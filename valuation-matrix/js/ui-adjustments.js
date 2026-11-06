// Gibsons valuation comparison tool: qualitative adjustment grid (mounted at #vm-adjustments).
//
// Contract assumptions:
// - Comparables carry no parking field, so the comparable's parking chosen in the Parking helper
//   is kept on the parking adjustment entry as extra fields:
//   comp.adjustments.parking = { mode, value, note, compParking, cpz }. calc.js ignores them.
// - An adjustment whose value is 0 and whose note is empty is removed from comp.adjustments
//   (unless it still holds helper fields), so empty cells do not clutter saved cases.
// - Grid shows sales for matrixType 'sales', rentals for 'rental', and a switch for 'btl'.
// - Quantum (size) row reads Result.quantum from store.evaluation(); the override writes
//   comp.quantumOverride (blank input = null = use the band).
// - Totals show qualitative %, qualitative £ and the fully adjusted value from the evaluation.
//   Nothing here produces an average or adopted value.
import { CATEGORIES, PARKING } from './model.js';
import { suggestParking, findParkingArea, parkingWords, PARKING_RULES } from './parking-data.js';

const CHIP_VALUES = [-10, -7.5, -5, -2.5, 2.5, 5, 7.5, 10];
const PARKING_LABELS = { garage: 'Garage', driveway: 'Driveway', 'on-street': 'On street only', permit: 'Residents permit', none: 'No parking' };

const gbpFmt = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });
function money(n) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'Not available';
  return n < 0 ? '−' + gbpFmt.format(Math.abs(n)) : gbpFmt.format(n);
}
function signedMoney(n) { return n > 0 ? '+' + money(n) : money(n); }
function pctText(n, dp = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return 'Not available';
  const t = Math.abs(n).toFixed(dp).replace(/\.0+$/, '');
  return (n > 0 ? '+' : n < 0 ? '−' : '') + t + '%';
}
function numText(n) { return n === null || n === undefined || !Number.isFinite(n) ? '' : String(n); }

/** Parse what a person types: "5", "+5", "-2.5", "5%", "£2,000", "−3" (unicode minus). */
export function parseEntry(text) {
  if (text === null || text === undefined) return null;
  const t = String(text).replace(/[−–—]/g, '-').replace(/[£%,\s]/g, '');
  if (t === '' || t === '-' || t === '+' || t === '.') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(e.dataset, v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}

function shortAddress(a) {
  const s = String(a || '').trim();
  if (!s) return 'No address entered';
  const first = s.split(',')[0].trim();
  return first.length > 40 ? first.slice(0, 38) + '…' : first;
}

function listKey(kind) { return kind === 'rentals' ? 'rentals' : 'sales'; }

export function mount(rootEl, store) {
  rootEl.classList.add('vm-adj');
  let uid = 0;
  const nextId = (p) => `vm-adj-${p}-${++uid}`;
  let kind = 'sales';
  let structureKey = '';
  let cells = [];        // per comp per category refs
  let compRefs = [];     // per comp column refs (quantum + totals + header)
  let openGuide = null;

  // ---------- static frame ----------
  const head = el('div', { class: 'vm-adj__head' },
    el('h2', { class: 'vm-adj__title', text: 'Adjustments' }),
    el('p', { class: 'vm-adj__sign' },
      el('strong', { text: 'How the signs work. ' }),
      'Positive means the comparable is worse than the subject, so its price is adjusted up. Negative means it is better, so it is adjusted down.'),
    el('p', { class: 'vm-adj__hint', text: 'Enter each adjustment as a percentage (the default) or switch the cell to a pound figure. Give a short reason for every adjustment that is not zero; the reasons are used in the report commentary. Tap a row name to see guidance.' }),
  );
  const kindBar = el('div', { class: 'vm-adj__kinds', role: 'tablist', 'aria-label': 'Which comparables to adjust' });
  const kindBtns = {};
  for (const [k, label] of [['sales', 'Sales comparables'], ['rentals', 'Rental comparables']]) {
    const b = el('button', { type: 'button', class: 'vm-adj__kind', role: 'tab', dataset: { kind: k }, text: label,
      onclick: () => { if (kind !== k) { kind = k; structureKey = ''; render(); } } });
    kindBtns[k] = b; kindBar.append(b);
  }
  const subjectLine = el('p', { class: 'vm-adj__subject', 'aria-live': 'polite' });
  const empty = el('div', { class: 'vm-adj__empty' });
  const scroll = el('div', { class: 'vm-adj__scroll', tabindex: '0', role: 'region', 'aria-label': 'Adjustment grid, scrolls sideways' });
  rootEl.replaceChildren(head, kindBar, subjectLine, empty, scroll);

  // Close an open guidance note when tapping elsewhere.
  document.addEventListener('click', (e) => {
    if (openGuide && !openGuide.contains(e.target)) { openGuide.classList.remove('is-open'); openGuide.querySelector('button')?.setAttribute('aria-expanded', 'false'); openGuide = null; }
  });

  // ---------- writing helpers ----------
  function writeAdj(compId, catKey, patch) {
    store.update((d) => {
      const comp = d[listKey(kind)].find((c) => c.id === compId);
      if (!comp) return;
      if (!comp.adjustments || typeof comp.adjustments !== 'object') comp.adjustments = {};
      const cur = comp.adjustments[catKey] || { mode: 'pct', value: 0, note: '' };
      const next = { mode: 'pct', value: 0, note: '', ...cur, ...patch };
      const hasHelper = next.compParking !== undefined || next.cpz !== undefined;
      if (!next.value && !String(next.note || '').trim() && next.mode === 'pct' && !hasHelper) delete comp.adjustments[catKey];
      else comp.adjustments[catKey] = next;
    });
  }
  function writeComp(compId, fn) {
    store.update((d) => { const comp = d[listKey(kind)].find((c) => c.id === compId); if (comp) fn(comp); });
  }

  // ---------- structure ----------
  function computeKind(state) {
    const m = state.matrixType || 'sales';
    if (m === 'rental') return { kinds: ['rentals'], k: 'rentals' };
    if (m === 'btl') return { kinds: ['sales', 'rentals'], k: kind };
    return { kinds: ['sales'], k: 'sales' };
  }

  function buildGrid(state) {
    const comps = state[listKey(kind)] || [];
    cells = []; compRefs = [];
    const table = el('table', { class: 'vm-adj__table' });
    const caption = el('caption', { class: 'vm-adj__sr', text: `Adjustments for ${kind === 'rentals' ? 'rental' : 'sales'} comparables` });
    const thead = el('thead');
    const hr = el('tr', {}, el('th', { scope: 'col', class: 'vm-adj__corner', text: 'Category' }));
    comps.forEach((c, i) => {
      const th = el('th', { scope: 'col', class: 'vm-adj__colhead' + (c.excluded ? ' is-excluded' : '') },
        el('span', { class: 'vm-adj__compno', text: `Comparable ${i + 1}` }),
        el('span', { class: 'vm-adj__compaddr', title: c.address || '', text: shortAddress(c.address) }),
        el('span', { class: 'vm-adj__compprice' }),
        c.excluded ? el('span', { class: 'vm-adj__tag', text: 'Excluded from range' }) : null);
      hr.append(th);
      compRefs[i] = { id: c.id, price: th.querySelector('.vm-adj__compprice') };
    });
    thead.append(hr);

    const tbody = el('tbody');
    // Quantum row
    const qr = el('tr', { class: 'vm-adj__row vm-adj__row--quantum' },
      rowHead('Size (quantum)', 'Worked out from the floor areas using the stepped bands: under 10% difference gives 0%, 10% to 20% gives 5%, 20% to 30% gives 10%, 30% to 40% gives 15%, 40% to 50% gives 20%, and 50% or more gives 30% (the cap). You can override the band if you have a reason.'));
    comps.forEach((c, i) => {
      const id = nextId('q');
      const band = el('div', { class: 'vm-adj__band', 'aria-live': 'polite' });
      const input = el('input', { id, class: 'vm-adj__input vm-adj__qov', type: 'text', inputmode: 'decimal', autocomplete: 'off', size: '4', placeholder: 'Use band', 'aria-label': `Size override for comparable ${i + 1}, percent` });
      input.addEventListener('input', () => {
        const v = parseEntry(input.value);
        if (input.value.trim() === '') writeComp(c.id, (cc) => { cc.quantumOverride = null; });
        else if (v !== null) writeComp(c.id, (cc) => { cc.quantumOverride = v; });
      });
      const td = el('td', { class: 'vm-adj__cell' }, band,
        el('label', { class: 'vm-adj__qlabel', for: id }, 'Override %'), input);
      qr.append(td);
      Object.assign(compRefs[i], { band, qov: input });
    });
    tbody.append(qr);

    // Category rows
    CATEGORIES.forEach((cat, r) => {
      const tr = el('tr', { class: 'vm-adj__row' + (r % 2 ? ' is-alt' : ''), dataset: { cat: cat.key } },
        rowHead(cat.label, cat.key === 'parking' ? cat.guidance + '. ' + PARKING_RULES.garage.text : cat.guidance));
      cells[r] = [];
      comps.forEach((c, i) => {
        const ref = buildCell(c, i, cat);
        tr.append(ref.td);
        cells[r][i] = ref;
      });
      tbody.append(tr);
    });

    // Totals
    const tfoot = el('tfoot');
    const totals = [
      ['pct', 'Qualitative total (%)'],
      ['gbp', 'Qualitative total (£)'],
      ['adj', kind === 'rentals' ? 'Fully adjusted rent (per month)' : 'Fully adjusted value'],
    ];
    for (const [key, label] of totals) {
      const tr = el('tr', { class: 'vm-adj__total vm-adj__total--' + key }, el('th', { scope: 'row', class: 'vm-adj__rowhead', text: label }));
      comps.forEach((c, i) => { const td = el('td', { class: 'vm-adj__cell vm-adj__num' }); tr.append(td); compRefs[i]['t_' + key] = td; });
      tfoot.append(tr);
    }
    table.append(caption, thead, tbody, tfoot);
    scroll.replaceChildren(table);
  }

  function rowHead(label, guidance) {
    const gid = nextId('g');
    const th = el('th', { scope: 'row', class: 'vm-adj__rowhead' });
    const btn = el('button', { type: 'button', class: 'vm-adj__rowbtn', 'aria-expanded': 'false', 'aria-describedby': gid },
      el('span', { class: 'vm-adj__rowlabel', text: label }), el('span', { class: 'vm-adj__info', 'aria-hidden': 'true', text: 'i' }));
    const g = el('span', { id: gid, class: 'vm-adj__guide', role: 'note', text: guidance });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = !th.classList.contains('is-open');
      if (openGuide && openGuide !== th) { openGuide.classList.remove('is-open'); openGuide.querySelector('button')?.setAttribute('aria-expanded', 'false'); }
      th.classList.toggle('is-open', open); btn.setAttribute('aria-expanded', String(open));
      openGuide = open ? th : null;
    });
    th.append(btn, g);
    return th;
  }

  function buildCell(comp, i, cat) {
    const vid = nextId('v'), nid = nextId('n');
    const label = `${cat.label}, comparable ${i + 1}`;
    const input = el('input', { id: vid, class: 'vm-adj__input vm-adj__val', type: 'text', inputmode: 'decimal', autocomplete: 'off', size: '4', placeholder: '0', 'aria-label': `${label}, adjustment` });
    const modeBtn = el('button', { type: 'button', class: 'vm-adj__mode', 'aria-label': `${label}: switch between percent and pounds` });
    const note = el('textarea', { id: nid, class: 'vm-adj__note', rows: '2', cols: '10', 'aria-label': `${label}, reason`, placeholder: 'Reason (optional)' });
    const need = el('span', { class: 'vm-adj__need', text: 'Please give a reason' });
    const chips = el('div', { class: 'vm-adj__chips', role: 'group', 'aria-label': 'Quick picks in percent' });
    for (const v of CHIP_VALUES) {
      const b = el('button', { type: 'button', class: 'vm-adj__chip' + (v < 0 ? ' is-neg' : ''), dataset: { v: String(v) },
        'aria-label': `${v < 0 ? 'minus' : 'plus'} ${Math.abs(v)} percent`, text: (v > 0 ? '+' : '−') + Math.abs(v) });
      // Keep focus in the value box so the chip row stays open on touch screens.
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => {
        input.value = String(v);
        writeAdj(comp.id, cat.key, { mode: 'pct', value: v });
        input.focus();
      });
      chips.append(b);
    }
    input.addEventListener('input', () => { writeAdj(comp.id, cat.key, { value: parseEntry(input.value) ?? 0 }); });
    input.addEventListener('blur', () => {
      const v = parseEntry(input.value);
      input.value = v === null || v === 0 ? '' : String(v);
    });
    modeBtn.addEventListener('pointerdown', (e) => e.preventDefault());
    modeBtn.addEventListener('click', () => {
      const cur = currentAdj(comp.id, cat.key);
      writeAdj(comp.id, cat.key, { mode: cur.mode === 'gbp' ? 'pct' : 'gbp' });
    });
    note.addEventListener('input', () => writeAdj(comp.id, cat.key, { note: note.value }));

    const valWrap = el('div', { class: 'vm-adj__valwrap' }, input, modeBtn);
    const td = el('td', { class: 'vm-adj__cell vm-adj__cell--edit', dataset: { comp: comp.id, cat: cat.key } }, valWrap, note, need);
    // Chips sit at the end of the cell and show only while the value box has focus, so showing
    // or hiding them never moves the controls above them (a moved target would swallow a tap).
    const chipOwners = (t) => t === input || chips.contains(t) || t === modeBtn;
    td.addEventListener('focusin', (e) => td.classList.toggle('is-active', chipOwners(e.target)));
    td.addEventListener('focusout', (e) => { if (!e.relatedTarget || !chipOwners(e.relatedTarget)) td.classList.remove('is-active'); });

    const ref = { td, input, modeBtn, note, need, compId: comp.id, cat: cat.key };
    if (cat.key === 'parking') ref.parking = buildParkingHelper(comp, i, ref);
    td.append(chips);
    return ref;
  }

  function currentAdj(compId, catKey) {
    const comp = (store.get()[listKey(kind)] || []).find((c) => c.id === compId);
    const a = comp?.adjustments?.[catKey];
    return { mode: a?.mode === 'gbp' ? 'gbp' : 'pct', value: Number(a?.value) || 0, note: a?.note || '', compParking: a?.compParking, cpz: a?.cpz };
  }

  // ---------- parking helper ----------
  function buildParkingHelper(comp, i, ref) {
    const sid = nextId('pk');
    const select = el('select', { id: sid, class: 'vm-adj__pksel' },
      el('option', { value: '', text: 'Choose' }),
      ...PARKING.map((k) => el('option', { value: k, text: PARKING_LABELS[k] || k })));
    const cpzId = nextId('cpz');
    const cpz = el('input', { id: cpzId, type: 'checkbox', class: 'vm-adj__pkcpz' });
    const cpzWrap = el('label', { class: 'vm-adj__pkcpzlabel', for: cpzId }, cpz, ' Restricted parking zone');
    const out = el('p', { class: 'vm-adj__pkout', 'aria-live': 'polite' });
    const apply = el('button', { type: 'button', class: 'vm-adj__pkapply', text: 'Apply midpoint' });
    const body = el('div', { class: 'vm-adj__pkbody' },
      el('label', { class: 'vm-adj__pklabel', for: sid }, 'Comparable parking'), select, cpzWrap, out, apply);
    const det = el('details', { class: 'vm-adj__pk' }, el('summary', { text: 'Parking helper' }), body);
    select.addEventListener('change', () => writeAdj(comp.id, 'parking', { compParking: select.value || undefined }));
    cpz.addEventListener('change', () => writeAdj(comp.id, 'parking', { cpz: cpz.checked }));
    apply.addEventListener('click', () => {
      const s = store.get();
      const a = currentAdj(comp.id, 'parking');
      const sug = suggestParking(s.subject?.parking, a.compParking, s.subject?.parkingArea, { cpz: a.cpz });
      if (sug.status !== 'ok') return;
      const note = parkingNote(s.subject.parking, a.compParking, sug);
      ref.input.value = sug.mid ? String(sug.mid) : '';
      writeAdj(comp.id, 'parking', { mode: 'gbp', value: sug.mid, note });
    });
    ref.td.append(det);
    return { det, select, cpz, out, apply };
  }

  function parkingNote(subjectKind, compKind, sug) {
    const area = sug.area;
    const shares = sug.shareLow === sug.shareHigh ? `${Math.round(Math.abs(sug.shareLow) * 100)}%` : `${Math.round(Math.abs(sug.shareLow) * 100)}% to ${Math.round(Math.abs(sug.shareHigh) * 100)}%`;
    const better = sug.mid < 0 ? 'better' : 'worse';
    let t = `Parking: the subject has ${parkingWords(subjectKind)} and the comparable has ${parkingWords(compKind)}, so the comparable's parking is ${better}. `;
    if (sug.mid === 0) t = `Parking: the subject has ${parkingWords(subjectKind)} and the comparable has ${parkingWords(compKind)}. `;
    t += `Based on a parking space value of ${money(area.low)} to ${money(area.high)} in ${area.label}`;
    const lo = Math.min(Math.abs(sug.low), Math.abs(sug.high)), hi = Math.max(Math.abs(sug.low), Math.abs(sug.high));
    const range = lo === hi ? money(lo) : `${money(lo)} to ${money(hi)}`;
    const kindWord = sug.mid < 0 ? 'a deduction' : 'an addition';
    t += sug.mid === 0 ? ', no adjustment is warranted.' : `, using ${shares} of that value gives ${range}. The midpoint, ${kindWord} of ${money(Math.abs(sug.mid))}, has been applied.`;
    return t;
  }

  function updateParking(ref, state) {
    const p = ref.parking; if (!p) return;
    const a = currentAdj(ref.compId, 'parking');
    const area = findParkingArea(state.subject?.parkingArea);
    if (document.activeElement !== p.select) p.select.value = a.compParking || '';
    const cpzVal = typeof a.cpz === 'boolean' ? a.cpz : !!area?.cpz;
    p.cpz.checked = cpzVal;
    const showCpz = state.subject?.parking === 'permit' || a.compParking === 'permit';
    p.cpz.parentElement.hidden = !showCpz;
    const sug = suggestParking(state.subject?.parking, a.compParking, state.subject?.parkingArea, { cpz: a.cpz });
    let text;
    if (sug.status === 'ok') {
      const range = sug.low === sug.high ? money(sug.low) : `${money(sug.low)} to ${money(sug.high)}`;
      text = `${sug.basis} Suggested: ${range} (${area.label}). Midpoint ${signedMoney(sug.mid)}.`;
      if (area.notes) text += ` Area note: ${area.notes}.`;
    } else text = sug.basis;
    if (state.subject?.parking && sug.status !== 'unknown') text = `Subject: ${PARKING_LABELS[state.subject.parking] || state.subject.parking}. ` + text;
    p.out.textContent = text;
    p.apply.disabled = sug.status !== 'ok';
    p.apply.textContent = sug.status === 'ok' ? `Apply midpoint ${signedMoney(sug.mid)}` : 'Apply midpoint';
  }

  // ---------- in place update ----------
  function updateValues(state, ev) {
    const comps = state[listKey(kind)] || [];
    const results = (ev && ev[listKey(kind)]) || [];
    const byId = new Map(results.map((r) => [r.id, r]));
    const active = document.activeElement;
    comps.forEach((c, i) => {
      const ref = compRefs[i]; if (!ref) return;
      const res = byId.get(c.id);
      ref.price.textContent = c.price === null || c.price === undefined ? 'No price' : money(Number(c.price)) + (kind === 'rentals' ? ' per month' : '');
      // Quantum band
      const q = res?.quantum;
      let bandText;
      if (!q) bandText = 'Not worked out yet';
      else if (q.diffPct === null || q.diffPct === undefined) bandText = 'No floor area for the subject or this comparable, so no size adjustment from the bands.';
      else {
        const dir = q.diffPct > 0 ? 'smaller than' : q.diffPct < 0 ? 'larger than' : 'the same size as';
        const bandAdj = q.bandAdjPct ?? q.adjPct;
        bandText = q.diffPct === 0 ? 'Same size as the subject. Band 0%.' : `${Math.abs(q.diffPct).toFixed(1)}% ${dir} the subject. Band ${pctText(bandAdj)}.`;
      }
      if (q?.overridden) bandText += ` Override in use: ${pctText(q.adjPct)}.`;
      else if (q) bandText += ` Applied: ${pctText(q.adjPct)}.`;
      ref.band.textContent = bandText;
      ref.band.parentElement.classList.toggle('is-overridden', !!q?.overridden);
      if (active !== ref.qov) ref.qov.value = numText(c.quantumOverride === null || c.quantumOverride === undefined ? null : Number(c.quantumOverride));
      // Totals
      const ql = res?.qual;
      ref.t_pct.textContent = ql ? pctText(ql.pct, 2) : 'Not available';
      ref.t_gbp.textContent = ql ? signedMoney(ql.gbp) : 'Not available';
      ref.t_adj.textContent = res?.adjustedValue === null || res?.adjustedValue === undefined ? 'Not available' : money(res.adjustedValue);
      ref.t_adj.classList.toggle('is-excluded', !!c.excluded);
    });
    cells.forEach((row) => row.forEach((ref, i) => {
      const c = comps[i]; if (!c) return;
      const a = c.adjustments?.[ref.cat];
      const mode = a?.mode === 'gbp' ? 'gbp' : 'pct';
      const value = Number(a?.value) || 0;
      const note = a?.note || '';
      if (active !== ref.input) {
        const shown = parseEntry(ref.input.value) ?? 0;
        if (shown !== value) ref.input.value = value ? String(value) : '';
      }
      if (active !== ref.note && ref.note.value !== note) ref.note.value = note;
      ref.modeBtn.textContent = mode === 'gbp' ? '£' : '%';
      ref.modeBtn.setAttribute('aria-pressed', String(mode === 'gbp'));
      ref.modeBtn.title = mode === 'gbp' ? 'Pounds. Tap to use percent.' : 'Percent. Tap to use pounds.';
      ref.input.placeholder = mode === 'gbp' ? '£0' : '0%';
      ref.td.classList.toggle('is-gbp', mode === 'gbp');
      const needs = value !== 0 && !note.trim();
      ref.td.classList.toggle('needs-note', needs);
      ref.td.classList.toggle('has-value', value !== 0);
      ref.td.classList.toggle('is-pos', value > 0);
      ref.td.classList.toggle('is-neg', value < 0);
      ref.note.placeholder = needs ? 'Why? Please give a reason' : 'Reason (optional)';
      ref.note.setAttribute('aria-invalid', String(needs));
      if (ref.parking) updateParking(ref, state);
    }));
  }

  // ---------- render ----------
  function render() {
    const state = store.get();
    const ev = store.evaluation();
    const ck = computeKind(state);
    kind = ck.kinds.includes(ck.k) ? ck.k : ck.kinds[0];
    kindBar.hidden = ck.kinds.length < 2;
    for (const [k, b] of Object.entries(kindBtns)) {
      b.setAttribute('aria-selected', String(k === kind));
      b.classList.toggle('is-on', k === kind);
      b.hidden = !ck.kinds.includes(k);
    }
    const s = state.subject || {};
    const area = findParkingArea(s.parkingArea);
    const sqft = ev?.subjectSqFt;
    subjectLine.textContent = `Subject: ${sqft ? Math.round(sqft).toLocaleString('en-GB') + ' sq ft' : 'no floor area entered'}; parking ${PARKING_LABELS[s.parking] ? PARKING_LABELS[s.parking].toLowerCase() : 'not set'}${area ? ' in ' + area.label : ''}.`;

    const comps = state[listKey(kind)] || [];
    const key = kind + '|' + comps.map((c) => `${c.id}:${c.address}:${c.excluded ? 1 : 0}`).join('|');
    if (!comps.length) {
      empty.hidden = false;
      empty.textContent = kind === 'rentals'
        ? 'No rental comparables yet. Add them on the Comparables tab and they will appear here as columns.'
        : 'No sales comparables yet. Add them on the Comparables tab and they will appear here as columns.';
      scroll.hidden = true;
      structureKey = key; cells = []; compRefs = [];
      return;
    }
    empty.hidden = true; scroll.hidden = false;
    if (key !== structureKey) {
      const focus = captureFocus();
      const sl = scroll.scrollLeft;
      buildGrid(state);
      structureKey = key;
      scroll.scrollLeft = sl;
      updateValues(state, ev);
      restoreFocus(focus);
    } else {
      updateValues(state, ev);
    }
  }

  function captureFocus() {
    const a = document.activeElement;
    if (!a || !scroll.contains(a)) return null;
    const td = a.closest('td');
    return { comp: td?.dataset.comp, cat: td?.dataset.cat, cls: a.className.split(' ').find((x) => x.startsWith('vm-adj__')), start: a.selectionStart, end: a.selectionEnd };
  }
  function restoreFocus(f) {
    if (!f || !f.comp) return;
    const td = scroll.querySelector(`td[data-comp="${CSS.escape(f.comp)}"][data-cat="${CSS.escape(f.cat)}"]`);
    const t = td?.querySelector('.' + f.cls);
    if (!t) return;
    t.focus({ preventScroll: true });
    try { if (f.start !== null && f.start !== undefined) t.setSelectionRange(f.start, f.end); } catch { /* not a text input */ }
  }

  const unsub = store.subscribe(() => render());
  render();
  return { unmount() { unsub(); rootEl.replaceChildren(); } };
}
