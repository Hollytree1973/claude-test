// End to end browser test for the whole tool (index.html + js/app.js + every module).
// Run from the valuation-matrix folder:  node tests/e2e.mjs
// It starts `python3 -m http.server` on a free port, drives Chromium with Playwright at 390px
// (iPhone) and 1024px (iPad landscape), and writes screenshots to tests/screenshots/.
// The Excel library is served to the page from a local cache (the sandbox cannot reach jsDelivr);
// the bytes are identical to the pinned CDN file, so the integrity check still runs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import vm from 'node:vm';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { XLSX_URL } from '../js/export-xlsx.js';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const shots = path.join(here, 'screenshots');
fs.mkdirSync(shots, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-e2e-'));
const CACHE = path.join(process.env.VM_XLSX_CACHE || path.join(os.tmpdir(), 'gibsons-vm-cache'), 'xlsx-js-style-1.2.0.bundle.js');

const DASHES = /[-‐‑‒–—―−]/;
const LR_LINE = '"{3A9F2C1E-7B44-4D3B-E063-4704A8C07853}","425000","2026-03-12 00:00","CM1 2AB","S","N","F","14","","OAK ROAD","","CHELMSFORD","CHELMSFORD","ESSEX","A","A"';
const TABS = ['subject', 'comparables', 'hpi', 'adjustments', 'results'];

let passed = 0;
const failures = [];
async function check(name, fn) {
  try { await fn(); passed += 1; console.log('ok  ', name); }
  catch (e) { failures.push(name); console.log('FAIL', name, '\n     ', e && e.message ? e.message.split('\n').slice(0, 6).join('\n      ') : e); }
}

async function ensureLib() {
  if (fs.existsSync(CACHE)) return;
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  const res = await fetch('https://registry.npmjs.org/xlsx-js-style/-/xlsx-js-style-1.2.0.tgz');
  if (!res.ok) throw new Error('could not fetch xlsx-js-style: ' + res.status);
  const tgz = path.join(TMP, 'x.tgz');
  fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['xzf', tgz, '-C', TMP, 'package/dist/xlsx.bundle.js']);
  fs.copyFileSync(path.join(TMP, 'package/dist/xlsx.bundle.js'), CACHE);
}
function loadXlsxInNode() {
  const ctx = { console }; ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(CACHE, 'utf8'), ctx);
  return ctx.XLSX;
}
function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
}
const gbpToNum = (t) => Number(String(t).replace(/[^0-9.]/g, ''));

// Elements that stick out past the right edge of the viewport and are not inside a box that
// scrolls or clips sideways: these would cause sideways page scroll (or be cut off).
async function overflowing(page) {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth;
    const out = [];
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getClientRects().length) continue;
      const r = el.getBoundingClientRect();
      if (r.right <= W + 1 || r.width === 0) continue;
      let p = el.parentElement, contained = false;
      while (p && p !== document.body) {
        const ox = getComputedStyle(p).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') { contained = true; break; }
        p = p.parentElement;
      }
      if (!contained) out.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} right=${Math.round(r.right)}`);
    }
    return out.slice(0, 10);
  });
}

async function run() {
  await ensureLib();
  const port = await freePort();
  const srv = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i += 1) {
    try { await fetch(base + '/'); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  const browser = await chromium.launch();
  try {
    for (const vp of [{ name: 'iphone', width: 390, height: 844 }, { name: 'ipad', width: 1024, height: 768 }]) {
      console.log(`\n# ${vp.name} ${vp.width}px`);
      const ctx = await browser.newContext({
        viewport: { width: vp.width, height: vp.height }, deviceScaleFactor: 1, locale: 'en-GB', acceptDownloads: true,
        hasTouch: vp.name !== 'desktop', permissions: ['clipboard-read', 'clipboard-write'],
      });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('dialog', (d) => d.accept());
      let cdnHits = 0;
      await page.route(XLSX_URL, (route) => {
        cdnHits += 1;
        route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(CACHE) });
      });

      await page.goto(base + '/index.html');
      await page.evaluate(() => { try { localStorage.clear(); } catch {} });
      await page.reload();
      await page.waitForSelector('#vm-subject > *');

      await check(`${vp.name}: page loads with title, header and five tabs`, async () => {
        assert.equal(await page.title(), 'Gibsons Comparable Matrix');
        const head = await page.textContent('.vm-header');
        assert.match(head, /Gibsons Surveyors/);
        assert.match(head, /Comparable Matrix/);
        assert.equal(await page.locator('.vm-tabs [role="tab"]').count(), 5);
        const bg = await page.$eval('.vm-header', (e) => getComputedStyle(e).backgroundColor);
        assert.equal(bg, 'rgb(255, 102, 0)');
      });

      await check(`${vp.name}: load example case from step 1`, async () => {
        await page.click('[data-app-action="example"]');
        await page.waitForFunction(() => /Sales range £/.test(document.getElementById('vm-range-strip').textContent));
      });

      for (const t of TABS) {
        await check(`${vp.name}: tab ${t} renders without errors or sideways overflow`, async () => {
          await page.click(`#vm-tab-${t}`);
          await page.waitForTimeout(350);
          assert.equal(await page.isVisible(`#vm-panel-${t}`), true);
          const kids = await page.$eval(`#vm-${t}`, (e) => e.children.length);
          assert.ok(kids > 0, 'mount point is empty');
          assert.equal(await page.locator(`#vm-${t} .vm-error`).count(), 0, 'module showed a mount error');
          const sw = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          assert.ok(sw <= 0, 'page scrolls sideways by ' + sw);
          const over = await overflowing(page);
          assert.deepEqual(over, [], 'elements overflow the viewport');
          await page.screenshot({ path: path.join(shots, `${vp.width}-${TABS.indexOf(t) + 1}-${t}.png`), fullPage: true });
        });
      }

      await check(`${vp.name}: active tab is remembered after reload`, async () => {
        await page.click('#vm-tab-adjustments');
        await page.reload();
        await page.waitForSelector('#vm-adjustments > *');
        assert.equal(await page.getAttribute('#vm-tab-adjustments', 'aria-selected'), 'true');
        assert.equal(await page.isVisible('#vm-panel-adjustments'), true);
      });

      const rangeOnScreen = async () => {
        await page.click('#vm-tab-results');
        await page.waitForTimeout(200);
        return {
          low: gbpToNum(await page.textContent('.vm-results__summary [data-kind="sales"] .vm-results__low')),
          high: gbpToNum(await page.textContent('.vm-results__summary [data-kind="sales"] .vm-results__high')),
        };
      };
      const rangeFromCalc = () => page.evaluate(async () => {
        const { store } = await import('/js/store.js');
        const { evaluate } = await import('/js/calc.js');
        const ev = evaluate(store.get());
        return { low: Math.round(ev.salesRange.low), high: Math.round(ev.salesRange.high), count: ev.salesRange.count, n: store.get().sales.length };
      });

      let before;
      await check(`${vp.name}: results Range Low and Range High match calc.evaluate`, async () => {
        const shown = await rangeOnScreen();
        const calc = await rangeFromCalc();
        assert.equal(shown.low, calc.low);
        assert.equal(shown.high, calc.high);
        assert.ok(shown.low > 0 && shown.high >= shown.low);
        before = calc;
      });

      await check(`${vp.name}: no average or adopted value in results or header`, async () => {
        const txt = (await page.textContent('#vm-results')) + (await page.textContent('.vm-header'));
        assert.doesNotMatch(txt, /average|adopted|weighted/i);
        assert.match(txt, /Range Low/);
        assert.match(txt, /Range High/);
      });

      await check(`${vp.name}: paste import adds a Land Registry comparable`, async () => {
        await page.click('#vm-tab-comparables');
        await page.click('#vm-comparables [data-act="import"]');
        await page.waitForSelector('dialog.vm-cmp-dialog[open]');
        await page.fill('dialog.vm-cmp-dialog[open] textarea.vm-cmp-paste', LR_LINE);
        await page.click('dialog.vm-cmp-dialog[open] [data-dlg="read"]');
        await page.waitForSelector('dialog.vm-cmp-dialog[open] [data-dlg="add"]:not([disabled])');
        const status = await page.textContent('dialog.vm-cmp-dialog[open] .vm-cmp-dlg-status');
        assert.match(status, /Land Registry/i);
        await page.click('dialog.vm-cmp-dialog[open] [data-dlg="add"]');
        await page.waitForTimeout(300);
        const added = await page.evaluate(async () => {
          const { store } = await import('/js/store.js');
          const s = store.get().sales;
          return s[s.length - 1];
        });
        assert.equal(await page.evaluate(async () => (await import('/js/store.js')).store.get().sales.length), before.n + 1);
        assert.match(added.address, /14 Oak Road/i);
        assert.equal(added.price, 425000);
        assert.equal(added.saleDate, '2026-03-12');
        assert.equal(added.source, 'Land Registry');
        const shot = path.join(shots, `${vp.width}-2-comparables-after-import.png`);
        await page.screenshot({ path: shot, fullPage: false });
      });

      await check(`${vp.name}: an adjustment changes the range`, async () => {
        const start = await rangeFromCalc();
        // Find the included comparable that sets Range High and mark it down 10 percent for condition.
        const target = await page.evaluate(async () => {
          const { store } = await import('/js/store.js');
          const ev = store.evaluation();
          const top = ev.sales.filter((r) => r.included).sort((a, b) => b.adjustedValue - a.adjustedValue)[0];
          return top.id;
        });
        await page.click('#vm-tab-adjustments');
        const cell = page.locator(`#vm-adjustments td[data-comp="${target}"][data-cat="condition"] input.vm-adj__val`);
        await cell.scrollIntoViewIfNeeded();
        await cell.fill('-10');
        await page.waitForTimeout(200);
        const after = await rangeFromCalc();
        assert.notEqual(after.high, start.high, 'Range High did not move');
        const shown = await rangeOnScreen();
        assert.equal(shown.high, after.high);
        assert.equal(shown.low, after.low);
        // Switch the same cell to pounds: the range moves again.
        await page.click('#vm-tab-adjustments');
        await page.click(`#vm-adjustments td[data-comp="${target}"][data-cat="condition"] .vm-adj__mode`);
        await page.waitForTimeout(200);
        const pounds = await rangeFromCalc();
        assert.notEqual(pounds.high, after.high, 'toggling to pounds did not change the range');
        const mode = await page.evaluate(async (id) => (await import('/js/store.js')).store.get().sales.find((c) => c.id === id).adjustments.condition.mode, target);
        assert.equal(mode, 'gbp');
      });

      await check(`${vp.name}: Excel download has the sheets and live formulas`, async () => {
        await page.click('#vm-tab-results');
        const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#vm-results [data-action="xlsx"]')]);
        assert.match(dl.suggestedFilename(), /^Gibsons comparable matrix .+\.xlsx$/);
        const saved = path.join(TMP, `${vp.name}.xlsx`);
        await dl.saveAs(saved);
        assert.equal(cdnHits, 1);
        const X = loadXlsxInNode();
        const wb = X.read(fs.readFileSync(saved), { type: 'buffer', cellFormula: true });
        assert.deepEqual([...wb.SheetNames], ['Sales Matrix', 'Adjustments', 'Summary']);
        const sm = wb.Sheets['Sales Matrix'];
        const formulas = Object.keys(sm).filter((k) => k[0] !== '!' && sm[k].f);
        assert.ok(formulas.length >= 20, 'expected formulas in the sales matrix, got ' + formulas.length);
        const sum = wb.Sheets.Summary;
        const cells = Object.keys(sum).filter((k) => k[0] !== '!');
        const lowLabel = cells.find((k) => /^Range Low/.test(String(sum[k].v)));
        const highLabel = cells.find((k) => /^Range High/.test(String(sum[k].v)));
        assert.ok(lowLabel && highLabel, 'Summary has Range Low and Range High labels');
        const right = (addr) => { const c = X.utils.decode_cell(addr); return sum[X.utils.encode_cell({ r: c.r, c: c.c + 1 })]; };
        const calc = await rangeFromCalc();
        assert.ok(right(lowLabel).f, 'Range Low is a formula');
        assert.equal(Math.round(right(lowLabel).v), calc.low);
        assert.equal(Math.round(right(highLabel).v), calc.high);
        const allText = wb.SheetNames.flatMap((n) => Object.entries(wb.Sheets[n]).filter(([k, c]) => k[0] !== '!' && c.t === 's').map(([, c]) => c.v)).join('\n');
        const bad = allText.split('\n').filter((l) => /average|adopted value|weighted/i.test(l.replace('No single adopted value is given.', '')));
        assert.deepEqual(bad, []);
        await page.waitForSelector('#vm-results .vm-results__status');
        assert.match(await page.textContent('#vm-results .vm-results__status'), /Excel file downloaded/);
      });

      await check(`${vp.name}: copied commentary has no hyphens or dashes`, async () => {
        await page.click('#vm-results [data-action="commentary"]');
        await page.waitForFunction(() => /Commentary copied|Could not copy/.test(document.querySelector('#vm-results .vm-results__status').textContent));
        const clip = await page.evaluate(() => navigator.clipboard.readText());
        assert.ok(clip.length > 500, 'commentary is too short: ' + clip.length);
        const m = clip.match(DASHES);
        assert.equal(m, null, 'dash found near: ' + (m ? clip.slice(Math.max(0, m.index - 40), m.index + 40) : ''));
        assert.doesNotMatch(clip, /adopted value|weighted average|\baverage of/i);
        assert.match(clip, /Range Low/);
        assert.match(clip, /Range High/);
        assert.match(clip, /14 Oak Road/i);
        await page.screenshot({ path: path.join(shots, `${vp.width}-5-results-after-exports.png`), fullPage: true });
      });

      await check(`${vp.name}: no console errors`, async () => { assert.deepEqual(errors, []); });
      await ctx.close();
    }

    console.log('\n# module failure is contained');
    await check('a failing module shows an inline error, the rest still mounts', async () => {
      const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
      const page = await ctx.newPage();
      await page.route('**/js/ui-hpi.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'export function mount(){ throw new Error("boom"); }' }));
      await page.goto(base + '/index.html');
      await page.waitForSelector('#vm-hpi .vm-error', { state: 'attached' });
      assert.ok((await page.$eval('#vm-subject', (e) => e.children.length)) > 0);
      assert.ok((await page.$eval('#vm-results', (e) => e.children.length)) > 0);
      await ctx.close();
    });
  } finally {
    await browser.close();
    srv.kill();
  }
  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) { console.log('Failed:', failures.join('; ')); process.exitCode = 1; }
}

run().catch((e) => { console.error(e); process.exitCode = 1; });
