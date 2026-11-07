// End-to-end acceptance run. Usage: APP_URL=https://…/vault-atlas/ node tests/e2e/acceptance.mjs
// Requires Playwright + Chromium. Uses only the synthetic fixtures in /fixtures.
import { fresh, importZip, st, V1, V2, BASE } from './harness.mjs';
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const { browser, ctx, page, reqs, errors } = await fresh();
const origin = new URL(BASE).origin;
const edges = () => page.evaluate(() => { const g = window.__atlasSigma.getGraph(); return g.mapEdges((e, a, s, t) => ({ s, t, kind: a.kind })); });

// 1. Import synthetic vault ZIP
await importZip(page, V1);
let s = await st(page);
check('Import v1 ZIP', s.notes === 14 && s.vaults === 1, `${s.notes} notes`);
const done = await page.locator('[data-testid="import-done"]').innerText();
check('Corrupt file reported, import continues', /Broken\.md/.test(done) || /failed/i.test(done));

// 2. Open notes, wikilinks
await page.goto(BASE + '#/note/Welcome.md', { waitUntil: 'networkidle' });
const links = await page.$$eval('[data-testid="note-body"] a.internal-link', (as) => as.map((a) => a.getAttribute('href')));
check('Reader renders internal links', links.some((h) => decodeURIComponent(h).includes('Ideas/Garden.md')) && links.some((h) => decodeURIComponent(h).includes('Recipes/Bread.md')), links.slice(0,4).join(' '));
await page.click('[data-testid="note-body"] a.internal-link >> nth=0');
await page.waitForTimeout(400);
check('Clicking a wikilink opens the target note', /#\/note\//.test(page.url()), decodeURIComponent(page.url().split('#')[1]));
await page.goto(BASE + '#/note/' + encodeURIComponent('Ideas/Garden.md'), { waitUntil: 'networkidle' });
const back = await page.locator('[data-testid="list-backlinks"]').innerText();
check('Backlinks listed', /Welcome/.test(back) && /Big Ideas/.test(back));
const tags = await page.locator('[data-testid="list-tags"]').innerText();
check('Nested tag shown', /garden\/vegetables/.test(tags));
check('No script execution from Unsafe HTML', await page.goto(BASE + '#/note/' + encodeURIComponent('Unsafe HTML.md'), { waitUntil: 'networkidle' }).then(() => page.waitForTimeout(500)).then(() => page.evaluate(() => window.__pwned === undefined && !document.querySelector('[data-testid="note-body"] script, [data-testid="note-body"] iframe'))));

// 3. Graph: wikilinks and tags
await page.goto(BASE + '#/graph', { waitUntil: 'networkidle' }); await page.waitForTimeout(1200);
let e = await edges();
const has = (s, t) => e.some((x) => x.s === 'note:' + s && x.t === 'note:' + t && x.kind === 'link');
check('Graph has 13 note→note link edges', e.filter((x) => x.kind === 'link').length === 13, `${e.length}`);
check('Graph edges match wikilinks', has('Welcome.md', 'Ideas/Garden.md') && has('Ideas/Garden.md', 'Recipes/Bread.md') && has('Personal/Plan.md', 'Work/Meeting.md'));
check('Ambiguous [[Meeting]] from Welcome NOT counted', !has('Welcome.md', 'Work/Meeting.md') && !has('Welcome.md', 'Personal/Meeting.md'));
if (!(await page.locator('[data-testid="toggle-tags"]').isVisible())) await page.click('[data-testid="button-graph-settings"]');
await page.click('[data-testid="toggle-tags"]'); await page.waitForTimeout(800);
e = await edges();
const tagEdges = e.filter((x) => x.kind === 'tag');
check('Tag nodes/edges appear when enabled', tagEdges.length > 0 && tagEdges.some((x) => x.s === 'note:Ideas/Garden.md' && x.t.includes('garden/vegetables')), `${tagEdges.length} tag edges`);
check('Shared tags never create note→note links', e.filter((x) => x.kind === 'link').length === 13);

// app-only data
await page.goto(BASE + '#/note/' + encodeURIComponent('Recipes/Bread.md'), { waitUntil: 'networkidle' });
await page.click('[data-testid="button-pin"]'); await page.waitForTimeout(300);
await page.click('[data-testid="button-add-board"]');
await page.fill('[data-testid="input-new-board"]', 'Acceptance board');
await page.keyboard.press('Enter'); await page.waitForTimeout(600);

// 4. Updated ZIP, no duplicates
await page.goto(BASE + '#/import', { waitUntil: 'networkidle' });
await page.setInputFiles('[data-testid="input-zip-replacesnapshot"]', V2);
await page.waitForSelector('[data-testid="import-review"]');
const review = await page.locator('[data-testid="import-review"]').innerText();
check('Review shows counts before applying', /changed/i.test(review) && /missing/i.test(review) && /unchanged/i.test(review));
check('Move Recipes/Bread → Kitchen/Bread detected', await page.locator('[data-testid="check-move-Recipes/Bread.md"]').isChecked().catch(() => false));
await page.click('[data-testid="button-apply-import"]'); await page.waitForSelector('[data-testid="import-done"]');
let paths = await page.evaluate(() => [...globalThis.__atlas.getState().notes.keys()]);
s = await st(page);
check('No duplicate notes after update', new Set(paths).size === paths.length && !paths.includes('Recipes/Bread.md') && paths.includes('Kitchen/Bread.md') && paths.includes('New Idea.md'), `${paths.length} notes`);
check('Missing note kept & flagged, not silently deleted', paths.includes('Lonely.md'));
check('Pin followed the move', JSON.stringify(s.pins) === JSON.stringify(['Kitchen/Bread.md']), JSON.stringify(s.pins));
const cards = await page.evaluate(() => globalThis.__atlas.getState().boards.flatMap((b) => b.cards.map((c) => c.notePath)));
check('Board preserved across snapshot replace (card followed move)', s.boards === 1 && cards.includes('Kitchen/Bread.md'), JSON.stringify(cards));
await importZip(page, V2, 'input-zip-replacesnapshot');
paths = await page.evaluate(() => [...globalThis.__atlas.getState().notes.keys()]);
check('Re-importing same ZIP adds nothing', paths.length === 15 && s.vaults === 1, `${paths.length} notes`);
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(800);
check('State survives reload', (await st(page)).notes === 15);

// 5. Offline
await page.waitForFunction(() => navigator.serviceWorker?.controller, null, { timeout: 15000 }).catch(() => {});
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' }).catch(() => {}); await page.waitForTimeout(1500);
check('Works offline after first load', (await st(page).catch(() => ({}))).notes === 15);
await ctx.setOffline(false);

// 6. Network audit
const vaultWords = ['Garden', 'Bread', 'Welcome', 'starter', 'Lonely', 'vegetables', 'Atlas%20Demo', 'Atlas Demo', 'Meeting', 'Kitchen'];
const foreign = reqs.filter((r) => !r.u.startsWith(origin) && !r.u.startsWith('blob:') && !r.u.startsWith('data:'));
const nonGet = reqs.filter((r) => r.m !== 'GET');
const leaky = reqs.filter((r) => !r.u.startsWith('blob:') && vaultWords.some((w) => decodeURIComponent(r.u.replace(origin, '')).includes(w)));
check('No requests to any other origin', foreign.length === 0, foreign.map((r) => r.u).slice(0, 5).join(', '));
check('No uploads (only GET requests)', nonGet.length === 0, nonGet.map((r) => r.m + ' ' + r.u).slice(0, 5).join(', '));
check('No vault names/text in any request URL', leaky.length === 0, leaky.map((r) => r.u).slice(0, 5).join(', '));
console.log(`requests: ${reqs.length} total, unique paths: ${new Set(reqs.map((r) => r.u.replace(origin, '').split('?')[0])).size}`);
check('No page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
