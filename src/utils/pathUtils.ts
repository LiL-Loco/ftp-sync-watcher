import * as path from 'path';
import * as vscode from 'vscode';

/**
 * Normalize path separators to forward slashes
 */
export function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}

/**
 * Join paths and normalize
 */
export function joinPath(...parts: string[]): string {
    return normalizePath(path.join(...parts));
}

/**
 * Get relative path from base to target
 */
export function getRelativePath(basePath: string, targetPath: string): string {
    const relative = path.relative(basePath, targetPath);
    return normalizePath(relative);
}

/**
 * Ensure path ends with separator
 */
export function ensureTrailingSlash(dirPath: string): string {
    const normalized = normalizePath(dirPath);
    return normalized.endsWith('/') ? normalized : normalized + '/';
}

/**
 * Remove leading slash from path
 */
export function removeLeadingSlash(filePath: string): string {
    return filePath.replace(/^\/+/, '');
}

/**
 * Get the workspace folder for a given URI
 */
export function getWorkspaceFolder(uri: vscode.Uri): vscode.WorkspaceFolder | undefined {
    return vscode.workspace.getWorkspaceFolder(uri);
}

/**
 * Get all workspace folders
 */
export function getWorkspaceFolders(): readonly vscode.WorkspaceFolder[] {
    return vscode.workspace.workspaceFolders || [];
}

/**
 * Convert local path to remote path
 */
export function localToRemotePath(
    localPath: string,
    localBase: string,
    remoteBase: string
): string {
    const relativePath = getRelativePath(localBase, localPath);
    return joinPath(remoteBase, relativePath);
}

/**
 * Convert remote path to local path
 */
export function remoteToLocalPath(
    remotePath: string,
    remoteBase: string,
    localBase: string
): string {
    const normalized = normalizePath(remotePath);
    const normalizedBase = normalizePath(remoteBase);
    const relativePath = normalized.startsWith(normalizedBase)
        ? normalized.slice(normalizedBase.length)
        : normalized;
    return path.join(localBase, removeLeadingSlash(relativePath));
}

/**
 * Get parent directory of a path
 */
export function getParentDir(filePath: string): string {
    return normalizePath(path.dirname(filePath));
}

/**
 * Get filename from path
 */
export function getFilename(filePath: string): string {
    return path.basename(filePath);
}

/**
 * Check if path is absolute
 */
export function isAbsolutePath(filePath: string): boolean {
    return path.isAbsolute(filePath);
}
