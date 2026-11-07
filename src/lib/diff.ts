import { basename } from './paths';
import type { Board, GraphView, ImportMode, VaultAppData } from './types';

export interface DiffInputFile { path: string; hash: string; kind: 'note' | 'attachment' }

export interface MoveCandidate { from: string; to: string; reason: 'identical-content' | 'same-filename'; kind: 'note' | 'attachment' }

export interface ImportDiff {
  mode: ImportMode;
  added: DiffInputFile[];
  changed: DiffInputFile[];
  unchanged: DiffInputFile[];
  missing: DiffInputFile[];
  moves: MoveCandidate[];
}

export function computeDiff(existing: DiffInputFile[], incoming: DiffInputFile[], mode: ImportMode): ImportDiff {
  const ex = new Map(existing.map((f) => [f.path, f]));
  const inc = new Map(incoming.map((f) => [f.path, f]));
  const added: DiffInputFile[] = [];
  const changed: DiffInputFile[] = [];
  const unchanged: DiffInputFile[] = [];
  for (const f of incoming) {
    const old = ex.get(f.path);
    if (!old) added.push(f);
    else if (old.hash !== f.hash) changed.push(f);
    else unchanged.push(f);
  }
  const missing = mode === 'replace-snapshot' ? existing.filter((f) => !inc.has(f.path)) : [];
  const moves: MoveCandidate[] = [];
  if (missing.length && added.length) {
    const addedByHash = new Map<string, DiffInputFile[]>();
    const addedByName = new Map<string, DiffInputFile[]>();
    for (const a of added) {
      addedByHash.set(a.kind + a.hash, [...(addedByHash.get(a.kind + a.hash) ?? []), a]);
      const n = a.kind + basename(a.path).toLowerCase();
      addedByName.set(n, [...(addedByName.get(n) ?? []), a]);
    }
    const used = new Set<string>();
    for (const m of missing) {
      const h = (addedByHash.get(m.kind + m.hash) ?? []).filter((a) => !used.has(a.path));
      if (h.length === 1) { moves.push({ from: m.path, to: h[0].path, reason: 'identical-content', kind: m.kind }); used.add(h[0].path); continue; }
      const nm = (addedByName.get(m.kind + basename(m.path).toLowerCase()) ?? []).filter((a) => !used.has(a.path));
      if (nm.length === 1) { moves.push({ from: m.path, to: nm[0].path, reason: 'same-filename', kind: m.kind }); used.add(nm[0].path); }
    }
  }
  return { mode, added, changed, unchanged, missing, moves };
}

/** Remap app-only associations from old note paths to new ones. Returns new copies. */
export function applyMovesToAppData(
  map: Record<string, string>,
  app: VaultAppData,
  boards: Board[],
  views: GraphView[],
): { app: VaultAppData; boards: Board[]; views: GraphView[]; changedBoards: string[]; changedViews: string[] } {
  const r = (p: string) => map[p] ?? p;
  const remapPos = (pos?: Record<string, [number, number]>) => {
    if (!pos) return pos;
    const out: Record<string, [number, number]> = {};
    for (const [k, v] of Object.entries(pos)) out[k.startsWith('note:') ? 'note:' + r(k.slice(5)) : k] = v;
    return out;
  };
  const now = Date.now();
  const nextApp: VaultAppData = {
    ...app,
    favorites: [...new Set(app.favorites.map(r))],
    recents: app.recents.map((x) => ({ ...x, path: r(x.path) })),
    frozenPositions: remapPos(app.frozenPositions),
    moves: [...app.moves, ...Object.entries(map).map(([from, to]) => ({ from, to, at: now }))],
  };
  const changedBoards: string[] = [];
  const nextBoards = boards.map((b) => {
    if (!b.cards.some((c) => map[c.notePath])) return b;
    changedBoards.push(b.id);
    return { ...b, cards: b.cards.map((c) => (map[c.notePath] ? { ...c, notePath: map[c.notePath] } : c)), updatedAt: now };
  });
  const changedViews: string[] = [];
  const nextViews = views.map((v) => {
    const hit = (v.center && map[v.center]) || (v.positions && Object.keys(v.positions).some((k) => map[k.slice(5)]));
    if (!hit) return v;
    changedViews.push(v.id);
    return { ...v, center: v.center ? r(v.center) : v.center, positions: remapPos(v.positions) };
  });
  return { app: nextApp, boards: nextBoards, views: nextViews, changedBoards, changedViews };
}

export interface DanglingRef { path: string; where: string[] }

/** App-only references (favorites, boards, views) pointing to notes not in the current snapshot. */
export function findDangling(notePaths: Set<string>, app: VaultAppData | undefined, boards: Board[], views: GraphView[]): DanglingRef[] {
  const m = new Map<string, Set<string>>();
  const add = (p: string, w: string) => { if (!notePaths.has(p)) (m.get(p) ?? m.set(p, new Set()).get(p)!).add(w); };
  app?.favorites.forEach((p) => add(p, 'Pinned'));
  app?.recents.forEach((x) => add(x.path, 'Continue reading'));
  boards.forEach((b) => b.cards.forEach((c) => add(c.notePath, `Board “${b.name}”`)));
  views.forEach((v) => v.center && add(v.center, `Graph view “${v.name}”`));
  return [...m.entries()].map(([path, w]) => ({ path, where: [...w] })).sort((a, b) => a.path.localeCompare(b.path));
}
