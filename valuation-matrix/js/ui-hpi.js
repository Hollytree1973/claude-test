// HPI panel (mounted at #vm-hpi). Region picker, fetch from HM Land Registry, paste route,
// valuation date index, per comparable index at sale with factor, and a source line.
//
// Assumptions: the stylesheet css/ui-hpi.css is loaded by index.html (integrator); mount() also
// injects a <link> to it if none is present so the panel looks right when used on its own.
// The table re-renders only when its structure changes (comparable ids, sale dates, valuation
// date); values are updated in place so a focused input is never destroyed while typing.
import {
  REGIONS, REGION_GROUPS, regionBySlug, fetchSeries, parseSeriesCsv, indexEntryFor, latestMonth,
  applySeries, suggestRegionForPostcode, suggestRegionForArea, browseUrl, monthOf, addMonths,
  formatMonth, normaliseSeries,
} from './hpi.js';

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  return n;
};

function toNum(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[,\s]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
}
function longDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${d} ${formatMonth(`${y}-${String(m).padStart(2, '0')}`, true)}`;
}
function todayIso() { return new Date().toISOString().slice(0, 10); }
function setVal(input, v) {
  if (document.activeElement === input) return;
  const s = v === null || v === undefined ? '' : String(v);
  if (input.value !== s) input.value = s;
}
function changeWords(factor) {
  if (factor === null || factor === undefined || !Number.isFinite(factor)) return '';
  const pct = (factor - 1) * 100;
  if (Math.abs(pct) < 0.05) return 'no change';
  return `${Math.abs(pct).toFixed(1)}% ${pct > 0 ? 'up' : 'down'}`;
}

let uid = 0;

export function mount(rootEl, store) {
  if (!rootEl) return () => {};
  uid += 1;
  const id = (s) => `vm-hpi-${uid}-${s}`;
  ensureCss();
  rootEl.classList.add('vm-hpi');
  rootEl.innerHTML = '';

  // ---- region picker ----
  const select = el('select', { id: id('region'), class: 'vm-hpi-region', 'aria-describedby': id('region-hint') });
  select.append(el('option', { value: '', text: 'Choose an area' }));
  for (const g of REGION_GROUPS) {
    const og = el('optgroup', { label: g });
    for (const r of REGIONS.filter((x) => x.group === g)) og.append(el('option', { value: r.slug, text: r.label }));
    select.append(og);
  }
  const regionHint = el('p', { id: id('region-hint'), class: 'vm-hpi-hint' });

  const fetchBtn = el('button', { type: 'button', class: 'vm-hpi-btn vm-hpi-btn-primary', 'data-action': 'fetch', text: 'Fetch index figures' });
  const status = el('p', { class: 'vm-hpi-status', role: 'status', 'aria-live': 'polite' });
  const browseLink = el('a', { class: 'vm-hpi-link', target: '_blank', rel: 'noopener', text: 'Open the HM Land Registry figures for this area' });

  // ---- paste ----
  const pasteBox = el('textarea', {
    id: id('paste'), class: 'vm-hpi-paste', rows: '6', spellcheck: 'false',
    placeholder: 'Mar 2026, 98.9\nApr 2026, 99.0\n\nOr paste the whole CSV file downloaded from HM Land Registry or the ONS.',
  });
  const pasteBtn = el('button', { type: 'button', class: 'vm-hpi-btn', 'data-action': 'paste', text: 'Use pasted figures' });
  const pasteStatus = el('p', { class: 'vm-hpi-status', role: 'status', 'aria-live': 'polite' });
  const details = el('details', { class: 'vm-hpi-paste-wrap' },
    el('summary', { text: 'Paste index figures instead' }),
    el('p', { class: 'vm-hpi-hint', text: 'Paste one month per line with its index, for example "Mar 2026, 98.9" or "2026-03 98.9". You can also paste a whole CSV file from the HM Land Registry UK House Price Index site or the ONS. The all property types index is used.' }),
    el('label', { for: id('paste'), class: 'vm-hpi-sr', text: 'Index figures to paste' }),
    pasteBox, el('div', { class: 'vm-hpi-actions' }, pasteBtn), pasteStatus,
  );

  // ---- valuation index ----
  const valInput = el('input', { id: id('valindex'), class: 'vm-hpi-num', type: 'number', inputmode: 'decimal', step: '0.1', min: '0' });
  const valUseBtn = el('button', { type: 'button', class: 'vm-hpi-btn', 'data-action': 'use-valuation', text: 'Use series figure' });
  const valNote = el('p', { class: 'vm-hpi-note', 'data-role': 'latest-note' });

  // ---- table ----
  const tbody = el('tbody');
  const table = el('table', { class: 'vm-hpi-table' },
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col', text: 'No.' }), el('th', { scope: 'col', text: 'Comparable' }),
      el('th', { scope: 'col', text: 'Sale month' }), el('th', { scope: 'col', text: 'Series figure' }),
      el('th', { scope: 'col', text: 'Index at sale' }), el('th', { scope: 'col', text: 'Factor' }),
      el('th', { scope: 'col', text: 'Adjustment' }))),
    tbody);
  const emptyMsg = el('p', { class: 'vm-hpi-hint', text: 'No sales comparables yet. Add them in the comparables section and their sale months will appear here.' });
  const fillBtn = el('button', { type: 'button', class: 'vm-hpi-btn', 'data-action': 'fill', text: 'Fill blanks from series' });
  const replaceBtn = el('button', { type: 'button', class: 'vm-hpi-btn', 'data-action': 'replace', text: 'Replace all from series' });
  const seriesNote = el('p', { class: 'vm-hpi-hint', 'data-role': 'series-note' });

  // ---- source ----
  const sourceInput = el('input', { id: id('source'), class: 'vm-hpi-source', type: 'text' });

  rootEl.append(
    el('div', { class: 'vm-hpi-head' },
      el('h2', { class: 'vm-hpi-title', text: 'House price index' }),
      el('p', { class: 'vm-hpi-intro', text: 'The HPI adjustment brings older sale prices up (or down) to the valuation date using the official UK House Price Index, so every comparable is compared at today’s market level.' })),
    el('div', { class: 'vm-hpi-grid' },
      el('div', { class: 'vm-hpi-field' },
        el('label', { for: id('region'), text: 'Area for the index' }), select, regionHint),
      el('div', { class: 'vm-hpi-field' },
        el('span', { class: 'vm-hpi-label', text: 'Official figures' }),
        el('div', { class: 'vm-hpi-actions' }, fetchBtn), status, browseLink)),
    details,
    el('div', { class: 'vm-hpi-field vm-hpi-valuation' },
      el('label', { for: id('valindex'), text: 'Index at valuation date' }),
      el('div', { class: 'vm-hpi-inline' }, valInput, valUseBtn), valNote),
    el('div', { class: 'vm-hpi-tablewrap' }, table), emptyMsg,
    el('div', { class: 'vm-hpi-actions' }, fillBtn, replaceBtn), seriesNote,
    el('div', { class: 'vm-hpi-field' },
      el('label', { for: id('source'), text: 'Source of the index figures' }), sourceInput,
      el('p', { class: 'vm-hpi-hint', text: 'This line is shown with the matrix and in the report.' })),
  );

  // ---- behaviour ----
  let busy = false;
  let lastSuggestKey = '';
  let rowRefs = new Map();
  let structureKey = null;

  const st = () => store.get();
  const series = () => normaliseSeries(st().hpi?.series || []);

  function fetchRange(s) {
    const valM = monthOf(s.valuationDate) || monthOf(todayIso());
    const saleMonths = (s.sales || []).map((c) => monthOf(c.saleDate)).filter(Boolean).sort();
    let from = addMonths(valM, -36);
    if (saleMonths.length && saleMonths[0] < from) from = saleMonths[0];
    return { from: addMonths(from, -1), to: valM };
  }

  function setRegion(slug, hint) {
    const r = regionBySlug(slug);
    store.update((d) => {
      d.hpi = d.hpi || {};
      const changed = d.hpi.regionSlug !== (r ? r.slug : '');
      d.hpi.regionSlug = r ? r.slug : '';
      d.hpi.regionLabel = r ? r.label : '';
      if (changed && d.hpi.series && d.hpi.series.length) {
        // figures belong to the old area; keep hand entered indices but drop the cached series
        d.hpi.series = [];
      }
    });
    if (hint !== undefined) regionHint.textContent = hint;
  }

  function maybeSuggest(s) {
    if (s.hpi?.regionSlug) return;
    const key = `${s.subject?.postcode || ''}|${s.subject?.parkingArea || ''}`;
    if (key === lastSuggestKey) return;
    lastSuggestKey = key;
    const sug = suggestRegionForArea(s.subject?.parkingArea) || suggestRegionForPostcode(s.subject?.postcode);
    if (sug) {
      const why = sug.reason === 'parking area' ? 'the parking area chosen' : `the subject ${sug.reason}`;
      setRegion(sug.slug, `${sug.label} was chosen from ${why}. Change it if another area fits better.`);
    }
  }

  function sourceText(kind, s, ser) {
    const label = s.hpi?.regionLabel || regionBySlug(s.hpi?.regionSlug)?.label || 'chosen area';
    const latest = latestMonth(ser);
    const when = longDate(todayIso());
    if (kind === 'fetch') return `HM Land Registry UK House Price Index, ${label}, all property types, fetched ${when}${latest ? `, latest month ${formatMonth(latest, true)}` : ''}`;
    return `UK House Price Index figures pasted by the valuer, ${label}, all property types, entered ${when}${latest ? `, latest month ${formatMonth(latest, true)}` : ''}`;
  }

  function loadSeries(ser, kind) {
    let summary;
    store.update((d) => {
      summary = applySeries(d, ser, { force: false });
      d.hpi.source = sourceText(kind, d, ser);
    });
    return summary;
  }

  function summaryWords(ser, summary) {
    const first = ser[0].month, last = ser[ser.length - 1].month;
    const bits = [`${ser.length} months loaded, ${formatMonth(first, true)} to ${formatMonth(last, true)}.`];
    if (summary.filled) bits.push(`${summary.filled} comparable${summary.filled === 1 ? '' : 's'} filled in.`);
    if (summary.unchanged) bits.push(`${summary.unchanged} kept as already entered.`);
    if (summary.noMatch) bits.push(`${summary.noMatch} could not be matched (no sale date or sale before the first month).`);
    return bits.join(' ');
  }

  select.addEventListener('change', () => {
    setRegion(select.value, select.value ? '' : 'Choose the local authority area of the subject property.');
  });

  fetchBtn.addEventListener('click', async () => {
    if (busy) return;
    const s = st();
    const slug = s.hpi?.regionSlug;
    if (!slug) { status.textContent = 'Choose an area in the region list first.'; status.dataset.state = 'error'; return; }
    const { from, to } = fetchRange(s);
    busy = true; fetchBtn.disabled = true;
    status.dataset.state = 'busy';
    status.textContent = `Fetching ${regionBySlug(slug)?.label || slug} figures from HM Land Registry…`;
    try {
      const ser = await fetchSeries(slug, from, to);
      if (st().hpi?.regionSlug !== slug) { status.textContent = 'The area was changed while fetching. Press fetch again.'; status.dataset.state = 'error'; return; }
      const summary = loadSeries(ser, 'fetch');
      status.dataset.state = 'ok';
      status.textContent = summaryWords(ser, summary);
    } catch (err) {
      status.dataset.state = 'error';
      status.textContent = err?.message || 'The figures could not be fetched. Paste them instead.';
      details.open = true;
    } finally {
      busy = false; fetchBtn.disabled = false;
    }
  });

  pasteBtn.addEventListener('click', () => {
    const text = pasteBox.value;
    if (!text.trim()) { pasteStatus.dataset.state = 'error'; pasteStatus.textContent = 'Paste some figures into the box first.'; return; }
    let ser;
    try { ser = parseSeriesCsv(text, { region: st().hpi?.regionSlug || '' }); } catch (err) {
      pasteStatus.dataset.state = 'error'; pasteStatus.textContent = err.message; return;
    }
    if (!ser.length) {
      pasteStatus.dataset.state = 'error';
      pasteStatus.textContent = 'No month and index pairs were found. Each line needs a month and a number, for example "Mar 2026, 98.9".';
      return;
    }
    const summary = loadSeries(ser, 'paste');
    pasteStatus.dataset.state = 'ok';
    pasteStatus.textContent = summaryWords(ser, summary);
  });

  valInput.addEventListener('change', () => {
    const v = toNum(valInput.value);
    store.update((d) => { d.hpi = d.hpi || {}; d.hpi.valuationIndex = v; });
  });
  valUseBtn.addEventListener('click', () => {
    const e = indexEntryFor(series(), st().valuationDate);
    if (!e) return;
    store.update((d) => { d.hpi.valuationIndex = e.index; });
    setVal(valInput, e.index);
  });

  fillBtn.addEventListener('click', () => {
    let sm; store.update((d) => { sm = applySeries(d, null, { force: false }); });
    seriesNote.textContent = sm.filled ? `${sm.filled} blank index figure${sm.filled === 1 ? '' : 's'} filled from the series.` : 'Nothing to fill. Every comparable with a sale month already has an index, or there is no series loaded.';
  });
  replaceBtn.addEventListener('click', () => {
    if (!series().length) { seriesNote.textContent = 'Load a series first by fetching or pasting figures.'; return; }
    const ok = typeof window.confirm === 'function' ? window.confirm('Replace the valuation date index and every index at sale with the series figures? Figures typed by hand will be overwritten.') : true;
    if (!ok) return;
    let sm; store.update((d) => { sm = applySeries(d, null, { force: true }); });
    seriesNote.textContent = `${sm.filled} index figure${sm.filled === 1 ? '' : 's'} replaced from the series.`;
  });

  sourceInput.addEventListener('change', () => {
    store.update((d) => { d.hpi = d.hpi || {}; d.hpi.source = sourceInput.value.trim(); });
  });

  tbody.addEventListener('change', (ev) => {
    const input = ev.target.closest('input[data-comp]');
    if (!input) return;
    const cid = input.dataset.comp;
    const v = toNum(input.value);
    store.update((d) => { const c = (d.sales || []).find((x) => x.id === cid); if (c) c.hpiAtSale = v; });
  });

  // ---- render ----
  function buildRows(s) {
    tbody.innerHTML = '';
    rowRefs = new Map();
    (s.sales || []).forEach((c, i) => {
      const input = el('input', { type: 'number', inputmode: 'decimal', step: '0.1', min: '0', class: 'vm-hpi-num', 'data-comp': c.id, 'aria-label': `Index at sale for comparable ${i + 1}` });
      const refs = {
        tr: el('tr', { 'data-id': c.id }),
        addr: el('td', { class: 'vm-hpi-addr' }), month: el('td'), seriesCell: el('td', { class: 'vm-hpi-muted' }),
        input, factor: el('td', { class: 'vm-hpi-factor' }), adj: el('td'),
      };
      refs.tr.append(el('td', { text: String(i + 1) }), refs.addr, refs.month, refs.seriesCell, el('td', {}, input), refs.factor, refs.adj);
      tbody.append(refs.tr);
      rowRefs.set(c.id, refs);
    });
  }

  function render(s, evaluation) {
    s = s || st();
    maybeSuggest(s);
    s = st();
    const hpiState = s.hpi || {};
    const ser = normaliseSeries(hpiState.series || []);

    if (select.value !== (hpiState.regionSlug || '') && document.activeElement !== select) select.value = hpiState.regionSlug || '';
    if (!hpiState.regionSlug && !regionHint.textContent) regionHint.textContent = 'Choose the local authority area of the subject property.';
    if (hpiState.regionSlug) {
      const { from, to } = fetchRange(s);
      browseLink.href = browseUrl(hpiState.regionSlug, from, to);
      browseLink.hidden = false;
    } else browseLink.hidden = true;

    setVal(valInput, hpiState.valuationIndex);
    setVal(sourceInput, hpiState.source);
    sourceInput.placeholder = 'For example: HM Land Registry UK House Price Index, Chelmsford, fetched 6 November 2026';

    // latest month note
    const valM = monthOf(s.valuationDate);
    const ve = indexEntryFor(ser, s.valuationDate);
    const latest = latestMonth(ser);
    valUseBtn.hidden = !ve;
    if (!ser.length) {
      valNote.textContent = hpiState.valuationIndex ? 'Index entered by hand.' : 'Fetch or paste figures, or type the index for the valuation month here.';
    } else if (!ve) {
      valNote.textContent = `The series starts after the valuation date (${formatMonth(valM, true)}), so it cannot give a valuation date index.`;
    } else if (ve.exact) {
      valNote.textContent = `Series figure for ${formatMonth(ve.month, true)}: ${ve.index}.${differs(hpiState.valuationIndex, ve.index) ? ' The figure above was typed by hand and is the one used.' : ''}`;
    } else {
      valNote.textContent = `Latest month used: ${formatMonth(ve.month, true)} (index ${ve.index}). The index for ${formatMonth(valM, true)} is not published yet because figures come out about two months behind, so the latest available month is used.${differs(hpiState.valuationIndex, ve.index) ? ' The figure above was typed by hand and is the one used.' : ''}`;
    }
    valNote.dataset.latest = latest || '';
    seriesNote.dataset.latest = latest || '';
    if (latest && !seriesNote.textContent) seriesNote.textContent = '';

    // table
    const sales = s.sales || [];
    const key = `${s.valuationDate}|${sales.map((c) => `${c.id}:${c.saleDate}`).join(',')}`;
    if (key !== structureKey) {
      const focused = document.activeElement;
      const focusedId = focused && tbody.contains(focused) ? focused.dataset.comp : null;
      buildRows(s);
      structureKey = key;
      if (focusedId && rowRefs.get(focusedId)) rowRefs.get(focusedId).input.focus();
    }
    table.hidden = !sales.length;
    emptyMsg.hidden = !!sales.length;
    fillBtn.hidden = replaceBtn.hidden = !sales.length;

    const results = new Map((evaluation?.sales || []).map((r) => [r.id, r]));
    const vi = toNum(hpiState.valuationIndex);
    sales.forEach((c, i) => {
      const r = rowRefs.get(c.id);
      if (!r) return;
      r.addr.textContent = c.address || `Comparable ${i + 1}`;
      const sm = monthOf(c.saleDate);
      r.month.textContent = sm ? formatMonth(sm) : 'No sale date';
      const se = sm ? indexEntryFor(ser, c.saleDate) : null;
      r.seriesCell.textContent = se ? `${se.index}${se.exact ? '' : ` (${formatMonth(se.month)})`}` : (ser.length && sm ? 'Before series' : '');
      setVal(r.input, c.hpiAtSale);
      const si = toNum(c.hpiAtSale);
      const res = results.get(c.id);
      const required = res ? !!res.hpi?.required : null;
      const factor = vi && si ? vi / si : null;
      r.factor.textContent = factor ? factor.toFixed(4) : '';
      r.tr.classList.toggle('vm-hpi-flag', !!(res && (res.hpi?.flag === 'HPI_MISSING' || res.hpi?.flag === 'LARGE_HPI')));
      if (!sm) r.adj.textContent = 'Needs a sale date';
      else if (required === false) r.adj.textContent = 'Not needed (sale within 3 months)';
      else if (!factor) r.adj.textContent = 'Index missing [SURVEYOR TO CHECK]';
      else r.adj.textContent = `${changeWords(factor)}${res?.hpi?.flag === 'LARGE_HPI' ? ' (over 5%) [SURVEYOR TO NOTE]' : ''}`;
    });
  }

  const unsub = store.subscribe((s, ev) => render(s, ev));
  render(store.get(), store.evaluation());
  return () => { unsub(); };
}

function differs(a, b) { const x = toNum(a); return x !== null && Math.abs(x - b) > 1e-9; }

function ensureCss() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[href$="ui-hpi.css"]')) return;
  try {
    const href = new URL('../css/ui-hpi.css', import.meta.url).href;
    document.head.append(el('link', { rel: 'stylesheet', href }));
  } catch { /* ignore */ }
}
