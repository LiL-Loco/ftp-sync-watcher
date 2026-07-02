/**
 * VS-Code-spezifische Path-Wrapper — bewusst aus pathUtils.ts ausgelagert,
 * damit pathUtils.ts keine vscode-Imports enthaelt und in Unit-Tests ohne
 * Mock geladen werden kann.
 *
 * Diese Datei darf einzige Anlaufstelle fuer vscode-Objekte im Bereich
 * Pfad-Behandlung sein.
 */

import * as vscode from 'vscode';

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
