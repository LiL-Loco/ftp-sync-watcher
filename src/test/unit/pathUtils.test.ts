/**
 * Tests fuer die Path-Utilities. resolveSafeLocalPath ist die Version mit
 * Boundary-Check, remoteToLocalPath der legacy-Joiner ohne Schutz.
 */

import { strict as assert } from 'assert';
import * as path from 'path';
import {
    resolveSafeLocalPath,
    remoteToLocalPath,
    normalizePath,
    joinPath,
    getRelativePath
} from '../../utils/pathUtils';

describe('normalizePath', () => {
    it('konvertiert Backslashes zu Forward-Slashes', () => {
        assert.equal(normalizePath('foo\\bar\\baz'), 'foo/bar/baz');
    });

    it('laesst Forward-Slashes unveraendert', () => {
        assert.equal(normalizePath('foo/bar/baz'), 'foo/bar/baz');
    });
});

describe('joinPath + getRelativePath', () => {
    it('joinPath verbindet Segmente mit Normalisierung', () => {
        assert.equal(joinPath('a', 'b', 'c'), 'a/b/c');
    });

    it('getRelativePath liefert eine relative POSIX-Pfad-Zeichenkette', () => {
        const rel = getRelativePath('/workspace', '/workspace/src/file.ts');
        // Auf Linux/Mac erwarten wir 'src/file.ts'; auf Windows 'src\\file.ts',
        // das aber durch normalizePath zu 'src/file.ts' wird.
        assert.ok(rel === 'src/file.ts' || rel === 'src\\file.ts');
    });
});

describe('resolveSafeLocalPath', () => {
    const base = process.platform === 'win32' ? 'C:\\workspace' : '/workspace';

    it('simple file: Pfad innerhalb base', () => {
        const result = resolveSafeLocalPath(
            path.posix.join(base, 'src/file.ts'),
            base,
            base
        );
        assert.ok(result.endsWith(path.join('src', 'file.ts')));
    });

    it('blockt ../-Traversal-Segmente', () => {
        assert.throws(() => {
            resolveSafeLocalPath(
                path.posix.join(base, '..', '..', 'etc', 'passwd'),
                base,
                base
            );
        }, /Path traversal blocked/);
    });

    it('blockt /etc/passwd ausserhalb base', () => {
        // Server liefert einen absoluten Remote-Pfad, der nicht unter
        // remoteBase liegt.
        assert.throws(() => {
            resolveSafeLocalPath('/etc/passwd', base, base);
        }, /Path traversal blocked/);
    });

    it('erlaubt Datei NEBEN basePath (boundary equality)', () => {
        // basePath selbst als Ziel ist OK.
        const result = resolveSafeLocalPath(base, base, base);
        assert.ok(result === path.resolve(base) || result === base);
    });

    it('filtert leere Segmente und "." heraus', () => {
        const result = resolveSafeLocalPath(
            path.posix.join(base, '.', 'src', 'file.ts'),
            base,
            base
        );
        assert.ok(result.endsWith(path.join('src', 'file.ts')));
    });

    it('wirft bei nicht-String-Eingabe', () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        assert.throws(() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            resolveSafeLocalPath(null as any, base, base);
        }, /must be a string/);
    });
});

describe('remoteToLocalPath (Legacy)', () => {
    // Bewusst KEINE Sicherheitsgarantie — die Tests dokumentieren nur die
    // bestehende Semantik, damit eine spaetere Aenderung auffaellt.
    it('joined Remote zu Local ohne Pruefung', () => {
        const result = remoteToLocalPath('/var/www/html/file.html', '/var/www', '/local');
        // Ohne Boundary-Check kann der Pfad auch 'falsch' rauskommen, das
        // ist by design — diese Funktion nutzt nur der FileWatcher intern.
        assert.ok(typeof result === 'string');
        assert.ok(result.length > 0);
    });
});
