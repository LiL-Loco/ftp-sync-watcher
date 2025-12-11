import * as vscode from 'vscode';
import { ConfigManager, FileWatcher } from '../core';
import { StatusBar } from '../ui';
import { Logger, getRelativePath, localToRemotePath } from '../utils';

/**
 * Command handler for all FTP Sync commands
 */
export class CommandHandler {
    private configManager: ConfigManager;
    private watchers: Map<string, FileWatcher> = new Map();
    private statusBar: StatusBar;

    constructor(configManager: ConfigManager, statusBar: StatusBar) {
        this.configManager = configManager;
        this.statusBar = statusBar;
    }

    /**
     * Register all commands
     */
    public registerCommands(context: vscode.ExtensionContext): void {
        const commands = [
            vscode.commands.registerCommand('ftpSync.uploadFile', (uri?: vscode.Uri) => this.uploadFile(uri)),
            vscode.commands.registerCommand('ftpSync.uploadFolder', (uri?: vscode.Uri) => this.uploadFolder(uri)),
            vscode.commands.registerCommand('ftpSync.downloadFile', (uri?: vscode.Uri) => this.downloadFile(uri)),
            vscode.commands.registerCommand('ftpSync.downloadFolder', (uri?: vscode.Uri) => this.downloadFolder(uri)),
            vscode.commands.registerCommand('ftpSync.startWatcher', () => this.startWatcher()),
            vscode.commands.registerCommand('ftpSync.stopWatcher', () => this.stopWatcher()),
            vscode.commands.registerCommand('ftpSync.toggleWatcher', () => this.toggleWatcher()),
            vscode.commands.registerCommand('ftpSync.createConfig', () => this.createConfig()),
            vscode.commands.registerCommand('ftpSync.showOutput', () => Logger.show())
        ];

        commands.forEach(cmd => context.subscriptions.push(cmd));
    }

    /**
     * Dispose all watchers
     */
    public async dispose(): Promise<void> {
        for (const watcher of this.watchers.values()) {
            await watcher.stop();
        }
        this.watchers.clear();
    }

    /**
     * Upload current file or specified file
     */
    private async uploadFile(uri?: vscode.Uri): Promise<void> {
        const fileUri = uri || vscode.window.activeTextEditor?.document.uri;
        
        if (!fileUri) {
            vscode.window.showWarningMessage('No file selected');
            return;
        }

        const config = this.configManager.getConfigForUri(fileUri);
        if (!config) {
            vscode.window.showWarningMessage('No FTP configuration found for this workspace');
            return;
        }

        const workspacePath = this.configManager.getWorkspaceFolderPath(fileUri);
        if (!workspacePath) {
            return;
        }

        this.statusBar.showSyncing();

        try {
            // Get or create watcher, ensuring we reuse existing connections
            const watcher = await this.getOrCreateWatcher(workspacePath, config);

            const success = await watcher.uploadFile(fileUri.fsPath);
            
            if (success) {
                this.statusBar.showMessage('Upload complete!');
                vscode.window.showInformationMessage(`Uploaded: ${getRelativePath(workspacePath, fileUri.fsPath)}`);
            } else {
                this.statusBar.setState('error');
                vscode.window.showErrorMessage('Upload failed - Check output for details');
            }
        } catch (error) {
            this.statusBar.setState('error');
            Logger.error(`Upload failed: ${(error as Error).message}`, error as Error);
            vscode.window.showErrorMessage(`Upload failed: ${(error as Error).message}`);
        } finally {
            this.statusBar.endSyncing();
        }
    }

    /**
     * Upload folder
     */
    private async uploadFolder(uri?: vscode.Uri): Promise<void> {
        let folderUri = uri;
        
        if (!folderUri) {
            const folders = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Upload Folder'
            });
            
            if (!folders || folders.length === 0) {
                return;
            }
            folderUri = folders[0];
        }

        const config = this.configManager.getConfigForUri(folderUri);
        if (!config) {
            vscode.window.showWarningMessage('No FTP configuration found for this workspace');
            return;
        }

        const workspacePath = this.configManager.getWorkspaceFolderPath(folderUri);
        if (!workspacePath) {
            return;
        }

        this.statusBar.showSyncing();

        try {
            // Get or create watcher, ensuring we reuse existing connections
            const watcher = await this.getOrCreateWatcher(workspacePath, config);

            const result = await watcher.uploadFolder(folderUri.fsPath);
            
            this.statusBar.showMessage(`Uploaded ${result.success} files`);
            vscode.window.showInformationMessage(
                `Upload complete: ${result.success} succeeded, ${result.failed} failed`
            );
        } catch (error) {
            this.statusBar.setState('error');
            Logger.error(`Folder upload failed: ${(error as Error).message}`, error as Error);
            vscode.window.showErrorMessage(`Upload failed: ${(error as Error).message}`);
        } finally {
            this.statusBar.endSyncing();
        }
    }

    /**
     * Download current file
     */
    private async downloadFile(uri?: vscode.Uri): Promise<void> {
        const fileUri = uri || vscode.window.activeTextEditor?.document.uri;
        
        if (!fileUri) {
            vscode.window.showWarningMessage('No file selected');
            return;
        }

        const config = this.configManager.getConfigForUri(fileUri);
        if (!config) {
            vscode.window.showWarningMessage('No FTP configuration found for this workspace');
            return;
        }

        const workspacePath = this.configManager.getWorkspaceFolderPath(fileUri);
        if (!workspacePath) {
            return;
        }

        const remotePath = localToRemotePath(fileUri.fsPath, workspacePath, config.remotePath);

        this.statusBar.showSyncing();

        try {
            // Get or create watcher, ensuring we reuse existing connections
            const watcher = await this.getOrCreateWatcher(workspacePath, config);

            const success = await watcher.downloadFile(remotePath, fileUri.fsPath);
            
            if (success) {
                this.statusBar.showMessage('Download complete!');
                vscode.window.showInformationMessage(`Downloaded: ${getRelativePath(workspacePath, fileUri.fsPath)}`);
            } else {
                this.statusBar.setState('error');
                vscode.window.showErrorMessage('Download failed - Check output for details');
            }
        } catch (error) {
            this.statusBar.setState('error');
            Logger.error(`Download failed: ${(error as Error).message}`, error as Error);
            vscode.window.showErrorMessage(`Download failed: ${(error as Error).message}`);
        } finally {
            this.statusBar.endSyncing();
        }
    }

    /**
     * Download folder (placeholder)
     */
    private async downloadFolder(uri?: vscode.Uri): Promise<void> {
        vscode.window.showInformationMessage('Download folder feature coming soon!');
    }

    /**
     * Start file watcher
     */
    private async startWatcher(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showWarningMessage('No workspace folder open');
            return;
        }

        for (const folder of workspaceFolders) {
            const config = this.configManager.getConfig(folder.uri.fsPath);
            if (!config) {
                continue;
            }

            if (!config.watcher.enabled) {
                Logger.info(`Watcher disabled for ${folder.name}`);
                continue;
            }

            if (this.watchers.has(folder.uri.fsPath)) {
                Logger.info(`Watcher already running for ${folder.name}`);
                continue;
            }

            try {
                const watcher = new FileWatcher(folder.uri.fsPath, config);
                
                watcher.onChange((event) => {
                    this.statusBar.showSyncing();
                    Logger.info(`${event.type}: ${event.relativePath}`);
                    setTimeout(() => this.statusBar.endSyncing(), 500);
                });

                await watcher.start();
                this.watchers.set(folder.uri.fsPath, watcher);
                
                Logger.success(`Watcher started for ${folder.name}`);
            } catch (error) {
                Logger.error(`Failed to start watcher for ${folder.name}: ${(error as Error).message}`);
                this.statusBar.setState('error');
                vscode.window.showErrorMessage(`Failed to start watcher: ${(error as Error).message}`);
                return;
            }
        }

        if (this.watchers.size > 0) {
            this.statusBar.setState('watching');
            vscode.window.showInformationMessage('FTP Sync: File watcher started');
        }
    }

    /**
     * Stop file watcher
     */
    private async stopWatcher(): Promise<void> {
        for (const [path, watcher] of this.watchers) {
            await watcher.stop();
            Logger.info(`Watcher stopped for ${path}`);
        }
        
        this.watchers.clear();
        this.statusBar.setState('idle');
        vscode.window.showInformationMessage('FTP Sync: File watcher stopped');
    }

    /**
     * Toggle file watcher
     * If no config exists, creates one first
     */
    private async toggleWatcher(): Promise<void> {
        // Check if any config exists
        if (!this.configManager.hasConfigs()) {
            // No config exists - create one
            await this.createConfig();
            // After config is created, reload configs
            await this.configManager.initialize();
            // Update status bar state
            if (this.configManager.hasConfigs()) {
                this.statusBar.setState('idle');
            }
            return;
        }

        if (this.watchers.size > 0) {
            await this.stopWatcher();
        } else {
            await this.startWatcher();
        }
    }

    /**
     * Create configuration file
     */
    private async createConfig(): Promise<void> {
        Logger.info('createConfig command triggered');
        
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showWarningMessage('No workspace folder open');
            return;
        }

        let folderPath: string;
        
        if (workspaceFolders.length === 1) {
            folderPath = workspaceFolders[0].uri.fsPath;
        } else {
            const selected = await vscode.window.showQuickPick(
                workspaceFolders.map(f => ({
                    label: f.name,
                    description: f.uri.fsPath,
                    folder: f
                })),
                { placeHolder: 'Select workspace folder for configuration' }
            );
            
            if (!selected) {
                return;
            }
            folderPath = selected.folder.uri.fsPath;
        }

        await this.configManager.createConfig(folderPath);
    }

    /**
     * Auto-start watchers if configured
     */
    public async autoStart(): Promise<void> {
        const autoStart = vscode.workspace.getConfiguration('ftpSync').get<boolean>('autoStartWatcher');
        if (autoStart && this.configManager.hasConfigs()) {
            await this.startWatcher();
        }
    }

    /**
     * Handle document save for upload on save
     */
    public async handleDocumentSave(document: vscode.TextDocument): Promise<void> {
        const config = this.configManager.getConfigForUri(document.uri);
        if (!config || !config.uploadOnSave) {
            return;
        }

        const workspacePath = this.configManager.getWorkspaceFolderPath(document.uri);
        if (!workspacePath) {
            return;
        }

        // Get or create watcher, ensuring we reuse existing connections
        const watcher = await this.getOrCreateWatcher(workspacePath, config);

        this.statusBar.showSyncing();
        
        try {
            const success = await watcher.uploadFile(document.uri.fsPath);
            if (!success) {
                this.statusBar.setState('error');
            }
        } catch (error) {
            Logger.error(`Upload on save failed: ${(error as Error).message}`);
            this.statusBar.setState('error');
        } finally {
            this.statusBar.endSyncing();
        }
    }

    /**
     * Get existing watcher or create a new one for the workspace path
     * Ensures connection reuse and prevents connection leaks
     */
    private async getOrCreateWatcher(workspacePath: string, config: import('../types').FtpSyncConfig): Promise<FileWatcher> {
        let watcher = this.watchers.get(workspacePath);
        if (!watcher) {
            watcher = new FileWatcher(workspacePath, config);
            this.watchers.set(workspacePath, watcher);
        }
        return watcher;
    }
}
