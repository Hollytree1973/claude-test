// Results panel (mounted at #vm-results): results matrices, range chart, range summary,
// flags list, exports and case save / open / example / new.
//
// Public API
//   mount(rootEl, store)          renders the panel and keeps it in step with the store.
//   buildExampleCase()            returns a fresh example state (3 bed semi in Chelmsford).
//   validateCase(obj)             -> { ok: true, state } | { ok: false, error } for an opened JSON case.
//
// Contract assumptions (ARCHITECTURE.md leaves these open):
// 1. calc.js is imported statically (store.js already depends on it). export-xlsx.js and
//    commentary.js are imported dynamically on demand, so the panel works without them.
// 2. Which matrices show: sales unless matrixType is 'rental'; rentals when matrixType is
//    'btl' or 'rental'.
// 3. Results are matched to comparables by id, falling back to position.
// 4. Negative numbers use the true minus sign (U+2212), not a hyphen.
// 5. "Per sq ft equivalents" are shown two ways: the spread of £ per sq ft across the included
//    comparables (calc lowPerSqFt / highPerSqFt) and Range Low and Range High divided by the
//    subject floor area. calc's median is used only inside calc and is never shown.
// 6. Print: the Print button adds class 'vm-print-results' to <html> so only this panel prints
//    (A4 landscape, matrices and range summary). Printing from the browser menu is unaffected.
// 7. The example case uses dates relative to today and illustrative HPI figures (labelled as
//    such in hpi.source); it is not live Land Registry data.
// 8. An opened case must be a JSON object with version 1 (a number) and array sales / rentals
//    when present. Comparables missing fields are filled with createComparable defaults.
// The panel NEVER shows an average, weighted average or single adopted value.
import { createComparable, createState, todayIso } from './model.js';
import { sqftToSqm } from './calc.js';

const FIXED_NOTE = "This tool sets out the adjusted evidence range only. The valuation opinion is the RICS Registered Valuer's.";
const MINUS = '−';
const SVGNS = 'http://www.w3.org/2000/svg';

const TYPE_LABELS = {
  detached: 'Detached', 'semi-detached': 'Semi detached', 'end-terrace': 'End terrace', terraced: 'Terraced',
  flat: 'Flat', maisonette: 'Maisonette', bungalow: 'Bungalow',
};
const KIND_LABELS = { standard: 'Standard', auction: 'Auction', repossession: 'Repossession', 'new-build': 'New build' };
const SHORT_FLAG = {
  OVER_12_MONTHS: 'Over 12 months', HPI_REQUIRED: 'HPI needed', HPI_MISSING: 'HPI missing', LARGE_HPI: 'Large HPI',
  AUCTION: 'Auction', REPOSSESSION: 'Repossession', NEW_BUILD: 'New build', NO_FLOOR_AREA: 'No floor area',
  OVER_HALF_MILE: 'Over 0.5 miles', OUTLIER: 'Outlier', SHORT_LEASE: 'Short lease', MISSING_PRICE: 'No price',
  MISSING_DATE: 'No date',
};
const LEASE_WORDS = { green: '100 years or more', amber: '80 to 99 years', red: 'under 80 years' };

// ---------- small helpers ----------

function el(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  setAttrs(n, attrs);
  append(n, kids);
  return n;
}
function svg(tag, attrs = {}, ...kids) {
  const n = document.createElementNS(SVGNS, tag);
  setAttrs(n, attrs);
  append(n, kids);
  return n;
}
function setAttrs(n, attrs) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.setAttribute('class', v);
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
}
function append(n, kids) {
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
}

function num(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string' && x.trim() !== '') { const n = Number(x.replace(/[£,\s%]/g, '')); return Number.isFinite(n) ? n : null; }
  return null;
}
const fmtInt = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
const fmt2 = new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function sign(n, s) { return n < 0 ? MINUS + s : s; }
export function money(x, dp = 0) {
  const n = num(x);
  if (n === null) return '';
  const body = '£' + (dp ? fmt2 : fmtInt).format(Math.abs(n));
  return sign(n, body);
}
function signedMoney(x) {
  const n = num(x);
  if (n === null || n === 0) return n === 0 ? '£0' : '';
  return (n > 0 ? '+' : MINUS) + '£' + fmtInt.format(Math.abs(n));
}
function signedPct(x, dp = 1) {
  const n = num(x);
  if (n === null) return '';
  if (n === 0) return '0%';
  const v = Math.abs(n).toFixed(dp).replace(/\.0+$/, '');
  return (n > 0 ? '+' : MINUS) + v + '%';
}
function plainNum(x, dp = 0) {
  const n = num(x);
  if (n === null) return '';
  const s = dp ? n.toFixed(dp) : fmtInt.format(Math.abs(n));
  return dp ? (n < 0 ? MINUS + Math.abs(n).toFixed(dp) : s) : sign(n, s);
}
function ukDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}
function noHyphen(s) { return String(s ?? '').replace(/\s*[‐-―-]\s*/g, ' ').replace(/\s+/g, ' ').trim(); }
function typeLabel(t) { return TYPE_LABELS[t] || noHyphen(t ? t[0].toUpperCase() + t.slice(1) : ''); }
function tenureLabel(t) { return t ? t[0].toUpperCase() + t.slice(1) : ''; }
function compArea(c) {
  const ft = num(c?.floorAreaSqFt);
  if (ft !== null && ft > 0) return ft;
  const m = num(c?.floorAreaSqM);
  return m !== null && m > 0 ? Math.round(m * 10.764 * 10) / 10 : null;
}
function compSqm(c) {
  const m = num(c?.floorAreaSqM);
  if (m !== null && m > 0) return m;
  const ft = num(c?.floorAreaSqFt);
  return ft !== null && ft > 0 ? sqftToSqm(ft) : null;
}
function addressOf(c) { return noHyphen([c?.address, c?.postcode].filter(Boolean).join(', ')) || 'Address not entered'; }

function resultsFor(list, results) {
  const byId = new Map((results || []).filter((r) => r && r.id != null).map((r) => [r.id, r]));
  const comps = (Array.isArray(list) ? list : []).filter((c) => c && typeof c === 'object');
  return comps.map((c, i) => ({ comp: c, res: (c.id != null && byId.get(c.id)) || (results || [])[i] || null, i }));
}

function wanted(state) {
  const m = state?.matrixType || 'sales';
  return {
    sales: m !== 'rental',
    rentals: m === 'btl' || m === 'rental',
  };
}

// ---------- matrix ----------

function columns(kind) {
  const sales = kind === 'sales';
  const cols = [
    ['no', 'No.'], ['address', 'Address'], ['type', 'Type'], ['tenure', 'Tenure'], ['term', 'Unexpired term (years)'],
    ['beds', 'Beds'], ['sqft', 'Sq ft'], ['sqm', 'Sq m'],
    ['price', sales ? 'Sale price' : 'Rent pcm'], ['date', sales ? 'Sale date' : 'Date let or listed'],
    ['dist', 'Distance (miles)'], ['source', 'Source'], ['kind', sales ? 'Sale kind' : 'Kind'],
  ];
  if (sales) cols.push(['hpiSale', 'HPI at sale'], ['factor', 'HPI factor'], ['hpiPrice', 'HPI adjusted price']);
  cols.push(['diff', 'Size difference'], ['quantum', 'Quantum adj'], ['qualPct', 'Qualitative adj %'], ['qualGbp', 'Qualitative adj £'],
    ['value', sales ? 'Fully adjusted value' : 'Adjusted rent pcm']);
  if (!sales) cols.push(['weekly', 'Adjusted rent per week']);
  cols.push(['psf', sales ? '£ per sq ft' : '£ pcm per sq ft'], ['included', 'In range'], ['flags', 'Flags']);
  return cols;
}

const NUMERIC = new Set(['no', 'term', 'beds', 'sqft', 'sqm', 'price', 'dist', 'hpiSale', 'factor', 'hpiPrice', 'diff', 'quantum', 'qualPct', 'qualGbp', 'value', 'weekly', 'psf']);

function rowCells(kind, comp, res, i) {
  const r = res || {};
  const codes = new Set((r.flags || []).map((f) => f.code));
  const has = (...x) => x.some((k) => codes.has(k));
  const h = r.hpi || {};
  const q = r.quantum || {};
  const ql = r.qual || {};
  const lease = comp.tenure === 'leasehold';
  const diff = num(q.diffPct);
  const factor = num(h.factor);
  const cells = {
    no: [String(r.index ?? i + 1)],
    address: [addressOf(comp)],
    type: [typeLabel(comp.propertyType)],
    tenure: [tenureLabel(comp.tenure)],
    term: [lease ? plainNum(comp.unexpiredTerm) : '', has('SHORT_LEASE'), lease ? r.leaseLight : null],
    beds: [plainNum(comp.bedrooms)],
    sqft: [compArea(comp) === null ? 'None' : plainNum(compArea(comp)), has('NO_FLOOR_AREA')],
    sqm: [compSqm(comp) === null ? '' : plainNum(compSqm(comp), 1)],
    price: [money(comp.price) || 'None', has('MISSING_PRICE', 'AUCTION', 'REPOSSESSION', 'NEW_BUILD')],
    date: [ukDate(comp.saleDate) || 'None', has('MISSING_DATE', 'OVER_12_MONTHS')],
    dist: [plainNum(comp.distanceMiles, 2), has('OVER_HALF_MILE')],
    source: [noHyphen(comp.source)],
    kind: [KIND_LABELS[comp.saleKind] || noHyphen(comp.saleKind), has('AUCTION', 'REPOSSESSION', 'NEW_BUILD')],
    hpiSale: [plainNum(comp.hpiAtSale, 2)],
    factor: [h.applied && factor !== null ? factor.toFixed(4) : (h.required ? 'Missing' : 'Not needed'), has('HPI_MISSING', 'LARGE_HPI')],
    hpiPrice: [money(h.adjustedPrice)],
    diff: [diff === null ? 'None' : `${Math.abs(diff).toFixed(1)}% ${diff > 0 ? 'smaller' : diff < 0 ? 'larger' : 'same'}`],
    quantum: [signedPct(q.adjPct, 0) + (q.overridden ? ' (override)' : '')],
    qualPct: [signedPct(ql.pct ?? 0)],
    qualGbp: [signedMoney(ql.gbp ?? 0)],
    value: [money(r.adjustedValue) || 'None', has('OUTLIER')],
    weekly: [money(r.weekly, 2)],
    psf: [money(r.perSqFt, 2)],
    included: [comp.excluded ? 'Excluded' : (r.included ? 'Yes' : 'No')],
    flags: [(r.flags || []).map((f) => SHORT_FLAG[f.code] || f.code).join(', '), (r.flags || []).some((f) => f.severity !== 'info')],
  };
  return cells;
}

function renderMatrix(kind, state, ev) {
  const list = kind === 'sales' ? state.sales : state.rentals;
  const results = kind === 'sales' ? ev?.sales : ev?.rentals;
  const rows = resultsFor(list, results);
  const cols = columns(kind);
  const title = kind === 'sales' ? 'Sales matrix' : 'Rental matrix';
  const sec = el('section', { class: 'vm-results__matrix', 'data-kind': kind, 'aria-label': title });
  sec.append(el('h3', { class: 'vm-results__h' }, title));
  if (!rows.length) {
    sec.append(el('p', { class: 'vm-results__empty' }, kind === 'sales'
      ? 'No sales comparables yet. Add them in the comparables section, or load the example case below.'
      : 'No rental comparables yet. Add them in the comparables section.'));
    return sec;
  }
  const table = el('table', { class: 'vm-results__table' });
  table.append(el('caption', { class: 'vm-results__sr' }, `${title}: ${rows.length} comparable${rows.length === 1 ? '' : 's'}. Yellow cells need the surveyor to check them.`));
  const thead = el('thead');
  thead.append(el('tr', {}, cols.map(([k, label]) => el('th', { scope: 'col', class: `c-${k}` }, label))));
  table.append(thead);
  const tbody = el('tbody');
  rows.forEach(({ comp, res, i }) => {
    const cells = rowCells(kind, comp, res, i);
    const tr = el('tr', { class: comp.excluded ? 'is-excluded' : (res && !res.included ? 'is-out' : null), 'data-id': comp.id });
    for (const [k] of cols) {
      const [text, flagged, light] = cells[k] || [''];
      const td = el(k === 'address' ? 'th' : 'td', {
        class: [`c-${k}`, NUMERIC.has(k) ? 'is-num' : '', flagged ? 'is-flag' : ''].filter(Boolean).join(' '),
        scope: k === 'address' ? 'row' : null,
      });
      if (light) td.append(el('span', { class: `vm-results__lease vm-results__lease--${light}`, title: `Lease ${LEASE_WORDS[light]}`, 'aria-label': `Lease ${LEASE_WORDS[light]}` }), ' ');
      td.append(text);
      tr.append(td);
    }
    tbody.append(tr);
  });
  table.append(tbody);
  const wrap = el('div', { class: 'vm-results__scroll', tabindex: '0', role: 'region', 'aria-label': `${title}, scroll sideways to see every column` }, table);
  sec.append(wrap);
  const excluded = rows.filter((r) => r.comp.excluded).length;
  sec.append(el('p', { class: 'vm-results__legend' },
    el('span', { class: 'vm-results__key vm-results__key--flag' }), ' Yellow cells: surveyor to check. ',
    excluded ? [el('span', { class: 'vm-results__key vm-results__key--excl' }), ' Grey rows: excluded from the range but shown for reference. '] : null,
    rows.some((r) => r.comp.tenure === 'leasehold') ? 'Lease dots: green 100 years or more, amber 80 to 99 years, red under 80 years.' : null));
  return sec;
}

// ---------- chart ----------

function niceStep(span, target) {
  const raw = span / Math.max(1, target);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return m * p;
  return 10 * p;
}

function axisLabel(v, kind) {
  if (kind === 'sales') {
    const k = v / 1000;
    const s = Math.abs(k) >= 1000 ? (Math.abs(k) / 1000).toFixed(2).replace(/\.?0+$/, '') + 'm' : fmtInt.format(Math.abs(k)) + 'k';
    return sign(v, '£' + s);
  }
  return money(v);
}

export function renderChart(kind, state, ev, width) {
  const list = kind === 'sales' ? state.sales : state.rentals;
  const results = kind === 'sales' ? ev?.sales : ev?.rentals;
  const range = kind === 'sales' ? ev?.salesRange : ev?.rentalRange;
  const rows = resultsFor(list, results).map((r) => {
    const raw = num(r.comp.price);
    const adj = num(r.res?.adjustedValue);
    return { ...r, raw, adj };
  }).filter((r) => r.raw !== null || r.adj !== null);
  if (!rows.length) return null;

  const W = Math.max(280, Math.round(width || 640));
  const narrow = W < 520;
  const left = narrow ? 34 : 190;
  const right = 18;
  const top = 44;
  const rowH = narrow ? 30 : 28;
  const plotH = rows.length * rowH;
  const H = top + plotH + 40;
  const low = num(range?.low), high = num(range?.high);
  const vals = rows.flatMap((r) => [r.raw, r.adj]).concat([low, high]).filter((v) => v !== null);
  let min = Math.min(...vals), max = Math.max(...vals);
  if (min === max) { min *= 0.95; max *= 1.05; if (min === max) { min -= 1; max += 1; } }
  const pad = (max - min) * 0.06;
  min -= pad; max += pad;
  const step = niceStep(max - min, Math.max(2, Math.floor((W - left - right) / (narrow ? 70 : 90))));
  const t0 = Math.ceil(min / step) * step;
  const x = (v) => left + ((v - min) / (max - min)) * (W - left - right);

  const label = kind === 'sales' ? 'Sales evidence range chart' : 'Rental evidence range chart';
  const unit = kind === 'sales' ? '£ thousands' : '£ per calendar month';
  const id = `vm-chart-${kind}`;
  const descParts = rows.map((r) => {
    const name = `Comparable ${r.res?.index ?? r.i + 1}`;
    const a = r.adj === null ? 'no adjusted figure' : `adjusted ${money(r.adj)}`;
    return `${name}: price ${money(r.raw) || 'not entered'}, ${a}${r.comp.excluded ? ', excluded' : ''}`;
  });
  const rangeText = low !== null && high !== null ? `Range Low ${money(low)} to Range High ${money(high)}.` : 'No range yet.';
  const s = svg('svg', {
    class: 'vm-results__chart', width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img',
    'aria-labelledby': `${id}-t ${id}-d`,
  });
  s.append(svg('title', { id: `${id}-t` }, label), svg('desc', { id: `${id}-d` }, `${rangeText} ${descParts.join('. ')}.`));

  // band
  if (low !== null && high !== null) {
    const bx = x(low), bw = Math.max(2, x(high) - bx);
    s.append(svg('rect', { class: 'band', x: bx, y: top - 6, width: bw, height: plotH + 12 }));
    s.append(svg('line', { class: 'band-edge', x1: bx, x2: bx, y1: top - 6, y2: top + plotH + 6 }));
    s.append(svg('line', { class: 'band-edge', x1: bx + bw, x2: bx + bw, y1: top - 6, y2: top + plotH + 6 }));
    const lowT = `Low ${axisLabel(low, kind)}`, highT = `High ${axisLabel(high, kind)}`;
    const lx = Math.max(bx - 4, 4 + lowT.length * 6.4);
    const hx = Math.min(bx + bw + 4, W - 4 - highT.length * 6.4);
    s.append(svg('text', { class: 'band-label', x: lx, y: 16, 'text-anchor': 'end' }, lowT));
    s.append(svg('text', { class: 'band-label', x: hx, y: 32, 'text-anchor': 'start' }, highT));
  }
  // grid + axis
  const axisY = top + plotH + 8;
  s.append(svg('line', { class: 'axis', x1: left, x2: W - right, y1: axisY, y2: axisY }));
  for (let v = t0; v <= max + 1e-9; v += step) {
    const gx = x(v);
    s.append(svg('line', { class: 'grid', x1: gx, x2: gx, y1: top - 6, y2: axisY }));
    s.append(svg('text', { class: 'tick', x: gx, y: axisY + 15, 'text-anchor': 'middle' }, axisLabel(v, kind)));
  }
  s.append(svg('text', { class: 'axis-title', x: left + (W - left - right) / 2, y: H - 4, 'text-anchor': 'middle' }, unit));

  rows.forEach((r, k) => {
    const cy = top + k * rowH + rowH / 2;
    const n = r.res?.index ?? r.i + 1;
    const g = svg('g', { class: `row${r.comp.excluded || (r.res && !r.res.included) ? ' is-excluded' : ''}` });
    const name = narrow ? String(n) : `${n}  ${addressOf(r.comp).slice(0, 26)}${addressOf(r.comp).length > 26 ? '…' : ''}`;
    g.append(svg('text', { class: 'row-label', x: narrow ? 6 : 8, y: cy + 4 }, name));
    if (r.raw !== null && r.adj !== null) g.append(svg('line', { class: 'link', x1: x(r.raw), x2: x(r.adj), y1: cy, y2: cy }));
    if (r.raw !== null) g.append(svg('circle', { class: 'raw', cx: x(r.raw), cy, r: 4 }, svg('title', {}, `Comparable ${n} price ${money(r.raw)}`)));
    if (r.adj !== null) g.append(svg('circle', { class: 'adj', cx: x(r.adj), cy, r: 6 }, svg('title', {}, `Comparable ${n} adjusted ${money(r.adj)}${r.comp.excluded ? ' (excluded)' : ''}`)));
    s.append(g);
  });
  return s;
}

// ---------- summary ----------

function renderSummary(state, ev, want) {
  const card = el('section', { class: 'vm-results__summary', 'aria-label': 'Range summary' });
  card.append(el('h3', { class: 'vm-results__h' }, 'Range summary'));
  const subjectSqFt = num(ev?.subjectSqFt);
  const grid = el('div', { class: 'vm-results__sumgrid' });
  if (want.sales) {
    const r = ev?.salesRange || {};
    const total = (state.sales || []).length;
    const box = el('div', { class: 'vm-results__sumbox', 'data-kind': 'sales' });
    box.append(el('h4', {}, 'Sales evidence'));
    if (num(r.low) === null || num(r.high) === null) {
      box.append(el('p', { class: 'vm-results__empty' }, 'No range yet. Add at least one sales comparable with a price.'));
    } else {
      box.append(el('dl', { class: 'vm-results__range' },
        el('div', {}, el('dt', {}, 'Range Low'), el('dd', { class: 'vm-results__low' }, money(r.low))),
        el('div', {}, el('dt', {}, 'Range High'), el('dd', { class: 'vm-results__high' }, money(r.high)))));
      const lines = [];
      if (num(r.lowPerSqFt) !== null && num(r.highPerSqFt) !== null) lines.push(`Included comparables run from ${money(r.lowPerSqFt, 2)} to ${money(r.highPerSqFt, 2)} per sq ft.`);
      if (subjectSqFt) lines.push(`Over the subject's ${fmtInt.format(subjectSqFt)} sq ft, Range Low is ${money(r.low / subjectSqFt, 2)} and Range High is ${money(r.high / subjectSqFt, 2)} per sq ft.`);
      lines.push(`${r.count ?? 0} of ${total} sales comparable${total === 1 ? '' : 's'} included in the range.`);
      box.append(el('ul', { class: 'vm-results__sumlist' }, lines.map((t) => el('li', {}, t))));
    }
    grid.append(box);
  }
  if (want.rentals) {
    const r = ev?.rentalRange || {};
    const total = (state.rentals || []).length;
    const box = el('div', { class: 'vm-results__sumbox', 'data-kind': 'rentals' });
    box.append(el('h4', {}, 'Rental evidence'));
    if (num(r.low) === null || num(r.high) === null) {
      box.append(el('p', { class: 'vm-results__empty' }, 'No range yet. Add at least one rental comparable with a rent.'));
    } else {
      box.append(el('dl', { class: 'vm-results__range' },
        el('div', {}, el('dt', {}, 'Range Low'), el('dd', { class: 'vm-results__low' }, `${money(r.low)} pcm`)),
        el('div', {}, el('dt', {}, 'Range High'), el('dd', { class: 'vm-results__high' }, `${money(r.high)} pcm`))));
      const lines = [];
      if (num(r.lowWeekly) !== null) lines.push(`That is ${money(r.lowWeekly, 2)} to ${money(r.highWeekly, 2)} per week.`);
      const ps = resultsFor(state.rentals, ev?.rentals).filter((x) => x.res?.included && num(x.res?.perSqFt) !== null).map((x) => x.res.perSqFt);
      if (ps.length) lines.push(`Included rentals run from ${money(Math.min(...ps), 2)} to ${money(Math.max(...ps), 2)} pcm per sq ft.`);
      if (subjectSqFt) lines.push(`Over the subject's ${fmtInt.format(subjectSqFt)} sq ft, Range Low is ${money(r.low / subjectSqFt, 2)} and Range High is ${money(r.high / subjectSqFt, 2)} pcm per sq ft.`);
      lines.push(`${r.count ?? 0} of ${total} rental comparable${total === 1 ? '' : 's'} included in the range.`);
      box.append(el('ul', { class: 'vm-results__sumlist' }, lines.map((t) => el('li', {}, t))));
    }
    grid.append(box);
  }
  card.append(grid);
  card.append(el('p', { class: 'vm-results__note' }, FIXED_NOTE));
  return card;
}

// ---------- flags ----------

function renderFlags(state, ev, want) {
  const sec = el('section', { class: 'vm-results__flags', 'aria-label': 'Flags to check' });
  sec.append(el('h3', { class: 'vm-results__h' }, 'Points to check'));
  const warnings = (ev?.warnings || []).filter(Boolean);
  if (warnings.length) sec.append(el('ul', { class: 'vm-results__warnings' }, warnings.map((w) => el('li', {}, noHyphen(w)))));
  let any = false;
  for (const kind of ['sales', 'rentals']) {
    if (!want[kind]) continue;
    const rows = resultsFor(kind === 'sales' ? state.sales : state.rentals, kind === 'sales' ? ev?.sales : ev?.rentals)
      .filter((r) => (r.res?.flags || []).length || r.comp.excluded);
    if (!rows.length) continue;
    any = true;
    sec.append(el('h4', {}, kind === 'sales' ? 'Sales comparables' : 'Rental comparables'));
    const ol = el('ul', { class: 'vm-results__flaglist' });
    for (const { comp, res, i } of rows) {
      const items = (res?.flags || []).map((f) => el('li', { class: f.severity === 'info' ? 'is-info' : 'is-warn' }, noHyphen(f.label)));
      if (comp.excluded) items.push(el('li', { class: 'is-info' }, 'Excluded from the range by the surveyor.'));
      ol.append(el('li', { class: 'vm-results__flagcomp' },
        el('strong', {}, `Comparable ${res?.index ?? i + 1}: `), addressOf(comp),
        el('ul', {}, items)));
    }
    sec.append(ol);
  }
  if (!any && !warnings.length) sec.append(el('p', { class: 'vm-results__empty' }, 'Nothing flagged.'));
  return sec;
}

// ---------- example case ----------

function isoMonthsAgo(baseIso, months, day) {
  const [y, m] = baseIso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - months, 1));
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
}

/** A realistic built in example: 3 bed semi in Chelmsford, six sales comparables. */
export function buildExampleCase(valuationDate = todayIso()) {
  const s = createState();
  s.caseRef = 'EXAMPLE 001';
  s.valuationDate = valuationDate;
  s.instructionType = 'mortgage';
  s.matrixType = 'sales';
  Object.assign(s.subject, {
    address: '14 Gloucester Avenue, Chelmsford', postcode: 'CM2 9DU', propertyType: 'semi-detached', tenure: 'freehold',
    bedrooms: 3, floorAreaSqFt: 1050, floorAreaSqM: sqftToSqm(1050), condition: 'good', parking: 'driveway',
    parkingArea: 'chelmsford-suburbs', epc: 'D', garden: true, gardenNotes: 'South facing rear garden of about 60 feet',
    features: 'Single storey rear extension; kitchen refitted in 2022', defects: '',
  });
  // Illustrative monthly index: gentle rise of about 2.6% a year, a small dip last winter.
  const series = [];
  const vMonth = valuationDate.slice(0, 7);
  for (let k = 18; k >= 0; k -= 1) {
    const month = isoMonthsAgo(vMonth + '-01', k, 1).slice(0, 7);
    const wobble = [0, 0.3, 0.1, -0.4, -0.6, -0.2, 0.2][k % 7];
    series.push({ month, index: Math.round((141.2 - k * 0.3 + wobble) * 100) / 100 });
  }
  s.hpi = {
    regionSlug: 'chelmsford', regionLabel: 'Chelmsford', series,
    valuationIndex: series[series.length - 1].index,
    source: 'Example figures for illustration only, not live HM Land Registry data',
  };
  const idx = (iso) => { const m = iso.slice(0, 7); const e = [...series].reverse().find((p) => p.month <= m); return e ? e.index : null; };
  const pct = (value, note) => ({ mode: 'pct', value, note });
  const gbp = (value, note) => ({ mode: 'gbp', value, note });
  const comps = [
    { address: '22 Gloucester Avenue, Chelmsford', postcode: 'CM2 9DU', propertyType: 'semi-detached', bedrooms: 3,
      floorAreaSqFt: 1010, price: 415000, months: 2, day: 14, distanceMiles: 0.05,
      adjustments: { kitchen: pct(3, 'Original kitchen of around 2005; the subject was refitted in 2022') } },
    { address: '8 Lime Walk, Chelmsford', postcode: 'CM2 9NJ', propertyType: 'semi-detached', bedrooms: 3,
      floorAreaSqFt: 1180, price: 448000, months: 5, day: 3, distanceMiles: 0.31,
      adjustments: { condition: pct(-2, 'Fully refurbished throughout shortly before sale'), gardens: pct(1, 'Smaller, north facing rear garden') } },
    { address: '41 Longstomps Avenue, Chelmsford', postcode: 'CM2 9BY', propertyType: 'semi-detached', bedrooms: 3,
      floorAreaSqFt: 985, price: 399500, months: 7, day: 22, distanceMiles: 0.42,
      adjustments: { location: pct(2, 'Busier through road with more traffic noise') } },
    { address: '17 Hillside Grove, Chelmsford', postcode: 'CM2 9DE', propertyType: 'end-terrace', bedrooms: 3,
      floorAreaSqFt: 920, price: 362000, months: 10, day: 9, distanceMiles: 0.58, saleKind: 'auction', source: 'Auction house results',
      adjustments: { condition: pct(5, 'Sold at auction needing modernisation; the subject is in good order'), type: pct(2, 'End of terrace rather than semi detached') } },
    { address: '3 Baddow Court, Baddow Road, Chelmsford', postcode: 'CM2 9QS', propertyType: 'maisonette', bedrooms: 3,
      floorAreaSqFt: 995, price: 318000, months: 13, day: 27, distanceMiles: 0.36, tenure: 'leasehold', unexpiredTerm: 92,
      excluded: true, notes: 'Leasehold maisonette; kept for reference only and excluded from the range',
      adjustments: { tenure: pct(4, 'Leasehold with 92 years unexpired; the subject is freehold'), type: pct(6, 'Maisonette with no private garden'), gardens: pct(3, 'Shared communal garden only') } },
    { address: '63 Meadgate Avenue, Chelmsford', postcode: 'CM2 7LJ', propertyType: 'semi-detached', bedrooms: 3,
      floorAreaSqFt: 1075, price: 421000, months: 15, day: 11, distanceMiles: 0.47, source: 'Land Registry',
      adjustments: { garage: gbp(-10000, 'Detached single garage; the subject has none'), epc: pct(1, 'EPC rating E against the subject at D') } },
  ];
  s.sales = comps.map(({ months, day, ...c }) => {
    const saleDate = isoMonthsAgo(valuationDate, months, day);
    return createComparable({
      tenure: 'freehold', source: 'Rightmove SCT', saleKind: 'standard', ...c,
      floorAreaSqM: sqftToSqm(c.floorAreaSqFt), saleDate,
      hpiAtSale: months > 3 ? idx(saleDate) : null,
    });
  });
  return s;
}

// ---------- case validation ----------

export function validateCase(obj) {
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, error: 'This file is not a saved case from this tool.' };
  if (obj.version === undefined) return { ok: false, error: 'This file has no version number, so it does not look like a saved case from this tool.' };
  if (typeof obj.version !== 'number') return { ok: false, error: 'The version number in this file is not valid.' };
  if (obj.version > 1) return { ok: false, error: `This case was saved by a newer version of the tool (version ${obj.version}). Please update the tool and try again.` };
  if (obj.version !== 1) return { ok: false, error: `Case version ${obj.version} is not supported.` };
  for (const k of ['sales', 'rentals']) {
    if (obj[k] !== undefined && !Array.isArray(obj[k])) return { ok: false, error: `The ${k} list in this file is not valid.` };
  }
  if (obj.subject !== undefined && (typeof obj.subject !== 'object' || obj.subject === null)) return { ok: false, error: 'The subject property details in this file are not valid.' };
  const base = createState();
  const clean = (list) => (list || []).filter((c) => c && typeof c === 'object').map((c) => createComparable({ ...c, ...(c.id ? { id: c.id } : {}), adjustments: c.adjustments && typeof c.adjustments === 'object' ? c.adjustments : {} }));
  const state = {
    ...base, ...obj,
    subject: { ...base.subject, ...(obj.subject || {}) },
    hpi: { ...base.hpi, ...(obj.hpi && typeof obj.hpi === 'object' ? obj.hpi : {}) },
    sales: clean(obj.sales), rentals: clean(obj.rentals),
  };
  return { ok: true, state };
}

function hasData(state) {
  return !!((state.sales || []).length || (state.rentals || []).length || state.subject?.address || state.caseRef);
}

function safeName(s) { return noHyphen(String(s || '').replace(/[\\/:*?"<>|]+/g, ' ')).slice(0, 80); }

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: filename, class: 'vm-results__sr' });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

async function copyText(text, fallbackEl) {
  try {
    if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through */ }
  try {
    const ta = fallbackEl || el('textarea', { class: 'vm-results__sr' });
    if (!fallbackEl) { ta.value = text; document.body.append(ta); }
    ta.focus(); ta.select();
    const ok = document.execCommand && document.execCommand('copy');
    if (!fallbackEl) ta.remove();
    return !!ok;
  } catch { return false; }
}

// ---------- mount ----------

export function mount(rootEl, store) {
  if (!rootEl) throw new Error('ui-results: mount point missing');
  if (!document.querySelector('link[href$="ui-results.css"]')) {
    try { document.head.append(el('link', { rel: 'stylesheet', href: new URL('../css/ui-results.css', import.meta.url).href })); } catch { /* ignore */ }
  }
  rootEl.classList.add('vm-results');
  rootEl.replaceChildren();

  const printHead = el('header', { class: 'vm-results__printhead' });
  const summarySlot = el('div', { class: 'vm-results__slot-summary' });
  const chartSlot = el('section', { class: 'vm-results__charts', 'aria-label': 'Range chart' });
  const matrixSlot = el('div', { class: 'vm-results__slot-matrix' });
  const flagsSlot = el('div', { class: 'vm-results__slot-flags' });
  const status = el('p', { class: 'vm-results__status', role: 'status', 'aria-live': 'polite' });

  const btn = (label, action, cls = '') => el('button', { type: 'button', class: `vm-results__btn ${cls}`.trim(), 'data-action': action }, label);
  const fileInput = el('input', { type: 'file', accept: '.json,application/json', class: 'vm-results__file', 'aria-label': 'Choose a saved case file', hidden: true });
  const preview = el('textarea', { class: 'vm-results__preview', readonly: true, rows: '14', 'aria-label': 'Red Book commentary preview' });
  const previewBox = el('details', { class: 'vm-results__previewbox' },
    el('summary', {}, 'Commentary preview'),
    el('p', { class: 'vm-results__hint' }, 'This is the text copied to your clipboard. Read it through and complete the parts marked for the valuer.'),
    preview);
  previewBox.hidden = true;

  const actions = el('section', { class: 'vm-results__actions', 'aria-label': 'Export and case actions' },
    el('h3', { class: 'vm-results__h' }, 'Export and save'),
    el('div', { class: 'vm-results__btnrow' },
      btn('Download Excel', 'xlsx', 'is-primary'), btn('Copy Red Book commentary', 'commentary'),
      btn('Copy markdown table', 'markdown'), btn('Print', 'print')),
    el('div', { class: 'vm-results__btnrow' },
      btn('Save case', 'save'), btn('Open case', 'open'), btn('Load example case', 'example'), btn('New case', 'new', 'is-quiet')),
    fileInput, status, previewBox);

  rootEl.append(printHead, summarySlot, chartSlot, matrixSlot, flagsSlot, actions);

  const say = (msg, bad = false) => { status.textContent = msg; status.classList.toggle('is-bad', bad); };

  let commentaryMod = null;
  async function loadCommentary() {
    if (!commentaryMod) commentaryMod = await import('./commentary.js');
    return commentaryMod;
  }

  async function refreshPreview() {
    if (previewBox.hidden) return;
    try { const m = await loadCommentary(); preview.value = m.buildCommentary(store.get(), store.evaluation()); } catch { /* keep old text */ }
  }

  actions.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-action]');
    if (!b) return;
    const act = b.dataset.action;
    const state = store.get();
    const ev = store.evaluation();
    try {
      if (act === 'xlsx') {
        say('Preparing the Excel file…');
        b.disabled = true;
        try {
          const mod = await import('./export-xlsx.js');
          const name = await mod.exportXlsx(state, ev);
          say(`Excel file downloaded${typeof name === 'string' ? `: ${name}` : '.'}`);
        } finally { b.disabled = false; }
      } else if (act === 'commentary') {
        const m = await loadCommentary();
        const text = m.buildCommentary(state, ev);
        preview.value = text;
        previewBox.hidden = false;
        previewBox.open = true;
        const ok = await copyText(text, null);
        say(ok ? 'Commentary copied to the clipboard. A preview is shown below.' : 'Could not copy automatically. Select the text in the preview below and copy it.', !ok);
      } else if (act === 'markdown') {
        const m = await loadCommentary();
        const w = wanted(state);
        const parts = [];
        if (w.sales) parts.push('Sales matrix\n\n' + m.buildMarkdownTable(state, ev, 'sales'));
        if (w.rentals) parts.push('Rental matrix\n\n' + m.buildMarkdownTable(state, ev, 'rentals'));
        const ok = await copyText(parts.join('\n\n'), null);
        say(ok ? 'Markdown table copied to the clipboard.' : 'Could not copy the table automatically. Your browser blocked clipboard access.', !ok);
      } else if (act === 'print') {
        fillPrintHead();
        document.documentElement.classList.add('vm-print-results');
        const done = () => { document.documentElement.classList.remove('vm-print-results'); window.removeEventListener('afterprint', done); };
        window.addEventListener('afterprint', done);
        window.print();
        setTimeout(done, 1500);
      } else if (act === 'save') {
        const date = todayIso().split('-').reverse().join(' ');
        const name = `Gibsons case ${safeName(state.caseRef || state.subject?.address || 'untitled')} ${date}.json`;
        download(new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' }), name);
        say(`Case saved as ${name}.`);
      } else if (act === 'open') {
        fileInput.value = '';
        fileInput.click();
      } else if (act === 'example') {
        if (hasData(state) && !window.confirm('Load the example case? This replaces the case you have open now. Save it first if you want to keep it.')) return;
        store.replace(buildExampleCase());
        say('Example case loaded: a 3 bed semi detached house in Chelmsford with six sales comparables. Its HPI figures are for illustration only.');
      } else if (act === 'new') {
        if (!window.confirm('Start a new case? This clears everything you have entered. Save the case first if you want to keep it.')) return;
        store.replace(createState());
        preview.value = ''; previewBox.hidden = true;
        say('New case started.');
      }
    } catch (err) {
      console.warn('ui-results action failed', act, err);
      const what = { xlsx: 'The Excel file could not be made', commentary: 'The commentary could not be made', markdown: 'The markdown table could not be made' }[act] || 'That did not work';
      say(`${what}. ${err && err.message ? noHyphen(err.message) : 'Please try again.'}`, true);
    }
  });

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    try {
      const text = await f.text();
      let obj;
      try { obj = JSON.parse(text); } catch { say('This file could not be read. It is not a valid saved case.', true); return; }
      const v = validateCase(obj);
      if (!v.ok) { say(v.error, true); return; }
      if (hasData(store.get()) && !window.confirm('Open this case? It replaces the case you have open now.')) return;
      store.replace(v.state);
      say(`Opened ${f.name}.`);
    } catch (err) {
      say('This file could not be opened.', true);
    }
  });

  function fillPrintHead() {
    const s = store.get();
    printHead.replaceChildren(
      el('div', { class: 'vm-results__brand' }, 'Gibsons Surveyors'),
      el('div', {}, el('strong', {}, 'Comparable evidence matrix'),
        ` for ${noHyphen(s.subject?.address || 'the subject property')}${s.subject?.postcode ? ', ' + s.subject.postcode : ''}`),
      el('div', {}, [s.caseRef ? `Case ${noHyphen(s.caseRef)}` : '', s.valuationDate ? `Valuation date ${ukDate(s.valuationDate)}` : '', s.valuer ? noHyphen(s.valuer) : '']
        .filter(Boolean).join('   '),
      ),
    );
  }

  let chartWidth = 0;
  function drawCharts() {
    const state = store.get(), ev = store.evaluation(), w = wanted(state);
    const width = chartSlot.clientWidth || rootEl.clientWidth || 640;
    chartWidth = width;
    chartSlot.replaceChildren(el('h3', { class: 'vm-results__h' }, 'Evidence range chart'));
    let drew = false;
    for (const kind of ['sales', 'rentals']) {
      if (!w[kind]) continue;
      const c = renderChart(kind, state, ev, width - 2);
      if (!c) continue;
      drew = true;
      chartSlot.append(el('figure', { class: 'vm-results__fig', 'data-kind': kind }, c,
        el('figcaption', {}, kind === 'sales' ? 'Sales: ' : 'Rentals: ',
          el('span', { class: 'vm-results__dot vm-results__dot--raw' }), ' price as recorded, ',
          el('span', { class: 'vm-results__dot vm-results__dot--adj' }), ' fully adjusted figure, ',
          el('span', { class: 'vm-results__swatch' }), ' Range Low to Range High. Grey dots are excluded.')));
    }
    if (!drew) chartSlot.append(el('p', { class: 'vm-results__empty' }, 'The chart appears once comparables with prices are entered.'));
  }

  function render() {
    const state = store.get(), ev = store.evaluation(), w = wanted(state);
    fillPrintHead();
    if (!ev) {
      summarySlot.replaceChildren(el('p', { class: 'vm-results__empty' }, 'The results could not be worked out. Check the entries above.'));
      chartSlot.replaceChildren(); matrixSlot.replaceChildren(); flagsSlot.replaceChildren();
      return;
    }
    summarySlot.replaceChildren(renderSummary(state, ev, w));
    matrixSlot.replaceChildren(...['sales', 'rentals'].filter((k) => w[k]).map((k) => renderMatrix(k, state, ev)));
    flagsSlot.replaceChildren(renderFlags(state, ev, w));
    drawCharts();
    refreshPreview();
  }

  let queued = false;
  const schedule = () => {
    if (queued) return;
    queued = true;
    (window.requestAnimationFrame || setTimeout)(() => { queued = false; render(); });
  };
  const unsub = store.subscribe(schedule);
  render();

  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => { if (Math.abs((chartSlot.clientWidth || 0) - chartWidth) > 8) drawCharts(); });
    ro.observe(chartSlot);
  }
  return { render, destroy() { unsub(); if (ro) ro.disconnect(); } };
}

