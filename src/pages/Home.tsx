import { RefreshFolderButton } from '../components/FolderButton';
import { useMemo, useState } from 'react';
import { Shuffle, Pin, Clock, RefreshCw, Folder, Hash, Upload, Settings2, ChevronUp, ChevronDown, Eye, EyeOff, Sparkles, AlertTriangle, Network } from 'lucide-react';
import { useStore, setDashboard } from '../store';
import { DEFAULT_DASHBOARD } from '../lib/db';
import { useFolderTree, useNotes, useTagList } from '../derived';
import { Empty, NoteRow, fmtAgo, fmtDate, go, noteRoute, notesRoute, plural } from '../ui';

const LABELS: Record<string, string> = { search: 'Search', stats: 'Vault at a glance', continue: 'Continue reading', pinned: 'Pinned notes', recent: 'Recently imported or updated', folders: 'Browse by folder', tags: 'Browse by tag' };

export function NeedsImport() {
  const vault = useStore((s) => s.vault);
  return (
    <div className="page narrow">
      <Empty title="This vault's notes aren't loaded on this device"
        action={<div className="row-wrap" style={{ justifyContent: 'center' }}><a className="btn primary" href="#/import?mode=replace-snapshot" data-testid="button-reimport"><Upload />Import latest ZIP of “{vault?.name}”</a></div>}>
        You chose not to keep note content stored in this browser (or it was cleared). Your pinned notes, boards and saved views are still here and will reconnect by vault-relative path when you import the vault again.
      </Empty>
    </div>
  );
}

export default function Home() {
  const { vault, index, app, notes, contentLoaded, indexing } = useStore((s) => s);
  const all = useNotes();
  const tree = useFolderTree();
  const tags = useTagList();
  const [customize, setCustomize] = useState(false);
  const order = useMemo(() => {
    const o = app?.dashboard.order ?? DEFAULT_DASHBOARD;
    return [...o.filter((k) => LABELS[k]), ...DEFAULT_DASHBOARD.filter((k) => !o.includes(k))];
  }, [app]);
  const hidden = new Set(app?.dashboard.hidden ?? []);

  if (!vault) {
    return (
      <div className="page narrow">
        <Empty title="Map your Obsidian vault — privately"
          action={<div className="row-wrap" style={{ justifyContent: 'center' }}>
            <a className="btn primary" href="#/import" data-testid="button-import-empty"><Upload />Import your vault</a>
            <a className="btn" href="#/import?demo=1" data-testid="button-demo"><Sparkles />Try the demo vault</a>
          </div>}>
          Choose a ZIP of your vault (or a folder, or a few Markdown files). Everything is read and indexed inside this browser on your device. Nothing is uploaded, and your Obsidian files are never changed.
        </Empty>
      </div>
    );
  }
  if (!contentLoaded) return <NeedsImport />;
  if (!index) return <div className="page"><div className="empty-sm">{indexing ? 'Indexing notes on this device…' : 'Preparing…'}</div></div>;

  const live = all.filter((n) => !n.missing);
  const random = () => { if (live.length) go(noteRoute(live[Math.floor(Math.random() * live.length)].path)); };
  const move = (k: string, d: -1 | 1) => {
    const o = [...order]; const i = o.indexOf(k); const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    setDashboard({ order: o, hidden: [...hidden] });
  };
  const toggle = (k: string) => {
    const h = new Set(hidden); h.has(k) ? h.delete(k) : h.add(k);
    setDashboard({ order, hidden: [...h] });
  };

  const recents = (app?.recents ?? []).map((r) => ({ r, n: notes.get(r.path) })).filter((x) => x.n).slice(0, 6);
  const pinned = (app?.favorites ?? []).map((p) => ({ p, n: notes.get(p) }));
  const recentImports = [...live].sort((a, b) => b.contentUpdatedAt - a.contentUpdatedAt || (b.sourceMtime ?? 0) - (a.sourceMtime ?? 0)).slice(0, 8);
  const s = index.stats;

  const sections: Record<string, JSX.Element> = {
    search: (
      <div className="row-wrap">
        <button className="btn" onClick={random} data-testid="button-random"><Shuffle />Open a random note</button>
        <a className="btn ghost" href="#/graph"><Network />Explore the graph</a>
        <span className="faint small">Tip: press <span className="kbd">/</span> or <span className="kbd">Ctrl K</span> to search from anywhere.</span>
      </div>
    ),
    stats: (
      <div className="stats">
        <a className="stat" href={notesRoute({})} data-testid="stat-notes"><span className="v">{s.notes.toLocaleString()}</span><span className="l">Notes</span></a>
        <a className="stat" href="#/graph" data-testid="stat-connections" title="Unique pairs of notes joined by at least one resolved link"><span className="v">{s.connections.toLocaleString()}</span><span className="l">Resolved connections</span></a>
        <a className="stat" href="#/notes?view=tags" data-testid="stat-tags"><span className="v">{s.tags.toLocaleString()}</span><span className="l">Tags (incl. nested parents)</span></a>
        <a className="stat" href={notesRoute({ status: 'orphan' })} data-testid="stat-orphans" title="Notes with no resolved links in or out"><span className="v">{s.orphans.toLocaleString()}</span><span className="l">Orphan notes</span></a>
        <a className={'stat' + (s.unresolved + s.ambiguous ? ' attn' : '')} href="#/diagnostics" data-testid="stat-unresolved"><span className="v">{s.unresolved.toLocaleString()}</span><span className="l">Unresolved links{s.ambiguous ? ` · ${s.ambiguous} ambiguous` : ''}</span></a>
      </div>
    ),
    continue: recents.length ? (
      <div className="card tight"><div className="note-list">{recents.map(({ r, n }) => <NoteRow key={r.path} note={n!} meta={`Opened ${fmtAgo(r.at)}`} />)}</div></div>
    ) : <div className="empty-sm">Notes you open in Vault Atlas will appear here.</div>,
    pinned: pinned.length ? (
      <div className="card tight"><div className="note-list">{pinned.map(({ p, n }) => n ? <NoteRow key={p} note={n} /> : (
        <a key={p} className="note-row" href="#/diagnostics?tab=appdata"><AlertTriangle className="ico" aria-hidden /><div className="grow"><div className="t">{p}</div><div className="p">Pinned note not found in this snapshot — review in Diagnostics</div></div></a>
      ))}</div></div>
    ) : <div className="empty-sm">Pin notes from the reader with the pin button. Pins are app-only and never written to your vault.</div>,
    recent: (
      <div className="card tight"><div className="note-list">{recentImports.map((n) => (
        <NoteRow key={n.path} note={n} meta={<span title={`Content last changed in an import ${fmtDate(n.contentUpdatedAt)}. ${n.sourceMtime ? `File date (${n.sourceMtimeKind === 'zip' ? 'from ZIP entry' : 'reported by browser'}) ${fmtDate(n.sourceMtime)}` : 'No file date available'}`}>
          {n.firstImportedAt === n.contentUpdatedAt ? 'Added' : 'Updated'} {fmtAgo(n.contentUpdatedAt)}<br />
          <span className="faint">{n.sourceMtime ? `file ${fmtDate(n.sourceMtime)}` : 'no file date'}</span>
        </span>} />
      ))}</div>
      <div className="xs faint" style={{ padding: '8px 14px 12px' }}>“Added/Updated” is when Vault Atlas imported the change. “file” is the modification date stored in your ZIP/file — not a creation date.</div></div>
    ),
    folders: (
      <div className="card pad-sm"><div className="folder-list">
        {tree.count > 0 && <a className="folder-row" href={notesRoute({ folder: '/' })}><Folder aria-hidden />Vault root<span className="n num">{tree.count}</span></a>}
        {tree.children.map((f) => <a key={f.path} className="folder-row" href={notesRoute({ folder: f.path })} data-testid={`link-folder-${f.path}`}><Folder aria-hidden />{f.name}<span className="n num">{f.total}</span></a>)}
        {!tree.children.length && <div className="empty-sm">All notes are in the vault root.</div>}
      </div></div>
    ),
    tags: tags.length ? (
      <div className="row-wrap">{tags.slice(0, 40).map((t) => <a key={t.key} className="chip" href={notesRoute({ tag: t.name })} data-testid={`link-tag-${t.name}`}><Hash size={13} aria-hidden />{t.name}<span className="n num">{t.count}</span></a>)}
        {tags.length > 40 && <a className="chip" href="#/notes?view=tags">All {tags.length} tags →</a>}</div>
    ) : <div className="empty-sm">No tags found.</div>,
  };
  const icons: Record<string, JSX.Element> = { continue: <Clock size={14} />, pinned: <Pin size={14} />, recent: <RefreshCw size={14} />, folders: <Folder size={14} />, tags: <Hash size={14} /> };

  return (
    <div className="page">
      <div className="hero">
        <div>
          <h1>{vault.isDemo ? 'Demo vault' : vault.name}</h1>
          <p className="page-sub">{plural(s.notes, 'note')} · {plural(s.attachments, 'attachment')} · snapshot imported {fmtAgo(vault.lastImportAt)}{s.missing ? ` · ${s.missing} kept from an older snapshot` : ''}</p>
        </div>
        <div className="row-wrap">
          <RefreshFolderButton />
          <a className="btn" href="#/import" data-testid="button-update"><Upload />Update vault</a>
          <button className={'btn icon ghost' + (customize ? ' on' : '')} aria-pressed={customize} aria-label="Customize dashboard" onClick={() => setCustomize(!customize)} data-testid="button-customize"><Settings2 /></button>
        </div>
      </div>
      {vault.isDemo && <div className="notice warn" style={{ marginBottom: 24 }}><Sparkles aria-hidden /><div><strong>This is the synthetic demo vault.</strong> It's stored separately from your own vaults. Switch vaults from the sidebar, or <a href="#/import">import your vault</a>.</div></div>}
      {customize && (
        <div className="card pad-sm" style={{ marginBottom: 24 }}>
          <div className="section-title">Dashboard sections — reorder or hide</div>
          <div className="stack" style={{ gap: 6 }}>
            {order.map((k, i) => (
              <div key={k} className="customize-row">
                <span className="grow small" style={{ opacity: hidden.has(k) ? 0.5 : 1 }}>{LABELS[k]}</span>
                <button className="btn icon sm ghost" aria-label={`Move ${LABELS[k]} up`} disabled={i === 0} onClick={() => move(k, -1)}><ChevronUp /></button>
                <button className="btn icon sm ghost" aria-label={`Move ${LABELS[k]} down`} disabled={i === order.length - 1} onClick={() => move(k, 1)}><ChevronDown /></button>
                <button className="btn icon sm ghost" aria-label={hidden.has(k) ? `Show ${LABELS[k]}` : `Hide ${LABELS[k]}`} onClick={() => toggle(k)} data-testid={`button-toggle-${k}`}>{hidden.has(k) ? <EyeOff /> : <Eye />}</button>
              </div>
            ))}
          </div>
        </div>
      )}
      {order.filter((k) => !hidden.has(k)).map((k) => (
        <section key={k} className="dash-section" data-testid={`section-${k}`} aria-label={LABELS[k]}>
          {k !== 'search' && <h2 className="section-title">{icons[k]}{LABELS[k]}</h2>}
          {sections[k]}
        </section>
      ))}
    </div>
  );
}
