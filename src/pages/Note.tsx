import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Pin, PinOff, Code2, BookOpen, Network, LayoutDashboard, ImageOff, Image as ImageIcon, ExternalLink, AlertTriangle, Link2, CornerDownLeft, Hash, Paperclip, Info } from 'lucide-react';
import { useStore, toggleFavorite, recordOpen } from '../store';
import { useRenderCtx } from '../derived';
import { renderMarkdown } from '../lib/markdown';
import { buildGraph, DEFAULT_FILTERS } from '../lib/graphData';
import { GraphCanvas } from '../components/GraphCanvas';
import { fmtDate, fmtDateTime, go, noteRoute, notesRoute, Empty, useReducedMotion, plural } from '../ui';
import { NeedsImport } from './Home';
import { AddToBoard } from './Boards';
import type { ResolvedLink } from '../lib/resolver';

const STATUS_LABEL: Record<string, string> = { unresolved: 'Unresolved', ambiguous: 'Ambiguous', 'resolved-nearest': 'Nearest of several', 'resolved-alias': 'Via alias', unsupported: 'Unsupported file' };

function PropValue({ v }: { v: unknown }) {
  if (v == null) return <span className="faint">empty</span>;
  if (Array.isArray(v)) return <span className="row-wrap" style={{ gap: 4 }}>{v.map((x, i) => <span key={i} className="badge">{typeof x === 'object' ? JSON.stringify(x) : String(x)}</span>)}</span>;
  if (typeof v === 'object') return <span className="mono">{JSON.stringify(v)}</span>;
  return <>{String(v)}</>;
}

function LocalGraph({ path }: { path: string }) {
  const { index, notes } = useStore((s) => s);
  const theme = document.documentElement.dataset.theme ?? 'dark';
  const reduced = useReducedMotion();
  const built = useMemo(() => (index ? buildGraph(index, notes, { mode: 'local', center: path, depth: 1, filters: { ...DEFAULT_FILTERS, labels: 'all', colorBy: 'folder' }, limit: 300 }) : null), [index, notes, path]);
  if (!built) return null;
  if (built.graph.order <= 1) return <div className="empty-sm">No linked notes yet — this note has no resolved links in or out.</div>;
  return (
    <div className="mini-graph">
      <GraphCanvas graph={built.graph} selected={'note:' + path} onSelect={(k) => k && k !== 'note:' + path && k.startsWith('note:') && go(noteRoute(k.slice(5)))} labels="all" theme={theme} compact reducedMotion={reduced} ariaLabel="Local graph of directly linked notes" />
    </div>
  );
}

export default function NotePage({ path, query }: { path: string; query: URLSearchParams }) {
  const { notes, index, contentLoaded, vault, app, settings } = useStore((s) => s);
  const note = notes.get(path);
  const [raw, setRaw] = useState(false);
  const [allowRemote, setAllowRemote] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const ctx = useRenderCtx(path, allowRemote);
  const body = useRef<HTMLDivElement>(null);
  const [blocked, setBlocked] = useState(0);
  useEffect(() => { setRaw(false); setAllowRemote(false); if (note) recordOpen(path); }, [path, !!note]);

  useEffect(() => {
    if (!note || !ctx || !body.current || raw) return;
    const frag = renderMarkdown(note.content, ctx);
    body.current.replaceChildren(frag);
    setBlocked(body.current.querySelectorAll('.remote-blocked').length);
    const h = query.get('h'), b = query.get('b');
    let target: HTMLElement | null = null;
    if (b) target = body.current.querySelector(`[id="b-${CSS.escape(b)}"]`);
    else if (h) {
      const want = h.split('#').pop()!.replace(/[#|^:\[\]%*_`]/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
      target = [...body.current.querySelectorAll<HTMLElement>('[data-heading]')].find((x) => x.dataset.heading === want) ?? null;
    }
    if (target) { target.scrollIntoView({ block: 'start' }); target.classList.add('flash'); }
    else document.getElementById('main')?.scrollTo({ top: 0 });
  }, [note, ctx, raw, query.toString()]);

  // Same-page fragment links: "#/note/<this>?h=..." changes the hash → effect above re-runs and scrolls.

  if (!vault) return <div className="page"><div className="empty-sm">No vault. <a href="#/import">Import</a></div></div>;
  if (!contentLoaded) return <NeedsImport />;
  if (!note) {
    return <div className="page narrow"><Empty title="Note not found" action={<a className="btn" href="#/notes">Browse notes</a>}>There's no note at <span className="mono">{path}</span> in this snapshot. It may have been renamed, moved or removed in Obsidian. Saved associations for it are listed in Diagnostics.</Empty></div>;
  }
  const L = index?.links[path];
  const pinned = app?.favorites.includes(path);
  const fm = note.parsed.frontmatter;
  const crumbs = note.folder ? note.folder.split('/') : [];
  const out = L?.out ?? [];
  const groups = {
    notes: out.filter((l) => l.targetKind === 'note' && l.status !== 'self' && ['resolved', 'resolved-nearest', 'resolved-alias'].includes(l.status)),
    problems: out.filter((l) => ['unresolved', 'ambiguous', 'unsupported'].includes(l.status) || l.fragmentFound === false),
    attachments: out.filter((l) => l.targetKind === 'attachment' && l.status !== 'unresolved'),
    external: out.filter((l) => l.status === 'external'),
    self: out.filter((l) => l.status === 'self'),
  };
  const uniqueBy = (ls: ResolvedLink[]) => { const m = new Map<string, ResolvedLink>(); ls.forEach((l) => !m.has(l.targetPath! + (l.fragment ?? '')) && m.set(l.targetPath! + (l.fragment ?? ''), l)); return [...m.values()]; };
  const backlinks = (L?.inNotes ?? []).map((p) => {
    const src = notes.get(p);
    const ls = index?.links[p].out.filter((l) => l.targetPath === path) ?? [];
    const line = src && ls[0] && ls[0].line > 0 ? src.content.split('\n')[ls[0].line]?.trim() : '';
    return { p, name: src?.name ?? p, line, n: ls.length };
  });
  const obsidianVault = app?.obsidianVaultName || vault.rootName || vault.name;
  const obsidianUri = `obsidian://open?vault=${encodeURIComponent(obsidianVault)}&file=${encodeURIComponent(note.path.replace(/\.md$/, ''))}`;

  return (
    <div className="reader-wrap">
      <article aria-labelledby="note-title">
        <header className="reader-head">
          <nav className="crumbs" aria-label="Folder path">
            <a href={notesRoute({})}>{vault.isDemo ? 'Demo vault' : vault.name}</a>
            {crumbs.map((c, i) => <span key={i}>/ <a href={notesRoute({ folder: crumbs.slice(0, i + 1).join('/') })}>{c}</a></span>)}
          </nav>
          <h1 className="note-title" id="note-title">{note.name}</h1>
          {note.missing && <div className="notice warn" style={{ marginBottom: 12 }}><AlertTriangle aria-hidden /><div>This note was not in the latest imported snapshot. It's kept here (read-only) until you review it in <a href="#/import?tab=missing">Import → Missing files</a>.</div></div>}
          <div className="row-wrap">
            <button className={'btn sm' + (pinned ? ' on' : '')} aria-pressed={pinned} onClick={() => toggleFavorite(path)} data-testid="button-pin">{pinned ? <PinOff /> : <Pin />}{pinned ? 'Unpin' : 'Pin'}</button>
            <button className={'btn sm' + (raw ? ' on' : '')} aria-pressed={raw} onClick={() => setRaw(!raw)} data-testid="button-raw">{raw ? <BookOpen /> : <Code2 />}{raw ? 'Reading view' : 'View original Markdown'}</button>
            <a className="btn sm" href={`#/graph?center=${encodeURIComponent(path)}`} data-testid="button-open-graph"><Network />Graph</a>
            <button className="btn sm" onClick={() => setAddOpen(true)} data-testid="button-add-board"><LayoutDashboard />Add to board</button>
            <a className="btn sm ghost" href={obsidianUri} title={`Opens “${obsidianVault}” in the Obsidian app if it's installed (vault name can be changed in Settings)`}><ExternalLink />Open in Obsidian</a>
          </div>
          {blocked > 0 && !raw && (
            <div className="notice" style={{ marginTop: 12 }}>
              <ImageOff aria-hidden />
              <div className="grow"><strong>{plural(blocked, 'remote image')} not loaded.</strong> Loading contacts the image's server, which can reveal your IP address to it. Nothing from your vault is sent.</div>
              {settings.remoteImages === 'ask' && <button className="btn sm" onClick={() => setAllowRemote(true)} data-testid="button-load-remote"><ImageIcon />Load for this note</button>}
            </div>
          )}
        </header>
        {raw ? <pre className="raw-md" data-testid="text-raw-markdown">{note.content}</pre> : <div className="md" ref={body} data-testid="note-body" />}
      </article>
      <aside className="reader-side" aria-label="Note details">
        <section className="side-block">
          <h3><Info size={14} />File</h3>
          <dl className="kv">
            <dt>Path</dt><dd className="mono" data-testid="text-note-path">{note.path}</dd>
            <dt>File date</dt><dd>{note.sourceMtime ? <>{fmtDateTime(note.sourceMtime)} <span className="faint xs">({note.sourceMtimeKind === 'zip' ? 'modified, from ZIP entry' : 'modified, reported by browser'})</span></> : <span className="faint">not available</span>}</dd>
            <dt>First imported</dt><dd>{fmtDate(note.firstImportedAt)}</dd>
            <dt>Last changed</dt><dd>{fmtDate(note.contentUpdatedAt)} <span className="faint xs">(in an import)</span></dd>
            <dt>Words</dt><dd className="num">{note.parsed.wordCount.toLocaleString()}</dd>
          </dl>
        </section>
        {(fm && Object.keys(fm).length > 0) || note.parsed.frontmatterError ? (
          <section className="side-block">
            <h3>Properties</h3>
            {note.parsed.frontmatterError && <div className="notice warn small" style={{ marginBottom: 8 }}><AlertTriangle aria-hidden />Frontmatter couldn't be read: {note.parsed.frontmatterError}</div>}
            {fm && <dl className="kv" data-testid="list-properties">{Object.entries(fm).map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd><PropValue v={v} /></dd></Fragment>)}</dl>}
            {/date|created|updated|modified/i.test(Object.keys(fm ?? {}).join(' ')) && <div className="xs faint" style={{ marginTop: 6 }}>Dates in properties are shown exactly as written in the note.</div>}
          </section>
        ) : null}
        {note.parsed.tags.length > 0 && (
          <section className="side-block">
            <h3><Hash size={14} />Tags</h3>
            <div className="row-wrap" data-testid="list-tags">{note.parsed.tags.map((t) => <a key={t} className="chip" href={notesRoute({ tag: t })} title={`Found in ${note.parsed.tagSources[t.toLowerCase()]?.join(' and ')}`}>#{t}</a>)}</div>
          </section>
        )}
        {note.parsed.aliases.length > 0 && <section className="side-block"><h3>Aliases</h3><div className="row-wrap">{note.parsed.aliases.map((a) => <span key={a} className="badge">{a}</span>)}</div></section>}
        <section className="side-block">
          <h3><Link2 size={14} />Outgoing links · {uniqueBy(groups.notes).length}</h3>
          <div className="link-list" data-testid="list-outgoing">
            {uniqueBy(groups.notes).map((l, i) => (
              <a key={i} href={noteRoute(l.targetPath!) + (l.fragment ? `?${l.fragmentType === 'block' ? 'b' : 'h'}=${encodeURIComponent(l.fragment)}` : '')}>
                <span className="wrap-any">{notes.get(l.targetPath!)?.name}{l.fragment && <span className="faint"> › {l.fragmentType === 'block' ? '^' : ''}{l.fragment}</span>}</span>
                {STATUS_LABEL[l.status] && <span className="why">{STATUS_LABEL[l.status]}</span>}
              </a>
            ))}
            {!groups.notes.length && <div className="empty-sm">None</div>}
          </div>
          {groups.problems.length > 0 && (
            <div className="link-list" style={{ marginTop: 8 }} data-testid="list-problem-links">
              {groups.problems.map((l, i) => (
                <div key={i} className="li" title={l.candidates ? 'Candidates: ' + l.candidates.join(', ') : undefined}>
                  <AlertTriangle size={14} color={l.status === 'unresolved' ? 'var(--danger)' : 'var(--warn)'} style={{ flex: 'none' }} />
                  <span className="mono wrap-any">{l.raw}</span>
                  <span className="why">{l.fragmentFound === false ? 'Heading/block not found' : STATUS_LABEL[l.status]}</span>
                </div>
              ))}
            </div>
          )}
          {groups.self.length > 0 && <div className="xs faint" style={{ marginTop: 6 }}>{plural(groups.self.length, 'link')} to headings/blocks in this note.</div>}
          {groups.external.length > 0 && <div className="xs faint" style={{ marginTop: 4 }}>{plural(groups.external.length, 'external web link')}.</div>}
        </section>
        <section className="side-block">
          <h3><CornerDownLeft size={14} />Backlinks · {backlinks.length}</h3>
          <div className="link-list" data-testid="list-backlinks">
            {backlinks.map((b) => <a key={b.p} href={noteRoute(b.p)} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}><span>{b.name}</span>{b.line && <span className="xs faint wrap-any">{b.line.slice(0, 140)}</span>}</a>)}
            {!backlinks.length && <div className="empty-sm">No notes link here.</div>}
          </div>
        </section>
        {groups.attachments.length > 0 && (
          <section className="side-block">
            <h3><Paperclip size={14} />Attachments</h3>
            <div className="link-list">{uniqueBy(groups.attachments).map((l) => <a key={l.targetPath} href={`#/file/${l.targetPath!.split('/').map(encodeURIComponent).join('/')}`}><span className="wrap-any">{l.targetPath}</span>{l.embed && <span className="why">embedded</span>}</a>)}</div>
          </section>
        )}
        <section className="side-block">
          <h3><Network size={14} />Local graph</h3>
          <LocalGraph path={path} />
        </section>
      </aside>
      {addOpen && <AddToBoard paths={[path]} onClose={() => setAddOpen(false)} />}
    </div>
  );
}
