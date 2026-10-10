import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { summarizeTool, stationFor } from './tools.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');
const ROOT = path.resolve(process.env.OFFICE_ROOT || path.join(APP, '..'));
const PORT = Number(process.env.PORT || 4317);
const CLAUDE = process.env.CLAUDE_BIN || 'claude';
const DATA = path.join(APP, 'data');
const STATE_FILE = path.join(DATA, 'state.json');
const DIST = path.join(APP, 'dist');
const MAX_LOG = 600;

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

let state = { xp: 0, jobs: [] };
try {
  state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) };
} catch {}
for (const j of state.jobs) {
  if (j.status === 'working') {
    j.status = 'failed';
    j.error = 'The office closed mid-job (server restarted).';
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
  const { stopRequested, ...rest } = j;
  return { ...rest, log: j.log.slice(-tail) };
};
const snapshot = () => ({
  t: 'hello',
  staff: STAFF,
  modes: Object.fromEntries(Object.entries(MODES).map(([k, v]) => [k, v.label])),
  progress: progress(),
  jobs: state.jobs.map((j) => publicJob(j)),
});

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

function createJob({ repo, prompt, mode = 'edit', model = '' }) {
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
    const free = roster.filter((s) => !busy.has(s.id));
    if (!free.length) break;
    // Follow-ups go back to whoever did the first round, if they're free.
    const agent = free.find((s) => s.id === job.agentId) || free[Math.floor(Math.random() * free.length)];
    start(job, agent.id);
  }
}

function start(job, agentId) {
  const cwd = repoPath(job.repo);
  const args = ['-p', job.pending, '--output-format', 'stream-json', '--verbose', ...MODES[job.mode].args];
  if (job.model) args.push('--model', job.model);
  if (job.sessionId) args.push('--resume', job.sessionId);

  Object.assign(job, {
    status: 'working', agentId, pending: null, denials: [], error: null,
    stopRequested: false, startedAt: job.startedAt ?? Date.now(), turnTools: 0,
  });
  pushJob(job);

  if (!cwd) return finish(job, 'failed', 'That project folder is gone.');

  const child = spawn(CLAUDE, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
  running.set(job.id, child);

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
    if (job.status === 'working') {
      if (job.stopRequested) finish(job, 'stopped', 'Stopped by you.');
      else finish(job, 'failed', errTail.trim().split('\n').pop() || why);
    }
  };
  child.on('error', (err) => ended(`Could not start claude: ${err.message}`));
  child.on('close', (code) => ended(`claude exited with code ${code}`));
}

const textOf = (content) =>
  typeof content === 'string' ? content
    : Array.isArray(content) ? content.map((c) => c.text || '').join('\n')
    : '';

function onLine(job, line) {
  let e;
  try { e = JSON.parse(line); } catch { return; }

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
    finish(job, ok ? 'done' : 'failed', ok ? null : `Ended with ${e.subtype}`);
  }
}

function finish(job, status, error) {
  if (job.status !== 'working') return;
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
  save();
  setImmediate(pump);
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
  if (job.status === 'working' || job.status === 'queued') throw new Error('That job is still open.');
  message = String(message || '').trim();
  if (!message) throw new Error('Say something first.');
  if (mode && !MODES[mode]) throw new Error('Unknown mode.');
  if (mode) job.mode = mode;
  Object.assign(job, { status: 'queued', queuedAt: Date.now(), pending: message, error: null, endedAt: null });
  addLog(job, { kind: 'user', summary: message });
  pushJob(job);
  pump();
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
