/**
 * Configuration types for FTP Sync Watcher (v2.0+ Multi-Profile)
 *
 * Hinweis: Der fruehere Begriff "Config" wurde durch "Profile" ersetzt, weil
 * ein Workspace seit v2.0.0 mehrere unabhaengige Sync-Ziele halten kann. Ein
 * Profile beschreibt genau eine Verbindung in eine Richtung. Bidirektionaler
 * Sync wird als ZWEI Profile modelliert (siehe ADR-0003), nicht ueber ein
 * direction: 'bidirectional'-Feld.
 */

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