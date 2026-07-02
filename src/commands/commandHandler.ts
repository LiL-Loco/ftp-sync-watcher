import * as vscode from 'vscode';
import { ConfigManager, FileWatcher } from '../core';
import { StatusBar } from '../ui';
import { FtpSyncProfile } from '../types';
import { Logger, getRelativePath, localToRemotePath, showInfoMessage, showSuccessMessage, showWarningMessage, showErrorMessage, withFileProgress, withFolderProgress } from '../utils';

/**
 * Command-Handler fuer alle FTP-Sync-Kommandos. Verwaltet einen FileWatcher
 * pro Workspace-Folder. Seit v2.0.0 bekommt der Watcher die vollstaendige
 * Profil-Map eines Workspaces, nicht mehr ein einzelnes Config-Objekt.
 */
export class CommandHandler {
    private configManager: ConfigManager;
    private watchers: Map<string, FileWatcher> = new Map();
    private watcherPromises: Map<string, Promise<FileWatcher>> = new Map();
    private statusBar: StatusBar;

    constructor(configManager: ConfigManager, statusBar: StatusBar) {
        this.configManager = configManager;
        this.statusBar = statusBar;
    }

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

    public async dispose(): Promise<void> {
        // Promises zuerst aufloesen, damit keine Race-Conditions mehr laufende
        // Initialisierungen "ueberleben".
        this.watcherPromises.clear();
        for (const watcher of this.watchers.values()) {
            await watcher.stop();
        }
        this.watchers.clear();
    }

    private async uploadFile(uri?: vscode.Uri): Promise<void> {
        const fileUri = uri || vscode.window.activeTextEditor?.document.uri;

        if (!fileUri) {
            showWarningMessage('No file selected');
            return;
        }

        const workspacePath = this.configManager.getWorkspaceFolderPath(fileUri);
        if (!workspacePath) {
            return;
        }

        const profile = this.configManager.getProfileForUri(fileUri);
        if (!profile) {
            showWarningMessage('No FTP configuration found for this file');
            return;
        }

        this.statusBar.showSyncing();

        try {
            const watcher = await this.getOrCreateWatcher(workspacePath);

            const fileName = getRelativePath(workspacePath, fileUri.fsPath);
            const success = await withFileProgress(`Uploading ${fileName}`, async () => {
                return watcher.uploadFile(fileUri.fsPath);
            });

            if (success) {
                this.statusBar.showMessage('Upload complete!');
                showSuccessMessage(`Uploaded: ${fileName}`);
            } else {
                this.statusBar.setState('error');
                showErrorMessage('Upload failed - Check output for details');
            }
        } catch (error) {
            this.statusBar.setState('error');
            Logger.error(`Upload failed: ${(error as Error).message}`, error as Error);
            showErrorMessage(`Upload failed: ${(error as Error).message}`);
        } finally {
            this.statusBar.endSyncing();
        }
    }

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

        const workspacePath = this.configManager.getWorkspaceFolderPath(folderUri);
        if (!workspacePath) {
            return;
        }

        // Ordner-Upload: jedes Profil, dessen localPath innerhalb des
        // Ordners liegt, bekommt seinen Anteil. Heute heisst das: ein
        // Profil pro Ordner.
        const profile = this.configManager.getProfileForUri(folderUri);
        if (!profile) {
            showWarningMessage('No FTP configuration found for this workspace');
            return;
        }

        this.statusBar.showSyncing();

        try {
            const watcher = await this.getOrCreateWatcher(workspacePath);

            const fileCount = await watcher.getFileCount(folderUri.fsPath);

            if (fileCount === 0) {
                showInfoMessage('Folder is empty or all files are ignored');
                return;
            }

            const folderName = folderUri.fsPath.split(/[\\/]/).pop() || 'folder';

            const result = await withFolderProgress(
                `Uploading ${folderName}`,
                fileCount,
                async (reportProgress) => {
                    return watcher.uploadFolder(folderUri!.fsPath, (current, total, fileName) => {
                        reportProgress(current, fileName);
                    });
                }
            );

            this.statusBar.showMessage(`Uploaded ${result.success} files`);
            showSuccessMessage(
                `Upload complete: ${result.success} succeeded, ${result.failed} failed`
            );
        } catch (error) {
            this.statusBar.setState('error');
            Logger.error(`Folder upload failed: ${(error as Error).message}`, error as Error);
            showErrorMessage(`Upload failed: ${(error as Error).message}`);
        } finally {
            this.statusBar.endSyncing();
        }
    }

    private async downloadFile(uri?: vscode.Uri): Promise<void> {
        const fileUri = uri || vscode.window.activeTextEditor?.document.uri;

        if (!fileUri) {
            showWarningMessage('No file selected');
            return;
        }

        const workspacePath = this.configManager.getWorkspaceFolderPath(fileUri);
        if (!workspacePath) {
            return;
        }

        const profile = this.configManager.getProfileForUri(fileUri);
        if (!profile) {
            showWarningMessage('No FTP configuration found for this file');
            return;
        }

        const remotePath = localToRemotePath(fileUri.fsPath, profile.localPath, profile.remotePath);

        this.statusBar.showSyncing();

        try {
            const watcher = await this.getOrCreateWatcher(workspacePath);

            const success = await watcher.downloadFile(remotePath, fileUri.fsPath);

            if (success) {
                this.statusBar.showMessage('Download complete!');
                showSuccessMessage(`Downloaded: ${getRelativePath(workspacePath, fileUri.fsPath)}`);
            } else {
                this.statusBar.setState('error');
                showErrorMessage('Download failed - Check output for details');
            }
        } catch (error) {
            this.statusBar.setState('error');
            Logger.error(`Download failed: ${(error as Error).message}`, error as Error);
            showErrorMessage(`Download failed: ${(error as Error).message}`);
        } finally {
            this.statusBar.endSyncing();
        }
    }

    private async downloadFolder(_uri?: vscode.Uri): Promise<void> {
        showInfoMessage('Download folder feature coming soon!');
    }

    private async startWatcher(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            showWarningMessage('No workspace folder open');
            return;
        }

        for (const folder of workspaceFolders) {
            const profiles = this.configManager.getProfiles(folder.uri.fsPath);
            if (profiles.size === 0) {
                continue;
            }

            const hasEnabled = Array.from(profiles.values())
                .some(p => p.watcher.enabled);
            if (!hasEnabled) {
                Logger.info(`All profiles disabled for ${folder.name}`);
                continue;
            }

            if (this.watchers.has(folder.uri.fsPath)) {
                Logger.info(`Watcher already running for ${folder.name}`);
                continue;
            }

            try {
                const watcher = new FileWatcher(folder.uri.fsPath, profiles);

                watcher.onChange((event) => {
                    this.statusBar.showSyncing();
                    Logger.info(`[${event.profileName}] ${event.type}: ${event.relativePath}`);
                    setTimeout(() => this.statusBar.endSyncing(), 500);
                });

                await watcher.start();
                this.watchers.set(folder.uri.fsPath, watcher);

                Logger.success(`Watcher started for ${folder.name} (${profiles.size} profile(s))`);
            } catch (error) {
                Logger.error(`Failed to start watcher for ${folder.name}: ${(error as Error).message}`);
                this.statusBar.setState('error');
                showErrorMessage(`Failed to start watcher: ${(error as Error).message}`);
                return;
            }
        }

        if (this.watchers.size > 0) {
            this.statusBar.setState('watching');
            this.statusBar.setProfileCount(this.configManager.getProfileCount());
            showSuccessMessage('FTP Sync: File watcher started');
        }
    }

    private async stopWatcher(): Promise<void> {
        // Promises cachen, damit eine noch laufende Initialisierung das
        // .clear() nicht ueberlebt.
        this.watcherPromises.clear();
        for (const [path, watcher] of this.watchers) {
            await watcher.stop();
            Logger.info(`Watcher stopped for ${path}`);
        }

        this.watchers.clear();
        this.statusBar.setProfileCount(0);
        this.statusBar.setState('idle');
        showInfoMessage('FTP Sync: File watcher stopped');
    }

    private async toggleWatcher(): Promise<void> {
        if (!this.configManager.hasProfiles()) {
            await this.createConfig();
            await this.configManager.initialize();
            if (this.configManager.hasProfiles()) {
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

    private async createConfig(): Promise<void> {
        Logger.info('createConfig command triggered');

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            showWarningMessage('No workspace folder open');
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

    public async autoStart(): Promise<void> {
        const autoStart = vscode.workspace.getConfiguration('ftpSync').get<boolean>('autoStartWatcher');
        if (autoStart && this.configManager.hasProfiles()) {
            await this.startWatcher();
        }
    }

    /**
     * Upload-on-Save: wird vom globalen Document-Save-Listener aufgerufen.
     * Loest das Profil per URI auf; bei mehreren Profilen im selben
     * Workspace gewinnt das spezifischste (laengster localPath).
     */
    public async handleDocumentSave(document: vscode.TextDocument): Promise<void> {
        const profile = this.configManager.getProfileForUri(document.uri);
        if (!profile || !profile.uploadOnSave) {
            return;
        }

        const workspacePath = this.configManager.getWorkspaceFolderPath(document.uri);
        if (!workspacePath) {
            return;
        }

        const watcher = await this.getOrCreateWatcher(workspacePath);

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
     * Liefert den Watcher fuer den Workspace-Pfad oder erstellt einen neuen,
     * falls noch keiner laeuft. Stellt sicher, dass jede Workspace-Folder-
     * Verbindung nur einmal aufgebaut wird — selbst wenn mehrere Aufrufer
     * gleichzeitig (z.B. Upload + Upload-on-Save) eine Initialisierung
     * anstossen.
     *
     * Implementiert einen Promise-Cache: waehrend die erste Initialisierung
     * laeuft, teilen sich alle nachfolgenden Aufrufer dasselbe Promise. Erst
     * nach Abschluss (oder Fehler) wird der Eintrag entfernt, sodass ein
     * Retry moeglich ist.
     */
    private async getOrCreateWatcher(workspacePath: string): Promise<FileWatcher> {
        const cached = this.watchers.get(workspacePath);
        if (cached) {
            return cached;
        }

        const pending = this.watcherPromises.get(workspacePath);
        if (pending) {
            return pending;
        }

        const promise = (async () => {
            const profiles = this.configManager.getProfiles(workspacePath);
            if (profiles.size === 0) {
                throw new Error(`No profiles for workspace ${workspacePath}`);
            }
            const watcher = new FileWatcher(workspacePath, profiles);
            this.watchers.set(workspacePath, watcher);
            return watcher;
        })();

        this.watcherPromises.set(workspacePath, promise);

        try {
            return await promise;
        } finally {
            this.watcherPromises.delete(workspacePath);
        }
    }

    /**
     * Liefert das Profil, das aktuell fuer eine URI zustaendig ist. Oeffent-
     * lich fuer Konsumenten ausserhalb des CommandHandlers (z.B. Tests).
     */
    public getProfileForUri(uri: vscode.Uri): FtpSyncProfile | undefined {
        return this.configManager.getProfileForUri(uri);
    }
}