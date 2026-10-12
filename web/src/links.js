// Linked offices: invite another office or a guest with a one-time code, enter
// someone else's code, see and end links. A link needs a handle, claimed here
// or on the leaderboard; claiming one doesn't put the office on the board.
//
// Also the `visiting` flag: when this page shows a host's office as a guest,
// the controls a guest can't use are hidden and new work is held to the
// repos and clearance the host allowed.

const btn = document.getElementById('linkBtn');
const pop = document.getElementById('linkPop');
const app = document.getElementById('app');

const MODES = [{ id: 'plan', name: 'Plan only' }, { id: 'edit', name: 'Edit files' }, { id: 'auto', name: 'Full autonomy' }];
// What a guest's own agents may do in the shared projects (server/visits.js).
const THEIRS = [{ id: 'off', name: 'Off' }, { id: 'read', name: 'Read only' }, { id: 'edit', name: 'Edit a copy' }];
const RANK = { plan: 0, edit: 1, auto: 2 };
const TOKENS_PER_DAY = 2_000_000;
// Crockford base32 reads I and L as 1 and O as 0, so a misread code still works.
const CROCKFORD = /^[0-9A-HJKMNP-TV-Z]{8}$/;

let links = null;   // [{ id, peer, kind: 'link' | 'guest', role: 'peer' | 'host' | 'guest', createdAt, guest? }]
let line = {};      // { handle, connected, error }: this office on the link service
let board = null;   // the leaderboard status, which also knows the handle
let invite = null;  // { kind, code, expiresAt }
let guestForm = null; // { repos: Set, clearance, full, tokensPerDay, ourAgents, theirAgents, edit: link id | null }
let repos = null;
let busy = '';
let note = '';
let copied = false;

const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids.filter((k) => k != null && k !== false));
  return n;
};
const say = (text, cls = 'acct-note') => el('p', { className: cls, textContent: text });

async function call(path, body, method) {
  const init = body === undefined ? { method: method || 'GET' }
    : { method: method || 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, init);
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(out.error || (res.status === 404 ? 'Restart the office server to use links.' : 'That didn’t work.'));
  return out;
}

// "k7qx m2pd", "K7QX-M2PD" and "k7qxm2pd" are the same code.
export function normalizeCode(raw) {
  const s = String(raw || '').toUpperCase().replace(/[\s-]+/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  return CROCKFORD.test(s) ? s : null;
}
const shown = (code) => { const s = String(code).toUpperCase().replace(/-/g, ''); return `${s.slice(0, 4)}-${s.slice(4)}`; };

function tokens(n) {
  if (n >= 1e6) return `${+(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(n);
}
function expiry(at) {
  const ms = typeof at === 'number' ? at : Date.parse(at);
  if (!ms) return '';
  const left = ms - Date.now();
  if (left <= 0) return 'Expired. Make a new one.';
  const mins = Math.ceil(left / 6e4), h = Math.floor(mins / 60), m = mins % 60;
  const when = new Date(ms).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  return `Works once. Expires in ${h ? `${h} h ${m} min` : `${m} min`} (${when}).`;
}

function policy(g) {
  const n = g.repos?.length || 0;
  const mode = MODES.find((m) => m.id === g.clearance)?.name || g.clearance;
  const theirs = g.theirAgents === 'read' ? 'their agents read only' : g.theirAgents === 'edit' ? 'their agents edit a copy' : '';
  return [n === 1 ? g.repos[0] : `${n} projects`,
    ...(g.ourAgents === false ? ['our agents not lent'] : [mode, `${tokens(g.tokensPerDay || 0)} tokens a day`]),
    theirs].filter(Boolean).join(' · ');
}

function kindOf(l) {
  if (l.kind !== 'guest') return 'Linked office';
  return l.role === 'guest' ? 'Guest · you work with their agents' : 'Guest · they work with yours';
}

// ---------- the panel ----------

function render() {
  if (!pop || pop.hidden) return;
  const handle = line.handle || board?.handle;
  pop.replaceChildren(el('p', { className: 'theme-k', textContent: 'Linked offices' }));

  if (!handle) pop.append(...claim());
  else {
    pop.append(el('p', { className: 'lb-me' }, 'This office is ', el('strong', { textContent: `@${handle}` })));
    pop.append(actions());
    if (invite) pop.append(code());
    if (guestForm) pop.append(guest());
  }
  if (note) pop.append(say(note, 'acct-note acct-err'));
  if (line.error) pop.append(say(`Link service: ${line.error}`, 'acct-note acct-err'));
  else if (links?.length && line.connected === false) pop.append(say('Connecting to the link service…', 'acct-note acct-fine'));
  pop.append(list());
}

// A handle, without joining the leaderboard. A server from before this change
// only has "join", which also shares counters, so don't offer it there.
function claim() {
  const out = [say('Invite a guest to run jobs here within the limits you set. Their agents walk into your office as visitors. First, pick a handle for this office.')];
  if (board && !board.configured) return [...out, say('This office has no link service set up.', 'acct-note acct-err')];
  const form = el('form', { className: 'acct-form' });
  const input = el('input', { type: 'text', placeholder: 'Pick a handle', autocomplete: 'off', spellcheck: false, maxLength: 20 });
  input.setAttribute('aria-label', 'Handle');
  form.append(input, el('button', { type: 'submit', className: 'primary small', textContent: busy === 'claim' ? 'Claiming…' : 'Claim', disabled: !!busy }));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!input.value.trim()) return;
    await run('claim', async () => {
      setBoard(await call('/api/leaderboard/handle', { handle: input.value.trim() }), true);
      setLinks(await call('/api/links'));
    });
  });
  return [...out, form, say('Claiming a handle doesn’t put you on the leaderboard. Sharing your counters there is a separate choice.', 'acct-note acct-fine')];
}

function actions() {
  const wrap = el('div', { className: 'link-actions' });
  const asGuest = el('button', { type: 'button', className: 'ghost small', textContent: 'Invite a guest', disabled: !!busy });
  asGuest.setAttribute('aria-expanded', String(!!guestForm && !guestForm.edit));
  asGuest.addEventListener('click', () => openGuest());

  const form = el('form', { className: 'acct-form link-redeem' });
  const input = el('input', { type: 'text', placeholder: 'Enter a code, e.g. K7QX-M2PD', autocomplete: 'off', spellcheck: false, maxLength: 12 });
  input.setAttribute('aria-label', 'Invite code');
  form.append(input, el('button', { type: 'submit', className: 'primary small', textContent: busy === 'redeem' ? 'Linking…' : 'Link', disabled: !!busy }));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const c = normalizeCode(input.value);
    if (!c) { note = 'A code is 8 letters and numbers, like K7QX-M2PD.'; render(); return; }
    run('redeem', async () => {
      setLinks(await call('/api/links/redeem', { code: c }));
      invite = null;
    });
  });
  wrap.append(el('div', { className: 'link-row' }, asGuest), form);
  return wrap;
}

function code() {
  const box = el('div', { className: 'link-code' });
  const c = shown(invite.code);
  const copy = el('button', { type: 'button', className: 'ghost small', textContent: copied ? 'Copied' : 'Copy' });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(c); copied = true; } catch { note = 'Couldn’t copy. Select the code and copy it by hand.'; }
    render();
  });
  box.append(
    el('p', { className: 'theme-k', textContent: invite.kind === 'guest' ? 'Guest code' : 'Office code' }),
    el('div', { className: 'link-code-row' }, el('output', { className: 'link-code-v', textContent: c }), copy),
    say(`${invite.kind === 'guest' ? 'Give this to your guest. They enter it in their own office.' : 'Give this to the other office. They enter it under Linked offices.'} ${expiry(invite.expiresAt)}`, 'acct-note acct-fine'),
  );
  return box;
}

async function openGuest(l) {
  const same = l?.id ? guestForm?.edit === l.id : guestForm && !guestForm.edit;
  if (same) { guestForm = null; render(); return; }
  const g = l?.guest;
  guestForm = g
    ? { repos: new Set(g.repos || []), clearance: g.clearance === 'auto' ? 'edit' : g.clearance || 'edit', full: g.clearance === 'auto',
      tokensPerDay: g.tokensPerDay || TOKENS_PER_DAY, ourAgents: g.ourAgents !== false, theirAgents: g.theirAgents || 'off', edit: l.id, peer: l.peer }
    : { repos: new Set(), clearance: 'edit', full: false, tokensPerDay: TOKENS_PER_DAY, ourAgents: true, theirAgents: 'off', edit: null };
  invite = null;
  note = '';
  render();
  if (!repos) {
    try { repos = (await call('/api/repos')).repos || []; } catch (err) { repos = []; note = err.message; }
    render();
  }
}

function guest() {
  const f = guestForm;
  const form = el('form', { className: 'link-guest' });
  form.append(el('p', { className: 'theme-k', textContent: f.edit ? `What @${f.peer} can do` : 'Invite a guest' }),
    say('Pick the projects they can work in, then whose agents do the work: yours, on your Claude account, or their own, on theirs.', 'acct-note acct-fine'));

  const pick = el('fieldset', { className: 'link-repos' }, el('legend', { textContent: `Projects they can use (${f.repos.size} picked)` }));
  if (!repos) pick.append(say('Loading…', 'acct-note acct-fine'));
  else if (!repos.length) pick.append(say('No projects found.', 'acct-note acct-fine'));
  // A project shared before but gone from disk still shows, so saving doesn't drop it silently.
  for (const r of [...new Set([...(repos || []), ...(repos ? f.repos : [])])]) {
    const box = el('input', { type: 'checkbox', checked: f.repos.has(r) });
    box.addEventListener('change', () => { box.checked ? f.repos.add(r) : f.repos.delete(r); render(); });
    pick.append(el('label', {}, box, el('span', { textContent: r })));
  }

  // Our agents: the clearance cap and the token allowance only mean anything while they're lent.
  const lend = el('input', { type: 'checkbox', checked: f.ourAgents });
  lend.addEventListener('change', () => { f.ourAgents = lend.checked; render(); });
  const ours = el('fieldset', { className: 'link-ours', disabled: !f.ourAgents });
  ours.classList.toggle('off', !f.ourAgents);

  const caps = el('div', { className: 'theme-modes acct-modes link-cap' });
  caps.setAttribute('role', 'radiogroup');
  caps.setAttribute('aria-label', 'Clearance cap');
  for (const m of MODES.slice(0, 2)) {
    const b = el('button', { type: 'button', textContent: m.name, disabled: f.full });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(!f.full && f.clearance === m.id));
    b.addEventListener('click', () => { f.clearance = m.id; render(); });
    caps.append(b);
  }
  const full = el('input', { type: 'checkbox', checked: f.full });
  full.addEventListener('change', () => { f.full = full.checked; render(); });
  const warn = el('div', { className: 'link-warn' },
    el('p', { textContent: 'Full autonomy lets the guest run any command on this machine, with your files and your logins. Only allow it for someone you’d hand your laptop to.' }),
    el('label', {}, full, el('span', { textContent: 'Allow full autonomy anyway' })));

  const perDay = el('input', { type: 'number', min: 100000, step: 100000, value: f.tokensPerDay, required: f.ourAgents });
  perDay.setAttribute('aria-label', 'Tokens per day');
  const hint = el('span', { className: 'acct-fine', textContent: tokens(f.tokensPerDay) });
  perDay.addEventListener('input', () => { f.tokensPerDay = Math.floor(Number(perDay.value)) || 0; hint.textContent = tokens(f.tokensPerDay); });
  ours.append(el('p', { className: 'link-k', textContent: 'Clearance cap' }), caps, warn,
    el('label', { className: 'link-k link-tokens' }, el('span', { textContent: 'Tokens per day' }), perDay, hint));

  // Their agents: run on their machine and account, in a copy of the project.
  const theirs = el('div', { className: 'theme-modes acct-modes link-cap link-theirs' });
  theirs.setAttribute('role', 'radiogroup');
  theirs.setAttribute('aria-label', 'Their agents');
  for (const m of THEIRS) {
    const b = el('button', { type: 'button', textContent: m.name });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(f.theirAgents === m.id));
    b.addEventListener('click', () => { f.theirAgents = m.id; render(); });
    theirs.append(b);
  }

  const neither = !f.ourAgents && f.theirAgents === 'off';
  const ready = f.repos.size > 0 && !neither && !busy;
  const why = !f.repos.size ? 'Pick at least one project.' : neither ? 'Lend your agents, or let theirs in.' : '';
  form.append(pick,
    el('label', { className: 'link-switch' }, lend, el('span', {}, el('strong', { textContent: 'Lend our agents' }),
      el('span', { className: 'acct-fine', textContent: 'They start jobs with your agents, on your Claude account.' }))),
    ours,
    el('p', { className: 'link-k', textContent: 'Their agents' }), theirs,
    say(f.theirAgents === 'off' ? 'Their own agents can’t work in your projects.'
      : `Their own agents, on their account, work in a copy${f.theirAgents === 'edit' ? '. Nothing reaches your folder until you apply it from the job.' : ' and can’t change anything.'} They have no shell, so they can’t run anything here.`, 'acct-note acct-fine'),
    el('div', { className: 'link-row' },
      el('button', { type: 'submit', className: 'primary small', disabled: !ready,
        textContent: f.edit ? (busy === 'guest' ? 'Saving…' : 'Save') : busy === 'guest' ? 'Making a code…' : 'Make guest code' }),
      f.edit ? cancel() : null,
      why ? el('span', { className: 'acct-fine', textContent: why }) : null));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!f.repos.size || neither) { note = why; render(); return; }
    if (f.ourAgents && f.tokensPerDay < 100000) { note = 'Allow at least 100,000 tokens a day.'; render(); return; }
    const g = { repos: [...f.repos], clearance: f.full ? 'auto' : f.clearance, tokensPerDay: Math.max(f.tokensPerDay, 100000), ourAgents: f.ourAgents, theirAgents: f.theirAgents };
    if (f.edit) saveGuest(f.edit, g);
    else makeInvite('guest', g);
  });
  return form;
}

function cancel() {
  const b = el('button', { type: 'button', className: 'ghost small', textContent: 'Cancel' });
  b.addEventListener('click', () => { guestForm = null; render(); });
  return b;
}

function list() {
  const wrap = el('div', { className: 'lb-board' });
  if (!links) { wrap.append(say('Loading links…', 'acct-note acct-fine')); return wrap; }
  if (!links.length) { wrap.append(say('No links yet.', 'acct-note acct-fine')); return wrap; }
  const ul = el('ul', { className: 'lb-list link-list' });
  for (const l of links) {
    const li = el('li', { className: 'link-item' },
      el('span', { className: 'link-who' }, el('strong', { textContent: `@${l.peer}` }),
        el('span', { className: 'acct-fine', textContent: kindOf(l) }),
        l.guest ? el('span', { className: 'acct-fine link-policy', textContent: policy(l.guest) }) : null));
    // Their agents are tagged from our own chat, like ours; nothing to open.
    if (l.kind === 'guest' && l.role === 'guest') li.querySelector('.link-who').append(el('span', { className: 'acct-fine', textContent: 'Tag their agents in chat with @' }));
    const end = el('span', { className: 'link-row' });
    if (l.kind === 'guest' && l.role === 'host' && l.guest) {
      const edit = el('button', { type: 'button', className: 'ghost small', textContent: 'Change', disabled: !!busy });
      edit.setAttribute('aria-expanded', String(guestForm?.edit === l.id));
      edit.addEventListener('click', () => openGuest(l));
      end.append(edit);
    }
    const cut = el('button', { type: 'button', className: 'acct-forget', textContent: busy === l.id ? 'Unlinking…' : 'Unlink', disabled: !!busy });
    cut.addEventListener('click', () => unlink(l));
    end.append(cut);
    li.append(end);
    ul.append(li);
  }
  wrap.append(ul);
  return wrap;
}

// ---------- actions ----------

async function run(what, fn) {
  busy = what;
  note = '';
  render();
  try { await fn(); } catch (err) { note = err.message; }
  busy = '';
  render();
}

function makeInvite(kind, guestPolicy) {
  copied = false;
  return run(kind, async () => {
    const out = await call('/api/links/invite', guestPolicy ? { kind, guest: guestPolicy } : { kind });
    invite = { kind: out.kind || kind, code: out.code, expiresAt: out.expiresAt };
    guestForm = null;
  });
}

function saveGuest(id, g) {
  return run('guest', async () => {
    setLinks(await call(`/api/links/${encodeURIComponent(id)}/guest`, { guest: g }));
    guestForm = null;
  });
}

function unlink(l) {
  const why = l.kind !== 'guest' ? `You stop seeing each other’s agents.`
    : l.role === 'host' ? `Their running jobs stop and they lose access right away.`
      : `You can’t work with their agents again without a new code.`;
  if (!confirm(`Unlink @${l.peer}? ${why}`)) return;
  run(l.id, async () => {
    setLinks(await call(`/api/links/${encodeURIComponent(l.id)}`, undefined, 'DELETE'));
  });
}

function setBoard(next, tell = false) {
  board = next;
  if (tell) document.dispatchEvent(new CustomEvent('office:leaderboard', { detail: next }));
}

// ---------- from the server ----------

// The link status, from the hello, every { t: 'links' } and every links call:
// { handle, connected, error, links }.
export function setLinks(next) {
  if (!next || !Array.isArray(next.links)) return;
  links = next.links;
  line = { handle: next.handle || null, connected: next.connected, error: next.error || null };
  paintVisit();
  if (!busy) render();
}

document.addEventListener('office:leaderboard', (e) => { board = e.detail; if (!busy) render(); });

function open(on) {
  pop.hidden = !on;
  btn.setAttribute('aria-expanded', String(on));
  if (!on) { note = ''; guestForm = null; copied = false; return; }
  render();
  call('/api/links').then(setLinks, (err) => { links ||= []; note = err.message; render(); });
  if (!board) call('/api/leaderboard').then((s) => { board = s; render(); }, () => {});
}

btn?.addEventListener('click', () => open(pop.hidden));
// These keep their clicks from reaching the page, so close for them here.
for (const id of ['themeBtn', 'acctBtn']) document.getElementById(id)?.addEventListener('click', () => { if (!pop.hidden) open(false); });
document.addEventListener('click', (e) => {
  // A rerender can detach the clicked node before this runs; it was inside.
  if (pop && !pop.hidden && e.target.isConnected && !pop.contains(e.target) && !btn.contains(e.target)) open(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pop && !pop.hidden) { open(false); btn.focus(); }
});

// ---------- visiting a host's office as their guest ----------

// Set from ?visit=<link id> before the socket opens, so nothing a guest can't
// use ever flashes up; the host's policy arrives with the visit's hello.
export const visiting = {
  on: false, link: null, host: '', repos: null, clearance: 'edit', tokensPerDay: 0,
};
{
  const id = new URLSearchParams(location.search).get('visit');
  if (id) Object.assign(visiting, { on: true, link: id });
}

export function setVisiting(v) {
  if (!v) return;
  closed = '';
  Object.assign(visiting, {
    on: true,
    link: v.link ?? visiting.link,
    host: v.host ?? visiting.host,
    repos: Array.isArray(v.repos) ? v.repos : visiting.repos,
    clearance: RANK[v.clearance] != null ? v.clearance : visiting.clearance,
    tokensPerDay: v.tokensPerDay ?? visiting.tokensPerDay,
  });
  paintVisit();
}

// A job's API path: the host's, through our server, while visiting.
export function jobPath(id, rest = '') {
  // Encoded, so a host's job id can't walk the path to another of our routes.
  id = encodeURIComponent(id);
  return visiting.on ? `/api/visit/${encodeURIComponent(visiting.link)}/jobs/${id}${rest}` : `/api/jobs/${id}${rest}`;
}
// A follow-up's body: the host takes plain text, and files can't cross.
export function replyBody(message, mode, files) {
  return visiting.on ? { text: message, mode } : { message, mode, files };
}

// A guest has no chat with the host's Chief: the composer starts a job
// directly, in the one allowed project named with a #tag.
const tagOf = (r) => `#${r.replace(/\s+/g, '-')}`.toLowerCase();
export async function visitJob({ text, mode, model }) {
  const tags = (text.match(/(^|\s)#[\w.-]+/g) || []).map((t) => t.trim().toLowerCase());
  const repos = visiting.repos || [];
  const named = repos.filter((r) => tags.includes(tagOf(r)));
  if (named.length !== 1) {
    const list = repos.map(tagOf).join(', ') || 'none yet';
    throw new Error(named.length ? 'Name just one project per job.' : `Name the project with a # tag. You can use: ${list}.`);
  }
  const repo = named[0];
  const prompt = text.replace(new RegExp(`(^|\\s)${tagOf(repo).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i'), ' ').replace(/\s+/g, ' ').trim();
  if (!prompt) throw new Error('Say what the job is, as well as the project.');
  const { job } = await call(`/api/visit/${encodeURIComponent(visiting.link)}/jobs`, { repo, prompt, mode, model });
  return job;
}

// Only the clearances at or below the host's cap, for every mode picker.
export function capModes(modes) {
  if (!visiting.on || !modes) return modes;
  return Object.fromEntries(Object.entries(modes).filter(([k]) => (RANK[k] ?? 9) <= RANK[visiting.clearance]));
}
// Only the repos the host allowed. Until the policy arrives, none.
export function allowRepos(list) {
  if (!visiting.on || !Array.isArray(list)) return list;
  return list.filter((r) => visiting.repos?.includes(r));
}

// What to do when the visit socket closes: null for a normal reconnect, 0 to
// stop, or how long to wait before trying the host again.
let closed = '';
let ended = false;
export function visitClosed(code) {
  if (!visiting.on) return null;
  if (code === 4404) closed = 'The host ended this link. You can’t visit any more.';
  else if (code === 4502) closed = 'Can’t reach the host’s office right now. Trying again…';
  else { closed = ''; return null; }
  ended = code === 4404;
  paintVisit();
  return code === 4404 ? 0 : 10000;
}

function paintVisit() {
  if (!visiting.on) return;
  const host = visiting.host || links?.find((l) => l.id === visiting.link)?.peer || '';
  if (host) visiting.host = host;
  app.classList.add('visiting');
  app.dataset.visiting = host;
  // Once the host has ended the link there's nothing left to ask them.
  app.classList.toggle('visit-ended', !!ended);
  const input = document.getElementById('input');
  if (input) {
    input.placeholder = ended ? 'This link has ended.' : `Start a job${host ? ` at @${host}` : ''} · #project`;
    for (const c of document.querySelectorAll('#composer textarea, #composer select, #composer button')) c.disabled = !!ended;
  }
  const mode = document.getElementById('mode');
  if (mode) {
    for (const o of mode.options) o.hidden = o.disabled = RANK[o.value] > RANK[visiting.clearance];
    if (mode.selectedOptions[0]?.disabled) mode.value = visiting.clearance;
  }
  let bar = document.getElementById('visitBar');
  if (!bar) {
    bar = el('div', { className: 'visit-bar', id: 'visitBar' });
    bar.setAttribute('role', 'status');
    document.querySelector('.brand')?.after(bar);
  }
  const back = el('a', { href: location.pathname, textContent: 'Back to my office' });
  bar.replaceChildren(el('span', {}, 'Visiting ', el('strong', { textContent: host ? `@${host}` : 'a linked office' }),
    visiting.repos ? ` · ${visiting.repos.length} ${visiting.repos.length === 1 ? 'project' : 'projects'}, up to ${MODES.find((m) => m.id === visiting.clearance)?.name.toLowerCase()}` : ''), back);
  bar.classList.toggle('visit-off', !!closed);
  if (closed) bar.append(el('p', { className: 'visit-note', textContent: closed }));
}
paintVisit();
