import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { summarizeTool, stationFor } from './tools.js';
import { route } from './chief.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const ROOT = path.resolve(process.env.OFFICE_ROOT || path.join(APP, '..'));
const PORT = Number(process.env.PORT || 4317);
const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const DATA = path.join(APP, 'data');
const STATE_FILE = path.join(DATA, 'state.json');
const DIST = path.join(APP, 'dist');
const MAX_LOG = 600;
const MAX_CHAT = 300;
const CHIEF_MODEL = process.env.CHIEF_MODEL || 'sonnet';
// After a turn ends, keep the session open briefly: a message that landed
// at the last moment starts another turn instead of being lost.
const GRACE_MS = 2500;

// The roster. Capacity grows with level, so later names are "hires".
const STAFF = [
  { id: 'ada', name: 'Ada', shirt: '#e07a5f', hair: '#2b2118', skin: '#8d5a3b' },
  { id: 'tunde', name: 'Tunde', shirt: '#3d7ea6', hair: '#151515', skin: '#5c3a24' },
  { id: 'mira', name: 'Mira', shirt: '#81b29a', hair: '#7a4b2a', skin: '#e2b48f' },
  { id: 'kai', name: 'Kai', shirt: '#f2cc8f', hair: '#1f1f1f', skin: '#c48b5f' },
  { id: 'zola', name: 'Zola', shirt: '#9c6ade', hair: '#2a1a12', skin: '#6b4329' },
  { id: 'remi', name: 'Remi', shirt: '#e5989b', hair: '#d9a441', skin: '#f0c9a6' },
  { id: 'obi', name: 'Obi', shirt: '#2a9d8f', hair: '#101010', skin: '#4e2f1c' },
  { id: 'lin', name: 'Lin', shirt: '#577590', hair: '#0d0d0d', skin: '#e8c39e' },
];

const MODES = {
  plan: { label: 'Plan only', args: ['--permission-mode', 'plan'] },
  edit: { label: 'Edit files', args: ['--permission-mode', 'acceptEdits'] },
  auto: { label: 'Full autonomy', args: ['--permission-mode', 'bypassPermissions'] },
};
const MODELS = new Set(['', 'opus', 'sonnet', 'haiku']);

// ---------- state ----------

let state = { xp: 0, jobs: [], chat: [], chiefCost: 0 };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
} catch {}
// A restart shouldn't cost anyone their work: jobs that were mid-session
// pick up where they left off, with the same agent.
for (const j of state.jobs) {
  if (j.status !== 'working') continue;
  if (j.sessionId) {
    Object.assign(j, {
      status: 'queued', queuedAt: Date.now(), wantAgent: j.agentId, waiting: false,
      pending: 'The office restarted while you were working, which interrupted you. Pick up exactly where you left off.',
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
  chiefCost: state.chiefCost,
  chiefBusy,
});

function post(from, text, extra = {}) {
  const msg = { id: crypto.randomUUID().slice(0, 8), from, text, ts: Date.now(), ...extra };
  state.chat.push(msg);
  if (state.chat.length > MAX_CHAT) state.chat.splice(0, state.chat.length - MAX_CHAT);
  send({ t: 'chat', msg });
  save();
  return msg;
}

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
const OFFICE_TOOLS = ['mcp__office__office_roster', 'mcp__office__message_colleague', 'mcp__office__hand_off'];
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

function createJob({ repo, prompt, mode = 'edit', model = '', agentId = '' }) {
  if (!repoPath(repo)) throw new Error('Unknown project folder.');
  prompt = String(prompt || '').trim();
  if (!prompt) throw new Error('Give the job a brief.');
  if (!MODES[mode]) throw new Error('Unknown mode.');
  if (!MODELS.has(model)) throw new Error('Unknown model.');
  const now = Date.now();
  const job = {
    id: crypto.randomUUID().slice(0, 8),
    repo, prompt, mode, model,
    title: prompt.split('\n')[0].slice(0, 90),
    status: 'queued', createdAt: now, queuedAt: now, startedAt: null, endedAt: null,
    sessionId: null, agentId: null, cost: 0, turns: 0, tools: 0, xp: 0,
    pending: prompt, denials: [], error: null, log: [],
    wantAgent: STAFF.some((st) => st.id === agentId) ? agentId : null,
  };
  state.jobs.push(job);
  addLog(job, { kind: 'user', summary: prompt });
  pushJob(job);
  pump();
  return job;
}

function pump() {
  const roster = STAFF.slice(0, capacity());
  const queued = state.jobs.filter((j) => j.status === 'queued').sort((a, b) => a.queuedAt - b.queuedAt);
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
  args.push('--mcp-config', JSON.stringify(mcp), '--allowedTools', OFFICE_TOOLS.join(','), '--append-system-prompt', officePrompt(agentId));
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
  if (job.status === 'working' && running.has(job.id)) {
    endGrace(job);
    job.lastTurn = null;
    if (job.waiting) { job.waiting = false; pushJob(job); }
    addLog(job, { kind: 'user', summary: text });
    if (write(running.get(job.id), text)) return 'live';
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

function finish(job, status, error) {
  if (job.status !== 'working') return;
  clearWaits(job);
  tokens.delete(job.id);
  job.waiting = false;
  const before = progress();
  job.status = status;
  job.error = error;
  job.endedAt = Date.now();
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
  const asker = job.requestedBy && state.jobs.find((j) => j.id === job.requestedBy);
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

function replyJob(job, { message, mode }) {
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

function chiefContext(text, agent, repo) {
  const roster = STAFF.slice(0, capacity());
  const lines = ['Staff:'];
  for (const s of roster) {
    const j = state.jobs.find((x) => x.status === 'working' && x.agentId === s.id);
    if (!j) { lines.push(`- ${s.name} (id ${s.id}): free`); continue; }
    const last = [...j.log].reverse().find((e) => e.kind === 'tool' || e.kind === 'text');
    lines.push(`- ${s.name} (id ${s.id}): working on job ${j.id} in ${j.repo}: "${j.title}". Latest: ${last ? last.summary.slice(0, 100).replace(/\n/g, ' ') : 'just starting'}`);
  }
  const queued = state.jobs.filter((j) => j.status === 'queued');
  if (queued.length) {
    lines.push('Queued:');
    for (const j of queued) lines.push(`- job ${j.id} in ${j.repo}: "${j.title}"${j.wantAgent ? ` (for ${nameOf(j.wantAgent)})` : ''}`);
  }
  const recent = state.jobs.filter((j) => ['done', 'failed', 'stopped'].includes(j.status)).sort((a, b) => b.endedAt - a.endedAt).slice(0, 6);
  if (recent.length) {
    lines.push('Recently finished:');
    for (const j of recent) lines.push(`- job ${j.id} by ${nameOf(j.agentId)} in ${j.repo}: "${j.title}" (${j.status}, ${ago(j.endedAt)} ago)`);
  }
  lines.push('', `Projects: ${listRepos().join(', ')}`, '', 'Recent chat:');
  for (const m of state.chat.slice(-9, -1)) {
    const who = (m.from === 'you' ? 'Boss' : m.from === 'chief' ? 'Chief' : nameOf(m.from)) + (m.to ? ` → ${nameOf(m.to)}` : '');
    lines.push(`${who}: ${m.text.slice(0, 200).replace(/\n/g, ' ')}`);
  }
  lines.push('', `New message from the boss: ${text}`);
  if (agent) lines.push(`Tagged agent: ${agent.name} (id ${agent.id})`);
  if (repo) lines.push(`Tagged project: ${repo}`);
  return lines.join('\n');
}

function hireWork({ repo, brief, agentId, mode, model, say }) {
  const job = createJob({ repo, prompt: brief, mode, model, agentId: agentId || '' });
  const who = nameOf(job.agentId);
  let line = say || `${who} is on it.`;
  if (job.status === 'queued') {
    line = agentId
      ? `${nameOf(agentId)} is busy right now, so it's next on their list.`
      : `Everyone's busy, so it's in the queue. First free hand takes it.`;
  }
  post('chief', line, { jobId: job.id });
}

async function dispatch(text, mode, model) {
  const { agent, repo, clean } = parseTags(text);
  const open = state.jobs.filter((j) => j.status === 'working' || j.status === 'queued');

  // A named project with nothing open in it can only be new work.
  if (repo && !open.some((j) => j.repo === repo)) {
    return hireWork({ repo, brief: clean, agentId: agent?.id, mode, model });
  }

  chiefBusy = true;
  send({ t: 'chief', busy: true });
  let d;
  try {
    d = await route(chiefContext(text, agent, repo), { bin: CLAUDE, model: CHIEF_MODEL });
    state.chiefCost += d.cost || 0;
  } finally {
    chiefBusy = false;
    send({ t: 'chief', busy: false, cost: state.chiefCost });
  }

  if (d.action === 'followup') {
    const job = state.jobs.find((j) => j.id === d.jobId);
    if (job) {
      deliver(job, clean);
      return post('chief', d.say || `Passed to ${nameOf(job.agentId)}.`, { jobId: job.id });
    }
  }
  if (d.action === 'new' || d.action === 'followup') {
    const project = repo || listRepos().find((r) => norm(r) === norm(d.repo || ''));
    if (!project) return post('chief', 'Which project is that for? Tag it with #project.');
    const roster = STAFF.slice(0, capacity());
    const agentId = agent?.id || (roster.some((s) => s.id === d.agentId) ? d.agentId : '');
    return hireWork({ repo: project, brief: (d.brief || '').trim() || clean, agentId, mode, model, say: d.say });
  }
  post('chief', d.say || 'Could you say a bit more?');
}

function chat({ text, mode = 'edit', model = '' }) {
  text = String(text || '').trim();
  if (!text) throw new Error('Say something first.');
  if (!MODES[mode]) throw new Error('Unknown mode.');
  if (!MODELS.has(model)) throw new Error('Unknown model.');
  post('you', text);
  chiefQueue = chiefQueue
    .then(() => dispatch(text, mode, model))
    .catch((err) => post('chief', `I couldn't route that one: ${err.message}`));
}


// ---------- agents talking to each other ----------

function officePrompt(agentId) {
  const me = nameOf(agentId);
  const others = STAFF.slice(0, capacity()).filter((s) => s.id !== agentId).map((s) => s.name).join(', ');
  return `You are ${me}, one of the agents in the Agent Office. Your colleagues: ${others || 'none yet'}. ` +
    `The office tools let you see what colleagues are doing (office_roster), message a colleague mid-task (message_colleague), ` +
    `and hand work to a free colleague, in this project or another (hand_off). Use them when a colleague's work or another project matters to yours, ` +
    `or to split independent work. Keep messages short and specific. Messages from colleagues reach you as user messages starting "Message from". ` +
    `When a colleague asks you something, answer with message_colleague.`;
}

const MAX_MESSAGES = 20, MAX_HANDOFFS = 5, MAX_DEPTH = 2;

function caller(req) {
  const id = req.headers['x-office-job'];
  const job = state.jobs.find((j) => j.id === id);
  if (!job || job.status !== 'working' || !tokens.get(id) || tokens.get(id) !== req.headers['x-office-token']) return null;
  return job;
}

function colleague(name) {
  return STAFF.slice(0, capacity()).find((s) => norm(s.name) === norm(name));
}
const workingJobOf = (agentId) => state.jobs.find((j) => j.status === 'working' && j.agentId === agentId);

const agentApi = {
  office_roster(me) {
    const lines = [`You are ${nameOf(me.agentId)}.`, 'Colleagues:'];
    for (const s of STAFF.slice(0, capacity())) {
      if (s.id === me.agentId) continue;
      const j = workingJobOf(s.id);
      lines.push(j ? `- ${s.name}: ${j.waiting ? 'waiting on a colleague' : 'working'} on "${j.title}" in ${j.repo}` : `- ${s.name}: free`);
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
    const theirs = workingJobOf(target.id);
    if (!theirs || !running.has(theirs.id)) throw new Error(`${target.name} isn't on a job right now. Use hand_off to give them work.`);

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
    post(me.agentId, message, { to: target.id, kind: 'dm' });
    send({ t: 'visit', from: me.agentId, to: target.id });
    return wait_for_reply
      ? `Delivered to ${target.name}. Wrap up this step and end your turn; you'll resume when they answer.`
      : `Delivered to ${target.name}.`;
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
      const busy = workingJobOf(target.id);
      if (busy) throw new Error(`${target.name} is busy with "${busy.title}". Pick someone free or do it yourself.`);
    } else {
      target = STAFF.slice(0, capacity()).find((s) => s.id !== me.agentId && !workingJobOf(s.id));
      if (!target) throw new Error('Nobody is free right now. Do it yourself, or check office_roster later.');
    }

    const myName = nameOf(me.agentId);
    const job = createJob({
      repo, mode: me.mode, model: me.model, agentId: target.id,
      prompt: `${brief}\n\n(Handed to you by ${myName}, who is working on "${me.title}" in ${me.repo}. Your final reply goes straight back to them, so make it the answer they need.)`,
    });
    job.requestedBy = me.id;
    job.depth = (me.depth || 0) + 1;
    job.title = brief.split('\n')[0].slice(0, 90);
    pushJob(job);
    if (wait) addWait(me, { kind: 'job', id: job.id });
    post(me.agentId, brief, { to: target.id, kind: 'handoff', jobId: job.id, project: repo });
    send({ t: 'visit', from: me.agentId, to: target.id });
    return wait
      ? `${target.name} has it (job ${job.id}, ${repo}). Wrap up this step and end your turn; their result will come to you.`
      : `${target.name} has it (job ${job.id}, ${repo}). Their result will reach you if you're still working.`;
  },
};

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
    if (req.method === 'POST' && url.pathname === '/api/chat') { chat(await readBody(req)); return json(res, 202, { ok: true }); }
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
