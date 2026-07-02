/**
 * TombstoneStore - persistente Marker fuer lokal geloeschte Dateien in
 * remoteToLocal-Profilen (ADR-0002).
 *
 * Hintergrund: Wenn ein Profil mit direction: 'remoteToLocal' konfiguriert
 * ist, pollt der Watcher das Remote-Verzeichnis und laedt neue Dateien
 * herunter. Wird eine Datei lokal geloescht, wuerde der naechste Poll die
 * Remote-Datei zurueckbringen. Tombstones verhindern das, indem sie den
 * Pfad fuer eine begrenzte Zeit (TOMBSTONE_TTL_MS, default 7 Tage) als
 * "vom User bewusst geloescht" markieren.
 *
 * Storage: vscode.ExtensionContext.globalState (Workspace-lokal, ueberlebt
 * Editor-Restarts, wird beim Workspace-Wechsel mitgenommen).
 *
 * Schluessel-Schema:
 *   tombstones.${workspaceFolder}.${profileName}
 * Wert: { [path: string]: { expiresAt: number } }
 *
 * Der TombstoneStore ist eine pure Klasse, die ein GlobalStateLike-
 * Interface akzeptiert — dadurch in Unit-Tests ohne vscode-Mock einsetzbar.
 */

import { TOMBSTONE_TTL_MS } from '../types';

export interface GlobalStateLike {
    get<T>(key: string): T | undefined;
    update(key: string, value: unknown): Thenable<void>;
}

export interface TombstoneEntry {
    expiresAt: number;
}

/**
 * Liefert den globalState-Schluessel fuer ein Tombstone-Set.
 * Exportiert, damit Tests das gleiche Schema verifizieren koennen.
 */
export function buildTombstoneKey(workspaceFolder: string, profileName: string): string {
    return `tombstones.${workspaceFolder}.${profileName}`;
}

export class TombstoneStore {
    private globalState: GlobalStateLike;
    private workspaceFolder: string;
    private profileName: string;
    private ttlMs: number;
    private now: () => number;

    constructor(
        globalState: GlobalStateLike,
        workspaceFolder: string,
        profileName: string,
        options: { ttlMs?: number; now?: () => number } = {}
    ) {
        this.globalState = globalState;
        this.workspaceFolder = workspaceFolder;
        this.profileName = profileName;
        this.ttlMs = options.ttlMs ?? TOMBSTONE_TTL_MS;
        // now() ist austauschbar, damit Tests mit fakeTimers arbeiten koennen.
        this.now = options.now ?? (() => Date.now());
    }

    private key(): string {
        return buildTombstoneKey(this.workspaceFolder, this.profileName);
    }

    private readAll(): Record<string, TombstoneEntry> {
        const value = this.globalState.get<Record<string, TombstoneEntry>>(this.key());
        return value ?? {};
    }

    private async writeAll(value: Record<string, TombstoneEntry>): Promise<void> {
        await this.globalState.update(this.key(), value);
    }

    /**
     * Markiert einen Pfad als geloescht. Nach Ablauf der TTL verfaellt der
     * Eintrag automatisch (beim naechsten has()-Aufruf oder prune()).
     */
    public async add(path: string): Promise<void> {
        const all = this.readAll();
        all[path] = { expiresAt: this.now() + this.ttlMs };
        await this.writeAll(all);
    }

    /**
     * Liefert true, wenn der Pfad noch innerhalb seiner TTL liegt.
     * Abgelaufene Eintraege werden NICHT entfernt — das macht prune().
     * Sie werden aber bei has() als "nicht vorhanden" gewertet, damit
     * ein "logisch abgelaufener" Tombstone den Download nicht mehr
     * blockiert.
     */
    public has(path: string): boolean {
        const all = this.readAll();
        const entry = all[path];
        if (!entry) {
            return false;
        }
        return entry.expiresAt > this.now();
    }

    /**
     * Entfernt einen Tombstone explizit (z.B. wenn die Datei durch eine
     * remoteToLocal-Operation neu zurueckkommt). Idempotent: ein Aufruf
     * auf einen nicht-existenten Tombstone ist ein No-Op.
     */
    public async remove(path: string): Promise<void> {
        const all = this.readAll();
        if (!(path in all)) {
            return;
        }
        delete all[path];
        await this.writeAll(all);
    }

    /**
     * Entfernt abgelaufene Tombstones. Sollte einmal pro Session
     * aufgerufen werden (z.B. beim Initialize des FileWatchers), damit
     * globalState nicht mit veralteten Eintraegen volllaeuft.
     */
    public async prune(): Promise<void> {
        const all = this.readAll();
        const cutoff = this.now();
        let changed = false;
        for (const [path, entry] of Object.entries(all)) {
            if (entry.expiresAt <= cutoff) {
                delete all[path];
                changed = true;
            }
        }
        if (changed) {
            await this.writeAll(all);
        }
    }

    /**
     * Liefert die Anzahl aktiver (nicht abgelaufener) Tombstones. Fuer
     // Debug-Output und Status-Bar-Anzeige nuetzlich.
     */
    public size(): number {
        const all = this.readAll();
        const cutoff = this.now();
        let count = 0;
        for (const entry of Object.values(all)) {
            if (entry.expiresAt > cutoff) {
                count++;
            }
        }
        return count;
    }
}
