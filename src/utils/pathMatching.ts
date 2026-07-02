/**
 * Pure-Functions fuer Pfad-Matching ohne VS-Code-Abhaengigkeit.
 *
 * Diese Funktionen sind bewusst aus pathUtils herausgehalten, damit sie
 * von Unit-Tests ohne vscode-Mock aufgerufen werden koennen.
 */

import * as path from 'path';

export interface ProfileLike {
    localPath?: string;
}

/**
 * Liefert das Profil mit dem laengsten passenden localPath-Praefix fuer
 * einen gegebenen URI-Pfad.
 *
 * Match-Regel: `uriPath` matched auf `profile.localPath`, wenn beide nach
 * Normalisierung gleich sind ODER uriPath ein strikter Unterordner ist
 * (also verhindert wird, dass /workspace/dev zu /workspace/dev-tools
 * matcht).
 *
 * Bei Mehrdeutigkeit gewinnt das spezifischste Profil (laengster
 * localPath). Liefert `undefined`, wenn kein Profil passt.
 */
export function resolveProfileByLongestPrefix(
    uriPath: string,
    profiles: ReadonlyArray<ProfileLike>
): ProfileLike | undefined {
    const normalizedUri = path.normalize(uriPath);
    let bestMatch: ProfileLike | undefined;
    let bestLength = -1;

    for (const profile of profiles) {
        if (!profile.localPath) continue;
        const normalizedLocal = path.normalize(profile.localPath);
        if (normalizedUri === normalizedLocal ||
            normalizedUri.startsWith(normalizedLocal + path.sep)) {
            if (normalizedLocal.length > bestLength) {
                bestMatch = profile;
                bestLength = normalizedLocal.length;
            }
        }
    }
    return bestMatch;
}
