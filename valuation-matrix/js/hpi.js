// UK House Price Index (HPI) data: region list, fetch from HM Land Registry, paste parsing,
// index lookup and applying a series to a case draft. Pure module (no DOM); runs under Node.
//
// Contract notes and assumptions (ARCHITECTURE.md left these open):
// 1. Route chosen for fetchSeries: the HM Land Registry linked data API list endpoint
//      https://landregistry.data.gov.uk/data/ukhpi/region/<slug>.json
//        ?_properties=refMonth,housePriceIndex&_sort=refMonth&min-refMonth=YYYY-MM&max-refMonth=YYYY-MM&_pageSize=200
//    It returns the all property types housePriceIndex per month (verified November 2026: Chelmsford
//    August 2026 = 98.3). The sandbox this was built in could not see response headers, so browser
//    CORS support is not confirmed. Any network or CORS failure throws an Error with a friendly
//    message (err.code = 'NETWORK') and the panel offers the paste route instead.
// 2. indexFor(series, isoDate) returns a number (or null). indexEntryFor() returns the month that
//    was used as well, so the panel can say which month was taken when the valuation month has not
//    yet been published (HPI is published about two months in arrears).
// 3. applySeries(draft, series, { force }) also stores the series on draft.hpi.series when a
//    series is passed, and returns a small summary object. Without force it only fills
//    valuationIndex and hpiAtSale where they are null (hand entered figures win).
// 4. parseSeriesCsv(text, { region }) accepts an optional region filter for multi area files such
//    as the Land Registry full file. Without it a multi area file throws a friendly Error.
// 5. Region labels avoid hyphens (for example 'Southend on Sea') because they appear in prose.

const BASE = 'https://landregistry.data.gov.uk';

const ESSEX = [
  ['basildon', 'Basildon'], ['braintree', 'Braintree'], ['brentwood', 'Brentwood'],
  ['castle-point', 'Castle Point'], ['chelmsford', 'Chelmsford'], ['colchester', 'Colchester'],
  ['epping-forest', 'Epping Forest'], ['harlow', 'Harlow'], ['maldon', 'Maldon'],
  ['rochford', 'Rochford'], ['tendring', 'Tendring'], ['uttlesford', 'Uttlesford'],
  ['southend-on-sea', 'Southend on Sea'], ['thurrock', 'Thurrock'],
];
const LONDON = [
  ['barking-and-dagenham', 'Barking and Dagenham'], ['barnet', 'Barnet'], ['bexley', 'Bexley'],
  ['brent', 'Brent'], ['bromley', 'Bromley'], ['camden', 'Camden'], ['city-of-london', 'City of London'],
  ['croydon', 'Croydon'], ['ealing', 'Ealing'], ['enfield', 'Enfield'], ['greenwich', 'Greenwich'],
  ['hackney', 'Hackney'], ['hammersmith-and-fulham', 'Hammersmith and Fulham'], ['haringey', 'Haringey'],
  ['harrow', 'Harrow'], ['havering', 'Havering'], ['hillingdon', 'Hillingdon'], ['hounslow', 'Hounslow'],
  ['islington', 'Islington'], ['kensington-and-chelsea', 'Kensington and Chelsea'],
  ['kingston-upon-thames', 'Kingston upon Thames'], ['lambeth', 'Lambeth'], ['lewisham', 'Lewisham'],
  ['merton', 'Merton'], ['newham', 'Newham'], ['redbridge', 'Redbridge'],
  ['richmond-upon-thames', 'Richmond upon Thames'], ['southwark', 'Southwark'], ['sutton', 'Sutton'],
  ['tower-hamlets', 'Tower Hamlets'], ['waltham-forest', 'Waltham Forest'], ['wandsworth', 'Wandsworth'],
  ['city-of-westminster', 'Westminster'],
];
const HERTS = [
  ['broxbourne', 'Broxbourne'], ['dacorum', 'Dacorum'], ['east-hertfordshire', 'East Hertfordshire'],
  ['hertsmere', 'Hertsmere'], ['north-hertfordshire', 'North Hertfordshire'], ['st-albans', 'St Albans'],
  ['stevenage', 'Stevenage'], ['three-rivers', 'Three Rivers'], ['watford', 'Watford'],
  ['welwyn-hatfield', 'Welwyn Hatfield'],
];
const WIDER = [
  ['east-of-england', 'East of England'], ['london', 'London'], ['england', 'England'],
  ['united-kingdom', 'United Kingdom'],
];

export const REGION_GROUPS = ['Essex', 'London boroughs', 'Hertfordshire', 'Wider areas'];

export const REGIONS = Object.freeze([
  ...ESSEX.map(([slug, label]) => ({ slug, label, group: 'Essex' })),
  ...LONDON.map(([slug, label]) => ({ slug, label, group: 'London boroughs' })),
  ...HERTS.map(([slug, label]) => ({ slug, label, group: 'Hertfordshire' })),
  ...WIDER.map(([slug, label]) => ({ slug, label, group: 'Wider areas' })),
].map(Object.freeze));

export function regionBySlug(slug) {
  return REGIONS.find((r) => r.slug === slug) || null;
}

export function regionUri(slug) { return `http://landregistry.data.gov.uk/id/region/${slug}`; }

// Link to the official UKHPI browse page for a region, so the valuer can download the CSV.
export function browseUrl(slug, fromMonth, toMonth) {
  const p = new URLSearchParams();
  p.set('location', regionUri(slug));
  if (fromMonth) p.set('from', `${fromMonth}-01`);
  if (toMonth) p.set('to', `${toMonth}-01`);
  p.set('lang', 'en');
  return `${BASE}/app/ukhpi/browse?${p.toString()}`;
}

// ---------- postcode and parking area suggestions ----------

const OUTWARD = {
  chelmsford: ['CM1', 'CM2'], maldon: ['CM9'], braintree: ['CM7', 'CM77'],
  brentwood: ['CM13', 'CM14', 'CM15'], basildon: ['SS13', 'SS14', 'SS15', 'SS16', 'CM11', 'CM12'],
  'castle-point': ['SS7', 'SS8'], rochford: ['SS4', 'SS5'],
  'southend-on-sea': ['SS0', 'SS1', 'SS2', 'SS3', 'SS9'],
  thurrock: ['RM15', 'RM16', 'RM17', 'RM18', 'RM19', 'RM20', 'SS17'],
  colchester: ['CO1', 'CO2', 'CO3', 'CO4'], tendring: ['CO12', 'CO13', 'CO14', 'CO15', 'CO16'],
  harlow: ['CM18', 'CM19', 'CM20'], 'epping-forest': ['IG10', 'CM16'], uttlesford: ['CB10', 'CB11', 'CM6'],
  'tower-hamlets': ['E1W', 'E3', 'E14'], hackney: ['E8', 'E9'], newham: ['E13', 'E15'],
  greenwich: ['SE10', 'SE18', 'SE28'], lewisham: ['SE13', 'SE4', 'SE6'], wandsworth: ['SW11', 'SW18'],
  camden: ['NW1', 'NW3', 'NW5'], 'city-of-westminster': ['W1', 'W2', 'SW1'],
  'city-of-london': ['EC2', 'EC3', 'EC4'], enfield: ['EN1', 'EN2', 'EN3'],
  havering: ['RM1', 'RM2', 'RM3', 'RM11', 'RM12', 'RM14'], 'barking-and-dagenham': ['RM8', 'RM9', 'RM10'],
  redbridge: ['IG1', 'IG2', 'IG3', 'IG4', 'IG5'], bexley: ['DA5', 'DA6', 'DA7'], bromley: ['BR1', 'BR2'],
  croydon: ['CR0'], sutton: ['SM1', 'SM2'], 'kingston-upon-thames': ['KT1', 'KT2'],
  'richmond-upon-thames': ['TW9', 'TW10'], hillingdon: ['UB8', 'UB10'], hounslow: ['TW3', 'TW4'],
  harrow: ['HA1', 'HA2', 'HA3'], 'waltham-forest': ['E17', 'E4'], haringey: ['N8', 'N15', 'N17'],
  islington: ['N7', 'N19'], barnet: ['EN4', 'EN5', 'NW4', 'NW7'], ealing: ['W5', 'W13'],
  'st-albans': ['AL1', 'AL2', 'AL3', 'AL4'], 'welwyn-hatfield': ['AL7', 'AL8', 'AL9', 'AL10'],
  dacorum: ['HP1', 'HP2', 'HP3'], stevenage: ['SG1', 'SG2'], 'north-hertfordshire': ['SG4', 'SG5', 'SG6'],
  'east-hertfordshire': ['SG12', 'SG13', 'SG14', 'CM21', 'CM23'],
  watford: ['WD17', 'WD18', 'WD19', 'WD24', 'WD25'], 'three-rivers': ['WD3'],
  hertsmere: ['WD6', 'EN6'], broxbourne: ['EN7', 'EN8', 'EN10', 'EN11'],
};
const OUTWARD_INDEX = new Map();
for (const [slug, codes] of Object.entries(OUTWARD)) for (const c of codes) OUTWARD_INDEX.set(c, slug);
const LONDON_AREAS = new Set(['E', 'EC', 'N', 'NW', 'SE', 'SW', 'W', 'WC']);

export function outwardCode(postcode) {
  const s = String(postcode || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
  if (!s) return '';
  const m = s.match(/^([A-Z]{1,2}\d[A-Z\d]?)(?:\s*\d[A-Z]{2})?$/);
  return m ? m[1] : '';
}

// Suggests a region for a subject postcode (only when the district is clear). Returns
// { slug, label, reason } or null.
export function suggestRegionForPostcode(postcode) {
  const out = outwardCode(postcode);
  if (!out) return null;
  let slug = OUTWARD_INDEX.get(out);
  if (!slug && /^(W1|SW1|EC\d|WC\d)[A-Z]$/.test(out)) slug = OUTWARD_INDEX.get(out.slice(0, -1));
  if (!slug && /^EC\d/.test(out)) slug = OUTWARD_INDEX.get(out.slice(0, 3));
  if (slug) {
    const r = regionBySlug(slug);
    return r ? { slug: r.slug, label: r.label, reason: `postcode district ${out}` } : null;
  }
  const area = out.match(/^[A-Z]+/)[0];
  if (LONDON_AREAS.has(area)) return { slug: 'london', label: 'London', reason: `London postcode ${out}` };
  return null;
}

function norm(s) { return String(s || '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, ' ').trim(); }

// Suggests a region from a parking area key or label (parking-data.js) when it names a borough
// or district. Returns { slug, label, reason } or null.
export function suggestRegionForArea(areaKeyOrLabel) {
  const n = norm(areaKeyOrLabel);
  if (!n) return null;
  const stripped = n.replace(/\b(london borough of|royal borough of|borough|district|council|city of)\b/g, ' ').replace(/\s+/g, ' ').trim();
  for (const r of REGIONS) {
    if (r.group === 'Wider areas') continue;
    const cands = [norm(r.slug), norm(r.label)];
    if (cands.includes(n) || cands.includes(stripped)) return { slug: r.slug, label: r.label, reason: 'parking area' };
  }
  return null;
}

// ---------- month helpers ----------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function pad2(n) { return String(n).padStart(2, '0'); }
function ym(y, m) {
  y = Number(y); m = Number(m);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12 || y < 1900 || y > 2200) return null;
  return `${y}-${pad2(m)}`;
}
function fullYear(y) { const n = Number(y); return String(y).length === 2 ? (n >= 70 ? 1900 + n : 2000 + n) : n; }
function monthFromName(name) {
  const k = String(name).toLowerCase().slice(0, 3);
  const i = MONTHS.indexOf(k === 'sept' ? 'sep' : k);
  return i < 0 ? null : i + 1;
}

// Parses many month formats into 'YYYY-MM'; null when not a month.
export function parseMonth(input) {
  if (input === null || input === undefined) return null;
  let s = String(input).trim().replace(/^["']|["']$/g, '').trim();
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.](\d{1,2}))?(?:[T\s].*)?$/))) return ym(m[1], m[2]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})(?:\s.*)?$/))) return ym(m[3], m[2]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{4})$/))) return ym(m[2], m[1]);
  if ((m = s.match(/^(\d{4})\s*M(\d{1,2})$/i))) return ym(m[1], m[2]);
  if ((m = s.match(/^(\d{4})(\d{2})$/))) return ym(m[1], m[2]);
  if ((m = s.match(/^(?:\d{1,2}(?:st|nd|rd|th)?\s+)?([A-Za-z]{3,9})\.?[\s\-,'/]*(\d{4}|\d{2})$/))) {
    const mo = monthFromName(m[1]);
    if (mo && (m[1].length === 3 || MONTH_NAMES.some((n) => n.toLowerCase().startsWith(m[1].toLowerCase())))) return ym(fullYear(m[2]), mo);
  }
  if ((m = s.match(/^(\d{4})[\s\-,]*([A-Za-z]{3,9})$/))) {
    const mo = monthFromName(m[2]);
    if (mo) return ym(m[1], mo);
  }
  return null;
}

export function monthOf(isoDate) { return parseMonth(String(isoDate || '').slice(0, 10)); }

export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${pad2((t % 12) + 1)}`;
}

export function monthDiff(a, b) { // b minus a, whole months
  const [ya, ma] = a.split('-').map(Number), [yb, mb] = b.split('-').map(Number);
  return (yb * 12 + mb) - (ya * 12 + ma);
}

export function formatMonth(month, long = false) {
  if (!month) return '';
  const [y, m] = month.split('-').map(Number);
  const name = MONTH_NAMES[m - 1];
  return `${long ? name : name.slice(0, 3)} ${y}`;
}

// ---------- series helpers ----------

export function normaliseSeries(series) {
  const map = new Map();
  for (const row of Array.isArray(series) ? series : []) {
    const month = parseMonth(row?.month);
    const index = Number(row?.index);
    if (month && Number.isFinite(index) && index > 0) map.set(month, index);
  }
  return [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([month, index]) => ({ month, index }));
}

export function latestMonth(series) {
  const s = normaliseSeries(series);
  return s.length ? s[s.length - 1].month : null;
}

// { month, index, exact, lagMonths } for the nearest month at or before isoDate, or null.
export function indexEntryFor(series, isoDate) {
  const target = parseMonth(String(isoDate || '').slice(0, 10)) || parseMonth(isoDate);
  if (!target) return null;
  const s = normaliseSeries(series);
  let hit = null;
  for (const row of s) { if (row.month <= target) hit = row; else break; }
  if (!hit) return null;
  return { month: hit.month, index: hit.index, exact: hit.month === target, lagMonths: monthDiff(hit.month, target) };
}

export function indexFor(series, isoDate) {
  const e = indexEntryFor(series, isoDate);
  return e ? e.index : null;
}

// Mutates a draft state. Fills hpi.valuationIndex and each sales comparable's hpiAtSale from the
// series, only where currently null unless opts.force. Rentals are never touched (no HPI).
export function applySeries(state, series, opts = {}) {
  const force = !!opts.force;
  const s = normaliseSeries(series ?? state?.hpi?.series);
  const summary = { valuationIndex: null, valuationMonth: null, latestMonth: s.length ? s[s.length - 1].month : null, filled: 0, unchanged: 0, noMatch: 0 };
  if (!state) return summary;
  if (!state.hpi) state.hpi = { regionSlug: '', regionLabel: '', series: [], valuationIndex: null, source: '' };
  if (series !== undefined && series !== null) state.hpi.series = s;
  if (!s.length) return summary;
  const v = indexEntryFor(s, state.valuationDate);
  if (v) {
    summary.valuationMonth = v.month;
    if (force || state.hpi.valuationIndex === null || state.hpi.valuationIndex === undefined || state.hpi.valuationIndex === '') {
      state.hpi.valuationIndex = v.index;
    }
  }
  summary.valuationIndex = state.hpi.valuationIndex ?? null;
  for (const comp of Array.isArray(state.sales) ? state.sales : []) {
    const has = comp.hpiAtSale !== null && comp.hpiAtSale !== undefined && comp.hpiAtSale !== '';
    if (has && !force) { summary.unchanged += 1; continue; }
    const e = comp.saleDate ? indexEntryFor(s, comp.saleDate) : null;
    if (e) { comp.hpiAtSale = e.index; summary.filled += 1; } else { summary.noMatch += 1; }
  }
  return summary;
}

// ---------- CSV and paste parsing ----------

function detectDelimiter(lines) {
  const sample = lines.slice(0, 40);
  const score = (d) => sample.reduce((n, l) => n + (splitLine(l, d).length > 1 ? 1 : 0), 0);
  const cands = ['\t', ',', ';', '|'];
  let best = null, bestScore = 0;
  for (const d of cands) { const sc = score(d); if (sc > bestScore) { best = d; bestScore = sc; } }
  return best;
}

function splitLine(line, d) {
  if (!d) return [line];
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === d) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function parseNumber(cell) {
  if (cell === null || cell === undefined) return null;
  const s = String(cell).trim().replace(/^["']|["']$/g, '').replace(/[£,\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  return Number(s);
}

// "Mar 2026 152.3", "2026-03 = 152.3", "March 2026: 152.3"
function splitLoose(line) {
  const m = String(line).trim().match(/^(.*?\S)[\s,;:=|]+(?:£)?(\d+(?:\.\d+)?)\s*$/);
  return m ? [m[1].trim(), m[2]] : [String(line).trim()];
}

function headerScore(h) {
  const s = norm(h);
  if (!s) return -1;
  if (/(change|volume|average|sales|price(?! index))/.test(s) && !/price index/.test(s)) return -1;
  let sc = 0;
  if (s === 'index' || s === 'hpi' || s === 'housepriceindex' || s === 'house price index') sc = 10;
  else if (/house price index|housepriceindex|\bhpi\b|\bindex\b/.test(s)) sc = 5;
  else return -1;
  if (/all property|all types|all dwellings|all/.test(s)) sc += 4;
  if (/detached|semi|terrace|flat|maisonette|cash|mortgage|first time|former owner|new build|existing|seasonal|\bsa\b|indexsa/.test(s.replace(/\s/g, ' ')) || /indexsa/.test(String(h).toLowerCase())) sc -= 8;
  return sc;
}

const REGION_HEADER = /^(region ?name|name|area|area name|region|location|geography)$/;

// Accepts the UKHPI app download CSV, the Land Registry full file, ONS style CSV (metadata rows
// then "2025 JAN","152.3"), tab separated cells pasted from a spreadsheet, and simple lines such as
// "2026-03,152.3" or "Mar 2026, 152.3". Returns [{ month, index }] sorted by month.
export function parseSeriesCsv(text, opts = {}) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r\n|\n|\r/).map((l) => l.trim()).filter((l) => l.length);
  if (!lines.length) return [];
  const d = detectDelimiter(lines);
  let rows = lines.map((l) => splitLine(l, d)).map((cells) => (cells.length === 1 ? splitLoose(cells[0]) : cells));
  rows = rows.map((r) => (r.length > 1 && r.every((c) => c === '') ? [] : r)).filter((r) => r.length);

  // month column: the one where most rows hold a month
  const width = Math.max(...rows.map((r) => r.length));
  let monthCol = -1, monthCount = 0;
  for (let j = 0; j < width; j++) {
    const n = rows.reduce((k, r) => k + (parseMonth(r[j]) ? 1 : 0), 0);
    if (n > monthCount) { monthCount = n; monthCol = j; }
  }
  if (monthCol < 0) return [];

  const firstData = rows.findIndex((r) => parseMonth(r[monthCol]) && r.some((c, j) => j !== monthCol && parseNumber(c) !== null));
  if (firstData < 0) return [];
  let header = null;
  for (let i = firstData - 1; i >= 0; i--) {
    if (rows[i].length >= 2 && rows[i].some((c) => /[a-z]/i.test(c))) { header = rows[i]; break; }
  }
  const data = rows.slice(firstData).filter((r) => parseMonth(r[monthCol]));

  // index column
  let indexCol = -1;
  if (header) {
    let best = 0;
    header.forEach((h, j) => { if (j === monthCol) return; const sc = headerScore(h); if (sc > best) { best = sc; indexCol = j; } });
  }
  if (indexCol < 0) {
    let bestN = 0;
    for (let j = 0; j < width; j++) {
      if (j === monthCol) continue;
      const nums = data.map((r) => parseNumber(r[j])).filter((v) => v !== null);
      if (!nums.length) continue;
      const plausible = nums.filter((v) => v > 0 && v < 2000).length;
      if (plausible > bestN) { bestN = plausible; indexCol = j; }
    }
  }
  if (indexCol < 0) return [];

  // multi area files
  let rows2 = data;
  if (header) {
    const rc = header.findIndex((h, j) => j !== monthCol && j !== indexCol && REGION_HEADER.test(norm(h)));
    if (rc >= 0) {
      const names = [...new Set(data.map((r) => r[rc]).filter(Boolean))];
      if (names.length > 1) {
        const want = opts.region ? norm(opts.region) : '';
        const wantLabel = opts.region ? norm(regionBySlug(opts.region)?.label || opts.region) : '';
        const match = names.find((n) => { const x = norm(n); return want && (x === want || x === wantLabel || x.replace(/ /g, '-') === opts.region); });
        if (!match) {
          const err = new Error(`This file holds figures for ${names.length} different areas. Choose the area in the region list first, or paste the figures for one area only.`);
          err.code = 'MULTI_REGION';
          err.regions = names;
          throw err;
        }
        rows2 = data.filter((r) => r[rc] === match);
      }
    }
  }

  return normaliseSeries(rows2.map((r) => ({ month: parseMonth(r[monthCol]), index: parseNumber(r[indexCol]) })));
}

// ---------- fetch ----------

function friendly(message, code, cause) {
  const e = new Error(message);
  e.code = code;
  if (cause) e.cause = cause;
  return e;
}

// Fetches the all property types monthly index for a region from HM Land Registry.
// fromMonth and toMonth are 'YYYY-MM' (inclusive). Resolves to [{ month, index }] sorted by month,
// or throws an Error whose message is safe to show to the user.
export async function fetchSeries(slug, fromMonth, toMonth, opts = {}) {
  const fetchFn = opts.fetch || (typeof fetch === 'function' ? fetch.bind(globalThis) : null);
  if (!slug) throw friendly('Choose an area in the region list before fetching index figures.', 'NO_REGION');
  if (!fetchFn) throw friendly('This browser cannot fetch data. Paste the index figures instead.', 'NETWORK');
  const from = parseMonth(fromMonth), to = parseMonth(toMonth);
  const params = new URLSearchParams({ _properties: 'refMonth,housePriceIndex', _sort: 'refMonth', _pageSize: '200' });
  if (from) params.set('min-refMonth', from);
  if (to) params.set('max-refMonth', to);
  let url = `${BASE}/data/ukhpi/region/${encodeURIComponent(slug)}.json?${params.toString()}`;
  const label = regionBySlug(slug)?.label || slug;
  const timeoutMs = opts.timeoutMs ?? 20000;
  const out = [];
  for (let page = 0; url && page < 20; page++) {
    const ctl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    let res, body;
    try {
      res = await fetchFn(url, { headers: { Accept: 'application/json' }, signal: ctl?.signal, mode: 'cors' });
    } catch (err) {
      if (timer) clearTimeout(timer);
      if (err?.name === 'AbortError') throw friendly('HM Land Registry took too long to answer. Try again in a moment, or paste the index figures instead.', 'TIMEOUT', err);
      throw friendly('Could not reach HM Land Registry from this browser. This is usually because the site blocks direct requests from other web pages or you are offline. Use the link below to download the figures and paste them in instead.', 'NETWORK', err);
    }
    try {
      if (res.status === 404) throw friendly(`HM Land Registry has no index figures for ${label}. Check the region, or paste the figures instead.`, 'NOT_FOUND');
      if (!res.ok) throw friendly(`HM Land Registry answered with an error (status ${res.status}). Try again later, or paste the index figures instead.`, 'HTTP');
      body = await res.json();
    } catch (err) {
      if (timer) clearTimeout(timer);
      if (err?.code) throw err;
      throw friendly('HM Land Registry sent data this tool could not read. Paste the index figures instead.', 'BAD_DATA', err);
    }
    if (timer) clearTimeout(timer);
    const items = body?.result?.items ?? (body?.result?.primaryTopic ? [body.result.primaryTopic] : []);
    for (const it of items) {
      const month = parseMonth(it?.refMonth?._value ?? it?.refMonth);
      const raw = it?.housePriceIndex;
      const index = Number(Array.isArray(raw) ? raw[0] : (raw?._value ?? raw));
      if (month && Number.isFinite(index) && index > 0) out.push({ month, index });
    }
    const next = body?.result?.next;
    url = items.length && next && next !== url ? String(next) : null;
  }
  const series = normaliseSeries(out);
  if (!series.length) throw friendly(`No index figures were found for ${label} in that period. HPI is published about two months behind, so very recent months may not be out yet.`, 'EMPTY');
  return series;
}
