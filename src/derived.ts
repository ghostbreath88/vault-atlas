import { useMemo } from 'react';
import { buildResolver } from './lib/resolver';
import { getState, useStore, attachmentUrl } from './store';
import type { RenderCtx } from './lib/markdown';

let cache: { key: unknown; r: ReturnType<typeof buildResolver> } | null = null;
export function getResolver() {
  const s = getState();
  const key = s.index;
  if (cache && cache.key === key) return cache.r;
  const unsupported = (s.vault?.inventory ?? []).filter((i) => /canvas|bases|\.txt|\.markdown/i.test(i.reason)).map((i) => i.path);
  const r = buildResolver({ notes: [...s.notes.values()].map((n) => ({ path: n.path, parsed: n.parsed })), attachments: [...s.attachments.keys()], unsupported, aliasFallback: s.settings.aliasFallback });
  cache = { key, r };
  return r;
}

export function useRenderCtx(fromPath: string, allowRemote: boolean): RenderCtx | null {
  const index = useStore((s) => s.index);
  return useMemo(() => {
    if (!index) return null;
    const r = getResolver();
    return {
      fromPath,
      resolve: r.resolve,
      attachmentUrl,
      getContent: (p) => getState().notes.get(p)?.content,
      allowRemote,
    };
  }, [index, fromPath, allowRemote]);
}

export function useNotes() {
  const notes = useStore((s) => s.notes);
  return useMemo(() => [...notes.values()].sort((a, b) => a.path.localeCompare(b.path)), [notes]);
}

export interface FolderNode { path: string; name: string; count: number; total: number; children: FolderNode[] }
export function useFolderTree(): FolderNode {
  const index = useStore((s) => s.index);
  return useMemo(() => {
    const root: FolderNode = { path: '', name: 'Vault root', count: 0, total: 0, children: [] };
    if (!index) return root;
    const map = new Map<string, FolderNode>([['', root]]);
    const ensure = (p: string): FolderNode => {
      if (map.has(p)) return map.get(p)!;
      const parent = ensure(p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
      const n: FolderNode = { path: p, name: p.slice(p.lastIndexOf('/') + 1), count: 0, total: 0, children: [] };
      parent.children.push(n);
      map.set(p, n);
      return n;
    };
    for (const [f, c] of Object.entries(index.folders)) {
      const n = ensure(f);
      n.count += c;
    }
    const sum = (n: FolderNode): number => { n.children.sort((a, b) => a.name.localeCompare(b.name)); n.total = n.count + n.children.reduce((a, c) => a + sum(c), 0); return n.total; };
    sum(root);
    return root;
  }, [index]);
}

export function useTagList() {
  const index = useStore((s) => s.index);
  return useMemo(() => (index ? Object.entries(index.tags).map(([key, v]) => ({ key, name: v.name, count: v.notes.length })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)) : []), [index]);
}
