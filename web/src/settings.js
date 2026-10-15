// The Settings page: the office owner, the token limit and the other options the
// office reads at startup, set here instead of in environment variables. The
// server owns the list (name, kind, limits, default); this only draws it, so a
// new setting there shows up here with no change.

import { visiting } from './links.js';

const btn = document.getElementById('setBtn');
const dlg = document.getElementById('settings');

let defs = null; // [{ key, group, label, kind, hint, value, default, custom, ... }]
let draft = {};  // key -> what is in the field now, for fields that differ from saved
let busy = false;
let note = '';
let toast = () => {};

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
el.kids = (node, kids) => { node.append(...kids); return node; };

const shown = (d) => (d.key in draft ? draft[d.key] : d.value);
const label = (d, v) => {
  if (d.kind === 'bool') return v ? 'on' : 'off';
  if (d.kind === 'time') return v || 'off';
  if (d.kind === 'text') return v || 'the account name';
  return d.kind === 'number' ? `${Number(v).toLocaleString()}${d.unit ? ` ${d.unit}` : ''}` : String(v);
};
const okNumber = (d, v) => Number.isInteger(v) && v >= d.min && v <= d.max;
const dirty = () => Object.keys(draft);

function control(d) {
  const v = shown(d);
  const id = `set-${d.key}`;
  const change = (next) => {
    if (Object.is(next, d.value)) delete draft[d.key]; else draft[d.key] = next;
    paintFoot();
    paintRow(d);
  };
  if (d.kind === 'bool') {
    const b = el('button', { type: 'button', id, className: 'set-switch' });
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(!!v));
    b.addEventListener('click', () => { change(!shown(d)); b.setAttribute('aria-checked', String(!!shown(d))); });
    return b;
  }
  if (d.kind === 'choice') {
    const row = el('div', { className: 'theme-modes set-choice' });
    row.setAttribute('role', 'radiogroup');
    row.setAttribute('aria-label', d.label);
    row.style.gridTemplateColumns = `repeat(${d.options.length}, 1fr)`;
    for (const o of d.options) {
      const b = el('button', { type: 'button', textContent: o });
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(o === v));
      b.addEventListener('click', () => {
        change(o);
        for (const x of row.children) x.setAttribute('aria-checked', String(x.textContent === o));
      });
      row.append(b);
    }
    return row;
  }
  const input = el('input', { id, className: 'set-input' });
  input.spellcheck = false;
  input.autocomplete = 'off';
  if (d.kind === 'number') Object.assign(input, { type: 'number', min: d.min, max: d.max, step: d.step || 1, value: v, inputMode: 'numeric' });
  else if (d.kind === 'time') Object.assign(input, { type: 'time', value: v });
  else Object.assign(input, { type: 'text', value: v, maxLength: d.max, placeholder: d.default || 'Your first name' });
  input.addEventListener('input', () => {
    const raw = input.value;
    change(d.kind === 'number' ? (raw === '' ? NaN : Number(raw)) : raw);
  });
  return input;
}

const rows = new Map(); // key -> the row element, to repaint its footnote alone
function paintRow(d) {
  const r = rows.get(d.key);
  if (!r) return;
  r.classList.toggle('set-changed', d.key in draft);
  const fine = r.querySelector('.set-fine');
  fine.replaceChildren();
  const v = shown(d);
  if (d.kind === 'number' && !okNumber(d, v)) {
    fine.textContent = `Use a whole number from ${d.min.toLocaleString()} to ${d.max.toLocaleString()}.`;
    fine.classList.add('acct-err');
    return;
  }
  fine.classList.remove('acct-err');
  if (d.hint) fine.append(d.hint, ' ');
  if (d.custom && !(d.key in draft)) {
    const reset = el('button', { type: 'button', className: 'acct-forget set-reset', textContent: `Use the default (${label(d, d.default)})` });
    reset.addEventListener('click', () => commit({ [d.key]: null }));
    fine.append(reset);
  } else if (!d.custom) {
    fine.append(`Default: ${label(d, d.default)}.`);
  }
}

function paintFoot() {
  const n = dirty().length;
  const save = dlg.querySelector('.set-save');
  const undo = dlg.querySelector('.set-undo');
  const msg = dlg.querySelector('.set-msg');
  if (!save) return;
  const bad = defs.some((d) => d.key in draft && d.kind === 'number' && !okNumber(d, draft[d.key]));
  save.disabled = busy || !n || bad;
  save.textContent = busy ? 'Saving…' : n > 1 ? `Save ${n} changes` : 'Save';
  undo.hidden = !n || busy;
  msg.textContent = note || (n ? 'Unsaved changes' : '');
  msg.classList.toggle('acct-err', !!note);
}

function render() {
  rows.clear();
  const body = dlg.querySelector('.set-body');
  body.replaceChildren();
  if (!defs) {
    body.append(el('p', { className: 'acct-note', textContent: note || 'Loading…' }));
    return;
  }
  const groups = [...new Set(defs.map((d) => d.group))];
  for (const g of groups) {
    const sec = el('section', { className: 'set-group' });
    sec.append(el('h3', { className: 'theme-k', textContent: g }));
    for (const d of defs.filter((x) => x.group === g)) {
      const r = el('div', { className: 'set-row' });
      const text = el('div', { className: 'set-text' });
      const lab = el('label', { className: 'set-label', textContent: d.label });
      lab.htmlFor = `set-${d.key}`;
      text.append(lab, el('p', { className: 'acct-note acct-fine set-fine' }));
      r.append(text, control(d));
      rows.set(d.key, r);
      sec.append(r);
      paintRow(d);
    }
    body.append(sec);
  }
  paintFoot();
}

async function commit(patch) {
  busy = true;
  note = '';
  paintFoot();
  try {
    const res = await fetch('/api/settings', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || 'That didn’t save.');
    for (const k of Object.keys(patch)) delete draft[k];
    apply(out);
    toast('Settings saved', 'good');
  } catch (err) {
    note = err.message;
  }
  busy = false;
  render();
}

let onOwner = () => {};
function apply(msg) {
  defs = msg.settings;
  // Another tab saved a value you hadn't touched: show theirs. One you had
  // edited stays yours until you save or discard it.
  for (const d of defs) if (d.key in draft && Object.is(draft[d.key], d.value)) delete draft[d.key];
  if (msg.owner !== undefined) onOwner(msg.owner);
}

// The current value of a setting, or undefined before the server has said.
export const settingValue = (key) => defs?.find((d) => d.key === key)?.value;

// From the server's hello, and from changes made in another tab.
export function setSettings(msg) {
  if (!msg?.settings) return;
  apply(msg);
  if (dlg?.open && !busy) render();
}

function open() {
  note = '';
  dlg.showModal();
  btn.setAttribute('aria-expanded', 'true');
  render();
  if (!defs) {
    fetch('/api/settings').then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((out) => { apply(out); render(); }, () => { note = 'Restart the office server to use Settings.'; render(); });
  }
  dlg.querySelector('input, button.set-switch, [role=radio]')?.focus();
}

function close() {
  if (dirty().length && !confirm('Discard your unsaved changes?')) return false;
  draft = {};
  dlg.close();
  return true;
}

export function initSettings({ toast: t, renderOwner }) {
  toast = t;
  onOwner = renderOwner;
  if (!btn || !dlg) return;
  // A guest has no say in the host's office.
  if (visiting.on) { btn.hidden = true; return; }
  dlg.append(
    el.kids(el('header', { className: 'set-head' }), [
      el('h2', { textContent: 'Settings' }),
      Object.assign(el('button', { type: 'button', className: 'theme-btn set-x' }), { innerHTML: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>', ariaLabel: 'Close settings' }),
    ]),
    el('div', { className: 'set-body' }),
    el.kids(el('footer', { className: 'set-foot' }), [
      el('span', { className: 'set-msg', role: 'status' }),
      el('button', { type: 'button', className: 'set-undo acct-forget', textContent: 'Discard', hidden: true }),
      el('button', { type: 'button', className: 'primary small set-save', textContent: 'Save', disabled: true }),
    ]),
  );
  dlg.querySelector('.set-x').addEventListener('click', close);
  dlg.querySelector('.set-undo').addEventListener('click', () => { draft = {}; note = ''; render(); });
  dlg.querySelector('.set-save').addEventListener('click', () => commit({ ...draft }));
  btn.addEventListener('click', open);
  // Esc and a click on the backdrop ask before dropping edits.
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
  dlg.addEventListener('close', () => { btn.setAttribute('aria-expanded', 'false'); btn.focus(); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('input') && !dlg.querySelector('.set-save').disabled) { e.preventDefault(); commit({ ...draft }); }
  });
}
