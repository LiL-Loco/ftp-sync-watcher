import { FtpSyncConfig } from '../types';
import { RemoteClient } from './remoteClient';
import { FtpClient } from './ftpClient';
import { SftpClientWrapper } from './sftpClient';

export { RemoteClient, TransferResult, RemoteFileInfo } from './remoteClient';
export { FtpClient } from './ftpClient';
export { SftpClientWrapper } from './sftpClient';

/**
 * Factory function to create the appropriate client based on protocol
 */
export function createClient(config: FtpSyncConfig): RemoteClient {
    switch (config.protocol) {
        case 'ftp':
            return new FtpClient(config);
        case 'sftp':
            return new SftpClientWrapper(config);
        default:
            throw new Error(`Unsupported protocol: ${config.protocol}`);
    }
}
