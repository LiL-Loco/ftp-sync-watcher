import * as vscode from 'vscode';

export type StatusState = 'idle' | 'watching' | 'syncing' | 'error' | 'unconfigured';

/**
 * Status bar integration for FTP Sync
 */
export class StatusBar {
    private statusBarItem: vscode.StatusBarItem;
    private currentState: StatusState = 'unconfigured';
    private syncCount = 0;
    private profileCount = 0;

    constructor() {
        // Create status bar item with ID for better tracking
        this.statusBarItem = vscode.window.createStatusBarItem(
            'ftpSync.statusBar',
            vscode.StatusBarAlignment.Left,
            100
        );
        this.statusBarItem.name = 'FTP Sync Status';
        this.statusBarItem.command = 'ftpSync.toggleWatcher';
        this.updateDisplay();
        // Show immediately
        this.statusBarItem.show();
    }

    /**
     * Show the status bar item
     */
    public show(): void {
        this.statusBarItem.show();
    }

    /**
     * Hide the status bar item
     */
    public hide(): void {
        this.statusBarItem.hide();
    }

    /**
     * Dispose the status bar item
     */
    public dispose(): void {
        this.statusBarItem.dispose();
    }

    /**
     * Set the current state
     */
    public setState(state: StatusState): void {
        this.currentState = state;
        this.updateDisplay();
    }

    /**
     * Setzt die Anzahl der aktuell aktiven Profile. Wird im Watching- und
     * Syncing-Zustand als Suffix angezeigt, sobald mehr als ein Profil
     * konfiguriert ist (z.B. "Watching (3 profiles)"). Bei 0 oder 1 Profil
     * bleibt die Anzeige unveraendert, damit Single-Profile-Setups nicht
     * mit ueberfluessiger Information befuellt werden.
     */
    public setProfileCount(count: number): void {
        this.profileCount = Math.max(0, count | 0);
        this.updateDisplay();
    }

    /**
     * Get current state
     */
    public getState(): StatusState {
        return this.currentState;
    }

    /**
     * Show syncing state temporarily
     */
    public showSyncing(): void {
        this.syncCount++;
        this.setState('syncing');
    }

    /**
     * End syncing state
     */
    public endSyncing(): void {
        this.syncCount = Math.max(0, this.syncCount - 1);
        if (this.syncCount === 0) {
            this.setState('watching');
        }
    }

    /**
     * Update the display based on current state
     */
    private updateDisplay(): void {
        switch (this.currentState) {
            case 'unconfigured':
                this.statusBarItem.text = '$(cloud) FTP Sync: Setup';
                this.statusBarItem.tooltip = 'Click to create configuration file';
                this.statusBarItem.backgroundColor = undefined;
                break;
            case 'idle':
                this.statusBarItem.text = '$(cloud) FTP Sync';
                this.statusBarItem.tooltip = 'Click to start file watcher';
                this.statusBarItem.backgroundColor = undefined;
                break;
            case 'watching':
                this.statusBarItem.text = this.profileCount > 1
                    ? `$(eye) FTP Sync: Watching (${this.profileCount} profiles)`
                    : '$(eye) FTP Sync: Watching';
                this.statusBarItem.tooltip = this.profileCount > 1
                    ? `${this.profileCount} profiles active - Click to stop`
                    : 'File watcher active - Click to stop';
                this.statusBarItem.backgroundColor = undefined;
                break;
            case 'syncing':
                this.statusBarItem.text = this.profileCount > 1
                    ? `$(sync~spin) FTP Sync: Syncing (${this.profileCount} profiles)...`
                    : '$(sync~spin) FTP Sync: Syncing...';
                this.statusBarItem.tooltip = this.profileCount > 1
                    ? `Syncing ${this.profileCount} profiles...`
                    : 'Uploading files...';
                this.statusBarItem.backgroundColor = undefined;
                break;
            case 'error':
                this.statusBarItem.text = '$(error) FTP Sync: Error';
                this.statusBarItem.tooltip = 'Error occurred - Check output for details';
                this.statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
                break;
        }
    }

    /**
     * Show a temporary message
     */
    public showMessage(message: string, duration = 3000): void {
        this.statusBarItem.text = `$(cloud) ${message}`;
        
        setTimeout(() => {
            this.updateDisplay();
        }, duration);
    }
}
