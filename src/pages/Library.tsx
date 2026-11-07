import { useEffect, useMemo, useState } from 'react';
import { Hash, X, SlidersHorizontal } from 'lucide-react';
import { useStore, search, type SearchHit } from '../store';
import { useFolderTree, useNotes, useTagList, type FolderNode } from '../derived';
import { NoteRow, fmtDate, go, notesRoute, plural } from '../ui';
import { NeedsImport } from './Home';
import type { NoteRecord } from '../lib/types';

function flatFolders(n: FolderNode, out: { path: string; depth: number; total: number }[] = [], depth = 0) {
  for (const c of n.children) { out.push({ path: c.path, depth, total: c.total }); flatFolders(c, out, depth + 1); }
  return out;
}

export default function Library({ query }: { query: URLSearchParams }) {
  const { index, contentLoaded, vault } = useStore((s) => s);
  const all = useNotes();
  const tree = useFolderTree();
  const tagList = useTagList();
  const q = query.get('q') ?? '';
  const folder = query.get('folder') ?? '';
  const tags = (query.get('tag') ?? '').split(',').filter(Boolean);
  const tagMode = (query.get('tagMode') ?? 'or') as 'and' | 'or';
  const prop = query.get('prop') ?? '';
  const status = query.get('status') ?? '';
  const sort = query.get('sort') ?? (q ? 'relevance' : 'name');
  const view = query.get('view') ?? '';
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [qInput, setQInput] = useState(q);
  const [showFilters, setShowFilters] = useState(false);
  useEffect(() => setQInput(q), [q]);
  useEffect(() => {
    let live = true;
    if (!q.trim()) { setHits(null); return; }
    search(q, 2000).then((h) => live && setHits(h));
    return () => { live = false; };
  }, [q, index]);

  const set = (k: string, v?: string) => {
    const o: Record<string, string | undefined> = { q, folder, tag: tags.join(','), tagMode: tagMode === 'or' ? undefined : tagMode, prop, status, sort: query.get('sort') ?? undefined, view: undefined };
    o[k] = v;
    go(notesRoute(o));
  };
  const props = useMemo(() => {
    const m = new Map<string, number>();
    all.forEach((n) => n.parsed.frontmatter && Object.keys(n.parsed.frontmatter).forEach((k) => m.set(k, (m.get(k) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);

  const results = useMemo(() => {
    if (!index) return [] as { n: NoteRecord; terms: string[] }[];
    const hitMap = hits ? new Map(hits.map((h) => [h.path, h])) : null;
    let list = all.filter((n) => !hitMap || hitMap.has(n.path));
    if (folder) list = list.filter((n) => (folder === '/' ? n.folder === '' : n.folder === folder || n.folder.startsWith(folder + '/')));
    if (tags.length) {
      const sets = tags.map((t) => new Set(index.tags[t.toLowerCase()]?.notes ?? []));
      list = list.filter((n) => (tagMode === 'and' ? sets.every((s) => s.has(n.path)) : sets.some((s) => s.has(n.path))));
    }
    if (prop) list = list.filter((n) => n.parsed.frontmatter && prop in n.parsed.frontmatter);
    if (status === 'orphan') { const o = new Set(index.orphans); list = list.filter((n) => o.has(n.path)); }
    if (status === 'unresolved') { const u = new Set(index.diagnostics.filter((d) => d.link.status === 'unresolved' || d.link.status === 'ambiguous').map((d) => d.from)); list = list.filter((n) => u.has(n.path)); }
    if (status === 'missing') list = list.filter((n) => n.missing);
    if (status === 'untagged') list = list.filter((n) => !n.parsed.tags.length);
    const out = list.map((n) => ({ n, terms: hitMap?.get(n.path)?.terms ?? [] }));
    if (sort === 'relevance' && hitMap) out.sort((a, b) => hitMap.get(b.n.path)!.score - hitMap.get(a.n.path)!.score);
    else if (sort === 'filedate') out.sort((a, b) => (b.n.sourceMtime ?? 0) - (a.n.sourceMtime ?? 0));
    else if (sort === 'imported') out.sort((a, b) => b.n.contentUpdatedAt - a.n.contentUpdatedAt);
    else if (sort === 'links') out.sort((a, b) => (index.links[b.n.path].inNotes.length + index.links[b.n.path].outNotes.length) - (index.links[a.n.path].inNotes.length + index.links[a.n.path].outNotes.length));
    else if (sort === 'size') out.sort((a, b) => b.n.parsed.wordCount - a.n.parsed.wordCount);
    else out.sort((a, b) => a.n.name.localeCompare(b.n.name) || a.n.path.localeCompare(b.n.path));
    return out;
  }, [all, hits, folder, tags.join(','), tagMode, prop, status, sort, index]);

  if (!vault) return <div className="page"><div className="empty-sm">No vault yet. <a href="#/import">Import your vault</a>.</div></div>;
  if (!contentLoaded) return <NeedsImport />;
  if (!index) return <div className="page"><div className="empty-sm">Indexing…</div></div>;

  if (view === 'tags') {
    return (
      <div className="page">
        <div className="page-head"><div><h1 className="page-title">Tags</h1><p className="page-sub">Frontmatter and inline tags. Nested tags like #parent/child also count toward #parent.</p></div></div>
        <div className="row-wrap">{tagList.map((t) => <a key={t.key} className="chip" href={notesRoute({ tag: t.name })}><Hash size={13} aria-hidden />{t.name}<span className="n num">{t.count}</span></a>)}</div>
      </div>
    );
  }
  const folders = flatFolders(tree);
  const active = [folder && `Folder: ${folder === '/' ? 'root' : folder}`, tags.length && `Tags (${tagMode.toUpperCase()}): ${tags.map((t) => '#' + t).join(', ')}`, prop && `Has property: ${prop}`, status && `Status: ${status}`].filter(Boolean) as string[];

  return (
    <div className="page">
      <div className="page-head">
        <div><h1 className="page-title">Notes</h1><p className="page-sub">{q ? `${plural(results.length, 'match', 'matches')} for “${q}”` : plural(results.length, 'note')}{active.length ? ' · filtered' : ''}</p></div>
        <button className="btn" onClick={() => setShowFilters(!showFilters)} aria-expanded={showFilters} data-testid="button-filters"><SlidersHorizontal />Filters</button>
      </div>
      <form className="row" style={{ marginBottom: 16 }} onSubmit={(e) => { e.preventDefault(); set('q', qInput || undefined); }}>
        <input className="input" type="search" placeholder="Search titles, content, tags, paths, properties" value={qInput} onChange={(e) => setQInput(e.target.value)} aria-label="Search notes" data-testid="input-library-search" />
        <button className="btn primary" type="submit">Search</button>
      </form>
      {showFilters && (
        <div className="card pad-sm" style={{ marginBottom: 16 }}>
          <div className="grid cols-3">
            <label className="field">Folder (includes subfolders)
              <select className="input" value={folder} onChange={(e) => set('folder', e.target.value || undefined)} data-testid="select-folder">
                <option value="">All folders</option>
                <option value="/">Vault root only</option>
                {folders.map((f) => <option key={f.path} value={f.path}>{'\u00a0\u00a0'.repeat(f.depth)}{f.path.split('/').pop()} ({f.total})</option>)}
              </select>
            </label>
            <label className="field">Has property
              <select className="input" value={prop} onChange={(e) => set('prop', e.target.value || undefined)}>
                <option value="">Any</option>
                {props.map(([k, c]) => <option key={k} value={k}>{k} ({c})</option>)}
              </select>
            </label>
            <label className="field">Status
              <select className="input" value={status} onChange={(e) => set('status', e.target.value || undefined)} data-testid="select-status">
                <option value="">Any</option><option value="orphan">Orphans (no links in or out)</option><option value="unresolved">Has unresolved/ambiguous links</option><option value="untagged">Untagged</option><option value="missing">Missing from latest snapshot</option>
              </select>
            </label>
            <label className="field">Sort
              <select className="input" value={sort} onChange={(e) => set('sort', e.target.value)}>
                {q && <option value="relevance">Relevance</option>}
                <option value="name">Name</option><option value="filedate">File date (from ZIP/file)</option><option value="imported">Last changed in an import</option><option value="links">Most connected</option><option value="size">Longest</option>
              </select>
            </label>
          </div>
          <div style={{ marginTop: 16 }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <span className="small muted grow">Tags — multiple tags match with</span>
              <div className="seg" role="group" aria-label="Tag match mode">
                <button aria-pressed={tagMode === 'or'} onClick={() => set('tagMode', undefined)}>ANY (OR)</button>
                <button aria-pressed={tagMode === 'and'} onClick={() => set('tagMode', 'and')}>ALL (AND)</button>
              </div>
            </div>
            <div className="chip-pick">
              {tagList.map((t) => {
                const on = tags.some((x) => x.toLowerCase() === t.key);
                return <button key={t.key} className={'chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => set('tag', (on ? tags.filter((x) => x.toLowerCase() !== t.key) : [...tags, t.name]).join(',') || undefined)}>#{t.name}<span className="n">{t.count}</span></button>;
              })}
            </div>
          </div>
        </div>
      )}
      {active.length > 0 && (
        <div className="row-wrap" style={{ marginBottom: 12 }}>
          {active.map((a) => <span key={a} className="badge accent">{a}</span>)}
          <a className="btn sm ghost" href={notesRoute({ q })}><X />Clear filters</a>
        </div>
      )}
      <div className="card tight">
        <div className="note-list">
          {results.slice(0, 600).map(({ n, terms }) => <NoteRow key={n.path} note={n} snippet terms={terms} meta={n.sourceMtime ? <span title={n.sourceMtimeKind === 'zip' ? 'Modified date stored in the ZIP' : 'Modified date reported by the browser'}>{fmtDate(n.sourceMtime)}</span> : undefined} />)}
          {!results.length && <div className="empty-sm" style={{ padding: 20 }}>No notes match. Try fewer filters or a different search.</div>}
          {results.length > 600 && <div className="empty-sm" style={{ padding: 16 }}>Showing the first 600 of {results.length.toLocaleString()}. Narrow with search or filters.</div>}
        </div>
      </div>
    </div>
  );
}
