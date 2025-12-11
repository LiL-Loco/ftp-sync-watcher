/**
 * Configuration types for FTP Sync Watcher
 */

export type Protocol = 'ftp' | 'sftp';

export interface WatcherConfig {
    enabled: boolean;
    files: string | false;
    autoUpload: boolean;
    autoDelete: boolean;
}

export interface SecureOptions {
    rejectUnauthorized: boolean;
}

export interface FtpSyncConfig {
    name?: string;
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
    concurrency: number;
    debug: boolean;
}

export const DEFAULT_CONFIG: Partial<FtpSyncConfig> = {
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
    timeout: 30000,
    concurrency: 3,
    debug: false
};

export function getDefaultPort(protocol: Protocol, secure: boolean): number {
    if (protocol === 'sftp') {
        return 22;
    }
    return secure ? 990 : 21;
}

export function mergeWithDefaults(config: Partial<FtpSyncConfig>): FtpSyncConfig {
    const merged = { ...DEFAULT_CONFIG, ...config } as FtpSyncConfig;
    
    // Merge watcher config
    if (config.watcher) {
        merged.watcher = { ...DEFAULT_CONFIG.watcher, ...config.watcher } as WatcherConfig;
    }
    
    // Set default port based on protocol
    if (!merged.port) {
        merged.port = getDefaultPort(merged.protocol, merged.secure);
    }
    
    return merged;
}
