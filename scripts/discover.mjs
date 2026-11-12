// One-off: record what the public ticket page loads and renders, so the monitor
// can be written against the real page structure.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const URL = 'https://tuboleto.cultura.pe/llaqta_machupicchu';
fs.mkdirSync('out', { recursive: true });
const net = [];

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({
  locale: 'es-PE', timezoneId: 'America/Lima', viewport: { width: 1366, height: 900 },
});
const page = await ctx.newPage();
page.on('console', m => net.push({ console: m.text().slice(0, 500) }));
page.on('response', async r => {
  const q = r.request();
  if (['image', 'font', 'stylesheet', 'media'].includes(q.resourceType())) return;
  const e = { url: r.url(), method: q.method(), status: r.status(), type: q.resourceType(),
              post: (q.postData() || '').slice(0, 2000) };
  if (['xhr', 'fetch'].includes(q.resourceType())) {
    e.reqHeaders = Object.keys(q.headers());
    try { e.body = (await r.text()).slice(0, 4000); } catch { e.body = '<unreadable>'; }
  }
  net.push(e);
});

let err = null;
try {
  const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  console.log('status', resp && resp.status());
  await page.waitForLoadState('networkidle', { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);
} catch (e) { err = String(e); console.log('ERROR', err); }

await page.screenshot({ path: 'out/page.png', fullPage: true }).catch(() => {});
fs.writeFileSync('out/page.html', await page.content().catch(() => ''));
fs.writeFileSync('out/text.txt', await page.evaluate(() => document.body.innerText).catch(() => ''));
const controls = await page.evaluate(() =>
  [...document.querySelectorAll('button,a,input,select,[role=button],[role=option],mat-select,mat-option,[class*=calendar],[class*=date]')]
    .slice(0, 400).map(e => ({
      tag: e.tagName, id: e.id, cls: String(e.className).slice(0, 120),
      text: (e.innerText || e.value || '').trim().slice(0, 80),
      attrs: [...e.attributes].filter(a => !['class', 'id', 'style'].includes(a.name)).map(a => `${a.name}=${a.value.slice(0, 60)}`),
    }))).catch(() => []);
fs.writeFileSync('out/controls.json', JSON.stringify(controls, null, 1));
fs.writeFileSync('out/network.json', JSON.stringify(net, null, 1));
console.log('title', await page.title().catch(() => ''), '| requests', net.length, '| controls', controls.length);
await browser.close();
if (err) process.exit(1);
