// Comparables entry (mounted at #vm-comparables): sales and rentals, plus the paste import dialog.
//
// Public API: mount(rootEl, store) -> unmount function.
//
// Assumptions where ARCHITECTURE.md leaves room:
// - Layout is one responsive card per comparable. On a phone the fields stack; on an iPad or
//   desktop the same card lays its fields out in a dense grid, so it reads like a table row
//   while staying easy to tap. Cards can be collapsed to a one line summary.
// - Sub tabs: matrixType 'sales' shows sales only, 'rental' shows rentals only, 'btl' shows
//   both as tabs. The chosen tab is kept in memory only.
// - Cards are keyed by comparable id and updated in place. A focused input is never rewritten,
//   and cards are only created or removed when a comparable is added or removed.
// - Sale type (saleKind) is shown for sales only; rentals keep whatever value they hold.
// - parsers.js is loaded lazily when the import dialog is first used, so a parser problem never
//   stops the comparables list from working.
// - The 'included' count in the summary counts comparables not excluded by the user.
// - Price fields accept 250000, 250,000, £250,000 or 250k.
// - The stylesheet css/ui-comparables.css is loaded by index.html; mount() also injects a
//   <link> to it if none is present so the module looks right on its own.
import { createComparable, PROPERTY_TYPES, SALE_KINDS } from './model.js';
import { sqftToSqm, sqmToSqft } from './calc.js';

const TYPE_LABELS = {
  detached: 'Detached', 'semi-detached': 'Semi detached', 'end-terrace': 'End terrace',
  terraced: 'Terraced', flat: 'Flat', maisonette: 'Maisonette', bungalow: 'Bungalow',
};
const KIND_LABELS = { standard: 'Standard', auction: 'Auction', repossession: 'Repossession', 'new-build': 'New build' };
const SOURCES = ['Rightmove SCT', 'Land Registry', 'Agent', 'Rightmove', 'Zoopla', 'OnTheMarket', 'EPC register'];

// Short badge text; the full house style label from calc.js is shown when the badge is tapped.
const SHORT_FLAGS = {
  OVER_12_MONTHS: 'Over 12 months old',
  HPI_REQUIRED: 'HPI needed',
  HPI_MISSING: 'HPI index missing',
  LARGE_HPI: 'Large HPI change',
  AUCTION: 'Auction',
  REPOSSESSION: 'Repossession',
  NEW_BUILD: 'New build',
  NO_FLOOR_AREA: 'No floor area',
  OVER_HALF_MILE: 'Over 0.5 miles',
  OUTLIER: 'Outlier',
  SHORT_LEASE: 'Short lease',
  MISSING_PRICE: 'No price',
  MISSING_DATE: 'No date',
};
const LEASE_TEXT = {
  green: 'Lease 100 years or more',
  amber: 'Lease 80 to 99 years',
  red: 'Lease under 80 years',
};

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

export function parseNumber(v, { money = false } = {}) {
  if (v === null || v === undefined) return null;
  let s = String(v).trim().toLowerCase().replace(/[£,\s]/g, '');
  if (!s) return null;
  let mult = 1;
  if (money && /[km]$/.test(s)) { mult = s.endsWith('k') ? 1000 : 1000000; s = s.slice(0, -1); }
  if (!/^\d*\.?\d+$|^\d+\.$/.test(s)) return null;
  const n = Number(s) * mult;
  return Number.isFinite(n) ? n : null;
}
function fmtMoney(n) { return n === null || n === undefined ? '' : Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 }); }
function fmtNum(n) { return n === null || n === undefined ? '' : String(n); }
function shortDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}
function plural(n, one, many) { return `${n} ${n === 1 ? one : many}`; }

function fieldsFor(kind) {
  const rent = kind === 'rentals';
  return [
    { f: 'address', label: 'Address', type: 'text', wide: true, attrs: { autocomplete: 'off', placeholder: 'e.g. 14 Oak Road, Chelmsford' } },
    { f: 'postcode', label: 'Postcode', type: 'text', attrs: { autocomplete: 'off', autocapitalize: 'characters' } },
    { f: 'propertyType', label: 'Type', type: 'select', options: [['', 'Not known'], ...PROPERTY_TYPES.map((t) => [t, TYPE_LABELS[t] || t])] },
    { f: 'tenure', label: 'Tenure', type: 'select', options: [['freehold', 'Freehold'], ['leasehold', 'Leasehold']] },
    { f: 'unexpiredTerm', label: 'Lease left (years)', type: 'num', leaseOnly: true, attrs: { inputmode: 'decimal' } },
    { f: 'bedrooms', label: 'Bedrooms', type: 'num', attrs: { inputmode: 'numeric' } },
    { f: 'floorAreaSqFt', label: 'Floor area sq ft', type: 'num', attrs: { inputmode: 'decimal' } },
    { f: 'floorAreaSqM', label: 'Floor area sq m', type: 'num', attrs: { inputmode: 'decimal' } },
    { f: 'price', label: rent ? 'Rent £ pcm' : 'Sale price £', type: 'money', attrs: { inputmode: 'decimal' } },
    { f: 'saleDate', label: rent ? 'Date let or listed' : 'Sale date', type: 'date' },
    { f: 'distanceMiles', label: 'Distance (miles)', type: 'num', attrs: { inputmode: 'decimal' } },
    { f: 'source', label: 'Source', type: 'text', list: true, attrs: { autocomplete: 'off' } },
    rent ? null : { f: 'saleKind', label: 'Sale type', type: 'select', options: SALE_KINDS.map((k) => [k, KIND_LABELS[k] || k]) },
    { f: 'notes', label: 'Notes', type: 'textarea', wide: true },
  ].filter(Boolean);
}

function ensureCss() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[href$="ui-comparables.css"]')) return;
  try {
    const href = new URL('../css/ui-comparables.css', import.meta.url).href;
    document.head.append(el('link', { rel: 'stylesheet', href }));
  } catch { /* ignore */ }
}

let uid = 0;

export function mount(rootEl, store) {
  if (!rootEl) return () => {};
  uid += 1;
  const pfx = `vm-cmp-${uid}`;
  ensureCss();
  rootEl.classList.add('vm-comparables');
  rootEl.innerHTML = '';

  let chosenKind = 'sales';       // remembered tab for btl
  let listKind = null;            // kind the current cards were built for
  const cards = new Map();        // id -> { root, inputs: {field: el}, flagsEl, ... }
  const collapsed = new Set();
  let toastTimer = null;
  let lastDeleted = null;

  // ---------- static frame ----------
  const heading = el('h2', { class: 'vm-cmp-title', text: 'Comparables' });
  const tabs = el('div', { class: 'vm-cmp-tabs', role: 'tablist', 'aria-label': 'Comparable type' });
  const tabSales = el('button', { type: 'button', class: 'vm-cmp-tab', role: 'tab', 'data-kind': 'sales' });
  const tabRent = el('button', { type: 'button', class: 'vm-cmp-tab', role: 'tab', 'data-kind': 'rentals' });
  tabs.append(tabSales, tabRent);
  const summary = el('p', { class: 'vm-cmp-summary', 'aria-live': 'polite' });
  const addBtn = el('button', { type: 'button', class: 'vm-cmp-btn vm-cmp-btn-primary', 'data-act': 'add' }, 'Add comparable');
  const importBtn = el('button', { type: 'button', class: 'vm-cmp-btn', 'data-act': 'import' }, 'Import from paste');
  const expandAllBtn = el('button', { type: 'button', class: 'vm-cmp-btn vm-cmp-btn-quiet', 'data-act': 'toggle-all' }, 'Collapse all');
  const toolbar = el('div', { class: 'vm-cmp-toolbar' }, addBtn, importBtn, expandAllBtn);
  const empty = el('p', { class: 'vm-cmp-empty' });
  const list = el('div', { class: 'vm-cmp-list', id: `${pfx}-list`, role: 'tabpanel' });
  const datalist = el('datalist', { id: `${pfx}-sources` }, SOURCES.map((s) => el('option', { value: s })));
  const toast = el('div', { class: 'vm-cmp-toast', role: 'status', 'aria-live': 'polite', hidden: true });
  const footer = el('div', { class: 'vm-cmp-toolbar vm-cmp-toolbar-foot' },
    el('button', { type: 'button', class: 'vm-cmp-btn', 'data-act': 'add' }, 'Add another comparable'));
  rootEl.append(heading, tabs, summary, toolbar, empty, list, footer, datalist, toast);

  const dialog = buildDialog();
  rootEl.append(dialog.el);

  // ---------- helpers ----------
  const activeKind = (state) => {
    const m = state.matrixType || 'sales';
    if (m === 'rental') return 'rentals';
    if (m === 'btl') return chosenKind;
    return 'sales';
  };
  const compsOf = (state, kind) => (Array.isArray(state[kind]) ? state[kind] : []);
  const noun = (kind) => (kind === 'rentals' ? 'Rental' : 'Sale');

  function updateComp(kind, id, fn) {
    store.update((d) => {
      const c = (d[kind] || []).find((x) => x.id === id);
      if (c) fn(c);
    });
  }

  // ---------- card building ----------
  function buildCard(comp, kind) {
    const id = comp.id;
    const root = el('article', { class: 'vm-cmp-card', 'data-id': id });
    const num = el('span', { class: 'vm-cmp-num' });
    const title = el('span', { class: 'vm-cmp-headline' });
    const lease = el('span', { class: 'vm-cmp-lease', hidden: true });
    const flagsEl = el('div', { class: 'vm-cmp-flags' });
    const flagNote = el('p', { class: 'vm-cmp-flagnote', hidden: true });
    const includeBox = el('input', { type: 'checkbox', 'data-field': 'include', id: `${pfx}-${id}-include` });
    const includeLbl = el('label', { class: 'vm-cmp-include', for: `${pfx}-${id}-include` }, includeBox, el('span', { text: 'Include in range' }));
    const btn = (act, text, aria) => el('button', { type: 'button', class: 'vm-cmp-icon', 'data-act': act, 'aria-label': aria, title: aria }, text);
    const collapseBtn = el('button', { type: 'button', class: 'vm-cmp-icon vm-cmp-collapse', 'data-act': 'collapse', 'aria-expanded': 'true' });
    const actions = el('div', { class: 'vm-cmp-actions' },
      btn('up', '↑', 'Move up'), btn('down', '↓', 'Move down'),
      btn('duplicate', 'Copy', 'Duplicate this comparable'), btn('delete', 'Delete', 'Delete this comparable'), collapseBtn);
    const head = el('header', { class: 'vm-cmp-head' },
      el('div', { class: 'vm-cmp-headtext' }, num, title, lease), includeLbl, actions);

    const inputs = {};
    const wraps = {};
    const grid = el('div', { class: 'vm-cmp-grid', id: `${pfx}-${id}-body` });
    for (const def of fieldsFor(kind)) {
      const fid = `${pfx}-${id}-${def.f}`;
      let input;
      if (def.type === 'select') {
        input = el('select', { id: fid }, def.options.map(([v, t]) => el('option', { value: v, text: t })));
      } else if (def.type === 'textarea') {
        input = el('textarea', { id: fid, rows: 2 });
      } else if (def.type === 'date') {
        input = el('input', { id: fid, type: 'date' });
      } else {
        input = el('input', { id: fid, type: 'text', ...(def.attrs || {}), list: def.list ? `${pfx}-sources` : null });
      }
      input.dataset.field = def.f;
      input.dataset.type = def.type;
      inputs[def.f] = input;
      const wrap = el('div', { class: `vm-cmp-field vm-cmp-f-${def.f}${def.wide ? ' vm-cmp-wide' : ''}` },
        el('label', { for: fid, text: def.label }), input);
      if (def.leaseOnly) wrap.dataset.leaseOnly = '1';
      wraps[def.f] = wrap;
      grid.append(wrap);
    }
    collapseBtn.setAttribute('aria-controls', grid.id);
    root.append(head, flagsEl, flagNote, grid);
    return { root, num, title, lease, flagsEl, flagNote, includeBox, collapseBtn, inputs, wraps, grid, flagCodes: '' };
  }

  function setVal(input, v) {
    if (document.activeElement === input) return;
    let s;
    if (input.dataset.type === 'money') s = fmtMoney(v);
    else if (input.dataset.type === 'num') s = fmtNum(v);
    else s = v === null || v === undefined ? '' : String(v);
    if (input.tagName === 'SELECT' && ![...input.options].some((o) => o.value === s)) {
      input.append(el('option', { value: s, text: s }));
    }
    if (input.value !== s) input.value = s;
    input.removeAttribute('aria-invalid');
  }

  function fillCard(card, comp, result, index, kind) {
    card.num.textContent = `${noun(kind)} ${index + 1}`;
    const bits = [comp.address || 'No address yet'];
    if (comp.price !== null && comp.price !== undefined) bits.push(`£${fmtMoney(comp.price)}${kind === 'rentals' ? ' pcm' : ''}`);
    if (comp.saleDate) bits.push(shortDate(comp.saleDate));
    card.title.textContent = bits.join(', ');
    for (const [f, input] of Object.entries(card.inputs)) setVal(input, comp[f]);
    if (document.activeElement !== card.includeBox) card.includeBox.checked = !comp.excluded;
    card.root.classList.toggle('vm-cmp-excluded', !!comp.excluded);
    const isLease = comp.tenure === 'leasehold';
    for (const w of Object.values(card.wraps)) if (w.dataset.leaseOnly) w.hidden = !isLease;

    // lease light
    const light = result ? result.leaseLight : null;
    if (isLease && light) {
      card.lease.hidden = false;
      card.lease.className = `vm-cmp-lease vm-cmp-lease-${light}`;
      card.lease.textContent = LEASE_TEXT[light] || '';
    } else if (isLease) {
      card.lease.hidden = false;
      card.lease.className = 'vm-cmp-lease vm-cmp-lease-none';
      card.lease.textContent = 'Lease length not entered';
    } else {
      card.lease.hidden = true;
    }

    // flags
    const flags = (result && Array.isArray(result.flags)) ? result.flags : [];
    const codes = flags.map((f) => f.code).join(',');
    if (codes !== card.flagCodes) {
      card.flagCodes = codes;
      card.flagsEl.replaceChildren(...flags.map((f) => el('button', {
        type: 'button', class: `vm-cmp-flag vm-cmp-flag-${f.severity || 'warn'}`, 'data-act': 'flag',
        'data-code': f.code, 'data-label': f.label || '', title: f.label || '', 'aria-label': f.label || SHORT_FLAGS[f.code] || f.code,
      }, (f.code === 'MISSING_PRICE' && kind === 'rentals') ? 'No rent' : (SHORT_FLAGS[f.code] || f.code))));
      if (!card.flagNote.hidden && !codes.includes(card.flagNote.dataset.code || '\u0000')) card.flagNote.hidden = true;
      else if (!card.flagNote.hidden) {
        const f = flags.find((x) => x.code === card.flagNote.dataset.code);
        if (f) card.flagNote.textContent = f.label;
      }
    }
    card.flagsEl.hidden = !flags.length;

    const isCollapsed = collapsed.has(comp.id);
    card.root.classList.toggle('vm-cmp-collapsed', isCollapsed);
    card.grid.hidden = isCollapsed;
    card.collapseBtn.textContent = isCollapsed ? 'Show' : 'Hide';
    card.collapseBtn.setAttribute('aria-expanded', String(!isCollapsed));
    card.collapseBtn.setAttribute('aria-label', isCollapsed ? 'Show details' : 'Hide details');
  }

  // ---------- render ----------
  function render(state = store.get(), evaluation = store.evaluation()) {
    const m = state.matrixType || 'sales';
    const kind = activeKind(state);
    const sales = compsOf(state, 'sales');
    const rents = compsOf(state, 'rentals');
    const showTabs = m === 'btl';
    tabs.hidden = !showTabs;
    tabSales.textContent = `Sales (${sales.length})`;
    tabRent.textContent = `Rentals (${rents.length})`;
    for (const t of [tabSales, tabRent]) {
      const on = t.dataset.kind === kind;
      t.setAttribute('aria-selected', String(on));
      t.classList.toggle('vm-cmp-tab-on', on);
      t.tabIndex = on ? 0 : -1;
    }
    heading.textContent = m === 'rental' ? 'Rental comparables' : m === 'btl' ? 'Comparables' : 'Sales comparables';

    const comps = compsOf(state, kind);
    const included = comps.filter((c) => !c.excluded).length;
    summary.textContent = `${plural(comps.length, 'comparable', 'comparables')}, ${included} included`
      + (kind === 'rentals' && m === 'btl' ? ' (rentals)' : kind === 'sales' && m === 'btl' ? ' (sales)' : '');
    empty.hidden = comps.length > 0;
    empty.textContent = kind === 'rentals'
      ? 'No rental comparables yet. Add one by hand, or paste lettings from Rightmove or an agent.'
      : 'No sales comparables yet. Add one by hand, or paste sold prices from Rightmove or Land Registry.';
    footer.hidden = comps.length < 3;
    const allCollapsed = comps.length > 0 && comps.every((c) => collapsed.has(c.id));
    expandAllBtn.textContent = allCollapsed ? 'Expand all' : 'Collapse all';
    expandAllBtn.hidden = comps.length === 0;

    // structural: switching kind rebuilds the cards
    if (listKind !== kind) {
      cards.clear();
      list.replaceChildren();
      listKind = kind;
    }
    const results = (evaluation && Array.isArray(evaluation[kind])) ? evaluation[kind] : [];
    const byId = new Map(results.map((r) => [r.id, r]));
    const seen = new Set();
    comps.forEach((comp, i) => {
      if (!comp || !comp.id) return;
      seen.add(comp.id);
      let card = cards.get(comp.id);
      if (!card) { card = buildCard(comp, kind); cards.set(comp.id, card); }
      fillCard(card, comp, byId.get(comp.id), i, kind);
      card.root.querySelector('[data-act="up"]').disabled = i === 0;
      card.root.querySelector('[data-act="down"]').disabled = i === comps.length - 1;
      if (list.children[i] !== card.root) list.insertBefore(card.root, list.children[i] || null);
    });
    for (const [id, card] of cards) {
      if (!seen.has(id)) { card.root.remove(); cards.delete(id); }
    }
  }

  // ---------- input handling ----------
  function onInput(e) {
    const t = e.target;
    const field = t.dataset && t.dataset.field;
    if (!field) return;
    const cardEl = t.closest('.vm-cmp-card');
    if (!cardEl || !list.contains(cardEl)) return;
    const id = cardEl.dataset.id;
    const kind = listKind;
    if (field === 'include') {
      updateComp(kind, id, (c) => { c.excluded = !t.checked; });
      return;
    }
    const type = t.dataset.type;
    if (type === 'num' || type === 'money') {
      const raw = t.value;
      const n = parseNumber(raw, { money: type === 'money' });
      if (raw.trim() && n === null) { t.setAttribute('aria-invalid', 'true'); return; }
      t.removeAttribute('aria-invalid');
      updateComp(kind, id, (c) => {
        c[field] = field === 'bedrooms' && n !== null ? Math.round(n) : n;
        if (field === 'floorAreaSqFt') c.floorAreaSqM = n === null ? null : sqftToSqm(n);
        if (field === 'floorAreaSqM') c.floorAreaSqFt = n === null ? null : sqmToSqft(n);
      });
      return;
    }
    let v = t.value;
    if (field === 'postcode') v = v.toUpperCase();
    updateComp(kind, id, (c) => {
      c[field] = v;
      if (field === 'tenure' && v === 'freehold') c.unexpiredTerm = null;
    });
  }

  function onBlur(e) {
    const t = e.target;
    if (t.dataset && (t.dataset.type === 'money' || t.dataset.type === 'num' || t.dataset.field === 'postcode')) {
      // reformat the value now that focus has left it
      setTimeout(() => render(), 0);
    }
  }

  function focusIn(id, sel) {
    const card = cards.get(id);
    const n = card && card.root.querySelector(sel);
    if (n && !n.disabled) n.focus();
    else if (card) card.root.querySelector('[data-act="duplicate"]')?.focus();
  }

  function addComparable(kind) {
    const c = createComparable(kind === 'rentals' ? { source: 'Rightmove' } : {});
    store.update((d) => { (d[kind] = d[kind] || []).push(c); });
    focusIn(c.id, '[data-field="address"]');
    cards.get(c.id)?.root.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }

  function showToast(msg, undo) {
    clearTimeout(toastTimer);
    toast.replaceChildren(el('span', { text: msg }));
    if (undo) toast.append(el('button', { type: 'button', class: 'vm-cmp-btn vm-cmp-undo', 'data-act': 'undo' }, 'Undo'));
    toast.hidden = false;
    toastTimer = setTimeout(() => { toast.hidden = true; lastDeleted = null; }, undo ? 10000 : 4000);
  }

  function onClick(e) {
    const b = e.target.closest('[data-act]');
    if (!b || !rootEl.contains(b) || dialog.el.contains(b)) return;
    const act = b.dataset.act;
    const state = store.get();
    const kind = activeKind(state);
    const cardEl = b.closest('.vm-cmp-card');
    const id = cardEl ? cardEl.dataset.id : null;
    if (act === 'add') return addComparable(kind);
    if (act === 'import') return dialog.open(kind);
    if (act === 'toggle-all') {
      const comps = compsOf(state, kind);
      const all = comps.every((c) => collapsed.has(c.id));
      for (const c of comps) { if (all) collapsed.delete(c.id); else collapsed.add(c.id); }
      return render();
    }
    if (act === 'undo') {
      if (!lastDeleted) return;
      const { comp, index, kind: k } = lastDeleted;
      lastDeleted = null;
      store.update((d) => { const arr = (d[k] = d[k] || []); arr.splice(Math.min(index, arr.length), 0, comp); });
      showToast('Comparable restored');
      if (k === listKind) focusIn(comp.id, '[data-field="address"]');
      return;
    }
    if (!id) return;
    const comps = compsOf(state, kind);
    const i = comps.findIndex((c) => c.id === id);
    if (i < 0) return;
    if (act === 'flag') {
      const card = cards.get(id);
      const same = !card.flagNote.hidden && card.flagNote.dataset.code === b.dataset.code;
      card.flagNote.hidden = same;
      card.flagNote.dataset.code = b.dataset.code;
      card.flagNote.textContent = b.dataset.label;
      return;
    }
    if (act === 'collapse') {
      if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
      render();
      return;
    }
    if (act === 'up' || act === 'down') {
      const j = act === 'up' ? i - 1 : i + 1;
      if (j < 0 || j >= comps.length) return;
      store.update((d) => { const arr = d[kind]; [arr[i], arr[j]] = [arr[j], arr[i]]; });
      focusIn(id, `[data-act="${act}"]`);
      return;
    }
    if (act === 'duplicate') {
      const { id: _old, ...rest } = structuredClone(comps[i]);
      void _old;
      const copy = createComparable(rest);
      store.update((d) => { d[kind].splice(i + 1, 0, copy); });
      showToast(`${noun(kind)} ${i + 1} copied as ${noun(kind).toLowerCase()} ${i + 2}`);
      focusIn(copy.id, '[data-field="address"]');
      return;
    }
    if (act === 'delete') {
      const comp = structuredClone(comps[i]);
      lastDeleted = { comp, index: i, kind };
      store.update((d) => { d[kind].splice(i, 1); });
      collapsed.delete(id);
      showToast(`${noun(kind)} ${i + 1}${comp.address ? ` (${comp.address})` : ''} deleted.`, true);
      toast.querySelector('[data-act="undo"]')?.focus();
    }
  }

  function onTabClick(e) {
    const t = e.target.closest('.vm-cmp-tab');
    if (!t) return;
    chosenKind = t.dataset.kind;
    render();
  }
  function onTabKey(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    chosenKind = chosenKind === 'sales' ? 'rentals' : 'sales';
    render();
    (chosenKind === 'sales' ? tabSales : tabRent).focus();
  }

  rootEl.addEventListener('input', onInput);
  // Older Safari may not fire 'input' on selects or checkboxes; updates are idempotent.
  const onChange = (e) => { if (e.target.tagName === 'SELECT' || e.target.type === 'checkbox' || e.target.type === 'date') onInput(e); };
  rootEl.addEventListener('change', onChange);
  rootEl.addEventListener('focusout', onBlur);
  rootEl.addEventListener('click', onClick);
  tabs.addEventListener('click', onTabClick);
  tabs.addEventListener('keydown', onTabKey);

  // ---------- import dialog ----------
  function buildDialog() {
    const dlg = el('dialog', { class: 'vm-cmp-dialog', 'aria-labelledby': `${pfx}-dlg-title` });
    const title = el('h3', { id: `${pfx}-dlg-title`, text: 'Import from paste' });
    const help = el('p', { class: 'vm-cmp-help' });
    const ta = el('textarea', { class: 'vm-cmp-paste', rows: 8, 'aria-label': 'Pasted comparables', spellcheck: 'false' });
    const readBtn = el('button', { type: 'button', class: 'vm-cmp-btn vm-cmp-btn-primary', 'data-dlg': 'read' }, 'Read pasted text');
    const status = el('p', { class: 'vm-cmp-dlg-status', 'aria-live': 'polite' });
    const warnList = el('ul', { class: 'vm-cmp-warnings', hidden: true });
    const selectAll = el('input', { type: 'checkbox', 'data-dlg': 'all', 'aria-label': 'Select all rows', checked: true });
    const tbody = el('tbody');
    const table = el('table', { class: 'vm-cmp-preview' },
      el('thead', {}, el('tr', {}, el('th', {}, selectAll), ...['Address', 'Postcode', 'Type', 'Beds', 'Sq ft', 'Price', 'Date', 'Miles', 'Notes'].map((h) => el('th', { scope: 'col', text: h })))),
      tbody);
    const tableWrap = el('div', { class: 'vm-cmp-preview-wrap', hidden: true }, table);
    const addSel = el('button', { type: 'button', class: 'vm-cmp-btn vm-cmp-btn-primary', 'data-dlg': 'add', disabled: true }, 'Add selected');
    const cancel = el('button', { type: 'button', class: 'vm-cmp-btn', 'data-dlg': 'cancel' }, 'Cancel');
    dlg.append(title, help, ta, el('div', { class: 'vm-cmp-toolbar' }, readBtn), status, warnList, tableWrap,
      el('div', { class: 'vm-cmp-toolbar vm-cmp-dlg-foot' }, cancel, addSel));

    let kind = 'sales';
    let rows = [];

    const countSel = () => tbody.querySelectorAll('input[type=checkbox]:checked').length;
    const syncAdd = () => {
      const n = countSel();
      addSel.disabled = n === 0;
      addSel.textContent = n ? `Add ${plural(n, 'selected comparable', 'selected comparables')}` : 'Add selected';
      selectAll.checked = n === rows.length && rows.length > 0;
      selectAll.indeterminate = n > 0 && n < rows.length;
    };

    function reset() {
      rows = [];
      tbody.replaceChildren();
      tableWrap.hidden = true;
      warnList.hidden = true;
      warnList.replaceChildren();
      status.textContent = '';
      syncAdd();
    }

    async function read() {
      reset();
      status.textContent = 'Reading';
      let parse;
      try {
        ({ parseComparables: parse } = await import('./parsers.js'));
      } catch (err) {
        console.error(err);
        status.textContent = 'The import reader could not be loaded. Please add the comparables by hand.';
        return;
      }
      let res;
      try { res = parse(ta.value, { kind }); } catch (err) {
        console.error(err);
        status.textContent = 'The pasted text could not be read.';
        return;
      }
      rows = Array.isArray(res && res.rows) ? res.rows : [];
      const warnings = Array.isArray(res && res.warnings) ? res.warnings : [];
      const fmt = res && (res.formatLabel || res.format);
      status.textContent = rows.length
        ? `Found ${plural(rows.length, 'comparable', 'comparables')}${fmt && res.format !== 'empty' ? ` in ${fmt}` : ''}. Untick any you do not want.`
        : 'No comparables found.';
      if (warnings.length) {
        warnList.replaceChildren(...warnings.map((w) => el('li', { text: w })));
        warnList.hidden = false;
      }
      tbody.replaceChildren(...rows.map((r, i) => el('tr', {},
        el('td', {}, el('input', { type: 'checkbox', checked: true, 'data-row': i, 'aria-label': `Import row ${i + 1}` })),
        el('td', { text: r.address || '' }),
        el('td', { text: r.postcode || '' }),
        el('td', { text: TYPE_LABELS[r.propertyType] || r.propertyType || '' }),
        el('td', { text: fmtNum(r.bedrooms) }),
        el('td', { text: r.floorAreaSqFt ? fmtMoney(r.floorAreaSqFt) : '' }),
        el('td', { text: r.price !== null && r.price !== undefined ? `£${fmtMoney(r.price)}` : '' }),
        el('td', { text: shortDate(r.saleDate) }),
        el('td', { text: fmtNum(r.distanceMiles) }),
        el('td', { text: [r.tenure === 'leasehold' ? `Leasehold${r.unexpiredTerm ? `, ${r.unexpiredTerm} years` : ''}` : '', r.saleKind && r.saleKind !== 'standard' ? KIND_LABELS[r.saleKind] : '', r.notes || ''].filter(Boolean).join('; ') }),
      )));
      tableWrap.hidden = rows.length === 0;
      syncAdd();
    }

    function addSelected() {
      const picks = [...tbody.querySelectorAll('input[data-row]:checked')].map((b) => rows[Number(b.dataset.row)]).filter(Boolean);
      if (!picks.length) return;
      const comps = picks.map((r) => {
        const { id: _i, ...rest } = r || {};
        void _i;
        const c = createComparable(structuredClone(rest));
        if (c.floorAreaSqFt != null && c.floorAreaSqM == null) c.floorAreaSqM = sqftToSqm(c.floorAreaSqFt);
        if (c.floorAreaSqM != null && c.floorAreaSqFt == null) c.floorAreaSqFt = sqmToSqft(c.floorAreaSqM);
        return c;
      });
      store.update((d) => { (d[kind] = d[kind] || []).push(...comps); });
      close();
      ta.value = '';
      reset();
      showToast(`${plural(comps.length, 'comparable', 'comparables')} added from the pasted text`);
    }

    function close() {
      if (typeof dlg.close === 'function' && dlg.open) dlg.close();
      else dlg.removeAttribute('open');
      importBtn.focus();
    }

    dlg.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dlg]');
      if (!b) return;
      if (b.dataset.dlg === 'read') read();
      else if (b.dataset.dlg === 'add') addSelected();
      else if (b.dataset.dlg === 'cancel') close();
    });
    dlg.addEventListener('change', (e) => {
      if (e.target === selectAll) {
        for (const b of tbody.querySelectorAll('input[data-row]')) b.checked = selectAll.checked;
      }
      syncAdd();
    });
    dlg.addEventListener('cancel', () => setTimeout(() => importBtn.focus(), 0));

    return {
      el: dlg,
      open(k) {
        kind = k;
        title.textContent = k === 'rentals' ? 'Import rental comparables from paste' : 'Import sales comparables from paste';
        help.textContent = k === 'rentals'
          ? 'Paste lettings from Rightmove, an agent list or a spreadsheet. Rents are read as £ per calendar month; weekly or yearly rents are converted.'
          : 'Paste sold prices from Rightmove SCT, Land Registry price paid data, a spreadsheet, or a typed list with one comparable per line.';
        reset();
        if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
        ta.focus();
      },
      close,
    };
  }

  // ---------- go ----------
  render();
  const unsub = store.subscribe((s, ev) => render(s, ev));
  return () => {
    unsub();
    clearTimeout(toastTimer);
    rootEl.removeEventListener('input', onInput);
    rootEl.removeEventListener('change', onChange);
    rootEl.removeEventListener('click', onClick);
    rootEl.removeEventListener('focusout', onBlur);
    rootEl.innerHTML = '';
  };
}
