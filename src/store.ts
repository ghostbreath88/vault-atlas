import { useSyncExternalStore } from 'react';
import { defaultAppData, deleteEverything, openAtlasDB, requestPersistence } from './lib/db';
import { applyMovesToAppData, computeDiff, findDangling, type DiffInputFile, type ImportDiff, type MoveCandidate } from './lib/diff';
import type { ImportSource, ScanResult } from './lib/importCore';
import type { VaultIndex } from './lib/indexer';
import { basename, dirname, noteName } from './lib/paths';
import type { AttachmentRecord, Board, GraphView, ImportLog, ImportMode, NoteRecord, Settings, VaultAppData, VaultRecord } from './lib/types';
import { DEFAULT_SETTINGS } from './lib/types';
import ImportWorker from './workers/import.worker?worker';
import IndexWorker from './workers/index.worker?worker';

export interface Toast { id: number; text: string; tone?: 'ok' | 'warn' | 'error' }

export interface State {
  ready: boolean;
  settings: Settings;
  vaults: VaultRecord[];
  vault?: VaultRecord;
  notes: Map<string, NoteRecord>;
  attachments: Map<string, AttachmentRecord>;
  contentLoaded: boolean;
  index?: VaultIndex;
  indexing: boolean;
  app?: VaultAppData;
  boards: Board[];
  views: GraphView[];
  imports: ImportLog[];
  toasts: Toast[];
  persistence: 'granted' | 'denied' | 'unsupported' | 'unknown';
  dbError?: string;
  updateReady?: () => void;
}

let state: State = {
  ready: false, settings: DEFAULT_SETTINGS, vaults: [], notes: new Map(), attachments: new Map(), contentLoaded: false,
  indexing: false, boards: [], views: [], imports: [], toasts: [], persistence: 'unknown',
};
const listeners = new Set<() => void>();
export const getState = () => state;
export function setState(p: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof p === 'function' ? p(state) : p) };
  listeners.forEach((l) => l());
}
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => sel(state));
}

let toastId = 0;
export function toast(text: string, tone: Toast['tone'] = 'ok') {
  const t = { id: ++toastId, text, tone };
  setState((s) => ({ toasts: [...s.toasts, t] }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((x) => x.id !== t.id) })), tone === 'error' ? 8000 : 4000);
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2) + Date.now().toString(36));
export const newId = uid;

/* ------------------------------------------------------------------ boot */

export async function boot() {
  try {
    const db = await openAtlasDB();
    const s = await db.get('settings', 'settings');
    const settings = { ...DEFAULT_SETTINGS, ...(s ?? {}) };
    const vaults = await db.getAll('vaults');
    const persisted = await navigator.storage?.persisted?.().catch(() => false);
    setState({ settings, vaults, ready: true, persistence: persisted ? 'granted' : typeof navigator.storage?.persist === 'function' ? 'unknown' : 'unsupported' });
    const cur = vaults.find((v) => v.id === settings.currentVaultId) ?? vaults.find((v) => !v.isDemo) ?? vaults[0];
    if (cur) await openVault(cur.id);
  } catch (e) {
    setState({ ready: true, dbError: (e as Error).message || 'IndexedDB unavailable' });
  }
}

export async function saveSettings(p: Partial<Settings>) {
  const settings = { ...state.settings, ...p };
  setState({ settings });
  try { (await openAtlasDB()).put('settings', { ...settings, id: 'settings' }); } catch { /* in-memory only */ }
  if ('aliasFallback' in p) reindex();
}

/* --------------------------------------------------------------- vaults */

const urlCache = new Map<string, string>();
export function attachmentUrl(path: string): string | undefined {
  const a = state.attachments.get(path);
  if (!a) return undefined;
  let u = urlCache.get(path);
  if (!u) { u = URL.createObjectURL(a.blob); urlCache.set(path, u); }
  return u;
}
function clearUrls() { urlCache.forEach((u) => URL.revokeObjectURL(u)); urlCache.clear(); }

export async function openVault(id: string) {
  const db = await openAtlasDB();
  const vault = await db.get('vaults', id);
  if (!vault) return;
  clearUrls();
  const [notes, atts, app, boards, views, imports] = await Promise.all([
    vault.persistContent ? db.getAllFromIndex('notes', 'byVault', id) : Promise.resolve([] as NoteRecord[]),
    vault.persistContent ? db.getAllFromIndex('attachments', 'byVault', id) : Promise.resolve([] as AttachmentRecord[]),
    db.get('appdata', id),
    db.getAllFromIndex('boards', 'byVault', id),
    db.getAllFromIndex('views', 'byVault', id),
    db.getAllFromIndex('imports', 'byVault', id),
  ]);
  setState({
    vault,
    notes: new Map(notes.map((n) => [n.path, n])),
    attachments: new Map(atts.map((a) => [a.path, a])),
    contentLoaded: vault.persistContent ? notes.length + atts.length > 0 : false,
    app: app ?? defaultAppData(id),
    boards: boards.sort((a, b) => b.updatedAt - a.updatedAt),
    views: views.sort((a, b) => b.createdAt - a.createdAt),
    imports: imports.sort((a, b) => b.at - a.at),
    index: undefined,
  });
  saveSettings({ currentVaultId: id });
  await reindex();
}

/* ---------------------------------------------------------------- index */

let indexWorker: Worker | null = null;
let reqSeq = 0;
const pending = new Map<number, (v: any) => void>();
function iw() {
  if (!indexWorker) {
    indexWorker = new IndexWorker();
    indexWorker.onmessage = (e) => { const r = pending.get(e.data.reqId); if (r) { pending.delete(e.data.reqId); r(e.data); } };
  }
  return indexWorker;
}
function call(msg: any): Promise<any> {
  const reqId = ++reqSeq;
  return new Promise((res) => { pending.set(reqId, res); iw().postMessage({ ...msg, reqId }); });
}

export async function reindex() {
  if (!state.vault) return;
  setState({ indexing: true });
  const notes = [...state.notes.values()].map((n) => ({ path: n.path, name: n.name, folder: n.folder, parsed: n.parsed, content: n.content, missing: n.missing }));
  const unsupported = state.vault.inventory.filter((i) => /canvas|bases|\.txt|\.markdown/i.test(i.reason)).map((i) => i.path);
  const r = await call({ type: 'build', notes, attachments: [...state.attachments.keys()], unsupported, aliasFallback: state.settings.aliasFallback });
  setState({ index: r.index, indexing: false });
}

export interface SearchHit { path: string; score: number; terms: string[]; match: Record<string, string[]> }
export async function search(q: string, limit = 200): Promise<SearchHit[]> {
  if (!q.trim() || !state.index) return [];
  const r = await call({ type: 'search', q, limit });
  return r.results;
}

/* --------------------------------------------------------------- import */

export interface ScanJob { cancel: () => void; promise: Promise<ScanResult> }
export type Progress = { done: number; total: number; current: string };

export function startScan(source: ImportSource, onProgress: (p: Progress) => void): ScanJob {
  const w = new ImportWorker();
  let reject!: (e: Error) => void;
  const promise = new Promise<ScanResult>((res, rej) => {
    reject = rej;
    w.onmessage = (e) => {
      if (e.data.type === 'progress') onProgress(e.data);
      else if (e.data.type === 'done') { w.terminate(); res(e.data.result); }
      else if (e.data.type === 'error') { w.terminate(); rej(new Error(e.data.error)); }
    };
    w.onerror = (e) => { w.terminate(); rej(new Error(e.message || 'Import worker crashed')); };
  });
  w.postMessage({ source, maxAttachmentBytes: state.settings.maxAttachmentMB * 1048576 });
  return { promise, cancel: () => { w.terminate(); reject(new Error('Import cancelled')); } };
}

export interface PlanFile { rawPath: string; path: string | null; kind: 'note' | 'attachment'; hash: string; destChoices?: string[]; destReason?: string }

export interface ImportPlan {
  mode: ImportMode;
  scan: ScanResult;
  stripRoot: boolean;
  files: PlanFile[];
  diff: ImportDiff;
  /** add-update with loose files needing a destination */
  needsDestination: PlanFile[];
  duplicatesInSource: string[];
}

export function hasStructure(scan: ScanResult) {
  return [...scan.notes.map((n) => n.rawPath), ...scan.attachments.map((a) => a.rawPath)].some((p) => p.includes('/'));
}

function existingFiles(): DiffInputFile[] {
  if (!state.vault) return [];
  return state.vault.manifest.map((m) => ({ path: m.path, hash: m.hash, kind: m.kind }));
}

export function suggestStripRoot(scan: ScanResult, mode: ImportMode): boolean {
  if (!scan.root) return false;
  if (mode === 'new-vault' || !state.vault) return true;
  const ex = new Set(existingFiles().map((f) => f.path));
  const all = [...scan.notes.map((n) => n.rawPath), ...scan.attachments.map((a) => a.rawPath)];
  const strip = all.filter((p) => ex.has(p.slice(scan.root!.length + 1))).length;
  const keep = all.filter((p) => ex.has(p)).length;
  if (strip !== keep) return strip > keep;
  if (scan.hasObsidianDir || scan.root === state.vault.rootName) return true;
  return !ex.size || ![...ex].some((p) => p.startsWith(scan.root + '/'));
}

export function buildPlan(scan: ScanResult, mode: ImportMode, stripRoot: boolean, destOverrides: Record<string, string> = {}): ImportPlan {
  const rel = (p: string) => (stripRoot && scan.root ? p.slice(scan.root.length + 1) : p);
  const exNotes = [...state.vault?.manifest ?? []].filter((m) => m.kind === 'note');
  const exAtts = [...state.vault?.manifest ?? []].filter((m) => m.kind === 'attachment');
  const structured = hasStructure(scan);
  const needsDestination: PlanFile[] = [];
  const files: PlanFile[] = [];
  const mk = (rawPath: string, kind: 'note' | 'attachment', hash: string): PlanFile => {
    let path: string | null = rel(rawPath);
    let destChoices: string[] | undefined;
    let destReason: string | undefined;
    if (mode === 'add-update' && !structured) {
      const pool = kind === 'note' ? exNotes : exAtts;
      const same = pool.filter((m) => basename(m.path).toLowerCase() === basename(rawPath).toLowerCase()).map((m) => m.path);
      if (destOverrides[rawPath] !== undefined) path = destOverrides[rawPath];
      else if (same.length === 1) path = same[0];
      else { path = null; destChoices = same; destReason = same.length ? `${same.length} existing files share this name` : 'New file — folder unknown'; }
      if (same.length === 1 && destOverrides[rawPath] === undefined) destReason = 'Matches one existing file by name';
      destChoices ??= same;
    }
    const f: PlanFile = { rawPath, path, kind, hash, destChoices, destReason };
    if (mode === 'add-update' && !structured) needsDestination.push(f);
    return f;
  };
  scan.notes.forEach((n) => files.push(mk(n.rawPath, 'note', n.hash)));
  scan.attachments.forEach((a) => files.push(mk(a.rawPath, 'attachment', a.hash)));
  const seen = new Map<string, number>();
  files.forEach((f) => f.path && seen.set(f.path, (seen.get(f.path) ?? 0) + 1));
  const duplicatesInSource = [...seen.entries()].filter(([, c]) => c > 1).map(([p]) => p);
  const incoming = files.filter((f) => f.path).map((f) => ({ path: f.path!, hash: f.hash, kind: f.kind }));
  const diff = computeDiff(mode === 'new-vault' ? [] : existingFiles(), incoming, mode);
  return { mode, scan, stripRoot, files, diff, needsDestination, duplicatesInSource };
}

export interface ApplyOptions {
  vaultName?: string;
  persistContent: boolean;
  /** For replace-snapshot: what to do with files missing from the new snapshot. */
  missingAction: 'keep' | 'remove';
  acceptedMoves: MoveCandidate[];
  isDemo?: boolean;
}

export async function applyPlan(plan: ImportPlan, opts: ApplyOptions): Promise<ImportLog> {
  const db = await openAtlasDB();
  const now = Date.now();
  let vault: VaultRecord;
  const fresh = plan.mode === 'new-vault';
  if (fresh) {
    vault = {
      id: opts.isDemo ? 'demo-' + uid() : uid(), name: opts.vaultName || plan.scan.root || 'My vault', isDemo: opts.isDemo,
      createdAt: now, persistContent: opts.persistContent, manifest: [], inventory: [], ignoredCount: 0, rootName: plan.scan.root ?? undefined,
    };
  } else {
    vault = { ...state.vault! };
    vault.persistContent = opts.persistContent;
  }
  const oldNotes = fresh ? new Map<string, NoteRecord>() : new Map(state.notes);
  const oldAtts = fresh ? new Map<string, AttachmentRecord>() : new Map(state.attachments);
  const oldManifest = new Map((fresh ? [] : vault.manifest).map((m) => [m.path, m]));
  const notes = new Map(oldNotes);
  const atts = new Map(oldAtts);
  const moveMap: Record<string, string> = {};
  for (const m of opts.acceptedMoves) moveMap[m.from] = m.to;

  const scanNote = new Map(plan.scan.notes.map((n) => [n.rawPath, n]));
  const scanAtt = new Map(plan.scan.attachments.map((a) => [a.rawPath, a]));
  const counts = { added: plan.diff.added.length, changed: plan.diff.changed.length, unchanged: plan.diff.unchanged.length, missing: plan.diff.missing.length, failed: plan.scan.failed.length, skipped: plan.scan.skipped.length, ignored: plan.scan.ignored.length, removed: 0, moved: opts.acceptedMoves.length };
  const changedPaths = new Set([...plan.diff.added, ...plan.diff.changed].map((f) => f.path));

  for (const f of plan.files) {
    if (!f.path) continue;
    const prevPath = Object.keys(moveMap).find((k) => moveMap[k] === f.path);
    if (f.kind === 'note') {
      const s = scanNote.get(f.rawPath)!;
      const old = oldNotes.get(f.path) ?? (prevPath ? oldNotes.get(prevPath) : undefined);
      const unchanged = !changedPaths.has(f.path) && old && old.hash === s.hash;
      notes.set(f.path, {
        vaultId: vault.id, path: f.path, name: noteName(f.path), folder: dirname(f.path), content: s.content, hash: s.hash, size: s.size,
        sourceMtime: s.mtime, sourceMtimeKind: s.mtimeKind, parsed: s.parsed,
        firstImportedAt: old?.firstImportedAt ?? now, contentUpdatedAt: unchanged ? old!.contentUpdatedAt : now,
      });
    } else {
      const s = scanAtt.get(f.rawPath)!;
      const old = oldAtts.get(f.path) ?? (prevPath ? oldAtts.get(prevPath) : undefined);
      const unchanged = !changedPaths.has(f.path) && old && old.hash === s.hash;
      atts.set(f.path, {
        vaultId: vault.id, path: f.path, name: basename(f.path), folder: dirname(f.path), media: s.media, mime: s.mime, size: s.size, hash: s.hash, blob: s.blob,
        sourceMtime: s.mtime, firstImportedAt: old?.firstImportedAt ?? now, contentUpdatedAt: unchanged ? old!.contentUpdatedAt : now,
      });
    }
  }
  // Missing files (replace-snapshot only)
  const removed: { path: string; kind: 'note' | 'attachment' }[] = [];
  for (const m of plan.diff.missing) {
    const map = m.kind === 'note' ? notes : atts;
    if (moveMap[m.path] || opts.missingAction === 'remove') {
      map.delete(m.path);
      removed.push({ path: m.path, kind: m.kind });
      counts.removed++;
    } else {
      const rec = map.get(m.path);
      if (rec) map.set(m.path, { ...rec, missing: true } as any);
    }
  }
  if (plan.mode === 'replace-snapshot') {
    // Clear missing flag for files that are back.
    for (const f of plan.files) {
      if (!f.path) continue;
      const map = f.kind === 'note' ? notes : atts;
      const r = map.get(f.path);
      if (r && (r as any).missing) map.set(f.path, { ...r, missing: false } as any);
    }
  }

  // Manifest (paths + hashes of what is currently imported, incl. kept-missing ones so they keep being reported).
  const manifest = new Map(oldManifest);
  removed.forEach((r) => manifest.delete(r.path));
  for (const f of plan.files) if (f.path) manifest.set(f.path, { path: f.path, hash: f.hash, size: f.kind === 'note' ? scanNote.get(f.rawPath)!.size : scanAtt.get(f.rawPath)!.size, kind: f.kind });
  vault.manifest = [...manifest.values()];
  const rel = (p: string) => (plan.stripRoot && plan.scan.root ? p.slice(plan.scan.root.length + 1) : p);
  const inv = [...plan.scan.unsupported, ...plan.scan.skipped].map((i) => ({ ...i, path: rel(i.path) }));
  vault.inventory = plan.mode === 'add-update' ? [...vault.inventory.filter((i) => !inv.some((x) => x.path === i.path)), ...inv] : inv;
  vault.ignoredCount = plan.mode === 'add-update' ? vault.ignoredCount : plan.scan.ignored.length;
  vault.lastImportAt = now;
  if (plan.scan.root && plan.stripRoot) vault.rootName ??= plan.scan.root;

  // App-only data: remap accepted moves; never deleted here.
  let app = fresh ? defaultAppData(vault.id) : state.app ?? defaultAppData(vault.id);
  let boards = fresh ? [] : state.boards;
  let views = fresh ? [] : state.views;
  if (opts.acceptedMoves.length) {
    const r = applyMovesToAppData(moveMap, app, boards, views);
    app = r.app; boards = r.boards; views = r.views;
  }

  const log: ImportLog = { id: uid(), vaultId: vault.id, at: now, mode: plan.mode, sourceLabel: plan.scan.label, counts, failed: plan.scan.failed.map((f) => ({ ...f, path: rel(f.path) })) };

  // Persist
  const tx = db.transaction(['vaults', 'notes', 'attachments', 'appdata', 'boards', 'views', 'imports'], 'readwrite');
  tx.objectStore('vaults').put(vault);
  if (vault.persistContent) {
    const ns = tx.objectStore('notes');
    const as = tx.objectStore('attachments');
    for (const f of plan.files) {
      if (!f.path) continue;
      if (f.kind === 'note') ns.put(notes.get(f.path)!);
      else as.put(atts.get(f.path)!);
    }
    for (const r of removed) (r.kind === 'note' ? ns : as).delete([vault.id, r.path]);
    for (const m of plan.diff.missing) if (!removed.some((r) => r.path === m.path)) {
      const rec = (m.kind === 'note' ? notes : atts).get(m.path);
      if (rec) (m.kind === 'note' ? ns : as).put(rec as any);
    }
  }
  tx.objectStore('appdata').put(app);
  boards.forEach((b) => tx.objectStore('boards').put(b));
  views.forEach((v) => tx.objectStore('views').put(v));
  tx.objectStore('imports').put(log);
  await tx.done;
  if (vault.persistContent && opts.persistContent) requestPersistence().then((p) => setState({ persistence: p }));

  if (fresh || state.vault?.id !== vault.id) clearUrls();
  else removed.forEach((r) => { const u = urlCache.get(r.path); if (u) { URL.revokeObjectURL(u); urlCache.delete(r.path); } });
  for (const f of plan.files) if (f.kind === 'attachment' && f.path && urlCache.has(f.path)) { URL.revokeObjectURL(urlCache.get(f.path)!); urlCache.delete(f.path); }
  const vaults = [...state.vaults.filter((v) => v.id !== vault.id), vault];
  setState({ vault, vaults, notes, attachments: atts, contentLoaded: true, app, boards, views, imports: [log, ...(fresh ? [] : state.imports)] });
  saveSettings({ currentVaultId: vault.id });
  await reindex();
  return log;
}

/* ----------------------------------------------------- app-only data */

async function putApp(app: VaultAppData) {
  setState({ app });
  try { await (await openAtlasDB()).put('appdata', app); } catch { /* ignore */ }
}
export function toggleFavorite(path: string) {
  const app = state.app!;
  const favorites = app.favorites.includes(path) ? app.favorites.filter((p) => p !== path) : [path, ...app.favorites];
  putApp({ ...app, favorites });
}
export function recordOpen(path: string) {
  const app = state.app;
  if (!app) return;
  const recents = [{ path, at: Date.now() }, ...app.recents.filter((r) => r.path !== path)].slice(0, 30);
  putApp({ ...app, recents });
}
export function setDashboard(dashboard: VaultAppData['dashboard']) { putApp({ ...state.app!, dashboard }); }
export function setFrozen(pos?: Record<string, [number, number]>) { putApp({ ...state.app!, frozenPositions: pos }); }
export function setObsidianVaultName(name: string) { putApp({ ...state.app!, obsidianVaultName: name }); }

export async function saveBoard(b: Board) {
  const boards = [b, ...state.boards.filter((x) => x.id !== b.id)];
  setState({ boards });
  await (await openAtlasDB()).put('boards', b);
}
export async function deleteBoard(id: string) {
  setState({ boards: state.boards.filter((b) => b.id !== id) });
  await (await openAtlasDB()).delete('boards', id);
}
export async function saveView(v: GraphView) {
  setState({ views: [v, ...state.views.filter((x) => x.id !== v.id)] });
  await (await openAtlasDB()).put('views', v);
}
export async function deleteView(id: string) {
  setState({ views: state.views.filter((v) => v.id !== id) });
  await (await openAtlasDB()).delete('views', id);
}

export function dangling() {
  if (!state.vault || !state.contentLoaded) return [];
  return findDangling(new Set([...state.notes.values()].filter((n) => !n.missing).map((n) => n.path)), state.app, state.boards, state.views);
}

/** Re-point (or drop) a saved association that refers to a note no longer in the snapshot. */
export async function remapReference(from: string, to: string | null) {
  if (to) {
    const r = applyMovesToAppData({ [from]: to }, state.app!, state.boards, state.views);
    await putApp(r.app);
    for (const id of r.changedBoards) await saveBoard(r.boards.find((b) => b.id === id)!);
    for (const id of r.changedViews) await saveView(r.views.find((v) => v.id === id)!);
  } else {
    const app = state.app!;
    await putApp({ ...app, favorites: app.favorites.filter((p) => p !== from), recents: app.recents.filter((r) => r.path !== from) });
    for (const b of state.boards) if (b.cards.some((c) => c.notePath === from)) {
      const gone = new Set(b.cards.filter((c) => c.notePath === from).map((c) => c.id));
      await saveBoard({ ...b, cards: b.cards.filter((c) => !gone.has(c.id)), links: b.links.filter((l) => !gone.has(l.from) && !gone.has(l.to)), updatedAt: Date.now() });
    }
    for (const v of state.views) if (v.center === from) await saveView({ ...v, center: undefined, mode: 'full' });
  }
}

/** Remove notes that are flagged missing (kept from older snapshots), after the user reviewed them. */
export async function cleanupMissing(paths: string[]) {
  const db = await openAtlasDB();
  const notes = new Map(state.notes);
  const atts = new Map(state.attachments);
  const vault = { ...state.vault! };
  const set = new Set(paths);
  const tx = db.transaction(['notes', 'attachments', 'vaults'], 'readwrite');
  for (const p of paths) {
    if (notes.delete(p)) tx.objectStore('notes').delete([vault.id, p]);
    if (atts.delete(p)) tx.objectStore('attachments').delete([vault.id, p]);
  }
  vault.manifest = vault.manifest.filter((m) => !set.has(m.path));
  tx.objectStore('vaults').put(vault);
  await tx.done;
  setState({ notes, attachments: atts, vault, vaults: state.vaults.map((v) => (v.id === vault.id ? vault : v)) });
  await reindex();
}

export async function setPersistContent(on: boolean) {
  const db = await openAtlasDB();
  const vault = { ...state.vault!, persistContent: on };
  const tx = db.transaction(['notes', 'attachments', 'vaults'], 'readwrite');
  if (on) {
    state.notes.forEach((n) => tx.objectStore('notes').put(n));
    state.attachments.forEach((a) => tx.objectStore('attachments').put(a));
  } else {
    for (const k of await tx.objectStore('notes').index('byVault').getAllKeys(vault.id)) tx.objectStore('notes').delete(k);
    for (const k of await tx.objectStore('attachments').index('byVault').getAllKeys(vault.id)) tx.objectStore('attachments').delete(k);
  }
  tx.objectStore('vaults').put(vault);
  await tx.done;
  setState({ vault, vaults: state.vaults.map((v) => (v.id === vault.id ? vault : v)) });
  if (on) requestPersistence().then((p) => setState({ persistence: p }));
}

export async function deleteVault(id: string) {
  const db = await openAtlasDB();
  const tx = db.transaction(['vaults', 'notes', 'attachments', 'appdata', 'boards', 'views', 'imports'], 'readwrite');
  tx.objectStore('vaults').delete(id);
  for (const s of ['notes', 'attachments', 'boards', 'views', 'imports'] as const) {
    const st = tx.objectStore(s);
    for (const k of await st.index('byVault').getAllKeys(id)) st.delete(k as any);
  }
  tx.objectStore('appdata').delete(id);
  await tx.done;
  const vaults = state.vaults.filter((v) => v.id !== id);
  clearUrls();
  setState({ vaults, vault: undefined, notes: new Map(), attachments: new Map(), index: undefined, app: undefined, boards: [], views: [], imports: [], contentLoaded: false });
  const next = vaults.find((v) => !v.isDemo) ?? vaults[0];
  if (next) await openVault(next.id);
  else saveSettings({ currentVaultId: undefined });
}

export async function deleteAllLocalData() {
  clearUrls();
  indexWorker?.terminate();
  indexWorker = null;
  await deleteEverything();
  try {
    for (const k of await caches.keys()) if (!k.startsWith('workbox-precache')) await caches.delete(k);
  } catch { /* ignore */ }
  setState({ vaults: [], vault: undefined, notes: new Map(), attachments: new Map(), index: undefined, app: undefined, boards: [], views: [], imports: [], contentLoaded: false, settings: DEFAULT_SETTINGS });
}

/* ------------------------------------------------- export / import app data */

export const APPDATA_FORMAT = 'vault-atlas-appdata';
export interface AppDataExport {
  format: typeof APPDATA_FORMAT;
  version: 1;
  exportedAt: string;
  note: string;
  settings: Settings;
  vaults: { id: string; name: string; rootName?: string; isDemo?: boolean; app: VaultAppData; boards: Board[]; views: GraphView[] }[];
}

export async function exportAppData(): Promise<AppDataExport> {
  const db = await openAtlasDB();
  const vaults = await db.getAll('vaults');
  const out: AppDataExport = {
    format: APPDATA_FORMAT, version: 1, exportedAt: new Date().toISOString(),
    note: 'Vault Atlas app-only data: settings, pinned notes, reading history, dashboard layout, saved graph views and boards. This is NOT a backup of your Obsidian notes; it contains note paths but no note content.',
    settings: state.settings, vaults: [],
  };
  for (const v of vaults) {
    out.vaults.push({
      id: v.id, name: v.name, rootName: v.rootName, isDemo: v.isDemo,
      app: (await db.get('appdata', v.id)) ?? defaultAppData(v.id),
      boards: await db.getAllFromIndex('boards', 'byVault', v.id),
      views: await db.getAllFromIndex('views', 'byVault', v.id),
    });
  }
  return out;
}

/** Restores app-only data. Vaults that don't exist on this device become empty placeholders awaiting a ZIP import. */
export async function importAppData(data: AppDataExport, target?: { fromVaultId: string; toVaultId: string }) {
  if (data?.format !== APPDATA_FORMAT) throw new Error('This file is not a Vault Atlas settings export.');
  const db = await openAtlasDB();
  const existing = new Map((await db.getAll('vaults')).map((v) => [v.id, v]));
  let restored = 0;
  for (const v of data.vaults) {
    if (target && v.id !== target.fromVaultId) continue;
    const id = target ? target.toVaultId : v.id;
    if (!existing.has(id)) {
      await db.put('vaults', { id, name: v.name, rootName: v.rootName, isDemo: v.isDemo, createdAt: Date.now(), persistContent: state.settings.persistDefault, manifest: [], inventory: [], ignoredCount: 0 });
    }
    await db.put('appdata', { ...defaultAppData(id), ...v.app, vaultId: id });
    for (const b of v.boards) await db.put('boards', { ...b, vaultId: id });
    for (const g of v.views) await db.put('views', { ...g, vaultId: id });
    restored++;
  }
  const { currentVaultId: _ignored, ...rest } = data.settings ?? {};
  await saveSettings({ ...rest });
  const vaults = await db.getAll('vaults');
  setState({ vaults });
  if (state.vault) await openVault(state.vault.id);
  else if (vaults[0]) await openVault(vaults[0].id);
  return restored;
}
