import * as vscode from 'vscode';
import * as path from 'path';
import { ConfigManager } from '../core';
import { FtpSyncConfig } from '../types';
import { FtpClient } from '../clients/ftpClient';
import { SftpClientWrapper } from '../clients/sftpClient';
import { RemoteClient, RemoteFileInfo } from '../clients/remoteClient';
import { Logger } from '../utils';

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
    private config: FtpSyncConfig | undefined;
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
     * Connect to the FTP/SFTP server
     */
    public async connect(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            vscode.window.showWarningMessage('No workspace folder open');
            return;
        }

        // Get config for first workspace folder with config
        for (const folder of workspaceFolders) {
            const config = this.configManager.getConfig(folder.uri.fsPath);
            if (config) {
                this.config = config;
                this.workspacePath = folder.uri.fsPath;
                break;
            }
        }

        if (!this.config) {
            vscode.window.showWarningMessage('No FTP configuration found. Create one first.');
            this.refresh();
            return;
        }

        this.connectionStatus = 'connecting';
        this.refresh();

        try {
            // Create appropriate client
            if (this.config.protocol === 'sftp') {
                this.client = new SftpClientWrapper(this.config);
            } else {
                this.client = new FtpClient(this.config);
            }

            await this.client.connect();
            this.connectionStatus = 'connected';
            this.currentPath = this.config.remotePath;
            Logger.success(`FTP Explorer connected to ${this.config.host}`);
            vscode.window.showInformationMessage(`Connected to ${this.config.name || this.config.host}`);
        } catch (error) {
            this.connectionStatus = 'error';
            this.errorMessage = (error as Error).message;
            Logger.error(`FTP Explorer connection failed: ${this.errorMessage}`);
            vscode.window.showErrorMessage(`Connection failed: ${this.errorMessage}`);
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
        if (this.config && this.currentPath !== this.config.remotePath) {
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
            // Check if config exists - return empty array to show welcome content
            if (!this.configManager.hasConfigs()) {
                return [];
            }

            // Show connection status if not connected
            if (this.connectionStatus !== 'connected') {
                return [new ConnectionStatusItem(
                    this.connectionStatus,
                    this.config?.name || this.config?.host,
                    this.errorMessage
                )];
            }

            // Connected - show current path header and directory contents
            const items: vscode.TreeItem[] = [];
            
            // Add current path indicator
            const canGoUp = this.config && this.currentPath !== this.config.remotePath;
            items.push(new CurrentPathItem(this.currentPath, !!canGoUp));
            
            // Add directory contents
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
     * Download a file from the server
     */
    public async downloadItem(item: FtpTreeItem): Promise<void> {
        if (!this.client || !this.config || !this.workspacePath) {
            vscode.window.showWarningMessage('Not connected');
            return;
        }

        try {
            // Calculate local path
            const relativePath = item.remotePath.startsWith(this.config.remotePath)
                ? item.remotePath.substring(this.config.remotePath.length)
                : item.remotePath;
            
            const localPath = path.join(this.workspacePath, this.config.localPath || '.', relativePath);

            if (item.isDirectory) {
                // Download folder - to be implemented
                vscode.window.showInformationMessage('Folder download coming soon!');
            } else {
                await this.client.downloadFile(item.remotePath, localPath);
                vscode.window.showInformationMessage(`Downloaded: ${item.label}`);
            }
        } catch (error) {
            vscode.window.showErrorMessage(`Download failed: ${(error as Error).message}`);
        }
    }

    /**
     * Delete a file or folder from the server
     */
    public async deleteItem(item: FtpTreeItem): Promise<void> {
        if (!this.client) {
            vscode.window.showWarningMessage('Not connected');
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
            vscode.window.showInformationMessage(`Deleted: ${item.label}`);
        } catch (error) {
            vscode.window.showErrorMessage(`Delete failed: ${(error as Error).message}`);
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
