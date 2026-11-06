// App wiring: imports the store, mounts every UI module into its panel, runs the step tabs,
// and keeps a small range strip in the header.
//
// Assumptions:
// - Each UI module is loaded with a dynamic import inside its own try/catch, so a module that
//   fails to load or throws in mount() shows a short inline message in its panel and the rest of
//   the tool keeps working.
// - The active tab is remembered in localStorage key 'gibsons-vm-tab' (wrapped in try/catch).
//   A location hash such as #results wins over the remembered tab, so links can open a step.
// - The header strip shows Range Low and Range High only; never an average or adopted value.
import { store } from './store.js';

const TABS = ['subject', 'comparables', 'hpi', 'adjustments', 'results'];
const TAB_KEY = 'gibsons-vm-tab';
const MODULES = [
  ['subject', './ui-subject.js', 'vm-subject', 'Case and subject'],
  ['comparables', './ui-comparables.js', 'vm-comparables', 'Comparables'],
  ['hpi', './ui-hpi.js', 'vm-hpi', 'HPI'],
  ['adjustments', './ui-adjustments.js', 'vm-adjustments', 'Adjustments'],
  ['results', './ui-results.js', 'vm-results', 'Results'],
];

function readTab() {
  try {
    const h = (location.hash || '').replace('#', '');
    if (TABS.includes(h)) return h;
  } catch { /* ignore */ }
  try {
    const t = localStorage.getItem(TAB_KEY);
    if (TABS.includes(t)) return t;
  } catch { /* storage unavailable */ }
  return 'subject';
}
function saveTab(t) {
  try { localStorage.setItem(TAB_KEY, t); } catch { /* storage unavailable */ }
}

let active = null;
function showTab(name, { focus = false, scroll = true } = {}) {
  if (!TABS.includes(name)) name = 'subject';
  active = name;
  for (const t of TABS) {
    const tab = document.getElementById(`vm-tab-${t}`);
    const panel = document.getElementById(`vm-panel-${t}`);
    const on = t === name;
    if (tab) {
      tab.setAttribute('aria-selected', on ? 'true' : 'false');
      tab.tabIndex = on ? 0 : -1;
      tab.classList.toggle('is-active', on);
      if (on && focus) tab.focus();
      if (on) { try { tab.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* old browsers */ } }
    }
    if (panel) panel.hidden = !on;
  }
  const i = TABS.indexOf(name);
  const nav = document.getElementById('vm-stepnav');
  if (nav) {
    const prev = nav.querySelector('[data-step="prev"]');
    const next = nav.querySelector('[data-step="next"]');
    prev.hidden = i === 0;
    next.hidden = i === TABS.length - 1;
    if (!next.hidden) next.textContent = `Next: ${document.querySelector(`#vm-tab-${TABS[i + 1]} .vm-tab__label`)?.textContent || ''}`;
    if (!prev.hidden) prev.textContent = 'Back';
  }
  saveTab(name);
  if (scroll) { try { window.scrollTo({ top: 0 }); } catch { /* ignore */ } }
}

function wireTabs() {
  const list = document.querySelector('[role="tablist"]');
  list.addEventListener('click', (e) => {
    const b = e.target.closest('[role="tab"]');
    if (b) showTab(b.dataset.tab);
  });
  list.addEventListener('keydown', (e) => {
    const i = TABS.indexOf(active);
    let n = null;
    if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = TABS.length - 1;
    if (n === null) return;
    e.preventDefault();
    showTab(TABS[n], { focus: true, scroll: false });
  });
  document.getElementById('vm-stepnav').addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    const i = TABS.indexOf(active);
    const n = b.dataset.step === 'next' ? Math.min(i + 1, TABS.length - 1) : Math.max(i - 1, 0);
    showTab(TABS[n]);
  });
  window.addEventListener('hashchange', () => {
    const h = (location.hash || '').replace('#', '');
    if (TABS.includes(h)) showTab(h);
  });
}

function showMountError(rootEl, label, err) {
  console.error(`Could not start the ${label} panel`, err);
  if (!rootEl) return;
  const box = document.createElement('div');
  box.className = 'vm-error';
  box.setAttribute('role', 'alert');
  const strong = document.createElement('strong');
  strong.textContent = `The ${label} panel could not be shown.`;
  const p = document.createElement('p');
  p.textContent = 'The rest of the tool still works. Reload the page to try again. If this keeps happening, save the case from the Results step and report the problem.';
  box.append(strong, p);
  rootEl.replaceChildren(box);
}

async function mountAll() {
  await Promise.all(MODULES.map(async ([, path, id, label]) => {
    const rootEl = document.getElementById(id);
    try {
      const mod = await import(path);
      if (typeof mod.mount !== 'function') throw new Error('module has no mount function');
      mod.mount(rootEl, store);
    } catch (err) {
      showMountError(rootEl, label, err);
    }
  }));
}

// ---------- header range strip ----------
const gbp = (n) => '£' + Math.round(n).toLocaleString('en-GB');
function renderStrip() {
  const strip = document.getElementById('vm-range-strip');
  if (!strip) return;
  const state = store.get();
  const ev = store.evaluation();
  const parts = [];
  if (ev) {
    const showSales = state.matrixType !== 'rental';
    const showRent = state.matrixType === 'btl' || state.matrixType === 'rental';
    const s = ev.salesRange, r = ev.rentalRange;
    if (showSales && s && s.count > 0 && Number.isFinite(s.low) && Number.isFinite(s.high)) {
      parts.push(`Sales range ${gbp(s.low)} to ${gbp(s.high)}`);
    }
    if (showRent && r && r.count > 0 && Number.isFinite(r.low) && Number.isFinite(r.high)) {
      parts.push(`Rental range ${gbp(r.low)} to ${gbp(r.high)} pcm`);
    }
  }
  strip.textContent = parts.length ? parts.join('  ·  ') : 'No range yet';
  strip.classList.toggle('is-empty', parts.length === 0);
}

function hasData(s) {
  return !!(s && ((s.sales && s.sales.length) || (s.rentals && s.rentals.length) || (s.subject && s.subject.address)));
}
function renderIntro() {
  const intro = document.getElementById('vm-intro');
  if (intro) intro.hidden = hasData(store.get());
}

function wireIntro() {
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-app-action="example"]');
    if (!b) return;
    try {
      const { buildExampleCase } = await import('./ui-results.js');
      if (hasData(store.get()) && !window.confirm('Load the example case? This replaces the case you have open now.')) return;
      store.replace(buildExampleCase());
    } catch (err) {
      console.error('Could not load the example case', err);
    }
  });
}

function start() {
  wireTabs();
  wireIntro();
  showTab(readTab(), { scroll: false });
  store.subscribe(() => { renderStrip(); renderIntro(); });
  renderStrip();
  renderIntro();
  mountAll();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
