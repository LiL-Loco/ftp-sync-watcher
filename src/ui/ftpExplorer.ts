import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import AdmZip from 'adm-zip';
import * as tar from 'tar';
import { ConfigManager } from '../core';
import { FtpSyncProfile } from '../types';
import { FtpClient } from '../clients/ftpClient';
import { SftpClientWrapper } from '../clients/sftpClient';
import { RemoteClient, RemoteFileInfo } from '../clients/remoteClient';
import { Logger, showInfoMessage, showSuccessMessage, showWarningMessage, showErrorMessage, withFolderProgress, withFileProgress, withIndeterminateProgress, resolveSafeLocalPath } from '../utils';

/**
 * Regex fuer Archiv-Dateinamen (.zip, .tar.gz, .tar, .tgz). Wird sowohl
 * fuer die contextValue-Logik im FtpTreeItem als auch fuer den
 * getArchiveType-Helper verwendet.
 */
const ARCHIVE_EXTENSION_REGEX = /\.(zip|tar\.gz|tgz|tar)$/i;

/**
 * Liefert true, wenn die uebergebene Datei ein unterstuetztes Archiv
 * (.zip, .tar.gz, .tar, .tgz) ist.
 */
function isArchiveFile(name: string): boolean {
    return ARCHIVE_EXTENSION_REGEX.test(name);
}

/**
 * Bestimmt den Archiv-Typ aus dem Dateinamen. Liefert 'zip' fuer .zip,
 * 'tar' fuer .tar/.tar.gz/.tgz, oder null fuer nicht-unterstuetzte Formate.
 */
function getArchiveType(name: string): 'zip' | 'tar' | null {
    if (/\.zip$/i.test(name)) {
        return 'zip';
    }
    if (/\.(tar\.gz|tgz|tar)$/i.test(name)) {
        return 'tar';
    }
    return null;
}

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
            // Archiv-Dateien tragen eine zusaetzliche Markierung 'ftpArchive',
            // damit das Kontextmenue zielgerichtet nur fuer Archive
            // Extract-Befehle anbieten kann. 'ftpFile' bleibt enthalten,
            // damit bestehende Menuepunkte (Download/Delete/Copy Path)
            // weiterhin matchen (viewItem =~ /ftpFile/).
            this.contextValue = isArchiveFile(label)
                ? 'ftpFile|ftpArchive'
                : 'ftpFile';

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
                // Statt leerer View (→ viewsWelcome-Link): ein dediziertes
                // NoConfigItem mit command. Eindeutiger Render-Pfad, kein
                // doppelter Button, konsistent mit ConnectionStatusItem /
                // CurrentPathItem.
                return [new NoConfigItem()];
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
     * Copy the absolute remote path of an FTP Explorer item to the system
     * clipboard. Useful for pasting the path into a `.ftpsync.json` profile
     * (`remotePath` field) without having to type it manually.
     */
    public async copyRemotePath(item: FtpTreeItem): Promise<void> {
        try {
            await vscode.env.clipboard.writeText(item.remotePath);
            Logger.info(`Copied remote path to clipboard: ${item.remotePath}`);
            showSuccessMessage(`Copied: ${item.remotePath}`);
        } catch (error) {
            Logger.error(`Failed to copy remote path: ${(error as Error).message}`);
            showErrorMessage(`Failed to copy remote path: ${(error as Error).message}`);
        }
    }

    /**
     * Move/rename a remote file or folder via an InputBox. Atomic on both
     * FTP (RNFR + RNTO) and SFTP (`ssh2-sftp-client.rename()`). Validates
     * the new path is absolute and contains no `..` segments before
     * contacting the server. Invalidates the cache for both source and
     * target parent directories so the explorer refresh shows the new
     * layout.
     */
    public async moveRemoteFile(item: FtpTreeItem): Promise<void> {
        if (!this.client || !item.remotePath) {
            showWarningMessage('Not connected');
            return;
        }

        const newPath = await vscode.window.showInputBox({
            prompt: `Move "${item.label}" to:`,
            value: item.remotePath,
            placeHolder: '/remote/path/to/new-name-or-location',
            validateInput: (value: string) => {
                if (!value) {
                    return 'Path is required';
                }
                if (!value.startsWith('/')) {
                    return 'Path must be absolute (start with /)';
                }
                if (value.split('/').some((seg) => seg === '..')) {
                    return 'Path must not contain .. segments';
                }
                if (value === item.remotePath) {
                    return 'New path must differ from current path';
                }
                return null;
            }
        });

        if (!newPath) {
            return;
        }

        try {
            await this.client.rename(item.remotePath, newPath);
            const sourceParent = path.posix.dirname(item.remotePath);
            const targetParent = path.posix.dirname(newPath);
            this.directoryCache.delete(sourceParent);
            if (targetParent !== sourceParent) {
                this.directoryCache.delete(targetParent);
            }
            this.refresh();
            showSuccessMessage(`Moved: ${item.label} -> ${newPath}`);
        } catch (error) {
            Logger.error(`Move failed: ${(error as Error).message}`);
            showErrorMessage(`Move failed: ${(error as Error).message}`);
        }
    }

    /**
     * Extract a remote archive (.zip, .tar.gz, .tar, .tgz) on the FTP/SFTP
     * server. Workflow: 1) Download des Archivs in ein lokales Temp-Verzeichnis,
     * 2) lokales Entpacken, 3) rekursiver Upload jedes extrahierten Elements
     * in das Ziel-Verzeichnis auf dem Server. Bei `customTargetDir === undefined`
     * wird das Ziel automatisch aus dem Parent-Dir des Archivs und dem Archiv-
     * Namen (ohne Endung) gebildet (sogenanntes 'Extract Here').
     *
     * Unterstuetzt nur Formate, die `getArchiveType()` kennt. Pfad-Traversal-
     * Schutz verhindert, dass Archiv-Inhalte mit `..`-Segmenten aus dem
     * Ziel-Verzeichnis ausbrechen.
     */
    public async extractRemoteArchive(item: FtpTreeItem, customTargetDir?: string): Promise<void> {
        if (!this.client || !this.profile || !this.workspacePath) {
            showWarningMessage('Not connected');
            return;
        }

        const archiveType = getArchiveType(item.label as string);
        if (!archiveType) {
            showWarningMessage(`Unsupported archive format: ${item.label}`);
            return;
        }

        // Ziel-Verzeichnis: 'Extract Here' = Parent-Dir + Archiv-Name ohne
        // Extension; 'Extract to...' = benutzerdefiniert (vom Caller gesetzt).
        const parentDir = path.posix.dirname(item.remotePath);
        const baseName = (item.label as string).replace(ARCHIVE_EXTENSION_REGEX, '');
        const targetDir = customTargetDir ?? path.posix.join(parentDir, baseName);

        if (!targetDir.startsWith('/')) {
            showErrorMessage(`Target directory must be an absolute path (got: ${targetDir})`);
            return;
        }

        const tempDir = path.join(
            os.tmpdir(),
            `ftp-sync-extract-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
        );
        const tempArchive = path.join(tempDir, item.label as string);
        const tempExtract = path.join(tempDir, 'extracted');

        try {
            Logger.info(`Extracting remote archive: ${item.remotePath} -> ${targetDir}`);

            // Schritt 1: Archiv auf den lokalen Temp-Pfad herunterladen.
            await withIndeterminateProgress(
                `Downloading ${item.label}`,
                async (update) => {
                    update('Downloading...');
                    await this.client!.downloadFile(item.remotePath, tempArchive);
                    update('Download complete');
                }
            );
            Logger.info(`Downloaded archive to ${tempArchive}`);

            // Schritt 2: Lokal entpacken. adm-zip ist synchron (in-memory),
            // tar.x ist async (streaming).
            await withIndeterminateProgress(
                `Extracting ${item.label}`,
                async (update) => {
                    update('Extracting...');
                    fs.mkdirSync(tempExtract, { recursive: true });
                    if (archiveType === 'zip') {
                        const zip = new AdmZip(tempArchive);
                        zip.extractAllTo(tempExtract, true);
                    } else {
                        await tar.x({ file: tempArchive, cwd: tempExtract });
                    }
                    update('Extract complete');
                }
            );
            Logger.info(`Extracted archive to ${tempExtract}`);

            // Schritt 3: Lokal entpackte Struktur aufwaerts und auf den Server
            // hochladen. Verzeichnisse werden vor dem Inhalt angelegt (manche
            // FTP-Server legen kein implizites Parent-Dir an).
            const entries = this.collectExtractedEntries(tempExtract);
            if (entries.length === 0) {
                showInfoMessage(`Archive "${item.label}" is empty`);
                return;
            }

            await withFolderProgress(
                `Uploading ${entries.length} entries to ${targetDir}`,
                entries.length,
                async (reportProgress) => {
                    try {
                        await this.client!.createDirectory(targetDir);
                    } catch (e) {
                        // 'already exists' ist OK; andere Fehler weiterwerfen.
                        const msg = (e as Error).message;
                        if (!msg.includes('already exists') && !msg.includes('EEXIST')) {
                            throw e;
                        }
                    }

                    let counter = 0;
                    for (const { localPath, relativePath, isDirectory } of entries) {
                        // Pfad-Traversal-Schutz: kein Segment darf '..' sein.
                        if (relativePath.split('/').some((seg) => seg === '..')) {
                            throw new Error(
                                `Archive contains path traversal segment: ${relativePath}`
                            );
                        }
                        const remotePath = path.posix.join(targetDir, relativePath);
                        if (isDirectory) {
                            await this.client!.createDirectory(remotePath);
                        } else {
                            await this.client!.uploadFile(localPath, remotePath);
                        }
                        counter++;
                        reportProgress(counter, path.posix.basename(remotePath));
                    }
                }
            );

            // Cache invalidieren, damit der Explorer die neuen Eintraege zeigt.
            this.directoryCache.delete(parentDir);
            this.directoryCache.delete(targetDir);
            this.refresh();

            showSuccessMessage(`Extracted to ${targetDir}`);
        } catch (error) {
            Logger.error(`Extract failed: ${(error as Error).message}`);
            showErrorMessage(`Extract failed: ${(error as Error).message}`);
        } finally {
            // Cleanup: lokales Temp-Verzeichnis loeschen, auch bei Fehlschlag.
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (cleanupError) {
                Logger.warn(
                    `Failed to clean up temp dir ${tempDir}: ${(cleanupError as Error).message}`
                );
            }
        }
    }

    /**
     * Sammelt alle Dateien und Verzeichnisse unterhalb von `rootDir`
     * rekursiv ein. Verzeichnisse werden vor ihren Inhalten aufgelistet,
     * damit der Caller sie auf dem Server anlegen kann, bevor die
     * enthaltenen Dateien hochgeladen werden. `relativePath` ist immer
     * posix-stil (mit '/' als Separator) fuer die spaetere Zusammensetzung
     * mit `path.posix.join(targetDir, ...)`.
     */
    private collectExtractedEntries(
        rootDir: string
    ): Array<{ localPath: string; relativePath: string; isDirectory: boolean }> {
        const result: Array<{ localPath: string; relativePath: string; isDirectory: boolean }> = [];

        const walk = (dir: string, relBase: string): void => {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            // Alphabetisch sortieren fuer stabile Reihenfolge.
            entries.sort((a, b) => a.name.localeCompare(b.name));
            for (const entry of entries) {
                const localPath = path.join(dir, entry.name);
                const relativePath = relBase ? `${relBase}/${entry.name}` : entry.name;
                if (entry.isDirectory()) {
                    result.push({ localPath, relativePath, isDirectory: true });
                    walk(localPath, relativePath);
                } else if (entry.isFile()) {
                    result.push({ localPath, relativePath, isDirectory: false });
                }
                // Symlinks und andere werden bewusst uebergangen.
            }
        };

        walk(rootDir, '');
        return result;
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

/**
 * Drag-and-drop controller for the FTP Explorer TreeView. Enables internal
 * drag-and-drop from one FtpTreeItem to another: dropping a file or folder
 * onto a folder moves the source into that folder via the active
 * `RemoteClient.rename()` (atomic on both FTP and SFTP). Dropping on a file
 * moves the source into that file's parent folder (VS Code convention).
 *
 * Verbote:
 * - Drop without target (empty space): rejected, otherwise the destination
 *   would be ambiguous.
 * - Drop on a folder into itself or one of its descendants: rejected to
 *   prevent infinite recursion.
 * - Drop on a status item (connection status, no-config, current-path):
 *   rejected, those are not navigable paths.
 * - Sources that are not FtpTreeItem instances: rejected.
 *
 * Cache invalidation: both source and target parent directories are cleared
 * once all moves succeed. A single success/failure message is reported at the
 * end.
 */
export class FtpExplorerDragAndDropController implements vscode.TreeDragAndDropController<vscode.TreeItem> {
    public readonly dragMimeTypes: readonly string[] = ['application/vnd.code-tree-ftpexplorer'];
    public readonly dropMimeTypes: readonly string[] = ['application/vnd.code-tree-ftpexplorer'];

    constructor(private provider: FtpExplorerProvider) {}

    /**
     * Set a custom MIME item on the data transfer so the drop can identify
     * the source. `TreeDragAndDropController<T>.handleDrop` does NOT receive
     * the source array as a separate argument — it must be re-read from
     * the dataTransfer payload set here.
     */
    public async handleDrag(
        sources: readonly vscode.TreeItem[],
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const payload = sources
            .filter((s): s is FtpTreeItem => s instanceof FtpTreeItem)
            .map((s) => ({ remotePath: s.remotePath, isDirectory: s.isDirectory, label: s.label }));
        dataTransfer.set(
            'application/vnd.code-tree-ftpexplorer',
            new vscode.DataTransferItem(payload)
        );
    }

    public async handleDrop(
        target: vscode.TreeItem | undefined,
        dataTransfer: vscode.DataTransfer,
        _token: vscode.CancellationToken
    ): Promise<void> {
        const client = this.provider['client'] as RemoteClient | undefined;
        if (!client) {
            showWarningMessage('Not connected');
            return;
        }

        const targetItem = target instanceof FtpTreeItem ? target : undefined;
        if (!targetItem) {
            showWarningMessage('Drop target must be a folder or file in the FTP Explorer');
            return;
        }

        const sourcePayload = dataTransfer.get('application/vnd.code-tree-ftpexplorer');
        if (!sourcePayload) {
            return;
        }
        const sourceText = await sourcePayload.asString();
        let sourceList: Array<{ remotePath: string; isDirectory: boolean; label: string }>;
        try {
            sourceList = JSON.parse(sourceText);
        } catch {
            return;
        }
        if (!Array.isArray(sourceList) || sourceList.length === 0) {
            return;
        }

        const moves: Array<{ from: string; to: string; label: string }> = [];
        for (const source of sourceList) {
            const newPath = this.computeMoveTargetFromPayload(source, targetItem);
            if (!newPath) {
                showWarningMessage(`Cannot move "${source.label}" onto "${targetItem.label}" — invalid drop`);
                return;
            }
            moves.push({ from: source.remotePath, to: newPath, label: source.label });
        }

        let successCount = 0;
        let failCount = 0;
        const affectedParents = new Set<string>();

        for (const move of moves) {
            try {
                await client.rename(move.from, move.to);
                affectedParents.add(path.posix.dirname(move.from));
                affectedParents.add(path.posix.dirname(move.to));
                successCount++;
            } catch (error) {
                failCount++;
                Logger.error(`Move failed for ${move.from} -> ${move.to}: ${(error as Error).message}`);
                showErrorMessage(`Move failed: ${move.label} -> ${(error as Error).message}`);
            }
        }

        const cache = this.provider['directoryCache'] as Map<string, unknown>;
        for (const parent of affectedParents) {
            cache.delete(parent);
        }
        if (successCount > 0) {
            this.provider.refresh();
        }
        if (failCount === 0) {
            showSuccessMessage(`Moved ${successCount} item(s) to ${targetItem.remotePath}`);
        } else if (successCount > 0) {
            showWarningMessage(`Moved ${successCount}, ${failCount} failed`);
        }
    }

    /**
     * Berechnet den Zielpfad fuer einen Drop. Liefert null, wenn der Drop
     * ungueltig ist (Quelle = Ziel, Ziel ist Nachfahre der Quelle, oder
     * der Move waere ein No-Op in den gleichen Ordner).
     */
    private computeMoveTargetFromPayload(
        source: { remotePath: string; isDirectory: boolean; label: string },
        target: FtpTreeItem
    ): string | null {
        if (source.remotePath === target.remotePath) {
            return null;
        }

        if (target.isDirectory) {
            if (target.remotePath.startsWith(source.remotePath + '/')) {
                return null;
            }
            return path.posix.join(target.remotePath, source.label);
        }

        const targetParent = path.posix.dirname(target.remotePath);
        if (source.remotePath === targetParent) {
            return null;
        }
        if (target.remotePath.startsWith(source.remotePath + '/')) {
            return null;
        }
        return path.posix.join(targetParent, source.label);
    }
}
