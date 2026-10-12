// The leaderboard: join under a claimed handle, see where this office stands,
// leave and be forgotten. Only day counters are shared (jobs finished, tokens,
// agent time); the popover says so before anything is sent.
//
// A server that reports `sharing` can hold a handle (which links need)
// without sharing counters, so once there's a handle the board is a toggle.

const btn = document.getElementById('lbBtn');
const pop = document.getElementById('lbPop');

const METRICS = [
  { id: 'jobs', name: 'Jobs', value: (r) => String(r.jobs) },
  { id: 'tokens', name: 'Tokens', value: (r) => tokens(r.tokens) },
  { id: 'time', name: 'Time', value: (r) => span(r.seconds) },
];
const PERIODS = [{ id: 'week', name: 'This week' }, { id: 'all', name: 'All time' }];

let status = null;
let period = 'week';
let metric = 'jobs';
let data = null; // { period, jobs, tokens, time, players }
let loading = false;
let busy = false;
let note = '';
let boardNote = '';

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);

function tokens(n) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(n >= 1e5 ? 0 : 1)}k`;
  return String(n);
}
function span(sec) {
  const m = Math.round(sec / 60);
  if (m < 1) return sec > 0 ? '<1m' : '0m';
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
function ago(ms) {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 90) return 'just now';
  if (s < 5400) return `${Math.round(s / 60)} min ago`;
  return s < 129600 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86400)} days ago`;
}

function tabs(items, current, label, pick, cls = '') {
  const row = el('div', { className: `theme-modes lb-tabs ${cls}` });
  row.setAttribute('role', 'radiogroup');
  row.setAttribute('aria-label', label);
  for (const it of items) {
    const b = el('button', { type: 'button' });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(it.id === current));
    b.append(el('span', { textContent: it.name }));
    b.addEventListener('click', () => pick(it.id));
    row.append(b);
  }
  return row;
}

function render() {
  if (!pop) return;
  pop.replaceChildren(el('p', { className: 'theme-k', textContent: 'Leaderboard' }));
  const say = (text, cls = 'acct-note') => pop.append(el('p', { className: cls, textContent: text }));
  if (!status) { say(note || 'Checking…'); return; }
  if (!status.configured) {
    say('No leaderboard is set up for this office. Whoever hosts one gives you its address: set it as OFFICE_LEADERBOARD_URL and restart the office.');
    return;
  }

  if (split()) {
    mine();
  } else if (status.joined) {
    const w = status.week;
    const me = el('p', { className: 'lb-me' });
    pop.append(me);
    me.append(el('strong', { textContent: status.handle }),
      el('span', { textContent: ` · ${w.jobs} ${w.jobs === 1 ? 'job' : 'jobs'}, ${tokens(w.tokens)} tokens, ${span(w.seconds)} this week` }));
    const sync = status.error ? `Not shared yet: ${status.error}` : status.lastSync ? `Shared ${ago(status.lastSync)}.` : 'Sharing…';
    say(sync, status.error ? 'acct-note acct-err' : 'acct-note acct-fine');
  } else {
    say('Compete on jobs finished, tokens used and time your agents spend working. Joining shares exactly these counters per day, for the last two weeks and from now on, under the handle you claim. Never prompts, projects, files, chat or cost.');
    const form = el('form', { className: 'acct-form' });
    const input = el('input', { type: 'text', placeholder: 'Pick a handle', autocomplete: 'off', spellcheck: false, maxLength: 20 });
    input.setAttribute('aria-label', 'Handle');
    form.append(input, el('button', { type: 'submit', className: 'primary small', textContent: busy ? 'Joining…' : 'Join', disabled: busy }));
    form.addEventListener('submit', (e) => { e.preventDefault(); if (input.value.trim()) change('POST', { handle: input.value }); });
    pop.append(form);
    if (note) say(note, 'acct-note acct-err');
  }

  pop.append(
    tabs(PERIODS, period, 'Period', (id) => { period = id; load(); }, 'lb-period'),
    tabs(METRICS, metric, 'Ranked by', (id) => { metric = id; render(); }, 'lb-metric'),
  );
  pop.append(table());
  if (status.joined && !split()) {
    const leave = el('button', { type: 'button', className: 'acct-forget', textContent: busy ? 'Working…' : 'Leave and delete my data', disabled: busy });
    leave.addEventListener('click', () => { if (confirm('Leave the leaderboard? Your handle is released and your counters are deleted from the service.')) change('DELETE'); });
    pop.append(leave);
    if (note) say(note, 'acct-note acct-err');
  }
}

// With no handle yet, joining claims one and shares, as before.
const split = () => !!status && 'sharing' in status && !!status.handle;

// A handle, and whether to share counters under it.
function mine() {
  const say = (text, cls = 'acct-note') => pop.append(el('p', { className: cls, textContent: text }));
  const me = el('p', { className: 'lb-me' });
  me.append(el('strong', { textContent: status.handle }));
  if (status.sharing && status.week) {
    const w = status.week;
    me.append(el('span', { textContent: ` · ${w.jobs} ${w.jobs === 1 ? 'job' : 'jobs'}, ${tokens(w.tokens)} tokens, ${span(w.seconds)} this week` }));
  }
  pop.append(me);
  const box = el('input', { type: 'checkbox', checked: !!status.sharing, disabled: busy });
  box.addEventListener('change', () => {
    if (box.checked) { change('POST', { handle: status.handle }); return; }
    const ask = 'Stop sharing? Your counters are deleted from the board. You keep your handle while you have linked offices; with none, the handle is released too.';
    if (confirm(ask)) change('DELETE'); else box.checked = true;
  });
  const share = el('label', { className: 'lb-share' });
  share.append(box, el('span', { textContent: 'Share my counters on the board' }));
  pop.append(share);
  if (status.sharing) {
    const sync = status.error ? `Not shared yet: ${status.error}` : status.lastSync ? `Shared ${ago(status.lastSync)}.` : 'Sharing…';
    say(sync, status.error ? 'acct-note acct-err' : 'acct-note acct-fine');
  } else {
    say('Sharing sends jobs finished, tokens and agent time per day, for the last two weeks and from now on. Never prompts, projects, files, chat or cost.', 'acct-note acct-fine');
  }
  if (note) say(note, 'acct-note acct-err');
}

function table() {
  const wrap = el('div', { className: 'lb-board' });
  if (!data) {
    wrap.append(el('p', { className: 'acct-note', textContent: loading ? 'Loading…' : boardNote || 'No board yet.' }));
    return wrap;
  }
  const key = metric === 'time' ? 'time' : metric;
  const rows = data[key] || [];
  if (!rows.length) {
    wrap.append(el('p', { className: 'acct-note', textContent: 'Nobody on the board yet.' }));
    return wrap;
  }
  const m = METRICS.find((x) => x.id === metric);
  const list = el('ol', { className: 'lb-list' });
  for (const r of rows) {
    const li = el('li', { className: r.handle.toLowerCase() === status.handle?.toLowerCase() ? 'lb-row lb-you' : 'lb-row' });
    li.append(el('span', { className: 'lb-rank', textContent: String(r.rank) }),
      el('span', { className: 'lb-name', textContent: r.handle }),
      el('span', { className: 'lb-val', textContent: m.value(r) }));
    list.append(li);
  }
  wrap.append(list);
  if (data.players > rows.length) wrap.append(el('p', { className: 'acct-note acct-fine', textContent: `Top ${rows.length} of ${data.players}.` }));
  if (data.since) wrap.append(el('p', { className: 'acct-note acct-fine', textContent: `Weeks start Monday, UTC.` }));
  return wrap;
}

async function load() {
  if (!status?.configured) return;
  loading = true;
  boardNote = '';
  render();
  try {
    const res = await fetch(`/api/leaderboard/board?period=${period}`);
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || 'Couldn’t load the board.');
    data = out;
  } catch (err) {
    data = null;
    boardNote = err.message;
  }
  loading = false;
  if (!pop.hidden) render();
}

async function change(method, body) {
  busy = true;
  note = '';
  render();
  try {
    const res = await fetch('/api/leaderboard', method === 'POST'
      ? { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
      : { method });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || 'That didn’t work.');
    adopt(out);
    data = null;
  } catch (err) {
    note = err.message;
  }
  busy = false;
  render();
  if (!note) load();
}

// From the server's hello, and whenever a sync lands.
export function setLeaderboard(next) {
  if (!next) return;
  adopt(next);
  if (!busy && !pop.hidden) render();
}

// The links panel needs the handle too, and can claim one itself.
function adopt(next) {
  status = next;
  document.dispatchEvent(new CustomEvent('office:leaderboard', { detail: next }));
}
document.addEventListener('office:leaderboard', (e) => {
  if (e.detail === status) return;
  status = e.detail;
  if (!busy && pop && !pop.hidden) render();
});

function open(on) {
  pop.hidden = !on;
  btn.setAttribute('aria-expanded', String(on));
  if (!on) { note = ''; return; }
  render();
  if (!status) {
    fetch('/api/leaderboard').then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((s) => { adopt(s); render(); load(); }, () => { note = 'Restart the office server to use this.'; render(); });
  } else {
    load();
  }
}

btn?.addEventListener('click', () => open(pop.hidden));
// These two keep their clicks from reaching the page, so close for them here.
for (const id of ['themeBtn', 'acctBtn']) document.getElementById(id)?.addEventListener('click', () => { if (!pop.hidden) open(false); });
document.addEventListener('click', (e) => {
  // The path is fixed at dispatch; a click that re-rendered the popover has
  // already detached its target, so contains() would call it an outside click.
  const path = e.composedPath();
  if (pop && !pop.hidden && !path.includes(pop) && !path.includes(btn)) open(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pop && !pop.hidden) { open(false); btn.focus(); }
});

// First visit: ask for a name and claim it as the handle. Claiming doesn't
// share anything; joining the board stays a separate choice.
const ASKED = 'office.nameAsked';
const NAME = 'office.name';
// What comes next in onboarding (meeting the team); main.js sets it.
let welcomed = () => {};
export function onWelcomed(fn) { welcomed = fn; }
const toHandle = (name) => name.trim().replace(/\s+/g, '_').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 20);

function askName() {
  const dlg = el('dialog', { className: 'name-ask' });
  const form = el('form', { method: 'dialog' });
  const input = el('input', { type: 'text', placeholder: 'Your name', autocomplete: 'off', spellcheck: false, maxLength: 40 });
  input.setAttribute('aria-label', 'Your name');
  const err = el('p', { className: 'acct-note acct-err', hidden: true });
  const go = el('button', { type: 'submit', className: 'primary small', textContent: 'Continue' });
  const skip = el('button', { type: 'button', className: 'acct-forget', textContent: 'Not now' });
  const row = el('div', { className: 'acct-form' });
  row.append(input, go);
  form.append(
    el('h2', { textContent: 'Welcome to the office' }),
    el('p', { className: 'acct-note', textContent: status?.configured ? 'What should we call you? Your name becomes your handle on the leaderboard. Nothing is shared until you join it.' : 'What should we call you?' }),
    row, err, skip);
  dlg.append(form);
  const done = () => { try { localStorage.setItem(ASKED, '1'); } catch {} dlg.close(); dlg.remove(); welcomed(); };
  skip.addEventListener('click', done);
  dlg.addEventListener('cancel', done);
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = input.value.trim();
    const handle = toHandle(name);
    if (!name) return;
    err.hidden = true;
    go.disabled = true;
    try {
      if (status?.configured) {
        if (handle.length < 3) throw new Error('Use at least 3 letters or numbers.');
        const res = await fetch('/api/leaderboard/handle', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle }) });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error || 'That handle didn’t work.');
        adopt(out);
        if (!pop.hidden) render();
      }
      try { localStorage.setItem(NAME, name); } catch {}
      done();
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
      go.disabled = false;
      input.focus();
    }
  });
  document.body.append(dlg);
  dlg.showModal();
  input.focus();
}

try {
  // Not while visiting a linked office: it would cover the host's office.
  if (!localStorage.getItem(ASKED) && !new URLSearchParams(location.search).has('visit')) {
    fetch('/api/leaderboard').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((s) => {
      if (s) adopt(s);
      if (s?.handle) { try { localStorage.setItem(ASKED, '1'); } catch {} return; }
      askName();
    });
  }
} catch { /* storage blocked: don't nag */ }
