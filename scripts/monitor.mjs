// Checks the public Machu Picchu ticket calendar for a date window and raises a
// GitHub issue (plus an optional ntfy push) the first time any day opens for sale.
//
// It drives the page the way a visitor would: circuit -> route -> calendar, and
// reads which days the calendar lets you pick. It never touches the purchase flow.
import { chromium } from 'playwright-core';
import fs from 'node:fs';

const SITE = 'https://tuboleto.cultura.pe/llaqta_machupicchu';
const FROM = process.env.WATCH_FROM || '2027-01-01';
const TO = process.env.WATCH_TO || '2027-01-07';
const LABEL = process.env.ALERT_LABEL || 'ticket-alert';
const BROKEN_LABEL = 'monitor-broken';
const REPO = process.env.GITHUB_REPOSITORY;
const TOKEN = process.env.GITHUB_TOKEN;
const QUERY = 'consulta-fechas-disponibles';

const pad = n => String(n).padStart(2, '0');
const iso = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

/** Months touched by the watch window, each with the days we care about. */
function watchMonths() {
  const [fy, fm, fd] = FROM.split('-').map(Number);
  const [ty, tm, td] = TO.split('-').map(Number);
  const out = [];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, m = 1) : m++) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const first = y === fy && m === fm ? fd : 1;
    const end = y === ty && m === tm ? td : last;
    out.push({ y, m, days: Array.from({ length: end - first + 1 }, (_, i) => first + i) });
  }
  return out;
}

async function scrape() {
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'chrome' });
  const page = await (await browser.newContext({
    locale: 'es-PE', timezoneId: 'America/Lima', viewport: { width: 1366, height: 900 },
  })).newPage();
  page.setDefaultTimeout(15000);

  // Remember the outcome of each calendar query so a failed request is never
  // mistaken for "no tickets" or, worse, for "tickets".
  let queries = [];
  page.on('response', async r => {
    if (!r.url().includes(QUERY)) return;
    let post = {}, estado = null;
    try { post = JSON.parse(r.request().postData() || '{}'); } catch {}
    try { estado = (await r.json()).estado; } catch {}
    queries.push({ from: post.dfInicio, ok: r.status() === 200 && estado === true });
  });
  const nextQuery = () => page.waitForResponse(r => r.url().includes(QUERY), { timeout: 8000 }).catch(() => null);

  const selects = page.locator('mat-select');
  const options = page.locator('mat-option');
  const calendar = page.locator('mat-calendar');

  /** Open dropdown `sel`, choose option `idx`, return all option labels. */
  const pick = async (sel, idx) => {
    for (let i = 0; i < 5 && !(await options.count()); i++) {
      await selects.nth(sel).click({ timeout: 3000 }).catch(() => {});
      await options.first().waitFor({ timeout: 2000 }).catch(() => {});
    }
    const labels = (await options.allInnerTexts()).map(t => t.trim());
    if (idx >= labels.length) throw new Error(`dropdown ${sel} has no option ${idx}`);
    await options.nth(idx).click();
    await options.first().waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    return labels;
  };

  const openCalendar = async () => {
    const triggers = ['input.mat-datepicker-input', 'mat-datepicker-toggle button'];
    for (let i = 0; i < 6 && !(await calendar.count()); i++) {
      await page.locator(triggers[i % 2]).click({ timeout: 1500, noWaitAfter: true }).catch(() => {});
      await calendar.waitFor({ timeout: 1500 }).catch(() => {});
    }
    if (!(await calendar.count())) throw new Error('calendar did not open');
  };

  const closeCalendar = async () => {
    for (let i = 0; i < 3 && (await calendar.count()); i++) {
      await page.keyboard.press('Escape');
      await calendar.waitFor({ state: 'detached', timeout: 2000 }).catch(() => {});
    }
  };

  /** Page through the calendar until it shows month m of year y. */
  const gotoMonth = async (y, m) => {
    for (let i = 0; i < 36; i++) {
      const label = (await page.locator('.mat-calendar-period-button').innerText()).trim();
      const match = label.match(/^(\d{1,2})\/(\d{4})$/);
      if (!match) throw new Error(`unexpected calendar header "${label}"`);
      const diff = (y - Number(match[2])) * 12 + (m - Number(match[1]));
      if (diff === 0) return;
      const answered = nextQuery();
      await page.locator(diff > 0 ? '.mat-calendar-next-button' : '.mat-calendar-previous-button').click();
      await answered;
    }
    throw new Error(`could not reach ${m}/${y} in the calendar`);
  };

  const readDays = () => page.locator('.mat-calendar-body-cell').evaluateAll(cells =>
    Object.fromEntries(cells.map(c => [
      Number(c.innerText.trim()),
      !(c.classList.contains('mat-calendar-body-disabled') || c.getAttribute('aria-disabled') === 'true'),
    ])));

  const results = [];
  try {
    await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await selects.first().waitFor({ timeout: 30000 });

    let circuits = null;
    for (let c = 0; !circuits || c < circuits.length; c++) {
      circuits = await pick(0, c);
      let routes = null;
      for (let r = 0; !routes || r < routes.length; r++) {
        queries = [];
        const loaded = nextQuery();
        routes = await pick(1, r);
        await loaded;
        await openCalendar();
        const dates = {};
        for (const { y, m, days } of watchMonths()) {
          await gotoMonth(y, m);
          await page.waitForTimeout(400); // let the calendar repaint from the answer
          const answered = queries.some(q => q.from === iso(y, m, 1) && q.ok);
          const open = await readDays();
          for (const d of days) {
            dates[iso(y, m, d)] = !answered || !(d in open) ? 'unknown' : open[d] ? 'available' : 'unavailable';
          }
        }
        await closeCalendar();
        results.push({ circuit: circuits[c], route: routes[r], dates });
      }
    }
  } catch (e) {
    fs.mkdirSync('out', { recursive: true });
    await page.screenshot({ path: 'out/failure.png' }).catch(() => {});
    throw e;
  } finally {
    await browser.close();
  }
  return results;
}

// ---------- notifications ----------

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json', 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub ${method} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
}

const openIssue = async label =>
  (await gh('GET', `/issues?state=open&labels=${encodeURIComponent(label)}&per_page=1`))[0] || null;

async function push(title, text) {
  if (!process.env.NTFY_TOPIC) return;
  await fetch(`https://ntfy.sh/${process.env.NTFY_TOPIC}`, {
    method: 'POST', body: text, headers: { Title: title, Priority: 'urgent', Tags: 'tickets', Click: SITE },
  }).catch(e => console.log('ntfy push failed:', String(e)));
}

function table(results) {
  const dates = Object.keys(results[0].dates);
  const mark = { available: '✅', unavailable: '—', unknown: '?' };
  return [
    `| Route | ${dates.map(d => d.slice(5)).join(' | ')} |`,
    `|---|${dates.map(() => ':-:').join('|')}|`,
    ...results.map(r => `| ${r.route} | ${dates.map(d => mark[r.dates[d]]).join(' | ')} |`),
  ].join('\n');
}

async function alertAvailable(results, slots) {
  const title = `Machu Picchu tickets on sale for ${FROM} to ${TO}`;
  const lines = slots.map(s => `- ${s.replace('|', ' — ')}`).join('\n');
  if (!TOKEN) { console.log('No GITHUB_TOKEN; would alert:\n' + lines); return; }
  const owner = process.env.GITHUB_REPOSITORY_OWNER;
  const body = known => [
    `@${owner} tickets are on sale. Buy at ${SITE}`, '', table(results), '',
    `Checked ${new Date().toISOString()}. Close this issue to be alerted again from scratch.`,
    `<!-- slots:${JSON.stringify(known)} -->`,
  ].join('\n');

  const existing = await openIssue(LABEL);
  if (!existing) {
    const made = await gh('POST', '/issues', { title, body: body(slots), labels: [LABEL] });
    console.log('Alert issue opened:', made.html_url);
    await push(title, lines);
    return;
  }
  const known = JSON.parse((existing.body.match(/<!-- slots:(.*) -->/) || [, '[]'])[1]);
  const fresh = slots.filter(s => !known.includes(s));
  if (!fresh.length) { console.log('Already alerted in', existing.html_url); return; }
  const freshLines = fresh.map(s => `- ${s.replace('|', ' — ')}`).join('\n');
  await gh('POST', `/issues/${existing.number}/comments`, { body: `@${owner} more dates opened:\n\n${freshLines}` });
  await gh('PATCH', `/issues/${existing.number}`, { body: body([...known, ...fresh]) });
  await push('More Machu Picchu dates opened', freshLines);
}

/** Open a "monitor broken" issue, unless one is already open. */
async function reportBroken(error) {
  if (!TOKEN || (await openIssue(BROKEN_LABEL))) return;
  await gh('POST', '/issues', {
    title: 'Ticket monitor is failing',
    labels: [BROKEN_LABEL],
    body: `@${process.env.GITHUB_REPOSITORY_OWNER} the last ${BROKEN_AFTER} checks failed, so availability is not being watched.\n\n\`\`\`\n${error}\n\`\`\`\n\nRun: ${process.env.GITHUB_SERVER_URL}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  });
  await push('Machu Picchu monitor is failing', String(error).slice(0, 300));
}

async function clearBroken() {
  if (!TOKEN) return;
  const issue = await openIssue(BROKEN_LABEL);
  if (!issue) return;
  await gh('POST', `/issues/${issue.number}/comments`, { body: 'Checks are passing again.' });
  await gh('PATCH', `/issues/${issue.number}`, { state: 'closed' });
}

// ---------- main ----------

// GitHub starts scheduled workflows far less often than the cron asks for, so a
// scheduled run keeps checking on its own clock for LOOP_MINUTES and the next
// run takes over when it ends. LOOP_MINUTES=0 means a single check.
const LOOP_MS = Number(process.env.LOOP_MINUTES || 0) * 60_000;
const EVERY_MS = Number(process.env.CHECK_EVERY_SECONDS || 300) * 1000;
const BROKEN_AFTER = 3;
const today = () => new Date().toISOString().slice(0, 10);

let lastSummary = '';
async function checkOnce() {
  // The page occasionally loads without its route list; one fresh attempt fixes it.
  const results = await scrape().catch(e => {
    console.log('First attempt failed, retrying:', e.message);
    return scrape();
  });
  const states = results.flatMap(r => Object.values(r.dates));
  const slots = results.flatMap(r =>
    Object.entries(r.dates).filter(([, s]) => s === 'available').map(([d]) => `${d}|${r.route}`));
  const unknown = states.filter(s => s === 'unknown').length;
  const headline = `${FROM} to ${TO}: ${slots.length ? `${slots.length} route-days ON SALE` : 'not on sale'}`;
  console.log(`${new Date().toISOString()} ${headline} (${results.length} routes, ${unknown} unreadable)`);

  // Print the full table on the first check and whenever it changes.
  const summary = `### ${headline}\n\n${table(results)}\n`;
  if (summary !== lastSummary) {
    lastSummary = summary;
    console.log(summary);
    if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\nAs of ${new Date().toISOString()}\n\n`);
  }

  if (slots.length) await alertAvailable(results, slots);
  // A check only counts as healthy if at least half of the answers were readable.
  if (!results.length || unknown > states.length / 2) {
    throw new Error(`could not read the calendar for ${unknown} of ${states.length} route-days`);
  }
  await clearBroken();
}

const deadline = Date.now() + LOOP_MS;
let failures = 0;
for (;;) {
  if (TO < today()) {
    console.log(`Watch window ended on ${TO}; nothing to check. Disable this workflow.`);
    break;
  }
  const started = Date.now();
  try {
    await checkOnce();
    failures = 0;
  } catch (e) {
    failures++;
    console.error(`CHECK FAILED (${failures} in a row):`, e);
    if (failures === BROKEN_AFTER) {
      await reportBroken(e.stack || String(e)).catch(x => console.error('could not report failure:', x));
    }
  }
  const next = started + EVERY_MS;
  if (next > deadline) break;
  await new Promise(resolve => setTimeout(resolve, Math.max(0, next - Date.now())));
}
// Fail the run if it ended on a failure, so the Actions history shows it.
process.exit(failures ? 1 : 0);
