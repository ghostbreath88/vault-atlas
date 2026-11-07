import { useEffect, useMemo, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, Maximize, Play, Pause, Lock, Unlock, RotateCcw, SlidersHorizontal, Save, Trash2, X, FileText, Hash, Paperclip, AlertTriangle, LayoutDashboard } from 'lucide-react';
import { useStore, saveView, deleteView, setFrozen, newId, toast } from '../store';
import { buildGraph, COLORS, DEFAULT_FILTERS, seedPos } from '../lib/graphData';
import { GraphCanvas, type GraphHandle } from '../components/GraphCanvas';
import { useFolderTree, useTagList, type FolderNode } from '../derived';
import { go, noteRoute, notesRoute, useReducedMotion, useMediaQuery, Dialog, plainSnippet, plural } from '../ui';
import { NeedsImport } from './Home';
import type { GraphFilters } from '../lib/types';
import { AddToBoard } from './Boards';

const posCache = new Map<string, [number, number]>();

function flat(n: FolderNode, out: string[] = []) { for (const c of n.children) { out.push(c.path); flat(c, out); } return out; }

export function NodeDetails({ nodeKey, onClose, compact }: { nodeKey: string; onClose?: () => void; compact?: boolean }) {
  const { notes, index } = useStore((s) => s);
  const [addOpen, setAddOpen] = useState(false);
  if (!index) return null;
  if (nodeKey.startsWith('note:')) {
    const path = nodeKey.slice(5);
    const n = notes.get(path);
    const L = index.links[path];
    if (!n || !L) return null;
    return (
      <div className="stack" style={{ gap: 14 }}>
        <div>
          <div className="xs faint wrap-any">{n.path}</div>
          <div style={{ fontFamily: 'var(--font-read)', fontSize: '1.25rem', fontWeight: 600, lineHeight: 1.25 }} className="wrap-any">{n.name}</div>
          {n.missing && <span className="badge warn">Missing from latest snapshot</span>}
        </div>
        <div className="small muted" style={{ fontFamily: 'var(--font-read)' }}>{plainSnippet(n.content, [], 260).text || <span className="faint">Empty note</span>}</div>
        <div className="row-wrap">
          <a className="btn sm primary" href={noteRoute(path)} data-testid="button-open-note"><FileText />Open note</a>
          <a className="btn sm" href={`#/graph?center=${encodeURIComponent(path)}`}>Local graph</a>
          <button className="btn sm" onClick={() => setAddOpen(true)}><LayoutDashboard />Add to board</button>
          {onClose && <button className="btn sm ghost" onClick={onClose}><X />Close</button>}
        </div>
        <div className="small"><strong className="num">{L.outNotes.length}</strong> outgoing · <strong className="num">{L.inNotes.length}</strong> backlinks · <strong className="num">{n.parsed.tags.length}</strong> tags</div>
        {!compact && (
          <>
            {L.outNotes.length > 0 && <div className="side-block"><h3>Links to</h3><div className="link-list">{L.outNotes.slice(0, 30).map((t) => <a key={t} href={noteRoute(t)}>{notes.get(t)?.name ?? t}</a>)}</div></div>}
            {L.inNotes.length > 0 && <div className="side-block"><h3>Linked from</h3><div className="link-list">{L.inNotes.slice(0, 30).map((t) => <a key={t} href={noteRoute(t)}>{notes.get(t)?.name ?? t}</a>)}</div></div>}
            {n.parsed.tags.length > 0 && <div className="row-wrap">{n.parsed.tags.map((t) => <a key={t} className="chip" href={notesRoute({ tag: t })}>#{t}</a>)}</div>}
          </>
        )}
        {addOpen && <AddToBoard paths={[path]} onClose={() => setAddOpen(false)} />}
      </div>
    );
  }
  if (nodeKey.startsWith('tag:')) {
    const t = index.tags[nodeKey.slice(4)];
    return (
      <div className="stack">
        <div className="row"><Hash size={18} /><strong>{t?.name}</strong></div>
        <div className="small muted">Tag membership — {plural(t?.notes.length ?? 0, 'note')}. Notes sharing a tag are <em>not</em> counted as linked to each other.</div>
        <div className="row-wrap"><a className="btn sm primary" href={notesRoute({ tag: t?.name })}>List notes</a>{onClose && <button className="btn sm ghost" onClick={onClose}>Close</button>}</div>
      </div>
    );
  }
  if (nodeKey.startsWith('att:')) {
    const p = nodeKey.slice(4);
    return (
      <div className="stack">
        <div className="row"><Paperclip size={18} /><strong className="wrap-any">{p}</strong></div>
        <div className="small muted">Attachment referenced by {plural(index.attachmentRefs[p]?.length ?? 0, 'note')}.</div>
        <div className="row-wrap"><a className="btn sm primary" href={`#/file/${p.split('/').map(encodeURIComponent).join('/')}`}>View attachment</a>{onClose && <button className="btn sm ghost" onClick={onClose}>Close</button>}</div>
      </div>
    );
  }
  if (nodeKey.startsWith('unres:')) {
    return (
      <div className="stack">
        <div className="row"><AlertTriangle size={18} color="var(--danger)" /><strong className="wrap-any">{nodeKey.slice(6)}</strong></div>
        <div className="small muted">Link target with no unique matching note in this snapshot. Vault Atlas does not create notes for it.</div>
        <div className="row-wrap"><a className="btn sm" href="#/diagnostics">Open diagnostics</a>{onClose && <button className="btn sm ghost" onClick={onClose}>Close</button>}</div>
      </div>
    );
  }
  return null;
}

export default function GraphPage({ query }: { query: URLSearchParams }) {
  const { index, notes, contentLoaded, vault, app, views, settings } = useStore((s) => s);
  const theme = document.documentElement.dataset.theme ?? 'dark';
  const reduced = useReducedMotion();
  const isNarrow = useMediaQuery('(max-width: 860px)');
  const tree = useFolderTree();
  const tagList = useTagList();
  const center = query.get('center') ?? undefined;
  const [mode, setMode] = useState<'full' | 'local'>(center ? 'local' : 'full');
  const [depth, setDepth] = useState(Number(query.get('depth') ?? 1));
  const [filters, setFilters] = useState<GraphFilters>(DEFAULT_FILTERS);
  const [selected, setSelected] = useState<string | null>(center ? 'note:' + center : null);
  const [live, setLive] = useState(false);
  const [ctrlOpen, setCtrlOpen] = useState(false);
  const [jump, setJump] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [viewName, setViewName] = useState('');
  const [layoutTick, setLayoutTick] = useState(0);
  const h = useRef<GraphHandle>(null);
  useEffect(() => { if (center) { setMode('local'); setSelected('note:' + center); } }, [center]);
  const frozen = app?.frozenPositions;
  const effCenter = mode === 'local' ? (center ?? (selected?.startsWith('note:') ? selected.slice(5) : undefined)) : undefined;

  const built = useMemo(() => {
    if (!index) return null;
    const positions: Record<string, [number, number]> = {};
    posCache.forEach((v, k) => (positions[k] = v));
    const b = buildGraph(index, notes, { mode: effCenter ? 'local' : 'full', center: effCenter, depth, filters, limit: settings.graphNodeLimit }, frozen ?? positions);
    let all = true;
    b.graph.forEachNode((k, a) => {
      if (!(frozen?.[k] ?? posCache.get(k))) {
        all = false;
        // place new nodes near an already-placed neighbour
        const nb = b.graph.neighbors(k).find((x) => frozen?.[x] ?? posCache.get(x));
        if (nb) { const [x, y] = (frozen?.[nb] ?? posCache.get(nb))!; const [jx, jy] = seedPos(k); b.graph.mergeNodeAttributes(k, { x: x + jx / 20, y: y + jy / 20 }); }
      }
    });
    return { ...b, allPlaced: all };
  }, [index, notes, effCenter, depth, filters, settings.graphNodeLimit, frozen, layoutTick]);

  const remember = () => { const p = h.current?.positions(); if (p) Object.entries(p).forEach(([k, v]) => posCache.set(k, v)); };
  useEffect(() => () => remember(), [built]);

  if (!vault) return <div className="page"><div className="empty-sm">No vault yet. <a href="#/import">Import your vault</a>.</div></div>;
  if (!contentLoaded) return <NeedsImport />;
  if (!index || !built) return <div className="page"><div className="empty-sm">Indexing…</div></div>;

  const setF = (p: Partial<GraphFilters>) => { remember(); setFilters((f) => ({ ...f, ...p })); };
  const folders = flat(tree);
  const jumpMatches = jump.trim() ? (() => {
    const q = jump.toLowerCase();
    const out: { key: string; label: string; sub: string }[] = [];
    built.graph.forEachNode((k, a) => { if (out.length < 8 && String(a.label).toLowerCase().includes(q)) out.push({ key: k, label: a.label, sub: a.path ?? a.kind }); });
    return out;
  })() : [];
  const doJump = (k: string) => { setSelected(k); setJump(''); setTimeout(() => h.current?.focusNode(k), 30); };
  const freeze = () => {
    if (frozen) { setFrozen(undefined); toast('Layout unfrozen — positions will be recalculated'); return; }
    h.current?.stopLive();
    const pos = { ...Object.fromEntries(posCache), ...h.current!.positions() };
    setFrozen(pos);
    toast('Layout frozen — node positions are saved on this device');
  };
  const save = () => {
    const name = viewName.trim() || `View ${views.length + 1}`;
    saveView({ id: newId(), vaultId: vault.id, name, mode: effCenter ? 'local' : 'full', center: effCenter, depth, filters, positions: h.current?.positions(), createdAt: Date.now() });
    setSaveOpen(false); setViewName(''); toast(`Saved graph view “${name}”`);
  };
  const applyView = (id: string) => {
    const v = views.find((x) => x.id === id);
    if (!v) return;
    remember();
    if (v.positions) Object.entries(v.positions).forEach(([k, p]) => posCache.set(k, p));
    setFilters({ ...DEFAULT_FILTERS, ...v.filters });
    setDepth(v.depth);
    setMode(v.mode);
    if (v.mode === 'local' && v.center) { go(`#/graph?center=${encodeURIComponent(v.center)}`); setSelected('note:' + v.center); }
    else { if (center) go('#/graph'); setSelected(null); }
    setLayoutTick((t) => t + 1);
  };

  const onOpen = (k: string) => {
    if (k.startsWith('note:')) go(noteRoute(k.slice(5)));
    else if (k.startsWith('tag:')) go(notesRoute({ tag: index.tags[k.slice(4)]?.name }));
  };

  return (
    <div className={'graph-page' + (ctrlOpen ? ' controls-open' : '')}>
      <aside className="graph-controls" aria-label="Graph settings">
        <div className="row"><strong className="grow">Graph</strong><button className="btn icon sm ghost graph-controls-toggle" aria-label="Close settings" onClick={() => setCtrlOpen(false)}><X /></button></div>
        <div className="ctrl-group">
          <span className="label">Scope</span>
          <div className="seg" role="group" aria-label="Graph scope">
            <button aria-pressed={!effCenter} onClick={() => { setMode('full'); if (center) go('#/graph'); }} data-testid="button-full-graph">Whole vault</button>
            <button aria-pressed={!!effCenter} onClick={() => { setMode('local'); if (!selected?.startsWith('note:')) toast('Select a note to centre the local graph', 'warn'); }} data-testid="button-local-graph">Local</button>
          </div>
          {mode === 'local' && (
            <label className="field">Depth (note-to-note link hops): {depth}
              <input type="range" min={1} max={4} value={depth} onChange={(e) => setDepth(Number(e.target.value))} aria-label="Local graph depth" data-testid="input-depth" />
            </label>
          )}
          {effCenter && <div className="xs muted wrap-any">Centred on <strong>{notes.get(effCenter)?.name}</strong></div>}
        </div>
        <div className="ctrl-group">
          <span className="label">Show</span>
          <label className="check"><input type="checkbox" checked={filters.showTags} onChange={(e) => setF({ showTags: e.target.checked })} data-testid="toggle-tags" />Tag nodes</label>
          <label className="check"><input type="checkbox" checked={filters.showAttachments} onChange={(e) => setF({ showAttachments: e.target.checked })} data-testid="toggle-attachments" />Attachment nodes</label>
          <label className="check"><input type="checkbox" checked={filters.showUnresolved} onChange={(e) => setF({ showUnresolved: e.target.checked })} data-testid="toggle-unresolved" />Unresolved &amp; ambiguous links</label>
          <label className="check"><input type="checkbox" checked={filters.showOrphans} onChange={(e) => setF({ showOrphans: e.target.checked })} data-testid="toggle-orphans" />Orphan notes</label>
          <label className="check"><input type="checkbox" checked={filters.arrows} onChange={(e) => setF({ arrows: e.target.checked })} data-testid="toggle-arrows" />Arrows on outgoing links</label>
          <label className="check"><input type="checkbox" checked={filters.sizeByDegree} onChange={(e) => setF({ sizeByDegree: e.target.checked })} />Size by connection count</label>
        </div>
        <div className="ctrl-group">
          <span className="label">Colour &amp; labels</span>
          <div className="seg" role="group" aria-label="Colour nodes by">
            {(['folder', 'tag', 'none'] as const).map((c) => <button key={c} aria-pressed={filters.colorBy === c} onClick={() => setF({ colorBy: c })}>{c === 'none' ? 'Plain' : 'By ' + c}</button>)}
          </div>
          <div className="seg" role="group" aria-label="Labels">
            {(['adaptive', 'selected', 'all'] as const).map((c) => <button key={c} aria-pressed={filters.labels === c} onClick={() => setF({ labels: c })}>{c === 'adaptive' ? 'Labels: zoom' : c === 'selected' ? 'Selection' : 'All'}</button>)}
          </div>
        </div>
        <div className="ctrl-group">
          <span className="label">Filter by folder</span>
          <div className="chip-pick">
            {[{ p: '/', l: 'root' }, ...folders.map((p) => ({ p, l: p }))].map(({ p, l }) => {
              const on = filters.folders.includes(p);
              return <button key={p} className={'chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => setF({ folders: on ? filters.folders.filter((x) => x !== p) : [...filters.folders, p] })}>{l}</button>;
            })}
          </div>
        </div>
        <div className="ctrl-group">
          <div className="row"><span className="label grow">Filter by tag</span>
            <div className="seg" role="group" aria-label="Tag filter mode">
              <button aria-pressed={filters.tagMode === 'or'} onClick={() => setF({ tagMode: 'or' })} title="Notes with any selected tag">ANY</button>
              <button aria-pressed={filters.tagMode === 'and'} onClick={() => setF({ tagMode: 'and' })} title="Notes with all selected tags">ALL</button>
            </div>
          </div>
          <div className="chip-pick">
            {tagList.slice(0, 80).map((t) => {
              const on = filters.tags.some((x) => x.toLowerCase() === t.key);
              return <button key={t.key} className={'chip' + (on ? ' on' : '')} aria-pressed={on} onClick={() => setF({ tags: on ? filters.tags.filter((x) => x.toLowerCase() !== t.key) : [...filters.tags, t.name] })}>#{t.name}</button>;
            })}
          </div>
          {filters.tags.length > 1 && <div className="xs muted">{filters.tagMode === 'and' ? 'Showing notes that have ALL selected tags (nested tags count).' : 'Showing notes that have ANY selected tag (nested tags count).'}</div>}
        </div>
        <div className="ctrl-group">
          <span className="label">Saved views</span>
          <button className="btn sm" onClick={() => setSaveOpen(true)} data-testid="button-save-view"><Save />Save current view</button>
          {views.map((v) => (
            <div key={v.id} className="row">
              <button className="btn sm ghost grow" style={{ justifyContent: 'flex-start' }} onClick={() => applyView(v.id)}>{v.name}<span className="faint xs">{v.mode === 'local' ? ' · local' : ''}</span></button>
              <button className="btn icon sm ghost" aria-label={`Delete view ${v.name}`} onClick={() => deleteView(v.id)}><Trash2 /></button>
            </div>
          ))}
        </div>
        <button className="btn sm ghost" onClick={() => { remember(); setFilters(DEFAULT_FILTERS); setDepth(1); }}><RotateCcw />Reset filters</button>
      </aside>

      <div className="graph-stage">
        <GraphCanvas ref={h} graph={built.graph} selected={selected} onSelect={setSelected} onOpen={onOpen} labels={filters.labels} theme={theme}
          frozen={built.allPlaced} reducedMotion={reduced} onLiveChange={setLive} onLayoutState={(s) => s === 'ready' && remember()}
          ariaLabel={`Knowledge graph with ${built.graph.order} nodes and ${built.graph.size} edges`} />
        <div className="graph-top">
          <button className="btn sm graph-controls-toggle" onClick={() => setCtrlOpen(true)} data-testid="button-graph-settings"><SlidersHorizontal />Settings</button>
          <div style={{ position: 'relative', width: 'min(300px, 60vw)' }}>
            <input className="input" style={{ minHeight: 40 }} placeholder="Find a node…" value={jump} onChange={(e) => setJump(e.target.value)} aria-label="Find and jump to a node"
              onKeyDown={(e) => { if (e.key === 'Enter' && jumpMatches[0]) doJump(jumpMatches[0].key); }} data-testid="input-graph-find" />
            {jumpMatches.length > 0 && (
              <div className="search-pop" role="listbox">
                {jumpMatches.map((m) => <div key={m.key} role="option" aria-selected={false} className="search-item" onMouseDown={(e) => { e.preventDefault(); doJump(m.key); }}><div className="t">{m.label}</div><div className="p">{m.sub}</div></div>)}
              </div>
            )}
          </div>
          <span className="badge num" data-testid="text-graph-counts">{built.noteCount} notes · {built.graph.size} edges</span>
          {frozen && <span className="badge accent"><Lock />Frozen</span>}
        </div>
        <div className="graph-toolbar" role="toolbar" aria-label="Graph view controls">
          <button className="btn icon" aria-label="Zoom in" title="Zoom in (+)" onClick={() => h.current?.zoomIn()} data-testid="button-zoom-in"><ZoomIn /></button>
          <button className="btn icon" aria-label="Zoom out" title="Zoom out (−)" onClick={() => h.current?.zoomOut()} data-testid="button-zoom-out"><ZoomOut /></button>
          <button className="btn icon" aria-label="Fit to screen" title="Fit to screen (0)" onClick={() => h.current?.fit()} data-testid="button-fit"><Maximize /></button>
          <button className={'btn icon' + (live ? ' on' : '')} aria-label={live ? 'Pause layout' : 'Resume live layout'} title={live ? 'Pause layout' : 'Resume live layout'} disabled={!!frozen} onClick={() => (live ? h.current?.stopLive() : h.current?.startLive())} data-testid="button-layout">{live ? <Pause /> : <Play />}</button>
          <button className={'btn icon' + (frozen ? ' on' : '')} aria-label={frozen ? 'Unfreeze layout' : 'Freeze layout'} title={frozen ? 'Unfreeze layout' : 'Freeze layout (save positions)'} onClick={freeze} data-testid="button-freeze">{frozen ? <Lock /> : <Unlock />}</button>
          <button className="btn icon" aria-label="Re-run layout" title="Re-run layout from scratch" disabled={!!frozen} onClick={() => { posCache.clear(); h.current?.relayout(); }} data-testid="button-relayout"><RotateCcw /></button>
        </div>
        <details className="graph-legend" open={!isNarrow}>
          <summary>Legend</summary>
          {built.legend.slice(0, 10).map((l) => <div key={l.label} className="legend-row"><span className="legend-dot" style={{ background: l.color }} />{l.label}</div>)}
          <div className="legend-row" style={{ marginTop: 4 }}><span className="legend-line" style={{ borderColor: COLORS.linkEdge }} />Link in your notes (wikilink / Markdown)</div>
          {filters.showTags && <div className="legend-row"><span className="legend-line" style={{ borderColor: COLORS.tagEdge, borderTopStyle: 'dotted', borderRadius: 8 }} /><span className="legend-dot" style={{ background: COLORS.tag }} />Tag membership (curved) — not a link</div>}
          {filters.showAttachments && <div className="legend-row"><span className="legend-dot" style={{ background: COLORS.attachment }} />Attachment</div>}
          {filters.showUnresolved && <div className="legend-row"><span className="legend-dot" style={{ background: COLORS.unresolved }} />Unresolved / ambiguous target</div>}
        </details>
        {built.truncated && <div className="graph-banner" style={{ bottom: 'auto', top: 60 }}><span className="badge warn">Showing the {built.truncated.shown.toLocaleString()} most-connected of {built.truncated.total.toLocaleString()} notes — filter or use a local graph</span></div>}
        {selected && (
          <div className="card pad-sm" style={{ position: 'absolute', right: 12, bottom: 12, width: 'min(340px, calc(100% - 24px))', maxHeight: '55%', overflowY: 'auto', zIndex: 7, boxShadow: 'var(--shadow)' }} data-testid="panel-node-details">
            <NodeDetails nodeKey={selected} onClose={() => setSelected(null)} compact />
          </div>
        )}
      </div>
      {saveOpen && (
        <Dialog title="Save graph view" onClose={() => setSaveOpen(false)}>
          <label className="field">Name<input className="input" value={viewName} onChange={(e) => setViewName(e.target.value)} placeholder="e.g. Journal + health" autoFocus onKeyDown={(e) => e.key === 'Enter' && save()} data-testid="input-view-name" /></label>
          <div className="xs muted">Saves scope, depth, filters and current node positions on this device. Views are app-only data and are included in settings export.</div>
          <div className="dialog-actions"><button className="btn ghost" onClick={() => setSaveOpen(false)}>Cancel</button><button className="btn primary" onClick={save} data-testid="button-save-view-confirm">Save view</button></div>
        </Dialog>
      )}
    </div>
  );
}
