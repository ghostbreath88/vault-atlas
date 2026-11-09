import Graph from 'graphology';
import type { VaultIndex } from './indexer';
import type { GraphFilters, NoteRecord } from './types';
import { basename, stripMd } from './paths';

export const DEFAULT_FILTERS: GraphFilters = {
  folders: [], tags: [], tagMode: 'or', showTags: false, showAttachments: false, showUnresolved: false, showOrphans: true,
  colorBy: 'folder', sizeByDegree: true, arrows: false, labels: 'adaptive',
};

// Neon rainbow, kept distinguishable; tags/attachments/unresolved use separate shapes-of-colour below.
export const PALETTE = ['#ff4fd8', '#35e8ff', '#8cff66', '#ffa04d', '#b195ff', '#48ffc8', '#6f9bff', '#ff6f9f', '#d4ff4a', '#f7a8ff'];
export const COLORS = { tag: '#ffe45c', attachment: '#c8b7a6', unresolved: '#ff3355', linkEdge: 'rgba(201,251,227,0.45)', tagEdge: 'rgba(255,228,92,0.5)', attEdge: 'rgba(200,183,166,0.45)', unresEdge: 'rgba(255,51,85,0.5)', neutral: '#9ad9bd' };

export type NodeKind = 'note' | 'tag' | 'attachment' | 'unresolved';
export type EdgeKind = 'link' | 'tag' | 'tag-parent' | 'attachment' | 'unresolved';

export interface BuildOpts {
  mode: 'full' | 'local';
  center?: string;
  depth: number;
  filters: GraphFilters;
  limit: number;
}

export interface BuiltGraph {
  graph: Graph;
  legend: { label: string; color: string }[];
  truncated?: { shown: number; total: number };
  noteCount: number;
}

function hash(s: string) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function seedPos(key: string): [number, number] {
  const h = hash(key), a = (h % 3600) / 3600 * Math.PI * 2, r = 10 + ((h >>> 12) % 1000) / 10;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

export function buildGraph(index: VaultIndex, notes: Map<string, NoteRecord>, o: BuildOpts, frozen?: Record<string, [number, number]>): BuiltGraph {
  const f = o.filters;
  const g = new Graph({ type: 'directed', multi: false, allowSelfLoops: false });
  const orphanSet = new Set(index.orphans);
  // 1) choose notes
  let chosen: string[];
  if (o.mode === 'local' && o.center && index.links[o.center]) {
    const seen = new Map<string, number>([[o.center, 0]]);
    let frontier = [o.center];
    for (let d = 1; d <= o.depth; d++) {
      const next: string[] = [];
      for (const p of frontier) {
        const L = index.links[p];
        for (const q of [...L.outNotes, ...L.inNotes]) if (!seen.has(q)) { seen.set(q, d); next.push(q); }
      }
      frontier = next;
    }
    chosen = [...seen.keys()];
  } else {
    chosen = Object.keys(index.links);
  }
  // 2) filters (the local-graph center is always kept)
  const tagSets = f.tags.map((t) => new Set(index.tags[t.toLowerCase()]?.notes ?? []));
  chosen = chosen.filter((p) => {
    if (p === o.center && o.mode === 'local') return true;
    const n = notes.get(p);
    if (!n) return false;
    if (f.folders.length && !f.folders.some((fd) => (fd === '/' ? n.folder === '' : n.folder === fd || n.folder.startsWith(fd + '/')))) return false;
    if (tagSets.length && !(f.tagMode === 'and' ? tagSets.every((s) => s.has(p)) : tagSets.some((s) => s.has(p)))) return false;
    if (!f.showOrphans && orphanSet.has(p)) return false;
    return true;
  });
  const total = chosen.length;
  let truncated: BuiltGraph['truncated'];
  if (chosen.length > o.limit) {
    const deg = (p: string) => index.links[p].inNotes.length + index.links[p].outNotes.length;
    chosen = chosen.sort((a, b) => deg(b) - deg(a)).slice(0, o.limit);
    if (o.center && !chosen.includes(o.center)) chosen[chosen.length - 1] = o.center;
    truncated = { shown: chosen.length, total };
  }
  const chosenSet = new Set(chosen);

  // 3) colors
  const groupOf = (p: string): string => {
    const n = notes.get(p)!;
    if (f.colorBy === 'folder') return n.folder ? n.folder.split('/')[0] : '(root)';
    if (f.colorBy === 'tag') return n.parsed.tags[0]?.split('/')[0] ?? '(untagged)';
    return 'note';
  };
  const counts = new Map<string, number>();
  chosen.forEach((p) => { const k = groupOf(p); counts.set(k, (counts.get(k) ?? 0) + 1); });
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const colorMap = new Map<string, string>();
  ranked.forEach((k, i) => colorMap.set(k, f.colorBy === 'none' ? COLORS.neutral : i < PALETTE.length - 1 ? PALETTE[i] : COLORS.neutral));
  const legend = f.colorBy === 'none' ? [] : ranked.slice(0, PALETTE.length - 1).map((k) => ({ label: f.colorBy === 'tag' && !k.startsWith('(') ? '#' + k : k, color: colorMap.get(k)! }));
  if (f.colorBy !== 'none' && ranked.length > PALETTE.length - 1) legend.push({ label: `${ranked.length - PALETTE.length + 1} more (grey)`, color: COLORS.neutral });

  const pos = (key: string): [number, number] => frozen?.[key] ?? seedPos(key);
  for (const p of chosen) {
    const n = notes.get(p)!;
    const L = index.links[p];
    const degree = L.inNotes.length + L.outNotes.length;
    const [x, y] = pos('note:' + p);
    g.addNode('note:' + p, {
      x, y, kind: 'note', path: p, label: n.name, degree, group: groupOf(p), color: colorMap.get(groupOf(p)) ?? COLORS.neutral,
      size: f.sizeByDegree ? Math.min(4 + Math.sqrt(degree) * 2.6, 22) : 6, missing: !!n.missing, orphan: orphanSet.has(p),
    });
  }
  // 4) note -> note edges (actual links only)
  for (const e of index.edges) {
    if (!chosenSet.has(e.source) || !chosenSet.has(e.target)) continue;
    const s = 'note:' + e.source, t = 'note:' + e.target;
    const reverse = g.hasEdge(t, s);
    g.addEdgeWithKey(`l:${e.source}\u0000${e.target}`, s, t, { kind: 'link', count: e.count, color: COLORS.linkEdge, size: Math.min(1 + Math.log2(e.count), 3), type: f.arrows ? 'arrow' : 'line', mutual: reverse });
  }
  // 5) tag nodes (membership is NOT a note-to-note link)
  if (f.showTags) {
    const used = new Set<string>();
    for (const p of chosen) {
      for (const t of notes.get(p)!.parsed.tags) {
        const key = 'tag:' + t.toLowerCase();
        if (!g.hasNode(key)) { const [x, y] = pos(key); g.addNode(key, { x, y, kind: 'tag', label: '#' + t, color: COLORS.tag, size: 5, tag: t }); }
        used.add(t.toLowerCase());
        const ek = `t:${p}\u0000${t.toLowerCase()}`;
        if (!g.hasEdge(ek)) g.addEdgeWithKey(ek, 'note:' + p, key, { kind: 'tag', color: COLORS.tagEdge, size: 0.8, type: 'curved' });
      }
    }
    // nested tag hierarchy: child tag -> parent tag
    for (const t of [...used]) {
      const parts = t.split('/');
      for (let i = parts.length - 1; i >= 1; i--) {
        const child = 'tag:' + parts.slice(0, i + 1).join('/');
        const parent = 'tag:' + parts.slice(0, i).join('/');
        if (!g.hasNode(parent)) { const [x, y] = pos(parent); g.addNode(parent, { x, y, kind: 'tag', label: '#' + index.tags[parts.slice(0, i).join('/')]?.name, color: COLORS.tag, size: 5, tag: index.tags[parts.slice(0, i).join('/')]?.name }); }
        const ek = `tp:${child}\u0000${parent}`;
        if (g.hasNode(child) && !g.hasEdge(ek)) g.addEdgeWithKey(ek, child, parent, { kind: 'tag-parent', color: COLORS.tagEdge, size: 0.8, type: 'curved' });
      }
    }
    g.forEachNode((k, a) => { if (a.kind === 'tag') g.setNodeAttribute(k, 'size', Math.min(4 + Math.sqrt(g.degree(k)) * 1.8, 16)); });
  }
  if (f.showAttachments) {
    for (const p of chosen) for (const a of index.links[p].attachments) {
      const key = 'att:' + a;
      if (!g.hasNode(key)) { const [x, y] = pos(key); g.addNode(key, { x, y, kind: 'attachment', label: basename(a), color: COLORS.attachment, size: 4, path: a }); }
      g.mergeEdgeWithKey(`a:${p}\u0000${a}`, 'note:' + p, key, { kind: 'attachment', color: COLORS.attEdge, size: 0.8, type: 'line' });
    }
  }
  if (f.showUnresolved) {
    for (const p of chosen) for (const l of index.links[p].out) {
      if (l.status !== 'unresolved' && l.status !== 'ambiguous') continue;
      if (l.embed && l.status === 'unresolved' && /\.[a-z0-9]{2,5}$/i.test(l.target)) { /* missing attachment — still show */ }
      const key = 'unres:' + l.target.toLowerCase();
      if (!g.hasNode(key)) { const [x, y] = pos(key); g.addNode(key, { x, y, kind: 'unresolved', label: stripMd(l.target) + (l.status === 'ambiguous' ? ' (ambiguous)' : ' (unresolved)'), color: COLORS.unresolved, size: 4, target: l.target, ambiguous: l.status === 'ambiguous', candidates: l.candidates }); }
      g.mergeEdgeWithKey(`u:${p}\u0000${key}`, 'note:' + p, key, { kind: 'unresolved', color: COLORS.unresEdge, size: 0.8, type: f.arrows ? 'arrow' : 'line' });
    }
  }
  return { graph: g, legend, truncated, noteCount: chosen.length };
}
