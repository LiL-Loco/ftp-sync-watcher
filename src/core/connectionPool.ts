import { FtpSyncConfig } from '../types';
import { RemoteClient, createClient } from '../clients';
import { Logger } from '../utils';

/**
 * Connection health states
 */
export type ConnectionHealth = 'healthy' | 'degraded' | 'disconnected' | 'failed' | 'rate-limited';

/**
 * Global connection tracking to prevent exceeding server limits
 */
class GlobalConnectionManager {
    private static instance: GlobalConnectionManager;
    private activeConnections = 0;
    private maxGlobalConnections = 2; // Conservative limit to avoid server rejection
    private connectionQueue: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];
    private rateLimitedUntil = 0; // Timestamp when rate limiting expires
    private rateLimitDelay = 60000; // Wait 60 seconds after 530 error

    public static getInstance(): GlobalConnectionManager {
        if (!GlobalConnectionManager.instance) {
            GlobalConnectionManager.instance = new GlobalConnectionManager();
        }
        return GlobalConnectionManager.instance;
    }

    /**
     * Check if we hit a rate limit (530 error)
     */
    public setRateLimited(): void {
        this.rateLimitedUntil = Date.now() + this.rateLimitDelay;
        Logger.warn(`Rate limited by server. Waiting ${this.rateLimitDelay / 1000} seconds before retrying...`);
    }

    /**
     * Check if still rate limited
     */
    public isRateLimited(): boolean {
        return Date.now() < this.rateLimitedUntil;
    }

    /**
     * Get remaining rate limit time in ms
     */
    public getRateLimitRemaining(): number {
        return Math.max(0, this.rateLimitedUntil - Date.now());
    }

    /**
     * Request a connection slot
     */
    public async acquireSlot(): Promise<void> {
        // Wait if rate limited
        if (this.isRateLimited()) {
            const waitTime = this.getRateLimitRemaining();
            Logger.info(`Waiting ${Math.ceil(waitTime / 1000)}s due to server rate limit...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }

        if (this.activeConnections < this.maxGlobalConnections) {
            this.activeConnections++;
            Logger.debug(`Connection slot acquired (${this.activeConnections}/${this.maxGlobalConnections})`);
            return;
        }

        // Wait for a slot to become available
        Logger.debug(`Waiting for connection slot (${this.activeConnections}/${this.maxGlobalConnections})...`);
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const index = this.connectionQueue.findIndex(q => q.resolve === resolve);
                if (index !== -1) {
                    this.connectionQueue.splice(index, 1);
                }
                reject(new Error('Timeout waiting for connection slot'));
            }, 120000); // 2 minute timeout

            this.connectionQueue.push({
                resolve: () => {
                    clearTimeout(timeout);
                    this.activeConnections++;
                    Logger.debug(`Connection slot acquired from queue (${this.activeConnections}/${this.maxGlobalConnections})`);
                    resolve();
                },
                reject: (error: Error) => {
                    clearTimeout(timeout);
                    reject(error);
                }
            });
        });
    }

    /**
     * Release a connection slot
     */
    public releaseSlot(): void {
        this.activeConnections = Math.max(0, this.activeConnections - 1);
        Logger.debug(`Connection slot released (${this.activeConnections}/${this.maxGlobalConnections})`);

        // Process waiting connections
        if (this.connectionQueue.length > 0 && this.activeConnections < this.maxGlobalConnections) {
            const next = this.connectionQueue.shift();
            if (next) {
                next.resolve();
            }
        }
    }

    /**
     * Get current connection count
     */
    public getActiveCount(): number {
        return this.activeConnections;
    }

    /**
     * Reset all connections (for cleanup)
     */
    public reset(): void {
        this.activeConnections = 0;
        this.rateLimitedUntil = 0;
        this.connectionQueue.forEach(q => q.reject(new Error('Connection manager reset')));
        this.connectionQueue = [];
    }
}

// Export singleton accessor
export const globalConnectionManager = GlobalConnectionManager.getInstance();

/**
 * Manages connection pooling with automatic reconnection and health monitoring
 */
export class ConnectionPool {
    private config: FtpSyncConfig;
    private client: RemoteClient | null = null;
    private health: ConnectionHealth = 'disconnected';
    private reconnectAttempts = 0;
    private maxReconnectAttempts = 5;
    private reconnectDelay = 1000; // Start with 1 second
    private maxReconnectDelay = 30000; // Max 30 seconds
    private lastActivity = Date.now();
    private healthCheckInterval: NodeJS.Timeout | null = null;
    private operationTimeout = 30000; // 30 seconds per operation
    private keepAliveInterval = 60000; // 60 seconds
    private isReconnecting = false;
    private pendingOperations = 0;
    private hasSlot = false;
    
    // Mutex for serializing FTP operations (basic-ftp only supports one operation at a time)
    private operationMutex: Promise<void> = Promise.resolve();
    private operationQueue: Array<{
        resolve: () => void;
        reject: (error: Error) => void;
    }> = [];

    constructor(config: FtpSyncConfig) {
        this.config = config;
        this.operationTimeout = config.timeout || 30000;
    }

    /**
     * Acquire the operation mutex - ensures only one FTP operation runs at a time
     * basic-ftp throws "User launched a task while another one is still running" otherwise
     */
    private async acquireOperationLock(): Promise<() => void> {
        // Create a new promise that will be resolved when it's this operation's turn
        let releaseLock: () => void;
        
        const waitForTurn = new Promise<void>((resolve) => {
            releaseLock = resolve;
        });

        // Chain onto the existing mutex
        const previousMutex = this.operationMutex;
        this.operationMutex = previousMutex.then(() => waitForTurn);

        // Wait for previous operations to complete
        await previousMutex;

        // Return the release function
        return () => {
            releaseLock();
        };
    }

    /**
     * Get a healthy connection, reconnecting if necessary
     */
    public async getConnection(): Promise<RemoteClient> {
        // Check if client is actually connected (not just marked as healthy)
        if (this.client && this.health === 'healthy') {
            // Verify the client is actually still connected
            if (this.client.isConnected()) {
                this.lastActivity = Date.now();
                return this.client;
            } else {
                // Client reports disconnected, reset state
                Logger.debug('Client reports disconnected, reconnecting...');
                this.health = 'disconnected';
                this.client = null;
                if (this.hasSlot) {
                    globalConnectionManager.releaseSlot();
                    this.hasSlot = false;
                }
            }
        }

        // If currently reconnecting, wait for it
        if (this.isReconnecting) {
            return this.waitForReconnect();
        }

        // Need to connect or reconnect
        return this.connect();
    }

    /**
     * Connect to the server
     */
    private async connect(): Promise<RemoteClient> {
        this.isReconnecting = true;

        try {
            // Dispose old client if exists
            if (this.client) {
                try {
                    await this.client.disconnect();
                } catch {
                    // Ignore disconnect errors
                }
                this.client = null;
                // Release the slot if we had one
                if (this.hasSlot) {
                    globalConnectionManager.releaseSlot();
                    this.hasSlot = false;
                }
            }

            // Acquire a connection slot from global manager
            if (!this.hasSlot) {
                await globalConnectionManager.acquireSlot();
                this.hasSlot = true;
            }

            Logger.info(`Connecting to ${this.config.host}...`);
            
            // Create new client with timeout wrapper
            this.client = createClient(this.config);
            
            // Connect with timeout
            await this.withTimeout(
                this.client.connect(),
                this.operationTimeout,
                'Connection timeout'
            );

            this.health = 'healthy';
            this.reconnectAttempts = 0;
            this.reconnectDelay = 1000;
            this.lastActivity = Date.now();
            
            // Start health monitoring
            this.startHealthCheck();

            Logger.success(`Connected to ${this.config.host}`);
            return this.client;
        } catch (error) {
            const errorMessage = (error as Error).message;
            
            // Check for 530 max connections error
            if (errorMessage.includes('530') && errorMessage.toLowerCase().includes('maximum')) {
                this.health = 'rate-limited';
                globalConnectionManager.setRateLimited();
                // Release slot since we couldn't connect
                if (this.hasSlot) {
                    globalConnectionManager.releaseSlot();
                    this.hasSlot = false;
                }
            } else {
                this.health = 'failed';
            }
            
            this.client = null;
            
            Logger.error(`Connection failed: ${errorMessage}`);
            throw error;
        } finally {
            this.isReconnecting = false;
        }
    }

    /**
     * Wait for ongoing reconnection
     */
    private async waitForReconnect(): Promise<RemoteClient> {
        const maxWait = 60000; // 60 seconds max wait
        const checkInterval = 100;
        let waited = 0;

        while (this.isReconnecting && waited < maxWait) {
            await new Promise(resolve => setTimeout(resolve, checkInterval));
            waited += checkInterval;
        }

        if (this.client && this.health === 'healthy') {
            return this.client;
        }

        throw new Error('Reconnection failed');
    }

    /**
     * Attempt to reconnect with exponential backoff
     */
    public async reconnect(): Promise<RemoteClient> {
        // If rate limited, wait for the rate limit to expire first
        if (globalConnectionManager.isRateLimited()) {
            const waitTime = globalConnectionManager.getRateLimitRemaining();
            Logger.warn(`Server rate limited. Waiting ${Math.ceil(waitTime / 1000)}s before reconnecting...`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            // Reset reconnect attempts after rate limit wait
            this.reconnectAttempts = 0;
        }

        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            this.health = 'failed';
            throw new Error(`Max reconnection attempts (${this.maxReconnectAttempts}) reached`);
        }

        this.reconnectAttempts++;
        this.health = 'degraded';

        // Exponential backoff with longer delays for connection issues
        const delay = Math.min(
            this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1),
            this.maxReconnectDelay
        );

        Logger.warn(`Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
        
        await new Promise(resolve => setTimeout(resolve, delay));

        return this.connect();
    }

    /**
     * Execute an operation with automatic retry on failure
     * Operations are serialized using a mutex to prevent basic-ftp errors
     */
    public async executeWithRetry<T>(
        operation: (client: RemoteClient) => Promise<T>,
        operationName: string
    ): Promise<T> {
        const maxRetries = 3;
        let lastError: Error | null = null;

        // Acquire the operation lock - this ensures only one FTP operation runs at a time
        const releaseLock = await this.acquireOperationLock();

        try {
            for (let attempt = 1; attempt <= maxRetries; attempt++) {
                try {
                    this.pendingOperations++;
                    const client = await this.getConnection();
                    
                    // Execute with timeout
                    const result = await this.withTimeout(
                        operation(client),
                        this.operationTimeout,
                        `${operationName} timeout`
                    );

                    this.lastActivity = Date.now();
                    this.pendingOperations--;
                    return result;
                } catch (error) {
                    this.pendingOperations--;
                    lastError = error as Error;
                    
                    const isConnectionError = this.isConnectionError(error as Error);
                    const isRateLimit = this.isRateLimitError(error as Error);
                    
                    Logger.warn(`${operationName} failed (attempt ${attempt}/${maxRetries}): ${lastError.message}`);

                    // Rate limit error - special handling
                    if (isRateLimit) {
                        globalConnectionManager.setRateLimited();
                        this.health = 'rate-limited';
                        
                        if (attempt < maxRetries) {
                            // Wait for rate limit to expire then retry
                            const waitTime = globalConnectionManager.getRateLimitRemaining();
                            Logger.info(`Waiting ${Math.ceil(waitTime / 1000)}s due to server connection limit...`);
                            await new Promise(resolve => setTimeout(resolve, waitTime));
                            // Reset the connection for retry
                            if (this.client) {
                                try {
                                    await this.client.disconnect();
                                } catch {
                                    // Ignore
                                }
                                this.client = null;
                                if (this.hasSlot) {
                                    globalConnectionManager.releaseSlot();
                                    this.hasSlot = false;
                                }
                            }
                            this.health = 'disconnected';
                        }
                    } else if (isConnectionError && attempt < maxRetries) {
                        // Connection error - try to reconnect
                        this.health = 'degraded';
                        try {
                            await this.reconnect();
                        } catch (reconnectError) {
                            Logger.error(`Reconnection failed: ${(reconnectError as Error).message}`);
                        }
                    } else if (!isConnectionError) {
                        // Non-connection error - don't retry
                        throw error;
                    }
                }
            }

            throw lastError || new Error(`${operationName} failed after ${maxRetries} attempts`);
        } finally {
            // Always release the lock
            releaseLock();
        }
    }

    /**
     * Check if an error is connection-related
     */
    private isConnectionError(error: Error): boolean {
        const connectionErrors = [
            'ECONNRESET',
            'ECONNREFUSED',
            'ETIMEDOUT',
            'ENOTFOUND',
            'ENETUNREACH',
            'EHOSTUNREACH',
            'EPIPE',
            'connection',
            'timeout',
            'socket',
            'closed',
            'ended',
            'disconnected',
            '530', // Max connections error
            'user closed', // User closed client error
            'transfer strategies', // Transfer strategies error
            'client is closed' // Client is closed error
        ];

        const message = error.message.toLowerCase();
        return connectionErrors.some(e => message.includes(e.toLowerCase()));
    }

    /**
     * Check if error is a rate limit / max connections error
     */
    private isRateLimitError(error: Error): boolean {
        const message = error.message.toLowerCase();
        return message.includes('530') && message.includes('maximum');
    }

    /**
     * Wrap a promise with timeout
     */
    private async withTimeout<T>(
        promise: Promise<T>,
        ms: number,
        errorMessage: string
    ): Promise<T> {
        let timeoutId: NodeJS.Timeout;

        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(errorMessage));
            }, ms);
        });

        try {
            const result = await Promise.race([promise, timeoutPromise]);
            clearTimeout(timeoutId!);
            return result;
        } catch (error) {
            clearTimeout(timeoutId!);
            throw error;
        }
    }

    /**
     * Start periodic health checks
     */
    private startHealthCheck(): void {
        this.stopHealthCheck();

        this.healthCheckInterval = setInterval(async () => {
            // Skip if operations are pending
            if (this.pendingOperations > 0) {
                return;
            }

            const idleTime = Date.now() - this.lastActivity;

            // If idle for too long, check connection health
            if (idleTime > this.keepAliveInterval) {
                try {
                    if (this.client && this.client.isConnected()) {
                        // Try a simple operation to check connection
                        await this.withTimeout(
                            this.client.exists(this.config.remotePath),
                            5000,
                            'Health check timeout'
                        );
                        this.lastActivity = Date.now();
                        Logger.debug('Health check passed');
                    } else {
                        this.health = 'disconnected';
                        Logger.debug('Connection lost, will reconnect on next operation');
                    }
                } catch (error) {
                    Logger.debug(`Health check failed: ${(error as Error).message}`);
                    this.health = 'degraded';
                }
            }
        }, this.keepAliveInterval / 2);
    }

    /**
     * Stop health checks
     */
    private stopHealthCheck(): void {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
    }

    /**
     * Get current health status
     */
    public getHealth(): ConnectionHealth {
        return this.health;
    }

    /**
     * Check if connected
     */
    public isConnected(): boolean {
        return this.client !== null && this.health === 'healthy';
    }

    /**
     * Dispose the connection pool
     */
    public async dispose(): Promise<void> {
        this.stopHealthCheck();

        if (this.client) {
            try {
                await this.client.disconnect();
            } catch {
                // Ignore
            }
            this.client = null;
        }

        // Release connection slot
        if (this.hasSlot) {
            globalConnectionManager.releaseSlot();
            this.hasSlot = false;
        }

        this.health = 'disconnected';
    }

    /**
     * Force reconnection
     */
    public async forceReconnect(): Promise<void> {
        this.reconnectAttempts = 0;
        this.health = 'disconnected';
        await this.connect();
    }
}
