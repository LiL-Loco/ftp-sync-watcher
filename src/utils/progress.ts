import * as vscode from 'vscode';

/**
 * Options for progress operations
 */
export interface ProgressOptions {
    title: string;
    cancellable?: boolean;
}

/**
 * Run an operation with a progress indicator
 * @param options Progress options (title, cancellable)
 * @param operation The async operation to run
 * @returns The result of the operation
 */
export async function withProgress<T>(
    options: ProgressOptions,
    operation: (
        progress: vscode.Progress<{ message?: string; increment?: number }>,
        token: vscode.CancellationToken
    ) => Promise<T>
): Promise<T> {
    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: options.title,
            cancellable: options.cancellable ?? false
        },
        operation
    );
}

/**
 * Run a file transfer operation with progress
 * Shows progress for single file transfers
 */
export async function withFileProgress<T>(
    title: string,
    operation: () => Promise<T>
): Promise<T> {
    return withProgress({ title }, async (progress) => {
        progress.report({ message: 'Transferring...' });
        const result = await operation();
        progress.report({ message: 'Complete!', increment: 100 });
        return result;
    });
}

/**
 * Run a folder transfer operation with progress
 * Shows progress for multiple files
 */
export async function withFolderProgress<T>(
    title: string,
    totalFiles: number,
    operation: (reportProgress: (current: number, fileName: string) => void) => Promise<T>
): Promise<T> {
    return withProgress({ title, cancellable: true }, async (progress, token) => {
        let lastPercent = 0;
        
        const reportProgress = (current: number, fileName: string) => {
            if (token.isCancellationRequested) {
                throw new Error('Operation cancelled by user');
            }
            
            const percent = Math.round((current / totalFiles) * 100);
            const increment = percent - lastPercent;
            lastPercent = percent;
            
            progress.report({
                message: `${current}/${totalFiles} - ${fileName}`,
                increment
            });
        };
        
        return operation(reportProgress);
    });
}

/**
 * Simple indeterminate progress for operations without known total
 */
export async function withIndeterminateProgress<T>(
    title: string,
    operation: (updateMessage: (message: string) => void) => Promise<T>
): Promise<T> {
    return withProgress({ title }, async (progress) => {
        const updateMessage = (message: string) => {
            progress.report({ message });
        };
        return operation(updateMessage);
    });
}
