import * as ftp from 'basic-ftp';
import * as fs from 'fs';
import * as path from 'path';
import { FtpSyncConfig } from '../types';
import { Logger, normalizePath, getParentDir } from '../utils';
import { RemoteClient, TransferResult, RemoteFileInfo } from './remoteClient';

/**
 * FTP Client implementation using basic-ftp
 */
export class FtpClient extends RemoteClient {
    private client: ftp.Client;

    constructor(config: FtpSyncConfig) {
        super(config);
        this.client = new ftp.Client(this.config.timeout);
        
        if (this.config.debug) {
            this.client.ftp.verbose = true;
        }
    }

    async connect(): Promise<void> {
        try {
            Logger.info(`Connecting to FTP server ${this.config.host}:${this.config.port}...`);
            
            await this.client.access({
                host: this.config.host,
                port: this.config.port,
                user: this.config.username,
                password: this.config.password,
                secure: this.config.secure,
                secureOptions: this.config.secureOptions
            });
            
            this.connected = true;
            Logger.success(`Connected to FTP server ${this.config.host}`);
        } catch (error) {
            this.connected = false;
            Logger.error(`Failed to connect to FTP server: ${(error as Error).message}`, error as Error);
            throw error;
        }
    }

    async disconnect(): Promise<void> {
        try {
            this.client.close();
            this.connected = false;
            Logger.info('Disconnected from FTP server');
        } catch (error) {
            Logger.error(`Error disconnecting from FTP server: ${(error as Error).message}`);
        }
    }

    async uploadFile(localPath: string, remotePath: string): Promise<TransferResult> {
        const normalizedRemotePath = normalizePath(remotePath);
        
        try {
            // Ensure remote directory exists
            await this.ensureDirectory(getParentDir(normalizedRemotePath));
            
            Logger.debug(`Uploading ${localPath} to ${normalizedRemotePath}`);
            await this.client.uploadFrom(localPath, normalizedRemotePath);
            
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
            await this.client.downloadTo(localPath, normalizedRemotePath);
            
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
            await this.client.remove(normalizedRemotePath);
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
            await this.client.removeDir(normalizedRemotePath);
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
            await this.client.send('MKD ' + normalizedRemotePath);
        } catch (error) {
            // Ignore error if directory already exists
            const errorMessage = (error as Error).message;
            if (!errorMessage.includes('550') && !errorMessage.includes('already exists')) {
                throw error;
            }
        }
    }

    async ensureDirectory(remotePath: string): Promise<void> {
        const normalizedRemotePath = normalizePath(remotePath);
        
        try {
            await this.client.ensureDir(normalizedRemotePath);
        } catch (error) {
            Logger.error(`Failed to ensure directory ${remotePath}: ${(error as Error).message}`);
            throw error;
        }
    }

    async listDirectory(remotePath: string): Promise<RemoteFileInfo[]> {
        const normalizedRemotePath = normalizePath(remotePath);
        
        try {
            const list = await this.client.list(normalizedRemotePath);
            return list.map(item => ({
                name: item.name,
                path: normalizePath(path.join(normalizedRemotePath, item.name)),
                type: item.isDirectory ? 'directory' as const : item.isSymbolicLink ? 'link' as const : 'file' as const,
                size: item.size,
                modifiedTime: item.modifiedAt || new Date()
            }));
        } catch (error) {
            Logger.error(`Failed to list directory ${remotePath}: ${(error as Error).message}`);
            throw error;
        }
    }

    async exists(remotePath: string): Promise<boolean> {
        const normalizedRemotePath = normalizePath(remotePath);
        
        try {
            await this.client.size(normalizedRemotePath);
            return true;
        } catch {
            try {
                await this.client.list(normalizedRemotePath);
                return true;
            } catch {
                return false;
            }
        }
    }

    async isDirectory(remotePath: string): Promise<boolean> {
        const normalizedRemotePath = normalizePath(remotePath);
        
        try {
            await this.client.list(normalizedRemotePath);
            return true;
        } catch {
            return false;
        }
    }

    async getFileInfo(remotePath: string): Promise<RemoteFileInfo | null> {
        const normalizedRemotePath = normalizePath(remotePath);
        const parentDir = getParentDir(normalizedRemotePath);
        const fileName = path.basename(normalizedRemotePath);
        
        try {
            const list = await this.client.list(parentDir);
            const file = list.find(f => f.name === fileName);
            
            if (!file) {
                return null;
            }
            
            return {
                name: file.name,
                path: normalizedRemotePath,
                type: file.isDirectory ? 'directory' : file.isSymbolicLink ? 'link' : 'file',
                size: file.size,
                modifiedTime: file.modifiedAt || new Date()
            };
        } catch {
            return null;
        }
    }
}
