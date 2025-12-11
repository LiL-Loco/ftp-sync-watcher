import { EventEmitter } from 'events';
import { Logger } from '../utils';

export interface QueuedOperation<T = unknown> {
    id: string;
    operation: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    priority: number;
    addedAt: number;
    timeout: number;
    retries: number;
    maxRetries: number;
}

export type QueueStatus = 'idle' | 'processing' | 'paused' | 'error';

/**
 * Operation queue with prioritization and timeout handling
 * Prevents operations from hanging indefinitely
 * Uses sequential processing by default to avoid connection overload
 */
export class OperationQueue extends EventEmitter {
    private queue: QueuedOperation[] = [];
    private processing = false;
    private status: QueueStatus = 'idle';
    private concurrency = 1; // Default to 1 for sequential processing
    private activeOperations = 0;
    private operationCounter = 0;
    private isPaused = false;
    private defaultTimeout = 30000;
    private maxQueueSize = 100;
    private operationDelay = 100; // Small delay between operations to prevent flooding

    constructor(concurrency = 1, defaultTimeout = 30000) {
        super();
        // Limit concurrency to 1 to prevent connection issues
        this.concurrency = Math.min(concurrency, 1);
        this.defaultTimeout = defaultTimeout;
    }

    /**
     * Add an operation to the queue
     */
    public enqueue<T>(
        operation: () => Promise<T>,
        options: {
            priority?: number;
            timeout?: number;
            maxRetries?: number;
        } = {}
    ): Promise<T> {
        return new Promise((resolve, reject) => {
            // Check queue size limit
            if (this.queue.length >= this.maxQueueSize) {
                reject(new Error('Operation queue is full'));
                return;
            }

            const queuedOp: QueuedOperation<T> = {
                id: `op_${++this.operationCounter}_${Date.now()}`,
                operation,
                resolve: resolve as (value: unknown) => void,
                reject,
                priority: options.priority ?? 0,
                addedAt: Date.now(),
                timeout: options.timeout ?? this.defaultTimeout,
                retries: 0,
                maxRetries: options.maxRetries ?? 3
            };

            // Insert based on priority (higher priority first)
            const insertIndex = this.queue.findIndex(op => op.priority < queuedOp.priority);
            if (insertIndex === -1) {
                this.queue.push(queuedOp as QueuedOperation);
            } else {
                this.queue.splice(insertIndex, 0, queuedOp as QueuedOperation);
            }

            Logger.debug(`Queued operation ${queuedOp.id} (priority: ${queuedOp.priority}, queue size: ${this.queue.length})`);

            // Start processing if not already
            this.processQueue();
        });
    }

    /**
     * Process the queue
     */
    private async processQueue(): Promise<void> {
        if (this.isPaused || this.processing) {
            return;
        }

        this.processing = true;
        this.status = 'processing';

        while (this.queue.length > 0 && !this.isPaused) {
            // Wait if at max concurrency
            if (this.activeOperations >= this.concurrency) {
                await new Promise(resolve => setTimeout(resolve, 50));
                continue;
            }

            const operation = this.queue.shift();
            if (!operation) {
                break;
            }

            // Check if operation has been waiting too long
            const waitTime = Date.now() - operation.addedAt;
            if (waitTime > operation.timeout * 2) {
                Logger.warn(`Operation ${operation.id} expired after waiting ${waitTime}ms`);
                operation.reject(new Error('Operation expired in queue'));
                continue;
            }

            this.executeOperation(operation);
        }

        this.processing = false;
        this.status = this.queue.length > 0 ? 'processing' : 'idle';
    }

    /**
     * Execute a single operation with timeout
     */
    private async executeOperation(op: QueuedOperation): Promise<void> {
        this.activeOperations++;

        try {
            const result = await this.withTimeout(
                op.operation(),
                op.timeout,
                `Operation ${op.id} timed out after ${op.timeout}ms`
            );

            op.resolve(result);
            Logger.debug(`Operation ${op.id} completed successfully`);
        } catch (error) {
            const err = error as Error;

            // Check if we should retry
            if (op.retries < op.maxRetries && this.isRetryableError(err)) {
                op.retries++;
                Logger.warn(`Operation ${op.id} failed, retrying (${op.retries}/${op.maxRetries}): ${err.message}`);
                
                // Re-add to queue with slight delay
                setTimeout(() => {
                    this.queue.unshift(op);
                    this.processQueue();
                }, 1000 * op.retries); // Exponential backoff
            } else {
                Logger.error(`Operation ${op.id} failed permanently: ${err.message}`);
                op.reject(err);
            }
        } finally {
            this.activeOperations--;
            
            // Continue processing
            if (this.queue.length > 0 && !this.isPaused) {
                this.processQueue();
            }
        }
    }

    /**
     * Check if error is retryable
     */
    private isRetryableError(error: Error): boolean {
        const retryablePatterns = [
            'timeout',
            'ECONNRESET',
            'ETIMEDOUT',
            'socket',
            'connection'
        ];

        const message = error.message.toLowerCase();
        return retryablePatterns.some(p => message.includes(p.toLowerCase()));
    }

    /**
     * Wrap promise with timeout
     */
    private withTimeout<T>(promise: Promise<T>, ms: number, errorMessage: string): Promise<T> {
        let timeoutId: NodeJS.Timeout;

        const timeoutPromise = new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
                reject(new Error(errorMessage));
            }, ms);
        });

        return Promise.race([promise, timeoutPromise]).finally(() => {
            clearTimeout(timeoutId);
        });
    }

    /**
     * Pause queue processing
     */
    public pause(): void {
        this.isPaused = true;
        this.status = 'paused';
        Logger.info('Operation queue paused');
    }

    /**
     * Resume queue processing
     */
    public resume(): void {
        this.isPaused = false;
        Logger.info('Operation queue resumed');
        this.processQueue();
    }

    /**
     * Clear all pending operations
     */
    public clear(): void {
        const count = this.queue.length;
        
        // Reject all pending operations
        for (const op of this.queue) {
            op.reject(new Error('Queue cleared'));
        }
        
        this.queue = [];
        Logger.info(`Cleared ${count} pending operations`);
    }

    /**
     * Get queue status
     */
    public getStatus(): {
        status: QueueStatus;
        pending: number;
        active: number;
    } {
        return {
            status: this.status,
            pending: this.queue.length,
            active: this.activeOperations
        };
    }

    /**
     * Get queue length
     */
    public get length(): number {
        return this.queue.length;
    }

    /**
     * Check if queue is empty
     */
    public get isEmpty(): boolean {
        return this.queue.length === 0 && this.activeOperations === 0;
    }
}
