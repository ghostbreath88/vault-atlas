// Android acceptance tests for the Vault Atlas APK, run on an Android emulator in GitHub Actions.
// Drives the real installed app: WebView via Chrome DevTools (debug build), system UI (file pickers,
// folder picker, Save dialog) via UI Automator, and the device shell via adb.
//
//   OLD_APK=… NEW_APK=… STUB_APK=… RELEASE_APK=… node tests/android/run.mjs
import { _android as android } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(new URL('.', import.meta.url).pathname, '../..');
const OUT = process.env.OUT_DIR || path.join(ROOT, 'android-test-results');
mkdirSync(OUT, { recursive: true });
const PKG = 'io.github.ghostbreath88.vaultatlas.test';
const RELEASE_PKG = 'io.github.ghostbreath88.vaultatlas';
const ACTIVITY = 'io.github.ghostbreath88.vaultatlas.MainActivity';
const CP2 = existsSync(new URL('./folder.mjs', import.meta.url)) && process.env.ATLAS_CP2 !== '0';
const VAULT_DIR = '/sdcard/Documents/Atlas Demo Vault';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail: String(detail).slice(0, 300) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + String(detail).slice(0, 300) : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const [device] = await android.devices();
if (!device) throw new Error('No Android device/emulator found');
const sh = async (cmd) => (await device.shell(cmd)).toString().trim();
console.log('Device:', await sh('getprop ro.product.model'), 'Android', await sh('getprop ro.build.version.release'), 'SDK', await sh('getprop ro.build.version.sdk'));
console.log('WebView:', await sh("dumpsys webviewupdate | grep -m1 'Current WebView package'"));

let page;
async function launch(pkg = PKG) {
  await sh(`am start -W -n ${pkg}/${ACTIVITY}`);
  const wv = await device.webView({ pkg }, { timeout: 60000 });
  page = await wv.page();
  page.setDefaultTimeout(45000);
  // Wait until stored data has been opened (vault list read, and the current vault's notes loaded if any).
  await page.waitForFunction(() => {
    const s = globalThis.__atlas && globalThis.__atlas.getState();
    if (!s || !s.ready) return false;
    if (!s.vaults.length) return true;
    return !!s.vault && (!s.vault.persistContent || !s.vault.manifest.length || s.notes.size > 0 || s.attachments.size > 0);
  }, null, { timeout: 60000 });
  await sleep(500);
  return page;
}
async function stop(pkg = PKG) { await sh(`am force-stop ${pkg}`); await sleep(1000); }
const st = () => page.evaluate(() => { const s = globalThis.__atlas.getState(); return { vault: s.vault?.name, vaults: s.vaults.length, notes: s.notes.size, contentLoaded: s.contentLoaded, pins: s.app?.favorites ?? null, boards: s.boards.length, views: s.views.length }; });
const go = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await sleep(700); };
const shot = async (name) => { try { await device.screenshot({ path: path.join(OUT, name + '.png') }); } catch (e) { console.log('screenshot failed', e.message); } };

/** Puts a local file into one of the app's <input type=file> elements (same as picking it). */
async function setFile(testid, file, name, mime) {
  const b64 = readFileSync(file).toString('base64');
  await page.evaluate(({ b64, name, mime, testid }) => {
    const bin = atob(b64); const u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const dt = new DataTransfer(); dt.items.add(new File([u8], name, { type: mime }));
    const inp = document.querySelector(`[data-testid="${testid}"]`);
    if (!inp) throw new Error('no input ' + testid);
    inp.files = dt.files; inp.dispatchEvent(new Event('change', { bubbles: true }));
  }, { b64, name, mime, testid });
}
async function importZip(file, testid, { expectReview = true } = {}) {
  await go('#/'); await go('#/import');
  await page.waitForSelector(`[data-testid="${testid}"]`, { state: 'attached' });
  const t0 = Date.now();
  await setFile(testid, file, path.basename(file), 'application/zip');
  if (expectReview) await page.waitForSelector('[data-testid="import-review"]', { timeout: 120000 });
  const tScan = Date.now() - t0;
  await page.click('[data-testid="button-apply-import"]');
  await page.waitForSelector('[data-testid="import-done"]', { timeout: 120000 });
  return { tScan, tTotal: Date.now() - t0 };
}
const edges = () => page.evaluate(() => { const g = window.__atlasSigma.getGraph(); return g.mapEdges((e, a, s, t) => ({ s, t, kind: a.kind })); });
const V1 = path.join(ROOT, 'fixtures/vault-v1.zip'), V2 = path.join(ROOT, 'fixtures/vault-v2.zip');

try {
  /* ------------------------------------------------------------- setup */
  for (const p of [PKG, RELEASE_PKG, 'io.github.ghostbreath88.obsidianstub']) await sh(`pm uninstall ${p}`).catch(() => {});
  await device.installApk(process.env.OLD_APK);
  if (process.env.STUB_APK) await device.installApk(process.env.STUB_APK);
  const perms = await sh(`dumpsys package ${PKG} | grep -E 'android.permission.(INTERNET|ACCESS_NETWORK_STATE)' || true`);
  check('APK declares no INTERNET / network permission', perms === '', perms || 'none');

  /* ------------------------------------------- 1. first launch, offline */
  await sh('cmd connectivity airplane-mode enable'); await sh('svc wifi disable'); await sh('svc data disable');
  await sleep(3000);
  check('Airplane mode on before the first launch', (await sh('settings get global airplane_mode_on')) === '1');
  await launch();
  const boot = await page.evaluate(() => ({
    title: document.title,
    text: document.body.innerText.slice(0, 400),
    origin: location.origin,
    font: getComputedStyle(document.body).fontFamily,
    fontOk: document.fonts.check('16px "Source Code Pro Variable"'),
    bg: getComputedStyle(document.body).backgroundColor,
    color: getComputedStyle(document.body).color,
    sw: !!navigator.serviceWorker?.controller,
    resources: performance.getEntriesByType('resource').map((r) => r.name),
  }));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForSelector('text=Import', { timeout: 20000 }).catch(() => {});
  check('First launch in airplane mode renders the app', /Vault Atlas/.test(boot.title) && /import/i.test(boot.text), boot.text.slice(0, 80).replace(/\n/g, ' '));
  check('App is served from inside the APK (https://localhost)', boot.origin === 'https://localhost', boot.origin);
  check('All loaded resources are local', boot.resources.every((u) => u.startsWith('https://localhost/') || u.startsWith('blob:') || u.startsWith('data:')), boot.resources.filter((u) => !u.startsWith('https://localhost/')).slice(0, 3).join(', '));
  check('Bundled Source Code Pro font active', boot.fontOk && /Source Code Pro/.test(boot.font), boot.font);
  check('Deep purple background, pale mint text', boot.bg === 'rgb(14, 4, 24)' && boot.color === 'rgb(201, 251, 227)', `${boot.bg} / ${boot.color}`);
  check('No service worker needed in the APK', !boot.sw);
  await shot('01-first-launch-offline');

  /* ------------------------------------------------------- 2. ZIP import */
  const t1 = await importZip(V1, 'input-zip-newvault');
  let s = await st();
  check('ZIP import (v1) offline on Android', s.notes === 14 && s.vaults === 1, `${s.notes} notes, scan ${t1.tScan} ms, total ${t1.tTotal} ms`);
  await go('#/note/Welcome.md'); await page.waitForSelector('[data-testid="note-body"]');
  const links = await page.$$eval('[data-testid="note-body"] a.internal-link', (as) => as.map((a) => decodeURIComponent(a.getAttribute('href'))));
  check('Reader shows wikilinks', links.some((h) => h.includes('Ideas/Garden.md')) && links.some((h) => h.includes('Recipes/Bread.md')), links.length + ' links');
  await page.click('[data-testid="note-body"] a.internal-link >> nth=0'); await sleep(600);
  check('Tapping a wikilink opens the note', /#\/note\/Ideas/.test(await page.evaluate(() => location.hash)));
  check('Script in note did not run', await page.evaluate(async () => { location.hash = '#/note/Unsafe%20HTML.md'; await new Promise((r) => setTimeout(r, 800)); return window.__pwned === undefined; }));
  await go('#/graph'); await sleep(1500);
  let e = await edges();
  check('Graph: 13 wikilink edges', e.filter((x) => x.kind === 'link').length === 13, e.length);
  await shot('02-graph-phone');

  /* ------------------------------------------- 3. app-only data + update */
  await go('#/note/Recipes%2FBread.md'); await page.click('[data-testid="button-pin"]');
  await page.click('[data-testid="button-add-board"]'); await page.fill('[data-testid="input-new-board"]', 'Phone board'); await page.keyboard.press('Enter'); await sleep(600);
  await go('#/'); await go('#/import');
  await setFile('input-zip-replacesnapshot', V2, 'vault-v2.zip', 'application/zip');
  await page.waitForSelector('[data-testid="import-review"]', { timeout: 120000 });
  check('Refresh review shows a detected move', await page.locator('[data-testid="check-move-Recipes/Bread.md"]').isChecked());
  await page.click('[data-testid="button-apply-import"]'); await page.waitForSelector('[data-testid="import-done"]');
  let paths = await page.evaluate(() => [...globalThis.__atlas.getState().notes.keys()]);
  s = await st();
  check('Updated ZIP: no duplicates, move applied, missing note kept', new Set(paths).size === paths.length && !paths.includes('Recipes/Bread.md') && paths.includes('Kitchen/Bread.md') && paths.includes('Lonely.md'), paths.length + ' notes');
  check('Pin and board followed the move', JSON.stringify(s.pins) === '["Kitchen/Bread.md"]' && s.boards === 1, JSON.stringify(s.pins));
  await importZip(V2, 'input-zip-replacesnapshot');
  check('Re-importing the same ZIP adds nothing', (await st()).notes === 15);

  /* --------------------------------------- 4. external requests blocked */
  await sh('cmd connectivity airplane-mode disable'); await sh('svc wifi enable'); await sh('svc data enable');
  await sleep(6000);
  const net = await sh('ping -c 1 -W 3 8.8.8.8 >/dev/null 2>&1 && echo up || echo down');
  console.log('Emulator network (shell ping):', net);
  // OS-level enforcement: a process running as the app's own Linux user cannot open internet sockets at all.
  const shellNet = await sh('toybox nc -w 4 8.8.8.8 53 </dev/null >/dev/null 2>&1; echo rc=$?');
  const appNet = await sh(`run-as ${PKG} toybox nc -w 4 8.8.8.8 53 </dev/null 2>&1; echo rc=$?`);
  const appPing = await sh(`run-as ${PKG} /system/bin/ping -c 1 -W 3 8.8.8.8 2>&1 | tail -1`);
  console.log('shell nc:', shellNet, '| app nc:', appNet, '| app ping:', appPing);
  check('As the app’s own Android user, opening an internet socket is refused by the OS', /denied|not permitted|EACCES/i.test(appNet + ' ' + appPing) || (!/rc=0/.test(appNet) && /rc=0/.test(shellNet)), `app: ${appNet.replace(/\n/g, ' ')} | ${appPing} | shell: ${shellNet}`);
  const before = await page.evaluate(() => window.Capacitor.Plugins.AtlasNative.info());
  const probes = await page.evaluate(async () => {
    const out = {};
    const t = (p, ms = 8000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error('timeout')), ms))]);
    try { const r = await t(fetch('https://example.com/?probe=1', { mode: 'no-cors' })); out.fetch = 'reached:' + r.type; } catch (e) { out.fetch = 'blocked'; }
    try { await t(new Promise((res, rej) => { const x = new XMLHttpRequest(); x.open('GET', 'https://example.com/'); x.onload = () => res(); x.onerror = () => rej(new Error('x')); x.send(); })); out.xhr = 'reached'; } catch { out.xhr = 'blocked'; }
    out.img = await new Promise((res) => { const i = new Image(); i.onload = () => res('reached'); i.onerror = () => res('blocked'); i.src = 'https://www.google.com/favicon.ico?probe=' + Date.now(); setTimeout(() => res('blocked(timeout)'), 8000); });
    out.ws = await new Promise((res) => { try { const w = new WebSocket('wss://echo.websocket.org/'); w.onopen = () => res('reached'); w.onerror = () => res('blocked'); setTimeout(() => res('blocked(timeout)'), 8000); } catch { res('blocked'); } });
    out.beacon = (() => { try { return navigator.sendBeacon('https://example.com/b', 'x') ? 'queued' : 'refused'; } catch { return 'refused'; } })();
    out.iframe = await new Promise((res) => { const f = document.createElement('iframe'); f.src = 'https://example.com/'; f.onload = () => { try { res(f.contentDocument ? 'loaded-empty' : 'loaded'); } catch { res('loaded-crossorigin'); } f.remove(); }; document.body.append(f); setTimeout(() => { res('blocked(timeout)'); f.remove(); }, 8000); });
    return out;
  });
  const after = await page.evaluate(() => window.Capacitor.Plugins.AtlasNative.info());
  check('With network ON, fetch/XHR/WebSocket/image to the internet all fail', probes.fetch === 'blocked' && probes.xhr === 'blocked' && probes.ws.startsWith('blocked') && probes.img.startsWith('blocked'), JSON.stringify(probes));
  check('Native layer intercepted and refused external loads', after.blockedRequests > before.blockedRequests, `${before.blockedRequests} → ${after.blockedRequests}`);
  check('App reports INTERNET permission not granted', after.internetPermission === false);
  await go('#/note/Welcome.md'); await sleep(800);
  check('Remote image in note is not loaded; no load button in the APK', (await page.locator('[data-testid="button-load-remote"]').count()) === 0 && /not shown/.test(await page.locator('.notice').first().innerText()));

  /* ----------------------------------- 5. restart + APK update persist */
  await stop(); await launch();
  s = await st();
  check('Data survives app restart', s.notes === 15 && JSON.stringify(s.pins) === '["Kitchen/Bread.md"]' && s.boards === 1);
  const vOld = (await page.evaluate(() => window.Capacitor.Plugins.AtlasNative.info())).versionCode;
  await stop();
  await device.installApk(process.env.NEW_APK);
  await launch();
  const vNew = (await page.evaluate(() => window.Capacitor.Plugins.AtlasNative.info())).versionCode;
  s = await st();
  check('APK update (versionCode ' + vOld + ' → ' + vNew + ') keeps notes, pins, boards', vNew > vOld && s.notes === 15 && JSON.stringify(s.pins) === '["Kitchen/Bread.md"]' && s.boards === 1, JSON.stringify(s));

  /* ------------------------------------------- 6. app-data export (SAF) */
  await sh('rm -f /sdcard/Download/vault-atlas-settings-*.json');
  await go('#/settings');
  await page.click('[data-testid="button-export"]');
  await device.wait({ text: /^save$/i }, { timeout: 20000 }).catch(() => {});
  await shot('06-save-dialog');
  await device.tap({ text: /^save$/i });
  await sleep(2500);
  let exported = await sh("ls /sdcard/Download/ 2>/dev/null | grep vault-atlas-settings || find /sdcard -name 'vault-atlas-settings-*.json' 2>/dev/null | head -1");
  const expPath = exported.includes('/') ? exported.split('\n')[0] : '/sdcard/Download/' + exported.split('\n')[0];
  const expText = exported ? await sh(`cat "${expPath}"`) : '';
  check('Export app data saves a file through Android\'s Save dialog', /vault-atlas-appdata/.test(expText), expPath);
  check('Exported file contains pins but no note text', expText.includes('Kitchen/Bread.md') && !expText.includes('Feed the starter'));

  /* ------------------- 7. delete all, then transfer browser settings in */
  await go('#/settings');
  await page.click('[data-testid="button-delete-all"]');
  await page.fill('[data-testid="input-confirm-text"]', 'DELETE');
  await page.click('[data-testid="button-confirm"]'); await sleep(2000);
  await stop(); await launch();
  s = await st();
  check('Delete all imported local data empties the app', s.vaults === 0 && s.notes === 0);
  await go('#/settings');
  await setFile('input-appdata', path.join(ROOT, 'tests/android/fixtures/browser-export.json'), 'browser-export.json', 'application/json');
  await page.click('[data-testid="button-restore-appdata"]'); await sleep(1200);
  s = await st();
  check('Browser-exported app data imports into the APK', s.vaults === 1 && JSON.stringify(s.pins) === '["Recipes/Bread.md"]' && s.boards === 1 && s.views === 1, JSON.stringify(s));
  await go('#/'); await go('#/import');
  await setFile('input-zip-replacesnapshot', V2, 'vault-v2.zip', 'application/zip');
  await page.waitForSelector('[data-testid="import-review"]', { timeout: 120000 });
  await page.click('[data-testid="button-apply-import"]'); await page.waitForSelector('[data-testid="import-done"]');
  s = await st();
  const cards = await page.evaluate(() => globalThis.__atlas.getState().boards.flatMap((b) => b.cards.map((c) => c.notePath)));
  check('After importing the vault, transferred pins/boards reconnect by path', s.notes === 14 && cards.length === 1, JSON.stringify({ pins: s.pins, cards }));
  await shot('07-after-transfer');

  /* ------------------------------------------------- 8. DeX-size layout */
  await sh('wm size 1920x1080'); await sh('wm density 160'); await sleep(2500);
  await go('#/graph'); await sleep(2000); await shot('08-desktop-size-graph');
  await go('#/note/Welcome.md'); await sleep(1000); await shot('08-desktop-size-note');
  const desk = await page.evaluate(() => ({ w: innerWidth, sidebar: getComputedStyle(document.querySelector('.sidebar')).display, overflow: document.documentElement.scrollWidth > innerWidth }));
  check('Desktop-size window (1920×1080 @160dpi) shows the side navigation', desk.sidebar !== 'none' && !desk.overflow, JSON.stringify(desk));
  await sh('wm size reset'); await sh('wm density reset'); await sleep(2000);

  if (CP2) await (await import('./folder.mjs')).run({ device, sh, sleep, check, launch, stop, st, go, shot, getPage: () => page, VAULT_DIR, PKG, ROOT });
} catch (err) {
  check('Test run completed without crashing', false, err.stack || err);
  await shot('zz-crash');
}

/* ------------------------------------------- release APK smoke test */
if (process.env.RELEASE_APK) {
  try {
    await sh(`am force-stop ${PKG}`); await sh('input keyevent HOME');
    await sh('cmd connectivity airplane-mode enable'); await sleep(2000);
    await device.installApk(process.env.RELEASE_APK);
    const perms = await sh(`dumpsys package ${RELEASE_PKG} | grep -E 'android.permission.INTERNET' || true`);
    check('Signed release APK: no INTERNET permission', perms === '');
    await sh('logcat -c');
    await sh(`am start -W -n ${RELEASE_PKG}/${ACTIVITY}`); await sleep(8000);
    const pid = await sh(`pidof ${RELEASE_PKG} || true`);
    const top = await sh("dumpsys activity activities | grep -m1 -E 'topResumedActivity|mResumedActivity'");
    const crash = await sh(`logcat -d | grep -E 'FATAL EXCEPTION|AndroidRuntime: Process: ${RELEASE_PKG}' | head -3 || true`);
    await shot('09-release-offline');
    const png = await device.screenshot();
    check('Signed release APK launches offline (running, in front, no crash)', !!pid && top.includes(RELEASE_PKG) && !crash, `pid ${pid}; ${top}; ${crash}`);
    check('Release screen is rendered, not blank', png.length > 40000, png.length + ' bytes');
    const dbg = pid ? await sh(`cat /proc/net/unix | grep -c "webview_devtools_remote_${pid}" || true`) : 'no pid';
    check('Release build has WebView remote debugging disabled', dbg === '0', dbg);
  } catch (err) { check('Release smoke test', false, err.message); }
}

writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} Android checks passed`);
await device.close();
process.exit(failed ? 1 : 0);
