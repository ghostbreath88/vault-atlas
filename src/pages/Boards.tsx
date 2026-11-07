import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, ArrowLeft, Link as LinkIcon, ZoomIn, ZoomOut, Maximize, FileText, LayoutDashboard, AlertTriangle, X, Pencil } from 'lucide-react';
import { useStore, saveBoard, deleteBoard, newId, toast, search, getState } from '../store';
import type { Board, BoardCard, BoardLink } from '../lib/types';
import { Confirm, Dialog, Empty, fmtAgo, go, noteRoute, plainSnippet, plural } from '../ui';
import { noteName } from '../lib/paths';
import { NeedsImport } from './Home';

function newBoard(name: string): Board {
  const s = getState();
  return { id: newId(), vaultId: s.vault!.id, name, cards: [], links: [], camera: { x: 80, y: 80, zoom: 1 }, createdAt: Date.now(), updatedAt: Date.now() };
}

function addCards(b: Board, paths: string[]): Board {
  const existing = new Set(b.cards.map((c) => c.notePath));
  const fresh = paths.filter((p) => !existing.has(p));
  const maxY = b.cards.reduce((m, c) => Math.max(m, c.y), -200);
  const cards: BoardCard[] = fresh.map((p, i) => ({ id: newId(), notePath: p, title: noteName(p), x: 40 + (i % 4) * 270, y: maxY + 220 + Math.floor(i / 4) * 200 }));
  return { ...b, cards: [...b.cards, ...cards], updatedAt: Date.now() };
}

export function AddToBoard({ paths, onClose }: { paths: string[]; onClose: () => void }) {
  const boards = useStore((s) => s.boards);
  const [name, setName] = useState('');
  const add = async (b: Board) => {
    const nb = addCards(b, paths);
    await saveBoard(nb);
    toast(`Added to board “${nb.name}”`);
    onClose();
  };
  return (
    <Dialog title="Add to a board" onClose={onClose}>
      <div className="small muted">Boards are your own arrangements. Cards and connections you draw stay inside Vault Atlas — they never change your notes and aren't counted as links.</div>
      {boards.length > 0 && <div className="link-list">{boards.map((b) => <button key={b.id} className="btn ghost" style={{ justifyContent: 'flex-start' }} onClick={() => add(b)} data-testid={`button-board-${b.id}`}><LayoutDashboard />{b.name}<span className="faint xs">{plural(b.cards.length, 'card')}</span></button>)}</div>}
      <form className="row" onSubmit={(e) => { e.preventDefault(); add(newBoard(name.trim() || 'Untitled board')); }}>
        <input className="input" placeholder="New board name" value={name} onChange={(e) => setName(e.target.value)} data-testid="input-new-board" />
        <button className="btn primary" type="submit"><Plus />Create</button>
      </form>
      <div className="dialog-actions"><button className="btn ghost" onClick={onClose}>Cancel</button></div>
    </Dialog>
  );
}

function AddNotesDialog({ board, onAdd, onClose }: { board: Board; onAdd: (paths: string[]) => void; onClose: () => void }) {
  const notes = useStore((s) => s.notes);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [hits, setHits] = useState<string[] | null>(null);
  useEffect(() => { let live = true; if (!q.trim()) { setHits(null); return; } search(q, 60).then((h) => live && setHits(h.map((x) => x.path))); return () => { live = false; }; }, [q]);
  const on = new Set(board.cards.map((c) => c.notePath));
  const list = (hits ?? [...notes.keys()].sort()).filter((p) => notes.has(p)).slice(0, 80);
  return (
    <Dialog title="Add notes as cards" onClose={onClose} wide>
      <input className="input" type="search" placeholder="Search notes" value={q} onChange={(e) => setQ(e.target.value)} autoFocus data-testid="input-board-search" />
      <div style={{ maxHeight: '45dvh', overflowY: 'auto' }} className="link-list">
        {list.map((p) => (
          <label key={p} className="check" style={{ padding: '0 8px', opacity: on.has(p) ? 0.5 : 1 }}>
            <input type="checkbox" disabled={on.has(p)} checked={picked.includes(p) || on.has(p)} onChange={(e) => setPicked(e.target.checked ? [...picked, p] : picked.filter((x) => x !== p))} />
            <span className="grow"><strong className="small">{notes.get(p)!.name}</strong> <span className="xs faint">{p}</span></span>
            {on.has(p) && <span className="xs faint">on board</span>}
          </label>
        ))}
      </div>
      <div className="dialog-actions"><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!picked.length} onClick={() => onAdd(picked)} data-testid="button-add-cards">Add {picked.length || ''} {picked.length === 1 ? 'card' : 'cards'}</button></div>
    </Dialog>
  );
}

function BoardCanvas({ board: initial }: { board: Board }) {
  const notes = useStore((s) => s.notes);
  const [b, setB] = useState(initial);
  const [sel, setSel] = useState<string | null>(null);
  const [selLink, setSelLink] = useState<string | null>(null);
  const [connect, setConnect] = useState<{ on: boolean; from?: string }>({ on: false });
  const [labelDlg, setLabelDlg] = useState<{ from: string; to: string; id?: string; label: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [rename, setRename] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const saveT = useRef<number>();
  const bRef = useRef(b);
  bRef.current = b;
  const update = (nb: Board, now = false) => {
    setB(nb);
    clearTimeout(saveT.current);
    saveT.current = window.setTimeout(() => saveBoard({ ...bRef.current, updatedAt: Date.now() }), now ? 0 : 400);
  };
  useEffect(() => () => { clearTimeout(saveT.current); saveBoard({ ...bRef.current }); }, []);

  const cam = b.camera;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ kind: 'pan' | 'card' | 'pinch' | 'tap'; card?: string; startCam: typeof cam; start: { x: number; y: number }; cardStart?: { x: number; y: number }; dist?: number; mid?: { x: number; y: number }; moved?: boolean } | null>(null);

  const toLocal = (e: { clientX: number; clientY: number }) => { const r = stage.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const zoomAt = (pt: { x: number; y: number }, factor: number, base = bRef.current.camera) => {
    const zoom = Math.min(2.5, Math.max(0.2, base.zoom * factor));
    const k = zoom / base.zoom;
    return { zoom, x: pt.x - (pt.x - base.x) * k, y: pt.y - (pt.y - base.y) * k };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('button, a, .board-label, input')) return;
    stage.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, toLocal(e));
    const cardEl = t.closest<HTMLElement>('[data-card]');
    if (pointers.current.size === 2) {
      const [a, c] = [...pointers.current.values()];
      gesture.current = { kind: 'pinch', startCam: bRef.current.camera, start: a, dist: Math.hypot(a.x - c.x, a.y - c.y), mid: { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 } };
      return;
    }
    if (cardEl && !connect.on) {
      const card = bRef.current.cards.find((c) => c.id === cardEl.dataset.card)!;
      gesture.current = { kind: 'card', card: card.id, startCam: cam, start: toLocal(e), cardStart: { x: card.x, y: card.y } };
      setSel(card.id); setSelLink(null);
    } else if (!cardEl) {
      gesture.current = { kind: 'pan', startCam: cam, start: toLocal(e) };
    } else {
      gesture.current = { kind: 'tap', card: cardEl.dataset.card, startCam: cam, start: toLocal(e) };
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = toLocal(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === 'pinch' && pointers.current.size >= 2) {
      const [a, c] = [...pointers.current.values()];
      const d = Math.hypot(a.x - c.x, a.y - c.y);
      const mid = { x: (a.x + c.x) / 2, y: (a.y + c.y) / 2 };
      const z = zoomAt(g.mid!, d / g.dist!, g.startCam);
      setB((x) => ({ ...x, camera: { ...z, x: z.x + mid.x - g.mid!.x, y: z.y + mid.y - g.mid!.y } }));
      return;
    }
    const dx = p.x - g.start.x, dy = p.y - g.start.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) g.moved = true;
    if (g.kind === 'pan') setB((x) => ({ ...x, camera: { ...g.startCam, x: g.startCam.x + dx, y: g.startCam.y + dy } }));
    if (g.kind === 'card') setB((x) => ({ ...x, cards: x.cards.map((c) => (c.id === g.card ? { ...c, x: g.cardStart!.x + dx / x.camera.zoom, y: g.cardStart!.y + dy / x.camera.zoom } : c)) }));
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g && pointers.current.size === 0) {
      if (g.kind === 'pan' && !g.moved) { setSel(null); setSelLink(null); }
      if (g.kind === 'tap' && !g.moved && g.card) { clickCard(g.card); setSel(g.card); }
      gesture.current = null;
      update(bRef.current);
    }
  };
  const onWheel = (e: React.WheelEvent) => { const z = zoomAt(toLocal(e), e.deltaY < 0 ? 1.12 : 1 / 1.12); update({ ...bRef.current, camera: z }); };
  const zoomBtn = (f: number) => { const r = stage.current!.getBoundingClientRect(); update({ ...b, camera: zoomAt({ x: r.width / 2, y: r.height / 2 }, f) }); };
  const fit = () => {
    if (!b.cards.length) return update({ ...b, camera: { x: 80, y: 80, zoom: 1 } });
    const r = stage.current!.getBoundingClientRect();
    const minX = Math.min(...b.cards.map((c) => c.x)), minY = Math.min(...b.cards.map((c) => c.y));
    const maxX = Math.max(...b.cards.map((c) => c.x + 230)), maxY = Math.max(...b.cards.map((c) => c.y + 150));
    const zoom = Math.min(1.4, Math.max(0.2, Math.min((r.width - 80) / (maxX - minX), (r.height - 80) / (maxY - minY))));
    update({ ...b, camera: { zoom, x: (r.width - (maxX - minX) * zoom) / 2 - minX * zoom, y: (r.height - (maxY - minY) * zoom) / 2 - minY * zoom } });
  };

  const clickCard = (id: string) => {
    if (!connect.on) return;
    if (!connect.from) { setConnect({ on: true, from: id }); return; }
    if (connect.from === id) { setConnect({ on: true }); return; }
    setLabelDlg({ from: connect.from, to: id, label: '' });
    setConnect({ on: true });
  };
  const saveLink = () => {
    if (!labelDlg) return;
    if (labelDlg.id) update({ ...b, links: b.links.map((l) => (l.id === labelDlg.id ? { ...l, label: labelDlg.label } : l)) }, true);
    else update({ ...b, links: [...b.links, { id: newId(), from: labelDlg.from, to: labelDlg.to, label: labelDlg.label.trim() }] }, true);
    setLabelDlg(null);
  };
  const removeCard = (id: string) => { update({ ...b, cards: b.cards.filter((c) => c.id !== id), links: b.links.filter((l) => l.from !== id && l.to !== id) }, true); setSel(null); setConfirmDel(null); };

  const onCardKey = (e: React.KeyboardEvent, c: BoardCard) => {
    const step = e.shiftKey ? 50 : 10;
    const mv: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (mv[e.key]) { e.preventDefault(); update({ ...b, cards: b.cards.map((x) => (x.id === c.id ? { ...x, x: x.x + mv[e.key][0], y: x.y + mv[e.key][1] } : x)) }); }
    else if (e.key === 'Enter') { if (connect.on) clickCard(c.id); else go(noteRoute(c.notePath)); }
    else if (e.key === ' ') { e.preventDefault(); clickCard(c.id); setSel(c.id); }
    else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); setConfirmDel(c.id); }
  };
  const center = (c: BoardCard) => ({ x: c.x + 115, y: c.y + 60 });
  const byId = useMemo(() => new Map(b.cards.map((c) => [c.id, c])), [b.cards]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="board-toolbar">
        <a className="btn icon sm ghost" href="#/boards" aria-label="All boards"><ArrowLeft /></a>
        {rename ? (
          <form onSubmit={(e) => { e.preventDefault(); setRename(false); update(bRef.current, true); }} className="row">
            <input className="input" style={{ minHeight: 36 }} value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} autoFocus onBlur={() => { setRename(false); update(bRef.current, true); }} aria-label="Board name" />
          </form>
        ) : <button className="btn sm ghost" onClick={() => setRename(true)} title="Rename board"><strong>{b.name}</strong><Pencil /></button>}
        <span className="grow" />
        <button className="btn sm primary" onClick={() => setAdding(true)} data-testid="button-add-notes"><Plus />Add notes</button>
        <button className={'btn sm' + (connect.on ? ' on' : '')} aria-pressed={connect.on} onClick={() => setConnect({ on: !connect.on })} data-testid="button-connect"><LinkIcon />{connect.on ? 'Connecting…' : 'Connect cards'}</button>
        <button className="btn icon sm" aria-label="Zoom in" onClick={() => zoomBtn(1.2)}><ZoomIn /></button>
        <button className="btn icon sm" aria-label="Zoom out" onClick={() => zoomBtn(1 / 1.2)}><ZoomOut /></button>
        <button className="btn icon sm" aria-label="Fit cards to screen" onClick={fit}><Maximize /></button>
      </div>
      <div ref={stage} className="board-stage" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel} data-testid="board-stage" aria-label={`Board ${b.name}`} role="region">
        {connect.on && <div className="board-hint"><span className="badge accent">{connect.from ? 'Now tap the card to connect to' : 'Tap the first card'} · <button className="btn sm ghost" style={{ minHeight: 24 }} onClick={() => setConnect({ on: false })}>Done</button></span></div>}
        {!b.cards.length && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}><div className="empty-sm" style={{ textAlign: 'center' }}>Add notes to start arranging.<br />Drag cards by their title · drag the background to pan · pinch or scroll to zoom.</div></div>}
        <div className="board-layer" style={{ transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.zoom})` }}>
          <svg className="board-svg" width="1" height="1" aria-hidden>
            {b.links.map((l) => {
              const a = byId.get(l.from), c = byId.get(l.to);
              if (!a || !c) return null;
              const p = center(a), q = center(c);
              return <g key={l.id}><line className={'bl' + (selLink === l.id ? ' sel' : '')} x1={p.x} y1={p.y} x2={q.x} y2={q.y} /></g>;
            })}
          </svg>
          {b.cards.map((c) => {
            const n = notes.get(c.notePath);
            return (
              <div key={c.id} data-card={c.id} className={'bcard' + (sel === c.id ? ' sel' : '') + (connect.from === c.id ? ' connect-src' : '')} style={{ left: c.x, top: c.y }} tabIndex={0}
                onKeyDown={(e) => onCardKey(e, c)} onFocus={() => setSel(c.id)} aria-label={`Card ${n?.name ?? c.title}${n ? '' : ' (note missing)'}`} data-testid={`board-card-${c.notePath}`}>
                <div className="bcard-head">{n?.name ?? c.title}</div>
                <div className="bcard-path">{c.notePath}</div>
                {n ? <div className="bcard-snippet">{plainSnippet(n.content, [], 140).text}</div> : <div className="bcard-snippet"><span className="badge warn"><AlertTriangle />Not in current snapshot</span></div>}
                <div className="bcard-foot">
                  {n && <a className="btn icon sm ghost" href={noteRoute(c.notePath)} aria-label={`Open ${n.name}`}><FileText /></a>}
                  <span className="grow" />
                  <button className="btn icon sm ghost" aria-label="Remove card" onClick={(e) => { e.stopPropagation(); setConfirmDel(c.id); }}><X /></button>
                </div>
              </div>
            );
          })}
          {b.links.map((l) => {
            const a = byId.get(l.from), c = byId.get(l.to);
            if (!a || !c) return null;
            const p = center(a), q = center(c);
            return <button key={l.id} className="board-label" style={{ left: (p.x + q.x) / 2, top: (p.y + q.y) / 2 }} onClick={() => { setSelLink(l.id); setLabelDlg({ from: l.from, to: l.to, id: l.id, label: l.label }); }} title="Edit connection" data-testid={`board-link-${l.id}`}>{l.label || 'connection'}</button>;
          })}
        </div>
      </div>
      {adding && <AddNotesDialog board={b} onClose={() => setAdding(false)} onAdd={(ps) => { update(addCards(b, ps), true); setAdding(false); }} />}
      {labelDlg && (
        <Dialog title={labelDlg.id ? 'Edit connection' : 'Label this connection'} onClose={() => setLabelDlg(null)}>
          <div className="small muted">{byId.get(labelDlg.from)?.title} → {byId.get(labelDlg.to)?.title}. Board connections are app-only and never added to your notes.</div>
          <input className="input" value={labelDlg.label} onChange={(e) => setLabelDlg({ ...labelDlg, label: e.target.value })} placeholder="e.g. inspired by, contradicts, next step" autoFocus onKeyDown={(e) => e.key === 'Enter' && saveLink()} data-testid="input-link-label" />
          <div className="dialog-actions">
            {labelDlg.id && <button className="btn danger" onClick={() => { update({ ...b, links: b.links.filter((l) => l.id !== labelDlg.id) }, true); setLabelDlg(null); }}><Trash2 />Delete</button>}
            <button className="btn ghost" onClick={() => setLabelDlg(null)}>Cancel</button>
            <button className="btn primary" onClick={saveLink} data-testid="button-save-link">Save</button>
          </div>
        </Dialog>
      )}
      {confirmDel && <Confirm title="Remove card?" body="This removes the card and its board connections. Your note is not affected." confirmLabel="Remove" danger onCancel={() => setConfirmDel(null)} onConfirm={() => removeCard(confirmDel)} />}
    </div>
  );
}

export default function Boards({ id }: { id?: string }) {
  const { boards, vault, contentLoaded } = useStore((s) => s);
  const [name, setName] = useState('');
  const [del, setDel] = useState<Board | null>(null);
  if (!vault) return <div className="page"><div className="empty-sm">No vault. <a href="#/import">Import your vault</a>.</div></div>;
  if (id) {
    const b = boards.find((x) => x.id === id);
    if (!b) return <div className="page"><Empty title="Board not found" action={<a className="btn" href="#/boards">All boards</a>} /></div>;
    if (!contentLoaded) return <NeedsImport />;
    return <BoardCanvas key={b.id} board={b} />;
  }
  return (
    <div className="page">
      <div className="page-head"><div><h1 className="page-title">Boards</h1><p className="page-sub">Hand-arranged maps of selected notes. Connections you draw here are yours alone — they're saved in Vault Atlas, never written to Obsidian, and never counted as wikilinks.</p></div></div>
      <form className="row" style={{ marginBottom: 20, maxWidth: 520 }} onSubmit={async (e) => { e.preventDefault(); const nb = newBoard(name.trim() || 'Untitled board'); await saveBoard(nb); setName(''); go(`#/boards/${nb.id}`); }}>
        <input className="input" placeholder="New board name" value={name} onChange={(e) => setName(e.target.value)} aria-label="New board name" data-testid="input-board-name" />
        <button className="btn primary" type="submit" data-testid="button-create-board"><Plus />Create board</button>
      </form>
      {boards.length ? (
        <div className="grid cols-3">
          {boards.map((b) => (
            <div key={b.id} className="card pad-sm stack" style={{ gap: 8 }}>
              <a href={`#/boards/${b.id}`} style={{ color: 'var(--text)', textDecoration: 'none', fontWeight: 650 }} data-testid={`link-board-${b.id}`}>{b.name}</a>
              <div className="xs faint">{plural(b.cards.length, 'card')} · {plural(b.links.length, 'connection')} · edited {fmtAgo(b.updatedAt)}</div>
              <div className="row"><a className="btn sm" href={`#/boards/${b.id}`}>Open</a><span className="grow" /><button className="btn icon sm ghost" aria-label={`Delete board ${b.name}`} onClick={() => setDel(b)}><Trash2 /></button></div>
            </div>
          ))}
        </div>
      ) : <div className="empty-sm">No boards yet.</div>}
      {del && <Confirm title={`Delete “${del.name}”?`} body="The board, its cards and drawn connections are removed from this device. Your notes are not affected." confirmLabel="Delete board" danger onCancel={() => setDel(null)} onConfirm={() => { deleteBoard(del.id); setDel(null); }} />}
    </div>
  );
}

export type { BoardLink };
