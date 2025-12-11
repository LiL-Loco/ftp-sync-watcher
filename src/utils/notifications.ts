import * as vscode from 'vscode';

/**
 * Default timeout for auto-dismissing notifications (in milliseconds)
 */
const DEFAULT_TIMEOUT = 3000;

/**
 * Show an information message that auto-dismisses after a timeout
 * @param message The message to show
 * @param timeout Time in ms before auto-dismiss (default: 3000)
 */
export function showInfoMessage(message: string, timeout = DEFAULT_TIMEOUT): void {
    showTemporaryMessage(message, 'info', timeout);
}

/**
 * Show a success message that auto-dismisses after a timeout
 * @param message The message to show
 * @param timeout Time in ms before auto-dismiss (default: 3000)
 */
export function showSuccessMessage(message: string, timeout = DEFAULT_TIMEOUT): void {
    showTemporaryMessage(`✓ ${message}`, 'info', timeout);
}

/**
 * Show a warning message that auto-dismisses after a timeout
 * @param message The message to show
 * @param timeout Time in ms before auto-dismiss (default: 5000)
 */
export function showWarningMessage(message: string, timeout = 5000): void {
    showTemporaryMessage(message, 'warning', timeout);
}

/**
 * Show an error message - these stay visible until dismissed (errors are important!)
 * @param message The message to show
 */
export function showErrorMessage(message: string): void {
    vscode.window.showErrorMessage(message);
}

/**
 * Internal function to show a temporary message using withProgress
 * This is a workaround since VS Code doesn't support auto-dismissing notifications natively
 */
function showTemporaryMessage(
    message: string,
    type: 'info' | 'warning',
    timeout: number
): void {
    vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: message,
            cancellable: false
        },
        async (progress) => {
            // Show for the specified duration
            await new Promise<void>((resolve) => {
                setTimeout(() => {
                    resolve();
                }, timeout);
            });
        }
    );
}

/**
 * Show a message in the status bar (always auto-dismisses)
 * Good for quick, non-intrusive feedback
 * @param message The message to show
 * @param timeout Time in ms before auto-dismiss (default: 3000)
 */
export function showStatusBarMessage(message: string, timeout = DEFAULT_TIMEOUT): vscode.Disposable {
    return vscode.window.setStatusBarMessage(message, timeout);
}
