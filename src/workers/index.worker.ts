/// <reference lib="webworker" />
import MiniSearch from 'minisearch';
import { buildIndex, type IndexNoteInput } from '../lib/indexer';

interface SearchDoc { id: string; title: string; aliases: string; tags: string; path: string; headings: string; props: string; content: string }
let mini: MiniSearch<SearchDoc> | null = null;

function propsText(fm: Record<string, unknown> | null): string {
  if (!fm) return '';
  try { return Object.entries(fm).map(([k, v]) => `${k} ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(' \n'); } catch { return ''; }
}

self.onmessage = (ev: MessageEvent) => {
  const msg = ev.data;
  if (msg.type === 'build') {
    const t0 = performance.now();
    const notes: (IndexNoteInput & { content: string })[] = msg.notes;
    const index = buildIndex(notes, msg.attachments, msg.unsupported, msg.aliasFallback);
    const t1 = performance.now();
    mini = new MiniSearch<SearchDoc>({
      fields: ['title', 'aliases', 'tags', 'path', 'headings', 'props', 'content'],
      storeFields: [],
      searchOptions: { boost: { title: 5, aliases: 4, tags: 3, headings: 2, path: 1.5, props: 1.2 }, prefix: true, fuzzy: 0.15, combineWith: 'AND' },
      tokenize: (s) => s.toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean),
    });
    mini.addAll(notes.map((n) => ({
      id: n.path,
      title: n.name,
      aliases: n.parsed.aliases.join(' '),
      tags: n.parsed.tags.map((t) => t.replace(/\//g, ' ') + ' ' + t).join(' '),
      path: n.path.replace(/[\/._-]/g, ' '),
      headings: n.parsed.headings.map((h) => h.text).join(' '),
      props: propsText(n.parsed.frontmatter),
      content: n.content,
    })));
    postMessage({ type: 'built', reqId: msg.reqId, index, timings: { index: t1 - t0, search: performance.now() - t1 } });
  } else if (msg.type === 'search') {
    if (!mini || !msg.q.trim()) return postMessage({ type: 'results', reqId: msg.reqId, results: [] });
    let r = mini.search(msg.q);
    if (!r.length) r = mini.search(msg.q, { combineWith: 'OR' });
    postMessage({ type: 'results', reqId: msg.reqId, results: r.slice(0, msg.limit ?? 200).map((x) => ({ path: x.id, score: x.score, terms: x.terms, match: x.match })) });
  }
};
