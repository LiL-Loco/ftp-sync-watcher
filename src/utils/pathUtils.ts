/**
 * Pure path operations extracted to enable unit testing without a vscode mock.
 * All path-manipulation primitives live here.
 */

import * as path from 'path';

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
 * Convert remote path to local path WITHOUT security check.
 *
 * Diese Funktion ist ein einfacher Path-Joiner ohne Sicherheits-Pruefung.
 * Fuer sicherheitskritische Stellen (z.B. Downloads vom Explorer) muss
 * resolveSafeLocalPath verwendet werden, das einen Boundary-Check macht.
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
 * Loest einen Remote-Pfad zu einem absoluten lokalen Pfad auf und prueft,
 * dass das Ergebnis unterhalb des lokalen Basis-Pfads liegt.
 *
 * Algorithmus:
 *   1. Remote-Pfad auf POSIX-Slashes normalisieren.
 *   2. Den Prefix-Strip auf remoteBase anwenden, um den Remote-Relativ-Pfad
 *      zu bekommen. Wenn remoteBase nicht im Remote-Pfad enthalten ist,
 *      wird der gesamte Pfad als relativ behandelt.
 *   3. Pfad-Traversal-Schutz:
 *      a. Vorkommen von '..'-Segmenten loesen sofort einen Fehler aus
 *         (nicht stillschweigend wegwerfen — sonst wird aus
 *         '/workspace/../../etc/passwd' still '/workspace/etc/passwd').
 *      b. '.'-Segmente werden ignoriert.
 *   4. Mit path.join wird das Ergebnis gegen den aufgeloesten localBase
 *      zusammengefuegt.
 *   5. Boundary-Check: das Ergebnis MUSS unter path.resolve(localBase)
 *      liegen (oder gleich sein) — zweite Verteidigungslinie fuer
 *      trickreiche Unicode-Codierungen.
 *
 * Wirft: Error mit Nachricht, sobald das Ergebnis ausserhalb der erlaubten
 * Basis liegt oder der Remote-Pfad '..'-Segmente enthaelt. Wirft ebenfalls,
 * wenn die Eingabe kein String ist.
 */
export function resolveSafeLocalPath(
    remotePath: string,
    remoteBase: string,
    localBase: string
): string {
    if (typeof remotePath !== 'string') {
        throw new Error(`resolveSafeLocalPath: remotePath must be a string, got ${typeof remotePath}`);
    }

    // 1) Beide Pfade auf POSIX-Slashes normalisieren.
    const normalizedRemote = normalizePath(remotePath);
    const normalizedRemoteBase = normalizePath(remoteBase);
    const baseWithSep = normalizedRemoteBase.endsWith('/')
        ? normalizedRemoteBase
        : normalizedRemoteBase + '/';

    // 2) Prefix-Strip: alles VOR remoteBase rauswerfen. Wenn der Remote-Pfad
    //    nicht innerhalb (oder gleich) remoteBase liegt, ist das ein
    //    Sicherheits-Vorfall: der Server hat einen Pfad zurueckgegeben, den
    //    wir nie angefragt haben.
    let relative: string;
    if (normalizedRemote === normalizedRemoteBase) {
        relative = '';
    } else if (normalizedRemote.startsWith(baseWithSep)) {
        relative = normalizedRemote.slice(baseWithSep.length);
    } else {
        throw new Error(
            `Path traversal blocked: ${remotePath} is outside remoteBase ${remoteBase}`
        );
    }

    // 3) Traversal-Schutz: '..'-Segmente werfen einen Fehler, '.' wird
    //    gefiltert.
    const segments = relative.split('/');
    const cleanSegments: string[] = [];
    for (const seg of segments) {
        if (!seg) continue;
        if (seg === '.') continue;
        if (seg === '..') {
            throw new Error(
                `Path traversal blocked: '${remotePath}' contains '..' segment`
            );
        }
        cleanSegments.push(seg);
    }
    const safeRelative = cleanSegments.join(path.sep);

    // 4) Join mit localBase.
    const localPath = path.join(localBase, safeRelative);

    // 5) Boundary-Check mit path.resolve.
    const resolvedLocal = path.resolve(localPath);
    const resolvedBase = path.resolve(localBase);

    if (resolvedLocal !== resolvedBase && !resolvedLocal.startsWith(resolvedBase + path.sep)) {
        throw new Error(
            `Path traversal blocked: ${remotePath} resolves outside ${localBase}`
        );
    }

    return localPath;
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
