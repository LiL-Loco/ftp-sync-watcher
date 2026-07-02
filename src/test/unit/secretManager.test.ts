/**
 * Tests fuer den SecretManager.
 *
 * Diese Tests verwenden einen In-Memory-Mock, der das SecretStorageLike-
 * Interface implementiert. Dadurch kann der Manager ohne vscode-Mock
 * getestet werden — nur die public-API wird verifiziert.
 */

import { strict as assert } from 'assert';
import { SecretManager, buildSecretKey } from '../../core/secretManager';
import { SecretStorageLike } from '../../core/secretManager';

class InMemorySecretStorage implements SecretStorageLike {
    private entries = new Map<string, string>();

    async get(key: string): Promise<string | undefined> {
        return this.entries.get(key);
    }

    async store(key: string, value: string): Promise<void> {
        this.entries.set(key, value);
    }

    async delete(key: string): Promise<void> {
        this.entries.delete(key);
    }
}

describe('buildSecretKey', () => {
    it('baut das deterministische ftpSync-Schema', () => {
        const key = buildSecretKey('/workspace', 'production', 'password');
        assert.equal(key, 'ftpSync./workspace.production.password');
    });

    it('unterscheidet password und passphrase ueber kind', () => {
        const passwordKey = buildSecretKey('/ws', 'p', 'password');
        const passphraseKey = buildSecretKey('/ws', 'p', 'passphrase');
        assert.notEqual(passwordKey, passphraseKey);
    });
});

describe('SecretManager', () => {
    let storage: InMemorySecretStorage;
    let manager: SecretManager;

    beforeEach(() => {
        storage = new InMemorySecretStorage();
        manager = new SecretManager(storage);
    });

    it('setSecret + getSecret roundtrip', async () => {
        await manager.setSecret('/ws', 'p1', 'password', 'geheim');
        const result = await manager.getSecret('/ws', 'p1', 'password');
        assert.equal(result, 'geheim');
    });

    it('liefert undefined fuer nicht-gesetzte Secrets', async () => {
        const result = await manager.getSecret('/ws', 'nope', 'password');
        assert.equal(result, undefined);
    });

    it('deleteSecret entfernt nur das adressierte Secret', async () => {
        await manager.setSecret('/ws', 'p1', 'password', 'pw');
        await manager.setSecret('/ws', 'p1', 'passphrase', 'pp');
        await manager.deleteSecret('/ws', 'p1', 'password');

        assert.equal(await manager.getSecret('/ws', 'p1', 'password'), undefined);
        assert.equal(await manager.getSecret('/ws', 'p1', 'passphrase'), 'pp');
    });

    it('unterscheidet Profile mit gleichem Namen in unterschiedlichen Workspaces', async () => {
        await manager.setSecret('/ws-a', 'prod', 'password', 'a-pw');
        await manager.setSecret('/ws-b', 'prod', 'password', 'b-pw');

        assert.equal(await manager.getSecret('/ws-a', 'prod', 'password'), 'a-pw');
        assert.equal(await manager.getSecret('/ws-b', 'prod', 'password'), 'b-pw');
    });

    it('clearProfileSecrets entfernt password UND passphrase', async () => {
        await manager.setSecret('/ws', 'p1', 'password', 'pw');
        await manager.setSecret('/ws', 'p1', 'passphrase', 'pp');

        await manager.clearProfileSecrets('/ws', 'p1');

        assert.equal(await manager.getSecret('/ws', 'p1', 'password'), undefined);
        assert.equal(await manager.getSecret('/ws', 'p1', 'passphrase'), undefined);
    });

    it('clearProfileSecrets laesst andere Profile unberuehrt', async () => {
        await manager.setSecret('/ws', 'p1', 'password', 'pw-1');
        await manager.setSecret('/ws', 'p2', 'password', 'pw-2');

        await manager.clearProfileSecrets('/ws', 'p1');

        assert.equal(await manager.getSecret('/ws', 'p1', 'password'), undefined);
        assert.equal(await manager.getSecret('/ws', 'p2', 'password'), 'pw-2');
    });
});
