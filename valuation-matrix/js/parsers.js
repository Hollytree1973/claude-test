// Paste and CSV import of comparables.
//
// Public API (ARCHITECTURE.md):
//   parseComparables(text, { kind: 'sales'|'rentals' }) -> { rows, warnings, format }
//
// format is one of: 'rightmove' (Rightmove SCT / Rightmove Plus style pasted blocks),
// 'land-registry' (HM Land Registry Price Paid Data CSV, no header row), 'table' (any CSV
// or tab separated table with a header row), 'list' (free typed list, one per line),
// 'empty' (nothing to read).
//
// Contract assumptions (the contract leaves these open):
// - rows are partial Comparables with no id. Only fields that were actually found are set,
//   so createComparable() defaults still apply to the rest; source and saleKind are always set.
// - Address is returned without the postcode; the postcode goes in its own field.
// - Row numbers in warnings ("Row 3") count the rows returned, from 1, in order. Input lines
//   that are skipped are reported as "Line n".
// - Floor area: when only one unit is given the other is filled (1 sq m = 10.764 sq ft, 1 dp).
//   A table column called just "floor area" with bare numbers is read as sq ft when above
//   250 and sq m otherwise, with a warning.
// - Rentals: rents are pcm. Weekly rents are converted (x 52 / 12) and annual rents (/ 12),
//   rounded to the nearest pound, with a warning.
// - A month only date becomes the first of that month, with a warning.
// - Generated text (warnings, notes) uses British English with no dashes or hyphens.
// Never throws.

const SQFT_PER_SQM = 10.764;
const MILES_PER_KM = 0.621371;

const MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5,
  jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const MON_RE = '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

const NUMBER_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// UK postcode, full (CM1 2AB) and the outward code alone (CM1) for partial matches.
const POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;
const OUTCODE_END_RE = /(?:^|[\s,])([A-Z]{1,2}\d[A-Z\d]?)\s*$/i;

// ---------------------------------------------------------------- small helpers

function round(x, dp) {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}
export function sqmFromSqft(sqft) { return round(sqft / SQFT_PER_SQM, 1); }
export function sqftFromSqm(sqm) { return round(sqm * SQFT_PER_SQM, 1); }

function toNumber(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/[,\s£]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function pad(n) { return String(n).padStart(2, '0'); }

function validDate(y, m, d) {
  if (!(y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function fullYear(yy) {
  const y = Number(yy);
  if (String(yy).length === 4) return y;
  const nowYY = new Date().getFullYear() % 100;
  return y <= nowYY + 1 ? 2000 + y : 1900 + y;
}

function monthNum(name) { return MONTHS[String(name).toLowerCase().replace(/\.$/, '')] || null; }

/**
 * Find every UK style date in a piece of text.
 * Returns [{ iso, monthOnly, index, length }] sorted by position.
 */
export function findDates(text) {
  const s = String(text || '');
  const found = [];
  const taken = [];
  const free = (a, b) => !taken.some(([x, y]) => a < y && b > x);
  const add = (m, y, mo, d, monthOnly) => {
    const a = m.index, b = m.index + m[0].length;
    if (!free(a, b)) return;
    // Claim the text even when the date is impossible, so 31/02/2026 is not read again as 02/2026.
    taken.push([a, b]);
    if (!validDate(y, mo, d)) return;
    found.push({ iso: `${y}-${pad(mo)}-${pad(d)}`, monthOnly, index: a, length: b - a });
  };
  const run = (re, fn) => { for (const m of s.matchAll(re)) fn(m); };
  // YYYY-MM-DD (optionally with a time after it)
  run(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b/g, (m) => add(m, +m[1], +m[2], +m[3], false));
  // DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY, DD/MM/YY
  run(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})\b/g, (m) => add(m, fullYear(m[3]), +m[2], +m[1], false));
  // 12 Mar 2026, 12th March 2026, 12 of March, 2026
  run(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MON_RE}\\.?,?\\s+(\\d{4})\\b`, 'gi'),
    (m) => add(m, +m[3], monthNum(m[2]), +m[1], false));
  // March 12, 2026
  run(new RegExp(`\\b${MON_RE}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'),
    (m) => add(m, +m[3], monthNum(m[1]), +m[2], false));
  // 12 Mar 26
  run(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MON_RE}\\.?\\s+(\\d{2})\\b(?![\\d,.])`, 'gi'),
    (m) => add(m, fullYear(m[3]), monthNum(m[2]), +m[1], false));
  // Mar 2026, March 2026
  run(new RegExp(`\\b${MON_RE}\\.?,?\\s+(\\d{4})\\b`, 'gi'), (m) => add(m, +m[2], monthNum(m[1]), 1, true));
  // 03/2026, 3-2026
  run(/\b(\d{1,2})[/.-](\d{4})\b/g, (m) => add(m, +m[2], +m[1], 1, true));
  // 2026-03
  run(/\b(\d{4})[-/](\d{1,2})\b(?![-/.]\d)/g, (m) => add(m, +m[1], +m[2], 1, true));
  return found.sort((a, b) => a.index - b.index);
}

/** Parse a single UK date string. Returns { iso, monthOnly } or null. */
export function parseUkDate(text) {
  const d = findDates(text)[0];
  return d ? { iso: d.iso, monthOnly: d.monthOnly } : null;
}

function describeMonth(iso) {
  const [y, m] = iso.split('-');
  return `${MONTH_NAMES[Number(m) - 1]} ${y}`;
}

export function normalisePostcode(s) {
  const m = String(s || '').match(POSTCODE_RE);
  if (!m) return '';
  return `${m[1].toUpperCase()} ${m[2].toUpperCase()}`;
}

/** Pull a full UK postcode out of an address. Returns { postcode, rest, partial }. */
export function extractPostcode(address) {
  const s = String(address || '');
  const m = s.match(POSTCODE_RE);
  if (m) {
    const rest = (s.slice(0, m.index) + s.slice(m.index + m[0].length));
    return { postcode: `${m[1].toUpperCase()} ${m[2].toUpperCase()}`, rest: tidyAddress(rest), partial: false };
  }
  const o = s.match(OUTCODE_END_RE);
  // Only treat a trailing token as an outward code if the rest looks like an address.
  if (o && /[a-z]{3}/i.test(s.slice(0, o.index)) && /\d/.test(o[1])) {
    return { postcode: o[1].toUpperCase(), rest: tidyAddress(s.slice(0, o.index)), partial: true };
  }
  return { postcode: '', rest: tidyAddress(s), partial: false };
}

function tidyAddress(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*(,\s*)+/g, ', ')
    .replace(/\s+,/g, ',')
    .replace(/^[\s,;:|.]+|[\s,;:|]+$/g, '')
    .trim();
}

// Title case for upper case Land Registry addresses: "STANFORD-LE-HOPE" -> "Stanford-le-Hope".
const SMALL_WORDS = new Set(['le', 'la', 'on', 'upon', 'the', 'de', 'in', 'by', 'under', 'cum', 'en', 'sur', 'of', 'and']);
export function titleCase(s) {
  return String(s || '').toLowerCase().split(/(\s+)/).map((word) => {
    if (/\d/.test(word)) return word.toUpperCase();
    return word.split('-').map((part, i) => {
      if (i > 0 && SMALL_WORDS.has(part)) return part;
      return part.replace(/^([("']*)([a-z])/, (_, p, c) => p + c.toUpperCase())
        .replace(/^(mc)([a-z])/, (_, p, c) => 'Mc' + c.toUpperCase());
    }).join('-');
  }).join('');
}

// ---------------------------------------------------------------- field extractors

/**
 * Find money amounts. Excludes price per square foot / metre figures.
 * Returns [{ value, unit: 'pcm'|'pw'|'pa'|null, index, explicit }].
 */
export function findPrices(text, { bare = false } = {}) {
  const s = String(text || '');
  const out = [];
  const UNIT = '(pcm|p\\.c\\.m\\.?|per\\s+calendar\\s+month|per\\s+month|a\\s+month|monthly|pm|p\\/m|pw|p\\.w\\.?|p\\/w|per\\s+week|a\\s+week|weekly|pa|p\\.a\\.?|per\\s+annum|per\\s+year|a\\s+year|annually|yearly)';
  const re = new RegExp(`(?:£|GBP\\s?)\\s*(\\d[\\d,]*(?:\\.\\d+)?)\\s*(k|m|mn|million)?(?![a-z\\d])\\s*(?:\\(?\\s*${UNIT}(?![a-z])\\)?)?`, 'gi');
  for (const m of s.matchAll(re)) {
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 24);
    if (/^\s*(?:per|\/|a)?\s*(?:sq|square|ft|psf|m²|m2\b)/i.test(after)) continue;
    if (/^\s*psf\b/i.test(after)) continue;
    let v = toNumber(m[1]);
    if (v == null) continue;
    const mult = (m[2] || '').toLowerCase();
    if (mult === 'k') v *= 1000;
    else if (mult) v *= 1000000;
    out.push({ value: Math.round(v * 100) / 100, unit: unitOf(m[3]), index: m.index, explicit: true });
  }
  // Rents written without a pound sign: "1350 pcm", "325 pw".
  // (No lookbehind, for older iPad Safari.)
  const re2 = new RegExp(`(^|[^£\\d.,])(\\d[\\d,]{2,}(?:\\.\\d+)?)\\s*${UNIT}(?![a-z])`, 'gi');
  for (const m of s.matchAll(re2)) {
    const idx = m.index + m[1].length;
    if (/£\s*$/.test(s.slice(Math.max(0, idx - 3), idx))) continue;
    if (out.some((p) => Math.abs(p.index - idx) < 4)) continue;
    const v = toNumber(m[2]);
    if (v != null) out.push({ value: v, unit: unitOf(m[3]), index: idx, explicit: true });
  }
  // Bare numbers or 425k, only when asked (a list segment or a price column).
  if (bare && !out.length) {
    const m = s.match(/^\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m|mn|million)?\s*$/i);
    if (m) {
      let v = toNumber(m[1]);
      const mult = (m[2] || '').toLowerCase();
      if (v != null) {
        if (mult === 'k') v *= 1000; else if (mult) v *= 1000000;
        out.push({ value: v, unit: null, index: m.index, explicit: false });
      }
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

function unitOf(u) {
  if (!u) return null;
  const x = u.toLowerCase().replace(/[.\s/]/g, '');
  if (/^(pcm|percalendarmonth|permonth|amonth|monthly|pm)$/.test(x)) return 'pcm';
  if (/^(pw|perweek|aweek|weekly)$/.test(x)) return 'pw';
  if (/^(pa|perannum|peryear|ayear|annually|yearly)$/.test(x)) return 'pa';
  return null;
}

/** Property type from free text, one of the model PROPERTY_TYPES or ''. */
export function detectPropertyType(text) {
  const s = String(text || '').toLowerCase();
  if (/\bmaisonette\b/.test(s)) return 'maisonette';
  if (/\b(flat|apartment|studio|penthouse|duplex)\b/.test(s)) return 'flat';
  if (/\b(bungalow|bung|chalet bungalow|dormer bungalow)\b/.test(s)) return 'bungalow';
  if (/\bend[\s-]*(of[\s-]*)?terr(ace|aced)?\b|\bend[\s-]*terr\b|\beot\b/.test(s)) return 'end-terrace';
  if (/\bsemi\b|\bsemi[\s-]*det(ached)?\b/.test(s)) return 'semi-detached';
  if (/\b(mid[\s-]*)?terr(ace|aced)?\b|\btown\s*house\b|\btownhouse\b|\bmews house\b/.test(s)) return 'terraced';
  if (/\b(link[\s-]*)?det(ached)?\b/.test(s)) return 'detached';
  return '';
}

const PPD_TYPES = { D: 'detached', S: 'semi-detached', T: 'terraced', F: 'flat' };

export function detectBedrooms(text) {
  const s = String(text || '');
  let m = s.match(/\b(\d{1,2})\s*-?\s*(?:bed(?:room)?s?|bdrms?|bdr|br)\b/i);
  if (m) return Number(m[1]);
  m = s.match(/\bbed(?:room)?s?\s*[:=]?\s*(\d{1,2})\b/i);
  if (m) return Number(m[1]);
  m = s.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\s*-?\s*bed(?:room)?s?\b/i);
  if (m) return NUMBER_WORDS[m[1].toLowerCase()];
  if (/\bstudio\b/i.test(s)) return 0;
  return null;
}

/** Floor area: returns { sqft, sqm } with either or both set, or null. */
export function detectFloorArea(text) {
  const s = String(text || '');
  let sqft = null, sqm = null;
  const notPrice = (m) => !/£\s*$|per\s*$/i.test(s.slice(Math.max(0, m.index - 6), m.index));
  for (const m of s.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*ft\.?|sqft|ft²|ft2|square\s*f(?:ee|oo)t)(?![a-z])/gi)) {
    if (notPrice(m)) { sqft = toNumber(m[1]); break; }
  }
  for (const m of s.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*m(?:etres?|eters?)?\.?|sqm|m²|m2|square\s*met(?:re|er)s?)(?![a-z\d])/gi)) {
    if (notPrice(m)) { sqm = toNumber(m[1]); break; }
  }
  if (sqft == null && sqm == null) return null;
  return { sqft, sqm };
}

/** Distance in miles; km and metres are converted. Returns { miles, converted } or null. */
export function detectDistance(text) {
  const s = String(text || '');
  let m = s.match(/(\d+(?:\.\d+)?|\.\d+)\s*(?:miles?|mi|mls)\b/i);
  if (m) return { miles: round(Number(m[1]), 2), converted: null };
  m = s.match(/(\d+(?:\.\d+)?)\s*(?:km|kms|kilomet(?:re|er)s?)\b/i);
  if (m) return { miles: round(Number(m[1]) * MILES_PER_KM, 2), converted: 'kilometres' };
  m = s.match(/(\d+)\s*(?:metres|meters|mtrs)\b/i);
  if (m) return { miles: round(Number(m[1]) / 1609.344, 2), converted: 'metres' };
  return null;
}

export function detectTenure(text) {
  const s = String(text || '').toLowerCase();
  if (/share\s+of\s+(the\s+)?freehold/.test(s)) return { tenure: 'leasehold', note: 'Share of freehold' };
  if (/\bleasehold\b|\blease\b|\bl\/h\b|\blh\b/.test(s)) return { tenure: 'leasehold', note: '' };
  if (/\bfreehold\b|\bf\/h\b|\bfh\b/.test(s)) return { tenure: 'freehold', note: '' };
  if (/\bcommonhold\b/.test(s)) return { tenure: 'freehold', note: 'Commonhold' };
  return null;
}

export function detectUnexpiredTerm(text) {
  const s = String(text || '');
  let m = s.match(/(\d{1,3})\s*(?:years?|yrs?)\s*(?:remaining|unexpired|left|to\s+run|outstanding)/i);
  if (m) return Number(m[1]);
  m = s.match(/(?:unexpired|remaining)\s*(?:term|lease)?\s*(?:of)?\s*[:=]?\s*(\d{1,3})\s*(?:years?|yrs?)?/i);
  if (m) return Number(m[1]);
  m = s.match(/lease\s*(?:length|term)?\s*[:=]\s*(\d{1,3})\s*(?:years?|yrs?)?/i);
  if (m) return Number(m[1]);
  return null;
}

/** 'auction' | 'repossession' | 'new-build' | null */
export function detectSaleKind(text) {
  const s = String(text || '').toLowerCase();
  if (/repossess|mortgagee|\breceivers?(hip)?\b|lpa receiver|bank sale/.test(s)) return 'repossession';
  if (/\bauction(ed)?\b/.test(s)) return 'auction';
  if (/new[\s-]*build|newbuild|new\s+home|brand\s+new|off[\s-]*plan|show\s+home/.test(s)) return 'new-build';
  return null;
}

// ---------------------------------------------------------------- CSV

/** Minimal RFC 4180 style parser. Returns array of arrays of trimmed strings. */
export function parseDelimited(text, delim) {
  const rows = [];
  let row = [], cell = '', q = false;
  const s = String(text || '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += c;
    } else if (c === '"' && cell.trim() === '') { q = true; cell = ''; }
    else if (c === delim) { row.push(cell.trim()); cell = ''; }
    else if (c === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows.filter((r) => r.some((x) => x !== ''));
}

function pickDelimiter(line) {
  if (line.includes('\t')) return '\t';
  const counts = { ',': 0, ';': 0, '|': 0 };
  let q = false;
  for (const c of line) {
    if (c === '"') q = !q;
    else if (!q && c in counts) counts[c]++;
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

// ---------------------------------------------------------------- header mapping

function normHeader(h) {
  return String(h || '').toLowerCase().replace(/²/g, '2').replace(/[^a-z0-9]+/g, ' ').trim();
}

// Ordered: the first match wins.
const HEADER_RULES = [
  [/^(id|ref|reference|transaction( id| unique identifier)?|record status|status|no|number|#|row|comp|comparable no)$/, 'ignore'],
  [/per sq|psf|per square|per ft|per m2|price per|ppsf|per sqm/, 'ignore'],
  [/postcode|post code|postal code|^zip/, 'postcode'],
  [/sale (type|kind|method)|new ?build|old ?new|^old$|auction|repossess/, 'saleKind'],
  [/ppd|category/, 'ppdCategory'],
  [/bed/, 'beds'],
  [/sq ?ft|sqft|square f|ft2|feet/, 'sqft'],
  [/sq ?m|sqm|square m|m2|metres|meters/, 'sqm'],
  [/floor ?area|^area|internal area|^size|gia|gifa|nia/, 'area'],
  [/distance|miles|^dist|proximity|^km/, 'distance'],
  [/unexpired|years remaining|term remaining|remaining term|lease (length|term|remaining|years)|^lease$|^unexpired/, 'lease'],
  [/tenure|duration|freehold|leasehold/, 'tenure'],
  [/type|style|built form/, 'type'],
  [/\brent|rental|pcm|per month|per week/, 'rent'],
  [/price|sold for|amount|consideration|value|^sold$/, 'price'],
  [/date|^sold on|completed|completion|transfer|let on|^let$|listed|^when|^month/, 'date'],
  [/source|provider|evidence|origin/, 'source'],
  [/note|comment|remark/, 'notes'],
  [/description|details|summary|^info|features/, 'description'],
  [/^saon|secondary addressable|flat (no|number)|^flat$|^unit$/, 'saon'],
  [/^paon|primary addressable|house (no|number|name)|building/, 'paon'],
  [/street|road/, 'street'],
  [/locality|village/, 'locality'],
  [/town|city|^place/, 'town'],
  [/district|borough|council|authority/, 'district'],
  [/county/, 'county'],
  [/address|^property$|^location$|^comparable$|^premises$/, 'address'],
];

function mapHeader(h) {
  const n = normHeader(h);
  if (!n) return null;
  for (const [re, key] of HEADER_RULES) if (re.test(n)) return key === 'ignore' ? null : key;
  return null;
}

function headerUnit(h) {
  const n = normHeader(h);
  if (/\bpw\b|week/.test(n)) return 'pw';
  if (/\bpa\b|annum|annual|year/.test(n)) return 'pa';
  if (/pcm|month|\bpm\b/.test(n)) return 'pcm';
  return null;
}

// ---------------------------------------------------------------- format detection

const PPD_ID_RE = /^\{?[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}\}?$/i;

function looksLikePpd(cells) {
  if (cells.length < 15) return false;
  const priceOk = /^\d+$/.test(cells[1]);
  const dateOk = /^\d{4}-\d{2}-\d{2}/.test(cells[2]) || /^\d{1,2}\/\d{1,2}\/\d{4}/.test(cells[2]);
  const typeOk = /^[DSTFO]$/i.test(cells[4]);
  const durOk = /^[FLU]?$/i.test(cells[6]);
  return (PPD_ID_RE.test(cells[0]) && priceOk) || (priceOk && dateOk && typeOk && durOk);
}

function isHeaderRow(cells) {
  if (cells.length < 2) return false;
  if (cells.some((c) => /£|^\d[\d,.]*$/.test(c))) return false;
  const mapped = cells.map(mapHeader).filter(Boolean);
  return new Set(mapped).size >= 2;
}

function hasPrice(line) { return findPrices(line).length > 0; }

export function detectFormat(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return 'empty';
  const sample = lines.slice(0, 6);
  const ppdHits = sample.filter((l) => looksLikePpd(parseDelimited(l, ',')[0] || [])).length;
  if (ppdHits && ppdHits >= Math.ceil(sample.length / 2)) return 'land-registry';
  const delim = pickDelimiter(lines[0]);
  const head = parseDelimited(lines[0], delim)[0] || [];
  if (lines.length >= 2 && isHeaderRow(head)) return 'table';
  const priceLines = lines.filter(hasPrice).length;
  if (priceLines && priceLines / lines.length >= 0.7) return 'list';
  return 'rightmove';
}

// ---------------------------------------------------------------- row building

/**
 * Turn the free text of one comparable (address already split off) into fields.
 * Mutates and returns ctx.row; pushes row level messages into ctx.msgs.
 */
function extractFromText(text, ctx, { priceBare = false } = {}) {
  const { row, msgs, kind, notes } = ctx;
  if (row.price == null) setPriceFrom(findPrices(text, { bare: priceBare }), text, ctx);
  if (!row.saleDate) setDateFrom(text, ctx);
  if (row.bedrooms == null) {
    const b = detectBedrooms(text);
    if (b != null) row.bedrooms = b;
  }
  if (!row.propertyType) {
    const t = detectPropertyType(text);
    if (t) row.propertyType = t;
  }
  if (row.floorAreaSqFt == null && row.floorAreaSqM == null) {
    const a = detectFloorArea(text);
    if (a) { row.floorAreaSqFt = a.sqft; row.floorAreaSqM = a.sqm; }
  }
  if (row.distanceMiles == null) {
    const d = detectDistance(text);
    if (d) {
      row.distanceMiles = d.miles;
      if (d.converted) msgs.push(`distance converted from ${d.converted} to ${d.miles} miles`);
    }
  }
  if (!row.tenure) {
    const t = detectTenure(text);
    if (t) { row.tenure = t.tenure; if (t.note) notes.push(t.note); }
  }
  if (row.unexpiredTerm == null) {
    const u = detectUnexpiredTerm(text);
    if (u != null) row.unexpiredTerm = u;
  }
  const k = detectSaleKind(text);
  if (k && (!row.saleKind || row.saleKind === 'standard')) row.saleKind = k;
  if (/shared\s+ownership|\d+\s*%\s*share/i.test(text)) {
    msgs.push('mentions shared ownership, so the price may be for a part share only [SURVEYOR TO CHECK]');
  }
  if (/retirement|over\s*(55|60)s?|age\s+restricted/i.test(text)) notes.push('Retirement or age restricted housing');
  void kind;
  return row;
}

function setPriceFrom(prices, text, ctx) {
  if (!prices.length) return;
  const { row, msgs } = ctx;
  const lines = String(text).split('\n');
  const lineOf = (idx) => {
    let pos = 0;
    for (const l of lines) { if (idx <= pos + l.length) return l; pos += l.length + 1; }
    return '';
  };
  const secondary = /previous|previously|asking|guide|listed|\bwas\b|reduced|offers|estimate|price change|bought|purchased in/i;
  const preferred = /sold|price paid|sale price|achieved|\blet\b|rent|completed/i;
  const scored = prices.map((p, i) => {
    const l = lineOf(p.index);
    let score = 0;
    if (secondary.test(l)) score -= 5;
    if (preferred.test(l)) score += 2;
    if (p.unit && ctx.kind === 'rentals') score += 1;
    return { p, score, i };
  }).sort((a, b) => b.score - a.score || a.i - b.i);
  const pick = scored[0].p;
  const others = new Set(scored.filter((s) => s.score === scored[0].score && s.p.value !== pick.value).map((s) => s.p.value));
  if (others.size) msgs.push(`more than one price found; £${fmt(pick.value)} was used [SURVEYOR TO CHECK]`);
  applyPrice(pick.value, pick.unit, ctx);
}

function applyPrice(value, unit, ctx) {
  const { row, msgs, kind, notes } = ctx;
  if (value == null) return;
  if (kind === 'rentals') {
    if (unit === 'pw') {
      const pcm = Math.round(value * 52 / 12);
      msgs.push(`weekly rent of £${fmt(value)} converted to £${fmt(pcm)} per calendar month (weekly x 52 / 12)`);
      notes.push(`Rent given as £${fmt(value)} per week`);
      row.price = pcm;
      return;
    }
    if (unit === 'pa') {
      const pcm = Math.round(value / 12);
      msgs.push(`annual rent of £${fmt(value)} converted to £${fmt(pcm)} per calendar month`);
      notes.push(`Rent given as £${fmt(value)} a year`);
      row.price = pcm;
      return;
    }
    row.price = value;
    if (value > 15000) msgs.push(`rent of £${fmt(value)} looks high for a monthly rent; check it is per calendar month [SURVEYOR TO CHECK]`);
    return;
  }
  row.price = value;
  if (unit) msgs.push(`price of £${fmt(value)} is marked as a rent; check this is a sale [SURVEYOR TO CHECK]`);
  else if (value < 20000) msgs.push(`price of £${fmt(value)} looks low for a sale price; it may be a rent [SURVEYOR TO CHECK]`);
}

function setDateFrom(text, ctx) {
  const dates = findDates(text);
  if (!dates.length) return;
  const lines = String(text).split('\n');
  let pos = 0;
  const lineStarts = lines.map((l) => { const st = pos; pos += l.length + 1; return [st, l]; });
  const lineFor = (i) => { let r = ''; for (const [st, l] of lineStarts) if (i >= st) r = l; return r; };
  const pref = /sold|date|let|completed|completion|transfer|agreed|listed|added|on\b/i;
  const bad = /previous|previously|bought|purchased|built|epc|valid|expires|year built/i;
  const ranked = dates.map((d, i) => {
    const l = lineFor(d.index);
    return { d, i, score: (pref.test(l) ? 2 : 0) - (bad.test(l) ? 5 : 0) + (d.monthOnly ? 0 : 1) };
  }).sort((a, b) => b.score - a.score || a.i - b.i);
  applyDate(ranked[0].d.iso, ranked[0].d.monthOnly, ctx);
}

function applyDate(iso, monthOnly, ctx) {
  ctx.row.saleDate = iso;
  const word = ctx.kind === 'rentals' ? 'letting date' : 'sale date';
  if (monthOnly) {
    ctx.msgs.push(`only a month was given for the ${word} (${describeMonth(iso)}), so the 1st of the month has been used`);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (iso > today) ctx.msgs.push(`the ${word} is in the future [SURVEYOR TO CHECK]`);
}

function fmt(n) {
  return Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 });
}

function newCtx(kind) {
  return { kind, row: {}, msgs: [], notes: [] };
}

/** Fill both units, set defaults, and add the standard missing field warnings. */
function finishRow(ctx, { source, skipAreaWarning = false, skipBedWarning = false } = {}) {
  const { row, msgs, notes, kind } = ctx;
  if (row.floorAreaSqFt != null && row.floorAreaSqM == null) row.floorAreaSqM = sqmFromSqft(row.floorAreaSqFt);
  if (row.floorAreaSqM != null && row.floorAreaSqFt == null) row.floorAreaSqFt = sqftFromSqm(row.floorAreaSqM);
  if (row.floorAreaSqFt == null) { delete row.floorAreaSqFt; delete row.floorAreaSqM; }
  if (!row.source) row.source = source || '';
  if (!row.saleKind) row.saleKind = 'standard';
  if (row.address) row.address = tidyAddress(row.address);

  if (!row.address) msgs.unshift('no address found');
  if (row.price == null) msgs.push(kind === 'rentals' ? 'no rent found' : 'no price found');
  if (!row.saleDate) msgs.push(kind === 'rentals' ? 'no letting date found' : 'no sale date found');
  if (row.floorAreaSqFt == null && !skipAreaWarning) msgs.push('no floor area found');
  if (row.bedrooms == null && !skipBedWarning) msgs.push('no bedroom count found');
  if (!row.propertyType && !ctx.typeWarned) msgs.push('property type not recognised');
  if (row.tenure === 'leasehold' && row.unexpiredTerm == null) msgs.push('leasehold but no unexpired lease term found');
  if (!row.tenure && (row.propertyType === 'flat' || row.propertyType === 'maisonette')) {
    msgs.push('no tenure given for a flat; check whether it is leasehold [SURVEYOR TO CHECK]');
  }
  if (row.saleKind === 'auction') msgs.push('sold at auction [SURVEYOR TO CHECK]');
  if (row.saleKind === 'repossession') msgs.push('repossession or receiver sale [SURVEYOR TO CHECK]');
  if (row.saleKind === 'new-build') msgs.push('new build sale, which may include a premium [SURVEYOR TO CHECK]');
  if (notes.length) row.notes = [...new Set(notes)].join('. ');
  for (const k of Object.keys(row)) if (row[k] === undefined || row[k] === '') {
    if (k !== 'source') delete row[k];
  }
  return row;
}

// ---------------------------------------------------------------- Land Registry PPD

function parsePpd(text, kind, out) {
  const rows = parseDelimited(text, ',');
  let line = 0;
  for (const cells of rows) {
    line++;
    if (!looksLikePpd(cells)) {
      if (isHeaderRow(cells)) continue;
      out.warnings.push(`Line ${line} was skipped because it is not in the Land Registry price paid layout`);
      continue;
    }
    const [, price, date, postcode, type, oldNew, duration, paon, saon, street, locality, town, , , category, status] = cells;
    if ((status || '').toUpperCase() === 'D') {
      out.warnings.push(`Line ${line} was skipped because Land Registry marks it as a deleted record`);
      continue;
    }
    const ctx = newCtx(kind);
    const { row, msgs, notes } = ctx;
    row.address = buildPpdAddress({ paon, saon, street, locality, town });
    row.postcode = normalisePostcode(postcode) || (postcode || '').toUpperCase();
    row.price = toNumber(price);
    const d = parseUkDate(date);
    if (d) applyDate(d.iso, false, ctx);
    const t = PPD_TYPES[(type || '').toUpperCase()];
    if (t) row.propertyType = t;
    else { msgs.push('Land Registry property type is "other", so the type must be set by hand'); ctx.typeWarned = true; }
    const dur = (duration || '').toUpperCase();
    if (dur === 'F') row.tenure = 'freehold';
    else if (dur === 'L') row.tenure = 'leasehold';
    row.saleKind = (oldNew || '').toUpperCase() === 'Y' ? 'new-build' : 'standard';
    if ((category || '').toUpperCase() === 'B') {
      notes.push('Land Registry category B (additional price paid)');
      msgs.push('Land Registry category B sale, which can be a repossession, buy to let or company purchase [SURVEYOR TO CHECK]');
    }
    if (row.tenure === 'leasehold') {
      // The unexpired term is never in PPD; one warning per row is enough.
    }
    finishRow(ctx, { source: 'Land Registry', skipAreaWarning: true, skipBedWarning: true });
    pushRow(out, row, msgs);
  }
  if (out.rows.length) {
    out.warnings.unshift('Land Registry price paid data does not include floor area, bedrooms or distance; add these by hand, for example from the EPC register');
  }
  if (kind === 'rentals') out.warnings.unshift('Land Registry price paid data records sales, not rents [SURVEYOR TO CHECK]');
}

function buildPpdAddress({ paon, saon, street, locality, town }) {
  const p = titleCase(paon || ''), s = titleCase(saon || ''), st = titleCase(street || '');
  const parts = [];
  if (s) parts.push(s);
  if (p && st) parts.push(/^\d/.test(p) ? `${p} ${st}` : `${p}, ${st}`);
  else if (p || st) parts.push(p || st);
  const loc = titleCase(locality || ''), tw = titleCase(town || '');
  if (loc && loc.toLowerCase() !== tw.toLowerCase()) parts.push(loc);
  if (tw) parts.push(tw);
  return parts.join(', ');
}

// ---------------------------------------------------------------- table with header

function parseTable(text, kind, out) {
  const firstLine = text.split('\n').find((l) => l.trim());
  const delim = pickDelimiter(firstLine);
  const rows = parseDelimited(text, delim);
  const header = rows[0];
  const cols = header.map((h) => ({ key: mapHeader(h), unit: headerUnit(h), raw: h, norm: normHeader(h) }));
  // A "rent" column wins over a "price" column for rentals; for sales a price column wins.
  const hasRent = cols.some((c) => c.key === 'rent');
  const hasPriceCol = cols.some((c) => c.key === 'price');
  for (const c of cols) {
    if (c.key === 'rent') c.key = (kind === 'rentals' || !hasPriceCol) ? 'price' : null;
    else if (c.key === 'price' && kind === 'rentals' && hasRent) c.key = null;
  }
  const areaCol = cols.find((c) => c.key === 'area');
  if (areaCol) {
    if (/ft|feet/.test(areaCol.norm)) areaCol.key = 'sqft';
    else if (/\bm\b|m2|metre|meter|sqm/.test(areaCol.norm)) areaCol.key = 'sqm';
  }
  const unmapped = cols.filter((c) => !c.key && c.raw).map((c) => c.raw);
  if (unmapped.length) out.warnings.push(`Columns not used: ${unmapped.join(', ').replace(/-/g, ' ')}`);

  let areaGuessWarned = false;
  for (let r = 1; r < rows.length; r++) {
    const cells = repairSplitNumbers(rows[r], header.length);
    const line = r + 1;
    const ctx = newCtx(kind);
    const { row, msgs, notes } = ctx;
    const val = (key) => { const i = cols.findIndex((c) => c.key === key); return i >= 0 ? (cells[i] || '').trim() : ''; };
    const colOf = (key) => cols.find((c) => c.key === key);
    const extra = [];

    // Address
    const addressParts = [];
    const saon = val('saon'), paon = val('paon'), street = val('street');
    if (val('address')) addressParts.push(val('address'));
    else if (saon || paon || street) addressParts.push(buildPpdAddress({ paon, saon, street }).replace(/^./, (c) => c));
    for (const k of ['locality', 'town']) {
      const v = val(k);
      if (v && !addressParts.join(' ').toLowerCase().includes(v.toLowerCase())) addressParts.push(v);
    }
    let address = addressParts.join(', ');
    if (address && address === address.toUpperCase() && /[A-Z]{3}/.test(address)) address = titleCase(address);
    const pcCell = val('postcode');
    const ep = extractPostcode(address);
    row.address = ep.rest;
    row.postcode = normalisePostcode(pcCell) || pcCell.toUpperCase() || ep.postcode;
    if (!pcCell && ep.partial) msgs.push('only part of the postcode was found');

    // Price
    const priceCell = val('price');
    if (priceCell) {
      const ps = findPrices(priceCell, { bare: true });
      if (ps.length) applyPrice(ps[0].value, ps[0].unit || colOf('price').unit, ctx);
      else if (toNumber(priceCell) != null) applyPrice(toNumber(priceCell), colOf('price').unit, ctx);
      else msgs.push(kind === 'rentals' ? 'rent not understood' : 'price not understood');
    }
    // Date
    const dateCell = val('date');
    if (dateCell) {
      const d = parseUkDate(dateCell);
      if (d) applyDate(d.iso, d.monthOnly, ctx);
      else msgs.push('date not understood');
    }
    // Beds
    const bedCell = val('beds');
    if (bedCell) {
      const n = toNumber(bedCell);
      if (n != null) row.bedrooms = Math.round(n);
      else { const b = detectBedrooms(bedCell); if (b != null) row.bedrooms = b; }
    }
    // Floor area
    const sqftCell = val('sqft'), sqmCell = val('sqm'), areaCell = val('area');
    if (sqftCell) row.floorAreaSqFt = toNumber(sqftCell) ?? detectFloorArea(sqftCell)?.sqft ?? null;
    if (sqmCell) row.floorAreaSqM = toNumber(sqmCell) ?? detectFloorArea(sqmCell)?.sqm ?? null;
    if (areaCell && row.floorAreaSqFt == null && row.floorAreaSqM == null) {
      const a = detectFloorArea(areaCell);
      if (a) { row.floorAreaSqFt = a.sqft; row.floorAreaSqM = a.sqm; }
      else {
        const n = toNumber(areaCell);
        if (n != null) {
          if (n > 250) row.floorAreaSqFt = n; else row.floorAreaSqM = n;
          if (!areaGuessWarned) {
            out.warnings.push('The floor area column has no unit, so figures above 250 were read as sq ft and the rest as sq m [SURVEYOR TO CHECK]');
            areaGuessWarned = true;
          }
        }
      }
    }
    if (row.floorAreaSqFt == null) delete row.floorAreaSqFt;
    if (row.floorAreaSqM == null) delete row.floorAreaSqM;
    // Distance
    const distCell = val('distance');
    if (distCell) {
      const d = detectDistance(distCell);
      if (d) {
        row.distanceMiles = d.miles;
        if (d.converted) msgs.push(`distance converted from ${d.converted} to ${d.miles} miles`);
      } else if (toNumber(distCell) != null) {
        const n = toNumber(distCell);
        if (/\bkm\b|kilomet/.test(colOf('distance').norm)) {
          row.distanceMiles = round(n * MILES_PER_KM, 2);
          msgs.push(`distance converted from kilometres to ${row.distanceMiles} miles`);
        } else row.distanceMiles = n;
      }
    }
    // Type
    const typeCell = val('type');
    if (typeCell) {
      const code = typeCell.trim().toUpperCase();
      if (PPD_TYPES[code]) row.propertyType = PPD_TYPES[code];
      else if (code === 'O') { msgs.push('property type is "other", so it must be set by hand'); ctx.typeWarned = true; }
      else {
        const t = detectPropertyType(typeCell);
        if (t) row.propertyType = t;
        if (row.bedrooms == null) { const b = detectBedrooms(typeCell); if (b != null) row.bedrooms = b; }
      }
    }
    // Tenure
    const tenCell = val('tenure');
    if (tenCell) {
      const code = tenCell.trim().toUpperCase();
      if (code === 'F' || code === 'FH') row.tenure = 'freehold';
      else if (code === 'L' || code === 'LH') row.tenure = 'leasehold';
      else {
        const t = detectTenure(tenCell);
        if (t) { row.tenure = t.tenure; if (t.note) notes.push(t.note); }
        const u = detectUnexpiredTerm(tenCell);
        if (u != null) row.unexpiredTerm = u;
      }
    }
    // Lease
    const leaseCell = val('lease');
    if (leaseCell) {
      const n = toNumber(leaseCell.replace(/years?|yrs?/gi, ''));
      if (n != null) row.unexpiredTerm = n;
      else { const u = detectUnexpiredTerm(leaseCell) ?? toNumber((leaseCell.match(/\d{1,3}/) || [])[0]); if (u != null) row.unexpiredTerm = u; }
      if (row.unexpiredTerm != null && !row.tenure) row.tenure = 'leasehold';
    }
    // Sale kind
    const skCell = val('saleKind');
    if (skCell) {
      const code = skCell.trim().toUpperCase();
      if (code === 'Y' || code === 'YES' || code === 'TRUE') {
        const n = colOf('saleKind').norm;
        row.saleKind = /auction/.test(n) ? 'auction' : /repossess/.test(n) ? 'repossession' : 'new-build';
      } else if (code !== 'N' && code !== 'NO' && code !== 'FALSE') {
        const k = detectSaleKind(skCell);
        if (k) row.saleKind = k;
      }
    }
    const cat = val('ppdCategory');
    if (cat.toUpperCase() === 'B') {
      notes.push('Land Registry category B (additional price paid)');
      msgs.push('Land Registry category B sale, which can be a repossession, buy to let or company purchase [SURVEYOR TO CHECK]');
    }
    // Source and notes
    const src = val('source');
    if (src) row.source = normaliseSource(src);
    const note = val('notes');
    if (note) { notes.push(note); extra.push(note); }
    const desc = val('description');
    if (desc) extra.push(desc);
    // Anything still missing may be in the description or notes columns.
    if (extra.length) {
      const saved = row.saleKind;
      extractFromText(extra.join('\n'), ctx);
      if (saved && saved !== 'standard') row.saleKind = saved;
    } else {
      const k = detectSaleKind(cells.join(' '));
      if (k && (!row.saleKind || row.saleKind === 'standard')) row.saleKind = k;
    }
    if (!row.address && !row.price && !row.saleDate) {
      out.warnings.push(`Line ${line} was skipped because it has no address, price or date`);
      continue;
    }
    finishRow(ctx, { source: src ? normaliseSource(src) : guessSource(text) });
    pushRow(out, row, msgs);
  }
}

// An unquoted £300,000 in a comma separated file splits into "£300" and "000"; join them back.
function repairSplitNumbers(cells, want) {
  const c = [...cells];
  let i = 0;
  while (c.length > want && i < c.length - 1) {
    if (/^(£\s*)?\d{1,3}(,\d{3})*$/.test(c[i]) && /^\d{3}(\.\d+)?(\s*(sq|pcm|pw|k)\b.*)?$/i.test(c[i + 1])) {
      c.splice(i, 2, `${c[i]},${c[i + 1]}`);
    } else i++;
  }
  return c;
}

function normaliseSource(s) {
  const x = String(s).toLowerCase();
  if (/rightmove/.test(x) && /sct|sold|comparable|plus/.test(x)) return 'Rightmove SCT';
  if (/rightmove/.test(x)) return 'Rightmove';
  if (/land\s*reg|hmlr|ppd|price paid/.test(x)) return 'Land Registry';
  if (/zoopla/.test(x)) return 'Zoopla';
  if (/agent/.test(x)) return 'Agent';
  return String(s).trim();
}

function guessSource(text) {
  const x = String(text).toLowerCase();
  if (/rightmove/.test(x)) return 'Rightmove SCT';
  if (/land registry|price paid/.test(x)) return 'Land Registry';
  if (/zoopla/.test(x)) return 'Zoopla';
  return '';
}

// ---------------------------------------------------------------- free typed list

function protectThousands(s) {
  // 425,000 -> 425000 and 1,023 -> 1023 so commas can split fields.
  let prev;
  let x = s;
  do { prev = x; x = x.replace(/(\d),(\d{3})(?!\d)/g, '$1$2'); } while (x !== prev);
  return x;
}

function isFieldSegment(seg) {
  const s = seg.trim();
  if (!s) return false;
  if (findPrices(s, { bare: true }).length) return true;
  if (findDates(s).length) return true;
  if (detectFloorArea(s) || detectDistance(s)) return true;
  if (detectBedrooms(s) != null && !/\b(road|street|lane|avenue|close|way|drive)\b/i.test(s)) return true;
  if (/^(freehold|leasehold|share of freehold|fh|lh|f\/h|l\/h)\b/i.test(s)) return true;
  if (/^(sold|let|price|rent|date|tenure|type|beds?|bedrooms|area|size|distance|source|lease|unexpired|epc|notes?)\b\s*[:=]?/i.test(s)) return true;
  if (/(auction|repossess|new\s*build|off\s*plan)/i.test(s)) return true;
  const words = s.split(/\s+/).length;
  if (/^(flat|apartment|unit|maisonette|plot)\s+\d/i.test(s)) return false;
  if (words <= 4 && detectPropertyType(s) && !/\d/.test(s.split(/\s+/)[0] || 'x')) return true;
  if (words <= 4 && /^\d+\s*bed/i.test(s)) return true;
  return false;
}

function parseList(text, kind, out) {
  const lines = text.split('\n');
  let lineNo = 0;
  for (const raw of lines) {
    lineNo++;
    const line = raw.replace(/^\s*(?:\d{1,2}[.)]\s+|[-*•]\s+)/, '').trim();
    if (!line) continue;
    const prot = protectThousands(line);
    const segs = prot.split(/\s*[,;|\t]\s*/).filter((x) => x.trim());
    const addr = [];
    const rest = [];
    let inAddress = true;
    for (const seg of segs) {
      if (inAddress && !isFieldSegment(seg)) addr.push(seg);
      else { inAddress = false; rest.push(seg); }
    }
    if (!findPrices(prot, { bare: false }).length && !rest.some((s) => findPrices(s, { bare: true }).length) && !addr.length) {
      out.warnings.push(`Line ${lineNo} was skipped because it could not be read`);
      continue;
    }
    const ctx = newCtx(kind);
    const { row, msgs } = ctx;
    const ep = extractPostcode(addr.join(', '));
    row.address = ep.rest;
    row.postcode = ep.postcode;
    if (ep.partial) msgs.push('only part of the postcode was found');
    if (!row.postcode) {
      const pc = normalisePostcode(rest.join(' '));
      if (pc) row.postcode = pc;
    }
    // Price: an explicit £ amount anywhere, otherwise the first bare number segment.
    const restText = rest.join('\n');
    const explicit = findPrices(restText);
    if (explicit.length) setPriceFrom(explicit, restText, ctx);
    else {
      for (const seg of rest) {
        const p = findPrices(seg, { bare: true });
        if (p.length && !findDates(seg).length) { applyPrice(p[0].value, p[0].unit, ctx); break; }
      }
    }
    extractFromText(restText, ctx);
    const src = (rest.find((s) => /^source\s*[:=]/i.test(s)) || '').replace(/^source\s*[:=]\s*/i, '');
    finishRow(ctx, { source: src ? normaliseSource(src) : guessSource(line) });
    pushRow(out, row, msgs);
  }
}

// ---------------------------------------------------------------- Rightmove blocks

const JUNK_LINE = /^(view( details| property| on map| sold prices)?|save( property)?|hide( property)?|share|map|maps?|photos?|floor ?plans?|street ?view|details|more details|sold stc|under offer|featured|premium listing|new|reduced|contact agent|request details|virtual tour|\d+\s*(of|\/)\s*\d+|\d+ photos?|see all.*|next|previous|back to results|[<>«»]+|sort by.*|showing \d+.*|\d+ results?.*|page \d+.*)$/i;
const STREET_WORDS = /\b(road|rd|street|st|avenue|ave|close|lane|way|drive|gardens|crescent|court|place|grove|mews|park|hill|green|walk|rise|view|chase|parade|square|row|terrace|meadow|meadows|wharf|quay|lodge|house|cottages?|end|field|fields|path|vale|wood|oaks?)\b/i;

function isRmFieldLine(l) {
  const s = l.trim();
  if (hasPrice(s)) return true;
  if (findDates(s).length) return true;
  if (detectFloorArea(s) || detectDistance(s)) return true;
  if (/^(\d+|one|two|three|four|five|six)\s*-?\s*bed/i.test(s) || /^studio\b/i.test(s)) return true;
  if (/^(freehold|leasehold|share of freehold|tenure)\b/i.test(s)) return true;
  if (/^(sold\s+(on|for|in|at|date|price)|sold\s*[:=]|last sold|let\s+(on|agreed|date|in)|let\s*[:=]|date|price|type|property type|bedrooms?|bathrooms?|receptions?|distance|floor area|size|epc|council tax|tenure|lease|source|key features|added|listed|new build|auction)\b/i.test(s)) return true;
  if (/^(flat|apartment|unit|maisonette)\s+\d/i.test(s)) return false;
  if (s.split(/\s+/).length <= 4 && /^(detached|semi|terraced|end|mid|flat|apartment|maisonette|bungalow|town ?house|link|ground|first|second|top)\b/i.test(s)) return true;
  return false;
}

function addressScore(l) {
  let sc = 0;
  if (POSTCODE_RE.test(l)) sc += 3;
  if (/^(flat|apartment|unit|plot|\d+[a-z]?\b)/i.test(l)) sc += 2;
  if (STREET_WORDS.test(l)) sc += 2;
  if (l.includes(',')) sc += 1;
  if (/sold (house )?prices|results|showing|near|properties|search|radius|comparables?\b|rightmove/i.test(l)) sc -= 4;
  if (l.length > 120) sc -= 2;
  return sc;
}

function primaryPriceLine(l) {
  return hasPrice(l) && !/previous|previously|asking|guide|\bwas\b|reduced|estimate|bought|purchased/i.test(l);
}

function splitRightmoveBlocks(text) {
  const all = text.split('\n').map((l) => l.trim());
  // First split on blank lines.
  let blocks = [];
  let cur = [];
  for (const l of all) {
    if (!l) { if (cur.length) blocks.push(cur); cur = []; continue; }
    if (JUNK_LINE.test(l.replace(/[.:]+$/, ''))) continue;
    cur.push(l);
  }
  if (cur.length) blocks.push(cur);

  // Then split any block holding more than one sale.
  const split = [];
  for (const b of blocks) {
    let c = [];
    let cPrice = false, cAddr = false;
    for (const l of b) {
      const isField = isRmFieldLine(l);
      const addrLike = !isField && addressScore(l) >= 3;
      const isPrice = primaryPriceLine(l);
      if (cPrice && addrLike) {
        split.push(c); c = []; cPrice = false; cAddr = false;
      } else if (cPrice && isPrice) {
        // Move trailing non field lines (most likely the next address) into the new block.
        const carry = [];
        while (c.length && !isRmFieldLine(c[c.length - 1])) carry.unshift(c.pop());
        split.push(c); c = carry; cPrice = false; cAddr = carry.length > 0;
      }
      c.push(l);
      if (isPrice) cPrice = true;
      if (addrLike) cAddr = true;
    }
    if (c.length) split.push(c);
    void cAddr;
  }

  // Merge headings into the following block and orphan detail blocks into the previous one.
  const merged = [];
  let pending = [];
  for (const b of split) {
    const hasField = b.some(isRmFieldLine);
    const hasAddr = b.some((l) => !isRmFieldLine(l));
    const prev = merged[merged.length - 1];
    const prevHasPrice = prev && prev.some(primaryPriceLine);
    const thisHasPrice = b.some(primaryPriceLine);
    if (hasField && !hasAddr && !pending.length && prev && (!prevHasPrice || !thisHasPrice)) {
      prev.push(...b);
      continue;
    }
    const substantive = thisHasPrice || b.some((l) => findDates(l).length);
    if (!hasField || !substantive) { pending.push(...b); continue; }
    merged.push([...pending, ...b]);
    pending = [];
  }
  if (pending.length && merged.length) {
    // Trailing non field text (for example a footer); ignore unless it looks like an address.
    if (pending.some((l) => addressScore(l) >= 3)) merged.push(pending);
  } else if (pending.length) merged.push(pending);
  return merged;
}

function parseRightmove(text, kind, out) {
  const blocks = splitRightmoveBlocks(text);
  for (const b of blocks) {
    const ctx = newCtx(kind);
    const { row, msgs } = ctx;
    // Pick the address line.
    let best = -1, bestScore = -Infinity;
    b.forEach((l, i) => {
      if (isRmFieldLine(l) && !POSTCODE_RE.test(l)) return;
      if (isRmFieldLine(l) && hasPrice(l)) return;
      const sc = addressScore(l) - (isRmFieldLine(l) ? 3 : 0);
      if (sc > bestScore) { bestScore = sc; best = i; }
    });
    const others = b.filter((_, i) => i !== best);
    if (best >= 0) {
      const ep = extractPostcode(b[best].replace(/^(address|property)\s*[:=]\s*/i, ''));
      row.address = ep.rest;
      row.postcode = ep.postcode;
      if (ep.partial) msgs.push('only part of the postcode was found');
    }
    if (!row.postcode) {
      const pc = normalisePostcode(others.join(' '));
      if (pc) row.postcode = pc;
    }
    const detail = others.join('\n');
    extractFromText(detail, ctx);
    if (!row.address && row.price == null && !row.saleDate) {
      out.warnings.push('Some pasted text was skipped because no comparable could be read from it');
      continue;
    }
    finishRow(ctx, { source: kind === 'rentals' ? 'Rightmove' : 'Rightmove SCT' });
    pushRow(out, row, msgs);
  }
}

// ---------------------------------------------------------------- output

function pushRow(out, row, msgs) {
  out.rows.push(row);
  const n = out.rows.length;
  const key = [String(row.address || '').toLowerCase(), row.price, row.saleDate].join('|');
  const dupe = out._keys.get(key);
  if (dupe && row.address) msgs.push(`looks like a duplicate of row ${dupe}`);
  else out._keys.set(key, n);
  for (const m of [...new Set(msgs)]) out.warnings.push(`Row ${n}: ${m}`);
}

const FORMAT_LABELS = {
  rightmove: 'Rightmove style pasted text',
  'land-registry': 'Land Registry price paid data',
  table: 'table with column headings',
  list: 'typed list, one comparable per line',
};

/**
 * Parse pasted comparables.
 * @param {string} text
 * @param {{kind?: 'sales'|'rentals'}} [opts]
 * @returns {{ rows: object[], warnings: string[], format: string }}
 */
export function parseComparables(text, opts = {}) {
  const kind = opts && opts.kind === 'rentals' ? 'rentals' : 'sales';
  const out = { rows: [], warnings: [], format: 'empty', _keys: new Map() };
  try {
    const clean = String(text ?? '')
      .replace(/^﻿/, '')
      .replace(/\r\n?/g, '\n')
      .replace(/[   ]/g, ' ')
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"');
    const format = detectFormat(clean);
    out.format = format;
    if (format === 'empty') {
      out.warnings.push('Nothing was pasted');
    } else if (format === 'land-registry') parsePpd(clean, kind, out);
    else if (format === 'table') parseTable(clean, kind, out);
    else if (format === 'list') parseList(clean, kind, out);
    else parseRightmove(clean, kind, out);
    if (format !== 'empty' && !out.rows.length) {
      out.warnings.push('No comparables could be read from the pasted text. Try one comparable per line, or a table with column headings');
    }
  } catch (e) {
    // Never throw: report and return whatever was read.
    out.warnings.push('Part of the pasted text could not be read, so some comparables may be missing');
    if (typeof console !== 'undefined') console.error('parseComparables failed', e);
  }
  const { _keys, ...result } = out;
  void _keys;
  result.formatLabel = FORMAT_LABELS[result.format] || '';
  return result;
}
