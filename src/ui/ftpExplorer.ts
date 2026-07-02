import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigManager } from '../core';
import { FtpSyncProfile } from '../types';
import { FtpClient } from '../clients/ftpClient';
import { SftpClientWrapper } from '../clients/sftpClient';
import { RemoteClient, RemoteFileInfo } from '../clients/remoteClient';
import { Logger, showInfoMessage, showSuccessMessage, showWarningMessage, showErrorMessage, withFolderProgress, withFileProgress, resolveSafeLocalPath } from '../utils';

/**
 * Tree item for FTP Explorer
 */
export class FtpTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly remotePath: string,
        public readonly isDirectory: boolean,
        public readonly fileInfo?: RemoteFileInfo,
        public readonly workspacePath?: string
    ) {
        super(label, collapsibleState);

        if (isDirectory) {
            this.iconPath = new vscode.ThemeIcon('folder');
            this.contextValue = 'ftpFolder';
        } else {
            this.iconPath = new vscode.ThemeIcon('file');
            this.contextValue = 'ftpFile';
            
            // Add file size to description
            if (fileInfo?.size) {
                this.description = this.formatFileSize(fileInfo.size);
            }
        }

        this.tooltip = remotePath;
    }

    private formatFileSize(bytes: number): string {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
        if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
    }
}

/**
 * Connection status item
 */
export class ConnectionStatusItem extends vscode.TreeItem {
    constructor(
        public readonly status: 'disconnected' | 'connecting' | 'connected' | 'error',
        public readonly serverName?: string,
        public readonly errorMessage?: string
    ) {
        super(
            status === 'disconnected' ? 'Not Connected' :
            status === 'connecting' ? 'Connecting...' :
            status === 'connected' ? `Connected: ${serverName}` :
            `Error: ${errorMessage}`,
            vscode.TreeItemCollapsibleState.None
        );

        switch (status) {
            case 'disconnected':
                this.iconPath = new vscode.ThemeIcon('plug');
                this.description = 'Click to connect';
                this.command = {
                    command: 'ftpSync.connect',
                    title: 'Connect'
                };
                break;
            case 'connecting':
                this.iconPath = new vscode.ThemeIcon('sync~spin');
                break;
            case 'connected':
                this.iconPath = new vscode.ThemeIcon('check', new vscode.ThemeColor('charts.green'));
                break;
            case 'error':
                this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
                break;
        }

        this.contextValue = `connection-${status}`;
    }
}

/**
 * No config item
 */
export class NoConfigItem extends vscode.TreeItem {
    constructor() {
        super('No configuration found', vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('warning');
        this.description = 'Click to create';
        this.command = {
            command: 'ftpSync.createConfig',
            title: 'Create Configuration'
        };
        this.contextValue = 'noConfig';
    }
}

/**
 * Current path/breadcrumb item
 */
export class CurrentPathItem extends vscode.TreeItem {
    constructor(
        public readonly currentPath: string,
        public readonly canGoUp: boolean
    ) {
        super(currentPath, vscode.TreeItemCollapsibleState.None);
        this.iconPath = new vscode.ThemeIcon('folder-opened');
        this.description = canGoUp ? '← Go up' : 'Root';
        this.contextValue = 'currentPath';
        
        if (canGoUp) {
            this.command = {
                command: 'ftpSync.navigateUp',
                title: 'Go to Parent Directory'
            };
        }
    }
}

/**
 * FTP Explorer Tree Data Provider
 */
export class FtpExplorerProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<vscode.TreeItem | undefined | null | void> = new vscode.EventEmitter<vscode.TreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<vscode.TreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private client: RemoteClient | undefined;
    private profile: FtpSyncProfile | undefined;
    private workspacePath: string | undefined;
    private connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'error' = 'disconnected';
    private errorMessage: string | undefined;
    private directoryCache: Map<string, FtpTreeItem[]> = new Map();
    private currentPath: string = '/';

    constructor(private configManager: ConfigManager) {}

    /**
     * Refresh the tree view
     */
    public refresh(): void {
        this.directoryCache.clear();
        this._onDidChangeTreeData.fire();
    }

    /**
     * Connect to the FTP/SFTP server. Bei mehreren Profilen wird das erste
     * Profil des ersten Workspace-Folders mit geladenen Profilen verwendet.
     * Eine granularere Profil-Auswahl folgt in einem spaeteren Release.
     */
    public async connect(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            showWarningMessage('No workspace folder open');
            return;
        }

        for (const folder of workspaceFolders) {
            const profiles = this.configManager.getProfilesForFolder(folder.uri.fsPath);
            if (profiles && profiles.size > 0) {
                this.profile = profiles.values().next().value;
                this.workspacePath = folder.uri.fsPath;
                break;
            }
        }

        if (!this.profile) {
            showWarningMessage('No FTP configuration found. Create one first.');
            this.refresh();
            return;
        }

        this.connectionStatus = 'connecting';
        this.refresh();

        try {
            if (this.profile.protocol === 'sftp') {
                this.client = new SftpClientWrapper(this.profile);
            } else {
                this.client = new FtpClient(this.profile);
            }

            await this.client.connect();
            this.connectionStatus = 'connected';
            this.currentPath = this.profile.remotePath;
            Logger.success(`FTP Explorer connected to ${this.profile.host} (profile "${this.profile.name}")`);
            showSuccessMessage(`Connected to ${this.profile.name}`);
        } catch (error) {
            this.connectionStatus = 'error';
            this.errorMessage = (error as Error).message;
            Logger.error(`FTP Explorer connection failed: ${this.errorMessage}`);
            showErrorMessage(`Connection failed: ${this.errorMessage}`);
        }

        this.refresh();
    }

    /**
     * Disconnect from the server
     */
    public async disconnect(): Promise<void> {
        if (this.client) {
            try {
                await this.client.disconnect();
            } catch (error) {
                Logger.error(`Disconnect error: ${(error as Error).message}`);
            }
            this.client = undefined;
        }
        
        this.connectionStatus = 'disconnected';
        this.currentPath = '/';
        this.directoryCache.clear();
        this.refresh();
        Logger.info('FTP Explorer disconnected');
    }

    /**
     * Navigate to a specific path
     */
    public navigateTo(remotePath: string): void {
        this.currentPath = remotePath;
        this.refresh();
    }

    /**
     * Navigate up one directory
     */
    public navigateUp(): void {
        if (this.profile && this.currentPath !== this.profile.remotePath) {
            this.currentPath = path.posix.dirname(this.currentPath);
            this.refresh();
        }
    }

    /**
     * Get current path
     */
    public getCurrentPath(): string {
        return this.currentPath;
    }

    /**
     * Get tree item
     */
    getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children of a tree item
     */
    async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
        // Root level
        if (!element) {
            if (!this.configManager.hasProfiles()) {
                return [];
            }

            if (this.connectionStatus !== 'connected') {
                return [new ConnectionStatusItem(
                    this.connectionStatus,
                    this.profile?.name || this.profile?.host,
                    this.errorMessage
                )];
            }

            const items: vscode.TreeItem[] = [];

            const canGoUp = this.profile && this.currentPath !== this.profile.remotePath;
            items.push(new CurrentPathItem(this.currentPath, !!canGoUp));

            const directoryItems = await this.listDirectory(this.currentPath);
            items.push(...directoryItems);

            return items;
        }

        // If clicking on CurrentPathItem, do nothing (command handles navigation)
        if (element instanceof CurrentPathItem) {
            return [];
        }

        // Subdirectory - expand to show contents (don't navigate)
        if (element instanceof FtpTreeItem && element.isDirectory) {
            return this.listDirectory(element.remotePath);
        }

        return [];
    }

    /**
     * List directory contents
     */
    private async listDirectory(remotePath: string): Promise<FtpTreeItem[]> {
        // Check cache
        if (this.directoryCache.has(remotePath)) {
            return this.directoryCache.get(remotePath)!;
        }

        if (!this.client) {
            return [];
        }

        try {
            const files: RemoteFileInfo[] = await this.client.listDirectory(remotePath);
            
            const items: FtpTreeItem[] = files
                .filter((file: RemoteFileInfo) => file.name !== '.' && file.name !== '..')
                .sort((a: RemoteFileInfo, b: RemoteFileInfo) => {
                    // Directories first
                    if (a.type === 'directory' && b.type !== 'directory') return -1;
                    if (a.type !== 'directory' && b.type === 'directory') return 1;
                    // Then alphabetically
                    return a.name.localeCompare(b.name);
                })
                .map((file: RemoteFileInfo) => new FtpTreeItem(
                    file.name,
                    file.type === 'directory'
                        ? vscode.TreeItemCollapsibleState.Collapsed 
                        : vscode.TreeItemCollapsibleState.None,
                    path.posix.join(remotePath, file.name),
                    file.type === 'directory',
                    file,
                    this.workspacePath
                ));

            this.directoryCache.set(remotePath, items);
            return items;
        } catch (error) {
            Logger.error(`Failed to list directory ${remotePath}: ${(error as Error).message}`);
            return [];
        }
    }

    /**
     * Download a file or folder from the server
     */
    public async downloadItem(item: FtpTreeItem): Promise<void> {
        if (!this.client || !this.profile || !this.workspacePath) {
            showWarningMessage('Not connected');
            return;
        }

        try {
            // Lokaler Basispfad (Workspace + Profile-localPath).
            const basePath = path.isAbsolute(this.profile.localPath || '.')
                ? this.profile.localPath
                : path.join(this.workspacePath, this.profile.localPath || '.');

            // Konsolidierter Path-Traversal-Schutz (siehe resolveSafeLocalPath).
            const localPath = resolveSafeLocalPath(
                item.remotePath,
                this.profile.remotePath,
                basePath
            );
            const relativePath = path.relative(basePath, localPath);

            Logger.info(`Download: remotePath="${item.remotePath}", relativePath="${relativePath}", localPath="${localPath}"`);

            if (item.isDirectory) {
                // Download folder recursively with progress
                await this.downloadFolderRecursive(item.remotePath, localPath, item.label as string);
            } else {
                // Ensure local directory exists
                const localDir = path.dirname(localPath);
                if (!fs.existsSync(localDir)) {
                    fs.mkdirSync(localDir, { recursive: true });
                }
                
                // Download single file with progress
                await withFileProgress(`Downloading ${item.label}`, async () => {
                    await this.client!.downloadFile(item.remotePath, localPath);
                });
                showSuccessMessage(`Downloaded: ${item.label}`);
            }
        } catch (error) {
            if ((error as Error).message === 'Operation cancelled by user') {
                showInfoMessage('Download cancelled');
            } else {
                showErrorMessage(`Download failed: ${(error as Error).message}`);
            }
        }
    }

    /**
     * Download a folder recursively with progress tracking
     */
    private async downloadFolderRecursive(remotePath: string, localPath: string, folderName: string): Promise<void> {
        if (!this.client) {
            return;
        }

        // First, count all files to download
        const filesToDownload: Array<{ remotePath: string; localPath: string; name: string }> = [];
        
        const collectFiles = async (remoteDir: string, localDir: string): Promise<void> => {
            const items = await this.client!.listDirectory(remoteDir);
            
            for (const item of items) {
                const itemRemotePath = item.path;
                const itemLocalPath = path.join(localDir, item.name);
                
                if (item.type === 'directory') {
                    await collectFiles(itemRemotePath, itemLocalPath);
                } else {
                    filesToDownload.push({
                        remotePath: itemRemotePath,
                        localPath: itemLocalPath,
                        name: item.name
                    });
                }
            }
        };

        // Collect all files first
        await collectFiles(remotePath, localPath);
        
        if (filesToDownload.length === 0) {
            showInfoMessage(`Folder "${folderName}" is empty`);
            return;
        }

        // Download with progress
        let successCount = 0;
        let failCount = 0;

        await withFolderProgress(
            `Downloading ${folderName}`,
            filesToDownload.length,
            async (reportProgress) => {
                for (let i = 0; i < filesToDownload.length; i++) {
                    const file = filesToDownload[i];
                    reportProgress(i + 1, file.name);
                    
                    try {
                        // Ensure local directory exists
                        const localDir = path.dirname(file.localPath);
                        if (!fs.existsSync(localDir)) {
                            fs.mkdirSync(localDir, { recursive: true });
                        }
                        
                        await this.client!.downloadFile(file.remotePath, file.localPath);
                        successCount++;
                    } catch (error) {
                        Logger.error(`Failed to download ${file.name}: ${(error as Error).message}`);
                        failCount++;
                    }
                }
            }
        );

        if (failCount === 0) {
            showSuccessMessage(`Downloaded ${successCount} files from "${folderName}"`);
        } else {
            showWarningMessage(`Downloaded ${successCount} files, ${failCount} failed`);
        }
    }

    /**
     * Delete a file or folder from the server
     */
    public async deleteItem(item: FtpTreeItem): Promise<void> {
        if (!this.client) {
            showWarningMessage('Not connected');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `Delete ${item.isDirectory ? 'folder' : 'file'} "${item.label}" from server?`,
            { modal: true },
            'Delete'
        );

        if (confirm !== 'Delete') {
            return;
        }

        try {
            if (item.isDirectory) {
                await this.client.deleteDirectory(item.remotePath);
            } else {
                await this.client.deleteFile(item.remotePath);
            }
            
            // Clear cache for parent directory
            const parentPath = path.posix.dirname(item.remotePath);
            this.directoryCache.delete(parentPath);
            
            this.refresh();
            showSuccessMessage(`Deleted: ${item.label}`);
        } catch (error) {
            showErrorMessage(`Delete failed: ${(error as Error).message}`);
        }
    }

    /**
     * Dispose resources
     */
    public async dispose(): Promise<void> {
        await this.disconnect();
        this._onDidChangeTreeData.dispose();
    }
}
