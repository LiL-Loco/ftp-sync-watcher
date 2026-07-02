/**
 * SecretManager - schmales Wrapper-Modul um vscode.SecretStorage.
 *
 * Seit v2.0.0 werden Passwoerter bevorzugt im verschluesselten
 * SecretStorage der VS-Code-Instanz abgelegt, statt im Klartext in
 * .ftpsync.json. Der Manager kapselt das Schluessel-Schema und ermoeglicht
 * Unit-Tests gegen einen Mock, ohne vscode importieren zu muessen.
 *
 * Schluessel-Schema (deterministisch, flach):
 *   ftpSync.${workspaceFolder}.${profileName}.${kind}
 *   kind in { password, passphrase }
 *
 * Beispiel: ftpSync.D:/work/myrepo.production.password
 *
 * Hinweis: workspaceFolder-Pfade koennen Doppelpunkte oder Leerzeichen
 * enthalten. Das Schema ist eine flache Zeichenkette ohne Trennzeichen-
 * Konflikte, weil profileName (vom User gewaehlt) Doppelpunkte verbieten
 * sollte — das JSON-Schema erzwingt das bisher nicht, aber SecretStorage
 * ist intern eine Map, daher sind Kollisionen nur dann ein Problem, wenn
 * zwei Profile in zwei Workspaces denselben Namen haben UND die
 * Workspace-Pfade durch Profil-Namen-Disambiguierung kollidieren. Das
 * schliessen wir aus, weil die Profil-Map pro Workspace getrennt ist und
 * der Lookup ueber (workspaceFolder, profileName) immer eindeutig ist.
 */

import type { SecretStorage } from 'vscode';

export type SecretKind = 'password' | 'passphrase';

export interface SecretStorageLike {
    get(key: string): Promise<string | undefined>;
    store(key: string, value: string): Promise<void>;
    delete(key: string): Promise<void>;
}

/**
 * Liefert den SecretStorage-Schluessel fuer ein bestimmtes Profil + Geheimnis.
 * Exportiert, damit Tests (und Migrations-Skripte) das gleiche Schema
 * verwenden koennen.
 */
export function buildSecretKey(
    workspaceFolder: string,
    profileName: string,
    kind: SecretKind
): string {
    return `ftpSync.${workspaceFolder}.${profileName}.${kind}`;
}

/**
 * SecretManager kapselt die Interaktion mit vscode.SecretStorage. Er
 * akzeptiert jede Implementierung von SecretStorageLike, damit er in Unit-
 * Tests ohne vscode-Mock einsetzbar ist.
 */
export class SecretManager {
    private storage: SecretStorageLike;

    constructor(storage: SecretStorageLike) {
        this.storage = storage;
    }

    /**
     * Erstellt einen SecretManager direkt aus einer vscode.ExtensionContext.
     */
    static fromContext(context: { secrets: SecretStorage }): SecretManager {
        return new SecretManager({
            get: async (key) => await context.secrets.get(key),
            store: async (key, value) => { await context.secrets.store(key, value); },
            delete: async (key) => { await context.secrets.delete(key); }
        });
    }

    public async getSecret(
        workspaceFolder: string,
        profileName: string,
        kind: SecretKind
    ): Promise<string | undefined> {
        const key = buildSecretKey(workspaceFolder, profileName, kind);
        return this.storage.get(key);
    }

    public async setSecret(
        workspaceFolder: string,
        profileName: string,
        kind: SecretKind,
        value: string
    ): Promise<void> {
        const key = buildSecretKey(workspaceFolder, profileName, kind);
        await this.storage.store(key, value);
    }

    public async deleteSecret(
        workspaceFolder: string,
        profileName: string,
        kind: SecretKind
    ): Promise<void> {
        const key = buildSecretKey(workspaceFolder, profileName, kind);
        await this.storage.delete(key);
    }

    /**
     * Loescht alle Secrets eines Profils (Passwort + Passphrase). Wird vom
     * ftpSync.clearCredentials-Kommando benutzt.
     */
    public async clearProfileSecrets(
        workspaceFolder: string,
        profileName: string
    ): Promise<void> {
        await this.deleteSecret(workspaceFolder, profileName, 'password');
        await this.deleteSecret(workspaceFolder, profileName, 'passphrase');
    }
}
