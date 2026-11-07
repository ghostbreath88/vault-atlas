import { openDB, type IDBPDatabase, type DBSchema } from 'idb';
import type { AttachmentRecord, Board, GraphView, ImportLog, NoteRecord, Settings, VaultAppData, VaultRecord } from './types';

/**
 * Storage layout. Imported vault CONTENT (notes, attachments) lives in separate stores from
 * APP-ONLY data (appdata, boards, views, settings). Replacing a snapshot only touches content stores.
 *
 * Schema history:
 *   v1 — vaults, notes, attachments, appdata, boards, views, settings
 *   v2 — adds `imports` (import history log) and backfills `moves`/`dashboard` on appdata
 */
export const DB_NAME = 'vault-atlas';
export const DB_VERSION = 2;

export interface AtlasDB extends DBSchema {
  vaults: { key: string; value: VaultRecord };
  notes: { key: [string, string]; value: NoteRecord; indexes: { byVault: string } };
  attachments: { key: [string, string]; value: AttachmentRecord; indexes: { byVault: string } };
  appdata: { key: string; value: VaultAppData };
  boards: { key: string; value: Board; indexes: { byVault: string } };
  views: { key: string; value: GraphView; indexes: { byVault: string } };
  settings: { key: string; value: Settings & { id: string } };
  imports: { key: string; value: ImportLog; indexes: { byVault: string } };
}

export const DEFAULT_DASHBOARD = ['search', 'stats', 'continue', 'pinned', 'recent', 'folders', 'tags'];

export function defaultAppData(vaultId: string): VaultAppData {
  return { vaultId, favorites: [], recents: [], dashboard: { order: [...DEFAULT_DASHBOARD], hidden: [] }, moves: [] };
}

let dbp: Promise<IDBPDatabase<AtlasDB>> | null = null;

export function openAtlasDB(name = DB_NAME): Promise<IDBPDatabase<AtlasDB>> {
  if (dbp && name === DB_NAME) return dbp;
  const p = openDB<AtlasDB>(name, DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore('vaults', { keyPath: 'id' });
        db.createObjectStore('notes', { keyPath: ['vaultId', 'path'] }).createIndex('byVault', 'vaultId');
        db.createObjectStore('attachments', { keyPath: ['vaultId', 'path'] }).createIndex('byVault', 'vaultId');
        db.createObjectStore('appdata', { keyPath: 'vaultId' });
        db.createObjectStore('boards', { keyPath: 'id' }).createIndex('byVault', 'vaultId');
        db.createObjectStore('views', { keyPath: 'id' }).createIndex('byVault', 'vaultId');
        db.createObjectStore('settings', { keyPath: 'id' });
      }
      if (oldVersion < 2) {
        db.createObjectStore('imports', { keyPath: 'id' }).createIndex('byVault', 'vaultId');
        if (oldVersion >= 1) {
          const store = tx.objectStore('appdata');
          let cur = await store.openCursor();
          while (cur) {
            const v = cur.value as VaultAppData;
            const next: VaultAppData = { ...defaultAppData(v.vaultId), ...v };
            next.moves ??= [];
            next.dashboard ??= { order: [...DEFAULT_DASHBOARD], hidden: [] };
            await cur.update(next);
            cur = await cur.continue();
          }
        }
      }
    },
    blocking() {
      // A newer version of the app opened in another tab — close so it can upgrade.
      dbp?.then((d) => d.close());
      dbp = null;
    },
  });
  if (name === DB_NAME) dbp = p;
  return p;
}

export async function deleteEverything() {
  if (dbp) (await dbp).close();
  dbp = null;
  await new Promise<void>((res, rej) => {
    const r = indexedDB.deleteDatabase(DB_NAME);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
    r.onblocked = () => res();
  });
}

export async function requestPersistence(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!navigator.storage?.persist) return 'unsupported';
  try {
    if (await navigator.storage.persisted()) return 'granted';
    return (await navigator.storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

export async function storageEstimate() {
  try {
    const e = await navigator.storage?.estimate?.();
    const persisted = await navigator.storage?.persisted?.();
    return { usage: e?.usage, quota: e?.quota, persisted };
  } catch {
    return {};
  }
}
