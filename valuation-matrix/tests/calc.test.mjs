// Tests for js/calc.js. Run: node --test tests/
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  sqftToSqm, sqmToSqft, monthsBetween, quantum, quantumFor, hpi, qualitative, adjustedValue,
  flagsFor, leaseLight, evaluate, FLAG_LABELS, toNumber,
} from '../js/calc.js';

const codes = (flags) => flags.map((f) => f.code);

function baseState(extra = {}) {
  return {
    version: 1, valuationDate: '2026-11-06', matrixType: 'sales',
    subject: { floorAreaSqFt: 1000, floorAreaSqM: null, tenure: 'freehold' },
    hpi: { valuationIndex: 150, series: [] },
    sales: [], rentals: [], ...extra,
  };
}
function comp(extra = {}) {
  return {
    id: 'x', address: '', tenure: 'freehold', unexpiredTerm: null, floorAreaSqFt: null, floorAreaSqM: null,
    price: 300000, saleDate: '2026-10-01', distanceMiles: 0.2, saleKind: 'standard', hpiAtSale: null,
    quantumOverride: null, adjustments: {}, excluded: false, ...extra,
  };
}

describe('conversions and parsing', () => {
  test('sq ft and sq m', () => {
    assert.equal(sqftToSqm(1076.4), 100);
    assert.equal(sqmToSqft(100), 1076.4);
    assert.equal(sqftToSqm(1000), 92.9); // 1000 / 10.764 = 92.902
    assert.equal(sqftToSqm('1,000'), 92.9);
    assert.equal(sqftToSqm(''), null);
    assert.equal(sqmToSqft(null), null);
    assert.equal(sqmToSqft('abc'), null);
  });
  test('toNumber is defensive', () => {
    assert.equal(toNumber('£250,000'), 250000);
    assert.equal(toNumber(' 5 '), 5);
    assert.equal(toNumber(''), null);
    assert.equal(toNumber(NaN), null);
    assert.equal(toNumber(undefined), null);
    assert.equal(toNumber({}), null);
  });
  test('monthsBetween', () => {
    assert.equal(monthsBetween('2026-08-06', '2026-11-06'), 3);
    assert.equal(monthsBetween('2026-11-06', '2026-08-06'), -3);
    assert.equal(monthsBetween('2026-01-31', '2026-02-28'), 1); // month end clamps
    assert.ok(Math.abs(monthsBetween('2026-01-01', '2026-01-16') - 15 / 31) < 1e-12);
    assert.equal(monthsBetween('06/08/2026', '2026-11-06'), 3);
    assert.equal(monthsBetween('', '2026-11-06'), null);
    assert.equal(monthsBetween('2026-02-31', '2026-11-06'), null);
  });
});

describe('quantum bands', () => {
  // subject 1000 sq ft; comp = 1000 * (1 - d/100) when smaller, 1000 * (1 + d/100) when larger
  const cases = [
    [9.99, 0], [10, 5], [19.99, 5], [20, 10], [29.99, 10], [30, 15], [39.99, 15], [40, 20],
    [49.99, 20], [50, 30], [80, 30],
  ];
  for (const [d, band] of cases) {
    test(`comp smaller by ${d}% gives +${band}%`, () => {
      const q = quantum(1000, 1000 - d * 10);
      assert.equal(q.diffPct, d);
      assert.equal(q.bandPct, band);
      assert.equal(q.adjPct, band);
      assert.equal(q.applied, band !== 0);
      assert.equal(q.flag, null);
    });
    test(`comp larger by ${d}% gives ${band === 0 ? '' : '-'}${band}%`, () => {
      const q = quantum(1000, 1000 + d * 10);
      assert.equal(q.diffPct, -d);
      assert.equal(q.bandPct, band);
      assert.equal(q.adjPct, band === 0 ? 0 : -band);
      assert.ok(!Object.is(q.adjPct, -0));
    });
  }
  test('awkward float boundary still bands at 20%', () => {
    // 1234 * 0.8 = 987.2: (1234 - 987.2) / 1234 * 100 is 19.999999... in floating point
    assert.equal(quantum(1234, 987.2).bandPct, 10);
    assert.equal(quantum(1234, 1234 * 1.1).bandPct, 5);
  });
  test('missing area', () => {
    for (const [s, c] of [[null, 900], [1000, null], ['', ''], [0, 900], [1000, 'n/a']]) {
      const q = quantum(s, c);
      assert.deepEqual(q, { diffPct: null, bandPct: 0, adjPct: 0, applied: false, flag: 'NO_FLOOR_AREA' });
    }
  });
  test('string areas accepted', () => assert.equal(quantum('1,000', '800').adjPct, 10));
  test('quantumOverride replaces band result', () => {
    const q = quantumFor(comp({ floorAreaSqFt: 900, quantumOverride: 2.5 }), 1000);
    assert.equal(q.adjPct, 2.5);
    assert.equal(q.bandAdjPct, 5);
    assert.equal(q.overridden, true);
    assert.equal(quantumFor(comp({ floorAreaSqFt: 900 }), 1000).overridden, false);
    // override also works with no area, and removes the NO_FLOOR_AREA flag
    const c = comp({ quantumOverride: -5 });
    assert.equal(quantumFor(c, 1000).adjPct, -5);
    assert.ok(!codes(flagsFor(c, baseState())).includes('NO_FLOOR_AREA'));
    assert.equal(adjustedValue(c, baseState()), 285000); // 300000 x 0.95
  });
});

describe('HPI', () => {
  test('exactly 3 months is not required; just over is', () => {
    const st = baseState();
    const at3 = hpi(comp({ saleDate: '2026-08-06', hpiAtSale: 140 }), st);
    assert.equal(at3.required, false);
    assert.equal(at3.applied, false);
    assert.equal(at3.factor, null);
    assert.equal(at3.adjustedPrice, 300000);
    const over = hpi(comp({ saleDate: '2026-08-05', hpiAtSale: 140 }), st);
    assert.equal(over.required, true);
    assert.equal(over.applied, true);
  });
  test('factor maths', () => {
    // 150 / 147 = 1.020408...; 300000 x 1.020408 = 306122.45 -> 306122
    const h = hpi(comp({ saleDate: '2026-05-01', hpiAtSale: 147 }), baseState());
    assert.ok(Math.abs(h.factor - 150 / 147) < 1e-12);
    assert.equal(h.adjustedPrice, 306122);
    assert.equal(h.flag, null);
    // string indices
    const h2 = hpi(comp({ saleDate: '2026-05-01', hpiAtSale: '120' }), baseState({ hpi: { valuationIndex: '132' } }));
    assert.ok(Math.abs(h2.factor - 1.1) < 1e-12);
    assert.equal(h2.adjustedPrice, 330000);
  });
  test('large HPI flag above 5% either way, not at exactly 5%', () => {
    const st = baseState({ hpi: { valuationIndex: 105 } });
    assert.equal(hpi(comp({ saleDate: '2026-01-01', hpiAtSale: 100 }), st).flag, null); // exactly +5%
    assert.equal(hpi(comp({ saleDate: '2026-01-01', hpiAtSale: 99.9 }), st).flag, 'LARGE_HPI');
    const st2 = baseState({ hpi: { valuationIndex: 94.9 } });
    assert.equal(hpi(comp({ saleDate: '2026-01-01', hpiAtSale: 100 }), st2).flag, 'LARGE_HPI');
    const f = flagsFor(comp({ saleDate: '2026-01-01', hpiAtSale: 99.9 }), st);
    assert.ok(codes(f).includes('LARGE_HPI'));
    assert.equal(f.find((x) => x.code === 'LARGE_HPI').label, 'Large HPI adjustment [SURVEYOR TO NOTE]');
  });
  test('missing indices when required', () => {
    const h = hpi(comp({ saleDate: '2026-01-01', hpiAtSale: null }), baseState());
    assert.deepEqual([h.required, h.factor, h.adjustedPrice, h.applied, h.flag], [true, null, 300000, false, 'HPI_MISSING']);
    const h2 = hpi(comp({ saleDate: '2026-01-01', hpiAtSale: 140 }), baseState({ hpi: { valuationIndex: '' } }));
    assert.equal(h2.flag, 'HPI_MISSING');
    const f = codes(flagsFor(comp({ saleDate: '2026-01-01' }), baseState()));
    assert.ok(f.includes('HPI_REQUIRED') && f.includes('HPI_MISSING'));
  });
  test('rentals never take HPI', () => {
    const r = comp({ id: 'r1', price: 1500, saleDate: '2025-01-01', hpiAtSale: 100 });
    const st = baseState({ rentals: [r] });
    assert.equal(hpi(r, st).required, false); // detected from state.rentals
    assert.equal(hpi(r, baseState(), { kind: 'rentals' }).required, false);
    assert.equal(hpi(r, baseState()).required, true); // treated as a sale when not in rentals
  });
  test('no state or no hpi block does not throw', () => {
    assert.equal(hpi(comp(), undefined).required, false);
    assert.equal(hpi({}, {}).adjustedPrice, null);
  });
});

describe('qualitative and adjusted value', () => {
  test('combined pct and gbp', () => {
    const c = comp({
      price: 250000, saleDate: '2026-10-01', floorAreaSqFt: 850, // 15% smaller -> +5%
      adjustments: {
        condition: { mode: 'pct', value: 3, note: 'dated' },
        kitchen: { mode: 'pct', value: '-1.5', note: '' },
        parking: { mode: 'gbp', value: 7500, note: 'no driveway' },
        garage: { mode: 'gbp', value: '-2,500', note: '' },
        gardens: { mode: 'pct', value: '', note: '' }, // ignored
        aspect: { mode: 'pct', value: 0, note: '' }, // ignored
        layout: null, // ignored
      },
    });
    const q = qualitative(c);
    assert.equal(q.pct, 1.5);
    assert.equal(q.gbp, 5000);
    assert.deepEqual(q.rows.map((r) => r.key), ['condition', 'kitchen', 'parking', 'garage']);
    assert.equal(q.rows[0].label, 'Condition');
    // 250000 x 1.05 x 1.015 + 5000 = 266437.5 + 5000 = 271437.5 -> 271438
    assert.equal(adjustedValue(c, baseState()), 271438);
  });
  test('missing price gives null, never NaN', () => {
    assert.equal(adjustedValue(comp({ price: '' }), baseState()), null);
    assert.equal(adjustedValue(comp({ price: null }), {}), null);
    assert.deepEqual(qualitative({}), { pct: 0, gbp: 0, rows: [] });
    assert.deepEqual(qualitative(null), { pct: 0, gbp: 0, rows: [] });
  });
});

describe('flags', () => {
  test('sale kinds, distance, missing data', () => {
    const st = baseState();
    assert.deepEqual(codes(flagsFor(comp({ saleKind: 'auction', floorAreaSqFt: 1000 }), st)), ['AUCTION']);
    assert.deepEqual(codes(flagsFor(comp({ saleKind: 'repossession', floorAreaSqFt: 1000 }), st)), ['REPOSSESSION']);
    assert.deepEqual(codes(flagsFor(comp({ saleKind: 'new-build', floorAreaSqFt: 1000 }), st)), ['NEW_BUILD']);
    assert.deepEqual(codes(flagsFor(comp({ distanceMiles: 0.5, floorAreaSqFt: 1000 }), st)), []);
    assert.deepEqual(codes(flagsFor(comp({ distanceMiles: '0.51', floorAreaSqFt: 1000 }), st)), ['OVER_HALF_MILE']);
    assert.deepEqual(codes(flagsFor(comp({ price: null, saleDate: '' }), st)), ['NO_FLOOR_AREA', 'MISSING_PRICE', 'MISSING_DATE']);
    assert.equal(flagsFor(comp(), st).find((f) => f.code === 'NO_FLOOR_AREA').label, 'No floor area: quantum adjustment not applied');
  });
  test('over 12 months', () => {
    const st = baseState();
    assert.ok(!codes(flagsFor(comp({ saleDate: '2025-11-06', hpiAtSale: 145 }), st)).includes('OVER_12_MONTHS'));
    const f = flagsFor(comp({ saleDate: '2025-11-05', hpiAtSale: 145 }), st);
    assert.ok(codes(f).includes('OVER_12_MONTHS'));
    assert.equal(f[0].label, 'Sale over 12 months before valuation date [SURVEYOR TO CHECK]');
  });
  test('short lease and lease lights at 79, 80, 99, 100', () => {
    assert.equal(leaseLight(79), 'red');
    assert.equal(leaseLight(79.9), 'red');
    assert.equal(leaseLight(80), 'amber');
    assert.equal(leaseLight(99), 'amber');
    assert.equal(leaseLight(100), 'green');
    assert.equal(leaseLight('125'), 'green');
    assert.equal(leaseLight(null), null);
    assert.equal(leaseLight(''), null);
    const st = baseState();
    assert.ok(codes(flagsFor(comp({ tenure: 'leasehold', unexpiredTerm: 79 }), st)).includes('SHORT_LEASE'));
    assert.ok(!codes(flagsFor(comp({ tenure: 'leasehold', unexpiredTerm: 80 }), st)).includes('SHORT_LEASE'));
    assert.ok(!codes(flagsFor(comp({ tenure: 'freehold', unexpiredTerm: 50 }), st)).includes('SHORT_LEASE'));
  });
  test('outlier at 15% from median', () => {
    const st = baseState();
    assert.ok(!codes(flagsFor(comp({ price: 345000 }), st, { median: 300000 })).includes('OUTLIER')); // exactly 15%
    assert.ok(codes(flagsFor(comp({ price: 345001 }), st, { median: 300000 })).includes('OUTLIER'));
    assert.ok(codes(flagsFor(comp({ price: 254999 }), st, { median: 300000 })).includes('OUTLIER'));
    assert.ok(!codes(flagsFor(comp({ price: 400000 }), st, {})).includes('OUTLIER'));
  });
  test('every flag label is house style with no dashes', () => {
    for (const [code, label] of Object.entries(FLAG_LABELS)) {
      assert.ok(/\[SURVEYOR TO (CHECK|NOTE)\]$/.test(label) || code === 'NO_FLOOR_AREA', code);
      assert.ok(!/[-–—]/.test(label), `${code} contains a dash`);
    }
  });
});

describe('evaluate', () => {
  // Worked example, hand checked. Valuation date 6 Nov 2026, subject 1000 sq ft, HPI at valuation 150.
  //
  // Comp 1: £300,000, sold 1 Sep 2026 (2.17 months, so no HPI). 900 sq ft: (1000 - 900) / 1000 = 10%
  //   smaller, band +5%. Condition +2%.  300,000 x 1.05 x 1.02 = 321,300.  Per sq ft 321,300 / 900 = 357.00.
  // Comp 2: £280,000, sold 15 Mar 2026 (7.7 months, HPI needed), HPI at sale 145, factor 150 / 145 =
  //   1.034483, HPI adjusted 289,655.17. Area 100 sq m = 1,076.4 sq ft: 7.64% larger, band 0%.
  //   Kitchen -3%, parking +£10,000.  289,655.17 x 0.97 + 10,000 = 280,965.52 + 10,000 = 290,965.52
  //   -> 290,966. Per sq ft 290,965.52 / 1,076.4 = 270.31.
  // Comp 3: £400,000, sold 20 Aug 2025 (14.5 months: over 12 months, HPI needed), HPI at sale 140,
  //   factor 1.071429 (over 5%: large HPI), HPI adjusted 428,571.43. 1300 sq ft: 30% larger, band -15%.
  //   Location -5%.  428,571.43 x 0.85 x 0.95 = 346,071.43 -> 346,071. Per sq ft 346,071.43 / 1300 = 266.21.
  // Median of HPI adjusted prices [289,655.17, 300,000, 428,571.43] = 300,000.
  //   Comp 3 is (428,571 - 300,000) / 300,000 = 42.9% away: OUTLIER. Comp 2 is 3.4% away: not.
  // Range: low 290,966 (comp 2), high 346,071 (comp 3). Per sq ft low 266.21, high 357.00.
  // Excluding comp 3: high becomes 321,300; median becomes (289,655.17 + 300,000) / 2 = 294,827.59.
  function worked() {
    return baseState({
      sales: [
        comp({ id: 'a', price: 300000, saleDate: '2026-09-01', floorAreaSqFt: 900, adjustments: { condition: { mode: 'pct', value: 2, note: 'tired' } } }),
        comp({ id: 'b', price: '280,000', saleDate: '2026-03-15', hpiAtSale: 145, floorAreaSqM: 100,
          adjustments: { kitchen: { mode: 'pct', value: -3, note: '' }, parking: { mode: 'gbp', value: 10000, note: 'no off street' } } }),
        comp({ id: 'c', price: 400000, saleDate: '2025-08-20', hpiAtSale: 140, floorAreaSqFt: 1300, adjustments: { location: { mode: 'pct', value: -5, note: '' } } }),
      ],
    });
  }
  test('full worked example', () => {
    const ev = evaluate(worked());
    const [a, b, c] = ev.sales;
    assert.deepEqual(ev.sales.map((r) => r.index), [1, 2, 3]);
    assert.equal(a.adjustedValue, 321300);
    assert.equal(a.perSqFt, 357);
    assert.equal(a.hpi.required, false);
    assert.equal(a.quantum.adjPct, 5);
    assert.deepEqual(codes(a.flags), []);
    assert.equal(b.hpi.adjustedPrice, 289655);
    assert.ok(Math.abs(b.hpi.factor - 1.0344827586) < 1e-9);
    assert.equal(b.quantum.diffPct, -7.64);
    assert.equal(b.quantum.adjPct, 0);
    assert.equal(b.qual.pct, -3);
    assert.equal(b.qual.gbp, 10000);
    assert.equal(b.adjustedValue, 290966);
    assert.equal(b.perSqFt, 270.31);
    assert.deepEqual(codes(b.flags), ['HPI_REQUIRED']);
    assert.equal(c.hpi.adjustedPrice, 428571);
    assert.equal(c.quantum.adjPct, -15);
    assert.equal(c.adjustedValue, 346071);
    assert.equal(c.perSqFt, 266.21);
    assert.deepEqual(codes(c.flags), ['OVER_12_MONTHS', 'HPI_REQUIRED', 'LARGE_HPI', 'OUTLIER']);
    assert.deepEqual(ev.salesRange, { low: 290966, high: 346071, count: 3, median: 300000, lowPerSqFt: 266.21, highPerSqFt: 357 });
    assert.equal(ev.subjectSqFt, 1000);
    assert.deepEqual(ev.warnings, []);
    // no single adopted value or average anywhere in the output
    const keys = JSON.stringify(ev).toLowerCase();
    assert.ok(!/adopted|average|mean|weighted/.test(keys));
  });
  test('excluded comps are out of the range but still shown', () => {
    const st = worked();
    st.sales[2].excluded = true;
    const ev = evaluate(st);
    assert.equal(ev.sales.length, 3);
    assert.equal(ev.sales[2].included, false);
    assert.equal(ev.sales[2].adjustedValue, 346071);
    assert.deepEqual([ev.salesRange.low, ev.salesRange.high, ev.salesRange.count], [290966, 321300, 2]);
    assert.equal(ev.salesRange.median, 294828);
    assert.ok(ev.warnings.some((w) => w.includes('Only 2 sales')));
  });
  test('quantum override shows on Result', () => {
    const st = worked();
    st.sales[0].quantumOverride = '0';
    const ev = evaluate(st);
    assert.equal(ev.sales[0].quantum.overridden, true);
    assert.equal(ev.sales[0].quantum.adjPct, 0);
    assert.equal(ev.sales[0].adjustedValue, 306000); // 300000 x 1.00 x 1.02
  });
  test('rentals: weekly conversion, quantum and qual applied, no HPI', () => {
    const st = baseState({
      matrixType: 'btl',
      rentals: [
        // 1500 pcm, 2 years old with an HPI index that must be ignored; 800 sq ft = 20% smaller -> +10%;
        // condition +2%, +£50 pcm. 1500 x 1.10 x 1.02 + 50 = 1683 + 50 = 1733 pcm; weekly 1733 x 12 / 52 = 399.92
        comp({ id: 'r1', price: 1500, saleDate: '2024-11-01', hpiAtSale: 100, floorAreaSqFt: 800,
          adjustments: { condition: { mode: 'pct', value: 2, note: '' }, parking: { mode: 'gbp', value: 50, note: '' } } }),
        // 1300 pcm, no area -> no quantum. weekly 1300 x 12 / 52 = 300
        comp({ id: 'r2', price: 1300, saleDate: '2026-10-01' }),
        comp({ id: 'r3', price: null, saleDate: '2026-10-01', floorAreaSqFt: 1000 }),
      ],
    });
    const ev = evaluate(st);
    const [r1, r2, r3] = ev.rentals;
    assert.equal(r1.hpi.required, false);
    assert.equal(r1.adjustedValue, 1733);
    assert.equal(r1.weekly, 399.92);
    assert.equal(r1.perSqFt, 2.17); // 1733 / 800 = 2.166
    assert.ok(!codes(r1.flags).some((c) => c.startsWith('HPI') || c === 'LARGE_HPI'));
    assert.ok(codes(r1.flags).includes('OVER_12_MONTHS'));
    assert.equal(r1.flags.find((f) => f.code === 'OVER_12_MONTHS').label, 'Let or listed over 12 months before valuation date [SURVEYOR TO CHECK]');
    assert.equal(r2.weekly, 300);
    assert.equal(r3.adjustedValue, null);
    assert.equal(r3.weekly, null);
    assert.equal(r3.included, false);
    assert.deepEqual(ev.rentalRange, { low: 1300, high: 1733, count: 2, median: 1400, lowWeekly: 300, highWeekly: 399.92 });
    // outlier for rentals uses unadjusted rents: median 1400, 1500 is 7.1% away: not an outlier
    assert.ok(!codes(r1.flags).includes('OUTLIER'));
  });
  test('lease light on results', () => {
    const st = baseState({ sales: [comp({ tenure: 'leasehold', unexpiredTerm: 85 }), comp({ tenure: 'freehold' })] });
    const ev = evaluate(st);
    assert.equal(ev.sales[0].leaseLight, 'amber');
    assert.equal(ev.sales[1].leaseLight, null);
  });
  test('partial and junk state never throws or returns NaN', () => {
    for (const s of [undefined, null, {}, { sales: null }, { sales: [null, {}, { price: 'abc' }], rentals: 'x', subject: null, hpi: null },
      { valuationDate: 'not a date', subject: { floorAreaSqM: '93' }, sales: [{ price: '£250,000', saleDate: '01/01/2026', hpiAtSale: '' }] }]) {
      const ev = evaluate(s);
      assert.ok(!JSON.stringify(ev).includes('NaN'));
      assert.ok(!/null|undefined/.test(JSON.stringify(ev.warnings)));
      assert.ok(!/[-–—]/.test(ev.warnings.join(' ')), 'warnings contain a dash');
      for (const r of ev.sales) assert.ok(r.adjustedValue === null || Number.isFinite(r.adjustedValue));
    }
    const ev = evaluate({ subject: { floorAreaSqM: '93' }, sales: [] });
    assert.equal(ev.subjectSqFt, 1001.1); // 93 x 10.764 = 1001.052
    assert.equal(ev.salesRange.low, null);
    assert.equal(ev.salesRange.count, 0);
    assert.ok(evaluate({}).warnings.some((w) => w.includes('No floor area')));
  });
});

// Integrator's hand check of the example case (ui-results buildExampleCase at valuation date
// 2026-11-06). Inputs are written out here so the check does not depend on the UI module.
// Subject 1,050 sq ft. Index at valuation date 141.2.
//
// Comparable 2, 8 Lime Walk: £448,000 sold 03/06/2026 (over 3 months), index at sale 139.5, 1,180 sq ft.
//   HPI factor        141.2 / 139.5 = 1.012186
//   HPI adjusted      448,000 x 141.2 / 139.5 = 453,459.50
//   Size              (1,050 minus 1,180) / 1,050 = minus 12.38%, band 10 to 20 = 5%, comp larger so minus 5%
//   Qualitative       condition minus 2% plus gardens 1% = minus 1%
//   Fully adjusted    453,459.50 x 0.95 x 0.99 = 426,478.66, so £426,479
//
// Comparable 6, 63 Meadgate Avenue: £421,000 sold 11/08/2025, index at sale 137.0, 1,075 sq ft.
//   HPI factor        141.2 / 137 = 1.030657
//   HPI adjusted      421,000 x 141.2 / 137 = 433,906.57
//   Size              (1,050 minus 1,075) / 1,050 = minus 2.38%, under 10% so no adjustment
//   Qualitative       EPC 1% and garage minus £10,000
//   Fully adjusted    433,906.57 x 1.01 minus 10,000 = 428,245.64, so £428,246 (this is Range High)
//
// Comparable 3, 41 Longstomps Avenue: £399,500, index 139.1, 985 sq ft, location 2%.
//   399,500 x 141.2 / 139.1 x 1.02 = 413,641.91, so £413,642 (this is Range Low)
describe('integrator hand check on the example case', () => {
  const comp = (o) => ({ id: o.address, address: o.address, propertyType: 'semi-detached', tenure: 'freehold', unexpiredTerm: null,
    bedrooms: 3, floorAreaSqM: null, distanceMiles: 0.3, source: 'Rightmove SCT', saleKind: 'standard', quantumOverride: null,
    excluded: false, notes: '', ...o });
  const pct = (value) => ({ mode: 'pct', value, note: 'x' });
  const state = {
    version: 1, valuationDate: '2026-11-06', matrixType: 'sales',
    subject: { floorAreaSqFt: 1050, floorAreaSqM: null, tenure: 'freehold' },
    hpi: { valuationIndex: 141.2, series: [] },
    sales: [
      comp({ address: '22 Gloucester Avenue', floorAreaSqFt: 1010, price: 415000, saleDate: '2026-09-14', hpiAtSale: null, adjustments: { kitchen: pct(3) } }),
      comp({ address: '8 Lime Walk', floorAreaSqFt: 1180, price: 448000, saleDate: '2026-06-03', hpiAtSale: 139.5, adjustments: { condition: pct(-2), gardens: pct(1) } }),
      comp({ address: '41 Longstomps Avenue', floorAreaSqFt: 985, price: 399500, saleDate: '2026-04-22', hpiAtSale: 139.1, adjustments: { location: pct(2) } }),
      comp({ address: '63 Meadgate Avenue', floorAreaSqFt: 1075, price: 421000, saleDate: '2025-08-11', hpiAtSale: 137, adjustments: { epc: pct(1), garage: { mode: 'gbp', value: -10000, note: 'x' } } }),
    ],
    rentals: [],
  };
  const ev = evaluate(state);
  const [, lime, longstomps, meadgate] = ev.sales;

  test('8 Lime Walk: HPI factor, quantum band, qualitative and fully adjusted value', () => {
    assert.ok(Math.abs(lime.hpi.factor - 1.012186) < 1e-6);
    assert.ok(Math.abs(lime.hpi.adjustedPrice - 453459.5) <= 1);
    assert.equal(lime.quantum.bandPct, 5);
    assert.equal(lime.quantum.adjPct, -5);
    assert.equal(lime.qual.pct, -1);
    assert.equal(lime.qual.gbp, 0);
    assert.equal(Math.round(lime.adjustedValue), 426479);
  });

  test('63 Meadgate Avenue: HPI factor, no quantum, % and £ qualitative, fully adjusted value', () => {
    assert.ok(Math.abs(meadgate.hpi.factor - 1.030657) < 1e-6);
    assert.ok(Math.abs(meadgate.hpi.adjustedPrice - 433906.57) <= 1);
    assert.equal(meadgate.quantum.adjPct, 0);
    assert.equal(meadgate.qual.pct, 1);
    assert.equal(meadgate.qual.gbp, -10000);
    assert.equal(Math.round(meadgate.adjustedValue), 428246);
  });

  test('range is the lowest and highest fully adjusted value, nothing in between', () => {
    assert.equal(Math.round(longstomps.adjustedValue), 413642);
    assert.equal(Math.round(ev.salesRange.low), 413642);
    assert.equal(Math.round(ev.salesRange.high), 428246);
    assert.equal(ev.salesRange.count, 4);
  });
});
