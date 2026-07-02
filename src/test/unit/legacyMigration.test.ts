/**
 * Unit-Tests fuer die stille Migration aus dem v1.x-Flachformat und das
 * Defaults-Merging. Reine Pure-Functions ohne VS-Code-Abhaengigkeiten.
 */

import { strict as assert } from 'assert';
import {
    migrateLegacyConfig,
    mergeProfileWithDefaults,
    LEGACY_MIGRATION_PROFILE_NAME,
    FtpSyncProfile
} from '../../types/config';

describe('migrateLegacyConfig', () => {
    it('wickelt ein Legacy-Flachobjekt in profiles[0] mit Default-Namen', () => {
        const legacy = {
            protocol: 'ftp',
            host: 'ftp.example.com',
            username: 'user',
            remotePath: '/var/www',
            uploadOnSave: true
        };

        const result = migrateLegacyConfig(legacy);

        assert.equal(result.profiles.length, 1);
        assert.equal(result.profiles[0].name, LEGACY_MIGRATION_PROFILE_NAME);
        assert.equal(result.profiles[0].host, 'ftp.example.com');
        assert.equal(result.profiles[0].protocol, 'ftp');
    });

    it('verwirft das concurrency-Feld des Legacy-Profils', () => {
        const legacy = {
            protocol: 'sftp',
            host: 'sftp.example.com',
            username: 'user',
            remotePath: '/var/www',
            concurrency: 5
        };

        const result = migrateLegacyConfig(legacy);

        assert.equal((result.profiles[0] as unknown as Record<string, unknown>).concurrency, undefined);
    });

    it('laesst einen expliziten Namen aus dem Legacy-Objekt unangetastet', () => {
        const legacy = {
            name: 'Production',
            protocol: 'sftp',
            host: 'sftp.example.com',
            username: 'user',
            remotePath: '/var/www'
        };

        const result = migrateLegacyConfig(legacy);

        assert.equal(result.profiles[0].name, 'Production');
    });

    it('reicht ein bereits valides Container-Shape unveraendert durch', () => {
        const modern = {
            profiles: [
                {
                    name: 'Staging',
                    protocol: 'sftp',
                    host: 'staging.example.com',
                    username: 'user',
                    remotePath: '/var/www'
                }
            ]
        };

        const result = migrateLegacyConfig(modern);

        assert.equal(result.profiles.length, 1);
        assert.equal(result.profiles[0].name, 'Staging');
    });

    it('liefert eine leere Profil-Liste fuer null, undefined oder Nicht-Objekte', () => {
        assert.deepEqual(migrateLegacyConfig(null).profiles, []);
        assert.deepEqual(migrateLegacyConfig(undefined).profiles, []);
        assert.deepEqual(migrateLegacyConfig('kein-objekt' as unknown).profiles, []);
        assert.deepEqual(migrateLegacyConfig([] as unknown).profiles, []);
    });
});

describe('mergeProfileWithDefaults', () => {
    it('setzt fehlende Defaults: direction=localToRemote, protocol=sftp, port=22', () => {
        const partial: Partial<FtpSyncProfile> = {
            name: 'My Server',
            host: 'example.com',
            username: 'user',
            remotePath: '/var/www'
        };

        const merged = mergeProfileWithDefaults(partial);

        assert.equal(merged.direction, 'localToRemote');
        assert.equal(merged.protocol, 'sftp');
        assert.equal(merged.port, 22);
        assert.equal(merged.timeout, 30000);
        assert.equal(merged.uploadOnSave, true);
        assert.equal(merged.watcher.enabled, true);
    });

    it('waehlt FTP-Defaultport 21 (ohne TLS) bzw. 990 (mit TLS)', () => {
        const ftpNoTls = mergeProfileWithDefaults({ protocol: 'ftp', secure: false });
        assert.equal(ftpNoTls.port, 21);

        const ftpTls = mergeProfileWithDefaults({ protocol: 'ftp', secure: true });
        assert.equal(ftpTls.port, 990);
    });

    it('ueberschreibt Defaults NICHT, wenn das Profil sie explizit setzt', () => {
        const partial: Partial<FtpSyncProfile> = {
            name: 'Custom',
            protocol: 'sftp',
            host: 'h',
            username: 'u',
            remotePath: '/',
            timeout: 60000,
            uploadOnSave: false,
            ignore: ['build'],
            direction: 'remoteToLocal'
        };

        const merged = mergeProfileWithDefaults(partial);

        assert.equal(merged.timeout, 60000);
        assert.equal(merged.uploadOnSave, false);
        assert.deepEqual(merged.ignore, ['build']);
        assert.equal(merged.direction, 'remoteToLocal');
    });

    it('merged nested watcher/secureOptions rekursiv', () => {
        const partial: Partial<FtpSyncProfile> = {
            name: 'Watched',
            protocol: 'sftp',
            host: 'h',
            username: 'u',
            remotePath: '/',
            watcher: {
                enabled: true,
                files: '**/*',
                autoUpload: true,
                autoDelete: true
            },
            secureOptions: {
                rejectUnauthorized: false
            }
        };

        const merged = mergeProfileWithDefaults(partial);

        assert.equal(merged.watcher.autoDelete, true);
        assert.equal(merged.secureOptions?.rejectUnauthorized, false);
    });
});