import { chromium } from 'playwright';
import { importZip, st, V2 } from './harness.mjs';
const BASE = 'https://ghostbreath88.github.io/vault-atlas/';
const ctx = await chromium.launchPersistentContext('/tmp/pw-profile', { viewport: { width: 1280, height: 800 } });
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
if (process.argv[2] === 'setup') {
  await importZip(page, V2);
  await page.goto(BASE + '#/note/' + encodeURIComponent('Kitchen/Bread.md'), { waitUntil: 'networkidle' });
  await page.click('[data-testid="button-pin"]'); await page.waitForTimeout(400);
} else {
  await page.waitForTimeout(8000);
  const prompt = await page.getByText(/Update ready/i).count();
  console.log('update prompt visible:', prompt);
  if (prompt) { await page.getByText(/Update ready/i).first().click(); await page.waitForTimeout(4000); }
}
await page.goto(BASE + '#/settings', { waitUntil: 'networkidle' }); console.log(await st(page), (await page.getByText(/^Version /).innerText()));
await ctx.close();
