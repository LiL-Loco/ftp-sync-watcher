import * as vscode from 'vscode';
import * as path from 'path';
import { FtpSyncConfig } from '../types';
import { Logger, normalizePath, getRelativePath, localToRemotePath } from '../utils';
import { IgnoreHandler } from './ignoreHandler';
import { ConnectionPool } from './connectionPool';
import { OperationQueue } from './operationQueue';

export type FileChangeType = 'created' | 'changed' | 'deleted';

export interface FileChangeEvent {
    type: FileChangeType;
    uri: vscode.Uri;
    relativePath: string;
}

export interface WatcherStats {
    uploadsSucceeded: number;
    uploadsFailed: number;
    deletesSucceeded: number;
    deletesFailed: number;
    lastActivity: Date | null;
    isConnected: boolean;
    queueLength: number;
}

/**
 * Robust file watcher with automatic reconnection and operation queuing
 */
export class FileWatcher {
    private config: FtpSyncConfig;
    private workspacePath: string;
    private ignoreHandler: IgnoreHandler;
    private watcher: vscode.FileSystemWatcher | undefined;
    private watcherDisposables: vscode.Disposable[] = [];
    private connectionPool: ConnectionPool;
    private operationQueue: OperationQueue;
    private isRunning = false;
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private pendingOperations: Set<string> = new Set(); // Track files currently being processed
    private activeUploads: Set<string> = new Set(); // Track files being uploaded by uploadFile()
    private debounceMs = 500; // Increased from 300ms to handle Ctrl+S spam
    private onChangeCallback?: (event: FileChangeEvent) => void;
    private onErrorCallback?: (error: Error) => void;
    private stats: WatcherStats = {
        uploadsSucceeded: 0,
        uploadsFailed: 0,
        deletesSucceeded: 0,
        deletesFailed: 0,
        lastActivity: null,
        isConnected: false,
        queueLength: 0
    };

    constructor(workspacePath: string, config: FtpSyncConfig) {
        this.workspacePath = workspacePath;
        this.config = config;
        this.ignoreHandler = new IgnoreHandler(
            workspacePath,
            config.ignore,
            config.useGitIgnore
        );
        this.connectionPool = new ConnectionPool(config);
        this.operationQueue = new OperationQueue(
            config.concurrency || 3,
            config.timeout || 30000
        );
    }

    /**
     * Start the file watcher
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            Logger.warn('File watcher is already running');
            return;
        }

        try {
            // Initialize ignore handler
            await this.ignoreHandler.initialize();

            // Test connection before starting
            Logger.info('Testing connection...');
            await this.connectionPool.getConnection();
            this.stats.isConnected = true;

            // Determine watch pattern
            const watchPattern = typeof this.config.watcher.files === 'string'
                ? this.config.watcher.files
                : '**/*';

            // Create file watcher
            const pattern = new vscode.RelativePattern(this.workspacePath, watchPattern);
            this.watcher = vscode.workspace.createFileSystemWatcher(pattern);

            // Setup event handlers and store disposables
            if (this.config.watcher.autoUpload) {
                this.watcherDisposables.push(
                    this.watcher.onDidCreate((uri) => this.handleFileChange('created', uri))
                );
                this.watcherDisposables.push(
                    this.watcher.onDidChange((uri) => this.handleFileChange('changed', uri))
                );
            }

            if (this.config.watcher.autoDelete) {
                this.watcherDisposables.push(
                    this.watcher.onDidDelete((uri) => this.handleFileChange('deleted', uri))
                );
            }

            this.isRunning = true;
            Logger.success(`File watcher started for ${this.workspacePath}`);
            Logger.info(`Watching pattern: ${watchPattern}`);
            Logger.info(`Concurrency: ${this.config.concurrency || 3}, Timeout: ${this.config.timeout || 30000}ms`);
        } catch (error) {
            this.stats.isConnected = false;
            Logger.error(`Failed to start file watcher: ${(error as Error).message}`, error as Error);
            throw error;
        }
    }

    /**
     * Stop the file watcher
     */
    public async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        // Clear debounce timers
        this.debounceTimers.forEach((timer) => clearTimeout(timer));
        this.debounceTimers.clear();

        // Clear pending operations tracking
        this.pendingOperations.clear();
        
        // Clear active uploads tracking
        this.activeUploads.clear();

        // Clear operation queue
        this.operationQueue.clear();

        // Dispose event listeners first
        this.watcherDisposables.forEach(d => d.dispose());
        this.watcherDisposables = [];

        // Dispose watcher
        if (this.watcher) {
            this.watcher.dispose();
            this.watcher = undefined;
        }

        // Dispose connection pool
        await this.connectionPool.dispose();
        this.stats.isConnected = false;

        this.isRunning = false;
        Logger.info('File watcher stopped');
    }

    /**
     * Check if watcher is running
     */
    public isActive(): boolean {
        return this.isRunning;
    }

    /**
     * Get current statistics
     */
    public getStats(): WatcherStats {
        const queueStatus = this.operationQueue.getStatus();
        return {
            ...this.stats,
            isConnected: this.connectionPool.isConnected(),
            queueLength: queueStatus.pending + queueStatus.active
        };
    }

    /**
     * Set callback for file changes
     */
    public onChange(callback: (event: FileChangeEvent) => void): void {
        this.onChangeCallback = callback;
    }

    /**
     * Set callback for errors
     */
    public onError(callback: (error: Error) => void): void {
        this.onErrorCallback = callback;
    }

    /**
     * Handle file change events with debouncing and duplicate prevention
     */
    private handleFileChange(type: FileChangeType, uri: vscode.Uri): void {
        const relativePath = getRelativePath(this.workspacePath, uri.fsPath);

        // Check if file should be ignored
        if (this.ignoreHandler.isIgnored(relativePath)) {
            Logger.debug(`Ignoring ${type} event for: ${relativePath}`);
            return;
        }

        // Use file path as key (not type:path) to coalesce all events for same file
        const key = uri.fsPath;
        
        // If this file is currently being uploaded via uploadFile() (uploadOnSave), skip
        // This prevents double uploads when both uploadOnSave and watcher are active
        if (this.activeUploads.has(key)) {
            Logger.debug(`Skipping watcher ${type} for: ${relativePath} (uploadOnSave in progress)`);
            return;
        }
        
        // If this file is already being processed, just reset the debounce timer
        // This ensures we upload the latest version after the current upload finishes
        const existingTimer = this.debounceTimers.get(key);
        if (existingTimer) {
            clearTimeout(existingTimer);
            Logger.debug(`Debouncing ${type} for: ${relativePath}`);
        }

        const timer = setTimeout(() => {
            this.debounceTimers.delete(key);
            
            // Skip if this file is already in the queue or being processed
            if (this.pendingOperations.has(key)) {
                Logger.debug(`Skipping duplicate ${type} for: ${relativePath} (already queued)`);
                return;
            }
            
            // Double-check activeUploads again after debounce
            if (this.activeUploads.has(key)) {
                Logger.debug(`Skipping watcher ${type} for: ${relativePath} (uploadOnSave completed during debounce)`);
                return;
            }
            
            this.queueFileChange(type, uri, relativePath);
        }, this.debounceMs);

        this.debounceTimers.set(key, timer);
    }

    /**
     * Queue a file change for processing
     */
    private queueFileChange(
        type: FileChangeType,
        uri: vscode.Uri,
        relativePath: string
    ): void {
        const event: FileChangeEvent = { type, uri, relativePath };
        const key = uri.fsPath;

        // Mark this file as pending
        this.pendingOperations.add(key);

        // Notify callback immediately
        if (this.onChangeCallback) {
            this.onChangeCallback(event);
        }

        // Queue the operation
        const priority = type === 'deleted' ? 0 : 1; // Uploads have higher priority
        
        this.operationQueue.enqueue(
            () => this.processFileChange(type, uri, relativePath),
            { priority, timeout: this.config.timeout || 30000 }
        ).then(() => {
            // Remove from pending on success
            this.pendingOperations.delete(key);
        }).catch((error) => {
            // Remove from pending on error
            this.pendingOperations.delete(key);
            Logger.error(`Failed to process ${type} for ${relativePath}: ${error.message}`);
            if (this.onErrorCallback) {
                this.onErrorCallback(error as Error);
            }
        });
    }

    /**
     * Process a file change event
     */
    private async processFileChange(
        type: FileChangeType,
        uri: vscode.Uri,
        relativePath: string
    ): Promise<void> {
        const remotePath = localToRemotePath(
            uri.fsPath,
            this.workspacePath,
            this.config.remotePath
        );

        try {
            await this.connectionPool.executeWithRetry(
                async (client) => {
                    switch (type) {
                        case 'created':
                        case 'changed':
                            const result = await client.uploadFile(uri.fsPath, remotePath);
                            if (result.success) {
                                this.stats.uploadsSucceeded++;
                            } else {
                                this.stats.uploadsFailed++;
                                throw result.error || new Error('Upload failed');
                            }
                            break;
                        case 'deleted':
                            try {
                                await client.deleteFile(remotePath);
                                this.stats.deletesSucceeded++;
                            } catch {
                                // Try deleting as directory
                                try {
                                    await client.deleteDirectory(remotePath);
                                    this.stats.deletesSucceeded++;
                                } catch (dirError) {
                                    this.stats.deletesFailed++;
                                    Logger.debug(`Could not delete ${remotePath}: may not exist on remote`);
                                }
                            }
                            break;
                    }
                },
                `${type} ${relativePath}`
            );

            this.stats.lastActivity = new Date();
            this.stats.isConnected = true;
        } catch (error) {
            this.stats.isConnected = this.connectionPool.isConnected();
            throw error;
        }
    }

    /**
     * Upload a single file manually (used by uploadOnSave)
     * This method is serialized via activeUploads to prevent conflicts with the watcher
     */
    public async uploadFile(localPath: string): Promise<boolean> {
        const relativePath = getRelativePath(this.workspacePath, localPath);
        
        if (this.ignoreHandler.isIgnored(relativePath)) {
            Logger.warn(`File is ignored: ${relativePath}`);
            return false;
        }

        // Mark this file as being uploaded to prevent watcher conflicts
        this.activeUploads.add(localPath);
        
        // Also cancel any pending debounce timer for this file
        const existingTimer = this.debounceTimers.get(localPath);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.debounceTimers.delete(localPath);
        }

        const remotePath = localToRemotePath(localPath, this.workspacePath, this.config.remotePath);

        try {
            await this.connectionPool.executeWithRetry(
                async (client) => {
                    const result = await client.uploadFile(localPath, remotePath);
                    if (!result.success) {
                        throw result.error || new Error('Upload failed');
                    }
                },
                `upload ${relativePath}`
            );

            this.stats.uploadsSucceeded++;
            this.stats.lastActivity = new Date();
            this.stats.isConnected = true;
            return true;
        } catch (error) {
            this.stats.uploadsFailed++;
            this.stats.isConnected = this.connectionPool.isConnected();
            Logger.error(`Failed to upload ${relativePath}: ${(error as Error).message}`);
            return false;
        } finally {
            // Remove from active uploads after a short delay
            // This gives the watcher time to ignore the change event
            setTimeout(() => {
                this.activeUploads.delete(localPath);
            }, 1000);
        }
    }

    /**
     * Download a single file manually
     */
    public async downloadFile(remotePath: string, localPath: string): Promise<boolean> {
        try {
            await this.connectionPool.executeWithRetry(
                async (client) => {
                    const result = await client.downloadFile(remotePath, localPath);
                    if (!result.success) {
                        throw result.error || new Error('Download failed');
                    }
                },
                `download ${path.basename(remotePath)}`
            );

            this.stats.lastActivity = new Date();
            this.stats.isConnected = true;
            return true;
        } catch (error) {
            this.stats.isConnected = this.connectionPool.isConnected();
            Logger.error(`Failed to download: ${(error as Error).message}`);
            return false;
        }
    }

    /**
     * Upload a folder recursively
     */
    public async uploadFolder(localPath: string): Promise<{ success: number; failed: number }> {
        const fs = await import('fs');
        const result = { success: 0, failed: 0 };

        const processDir = async (dirPath: string): Promise<void> => {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                const relativePath = getRelativePath(this.workspacePath, fullPath);

                if (this.ignoreHandler.isIgnored(relativePath)) {
                    continue;
                }

                if (entry.isDirectory()) {
                    await processDir(fullPath);
                } else if (entry.isFile()) {
                    const success = await this.uploadFile(fullPath);
                    if (success) {
                        result.success++;
                    } else {
                        result.failed++;
                    }
                }
            }
        };

        await processDir(localPath);
        return result;
    }

    /**
     * Reload ignore patterns
     */
    public async reloadIgnorePatterns(): Promise<void> {
        await this.ignoreHandler.reload();
    }

    /**
     * Force reconnection
     */
    public async forceReconnect(): Promise<void> {
        Logger.info('Forcing reconnection...');
        await this.connectionPool.forceReconnect();
        this.stats.isConnected = true;
    }

    /**
     * Pause processing
     */
    public pause(): void {
        this.operationQueue.pause();
    }

    /**
     * Resume processing
     */
    public resume(): void {
        this.operationQueue.resume();
    }
}
