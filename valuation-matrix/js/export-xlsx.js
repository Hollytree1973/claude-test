// Gibsons valuation comparison tool: branded Excel workbook export.
//
// Public API
//   exportXlsx(state, evaluation, opts?)   loads the library lazily, builds, downloads. Resolves to the filename.
//   buildWorkbook(state, evaluation, XLSXlib)  returns the SheetJS workbook object (no download; Node friendly).
//   writeWorkbook(wb, XLSXlib)             returns a Uint8Array .xlsx with frozen panes applied.
//   xlsxFilename(state)                    the download filename.
//   loadXlsxLib(url?)                      lazily injects the pinned script tag, resolves to window.XLSX.
//   XLSX_URL, XLSX_INTEGRITY               the pinned CDN build (jsDelivr file hash checked against npm tarball).
//
// Contract assumptions (ARCHITECTURE.md is silent on these):
// 1. exportXlsx takes an optional third argument { libUrl } (used by test harnesses); if
//    window.XLSX from xlsx-js-style is already present it is reused. If evaluation is missing,
//    calc.evaluate(state) is used.
// 2. The SheetJS community writer cannot write frozen panes, so writeWorkbook() rewrites each
//    sheet's <sheetView> inside the zip (using the library's own CFB zip helper). The frozen
//    split is recorded on each sheet as ws['!freeze'] = { xSplit, ySplit }.
// 3. Live formulas: HPI factor, HPI adjusted price, fully adjusted value and £ per sq ft are
//    formulas over the input cells in the same row; Qualitative adj % and £ on the matrices are
//    formulas pointing at the totals on the Adjustments sheet, so editing an adjustment there
//    flows through. Range Low and Range High are MIN(IF(...)) / MAX(IF(...)) array formulas over
//    rows whose Included cell says "Yes". Every formula cell also carries the value calc.js worked
//    out, so the file reads correctly before Excel recalculates.
// 4. Comparable floor area shown in Sq ft is the sq ft figure, or the sq m figure converted
//    (as calc.js does), so the £ per sq ft formula matches the tool.
// 5. Rental Matrix: no HPI columns (calc never applies HPI to rentals); rent pcm, adjusted rent
//    pcm and adjusted rent per week (pcm x 12 / 52) columns, and £ pcm per sq ft.
// 6. Display text replaces hyphens in stored values with spaces (for example 'semi-detached'
//    shows as 'Semi detached') so nothing in the workbook prose carries a hyphen.
// The workbook never contains a single adopted value, an average or a weighted average.

import { CATEGORIES, INSTRUCTION_TYPES } from './model.js';
import { evaluate, FLAG_LABELS } from './calc.js';

export const XLSX_URL = 'https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
export const XLSX_INTEGRITY = 'sha384-OUW9euuUyxyHcAhTqbhI+Iyb8LMssXt/cpz0yXhs9UWG2/R/uaWdakx/4cfww7Vb';

// ---------- brand styles ----------

const ORANGE = 'FF6600', TEXT = '333333', WHITE = 'FFFFFF', ALT = 'F9F9F9', FLAG_FILL = 'FFFACD', FLAG_TEXT = 'CC0000';
const FONT = 'Arial';
const GBP = '£#,##0', GBP2 = '£#,##0.00', PCT = '0.0%', DATE = 'dd/mm/yyyy';
const thin = { style: 'thin', color: { rgb: 'D9D9D9' } };
const BORDER = { top: thin, bottom: thin, left: thin, right: thin };

const ST = {
  brand: { font: { name: FONT, sz: 16, bold: true, color: { rgb: ORANGE } } },
  title: { font: { name: FONT, sz: 12, bold: true, color: { rgb: TEXT } } },
  sub: { font: { name: FONT, sz: 10, color: { rgb: TEXT } } },
  header: {
    font: { name: FONT, sz: 10, bold: true, color: { rgb: WHITE } },
    fill: { patternType: 'solid', fgColor: { rgb: ORANGE } },
    alignment: { vertical: 'center', horizontal: 'center', wrapText: true }, border: BORDER,
  },
  section: {
    font: { name: FONT, sz: 11, bold: true, color: { rgb: WHITE } },
    fill: { patternType: 'solid', fgColor: { rgb: ORANGE } },
  },
  label: { font: { name: FONT, sz: 10, bold: true, color: { rgb: TEXT } }, alignment: { vertical: 'top' } },
  value: { font: { name: FONT, sz: 10, color: { rgb: TEXT } }, alignment: { vertical: 'top', wrapText: true } },
  rangeLabel: { font: { name: FONT, sz: 11, bold: true, color: { rgb: TEXT } }, border: { top: { style: 'medium', color: { rgb: ORANGE } } } },
  rangeValue: { font: { name: FONT, sz: 11, bold: true, color: { rgb: ORANGE } }, border: { top: { style: 'medium', color: { rgb: ORANGE } } } },
  note: { font: { name: FONT, sz: 9, italic: true, color: { rgb: '666666' } } },
  todo: { font: { name: FONT, sz: 11, bold: true, color: { rgb: FLAG_TEXT } }, fill: { patternType: 'solid', fgColor: { rgb: FLAG_FILL } } },
};

const LEASE_FILL = { green: 'E2EFDA', amber: 'FFE699', red: 'F8CBAD' };

function dataStyle(rowIdx, { fmt, align, flag, wrap, muted, lease } = {}) {
  const s = {
    font: { name: FONT, sz: 10, color: { rgb: TEXT } },
    fill: { patternType: 'solid', fgColor: { rgb: rowIdx % 2 ? ALT : WHITE } },
    alignment: { vertical: 'top', horizontal: align || 'left', wrapText: !!wrap }, border: BORDER,
  };
  if (fmt) s.numFmt = fmt;
  if (muted) s.font = { ...s.font, color: { rgb: '808080' }, italic: true };
  if (lease && LEASE_FILL[lease]) s.fill = { patternType: 'solid', fgColor: { rgb: LEASE_FILL[lease] } };
  if (flag) {
    s.fill = { patternType: 'solid', fgColor: { rgb: FLAG_FILL } };
    s.font = { name: FONT, sz: 10, color: { rgb: FLAG_TEXT }, bold: false };
  }
  return s;
}

// ---------- small helpers ----------

function num(x) {
  if (typeof x === 'number') return Number.isFinite(x) ? x : null;
  if (typeof x === 'string' && x.trim() !== '') {
    const n = Number(x.replace(/[£,\s%]/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** 'semi-detached' -> 'Semi detached'. Never leaves a hyphen or dash in display text. */
export function human(v) {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/[‐-―\-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function prose(v) {
  // Free text typed by the surveyor: keep their words but swap dashes between words for commas or spaces.
  if (v === null || v === undefined) return '';
  return String(v).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y, mo, d) => `${d}/${mo}/${y}`)
    .replace(/\s+[‒-―\-]+\s+/g, ', ').replace(/(\d)\s*[‒-―\-]\s*(\d)/g, '$1 to $2')
    .replace(/[‐-―\-]/g, ' ').replace(/[ \t]+/g, ' ').trim();
}

function parseIso(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d };
}

/** ISO date to Excel serial (1900 date system), timezone free. */
function excelDate(iso) {
  const p = parseIso(iso);
  if (!p) return null;
  return (Date.UTC(p.y, p.mo - 1, p.d) - Date.UTC(1899, 11, 30)) / 86400000;
}

function ukDate(iso) {
  const p = parseIso(iso);
  return p ? `${String(p.d).padStart(2, '0')}/${String(p.mo).padStart(2, '0')}/${p.y}` : '';
}

function areaFt(c) {
  const ft = num(c?.floorAreaSqFt);
  if (ft !== null && ft > 0) return ft;
  const m = num(c?.floorAreaSqM);
  return m !== null && m > 0 ? Math.round(m * 10.764 * 10) / 10 : null;
}
function areaM(c) {
  const m = num(c?.floorAreaSqM);
  if (m !== null && m > 0) return m;
  const ft = num(c?.floorAreaSqFt);
  return ft !== null && ft > 0 ? Math.round((ft / 10.764) * 10) / 10 : null;
}

function firstLine(address) {
  return String(address || '').split(/[\n,]/)[0].trim();
}

function safeName(s) {
  return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80).trim();
}

export function xlsxFilename(state) {
  const who = safeName(state?.caseRef) || safeName(firstLine(state?.subject?.address));
  const date = safeName(state?.valuationDate);
  return ['Gibsons comparable matrix', who, date].filter(Boolean).join(' ') + '.xlsx';
}

function instructionLabel(key) {
  const hit = INSTRUCTION_TYPES.find(([k]) => k === key);
  return hit ? hit[1] : human(key);
}

const MATRIX_LABELS = { sales: 'Sales', btl: 'Buy to let (sales and rentals)', rental: 'Rental only' };

function wants(state) {
  const m = state?.matrixType || 'sales';
  return { sales: m === 'sales' || m === 'btl', rentals: m === 'btl' || m === 'rental' };
}

function resultFor(list, comp, i) {
  if (!Array.isArray(list)) return null;
  const byIndex = list[i];
  if (byIndex && (byIndex.id === comp.id || comp.id == null)) return byIndex;
  return list.find((r) => r && r.id === comp.id) || byIndex || null;
}

function flagText(result) {
  const flags = Array.isArray(result?.flags) ? result.flags : [];
  return flags.map((f) => prose(f.label || FLAG_LABELS[f.code] || f.code)).join('\n');
}

// ---------- sheet writer ----------

class Sheet {
  constructor(X, name) {
    this.X = X; this.name = name; this.ws = {}; this.maxR = 0; this.maxC = 0;
    this.cols = []; this.rows = []; this.merges = [];
  }
  addr(r, c) { return this.X.utils.encode_cell({ r, c }); }
  set(r, c, value, style, extra = {}) {
    const cell = {};
    if (value === null || value === undefined || value === '') { cell.t = 's'; cell.v = ''; }
    else if (typeof value === 'number') { cell.t = 'n'; cell.v = value; }
    else if (typeof value === 'boolean') { cell.t = 'b'; cell.v = value; }
    else { cell.t = 's'; cell.v = String(value); }
    if (style) { cell.s = style; if (style.numFmt) cell.z = style.numFmt; }
    Object.assign(cell, extra);
    this.ws[this.addr(r, c)] = cell;
    this.maxR = Math.max(this.maxR, r); this.maxC = Math.max(this.maxC, c);
    return cell;
  }
  formula(r, c, f, cached, style, array = false) {
    const cell = this.set(r, c, cached, style);
    cell.f = f;
    if (array) cell.F = `${this.addr(r, c)}:${this.addr(r, c)}`;
    return cell;
  }
  finish(freeze) {
    this.ws['!ref'] = this.X.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: this.maxR, c: this.maxC } });
    this.ws['!cols'] = this.cols;
    if (this.rows.length) this.ws['!rows'] = this.rows;
    if (this.merges.length) this.ws['!merges'] = this.merges;
    if (freeze) this.ws['!freeze'] = freeze;
    return this.ws;
  }
}

function col(i) {
  let s = '', n = i + 1;
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

function titleBlock(sh, title, state, span) {
  sh.set(0, 0, 'Gibsons Surveyors', ST.brand);
  sh.set(1, 0, title, ST.title);
  const bits = [];
  const addr = prose(state?.subject?.address);
  if (addr) bits.push(`Subject: ${addr.replace(/\s*\n\s*/g, ', ')}`);
  if (state?.caseRef) bits.push(`Case reference: ${prose(state.caseRef)}`);
  if (state?.valuationDate) bits.push(`Valuation date: ${ukDate(state.valuationDate)}`);
  if (state?.valuer) bits.push(`Valuer: ${prose(state.valuer)}`);
  sh.set(2, 0, bits.join('   |   '), ST.sub);
  sh.merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: Math.min(span, 8) } }, { s: { r: 2, c: 0 }, e: { r: 2, c: Math.min(span, 12) } });
  sh.rows[0] = { hpt: 22 };
}

const HEADER_ROW = 4; // zero based; rows 0 to 2 title block, row 3 spacer
const FIRST_DATA = HEADER_ROW + 1;

// Column definitions. Each column: key, label, width, and how to fill a cell.
function matrixColumns(kind) {
  const sales = kind === 'sales';
  const cols = [
    { key: 'no', label: 'No.', w: 5, align: 'center' },
    { key: 'address', label: 'Address', w: 34, wrap: true },
    { key: 'type', label: 'Type', w: 13 },
    { key: 'tenure', label: 'Tenure', w: 11 },
    { key: 'term', label: 'Unexpired term', w: 10, fmt: '0', align: 'right' },
    { key: 'beds', label: 'Beds', w: 6, fmt: '0', align: 'center' },
    { key: 'sqft', label: 'Sq ft', w: 8, fmt: '#,##0', align: 'right' },
    { key: 'sqm', label: 'Sq m', w: 8, fmt: '0.0', align: 'right' },
    { key: 'price', label: sales ? 'Sale price' : 'Rent pcm', w: 12, fmt: GBP, align: 'right' },
    { key: 'date', label: sales ? 'Sale date' : 'Date let or listed', w: 11, fmt: DATE, align: 'center' },
    { key: 'dist', label: 'Distance (miles)', w: 9, fmt: '0.00', align: 'right' },
    { key: 'source', label: 'Source', w: 14, wrap: true },
    { key: 'kind', label: sales ? 'Sale kind' : 'Kind', w: 12 },
  ];
  if (sales) {
    cols.push(
      { key: 'hpiSale', label: 'HPI at sale', w: 9, fmt: '0.00', align: 'right' },
      { key: 'hpiVal', label: 'HPI at valuation', w: 10, fmt: '0.00', align: 'right' },
      { key: 'factor', label: 'HPI factor', w: 9, fmt: '0.0000', align: 'right' },
      { key: 'hpiPrice', label: 'HPI adjusted price', w: 13, fmt: GBP, align: 'right' },
    );
  }
  cols.push(
    { key: 'diff', label: 'Size diff %', w: 9, fmt: PCT, align: 'right' },
    { key: 'quantum', label: 'Quantum adj %', w: 10, fmt: PCT, align: 'right' },
    { key: 'qualPct', label: 'Qualitative adj %', w: 11, fmt: PCT, align: 'right' },
    { key: 'qualGbp', label: 'Qualitative adj £', w: 12, fmt: sales ? GBP : GBP2, align: 'right' },
    { key: 'value', label: sales ? 'Fully adjusted value' : 'Adjusted rent pcm', w: 14, fmt: GBP, align: 'right' },
  );
  if (!sales) cols.push({ key: 'weekly', label: 'Adjusted rent per week', w: 12, fmt: GBP2, align: 'right' });
  cols.push(
    { key: 'psf', label: sales ? '£ per sq ft' : '£ pcm per sq ft', w: 10, fmt: GBP2, align: 'right' },
    { key: 'included', label: 'Included', w: 9, align: 'center' },
    { key: 'flags', label: 'Flags', w: 60, wrap: true },
  );
  cols.forEach((c, i) => { c.i = i; c.L = col(i); });
  return cols;
}

// adjRefs: { [compIndex]: { pct: 'Adjustments!D21', gbp: 'Adjustments!D22' } }
function buildMatrix(X, state, evaluation, kind, adjRefs) {
  const sales = kind === 'sales';
  const list = (sales ? state.sales : state.rentals) || [];
  const results = sales ? evaluation?.sales : evaluation?.rentals;
  const range = sales ? evaluation?.salesRange : evaluation?.rentalRange;
  const name = sales ? 'Sales Matrix' : 'Rental Matrix';
  const sh = new Sheet(X, name);
  const cols = matrixColumns(kind);
  const C = Object.fromEntries(cols.map((c) => [c.key, c]));
  titleBlock(sh, sales ? 'Sales comparable matrix' : 'Rental comparable matrix', state, cols.length - 1);

  cols.forEach((c) => sh.set(HEADER_ROW, c.i, c.label, ST.header));
  sh.rows[HEADER_ROW] = { hpt: 32 };
  sh.cols = cols.map((c) => ({ wch: c.w }));

  const valuationIndex = num(state?.hpi?.valuationIndex);
  const last = FIRST_DATA + Math.max(list.length, 1) - 1;

  list.forEach((comp, i) => {
    const r = FIRST_DATA + i, R = r + 1; // R is the 1 based Excel row
    const res = resultFor(results, comp, i) || {};
    const ref = (k) => `${C[k].L}${R}`;
    const flags = flagText(res);
    const excluded = !res.included;
    const st = (k, extra = {}) => dataStyle(i, { fmt: C[k].fmt, align: C[k].align, wrap: C[k].wrap, ...extra });
    const put = (k, v, extra) => sh.set(r, C[k].i, v, st(k, extra));

    put('no', res.index ?? i + 1);
    put('address', prose([comp.address, comp.postcode].filter(Boolean).join(', ')));
    put('type', human(comp.propertyType));
    put('tenure', human(comp.tenure));
    put('term', comp.tenure === 'leasehold' ? num(comp.unexpiredTerm) : null, { lease: res.leaseLight });
    put('beds', num(comp.bedrooms));
    const ft = areaFt(comp);
    put('sqft', ft);
    put('sqm', areaM(comp));
    const price = num(comp.price);
    put('price', price);
    put('date', excelDate(comp.saleDate));
    put('dist', num(comp.distanceMiles));
    put('source', prose(comp.source));
    put('kind', human(comp.saleKind));

    if (sales) {
      const h = res.hpi || {};
      const hs = num(comp.hpiAtSale);
      put('hpiSale', hs);
      if (h.required) {
        put('hpiVal', valuationIndex);
        const cachedFactor = h.applied && h.factor ? h.factor : 1;
        sh.formula(r, C.factor.i, `IF(AND(ISNUMBER(${ref('hpiSale')}),ISNUMBER(${ref('hpiVal')}),N(${ref('hpiSale')})>0),${ref('hpiVal')}/${ref('hpiSale')},1)`,
          cachedFactor, st('factor', { flag: h.flag === 'HPI_MISSING' }));
      } else {
        put('hpiVal', null);
        sh.set(r, C.factor.i, 'Not required', st('factor', { muted: true }));
      }
      const cachedHpiPrice = price === null ? '' : (h.applied && h.factor ? price * h.factor : price);
      sh.formula(r, C.hpiPrice.i,
        `IF(ISNUMBER(${ref('price')}),IF(ISNUMBER(${ref('factor')}),${ref('price')}*${ref('factor')},${ref('price')}),"")`,
        cachedHpiPrice, st('hpiPrice'));
    }

    const q = res.quantum || {};
    put('diff', num(q.diffPct) === null ? null : q.diffPct / 100);
    put('quantum', (num(q.adjPct) ?? 0) / 100);
    const qual = res.qual || { pct: 0, gbp: 0 };
    const refs = adjRefs?.[i];
    const qp = (num(qual.pct) ?? 0) / 100, qg = num(qual.gbp) ?? 0;
    if (refs) {
      sh.formula(r, C.qualPct.i, refs.pct, qp, st('qualPct'));
      sh.formula(r, C.qualGbp.i, refs.gbp, qg, st('qualGbp'));
    } else {
      put('qualPct', qp);
      put('qualGbp', qg);
    }

    const base = sales ? ref('hpiPrice') : ref('price');
    const value = num(res.adjustedValue);
    sh.formula(r, C.value.i,
      `IF(ISNUMBER(${base}),${base}*(1+N(${ref('quantum')}))*(1+N(${ref('qualPct')}))+N(${ref('qualGbp')}),"")`,
      value === null ? '' : value, st('value', { fmt: GBP }));
    if (!sales) {
      sh.formula(r, C.weekly.i, `IF(ISNUMBER(${ref('value')}),${ref('value')}*12/52,"")`,
        num(res.weekly) ?? (value === null ? '' : (value * 12) / 52), st('weekly'));
    }
    sh.formula(r, C.psf.i, `IF(AND(ISNUMBER(${ref('value')}),ISNUMBER(${ref('sqft')})),IF(${ref('sqft')}>0,${ref('value')}/${ref('sqft')},""),"")`,
      num(res.perSqFt) ?? '', st('psf'));
    put('included', excluded ? 'No' : 'Yes', { muted: excluded });
    put('flags', flags, { flag: !!flags, wrap: true });
    const lines = flags ? flags.split('\n').length : 1;
    const addrLines = Math.ceil(String(sh.ws[sh.addr(r, C.address.i)].v).length / 36) || 1;
    sh.rows[r] = { hpt: Math.max(15, 13 * Math.max(lines, addrLines) + 2) };
  });

  if (!list.length) {
    sh.set(FIRST_DATA, C.address.i, sales ? 'No sales comparables entered' : 'No rental comparables entered', ST.note);
  }

  // Range rows: MIN and MAX of included rows only. No average, no adopted value.
  const rr = last + 2;
  const span = (k) => `${C[k].L}${FIRST_DATA + 1}:${C[k].L}${last + 1}`;
  const inc = span('included');
  const minF = (k) => `IF(COUNTIF(${inc},"Yes")=0,"",MIN(IF(${inc}="Yes",IF(ISNUMBER(${span(k)}),${span(k)}))))`;
  const maxF = (k) => `IF(COUNTIF(${inc},"Yes")=0,"",MAX(IF(${inc}="Yes",IF(ISNUMBER(${span(k)}),${span(k)}))))`;
  const cells = {};
  const writeRange = (row, label, fn, which) => {
    sh.set(row, C.address.i, label, ST.rangeLabel);
    for (let c = 0; c < cols.length; c += 1) if (c !== C.address.i) sh.set(row, c, '', { border: ST.rangeLabel.border });
    const v = num(range?.[which]);
    cells[which] = { sheet: name, addr: `${C.value.L}${row + 1}` };
    sh.formula(row, C.value.i, fn('value'), v ?? '', { ...ST.rangeValue, numFmt: GBP }, true);
    if (!sales) {
      const wk = num(range?.[which === 'low' ? 'lowWeekly' : 'highWeekly']);
      cells[which + 'Weekly'] = { sheet: name, addr: `${C.weekly.L}${row + 1}` };
      sh.formula(row, C.weekly.i, fn('weekly'), wk ?? '', { ...ST.rangeValue, numFmt: GBP2 }, true);
    }
    const p = num(range?.[which === 'low' ? 'lowPerSqFt' : 'highPerSqFt']);
    const psf = p ?? perSqFtFromResults(results, which);
    cells[which + 'PerSqFt'] = { sheet: name, addr: `${C.psf.L}${row + 1}` };
    sh.formula(row, C.psf.i, fn('psf'), psf ?? '', { ...ST.rangeValue, numFmt: GBP2 }, true);
  };
  writeRange(rr, 'Range Low', minF, 'low');
  writeRange(rr + 1, 'Range High', maxF, 'high');
  sh.set(rr + 2, C.address.i, `Count of comparables included: ${num(range?.count) ?? 0}`, ST.note);
  sh.set(rr + 3, C.address.i, 'This matrix gives a range of evidence only. The valuation opinion is solely that of the RICS Registered Valuer.', ST.note);
  sh.set(rr + 4, C.address.i, 'Rows marked No in the Included column are shown for reference but left out of the range. Change Yes or No to test the evidence.', ST.note);
  if (sales) sh.set(rr + 5, C.address.i, 'HPI factor = HPI at valuation divided by HPI at sale. Fully adjusted value = HPI adjusted price x (1 + quantum %) x (1 + qualitative %) + qualitative £.', ST.note);
  else sh.set(rr + 5, C.address.i, 'Adjusted rent = rent pcm x (1 + quantum %) x (1 + qualitative %) + qualitative £. Rent per week = rent pcm x 12 divided by 52.', ST.note);

  const ws = sh.finish({ xSplit: 2, ySplit: HEADER_ROW + 1 });
  ws['!autofilter'] = { ref: `A${HEADER_ROW + 1}:${cols[cols.length - 1].L}${last + 1}` };
  return { ws, name, cells };
}

function perSqFtFromResults(results, which) {
  if (!Array.isArray(results)) return null;
  const v = results.filter((r) => r && r.included && num(r.perSqFt) !== null).map((r) => r.perSqFt);
  if (!v.length) return null;
  return which === 'low' ? Math.min(...v) : Math.max(...v);
}

// ---------- Adjustments sheet ----------

function categoryList(state, use) {
  const known = new Set(CATEGORIES.map((c) => c.key));
  const extra = [];
  const scan = (list) => (list || []).forEach((c) => Object.keys(c?.adjustments || {}).forEach((k) => {
    if (!known.has(k) && !extra.includes(k)) extra.push(k);
  }));
  if (use.sales) scan(state.sales);
  if (use.rentals) scan(state.rentals);
  return [...CATEGORIES.map((c) => ({ key: c.key, label: c.label, guidance: c.guidance })), ...extra.map((k) => ({ key: k, label: human(k), guidance: '' }))];
}

function buildAdjustments(X, state, evaluation, use) {
  const sh = new Sheet(X, 'Adjustments');
  const cats = categoryList(state, use);
  const groups = [];
  if (use.sales) (state.sales || []).forEach((c, i) => groups.push({ kind: 'sales', comp: c, i, res: resultFor(evaluation?.sales, c, i), title: `Sale ${i + 1}` }));
  if (use.rentals) (state.rentals || []).forEach((c, i) => groups.push({ kind: 'rentals', comp: c, i, res: resultFor(evaluation?.rentals, c, i), title: `Rental ${i + 1}` }));

  sh.set(0, 0, 'Gibsons Surveyors', ST.brand);
  sh.set(1, 0, 'Qualitative adjustments by category', ST.title);
  sh.set(2, 0, 'Positive means the comparable is inferior to the subject (value added). Negative means it is superior (value deducted). Mode is % or £.', ST.sub);
  sh.merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: 10 } });
  const H1 = 3, H2 = 4, first = 5;
  sh.set(H1, 0, 'No.', ST.header); sh.set(H2, 0, '', ST.header);
  sh.set(H1, 1, 'Category', ST.header); sh.set(H2, 1, '', ST.header);
  sh.merges.push({ s: { r: H1, c: 0 }, e: { r: H2, c: 0 } }, { s: { r: H1, c: 1 }, e: { r: H2, c: 1 } });
  sh.cols = [{ wch: 5 }, { wch: 28 }];
  sh.rows[H1] = { hpt: 30 };

  const refs = { sales: {}, rentals: {} };
  const totalPctRow = first + cats.length, totalGbpRow = totalPctRow + 1;

  groups.forEach((g, gi) => {
    const c0 = 2 + gi * 3;
    const addr = firstLine(g.comp.address);
    sh.set(H1, c0, prose(`${g.title}${addr ? ': ' + addr : ''}`), ST.header);
    sh.set(H1, c0 + 1, '', ST.header); sh.set(H1, c0 + 2, '', ST.header);
    sh.merges.push({ s: { r: H1, c: c0 }, e: { r: H1, c: c0 + 2 } });
    sh.set(H2, c0, 'Mode', ST.header); sh.set(H2, c0 + 1, 'Value', ST.header); sh.set(H2, c0 + 2, 'Note', ST.header);
    sh.cols[c0] = { wch: 6 }; sh.cols[c0 + 1] = { wch: 10 }; sh.cols[c0 + 2] = { wch: 30 };
    const adj = g.comp.adjustments || {};
    cats.forEach((cat, ci) => {
      const r = first + ci;
      const a = adj[cat.key];
      const v = a ? num(a.value) : null;
      const note = a && typeof a.note === 'string' ? prose(a.note) : '';
      const has = a && (v !== null && v !== 0 || note);
      const mode = a?.mode === 'gbp' ? 'gbp' : 'pct';
      sh.set(r, c0, has ? (mode === 'gbp' ? '£' : '%') : '', dataStyle(ci, { align: 'center' }));
      sh.set(r, c0 + 1, has ? (mode === 'gbp' ? (v ?? 0) : (v ?? 0) / 100) : null,
        dataStyle(ci, { fmt: mode === 'gbp' ? GBP : PCT, align: 'right' }));
      sh.set(r, c0 + 2, note, dataStyle(ci, { wrap: true }));
    });
    const modeR = `${col(c0)}${first + 1}:${col(c0)}${first + cats.length}`;
    const valR = `${col(c0 + 1)}${first + 1}:${col(c0 + 1)}${first + cats.length}`;
    const qual = g.res?.qual || {};
    sh.formula(totalPctRow, c0 + 1, `SUMIF(${modeR},"%",${valR})`, (num(qual.pct) ?? 0) / 100, { ...ST.rangeValue, numFmt: PCT });
    sh.formula(totalGbpRow, c0 + 1, `SUMIF(${modeR},"£",${valR})`, num(qual.gbp) ?? 0, { ...ST.rangeValue, numFmt: GBP });
    sh.set(totalPctRow, c0, '', { border: ST.rangeLabel.border }); sh.set(totalPctRow, c0 + 2, '', { border: ST.rangeLabel.border });
    refs[g.kind][g.i] = { pct: `Adjustments!${col(c0 + 1)}${totalPctRow + 1}`, gbp: `Adjustments!${col(c0 + 1)}${totalGbpRow + 1}` };
  });

  cats.forEach((cat, ci) => {
    sh.set(first + ci, 0, ci + 1, dataStyle(ci, { align: 'center' }));
    sh.set(first + ci, 1, cat.label, dataStyle(ci, {}));
  });
  sh.set(totalPctRow, 1, 'Total qualitative %', ST.rangeLabel);
  sh.set(totalPctRow, 0, '', { border: ST.rangeLabel.border });
  sh.set(totalGbpRow, 1, 'Total qualitative £', ST.label);
  if (!groups.length) sh.set(first, 2, 'No comparables entered', ST.note);
  sh.set(totalGbpRow + 2, 1, 'Change a mode to % or £ and the value beside it; the totals and the matrix update when Excel recalculates.', ST.note);
  sh.set(totalGbpRow + 3, 1, 'Other must be named in the note.', ST.note);

  return { ws: sh.finish({ xSplit: 2, ySplit: H2 + 1 }), refs };
}

// ---------- Summary sheet ----------

function buildSummary(X, state, evaluation, use, cellsBy) {
  const sh = new Sheet(X, 'Summary');
  sh.cols = [{ wch: 34 }, { wch: 70 }];
  sh.set(0, 0, 'Gibsons Surveyors', ST.brand);
  sh.set(1, 0, 'Comparable evidence summary', ST.title);
  sh.rows[0] = { hpt: 22 };
  let r = 3;
  const section = (t) => { sh.set(r, 0, t, ST.section); sh.set(r, 1, '', ST.section); r += 1; };
  const row = (label, value, style) => {
    sh.set(r, 0, label, ST.label);
    sh.set(r, 1, value === null || value === undefined ? '' : value, style || ST.value);
    r += 1;
  };
  const ref = (cell) => `'${cell.sheet}'!${cell.addr}`;
  const s = state.subject || {};
  const n = (x) => num(x);

  section('Case details');
  row('Case reference', prose(state.caseRef));
  row('Valuer', prose(state.valuer));
  const vd = excelDate(state.valuationDate);
  row('Valuation date', vd, vd === null ? ST.value : { ...ST.value, numFmt: DATE, alignment: { horizontal: 'left' } });
  row('Instruction type', instructionLabel(state.instructionType));
  row('Matrix type', MATRIX_LABELS[state.matrixType] || human(state.matrixType));
  r += 1;

  section('Subject property');
  row('Address', prose(s.address));
  row('Postcode', prose(s.postcode));
  row('Property type', human(s.propertyType));
  row('Tenure', human(s.tenure));
  if (s.tenure === 'leasehold') {
    row('Unexpired term (years)', n(s.unexpiredTerm));
    row('Ground rent (£ a year)', n(s.groundRent), { ...ST.value, numFmt: GBP, alignment: { horizontal: 'left' } });
    row('Ground rent review', prose(s.groundRentReview));
  }
  row('Bedrooms', n(s.bedrooms), { ...ST.value, alignment: { horizontal: 'left' } });
  row('Floor area (sq ft)', areaFt(s), { ...ST.value, numFmt: '#,##0', alignment: { horizontal: 'left' } });
  row('Floor area (sq m)', areaM(s), { ...ST.value, numFmt: '0.0', alignment: { horizontal: 'left' } });
  row('Condition', human(s.condition));
  row('Parking', human(s.parking));
  if (s.parkingArea) row('Parking area', human(s.parkingArea));
  row('EPC rating', prose(s.epc));
  row('Garden', s.garden ? 'Yes' : 'No');
  if (s.gardenNotes) row('Garden notes', prose(s.gardenNotes));
  row('Special features', prose(s.features));
  row('Significant defects', prose(s.defects));
  r += 1;

  section('House price index (time adjustment)');
  row('HPI region', prose(state.hpi?.regionLabel || human(state.hpi?.regionSlug)));
  row('HPI source', prose(state.hpi?.source));
  row('HPI at valuation date', n(state.hpi?.valuationIndex), { ...ST.value, numFmt: '0.00', alignment: { horizontal: 'left' } });
  r += 1;

  const rangeRows = (title, cells, range, opts) => {
    section(title);
    const money = (cell, v, fmt) => {
      sh.set(r, 0, cell.label, ST.label);
      if (cell.ref) sh.formula(r, 1, ref(cell.ref), v ?? '', { ...ST.rangeValue, border: undefined, numFmt: fmt, alignment: { horizontal: 'left' } });
      else sh.set(r, 1, v ?? '', { ...ST.rangeValue, border: undefined, numFmt: fmt, alignment: { horizontal: 'left' } });
      r += 1;
    };
    money({ label: opts.lowLabel, ref: cells?.low }, n(range?.low), GBP);
    money({ label: opts.highLabel, ref: cells?.high }, n(range?.high), GBP);
    if (opts.weekly) {
      money({ label: 'Range Low (rent per week)', ref: cells?.lowWeekly }, n(range?.lowWeekly), GBP2);
      money({ label: 'Range High (rent per week)', ref: cells?.highWeekly }, n(range?.highWeekly), GBP2);
    }
    money({ label: opts.psfLow, ref: cells?.lowPerSqFt }, n(range?.lowPerSqFt) ?? perSqFtFromResults(opts.results, 'low'), GBP2);
    money({ label: opts.psfHigh, ref: cells?.highPerSqFt }, n(range?.highPerSqFt) ?? perSqFtFromResults(opts.results, 'high'), GBP2);
    row('Comparables included in the range', n(range?.count) ?? 0, { ...ST.value, alignment: { horizontal: 'left' } });
    r += 1;
  };
  if (use.sales) rangeRows('Sales evidence range', cellsBy.sales, evaluation?.salesRange, {
    lowLabel: 'Range Low', highLabel: 'Range High', psfLow: 'Range Low per sq ft', psfHigh: 'Range High per sq ft', results: evaluation?.sales,
  });
  if (use.rentals) rangeRows('Rental evidence range', cellsBy.rentals, evaluation?.rentalRange, {
    lowLabel: 'Range Low (rent pcm)', highLabel: 'Range High (rent pcm)', weekly: true,
    psfLow: 'Range Low (£ pcm per sq ft)', psfHigh: 'Range High (£ pcm per sq ft)', results: evaluation?.rentals,
  });

  section('Flags for the surveyor');
  const flagLines = [];
  const collect = (list, results, word) => (list || []).forEach((c, i) => {
    const res = resultFor(results, c, i);
    (res?.flags || []).forEach((f) => flagLines.push([`${word} ${i + 1}${firstLine(c.address) ? ': ' + prose(firstLine(c.address)) : ''}`, prose(f.label || FLAG_LABELS[f.code] || f.code)]));
  });
  if (use.sales) collect(state.sales, evaluation?.sales, 'Sale');
  if (use.rentals) collect(state.rentals, evaluation?.rentals, 'Rental');
  (evaluation?.warnings || []).forEach((w) => flagLines.push(['General', prose(w)]));
  if (!flagLines.length) row('None', 'No flags raised.');
  const flagStyle = { ...ST.value, fill: { patternType: 'solid', fgColor: { rgb: FLAG_FILL } }, font: { name: FONT, sz: 10, color: { rgb: FLAG_TEXT } } };
  flagLines.forEach(([who, text]) => row(who, text, flagStyle));
  r += 1;

  section('Valuation opinion');
  sh.set(r, 0, 'Valuation opinion: [VALUER TO COMPLETE]', ST.todo);
  sh.set(r, 1, '', ST.todo);
  sh.merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
  r += 1;
  sh.set(r, 0, 'The figures above are a range of comparable evidence only, given as Range Low and Range High. No single adopted value is given. The valuation opinion is solely that of the RICS Registered Valuer.', ST.note);
  sh.merges.push({ s: { r, c: 0 }, e: { r, c: 1 } });
  sh.rows[r] = { hpt: 26 };
  sh.ws[sh.addr(r, 0)].s = { ...ST.note, alignment: { wrapText: true, vertical: 'top' } };
  return sh.finish({ xSplit: 0, ySplit: 2 });
}

// ---------- workbook ----------

export function buildWorkbook(state, evaluation, XLSXlib) {
  const X = XLSXlib || (typeof globalThis !== 'undefined' ? globalThis.XLSX : null);
  if (!X || !X.utils) throw new Error('The Excel library is not loaded.');
  const st = state || {};
  const ev = evaluation || evaluate(st);
  const use = wants(st);
  const wb = X.utils.book_new();
  const adj = buildAdjustments(X, st, ev, use);
  const cellsBy = {};
  const sheets = [];
  if (use.sales) { const m = buildMatrix(X, st, ev, 'sales', adj.refs.sales); cellsBy.sales = m.cells; sheets.push(m); }
  if (use.rentals) { const m = buildMatrix(X, st, ev, 'rentals', adj.refs.rentals); cellsBy.rentals = m.cells; sheets.push(m); }
  sheets.forEach((m) => X.utils.book_append_sheet(wb, m.ws, m.name));
  X.utils.book_append_sheet(wb, adj.ws, 'Adjustments');
  X.utils.book_append_sheet(wb, buildSummary(X, st, ev, use, cellsBy), 'Summary');
  wb.Props = { Title: 'Gibsons comparable matrix', Author: prose(st.valuer) || 'Gibsons Surveyors', Company: 'Gibsons Surveyors' };
  wb.Workbook = { ...(wb.Workbook || {}), CalcPr: { fullCalcOnLoad: true } };
  return wb;
}

function paneXml(f) {
  const x = f.xSplit || 0, y = f.ySplit || 0;
  if (!x && !y) return null;
  const top = `${x ? col(x) : 'A'}${y + 1}`;
  const pane = x && y ? 'bottomRight' : y ? 'bottomLeft' : 'topRight';
  const attrs = [x ? `xSplit="${x}"` : '', y ? `ySplit="${y}"` : '', `topLeftCell="${top}"`, `activePane="${pane}"`, 'state="frozen"'].filter(Boolean).join(' ');
  return `<pane ${attrs}/><selection pane="${pane}" activeCell="${top}" sqref="${top}"/>`;
}

/** Write the workbook to xlsx bytes and add the frozen panes the community writer leaves out. */
export function writeWorkbook(wb, XLSXlib) {
  const X = XLSXlib || globalThis.XLSX;
  const raw = X.write(wb, { type: 'array', bookType: 'xlsx', compression: true });
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
  const freezes = wb.SheetNames.map((n) => wb.Sheets[n]['!freeze']);
  if (!freezes.some(Boolean) || !X.CFB) return bytes;
  try {
    const zip = X.CFB.read(bytes, { type: 'array' });
    const dec = new TextDecoder(), enc = new TextEncoder();
    freezes.forEach((f, i) => {
      if (!f) return;
      const pane = paneXml(f);
      if (!pane) return;
      const idx = zip.FullPaths.findIndex((p) => p.endsWith(`xl/worksheets/sheet${i + 1}.xml`));
      if (idx < 0) return;
      const entry = zip.FileIndex[idx];
      const xml = dec.decode(entry.content);
      const out = xml.replace(/<sheetView\b([^>]*?)\/>/, (m, a) => `<sheetView${a}>${pane}</sheetView>`);
      if (out !== xml) { entry.content = enc.encode(out); entry.size = entry.content.length; }
    });
    const patched = X.CFB.write(zip, { fileType: 'zip', type: 'array', compression: true });
    return patched instanceof Uint8Array ? patched : new Uint8Array(patched);
  } catch (e) {
    console.warn('Could not add frozen panes; exporting without them.', e);
    return bytes;
  }
}

// ---------- lazy library load ----------

let loading = null;

export function loadXlsxLib(url = XLSX_URL) {
  const g = typeof window !== 'undefined' ? window : globalThis;
  if (g.XLSX && g.XLSX.utils && g.XLSX.style_version) return Promise.resolve(g.XLSX);
  if (loading) return loading;
  if (typeof document === 'undefined') return Promise.reject(new Error('The Excel library can only be loaded in a browser.'));
  loading = new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = url;
    if (url === XLSX_URL) { el.integrity = XLSX_INTEGRITY; el.crossOrigin = 'anonymous'; }
    el.async = true;
    el.dataset.vmXlsx = '1';
    el.onload = () => {
      if (g.XLSX && g.XLSX.utils) resolve(g.XLSX);
      else { el.remove(); loading = null; reject(new Error('The Excel library loaded but did not start. Please try again.')); }
    };
    el.onerror = () => {
      el.remove(); loading = null;
      reject(new Error('Could not load the Excel library. Please check your internet connection and try again.'));
    };
    document.head.appendChild(el);
  });
  return loading;
}

function download(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.rel = 'noopener'; a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 4000);
}

export async function exportXlsx(state, evaluation, opts = {}) {
  const X = await loadXlsxLib(opts.libUrl || XLSX_URL);
  const wb = buildWorkbook(state, evaluation || evaluate(state), X);
  const bytes = writeWorkbook(wb, X);
  const filename = xlsxFilename(state);
  download(bytes, filename);
  return filename;
}
