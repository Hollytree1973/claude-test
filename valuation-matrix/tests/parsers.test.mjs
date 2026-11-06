// Tests for js/parsers.js. Run: node --test tests/parsers.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  parseComparables, parseUkDate, findDates, extractPostcode, detectPropertyType,
  detectFloorArea, findPrices, titleCase,
} from '../js/parsers.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name) => readFileSync(join(here, 'fixtures', name), 'utf8');

const ALLOWED = new Set(['address', 'postcode', 'propertyType', 'tenure', 'unexpiredTerm', 'bedrooms',
  'floorAreaSqFt', 'floorAreaSqM', 'price', 'saleDate', 'distanceMiles', 'source', 'saleKind',
  'hpiAtSale', 'quantumOverride', 'adjustments', 'excluded', 'notes']);
const TYPES = new Set(['detached', 'semi-detached', 'terraced', 'end-terrace', 'flat', 'maisonette', 'bungalow']);
const KINDS = new Set(['standard', 'auction', 'repossession', 'new-build']);

function checkShape(res) {
  assert.ok(Array.isArray(res.rows));
  assert.ok(Array.isArray(res.warnings));
  assert.equal(typeof res.format, 'string');
  for (const r of res.rows) {
    assert.equal(r.id, undefined, 'rows must not carry an id');
    for (const k of Object.keys(r)) assert.ok(ALLOWED.has(k), `unexpected key ${k}`);
    if (r.propertyType) assert.ok(TYPES.has(r.propertyType), r.propertyType);
    assert.ok(KINDS.has(r.saleKind), r.saleKind);
    if (r.tenure) assert.ok(r.tenure === 'freehold' || r.tenure === 'leasehold');
    if (r.saleDate) assert.match(r.saleDate, /^\d{4}-\d{2}-\d{2}$/);
    if (r.postcode) assert.match(r.postcode, /^[A-Z]{1,2}\d[A-Z\d]?( \d[A-Z]{2})?$/);
    if (r.floorAreaSqFt != null || r.floorAreaSqM != null) {
      assert.equal(typeof r.floorAreaSqFt, 'number');
      assert.equal(typeof r.floorAreaSqM, 'number');
    }
  }
  for (const w of res.warnings) {
    assert.equal(typeof w, 'string');
    assert.doesNotMatch(w, /[-‐-―]/, `warning contains a dash: ${w}`);
  }
  for (const r of res.rows) if (r.notes) assert.doesNotMatch(r.notes, /[-‐-―]/);
  // Never an adopted value, average or weighted average.
  const json = JSON.stringify(res).toLowerCase();
  assert.doesNotMatch(json, /adopted|average|weighted|mean/);
  return res;
}

// ---------------------------------------------------------------- helpers

test('UK dates parse to ISO', () => {
  assert.deepEqual(parseUkDate('12/03/2026'), { iso: '2026-03-12', monthOnly: false });
  assert.deepEqual(parseUkDate('Sold on 12 Mar 2026'), { iso: '2026-03-12', monthOnly: false });
  assert.deepEqual(parseUkDate('1st September 2025'), { iso: '2025-09-01', monthOnly: false });
  assert.deepEqual(parseUkDate('2026-03-12 00:00'), { iso: '2026-03-12', monthOnly: false });
  assert.deepEqual(parseUkDate('Mar 2026'), { iso: '2026-03-01', monthOnly: true });
  assert.deepEqual(parseUkDate('March 2026'), { iso: '2026-03-01', monthOnly: true });
  assert.deepEqual(parseUkDate('03/2026'), { iso: '2026-03-01', monthOnly: true });
  assert.deepEqual(parseUkDate('5.1.25'), { iso: '2025-01-05', monthOnly: false });
  assert.equal(parseUkDate('31/02/2026'), null, 'impossible dates are rejected');
  assert.equal(parseUkDate('CM1 2AB'), null);
  assert.equal(findDates('£425,000 0.21 miles 1,023 sq ft').length, 0);
});

test('postcodes are extracted and normalised', () => {
  assert.deepEqual(extractPostcode('14 Oak Road, Chelmsford, Essex CM1 2AB'),
    { postcode: 'CM1 2AB', rest: '14 Oak Road, Chelmsford, Essex', partial: false });
  assert.equal(extractPostcode('51 Ongar Road, Brentwood cm159ax').postcode, 'CM15 9AX');
  const p = extractPostcode('22 High Street, Ingatestone, CM4');
  assert.equal(p.postcode, 'CM4');
  assert.equal(p.partial, true);
  assert.equal(extractPostcode('Rose Cottage, Weald Road').postcode, '');
});

test('property types are recognised', () => {
  assert.equal(detectPropertyType('3 bed semi-detached house'), 'semi-detached');
  assert.equal(detectPropertyType('3 bed semi'), 'semi-detached');
  assert.equal(detectPropertyType('End of terrace house'), 'end-terrace');
  assert.equal(detectPropertyType('Mid terrace'), 'terraced');
  assert.equal(detectPropertyType('4 bed detached house'), 'detached');
  assert.equal(detectPropertyType('2 bed semi-detached bungalow'), 'bungalow');
  assert.equal(detectPropertyType('2 bed apartment'), 'flat');
  assert.equal(detectPropertyType('Ground floor maisonette'), 'maisonette');
  assert.equal(detectPropertyType('Town house'), 'terraced');
  assert.equal(detectPropertyType('Land'), '');
});

test('floor areas and prices', () => {
  assert.deepEqual(detectFloorArea('1,023 sq ft'), { sqft: 1023, sqm: null });
  assert.deepEqual(detectFloorArea('95 sq m'), { sqft: null, sqm: 95 });
  assert.deepEqual(detectFloorArea('88m²'), { sqft: null, sqm: 88 });
  assert.equal(detectFloorArea('£415 per sq ft'), null, 'price per sq ft is not a floor area');
  assert.deepEqual(findPrices('£425,000').map((p) => p.value), [425000]);
  assert.deepEqual(findPrices('£455k').map((p) => p.value), [455000]);
  assert.deepEqual(findPrices('£1.2m').map((p) => p.value), [1200000]);
  assert.deepEqual(findPrices('£415 per sq ft'), []);
  assert.equal(findPrices('£425 pw')[0].unit, 'pw');
  assert.equal(findPrices('1,450 pcm')[0].unit, 'pcm');
});

test('title case keeps place names readable', () => {
  assert.equal(titleCase('STANFORD-LE-HOPE'), 'Stanford-le-Hope');
  assert.equal(titleCase('FLAT 2A'), 'Flat 2A');
  assert.equal(titleCase("ST MARY'S ROAD"), "St Mary's Road");
});

// ---------------------------------------------------------------- formats

test('Rightmove SCT pasted blocks', () => {
  const res = checkShape(parseComparables(fx('rightmove-sct.txt'), { kind: 'sales' }));
  assert.equal(res.format, 'rightmove');
  assert.equal(res.rows.length, 5, 'heading lines are not read as a comparable');
  const [a, b, c, d, e] = res.rows;
  assert.equal(a.address, '14 Oak Road, Chelmsford, Essex');
  assert.equal(a.postcode, 'CM1 2AB');
  assert.equal(a.price, 425000, 'the previous sale price is ignored');
  assert.equal(a.saleDate, '2026-03-12');
  assert.equal(a.bedrooms, 3);
  assert.equal(a.propertyType, 'semi-detached');
  assert.equal(a.floorAreaSqFt, 1023);
  assert.equal(a.floorAreaSqM, 95);
  assert.equal(a.distanceMiles, 0.21);
  assert.equal(a.tenure, 'freehold');
  assert.equal(a.source, 'Rightmove SCT');
  assert.equal(b.price, 398500);
  assert.equal(b.floorAreaSqM, 88);
  assert.equal(b.floorAreaSqFt, 947.2, 'sq ft filled from sq m');
  assert.equal(c.tenure, 'leasehold');
  assert.equal(c.unexpiredTerm, 112);
  assert.equal(c.saleDate, '2025-11-03');
  assert.equal(c.propertyType, 'flat');
  assert.equal(d.saleKind, 'auction');
  assert.equal(d.propertyType, 'end-terrace');
  assert.equal(e.saleKind, 'new-build');
  assert.ok(res.warnings.includes('Row 4: no floor area found'));
});

test('Rightmove blocks without blank lines between them', () => {
  const res = checkShape(parseComparables(fx('rightmove-noblanks.txt'), { kind: 'sales' }));
  assert.equal(res.format, 'rightmove');
  assert.equal(res.rows.length, 3);
  assert.deepEqual(res.rows.map((r) => r.price), [575000, 540000, 695000]);
  assert.equal(res.rows[2].address, 'Rose Cottage, Weald Road, Brentwood');
  assert.equal(res.rows[1].postcode, 'CM14 4NB');
});

test('Land Registry price paid CSV', () => {
  const res = checkShape(parseComparables(fx('land-registry-ppd.csv'), { kind: 'sales' }));
  assert.equal(res.format, 'land-registry');
  assert.equal(res.rows.length, 7, 'deleted records are skipped');
  const [a, flat, nb, catB, , sle, other] = res.rows;
  assert.equal(a.address, '14 Oak Road, Chelmsford');
  assert.equal(a.postcode, 'CM1 2AB');
  assert.equal(a.price, 425000);
  assert.equal(a.saleDate, '2026-03-12');
  assert.equal(a.propertyType, 'semi-detached');
  assert.equal(a.tenure, 'freehold');
  assert.equal(a.source, 'Land Registry');
  assert.equal(flat.address, 'Flat 6, Cedar Court, New London Road, Chelmsford');
  assert.equal(flat.tenure, 'leasehold');
  assert.equal(flat.propertyType, 'flat');
  assert.equal(nb.saleKind, 'new-build');
  assert.equal(catB.address, '33 Beehive Lane, Great Baddow, Chelmsford');
  assert.ok(res.warnings.some((w) => w.startsWith('Row 4: Land Registry category B')));
  assert.equal(sle.address, '8 King Street, Stanford-le-Hope');
  assert.equal(other.propertyType, undefined);
  assert.ok(res.warnings.some((w) => /Line 8 was skipped/.test(w)));
});

test('CSV table with header row', () => {
  const res = checkShape(parseComparables(fx('table.csv'), { kind: 'sales' }));
  assert.equal(res.format, 'table');
  assert.equal(res.rows.length, 4);
  const [a, b, c, d] = res.rows;
  assert.equal(a.price, 425000);
  assert.equal(a.saleDate, '2026-03-12');
  assert.equal(a.floorAreaSqFt, 1023);
  assert.equal(a.floorAreaSqM, 95);
  assert.equal(a.distanceMiles, 0.21);
  assert.equal(b.source, 'Land Registry');
  assert.equal(b.notes, 'South facing garden');
  assert.equal(c.unexpiredTerm, 112);
  assert.equal(c.source, 'Agent');
  assert.equal(d.saleKind, 'auction');
  assert.equal(d.saleDate, '2025-08-01');
  assert.ok(res.warnings.some((w) => /^Row 4: only a month was given/.test(w)));
});

test('tab separated table with type and tenure codes', () => {
  const res = checkShape(parseComparables(fx('table.tsv'), { kind: 'sales' }));
  assert.equal(res.format, 'table');
  assert.equal(res.rows.length, 3);
  assert.equal(res.rows[0].propertyType, 'semi-detached');
  assert.equal(res.rows[0].tenure, 'freehold');
  assert.equal(res.rows[0].saleDate, '2026-02-04');
  assert.equal(res.rows[0].floorAreaSqFt, 1141);
  assert.equal(res.rows[2].unexpiredTerm, 94);
  assert.equal(res.rows[2].floorAreaSqFt, 662);
});

test('free typed list', () => {
  const res = checkShape(parseComparables(fx('free-list.txt'), { kind: 'sales' }));
  assert.equal(res.format, 'list');
  assert.equal(res.rows.length, 4);
  const [a, b, c, d] = res.rows;
  assert.deepEqual(
    { address: a.address, postcode: a.postcode, price: a.price, saleDate: a.saleDate, bedrooms: a.bedrooms,
      propertyType: a.propertyType, floorAreaSqFt: a.floorAreaSqFt, floorAreaSqM: a.floorAreaSqM, distanceMiles: a.distanceMiles },
    { address: '12 Oak Road', postcode: 'CM1 2AB', price: 410000, saleDate: '2026-03-01', bedrooms: 3,
      propertyType: 'semi-detached', floorAreaSqFt: 980, floorAreaSqM: 91, distanceMiles: 0.3 });
  assert.ok(res.warnings.some((w) => w.startsWith('Row 1: only a month was given')));
  assert.equal(b.price, 455000);
  assert.equal(b.floorAreaSqFt, 1097.9);
  assert.equal(c.address, 'Flat 2, 8 Duke Street, Chelmsford');
  assert.equal(c.unexpiredTerm, 89);
  assert.equal(d.price, 385000, 'bare number read as the price');
  assert.equal(d.saleKind, 'repossession');
  assert.equal(d.propertyType, 'terraced');
});

test('single example line from the brief', () => {
  const res = checkShape(parseComparables('12 Oak Road CM1 2AB, £410,000, 03/2026, 3 bed semi, 980 sq ft, 0.3 miles', { kind: 'sales' }));
  assert.equal(res.rows.length, 1);
  assert.equal(res.rows[0].price, 410000);
});

// ---------------------------------------------------------------- rentals

test('rentals: pcm kept, pw converted with a warning', () => {
  const res = checkShape(parseComparables(fx('rentals-rightmove.txt'), { kind: 'rentals' }));
  assert.equal(res.rows.length, 3);
  assert.equal(res.rows[0].price, 1450);
  assert.equal(res.rows[0].saleDate, '2026-09-02');
  assert.equal(res.rows[1].price, Math.round(425 * 52 / 12));
  assert.ok(res.warnings.some((w) => w.startsWith('Row 2: weekly rent')));
  assert.equal(res.rows[2].saleDate, '2026-08-01');
  assert.equal(res.rows[0].source, 'Rightmove');
});

test('rentals table with a weekly rent column', () => {
  const res = checkShape(parseComparables(fx('rentals-table.csv'), { kind: 'rentals' }));
  assert.equal(res.format, 'table');
  assert.equal(res.rows[0].price, 1300);
  assert.equal(res.rows[1].price, 1200);
});

// ---------------------------------------------------------------- robustness

test('never throws on odd input', () => {
  for (const input of [undefined, null, '', '   \n\n', 42, {}, 'hello', '£', ',,,,\n,,,', '"unterminated, quote\n1,2',
    'x'.repeat(50000), '﻿Address,Price\n"1 A Road",100000']) {
    const res = parseComparables(input, { kind: 'sales' });
    checkShape(res);
  }
  assert.equal(parseComparables('', {}).format, 'empty');
  assert.equal(parseComparables('Address,Price\n"1 A Road, Brentwood",£300,000').rows[0].price, 300000);
});

test('missing data produces per row warnings', () => {
  const res = checkShape(parseComparables('3 High Street, Brentwood CM14 4AB, £350,000, 3 bed terraced', { kind: 'sales' }));
  assert.ok(res.warnings.includes('Row 1: no floor area found'));
  assert.ok(res.warnings.includes('Row 1: no sale date found'));
});

test('a sale price pasted as a rent is flagged, and vice versa', () => {
  const r1 = checkShape(parseComparables('9 Hall Lane, Shenfield CM15 9AF, £1,200 pcm, 01/09/2026', { kind: 'sales' }));
  assert.ok(r1.warnings.some((w) => /marked as a rent/.test(w)));
  const r2 = checkShape(parseComparables('9 Hall Lane, Shenfield CM15 9AF, £450,000, 01/09/2026', { kind: 'rentals' }));
  assert.ok(r2.warnings.some((w) => /looks high for a monthly rent/.test(w)));
});

test('duplicates are pointed out', () => {
  const line = '12 Oak Road CM1 2AB, £410,000, 12/03/2026, 3 bed semi, 980 sq ft';
  const res = checkShape(parseComparables(`${line}\n${line}`, { kind: 'sales' }));
  assert.equal(res.rows.length, 2);
  assert.ok(res.warnings.includes('Row 2: looks like a duplicate of row 1'));
});
