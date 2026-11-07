import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { useStore, dangling, remapReference, toast } from '../store';
import { noteRoute, fmtBytes, fmtDateTime, plural, Empty } from '../ui';
import { NeedsImport } from './Home';

export default function Diagnostics({ query }: { query: URLSearchParams }) {
  const { index, vault, notes, imports, contentLoaded, app } = useStore((s) => s);
  const [tab, setTab] = useState(query.get('tab') ?? 'links');
  const dang = useMemo(() => (index ? dangling() : []), [index, app]);
  const [remap, setRemap] = useState<Record<string, string>>({});
  if (!vault) return <div className="page"><Empty title="Nothing to diagnose yet" action={<a className="btn primary" href="#/import">Import your vault</a>} /></div>;
  if (!contentLoaded) return <NeedsImport />;
  if (!index) return <div className="page"><div className="empty-sm">Indexing…</div></div>;
  const by = (st: string) => index.diagnostics.filter((d) => d.link.status === st);
  const groups = [
    { k: 'unresolved', title: 'Unresolved links', help: 'No note or file matches the target. Vault Atlas never creates placeholder notes for these.', items: by('unresolved') },
    { k: 'ambiguous', title: 'Ambiguous links', help: 'Several notes match and none is in the linking note’s folder, so the link is not counted as a connection. Use a path, e.g. [[Folder/Note]], to make it explicit.', items: by('ambiguous') },
    { k: 'nearest', title: 'Resolved by folder proximity', help: 'Several notes share this name; resolved to the one in the same folder as the linking note (Obsidian’s rule). Counted as a connection.', items: by('resolved-nearest') },
    { k: 'alias', title: 'Resolved through an alias', help: 'Alias fallback is on (Settings). The target matched exactly one note’s alias.', items: by('resolved-alias') },
    { k: 'frag', title: 'Heading or block not found', help: 'The note exists, but the #heading or #^block in the link wasn’t found. The link still connects to the note.', items: index.diagnostics.filter((d) => d.link.fragmentFound === false) },
    { k: 'unsupported', title: 'Links to unsupported files', help: 'The target exists in your vault but its type (e.g. .canvas) isn’t displayed by Vault Atlas.', items: by('unsupported') },
  ];
  const fmErrors = [...notes.values()].filter((n) => n.parsed.frontmatterError);
  const lastFailed = imports[0]?.failed ?? [];
  const allNotes = [...notes.values()].filter((n) => !n.missing).map((n) => n.path).sort();
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="page-title">Diagnostics</h1><p className="page-sub">How Vault Atlas interpreted your vault. Nothing here changes your notes.</p></div></div>
      <div className="tabs" role="tablist">
        {[['links', `Links (${index.stats.unresolved + index.stats.ambiguous})`], ['files', `Files (${vault.inventory.length + fmErrors.length + lastFailed.length})`], ['appdata', `Saved associations (${dang.length})`]].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} data-testid={`tab-${k}`}>{l}</button>
        ))}
      </div>
      {tab === 'links' && (
        <div className="stack" style={{ gap: 16 }}>
          {groups.map((g) => (
            <details key={g.k} className="card pad-sm" open={g.items.length > 0 && (g.k === 'unresolved' || g.k === 'ambiguous')} data-testid={`diag-${g.k}`}>
              <summary style={{ cursor: 'pointer', minHeight: 32, fontWeight: 650 }}>{g.title} <span className="badge num">{g.items.length}</span></summary>
              <p className="xs muted">{g.help}</p>
              {g.items.length ? (
                <div className="table-scroll"><table className="table"><thead><tr><th>In note</th><th>Link as written</th><th>{g.k === 'ambiguous' ? 'Candidates' : 'Result'}</th></tr></thead><tbody>
                  {g.items.slice(0, 400).map((d, i) => (
                    <tr key={i}>
                      <td><a href={noteRoute(d.from)}>{notes.get(d.from)?.name}</a><div className="xs faint wrap-any">{d.from}{d.link.line ? ` · line ${d.link.line + 1}` : d.link.property ? ` · property “${d.link.property}”` : ''}</div></td>
                      <td className="mono small wrap-any">{d.link.raw}</td>
                      <td className="small wrap-any">{g.k === 'ambiguous' ? (d.link.candidates ?? []).map((c) => <div key={c}><a href={noteRoute(c)}>{c}</a></div>) : d.link.targetPath ? <a href={d.link.targetKind === 'note' ? noteRoute(d.link.targetPath) : '#/diagnostics'}>{d.link.targetPath}</a> : <span className="faint">—</span>}</td>
                    </tr>
                  ))}
                </tbody></table></div>
              ) : <div className="empty-sm">None.</div>}
            </details>
          ))}
        </div>
      )}
      {tab === 'files' && (
        <div className="stack" style={{ gap: 16 }}>
          <div className="card pad-sm"><strong className="small">Ignored by default</strong><p className="xs muted">{plural(vault.ignoredCount, 'file')} in .obsidian, .trash, hidden folders or system files were skipped in the latest full import.</p></div>
          <details className="card pad-sm" open={lastFailed.length > 0}><summary style={{ cursor: 'pointer', fontWeight: 650, minHeight: 32 }}>Failed in last import <span className="badge num">{lastFailed.length}</span></summary>
            {lastFailed.map((f) => <div key={f.path} className="small"><span className="mono">{f.path}</span> — <span className="muted">{f.error}</span></div>)}</details>
          <details className="card pad-sm"><summary style={{ cursor: 'pointer', fontWeight: 650, minHeight: 32 }}>Unsupported or skipped files <span className="badge num">{vault.inventory.length}</span></summary>
            <div className="table-scroll"><table className="table"><tbody>{vault.inventory.map((i) => <tr key={i.path}><td className="mono small wrap-any">{i.path}</td><td className="small muted">{i.reason}</td><td className="small num">{fmtBytes(i.size)}</td></tr>)}</tbody></table></div></details>
          <details className="card pad-sm" open={fmErrors.length > 0}><summary style={{ cursor: 'pointer', fontWeight: 650, minHeight: 32 }}>Frontmatter that couldn't be read <span className="badge num">{fmErrors.length}</span></summary>
            {fmErrors.map((n) => <div key={n.path} className="small"><a href={noteRoute(n.path)}>{n.path}</a> — <span className="muted">{n.parsed.frontmatterError}</span></div>)}</details>
          {imports[0] && <div className="xs faint">Latest import: {fmtDateTime(imports[0].at)} from {imports[0].sourceLabel}</div>}
        </div>
      )}
      {tab === 'appdata' && (
        <div className="stack" style={{ gap: 16 }}>
          <p className="small muted" style={{ margin: 0 }}>Pins, boards, reading history and graph views that point to a path that isn't in the current snapshot. They are kept until you decide — re-point them to the note's new path, or drop the association.</p>
          {dang.length ? dang.map((d) => (
            <div key={d.path} className="card pad-sm stack" style={{ gap: 8 }} data-testid={`dangling-${d.path}`}>
              <div className="row"><AlertTriangle size={16} color="var(--warn)" /><span className="mono small wrap-any grow">{d.path}</span></div>
              <div className="xs muted">Used in: {d.where.join(', ')}</div>
              <div className="row-wrap">
                <select className="input" style={{ maxWidth: 380 }} value={remap[d.path] ?? ''} onChange={(e) => setRemap({ ...remap, [d.path]: e.target.value })} aria-label={`New path for ${d.path}`}>
                  <option value="">Re-point to…</option>{allNotes.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <button className="btn sm" disabled={!remap[d.path]} onClick={async () => { await remapReference(d.path, remap[d.path]); toast('Associations moved'); }}>Re-point</button>
                <button className="btn sm ghost" onClick={async () => { await remapReference(d.path, null); toast('Association removed'); }}>Drop association</button>
              </div>
            </div>
          )) : <div className="empty-sm">All saved associations point to notes in the current snapshot.</div>}
          {app && app.moves.length > 0 && <details className="card pad-sm"><summary style={{ cursor: 'pointer', fontWeight: 650, minHeight: 32 }}>Confirmed moves ({app.moves.length})</summary>{app.moves.slice(-50).reverse().map((m, i) => <div key={i} className="xs"><span className="mono">{m.from}</span> → <span className="mono">{m.to}</span> <span className="faint">{fmtDateTime(m.at)}</span></div>)}</details>}
        </div>
      )}
    </div>
  );
}
