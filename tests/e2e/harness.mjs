import { chromium } from 'playwright';
import path from 'node:path';
export const BASE = process.env.APP_URL || 'http://127.0.0.1:4173/';
export const FIX = path.resolve(new URL('.', import.meta.url).pathname, '../../fixtures');
export const V1 = FIX + '/vault-v1.zip', V2 = FIX + '/vault-v2.zip';
export async function fresh(opts = {}) {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true, ...opts });
  const page = await ctx.newPage();
  const reqs = [], errors = [];
  ctx.on('request', (r) => reqs.push({ m: r.method(), u: r.url(), post: r.postData()?.slice(0, 80) }));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  return { browser, ctx, page, reqs, errors };
}
export async function importZip(page, file, testid = 'input-zip-newvault', { persist = true } = {}) {
  await page.goto(BASE + '#/', { waitUntil: 'networkidle' });
  await page.goto(BASE + '#/import', { waitUntil: 'networkidle' });
  await page.setInputFiles(`[data-testid="${testid}"]`, file);
  await page.waitForSelector('[data-testid="import-review"]', { timeout: 30000 });
  const cb = page.locator('[data-testid="check-persist"]');
  if (await cb.count()) { if ((await cb.isChecked()) !== persist) await cb.click(); }
  await page.click('[data-testid="button-apply-import"]');
  await page.waitForSelector('[data-testid="import-done"]', { timeout: 60000 });
}
export const st = (page) => page.evaluate(() => { const s = globalThis.__atlas.getState(); return { vault: s.vault?.name, vaults: s.vaults.length, notes: s.notes.size, contentLoaded: s.contentLoaded, pins: s.app?.favorites, boards: s.boards.length, views: s.views.length, theme: document.documentElement.dataset.theme }; });
