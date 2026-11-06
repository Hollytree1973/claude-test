// Tests for js/commentary.js. Run: node --test tests/commentary.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildCommentary, buildMarkdownTable } from '../js/commentary.js';
import { evaluate } from '../js/calc.js';
import { createState, createComparable } from '../js/model.js';

const DASHES = /[\-‐‑‒–—―−⁃﹘﹣－­]/;
const BANNED = ['delve', 'leverage', 'utilise', 'comprehensive', 'robust', 'seamless', 'crucial', 'vital',
  'moreover', 'furthermore', 'notably', 'thereby', 'hence', 'thus'];

function salesCase() {
  const s = createState();
  Object.assign(s, {
    caseRef: 'GS-2026-114', valuationDate: '2026-11-06', instructionType: 'mortgage', matrixType: 'sales',
  });
  Object.assign(s.subject, {
    address: '22 Rectory Lane', postcode: 'CM1 4XY', propertyType: 'semi-detached', tenure: 'freehold',
    bedrooms: 3, floorAreaSqFt: 1100, floorAreaSqM: 102.2, condition: 'average',
  });
  s.hpi = { regionSlug: 'chelmsford', regionLabel: 'Chelmsford', series: [], valuationIndex: 150.2,
    source: 'HM Land Registry UK HPI, fetched 2026-11-06' };
  s.sales = [
    createComparable({ id: 'a', address: '14 Oak Road', postcode: 'CM1 2AB', propertyType: 'semi-detached',
      bedrooms: 3, floorAreaSqFt: 1050, price: 425000, saleDate: '2026-03-12', distanceMiles: 0.25,
      hpiAtSale: 147.1, source: 'Rightmove SCT',
      adjustments: {
        condition: { mode: 'pct', value: -5, note: 'Fully refurbished in 2025 - superior to the subject' },
        parking: { mode: 'gbp', value: 5000, note: '' },
        kitchen: { mode: 'pct', value: 0, note: 'Similar' },
      } }),
    createComparable({ id: 'b', address: 'Flat 3, 10-12 Mill Street', postcode: 'CM2 0AA', propertyType: 'end-terrace',
      bedrooms: 2, floorAreaSqFt: 850, price: 360000, saleDate: '2026-09-20', distanceMiles: 0.41,
      source: 'Land Registry', adjustments: { gardens: { mode: 'pct', value: 2.5, note: 'Smaller north facing garden; average quality' } } }),
    createComparable({ id: 'c', address: '7 The Green', postcode: 'CM1 3ZZ', propertyType: 'detached',
      bedrooms: 4, floorAreaSqFt: 1600, price: 610000, saleDate: '2025-08-01', distanceMiles: 0.72,
      hpiAtSale: 139.0, saleKind: 'auction', source: 'Agent' }),
    createComparable({ id: 'd', address: '3 Elm Close', postcode: 'CM1 5QQ', propertyType: 'semi-detached',
      bedrooms: 3, floorAreaSqFt: null, floorAreaSqM: null, price: 415000, saleDate: '2026-06-02',
      distanceMiles: 0.3, hpiAtSale: null, source: 'Rightmove SCT', excluded: true,
      notes: 'Sale agreed between family members — not arm\'s length' }),
  ];
  return s;
}

function btlCase() {
  const s = salesCase();
  s.matrixType = 'btl';
  s.instructionType = 'btl';
  s.rentals = [
    createComparable({ id: 'r1', address: '18 Oak Road', propertyType: 'semi-detached', bedrooms: 3, floorAreaSqFt: 1080,
      price: 1650, saleDate: '2026-10-01', distanceMiles: 0.2, source: 'Rightmove' }),
    createComparable({ id: 'r2', address: '9 Mill Street', propertyType: 'terraced', bedrooms: 3, floorAreaSqFt: 900,
      price: 1500, saleDate: '2026-07-15', distanceMiles: 0.6, source: 'Rightmove',
      adjustments: { condition: { mode: 'pct', value: 3, note: 'Dated décor' } } }),
  ];
  return s;
}

function assertStyle(text) {
  const lines = text.split('\n');
  lines.forEach((l, i) => assert.ok(!DASHES.test(l), `dash or hyphen on line ${i + 1}: ${l}`));
  for (const w of BANNED) assert.ok(!new RegExp(`\\b${w}`, 'i').test(text), `banned word: ${w}`);
  assert.ok(!/\baverage/i.test(text), 'mentions average');
  assert.ok(!/adopted value/i.test(text), 'mentions adopted value');
}

describe('buildCommentary', () => {
  const state = salesCase();
  const ev = evaluate(state);
  const text = buildCommentary(state, ev);

  test('style rules: no dashes, banned words, average or adopted value', () => assertStyle(text));
  test('has the five sections and the bridge placeholder', () => {
    for (const h of ['1 Opening', '2 Sales comparables', '3 Outlier treatment', '4 Range conclusion', '5 Bridge to valuation opinion']) {
      assert.ok(text.includes(`\n${h}\n`), `missing heading ${h}`);
    }
    assert.ok(text.includes('[VALUER TO COMPLETE]'));
  });
  test('range conclusion uses Range Low and Range High with per square foot', () => {
    const low = ev.salesRange.low.toLocaleString('en-GB');
    const high = ev.salesRange.high.toLocaleString('en-GB');
    assert.ok(text.includes(`Range Low £${low} to Range High £${high}`), text);
    assert.match(text, /per square foot/);
  });
  test('opening gives count, radius, dates and sources', () => {
    assert.match(text, /I considered four sales comparables within a search radius of approximately 0\.8 miles/);
    assert.match(text, /between 1 August 2025 and 20 September 2026/);
    assert.match(text, /Rightmove SCT, Land Registry and Agent/);
    assert.match(text, /I inspected the subject property, 22 Rectory Lane/);
    assert.match(text, /6 November 2026/);
  });
  test('comparable paragraphs carry facts, HPI, quantum and rationale', () => {
    assert.match(text, /Comparable 1, 14 Oak Road, CM1 2AB, is a semi detached house/);
    assert.match(text, /1,050 sq ft \(97\.5 sq m\)/);
    assert.match(text, /sold on 12 March 2026 for £425,000/);
    assert.match(text, /factor of 1\.0211/);
    assert.match(text, /Fully refurbished in 2025, superior to the subject\./);
    assert.match(text, /For parking, I made an upward adjustment of £5,000\. \[VALUER TO ADD RATIONALE\]/);
    assert.ok(!/For kitchen/.test(text), 'zero adjustment should not be listed');
    assert.match(text, /Flat 3, 10 to 12 Mill Street/);
    assert.match(text, /end of terrace house/);
    assert.match(text, /22\.73% smaller than the subject property/);
    assert.match(text, /an upward adjustment of 10%/);
    assert.match(text, /no quantum \(size\) adjustment was applied/);
  });
  test('outlier treatment covers flagged and excluded comparables', () => {
    const sec = text.split('3 Outlier treatment')[1].split('4 Range conclusion')[0];
    assert.match(sec, /Comparable 3: .*auction sale.*more than half a mile.*reduced weight/s);
    assert.match(sec, /Comparable 4: .*excluded it from the range\. Reason for exclusion: Sale agreed between family members, not arm's length\./s);
  });
  test('works without an evaluation and with an empty case', () => {
    assert.equal(buildCommentary(state), text);
    const empty = buildCommentary(createState());
    assertStyle(empty);
    assert.match(empty, /Range Low and Range High cannot yet be stated/);
    assert.ok(empty.includes('[VALUER TO COMPLETE]'));
  });
});

describe('btl and rental commentary', () => {
  test('btl adds a rental evidence section before the bridge', () => {
    const s = btlCase();
    const ev = evaluate(s);
    const t = buildCommentary(s, ev);
    assertStyle(t);
    assert.ok(t.includes('\n5 Rental evidence\n'));
    assert.ok(t.includes('\n6 Bridge to valuation opinion\n'));
    assert.match(t, /Range Low £[\d,]+ to Range High £[\d,]+ per calendar month \(£[\d,.]+ to £[\d,.]+ per week\)/);
    assert.match(t, /Rental evidence is not adjusted for movement in house prices/);
    assert.match(t, /Dated décor\./);
  });
  test('rental only case uses rental evidence as the main sections', () => {
    const s = btlCase();
    s.matrixType = 'rental';
    const t = buildCommentary(s, evaluate(s));
    assertStyle(t);
    assert.ok(t.includes('\n2 Rental comparables\n'));
    assert.ok(t.includes('\n5 Bridge to valuation opinion\n'));
    assert.ok(!t.includes('Sales comparables'));
  });
  test('banned words and dashes in user notes are cleaned', () => {
    const s = salesCase();
    s.sales[0].adjustments.condition.note = 'Moreover, a robust – crucial – refurb; hence utilised the 2024-05 works';
    const t = buildCommentary(s, evaluate(s));
    assertStyle(t);
    assert.match(t, /Also, a sound, important, refurb; so used the May 2024 works\./);
  });
});

describe('buildMarkdownTable', () => {
  const s = salesCase();
  const ev = evaluate(s);
  const md = buildMarkdownTable(s, ev, 'sales');
  const lines = md.trim().split('\n');

  test('has header, separator and one row per comparable', () => {
    assert.match(lines[0], /^\| No\. \| Address \| Type \|.*Fully adjusted value £ \|/);
    assert.match(lines[1], /^\|( --- \|)+$/);
    assert.equal(lines.filter((l) => /^\| \d+ \|/.test(l)).length, 4);
  });
  test('cell text has no hyphens or dashes', () => {
    const text = lines.filter((_, i) => i !== 1).join('\n');
    assert.ok(!DASHES.test(text), text);
    assert.match(md, /Semi detached/);
    assert.match(md, /End of terrace/);
    assert.match(md, /minus 5%/);
  });
  test('flagged cells are marked', () => {
    const row3 = lines.find((l) => l.startsWith('| 3 |'));
    assert.match(row3, /0\.72 ⚠️ SURVEYOR TO CHECK/);
    assert.match(row3, /£610,000 \(auction\) ⚠️ SURVEYOR TO CHECK/);
    assert.ok(lines.find((l) => l.startsWith('| 4 |')).includes('Excluded'));
  });
  test('range line, no average or adopted value', () => {
    assert.match(md, /Range Low £[\d,]+ to Range High £[\d,]+/);
    assert.ok(!/average|adopted value/i.test(md));
  });
  test('rentals table', () => {
    const b = btlCase();
    const r = buildMarkdownTable(b, evaluate(b), 'rentals');
    assert.match(r, /Rent £ pcm/);
    assert.match(r, /per calendar month/);
    assert.ok(!DASHES.test(r.split('\n').filter((_, i) => i !== 1).join('\n')));
  });
});
