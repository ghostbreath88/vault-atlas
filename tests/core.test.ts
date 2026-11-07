import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseNote } from '../src/lib/parser';
import { scanSource, type ScanResult } from '../src/lib/importCore';
import { buildIndex, type VaultIndex } from '../src/lib/indexer';
import { computeDiff, applyMovesToAppData, findDangling } from '../src/lib/diff';
import { defaultAppData } from '../src/lib/db';

const zipBlob = (n: string) => new Blob([readFileSync(new URL(`../fixtures/${n}`, import.meta.url))]);
const strip = (r: ScanResult, p: string) => (r.root ? p.slice(r.root.length + 1) : p);

async function load(n: string, aliasFallback = false) {
  const r = await scanSource({ kind: 'zip', file: zipBlob(n), label: n }, { maxAttachmentBytes: 50e6 });
  const notes = r.notes.map((x) => { const path = strip(r, x.rawPath); return { path, name: path.split('/').pop()!.replace(/\.md$/, ''), folder: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '', parsed: x.parsed, hash: x.hash }; });
  const atts = r.attachments.map((a) => strip(r, a.rawPath));
  const unsup = r.unsupported.map((u) => strip(r, u.path));
  return { r, notes, idx: buildIndex(notes, atts, unsup, aliasFallback), atts };
}

describe('parser', () => {
  it('separates target, fragment and display', () => {
    const p = parseNote('[[Folder/Note#Heading|Shown]] [[Note#^blk]] [[Note.md]] ![[img.png]] [[#Local]]');
    expect(p.links.map((l) => [l.target, l.fragment, l.fragmentType, l.display, l.embed])).toEqual([
      ['Folder/Note', 'Heading', 'heading', 'Shown', false],
      ['Note', 'blk', 'block', undefined, false],
      ['Note.md', undefined, undefined, undefined, false],
      ['img.png', undefined, undefined, undefined, true],
      ['', 'Local', 'heading', undefined, false],
    ]);
  });
  it('ignores links/tags in code, comments, URLs and headings', () => {
    const p = parseNote(readFileSync(new URL('../fixtures/vault-v1/Atlas Demo Vault/Code Samples.md', import.meta.url), 'utf8'));
    expect(p.links.map((l) => l.target)).toEqual(['Welcome']);
    expect(p.tags).toEqual(['real-tag']);
  });
  it('reads frontmatter tags (list + string), aliases, nested inline tags', () => {
    const w = parseNote(readFileSync(new URL('../fixtures/vault-v1/Atlas Demo Vault/Welcome.md', import.meta.url), 'utf8'));
    expect(w.aliases).toEqual(['Home', 'Start Here']);
    expect(new Set(w.tags)).toEqual(new Set(['meta', 'start', 'inbox', 'health/sleep']));
    expect(w.tagSources['meta']).toEqual(['frontmatter']);
    const g = parseNote('---\ntags: garden, ideas/outdoor\n---\n#garden/vegetables');
    expect(g.tags.sort()).toEqual(['garden', 'garden/vegetables', 'ideas/outdoor']);
    expect(parseNote('# Heading\nIssue #123 and C# and url https://x.y/#frag').tags).toEqual([]);
  });
  it('finds headings and block ids, and frontmatter property links', () => {
    const p = parseNote('---\nrelated: "[[A]]"\n---\n# One\ntext ^b-1\n## Two');
    expect(p.headings.map((h) => h.text)).toEqual(['One', 'Two']);
    expect(p.blockIds).toEqual(['b-1']);
    expect(p.links[0]).toMatchObject({ target: 'A', property: 'related' });
  });
  it('handles bad frontmatter without throwing', () => {
    const p = parseNote('---\ntags: [unclosed\n---\nbody #ok');
    expect(p.frontmatterError).toBeTruthy();
    expect(p.tags).toEqual(['ok']);
  });
});

describe('import + resolution on synthetic vault v1', () => {
  let L: Awaited<ReturnType<typeof load>>;
  let idx: VaultIndex;
  beforeAll(async () => { L = await load('vault-v1.zip'); idx = L.idx; });
  const out = (p: string) => idx.links[p].out;
  it('inventories files', () => {
    expect(L.r.root).toBe('Atlas Demo Vault');
    expect(L.notes.length).toBe(14);
    expect(L.atts.sort()).toEqual(['files/manual.pdf', 'images/fern.png']);
    expect(L.r.unsupported.map((u) => strip(L.r, u.path)).sort()).toEqual(['Board.canvas', 'notes.txt']);
    expect(L.r.ignored.length).toBe(3);
    expect(L.r.failed.map((f) => strip(L.r, f.path))).toEqual(['Broken.md']);
  });
  it('resolves wikilinks, headings, blocks, relative + encoded markdown links', () => {
    const w = out('Welcome.md');
    const by = (raw: string) => w.find((l) => l.raw.includes(raw))!;
    expect(by('my little garden')).toMatchObject({ status: 'resolved', targetPath: 'Ideas/Garden.md', display: 'my little garden' });
    expect(by('Morning pages')).toMatchObject({ targetPath: 'Journal/2026-03-14.md', fragment: 'Morning pages', fragmentFound: true });
    expect(by('starter ratio')).toMatchObject({ targetPath: 'Recipes/Bread.md', fragmentType: 'block', fragmentFound: true });
    expect(by('Orphaned Thought.md')).toMatchObject({ targetPath: 'Orphaned Thought.md' });
    expect(by('[[#Section two]]')).toMatchObject({ status: 'self', fragmentFound: true });
    expect(by('[the garden]')).toMatchObject({ kind: 'markdown', targetPath: 'Ideas/Garden.md' });
    expect(by('Big%20Ideas')).toMatchObject({ targetPath: 'Ideas/Big Ideas.md' });
    expect(by('[[Missing Note]]').status).toBe('unresolved');
    expect(by('[[Meeting]]')).toMatchObject({ status: 'ambiguous', candidates: ['Personal/Meeting.md', 'Work/Meeting.md'] });
    expect(by('[[AKA Thing]]').status).toBe('unresolved');
    expect(by('example.com/page').status).toBe('external');
    expect(by('fern.png')).toMatchObject({ embed: true, targetKind: 'attachment', targetPath: 'images/fern.png' });
    expect(by('Board.canvas').status).toBe('unsupported');
    expect(by('[[Ideas/Garden]]')).toMatchObject({ property: 'related' });
  });
  it('relative ../ markdown link and same-folder preference for duplicates', () => {
    expect(out('Ideas/Garden.md').find((l) => l.raw.includes('../Recipes'))!.targetPath).toBe('Recipes/Bread.md');
    expect(out('Work/Notes.md')[0]).toMatchObject({ status: 'resolved-nearest', targetPath: 'Work/Meeting.md' });
    expect(out('Personal/Plan.md').map((l) => l.targetPath)).toEqual(['Personal/Meeting.md', 'Work/Meeting.md']);
  });
  it('keeps duplicate filenames as distinct notes', () => {
    expect(idx.links['Work/Meeting.md'].inNotes).toEqual(expect.arrayContaining(['Work/Notes.md', 'Personal/Plan.md']));
    expect(idx.links['Personal/Meeting.md'].inNotes).toEqual(['Personal/Plan.md']);
  });
  it('graph edges / tags / orphans / stats', () => {
    const e = new Set(idx.edges.map((x) => `${x.source} -> ${x.target}`));
    expect(e.has('Welcome.md -> Ideas/Garden.md')).toBe(true);
    expect(e.has('Ideas/Garden.md -> Welcome.md')).toBe(true);
    expect(e.has('Code Samples.md -> Welcome.md')).toBe(true);
    expect([...e].some((x) => x.includes('Fake'))).toBe(false);
    expect([...e].some((x) => x.startsWith('Welcome.md -> Welcome.md'))).toBe(false);
    expect(idx.orphans.sort()).toEqual(['Aliased Note.md', 'Lonely.md', 'Unsafe HTML.md']);
    expect(idx.tags['health'].notes.sort()).toEqual(['Journal/2026-03-14.md', 'Welcome.md']);
    expect(idx.tags['health/sleep']).toBeTruthy();
    expect(idx.tags['fake-fence-tag']).toBeUndefined();
    expect(idx.stats.unresolved).toBe(2);
    expect(idx.stats.ambiguous).toBe(1);
  });
  it('alias fallback only when enabled, labeled', async () => {
    const A = await load('vault-v1.zip', true);
    expect(A.idx.links['Welcome.md'].out.find((l) => l.raw === '[[AKA Thing]]')).toMatchObject({ status: 'resolved-alias', targetPath: 'Aliased Note.md' });
  });
});

describe('re-import v1 -> v2', () => {
  it('reports added/changed/unchanged/missing and detects the move', async () => {
    const a = await load('vault-v1.zip');
    const b = await load('vault-v2.zip');
    const f = (x: typeof a) => x.notes.map((n) => ({ path: n.path, hash: n.hash, kind: 'note' as const }));
    const d = computeDiff(f(a), f(b), 'replace-snapshot');
    expect(d.added.map((x) => x.path).sort()).toEqual(['Kitchen/Bread.md', 'New Idea.md']);
    expect(d.changed.map((x) => x.path).sort()).toEqual(['Ideas/Garden.md', 'Welcome.md']);
    expect(d.missing.map((x) => x.path).sort()).toEqual(['Lonely.md', 'Recipes/Bread.md']);
    expect(d.moves).toEqual([{ from: 'Recipes/Bread.md', to: 'Kitchen/Bread.md', reason: 'identical-content', kind: 'note' }]);
    expect(d.unchanged.length).toBe(10);
    const add = computeDiff(f(a), f(b), 'add-update');
    expect(add.missing).toEqual([]);
  });
  it('moves remap favorites/boards; dangling refs are reported not deleted', () => {
    const app = { ...defaultAppData('v'), favorites: ['Recipes/Bread.md', 'Lonely.md'] };
    const boards = [{ id: 'b', vaultId: 'v', name: 'B', cards: [{ id: 'c', notePath: 'Recipes/Bread.md', x: 0, y: 0, title: 'Bread' }], links: [], camera: { x: 0, y: 0, zoom: 1 }, createdAt: 0, updatedAt: 0 }];
    const r = applyMovesToAppData({ 'Recipes/Bread.md': 'Kitchen/Bread.md' }, app, boards, []);
    expect(r.app.favorites).toEqual(['Kitchen/Bread.md', 'Lonely.md']);
    expect(r.boards[0].cards[0].notePath).toBe('Kitchen/Bread.md');
    const dang = findDangling(new Set(['Kitchen/Bread.md']), r.app, r.boards, []);
    expect(dang).toEqual([{ path: 'Lonely.md', where: ['Pinned'] }]);
  });
});
