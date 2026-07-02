import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import {
    FtpSyncProfile,
    FtpSyncConfigFile,
    migrateLegacyConfig,
    mergeProfileWithDefaults
} from '../types';
import { Logger, showInfoMessage, showSuccessMessage, showErrorMessage, resolveProfileByLongestPrefix } from '../utils';

const CONFIG_FILENAME = '.ftpsync.json';
const CONFIG_DIR = '.vscode';

/**
 * Verwaltet die .ftpsync.json-Dateien aller Workspace-Folder. Seit v2.0.0
 * enthaelt jede Konfiguration eine Liste von Profilen statt eines einzelnen
 * Konfigurationsobjekts. Aeltere Flach-Objekte werden beim Laden still
 * migriert (siehe migrateLegacyConfig in types/config.ts).
 *
 * Pro Workspace werden die Profile in einer Map gehalten. Profile sind
 * eindeutig identifizierbar durch ihren Namen. Die Profile-Identitaet ueber
 * Workspaces hinweg ist "absoluter Pfad der Config-Datei + Profil-Name".
 */
export class ConfigManager {
    private profiles: Map<string, Map<string, FtpSyncProfile>> = new Map();
    private configWatchers: vscode.FileSystemWatcher[] = [];
    private watcherDisposables: vscode.Disposable[] = [];

    constructor() {}

    /**
     * Initialisiert den ConfigManager und laedt alle Konfigurationen.
     * Idempotent: ein zweiter Aufruf gibt bestehende Watcher frei und baut
     * sie neu auf, sodass kein Listener-Leak entsteht.
     */
    public async initialize(): Promise<void> {
        this.disposeWatchers();
        await this.loadAllConfigs();
        this.setupConfigWatchers();
    }

    /**
     * Gibt nur die File-Watcher-Disposables frei, ohne die Profil-Maps zu
     * beruehren. Wird von initialize() und dispose() gemeinsam genutzt.
     */
    private disposeWatchers(): void {
        this.watcherDisposables.forEach(d => d.dispose());
        this.watcherDisposables = [];
        this.configWatchers.forEach(w => w.dispose());
        this.configWatchers = [];
    }

    /**
     * Gibt alle File-Watcher und Event-Listener frei.
     */
    public dispose(): void {
        this.disposeWatchers();
    }

    /**
     * Pfad zur Konfigurationsdatei fuer einen Workspace-Folder.
     */
    private getConfigPath(folderPath: string): string {
        return path.join(folderPath, CONFIG_DIR, CONFIG_FILENAME);
    }

    /**
     * Loest einen optionalen Pfad (z.B. TLS-Zertifikate) gegen den Workspace-
     * Folder auf.
     */
    private resolveOptionalPath(folderPath: string, filePath?: string): string | undefined {
        if (!filePath) {
            return undefined;
        }

        if (path.isAbsolute(filePath)) {
            return filePath;
        }

        return path.join(folderPath, filePath);
    }

    /**
     * Laedt alle Konfigurationen aus allen Workspace-Foldern.
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
     * Laedt die Profile fuer einen bestimmten Workspace-Folder. Liefert die
     * Profil-Map (Key = Profil-Name) oder null, falls keine Konfiguration
     * existiert.
     *
     * Die Migration aus dem Legacy-Format (flaches Objekt) geschieht
     * automatisch und lautlos. Ein einzelnes migriertes Profil traegt den
     * Namen LEGACY_MIGRATION_PROFILE_NAME.
     */
    public async loadConfigForFolder(folderPath: string): Promise<Map<string, FtpSyncProfile> | null> {
        const configPath = this.getConfigPath(folderPath);

        try {
            if (!fs.existsSync(configPath)) {
                Logger.debug(`No config file found at ${configPath}`);
                this.profiles.delete(folderPath);
                return null;
            }

            const content = fs.readFileSync(configPath, 'utf-8');
            // JSONC: Kommentare muessen entfernt werden, bevor JSON.parse laeuft.
            const jsonContent = this.stripJsonComments(content);
            const rawObject = JSON.parse(jsonContent);

            // Stille Migration: Legacy-Shape (flaches Objekt ohne 'profiles')
            // wird hier in den neuen Container umgepackt.
            const configFile = migrateLegacyConfig(rawObject) as FtpSyncConfigFile;

            if (!configFile.profiles || configFile.profiles.length === 0) {
                Logger.warn(`No profiles found in ${configPath}`);
                this.profiles.delete(folderPath);
                return null;
            }

            const profileMap = new Map<string, FtpSyncProfile>();
            for (const rawProfile of configFile.profiles) {
                const profile = this.prepareProfile(folderPath, rawProfile);
                profileMap.set(profile.name, profile);
            }

            this.profiles.set(folderPath, profileMap);
            Logger.info(`Loaded ${profileMap.size} profile(s) from ${configPath}`);

            return profileMap;
        } catch (error) {
            Logger.error(`Failed to load config from ${configPath}: ${(error as Error).message}`);
            showErrorMessage(`FTP Sync: Failed to load configuration - ${(error as Error).message}`);
            return null;
        }
    }

    /**
     * Wendet Defaults an, loest relative Pfade auf und prueft TLS-Pfade.
     * Liefert eine NEUE Profil-Instanz; der uebergebene rawProfile bleibt
     * unveraendert (Immutability-Garantie fuer Aufrufer und Tests).
     */
    private prepareProfile(folderPath: string, rawProfile: Partial<FtpSyncProfile>): FtpSyncProfile {
        const merged = mergeProfileWithDefaults(rawProfile);

        // Lokaler Pfad wird gegen den Workspace-Folder aufgeloest.
        let resolvedLocalPath: string;
        if (merged.localPath && !path.isAbsolute(merged.localPath)) {
            resolvedLocalPath = path.join(folderPath, merged.localPath);
        } else if (!merged.localPath) {
            resolvedLocalPath = folderPath;
        } else {
            resolvedLocalPath = merged.localPath;
        }

        // TLS-Dateien ebenfalls relativ aufloesen und Existenz pruefen.
        let resolvedSecureOptions = merged.secureOptions;
        if (merged.secureOptions) {
            resolvedSecureOptions = {
                ...merged.secureOptions,
                caPath: this.resolveOptionalPath(folderPath, merged.secureOptions.caPath),
                certPath: this.resolveOptionalPath(folderPath, merged.secureOptions.certPath),
                keyPath: this.resolveOptionalPath(folderPath, merged.secureOptions.keyPath)
            };

            for (const tlsFilePath of [
                resolvedSecureOptions.caPath,
                resolvedSecureOptions.certPath,
                resolvedSecureOptions.keyPath
            ]) {
                if (tlsFilePath && !fs.existsSync(tlsFilePath)) {
                    Logger.warn(`Configured TLS file not found: ${tlsFilePath}`);
                }
            }
        }

        return {
            ...merged,
            localPath: resolvedLocalPath,
            secureOptions: resolvedSecureOptions
        };
    }

    /**
     * Entfernt Kommentare aus JSONC-Inhalt (single-line und multi-line).
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
                    i++; // '/' ueberspringen
                }
                continue;
            }

            if (char === '/' && nextChar === '/') {
                inSingleLineComment = true;
                i++; // zweites '/' ueberspringen
                continue;
            }

            if (char === '/' && nextChar === '*') {
                inMultiLineComment = true;
                i++; // '*' ueberspringen
                continue;
            }

            result += char;
        }

        return result;
    }

    /**
     * Setzt File-Watcher auf alle Konfigurationsdateien. Bei jeder Aenderung
     * wird die gesamte Profil-Map neu geladen — die Datei koennte strukturell
     * (Profile hinzufuegen/entfernen) geaendert worden sein.
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
                    showInfoMessage('FTP Sync: Configuration reloaded');
                })
            );

            this.watcherDisposables.push(
                watcher.onDidCreate(async (uri) => {
                    Logger.info(`Config file created: ${uri.fsPath}`);
                    await this.loadConfigForFolder(folder.uri.fsPath);
                    vscode.commands.executeCommand('setContext', 'ftpSync.hasConfig', this.hasProfiles());
                    showInfoMessage('FTP Sync: Configuration loaded');
                })
            );

            this.watcherDisposables.push(
                watcher.onDidDelete((uri) => {
                    Logger.info(`Config file deleted: ${uri.fsPath}`);
                    this.profiles.delete(folder.uri.fsPath);
                    vscode.commands.executeCommand('setContext', 'ftpSync.hasConfig', this.hasProfiles());
                })
            );

            this.configWatchers.push(watcher);
        }
    }

    /**
     * Liefert die Profil-Map eines Workspace-Folders.
     */
    public getProfilesForFolder(folderPath: string): Map<string, FtpSyncProfile> | undefined {
        return this.profiles.get(folderPath);
    }

    /**
     * Liefert das Profil, das fuer eine gegebene Datei-URI zustaendig ist.
     * Die Zuordnung erfolgt ueber die localPath der Profile: das Profil, dessen
     * localPath den URI-Pfad enthaelt, gewinnt. Bei Mehrdeutigkeit gewinnt
     * das Profil mit dem laengsten localPath (spezifischste Zuordnung).
     *
     * Liefert `undefined`, falls die URI ausserhalb aller localPath-Bereiche
     * liegt. Aufrufer MUESSEN diesen Fall explizit behandeln (z.B. Upload
     * ueberspringen), anstatt auf ein "erstes Profil" als Fallback
     * zurueckzufallen — das wuerde Uploads auf den falschen Server
     * ausloesen.
     */
    public getProfileForUri(uri: vscode.Uri): FtpSyncProfile | undefined {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            return undefined;
        }

        const profileMap = this.profiles.get(workspaceFolder.uri.fsPath);
        if (!profileMap || profileMap.size === 0) {
            return undefined;
        }

        const profiles = Array.from(profileMap.values());
        const match = resolveProfileByLongestPrefix(uri.fsPath, profiles);
        if (!match) {
            return undefined;
        }
        return profiles.find(p => p.localPath === match.localPath);
    }

    /**
     * Liefert alle Profile aller Workspace-Folder. Key ist "workspacePfad|name",
     * damit profile-IDs ueber Workspaces hinweg eindeutig bleiben.
     */
    public getAllProfiles(): Map<string, FtpSyncProfile> {
        const result = new Map<string, FtpSyncProfile>();
        for (const [folderPath, profileMap] of this.profiles.entries()) {
            for (const [profileName, profile] of profileMap.entries()) {
                result.set(`${folderPath}|${profileName}`, profile);
            }
        }
        return result;
    }

    /**
     * Liefert die Profile eines Workspace-Folders, eingefroren als Map.
     */
    public getProfiles(workspacePath: string): Map<string, FtpSyncProfile> {
        return this.profiles.get(workspacePath) ?? new Map();
    }

    /**
     * Liefert true, sobald mindestens ein Profil in irgendeinem Workspace
     * geladen ist.
     */
    public hasProfiles(): boolean {
        for (const profileMap of this.profiles.values()) {
            if (profileMap.size > 0) {
                return true;
            }
        }
        return false;
    }

    /**
     * Liefert die Anzahl der Profile ueber alle Workspaces hinweg.
     */
    public getProfileCount(): number {
        let total = 0;
        for (const profileMap of this.profiles.values()) {
            total += profileMap.size;
        }
        return total;
    }

    /**
     * Liefert die Anzahl der Profile in einem bestimmten Workspace.
     */
    public getProfileCountForFolder(folderPath: string): number {
        return this.profiles.get(folderPath)?.size ?? 0;
    }

    /**
     * Erstellt eine neue Konfigurationsdatei im .vscode-Ordner des Workspace-
     * Folders. Ab v2.0.0 wird die neue Container-Form ({ profiles: [...] })
     * mit einem Beispiel-Profil erzeugt, plus deutsche Inline-Kommentare.
     */
    public async createConfig(folderPath: string): Promise<void> {
        const vscodeDir = path.join(folderPath, CONFIG_DIR);
        const configPath = this.getConfigPath(folderPath);

        if (!fs.existsSync(vscodeDir)) {
            fs.mkdirSync(vscodeDir, { recursive: true });
        }

        if (fs.existsSync(configPath)) {
            const overwrite = await vscode.window.showWarningMessage(
                'Configuration file already exists. Overwrite?',
                'Yes', 'No'
            );
            if (overwrite !== 'Yes') {
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
    // ║  oder mehreren FTP-/SFTP-Servern. Jedes Element im 'profiles'-Array     ║
    // ║  beschreibt ein eigenstaendiges Sync-Ziel.                               ║
    // ║                                                                          ║
    // ║  IntelliSense & Validierung liefert das JSON-Schema (siehe              ║
    // ║  schemas/ftpsync.schema.json).                                           ║
    // ╚══════════════════════════════════════════════════════════════════════════╝

    "profiles": [

        {
            // ─────────────────────────────────────────────────────────────────
            // PROFIL-NAME (Pflichtfeld ab v2.0.0)
            // ─────────────────────────────────────────────────────────────────
            // Frei waehlbarer Anzeigename. Wird in Statusbar, Output-Channel
            // und Explorer-Header verwendet, um mehrere Profile
            // unterscheidbar zu machen.
            "name": "My Server",

            // Sync-Richtung. Heute produktiv: "localToRemote".
            // "remoteToLocal" und "bidirectional" werden ohne Fehler geladen,
            // fuehren aber noch keine Transfers aus (Forward-Kompatibilitaet).
            "direction": "localToRemote",

            // ─────────────────────────────────────────────────────────────────
            // VERBINDUNGSEINSTELLUNGEN
            // ─────────────────────────────────────────────────────────────────

            // Protokoll: "ftp" oder "sftp" (SFTP ist sicherer und empfohlen)
            "protocol": "sftp",

            // Hostname oder IP-Adresse des Servers
            "host": "example.com",

            // Port-Nummer (Standard: 21 fuer FTP, 22 fuer SFTP)
            "port": 22,

            // ─────────────────────────────────────────────────────────────────
            // AUTHENTIFIZIERUNG
            // ─────────────────────────────────────────────────────────────────

            // Benutzername fuer die Anmeldung
            "username": "username",

            // OPTION 1: Passwort-Authentifizierung (einfach, weniger sicher)
            "password": "",

            // OPTION 2: SSH-Key-Authentifizierung (sicherer, empfohlen fuer SFTP)
            //   ssh-keygen -t rsa -b 4096 -C "deine@email.de"
            //   ssh-copy-id -i ~/.ssh/id_rsa.pub user@server.de
            "privateKeyPath": "",
            "passphrase": "",

            // ─────────────────────────────────────────────────────────────────
            // PFAD-EINSTELLUNGEN
            // ─────────────────────────────────────────────────────────────────

            // Remote-Pfad auf dem Server (absoluter Pfad zum Zielverzeichnis)
            "remotePath": "/var/www/html",

            // Lokaler Pfad relativ zum Workspace
            // "."  = Aktueller Ordner (wo .vscode liegt)
            "localPath": ".",

            // ─────────────────────────────────────────────────────────────────
            // AUTOMATISCHE SYNCHRONISATION
            // ─────────────────────────────────────────────────────────────────

            // Dateien automatisch beim Speichern hochladen?
            "uploadOnSave": true,

            // File Watcher Konfiguration (ueberwacht Datei-Aenderungen)
            "watcher": {
                "enabled": true,
                "files": "**/*",
                "autoUpload": true,
                "autoDelete": false
            },

            // ─────────────────────────────────────────────────────────────────
            // AUSSCHLUSS-REGELN
            // ─────────────────────────────────────────────────────────────────

            "ignore": [
                ".git",
                ".vscode",
                "node_modules",
                ".DS_Store",
                "*.log"
            ],

            "useGitIgnore": true,

            // ─────────────────────────────────────────────────────────────────
            // ERWEITERTE EINSTELLUNGEN
            // ─────────────────────────────────────────────────────────────────

            // Verbindungs-Timeout in Millisekunden (Standard: 30000)
            // "timeout": 30000,

            // FTP ueber TLS (FTPS) verwenden? (nur fuer protocol: "ftp")
            "secure": false,

            // TLS-Optionen fuer FTPS (nur fuer protocol: "ftp" relevant)
            // "secureOptions": {
            //     "rejectUnauthorized": true,
            //     "caPath": ".certs/ca.pem",
            //     "certPath": ".certs/client-cert.pem",
            //     "keyPath": ".certs/client-key.pem"
            // },

            // Debug-Modus fuer ausfuehrliche Logs aktivieren?
            "debug": false
        }

        // Weitere Profile koennen hier als weitere Array-Eintraege ergaenzt
        // werden, z.B. ein zweites Profil fuer einen Staging-Server oder eine
        // zweite Richtung (bidirektionaler Sync, vgl. ADR-0003).
    ]
}`;

        fs.writeFileSync(configPath, defaultConfig, 'utf-8');

        await this.loadConfigForFolder(folderPath);

        vscode.commands.executeCommand('setContext', 'ftpSync.hasConfig', true);

        const doc = await vscode.workspace.openTextDocument(configPath);
        await vscode.window.showTextDocument(doc);

        Logger.info(`Created config file at ${configPath}`);
        showSuccessMessage('FTP Sync: Configuration file created. Please edit with your server details.', 5000);
    }

    /**
     * Liefert den Workspace-Folder-Pfad fuer eine URI.
     */
    public getWorkspaceFolderPath(uri: vscode.Uri): string | undefined {
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        return workspaceFolder?.uri.fsPath;
    }
}