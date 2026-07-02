/**
 * Tests fuer die Profile-Aufloesung aus einem Pfad (longest-prefix-match).
 *
 * Diese Tests isolieren die Aufloesungs-Logik aus ConfigManager, indem sie
 * die exportierte Pure-Function resolveProfileByLongestPrefix aus
 * utils/pathUtils direkt aufrufen. ConfigManager verwendet denselben
 * Algorithmus.
 */

import { strict as assert } from 'assert';
import { FtpSyncProfile } from '../../types/config';
import { resolveProfileByLongestPrefix } from '../../utils/pathMatching';

function makeProfile(name: string, localPath: string): FtpSyncProfile {
    return {
        name,
        direction: 'localToRemote',
        protocol: 'sftp',
        host: 'h',
        username: 'u',
        remotePath: '/',
        localPath,
        uploadOnSave: true,
        watcher: { enabled: true, files: '**/*', autoUpload: true, autoDelete: false },
        ignore: [],
        useGitIgnore: true,
        secure: false,
        timeout: 30000,
        debug: false
    };
}

describe('Pro-URI-Profil-Aufloesung (longest-prefix-match)', () => {
    it('liefert das spezifischere Profil bei ueberlappenden localPath-Werten', () => {
        const broad = makeProfile('broad', '/workspace');
        const narrow = makeProfile('narrow', '/workspace/sub');

        const result = resolveProfileByLongestPrefix('/workspace/sub/file.txt', [broad, narrow]);
        assert.equal(result?.localPath, '/workspace/sub');
    });

    it('liefert das einzige Profil bei nicht-ueberlappendem localPath', () => {
        const docs = makeProfile('docs', '/workspace/docs');
        const src = makeProfile('src', '/workspace/src');

        const result = resolveProfileByLongestPrefix('/workspace/src/file.ts', [docs, src]);
        assert.equal(result?.localPath, '/workspace/src');
    });

    it('liefert undefined, wenn die URI ausserhalb aller localPaths liegt', () => {
        const docs = makeProfile('docs', '/workspace/docs');
        const src = makeProfile('src', '/workspace/src');

        const result = resolveProfileByLongestPrefix('/workspace/README.md', [docs, src]);
        assert.equal(result, undefined);
    });

    it('unterscheidet /workspace/dev NICHT von /workspace/dev-tools', () => {
        // Critical edge case: startsWith alone wuerde beide matchen.
        const dev = makeProfile('dev', '/workspace/dev');

        const result = resolveProfileByLongestPrefix('/workspace/dev-tools/foo.txt', [dev]);
        assert.equal(result, undefined);
    });

    it('matcht exakt auf das localPath-Verzeichnis selbst', () => {
        const p = makeProfile('p', '/workspace/sub');

        const result = resolveProfileByLongestPrefix('/workspace/sub', [p]);
        assert.equal(result?.localPath, '/workspace/sub');
    });
});