// Tests for js/hpi.js and the HPI panel (js/ui-hpi.js). Run: node --test tests/hpi.test.mjs
// The browser test uses Playwright if it can be loaded; otherwise it is skipped.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  REGIONS, parseSeriesCsv, parseMonth, indexFor, indexEntryFor, latestMonth, applySeries, fetchSeries,
  suggestRegionForPostcode, suggestRegionForArea,
} from '../js/hpi.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('REGIONS', () => {
  test('has the expected areas with unique slugs and no hyphens in labels', () => {
    const groups = (g) => REGIONS.filter((r) => r.group === g).length;
    assert.equal(groups('Essex'), 14);
    assert.equal(groups('London boroughs'), 33);
    assert.equal(groups('Hertfordshire'), 10);
    for (const s of ['east-of-england', 'london', 'england', 'united-kingdom', 'chelmsford', 'city-of-london', 'thurrock', 'southend-on-sea', 'st-albans']) {
      assert.ok(REGIONS.some((r) => r.slug === s), s);
    }
    assert.equal(new Set(REGIONS.map((r) => r.slug)).size, REGIONS.length);
    for (const r of REGIONS) assert.ok(!/[-–—]/.test(r.label), r.label);
  });
});

describe('parseMonth', () => {
  const cases = {
    '2026-03': '2026-03', '2026-03-01': '2026-03', '2026-03-01T00:00:00Z': '2026-03', '01/03/2026': '2026-03',
    '03/2026': '2026-03', 'Mar 2026': '2026-03', 'March 2026': '2026-03', 'Mar-26': '2026-03', 'Sept 2025': '2025-09',
    '2026 MAR': '2026-03', '2026M03': '2026-03', '202603': '2026-03', '1 Mar 2026': '2026-03',
  };
  for (const [input, want] of Object.entries(cases)) test(input, () => assert.equal(parseMonth(input), want));
  test('rejects non months', () => {
    for (const x of ['', 'Title', '2026', '2026 Q1', '152.3', 'Total 2026', '2026-13']) assert.equal(parseMonth(x), null, x);
  });
});

describe('parseSeriesCsv', () => {
  test('simple pasted lines in mixed formats', () => {
    const s = parseSeriesCsv('Mar 2026, 152.3\nApr 2026 153.1\n2026-05\t154\nMay 2026: 154.2\n\n');
    assert.deepEqual(s, [{ month: '2026-03', index: 152.3 }, { month: '2026-04', index: 153.1 }, { month: '2026-05', index: 154.2 }]);
  });

  test('month,index with header, unsorted input comes back sorted', () => {
    const s = parseSeriesCsv('month,index\n2026-02,151\n2026-01,150.5\n');
    assert.deepEqual(s, [{ month: '2026-01', index: 150.5 }, { month: '2026-02', index: 151 }]);
  });

  test('UKHPI app download CSV picks the all property types index', () => {
    const csv = [
      '"Name","URI","Period","Pivotable date","Reporting period","Percentage change (monthly) All property types","House price index All property types","House price index Detached houses","Average price All property types"',
      '"Chelmsford","http://landregistry.data.gov.uk/id/region/chelmsford","2026-07","2026-07-01","monthly","-0.2","98.6","97.9","377000"',
      '"Chelmsford","http://landregistry.data.gov.uk/id/region/chelmsford","2026-08","2026-08-01","monthly","-0.3","98.3","98.0","376682"',
    ].join('\n');
    assert.deepEqual(parseSeriesCsv(csv), [{ month: '2026-07', index: 98.6 }, { month: '2026-08', index: 98.3 }]);
  });

  test('ONS style CSV with metadata rows', () => {
    const csv = [
      '"Title","UK House Price Index: Chelmsford"', '"CDID","ABCD"', '"Source dataset ID","HPI"',
      '"PreUnit",""', '"Unit","Index"', '"Release date","18-11-2026"', '"Next release","16 December 2026"',
      '"2024","95.1"', '"2025 Q1","96.0"', '"2026 JUL","98.6"', '"2026 AUG","98.3"',
    ].join('\n');
    assert.deepEqual(parseSeriesCsv(csv), [{ month: '2026-07', index: 98.6 }, { month: '2026-08', index: 98.3 }]);
  });

  test('Land Registry full file: needs a region filter, uses Index not IndexSA', () => {
    const csv = [
      'Date,RegionName,AreaCode,AveragePrice,Index,IndexSA,1m%Change,DetachedIndex',
      '01/07/2026,Chelmsford,E07000070,377000,98.6,98.1,-0.2,97.9',
      '01/08/2026,Chelmsford,E07000070,376682,98.3,98.0,-0.3,98.0',
      '01/08/2026,Basildon,E07000066,330000,101.2,101.0,0.1,100.0',
    ].join('\n');
    assert.throws(() => parseSeriesCsv(csv), (e) => e.code === 'MULTI_REGION' && /2 different areas/.test(e.message));
    assert.deepEqual(parseSeriesCsv(csv, { region: 'chelmsford' }), [{ month: '2026-07', index: 98.6 }, { month: '2026-08', index: 98.3 }]);
    assert.deepEqual(parseSeriesCsv(csv, { region: 'basildon' }), [{ month: '2026-08', index: 101.2 }]);
  });

  test('tab separated paste from a spreadsheet', () => {
    assert.deepEqual(parseSeriesCsv('Month\tHPI\nJan 2026\t97.1\nFeb 2026\t97.4'), [{ month: '2026-01', index: 97.1 }, { month: '2026-02', index: 97.4 }]);
  });

  test('rubbish gives an empty series', () => {
    assert.deepEqual(parseSeriesCsv(''), []);
    assert.deepEqual(parseSeriesCsv('hello world\nnothing here'), []);
  });
});

const SERIES = [
  { month: '2025-01', index: 95 }, { month: '2025-03', index: 96 }, { month: '2026-07', index: 98.6 }, { month: '2026-08', index: 98.3 },
];

describe('indexFor and latestMonth', () => {
  test('exact month', () => assert.equal(indexFor(SERIES, '2026-07-15'), 98.6));
  test('gap uses nearest month at or before', () => assert.equal(indexFor(SERIES, '2025-02-28'), 95));
  test('valuation month not yet published uses the latest month', () => {
    assert.equal(indexFor(SERIES, '2026-11-06'), 98.3);
    assert.deepEqual(indexEntryFor(SERIES, '2026-11-06'), { month: '2026-08', index: 98.3, exact: false, lagMonths: 3 });
  });
  test('before the series starts gives null', () => assert.equal(indexFor(SERIES, '2024-12-31'), null));
  test('bad input gives null', () => { assert.equal(indexFor(SERIES, ''), null); assert.equal(indexFor([], '2026-01-01'), null); });
  test('accepts YYYY-MM', () => assert.equal(indexFor(SERIES, '2025-03'), 96));
  test('latestMonth', () => { assert.equal(latestMonth(SERIES), '2026-08'); assert.equal(latestMonth([]), null); });
});

function draft() {
  return {
    valuationDate: '2026-11-06',
    hpi: { regionSlug: 'chelmsford', regionLabel: 'Chelmsford', series: [], valuationIndex: null, source: '' },
    sales: [
      { id: 'a', saleDate: '2025-03-14', hpiAtSale: null },
      { id: 'b', saleDate: '2025-01-02', hpiAtSale: 94.5 },
      { id: 'c', saleDate: '', hpiAtSale: null },
      { id: 'd', saleDate: '2020-01-01', hpiAtSale: null },
    ],
    rentals: [{ id: 'r', saleDate: '2025-03-01', hpiAtSale: null }],
  };
}

describe('applySeries', () => {
  test('fills only blanks without force', () => {
    const d = draft();
    const sm = applySeries(d, SERIES);
    assert.equal(d.hpi.valuationIndex, 98.3);
    assert.equal(d.sales[0].hpiAtSale, 96);
    assert.equal(d.sales[1].hpiAtSale, 94.5);
    assert.equal(d.sales[2].hpiAtSale, null);
    assert.equal(d.sales[3].hpiAtSale, null);
    assert.equal(d.rentals[0].hpiAtSale, null);
    assert.equal(d.hpi.series.length, 4);
    assert.deepEqual({ filled: sm.filled, unchanged: sm.unchanged, noMatch: sm.noMatch, valuationMonth: sm.valuationMonth, latestMonth: sm.latestMonth },
      { filled: 1, unchanged: 1, noMatch: 2, valuationMonth: '2026-08', latestMonth: '2026-08' });
  });

  test('keeps a hand entered valuation index without force', () => {
    const d = draft(); d.hpi.valuationIndex = 99.9;
    applySeries(d, SERIES);
    assert.equal(d.hpi.valuationIndex, 99.9);
  });

  test('force overwrites everything it can match', () => {
    const d = draft(); d.hpi.valuationIndex = 99.9;
    applySeries(d, SERIES, { force: true });
    assert.equal(d.hpi.valuationIndex, 98.3);
    assert.equal(d.sales[1].hpiAtSale, 95);
  });

  test('null series uses the cached state series', () => {
    const d = draft(); d.hpi.series = SERIES.slice();
    applySeries(d, null);
    assert.equal(d.sales[0].hpiAtSale, 96);
  });

  test('empty series changes nothing', () => {
    const d = draft();
    applySeries(d, []);
    assert.equal(d.hpi.valuationIndex, null);
    assert.equal(d.sales[0].hpiAtSale, null);
  });
});

describe('suggestions', () => {
  test('postcode districts', () => {
    assert.equal(suggestRegionForPostcode('CM2 9AB')?.slug, 'chelmsford');
    assert.equal(suggestRegionForPostcode('ss0 7aa')?.slug, 'southend-on-sea');
    assert.equal(suggestRegionForPostcode('SW1A 1AA')?.slug, 'city-of-westminster');
    assert.equal(suggestRegionForPostcode('EC1V 2NX')?.slug, 'london');
    assert.equal(suggestRegionForPostcode('CM5 0AA'), null);
    assert.equal(suggestRegionForPostcode(''), null);
  });
  test('parking area names', () => {
    assert.equal(suggestRegionForArea('camden')?.slug, 'camden');
    assert.equal(suggestRegionForArea('Royal Borough of Kensington & Chelsea')?.slug, 'kensington-and-chelsea');
    assert.equal(suggestRegionForArea('Essex outer'), null);
  });
});

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('fetchSeries', () => {
  test('builds the linked data URL and follows pages', async () => {
    const urls = [];
    const pages = [
      { result: { items: [{ refMonth: '2026-07', housePriceIndex: 98.6 }], next: 'https://landregistry.data.gov.uk/next' } },
      { result: { items: [{ refMonth: '2026-08', housePriceIndex: 98.3 }] } },
    ];
    const fakeFetch = async (url) => { urls.push(url); return jsonResponse(pages[urls.length - 1]); };
    const s = await fetchSeries('chelmsford', '2026-07', '2026-11', { fetch: fakeFetch });
    assert.deepEqual(s, [{ month: '2026-07', index: 98.6 }, { month: '2026-08', index: 98.3 }]);
    const u = new URL(urls[0]);
    assert.equal(u.origin + u.pathname, 'https://landregistry.data.gov.uk/data/ukhpi/region/chelmsford.json');
    assert.equal(u.searchParams.get('min-refMonth'), '2026-07');
    assert.equal(u.searchParams.get('max-refMonth'), '2026-11');
    assert.match(u.searchParams.get('_properties'), /housePriceIndex/);
    assert.equal(urls[1], 'https://landregistry.data.gov.uk/next');
  });

  test('network or CORS failure gives a friendly error', async () => {
    const fakeFetch = async () => { throw new TypeError('Failed to fetch'); };
    await assert.rejects(fetchSeries('chelmsford', '2026-01', '2026-11', { fetch: fakeFetch }), (e) => e.code === 'NETWORK' && /paste/.test(e.message));
  });

  test('404, empty and missing region', async () => {
    await assert.rejects(fetchSeries('nowhere', '2026-01', '2026-11', { fetch: async () => jsonResponse({}, 404) }), (e) => e.code === 'NOT_FOUND');
    await assert.rejects(fetchSeries('chelmsford', '2026-01', '2026-11', { fetch: async () => jsonResponse({ result: { items: [] } }) }), (e) => e.code === 'EMPTY');
    await assert.rejects(fetchSeries('', '2026-01', '2026-11', { fetch: async () => jsonResponse({}) }), (e) => e.code === 'NO_REGION');
  });
});

// ---------------- browser test of the panel ----------------

let chromium = null;
try { chromium = createRequire(import.meta.url)('playwright').chromium; } catch { /* not installed */ }

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
function startServer() {
  return new Promise((resolve) => {
    const srv = createServer(async (req, res) => {
      const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
      if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      try { const b = await readFile(p); res.writeHead(200, { 'content-type': TYPES[path.extname(p)] || 'application/octet-stream' }); res.end(b); } catch { res.writeHead(404); res.end(); }
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

test('HPI panel in a browser', { skip: !chromium && 'playwright not available', timeout: 60000 }, async () => {
  const srv = await startServer();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', (e) => errors.push(String(e)));
    let mode = 'ok';
    await page.route('https://landregistry.data.gov.uk/**', async (route) => {
      if (mode === 'fail') return route.abort('failed');
      const items = [];
      for (let y = 2023; y <= 2026; y++) for (let m = 1; m <= 12; m++) {
        if (y === 2026 && m > 8) break;
        items.push({ refMonth: `${y}-${String(m).padStart(2, '0')}`, housePriceIndex: Math.round((90 + (y - 2023) * 2 + m * 0.1) * 10) / 10 });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify({ result: { items } }) });
    });
    await page.goto(`${base}/tests/harness-hpi.html`);
    await page.waitForFunction(() => window.__ready === true);
    const root = page.locator('#vm-hpi');

    // explanation and default region from the CM2 postcode
    assert.match(await root.locator('.vm-hpi-intro').innerText(), /official UK House Price Index/);
    assert.equal(await root.locator('select.vm-hpi-region').inputValue(), 'chelmsford');
    assert.match(await root.locator('.vm-hpi-hint').first().innerText(), /postcode district CM2/);
    assert.equal(await root.locator('optgroup').count(), 4);
    assert.equal(await root.locator('tbody tr').count(), 3);

    // fetch
    await root.locator('[data-action="fetch"]').click();
    await page.waitForFunction(() => document.querySelector('#vm-hpi .vm-hpi-status').dataset.state === 'ok');
    let st = await page.evaluate(() => window.__store.get());
    assert.equal(st.hpi.valuationIndex, 96.8); // Aug 2026 = 90 + 6 + 0.8
    assert.equal(st.sales[0].hpiAtSale, 94.3); // Mar 2025
    assert.equal(st.sales[1].hpiAtSale, 96.8); // Sep 2026 not published, Aug 2026 used
    assert.equal(st.sales[2].hpiAtSale, 90); // typed by hand, kept
    assert.match(st.hpi.source, /^HM Land Registry UK House Price Index, Chelmsford, all property types, fetched .+, latest month August 2026$/);
    assert.equal(await root.locator('.vm-hpi-source').inputValue(), st.hpi.source);
    const note = await root.locator('[data-role="latest-note"]').innerText();
    assert.match(note, /Latest month used: August 2026/);
    assert.match(note, /about two months behind/);
    assert.equal(await root.locator('tbody tr').nth(0).locator('.vm-hpi-factor').innerText(), (96.8 / 94.3).toFixed(4));

    // edit index at sale by hand
    const inp = root.locator('tbody tr').nth(0).locator('input');
    await inp.fill('92');
    await inp.press('Enter');
    await inp.blur();
    st = await page.evaluate(() => window.__store.get());
    assert.equal(st.sales[0].hpiAtSale, 92);
    assert.equal(await root.locator('tbody tr').nth(0).locator('.vm-hpi-factor').innerText(), (96.8 / 92).toFixed(4));

    // manual valuation index
    await root.locator('.vm-hpi-valuation input').fill('97.5');
    await root.locator('.vm-hpi-valuation input').blur();
    st = await page.evaluate(() => window.__store.get());
    assert.equal(st.hpi.valuationIndex, 97.5);
    assert.match(await root.locator('[data-role="latest-note"]').innerText(), /typed by hand/);

    // failure gives friendly message and opens paste box
    mode = 'fail';
    await root.locator('[data-action="fetch"]').click();
    await page.waitForFunction(() => document.querySelector('#vm-hpi .vm-hpi-status').dataset.state === 'error');
    assert.match(await root.locator('.vm-hpi-status').first().innerText(), /Could not reach HM Land Registry/);
    assert.equal(await root.locator('details').evaluate((d) => d.open), true);

    // paste route, replace all
    await root.locator('textarea').fill('Jan 2024, 80\nMar 2025, 85\nOct 2026, 100');
    await root.locator('[data-action="paste"]').click();
    assert.match(await root.locator('.vm-hpi-paste-wrap .vm-hpi-status').innerText(), /3 months loaded/);
    st = await page.evaluate(() => window.__store.get());
    assert.match(st.hpi.source, /pasted by the valuer/);
    assert.equal(st.hpi.valuationIndex, 97.5); // hand entry kept
    page.once('dialog', (d) => d.accept());
    await root.locator('[data-action="replace"]').click();
    st = await page.evaluate(() => window.__store.get());
    assert.equal(st.hpi.valuationIndex, 100);
    assert.deepEqual(st.sales.map((c) => c.hpiAtSale), [85, 85, 80]); // Sep 2026 sale takes the nearest earlier month (Mar 2025)

    // structural change: a new comparable appears in the table
    await page.evaluate(() => window.__store.update((d) => { d.sales.push({ id: 'z', address: '9 New Road', saleDate: '2025-06-01', hpiAtSale: null, price: 1 }); }));
    assert.equal(await root.locator('tbody tr').count(), 4);
    assert.match(await root.locator('tbody tr').nth(3).innerText(), /9 New Road/);

    // no hyphens or dashes in visible prose (dates such as 2026-03 in the placeholder are data)
    const text = await root.innerText();
    for (const line of text.split('\n')) assert.ok(!/[A-Za-z]\s?[-–—]\s?[A-Za-z]/.test(line), `dash in: ${line}`);
    // never shows an average or adopted value
    assert.ok(!/average|adopted/i.test(text));

    // phone width: no horizontal page scroll
    await page.setViewportSize({ width: 375, height: 800 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, `page scrolls sideways by ${overflow}px`);

    // empty case and postcode with no clear district
    await page.goto(`${base}/tests/harness-hpi.html?empty=1&postcode=CM5%200AA`);
    await page.waitForFunction(() => window.__ready === true);
    assert.equal(await root.locator('select.vm-hpi-region').inputValue(), '');
    assert.match(await root.innerText(), /No sales comparables yet/);

    // the deliberate aborted request in the failure step logs one 'Failed to load resource' line
    assert.deepEqual(errors.filter((e) => !/Failed to load resource: net::ERR_FAILED/.test(e)), []);
  } finally {
    await browser.close();
    srv.close();
  }
});
