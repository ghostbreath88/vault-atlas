import { buildResolver, isResolvedAttachment, isResolvedNote, type ResolvedLink } from './resolver';
import type { ParsedNote } from './types';

export interface IndexNoteInput { path: string; name: string; folder: string; parsed: ParsedNote; missing?: boolean }

export interface NoteLinks {
  out: ResolvedLink[];
  /** Unique resolved note targets (excluding self). */
  outNotes: string[];
  inNotes: string[];
  attachments: string[];
}

export interface VaultIndex {
  links: Record<string, NoteLinks>;
  tags: Record<string, { name: string; notes: string[] }>; // key: lowercase full tag; includes parent tags
  folders: Record<string, number>; // folder -> direct note count ('' = root)
  edges: { source: string; target: string; count: number }[]; // unique directed note->note
  stats: { notes: number; connections: number; tags: number; orphans: number; unresolved: number; ambiguous: number; attachments: number; missing: number };
  orphans: string[];
  diagnostics: { from: string; link: ResolvedLink }[];
  attachmentRefs: Record<string, string[]>; // attachment path -> notes referencing it
}

export function buildIndex(notes: IndexNoteInput[], attachments: string[], unsupported: string[], aliasFallback: boolean): VaultIndex {
  const resolver = buildResolver({ notes, attachments, unsupported, aliasFallback });
  const links: Record<string, NoteLinks> = {};
  const edgeMap = new Map<string, number>();
  const diagnostics: VaultIndex['diagnostics'] = [];
  const attachmentRefs: Record<string, string[]> = {};
  for (const n of notes) links[n.path] = { out: [], outNotes: [], inNotes: [], attachments: [] };

  for (const n of notes) {
    const L = links[n.path];
    const outSet = new Set<string>();
    const attSet = new Set<string>();
    for (const raw of n.parsed.links) {
      const r = resolver.resolve(raw, n.path);
      L.out.push(r);
      if (isResolvedNote(r) && r.targetPath !== n.path) outSet.add(r.targetPath!);
      else if (isResolvedAttachment(r)) attSet.add(r.targetPath!);
      if (r.status === 'unresolved' || r.status === 'ambiguous' || r.status === 'resolved-nearest' || r.status === 'resolved-alias' || r.status === 'unsupported' || r.fragmentFound === false) {
        diagnostics.push({ from: n.path, link: r });
      }
      if (isResolvedNote(r) && r.targetPath !== n.path) {
        const k = n.path + '\u0000' + r.targetPath;
        edgeMap.set(k, (edgeMap.get(k) ?? 0) + 1);
      }
    }
    L.outNotes = [...outSet];
    L.attachments = [...attSet];
    for (const a of attSet) (attachmentRefs[a] ??= []).push(n.path);
  }
  for (const n of notes) for (const t of links[n.path].outNotes) links[t]?.inNotes.push(n.path);

  const tags: VaultIndex['tags'] = {};
  for (const n of notes) {
    const seen = new Set<string>();
    for (const t of n.parsed.tags) {
      const parts = t.split('/');
      for (let i = 1; i <= parts.length; i++) {
        const name = parts.slice(0, i).join('/');
        const key = name.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        (tags[key] ??= { name, notes: [] }).notes.push(n.path);
      }
    }
  }
  const folders: Record<string, number> = {};
  for (const n of notes) folders[n.folder] = (folders[n.folder] ?? 0) + 1;

  const edges = [...edgeMap.entries()].map(([k, count]) => {
    const [source, target] = k.split('\u0000');
    return { source, target, count };
  });
  const orphans = notes.filter((n) => !links[n.path].outNotes.length && !links[n.path].inNotes.length).map((n) => n.path);
  const undirected = new Set(edges.map((e) => (e.source < e.target ? e.source + '\u0000' + e.target : e.target + '\u0000' + e.source)));
  return {
    links,
    tags,
    folders,
    edges,
    orphans,
    diagnostics,
    attachmentRefs,
    stats: {
      notes: notes.length,
      connections: undirected.size,
      tags: Object.keys(tags).length,
      orphans: orphans.length,
      unresolved: diagnostics.filter((d) => d.link.status === 'unresolved').length,
      ambiguous: diagnostics.filter((d) => d.link.status === 'ambiguous').length,
      attachments: attachments.length,
      missing: notes.filter((n) => n.missing).length,
    },
  };
}
