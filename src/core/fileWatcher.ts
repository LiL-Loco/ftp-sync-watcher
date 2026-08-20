import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { FtpSyncProfile, DEFAULT_POLL_INTERVAL_MS, TOMBSTONE_TTL_MS } from '../types';
import { Logger, getRelativePath, localToRemotePath, remoteToLocalPath, resolveProfileByLongestPrefix } from '../utils';
import { IgnoreHandler } from './ignoreHandler';
import { ConnectionPool } from './connectionPool';
import { OperationQueue } from './operationQueue';
import { TombstoneStore } from './tombstoneStore';

export type FileChangeType = 'created' | 'changed' | 'deleted';

export interface FileChangeEvent {
    type: FileChangeType;
    uri: vscode.Uri;
    relativePath: string;
    profileName: string;
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
 * FileWatcher pro Workspace-Folder (Klassenname historisch, bleibt
 * unveraendert fuer Kompatibilitaet mit User-facing Commands und Settings).
 *
 * Seit v2.0.0 ist dieser Watcher fuer mehrere Profile in einem Workspace
 * zustaendig. Pro Profil haelt er:
 *   - einen eigenen ConnectionPool (eigener Mutex, eigenes Retry-Budget)
 *   - einen eigenen IgnoreHandler (jedes Profil hat eigene ignore-Liste)
 *
 * Die OperationQueue ist pro Watcher genau einmal und serialisiert
 * *Sequencing* (Prioritaet + Reihenfolge) ueber alle Profile hinweg.
 * Retry- und Slot-Management-Semantik delegiert sie an ConnectionPool und
 * globalConnectionManager (siehe ADR-0001).
 *
 * Pro ausgeloestem Trigger wird das zustaendige Profil per localPath-
 * Praefix-Match bestimmt; ein Transfer laeuft immer ueber den
 * ConnectionPool dieses Profils. Bidirektionaler Sync ist als ZWEI Profile
 * modelliert (siehe ADR-0003).
 *
 * Sync-Richtungen:
 *   - localToRemote (Default): klassischer File-Watcher-Pfad. Lokale
 *     Aenderungen werden hochgeladen. Loeschungen erzeugen einen
 *     Tombstone, damit ein nachfolgender remoteToLocal-Pull die Datei
 *     nicht zurueckbringt.
 *   - remoteToLocal: Polling-basiert (siehe ADR-0002). Der Watcher listet
 *     das Remote-Verzeichnis periodisch, vergleicht mit dem lokalen State
 *     und laedt neue/geaenderte Dateien herunter. Tombstones werden vor
 *     dem Download geprueft.
 *   - bidirectional: noch nicht implementiert (warnhafter Hinweis beim
 *     Start, dann Fallback auf den Watcher-Pfad des ersten aktiven
 *     Profils).
 */
export class FileWatcher {
    private workspacePath: string;
    private profiles: Map<string, FtpSyncProfile> = new Map();
    private connectionPools: Map<string, ConnectionPool> = new Map();
    private ignoreHandlers: Map<string, IgnoreHandler> = new Map();
    private tombstoneStores: Map<string, TombstoneStore> = new Map();
    private operationQueue: OperationQueue;
    private watcher: vscode.FileSystemWatcher | undefined;
    private watcherDisposables: vscode.Disposable[] = [];
    private pollingTimers: Map<string, NodeJS.Timeout> = new Map();
    private remoteStateCache: Map<string, Map<string, { size: number; modifiedTime: number }>> = new Map();
    private isRunning = false;
    /**
     * Promise-Cache fuer `start()`. Wenn zwei Aufrufer gleichzeitig (z.B.
     * `autoStartUploadOnSaveWatchers` + `getOrCreateWatcher` waehrend eines
     * fruehen Save-Events) `start()` aufrufen, teilen sie sich dasselbe
     * Promise. Ohne diesen Cache wuerden beide Calls in den Body laufen,
     * bevor `isRunning` gesetzt wird — mit Folge: zwei FileSystemWatcher,
     * doppelte Event-Handler und doppelte Polling-Loops pro Profil.
     */
    private startPromise: Promise<void> | undefined;
    private debounceTimers: Map<string, NodeJS.Timeout> = new Map();
    private pendingOperations: Set<string> = new Set();
    private activeUploads: Set<string> = new Set();
    private debounceMs = 500;
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
    private tombstoneStoreFactory?: (profileName: string) => TombstoneStore | undefined;

    constructor(
        workspacePath: string,
        profiles: Map<string, FtpSyncProfile>,
        options: { tombstoneStoreFactory?: (profileName: string) => TombstoneStore | undefined } = {}
    ) {
        this.workspacePath = workspacePath;
        this.profiles = profiles;
        this.operationQueue = new OperationQueue(30000);
        this.tombstoneStoreFactory = options.tombstoneStoreFactory;

        for (const [name, profile] of profiles.entries()) {
            this.connectionPools.set(name, new ConnectionPool(profile));
            this.ignoreHandlers.set(name, new IgnoreHandler(
                workspacePath,
                profile.ignore,
                profile.useGitIgnore
            ));
            const tsFactory = this.tombstoneStoreFactory;
            const store = tsFactory ? tsFactory(name) : undefined;
            if (store) {
                this.tombstoneStores.set(name, store);
            }
        }
    }

    /**
     * Startet den File-Watcher fuer alle aktiven Profile. Profile mit
     * watcher.enabled === false werden uebersprungen.
     *
     * Idempotent und race-safe: mehrfache parallele Aufrufer teilen sich
     * dasselbe `startPromise`. Damit ist es sicher, `start()` aus mehreren
     * Pfaden aufzurufen (z.B. `autoStartUploadOnSaveWatchers` plus ein
     * spontaner `getOrCreateWatcher` durch einen fruehen Save-Event), ohne
     * doppelte FileSystemWatcher-Registrierungen oder Polling-Loops zu
     * erzeugen.
     */
    public async start(): Promise<void> {
        if (this.isRunning) {
            Logger.warn('File watcher is already running');
            return;
        }

        if (this.startPromise) {
            return this.startPromise;
        }

        this.startPromise = this.doStart();
        try {
            await this.startPromise;
        } finally {
            // Promise-Cache nach Abschluss freigeben, damit spaeter ein
            // erneuter Start (z.B. nach `stop()`) moeglich ist.
            this.startPromise = undefined;
        }
    }

    /**
     * Tatsaechliche Start-Logik. Ausgelagert in eine eigene Methode, damit
     * der Promise-Cache in `start()` sauber funktioniert.
     */
    private async doStart(): Promise<void> {
        // Ignore-Handler initialisieren und Verbindung fuer jedes aktive
        // Profil testen. Fehler in einem Profil blockieren den Start
        // anderer Profile nicht — sie werden spaeter beim Trigger erneut
        // versucht (ConnectionPool-Reconnect).
        for (const [name, profile] of this.profiles.entries()) {
            if (!profile.watcher.enabled) {
                Logger.info(`Watcher disabled for profile "${name}"`);
                continue;
            }
    
            if (profile.direction === 'bidirectional') {
                Logger.warn(
                    `Profile "${name}" uses direction "bidirectional" — ` +
                    `not yet implemented, fallback to localToRemote semantics.`
                );
            }
    
            const ignoreHandler = this.ignoreHandlers.get(name);
            if (ignoreHandler) {
                await ignoreHandler.initialize();
            }
    
            const pool = this.connectionPools.get(name);
            if (pool) {
                try {
                    Logger.info(`Testing connection for profile "${name}"...`);
                    await pool.getConnection();
                } catch (error) {
                    Logger.warn(
                        `Profile "${name}" initial connection failed (will retry on demand): ${(error as Error).message}`
                    );
                }
            }
    
            // Tombstone-Store aufraeumen (veraltete Eintraege).
            const tsStore = this.tombstoneStores.get(name);
            if (tsStore) {
                await tsStore.prune();
            }
    
            // Polling-Loop fuer remoteToLocal-Profile starten.
            if (profile.direction === 'remoteToLocal' && profile.watcher.enabled) {
                this.startPollingLoop(name, profile);
            }
        }
    
        // Watch-Pattern: aus dem ersten aktiven Profil ableiten. Mehrere
        // Patterns koennen wir nicht kombinieren — daher gilt der Pattern
        // des ersten aktiven Profils fuer den ganzen Watcher. In der Regel
        // teilen sich Profile innerhalb eines Workspace dieselbe Quelle.
        let watchPattern = '**/*';
        for (const profile of this.profiles.values()) {
            if (profile.watcher.enabled && typeof profile.watcher.files === 'string') {
                watchPattern = profile.watcher.files;
                break;
            }
        }
    
        const pattern = new vscode.RelativePattern(this.workspacePath, watchPattern);
        // ACHTUNG — `awaitWriteFinish` ist BEWUSST deaktiviert.
        //
        // Hintergrund: VS-Code `awaitWriteFinish: { stability: 500 }`
        // wartet 500ms nach dem LETZTEN Schreibvorgang, bevor der
        // Change-Event ausgeloest wird. Bei kurzen Editor-Saves
        // (Atomar: write → close) funktioniert das. Bei KI-Agenten wie
        // Cursor / Cline / Continue versagt es: diese Tools schreiben
        // ueber mehrere Sekunden hinweg kontinuierlich (z.B. komplexes
        // TypeScript-Refactoring, das 1-3 Sekunden dauert und etliche
        // write-chunks produziert). Der awaitWriteFinish-Timer wird bei
        // jedem chunk zurueckgesetzt, loest am Ende nie aus, und der
        // finale Zustand der Datei wird nie an unseren Event-Handler
        // gemeldet. Die Datei wird NICHT hochgeladen.
        //
        // Wir verlassen uns stattdessen auf unseren eigenen Debounce
        // (debounceMs = 500) in handleFileChange. Der native Watcher
        // feuert bei JEDEM onDidChange und unser User-Code collapst
        // mehrere Events zu einem einzigen Upload. Das verhaelt sich
        // robust gegenueber beliebig langen KI-Write-Sequenzen.
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
    
        // Events werden auf alle aktiven Profile verteilt: jeder Trigger
        // wird per localPath-Match dem zustaendigen Profil zugeordnet.
        //
        // Wichtig: Wir registrieren die Events sobald IRGENDEINE Form von
        // Auto-Operation gewuenscht ist — `uploadOnSave` ODER `autoUpload`
        // fuer Uploads, `autoDelete` fuer Loeschungen. `uploadOnSave: true`
        // ist im Watcher-Kontext ein legitimer Trigger, weil KI-Agenten und
        // externe Tools den VS-Code-Save-Flow umgehen und nur ueber den
        // FileSystemWatcher erkannt werden koennen. handleFileChange macht
        // den zusaetzlichen Per-Profil-Filter (ein "manuell-nur"-Profil
        // wird nicht hochgeladen, auch wenn ein anderes Profil im selben
        // Workspace Auto-Upload aktiviert hat).
        const anyUploadViaFs = Array.from(this.profiles.values())
            .some(p => p.watcher.enabled && (p.uploadOnSave || p.watcher.autoUpload) && p.direction !== 'remoteToLocal');
        const anyDeleteViaFs = Array.from(this.profiles.values())
            .some(p => p.watcher.enabled && p.watcher.autoDelete && p.direction !== 'remoteToLocal');
    
        if (anyUploadViaFs) {
            this.watcherDisposables.push(
                this.watcher.onDidCreate((uri) => this.handleFileChange('created', uri))
            );
            this.watcherDisposables.push(
                this.watcher.onDidChange((uri) => this.handleFileChange('changed', uri))
            );
        }
    
        if (anyDeleteViaFs) {
            this.watcherDisposables.push(
                this.watcher.onDidDelete((uri) => this.handleFileChange('deleted', uri))
            );
        }
    
            this.isRunning = true;
            Logger.success(`File watcher started for ${this.workspacePath} (${this.connectionPools.size} pool(s))`);
            Logger.info(`Watching pattern: ${watchPattern}`);
        }
    
        /**
         * Startet einen Polling-Loop fuer ein remoteToLocal-Profil. Pro Tick
         * wird das Remote-Verzeichnis gelistet, mit dem letzten Stand
     * verglichen und neue/geaenderte Dateien werden heruntergeladen.
     */
    private startPollingLoop(profileName: string, profile: FtpSyncProfile): void {
        const intervalMs = profile.watcher.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
        Logger.info(
            `[${profileName}] Starting remoteToLocal polling loop ` +
            `(interval=${intervalMs}ms, remote=${profile.remotePath})`
        );

        const tick = async (): Promise<void> => {
            if (!this.isRunning) {
                return;
            }
            try {
                await this.pollOnce(profileName, profile);
            } catch (error) {
                Logger.warn(
                    `[${profileName}] Polling tick failed: ${(error as Error).message}`
                );
            }
        };

        // Erster Tick sofort, dann periodisch.
        void tick();
        const timer = setInterval(() => { void tick(); }, intervalMs);
        this.pollingTimers.set(profileName, timer);
    }

    /**
     * Ein einzelner Polling-Tick. Vergleich Remote-State mit Cache und
     * lokaler Existenz; Downloads werden enqueued.
     */
    private async pollOnce(profileName: string, profile: FtpSyncProfile): Promise<void> {
        const pool = this.connectionPools.get(profileName);
        const ignoreHandler = this.ignoreHandlers.get(profileName);
        if (!pool || !ignoreHandler) {
            return;
        }

        const remoteEntries = await pool.executeWithRetry(
            (client) => client.listDirectory(profile.remotePath),
            `poll list ${profile.remotePath}`
        );

        const previousState = this.remoteStateCache.get(profileName) ?? new Map();
        const newState = new Map<string, { size: number; modifiedTime: number }>();
        const tombstoneStore = this.tombstoneStores.get(profileName);

        for (const entry of remoteEntries) {
            if (entry.type === 'directory') {
                continue;
            }
            const relativeRemote = getRelativePath(profile.remotePath, entry.path);
            if (ignoreHandler.isIgnored(relativeRemote)) {
                continue;
            }
            const localPath = remoteToLocalPath(entry.path, profile.remotePath, profile.localPath);
            newState.set(entry.path, {
                size: entry.size,
                modifiedTime: entry.modifiedTime.getTime()
            });

            const prev = previousState.get(entry.path);
            const isNew = !prev;
            const isChanged =
                !!prev &&
                (prev.size !== entry.size || prev.modifiedTime !== entry.modifiedTime.getTime());
            const existsLocally = fs.existsSync(localPath);

            if ((isNew || isChanged) && existsLocally) {
                // Konflikt: lokal und remote geaendert — wir ueberschreiben
                // nicht automatisch (Last-Writer-Wins waere falsch, der User
                // soll entscheiden). Wir ueberspringen.
                if (isChanged) {
                    Logger.debug(
                        `[${profileName}] Conflict on ${entry.path} ` +
                        `(both sides changed) — skipping`
                    );
                    continue;
                }
            }

            if ((isNew || isChanged) && tombstoneStore?.has(entry.path)) {
                Logger.debug(
                    `[${profileName}] Skipping ${entry.path} (tombstone present)`
                );
                continue;
            }

            if (isNew || isChanged) {
                Logger.info(
                    `[${profileName}] Downloading ${relativeRemote} ` +
                    `(${isNew ? 'new' : 'changed'})`
                );
                this.enqueueRemoteDownload(profileName, profile, entry.path, localPath);
            }
        }

        this.remoteStateCache.set(profileName, newState);
    }

    /**
     * Schliesst einen Remote-Download in die OperationQueue ein. Verwendet
     * dieselbe Pipeline wie manuelle Downloads, sodass Retry-/Slot-Semantik
     * konsistent bleibt.
     */
    private enqueueRemoteDownload(
        profileName: string,
        profile: FtpSyncProfile,
        remotePath: string,
        localPath: string
    ): void {
        const tsStore = this.tombstoneStores.get(profileName);
        this.operationQueue.enqueue(
            async () => {
                if (tsStore?.has(remotePath)) {
                    Logger.debug(`[${profileName}] Skipping download (tombstone): ${remotePath}`);
                    return;
                }
                const pool = this.connectionPools.get(profileName);
                if (!pool) {
                    return;
                }
                const success = await this.downloadFile(remotePath, localPath);
                if (success && tsStore) {
                    // Datei ist durch, also existiert der Tombstone nicht
                    // mehr aus Sicht des Users — entfernen.
                    await tsStore.remove(remotePath);
                }
            },
            { priority: 1, timeout: 30000 }
        ).catch((error) => {
            Logger.error(
                `[${profileName}] Polling download failed: ${(error as Error).message}`
            );
        });
    }

    /**
     * Stoppt den File-Watcher und gibt alle Ressourcen frei.
     */
    public async stop(): Promise<void> {
        if (!this.isRunning) {
            return;
        }

        this.debounceTimers.forEach((timer) => clearTimeout(timer));
        this.debounceTimers.clear();
        this.pendingOperations.clear();
        this.activeUploads.clear();
        this.operationQueue.clear();

        // Polling-Timer stoppen.
        this.pollingTimers.forEach((timer) => clearInterval(timer));
        this.pollingTimers.clear();
        this.remoteStateCache.clear();

        this.watcherDisposables.forEach(d => d.dispose());
        this.watcherDisposables = [];

        if (this.watcher) {
            this.watcher.dispose();
            this.watcher = undefined;
        }

        for (const pool of this.connectionPools.values()) {
            await pool.dispose();
        }
        this.stats.isConnected = false;

        this.isRunning = false;
        // startPromise-Cache loeschen, damit ein spaeteres start() wieder
        // eine frische Initialisierung durchfuehrt (statt auf ein
        // abgeschlossenes Promise aufzulaufen).
        this.startPromise = undefined;
        Logger.info('File watcher stopped');
    }

    public isActive(): boolean {
        return this.isRunning;
    }

    /**
     * Liefert aggregierte Statistik. Bei mehreren Profilen ist
     * isConnected === true, sobald mindestens ein Pool verbunden ist.
     */
    public getStats(): WatcherStats {
        const queueStatus = this.operationQueue.getStatus();
        const anyConnected = Array.from(this.connectionPools.values())
            .some(pool => pool.isConnected());
        return {
            ...this.stats,
            isConnected: anyConnected,
            queueLength: queueStatus.pending + queueStatus.active
        };
    }

    public onChange(callback: (event: FileChangeEvent) => void): void {
        this.onChangeCallback = callback;
    }

    public onError(callback: (error: Error) => void): void {
        this.onErrorCallback = callback;
    }

    /**
     * Loest die URI auf das zustaendige Profil auf (lokalster localPath
     * gewinnt). Profile ohne Match oder mit deaktiviertem Watcher werden
     * uebersprungen.
     */
    private resolveProfileForUri(uri: vscode.Uri): { profile: FtpSyncProfile; name: string } | undefined {
        const eligible: Array<{ name: string; profile: FtpSyncProfile }> = [];
        for (const [name, profile] of this.profiles.entries()) {
            if (!profile.watcher.enabled) {
                continue;
            }
            eligible.push({ name, profile });
        }

        const match = resolveProfileByLongestPrefix(uri.fsPath, eligible.map(e => e.profile));
        if (!match) {
            return undefined;
        }
        const entry = eligible.find(e => e.profile.localPath === match.localPath);
        if (!entry) {
            return undefined;
        }
        return { profile: entry.profile, name: entry.name };
    }

    /**
     * File-Change-Handler mit Debouncing und Duplikat-Vermeidung. Identisch
     * zum alten Verhalten, aber das Ziel-Profil wird pro Trigger bestimmt.
     */
    private handleFileChange(type: FileChangeType, uri: vscode.Uri): void {
        const resolved = this.resolveProfileForUri(uri);
        if (!resolved) {
            Logger.debug(`No matching profile for ${type} event: ${uri.fsPath}`);
            return;
        }

        const { profile, name: profileName } = resolved;
        const ignoreHandler = this.ignoreHandlers.get(profileName);

        // Per-Profil-Filter: Ein Profil, das explizit nur manuelle Uploads
        // zulaesst (uploadOnSave: false, autoUpload: false), darf nicht durch
        // File-System-Events eines anderen Profils hochgeladen werden. Dieser
        // Filter stellt sicher, dass die "anyUploadViaFs"-Optimierung oben
        // nicht versehentlich in einem manuell-nur-Profil landet.
        if ((type === 'created' || type === 'changed') &&
            !profile.uploadOnSave && !profile.watcher.autoUpload) {
            Logger.debug(
                `[${profileName}] Skipping watcher ${type} for ${uri.fsPath} ` +
                `(upload disabled on this profile)`
            );
            return;
        }
        if (type === 'deleted' && !profile.watcher.autoDelete) {
            Logger.debug(
                `[${profileName}] Skipping watcher ${type} for ${uri.fsPath} ` +
                `(autoDelete disabled on this profile)`
            );
            return;
        }

        const relativePath = getRelativePath(profile.localPath, uri.fsPath);
        const workspaceRelative = getRelativePath(this.workspacePath, uri.fsPath);

        if (ignoreHandler && ignoreHandler.isIgnored(relativePath)) {
            Logger.debug(`[${profileName}] Ignoring ${type} event for: ${workspaceRelative}`);
            return;
        }

        const key = uri.fsPath;

        if (this.activeUploads.has(key)) {
            Logger.debug(`[${profileName}] Skipping watcher ${type} for: ${workspaceRelative} (uploadOnSave in progress)`);
            return;
        }

        const existingTimer = this.debounceTimers.get(key);
        if (existingTimer) {
            clearTimeout(existingTimer);
            Logger.debug(`[${profileName}] Debouncing ${type} for: ${workspaceRelative}`);
        }

        const timer = setTimeout(() => {
            this.debounceTimers.delete(key);

            if (this.pendingOperations.has(key)) {
                Logger.debug(`[${profileName}] Skipping duplicate ${type} for: ${workspaceRelative} (already queued)`);
                return;
            }

            if (this.activeUploads.has(key)) {
                Logger.debug(`[${profileName}] Skipping watcher ${type} for: ${workspaceRelative} (uploadOnSave completed during debounce)`);
                return;
            }

            this.queueFileChange(type, uri, workspaceRelative, profileName);
        }, this.debounceMs);

        this.debounceTimers.set(key, timer);
    }

    private queueFileChange(
        type: FileChangeType,
        uri: vscode.Uri,
        relativePath: string,
        profileName: string
    ): void {
        const event: FileChangeEvent = { type, uri, relativePath, profileName };
        const key = uri.fsPath;

        this.pendingOperations.add(key);

        if (this.onChangeCallback) {
            this.onChangeCallback(event);
        }

        const priority = type === 'deleted' ? 0 : 1;

        this.operationQueue.enqueue(
            () => this.processFileChange(type, uri, relativePath, profileName),
            { priority, timeout: 30000 }
        ).then(() => {
            this.pendingOperations.delete(key);
        }).catch((error) => {
            this.pendingOperations.delete(key);
            Logger.error(`[${profileName}] Failed to process ${type} for ${relativePath}: ${(error as Error).message}`);
            if (this.onErrorCallback) {
                this.onErrorCallback(error as Error);
            }
        });
    }

    /**
     * Verarbeitet einen File-Change ueber den ConnectionPool des Profils.
     */
    private async processFileChange(
        type: FileChangeType,
        uri: vscode.Uri,
        relativePath: string,
        profileName: string
    ): Promise<void> {
        const profile = this.profiles.get(profileName);
        const pool = this.connectionPools.get(profileName);
        if (!profile || !pool) {
            throw new Error(`Profile "${profileName}" disappeared during processing`);
        }

        const remotePath = localToRemotePath(
            uri.fsPath,
            profile.localPath,
            profile.remotePath
        );

        // Tombstone-Hook: bei einer lokalen Loeschung in einem Profil mit
        // Tombstone-Store den Remote-Pfad markieren, damit ein
        // remoteToLocal-Pull die Datei nicht zurueckbringt.
        if (type === 'deleted') {
            const tsStore = this.tombstoneStores.get(profileName);
            if (tsStore) {
                await tsStore.add(remotePath);
                Logger.debug(
                    `[${profileName}] Tombstone set for ${remotePath} ` +
                    `(TTL ${TOMBSTONE_TTL_MS / 1000}s)`
                );
            }
        }

        try {
            await pool.executeWithRetry(
                async (client) => {
                    switch (type) {
                        case 'created':
                        case 'changed': {
                            const fs = await import('fs');
                            const stats = fs.statSync(uri.fsPath);

                            if (stats.isDirectory()) {
                                Logger.debug(`[${profileName}] Creating directory: ${remotePath}`);
                                await client.ensureDirectory(remotePath);
                                this.stats.uploadsSucceeded++;
                            } else {
                                const result = await client.uploadFile(uri.fsPath, remotePath);
                                if (result.success) {
                                    this.stats.uploadsSucceeded++;
                                } else {
                                    this.stats.uploadsFailed++;
                                    throw result.error || new Error('Upload failed');
                                }
                            }
                            break;
                        }
                        case 'deleted':
                            try {
                                await client.deleteFile(remotePath);
                                this.stats.deletesSucceeded++;
                            } catch {
                                try {
                                    await client.deleteDirectory(remotePath);
                                    this.stats.deletesSucceeded++;
                                } catch {
                                    this.stats.deletesFailed++;
                                    Logger.debug(`[${profileName}] Could not delete ${remotePath}: may not exist on remote`);
                                }
                            }
                            break;
                    }
                },
                `${type} ${relativePath}`
            );

            this.stats.lastActivity = new Date();
            this.stats.isConnected = pool.isConnected();
        } catch (error) {
            this.stats.isConnected = pool.isConnected();
            throw error;
        }
    }

    /**
     * Manueller Upload (z.B. via Ctrl+S). Verwendet das per URI aufgeloeste
     * Profil. Bei keinem Match: Fehler (im Gegensatz zum Watcher, der
     * stumm uebergeht).
     */
    public async uploadFile(localPath: string): Promise<boolean> {
        const uri = vscode.Uri.file(localPath);
        const resolved = this.resolveProfileForUri(uri);
        if (!resolved) {
            Logger.warn(`No profile found for upload: ${localPath}`);
            return false;
        }

        const { profile, name: profileName } = resolved;
        const ignoreHandler = this.ignoreHandlers.get(profileName);
        const pool = this.connectionPools.get(profileName);

        if (!pool) {
            Logger.error(`Profile "${profileName}" has no connection pool`);
            return false;
        }

        const relativePath = getRelativePath(profile.localPath, localPath);

        if (ignoreHandler && ignoreHandler.isIgnored(relativePath)) {
            Logger.warn(`[${profileName}] File is ignored: ${relativePath}`);
            return false;
        }

        this.activeUploads.add(localPath);

        const existingTimer = this.debounceTimers.get(localPath);
        if (existingTimer) {
            clearTimeout(existingTimer);
            this.debounceTimers.delete(localPath);
        }

        const remotePath = localToRemotePath(localPath, profile.localPath, profile.remotePath);

        try {
            await pool.executeWithRetry(
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
            this.stats.isConnected = pool.isConnected();
            return true;
        } catch (error) {
            this.stats.uploadsFailed++;
            this.stats.isConnected = pool.isConnected();
            Logger.error(`[${profileName}] Failed to upload ${relativePath}: ${(error as Error).message}`);
            return false;
        } finally {
            setTimeout(() => {
                this.activeUploads.delete(localPath);
            }, 1000);
        }
    }

    /**
     * Manueller Download. Verwendet das per URI aufgeloeste Profil.
     */
    public async downloadFile(remotePath: string, localPath: string): Promise<boolean> {
        const uri = vscode.Uri.file(localPath);
        const resolved = this.resolveProfileForUri(uri);
        if (!resolved) {
            Logger.warn(`No profile found for download: ${localPath}`);
            return false;
        }

        const { name: profileName } = resolved;
        const pool = this.connectionPools.get(profileName);

        if (!pool) {
            Logger.error(`Profile "${profileName}" has no connection pool`);
            return false;
        }

        try {
            await pool.executeWithRetry(
                async (client) => {
                    const result = await client.downloadFile(remotePath, localPath);
                    if (!result.success) {
                        throw result.error || new Error('Download failed');
                    }
                },
                `download ${path.basename(remotePath)}`
            );

            this.stats.lastActivity = new Date();
            this.stats.isConnected = pool.isConnected();
            return true;
        } catch (error) {
            this.stats.isConnected = pool.isConnected();
            Logger.error(`[${profileName}] Failed to download: ${(error as Error).message}`);
            return false;
        }
    }

    /**
     * Upload eines Ordners rekursiv. Iteriert ueber alle Profile und laedt
     * jede Datei ueber das passende Profil hoch. Reihenfolge ist die
     * Definition-Reihenfolge der Profile.
     */
    public async uploadFolder(
        folderPath: string,
        onProgress?: (current: number, total: number, fileName: string) => void
    ): Promise<{ success: number; failed: number }> {
        const fs = await import('fs');
        const result = { success: 0, failed: 0 };

        const filesToUpload: Array<{ fullPath: string; relativePath: string }> = [];

        const collectFiles = (dirPath: string): void => {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });

            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                const relativePath = getRelativePath(this.workspacePath, fullPath);

                // Globale Pruefung gegen alle Profile-Ignore-Listen.
                let ignored = false;
                for (const handler of this.ignoreHandlers.values()) {
                    if (handler.isIgnored(relativePath)) {
                        ignored = true;
                        break;
                    }
                }
                if (ignored) {
                    continue;
                }

                if (entry.isDirectory()) {
                    collectFiles(fullPath);
                } else if (entry.isFile()) {
                    filesToUpload.push({ fullPath, relativePath });
                }
            }
        };

        collectFiles(folderPath);
        const totalFiles = filesToUpload.length;

        for (let i = 0; i < filesToUpload.length; i++) {
            const file = filesToUpload[i];

            if (onProgress) {
                onProgress(i + 1, totalFiles, path.basename(file.fullPath));
            }

            const success = await this.uploadFile(file.fullPath);
            if (success) {
                result.success++;
            } else {
                result.failed++;
            }
        }

        return result;
    }

    /**
     * Liefert die Anzahl der Dateien im Ordner, die von KEINEM Profil
     * ignoriert werden.
     */
    public async getFileCount(folderPath: string): Promise<number> {
        const fs = await import('fs');
        let count = 0;

        const countFiles = (dirPath: string): void => {
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                const relativePath = getRelativePath(this.workspacePath, fullPath);

                let ignored = false;
                for (const handler of this.ignoreHandlers.values()) {
                    if (handler.isIgnored(relativePath)) {
                        ignored = true;
                        break;
                    }
                }
                if (ignored) {
                    continue;
                }

                if (entry.isDirectory()) {
                    countFiles(fullPath);
                } else if (entry.isFile()) {
                    count++;
                }
            }
        };

        countFiles(folderPath);
        return count;
    }

    public async reloadIgnorePatterns(): Promise<void> {
        for (const handler of this.ignoreHandlers.values()) {
            await handler.reload();
        }
    }

    /**
     * Erzwingt Reconnect aller ConnectionPools.
     */
    public async forceReconnect(): Promise<void> {
        Logger.info('Forcing reconnection for all profiles...');
        for (const pool of this.connectionPools.values()) {
            try {
                await pool.forceReconnect();
            } catch (error) {
                Logger.warn(`Reconnect failed: ${(error as Error).message}`);
            }
        }
        this.stats.isConnected = true;
    }

    public pause(): void {
        this.operationQueue.pause();
    }

    public resume(): void {
        this.operationQueue.resume();
    }

    /**
     * Liefert die Profile-Map (read-only-Sicht). Fuer Konsumenten, die das
     * Profil direkt brauchen (z.B. fuer Host-Anzeige in der Statusbar).
     */
    public getProfiles(): Map<string, FtpSyncProfile> {
        return this.profiles;
    }

    /**
     * Liefert einen bestimmten ConnectionPool. Benoetigt von Konsumenten, die
     * ausserhalb des Watcher-Flows arbeiten (z.B. FTP Explorer).
     */
    public getConnectionPool(profileName: string): ConnectionPool | undefined {
        return this.connectionPools.get(profileName);
    }
}
