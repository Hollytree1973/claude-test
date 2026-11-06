// Gibsons valuation comparison tool: Red Book comparables commentary and markdown table.
//
// Public API (ARCHITECTURE.md):
//   buildCommentary(state, evaluation)               -> plain text commentary
//   buildMarkdownTable(state, evaluation, kind)      -> markdown table string ('sales' | 'rentals')
//
// Contract assumptions (noted for other agents):
// 1. If evaluation is missing or null, it is worked out here with calc.evaluate(state).
// 2. Section layout. Sales and BTL: 1 Opening, 2 Sales comparables, 3 Outlier treatment,
//    4 Range conclusion, then for BTL 5 Rental evidence, and finally Bridge to valuation
//    opinion (5 for sales, 6 for BTL). Rental only matrices use the same five sections with
//    rental evidence in place of sales evidence.
// 3. Every piece of user text (addresses, notes, sources) is cleaned before it is written:
//    ISO dates become '12 March 2026', number ranges such as '10-12' become '10 to 12', any
//    other hyphen or dash becomes a space, the house banned words are swapped for plain
//    words, and the word 'average' becomes 'typical'. This keeps the output free of dashes
//    and of anything that reads as an average or adopted value, even when the input has them.
// 4. A comparable is treated as needing outlier treatment when it is excluded or carries any
//    'warn' flag from calc.js (the 'info' flag HPI_REQUIRED alone does not count).
// 5. Negative numbers in the markdown table are written 'minus 5%' because a minus sign is a
//    hyphen. Positive adjustments are written '+5%'.
// 6. The calc median is used only inside calc for the outlier test; it is never printed.
import { evaluate, areaSqFt, sqftToSqm, FLAG_LABELS } from './calc.js';
import { CATEGORIES, INSTRUCTION_TYPES } from './model.js';

// ---------- text cleaning ----------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

const DASH_CLASS = '\\-\\u2010\\u2011\\u2012\\u2013\\u2014\\u2015\\u2212\\u2043\\uFE58\\uFE63\\uFF0D\\u00AD';
const DASH_RE = new RegExp(`[${DASH_CLASS}]`, 'g');

const BANNED = [
  [/\bdelv(e|es|ed|ing)\b/gi, (m) => ({ e: 'look', es: 'looks', ed: 'looked', ing: 'looking' })[m.slice(4).toLowerCase()]],
  [/\bleverag(e|es|ed|ing)\b/gi, (m) => ({ e: 'use', es: 'uses', ed: 'used', ing: 'using' })[m.slice(7).toLowerCase()]],
  [/\butili[sz](e|es|ed|ing|ation)\b/gi, (m) => ({ e: 'use', es: 'uses', ed: 'used', ing: 'using', ation: 'use' })[m.slice(6).toLowerCase()]],
  [/\bcomprehensive(ly)?\b/gi, (m) => (/ly$/i.test(m) ? 'fully' : 'full')],
  [/\brobust(ly)?\b/gi, (m) => (/ly$/i.test(m) ? 'soundly' : 'sound')],
  [/\bseamless(ly)?\b/gi, (m) => (/ly$/i.test(m) ? 'smoothly' : 'smooth')],
  [/\bcrucial(ly)?\b/gi, () => 'important'],
  [/\bvital(ly)?\b/gi, () => 'important'],
  [/\bmoreover\b/gi, () => 'also'],
  [/\bfurthermore\b/gi, () => 'also'],
  [/\bnotably\b/gi, () => 'in particular'],
  [/\bthereby\b/gi, () => 'so'],
  [/\bhence\b/gi, () => 'so'],
  [/\bthus\b/gi, () => 'so'],
  [/\bweighted averages?\b/gi, () => 'typical figure'],
  [/\baverages?\b/gi, () => 'typical'],
  [/\badopted values?\b/gi, () => 'value'],
];

function keepCase(original, replacement) {
  if (!replacement) return original;
  if (original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) {
    return replacement[0].toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

function scrubWords(s) {
  let out = s;
  for (const [re, fn] of BANNED) out = out.replace(re, (m) => keepCase(m, fn(m)));
  return out;
}

/** Remove every hyphen and dash from a piece of text in a readable way. */
function scrubDashes(s) {
  let out = s;
  // ISO dates and months first so they read as dates.
  out = out.replace(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g, (m, y, mo, d) => {
    const n = +mo;
    return n >= 1 && n <= 12 ? `${+d} ${MONTHS[n - 1]} ${y}` : m;
  });
  out = out.replace(/\b(\d{4})-(\d{1,2})\b/g, (m, y, mo) => {
    const n = +mo;
    return n >= 1 && n <= 12 ? `${MONTHS[n - 1]} ${y}` : m;
  });
  // Number ranges: 10-12 becomes 10 to 12.
  out = out.replace(new RegExp(`(\\d)\\s*[${DASH_CLASS}]+\\s*(?=[£]?\\d)`, 'g'), '$1 to ');
  // Spaced dashes used as punctuation become a comma.
  out = out.replace(new RegExp(`\\s+[${DASH_CLASS}]+\\s+`, 'g'), ', ');
  // A leading dash (list bullet) is dropped; any other becomes a space.
  out = out.replace(new RegExp(`^\\s*[${DASH_CLASS}]+\\s*`, 'gm'), '');
  out = out.replace(DASH_RE, ' ');
  return out;
}

/** Clean a piece of user supplied text for use in prose (single line). */
function clean(text) {
  if (text === null || text === undefined) return '';
  let s = String(text).replace(/\s+/g, ' ').trim();
  s = scrubDashes(s);
  s = scrubWords(s);
  return s.replace(/ {2,}/g, ' ').replace(/\s+([,.;:])/g, '$1').replace(/,\s*,/g, ',').trim();
}

/** Final safety pass over generated prose (keeps line breaks). */
function finalise(text) {
  return text.split('\n').map((line) => {
    let l = scrubWords(scrubDashes(line));
    return l.replace(/[ \t]{2,}/g, ' ').replace(/\s+$/, '');
  }).join('\n');
}

function sentence(text) {
  const s = clean(text).replace(/^[,;:.\s]+/, '');
  if (!s) return '';
  const first = s[0].toUpperCase() + s.slice(1);
  return /[.!?]$/.test(first) ? first : first + '.';
}

// ---------- formatting ----------

function num(x) {
  if (x === null || x === undefined || x === '') return null;
  const n = typeof x === 'number' ? x : Number(String(x).replace(/[£,\s%]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function group(intStr) { return intStr.replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/** 1234.5 with dp digits, thousands separators, never a minus sign (callers word the sign). */
function fmtNum(x, dp = 0) {
  const n = num(x);
  if (n === null) return '';
  const [i, f] = Math.abs(n).toFixed(dp).split('.');
  return f ? `${group(i)}.${f}` : group(i);
}

function money(x, dp = 0) { const n = num(x); return n === null ? '' : `£${fmtNum(n, dp)}`; }

function pct(x) {
  const n = num(x);
  if (n === null) return '';
  const r = Math.round(Math.abs(n) * 100) / 100;
  return `${Number.isInteger(r) ? r : r.toString()}%`;
}

function parseIso(iso) {
  if (typeof iso !== 'string') return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(iso.trim());
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(iso.trim());
  if (m) return { y: +m[3], m: +m[2], d: +m[1] };
  return null;
}

function fmtDate(iso) {
  const p = parseIso(iso);
  if (!p || p.m < 1 || p.m > 12) return '';
  return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
}

function dateKey(iso) { const p = parseIso(iso); return p ? p.y * 10000 + p.m * 100 + p.d : null; }

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve'];
function countWord(n) { return n >= 0 && n < WORDS.length ? WORDS[n] : String(n); }
function plural(n, one, many) { return `${countWord(n)} ${n === 1 ? one : many}`; }

function listJoin(items) {
  const a = items.filter(Boolean);
  if (a.length <= 1) return a.join('');
  return `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`;
}

const TYPE_PROSE = {
  'detached': 'a detached house', 'semi-detached': 'a semi detached house', 'terraced': 'a terraced house',
  'end-terrace': 'an end of terrace house', 'flat': 'a flat', 'maisonette': 'a maisonette', 'bungalow': 'a bungalow',
};
const TYPE_LABEL = {
  'detached': 'Detached', 'semi-detached': 'Semi detached', 'terraced': 'Terraced', 'end-terrace': 'End of terrace',
  'flat': 'Flat', 'maisonette': 'Maisonette', 'bungalow': 'Bungalow',
};

function typeProse(t) {
  const k = String(t || '').trim().toLowerCase();
  if (TYPE_PROSE[k]) return TYPE_PROSE[k];
  if (!k) return 'a property of unrecorded type [VALUER TO CONFIRM PROPERTY TYPE]';
  const c = clean(k);
  return `${/^[aeiou]/.test(c) ? 'an' : 'a'} ${c} property`;
}
function typeLabel(t) {
  const k = String(t || '').trim().toLowerCase();
  if (TYPE_LABEL[k]) return TYPE_LABEL[k];
  const c = clean(k);
  return c ? c[0].toUpperCase() + c.slice(1) : '';
}

function tenureProse(obj) {
  if (obj?.tenure === 'leasehold') {
    const term = num(obj.unexpiredTerm);
    return term === null
      ? 'held leasehold (unexpired term not recorded [VALUER TO CONFIRM])'
      : `held leasehold with ${fmtNum(term)} years unexpired`;
  }
  if (obj?.tenure === 'freehold') return 'held freehold';
  return 'of unrecorded tenure [VALUER TO CONFIRM TENURE]';
}

function areaProse(obj) {
  const ft = areaSqFt(obj);
  if (ft === null) return null;
  const m = num(obj.floorAreaSqM) ?? sqftToSqm(ft);
  return `${fmtNum(ft)} sq ft (${fmtNum(m, 1)} sq m)`;
}

function direction(value, unit) {
  const v = num(value) || 0;
  const amount = unit === 'gbp' ? money(Math.abs(v)) : pct(v);
  return v >= 0 ? `an upward adjustment of ${amount}` : `a downward adjustment of ${amount}`;
}

function bandText(band) {
  switch (band) {
    case 0: return 'under 10%';
    case 5: return '10% to 20%';
    case 10: return '20% to 30%';
    case 15: return '30% to 40%';
    case 20: return '40% to 50%';
    default: return '50% or more';
  }
}

const PURPOSE = Object.fromEntries(INSTRUCTION_TYPES.map(([k, label]) => [k, label]));

// ---------- per comparable prose ----------

function resultFor(list, results, comp, i) {
  return results.find((r) => r && r.id !== null && r.id !== undefined && r.id === comp.id) || results[i] || null;
}

function comparableParagraph(state, comp, r, n, kind) {
  const isRent = kind === 'rentals';
  const parts = [];
  const address = clean([comp.address, comp.postcode].filter(Boolean).join(', ')) || '[ADDRESS NOT RECORDED]';
  const area = areaProse(comp);
  const beds = num(comp.bedrooms);
  let intro = `Comparable ${n}, ${address}, is ${typeProse(comp.propertyType)}`;
  if (beds !== null) intro += ` with ${plural(beds, 'bedroom', 'bedrooms')}`;
  intro += `, ${tenureProse(comp)}`;
  intro += area ? `, with a floor area of ${area}.` : ', with no floor area recorded.';
  parts.push(intro);

  const date = fmtDate(comp.saleDate);
  const price = num(comp.price);
  const src = clean(comp.source);
  if (isRent) {
    let s = price === null ? 'No rent was recorded [VALUER TO CHECK]' : `It was let or listed at a rent of ${money(price)} per calendar month`;
    s += date ? ` on ${date}` : ' (date let or listed not recorded [VALUER TO CHECK])';
    if (src) s += `, as recorded by ${src}`;
    parts.push(s + '.');
  } else {
    let s = date ? `It sold on ${date}` : 'The date of sale was not recorded [VALUER TO CHECK], and it sold';
    s += price === null ? ' at a price that was not recorded [VALUER TO CHECK]' : ` for ${money(price)}`;
    if (src) s += `, as recorded by ${src}`;
    parts.push(s + '.');
  }
  const dist = num(comp.distanceMiles);
  if (dist !== null) parts.push(`It lies ${fmtNum(dist, 2)} miles from the subject property.`);
  if (comp.saleKind === 'auction') parts.push(isRent ? 'This comparable came from an auction.' : 'This was an auction sale.');
  if (comp.saleKind === 'repossession') parts.push(isRent ? 'This comparable was a repossession.' : 'This was a repossession sale.');
  if (comp.saleKind === 'new-build') parts.push(isRent ? 'This is a new build property.' : 'This was a new build sale.');

  // Time adjustment.
  const h = r?.hpi || {};
  if (isRent) {
    parts.push('Rental evidence is not adjusted for movement in house prices.');
  } else if (h.applied && num(h.factor) !== null) {
    const region = clean(state?.hpi?.regionLabel);
    const si = num(comp.hpiAtSale), vi = num(state?.hpi?.valuationIndex);
    let s = 'As the sale took place more than three months before the valuation date, I applied a time adjustment using the UK House Price Index';
    if (region) s += ` for ${region}`;
    if (si !== null && vi !== null) s += `, with an index of ${fmtNum(si, 2)} at the date of sale and ${fmtNum(vi, 2)} at the valuation date`;
    s += `. This gives a factor of ${fmtNum(h.factor, 4)} and a time adjusted price of ${money(h.adjustedPrice)}.`;
    parts.push(s);
    if (h.flag === 'LARGE_HPI') parts.push(`This time adjustment is more than 5% and I have noted it for checking.`);
  } else if (h.required) {
    parts.push('The sale took place more than three months before the valuation date, so a time adjustment is required, but the index figures were not available and no time adjustment has been made [VALUER TO APPLY HPI ADJUSTMENT].');
  } else if (date) {
    parts.push('The sale took place within three months of the valuation date, so no time adjustment was required.');
  }

  // Quantum (size) adjustment.
  const q = r?.quantum || {};
  const diff = num(q.diffPct);
  const sizeWord = diff !== null && diff >= 0 ? 'smaller' : 'larger';
  if (q.overridden) {
    let s = `I applied a quantum (size) adjustment of ${pct(q.adjPct)}${num(q.adjPct) < 0 ? ' downward' : ' upward'}`;
    if (diff !== null) s += `, in place of the stepped band result of ${pct(q.bandAdjPct)}, as the comparable is ${pct(diff)} ${sizeWord} than the subject property`;
    const why = sentence(comp.notes);
    s += `. ${why ? `Rationale: ${why}` : '[VALUER TO ADD RATIONALE]'}`;
    parts.push(s.replace(/\.\.$/, '.'));
  } else if (diff === null) {
    parts.push(area
      ? 'No floor area was recorded for the subject property, so no quantum (size) adjustment was applied.'
      : 'As no floor area was available for this comparable, no quantum (size) adjustment was applied.');
  } else if (!q.applied) {
    parts.push(`The comparable is ${pct(diff)} ${sizeWord} than the subject property. This is within the under 10% band, so I applied no quantum (size) adjustment.`);
  } else {
    parts.push(`The comparable is ${pct(diff)} ${sizeWord} than the subject property. Under the stepped band approach a difference of ${bandText(q.bandPct)} attracts ${direction(q.adjPct, 'pct')}, which I applied to reflect the ${sizeWord} size.`);
  }

  // Qualitative adjustments.
  const rows = (r?.qual?.rows || []).filter((row) => num(row.value) !== null && num(row.value) !== 0);
  if (!rows.length) {
    parts.push('I made no qualitative adjustments to this comparable.');
  } else {
    const labelOf = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label]));
    for (const row of rows) {
      const label = clean(labelOf[row.key] || row.label || row.key);
      const why = sentence(row.note);
      parts.push(`For ${label.toLowerCase()}, I made ${direction(row.value, row.mode)}. ${why ? `Rationale: ${why}` : '[VALUER TO ADD RATIONALE]'}`);
    }
  }

  // Result.
  const unit = isRent ? ' per calendar month' : '';
  if (num(r?.adjustedValue) === null) {
    parts.push(`No fully adjusted ${isRent ? 'rent' : 'value'} can be given as no ${isRent ? 'rent' : 'sale price'} was recorded [VALUER TO CHECK].`);
  } else {
    let s = `This gives a fully adjusted ${isRent ? 'rent' : 'value'} of ${money(r.adjustedValue)}${unit}`;
    if (isRent && num(r.weekly) !== null) s += ` (${money(r.weekly, 2)} per week)`;
    if (!isRent && num(r.perSqFt) !== null) s += `, equal to ${money(r.perSqFt, 2)} per square foot`;
    s += '.';
    if (comp.excluded) s += ' I have excluded this comparable from the range, as explained under outlier treatment.';
    parts.push(s);
  }
  return parts.join(' ');
}

// ---------- outlier treatment ----------

const FLAG_REASON = {
  OVER_12_MONTHS: (k) => `the ${k === 'rentals' ? 'letting' : 'sale'} took place more than 12 months before the valuation date`,
  HPI_MISSING: () => 'the index figures needed for the time adjustment were not available',
  LARGE_HPI: () => 'the time adjustment is more than 5%',
  AUCTION: (k) => (k === 'rentals' ? 'it came from an auction' : 'it was an auction sale, which may not reflect market value'),
  REPOSSESSION: (k) => (k === 'rentals' ? 'it was a repossession' : 'it was a repossession sale, which may not reflect market value'),
  NEW_BUILD: () => 'it was a new build, which may include a new build premium',
  NO_FLOOR_AREA: () => 'no floor area was available, so no size adjustment could be made',
  OVER_HALF_MILE: () => 'it lies more than half a mile from the subject property',
  OUTLIER: () => 'its time adjusted figure lies more than 15% away from the middle of the evidence',
  SHORT_LEASE: () => 'it is leasehold with under 80 years unexpired, so marriage value applies',
  MISSING_PRICE: (k) => `no ${k === 'rentals' ? 'rent' : 'sale price'} was recorded`,
  MISSING_DATE: (k) => `no ${k === 'rentals' ? 'date let or listed' : 'sale date'} was recorded`,
};

function outlierParagraphs(list, results, kind) {
  const out = [];
  list.forEach((comp, i) => {
    const r = resultFor(list, results, comp, i);
    const n = r?.index ?? i + 1;
    const warn = (r?.flags || []).filter((f) => f && f.severity !== 'info');
    if (!warn.length && !comp.excluded) return;
    const reasons = warn.map((f) => (FLAG_REASON[f.code] ? FLAG_REASON[f.code](kind) : clean(FLAG_LABELS[f.code] || f.label || f.code).replace(/\[[^\]]*\]/g, '').trim().toLowerCase()));
    let s = `Comparable ${n}: `;
    if (reasons.length) s += `I have flagged this comparable because ${listJoin(reasons)}.`;
    else s += 'I have not flagged this comparable on the standard checks.';
    if (comp.excluded) {
      const why = sentence(comp.notes);
      s += ` I have excluded it from the range. ${why ? `Reason for exclusion: ${why}` : '[VALUER TO ADD RATIONALE]'}`;
    } else if (num(r?.adjustedValue) === null) {
      s += ' It could not be included in the range as no fully adjusted figure could be worked out.';
    } else {
      s += ' I have kept it in the range but given it reduced weight in forming my opinion.';
    }
    out.push(s);
  });
  return out;
}

// ---------- section builders ----------

function evidenceFacts(list) {
  const dists = list.map((c) => num(c.distanceMiles)).filter((d) => d !== null);
  const dates = list.map((c) => c.saleDate).filter((d) => dateKey(d) !== null).sort((a, b) => dateKey(a) - dateKey(b));
  const sources = [];
  for (const c of list) {
    const s = clean(c.source);
    if (s && !sources.some((x) => x.toLowerCase() === s.toLowerCase())) sources.push(s);
  }
  const maxD = dists.length ? Math.max(...dists) : null;
  const radius = maxD === null ? null : Math.max(0.1, Math.ceil(maxD * 10 - 1e-9) / 10);
  return { radius, first: dates[0] || null, last: dates[dates.length - 1] || null, sources };
}

function evidenceIntro(list, kind) {
  const isRent = kind === 'rentals';
  const noun = isRent ? ['rental comparable', 'rental comparables'] : ['sales comparable', 'sales comparables'];
  const f = evidenceFacts(list);
  const excluded = list.filter((c) => c.excluded).length;
  let s = `I considered ${plural(list.length, noun[0], noun[1])}`;
  s += f.radius === null ? ' [VALUER TO CONFIRM SEARCH RADIUS]' : ` within a search radius of approximately ${fmtNum(f.radius, 1)} miles of the subject property`;
  if (f.first && f.last) {
    const verb = isRent ? 'let or listed' : 'sold';
    s += f.first === f.last ? `, ${verb} on ${fmtDate(f.first)}` : `, ${verb} between ${fmtDate(f.first)} and ${fmtDate(f.last)}`;
  }
  s += '.';
  s += f.sources.length ? ` The evidence was drawn from ${listJoin(f.sources)}.` : ' [VALUER TO CONFIRM SOURCES OF EVIDENCE]';
  if (excluded) s += ` Of these, I excluded ${countWord(excluded)} from the range for the reasons set out below.`;
  return s;
}

function rangeSentence(range, kind) {
  const isRent = kind === 'rentals';
  const low = num(range?.low), high = num(range?.high);
  if (low === null || high === null) {
    return `Range Low and Range High cannot yet be stated because no ${isRent ? 'rental' : 'sales'} comparable has a fully adjusted figure [VALUER TO CHECK].`;
  }
  const count = range.count ?? 0;
  let s = `Having regard to the ${plural(count, isRent ? 'rental comparable' : 'comparable', isRent ? 'rental comparables' : 'comparables')} included, the fully adjusted evidence indicates a range of Range Low ${money(low)} to Range High ${money(high)}`;
  if (isRent) {
    s += ' per calendar month';
    if (num(range.lowWeekly) !== null && num(range.highWeekly) !== null) s += ` (${money(range.lowWeekly, 2)} to ${money(range.highWeekly, 2)} per week)`;
  } else if (num(range.lowPerSqFt) !== null && num(range.highPerSqFt) !== null) {
    s += `, or ${money(range.lowPerSqFt, 2)} to ${money(range.highPerSqFt, 2)} per square foot`;
  }
  s += '.';
  if (count < 3) s += ` This range rests on fewer than three comparables and should be treated with caution [VALUER TO CHECK].`;
  s += ' This range is stated before my valuation opinion and is not itself an opinion of value.';
  return s;
}

function comparableBlock(state, list, results, kind, sectionNo) {
  if (!list.length) return [`No ${kind === 'rentals' ? 'rental' : 'sales'} comparables have been entered [VALUER TO ADD EVIDENCE].`];
  return list.map((comp, i) => {
    const r = resultFor(list, results, comp, i);
    const n = r?.index ?? i + 1;
    return `${sectionNo}.${n} ${comparableParagraph(state, comp, r, n, kind)}`;
  });
}

function outlierBlock(list, results, kind) {
  const paras = outlierParagraphs(list, results, kind);
  if (!list.length) return ['There are no comparables to review.'];
  if (!paras.length) return ['None of the comparables raised a concern on the standard checks, and I have given each of them full consideration.'];
  return paras;
}

function subjectSentence(state) {
  const s = state?.subject || {};
  const address = clean([s.address, s.postcode].filter(Boolean).join(', ')) || '[SUBJECT ADDRESS NOT RECORDED]';
  let out = `I inspected the subject property, ${address}, for the purposes of this valuation`;
  const purpose = PURPOSE[state?.instructionType];
  if (purpose && state.instructionType !== 'other') out += ` (${clean(purpose).toLowerCase()})`;
  out += '.';
  const vd = fmtDate(state?.valuationDate);
  out += vd ? ` The valuation date is ${vd}.` : ' [VALUER TO CONFIRM VALUATION DATE]';
  let d = `The subject property is ${typeProse(s.propertyType)}`;
  const beds = num(s.bedrooms);
  if (beds !== null) d += ` with ${plural(beds, 'bedroom', 'bedrooms')}`;
  d += `, ${tenureProse(s)}`;
  const area = areaProse(s);
  d += area ? `, with a floor area of ${area}.` : ', with no floor area recorded [VALUER TO CONFIRM FLOOR AREA].';
  return `${out} ${d}`;
}

// ---------- public API ----------

/**
 * Plain text Red Book comparables commentary. Never states an adopted value or average.
 * @param {object} state  case state (see model.js)
 * @param {object} [evaluation] calc.evaluate(state) result; worked out if missing
 * @returns {string}
 */
export function buildCommentary(state, evaluation) {
  const s = state && typeof state === 'object' ? state : {};
  const ev = evaluation && typeof evaluation === 'object' ? evaluation : evaluate(s);
  const matrix = s.matrixType || 'sales';
  const sales = Array.isArray(s.sales) ? s.sales.filter(Boolean) : [];
  const rentals = Array.isArray(s.rentals) ? s.rentals.filter(Boolean) : [];
  const mainKind = matrix === 'rental' ? 'rentals' : 'sales';
  const mainList = mainKind === 'rentals' ? rentals : sales;
  const mainResults = (mainKind === 'rentals' ? ev.rentals : ev.sales) || [];
  const mainRange = mainKind === 'rentals' ? ev.rentalRange : ev.salesRange;

  const lines = [];
  const push = (...xs) => { for (const x of xs) lines.push(x); };
  push('Comparable evidence');
  const ref = clean(s.caseRef);
  if (ref) push(`Case reference: ${ref}`);
  push('');

  push('1 Opening', '');
  push(subjectSentence(s), '');
  let open = evidenceIntro(mainList, mainKind);
  if (matrix === 'btl') open += ` As this is a buy to let instruction, I also considered rental evidence, which is set out in section 5.`;
  if (mainKind === 'sales' && s.hpi?.source) open += ` Time adjustments use ${clean(s.hpi.source)}.`;
  push(open, '');

  push(mainKind === 'rentals' ? '2 Rental comparables' : '2 Sales comparables', '');
  for (const p of comparableBlock(s, mainList, mainResults, mainKind, 2)) push(p, '');

  push('3 Outlier treatment', '');
  for (const p of outlierBlock(mainList, mainResults, mainKind)) push(p, '');

  push('4 Range conclusion', '');
  push(rangeSentence(mainRange, mainKind), '');

  let next = 5;
  if (matrix === 'btl') {
    const rr = ev.rentals || [];
    push('5 Rental evidence', '');
    push(evidenceIntro(rentals, 'rentals'), '');
    for (const p of comparableBlock(s, rentals, rr, 'rentals', 5)) push(p, '');
    push('Rental outlier treatment', '');
    for (const p of outlierBlock(rentals, rr, 'rentals')) push(p, '');
    push('Rental range conclusion', '');
    push(rangeSentence(ev.rentalRange, 'rentals'), '');
    next = 6;
  }

  push(`${next} Bridge to valuation opinion`, '');
  push('[VALUER TO COMPLETE]');
  return finalise(lines.join('\n')).replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ---------- markdown table ----------

const WARN_MARK = '⚠️ SURVEYOR TO CHECK';

function cell(text) {
  const t = clean(text).replace(/\|/g, '\\|');
  return t === '' ? 'n/a' : t;
}
function mark(text, flagged) { return flagged ? `${text} ${WARN_MARK}` : text; }
function signedPct(x) {
  const n = num(x);
  if (n === null) return '';
  if (n === 0) return '0%';
  return n > 0 ? `+${pct(n)}` : `minus ${pct(n)}`;
}
function signedMoney(x) {
  const n = num(x);
  if (n === null) return '';
  if (n === 0) return '£0';
  return n > 0 ? `+${money(n)}` : `minus ${money(n)}`;
}
const SHORT_FLAG = {
  OVER_12_MONTHS: 'Over 12 months old', HPI_REQUIRED: 'HPI required', HPI_MISSING: 'HPI index missing',
  LARGE_HPI: 'Large HPI adjustment', AUCTION: 'Auction', REPOSSESSION: 'Repossession', NEW_BUILD: 'New build',
  NO_FLOOR_AREA: 'No floor area', OVER_HALF_MILE: 'Over 0.5 miles', OUTLIER: 'Over 15% from median',
  SHORT_LEASE: 'Lease under 80 years', MISSING_PRICE: 'No price', MISSING_DATE: 'No date',
};

/**
 * Markdown version of the Excel matrix. Flagged cells carry '⚠️ SURVEYOR TO CHECK'.
 * @param {object} state
 * @param {object} [evaluation]
 * @param {'sales'|'rentals'} [kind]
 * @returns {string}
 */
export function buildMarkdownTable(state, evaluation, kind = 'sales') {
  const s = state && typeof state === 'object' ? state : {};
  const ev = evaluation && typeof evaluation === 'object' ? evaluation : evaluate(s);
  const isRent = kind === 'rentals' || kind === 'rental';
  const list = (Array.isArray(isRent ? s.rentals : s.sales) ? (isRent ? s.rentals : s.sales) : []).filter(Boolean);
  const results = (isRent ? ev.rentals : ev.sales) || [];

  const headers = isRent
    ? ['No.', 'Address', 'Type', 'Tenure', 'Unexpired term (years)', 'Bedrooms', 'Floor area sq ft', 'Floor area sq m',
      'Rent £ pcm', 'Date let or listed', 'Distance (miles)', 'Source', 'Quantum difference', 'Quantum adjustment',
      'Qualitative %', 'Qualitative £', 'Adjusted rent £ pcm', 'Adjusted rent £ per week', 'In range', 'Flags']
    : ['No.', 'Address', 'Type', 'Tenure', 'Unexpired term (years)', 'Bedrooms', 'Floor area sq ft', 'Floor area sq m',
      'Sale price £', 'Sale date', 'Distance (miles)', 'Source', 'HPI factor', 'HPI adjusted price £',
      'Quantum difference', 'Quantum adjustment', 'Qualitative %', 'Qualitative £', 'Fully adjusted value £',
      '£ per sq ft', 'In range', 'Flags'];

  const rows = list.map((c, i) => {
    const r = resultFor(list, results, c, i) || {};
    const codes = new Set((r.flags || []).map((f) => f.code));
    const has = (...x) => x.some((k) => codes.has(k));
    const ft = areaSqFt(c);
    const sqm = num(c.floorAreaSqM) ?? (ft === null ? null : sqftToSqm(ft));
    const q = r.quantum || {};
    const h = r.hpi || {};
    const kindNote = c.saleKind && c.saleKind !== 'standard' ? ` (${clean(c.saleKind)})` : '';
    const base = [
      String(r.index ?? i + 1),
      cell([c.address, c.postcode].filter(Boolean).join(', ')),
      cell(typeLabel(c.propertyType)),
      cell(c.tenure ? c.tenure[0].toUpperCase() + c.tenure.slice(1) : ''),
      mark(cell(c.tenure === 'leasehold' ? fmtNum(c.unexpiredTerm) : ''), has('SHORT_LEASE')),
      cell(fmtNum(c.bedrooms)),
      mark(cell(fmtNum(ft)), has('NO_FLOOR_AREA')),
      cell(fmtNum(sqm, 1)),
      mark(cell(money(c.price) + kindNote), has('MISSING_PRICE', 'AUCTION', 'REPOSSESSION', 'NEW_BUILD')),
      mark(cell(fmtDate(c.saleDate)), has('MISSING_DATE', 'OVER_12_MONTHS')),
      mark(cell(fmtNum(c.distanceMiles, 2)), has('OVER_HALF_MILE')),
      cell(c.source),
    ];
    const quantumCells = [
      cell(num(q.diffPct) === null ? '' : `${pct(q.diffPct)} ${num(q.diffPct) >= 0 ? 'smaller' : 'larger'}`),
      cell(signedPct(q.adjPct) + (q.overridden ? ' (override)' : '')),
      cell(signedPct(r.qual?.pct ?? 0)),
      cell(signedMoney(r.qual?.gbp ?? 0)),
    ];
    const included = c.excluded ? 'Excluded' : (r.included ? 'Yes' : 'No');
    const flagText = cell((r.flags || []).map((f) => SHORT_FLAG[f.code] || f.code).join('; ')) ;
    const flagCell = (r.flags || []).some((f) => f.severity !== 'info') ? mark(flagText, true) : flagText;
    if (isRent) {
      return [...base, ...quantumCells,
        mark(cell(money(r.adjustedValue)), has('OUTLIER')), cell(money(r.weekly, 2)), included, flagCell];
    }
    const factor = h.applied && num(h.factor) !== null ? fmtNum(h.factor, 4) : (h.required ? 'Missing' : 'Not required');
    return [...base,
      mark(cell(factor), has('HPI_MISSING', 'LARGE_HPI')),
      cell(money(h.adjustedPrice)),
      ...quantumCells,
      mark(cell(money(r.adjustedValue)), has('OUTLIER')),
      cell(money(r.perSqFt, 2)),
      included, flagCell];
  });

  const line = (cells) => `| ${cells.join(' | ')} |`;
  const out = [line(headers.map(cell)), line(headers.map(() => '---')), ...rows.map(line)];
  const range = isRent ? ev.rentalRange : ev.salesRange;
  const low = num(range?.low), high = num(range?.high);
  out.push('');
  if (low === null || high === null) out.push('Range Low and Range High: not yet available.');
  else {
    let t = `Range Low ${money(low)} to Range High ${money(high)}`;
    if (isRent) t += ' per calendar month';
    else if (num(range.lowPerSqFt) !== null) t += ` (${money(range.lowPerSqFt, 2)} to ${money(range.highPerSqFt, 2)} per sq ft)`;
    out.push(`${t}. These are the lowest and highest fully adjusted figures of the comparables in range; the valuation opinion is the valuer's.`);
  }
  return out.join('\n') + '\n';
}
