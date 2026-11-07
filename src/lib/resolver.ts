import { basename, dirname, extname, joinPath, normalizePath, stripMd } from './paths';
import { normHeading } from './parser';
import type { ParsedLink, ParsedNote } from './types';

export type ResolutionStatus =
  | 'resolved' // exactly one target
  | 'resolved-nearest' // several same-named files; picked the one in the linking note's folder (Obsidian's rule)
  | 'resolved-alias' // matched a unique alias (only when the user enables alias fallback)
  | 'self' // same-note heading/block link
  | 'ambiguous' // several candidates, no deterministic choice
  | 'unresolved' // nothing matches
  | 'unsupported' // points to a file that exists but is not imported (e.g. .canvas)
  | 'external'; // URL / other scheme

export interface ResolvedLink extends ParsedLink {
  status: ResolutionStatus;
  targetPath?: string;
  targetKind?: 'note' | 'attachment' | 'unsupported';
  candidates?: string[];
  fragmentFound?: boolean;
}

export interface ResolverInput {
  notes: { path: string; parsed: ParsedNote }[];
  attachments: string[];
  unsupported: string[];
  aliasFallback: boolean;
}

const lc = (s: string) => s.toLowerCase();

export function buildResolver(input: ResolverInput) {
  const notePaths = new Set(input.notes.map((n) => n.path));
  const lcNote = new Map<string, string>(); // lowercase full path -> path
  const byName = new Map<string, string[]>(); // lowercase basename without .md -> paths
  const files = new Map<string, { path: string; kind: 'attachment' | 'unsupported' }>();
  const fileByName = new Map<string, string[]>();
  const aliasMap = new Map<string, string[]>();
  const parsedByPath = new Map<string, ParsedNote>();

  for (const n of input.notes) {
    lcNote.set(lc(n.path), n.path);
    const k = lc(stripMd(basename(n.path)));
    byName.set(k, [...(byName.get(k) ?? []), n.path]);
    parsedByPath.set(n.path, n.parsed);
    for (const a of n.parsed.aliases) {
      const ak = lc(a.trim());
      if (!ak) continue;
      const arr = aliasMap.get(ak) ?? [];
      if (!arr.includes(n.path)) arr.push(n.path);
      aliasMap.set(ak, arr);
    }
  }
  const addFile = (p: string, kind: 'attachment' | 'unsupported') => {
    files.set(lc(p), { path: p, kind });
    const k = lc(basename(p));
    fileByName.set(k, [...(fileByName.get(k) ?? []), p]);
  };
  input.attachments.forEach((p) => addFile(p, 'attachment'));
  input.unsupported.forEach((p) => addFile(p, 'unsupported'));

  const pick = (cands: string[], fromFolder: string): { status: ResolutionStatus; path?: string; candidates?: string[] } => {
    if (cands.length === 1) return { status: 'resolved', path: cands[0] };
    if (cands.length === 0) return { status: 'unresolved' };
    const same = cands.filter((c) => dirname(c) === fromFolder);
    if (same.length === 1) return { status: 'resolved-nearest', path: same[0], candidates: cands };
    return { status: 'ambiguous', candidates: [...cands].sort() };
  };

  function checkFragment(path: string, link: ParsedLink): boolean | undefined {
    if (!link.fragment) return undefined;
    const p = parsedByPath.get(path);
    if (!p) return undefined;
    if (link.fragmentType === 'block') return p.blockIds.some((b) => lc(b) === lc(link.fragment!));
    // Nested heading paths "A#B" — check the last segment.
    const last = link.fragment.split('#').pop()!;
    const want = normHeading(last);
    return p.headings.some((h) => normHeading(h.text) === want);
  }

  function resolveNoteOrFile(target: string, fromPath: string, markdownStyle: boolean): Omit<ResolvedLink, keyof ParsedLink> {
    const fromFolder = dirname(fromPath);
    let t = target.trim();
    if (!t) return { status: 'self', targetPath: fromPath, targetKind: 'note' };
    const ext = extname(t);
    const isNoteish = !ext || ext === 'md' || !/^[a-z0-9]{1,6}$/.test(ext) || /\s/.test(ext);
    const explicitRel = /^\.\.?\//.test(t) || markdownStyle;
    const rooted = t.startsWith('/');
    if (rooted) t = t.slice(1);

    // 1) Exact path candidates (relative for markdown/./.., otherwise vault-absolute)
    const exact: string[] = [];
    if (explicitRel && !rooted) exact.push(joinPath(fromFolder, t));
    exact.push(normalizePath(t));
    for (const e of exact) {
      if (isNoteish) {
        const withMd = /\.md$/i.test(e) ? e : `${e}.md`;
        const hit = lcNote.get(lc(withMd));
        if (hit) return { status: 'resolved', targetPath: hit, targetKind: 'note' };
      }
      const f = files.get(lc(e));
      if (f) return f.kind === 'attachment'
        ? { status: 'resolved', targetPath: f.path, targetKind: 'attachment' }
        : { status: 'unsupported', targetPath: f.path, targetKind: 'unsupported' };
    }
    // 2) Name / path-suffix match (Obsidian shortest-path style)
    const norm = normalizePath(t);
    if (isNoteish) {
      const base = lc(stripMd(basename(norm)));
      const suffix = lc(stripMd(norm));
      const cands = (byName.get(base) ?? []).filter((p) => {
        const s = lc(stripMd(p));
        return s === suffix || s.endsWith('/' + suffix);
      });
      if (cands.length) {
        const r = pick(cands, fromFolder);
        return { ...r, targetPath: r.path, targetKind: r.path ? 'note' : undefined };
      }
    }
    const fb = lc(basename(norm));
    const fcands = (fileByName.get(fb) ?? []).filter((p) => lc(p) === lc(norm) || lc(p).endsWith('/' + lc(norm)));
    if (fcands.length) {
      const r = pick(fcands, fromFolder);
      const kind = r.path ? files.get(lc(r.path))!.kind : undefined;
      if (kind === 'unsupported') return { status: 'unsupported', targetPath: r.path, targetKind: 'unsupported' };
      return { status: r.status, targetPath: r.path, candidates: r.candidates, targetKind: kind };
    }

    // 3) Optional alias fallback, only if unambiguous
    if (input.aliasFallback && isNoteish && !norm.includes('/')) {
      const a = aliasMap.get(lc(stripMd(norm)));
      if (a && a.length === 1) return { status: 'resolved-alias', targetPath: a[0], targetKind: 'note' };
      if (a && a.length > 1) return { status: 'ambiguous', candidates: a, targetKind: 'note' };
    }
    return { status: 'unresolved' };
  }

  function resolve(link: ParsedLink, fromPath: string): ResolvedLink {
    if (link.external) return { ...link, status: 'external' };
    const r = resolveNoteOrFile(link.target, fromPath, link.kind === 'markdown');
    const out: ResolvedLink = { ...link, ...r };
    if (out.targetPath && out.targetKind === 'note') out.fragmentFound = checkFragment(out.targetPath, link);
    return out;
  }

  return { resolve, notePaths, aliasMap };
}

export function isResolvedNote(l: ResolvedLink) {
  return (l.status === 'resolved' || l.status === 'resolved-nearest' || l.status === 'resolved-alias') && l.targetKind === 'note';
}
export function isResolvedAttachment(l: ResolvedLink) {
  return (l.status === 'resolved' || l.status === 'resolved-nearest') && l.targetKind === 'attachment';
}
