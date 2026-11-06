// Tiny reactive store. API is part of the architecture contract; do not change signatures.
import { createState } from './model.js';
import { evaluate } from './calc.js';

const KEY = 'gibsons-vm-case';
let state = load() || createState();
let evaluation = safeEval(state);
const subs = new Set();

function safeEval(s) {
  try { return evaluate(s); } catch (e) { console.error('evaluate failed', e); return null; }
}
function load() {
  try { const raw = localStorage.getItem(KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}
function notify() {
  evaluation = safeEval(state);
  save();
  for (const fn of subs) { try { fn(state, evaluation); } catch (e) { console.error(e); } }
}

export const store = {
  get: () => state,
  evaluation: () => evaluation,
  update(fn) { const draft = structuredClone(state); fn(draft); state = draft; notify(); },
  replace(next) { state = { ...createState(), ...next }; notify(); },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
};
