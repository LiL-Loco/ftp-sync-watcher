/**
 * Configuration types for FTP Sync Watcher (v2.0+ Multi-Profile)
 *
 * Hinweis: Der fruehere Begriff "Config" wurde durch "Profile" ersetzt, weil
 * ein Workspace seit v2.0.0 mehrere unabhaengige Sync-Ziele halten kann. Ein
 * Profile beschreibt genau eine Verbindung in eine Richtung. Bidirektionaler
 * Sync wird als ZWEI Profile modelliert (siehe ADR-0003), nicht ueber ein
 * direction: 'bidirectional'-Feld.
 */

import * as path from 'path';

export type Protocol = 'ftp' | 'sftp';

/**
 * Sync-Richtung eines Profils. Heute produktiv: 'localToRemote'. Die anderen
 * Werte werden ohne Fehler geladen, fuehren aber noch keine Transfers aus —
 * sie sind forward-kompatibel fuer die Spiegel-Logik in einem spaeteren
 * 2.x-Release.
 */
export type Direction = 'localToRemote' | 'remoteToLocal' | 'bidirectional';

export interface WatcherConfig {
    enabled: boolean;
    files: string | false;
    autoUpload: boolean;
    autoDelete: boolean;
    /**
     * Polling-Intervall in Millisekunden fuer Profile mit
     * direction: 'remoteToLocal'. Bestimmt, wie oft der Watcher das
     * Remote-Verzeichnis listet und mit dem lokalen State abgleicht.
     * Default: 30000 (30 Sekunden).
     */
    pollIntervalMs?: number;
}

export interface SecureOptions {
    rejectUnauthorized?: boolean;
    caPath?: string;
    certPath?: string;
    keyPath?: string;
    passphrase?: string;
    minVersion?: 'TLSv1.2' | 'TLSv1.3';
    maxVersion?: 'TLSv1.2' | 'TLSv1.3';
    ciphers?: string;
    servername?: string;
    secureProtocol?: string;
}

/**
 * Ein einzelnes Sync-Profil: eine Verbindung in eine Richtung. Pflichtfelder
 * sind name, host, username, remotePath. Das fruehere 'concurrency'-Feld
 * wurde entfernt — OperationQueue laeuft strikt sequentiell (siehe
 * ADR-0001).
 */
export interface FtpSyncProfile {
    name: string;
    direction?: Direction;
    protocol: Protocol;
    host: string;
    port?: number;
    username: string;
    password?: string;
    privateKeyPath?: string;
    passphrase?: string;
    remotePath: string;
    localPath: string;
    uploadOnSave: boolean;
    watcher: WatcherConfig;
    ignore: string[];
    useGitIgnore: boolean;
    secure: boolean;
    secureOptions?: SecureOptions;
    timeout: number;
    debug: boolean;
}

/**
 * Top-Level-Shape der .ftpsync.json-Datei ab v2.0.0. Mehrere Profile pro
 * Workspace ermoeglichen mehrere Server und (in einem spaeteren Release) auch
 * bidirektionalen Sync als zwei unidirektionale Profile.
 */
export interface FtpSyncConfigFile {
    profiles: FtpSyncProfile[];
}

/**
 * Defaults, die beim Fehlen einzelner Felder in einem Profil eingesetzt
 * werden. Bewusst ohne 'concurrency' (entfernt in v2.0.0).
 */
export const DEFAULT_PROFILE: Partial<FtpSyncProfile> = {
    direction: 'localToRemote',
    protocol: 'sftp',
    localPath: '.',
    uploadOnSave: true,
    watcher: {
        enabled: true,
        files: '**/*',
        autoUpload: true,
        autoDelete: false
    },
    ignore: [
        '.git',
        '.vscode',
        'node_modules',
        '.ftpsync.json'
    ],
    useGitIgnore: true,
    secure: false,
    secureOptions: {
        rejectUnauthorized: true
    },
    timeout: 30000,
    debug: false
};

/**
 * Default-Name, der einem Profil bei der stillen Migration aus dem
 * Legacy-Shape (flaches Objekt ohne 'profiles'-Schluessel) zugewiesen wird.
 * Deterministisch, damit Logs und Statusbar denselben Namen anzeigen.
 */
export const LEGACY_MIGRATION_PROFILE_NAME = 'default';

/**
 * Ablaufzeit eines Tombstones. Sieben Tage reichen, damit ein Roundtrip
 * (lokal loeschen → naechster Remote-Pull → Datei waere zurueck) sicher
 * abgefangen wird, ohne dass dauerhaft Speicher fuer alte Loeschungen
 * liegen bleibt.
 */
export const TOMBSTONE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Default-Polling-Intervall fuer remoteToLocal-Profile in Millisekunden.
 * Wird verwendet, wenn watcher.pollIntervalMs nicht gesetzt ist.
 */
export const DEFAULT_POLL_INTERVAL_MS = 30000;

export function getDefaultPort(protocol: Protocol, secure: boolean): number {
    if (protocol === 'sftp') {
        return 22;
    }
    return secure ? 990 : 21;
}

/**
 * Wendet die Defaults auf ein partielles Profil an. Pflichtfelder werden
 * NICHT erzwungen — die JSON-Schema-Validierung ist dafuer zustaendig, der
 * Aufrufer muss bereits ein gueltiges Profil liefern. Diese Funktion fuellt
 * nur fehlende optionale Felder auf.
 */
export function mergeProfileWithDefaults(profile: Partial<FtpSyncProfile>): FtpSyncProfile {
    const merged = { ...DEFAULT_PROFILE, ...profile } as FtpSyncProfile;

    if (profile.watcher) {
        merged.watcher = { ...DEFAULT_PROFILE.watcher, ...profile.watcher } as WatcherConfig;
    }

    if (profile.secureOptions) {
        merged.secureOptions = { ...DEFAULT_PROFILE.secureOptions, ...profile.secureOptions } as SecureOptions;
    }

    if (!merged.port) {
        merged.port = getDefaultPort(merged.protocol, merged.secure);
    }

    return merged;
}

/**
 * Erkennt das Legacy-Format (flaches Objekt ohne 'profiles'-Schluessel) und
 * packt es in die neue Container-Form. Bestimmt einen deterministischen
 * Default-Namen fuer das eine migrierte Profil. Felder, die in v2.0.0
 * weggefallen sind (z.B. 'concurrency'), werden verworfen.
 *
 * Diese Funktion ist still: Sie gibt weder Logging noch Benutzer-Hinweise
 * aus. Die Migration ist Teil des "unsichtbaren Upgrades" (siehe PRD).
 */
export function migrateLegacyConfig(rawObject: unknown): FtpSyncConfigFile {
    if (!rawObject || typeof rawObject !== 'object' || Array.isArray(rawObject)) {
        return { profiles: [] };
    }

    const obj = rawObject as Record<string, unknown>;

    // Bereits im neuen Shape? Dann nur durchreichen — die Schema-Validierung
    // und mergeProfileWithDefaults gehoeren in den ConfigManager.
    if (Array.isArray(obj.profiles)) {
        return obj as unknown as FtpSyncConfigFile;
    }

    // Legacy-Shape: flaches Objekt ohne 'profiles'. Wir bauen ein einzelnes
    // Profil daraus. Konfliktfeld 'concurrency' wird bewusst verworfen.
    const legacyProfile: Partial<FtpSyncProfile> = { ...obj };
    delete (legacyProfile as Record<string, unknown>).concurrency;

    if (!legacyProfile.name) {
        legacyProfile.name = LEGACY_MIGRATION_PROFILE_NAME;
    }

    return { profiles: [legacyProfile as FtpSyncProfile] };
}

/**
 * Pure-Subset der Pfad-Aufloesung aus ConfigManager.prepareProfile. Loest
 * relative lokale Pfade und TLS-Pfade gegen den Workspace-Folder auf.
 *
 * Diese Funktion ist bewusst pure (keine vscode-Imports, kein fs-Zugriff,
 * kein Logging) — sie ist der Refactoring-Schutz fuer
 * `ConfigManager.prepareProfile` und in `prepareProfile.test.ts` direkt
 * testbar.
 *
 * Verhalten:
 *   - leerer `localPath`  → `folderPath` (Workspace-Root)
 *   - relativer `localPath` → `path.join(folderPath, localPath)`
 *   - absoluter `localPath` → bleibt unveraendert
 *   - TLS-Pfade: ebenfalls relativ zu folderPath, falls nicht absolut
 *   - Existenz-Pruefung der TLS-Dateien ist NICHT Teil dieser Funktion;
 *     der ConfigManager warnt separat und schreibt es nicht in das
 *     Profil-Objekt.
 */
export function resolveProfilePaths(
    folderPath: string,
    merged: FtpSyncProfile
): FtpSyncProfile {
    let resolvedLocalPath: string;
    if (merged.localPath && !path.isAbsolute(merged.localPath)) {
        resolvedLocalPath = path.join(folderPath, merged.localPath);
    } else if (!merged.localPath) {
        resolvedLocalPath = folderPath;
    } else {
        resolvedLocalPath = merged.localPath;
    }

    let resolvedSecureOptions = merged.secureOptions;
    if (merged.secureOptions) {
        const resolveOne = (p?: string): string | undefined => {
            if (!p) return p;
            if (path.isAbsolute(p)) return p;
            return path.join(folderPath, p);
        };
        resolvedSecureOptions = {
            ...merged.secureOptions,
            caPath: resolveOne(merged.secureOptions.caPath),
            certPath: resolveOne(merged.secureOptions.certPath),
            keyPath: resolveOne(merged.secureOptions.keyPath)
        };
    }

    return {
        ...merged,
        localPath: resolvedLocalPath,
        secureOptions: resolvedSecureOptions
    };
}