// Claude access: whether the office signs in with the Claude Code login on
// this machine or an Anthropic API key. The key goes to the server once and
// never comes back; the page only shows its last four.

const btn = document.getElementById('acctBtn');
const pop = document.getElementById('acctPop');

const CHOICES = [
  { id: 'login', name: 'Claude Code login' },
  { id: 'apikey', name: 'API key' },
];

let status = null;
let picked = null; // the choice on screen, which may not be saved yet
let busy = false;
let note = '';

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

function render() {
  if (!pop) return;
  if (!status) {
    pop.replaceChildren(el('p', { className: 'theme-k', textContent: 'Claude access' }),
      el('p', { className: 'acct-note', textContent: note || 'Checking…' }));
    return;
  }
  const mode = picked || status.mode;
  pop.replaceChildren();

  const row = el('div', { className: 'theme-modes acct-modes' });
  row.setAttribute('role', 'radiogroup');
  for (const c of CHOICES) {
    const b = el('button', { type: 'button' });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(c.id === mode));
    b.append(el('span', { textContent: c.name }));
    b.addEventListener('click', () => {
      picked = c.id;
      note = '';
      // The login needs nothing typed, and a key we already hold doesn't either.
      if (c.id === 'login' || status.keySet) save({ mode: c.id });
      else render();
    });
    row.append(b);
  }
  pop.append(el('p', { className: 'theme-k', textContent: 'Claude access' }), row);

  const say = (text, cls = 'acct-note') => pop.append(el('p', { className: cls, textContent: text }));
  if (mode === 'login') {
    say('Jobs run on your Claude plan, using the login Claude Code keeps on this machine. If it isn’t signed in yet, run claude once in a terminal.');
  } else {
    if (status.keySet && status.mode === 'apikey') {
      say(`Using the key ending ${status.keyHint}${status.keyFrom === 'env' ? ', from ANTHROPIC_API_KEY' : ''}. Jobs are billed to that API account.`);
    } else {
      say('Jobs are billed to the API account the key belongs to. It is kept on this machine only.');
    }
    const form = el('form', { className: 'acct-form' });
    const input = el('input', { type: 'password', placeholder: status.keySet ? 'Replace with another key' : 'sk-ant-…', autocomplete: 'off', spellcheck: false });
    input.setAttribute('aria-label', 'Anthropic API key');
    const go = el('button', { type: 'submit', className: 'primary small', textContent: busy ? 'Checking…' : 'Save', disabled: busy });
    form.append(input, go);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (input.value.trim()) save({ mode: 'apikey', key: input.value });
    });
    pop.append(form);
    if (status.keyFrom === 'office') {
      const forget = el('button', { type: 'button', className: 'acct-forget', textContent: 'Forget this key' });
      forget.addEventListener('click', () => save(null));
      pop.append(forget);
    }
    if (!busy) queueMicrotask(() => { if (!status.keySet) input.focus(); });
  }
  if (note) say(note, 'acct-note acct-err');
  pop.append(el('p', { className: 'acct-note acct-fine', textContent: 'Jobs already running finish the way they started.' }));
}

async function save(body) {
  busy = true;
  note = '';
  render();
  try {
    const res = await fetch('/api/auth', body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : { method: 'DELETE' });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || 'That didn’t save.');
    status = out;
    picked = null;
  } catch (err) {
    note = err.message;
  }
  busy = false;
  render();
}

// From the server's hello and from changes made in another tab.
export function setAccess(next) {
  if (!next) return;
  status = next;
  if (!busy) render();
}

function open(on) {
  pop.hidden = !on;
  btn.setAttribute('aria-expanded', String(on));
  if (!on) { picked = null; note = ''; }
  render();
  if (on) pop.querySelector('[aria-checked="true"]')?.focus();
  // A server older than this page doesn't send it in its hello.
  if (on && !status) {
    fetch('/api/auth').then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setAccess, () => { note = 'Restart the office server to choose this.'; render(); });
  }
}

btn?.addEventListener('click', () => open(pop.hidden));
// Appearance stops its clicks from reaching the page, so close for it here.
document.getElementById('themeBtn')?.addEventListener('click', () => { if (!pop.hidden) open(false); });
document.addEventListener('click', (e) => {
  if (pop && !pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) open(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pop && !pop.hidden) { open(false); btn.focus(); }
});
