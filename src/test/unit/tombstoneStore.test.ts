/**
 * Tests fuer den TombstoneStore.
 *
 * Der Store wird mit einem In-Memory-Mock fuer globalState getestet. Die
 * Zeit-Funktion `now` ist injizierbar, damit TTL-Ablauf ohne fakeTimers
 * simuliert werden kann.
 */

import { strict as assert } from 'assert';
import { TombstoneStore, buildTombstoneKey, GlobalStateLike } from '../../core/tombstoneStore';

class InMemoryGlobalState implements GlobalStateLike {
    private data = new Map<string, unknown>();

    get<T>(key: string): T | undefined {
        return this.data.get(key) as T | undefined;
    }

    async update(key: string, value: unknown): Promise<void> {
        this.data.set(key, value);
    }
}

describe('buildTombstoneKey', () => {
    it('baut das deterministische tombstones-Schema', () => {
        const key = buildTombstoneKey('/workspace', 'production');
        assert.equal(key, 'tombstones./workspace.production');
    });
});

describe('TombstoneStore', () => {
    let globalState: InMemoryGlobalState;

    beforeEach(() => {
        globalState = new InMemoryGlobalState();
    });

    it('has() liefert false fuer nie gesetzte Pfade', () => {
        const store = new TombstoneStore(globalState, '/ws', 'p1');
        assert.equal(store.has('nope.txt'), false);
    });

    it('add() + has() roundtrip innerhalb TTL', () => {
        const store = new TombstoneStore(globalState, '/ws', 'p1');
        return store.add('foo.txt').then(() => {
            assert.equal(store.has('foo.txt'), true);
        });
    });

    it('add() mit expliziter TTL wird nach Ablauf als "nicht mehr vorhanden" gewertet', () => {
        let nowValue = 1_000_000;
        const store = new TombstoneStore(globalState, '/ws', 'p1', {
            ttlMs: 100,
            now: () => nowValue
        });
        return store.add('foo.txt').then(() => {
            assert.equal(store.has('foo.txt'), true);
            // 50ms spaeter: noch innerhalb TTL
            nowValue += 50;
            assert.equal(store.has('foo.txt'), true);
            // 200ms spaeter: TTL abgelaufen
            nowValue += 200;
            assert.equal(store.has('foo.txt'), false);
        });
    });

    it('remove() loescht explizit einen Tombstone', () => {
        const store = new TombstoneStore(globalState, '/ws', 'p1');
        return store.add('a.txt').then(() => store.remove('a.txt'))
            .then(() => {
                assert.equal(store.has('a.txt'), false);
            });
    });

    it('remove() auf nicht-existentem Tombstone ist idempotent', () => {
        const store = new TombstoneStore(globalState, '/ws', 'p1');
        return store.remove('nope.txt').then(() => {
            assert.equal(store.has('nope.txt'), false);
        });
    });

    it('size() zaehlt nur aktive (nicht abgelaufene) Tombstones', () => {
        let nowValue = 1_000_000;
        const store = new TombstoneStore(globalState, '/ws', 'p1', {
            ttlMs: 100,
            now: () => nowValue
        });
        return store.add('a.txt')
            .then(() => {
                assert.equal(store.size(), 1);
                // Zeit + 150ms verschieben, dann b.txt anlegen.
                // a.txt ist jetzt abgelaufen, b.txt ist frisch.
                nowValue += 150;
                return store.add('b.txt');
            })
            .then(() => {
                assert.equal(store.size(), 1);
            });
    });

    it('prune() entfernt abgelaufene Tombstones aus globalState', () => {
        let nowValue = 1_000_000;
        const store = new TombstoneStore(globalState, '/ws', 'p1', {
            ttlMs: 100,
            now: () => nowValue
        });
        return store.add('a.txt')
            .then(() => store.add('b.txt'))
            .then(() => {
                nowValue += 200;
                return store.prune();
            })
            .then(() => {
                assert.equal(store.size(), 0);
                // globalState-Key existiert noch, aber enthaelt leere Map
                const raw = globalState.get<Record<string, unknown>>('tombstones./ws.p1');
                assert.deepEqual(raw, {});
            });
    });

    it('unterscheidet Profile mit gleichem Namen in unterschiedlichen Workspaces', () => {
        const storeA = new TombstoneStore(globalState, '/ws-a', 'p');
        const storeB = new TombstoneStore(globalState, '/ws-b', 'p');
        return storeA.add('file.txt')
            .then(() => {
                assert.equal(storeA.has('file.txt'), true);
                assert.equal(storeB.has('file.txt'), false);
            });
    });
});
