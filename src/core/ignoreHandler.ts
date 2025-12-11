import * as fs from 'fs';
import * as path from 'path';
import ignore, { Ignore } from 'ignore';
import { Logger, normalizePath } from '../utils';

/**
 * Handles file ignore logic including .gitignore and custom patterns
 */
export class IgnoreHandler {
    private ignoreInstance: Ignore;
    private customPatterns: string[];
    private useGitIgnore: boolean;
    private workspacePath: string;
    private initialized = false;

    constructor(workspacePath: string, customPatterns: string[] = [], useGitIgnore = true) {
        this.workspacePath = workspacePath;
        this.customPatterns = customPatterns;
        this.useGitIgnore = useGitIgnore;
        this.ignoreInstance = ignore();
    }

    /**
     * Initialize the ignore handler by loading all ignore patterns
     */
    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        // Add custom patterns
        if (this.customPatterns.length > 0) {
            this.ignoreInstance.add(this.customPatterns);
            Logger.debug(`Added ${this.customPatterns.length} custom ignore patterns`);
        }

        // Load .gitignore if enabled
        if (this.useGitIgnore) {
            await this.loadGitIgnore();
        }

        this.initialized = true;
    }

    /**
     * Load .gitignore file from workspace
     */
    private async loadGitIgnore(): Promise<void> {
        const gitIgnorePath = path.join(this.workspacePath, '.gitignore');
        
        try {
            if (fs.existsSync(gitIgnorePath)) {
                const content = fs.readFileSync(gitIgnorePath, 'utf-8');
                const lines = content.split('\n')
                    .map(line => line.trim())
                    .filter(line => line && !line.startsWith('#'));
                
                if (lines.length > 0) {
                    this.ignoreInstance.add(lines);
                    Logger.debug(`Loaded ${lines.length} patterns from .gitignore`);
                }
            }
        } catch (error) {
            Logger.warn(`Failed to load .gitignore: ${(error as Error).message}`);
        }
    }

    /**
     * Reload all ignore patterns
     */
    public async reload(): Promise<void> {
        this.ignoreInstance = ignore();
        this.initialized = false;
        await this.initialize();
    }

    /**
     * Check if a path should be ignored
     * @param relativePath Path relative to workspace root
     */
    public isIgnored(relativePath: string): boolean {
        if (!this.initialized) {
            Logger.warn('IgnoreHandler not initialized, initializing now');
            // Synchronous fallback - just use custom patterns
            this.ignoreInstance.add(this.customPatterns);
            this.initialized = true;
        }

        const normalized = normalizePath(relativePath);
        
        // Never ignore empty paths
        if (!normalized) {
            return false;
        }

        try {
            return this.ignoreInstance.ignores(normalized);
        } catch (error) {
            Logger.debug(`Error checking ignore status for ${normalized}: ${(error as Error).message}`);
            return false;
        }
    }

    /**
     * Filter an array of paths, returning only non-ignored paths
     * @param relativePaths Array of paths relative to workspace root
     */
    public filter(relativePaths: string[]): string[] {
        return relativePaths.filter(p => !this.isIgnored(p));
    }

    /**
     * Add additional patterns at runtime
     */
    public addPatterns(patterns: string[]): void {
        if (patterns.length > 0) {
            this.ignoreInstance.add(patterns);
            Logger.debug(`Added ${patterns.length} additional ignore patterns`);
        }
    }

    /**
     * Get all current patterns
     */
    public getPatterns(): string[] {
        return this.customPatterns;
    }
}
