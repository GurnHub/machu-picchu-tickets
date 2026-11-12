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
    try { e.body = (await r.text()).slice(0, 20000); } catch { e.body = '<unreadable>'; }
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

// ---- drive the form: circuit -> route -> calendar ----
const log = [];
const step = async (name, fn) => { try { log.push({ step: name, result: await fn() }); } catch (e) { log.push({ step: name, error: String(e).slice(0, 400) }); } };
const selects = page.locator('mat-select');
const options = () => page.locator('mat-option').evaluateAll(els => els.map(e => ({ text: e.innerText.trim(), disabled: e.getAttribute('aria-disabled'), value: e.getAttribute('ng-reflect-value') })));
const calendar = () => page.evaluate(() => ({
  period: document.querySelector('.mat-calendar-period-button')?.innerText.trim(),
  prevDisabled: document.querySelector('.mat-calendar-previous-button')?.disabled,
  nextDisabled: document.querySelector('.mat-calendar-next-button')?.disabled,
  cells: [...document.querySelectorAll('.mat-calendar-body-cell')].map(c => ({
    label: c.getAttribute('aria-label'), disabled: c.getAttribute('aria-disabled'),
    cls: c.className, text: c.innerText.trim(), title: c.getAttribute('title'),
    extra: [...c.attributes].filter(a => !['class', 'aria-label', 'aria-disabled'].includes(a.name)).map(a => a.name + '=' + a.value).join(' '),
  })),
  cellHtml: document.querySelector('.mat-calendar-body-cell:not(.mat-calendar-body-disabled)')?.outerHTML.slice(0, 800),
  disabledHtml: document.querySelector('.mat-calendar-body-cell.mat-calendar-body-disabled')?.outerHTML.slice(0, 800),
  legend: document.querySelector('mat-datepicker-content')?.innerText.slice(0, 600),
}));

await step('open circuit', async () => { await selects.nth(0).click(); await page.waitForTimeout(800); return options(); });
await step('pick circuit 0', async () => { await page.locator('mat-option').nth(0).click(); await page.waitForTimeout(2500); });
await step('open route', async () => { await selects.nth(1).click(); await page.waitForTimeout(800); return options(); });
await step('pick route 0', async () => { await page.locator('mat-option').nth(0).click(); await page.waitForTimeout(4000); });
await step('open calendar', async () => { await page.locator('mat-datepicker-toggle button').click(); await page.waitForTimeout(1500); return calendar(); });
await page.screenshot({ path: 'out/calendar.png' }).catch(() => {});
for (let i = 0; i < 4; i++) {
  await step('next month ' + i, async () => {
    const b = page.locator('.mat-calendar-next-button');
    if (await b.isDisabled()) return 'next disabled';
    await b.click(); await page.waitForTimeout(2500); return calendar();
  });
}
await page.screenshot({ path: 'out/calendar_last.png' }).catch(() => {});
await step('period click', async () => { await page.locator('.mat-calendar-period-button').click(); await page.waitForTimeout(800);
  return page.evaluate(() => [...document.querySelectorAll('.mat-calendar-body-cell')].map(c => c.getAttribute('aria-label') + '|' + c.getAttribute('aria-disabled'))); });
await page.keyboard.press('Escape'); await page.waitForTimeout(500);
// second circuit: just list its routes
await step('circuit 1 routes', async () => { await selects.nth(0).click(); await page.waitForTimeout(800); await page.locator('mat-option').nth(1).click(); await page.waitForTimeout(2500); await selects.nth(1).click(); await page.waitForTimeout(800); const o = await options(); await page.keyboard.press('Escape'); return o; });
await step('circuit 2 routes', async () => { await selects.nth(0).click(); await page.waitForTimeout(800); await page.locator('mat-option').nth(2).click(); await page.waitForTimeout(2500); await selects.nth(1).click(); await page.waitForTimeout(800); const o = await options(); await page.keyboard.press('Escape'); return o; });
fs.writeFileSync('out/flow.json', JSON.stringify(log, null, 1));

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
