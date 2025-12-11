import * as vscode from 'vscode';
import { ConfigManager } from './core';
import { CommandHandler } from './commands';
import { StatusBar, FtpExplorerProvider, FtpTreeItem } from './ui';
import { Logger, showErrorMessage } from './utils';

let configManager: ConfigManager;
let commandHandler: CommandHandler;
let statusBar: StatusBar;
let ftpExplorer: FtpExplorerProvider;

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

        // Initialize config manager
        configManager = new ConfigManager();
        await configManager.initialize();
        context.subscriptions.push({ dispose: () => configManager.dispose() });

        // Set context for views welcome
        vscode.commands.executeCommand('setContext', 'ftpSync.hasConfig', configManager.hasConfigs());

        // Set initial status bar state based on config existence
        if (configManager.hasConfigs()) {
            statusBar.setState('idle');
        } else {
            statusBar.setState('unconfigured');
        }

        // Initialize command handler
        commandHandler = new CommandHandler(configManager, statusBar);
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
            vscode.commands.registerCommand('ftpSync.deleteRemoteFile', (item: FtpTreeItem) => ftpExplorer.deleteItem(item))
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

        // Set debug mode from config
        const configs = configManager.getAllConfigs();
        for (const config of configs.values()) {
            if (config.debug) {
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
