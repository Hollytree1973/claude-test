// Gibsons valuation comparison tool: pure maths engine (no DOM, runs under Node).
//
// Contract assumptions (ARCHITECTURE.md left these open; noted here for other agents):
// 1. Rentals: hpi(), adjustedValue() and flagsFor() take an optional extra argument
//    { kind: 'sales' | 'rentals' } (for flagsFor the kind goes in ctx). Without it the comp is
//    treated as a rental when it appears in state.rentals and not in state.sales.
// 2. hpi(): when HPI is not required, factor is null, applied is false and adjustedPrice = price.
//    The result also carries months (months from sale to valuation date, or null).
// 3. quantum(): bands are tested on |diffPct| at full precision; diffPct returned is rounded to
//    2 dp for display. A missing subject OR comparable area gives flag 'NO_FLOOR_AREA'.
//    flagsFor() only raises NO_FLOOR_AREA when the comparable itself has no area (and no
//    quantumOverride); a missing subject area is reported once in evaluate().warnings.
// 4. quantumOverride (a % that replaces the band result) is applied in adjustedValue() and
//    evaluate(). Result.quantum then has adjPct = override, bandAdjPct = band result,
//    applied true, overridden true. Otherwise overridden is false.
// 5. Money: hpi.adjustedPrice and adjustedValue are rounded to the nearest pound only at the
//    end (no rounding of intermediates). perSqFt and weekly are rounded to 2 dp.
// 6. Range median (salesRange.median / rentalRange.median) is the median of HPI adjusted
//    prices of included comps with a price. It exists for the outlier test only and must
//    never be presented as an adopted value.
// 7. Comparable floor area: floorAreaSqFt if present, else sqmToSqft(floorAreaSqM) (1 dp).
// 8. Lease light on a Result is only given for leasehold comparables (null for freehold).
import { CATEGORIES } from './model.js';

export const SQFT_PER_SQM = 10.764;
export const HPI_REQUIRED_MONTHS = 3;
export const OLD_SALE_MONTHS = 12;
export const LARGE_HPI_THRESHOLD = 0.05;
export const OUTLIER_THRESHOLD = 0.15;
export const MAX_DISTANCE_MILES = 0.5;
export const SHORT_LEASE_YEARS = 80;

export const FLAG_LABELS = Object.freeze({
  OVER_12_MONTHS: 'Sale over 12 months before valuation date [SURVEYOR TO CHECK]',
  HPI_REQUIRED: 'Sale over 3 months before valuation date: HPI adjustment required [SURVEYOR TO CHECK]',
  HPI_MISSING: 'HPI index missing: time adjustment not applied, surveyor to apply by hand [SURVEYOR TO CHECK]',
  LARGE_HPI: 'Large HPI adjustment [SURVEYOR TO NOTE]',
  AUCTION: 'Auction sale [SURVEYOR TO CHECK]',
  REPOSSESSION: 'Repossession sale [SURVEYOR TO CHECK]',
  NEW_BUILD: 'New build sale [SURVEYOR TO CHECK]',
  NO_FLOOR_AREA: 'No floor area: quantum adjustment not applied',
  OVER_HALF_MILE: 'More than 0.5 miles from the subject [SURVEYOR TO CHECK]',
  OUTLIER: 'More than 15% away from the median of the evidence [SURVEYOR TO CHECK]',
  SHORT_LEASE: 'Leasehold with under 80 years unexpired: marriage value applies [SURVEYOR TO CHECK]',
  MISSING_PRICE: 'No price recorded [SURVEYOR TO CHECK]',
  MISSING_DATE: 'No sale date recorded [SURVEYOR TO CHECK]',
});

// Wording tweaks so rental flags read naturally. Codes are unchanged.
const RENTAL_LABELS = {
  OVER_12_MONTHS: 'Let or listed over 12 months before valuation date [SURVEYOR TO CHECK]',
  MISSING_PRICE: 'No rent recorded [SURVEYOR TO CHECK]',
  MISSING_DATE: 'No date let or listed recorded [SURVEYOR TO CHECK]',
  AUCTION: 'Auction comparable [SURVEYOR TO CHECK]',
  REPOSSESSION: 'Repossession comparable [SURVEYOR TO CHECK]',
  NEW_BUILD: 'New build comparable [SURVEYOR TO CHECK]',
};

const FLAG_SEVERITY = { HPI_REQUIRED: 'info' }; // everything else is 'warn'
const FLAG_ORDER = Object.keys(FLAG_LABELS);

// ---------- defensive helpers ----------

/** Coerce numbers and number-like strings ('£250,000', ' 5 ', '7.5%') to a finite number, else null. */
export function toNumber(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x !== 'string') return null;
  const s = x.replace(/[£,\s%]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function positive(x) {
  const n = toNumber(x);
  return n !== null && n > 0 ? n : null;
}

function round(x, dp) {
  if (x === null || !Number.isFinite(x)) return null;
  const f = 10 ** dp;
  const r = Math.round((x + (x >= 0 ? Number.EPSILON : -Number.EPSILON)) * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

function parseDate(v) {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : { y: v.getFullYear(), m: v.getMonth() + 1, d: v.getDate() };
  }
  if (typeof v !== 'string') return null;
  const s = v.trim();
  let y, m, d, mt;
  if ((mt = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) { y = +mt[1]; m = +mt[2]; d = +mt[3]; }
  else if ((mt = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s))) { d = +mt[1]; m = +mt[2]; y = +mt[3]; }
  else if ((mt = /^(\d{4})-(\d{1,2})$/.exec(s))) { y = +mt[1]; m = +mt[2]; d = 1; }
  else return null;
  if (m < 1 || m > 12 || d < 1 || d > daysInMonth(y, m)) return null;
  return { y, m, d };
}

function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
function utc(p) { return Date.UTC(p.y, p.m - 1, p.d); }
function addMonths(p, n) {
  const total = p.y * 12 + (p.m - 1) + n;
  const y = Math.floor(total / 12), m = (total % 12) + 1;
  return { y, m, d: Math.min(p.d, daysInMonth(y, m)) };
}

// ---------- conversions ----------

export function sqftToSqm(x) {
  const n = toNumber(x);
  return n === null ? null : round(n / SQFT_PER_SQM, 1);
}

export function sqmToSqft(x) {
  const n = toNumber(x);
  return n === null ? null : round(n * SQFT_PER_SQM, 1);
}

/** Floor area in sq ft of a subject or comparable (sq ft field wins, else converted sq m). */
export function areaSqFt(obj) {
  if (!obj || typeof obj !== 'object') return null;
  const ft = positive(obj.floorAreaSqFt);
  if (ft !== null) return ft;
  const m = positive(obj.floorAreaSqM);
  return m === null ? null : sqmToSqft(m);
}

/** Whole plus fractional calendar months from isoA to isoB (B minus A). Null if either is invalid. */
export function monthsBetween(isoA, isoB) {
  const a = parseDate(isoA), b = parseDate(isoB);
  if (!a || !b) return null;
  if (utc(b) < utc(a)) { const r = monthsBetween(isoB, isoA); return r === null ? null : -r; }
  let whole = (b.y - a.y) * 12 + (b.m - a.m);
  while (whole > 0 && utc(addMonths(a, whole)) > utc(b)) whole -= 1;
  const start = utc(addMonths(a, whole));
  const next = utc(addMonths(a, whole + 1));
  return whole + (utc(b) - start) / (next - start);
}

// ---------- quantum ----------

export function quantum(subjectSqFt, compSqFt) {
  const s = positive(subjectSqFt), c = positive(compSqFt);
  if (s === null || c === null) {
    return { diffPct: null, bandPct: 0, adjPct: 0, applied: false, flag: 'NO_FLOOR_AREA' };
  }
  const raw = ((s - c) / s) * 100;
  const d = Math.round(Math.abs(raw) * 1e9) / 1e9; // strip float noise before banding
  let band;
  if (d < 10) band = 0;
  else if (d < 20) band = 5;
  else if (d < 30) band = 10;
  else if (d < 40) band = 15;
  else if (d < 50) band = 20;
  else band = 30;
  const adj = band === 0 ? 0 : Math.sign(raw) * band;
  return { diffPct: round(raw, 2), bandPct: band, adjPct: adj, applied: band !== 0, flag: null };
}

/** quantum() for a comparable, honouring comp.quantumOverride. */
export function quantumFor(comp, subjectSqFt) {
  const q = quantum(subjectSqFt, areaSqFt(comp));
  const ov = comp ? toNumber(comp.quantumOverride) : null;
  if (ov === null) return { ...q, bandAdjPct: q.adjPct, overridden: false };
  return { ...q, bandAdjPct: q.adjPct, adjPct: ov, applied: true, flag: null, overridden: true };
}

// ---------- HPI ----------

function kindOf(comp, state, kind) {
  if (kind === 'rentals' || kind === 'rental') return 'rentals';
  if (kind === 'sales' || kind === 'sale') return 'sales';
  const same = (x) => x === comp || (x && comp && x.id && x.id === comp.id);
  const inR = Array.isArray(state?.rentals) && state.rentals.some(same);
  const inS = Array.isArray(state?.sales) && state.sales.some(same);
  return inR && !inS ? 'rentals' : 'sales';
}

export function hpi(comp, state, opts = {}) {
  const price = toNumber(comp?.price);
  const kind = kindOf(comp, state, opts?.kind);
  const months = monthsBetween(comp?.saleDate, state?.valuationDate);
  const base = { required: false, factor: null, adjustedPrice: price === null ? null : round(price, 0), applied: false, flag: null, months };
  if (kind === 'rentals') return base;
  if (months === null || !(months > HPI_REQUIRED_MONTHS)) return base;
  const vi = positive(state?.hpi?.valuationIndex), si = positive(comp?.hpiAtSale);
  if (vi === null || si === null) return { ...base, required: true, flag: 'HPI_MISSING' };
  const factor = vi / si;
  const large = Math.abs(factor - 1) > LARGE_HPI_THRESHOLD + 1e-12;
  return {
    required: true, factor, applied: true, months,
    adjustedPrice: price === null ? null : round(price * factor, 0),
    flag: large ? 'LARGE_HPI' : null,
  };
}

function hpiExact(comp, h) {
  const price = toNumber(comp?.price);
  if (price === null) return null;
  return h.applied && h.factor !== null ? price * h.factor : price;
}

// ---------- qualitative ----------

export function qualitative(comp) {
  const adj = comp && typeof comp.adjustments === 'object' && comp.adjustments ? comp.adjustments : {};
  const known = new Set(CATEGORIES.map((c) => c.key));
  const keys = [...CATEGORIES.map((c) => c.key), ...Object.keys(adj).filter((k) => !known.has(k))];
  const labelOf = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));
  let pct = 0, gbp = 0;
  const rows = [];
  for (const key of keys) {
    const a = adj[key];
    if (!a || typeof a !== 'object') continue;
    const value = toNumber(a.value);
    const note = typeof a.note === 'string' ? a.note : '';
    if (value === null && !note.trim()) continue;
    const mode = a.mode === 'gbp' ? 'gbp' : 'pct';
    const v = value === null ? 0 : value;
    if (v === 0 && !note.trim()) continue;
    if (mode === 'gbp') gbp += v; else pct += v;
    rows.push({ key, label: labelOf[key] || key, mode, value: v, note });
  }
  return { pct: round(pct, 6), gbp: round(gbp, 2), rows };
}

// ---------- adjusted value ----------

function subjectArea(state) { return areaSqFt(state?.subject); }

function adjustedExact(comp, state, kind) {
  const h = hpi(comp, state, { kind });
  const base = hpiExact(comp, h);
  if (base === null) return null;
  const q = quantumFor(comp, subjectArea(state));
  const ql = qualitative(comp);
  const v = base * (1 + q.adjPct / 100) * (1 + ql.pct / 100) + ql.gbp;
  return Number.isFinite(v) ? v : null;
}

/** HPI adjusted x (1 + quantum%) x (1 + qual%) + qual £. Rentals skip HPI. Null if no price. */
export function adjustedValue(comp, state, opts = {}) {
  return round(adjustedExact(comp, state, kindOf(comp, state, opts?.kind)), 0);
}

// ---------- lease light ----------

export function leaseLight(years) {
  const n = toNumber(years);
  if (n === null || n < 0) return null;
  if (n >= 100) return 'green';
  if (n >= 80) return 'amber';
  return 'red';
}

// ---------- flags ----------

function flag(code, kind) {
  const label = (kind === 'rentals' && RENTAL_LABELS[code]) || FLAG_LABELS[code];
  return { code, label, severity: FLAG_SEVERITY[code] || 'warn' };
}

export function flagsFor(comp, state, ctx = {}) {
  const kind = kindOf(comp, state, ctx?.kind);
  const codes = new Set();
  const price = toNumber(comp?.price);
  const months = monthsBetween(comp?.saleDate, state?.valuationDate);
  if (price === null) codes.add('MISSING_PRICE');
  if (!parseDate(comp?.saleDate)) codes.add('MISSING_DATE');
  if (months !== null && months > OLD_SALE_MONTHS) codes.add('OVER_12_MONTHS');
  const h = hpi(comp, state, { kind });
  if (h.required) codes.add('HPI_REQUIRED');
  if (h.flag) codes.add(h.flag);
  if (comp?.saleKind === 'auction') codes.add('AUCTION');
  if (comp?.saleKind === 'repossession') codes.add('REPOSSESSION');
  if (comp?.saleKind === 'new-build') codes.add('NEW_BUILD');
  if (areaSqFt(comp) === null && toNumber(comp?.quantumOverride) === null) codes.add('NO_FLOOR_AREA');
  const dist = toNumber(comp?.distanceMiles);
  if (dist !== null && dist > MAX_DISTANCE_MILES) codes.add('OVER_HALF_MILE');
  const median = positive(ctx?.median);
  const hp = hpiExact(comp, h);
  if (median !== null && hp !== null && Math.abs(hp - median) / median > OUTLIER_THRESHOLD + 1e-12) codes.add('OUTLIER');
  const term = toNumber(comp?.unexpiredTerm);
  if (comp?.tenure === 'leasehold' && term !== null && term < SHORT_LEASE_YEARS) codes.add('SHORT_LEASE');
  return FLAG_ORDER.filter((c) => codes.has(c)).map((c) => flag(c, kind));
}

// ---------- evaluate ----------

function median(values) {
  const v = values.filter((x) => x !== null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

function minMax(values) {
  const v = values.filter((x) => x !== null && Number.isFinite(x));
  return v.length ? { min: Math.min(...v), max: Math.max(...v) } : { min: null, max: null };
}

function evaluateList(list, state, kind) {
  const comps = Array.isArray(list) ? list.filter((c) => c && typeof c === 'object') : [];
  const sArea = subjectArea(state);
  const med = median(comps.filter((c) => !c.excluded).map((c) => hpiExact(c, hpi(c, state, { kind }))));
  const results = comps.map((c, i) => {
    const h = hpi(c, state, { kind });
    const exact = adjustedExact(c, state, kind);
    const area = areaSqFt(c);
    const value = round(exact, 0);
    const isLease = c.tenure === 'leasehold';
    const r = {
      id: c.id ?? null,
      index: i + 1,
      hpi: h,
      quantum: quantumFor(c, sArea),
      qual: qualitative(c),
      adjustedValue: value,
      perSqFt: exact !== null && area !== null ? round(exact / area, 2) : null,
      weekly: null,
      flags: flagsFor(c, state, { median: med, kind }),
      included: !c.excluded && value !== null,
      leaseLight: isLease ? leaseLight(c.unexpiredTerm) : null,
    };
    if (kind === 'rentals') r.weekly = exact === null ? null : round((exact * 12) / 52, 2);
    return r;
  });
  const inc = results.filter((r) => r.included);
  const v = minMax(inc.map((r) => r.adjustedValue));
  const p = minMax(inc.map((r) => r.perSqFt));
  return { results, range: { low: v.min, high: v.max, count: inc.length, median: med === null ? null : round(med, 0), lowPerSqFt: p.min, highPerSqFt: p.max } };
}

export function evaluate(state) {
  const s = state && typeof state === 'object' ? state : {};
  const sales = evaluateList(s.sales, s, 'sales');
  const rent = evaluateList(s.rentals, s, 'rentals');
  const weekly = (x) => (x === null ? null : round((x * 12) / 52, 2));
  const rentalRange = {
    low: rent.range.low, high: rent.range.high, count: rent.range.count, median: rent.range.median,
    lowWeekly: weekly(rent.range.low), highWeekly: weekly(rent.range.high),
  };
  const salesRange = { ...sales.range };
  const subjectSqFt = subjectArea(s);

  const warnings = [];
  const matrix = s.matrixType || 'sales';
  const wantSales = matrix !== 'rental', wantRent = matrix === 'btl' || matrix === 'rental';
  if (!parseDate(s.valuationDate)) warnings.push('No valuation date entered, so time (HPI) adjustments and date checks cannot be worked out.');
  if (subjectSqFt === null) warnings.push('No floor area entered for the subject property, so no quantum (size) adjustments have been applied.');
  const missingHpi = sales.results.filter((r) => r.hpi.flag === 'HPI_MISSING').length;
  if (missingHpi) warnings.push(`${missingHpi} sales comparable${missingHpi === 1 ? ' needs' : 's need'} an HPI index before the time adjustment can be applied.`);
  if (wantSales && salesRange.count < 3) warnings.push(`Only ${salesRange.count} sales comparable${salesRange.count === 1 ? '' : 's'} included in the range. At least 3 are normally expected.`);
  if (wantRent && rentalRange.count < 3) warnings.push(`Only ${rentalRange.count} rental comparable${rentalRange.count === 1 ? '' : 's'} included in the range. At least 3 are normally expected.`);

  return { sales: sales.results, rentals: rent.results, salesRange, rentalRange, subjectSqFt, warnings };
}
