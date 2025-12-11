import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { FtpSyncConfig, mergeWithDefaults } from '../types';
import { Logger, normalizePath } from '../utils';

const CONFIG_FILENAME = '.ftpsync.json';
const CONFIG_DIR = '.vscode';

/**
 * Manages FTP Sync configuration files
 */
export class ConfigManager {
    private configs: Map<string, FtpSyncConfig> = new Map();
    private configWatchers: vscode.FileSystemWatcher[] = [];
    private watcherDisposables: vscode.Disposable[] = [];

    constructor() {}

    /**
     * Initialize config manager and load all configurations
     */
    public async initialize(): Promise<void> {
        await this.loadAllConfigs();
        this.setupConfigWatchers();
    }

    /**
     * Dispose all watchers
     */
    public dispose(): void {
        this.watcherDisposables.forEach(d => d.dispose());
        this.watcherDisposables = [];
        this.configWatchers.forEach(w => w.dispose());
        this.configWatchers = [];
    }

    /**
     * Get the config file path for a workspace folder
     */
    private getConfigPath(folderPath: string): string {
        return path.join(folderPath, CONFIG_DIR, CONFIG_FILENAME);
    }

    /**
     * Load all config files from workspace folders
     */
    private async loadAllConfigs(): Promise<void> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        for (const folder of workspaceFolders) {
            await this.loadConfigForFolder(folder.uri.fsPath);
        }
    }

    /**
     * Load config for a specific workspace folder
     */
    public async loadConfigForFolder(folderPath: string): Promise<FtpSyncConfig | null> {
        const configPath = this.getConfigPath(folderPath);
        
        try {
            if (!fs.existsSync(configPath)) {
                Logger.debug(`No config file found at ${configPath}`);
                return null;
            }

            const content = fs.readFileSync(configPath, 'utf-8');
            // Parse JSONC (JSON with Comments) by stripping comments
            const jsonContent = this.stripJsonComments(content);
            const rawConfig = JSON.parse(jsonContent);
            const config = mergeWithDefaults(rawConfig);
            
            // Resolve local path relative to workspace folder
            if (config.localPath && !path.isAbsolute(config.localPath)) {
                config.localPath = path.join(folderPath, config.localPath);
            } else if (!config.localPath) {
                config.localPath = folderPath;
            }

            this.configs.set(folderPath, config);
            Logger.info(`Loaded configuration from ${configPath}`);
            
            return config;
        } catch (error) {
            Logger.error(`Failed to load config from ${configPath}: ${(error as Error).message}`);
            vscode.window.showErrorMessage(`FTP Sync: Failed to load configuration - ${(error as Error).message}`);
            return null;
        }
    }

    /**
     * Strip comments from JSONC content
     * Supports single-line (//) and multi-line comments
     */
    private stripJsonComments(content: string): string {
        let result = '';
        let inString = false;
        let inSingleLineComment = false;
        let inMultiLineComment = false;
        let escapeNext = false;

        for (let i = 0; i < content.length; i++) {
            const char = content[i];
            const nextChar = content[i + 1];

            if (escapeNext) {
                result += char;
                escapeNext = false;
                continue;
            }

            if (char === '\\' && inString) {
                result += char;
                escapeNext = true;
                continue;
            }

            if (char === '"' && !inSingleLineComment && !inMultiLineComment) {
                inString = !inString;
                result += char;
                continue;
            }

            if (inString) {
                result += char;
                continue;
            }

            if (inSingleLineComment) {
                if (char === '\n') {
                    inSingleLineComment = false;
                    result += char;
                }
                continue;
            }

            if (inMultiLineComment) {
                if (char === '*' && nextChar === '/') {
                    inMultiLineComment = false;
                    i++; // Skip the '/'
                }
                continue;
            }

            if (char === '/' && nextChar === '/') {
                inSingleLineComment = true;
                i++; // Skip the second '/'
                continue;
            }

            if (char === '/' && nextChar === '*') {
                inMultiLineComment = true;
                i++; // Skip the '*'
                continue;
            }

            result += char;
        }

        return result;
    }

    /**
     * Setup file watchers for config files
     */
    private setupConfigWatchers(): void {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return;
        }

        for (const folder of workspaceFolders) {
            const pattern = new vscode.RelativePattern(folder, `${CONFIG_DIR}/${CONFIG_FILENAME}`);
            const watcher = vscode.workspace.createFileSystemWatcher(pattern);

            this.watcherDisposables.push(
                watcher.onDidChange(async (uri) => {
                    Logger.info(`Config file changed: ${uri.fsPath}`);
                    await this.loadConfigForFolder(folder.uri.fsPath);
                    vscode.window.showInformationMessage('FTP Sync: Configuration reloaded');
                })
            );

            this.watcherDisposables.push(
                watcher.onDidCreate(async (uri) => {
                    Logger.info(`Config file created: ${uri.fsPath}`);
                    await this.loadConfigForFolder(folder.uri.fsPath);
                    vscode.commands.executeCommand('setContext', 'ftpSync.hasConfig', this.hasConfigs());
                    vscode.window.showInformationMessage('FTP Sync: Configuration loaded');
                })
            );

            this.watcherDisposables.push(
                watcher.onDidDelete((uri) => {
                    Logger.info(`Config file deleted: ${uri.fsPath}`);
                    this.configs.delete(folder.uri.fsPath);
                    vscode.commands.executeCommand('setContext', 'ftpSync.hasConfig', this.hasConfigs());
                })
            );

            this.configWatchers.push(watcher);
        }
    }

    /**
     * Get config for a specific workspace folder
     */
    public getConfig(folderPath: string): FtpSyncConfig | undefined {
        return this.configs.get(folderPath);
    }

    /**
     * Get config for a file URI
     */
    public getConfigForUri(uri: vscode.Uri): FtpSyncConfig | undefined {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            return undefined;
        }
        return this.configs.get(workspaceFolder.uri.fsPath);
    }

    /**
     * Get all loaded configurations
     */
    public getAllConfigs(): Map<string, FtpSyncConfig> {
        return this.configs;
    }

    /**
     * Check if any config is loaded
     */
    public hasConfigs(): boolean {
        return this.configs.size > 0;
    }

    /**
     * Create a new config file in .vscode folder
     */
    public async createConfig(folderPath: string): Promise<void> {
        const vscodeDir = path.join(folderPath, CONFIG_DIR);
        const configPath = this.getConfigPath(folderPath);
        
        // Create .vscode directory if it doesn't exist
        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }
        
        if (fs.existsSync(configPath)) {
            const overwrite = await vscode.window.showWarningMessage(
                'Configuration file already exists. Overwrite?',
                'Yes', 'No'
            );
            if (overwrite !== 'Yes') {
                // Just open the existing file
                const doc = await vscode.workspace.openTextDocument(configPath);
                await vscode.window.showTextDocument(doc);
                return;
            }
        }

        const defaultConfig = `{
    // ╔══════════════════════════════════════════════════════════════════════════╗
    // ║                    FTP/SFTP Sync Watcher Konfiguration                   ║
    // ╠══════════════════════════════════════════════════════════════════════════╣
    // ║  Diese Datei konfiguriert die automatische Synchronisation mit einem    ║
    // ║  FTP- oder SFTP-Server. Passe die Werte an deine Server-Einstellungen   ║
    // ║  an. Für IntelliSense und Validierung wird das JSON-Schema verwendet.   ║
    // ╚══════════════════════════════════════════════════════════════════════════╝

    // ─────────────────────────────────────────────────────────────────────────────
    // VERBINDUNGSEINSTELLUNGEN
    // ─────────────────────────────────────────────────────────────────────────────

    // Anzeigename für diese Verbindung (frei wählbar)
    "name": "My Server",

    // Protokoll: "ftp" oder "sftp" (SFTP ist sicherer und empfohlen)
    "protocol": "sftp",

    // Hostname oder IP-Adresse des Servers
    "host": "example.com",

    // Port-Nummer (Standard: 21 für FTP, 22 für SFTP)
    "port": 22,

    // ─────────────────────────────────────────────────────────────────────────────
    // AUTHENTIFIZIERUNG
    // ─────────────────────────────────────────────────────────────────────────────

    // Benutzername für die Anmeldung
    "username": "username",

    // Passwort für die Anmeldung
    // HINWEIS: Für SFTP ist ein SSH-Key (privateKeyPath) sicherer!
    "password": "",

    // Pfad zur privaten SSH-Schlüsseldatei (nur für SFTP)
    // Beispiel: "C:/Users/Name/.ssh/id_rsa" oder "~/.ssh/id_rsa"
    "privateKeyPath": "",

    // ─────────────────────────────────────────────────────────────────────────────
    // PFAD-EINSTELLUNGEN
    // ─────────────────────────────────────────────────────────────────────────────

    // Remote-Pfad auf dem Server (absoluter Pfad zum Zielverzeichnis)
    "remotePath": "/var/www/html",

    // Lokaler Pfad relativ zum Workspace
    // "."  = Aktueller Ordner (wo .vscode liegt)
    // ".." = Übergeordneter Ordner (Workspace-Root)
    "localPath": "..",

    // ─────────────────────────────────────────────────────────────────────────────
    // AUTOMATISCHE SYNCHRONISATION
    // ─────────────────────────────────────────────────────────────────────────────

    // Dateien automatisch beim Speichern hochladen?
    "uploadOnSave": true,

    // File Watcher Konfiguration (überwacht Dateiänderungen)
    "watcher": {
        // File Watcher aktivieren?
        "enabled": true,

        // Welche Dateien überwachen? (Glob-Pattern)
        // "**/*" = Alle Dateien in allen Unterordnern
        // "**/*.php" = Nur PHP-Dateien
        // "src/**/*" = Nur Dateien im src-Ordner
        "files": "**/*",

        // Geänderte Dateien automatisch hochladen?
        "autoUpload": true,

        // Gelöschte Dateien auch auf dem Server löschen?
        // VORSICHT: Kann zu Datenverlust führen!
        "autoDelete": false
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // AUSSCHLUSS-REGELN
    // ─────────────────────────────────────────────────────────────────────────────

    // Dateien/Ordner die NICHT synchronisiert werden sollen (Glob-Patterns)
    "ignore": [
        ".git",           // Git Repository
        ".vscode",        // VS Code Einstellungen
        "node_modules",   // NPM Pakete
        ".DS_Store",      // macOS Systemdateien
        "*.log"           // Log-Dateien
    ],

    // .gitignore Regeln zusätzlich anwenden?
    "useGitIgnore": true,

    // ─────────────────────────────────────────────────────────────────────────────
    // ERWEITERTE EINSTELLUNGEN
    // ─────────────────────────────────────────────────────────────────────────────

    // Verbindungs-Timeout in Millisekunden (Standard: 30000 = 30 Sekunden)
    // "timeout": 30000,

    // FTP über TLS (FTPS) verwenden? (nur für protocol: "ftp")
    // "secure": false,

    // Debug-Modus für ausführliche Logs aktivieren?
    "debug": false
}`;

        fs.writeFileSync(configPath, defaultConfig, 'utf-8');
        
        // Load the new config
        await this.loadConfigForFolder(folderPath);
        
        // Update context for views welcome
        vscode.commands.executeCommand('setContext', 'ftpSync.hasConfig', true);
        
        // Open the config file for editing
        const doc = await vscode.workspace.openTextDocument(configPath);
        await vscode.window.showTextDocument(doc);
        
        Logger.info(`Created config file at ${configPath}`);
        vscode.window.showInformationMessage('FTP Sync: Configuration file created. Please edit with your server details.');
    }

    /**
     * Get the workspace folder path for a given URI
     */
    public getWorkspaceFolderPath(uri: vscode.Uri): string | undefined {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        return workspaceFolder?.uri.fsPath;
    }
}
