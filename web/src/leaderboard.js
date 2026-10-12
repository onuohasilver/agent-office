// The leaderboard: join under a claimed handle, see where this office stands,
// leave and be forgotten. Only day counters are shared (jobs finished, tokens,
// agent time); the popover says so before anything is sent.

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

  if (status.joined) {
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
  if (status.joined) {
    const leave = el('button', { type: 'button', className: 'acct-forget', textContent: busy ? 'Working…' : 'Leave and delete my data', disabled: busy });
    leave.addEventListener('click', () => { if (confirm('Leave the leaderboard? Your handle is released and your counters are deleted from the service.')) change('DELETE'); });
    pop.append(leave);
    if (note) say(note, 'acct-note acct-err');
  }
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
    status = out;
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
  status = next;
  if (!busy && !pop.hidden) render();
}

function open(on) {
  pop.hidden = !on;
  btn.setAttribute('aria-expanded', String(on));
  if (!on) { note = ''; return; }
  render();
  if (!status) {
    fetch('/api/leaderboard').then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((s) => { status = s; render(); load(); }, () => { note = 'Restart the office server to use this.'; render(); });
  } else {
    load();
  }
}

btn?.addEventListener('click', () => open(pop.hidden));
// These two keep their clicks from reaching the page, so close for them here.
for (const id of ['themeBtn', 'acctBtn']) document.getElementById(id)?.addEventListener('click', () => { if (!pop.hidden) open(false); });
document.addEventListener('click', (e) => {
  if (pop && !pop.hidden && !pop.contains(e.target) && !btn.contains(e.target)) open(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pop && !pop.hidden) { open(false); btn.focus(); }
});
