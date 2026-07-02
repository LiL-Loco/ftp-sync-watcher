/**
 * Tests fuer resolveProfilePaths (extrahierter Pure-Subset aus
 * ConfigManager.prepareProfile).
 *
 * Diese Tests verifizieren die Pfad-Aufloesung gegen den Workspace-Folder
 * — kein vscode-Mock noetig.
 */

import * as path from 'path';
import { strict as assert } from 'assert';
import { resolveProfilePaths } from '../../types/config';
import { mergeProfileWithDefaults } from '../../types/config';
import type { FtpSyncProfile } from '../../types';

describe('resolveProfilePaths', () => {
    const FOLDER = process.platform === 'win32'
        ? 'D:\\workspace'
        : '/home/user/workspace';

    function baseMerged(): FtpSyncProfile {
        return mergeProfileWithDefaults({
            name: 'test',
            host: 'example.com',
            username: 'alice',
            remotePath: '/var/www'
        });
    }

    it('loest einen relativen localPath gegen den Workspace-Folder auf', () => {
        const merged = baseMerged();
        merged.localPath = 'src/web';

        const result = resolveProfilePaths(FOLDER, merged);

        assert.equal(result.localPath, path.join(FOLDER, 'src/web'));
    });

    it('behaelt einen absoluten localPath unveraendert', () => {
        const merged = baseMerged();
        merged.localPath = '/var/www';

        const result = resolveProfilePaths(FOLDER, merged);

        assert.equal(result.localPath, '/var/www');
    });

    it('behandelt einen leeren localPath als Workspace-Root', () => {
        const merged = baseMerged();
        merged.localPath = '';

        const result = resolveProfilePaths(FOLDER, merged);

        assert.equal(result.localPath, FOLDER);
    });

    it('mutiert das Eingabe-Objekt nicht (Immutability)', () => {
        const merged = baseMerged();
        const originalLocalPath = 'src/web';
        merged.localPath = originalLocalPath;

        const result = resolveProfilePaths(FOLDER, merged);

        assert.equal(merged.localPath, originalLocalPath);
        assert.notEqual(result, merged);
    });

    it('loest relative TLS-Pfade gegen den Workspace-Folder auf', () => {
        const merged = baseMerged();
        merged.secure = true;
        merged.secureOptions = {
            caPath: 'certs/ca.pem',
            certPath: 'certs/client.pem',
            keyPath: 'certs/client.key',
            rejectUnauthorized: true
        };

        const result = resolveProfilePaths(FOLDER, merged);

        assert.ok(result.secureOptions);
        assert.equal(result.secureOptions.caPath, path.join(FOLDER, 'certs/ca.pem'));
        assert.equal(result.secureOptions.certPath, path.join(FOLDER, 'certs/client.pem'));
        assert.equal(result.secureOptions.keyPath, path.join(FOLDER, 'certs/client.key'));
        // rejectUnauthorized ist kein Pfad, bleibt gleich
        assert.equal(result.secureOptions.rejectUnauthorized, true);
    });

    it('behaelt absolute TLS-Pfade unveraendert', () => {
        const merged = baseMerged();
        merged.secure = true;
        merged.secureOptions = {
            caPath: '/etc/ssl/ca.pem',
            rejectUnauthorized: true
        };

        const result = resolveProfilePaths(FOLDER, merged);

        assert.ok(result.secureOptions);
        assert.equal(result.secureOptions.caPath, '/etc/ssl/ca.pem');
    });

    it('behandelt undefined TLS-Pfade (sie bleiben undefined)', () => {
        const merged = baseMerged();
        merged.secure = true;
        merged.secureOptions = {
            rejectUnauthorized: true
        };

        const result = resolveProfilePaths(FOLDER, merged);

        assert.ok(result.secureOptions);
        assert.equal(result.secureOptions.caPath, undefined);
        assert.equal(result.secureOptions.certPath, undefined);
        assert.equal(result.secureOptions.keyPath, undefined);
    });

    it('lässt secureOptions weg, wenn das Profil keine hat', () => {
        const merged = baseMerged();
        merged.secureOptions = undefined;

        const result = resolveProfilePaths(FOLDER, merged);

        assert.equal(result.secureOptions, undefined);
    });

    it('gibt ein neues Objekt zurueck (referenz-frei)', () => {
        const merged = baseMerged();

        const result = resolveProfilePaths(FOLDER, merged);

        assert.notEqual(result, merged);
        assert.notEqual(result.secureOptions, merged.secureOptions);
    });

    it('behaelt verschachtelte nested watcher-Konfigurationen', () => {
        const merged = baseMerged();
        merged.watcher = {
            enabled: true,
            files: '**/*.php',
            autoUpload: true,
            autoDelete: false,
            pollIntervalMs: 15000
        };

        const result = resolveProfilePaths(FOLDER, merged);

        assert.equal(result.watcher.pollIntervalMs, 15000);
        assert.equal(result.watcher.files, '**/*.php');
    });
});