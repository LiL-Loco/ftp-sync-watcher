import SftpClient from 'ssh2-sftp-client';
import * as fs from 'fs';
import * as path from 'path';
import { FtpSyncConfig } from '../types';
import { Logger, normalizePath, getParentDir } from '../utils';
import { RemoteClient, TransferResult, RemoteFileInfo } from './remoteClient';

/**
 * SFTP Client implementation using ssh2-sftp-client
 */
export class SftpClientWrapper extends RemoteClient {
    private client: SftpClient;

    constructor(config: FtpSyncConfig) {
        super(config);
        this.client = new SftpClient();
    }

    async connect(): Promise<void> {
        try {
            Logger.info(`Connecting to SFTP server ${this.config.host}:${this.config.port}...`);
            
            const connectionOptions: SftpClient.ConnectOptions = {
                host: this.config.host,
                port: this.config.port,
                username: this.config.username,
                readyTimeout: this.config.timeout
            };

            // Use private key if provided, otherwise use password
            if (this.config.privateKeyPath) {
                const privateKey = fs.readFileSync(this.config.privateKeyPath);
                connectionOptions.privateKey = privateKey;
                if (this.config.passphrase) {
                    connectionOptions.passphrase = this.config.passphrase;
                }
            } else if (this.config.password) {
                connectionOptions.password = this.config.password;
            }

            if (this.config.debug) {
                connectionOptions.debug = (msg: string) => Logger.debug(`SFTP: ${msg}`);
            }

            await this.client.connect(connectionOptions);
            
            this.connected = true;
            Logger.success(`Connected to SFTP server ${this.config.host}`);
        } catch (error) {
            this.connected = false;
            Logger.error(`Failed to connect to SFTP server: ${(error as Error).message}`, error as Error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        try {
            await this.client.end();
            this.connected = false;
            Logger.info('Disconnected from SFTP server');
        } catch (error) {
            Logger.error(`Error disconnecting from SFTP server: ${(error as Error).message}`);
        }
    }

    async uploadFile(localPath: string, remotePath: string): Promise<TransferResult> {
        const normalizedRemotePath = normalizePath(remotePath);
        
        try {
            // Ensure remote directory exists
            await this.ensureDirectory(getParentDir(normalizedRemotePath));
            
            Logger.debug(`Uploading ${localPath} to ${normalizedRemotePath}`);
            await this.client.fastPut(localPath, normalizedRemotePath);
            
            Logger.success(`Uploaded: ${path.basename(localPath)}`);
            return {
                success: true,
                localPath,
                remotePath: normalizedRemotePath
            };
        } catch (error) {
            Logger.error(`Failed to upload ${localPath}: ${(error as Error).message}`);
            return {
                success: false,
                localPath,
                remotePath: normalizedRemotePath,
                error: error as Error
            };
        }
    }

    async downloadFile(remotePath: string, localPath: string): Promise<TransferResult> {
        const normalizedRemotePath = normalizePath(remotePath);
        
        try {
            // Ensure local directory exists
            const localDir = path.dirname(localPath);
            if (!fs.existsSync(localDir)) {
                fs.mkdirSync(localDir, { recursive: true });
            }
            
            Logger.debug(`Downloading ${normalizedRemotePath} to ${localPath}`);
            await this.client.fastGet(normalizedRemotePath, localPath);
            
            Logger.success(`Downloaded: ${path.basename(remotePath)}`);
            return {
                success: true,
                localPath,
                remotePath: normalizedRemotePath
            };
        } catch (error) {
            Logger.error(`Failed to download ${remotePath}: ${(error as Error).message}`);
            return {
                success: false,
                localPath,
                remotePath: normalizedRemotePath,
                error: error as Error
            };
        }
    }

    async deleteFile(remotePath: string): Promise<void> {
        const normalizedRemotePath = normalizePath(remotePath);
        
        try {
            Logger.debug(`Deleting remote file: ${normalizedRemotePath}`);
            await this.client.delete(normalizedRemotePath);
            Logger.success(`Deleted: ${path.basename(remotePath)}`);
        } catch (error) {
            Logger.error(`Failed to delete ${remotePath}: ${(error as Error).message}`);
            throw error;
        }
    }

    async deleteDirectory(remotePath: string): Promise<void> {
        const normalizedRemotePath = normalizePath(remotePath);
        
        try {
            Logger.debug(`Deleting remote directory: ${normalizedRemotePath}`);
            await this.client.rmdir(normalizedRemotePath, true);
            Logger.success(`Deleted directory: ${path.basename(remotePath)}`);
        } catch (error) {
            Logger.error(`Failed to delete directory ${remotePath}: ${(error as Error).message}`);
            throw error;
        }
    }

    async createDirectory(remotePath: string): Promise<void> {
        const normalizedRemotePath = normalizePath(remotePath);
        
        try {
            Logger.debug(`Creating remote directory: ${normalizedRemotePath}`);
            await this.client.mkdir(normalizedRemotePath, true);
        } catch (error) {
            // Ignore error if directory already exists
            const errorMessage = (error as Error).message;
            if (!errorMessage.includes('already exists') && !errorMessage.includes('EEXIST')) {
                throw error;
            }
        }
    }

    async ensureDirectory(remotePath: string): Promise<void> {
        const normalizedRemotePath = normalizePath(remotePath);
        
        try {
            const exists = await this.exists(normalizedRemotePath);
            if (!exists) {
                await this.client.mkdir(normalizedRemotePath, true);
            }
        } catch (error) {
            Logger.error(`Failed to ensure directory ${remotePath}: ${(error as Error).message}`);
            throw error;
        }
    }

    async listDirectory(remotePath: string): Promise<RemoteFileInfo[]> {
        const normalizedRemotePath = normalizePath(remotePath);
        
        try {
            const list = await this.client.list(normalizedRemotePath);
            return list.map((item: SftpClient.FileInfo) => ({
                name: item.name,
                path: normalizePath(path.join(normalizedRemotePath, item.name)),
                type: item.type === 'd' ? 'directory' as const : item.type === 'l' ? 'link' as const : 'file' as const,
                size: item.size,
                modifiedTime: new Date(item.modifyTime)
            }));
        } catch (error) {
            Logger.error(`Failed to list directory ${remotePath}: ${(error as Error).message}`);
            throw error;
        }
    }

    async exists(remotePath: string): Promise<boolean> {
        const normalizedRemotePath = normalizePath(remotePath);
        
        try {
            const result = await this.client.exists(normalizedRemotePath);
            return result !== false;
        } catch {
            return false;
        }
    }

    async isDirectory(remotePath: string): Promise<boolean> {
        const normalizedRemotePath = normalizePath(remotePath);
        
        try {
            const stat = await this.client.stat(normalizedRemotePath);
            return stat.isDirectory;
        } catch {
            return false;
        }
    }

    async getFileInfo(remotePath: string): Promise<RemoteFileInfo | null> {
        const normalizedRemotePath = normalizePath(remotePath);
        
        try {
            const stat = await this.client.stat(normalizedRemotePath);
            
            return {
                name: path.basename(normalizedRemotePath),
                path: normalizedRemotePath,
                type: stat.isDirectory ? 'directory' : 'file',
                size: stat.size,
                modifiedTime: new Date(stat.modifyTime)
            };
        } catch {
            return null;
        }
    }
}
