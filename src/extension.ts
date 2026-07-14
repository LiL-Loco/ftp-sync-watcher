import * as vscode from 'vscode';
import { ConfigManager, SecretManager, TombstoneStore } from './core';
import { CommandHandler } from './commands';
import { StatusBar, FtpExplorerProvider, FtpTreeItem } from './ui';
import { Logger, showErrorMessage } from './utils';

let configManager: ConfigManager;
let commandHandler: CommandHandler;
let statusBar: StatusBar;
let ftpExplorer: FtpExplorerProvider;
let secretManager: SecretManager;

/**
 * Extension activation
 */
export async function activate(context: vscode.ExtensionContext): Promise<void> {
    // Initialize logger
    Logger.init(context);
    Logger.info('FTP Sync Watcher extension activating...');

    try {
        // Initialize status bar first
        statusBar = new StatusBar();
        context.subscriptions.push({ dispose: () => statusBar.dispose() });
        
        // Always show status bar
        statusBar.show();

        // Initialize config manager with secret storage
        secretManager = SecretManager.fromContext(context);
        configManager = new ConfigManager(secretManager);
        await configManager.initialize();
        context.subscriptions.push({ dispose: () => configManager.dispose() });

        // Set context for views welcome
        vscode.commands.executeCommand('setContext', 'ftpSync.hasConfig', configManager.hasProfiles());

        // Set initial status bar state based on config existence
        if (configManager.hasProfiles()) {
            statusBar.setState('idle');
        } else {
            statusBar.setState('unconfigured');
        }

        // Initialize command handler
        commandHandler = new CommandHandler(configManager, statusBar, {
            tombstoneStoreFactory: (workspacePath, profileName) =>
                new TombstoneStore(context.globalState, workspacePath, profileName)
        });
        commandHandler.registerCommands(context);
        context.subscriptions.push({ dispose: () => commandHandler.dispose() });

        // Initialize FTP Explorer
        ftpExplorer = new FtpExplorerProvider(configManager);
        const treeView = vscode.window.createTreeView('ftpExplorerView', {
            treeDataProvider: ftpExplorer,
            showCollapseAll: true
        });
        context.subscriptions.push(treeView);
        context.subscriptions.push({ dispose: () => ftpExplorer.dispose() });

        // Register FTP Explorer commands
        context.subscriptions.push(
            vscode.commands.registerCommand('ftpSync.connect', () => ftpExplorer.connect()),
            vscode.commands.registerCommand('ftpSync.disconnect', () => ftpExplorer.disconnect()),
            vscode.commands.registerCommand('ftpSync.refreshExplorer', () => ftpExplorer.refresh()),
            vscode.commands.registerCommand('ftpSync.navigateUp', () => ftpExplorer.navigateUp()),
            vscode.commands.registerCommand('ftpSync.downloadRemoteFile', (item: FtpTreeItem) => ftpExplorer.downloadItem(item)),
            vscode.commands.registerCommand('ftpSync.deleteRemoteFile', (item: FtpTreeItem) => ftpExplorer.deleteItem(item)),
            vscode.commands.registerCommand('ftpSync.clearCredentials', () => clearStoredCredentials())
        );

        // Setup upload on save handler
        const saveListener = vscode.workspace.onDidSaveTextDocument(async (document) => {
            // Skip non-file schemes
            if (document.uri.scheme !== 'file') {
                return;
            }
            
            // Skip the config file itself
            if (document.fileName.endsWith('.ftpsync.json')) {
                return;
            }

            await commandHandler.handleDocumentSave(document);
        });
        context.subscriptions.push(saveListener);

        // Setup configuration change handler
        const configChangeListener = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration('ftpSync.showStatusBarItem')) {
                const show = vscode.workspace.getConfiguration('ftpSync').get<boolean>('showStatusBarItem', true);
                if (show) {
                    statusBar.show();
                } else {
                    statusBar.hide();
                }
            }
        });
        context.subscriptions.push(configChangeListener);

        // Auto-start watcher if configured
        await commandHandler.autoStart();

        // Auto-start FileSystemWatcher fuer Profile mit aktivem Auto-Upload.
        // Dies ist zwingend noetig, damit KI-Agent-Writes (Cursor, Cline,
        // Continue, git apply) Uploads ausloesen — `onDidSaveTextDocument`
        // sieht externe Schreibvorgaenge nicht.
        // Bewusst in try/catch gewrapped: ein Fehler hier darf NIE die
        // bereits registrierten Commands blockieren.
        try {
            await commandHandler.autoStartUploadOnSaveWatchers();
        } catch (error) {
            Logger.warn(
                `Auto-start of upload-on-save watchers failed: ${(error as Error).message}`
            );
        }

        // Set debug mode from first profile with debug=true
        const profiles = configManager.getAllProfiles();
        for (const profile of profiles.values()) {
            if (profile.debug) {
                Logger.setDebugMode(true);
                break;
            }
        }

        Logger.success('FTP Sync Watcher extension activated');
    } catch (error) {
        Logger.error(`Failed to activate extension: ${(error as Error).message}`, error as Error);
        showErrorMessage(`FTP Sync: Failed to activate - ${(error as Error).message}`);
    }
}

/**
 * Extension deactivation
 */
export async function deactivate(): Promise<void> {
    Logger.info('FTP Sync Watcher extension deactivating...');

    if (commandHandler) {
        await commandHandler.dispose();
    }

    Logger.info('FTP Sync Watcher extension deactivated');
}

/**
 * Interaktives Loeschen gespeicherter Credentials. Erkennt die Profile des
 * aktuellen Workspaces und bietet sie als QuickPick an. Pro Profil werden
 * Passwort + Passphrase geloescht.
 */
async function clearStoredCredentials(): Promise<void> {
    if (!configManager || !secretManager) {
        return;
    }

    const allProfiles = configManager.getAllProfiles();
    if (allProfiles.size === 0) {
        void vscode.window.showInformationMessage('FTP Sync: Keine Profile gefunden.');
        return;
    }

    // QuickPick-Items und parallel die Composite-Keys merken, damit wir
    // beim Auswaehlen sauber zurueck auf den originalen Schluessel mappen.
    const entries: Array<{ key: string; folder: string; name: string; item: vscode.QuickPickItem }> = [];
    for (const [key, profile] of allProfiles.entries()) {
        const sepIdx = key.indexOf('|');
        if (sepIdx < 0) continue;
        const folder = key.slice(0, sepIdx);
        const name = key.slice(sepIdx + 1);
        entries.push({
            key,
            folder,
            name,
            item: {
                label: `$(key) ${profile.name || name}`,
                description: `Workspace: ${folder}`,
                detail: `Loescht Passwort + Passphrase fuer Profil "${name}"`
            }
        });
    }

    const picked = await vscode.window.showQuickPick(
        entries.map(e => e.item),
        {
            placeHolder: 'Welches Profil soll seine gespeicherten Credentials verlieren?'
        }
    );

    if (!picked) {
        return;
    }

    const selected = entries.find(e => e.item === picked);
    if (!selected) {
        return;
    }

    const confirm = await vscode.window.showWarningMessage(
        `Gespeicherte Credentials fuer Profil "${selected.name}" wirklich loeschen?`,
        { modal: true },
        'Loeschen'
    );

    if (confirm !== 'Loeschen') {
        return;
    }

    await secretManager.clearProfileSecrets(selected.folder, selected.name);
    // Profile-Map neu laden, damit das secret-derived Passwort aus dem
    // In-Memory-Cache faellt.
    await configManager.loadConfigForFolder(selected.folder);

    void vscode.window.showInformationMessage(
        `FTP Sync: Credentials fuer Profil "${selected.name}" geloescht.`
    );
}
