// Produces tests/android/fixtures/browser-export.json: app data exported by the *browser* version
// (pins, a board, a saved graph view, Obsidian vault name) — used to test transfer into the APK.
import { fresh, importZip, V1, BASE } from './harness.mjs';
import { writeFileSync } from 'node:fs';
const { browser, page } = await fresh();
await importZip(page, V1);
await page.goto(BASE + '#/note/' + encodeURIComponent('Recipes/Bread.md'), { waitUntil: 'networkidle' });
await page.click('[data-testid="button-pin"]');
await page.click('[data-testid="button-add-board"]');
await page.fill('[data-testid="input-new-board"]', 'Browser board');
await page.keyboard.press('Enter'); await page.waitForTimeout(500);
await page.goto(BASE + '#/graph?center=' + encodeURIComponent('Recipes/Bread.md'), { waitUntil: 'networkidle' }); await page.waitForTimeout(800);
await page.click('[data-testid="button-save-view"]'); await page.fill('[data-testid="input-view-name"]', 'Browser view');
await page.click('[data-testid="button-save-view-confirm"]'); await page.waitForTimeout(400);
await page.goto(BASE + '#/settings', { waitUntil: 'networkidle' });
const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-testid="button-export"]')]);
const out = new URL('../android/fixtures/browser-export.json', import.meta.url).pathname;
await dl.saveAs(out);
console.log('saved', out);
await browser.close();
