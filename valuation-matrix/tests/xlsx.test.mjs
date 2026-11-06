// Tests for js/export-xlsx.js. Run: node --test tests/xlsx.test.mjs
// Loads the same xlsx-js-style 1.2.0 build the browser loads. It is fetched from the npm registry
// tarball on first run and cached outside the repo (VM_XLSX_CACHE, default <os tmp>/gibsons-vm-cache);
// its sha256 matches the jsDelivr file. If it cannot be fetched (offline) every suite is skipped. The library is run in a
// browser like vm context so it exposes a global XLSX exactly as the script tag does.
// Extra independent checks run when available: openpyxl (frozen panes, fills, fonts, formats)
// and LibreOffice headless (recalculates every formula and compares with calc.js).
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { buildWorkbook, writeWorkbook, xlsxFilename, human, XLSX_URL, XLSX_INTEGRITY } from '../js/export-xlsx.js';
import { evaluate } from '../js/calc.js';
import { createState, createComparable, CATEGORIES } from '../js/model.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const vendor = path.join(process.env.VM_XLSX_CACHE || path.join(os.tmpdir(), 'gibsons-vm-cache'), 'xlsx-js-style-1.2.0.bundle.js');
const JSDELIVR_SHA256 = 'HHq/KZP/LNYeUI+SaOms2gCYyXlvOSXSug0leQcmU+I=';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-xlsx-'));

async function ensureVendor() {
  if (fs.existsSync(vendor)) return;
  fs.mkdirSync(path.dirname(vendor), { recursive: true });
  const res = await fetch('https://registry.npmjs.org/xlsx-js-style/-/xlsx-js-style-1.2.0.tgz');
  if (!res.ok) throw new Error('could not fetch xlsx-js-style tarball: ' + res.status);
  const tgz = path.join(TMP, 'x.tgz');
  fs.writeFileSync(tgz, Buffer.from(await res.arrayBuffer()));
  execFileSync('tar', ['xzf', tgz, '-C', TMP, 'package/dist/xlsx.bundle.js']);
  fs.copyFileSync(path.join(TMP, 'package/dist/xlsx.bundle.js'), vendor);
}

let X;
function loadLib() {
  const ctx = { console };
  ctx.window = ctx; ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(vendor, 'utf8'), ctx);
  return ctx.XLSX;
}

function fixtureState() {
  const s = createState();
  Object.assign(s, {
    caseRef: 'GS/2026:114', valuer: 'Andrew Gibson MRICS', valuationDate: '2026-11-06',
    instructionType: 'help-to-buy', matrixType: 'btl',
  });
  Object.assign(s.subject, {
    address: '14 Rowan Way, Chelmsford', postcode: 'CM1 2AB', propertyType: 'semi-detached',
    tenure: 'freehold', bedrooms: 3, floorAreaSqFt: 1000, floorAreaSqM: 92.9, condition: 'below-average',
    parking: 'on-street', epc: 'C', garden: true, features: 'Loft room', defects: 'Damp to rear wall',
  });
  s.hpi = { regionSlug: 'chelmsford', regionLabel: 'Chelmsford', series: [], valuationIndex: 150, source: 'HM Land Registry UK HPI, fetched 2026-11-06' };
  s.sales = [
    createComparable({ id: 's1', address: '2 Rowan Way, Chelmsford', propertyType: 'semi-detached', bedrooms: 3,
      floorAreaSqFt: 850, price: 400000, saleDate: '2026-02-10', distanceMiles: 0.2, hpiAtSale: 140,
      adjustments: { condition: { mode: 'pct', value: 5, note: 'Dated kitchen' }, parking: { mode: 'gbp', value: -10000, note: 'Has driveway' } } }),
    createComparable({ id: 's2', address: '9 Birch Close, Chelmsford', propertyType: 'end-terrace', tenure: 'leasehold', unexpiredTerm: 72,
      floorAreaSqFt: 1150, price: 380000, saleDate: '2026-09-01', distanceMiles: 0.7, saleKind: 'auction' }),
    createComparable({ id: 's3', address: '1 Oak Road', floorAreaSqFt: null, floorAreaSqM: null, price: 360000,
      saleDate: '2025-06-01', distanceMiles: 0.3, hpiAtSale: null }),
    createComparable({ id: 's4', address: '5 Elm Street', floorAreaSqFt: 1000, price: 500000, saleDate: '2026-10-01', excluded: true }),
  ];
  s.rentals = [
    createComparable({ id: 'r1', address: '3 Ash Grove', floorAreaSqFt: 900, price: 1600, saleDate: '2026-08-01', source: 'Agent',
      adjustments: { kitchen: { mode: 'pct', value: -2.5, note: 'Newer kitchen' } } }),
    createComparable({ id: 'r2', address: '7 Ash Grove', floorAreaSqFt: 1000, price: 1750, saleDate: '2026-10-01' }),
  ];
  return s;
}

const cellAt = (ws, a) => ws[a];
function findCell(ws, pred) {
  for (const k of Object.keys(ws)) if (k[0] !== '!' && pred(ws[k], k)) return k;
  return null;
}
function headerMap(ws, X, row = 4) {
  const r = X.utils.decode_range(ws['!ref']);
  const m = {};
  for (let c = 0; c <= r.e.c; c += 1) { const cell = ws[X.utils.encode_cell({ r: row, c })]; if (cell) m[cell.v] = X.utils.encode_col(c); }
  return m;
}
function allText(wb) {
  const out = [];
  for (const n of wb.SheetNames) for (const [k, c] of Object.entries(wb.Sheets[n])) if (k[0] !== '!' && c.t === 's') out.push(String(c.v));
  return out;
}

const SALES_HEADERS = ['No.', 'Address', 'Type', 'Tenure', 'Unexpired term', 'Beds', 'Sq ft', 'Sq m', 'Sale price', 'Sale date',
  'Distance (miles)', 'Source', 'Sale kind', 'HPI at sale', 'HPI at valuation', 'HPI factor', 'HPI adjusted price', 'Size diff %',
  'Quantum adj %', 'Qualitative adj %', 'Qualitative adj £', 'Fully adjusted value', '£ per sq ft', 'Included', 'Flags'];

const NOLIB = await ensureVendor().then(() => false, (e) => `xlsx-js-style could not be fetched (${e.message}); skipping`);

let state, ev, wb, bytes, file;
before(async () => {
  if (NOLIB) return;
  X = loadLib();
  state = fixtureState();
  ev = evaluate(state);
  wb = buildWorkbook(state, ev, X);
  bytes = writeWorkbook(wb, X);
  file = path.join(TMP, 'out.xlsx');
  fs.writeFileSync(file, bytes);
});

describe('library pin', { skip: NOLIB }, () => {
  test('vendored build matches the jsDelivr file and the SRI hash', () => {
    const buf = fs.readFileSync(vendor);
    assert.equal(crypto.createHash('sha256').update(buf).digest('base64'), JSDELIVR_SHA256);
    assert.equal('sha384-' + crypto.createHash('sha384').update(buf).digest('base64'), XLSX_INTEGRITY);
    assert.match(XLSX_URL, /^https:\/\/cdn\.jsdelivr\.net\/npm\/xlsx-js-style@1\.2\.0\/dist\/xlsx\.bundle\.js$/);
    assert.equal(X.style_version, '1.2.0');
  });
});

describe('workbook structure', { skip: NOLIB }, () => {
  test('sheet names by matrix type', () => {
    assert.deepEqual([...wb.SheetNames], ['Sales Matrix', 'Rental Matrix', 'Adjustments', 'Summary']);
    const sales = buildWorkbook({ ...state, matrixType: 'sales' }, null, X);
    assert.deepEqual([...sales.SheetNames], ['Sales Matrix', 'Adjustments', 'Summary']);
    const rent = buildWorkbook({ ...state, matrixType: 'rental' }, null, X);
    assert.deepEqual([...rent.SheetNames], ['Rental Matrix', 'Adjustments', 'Summary']);
  });

  test('sales header labels in order, styled orange with white bold text', () => {
    const ws = wb.Sheets['Sales Matrix'];
    SALES_HEADERS.forEach((h, i) => {
      const c = ws[X.utils.encode_cell({ r: 4, c: i })];
      assert.equal(c.v, h, `column ${i}`);
      assert.match(c.s.fill.fgColor.rgb, /FF6600$/);
      assert.match(c.s.font.color.rgb, /FFFFFF$/);
      assert.equal(c.s.font.bold, true);
    });
  });

  test('rental header has pcm and per week columns and no HPI columns', () => {
    const h = headerMap(wb.Sheets['Rental Matrix'], X);
    for (const k of ['Rent pcm', 'Adjusted rent pcm', 'Adjusted rent per week', 'Included', 'Flags']) assert.ok(h[k], k);
    assert.equal(h['HPI factor'], undefined);
  });

  test('adjustments sheet lists the 17 categories with mode, value and note per comparable', () => {
    const ws = wb.Sheets.Adjustments;
    CATEGORIES.forEach((c, i) => assert.equal(ws[`B${6 + i}`].v, c.label));
    assert.equal(ws.C4.v, 'Sale 1: 2 Rowan Way');
    assert.deepEqual([ws.C5.v, ws.D5.v, ws.E5.v], ['Mode', 'Value', 'Note']);
    assert.equal(ws.C6.v, '%'); assert.equal(ws.D6.v, 0.05); assert.equal(ws.E6.v, 'Dated kitchen'); assert.equal(ws.D6.z, '0.0%');
    assert.equal(ws.C16.v, '£'); assert.equal(ws.D16.v, -10000); assert.equal(ws.D16.z, '£#,##0');
    assert.equal(ws.D23.f, 'SUMIF(C6:C22,"%",D6:D22)');
    assert.equal(ws.D24.f, 'SUMIF(C6:C22,"£",D6:D22)');
    const rentalGroup = findCell(ws, (c) => c.v === 'Rental 1: 3 Ash Grove');
    assert.ok(rentalGroup);
  });
});

describe('sales formulas and values', { skip: NOLIB }, () => {
  test('HPI factor, HPI adjusted price, fully adjusted value are live formulas with cached values', () => {
    const ws = wb.Sheets['Sales Matrix'];
    const h = headerMap(ws, X);
    const R = 6; // first data row in Excel terms
    const f = (k) => ws[`${h[k]}${R}`];
    assert.equal(f('HPI factor').f, `IF(AND(ISNUMBER(${h['HPI at sale']}${R}),ISNUMBER(${h['HPI at valuation']}${R}),N(${h['HPI at sale']}${R})>0),${h['HPI at valuation']}${R}/${h['HPI at sale']}${R},1)`);
    assert.ok(Math.abs(f('HPI factor').v - 150 / 140) < 1e-9);
    assert.match(f('HPI adjusted price').f, new RegExp(`${h['Sale price']}${R}\\*${h['HPI factor']}${R}`));
    assert.match(f('Fully adjusted value').f, new RegExp(`${h['HPI adjusted price']}${R}\\*\\(1\\+N\\(${h['Quantum adj %']}${R}\\)\\)`));
    assert.equal(f('Fully adjusted value').v, ev.sales[0].adjustedValue);
    assert.equal(f('Qualitative adj %').f, 'Adjustments!D23');
    assert.equal(f('Qualitative adj £').f, 'Adjustments!D24');
    assert.equal(f('Quantum adj %').v, 0.05);
    assert.equal(f('Quantum adj %').z, '0.0%');
    assert.equal(f('Size diff %').v, 0.15);
    assert.equal(f('Sale price').z, '£#,##0');
    assert.equal(f('Sale date').z, 'dd/mm/yyyy');
    assert.equal(f('Sale date').v, 46063); // 10/02/2026
    // row not needing HPI shows 'Not required'
    assert.equal(ws[`${h['HPI factor']}${R + 1}`].v, 'Not required');
  });

  test('Range Low and Range High are MIN and MAX array formulas over included rows only', () => {
    const ws = wb.Sheets['Sales Matrix'];
    const h = headerMap(ws, X);
    const low = findCell(ws, (c) => c.v === 'Range Low');
    const r = Number(low.replace(/\D/g, ''));
    const lowCell = ws[`${h['Fully adjusted value']}${r}`], highCell = ws[`${h['Fully adjusted value']}${r + 1}`];
    assert.match(lowCell.f, /^IF\(COUNTIF\(X6:X9,"Yes"\)=0,"",MIN\(IF\(X6:X9="Yes",IF\(ISNUMBER\(V6:V9\),V6:V9\)\)\)\)$/);
    assert.match(highCell.f, /MAX\(IF\(X6:X9="Yes"/);
    assert.equal(lowCell.F, `${h['Fully adjusted value']}${r}:${h['Fully adjusted value']}${r}`);
    assert.equal(lowCell.v, ev.salesRange.low);
    assert.equal(highCell.v, ev.salesRange.high);
    assert.equal(ws[`X9`].v, 'No'); // excluded comp 4
  });

  test('flag cells are yellow with red text, data rows alternate', () => {
    const ws = wb.Sheets['Sales Matrix'];
    const h = headerMap(ws, X);
    const fl = ws[`${h.Flags}7`];
    assert.match(fl.v, /Auction sale \[SURVEYOR TO CHECK\]/);
    assert.match(fl.v, /marriage value/);
    assert.match(fl.s.fill.fgColor.rgb, /FFFACD$/);
    assert.match(fl.s.font.color.rgb, /CC0000$/);
    assert.match(ws.B6.s.fill.fgColor.rgb, /FFFFFF$/);
    assert.match(ws.B7.s.fill.fgColor.rgb, /F9F9F9$/);
    assert.equal(ws.C7.v, 'End terrace');
  });

  test('frozen panes recorded and written into the sheet xml', () => {
    assert.deepEqual(wb.Sheets['Sales Matrix']['!freeze'], { xSplit: 2, ySplit: 5 });
    const zip = X.CFB.read(bytes, { type: 'array' });
    const i = zip.FullPaths.findIndex((p) => p.endsWith('xl/worksheets/sheet1.xml'));
    const xml = new TextDecoder().decode(zip.FileIndex[i].content);
    assert.match(xml, /<pane xSplit="2" ySplit="5" topLeftCell="C6" activePane="bottomRight" state="frozen"\/>/);
    const back = X.read(bytes, { type: 'array' });
    assert.deepEqual([...back.SheetNames], [...wb.SheetNames]);
  });
});

describe('summary sheet', { skip: NOLIB }, () => {
  test('carries case, subject, HPI, range and the valuer line', () => {
    const ws = wb.Sheets.Summary;
    const labels = {};
    for (const [k, c] of Object.entries(ws)) if (k[0] === 'A') labels[c.v] = ws['B' + k.slice(1)];
    assert.equal(labels['Case reference'].v, 'GS/2026:114');
    assert.equal(labels.Valuer.v, 'Andrew Gibson MRICS');
    assert.equal(labels['Instruction type'].v, 'Help to Buy');
    assert.equal(labels['Property type'].v, 'Semi detached');
    assert.equal(labels.Condition.v, 'Below average');
    assert.equal(labels['HPI region'].v, 'Chelmsford');
    assert.match(labels['HPI source'].v, /HM Land Registry/);
    assert.equal(labels['Range Low'].v, ev.salesRange.low);
    assert.equal(labels['Range High'].v, ev.salesRange.high);
    assert.match(labels['Range Low'].f, /^'Sales Matrix'!V\d+$/);
    assert.ok(labels['Range Low per sq ft']);
    assert.equal(labels['Range Low (rent pcm)'].v, ev.rentalRange.low);
    assert.equal(labels['Range High (rent per week)'].v, ev.rentalRange.highWeekly);
    assert.ok(findCell(ws, (c) => c.v === 'Valuation opinion: [VALUER TO COMPLETE]'));
    assert.ok(findCell(ws, (c) => /Auction sale/.test(c.v)));
  });

  test('never an adopted value, average or weighted average; no hyphens in text', () => {
    const text = allText(wb);
    for (const t of text) {
      assert.doesNotMatch(t, /adopted value:|weighted|\baverage value\b|\bmean\b/i, t);
      assert.doesNotMatch(t, /[‐-―]|\s-\s|[a-z]-[a-z]/i, t);
    }
    for (const n of wb.SheetNames) for (const [k, c] of Object.entries(wb.Sheets[n])) {
      if (k[0] !== '!' && c.f) assert.doesNotMatch(c.f, /AVERAGE|MEDIAN|SUMPRODUCT/i, `${n}!${k}`);
    }
    // the median used for the outlier test must not appear as a number anywhere
    const med = ev.salesRange.median;
    const nums = wb.SheetNames.flatMap((n) => Object.entries(wb.Sheets[n]).filter(([k, c]) => k[0] !== '!' && c.t === 'n').map(([, c]) => c.v));
    const inputs = new Set([...state.sales, ...state.rentals].map((c) => c.price));
    ev.sales.forEach((r) => inputs.add(r.hpi.adjustedPrice));
    if (!inputs.has(med)) assert.ok(!nums.includes(med), 'median leaked');
  });
});

describe('filename and helpers', { skip: NOLIB }, () => {
  test('filename uses case ref, strips unsafe characters', () => {
    assert.equal(xlsxFilename(state), 'Gibsons comparable matrix GS 2026 114 2026-11-06.xlsx');
    assert.equal(xlsxFilename({ caseRef: '', subject: { address: '14 Rowan Way, Chelmsford' }, valuationDate: '2026-11-06' }),
      'Gibsons comparable matrix 14 Rowan Way 2026-11-06.xlsx');
    assert.equal(xlsxFilename({ subject: { address: 'Flat 2\n10 High St' }, valuationDate: '' }), 'Gibsons comparable matrix Flat 2.xlsx');
    assert.equal(human('semi-detached'), 'Semi detached');
  });

  test('empty state still builds', () => {
    const s = createState();
    const w = buildWorkbook(s, evaluate(s), X);
    assert.deepEqual([...w.SheetNames], ['Sales Matrix', 'Adjustments', 'Summary']);
    assert.ok(writeWorkbook(w, X).length > 1000);
  });
});

// ---------- independent readers ----------

const hasPy = spawnSync('python3', ['-c', 'import openpyxl'], { encoding: 'utf8' }).status === 0;
describe('openpyxl reads the styles and panes', { skip: NOLIB || (!hasPy && 'openpyxl not installed') }, () => {
  test('fills, fonts, number formats, freeze, formulas', () => {
    const py = `
import openpyxl, json, sys
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb['Sales Matrix']
out = {
  'sheets': wb.sheetnames,
  'freeze': ws.freeze_panes,
  'freezeSummary': wb['Summary'].freeze_panes,
  'hdrFill': ws['A5'].fill.fgColor.rgb, 'hdrFont': ws['A5'].font.color.rgb, 'hdrBold': ws['A5'].font.b,
  'flagFill': ws['Y7'].fill.fgColor.rgb, 'flagFont': ws['Y7'].font.color.rgb,
  'altFill': ws['B7'].fill.fgColor.rgb,
  'priceFmt': ws['I6'].number_format, 'pctFmt': ws['S6'].number_format,
  'factorF': ws['P6'].value, 'valueF': ws['V6'].value,
  'widthB': ws.column_dimensions['B'].width,
}
print(json.dumps(out))`;
    const out = JSON.parse(execFileSync('python3', ['-c', py, file], { encoding: 'utf8' }));
    assert.deepEqual(out.sheets, ['Sales Matrix', 'Rental Matrix', 'Adjustments', 'Summary']);
    assert.equal(out.freeze, 'C6');
    assert.equal(out.freezeSummary, 'A3');
    assert.match(out.hdrFill, /FF6600$/); assert.match(out.hdrFont, /FFFFFF$/); assert.equal(out.hdrBold, true);
    assert.match(out.flagFill, /FFFACD$/); assert.match(out.flagFont, /CC0000$/);
    assert.match(out.altFill, /F9F9F9$/);
    assert.equal(out.priceFmt, '£#,##0'); assert.equal(out.pctFmt, '0.0%');
    assert.match(out.factorF, /^=IF\(AND\(ISNUMBER\(N6\)/);
    assert.match(out.valueF, /^=IF\(ISNUMBER\(Q6\)/);
    assert.ok(out.widthB > 30);
  });
});

const hasSoffice = spawnSync('soffice', ['--version'], { encoding: 'utf8' }).status === 0;
describe('LibreOffice recalculation matches calc.js', { skip: NOLIB || (!hasSoffice && 'LibreOffice not installed'), timeout: 120000 }, () => {
  test('recalculated formulas agree with the tool', () => {
    const outDir = path.join(TMP, 'lo');
    fs.mkdirSync(outDir, { recursive: true });
    // Blank every cached formula result first, so the check only passes if LibreOffice really
    // recalculated the formulas (a stale cache cannot satisfy it).
    const blank = buildWorkbook(state, ev, X);
    for (const n of blank.SheetNames) for (const [k, c] of Object.entries(blank.Sheets[n])) {
      if (k[0] !== '!' && c.f) { c.t = 'n'; c.v = 0; }
    }
    fs.mkdirSync(path.join(TMP, 'blank'), { recursive: true });
    const blankFile = path.join(TMP, 'blank', 'out.xlsx');
    fs.writeFileSync(blankFile, writeWorkbook(blank, X));
    execFileSync('soffice', ['--headless', `-env:UserInstallation=file://${TMP}/lo-profile`, '--convert-to', 'xlsx:Calc MS Excel 2007 XML', '--outdir', outDir, blankFile],
      { stdio: 'pipe', timeout: 110000 });
    const back = X.read(fs.readFileSync(path.join(outDir, 'out.xlsx')), { type: 'buffer' });
    const ws = back.Sheets['Sales Matrix'];
    const near = (a, b, tol = 1) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`);
    ev.sales.forEach((r, i) => {
      const R = 6 + i;
      if (r.adjustedValue === null) return;
      near(ws[`V${R}`].v, r.adjustedValue);
      if (r.perSqFt !== null) near(ws[`W${R}`].v, r.perSqFt, 0.01);
    });
    const low = findCell(ws, (c) => c.v === 'Range Low');
    const rr = Number(low.replace(/\D/g, ''));
    near(ws[`V${rr}`].v, ev.salesRange.low);
    near(ws[`V${rr + 1}`].v, ev.salesRange.high);
    near(ws[`W${rr}`].v, ev.salesRange.lowPerSqFt, 0.01);
    const rws = back.Sheets['Rental Matrix'];
    const rh = headerMap(rws, X);
    const rlow = findCell(rws, (c) => c.v === 'Range Low');
    const rr2 = Number(rlow.replace(/\D/g, ''));
    near(rws[`${rh['Adjusted rent pcm']}${rr2}`].v, ev.rentalRange.low);
    near(rws[`${rh['Adjusted rent per week']}${rr2 + 1}`].v, ev.rentalRange.highWeekly, 0.01);
    const summ = back.Sheets.Summary;
    assert.ok(findCell(summ, (c) => c.t === 'n' && c.v === ev.salesRange.high));
  });
});

// ---------- real browser download ----------

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';
let playwright = null;
try { playwright = createRequire(import.meta.url)('playwright'); } catch { /* not installed */ }

function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
}

describe('browser download via Playwright', { skip: NOLIB || (!playwright && 'playwright not installed'), timeout: 90000 }, () => {
  test('harness downloads a valid workbook through the pinned CDN script tag', async () => {
    const port = await freePort();
    const root = path.join(here, '..');
    const srv = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
    const browser = await playwright.chromium.launch();
    try {
      for (let i = 0; i < 50; i += 1) {
        try { await fetch(`http://127.0.0.1:${port}/`); break; } catch { await new Promise((r) => setTimeout(r, 100)); }
      }
      const ctx = await browser.newContext({ acceptDownloads: true });
      const page = await ctx.newPage();
      const errors = [];
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', (e) => errors.push(String(e)));
      // The sandbox cannot reach jsDelivr, so serve the identical bytes for the pinned URL.
      // The script tag still carries integrity and crossorigin, so the SRI hash is checked by Chromium.
      let cdnHits = 0;
      await page.route(XLSX_URL, (route) => {
        cdnHits += 1;
        route.fulfill({ status: 200, contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' }, body: fs.readFileSync(vendor) });
      });
      await page.goto(`http://127.0.0.1:${port}/tests/harness-xlsx.html`);
      await page.waitForFunction(() => window.__ready === true);
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#go')]);
      assert.equal(dl.suggestedFilename(), 'Gibsons comparable matrix GS 2026 114 2026-11-06.xlsx');
      const saved = path.join(TMP, 'browser.xlsx');
      await dl.saveAs(saved);
      await page.waitForSelector('#status[data-done]');
      assert.equal(cdnHits, 1);
      const sri = await page.evaluate(() => document.querySelector('script[data-vm-xlsx]')?.integrity);
      assert.equal(sri, XLSX_INTEGRITY);
      // second export reuses the loaded library
      const [dl2] = await Promise.all([page.waitForEvent('download'), page.click('#go')]);
      assert.ok(dl2);
      assert.equal(cdnHits, 1);
      const back = X.read(fs.readFileSync(saved), { type: 'buffer', cellStyles: true });
      assert.deepEqual([...back.SheetNames], ['Sales Matrix', 'Rental Matrix', 'Adjustments', 'Summary']);
      assert.equal(back.Sheets['Sales Matrix'].A5.v, 'No.');
      assert.ok(back.Sheets['Sales Matrix'].V6.f);
      assert.deepEqual(errors, []);

      // A failed CDN load gives a friendly message, not a crash.
      const page2 = await ctx.newPage();
      const errors2 = [];
      page2.on('pageerror', (e) => errors2.push(String(e)));
      await page2.route(XLSX_URL, (route) => route.abort());
      await page2.goto(`http://127.0.0.1:${port}/tests/harness-xlsx.html`);
      await page2.waitForFunction(() => window.__ready === true);
      await page2.click('#go');
      await page2.waitForSelector('#status[data-error]');
      assert.match(await page2.textContent('#status'), /Could not load the Excel library/);
      assert.deepEqual(errors2, []);
    } finally {
      await browser.close();
      srv.kill();
    }
  });
});
