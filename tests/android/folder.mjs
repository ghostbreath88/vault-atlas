// Checkpoint 2 tests: native read-only folder access, exact-note Obsidian hand-off, manual refresh.
// Called from run.mjs after the ZIP tests (the app then holds the v2 snapshot + transferred pins/board/view).
import { readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export async function run({ device, sh, sleep, check, launch, stop, st, go, shot, getPage, VAULT_DIR, PKG, ROOT }) {
  const page = () => getPage();
  const q = (p) => `"${p.replace(/"/g, '\\"')}"`;
  const md5All = async () => (await sh(`cd ${q(VAULT_DIR)} && find . -type f -exec md5sum {} + | sort -k2`));

  /* ------------------------------------------------ put a vault on the phone */
  const src = path.join(ROOT, 'fixtures/vault-v2/Atlas Demo Vault');
  await sh(`rm -rf ${q(VAULT_DIR)}; mkdir -p ${q(VAULT_DIR)}`);
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = path.join(d, n); return statSync(p).isDirectory() ? walk(p) : [p]; });
  for (const f of walk(src)) {
    const rel = path.relative(src, f);
    await sh(`mkdir -p ${q(path.posix.dirname(VAULT_DIR + '/' + rel))}`);
    await device.push(f, VAULT_DIR + '/' + rel);
  }
  const baseline = await md5All();
  check('Synthetic vault folder placed in Documents', baseline.split('\n').length >= 20, baseline.split('\n').length + ' files');

  /* ------------------------------------------ connect with the system picker */
  await go('#/'); await go('#/import');
  await page().click('[data-testid="button-connect-folder"]');
  await device.wait({ text: 'Atlas Demo Vault' }, { timeout: 30000 });
  await shot('10-folder-picker');
  await device.tap({ text: 'Atlas Demo Vault' });
  await sleep(1500);
  await device.tap({ text: /use this folder/i });
  await device.wait({ text: /^allow$/i }, { timeout: 15000 });
  await shot('11-folder-permission');
  await device.tap({ text: /^allow$/i });
  const t0 = Date.now();
  await page().waitForSelector('[data-testid="import-review"], [data-testid="import-done"]', { timeout: 120000 });
  const tScan = Date.now() - t0;
  const review = await page().locator('[data-testid="import-review"]').innerText().catch(() => '');
  check('Folder picked via Android system picker and read', /Folder/.test(review) || /Refreshed/.test(await page().innerText('body')), `scan ${tScan} ms`);
  if (review) { await page().click('[data-testid="button-apply-import"]'); await page().waitForSelector('[data-testid="import-done"]'); }
  let s = await st();
  const info1 = await page().evaluate(async () => ({ folder: await window.Capacitor.Plugins.AtlasNative.folderStatus(), linked: globalThis.__atlas.getState().settings.folderVaultId === globalThis.__atlas.getState().vault?.id, ovn: globalThis.__atlas.getState().app?.obsidianVaultName }));
  check('Folder connected with lasting read-only permission', info1.folder.connected && info1.folder.permission && info1.folder.accessible && info1.linked, JSON.stringify(info1.folder));
  check('Vault indexed from folder: 14 notes, no duplicates', s.notes === 14 && s.vaults === 1, JSON.stringify(s));
  check('Pins/boards/views preserved when switching from ZIP to folder', s.boards === 1 && s.views === 1 && (s.pins ?? []).length === 1, JSON.stringify(s.pins));
  check('Obsidian vault name defaults to the folder name', info1.ovn === 'Atlas Demo Vault', info1.ovn);

  /* --------------------------------------------- exact-note hand-off to Obsidian */
  await sh('logcat -c');
  await go('#/note/Ideas%2FGarden.md'); await page().waitForSelector('[data-testid="note-body"]');
  const uri = await page().getAttribute('[data-testid="button-open-obsidian"]', 'data-uri');
  await page().click('[data-testid="button-open-obsidian"]');
  await sleep(3000);
  const log = await sh('logcat -d -s ObsidianStub:I');
  const expected = 'obsidian://open?vault=Atlas%20Demo%20Vault&file=Ideas%2FGarden.md';
  check('“Open in Obsidian” sends the exact note to the Obsidian app', uri === expected && log.includes('RECEIVED ' + expected), log.split('\n').filter((l) => l.includes('RECEIVED')).pop() || uri);
  const top = await sh("dumpsys activity activities | grep -m1 -E 'topResumedActivity|mResumedActivity'");
  check('Obsidian (stand-in) app came to the foreground', /obsidianstub/.test(top), top);
  await shot('12-obsidian-stub');
  check('Reading the folder did not modify any vault file', (await md5All()) === baseline);

  /* ------------------------------ edit "in Obsidian", come back, refresh */
  await sh(`printf '\\nEdited in Obsidian on the phone. #edited\\n' >> ${q(VAULT_DIR + '/Ideas/Garden.md')}`);
  await sh(`printf '# Fresh From Phone\\n\\nWritten in Obsidian. Links to [[Garden]].\\n' > ${q(VAULT_DIR + '/Fresh From Phone.md')}`);
  const afterEdit = await md5All();
  await sh(`am start -n ${PKG}/io.github.ghostbreath88.vaultatlas.MainActivity`); await sleep(2000);
  check('Back in Vault Atlas on the same note', /Garden/.test(await page().evaluate(() => location.hash)));
  const t1 = Date.now();
  await page().click('[data-testid="button-refresh-folder"]');
  await page().waitForSelector('[data-testid="import-done"]', { timeout: 120000 });
  const tRefresh = Date.now() - t1;
  const doneText = await page().innerText('[data-testid="import-done"]');
  const n = async (id) => Number((await page().innerText(`[data-testid="count-${id}"] .v`)).replace(/\D/g, ''));
  check('Refresh from folder applies directly when nothing went missing', /Refreshed from folder/.test(doneText), `${tRefresh} ms`);
  check('Refresh found exactly 1 new and 1 changed note', (await n('done-added')) === 1 && (await n('done-changed')) === 1);
  await page().click('[data-testid="button-return"]'); await sleep(1000);
  const body = await page().innerText('[data-testid="note-body"]');
  check('Returned to the note, showing the edit', /Edited in Obsidian on the phone/.test(body) && /Garden/.test(await page().evaluate(() => location.hash)));
  const paths = await page().evaluate(() => [...globalThis.__atlas.getState().notes.keys()]);
  s = await st();
  check('No duplicates after refresh; new note added', paths.length === new Set(paths).size && paths.length === 15 && paths.includes('Fresh From Phone.md'), paths.length);
  check('Pins, board and saved view still there', (s.pins ?? []).length === 1 && s.boards === 1 && s.views === 1);
  const hits = await page().evaluate(async () => { location.hash = '#/notes?q=' + encodeURIComponent('Written in Obsidian'); await new Promise((r) => setTimeout(r, 1500)); return [...document.querySelectorAll('.note-row .t')].map((e) => e.textContent); });
  check('Search index rebuilt (finds the new note text)', hits.includes('Fresh From Phone'), JSON.stringify(hits));
  const tags = await page().evaluate(() => globalThis.__atlas.getState().notes.get('Ideas/Garden.md').parsed.tags);
  check('Tags rebuilt (#edited on Garden)', tags.includes('edited'), JSON.stringify(tags));
  await go('#/graph'); await sleep(1800);
  const e = await page().evaluate(() => window.__atlasSigma.getGraph().mapEdges((k, a, s, t) => `${s}>${t}`));
  check('Graph rebuilt with the new wikilink', e.includes('note:Fresh From Phone.md>note:Ideas/Garden.md'));
  check('Vault Atlas never wrote to the folder', (await md5All()) === afterEdit);

  /* -------------------------------------- restart keeps folder permission */
  await stop(); await launch();
  const f2 = await page().evaluate(() => window.Capacitor.Plugins.AtlasNative.folderStatus());
  check('Folder permission survives an app restart', f2.connected && f2.permission && f2.accessible);
  await go('#/');
  await page().click('[data-testid="button-refresh-folder"]');
  await page().waitForSelector('[data-testid="import-done"]', { timeout: 120000 });
  check('Refresh after restart: nothing changed, nothing duplicated', (await n('done-added')) === 0 && (await n('done-changed')) === 0 && (await st()).notes === 15);

  /* --------------------------------------------- a pinned note is deleted */
  await sh(`rm ${q(VAULT_DIR + '/Kitchen/Bread.md')}`);
  await go('#/'); await page().click('[data-testid="button-refresh-folder"]');
  await page().waitForSelector('[data-testid="import-review"]', { timeout: 120000 });
  check('A note missing from the folder triggers a review (not silent deletion)', Number((await page().innerText('[data-testid="count-missing"] .v')).replace(/\D/g, '')) >= 1);
  await page().click('[data-testid="button-apply-import"]'); await page().waitForSelector('[data-testid="import-done"]');
  const bread = await page().evaluate(() => globalThis.__atlas.getState().notes.get('Kitchen/Bread.md'));
  s = await st();
  check('Missing note kept and flagged; pin kept', bread?.missing === true && (s.pins ?? []).includes('Kitchen/Bread.md'), JSON.stringify({ missing: bread?.missing, pins: s.pins }));

  /* ------------------------------------------- folder moved / unavailable */
  await sh(`mv ${q(VAULT_DIR)} ${q(VAULT_DIR + ' (moved)')}`);
  await go('#/'); await go('#/import'); await sleep(500);
  await page().evaluate(async () => { location.hash = '#/import?folder=refresh'; });
  await sleep(4000);
  await go('#/'); await go('#/import'); await sleep(1500);
  const prob = await page().locator('[data-testid="folder-problem"]').innerText().catch(() => '');
  check('Moved/deleted folder is reported clearly, with Reconnect', /can’t be found|no longer has permission/.test(prob) && (await page().locator('[data-testid="button-reconnect-folder"]').innerText()).includes('Reconnect'), prob.slice(0, 120));
  check('Nothing was deleted from Vault Atlas when the folder vanished', (await st()).notes === 15);
  await shot('13-folder-missing');
  await sh(`mv ${q(VAULT_DIR + ' (moved)')} ${q(VAULT_DIR)}`);
  await loadAgain();
  async function loadAgain() { await page().evaluate(() => window.Capacitor.Plugins.AtlasNative.folderStatus()); }

  /* --------------------------------------------------------- disconnect */
  await go('#/'); await go('#/import'); await sleep(800);
  await page().click('[data-testid="button-disconnect-folder"]'); await sleep(800);
  const f3 = await page().evaluate(() => window.Capacitor.Plugins.AtlasNative.folderStatus());
  const grants = await sh(`dumpsys activity permissions 2>/dev/null | grep -c "${PKG}" || true`);
  check('Disconnect releases the folder permission; notes stay', !f3.connected && (await st()).notes === 15, 'grants mentioning app: ' + grants);
}
