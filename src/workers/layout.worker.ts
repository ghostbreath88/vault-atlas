/// <reference lib="webworker" />
import Graph from 'graphology';
import forceAtlas2 from 'graphology-layout-forceatlas2';

// Computes a settled ForceAtlas2 layout off the main thread.
self.onmessage = (ev: MessageEvent) => {
  const { reqId, nodes, edges } = ev.data as { reqId: number; nodes: { key: string; x: number; y: number; size: number }[]; edges: [string, string][] };
  const g = new Graph({ multi: true });
  for (const n of nodes) g.addNode(n.key, { x: n.x, y: n.y, size: n.size });
  for (const [s, t] of edges) if (g.hasNode(s) && g.hasNode(t)) g.addEdge(s, t);
  const n = g.order;
  const iterations = n < 300 ? 500 : n < 1500 ? 300 : n < 5000 ? 160 : 90;
  const settings = { ...forceAtlas2.inferSettings(g), barnesHutOptimize: n > 400, adjustSizes: n < 400, gravity: 1.2, strongGravityMode: false, scalingRatio: n < 50 ? 6 : n < 500 ? 4 : 2, slowDown: 2 };
  const t0 = performance.now();
  forceAtlas2.assign(g, { iterations, settings });
  const out: Record<string, [number, number]> = {};
  g.forEachNode((k, a) => { out[k] = [a.x, a.y]; });
  postMessage({ reqId, positions: out, ms: performance.now() - t0, iterations });
};
