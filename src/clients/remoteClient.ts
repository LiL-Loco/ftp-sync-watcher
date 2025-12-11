import { FtpSyncConfig } from '../types';

/**
 * Result of a file transfer operation
 */
export interface TransferResult {
    success: boolean;
    localPath: string;
    remotePath: string;
    error?: Error;
}

/**
 * File info from remote server
 */
export interface RemoteFileInfo {
    name: string;
    path: string;
    type: 'file' | 'directory' | 'link';
    size: number;
    modifiedTime: Date;
}

/**
 * Abstract base class for remote clients (FTP/SFTP)
 */
export abstract class RemoteClient {
    protected config: FtpSyncConfig;
    protected connected = false;

    constructor(config: FtpSyncConfig) {
        this.config = config;
    }

    /**
     * Connect to the remote server
     */
    abstract connect(): Promise<void>;

    /**
     * Disconnect from the remote server
     */
    abstract disconnect(): Promise<void>;

    /**
     * Check if connected
     */
    isConnected(): boolean {
        return this.connected;
    }

    /**
     * Upload a file to the remote server
     */
    abstract uploadFile(localPath: string, remotePath: string): Promise<TransferResult>;

    /**
     * Download a file from the remote server
     */
    abstract downloadFile(remotePath: string, localPath: string): Promise<TransferResult>;

    /**
     * Delete a file on the remote server
     */
    abstract deleteFile(remotePath: string): Promise<void>;

    /**
     * Delete a directory on the remote server
     */
    abstract deleteDirectory(remotePath: string): Promise<void>;

    /**
     * Create a directory on the remote server
     */
    abstract createDirectory(remotePath: string): Promise<void>;

    /**
     * Ensure directory exists (create if needed)
     */
    abstract ensureDirectory(remotePath: string): Promise<void>;

    /**
     * List files in a remote directory
     */
    abstract listDirectory(remotePath: string): Promise<RemoteFileInfo[]>;

    /**
     * Check if a remote path exists
     */
    abstract exists(remotePath: string): Promise<boolean>;

    /**
     * Check if a remote path is a directory
     */
    abstract isDirectory(remotePath: string): Promise<boolean>;

    /**
     * Get file info for a remote path
     */
    abstract getFileInfo(remotePath: string): Promise<RemoteFileInfo | null>;
}
