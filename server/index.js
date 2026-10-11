import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { summarizeTool, stationFor } from './tools.js';
import { route } from './chief.js';
import { fetchUsage } from './usage.js';
import { writeStandup, dueToday } from './standup.js';
import { sampleProcs, resetProcs, machine } from './procstat.js';
import { transcribe, vocabulary, voiceReady } from './voice.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const ROOT = path.resolve(process.env.OFFICE_ROOT || path.join(APP, '..'));
const PORT = Number(process.env.PORT || 4317);
const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const DATA = path.join(APP, 'data');
const STATE_FILE = path.join(DATA, 'state.json');
const DIST = path.join(APP, 'dist');
const UPLOADS = path.join(DATA, 'uploads');
const MAX_UPLOAD = 25 * 1024 * 1024;
const MAX_LOG = 600;
const MAX_CHAT = 300;
const CHIEF_MODEL = process.env.CHIEF_MODEL || 'sonnet';
// The daily standup, local time; "off" turns it off. Weekdays unless STANDUP_WEEKENDS=1.
const STANDUP_AT = process.env.STANDUP_AT ?? '09:30';
const STANDUP_WEEKENDS = process.env.STANDUP_WEEKENDS === '1';
// After a turn ends, keep the session open briefly: a message that landed
// at the last moment starts another turn instead of being lost.
const GRACE_MS = 2500;

// The roster. Capacity grows with level, so later names are "hires".
// Role, personality and background are defaults; the Team tab edits them.
const STAFF = [
  { id: 'ada', name: 'Ada', shirt: '#e07a5f', hair: '#2b2118', skin: '#8d5a3b',
    role: 'Frontend engineer',
    personality: 'Warm and quick. Sweats the details people can see: spacing, copy, the feel of a click.',
    background: 'Came up building marketing sites, then product UI. Has opinions about loading states.' },
  { id: 'tunde', name: 'Tunde', shirt: '#3d7ea6', hair: '#151515', skin: '#5c3a24',
    role: 'Backend engineer',
    personality: 'Calm and methodical. Says little, checks everything twice.',
    background: 'Years on payments infrastructure. Trusts logs over guesses.' },
  { id: 'mira', name: 'Mira', shirt: '#81b29a', hair: '#7a4b2a', skin: '#e2b48f',
    role: 'Full-stack engineer',
    personality: 'Curious and upbeat. Asks the question nobody else did.',
    background: 'Ran a small startup before joining. Happiest owning a feature end to end.' },
  { id: 'kai', name: 'Kai', shirt: '#f2cc8f', hair: '#1f1f1f', skin: '#c48b5f',
    role: 'Mobile engineer',
    personality: 'Dry humour, steady hands. Never ships without trying it on a device.',
    background: 'Built React Native and Swift apps for fintech. Knows every app store rejection by heart.' },
  { id: 'zola', name: 'Zola', shirt: '#9c6ade', hair: '#2a1a12', skin: '#6b4329',
    role: 'Release and tooling',
    personality: 'Organised and direct. Likes a clean git history and a short checklist.',
    background: 'Former DevOps lead. Builds the scripts everyone else ends up relying on.' },
  { id: 'remi', name: 'Remi', shirt: '#e5989b', hair: '#d9a441', skin: '#f0c9a6',
    role: 'QA and testing',
    personality: 'Playfully sceptical. Finds the edge case, then writes the test for it.',
    background: 'Started in support, so knows how real people break things.' },
  { id: 'obi', name: 'Obi', shirt: '#2a9d8f', hair: '#101010', skin: '#4e2f1c',
    role: 'Data and integrations',
    personality: 'Patient and precise. Reads the API docs before writing a line.',
    background: 'Wired up banks, payment rails and analytics pipelines. Fluent in webhooks.' },
  { id: 'lin', name: 'Lin', shirt: '#577590', hair: '#0d0d0d', skin: '#e8c39e',
    role: 'Security and review',
    personality: 'Quiet, thorough, kind in review. Explains the why behind every change asked for.',
    background: 'Did security audits for years. Reads diffs the way others read novels.' },
];
const PROFILE = { role: 80, personality: 600, background: 600 };

const MODES = {
  plan: { label: 'Plan only', args: ['--permission-mode', 'plan'] },
  edit: { label: 'Edit files', args: ['--permission-mode', 'acceptEdits'] },
  auto: { label: 'Full autonomy', args: ['--permission-mode', 'bypassPermissions'] },
};
// Full model IDs for the picker; the family aliases stay valid for older jobs.
const MODELS = new Set([
  '', 'opus', 'sonnet', 'haiku',
  'claude-fable-5-1', 'claude-fable-5',
  'claude-opus-5-5', 'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-opus-4-6',
  'claude-sonnet-5-5', 'claude-sonnet-5', 'claude-sonnet-4-6',
  'claude-haiku-5-5', 'claude-haiku-4-5',
]);
// Most work doesn't need the best model, so the chief sizes each job to one of
// these rungs and a job that fails climbs one (see bump). Family aliases, so
// each rung follows whatever is current. DEFAULT_TIER is for work that skips
// the chief, which can't be sized by anyone.
const LADDER = ['haiku', 'sonnet', 'opus'];
const DEFAULT_TIER = 'sonnet';
const TIER_LABEL = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' };
const tierOf = (model) => LADDER.find((t) => String(model || '').includes(t)) || '';
// The boss's picker wins; "Chief picks" (empty) hands the choice over, and only
// a job sized that way is allowed to climb on its own.
const sized = (model, tier) => (model
  ? { model, auto: false }
  : { model: LADDER.includes(tier) ? tier : DEFAULT_TIER, auto: true });

// ---------- state ----------

// ---------- channels ----------
//
// The office chat is split the way Slack is: #general always exists, and
// anyone can open another channel for a strand of work. Every message
// belongs to exactly one, and a reply stays in its thread's channel.

const GENERAL = 'general';
// Where the agents talk to each other about something other than the work.
// The break room in the browser posts its small talk here as it is spoken.
const CHILL = 'chill-room';
// Channels the whole office is in by definition. They keep no member list,
// nobody joins or leaves them, and there is nobody to invite. Add a reserved
// channel here and the rest of the channel code treats it that way.
const OPEN_TO_ALL = new Set([GENERAL, CHILL]);
const MAX_CHANNELS = 40;
const slug = (name) => String(name || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);

let state = { xp: 0, jobs: [], chat: [], channels: [], chiefCost: 0, dismissed: [], profiles: {} };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
} catch {}
if (!state.channels.some((c) => c.id === GENERAL)) state.channels.unshift({ id: GENERAL, name: GENERAL, createdAt: Date.now() });
// Sat next to #general, and described even if someone had already opened a
// channel by that name by hand. An explanation they wrote themselves stays.
const CHILL_PURPOSE = 'Whatever the office talks about that is not the work.';
const chillChannel = state.channels.find((c) => c.id === CHILL);
if (!chillChannel) state.channels.splice(1, 0, { id: CHILL, name: CHILL, purpose: CHILL_PURPOSE, createdAt: Date.now() });
else if (!chillChannel.purpose) chillChannel.purpose = CHILL_PURPOSE;

const hasChannel = (id) => state.channels.some((c) => c.id === id);
const channelOf = (id) => (hasChannel(id) ? id : GENERAL);

// `by` is whoever opened it, `purpose` a line about what it's for, and
// `members` anyone an agent has pulled in; all three are shown in the UI.
function createChannel(name, { by = 'you', purpose = '' } = {}) {
  const id = slug(name);
  if (!id) throw new Error('Give the channel a name.');
  if (hasChannel(id)) throw new Error(`#${id} already exists.`);
  if (state.channels.length >= MAX_CHANNELS) throw new Error('That is a lot of channels already. Tidy some up first.');
  const channel = { id, name: id, purpose: String(purpose || '').slice(0, 120), by, members: [], createdAt: Date.now() };
  state.channels.push(channel);
  send({ t: 'channels', channels: state.channels });
  save();
  return channel;
}

// Only an empty channel can go, so no conversation disappears with it.
function deleteChannel(id) {
  if (OPEN_TO_ALL.has(id)) throw new Error(`#${id} stays.`);
  if (!hasChannel(id)) throw new Error('No such channel.');
  if (state.chat.some((m) => channelOf(m.channel) === id)) throw new Error('That channel has messages in it.');
  state.channels = state.channels.filter((c) => c.id !== id);
  send({ t: 'channels', channels: state.channels });
  save();
}

// ---------- who is in a channel ----------
//
// #general is everyone's. Every other channel keeps a list of who is in it,
// and that list is who gets told when something is said there. It isn't a
// lock on the door: anyone may post anywhere, and posting puts them in it.

const MAX_MEMBERS = 12;
const membersOf = (id) => state.channels.find((c) => c.id === id)?.members || [];

function joinChannel(id, agentId) {
  const c = state.channels.find((x) => x.id === id);
  if (!c || OPEN_TO_ALL.has(id) || !STAFF.some((s) => s.id === agentId)) return false;
  c.members ||= [];
  if (c.members.includes(agentId)) return false;
  if (c.members.length >= MAX_MEMBERS) throw new Error(`#${id} already has a lot of people in it.`);
  c.members.push(agentId);
  send({ t: 'channels', channels: state.channels });
  save();
  return true;
}

// Agents write "#releases" or "releases" and mean the same channel.
function theChannel(name) {
  const id = slug(String(name || '').replace(/^#/, ''));
  if (!hasChannel(id)) throw new Error(`No channel called #${id || name}. list_channels shows them all.`);
  return id;
}
for (const s of STAFF) Object.assign(s, state.profiles[s.id]);
// A restart shouldn't cost anyone their work: jobs that were mid-session
// pick up where they left off, with the same agent.
for (const j of state.jobs) {
  if (j.status !== 'working') continue;
  if (j.sessionId) {
    Object.assign(j, {
      status: 'queued', queuedAt: Date.now(), wantAgent: j.agentId, waiting: false,
      // An unread message stashed by deliver() comes along too, rather than
      // being written over by the notice about the restart.
      pending: [j.pending, 'The office restarted while you were working, which interrupted you. Pick up exactly where you left off.'].filter(Boolean).join('\n\n'),
    });
    j.log.push({ kind: 'system', summary: 'Office restarted. Picking up where I left off.', ts: Date.now() });
  } else {
    j.status = 'failed';
    j.error = 'The office closed before this job got going.';
    j.endedAt = Date.now();
  }
}

const levelOf = (xp) => Math.floor(Math.sqrt(xp / 100)) + 1;
const xpFor = (level) => 100 * (level - 1) ** 2;
const capacity = () => Math.min(STAFF.length, 2 + levelOf(state.xp));
const hired = () => STAFF.slice(0, capacity());
// Who's in today: everyone hired, minus anyone the boss sent home.
const onFloor = () => hired().filter((s) => !state.dismissed.includes(s.id));
const progress = () => {
  const level = levelOf(state.xp);
  return { xp: state.xp, level, floor: xpFor(level), next: xpFor(level + 1), capacity: capacity() };
};

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, STATE_FILE);
  }, 400);
}

// ---------- broadcasting ----------

const clients = new Set();
function send(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) if (ws.readyState === 1) ws.send(data);
}
const publicJob = (j, tail = 40) => {
  const { stopRequested, lastTurn, sent, handoffs, ...rest } = j;
  return { ...rest, log: j.log.slice(-tail) };
};
const snapshot = () => ({
  t: 'hello',
  staff: STAFF,
  modes: Object.fromEntries(Object.entries(MODES).map(([k, v]) => [k, v.label])),
  progress: progress(),
  jobs: state.jobs.map((j) => publicJob(j)),
  chat: state.chat.slice(-150),
  channels: state.channels,
  chiefCost: state.chiefCost,
  chiefBusy,
  standup: standupNow && { who: standupNow.who },
  usage,
  procs,
  machine,
  dismissed: state.dismissed,
  voice: voiceReady(DATA),
});

// ---------- what the agents are costing this machine ----------

const PROC_EVERY = 3000;
let procs = null;
let procTimer = null;
let procBusy = false;

async function pollProcs() {
  if (procBusy) return;
  procBusy = true;
  try {
    const roots = new Map();
    for (const [id, child] of running) if (child.pid) roots.set(id, child.pid);
    if (!roots.size) return stopProcs();
    const next = await sampleProcs(roots);
    // Nothing measurable (ps unavailable) is the same as nothing to show.
    procs = next && Object.keys(next).length ? next : null;
    send({ t: 'proc', procs, machine });
  } finally {
    procBusy = false;
  }
}

// Only sampled while someone is working; an idle office polls nothing.
function startProcs() {
  if (procTimer) return;
  resetProcs();
  procTimer = setInterval(pollProcs, PROC_EVERY);
  pollProcs();
}

function stopProcs() {
  clearInterval(procTimer);
  procTimer = null;
  if (!procs) return;
  procs = null;
  send({ t: 'proc', procs, machine });
}

// ---------- plan usage ----------

const USAGE_EVERY = 2 * 60 * 1000;
const USAGE_GAP = 60 * 1000; // the endpoint rate-limits; never ask more often than this
const USAGE_MAX_BACKOFF = 15 * 60 * 1000;
let usage = null;
let usageTimer = null;
let usageLast = 0;
let usageBackoff = 0;
async function refreshUsage() {
  clearTimeout(usageTimer);
  usageLast = Date.now();
  let next;
  try { next = await fetchUsage(); } catch { next = { error: 'Usage unavailable right now.' }; }
  // A failed check keeps the last good numbers; the error only shows when
  // there is nothing to show instead.
  usage = next.error && (usage?.session || usage?.week) ? { ...usage, error: next.error } : next;
  usageBackoff = next.limited ? Math.min(USAGE_MAX_BACKOFF, (usageBackoff || USAGE_EVERY) * 2) : 0;
  send({ t: 'usage', usage });
  usageTimer = setTimeout(refreshUsage, usageBackoff || USAGE_EVERY);
}
// Turns end in bursts, so a finished turn only nudges the next check closer,
// and never closer than the gap, nor while backing off a rate limit.
function nudgeUsage() {
  if (usageBackoff) return;
  clearTimeout(usageTimer);
  usageTimer = setTimeout(refreshUsage, Math.max(5000, usageLast + USAGE_GAP - Date.now()));
}

function post(from, text, extra = {}) {
  const msg = { id: crypto.randomUUID().slice(0, 8), from, text, ts: Date.now(), ...extra };
  // An agent's updates on a job collect in that job's thread, in the channel
  // the job was asked for in. Anyone answering the boss directly passes an
  // explicit `thread` instead, because an answer belongs where the question
  // was asked. Nothing is ever moved once it has been posted.
  const job = msg.jobId && state.jobs.find((j) => j.id === msg.jobId);
  if (job?.thread && extra.thread === undefined) msg.thread = job.thread;
  const root = msg.thread && state.chat.find((m) => m.id === msg.thread);
  msg.channel = channelOf(root?.channel ?? extra.channel ?? job?.channel);
  state.chat.push(msg);
  if (state.chat.length > MAX_CHAT) state.chat.splice(0, state.chat.length - MAX_CHAT);
  send({ t: 'chat', msg });
  save();
  return msg;
}

const EMOJI = /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator})/u;
// Toggles one person's reaction; empty emoji lists are dropped so old messages stay lean.
function react(id, emoji, who = 'you') {
  const msg = state.chat.find((m) => m.id === id);
  if (!msg) throw new Error('No such message.');
  if (typeof emoji !== 'string' || emoji.length > 16 || !EMOJI.test(emoji)) throw new Error('That is not an emoji.');
  const r = (msg.reactions ||= {});
  const people = r[emoji] || [];
  r[emoji] = people.includes(who) ? people.filter((p) => p !== who) : [...people, who];
  if (!r[emoji].length) delete r[emoji];
  if (!Object.keys(r).length) delete msg.reactions;
  send({ t: 'react', id, reactions: msg.reactions || {} });
  save();
}

// ---------- the break room ----------
//
// Two idle agents trading small talk is acted out in the browser, which is
// the only place the floor and who is standing on it exist. The lines are
// office history though, so the browser claims a conversation here and the
// server writes each line into #chill-room as it is spoken.
//
// The claim is what stops two open windows from talking over each other:
// only one gets it, and it is handed back when the conversation ends, or
// goes stale on its own if that window is closed mid-sentence.

const CHILL_STALE = 20 * 1000;
// Small talk is cheap and constant; without a cap of its own it would push
// the day's actual work out of a shared history of MAX_CHAT.
const CHILL_KEEP = 60;
let chill = null;

function claimChill(who) {
  if (chill && Date.now() - chill.at < CHILL_STALE) return null;
  chill = { id: crypto.randomUUID().slice(0, 8), who, at: Date.now() };
  return chill;
}

function chillLine(id, from, text) {
  if (!chill || chill.id !== id) throw new Error('That conversation has ended.');
  if (!chill.who.includes(from)) throw new Error('Not one of the two talking.');
  const line = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!line) throw new Error('Nothing said.');
  chill.at = Date.now();
  const msg = post(from, line, { channel: CHILL, kind: 'chill' });
  const said = state.chat.filter((m) => m.channel === CHILL);
  if (said.length > CHILL_KEEP) {
    const old = said.slice(0, said.length - CHILL_KEEP).map((m) => m.id);
    const gone = new Set(old);
    state.chat = state.chat.filter((m) => !gone.has(m.id));
    // Told, not just dropped: a window left open all day would otherwise hold
    // every line it had ever seen, and the cap would only be true on reload.
    send({ t: 'forget', ids: old });
    save();
  }
  return msg;
}

const endChill = (id) => { if (chill?.id === id) chill = null; };

function addLog(job, entry) {
  entry.ts = Date.now();
  const last = job.log[job.log.length - 1];
  if (entry.kind === 'thinking' && last?.kind === 'thinking') return;
  job.log.push(entry);
  if (job.log.length > MAX_LOG) job.log.splice(0, job.log.length - MAX_LOG);
  send({ t: 'log', jobId: job.id, entry });
  save();
}
const pushJob = (job) => { send({ t: 'job', job: publicJob(job, 0) }); save(); };

// ---------- jobs ----------

const running = new Map();
const graces = new Map();
const tokens = new Map();
// Jobs paused until a colleague answers or finishes handed-off work:
// jobId -> [{ kind: 'job', id } | { kind: 'reply', from, timer }]
const waits = new Map();
const REPLY_WAIT_MS = 10 * 60 * 1000;
const OFFICE_TOOLS = [
  'mcp__office__office_roster', 'mcp__office__message_colleague', 'mcp__office__hand_off',
  'mcp__office__list_channels', 'mcp__office__create_channel', 'mcp__office__invite_to_channel', 'mcp__office__post_to_channel',
];
const endGrace = (job) => { clearTimeout(graces.get(job.id)); graces.delete(job.id); };

function repoPath(name) {
  if (typeof name !== 'string' || !name || /[\/\\]/.test(name) || name.startsWith('.')) return null;
  const p = path.join(ROOT, name);
  try { if (fs.statSync(p).isDirectory()) return p; } catch {}
  return null;
}

function listRepos() {
  return fs.readdirSync(ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules')
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

function createJob({ repo, prompt, mode = 'edit', model = '', auto = false, agentId = '' }) {
  if (!repoPath(repo)) throw new Error('Unknown project folder.');
  prompt = String(prompt || '').trim();
  if (!prompt) throw new Error('Give the job a brief.');
  if (!MODES[mode]) throw new Error('Unknown mode.');
  if (!MODELS.has(model)) throw new Error('Unknown model.');
  const now = Date.now();
  const job = {
    id: crypto.randomUUID().slice(0, 8),
    repo, prompt, mode, model, autoModel: !!auto, escalations: 0,
    title: prompt.split('\n')[0].slice(0, 90),
    status: 'queued', createdAt: now, queuedAt: now, startedAt: null, endedAt: null,
    sessionId: null, agentId: null, cost: 0, turns: 0, tools: 0, xp: 0,
    pending: prompt, denials: [], error: null, log: [],
    wantAgent: STAFF.some((st) => st.id === agentId) ? agentId : null,
  };
  state.jobs.push(job);
  if (job.wantAgent && state.dismissed.includes(job.wantAgent)) recall([job.wantAgent]);
  addLog(job, { kind: 'user', summary: prompt });
  pushJob(job);
  pump();
  return job;
}

function pump() {
  const queued = state.jobs.filter((j) => j.status === 'queued').sort((a, b) => a.queuedAt - b.queuedAt);
  // Work waiting with nobody in to take it: call someone back.
  if (queued.length && !onFloor().length && state.dismissed.length) recall([hired().find((s) => state.dismissed.includes(s.id))?.id]);
  const roster = onFloor();
  for (const job of queued) {
    const busy = new Set(state.jobs.filter((j) => j.status === 'working').map((j) => j.agentId));
    const free = roster.filter((s) => !busy.has(s.id) && (!job.wantAgent || s.id === job.wantAgent));
    if (!free.length) continue;
    // Follow-ups go back to whoever did the first round, if they're free.
    const agent = free.find((s) => s.id === job.agentId) || free[Math.floor(Math.random() * free.length)];
    start(job, agent.id);
  }
}

function start(job, agentId) {
  const cwd = repoPath(job.repo);
  const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', ...MODES[job.mode].args];
  if (job.model) args.push('--model', job.model);
  if (job.sessionId) args.push('--resume', job.sessionId);
  const token = crypto.randomUUID();
  tokens.set(job.id, token);
  const mcp = { mcpServers: { office: { command: process.execPath, args: [path.join(HERE, 'office-mcp.js')],
    env: { OFFICE_URL: `http://127.0.0.1:${PORT}`, OFFICE_JOB: job.id, OFFICE_TOKEN: token } } } };
  // Attachments live outside the project, so agents need leave to read them.
  fs.mkdirSync(UPLOADS, { recursive: true });
  args.push('--add-dir', UPLOADS);
  args.push('--mcp-config', JSON.stringify(mcp), '--allowedTools', OFFICE_TOOLS.join(','), '--append-system-prompt', officePrompt(agentId, job));
  // Being given work in a channel is how you end up in it.
  try { joinChannel(channelOf(job.channel), agentId); } catch {}
  const first = job.pending;

  Object.assign(job, {
    status: 'working', agentId, pending: null, denials: [], error: null,
    stopRequested: false, startedAt: job.startedAt ?? Date.now(), turnTools: 0, lastTurn: null, waiting: false,
  });
  pushJob(job);

  if (!cwd) return finish(job, 'failed', 'That project folder is gone.');

  // stdin stays open for the whole job, so the chief can hand the agent
  // new messages while it works.
  const child = spawn(CLAUDE, args, { cwd, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  running.set(job.id, child);
  startProcs();
  child.stdin.on('error', () => {});
  write(child, first);

  let buf = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      if (line.trim()) onLine(job, line);
    }
  });
  let errTail = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (d) => { errTail = (errTail + d).slice(-2000); });

  const ended = (why) => {
    running.delete(job.id);
    if (procs) { delete procs[job.id]; }
    endGrace(job);
    if (job.status !== 'working') return;
    if (job.stopRequested) finish(job, 'stopped', 'Stopped by you.');
    else if (job.lastTurn) finish(job, job.lastTurn.ok ? 'done' : 'failed', job.lastTurn.ok ? null : job.lastTurn.error);
    else finish(job, 'failed', errTail.trim().split('\n').pop() || why);
  };
  child.on('error', (err) => ended(`Could not start claude: ${err.message}`));
  child.on('close', (code) => ended(`claude exited with code ${code}`));
}

function write(child, text) {
  if (!child.stdin.writable) return false;
  child.stdin.write(JSON.stringify({ type: 'user', message: { role: 'user', content: text } }) + '\n');
  return true;
}

// Hand a message to a job, whatever state it is in.
function deliver(job, text) {
  if (job.status === 'working') {
    const child = running.get(job.id);
    endGrace(job);
    job.lastTurn = null;
    if (job.waiting) { job.waiting = false; pushJob(job); }
    addLog(job, { kind: 'user', summary: text });
    if (child && write(child, text)) return 'live';
    // The session ended between the check and the write, so there is nobody
    // to hand it to. Hold it for the next turn: passing it to replyJob would
    // only hand it straight back here, for as long as the stack allows.
    job.pending = job.pending ? `${job.pending}\n\n${text}` : text;
    return 'queued';
  }
  if (job.status === 'queued') {
    job.pending = `${job.pending}\n\n${text}`;
    addLog(job, { kind: 'user', summary: text });
    return 'queued';
  }
  replyJob(job, { message: text });
  return 'resumed';
}

const textOf = (content) =>
  typeof content === 'string' ? content
    : Array.isArray(content) ? content.map((c) => c.text || '').join('\n')
    : '';

function onLine(job, line) {
  let e;
  try { e = JSON.parse(line); } catch { return; }
  if (e.type === 'assistant' && graces.has(job.id)) { endGrace(job); job.lastTurn = null; }

  if (e.type === 'system' && e.subtype === 'init') {
    job.sessionId = e.session_id;
    addLog(job, { kind: 'system', summary: `Clocked in · ${e.model}` });
  } else if (e.type === 'assistant') {
    for (const c of e.message?.content || []) {
      if (c.type === 'text' && c.text.trim()) {
        addLog(job, { kind: 'text', summary: c.text.trim().slice(0, 6000) });
      } else if (c.type === 'thinking') {
        addLog(job, { kind: 'thinking', summary: 'Thinking…' });
      } else if (c.type === 'tool_use') {
        job.tools++;
        job.turnTools++;
        const entry = { kind: 'tool', tool: c.name, summary: summarizeTool(c.name, c.input), station: stationFor(c.name) };
        if (c.name === 'TodoWrite' && Array.isArray(c.input?.todos)) {
          entry.todos = c.input.todos.slice(0, 12).map((t) => ({ text: String(t.content || '').slice(0, 80), done: t.status === 'completed' }));
        }
        addLog(job, entry);
      }
    }
  } else if (e.type === 'user') {
    for (const c of e.message?.content || []) {
      if (c.type === 'tool_result' && c.is_error) {
        const text = textOf(c.content).trim();
        addLog(job, { kind: 'error', summary: text.slice(0, 400), blocked: /permission|haven't granted/i.test(text) });
      }
    }
  } else if (e.type === 'result') {
    job.cost += e.total_cost_usd || 0;
    job.turns++;
    // The input side of the last turn is how much context this session is
    // carrying. Worth seeing: a long-resumed job pays it on every turn.
    const u = e.usage || {};
    job.context = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    nudgeUsage();
    job.denials = [...new Set((e.permission_denials || []).map((d) => d.tool_name))];
    const ok = e.subtype === 'success' && !e.is_error;
    addLog(job, { kind: 'result', ok, summary: String(e.result || e.subtype || '').trim().slice(0, 8000), cost: e.total_cost_usd, ms: e.duration_ms });
    job.lastTurn = { ok, error: ok ? null : `Ended with ${e.subtype}`, text: String(e.result || '').trim() };
    endGrace(job);
    const pending = waits.get(job.id) || [];
    if (ok && pending.length && running.has(job.id)) {
      // Keep the session open; whatever they're waiting for will wake it.
      const names = [...new Set(pending.map((w) => (w.kind === 'job' ? nameOf(state.jobs.find((j) => j.id === w.id)?.agentId) : nameOf(w.from))))];
      job.waiting = true;
      addLog(job, { kind: 'system', summary: `Waiting on ${names.join(' and ')}`, wait: true });
      pushJob(job);
      return;
    }
    graces.set(job.id, setTimeout(() => {
      graces.delete(job.id);
      const child = running.get(job.id);
      if (child) child.stdin.end();
      else finish(job, ok ? 'done' : 'failed', job.lastTurn?.error);
    }, GRACE_MS));
  }
}

// One rung up the ladder, for a job the chief sized. A job that never got a
// turn out of the model didn't fail at the work — the folder was gone, the
// binary wouldn't start — so a stronger model would fail the same way and it
// stays where it is. Returns the new rung, or null if it isn't moving.
function bump(job) {
  if (!job.autoModel || !job.turns) return null;
  const at = LADDER.indexOf(tierOf(job.model));
  const next = at >= 0 ? LADDER[at + 1] : null;
  if (!next) return null;
  job.model = next;
  job.escalations = (job.escalations || 0) + 1;
  return next;
}

function finish(job, status, error) {
  if (job.status !== 'working') return;
  clearWaits(job);
  tokens.delete(job.id);
  job.waiting = false;
  const before = progress();
  job.status = status;
  job.error = error;
  job.endedAt = Date.now();
  // Capture the rung it failed on before bump() moves it.
  const was = TIER_LABEL[tierOf(job.model)] || job.model || 'the default model';
  const retry = status === 'failed' ? bump(job) : null;
  const gained = status === 'done' ? 40 + Math.min(80, (job.turnTools || 0) * 4) : 0;
  state.xp += gained;
  job.xp += gained;
  pushJob(job);
  if (gained) {
    const after = progress();
    send({ t: 'xp', progress: after, gained, jobId: job.id, agentId: job.agentId, levelUp: after.level > before.level });
  }
  const text = status === 'done' ? job.lastTurn?.text || 'Done.'
    : status === 'stopped' ? 'Stopped, as asked.'
    : `I hit a wall: ${error || 'something went wrong'}`;
  post(job.agentId, text, { jobId: job.id, status, denials: job.denials });

  // Hand the result back to whoever delegated this, if they're still at it.
  // Not on a retry: the work isn't finished, it's going up a rung, so whoever
  // handed it over keeps waiting for the real answer.
  const asker = !retry && job.requestedBy && state.jobs.find((j) => j.id === job.requestedBy);
  if (asker?.status === 'working' && running.has(asker.id)) {
    settle(asker, (w) => w.kind === 'job' && w.id === job.id);
    deliver(asker, `${nameOf(job.agentId)} finished the work you handed off ("${job.title}"), status: ${status}.\n\n${text}`);
  }
  // Anyone waiting on a reply from this agent stops waiting.
  for (const other of state.jobs) {
    if (other.status === 'working' && running.has(other.id) && settle(other, (w) => w.kind === 'reply' && w.from === job.agentId)) {
      deliver(other, `${nameOf(job.agentId)} finished their job without replying to you. Carry on without their answer.`);
    }
  }
  // A message can land in the gap between the session closing and here, in
  // which case deliver() left it in `pending` and nothing has read it. Put the
  // job back in the queue so somebody does. A stopped job stays stopped — the
  // boss pulled it on purpose — so say out loud that it went unread instead of
  // dropping it quietly.
  if (job.pending) {
    if (status === 'stopped') {
      post('chief', `A message for ${nameOf(job.agentId)} landed just as "${job.title}" was stopped, so nobody read it.`, { jobId: job.id });
      job.pending = null;
    } else {
      Object.assign(job, { status: 'queued', queuedAt: Date.now(), error: null, endedAt: null });
      addLog(job, { kind: 'system', summary: 'A message landed as this job was closing. Picking it back up.' });
      pushJob(job);
    }
  }
  // Back in the queue on the stronger model, in a fresh session rather than a
  // resumed one: the prompt cache belongs to the model that filled it, so
  // resuming would make the dearer model read the whole failed transcript at
  // full price. It gets a summary of the attempt instead, and the repo still
  // holds whatever the first attempt actually changed.
  if (retry) {
    const tried = (job.lastTurn?.text || '').trim().slice(0, 1200);
    // A fresh session knows nothing, so the brief goes in again with it.
    const note = [
      job.prompt,
      `An earlier attempt at this on ${was} ended badly: ${error || 'it did not finish'}.`,
      tried && `What that attempt reported:\n${tried}`,
      `You are on ${TIER_LABEL[retry]} now, picking this up fresh. The project still holds any changes that attempt made, so check where the work actually stands before redoing it, then finish the job.`,
    ].filter(Boolean).join('\n\n');
    job.sessionId = null;
    job.pending = job.pending ? `${note}\n\n${job.pending}` : note;
    if (job.status !== 'queued') Object.assign(job, { status: 'queued', queuedAt: Date.now(), error: null, endedAt: null });
    addLog(job, { kind: 'system', summary: `Hit a wall on ${was}; moving up to ${TIER_LABEL[retry]}` });
    pushJob(job);
    post('chief', `That hit a wall on ${was}. Running it again on ${TIER_LABEL[retry]}.`, { jobId: job.id, channel: job.channel });
  }
  save();
  setImmediate(pump);
}

function clearWaits(job) {
  for (const w of waits.get(job.id) || []) clearTimeout(w.timer);
  waits.delete(job.id);
}

// Drop the waits that match; true if any did.
function settle(job, match) {
  const list = waits.get(job.id);
  if (!list) return false;
  const gone = list.filter(match);
  if (!gone.length) return false;
  gone.forEach((w) => clearTimeout(w.timer));
  const keep = list.filter((w) => !match(w));
  if (keep.length) waits.set(job.id, keep); else waits.delete(job.id);
  return true;
}

function addWait(job, w) {
  waits.set(job.id, [...(waits.get(job.id) || []), w]);
}

function stopJob(job) {
  if (job.status === 'queued') {
    job.status = 'stopped';
    job.error = 'Pulled from the queue.';
    job.endedAt = Date.now();
    pushJob(job);
  } else if (job.status === 'working') {
    job.stopRequested = true;
    const child = running.get(job.id);
    if (child) {
      child.kill('SIGTERM');
      setTimeout(() => running.get(job.id) === child && child.kill('SIGKILL'), 5000);
    } else {
      finish(job, 'stopped', 'Stopped by you.');
    }
  }
}

function replyJob(job, { message, mode, files }) {
  message = withFiles(message, attachments(files));
  if (job.status === 'working' || job.status === 'queued') {
    if (!String(message || '').trim()) throw new Error('Say something first.');
    deliver(job, String(message).trim());
    return;
  }
  message = String(message || '').trim();
  if (!message) throw new Error('Say something first.');
  if (mode && !MODES[mode]) throw new Error('Unknown mode.');
  if (mode) job.mode = mode;
  Object.assign(job, { status: 'queued', queuedAt: Date.now(), pending: message, error: null, endedAt: null });
  addLog(job, { kind: 'user', summary: message });
  pushJob(job);
  pump();
}


// ---------- sending people home ----------

const names = (list) => (list.length < 2 ? list.join('') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`);

// Only idle agents can go; anyone mid-job stays until it's done.
function dismiss(ids) {
  const gone = [], busy = [];
  for (const id of ids) {
    const s = hired().find((x) => x.id === id);
    if (!s || state.dismissed.includes(id)) continue;
    if (workingJobOf(id)) { busy.push(s.name); continue; }
    state.dismissed.push(id);
    gone.push(s.name);
    // Work queued for them goes to whoever is free instead.
    for (const j of state.jobs) if (j.status === 'queued' && j.wantAgent === id) { j.wantAgent = null; pushJob(j); }
  }
  if (gone.length) { send({ t: 'staff', dismissed: state.dismissed }); save(); setImmediate(pump); }
  return [
    gone.length ? `${names(gone)} ${gone.length === 1 ? 'has' : 'have'} gone home.` : 'Nobody new to send home.',
    busy.length ? `${names(busy)} ${busy.length === 1 ? 'is' : 'are'} mid-job, so they stay until it's done.` : '',
  ].filter(Boolean).join(' ');
}

function recall(ids) {
  const back = ids.filter((id) => state.dismissed.includes(id));
  if (!back.length) return 'Everyone you named is already in.';
  state.dismissed = state.dismissed.filter((id) => !back.includes(id));
  send({ t: 'staff', dismissed: state.dismissed });
  save();
  setImmediate(pump);
  return `${names(back.map(nameOf))} ${back.length === 1 ? 'is' : 'are'} back in.`;
}

// ---------- chat + chief of staff ----------

let chiefBusy = false;
let chiefQueue = Promise.resolve();
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const nameOf = (id) => STAFF.find((s) => s.id === id)?.name || 'someone';
const ago = (ts) => {
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 60 ? `${m}m` : `${Math.round(m / 60)}h`;
};

function parseTags(text) {
  const roster = STAFF.slice(0, capacity());
  const repos = listRepos();
  const agentFor = (n) => roster.find((s) => norm(s.name) === norm(n));
  const repoFor = (n) => repos.find((r) => norm(r) === norm(n));
  const agents = [...text.matchAll(/@([\w-]+)/g)].map((m) => agentFor(m[1])).filter(Boolean);
  const projects = [...text.matchAll(/#([\w.-]+)/g)].map((m) => repoFor(m[1])).filter(Boolean);
  // Tags in front are just addressing; tags mid-sentence read as words.
  const clean = text
    .replace(/^(\s*[@#][\w.-]+)+\s*/, (lead) => lead.replace(/[@#]([\w.-]+)/g, (m, n) => (agentFor(n) || repoFor(n) ? '' : m)))
    .replace(/@([\w-]+)/g, (m, n) => (agentFor(n) ? '' : m))
    .replace(/#([\w.-]+)/g, (m, n) => repoFor(n) || m)
    .replace(/[ \t]+/g, ' ')
    .trim();
  return { agent: agents[0], repo: projects[0], clean: clean || text };
}

function chiefContext(text, agent, repo, channel = GENERAL) {
  const roster = STAFF.slice(0, capacity());
  const lines = ['Staff:'];
  for (const s of roster) {
    const id = s.role ? `id ${s.id}, ${s.role}` : `id ${s.id}`;
    const j = state.jobs.find((x) => x.status === 'working' && x.agentId === s.id);
    if (!j && state.dismissed.includes(s.id)) { lines.push(`- ${s.name} (${id}): dismissed, gone home`); continue; }
    if (!j) { lines.push(`- ${s.name} (${id}): free`); continue; }
    const last = [...j.log].reverse().find((e) => e.kind === 'tool' || e.kind === 'text');
    lines.push(`- ${s.name} (${id}): working on job ${j.id} in ${j.repo}, asked for in #${channelOf(j.channel)}: "${j.title}". Latest: ${last ? last.summary.slice(0, 100).replace(/\n/g, ' ') : 'just starting'}`);
  }
  const queued = state.jobs.filter((j) => j.status === 'queued');
  if (queued.length) {
    lines.push('Queued:');
    for (const j of queued) lines.push(`- job ${j.id} in ${j.repo}, asked for in #${channelOf(j.channel)}: "${j.title}"${j.wantAgent ? ` (for ${nameOf(j.wantAgent)})` : ''}`);
  }
  const recent = state.jobs.filter((j) => ['done', 'failed', 'stopped'].includes(j.status)).sort((a, b) => b.endedAt - a.endedAt).slice(0, 6);
  if (recent.length) {
    lines.push('Recently finished:');
    for (const j of recent) lines.push(`- job ${j.id} by ${nameOf(j.agentId)} in ${j.repo}, asked for in #${channelOf(j.channel)}: "${j.title}" (${j.status}, ${ago(j.endedAt)} ago)`);
  }
  lines.push('', `Projects: ${listRepos().join(', ')}`);
  lines.push('', `This message is in channel #${channel}. Channels: ${state.channels.map((c) => '#' + c.id).join(', ')}.`);
  lines.push(`You can only see #${channel}'s history below. A job's own channel is on its line above; never guess where something was discussed.`, '', `Recent chat in #${channel}:`);
  for (const m of state.chat.filter((x) => channelOf(x.channel) === channel).slice(-9, -1)) {
    const who = (m.from === 'you' ? 'Boss' : m.from === 'chief' ? 'Chief' : nameOf(m.from)) + (m.to ? ` → ${nameOf(m.to)}` : '');
    const reacts = Object.keys(m.reactions || {}).join('');
    lines.push(`${who}: ${m.text.slice(0, 200).replace(/\n/g, ' ')}${reacts ? ` [reactions: ${reacts}]` : ''}`);
  }
  lines.push('', `New message from the boss: ${text}`);
  if (agent) lines.push(`Tagged agent: ${agent.name} (id ${agent.id})`);
  if (repo) lines.push(`Tagged project: ${repo}`);
  return lines.join('\n');
}

function hireWork({ repo, brief, agentId, mode, model, auto, say, files, thread, inThread, channel }) {
  const job = createJob({ repo, prompt: withFiles(brief, files), mode, model, auto, agentId: agentId || '' });
  job.thread = thread;
  job.channel = channel;
  const who = nameOf(job.agentId);
  let line = say || `${who} is on it.`;
  if (job.status === 'queued') {
    line = agentId
      ? `${nameOf(agentId)} is busy right now, so it's next on their list.`
      : `Everyone's busy, so it's in the queue. First free hand takes it.`;
  }
  // A job the chief sized says which rung it went to, so the boss can see the
  // call being made and send it back up if it was the wrong one.
  if (job.autoModel) line += ` · ${TIER_LABEL[tierOf(job.model)]}`;
  // In the thread if that's where this was asked for, in the channel otherwise.
  post('chief', line, { jobId: job.id, channel, thread: inThread ? thread : null });
}

// `root` is the thread this conversation lives in: the boss's message, or the
// thread they replied in (`inThread`), where the chief answers too.
async function dispatch(text, mode, model, files, root, inThread, channel) {
  const { agent, repo, clean } = parseTags(text);
  const say = (line, extra = {}) => post('chief', line, { channel, ...(inThread ? { thread: root } : {}), ...extra });
  const open = state.jobs.filter((j) => j.status === 'working' || j.status === 'queued');

  // A named project with nothing open in it can only be new work.
  if (repo && !open.some((j) => j.repo === repo)) {
    return hireWork({ repo, brief: clean, agentId: agent?.id, mode, ...sized(model), files, thread: root, inThread, channel });
  }

  chiefBusy = true;
  send({ t: 'chief', busy: true });
  let d;
  try {
    const said = files.length ? `${text}\n(Attached: ${files.map((f) => f.name).join(', ')})` : text;
    d = await route(chiefContext(said, agent, repo, channel), { bin: CLAUDE, model: CHIEF_MODEL });
    state.chiefCost += d.cost || 0;
    nudgeUsage();
  } finally {
    chiefBusy = false;
    send({ t: 'chief', busy: false, cost: state.chiefCost });
  }

  if (d.action === 'followup') {
    const job = state.jobs.find((j) => j.id === d.jobId);
    if (job) {
      // A job with no thread of its own starts one under the message that
      // prompted this. One that already has a thread keeps it, and the answer
      // carries a link there rather than dragging the boss's message over.
      job.thread ||= root;
      // A job the boss sends back failed the work just as surely as one that
      // errored, so the second go gets a stronger model. One still running
      // keeps its model: its session is mid-flight and nobody is restarting it.
      const up = d.escalate && job.status !== 'working' ? bump(job) : null;
      if (up) addLog(job, { kind: 'system', summary: `Sent back by the boss; moving up to ${TIER_LABEL[up]}` });
      deliver(job, withFiles(clean, files));
      return post('chief', (d.say || `Passed to ${nameOf(job.agentId)}.`) + (up ? ` Running it on ${TIER_LABEL[up]} this time.` : ''), {
        jobId: job.id,
        channel,
        thread: inThread ? root : null,
        ...(job.thread !== root && { threadOf: job.thread }),
      });
    }
  }
  if (d.action === 'new' || d.action === 'followup') {
    const project = repo || listRepos().find((r) => norm(r) === norm(d.repo || ''));
    if (!project) return say('Which project is that for? Tag it with #project.');
    const roster = STAFF.slice(0, capacity());
    const agentId = agent?.id || (roster.some((s) => s.id === d.agentId) ? d.agentId : '');
    return hireWork({ repo: project, brief: (d.brief || '').trim() || clean, agentId, mode, ...sized(model, d.model), say: d.say, files, thread: root, inThread, channel });
  }
  if (d.action === 'dismiss' || d.action === 'recall') {
    const ids = [...new Set([...(d.agentIds || []), ...(agent ? [agent.id] : [])])];
    return say(d.action === 'dismiss' ? dismiss(ids) : recall(ids));
  }
  if (d.action === 'standup') return void runStandup(true);
  // An answer that is merely about a job gets the same link a follow-up does.
  // Asking "how did that go?" from another channel shouldn't dead-end just
  // because the job has already finished and nothing was passed on.
  const about = d.jobId && state.jobs.find((j) => j.id === d.jobId);
  say(d.say || 'Could you say a bit more?', about?.thread && about.thread !== root
    ? { jobId: about.id, threadOf: about.thread, thread: inThread ? root : null }
    : {});
}

// The job a thread is about: one started from it, or the job its first message came from.
function threadJob(root) {
  const job = state.jobs.findLast((j) => j.thread === root.id) || (root.jobId && state.jobs.find((j) => j.id === root.jobId));
  if (job && !job.thread) job.thread = root.id;
  return job;
}

function chat({ text, mode = 'edit', model = '', files, thread, channel }) {
  text = String(text || '').trim();
  files = attachments(files);
  if (!text && !files.length) throw new Error('Say something first.');
  if (!MODES[mode]) throw new Error('Unknown mode.');
  if (!MODELS.has(model)) throw new Error('Unknown model.');
  if (channel && !hasChannel(channel)) throw new Error('That channel is gone.');
  const root = thread && state.chat.find((m) => m.id === thread && !m.thread);
  if (thread && !root) throw new Error('That thread has scrolled out of the office chat.');
  // A reply belongs to the channel its thread lives in.
  const where = channelOf(root ? root.channel : channel);
  const msg = post('you', text, {
    channel: where,
    ...(files.length && { files: files.map(({ path: _, ...f }) => f) }),
    ...(root && { thread: root.id }),
  });
  if (/^\/standup$/i.test(text)) return void runStandup(true);
  if (!text) text = files.length === 1 ? 'Take a look at the attached file.' : 'Take a look at the attached files.';
  // A reply in a job's thread goes straight to that job; no routing needed.
  const job = root && threadJob(root);
  if (job) return void deliver(job, withFiles(text, files));
  chiefQueue = chiefQueue
    .then(() => dispatch(text, mode, model, files, root?.id || msg.id, !!root, where))
    .catch((err) => post('chief', `I couldn't route that one: ${err.message}`, { channel: where }));
}


// ---------- daily standup ----------

const GATHER_MS = 7000, SPEAK_MS = 5500;
const DAY_MS = 24 * 3600 * 1000;
let standupNow = null;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clip = (s, n) => {
  s = String(s || '').replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};
const ENDED = { done: 'Shipped', failed: 'Hit a wall on', stopped: 'Stopped' };

// What each agent can honestly report since the last standup.
function standupFacts(who, since) {
  return who.map((s) => {
    const mine = state.jobs.filter((j) => j.agentId === s.id);
    return {
      s,
      finished: mine.filter((j) => ENDED[j.status] && j.endedAt > since).sort((a, b) => a.endedAt - b.endedAt),
      now: mine.find((j) => j.status === 'working'),
      next: state.jobs.filter((j) => j.status === 'queued' && j.wantAgent === s.id),
    };
  });
}

function standupContext(facts) {
  const lines = [`Last standup: ${state.lastStandup ? `${ago(state.lastStandup)} ago` : 'none yet (covering the last day)'}.`, ''];
  for (const { s, finished, now, next } of facts) {
    lines.push(`${s.name} (id ${s.id}):`);
    for (const j of finished) {
      const said = j.status === 'done' ? j.log.findLast((e) => e.kind === 'result')?.summary : j.error;
      lines.push(`- Finished (${j.status}) in ${j.repo}: "${j.title}". ${said ? `Outcome: ${clip(said, 400)}` : ''}`);
      if (j.denials?.length) lines.push(`  Blocked from using ${j.denials.join(', ')} on that job.`);
    }
    if (now) {
      const last = now.log.findLast((e) => e.kind === 'tool' || e.kind === 'text');
      lines.push(`- Now: working on "${now.title}" in ${now.repo}${now.waiting ? ', waiting on a colleague' : ''}. Latest: ${last ? clip(last.summary, 160) : 'just starting'}`);
    }
    for (const j of next) lines.push(`- Queued for them: "${j.title}" in ${j.repo}`);
    if (!finished.length && !now && !next.length) lines.push('- Nothing since last standup; free.');
  }
  const open = state.jobs.filter((j) => j.status === 'queued' && !j.wantAgent);
  if (open.length) lines.push('', `Queued for whoever is free: ${open.map((j) => `"${j.title}" in ${j.repo}`).join('; ')}`);
  return lines.join('\n');
}

// The same updates from the facts alone, for when the model can't help.
function plainStandup(facts) {
  const updates = facts.map(({ s, finished, now, next }) => ({
    agentId: s.id,
    done: finished.length ? `${finished.map((j) => `${ENDED[j.status]} "${j.title}" in ${j.repo}`).join('; ')}.` : 'Nothing shipped since last standup.',
    today: now ? `Still on "${now.title}" in ${now.repo}.` : next.length ? `Picking up "${next[0].title}" in ${next[0].repo}.` : "I'm free, happy to take something.",
    blockers: [
      ...finished.filter((j) => j.status === 'failed').map((j) => `"${j.title}" failed: ${clip(j.error, 120)}`),
      ...(now?.waiting ? ['Waiting on a colleague.'] : []),
    ].join(' '),
  }));
  const busy = facts.filter((f) => f.now).map((f) => f.s.name);
  const free = facts.filter((f) => !f.now && !f.next.length).map((f) => f.s.name);
  const wrap = ["That's standup.", busy.length ? `${names(busy)} ${busy.length === 1 ? 'is' : 'are'} heads down.` : '',
    free.length ? `${names(free)} ${free.length === 1 ? 'is' : 'are'} free for new work.` : ''].filter(Boolean).join(' ');
  return { updates, wrap };
}

async function runStandup(byBoss) {
  if (standupNow) { if (byBoss) post('chief', "We're mid-standup already."); return; }
  const who = onFloor();
  if (!who.length) { if (byBoss) post('chief', "Nobody's on the floor to stand up."); return; }
  const facts = standupFacts(who, state.lastStandup || Date.now() - DAY_MS);
  const context = standupContext(facts);
  const plain = plainStandup(facts);
  const quiet = facts.every((f) => !f.finished.length && !f.now && !f.next.length);

  standupNow = { who: who.map((s) => s.id) };
  state.lastStandup = Date.now();
  send({ t: 'standup', phase: 'start', who: standupNow.who });
  post('chief', "Morning, everyone. Standup: what you got done, what's next, and anything in your way.", { kind: 'standup' });
  try {
    // A quiet office has nothing worth a model call. Otherwise it writes
    // while everyone walks over.
    const writing = quiet ? null : writeStandup(context, { bin: CLAUDE, model: CHIEF_MODEL }).catch(() => null);
    await sleep(GATHER_MS);
    const written = writing && (await writing);
    if (written) {
      state.chiefCost += written.cost || 0;
      send({ t: 'chief', busy: false, cost: state.chiefCost });
      nudgeUsage();
    }
    const said = [];
    for (const f of facts) {
      if (!onFloor().some((s) => s.id === f.s.id)) continue;
      const u = written?.updates?.find((x) => x.agentId === f.s.id) || plain.updates.find((x) => x.agentId === f.s.id);
      const blockers = clip(u.blockers, 300);
      post(f.s.id, `**Done:** ${clip(u.done, 500)}\n\n**Today:** ${clip(u.today, 300)}\n\n**Blockers:** ${blockers || 'none'}`,
        { kind: 'standup', say: clip(u.today, 90) });
      said.push({ agentId: f.s.id, today: clip(u.today, 200), blockers });
      await sleep(SPEAK_MS);
    }
    const wrap = clip(written?.wrap, 600) || plain.wrap;
    post('chief', wrap, { kind: 'standup' });
    state.standupNotes = { ts: state.lastStandup, said, wrap };
    save();
    await sleep(4000);
  } finally {
    standupNow = null;
    send({ t: 'standup', phase: 'end' });
  }
}

// Checked every minute. Missed standups still happen later that day, but
// not after 6pm, and a day with nothing to talk about is skipped.
function standupDue() {
  if (STANDUP_AT === 'off' || standupNow) return;
  const due = dueToday(STANDUP_AT, STANDUP_WEEKENDS);
  const now = Date.now();
  if (!due || now < due || (state.lastStandup || 0) >= due || new Date().getHours() >= 18) return;
  const since = state.lastStandup || now - DAY_MS;
  const active = state.jobs.some((j) => j.status === 'working' || j.status === 'queued' || (j.endedAt || 0) > since);
  if (!active) { state.lastStandup = now; save(); return; }
  runStandup(false);
}

// Agents starting work later in the day know what the team said.
function standupBrief(agentId) {
  const n = state.standupNotes;
  if (!n || Date.now() - n.ts > 18 * 3600 * 1000) return '';
  const lines = n.said.filter((x) => x.agentId !== agentId).map((x) => `${nameOf(x.agentId)}: ${x.today}${x.blockers ? ` (blocked: ${x.blockers})` : ''}`);
  return ` From today's standup: ${[...lines, `Chief: ${n.wrap}`].join(' | ')}`;
}

// ---------- agents talking to each other ----------

// Who they are, from the Team tab. It shapes their voice, never the work.
function persona(agentId) {
  const s = STAFF.find((x) => x.id === agentId);
  const bits = [
    s?.role && `Your role: ${s.role}.`,
    s?.personality && `Your personality: ${s.personality}`,
    s?.background && `Your background: ${s.background}`,
  ].filter(Boolean);
  if (!bits.length) return '';
  return `${bits.join(' ')} Let this colour how you write to the boss and colleagues; it never lowers the bar on the work itself. `;
}

function updateProfile(id, body) {
  const s = STAFF.find((x) => x.id === id);
  if (!s) return null;
  const p = {};
  for (const [k, max] of Object.entries(PROFILE)) p[k] = String(body[k] ?? s[k] ?? '').trim().slice(0, max);
  Object.assign(s, p);
  state.profiles[id] = p;
  save();
  send({ t: 'profile', id, profile: p });
  return p;
}

function officePrompt(agentId, job) {
  const me = nameOf(agentId);
  const others = onFloor().filter((s) => s.id !== agentId).map((s) => (s.role ? `${s.name} (${s.role})` : s.name)).join(', ');
  return `You are ${me}, one of the agents in the Agent Office. Your colleagues: ${others || 'none yet'}. ` + persona(agentId) +
    `The office tools let you see what colleagues are doing (office_roster), message a colleague mid-task (message_colleague), ` +
    `and hand work to a free colleague, in this project or another (hand_off). Use them when a colleague's work or another project matters to yours, ` +
    `or to split independent work. Keep messages short and specific. Messages from colleagues reach you as user messages starting "Message from". ` +
    `When a colleague asks you something, answer with message_colleague. ` +
    `The office chat is split into channels, the way Slack is, and this job is being discussed in #${channelOf(job?.channel)}. ` +
    `list_channels shows them all, create_channel opens one and puts colleagues in it, invite_to_channel adds someone later, and ` +
    `post_to_channel says something to everyone in one. Open a channel when a strand of work deserves its own place to be discussed; ` +
    `everyday talk stays in #general.` + standupBrief(agentId);
}

const MAX_MESSAGES = 20, MAX_HANDOFFS = 5, MAX_DEPTH = 2;

function caller(req) {
  const id = req.headers['x-office-job'];
  const job = state.jobs.find((j) => j.id === id);
  if (!job || job.status !== 'working' || !tokens.get(id) || tokens.get(id) !== req.headers['x-office-token']) return null;
  return job;
}

function colleague(name) {
  return hired().find((s) => norm(s.name) === norm(name));
}
const workingJobOf = (agentId) => state.jobs.find((j) => j.status === 'working' && j.agentId === agentId);
const RESUME_WINDOW_MS = 6 * 3600 * 1000;
// A free, in-office agent's last job, if it ended cleanly not long ago.
function recentJobOf(agentId) {
  if (state.dismissed.includes(agentId) || state.jobs.some((j) => j.status === 'queued' && j.agentId === agentId)) return null;
  const last = state.jobs.filter((j) => j.agentId === agentId && j.endedAt).sort((a, b) => b.endedAt - a.endedAt)[0];
  return last?.status === 'done' && Date.now() - last.endedAt < RESUME_WINDOW_MS ? last : null;
}

const agentApi = {
  office_roster(me) {
    const lines = [`You are ${nameOf(me.agentId)}.`, 'Colleagues:'];
    for (const s of onFloor()) {
      if (s.id === me.agentId) continue;
      const j = workingJobOf(s.id);
      const who = s.role ? `${s.name} (${s.role})` : s.name;
      lines.push(j ? `- ${who}: ${j.waiting ? 'waiting on a colleague' : 'working'} on "${j.title}" in ${j.repo}` : `- ${who}: free`);
    }
    lines.push('', `Projects: ${listRepos().join(', ')}`);
    return lines.join('\n');
  },

  message_colleague(me, { to, message, wait_for_reply = false }) {
    const target = colleague(to || '');
    message = String(message || '').trim();
    if (!target) throw new Error(`Nobody called ${to} works here. Check office_roster.`);
    if (target.id === me.agentId) throw new Error("That's you.");
    if (!message) throw new Error('The message is empty.');
    if ((me.sent = (me.sent || 0) + 1) > MAX_MESSAGES) throw new Error("You've sent a lot of messages on this job. Finish the work with what you have.");
    // Someone free may have ended their turn expecting this, so it resumes their latest job.
    const theirs = workingJobOf(target.id) || recentJobOf(target.id);
    if (!theirs || (theirs.status === 'working' && !running.has(theirs.id))) {
      throw new Error(`${target.name} isn't on a job right now. Use hand_off to give them work.`);
    }

    const myName = nameOf(me.agentId);
    deliver(theirs, `Message from ${myName} (working on "${me.title}" in ${me.repo}): ${message}` +
      (wait_for_reply ? `\n\n${myName} is waiting for your answer. Reply with message_colleague.` : ''));
    // If they were waiting to hear from me, this is that answer.
    settle(theirs, (w) => w.kind === 'reply' && w.from === me.agentId);
    if (wait_for_reply) {
      const timer = setTimeout(() => {
        if (settle(me, (w) => w.kind === 'reply' && w.from === target.id) && me.status === 'working') {
          deliver(me, `No reply from ${target.name} after 10 minutes. Carry on without it.`);
        }
      }, REPLY_WAIT_MS);
      addWait(me, { kind: 'reply', from: target.id, timer });
    }
    post(me.agentId, message, { to: target.id, kind: 'dm', channel: me.channel });
    send({ t: 'visit', from: me.agentId, to: target.id });
    return wait_for_reply
      ? `Delivered to ${target.name}. Wrap up this step and end your turn; you'll resume when they answer.`
      : `Delivered to ${target.name}.`;
  },

  list_channels(me) {
    const mine = channelOf(me.channel);
    const lines = ['Channels:'];
    for (const c of state.channels) {
      const who = OPEN_TO_ALL.has(c.id) ? 'everyone' : membersOf(c.id).length ? membersOf(c.id).map(nameOf).join(', ') : 'nobody yet';
      lines.push(`- #${c.id}${c.purpose ? ` — ${c.purpose}` : ''} (in it: ${who})${c.id === mine ? ' ← this job is being discussed here' : ''}`);
    }
    lines.push('', 'Say something in one with post_to_channel; everyone in it who is on a job hears it straight away.');
    return lines.join('\n');
  },

  create_channel(me, { name, purpose = '', invite = [] }) {
    const channel = createChannel(name, { by: me.agentId, purpose });
    joinChannel(channel.id, me.agentId);
    const added = [], missing = [];
    for (const who of [].concat(invite || []).slice(0, MAX_MEMBERS)) {
      const target = colleague(who);
      if (!target) { missing.push(String(who)); continue; }
      if (target.id !== me.agentId && joinChannel(channel.id, target.id)) added.push(target.name);
    }
    post(me.agentId, `Opened #${channel.id}${channel.purpose ? ` — ${channel.purpose}` : ''}.${added.length ? ` Added ${names(added)}.` : ''}`,
      { channel: channel.id, kind: 'channel' });
    return `#${channel.id} is open${added.length ? `, with ${names(added)} in it` : ''}. Say something in it with post_to_channel.` +
      (missing.length ? ` Nobody called ${names(missing)} works here, so they weren't added.` : '');
  },

  invite_to_channel(me, { channel, who }) {
    const id = theChannel(channel);
    if (OPEN_TO_ALL.has(id)) throw new Error(`Everyone is in #${id} already.`);
    const added = [], there = [], missing = [];
    for (const name of [].concat(who || []).slice(0, MAX_MEMBERS)) {
      const target = colleague(name);
      if (!target) { missing.push(String(name)); continue; }
      if (joinChannel(id, target.id)) added.push(target.name); else there.push(target.name);
    }
    if (!added.length && !there.length) throw new Error(`Nobody called ${names(missing) || 'that'} works here. Check office_roster.`);
    joinChannel(id, me.agentId);
    if (added.length) post(me.agentId, `Added ${names(added)} to #${id}.`, { channel: id, kind: 'channel' });
    return [
      added.length ? `${names(added)} ${added.length === 1 ? 'is' : 'are'} in #${id} now.` : '',
      there.length ? `${names(there)} ${there.length === 1 ? 'was' : 'were'} already in it.` : '',
      missing.length ? `Nobody called ${names(missing)} works here.` : '',
    ].filter(Boolean).join(' ');
  },

  post_to_channel(me, { channel, message }) {
    const id = theChannel(channel);
    message = String(message || '').trim();
    if (!message) throw new Error('The message is empty.');
    if ((me.sent = (me.sent || 0) + 1) > MAX_MESSAGES) throw new Error("You've sent a lot of messages on this job. Finish the work with what you have.");
    joinChannel(id, me.agentId);
    post(me.agentId, message, { channel: id, kind: 'channel' });

    // Whoever is in the channel and mid-job hears it now. Anyone free is left
    // alone on purpose: a word in a channel shouldn't pull half the office
    // back off the bench the way message_colleague deliberately does for one
    // person. It stays in the channel for the boss to see either way.
    const myName = nameOf(me.agentId);
    const reached = [], quiet = [];
    for (const agentId of membersOf(id)) {
      if (agentId === me.agentId) continue;
      const theirs = workingJobOf(agentId);
      if (!theirs || !running.has(theirs.id)) { quiet.push(nameOf(agentId)); continue; }
      deliver(theirs, `Message in #${id} from ${myName} (working on "${me.title}" in ${me.repo}): ${message}`);
      send({ t: 'visit', from: me.agentId, to: agentId });
      reached.push(nameOf(agentId));
    }
    return [
      `Posted in #${id}.`,
      reached.length ? `${names(reached)} ${reached.length === 1 ? 'has' : 'have'} it now.` : '',
      quiet.length ? `${names(quiet)} ${quiet.length === 1 ? 'is' : 'are'} not on a job, so it waits in the channel for them.` : '',
      !reached.length && !quiet.length ? 'Nobody else is in it yet — invite_to_channel adds people.' : '',
    ].filter(Boolean).join(' ');
  },

  hand_off(me, { project, brief, to, wait = true }) {
    const repo = listRepos().find((r) => norm(r) === norm(project || ''));
    brief = String(brief || '').trim();
    if (!repo) throw new Error(`No project called "${project}". Projects: ${listRepos().join(', ')}`);
    if (!brief) throw new Error('The brief is empty.');
    if ((me.depth || 0) >= MAX_DEPTH) throw new Error('This work has already been handed down twice. Do it yourself.');
    if ((me.handoffs = (me.handoffs || 0) + 1) > MAX_HANDOFFS) throw new Error("You've handed off a lot already. Finish the rest yourself.");

    // Only free colleagues: nobody can end up waiting on someone who waits on them.
    let target;
    if (to) {
      target = colleague(to);
      if (!target) throw new Error(`Nobody called ${to} works here. Check office_roster.`);
      if (target.id === me.agentId) throw new Error("That's you.");
      if (state.dismissed.includes(target.id)) throw new Error(`${target.name} has gone home for now. Pick someone else or do it yourself.`);
      const busy = workingJobOf(target.id);
      if (busy) throw new Error(`${target.name} is busy with "${busy.title}". Pick someone free or do it yourself.`);
    } else {
      target = onFloor().find((s) => s.id !== me.agentId && !workingJobOf(s.id));
      if (!target) throw new Error('Nobody is free right now. Do it yourself, or check office_roster later.');
    }

    const myName = nameOf(me.agentId);
    const job = createJob({
      repo, mode: me.mode, model: me.model, auto: me.autoModel, agentId: target.id,
      prompt: `${brief}\n\n(Handed to you by ${myName}, who is working on "${me.title}" in ${me.repo}. Your final reply goes straight back to them, so make it the answer they need.)`,
    });
    job.requestedBy = me.id;
    job.channel = me.channel;
    job.depth = (me.depth || 0) + 1;
    job.title = brief.split('\n')[0].slice(0, 90);
    pushJob(job);
    if (wait) addWait(me, { kind: 'job', id: job.id });
    job.thread = post(me.agentId, brief, { to: target.id, kind: 'handoff', jobId: job.id, project: repo }).id;
    send({ t: 'visit', from: me.agentId, to: target.id });
    return wait
      ? `${target.name} has it (job ${job.id}, ${repo}). Wrap up this step and end your turn; their result will come to you.`
      : `${target.name} has it (job ${job.id}, ${repo}). Their result will reach you if you're still working.`;
  },
};

// ---------- attachments ----------

// Each upload gets its own folder, so the original file name survives.
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };
// Audio plays in the chat bubble, so these are served inline like images.
const AUDIO_TYPES = { '.webm': 'audio/webm', '.m4a': 'audio/mp4', '.mp4': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.aac': 'audio/aac', '.flac': 'audio/flac' };
const ext = (name) => path.extname(name).toLowerCase();
const uploadDir = (id) => (typeof id === 'string' && /^[a-f0-9]{12}$/.test(id) ? path.join(UPLOADS, id) : null);

function upload(req) {
  let name = 'file';
  try { name = decodeURIComponent(String(req.headers['x-file-name'] || 'file')); } catch {}
  name = path.basename(name).replace(/[\x00-\x1f\/\\:*?"<>|]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file';
  const size = Number(req.headers['content-length'] || 0);
  if (size > MAX_UPLOAD) throw new Error('That file is over 25 MB.');
  const id = crypto.randomBytes(6).toString('hex');
  const dir = uploadDir(id);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  return new Promise((resolve, reject) => {
    const out = fs.createWriteStream(file);
    let got = 0;
    const fail = (err) => { out.destroy(); fs.rmSync(dir, { recursive: true, force: true }); reject(err); };
    req.on('data', (c) => {
      got += c.length;
      if (got > MAX_UPLOAD) { req.destroy(); fail(new Error('That file is over 25 MB.')); }
    });
    req.on('error', fail);
    out.on('error', fail);
    out.on('finish', () => resolve(attachments([id])[0]));
    req.pipe(out);
  });
}

// Ids from the browser become files on disk; anything unknown is dropped.
function attachments(ids) {
  if (!Array.isArray(ids)) return [];
  const out = [];
  for (const id of ids.slice(0, 20)) {
    const dir = uploadDir(id);
    let name;
    try { [name] = fs.readdirSync(dir); } catch {}
    if (!name) continue;
    const file = path.join(dir, name);
    out.push({ id, name, size: fs.statSync(file).size, image: !!IMAGE_TYPES[ext(name)], audio: !!AUDIO_TYPES[ext(name)], path: file });
  }
  return out;
}

function withFiles(text, files) {
  text = String(text || '').trim();
  // A voice note reaches the agent as its transcript; the audio itself is
  // only there for you to replay, and claude can't open it.
  files = files?.filter((f) => !f.audio);
  if (!files?.length) return text;
  const list = files.map((f) => `- ${f.path}`).join('\n');
  return `${text}\n\nAttached ${files.length === 1 ? 'file' : 'files'} (open with the Read tool, which shows images too):\n${list}`.trim();
}

function serveUpload(res, id, name) {
  const [f] = attachments([id]);
  if (!f || f.name !== name) return json(res, 404, { error: 'No such file.' });
  const type = IMAGE_TYPES[ext(f.name)] || AUDIO_TYPES[ext(f.name)];
  // Only plain images and audio show inline; anything else downloads, so an
  // uploaded page can't run on this origin.
  res.writeHead(200, {
    'content-type': type || 'application/octet-stream',
    'x-content-type-options': 'nosniff',
    ...(type ? {} : { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}` }),
  });
  fs.createReadStream(f.path).pipe(res);
}

// ---------- http ----------

const LOCAL = new Set(['localhost', '127.0.0.1', '[::1]']);
function trusted(req) {
  // Anything that can spawn claude with full permissions must refuse
  // requests from other websites and from rebinding hostnames.
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (!LOCAL.has(host)) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try { return LOCAL.has(new URL(origin).hostname); } catch { return false; }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const parts = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 200_000) { reject(new Error('Too large.')); req.destroy(); }
      else parts.push(c);
    });
    req.on('end', () => {
      try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); }
      catch { reject(new Error('Bad JSON.')); }
    });
  });
}

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml', '.png': 'image/png' };
function serveStatic(req, res) {
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = path.join(DIST, path.normalize(url).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(DIST)) return json(res, 403, { error: 'No.' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  if (!fs.existsSync(file)) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('No build yet. Use `npm run dev`, or `npm start` to build and serve.');
  }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

const server = http.createServer(async (req, res) => {
  if (!trusted(req)) return json(res, 403, { error: 'Local only.' });
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api') return serveStatic(req, res);

  try {
    if (req.method === 'GET' && url.pathname === '/api/repos') return json(res, 200, { root: ROOT, repos: listRepos() });
    if (req.method === 'POST' && parts[1] === 'agent' && agentApi[parts[2]]) {
      const me = caller(req);
      if (!me) return json(res, 403, { error: 'Not on the clock.' });
      return json(res, 200, { text: agentApi[parts[2]](me, await readBody(req)) });
    }
    if (req.method === 'POST' && url.pathname === '/api/uploads') {
      const { path: _, ...f } = await upload(req);
      return json(res, 201, f);
    }
    if (req.method === 'POST' && url.pathname === '/api/voice') {
      const f = await upload(req);
      let text = '';
      // The name hints only improve the spelling, so a project folder that
      // can't be listed must not cost you the transcript.
      let hint = '';
      try { hint = vocabulary(onFloor().map((s) => s.name), listRepos()); } catch {}
      try {
        text = await transcribe(f.path, { dataDir: DATA, prompt: hint });
      } catch (err) {
        fs.rm(path.dirname(f.path), { recursive: true, force: true }, () => {});
        return json(res, 503, { error: err.message });
      }
      const { path: _, ...meta } = f;
      return json(res, 200, { ...meta, text });
    }
    if (req.method === 'GET' && parts[1] === 'uploads' && parts.length === 4) return serveUpload(res, parts[2], decodeURIComponent(parts[3]));
    if (req.method === 'POST' && parts[1] === 'staff' && parts[2] && ['dismiss', 'recall'].includes(parts[3]) && !parts[4]) {
      const text = parts[3] === 'dismiss' ? dismiss([parts[2]]) : recall([parts[2]]);
      if (parts[3] === 'dismiss' && !state.dismissed.includes(parts[2])) return json(res, 400, { error: text });
      return json(res, 200, { text });
    }
    if (req.method === 'POST' && parts[1] === 'staff' && parts[2] && parts[3] === 'profile' && !parts[4]) {
      const p = updateProfile(parts[2], await readBody(req));
      return p ? json(res, 200, p) : json(res, 404, { error: 'No such agent.' });
    }
    if (req.method === 'POST' && url.pathname === '/api/standup') { runStandup(true); return json(res, 202, { ok: true }); }
    if (req.method === 'POST' && parts[1] === 'chat' && parts[2] && parts[3] === 'react' && !parts[4]) {
      react(parts[2], (await readBody(req)).emoji);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/api/chat') { chat(await readBody(req)); return json(res, 202, { ok: true }); }
    if (req.method === 'GET' && url.pathname === '/api/channels') return json(res, 200, { channels: state.channels });
    if (req.method === 'POST' && url.pathname === '/api/channels') {
      const { name, purpose } = await readBody(req);
      return json(res, 201, createChannel(name, { by: 'you', purpose }));
    }
    if (req.method === 'DELETE' && parts[1] === 'channels' && parts[2] && !parts[3]) { deleteChannel(parts[2]); return json(res, 200, { ok: true }); }
    // The break room: claim a conversation, post each line as it is spoken,
    // hand the claim back at the end. A refused claim answers with no id,
    // which the browser takes as "another window has this one".
    if (req.method === 'POST' && url.pathname === '/api/chill') {
      const { who = [] } = await readBody(req);
      const pair = [...new Set(who)].filter((id) => STAFF.some((s) => s.id === id)).slice(0, 2);
      if (pair.length < 2) return json(res, 400, { error: 'Two of the staff, please.' });
      return json(res, 200, { id: claimChill(pair)?.id || null });
    }
    if (req.method === 'POST' && parts[1] === 'chill' && parts[2] && parts[3] === 'line') {
      const { from, text } = await readBody(req);
      return json(res, 201, chillLine(parts[2], from, text));
    }
    if (req.method === 'DELETE' && parts[1] === 'chill' && parts[2] && !parts[3]) { endChill(parts[2]); return json(res, 200, { ok: true }); }
    if (req.method === 'POST' && url.pathname === '/api/jobs') return json(res, 201, publicJob(createJob(await readBody(req)), 0));
    if (req.method === 'POST' && url.pathname === '/api/jobs/clear') {
      state.jobs = state.jobs.filter((j) => j.status === 'working' || j.status === 'queued');
      save();
      send(snapshot());
      return json(res, 200, { ok: true });
    }
    if (parts[1] === 'jobs' && parts[2]) {
      const job = state.jobs.find((j) => j.id === parts[2]);
      if (!job) return json(res, 404, { error: 'No such job.' });
      if (req.method === 'GET' && !parts[3]) return json(res, 200, publicJob(job, MAX_LOG));
      if (req.method === 'POST' && parts[3] === 'stop') { stopJob(job); return json(res, 200, { ok: true }); }
      if (req.method === 'POST' && parts[3] === 'reply') { replyJob(job, await readBody(req)); return json(res, 200, { ok: true }); }
    }
    json(res, 404, { error: 'Not found.' });
  } catch (err) {
    json(res, 400, { error: err.message });
  }
});

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  if (new URL(req.url, 'http://x').pathname !== '/ws' || !trusted(req)) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.send(JSON.stringify(snapshot()));
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Agent Office open on http://localhost:${PORT}  (projects in ${ROOT})`);
  pump();
  refreshUsage();
  setInterval(standupDue, 60 * 1000);
  setTimeout(standupDue, 15 * 1000);
});

const shutdown = () => {
  for (const child of running.values()) child.kill('SIGTERM');
  clearTimeout(saveTimer);
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
