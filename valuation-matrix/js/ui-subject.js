// Case details and subject property form (mounted at #vm-subject).
//
// Contract assumptions:
// - parking-data.js is loaded with a dynamic import so the form still works (with an empty area
//   list and a short note) if that file is missing or fails to load. PARKING_AREAS entries are read
//   as { key, label, region, low, high, notes } with low and high as £ premiums.
// - Matrix type follows the instruction type: choosing "Buy to let" sets btl, "Rental assessment"
//   sets rental, and moving back to another instruction resets to sales only when the matrix type
//   still matches the earlier automatic suggestion. The user can always pick a different type.
// - Floor area: typing either box writes both fields (sq ft and sq m) to the store, converted at
//   1 sq m = 10.764 sq ft via calc.js, so both stay consistent for every other module.
// - The DOM is built once. Store changes update values in place and never touch the focused input.
// - css/ui-subject.css is expected from index.html; mount() injects a link if none is present.
import { INSTRUCTION_TYPES, PROPERTY_TYPES, CONDITIONS, PARKING } from './model.js';
import { sqftToSqm, sqmToSqft, leaseLight } from './calc.js';

const PROPERTY_LABELS = {
  detached: 'Detached house', 'semi-detached': 'Semi detached house', 'end-terrace': 'End of terrace house',
  terraced: 'Mid terrace house', flat: 'Flat', maisonette: 'Maisonette', bungalow: 'Bungalow',
};
const CONDITION_LABELS = { good: 'Good', average: 'Average', 'below-average': 'Below average', poor: 'Poor' };
const PARKING_LABELS = {
  garage: 'Garage', driveway: 'Driveway (off street)', 'on-street': 'On street, unrestricted',
  permit: 'Residents permit only', none: 'No parking',
};
const MATRIX_TYPES = [
  ['sales', 'Sales', 'Sold prices only'],
  ['btl', 'Buy to let', 'Sold prices and rents'],
  ['rental', 'Rental only', 'Rents only'],
];
const EPC_BANDS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];
const LEASE_TEXT = {
  green: ['100 years or more', 'A long lease. Lenders are usually comfortable.'],
  amber: ['80 to 99 years', 'Acceptable, but the lease will need extending before it falls below 80 years.'],
  red: ['Under 80 years', 'Short lease. Marriage value applies if the lease is extended, which makes extension much more expensive. [SURVEYOR TO CHECK]'],
};

function suggestedMatrix(instructionType) {
  if (instructionType === 'btl') return 'btl';
  if (instructionType === 'rental') return 'rental';
  return 'sales';
}

const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) {
    if (c !== null && c !== undefined && c !== false) n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
};

function toNum(v, { int = false } = {}) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(/[,£\s]/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return int ? Math.round(n) : n;
}
function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj); }
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i += 1) { if (o[keys[i]] == null) o[keys[i]] = {}; o = o[keys[i]]; }
  o[keys[keys.length - 1]] = value;
}
function setVal(input, v) {
  if (document.activeElement === input) return;
  const s = v === null || v === undefined ? '' : String(v);
  if (input.value !== s) input.value = s;
}
function money(n) { return '£' + Math.round(n).toLocaleString('en-GB'); }
// Reference data may contain dashes; the tool must not show them in prose.
function plain(text) {
  return String(text || '')
    .replace(/(\d)\s*[‐-―-]\s*(?=[£\d])/g, '$1 to ')
    .replace(/\s*[–—]\s*/g, ', ')
    .replace(/(\w)-(\w)/g, '$1 $2');
}

let uid = 0;

export function mount(rootEl, store) {
  if (!rootEl) return () => {};
  uid += 1;
  const id = (s) => `vm-subject-${uid}-${s}`;
  ensureCss();
  rootEl.classList.add('vm-subject');
  rootEl.innerHTML = '';

  const bindings = []; // { path, input, kind: 'text'|'num'|'int'|'select'|'date' }
  const radios = [];   // { path, inputs, parse }

  const write = (fn) => store.update(fn);

  // ---------- field builders ----------
  function field(key, label, control, { help, wide, extra, labelFor } = {}) {
    const helpId = help ? id(key + '-help') : null;
    if (helpId) control.setAttribute('aria-describedby', helpId);
    return el('div', { class: 'vm-subject__field' + (wide ? ' vm-subject__field--wide' : ''), 'data-field': key },
      el('label', { class: 'vm-subject__label', for: labelFor || control.id, text: label }),
      help ? el('p', { class: 'vm-subject__help', id: helpId, text: help }) : null,
      extra ? el('div', { class: 'vm-subject__row' }, control, extra) : control);
  }
  function textInput(path, attrs = {}) {
    const input = el('input', { type: 'text', id: id(path.replace('.', '-')), class: 'vm-subject__input', autocomplete: 'off', ...attrs });
    input.addEventListener('input', () => write((d) => setPath(d, path, input.value)));
    bindings.push({ path, input, kind: 'text' });
    return input;
  }
  function numInput(path, { int = false, onWrite, ...attrs } = {}) {
    const input = el('input', {
      type: 'text', inputmode: int ? 'numeric' : 'decimal', id: id(path.replace('.', '-')),
      class: 'vm-subject__input vm-subject__input--num', autocomplete: 'off', ...attrs,
    });
    input.addEventListener('input', () => {
      const v = toNum(input.value, { int });
      write((d) => { setPath(d, path, v); if (onWrite) onWrite(d, v); });
    });
    input.addEventListener('blur', () => {
      // Tidy the shown value once the user leaves the box.
      const v = getPath(store.get(), path);
      input.value = v === null || v === undefined ? '' : String(v);
    });
    bindings.push({ path, input, kind: 'num' });
    return input;
  }
  function selectInput(path, options, { onChange, groups } = {}) {
    const select = el('select', { id: id(path.replace('.', '-')), class: 'vm-subject__input vm-subject__select' });
    fillOptions(select, options, groups);
    select.addEventListener('change', () => write((d) => {
      const prev = getPath(d, path);
      setPath(d, path, select.value);
      if (onChange) onChange(d, select.value, prev);
    }));
    bindings.push({ path, input: select, kind: 'select' });
    return select;
  }
  function textArea(path, attrs = {}) {
    const ta = el('textarea', { id: id(path.replace('.', '-')), class: 'vm-subject__input vm-subject__textarea', rows: 3, ...attrs });
    ta.addEventListener('input', () => write((d) => setPath(d, path, ta.value)));
    bindings.push({ path, input: ta, kind: 'text' });
    return ta;
  }
  function radioGroup(path, name, options, { parse = (v) => v, onChange, cls = '' } = {}) {
    const wrap = el('div', { class: 'vm-subject__segmented ' + cls, role: 'radiogroup', id: id(name) });
    const inputs = [];
    for (const [value, label, sub, dataAttr] of options) {
      const input = el('input', { type: 'radio', name: id(name), value: String(value), class: 'vm-subject__radio' });
      input.addEventListener('change', () => {
        if (!input.checked) return;
        write((d) => { const prev = getPath(d, path); setPath(d, path, parse(input.value)); if (onChange) onChange(d, parse(input.value), prev); });
      });
      inputs.push(input);
      wrap.append(el('label', { class: 'vm-subject__seg', 'data-value': dataAttr ?? String(value) },
        input, el('span', { class: 'vm-subject__seg-main', text: label }),
        sub ? el('span', { class: 'vm-subject__seg-sub', text: sub }) : null));
    }
    radios.push({ path, inputs });
    return wrap;
  }
  function legendField(key, label, control, { help, wide } = {}) {
    const helpId = help ? id(key + '-help') : null;
    const labelId = id(key + '-label');
    control.setAttribute('aria-labelledby', labelId);
    if (helpId) control.setAttribute('aria-describedby', helpId);
    return el('div', { class: 'vm-subject__field' + (wide ? ' vm-subject__field--wide' : ''), 'data-field': key },
      el('span', { class: 'vm-subject__label', id: labelId, text: label }),
      help ? el('p', { class: 'vm-subject__help', id: helpId, text: help }) : null,
      control);
  }

  // ---------- case details ----------
  const matrixHint = el('p', { class: 'vm-subject__hint', 'aria-live': 'polite' });
  const caseSection = el('section', { class: 'vm-subject__card', 'aria-labelledby': id('case-h') },
    el('h2', { class: 'vm-subject__h', id: id('case-h'), text: 'Case details' }),
    el('div', { class: 'vm-subject__grid' },
      field('caseRef', 'Case reference', textInput('caseRef', { placeholder: 'For example GS 2026 101' })),
      field('valuer', 'Valuer', textInput('valuer', { autocomplete: 'name' }), { help: 'The RICS Registered Valuer signing the report.' }),
      field('valuationDate', 'Valuation date', dateInput('valuationDate'), { help: 'The date the value is given at, usually the inspection date.' }),
      field('instructionType', 'Instruction type', selectInput('instructionType', INSTRUCTION_TYPES, {
        onChange(d, next, prev) {
          const was = suggestedMatrix(prev);
          const now = suggestedMatrix(next);
          if (now !== 'sales' || d.matrixType === was) d.matrixType = now;
        },
      }), { help: 'Why the valuation is needed.' }),
      legendField('matrixType', 'Matrix type', radioGroup('matrixType', 'matrix', MATRIX_TYPES, { cls: 'vm-subject__segmented--three' }), {
        wide: true, help: 'Which evidence the matrix uses. Buy to let uses both sold prices and rents.',
      }),
    ),
    matrixHint);

  function dateInput(path) {
    const input = el('input', { type: 'date', id: id(path), class: 'vm-subject__input' });
    const onIn = () => { if (!input.value || /^\d{4}-\d{2}-\d{2}$/.test(input.value)) write((d) => setPath(d, path, input.value)); };
    input.addEventListener('input', onIn);
    input.addEventListener('change', onIn);
    bindings.push({ path, input, kind: 'date' });
    return input;
  }

  // ---------- subject property ----------
  const sqft = numInput('subject.floorAreaSqFt', {
    placeholder: 'sq ft', 'aria-label': 'Floor area in square feet',
    onWrite(d, v) { d.subject.floorAreaSqM = v === null ? null : sqftToSqm(v); },
  });
  const sqm = numInput('subject.floorAreaSqM', {
    placeholder: 'sq m', 'aria-label': 'Floor area in square metres',
    onWrite(d, v) { d.subject.floorAreaSqFt = v === null ? null : sqmToSqft(v); },
  });
  const areaControl = el('div', { class: 'vm-subject__area', id: id('area') },
    el('div', { class: 'vm-subject__unit' }, sqft, el('span', { class: 'vm-subject__unit-tag', text: 'sq ft' })),
    el('span', { class: 'vm-subject__equals', 'aria-hidden': 'true', text: '=' }),
    el('div', { class: 'vm-subject__unit' }, sqm, el('span', { class: 'vm-subject__unit-tag', text: 'sq m' })));

  const leaseBadge = el('span', { class: 'vm-subject__lease-badge', 'aria-live': 'polite', hidden: true });
  const leaseNote = el('p', { class: 'vm-subject__lease-note', hidden: true });
  const termInput = numInput('subject.unexpiredTerm', { placeholder: 'Years', 'aria-label': 'Unexpired term in years' });

  const leaseBlock = el('div', { class: 'vm-subject__lease vm-subject__field--wide', 'data-block': 'lease' },
    el('div', { class: 'vm-subject__grid' },
      field('unexpiredTerm', 'Unexpired term', termInput, { help: 'Years left on the lease.', extra: leaseBadge }),
      field('groundRent', 'Ground rent (£ a year)', numInput('subject.groundRent', { placeholder: '£ a year' }), { help: 'Yearly rent paid to the freeholder.' }),
      field('groundRentReview', 'Ground rent review pattern', textInput('subject.groundRentReview', { placeholder: 'For example doubles every 25 years' }), {
        wide: true, help: 'How and when the ground rent goes up.',
      }),
    ),
    leaseNote);

  const parkingSelect = el('select', { id: id('parkingArea'), class: 'vm-subject__input vm-subject__select' },
    el('option', { value: '', text: 'Loading areas' }));
  parkingSelect.disabled = true;
  parkingSelect.addEventListener('change', () => write((d) => { d.subject.parkingArea = parkingSelect.value; }));
  bindings.push({ path: 'subject.parkingArea', input: parkingSelect, kind: 'select' });
  const parkingInfo = el('p', { class: 'vm-subject__hint', 'aria-live': 'polite' });
  let parkingAreas = [];

  const subjectSection = el('section', { class: 'vm-subject__card', 'aria-labelledby': id('subj-h') },
    el('h2', { class: 'vm-subject__h', id: id('subj-h'), text: 'Subject property' }),
    el('div', { class: 'vm-subject__grid' },
      field('address', 'Address', textInput('subject.address', { autocomplete: 'street-address' }), { wide: true }),
      field('postcode', 'Postcode', textInput('subject.postcode', { autocomplete: 'postal-code', autocapitalize: 'characters', class: 'vm-subject__input vm-subject__input--postcode' })),
      field('propertyType', 'Property type', selectInput('subject.propertyType', [['', 'Choose a type'], ...PROPERTY_TYPES.map((k) => [k, PROPERTY_LABELS[k] || k])])),
      legendField('tenure', 'Tenure', radioGroup('subject.tenure', 'tenure', [['freehold', 'Freehold', 'You own the building and land'], ['leasehold', 'Leasehold', 'You own it for a set number of years']]), {
        wide: true, help: 'How the property is owned.',
      }),
      leaseBlock,
      field('bedrooms', 'Bedrooms', numInput('subject.bedrooms', { int: true, placeholder: 'Number' })),
      field('floorArea', 'Floor area', areaControl, {
        labelFor: sqft.id,
        help: 'Gross internal area. Type in either box; the other converts (1 sq m is 10.764 sq ft).',
      }),
      field('condition', 'Condition', selectInput('subject.condition', CONDITIONS.map((k) => [k, CONDITION_LABELS[k] || k]))),
      field('parking', 'Parking', selectInput('subject.parking', PARKING.map((k) => [k, PARKING_LABELS[k] || k]))),
      field('parkingArea', 'Parking area', parkingSelect, {
        wide: true, help: 'The borough or town, used to look up a typical value for a parking space.',
      }),
      el('div', { class: 'vm-subject__field--wide' }, parkingInfo),
      legendField('epc', 'EPC rating', radioGroup('subject.epc', 'epc', [...EPC_BANDS.map((b) => [b, b]), ['', 'Not known', null, 'none']], { cls: 'vm-subject__segmented--epc' }), {
        wide: true, help: 'Energy Performance Certificate band, A (most efficient) to G (least).',
      }),
      legendField('garden', 'Garden', radioGroup('subject.garden', 'garden', [['true', 'Yes'], ['false', 'No']], { parse: (v) => v === 'true' })),
      field('gardenNotes', 'Garden notes', textInput('subject.gardenNotes', { placeholder: 'For example south facing, 60 ft' }), { help: 'Size, aspect, communal or private.' }),
      field('features', 'Special features', textArea('subject.features', { placeholder: 'For example loft conversion, solar panels, sea views' }), { wide: true }),
      field('defects', 'Significant defects', textArea('subject.defects', { placeholder: 'For example subsidence cracking, damp, roof needs replacing' }), {
        wide: true, help: 'Anything that could materially affect value or lending.',
      }),
    ));

  const completeness = el('div', { class: 'vm-subject__complete', role: 'status', 'aria-live': 'polite' });

  rootEl.append(completeness, el('div', { class: 'vm-subject__cards' }, caseSection, subjectSection));

  // ---------- parking areas (lazy) ----------
  import('./parking-data.js').then((m) => {
    parkingAreas = Array.isArray(m.PARKING_AREAS) ? m.PARKING_AREAS : [];
  }).catch((e) => {
    console.warn('Parking areas unavailable', e);
    parkingAreas = [];
  }).finally(() => {
    const groups = [];
    for (const a of parkingAreas) {
      let g = groups.find((x) => x.label === (a.region || 'Other'));
      if (!g) { g = { label: a.region || 'Other', options: [] }; groups.push(g); }
      g.options.push([a.key, plain(a.label)]);
    }
    parkingSelect.innerHTML = '';
    fillOptions(parkingSelect, [['', parkingAreas.length ? 'Not set' : 'No area list available']], groups);
    parkingSelect.disabled = !parkingAreas.length;
    render(store.get());
  });

  // ---------- render ----------
  function render(state) {
    if (!state) return;
    const s = state.subject || {};
    for (const b of bindings) {
      const v = getPath(state, b.path);
      if (b.kind === 'select') {
        if (document.activeElement === b.input) continue;
        const want = v == null ? '' : String(v);
        if (want && b.input.options.length && ![...b.input.options].some((o) => o.value === want)) {
          // Keep an unknown saved value visible rather than silently dropping it.
          b.input.append(el('option', { value: want, text: want }));
        }
        if (b.input.value !== want) b.input.value = want;
      } else {
        setVal(b.input, v);
      }
    }
    for (const r of radios) {
      const v = getPath(state, r.path);
      const want = v === null || v === undefined ? '' : String(v);
      for (const i of r.inputs) i.checked = i.value === want;
    }

    // Matrix suggestion
    const sug = suggestedMatrix(state.instructionType);
    const sugLabel = MATRIX_TYPES.find((m) => m[0] === sug)[1];
    if (state.matrixType && state.matrixType !== sug) {
      matrixHint.textContent = `Suggested for this instruction: ${sugLabel}. You have chosen a different matrix type, which is fine if the case needs it.`;
    } else {
      matrixHint.textContent = `Matrix type ${sugLabel} matches this instruction.`;
    }

    // Lease
    const lease = s.tenure === 'leasehold';
    leaseBlock.hidden = !lease;
    const light = lease ? leaseLight(s.unexpiredTerm) : null;
    leaseBadge.hidden = !light;
    leaseNote.hidden = !light;
    if (light) {
      leaseBadge.className = `vm-subject__lease-badge vm-subject__lease-badge--${light}`;
      leaseBadge.dataset.light = light;
      leaseBadge.textContent = LEASE_TEXT[light][0];
      leaseNote.className = `vm-subject__lease-note vm-subject__lease-note--${light}`;
      leaseNote.textContent = LEASE_TEXT[light][1];
    } else {
      delete leaseBadge.dataset.light;
    }

    // Parking area info
    const area = parkingAreas.find((a) => a.key === s.parkingArea);
    if (area) {
      const parts = [];
      if (Number.isFinite(area.low) && Number.isFinite(area.high)) parts.push(`Typical value of a parking space here: ${money(area.low)} to ${money(area.high)}.`);
      if (area.notes) parts.push(plain(area.notes) + (/[.!?]$/.test(area.notes.trim()) ? '' : '.'));
      parkingInfo.textContent = parts.join(' ');
      parkingInfo.hidden = !parts.length;
    } else {
      parkingInfo.textContent = '';
      parkingInfo.hidden = true;
    }

    // Completeness
    const missing = [];
    if (!(toNum(s.floorAreaSqFt) || toNum(s.floorAreaSqM))) missing.push(['floorArea', 'floor area']);
    if (!state.valuationDate || !/^\d{4}-\d{2}-\d{2}$/.test(state.valuationDate)) missing.push(['valuationDate', 'valuation date']);
    if (!s.propertyType) missing.push(['propertyType', 'property type']);
    if (lease && toNum(s.unexpiredTerm) === null) missing.push(['unexpiredTerm', 'unexpired lease term']);
    renderCompleteness(missing);
    for (const f of rootEl.querySelectorAll('.vm-subject__field[data-field]')) {
      f.classList.toggle('vm-subject__field--missing', missing.some((m) => m[0] === f.dataset.field));
    }
  }

  let lastMissingKey = null;
  function renderCompleteness(missing) {
    const key = missing.map((m) => m[0]).join(',');
    if (key === lastMissingKey) return;
    lastMissingKey = key;
    completeness.innerHTML = '';
    completeness.dataset.state = missing.length ? 'missing' : 'ok';
    if (!missing.length) {
      completeness.append(el('span', { class: 'vm-subject__complete-icon', 'aria-hidden': 'true', text: '✓' }),
        el('span', { text: 'Subject details needed for the matrix are complete.' }));
      return;
    }
    completeness.append(el('span', { class: 'vm-subject__complete-icon', 'aria-hidden': 'true', text: '!' }),
      el('span', { text: 'Still needed for the matrix: ' }));
    const list = el('ul', { class: 'vm-subject__missing' });
    for (const [k, label] of missing) {
      const btn = el('button', { type: 'button', class: 'vm-subject__missing-btn', 'data-missing': k, text: label });
      btn.addEventListener('click', () => focusField(k));
      list.append(el('li', {}, btn));
    }
    completeness.append(list);
  }
  function focusField(k) {
    const f = rootEl.querySelector(`.vm-subject__field[data-field="${k}"]`);
    if (!f) return;
    const target = f.querySelector('input:not([type=radio]), select, textarea') || f.querySelector('input');
    f.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    target?.focus({ preventScroll: true });
  }

  render(store.get());
  const unsub = store.subscribe((state) => render(state));
  return () => { unsub(); };
}

function fillOptions(select, options, groups) {
  for (const [value, label] of options) select.append(el('option', { value, text: label }));
  for (const g of groups || []) {
    const og = el('optgroup', { label: plain(g.label) });
    for (const [value, label] of g.options) og.append(el('option', { value, text: label }));
    select.append(og);
  }
}

function ensureCss() {
  if (typeof document === 'undefined') return;
  if (document.querySelector('link[href$="ui-subject.css"]')) return;
  try {
    const href = new URL('../css/ui-subject.css', import.meta.url).href;
    document.head.append(el('link', { rel: 'stylesheet', href }));
  } catch { /* ignore */ }
}
