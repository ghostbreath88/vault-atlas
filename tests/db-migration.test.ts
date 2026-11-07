import 'fake-indexeddb/auto';
import { describe, it, expect } from 'vitest';
import { openDB } from 'idb';
import { openAtlasDB, DB_VERSION } from '../src/lib/db';

/** Builds a database exactly as schema v1 shipped (no `imports`, appdata without `moves`). */
async function makeV1(name: string) {
  const db = await openDB(name, 1, {
    upgrade(db) {
      db.createObjectStore('vaults', { keyPath: 'id' });
      db.createObjectStore('notes', { keyPath: ['vaultId', 'path'] }).createIndex('byVault', 'vaultId');
      db.createObjectStore('attachments', { keyPath: ['vaultId', 'path'] }).createIndex('byVault', 'vaultId');
      db.createObjectStore('appdata', { keyPath: 'vaultId' });
      db.createObjectStore('boards', { keyPath: 'id' }).createIndex('byVault', 'vaultId');
      db.createObjectStore('views', { keyPath: 'id' }).createIndex('byVault', 'vaultId');
      db.createObjectStore('settings', { keyPath: 'id' });
    },
  });
  await db.put('vaults', { id: 'v1', name: 'Old vault', manifest: [{ path: 'A.md', hash: 'x' }] });
  await db.put('notes', { vaultId: 'v1', path: 'A.md', raw: '# A\n[[B]]' });
  await db.put('appdata', { vaultId: 'v1', favorites: ['A.md'], recents: [{ path: 'A.md', at: 1 }] });
  await db.put('boards', { id: 'b1', vaultId: 'v1', name: 'My board', cards: [{ id: 'c1', notePath: 'A.md', x: 1, y: 2 }], links: [] });
  await db.put('views', { id: 'g1', vaultId: 'v1', name: 'View', createdAt: 1 });
  await db.put('settings', { id: 'settings', theme: 'dark' });
  db.close();
}

describe('IndexedDB migrations', () => {
  it('upgrades v1 -> current without losing notes or app-only data', async () => {
    const name = 'atlas-migration-test';
    await makeV1(name);
    const db = await openAtlasDB(name);
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames]).toContain('imports');
    const app = await db.get('appdata', 'v1');
    expect(app!.favorites).toEqual(['A.md']);
    expect(app!.recents).toEqual([{ path: 'A.md', at: 1 }]);
    expect(app!.moves).toEqual([]);
    expect(app!.dashboard.order.length).toBeGreaterThan(0);
    expect(((await db.get('notes', ['v1', 'A.md'])) as any).raw).toContain('[[B]]');
    expect((await db.get('boards', 'b1'))!.cards[0].notePath).toBe('A.md');
    expect((await db.get('views', 'g1'))!.name).toBe('View');
    expect((await db.get('settings', 'settings'))!.theme).toBe('dark');
    expect(await db.count('imports')).toBe(0);
    db.close();
  });
  it('creates a fresh database at the current version', async () => {
    const db = await openAtlasDB('atlas-fresh-test');
    expect(db.version).toBe(DB_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(['appdata', 'attachments', 'boards', 'imports', 'notes', 'settings', 'vaults', 'views']);
    db.close();
  });
});
