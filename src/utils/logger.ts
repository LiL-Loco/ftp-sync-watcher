import * as vscode from 'vscode';

/**
 * Logger utility for the extension
 */
export class Logger {
    private static outputChannel: vscode.OutputChannel | undefined;
    private static debugMode = false;

    public static init(context: vscode.ExtensionContext): void {
        this.outputChannel = vscode.window.createOutputChannel('FTP Sync');
        context.subscriptions.push(this.outputChannel);
    }

    public static setDebugMode(enabled: boolean): void {
        this.debugMode = enabled;
    }

    public static show(): void {
        this.outputChannel?.show();
    }

    public static info(message: string): void {
        this.log('INFO', message);
    }

    public static warn(message: string): void {
        this.log('WARN', message);
    }

    public static error(message: string, error?: Error): void {
        this.log('ERROR', message);
        if (error) {
            this.log('ERROR', error.stack || error.message);
        }
    }

    public static debug(message: string): void {
        if (this.debugMode) {
            this.log('DEBUG', message);
        }
    }

    public static success(message: string): void {
        this.log('SUCCESS', message);
    }

    private static log(level: string, message: string): void {
        const timestamp = new Date().toISOString();
        const formattedMessage = `[${timestamp}] [${level}] ${message}`;
        this.outputChannel?.appendLine(formattedMessage);
        
        if (level === 'ERROR') {
            console.error(formattedMessage);
        }
    }
}
