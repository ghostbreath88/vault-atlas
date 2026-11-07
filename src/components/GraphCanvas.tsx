import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import Sigma from 'sigma';
import { EdgeArrowProgram, EdgeLineProgram } from 'sigma/rendering';
import EdgeCurveProgram from '@sigma/edge-curve';
import FA2Layout from 'graphology-layout-forceatlas2/worker';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import type Graph from 'graphology';
import LayoutWorker from '../workers/layout.worker?worker';

export interface GraphHandle {
  fit: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  focusNode: (key: string) => void;
  positions: () => Record<string, [number, number]>;
  startLive: () => void;
  stopLive: () => void;
  relayout: () => void;
  isLive: () => boolean;
}

interface Props {
  graph: Graph;
  selected: string | null;
  onSelect: (key: string | null) => void;
  onOpen?: (key: string) => void;
  labels: 'adaptive' | 'selected' | 'all';
  theme: string;
  /** All nodes already have trusted positions (frozen) — skip initial layout. */
  frozen?: boolean;
  compact?: boolean;
  reducedMotion?: boolean;
  onLiveChange?: (live: boolean) => void;
  onLayoutState?: (s: 'computing' | 'ready') => void;
  ariaLabel: string;
}

let lw: Worker | null = null;
let lseq = 0;
function computeLayout(graph: Graph): Promise<Record<string, [number, number]>> {
  lw ??= new LayoutWorker();
  const reqId = ++lseq;
  const nodes: { key: string; x: number; y: number; size: number }[] = [];
  graph.forEachNode((key, a) => nodes.push({ key, x: a.x, y: a.y, size: a.size }));
  const edges: [string, string][] = [];
  graph.forEachEdge((_e, _a, s, t) => edges.push([s, t]));
  return new Promise((res) => {
    const on = (e: MessageEvent) => { if (e.data.reqId === reqId) { lw!.removeEventListener('message', on); res(e.data.positions); } };
    lw!.addEventListener('message', on);
    lw!.postMessage({ reqId, nodes, edges });
  });
}

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export const GraphCanvas = forwardRef<GraphHandle, Props>(function GraphCanvas(p, ref) {
  const box = useRef<HTMLDivElement>(null);
  const sig = useRef<Sigma | null>(null);
  const fa2 = useRef<FA2Layout | null>(null);
  const liveTimer = useRef<number>();
  const state = useRef({ selected: p.selected as string | null, hovered: null as string | null, labels: p.labels, neighbors: new Set<string>() });
  const props = useRef(p);
  props.current = p;
  const [computing, setComputing] = useState(false);

  const setNeighbors = () => {
    const g = p.graph;
    const focus = state.current.selected ?? state.current.hovered;
    state.current.neighbors = focus && g.hasNode(focus) ? new Set(g.neighbors(focus)) : new Set();
  };

  // Build renderer when the graph object changes
  useEffect(() => {
    const g = p.graph;
    const el = box.current!;
    let cancelled = false;
    const textColor = css('--text');
    const dim = css('--surface-3') || '#333';
    const edgeColor = css('--graph-edge') || '#888';
    const small = g.order < 80;
    const renderer = new Sigma(g, el, {
      allowInvalidContainer: true,
      renderEdgeLabels: false,
      defaultEdgeType: 'line',
      edgeProgramClasses: { line: EdgeLineProgram, arrow: EdgeArrowProgram, curved: EdgeCurveProgram },
      labelFont: 'Figtree Variable, Figtree, system-ui, sans-serif',
      labelSize: p.compact ? 11 : 13,
      labelWeight: '600',
      labelColor: { color: textColor },
      labelDensity: 0.55,
      labelGridCellSize: 110,
      labelRenderedSizeThreshold: small || p.compact ? 0 : 9,
      zIndex: true,
      minCameraRatio: 0.03,
      maxCameraRatio: 12,
      stagePadding: p.compact ? 56 : 40,
      defaultDrawNodeHover: (ctx, data, settings) => {
        // Theme-aware hover label pill
        const size = settings.labelSize, font = settings.labelFont;
        ctx.font = `600 ${size}px ${font}`;
        const label = data.label ?? '';
        const w = ctx.measureText(label).width + 14;
        const x = data.x + data.size + 4, y = data.y - size / 2 - 5, h = size + 10;
        ctx.fillStyle = css('--surface') || '#222';
        ctx.strokeStyle = css('--line-2') || '#444';
        ctx.beginPath();
        (ctx as any).roundRect ? (ctx as any).roundRect(x, y, w, h, 6) : ctx.rect(x, y, w, h);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = textColor;
        ctx.fillText(label, x + 7, data.y + size / 3);
        ctx.beginPath(); ctx.arc(data.x, data.y, data.size + 2, 0, Math.PI * 2); ctx.strokeStyle = css('--accent'); ctx.lineWidth = 2; ctx.stroke();
      },
      nodeReducer: (node, data) => {
        const s = state.current;
        const res: any = { ...data };
        const focus = s.selected ?? s.hovered;
        if (data.kind === 'unresolved') { res.color = data.color; }
        if (data.missing) res.color = dim;
        if (s.labels === 'all') res.forceLabel = true;
        if (s.labels === 'selected') res.label = node === focus || s.neighbors.has(node) ? data.label : '';
        if (focus) {
          if (node === focus) { res.highlighted = true; res.forceLabel = true; res.zIndex = 2; }
          else if (s.neighbors.has(node)) { res.forceLabel = s.neighbors.size < 40; res.zIndex = 1; }
          else { res.color = dim; res.label = ''; res.zIndex = 0; }
        }
        return res;
      },
      edgeReducer: (edge, data) => {
        const s = state.current;
        const focus = s.selected ?? s.hovered;
        const res: any = { ...data };
        if (data.kind === 'link') res.color = edgeColor;
        if (focus) {
          const [a, b] = g.extremities(edge);
          if (a === focus || b === focus) { res.color = data.kind === 'link' ? css('--accent') : data.color; res.size = (data.size ?? 1) + 1; res.zIndex = 1; }
          else res.hidden = true;
        }
        return res;
      },
    });
    sig.current = renderer;
    if (!p.compact) (window as any).__atlasSigma = renderer; // test hook (local only)
    setNeighbors();

    // Interaction: select / open / drag
    let dragged: string | null = null;
    let moved = false;
    renderer.on('downNode', (e) => {
      dragged = e.node; moved = false;
      if (!renderer.getCustomBBox()) renderer.setCustomBBox(renderer.getBBox());
    });
    renderer.on('moveBody', ({ event }) => {
      if (!dragged) return;
      moved = true;
      const pos = renderer.viewportToGraph(event);
      g.mergeNodeAttributes(dragged, { x: pos.x, y: pos.y, fixed: true });
      event.preventSigmaDefault();
      event.original.preventDefault();
      event.original.stopPropagation();
    });
    const up = () => { if (dragged && g.hasNode(dragged)) g.setNodeAttribute(dragged, 'fixed', false); dragged = null; };
    renderer.on('upNode', up);
    renderer.on('upStage', up);
    renderer.on('clickNode', (e) => { if (moved) { moved = false; return; } props.current.onSelect(e.node); });
    renderer.on('clickStage', () => props.current.onSelect(null));
    renderer.on('doubleClickNode', (e) => { e.preventSigmaDefault(); props.current.onOpen?.(e.node); });
    renderer.on('enterNode', (e) => { state.current.hovered = e.node; if (!state.current.selected) { setNeighbors(); renderer.refresh({ skipIndexation: true }); } el.style.cursor = 'pointer'; });
    renderer.on('leaveNode', () => { state.current.hovered = null; if (!state.current.selected) { setNeighbors(); renderer.refresh({ skipIndexation: true }); } el.style.cursor = ''; });

    // Initial layout
    const finish = () => { if (!cancelled) { setComputing(false); props.current.onLayoutState?.('ready'); } };
    if (p.frozen || g.order <= 1) finish();
    else if (g.order <= 60) {
      forceAtlas2.assign(g, { iterations: 400, settings: { ...forceAtlas2.inferSettings(g), adjustSizes: true, scalingRatio: 6, gravity: 1.2 } });
      finish();
    } else {
      setComputing(true);
      props.current.onLayoutState?.('computing');
      computeLayout(g).then((pos) => {
        if (cancelled) return;
        g.updateEachNodeAttributes((k, a) => (pos[k] ? { ...a, x: pos[k][0], y: pos[k][1] } : a), { attributes: ['x', 'y'] });
        renderer.setCustomBBox(null);
        renderer.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
        finish();
      });
    }
    return () => {
      cancelled = true;
      clearTimeout(liveTimer.current);
      fa2.current?.kill(); fa2.current = null;
      renderer.kill();
      sig.current = null;
    };
  }, [p.graph, p.theme, p.compact]);

  useEffect(() => {
    state.current.selected = p.selected;
    state.current.labels = p.labels;
    setNeighbors();
    const r = sig.current;
    if (!r) return;
    r.setSetting('labelRenderedSizeThreshold', p.labels === 'all' || p.compact || p.graph.order < 80 ? 0 : 9);
    r.setSetting('labelDensity', p.labels === 'all' ? 3 : 0.55);
    r.refresh({ skipIndexation: true });
  }, [p.selected, p.labels]);

  const startLive = () => {
    const g = p.graph;
    if (!sig.current || g.order < 2) return;
    sig.current.setCustomBBox(null);
    fa2.current ??= new FA2Layout(g, { settings: { ...forceAtlas2.inferSettings(g), barnesHutOptimize: g.order > 400, slowDown: 6, scalingRatio: g.order < 50 ? 6 : 3 }, getEdgeWeight: null });
    fa2.current.start();
    props.current.onLiveChange?.(true);
    clearTimeout(liveTimer.current);
    // Stop automatically to save battery; the user can resume.
    liveTimer.current = window.setTimeout(() => stopLive(), g.order > 1500 ? 12000 : 6000);
  };
  const stopLive = () => {
    clearTimeout(liveTimer.current);
    fa2.current?.stop();
    props.current.onLiveChange?.(false);
  };

  useImperativeHandle(ref, () => ({
    fit: () => { sig.current?.setCustomBBox(null); sig.current?.getCamera().animatedReset({ duration: p.reducedMotion ? 0 : 300 }); },
    zoomIn: () => sig.current?.getCamera().animatedZoom({ duration: p.reducedMotion ? 0 : 200 }),
    zoomOut: () => sig.current?.getCamera().animatedUnzoom({ duration: p.reducedMotion ? 0 : 200 }),
    focusNode: (key: string) => {
      const r = sig.current;
      if (!r || !p.graph.hasNode(key)) return;
      const d = r.getNodeDisplayData(key);
      if (d) r.getCamera().animate({ x: d.x, y: d.y, ratio: Math.min(r.getCamera().ratio, 0.5) }, { duration: p.reducedMotion ? 0 : 400 });
    },
    positions: () => { const o: Record<string, [number, number]> = {}; p.graph.forEachNode((k, a) => (o[k] = [a.x, a.y])); return o; },
    startLive, stopLive,
    isLive: () => !!fa2.current?.isRunning(),
    relayout: () => {
      stopLive();
      setComputing(true);
      computeLayout(p.graph).then((pos) => {
        p.graph.updateEachNodeAttributes((k, a) => (pos[k] ? { ...a, x: pos[k][0], y: pos[k][1] } : a), { attributes: ['x', 'y'] });
        sig.current?.setCustomBBox(null);
        sig.current?.getCamera().setState({ x: 0.5, y: 0.5, ratio: 1, angle: 0 });
        setComputing(false);
      });
    },
  }), [p.graph, p.reducedMotion]);

  const onKey = (e: React.KeyboardEvent) => {
    const r = sig.current;
    if (!r) return;
    const cam = r.getCamera();
    const st = cam.getState();
    const step = 0.08 * st.ratio;
    const map: Record<string, () => void> = {
      ArrowLeft: () => cam.setState({ ...st, x: st.x - step }),
      ArrowRight: () => cam.setState({ ...st, x: st.x + step }),
      ArrowUp: () => cam.setState({ ...st, y: st.y + step }),
      ArrowDown: () => cam.setState({ ...st, y: st.y - step }),
      '+': () => cam.animatedZoom({ duration: 150 }), '=': () => cam.animatedZoom({ duration: 150 }),
      '-': () => cam.animatedUnzoom({ duration: 150 }), '0': () => cam.animatedReset({ duration: 200 }),
      Escape: () => props.current.onSelect(null),
      Enter: () => state.current.selected && props.current.onOpen?.(state.current.selected),
    };
    if (map[e.key]) { e.preventDefault(); map[e.key](); }
  };

  return (
    <>
      <div ref={box} className="graph-canvas" tabIndex={0} role="application" aria-label={p.ariaLabel + '. Arrow keys pan, plus and minus zoom, 0 fits, Enter opens the selected note, Escape clears selection.'} onKeyDown={onKey} data-testid="graph-canvas" />
      {computing && <div className="graph-banner"><span className="badge accent">Arranging {p.graph.order.toLocaleString()} nodes on this device…</span></div>}
    </>
  );
});
