/**
 * Unit-Tests fuer die JSON-Schema-Validierung der .ftpsync.json.
 *
 * Wir laden das Schema aus schemas/ftpsync.schema.json und pruefen, dass:
 *   - das neue Container-Shape ({ profiles: [...] }) angenommen wird
 *   - Profile ohne 'name' abgelehnt werden
 *   - das Legacy-Flachformat lautlos akzeptiert wird
 *   - direction nur gueltige Enum-Werte annimmt
 *
 * Externe Effekte (Validation-Ergebnis), keine VS-Code-Abhaengigkeit.
 */

import { strict as assert } from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import Ajv = require('ajv');

function loadSchema(): object {
    const schemaPath = path.resolve(__dirname, '../../../schemas/ftpsync.schema.json');
    return JSON.parse(fs.readFileSync(schemaPath, 'utf-8'));
}

function makeValidator(): (data: unknown) => { valid: boolean; errors: unknown[] } {
    // Ajv 6 hat ein eigenes Options-Interface; strict akzeptiert es zur
    // Laufzeit, aber type-definitions sind strenger. Wir nutzen any, um
    // Tests fokussiert zu halten.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ajv = new (Ajv as any)({
        allErrors: true,
        strict: false
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const validate: any = ajv.compile(loadSchema());
    return (data: unknown) => {
        const valid = validate(data);
        return { valid, errors: valid ? [] : (validate.errors ?? []) };
    };
}

describe('ftpsync.schema.json', () => {
    it('akzeptiert ein gueltiges Container-Shape mit einem Profil', () => {
        const validate = makeValidator();
        const result = validate({
            profiles: [
                {
                    name: 'My Server',
                    protocol: 'sftp',
                    host: 'example.com',
                    username: 'user',
                    remotePath: '/var/www',
                    uploadOnSave: true,
                    watcher: {
                        enabled: true,
                        files: '**/*',
                        autoUpload: true,
                        autoDelete: false
                    },
                    ignore: ['.git'],
                    useGitIgnore: true,
                    secure: false,
                    timeout: 30000,
                    debug: false
                }
            ]
        });

        assert.equal(result.valid, true, JSON.stringify(result.errors));
    });

    it('lehnt Profile ohne name ab', () => {
        const validate = makeValidator();
        const result = validate({
            profiles: [
                {
                    protocol: 'sftp',
                    host: 'example.com',
                    username: 'user',
                    remotePath: '/var/www'
                }
            ]
        });

        assert.equal(result.valid, false);
    });

    it('lehnt direction ausserhalb der erlaubten Enum-Werte ab', () => {
        const validate = makeValidator();
        const result = validate({
            profiles: [
                {
                    name: 'Bad',
                    protocol: 'sftp',
                    host: 'h',
                    username: 'u',
                    remotePath: '/',
                    direction: 'sideways'
                }
            ]
        });

        assert.equal(result.valid, false);
    });

    it('akzeptiert direction-Werte: localToRemote, remoteToLocal, bidirectional', () => {
        const validate = makeValidator();
        for (const direction of ['localToRemote', 'remoteToLocal', 'bidirectional']) {
            const result = validate({
                profiles: [
                    {
                        name: 'P',
                        protocol: 'sftp',
                        host: 'h',
                        username: 'u',
                        remotePath: '/',
                        direction
                    }
                ]
            });
            assert.equal(result.valid, true, `${direction} sollte erlaubt sein: ${JSON.stringify(result.errors)}`);
        }
    });

    it('akzeptiert Legacy-Flachobjekte ohne profiles-Schluessel', () => {
        const validate = makeValidator();
        const result = validate({
            protocol: 'sftp',
            host: 'legacy.example.com',
            username: 'user',
            remotePath: '/var/www',
            uploadOnSave: true,
            watcher: {
                enabled: true,
                files: '**/*',
                autoUpload: true,
                autoDelete: false
            },
            ignore: ['.git'],
            useGitIgnore: true,
            secure: false,
            timeout: 30000,
            debug: false
        });

        // Legacy wird via _legacy_* erlaubt — das Schema soll es NICHT
        // blockieren. Die Migration uebernimmt die Transformation.
        assert.equal(result.valid, true);
    });
});