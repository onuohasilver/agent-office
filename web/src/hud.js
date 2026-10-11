// Everything that lives in the DOM: the level bar, the job list, the
// job detail drawer and the new-job dialog.

import { Marked } from 'marked';
import { recorder, voiceFile, speech } from './voice.js';

const $ = (id) => document.getElementById(id);
const DEFAULT_EMOJI = ['👍', '❤️', '😂', '🎉', '👀', '🙏', '🔥', '✅'];
const EMOJI_GROUPS = [
  ['Smileys', ['😀', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😋', '😛', '🤪', '🤔', '🤨', '😐', '😑', '😶', '🙄', '😏', '😬', '😌', '😴', '🤯', '🥳', '😎', '🤓', '🧐', '😕', '😟', '😮', '😲', '😳', '🥺', '😢', '😭', '😱', '😤', '😡', '🤬', '💀', '🤡', '👻']],
  ['Gestures', ['👍', '👎', '👌', '🤌', '✌️', '🤞', '🤝', '👏', '🙌', '👐', '🙏', '💪', '👋', '🤙', '👀', '🫡', '🤷', '🤦', '🙋', '🙇']],
  ['Hearts', ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '💔', '💯', '💥', '💫', '✨', '⭐', '🔥', '⚡']],
  ['Work', ['✅', '❌', '⚠️', '❓', '❗', '🚀', '🎉', '🎯', '🏆', '🐛', '🔧', '🛠️', '💡', '📌', '📎', '📝', '📈', '📉', '⏳', '🧪', '🔒', '🧠', '☕', '🍕']],
];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Agent output is markdown that can quote anything from a repo, so raw
// HTML is shown as text and only web links survive.
const md = new Marked({ gfm: true, breaks: true });
md.use({
  renderer: {
    html: (t) => esc(t.text ?? t),
    link: ({ href, text }) => (/^https?:\/\//i.test(href) ? `<a href="${esc(href)}" target="_blank" rel="noreferrer">${esc(text)}</a>` : esc(text)),
    image: ({ text }) => esc(text),
  },
});
const rich = (s) => md.parse(String(s ?? ''));
const STATUS = { queued: 'Queued', working: 'Working', done: 'Shipped', failed: 'Failed', stopped: 'Stopped' };
// A job's model as a person would say it: the chief's rungs by name, anything
// picked by hand by its label in the picker.
const TIERS = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' };
const modelLabel = (m) => TIERS[m] || [...($('model')?.options || [])].find((o) => o.value === m)?.text || m || 'Default';
const STATION = { library: 'Library', servers: 'Server room', window: 'Research', whiteboard: 'Whiteboard', desk: 'Desk' };

const store = (k, v) => {
  try {
    if (v === undefined) return localStorage.getItem(k);
    localStorage.setItem(k, v);
  } catch {}
  return null;
};

export function duration(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

const countdown = (ms) => {
  const m = Math.ceil(ms / 60000);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ${m % 60}m` : `${Math.floor(h / 24)}d ${h % 24}h`;
};
// Today's resets read as a time; later ones carry the weekday.
const resetsAt = (ts) => {
  const d = new Date(ts);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`;
};

// Memory reads in whatever unit keeps it to one or two digits.
const bytes = (n) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : `${Math.round(n / (1 << 20))} MB`);
// Small shares still deserve a digit; "0%" reads as broken.
const pct = (n) => `${n >= 10 ? Math.round(n) : Math.round(n * 10) / 10}%`;

export async function api(path, body, method) {
  const init = body === undefined
    ? (method ? { method } : {})
    : { method: method || 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
  const res = await fetch(path, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

const size = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${Math.round(n / 1024)} KB` : `${(n / 1048576).toFixed(1)} MB`);
const fileUrl = (f) => `/api/uploads/${f.id}/${encodeURIComponent(f.name)}`;

// Files waiting to go out with a message. Each uploads as soon as it is
// picked, pasted or dropped; sending waits for whatever is still in flight.
class Tray {
  constructor(el, onError) {
    this.el = el;
    this.onError = onError;
    this.items = [];
    el.onclick = (e) => {
      const x = e.target.closest('[data-drop]');
      if (x) { this.items = this.items.filter((i) => i.key !== x.dataset.drop); this.render(); }
    };
  }

  add(files) {
    for (const file of files) {
      const item = { key: Math.random().toString(36).slice(2), name: file.name || 'pasted', size: file.size, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null };
      const name = file.name || `pasted-${Date.now()}.${(file.type.split('/')[1] || 'bin').replace('jpeg', 'jpg')}`;
      item.done = fetch('/api/uploads', { method: 'POST', headers: { 'x-file-name': encodeURIComponent(name), 'content-type': file.type || 'application/octet-stream' }, body: file })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
          item.id = data.id;
        })
        .catch((err) => {
          this.items = this.items.filter((i) => i !== item);
          this.render();
          this.onError(`${item.name}: ${err.message}`);
        })
        .finally(() => { item.loading = false; this.render(); });
      item.loading = true;
      this.items.push(item);
    }
    this.render();
  }

  // A voice note is already on the server by the time it gets here: the
  // transcribing round trip uploaded it.
  attach({ id, name, size: bytes }) {
    this.items.push({ key: Math.random().toString(36).slice(2), id, name, size: bytes, done: Promise.resolve(), voice: true });
    this.render();
  }

  async ids() {
    await Promise.all(this.items.map((i) => i.done));
    return this.items.filter((i) => i.id).map((i) => i.id);
  }

  get empty() { return !this.items.length; }

  clear() {
    this.items.forEach((i) => i.preview && URL.revokeObjectURL(i.preview));
    this.items = [];
    this.render();
  }

  render() {
    this.el.hidden = !this.items.length;
    this.el.innerHTML = this.items.map((i) => `
      <span class="file ${i.loading ? 'loading' : ''}" title="${esc(i.name)} · ${size(i.size)}">
        ${i.preview ? `<img src="${i.preview}" alt="">` : i.voice ? '<b>VOICE</b>' : '<b>FILE</b>'}
        <span>${esc(i.name)}</span>
        <button type="button" data-drop="${i.key}" aria-label="Remove ${esc(i.name)}">×</button>
      </span>`).join('');
  }
}

// Paperclip, paste and drag-and-drop all feed the same tray.
function bindFiles(tray, { zone, input, picker, button }) {
  button.onclick = () => picker.click();
  picker.onchange = () => { tray.add([...picker.files]); picker.value = ''; };
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); tray.add(files); }
  });
  zone.addEventListener('dragover', (e) => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    zone.classList.add('dropping');
  });
  zone.addEventListener('dragleave', (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('dropping'); });
  zone.addEventListener('drop', (e) => {
    zone.classList.remove('dropping');
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    tray.add([...e.dataTransfer.files]);
  });
}

const fileList = (files) => files?.length
  ? `<div class="files">${files.map((f) => f.image
      ? `<a class="thumb" href="${fileUrl(f)}" target="_blank" rel="noreferrer" title="${esc(f.name)}"><img src="${fileUrl(f)}" alt="${esc(f.name)}" loading="lazy"></a>`
      : f.audio
      ? `<audio class="voice" controls preload="metadata" src="${fileUrl(f)}" title="${esc(f.name)}"></audio>`
      : `<a class="file" href="${fileUrl(f)}" title="${esc(f.name)} · ${size(f.size)}"><b>FILE</b><span>${esc(f.name)}</span></a>`).join('')}</div>`
  : '';

const ICONS = {
  more: '<svg viewBox="0 0 24 24"><path d="M7 7l5 5 5-5M7 13l5 5 5-5"/></svg>',
  speak: '<svg viewBox="0 0 24 24"><path d="M11 5 6 9H3v6h3l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/></svg>',
  open: '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9"/><path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  reply: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
};

export class Hud {
  constructor(app) {
    this.app = app;
    this.openId = null;
    this.repos = null;
    this.channels = [{ id: 'general', name: 'general' }];
    this.channel = store('office.channel') || 'general';
    this.unread = new Map();

    $('clear').onclick = async () => { await api('/api/jobs/clear', {}); this.closeDetail(); };
    $('away').onclick = (e) => {
      const b = e.target.closest('[data-recall]');
      if (b) this.app.recall(b.dataset.recall);
    };
    $('jobs').onclick = (e) => {
      const btn = e.target.closest('[data-id]');
      if (btn) this.app.openJob(btn.dataset.id);
    };
    document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => this.tab(b.dataset.tab)));
    this.bindTeam();
    this.bindChat();
    this.bindChannels();
    this.renderChannels();
    addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
      if ((e.key === 'n' || e.key === '/') && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); this.focusInput(); }
      if (e.key === 'Escape' && !typing) this.closeDetail();
    });
    setInterval(() => this.tick(), 1000);
  }

  // ---------- top bar ----------

  renderLevel(p) {
    $('lv').textContent = `Lv ${p.level}`;
    $('lv').title = `Level ${p.level}`;
    $('xpbar').style.width = `${Math.min(100, ((p.xp - p.floor) / (p.next - p.floor)) * 100)}%`;
    $('xptext').textContent = `${p.xp - p.floor} / ${p.next - p.floor} XP`;
  }

  // Plan usage: how much of the 5-hour session and the week is gone, and
  // when each comes back. Countdowns tick with the clock between updates.
  renderUsage(u) {
    if (u !== undefined) this.usage = u;
    u = this.usage;
    $('usage').hidden = !u;
    if (!u) return;
    const err = u.error && !u.session && !u.week;
    $('useErr').hidden = !err;
    $('useErr').textContent = err ? u.error : '';
    for (const [id, m] of [['useSession', u.session], ['useWeek', u.week]]) {
      const el = $(id);
      el.hidden = !m;
      if (!m) continue;
      const left = m.resetsAt ? m.resetsAt - Date.now() : null;
      el.className = `meter ${m.pct >= 90 ? 'hot' : m.pct >= 70 ? 'warm' : ''}`;
      el.querySelector('i').style.width = `${Math.min(100, m.pct)}%`;
      el.querySelector('.v').textContent = `${m.pct}%`;
      el.querySelector('.r').textContent = left === null ? '' : left <= 0 ? 'Resetting now' : `Resets in ${countdown(left)}`;
      el.title = m.resetsAt ? `Resets ${resetsAt(m.resetsAt)}` : '';
    }
  }

  // What the agents are actually using on this machine: CPU across all the
  // cores they're on, and resident memory. Only shown while someone works.
  renderProc(procs, machine) {
    if (machine) this.machine = machine;
    this.procs = procs || null;
    const m = this.machine;
    const list = Object.values(this.procs || {}).filter((p) => p);
    $('load').hidden = !list.length || !m;
    if ($('load').hidden) return this.renderMeta(this.app.job(this.openId));
    const cpu = list.reduce((a, p) => a + (p.cpu || 0), 0);
    const mem = list.reduce((a, p) => a + p.mem, 0);
    const share = cpu / m.cores;
    const memShare = (mem / m.mem) * 100;
    const agents = `${list.length} ${list.length === 1 ? 'agent' : 'agents'}`;
    const cores = `${(cpu / 100).toFixed(1)} of ${m.cores} cores`;
    this.meter('loadCpu', share, pct(share), list.length > 1 ? `${agents} · ${cores}` : cores, `${agents} using ${cores}`);
    this.meter('loadMem', memShare, bytes(mem), `${pct(memShare)} of ${bytes(m.mem)}`, `${agents} holding ${bytes(mem)} of ${bytes(m.mem)}`);
    this.renderMeta(this.app.job(this.openId));
  }

  meter(id, share, value, note, title) {
    const el = $(id);
    el.hidden = false;
    el.className = `meter ${share >= 90 ? 'hot' : share >= 70 ? 'warm' : ''}`;
    el.querySelector('i').style.width = `${Math.min(100, share)}%`;
    el.querySelector('.v').textContent = value;
    el.querySelector('.r').textContent = note;
    el.title = title;
  }

  renderStats(jobs, extra = 0) {
    const count = (s) => jobs.filter((j) => j.status === s).length;
    const spent = jobs.reduce((a, j) => a + (j.cost || 0), extra);
    $('stats').innerHTML = [
      `<span><b>${count('working')}</b> working</span>`,
      `<span><b>${count('queued')}</b> queued</span>`,
      `<span><b>${count('done')}</b> shipped</span>`,
      `<span><b>$${spent.toFixed(2)}</b> spent</span>`,
    ].join('');
  }

  // ---------- job list ----------

  renderJobs(jobs, staffName) {
    const order = { working: 0, queued: 1, done: 2, failed: 2, stopped: 2 };
    const list = [...jobs].sort((a, b) => order[a.status] - order[b.status] || (b.endedAt || b.queuedAt) - (a.endedAt || a.queuedAt));
    $('jobs').innerHTML = list.length
      ? list.map((j) => `
        <button class="job ${j.id === this.openId ? 'open' : ''}" data-id="${j.id}">
          <span class="dot ${j.status}"></span>
          <span class="t">${esc(j.title)}</span>
          <span class="m">${esc(j.repo)}${j.agentId ? ' · ' + esc(staffName(j.agentId)) : ''} · ${STATUS[j.status]}</span>
        </button>`).join('')
      : `<p class="empty">No jobs yet. Ask for something in the chat.</p>`;
    $('clear').hidden = !list.some((j) => order[j.status] === 2);
    const open = list.filter((j) => order[j.status] < 2).length;
    $('jobCount').textContent = open ? String(open) : '';
  }

  // ---------- detail drawer ----------

  async openDetail(id) {
    this.openId = id;
    const job = await api(`/api/jobs/${id}`);
    if (this.openId !== id) return;
    this.app.mergeLog(job);
    this.renderDetail();
    this.app.refreshLists();
  }

  closeDetail() {
    this.openId = null;
    $('detail').hidden = true;
    this.app.refreshLists();
    this.app.select(null);
  }

  renderDetail() {
    const job = this.app.job(this.openId);
    if (!job) return this.closeDetail();
    const el = $('detail');
    el.hidden = false;
    el.innerHTML = `
      <div class="d-head">
        <span class="pill ${job.status}">${STATUS[job.status]}</span>
        <button class="x" title="Close (Esc)">×</button>
      </div>
      <h2>${esc(job.title)}</h2>
      <dl class="meta" id="meta"></dl>
      <div class="log" id="log">${job.log.map((e, i) => this.entry(e, null, job.log[i - 1])).join('')}</div>
      <div class="d-foot">${this.footer(job)}</div>`;
    el.querySelector('.x').onclick = () => this.closeDetail();
    this.renderMeta(job);
    const log = $('log');
    log.scrollTop = log.scrollHeight;
    this.bindFooter(job);
  }

  renderMeta(job) {
    const meta = $('meta');
    if (!meta || !job) return;
    const end = job.status === 'working' || job.status === 'queued' ? Date.now() : job.endedAt || Date.now();
    const rows = [
      ['Project', job.repo],
      ['Agent', job.agentId ? this.app.staffName(job.agentId) : 'Unassigned'],
      ['Clearance', this.app.modes[job.mode] || job.mode],
      ['Model', [modelLabel(job.model), job.autoModel && 'chief’s pick',
        job.escalations ? `moved up ${job.escalations}×` : ''].filter(Boolean).join(' · ')],
      ['Context', job.context ? `${(job.context / 1000).toFixed(1)}k tokens` : '—'],
      ['Time', job.startedAt ? duration(end - job.startedAt) : '—'],
      ['Cost', `$${(job.cost || 0).toFixed(3)}`],
      ['XP', job.xp ? `+${job.xp}` : '—'],
    ];
    // Live machine cost, only while this job's process is actually up.
    const p = this.procs?.[job.id];
    if (p) {
      rows.push(['CPU', p.cpu === null ? 'measuring…' : `${Math.round(p.cpu)}%`]);
      rows.push(['Memory', bytes(p.mem)]);
      rows.push(['Processes', String(p.procs)]);
    }
    meta.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
  }

  // The final answer usually repeats the last message; show it once.
  entry(e, lastEl, prev) {
    const echo = e.kind === 'result' && (prev ? prev.kind === 'text' && prev.summary === e.summary : lastEl?.dataset.text === e.summary);
    switch (e.kind) {
      case 'user': return `<div class="e user"><span class="who">You</span><p>${esc(e.summary)}</p></div>`;
      case 'system': return `<div class="e sys">${esc(e.summary)}</div>`;
      case 'thinking': return `<div class="e sys">thinking…</div>`;
      case 'tool': return `<div class="e tool"><span class="st ${e.station}" title="${STATION[e.station] || ''}"></span>${esc(e.summary)}</div>`;
      case 'text': return `<div class="e text md" data-text="${esc(e.summary)}">${rich(e.summary)}</div>`;
      case 'error': return `<div class="e err">${esc(e.summary)}</div>`;
      case 'result': return `<div class="e result ${e.ok ? 'ok' : 'bad'}"><span class="who">${e.ok ? 'Result' : 'Ended early'}${e.ms ? ` · ${duration(e.ms)}` : ''}${e.cost ? ` · $${e.cost.toFixed(3)}` : ''}</span>${echo ? '' : `<div class="md">${rich(e.summary)}</div>`}</div>`;
      default: return '';
    }
  }

  appendLog(jobId, entry) {
    if (jobId !== this.openId) return;
    const log = $('log');
    if (!log) return;
    const stick = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
    log.insertAdjacentHTML('beforeend', this.entry(entry, log.lastElementChild));
    if (stick) log.scrollTop = log.scrollHeight;
  }

  footer(job) {
    if (job.status === 'working') return `<button class="ghost danger" data-act="stop">Stop work</button>`;
    if (job.status === 'queued') return `<button class="ghost danger" data-act="stop">Pull from queue</button>`;
    const blocked = job.denials?.length
      ? `<div class="notice">Blocked from using <b>${job.denials.map(esc).join(', ')}</b>.
           <button class="primary small" data-act="grant">Grant full autonomy and continue</button></div>`
      : '';
    const plan = job.mode === 'plan' && job.status === 'done'
      ? `<div class="notice">That's the plan. <button class="primary small" data-act="approve">Approve and build it</button></div>`
      : '';
    return `${blocked}${plan}
      <form class="reply" data-act="reply">
        <div class="tray" hidden></div>
        <textarea name="message" rows="2" placeholder="Follow up with ${esc(this.app.staffName(job.agentId) || 'them')}…"></textarea>
        <div class="row">
          <select name="mode">${Object.entries(this.app.modes).map(([k, v]) => `<option value="${k}" ${k === job.mode ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <button type="button" class="attach" title="Attach files or images" aria-label="Attach files">
            <svg viewBox="0 0 24 24"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/></svg>
          </button>
          <input type="file" multiple hidden />
          <button class="primary small" type="submit">Send</button>
        </div>
      </form>`;
  }

  bindFooter(job) {
    const foot = $('detail').querySelector('.d-foot');
    const act = async (fn) => {
      try { await fn(); } catch (err) { this.toast(err.message, 'bad'); }
    };
    foot.querySelectorAll('[data-act="stop"]').forEach((b) => (b.onclick = () => act(() => api(`/api/jobs/${job.id}/stop`, {}))));
    foot.querySelectorAll('[data-act="grant"]').forEach((b) => (b.onclick = () => act(() => api(`/api/jobs/${job.id}/reply`, {
      message: 'You now have permission to run the commands that were blocked. Carry on from where you stopped.', mode: 'auto',
    }))));
    foot.querySelectorAll('[data-act="approve"]').forEach((b) => (b.onclick = () => act(() => api(`/api/jobs/${job.id}/reply`, {
      message: 'Approved. Go ahead and implement the plan.', mode: 'edit',
    }))));
    const form = foot.querySelector('form.reply');
    if (form) {
      const tray = new Tray(form.querySelector('.tray'), (m) => this.toast(m, 'bad'));
      bindFiles(tray, { zone: form, input: form.message, picker: form.querySelector('input[type=file]'), button: form.querySelector('.attach') });
      form.onsubmit = (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        act(async () => {
          const files = await tray.ids();
          await api(`/api/jobs/${job.id}/reply`, { message: fd.get('message'), mode: fd.get('mode'), files });
          tray.clear();
        });
      };
      form.message.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); };
    }
  }

  tick() {
    const job = this.openId && this.app.job(this.openId);
    if (job && (job.status === 'working' || job.status === 'queued')) this.renderMeta(job);
    if (this.usage) this.renderUsage();
  }

  // ---------- channels ----------
  //
  // One strand of conversation each, the way Slack does it. Messages are
  // only ever shown in their own channel; anything that lands in one you
  // aren't reading marks it unread.

  renderChannels(list) {
    if (list) this.channels = list;
    // A channel that has gone (closed from another window) drops you back
    // into #general rather than leaving its messages on screen.
    if (!this.channels.some((c) => c.id === this.channel)) {
      this.channel = 'general';
      this.thread = null;
      if (this.chat) setTimeout(() => this.paintChat());
    }
    const rail = $('channels');
    const open = rail.querySelector('.new-channel');
    rail.innerHTML = this.channels.map((c) => {
      const n = this.unread.get(c.id) || 0;
      const on = c.id === this.channel;
      // Whatever the channel knows about itself goes in the tooltip: what
      // it's for, and who an agent has pulled into it.
      const who = (c.members || []).map((id) => this.app.person(id).name).join(', ');
      const title = `#${c.name}${c.purpose ? ` — ${c.purpose}` : ''}${who ? `\nIn it: ${who}` : ''}`;
      return `<button type="button" role="tab" aria-selected="${on}" class="channel ${on ? 'on' : ''}" data-channel="${esc(c.id)}" title="${esc(title)}">
        <span class="hash">#</span>${esc(c.name)}${n && !on ? `<span class="badge">${n > 99 ? '99+' : n}</span>` : ''}</button>`;
    }).join('')
      + (this.channel === 'general' ? '' : `<button type="button" class="channel close" data-close-channel="${esc(this.channel)}" aria-label="Close this channel" title="Close this channel">×</button>`)
      + `<button type="button" class="channel add" data-new-channel aria-label="New channel" title="New channel">+</button>`;
    if (open) rail.append(open);
    this.setPlaceholder();
  }

  setPlaceholder() {
    $('input').placeholder = `Message #${this.channel} · @agent #project`;
  }

  selectChannel(id) {
    if (!this.channels.some((c) => c.id === id)) return;
    this.channel = id;
    this.unread.delete(id);
    store('office.channel', id);
    this.thread = null;
    this.renderChannels();
    this.paintChat();
    this.tab('chat');
  }

  bindChannels() {
    $('channels').onclick = (e) => {
      const gone = e.target.closest('[data-close-channel]');
      if (gone) return this.deleteChannel(gone.dataset.closeChannel);
      const pick = e.target.closest('[data-channel]');
      if (pick) return this.selectChannel(pick.dataset.channel);
      if (e.target.closest('[data-new-channel]')) this.newChannel();
    };
  }

  // The + turns into a field in the rail; Enter creates, Escape backs out.
  newChannel() {
    const rail = $('channels');
    if (rail.querySelector('.new-channel')) return rail.querySelector('.new-channel input').focus();
    const form = document.createElement('form');
    form.className = 'new-channel';
    form.innerHTML = `<span class="hash">#</span><input maxlength="24" placeholder="new-channel" aria-label="Channel name" />`;
    const close = () => form.remove();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const name = form.querySelector('input').value.trim();
      if (!name) return close();
      try {
        const channel = await api('/api/channels', { name });
        close();
        this.selectChannel(channel.id);
      } catch (err) {
        this.toast(err.message, 'bad');
        form.querySelector('input').select();
      }
    };
    form.querySelector('input').onkeydown = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    form.querySelector('input').onblur = () => setTimeout(() => { if (!form.querySelector('input')?.value.trim()) close(); }, 120);
    rail.append(form);
    form.querySelector('input').focus();
  }

  async deleteChannel(id) {
    try {
      await api(`/api/channels/${encodeURIComponent(id)}`, undefined, 'DELETE');
      this.toast(`#${id} closed`, 'good');
    } catch (err) {
      this.toast(err.message, 'bad');
    }
  }

  // ---------- chat ----------

  tab(name) {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    $('chatPane').hidden = name !== 'chat' || !!this.thread;
    $('threadPane').hidden = name !== 'chat' || !this.thread;
    $('jobsPane').hidden = name !== 'jobs';
    $('teamPane').hidden = name !== 'team';
    if (name === 'team') this.renderTeam();
    if (name === 'chat') this.scrollChat(true);
  }

  focusInput(prefix = '') {
    this.thread = null;
    this.tab('chat');
    const input = $('input');
    if (prefix && !input.value.includes(prefix.trim())) input.value = prefix + input.value;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
    this.autosize();
  }

  bindChat() {
    const input = $('input');
    for (const id of ['mode', 'model']) {
      const saved = store(`office.${id}`);
      if (saved !== null) $(id).value = saved;
      $(id).onchange = () => store(`office.${id}`, $(id).value);
    }
    $('composer').onsubmit = (e) => { e.preventDefault(); this.send(); };
    this.tray = new Tray($('tray'), (m) => this.toast(m, 'bad'));
    bindFiles(this.tray, { zone: $('composer'), input, picker: $('file'), button: $('attach') });
    this.bindVoice();
    input.oninput = () => { this.autosize(); this.suggest(); };
    input.onclick = () => this.suggest();
    input.onblur = () => setTimeout(() => ($('ac').hidden = true), 120);
    input.onkeydown = (e) => {
      const ac = $('ac');
      if (!ac.hidden) {
        const items = [...ac.children];
        const at = items.findIndex((i) => i.classList.contains('on'));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const next = (at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items.forEach((i, k) => i.classList.toggle('on', k === next));
          return;
        }
        if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); this.pick(items[Math.max(0, at)]); return; }
        if (e.key === 'Escape') { e.preventDefault(); ac.hidden = true; return; }
      }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
    };
    $('ac').onmousedown = (e) => {
      const item = e.target.closest('[data-insert]');
      if (item) { e.preventDefault(); this.pick(item); }
    };
    const threadInput = $('threadInput');
    $('threadComposer').onsubmit = (e) => { e.preventDefault(); this.sendThread(); };
    $('threadBack').onclick = () => this.closeThread();
    threadInput.oninput = () => this.autosize(threadInput);
    threadInput.onkeydown = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); this.closeThread(); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.sendThread(); }
    };
    $('msgs').onclick = $('threadMsgs').onclick = (e) => {
      const thread = e.target.closest('[data-thread]');
      if (thread) return this.openThread(thread.dataset.thread);
      const pick = e.target.closest('[data-pick]');
      if (pick) return this.openPicker(pick);
      const react = e.target.closest('[data-react]');
      if (react) return this.react(react.closest('.msg').dataset.id, react.dataset.react);
      const say = e.target.closest('[data-say]');
      if (say) {
        const m = this.chat.get(say.closest('.msg').dataset.id);
        speech.stop();
        if (m) speech.speak(m.text, m.from, { force: true });
        return;
      }
      const open = e.target.closest('[data-open]');
      if (open) return this.app.openJob(open.dataset.open);
      const more = e.target.closest('[data-more]');
      if (more) { more.closest('.msg').classList.add('full'); more.remove(); return; }
      const grant = e.target.closest('[data-grant]');
      if (grant) {
        api(`/api/jobs/${grant.dataset.grant}/reply`, {
          message: 'You now have permission to run the commands that were blocked. Carry on from where you stopped.', mode: 'auto',
        }).then(() => grant.remove(), (err) => this.toast(err.message, 'bad'));
      }
    };
  }

  autosize(input = $('input')) {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }

  // The microphone. Click to start, click again to stop; the words come back
  // into the composer so you can fix a misheard name before anyone acts on
  // it, with the recording attached so you can hear what you actually said.
  bindVoice() {
    const mic = $('mic'), bar = $('rec'), label = $('recText');
    if (!recorder.supported) { mic.hidden = true; return; }
    let timer = null;
    const paint = (state) => {
      bar.hidden = state === 'idle';
      bar.classList.toggle('working', state === 'working');
      mic.classList.toggle('on', state === 'recording');
      mic.disabled = state === 'working';
      $('recStop').hidden = $('recDrop').hidden = state !== 'recording';
      if (state === 'working') label.textContent = 'Transcribing…';
    };
    const tick = () => {
      const s = Math.floor((Date.now() - recorder.startedAt) / 1000);
      label.textContent = `Recording ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    };
    const start = async () => {
      const ready = this.app.voice;
      if (ready && !ready.ok) return this.toast(ready.reason, 'bad');
      try { await recorder.start(); } catch (err) {
        return this.toast(err.name === 'NotAllowedError'
          ? 'The browser is blocking the microphone. Allow it for this page and try again.'
          : `No microphone here: ${err.message}`, 'bad');
      }
      speech.stop();
      paint('recording');
      tick();
      timer = setInterval(tick, 500);
    };
    const finish = async () => {
      clearInterval(timer);
      const blob = await recorder.stop();
      if (!blob) return paint('idle');
      paint('working');
      try {
        const file = voiceFile(blob);
        const res = await fetch('/api/voice', {
          method: 'POST',
          headers: { 'x-file-name': encodeURIComponent(file.name), 'content-type': file.type || 'audio/webm' },
          body: file,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || `Transcribing failed (${res.status})`);
        this.tray.attach(data);
        const input = $('input');
        if (data.text) input.value = input.value.trim() ? `${input.value.trim()} ${data.text}` : data.text;
        else this.toast("I couldn't make out any words in that one — it's attached if you want to send it anyway.", 'bad');
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        this.autosize();
      } catch (err) {
        this.toast(err.message, 'bad');
      }
      paint('idle');
    };
    const drop = () => { clearInterval(timer); recorder.cancel(); paint('idle'); };
    mic.onclick = () => (recorder.active ? finish() : start());
    $('recStop').onclick = finish;
    $('recDrop').onclick = drop;
    addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && recorder.active) { e.preventDefault(); return drop(); }
      // Option-M from anywhere, so you can talk without reaching for the mouse.
      if (e.altKey && /^(m|µ)$/i.test(e.key)) { e.preventDefault(); recorder.active ? finish() : start(); }
    });
    paint('idle');
  }

  async send() {
    const input = $('input');
    const text = input.value.trim();
    if ((!text && this.tray.empty) || this.sending) return;
    this.sending = true;
    input.value = '';
    this.autosize();
    $('ac').hidden = true;
    try {
      const files = await this.tray.ids();
      if (!text && !files.length) return;
      await api('/api/chat', { text, files, channel: this.channel, mode: $('mode').value, model: $('model').value });
      this.tray.clear();
    } catch (err) {
      input.value = text;
      this.toast(err.message, 'bad');
    } finally {
      this.sending = false;
    }
  }

  // @ for people, # for projects. Projects with spaces are written with dashes.
  async suggest() {
    const input = $('input');
    const before = input.value.slice(0, input.selectionStart);
    const m = before.match(/(^|\s)([@#])([\w.-]*)$/);
    const ac = $('ac');
    if (!m) { ac.hidden = true; return; }
    const [, , sigil, typed] = m;
    const q = typed.toLowerCase().replace(/[^a-z0-9]/g, '');
    let items;
    if (sigil === '@') {
      items = this.app.roster().map((a) => ({ insert: `@${a.name}`, label: a.name, note: a.note, dot: a.color }));
    } else {
      if (!this.repos) {
        try { this.repos = (await api('/api/repos')).repos; } catch { this.repos = []; }
      }
      items = this.repos.map((r) => ({ insert: `#${r.replace(/\s+/g, '-')}`, label: r, note: this.app.busyIn(r) }));
    }
    items = items.filter((i) => i.label.toLowerCase().replace(/[^a-z0-9]/g, '').includes(q))
      .sort((a, b) => a.label.toLowerCase().replace(/[^a-z0-9]/g, '').indexOf(q) - b.label.toLowerCase().replace(/[^a-z0-9]/g, '').indexOf(q))
      .slice(0, 8);
    if (!items.length) { ac.hidden = true; return; }
    ac.innerHTML = items.map((i, k) => `
      <div class="item ${k === 0 ? 'on' : ''}" data-insert="${esc(i.insert)}" data-len="${typed.length + 1}">
        ${i.dot ? `<i style="background:${i.dot}"></i>` : '<i class="hash">#</i>'}
        <span>${esc(i.label)}</span>${i.note ? `<em>${esc(i.note)}</em>` : ''}
      </div>`).join('');
    ac.hidden = false;
  }

  pick(item) {
    if (!item) return;
    const input = $('input');
    const caret = input.selectionStart;
    const start = caret - Number(item.dataset.len);
    input.value = input.value.slice(0, start) + item.dataset.insert + ' ' + input.value.slice(caret);
    const pos = start + item.dataset.insert.length + 1;
    input.setSelectionRange(pos, pos);
    $('ac').hidden = true;
    input.focus();
  }

  renderChat(messages) {
    this.chat = new Map(messages.map((m) => [m.id, m]));
    this.unread.clear();
    this.renderChannels();
    this.paintChat();
  }

  // Just this channel's messages, newest at the bottom.
  paintChat() {
    const roots = [...this.chat.values()].filter((m) => this.here(m) && !this.inThread(m));
    $('msgs').innerHTML = roots.length
      ? roots.map((m) => this.message(m)).join('')
      : `<p class="empty">${this.channel === 'general'
        ? 'Tell the office what you need. Tag someone with @, or a project with #. The chief of staff hands everything else to whoever fits.'
        : `Nothing in #${esc(this.channel)} yet. Whatever you ask for here stays here.`}</p>`;
    this.scrollChat(true);
    if (this.thread) this.renderThread();
  }

  here(m) {
    return (m.channel || 'general') === this.channel;
  }

  // A reply whose first message scrolled away shows in the main chat instead.
  inThread(m) {
    return !!m.thread && this.chat.has(m.thread);
  }

  replies(id) {
    return [...this.chat.values()].filter((m) => m.thread === id);
  }

  addMessage(m) {
    this.chat.set(m.id, m);
    if (!this.here(m)) {
      const id = m.channel || 'general';
      this.unread.set(id, (this.unread.get(id) || 0) + 1);
      this.renderChannels();
      return;
    }
    if (this.inThread(m)) {
      this.updateThreadSum(m.thread);
      if (this.thread === m.thread) {
        const box = $('threadMsgs');
        box.insertAdjacentHTML('beforeend', this.message(m, true));
        box.querySelector('.thread-count').textContent = this.countLabel(this.replies(m.thread).length);
        requestAnimationFrame(() => (box.scrollTop = box.scrollHeight));
      }
      return;
    }
    const msgs = $('msgs');
    const stick = msgs.scrollHeight - msgs.scrollTop - msgs.clientHeight < 80;
    msgs.querySelector('.empty')?.remove();
    msgs.insertAdjacentHTML('beforeend', this.message(m));
    if (stick || m.from === 'you') this.scrollChat(true);
  }

  scrollChat() {
    const msgs = $('msgs');
    requestAnimationFrame(() => (msgs.scrollTop = msgs.scrollHeight));
  }

  // ---------- threads ----------

  openThread(id) {
    if (!this.chat.has(id)) return;
    const m = this.chat.get(id);
    if (!this.here(m)) this.selectChannel(m.channel || 'general');
    this.thread = id;
    this.renderThread();
    this.tab('chat');
    $('threadInput').focus();
  }

  closeThread() {
    this.thread = null;
    this.tab('chat');
    $('input').focus();
  }

  renderThread() {
    const root = this.chat.get(this.thread);
    if (!root) return this.closeThread();
    const replies = this.replies(root.id);
    $('threadWhere').textContent = `Thread on ${this.app.person(root.from).name}'s message · #${root.channel || 'general'}`;
    const box = $('threadMsgs');
    box.innerHTML = this.message(root, true) +
      `<p class="thread-count">${this.countLabel(replies.length)}</p>` +
      replies.map((m) => this.message(m, true)).join('');
    requestAnimationFrame(() => (box.scrollTop = box.scrollHeight));
  }

  countLabel(n) {
    return n ? `${n} ${n === 1 ? 'reply' : 'replies'}` : 'No replies yet';
  }

  updateThreadSum(id) {
    const el = $('msgs').querySelector(`.msg[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.querySelector('.thread-sum')?.remove();
    el.querySelector('.reacts').insertAdjacentHTML('beforebegin', this.threadSum(this.chat.get(id)));
  }

  threadSum(m) {
    const replies = this.replies(m.id);
    if (!replies.length) return '';
    const last = replies.at(-1);
    const faces = [...new Set(replies.map((r) => r.from))].slice(-3)
      .map((p) => `<i style="background:${this.app.person(p).color}"></i>`).join('');
    const said = last.text.replace(/[*_`#>]/g, '').replace(/\s+/g, ' ').trim();
    return `
      <button type="button" class="thread-sum" data-thread="${esc(m.id)}">
        <span class="faces">${faces}</span><b>${this.countLabel(replies.length)}</b>
        <span class="last">${esc(this.app.person(last.from).name)}: ${esc(said.length > 70 ? said.slice(0, 69) + '…' : said)}</span>
      </button>`;
  }

  async sendThread() {
    const input = $('threadInput');
    const text = input.value.trim();
    if (!text || this.sending || !this.thread) return;
    this.sending = true;
    input.value = '';
    this.autosize(input);
    try {
      await api('/api/chat', { text, thread: this.thread, mode: $('mode').value, model: $('model').value });
    } catch (err) {
      input.value = text;
      this.toast(err.message, 'bad');
    } finally {
      this.sending = false;
    }
  }

  message(m, inThread = false) {
    const who = this.app.person(m.from);
    const to = m.to && this.app.person(m.to);
    const time = new Date(m.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const body = m.from === 'you'
      ? `<p>${esc(m.text).replace(/(^|\s)([@#][\w.-]+)/g, '$1<span class="tag">$2</span>')}</p>`
      : rich(m.text);
    const long = m.from !== 'you' && m.from !== 'chief' && !m.to && m.text.length > 420;
    const extras = [
      long ? `<button type="button" class="icon" data-more aria-label="Show all" title="Show all">${ICONS.more}</button>` : '',
      m.jobId && m.from !== 'you' ? `<button type="button" class="icon" data-open="${m.jobId}" aria-label="Open job" title="Open job">${ICONS.open}</button>` : '',
      !inThread && m.threadOf && this.chat.has(m.threadOf) ? `<button type="button" class="link" data-thread="${esc(m.threadOf)}">Updates are in this thread →</button>` : '',
      inThread ? '' : `<button type="button" class="icon quiet" data-thread="${esc(m.id)}" aria-label="Reply in thread" title="Reply in thread">${ICONS.reply}</button>`,
      m.from !== 'you' && m.text && speech.supported ? `<button type="button" class="icon quiet" data-say aria-label="Read aloud" title="Read aloud">${ICONS.speak}</button>` : '',
      m.denials?.length ? `<button type="button" class="primary small" data-grant="${m.jobId}">Grant full autonomy and continue</button>` : '',
    ].filter(Boolean).join('');
    return `
      <div data-id="${esc(m.id)}" class="msg from-${m.from === 'you' ? 'you' : m.from === 'chief' ? 'chief' : 'agent'} ${m.kind || ''} ${m.status || ''} ${long ? 'clamp' : ''}">
        <div class="who"><i style="background:${who.color}"></i><b>${esc(who.name)}</b>${to ? `<span class="arrow">→</span><i style="background:${to.color}"></i><b>${esc(to.name)}</b>` : ''}<time>${time}</time></div>
        ${m.kind === 'handoff' ? `<p class="kind">Handed off · ${esc(m.project || '')}</p>` : ''}
        ${m.kind === 'standup' && m.from !== 'chief' ? '<p class="kind">Standup</p>' : ''}
        ${m.text ? `<div class="body md">${body}</div>` : ''}
        ${fileList(m.files)}
        ${m.denials?.length ? `<p class="blocked">Blocked from using ${m.denials.map(esc).join(', ')}.</p>` : ''}
        ${extras ? `<div class="acts">${extras}</div>` : ''}
        ${inThread ? '' : this.threadSum(m)}
        ${this.reactionRow(m)}
      </div>`;
  }

  reactionRow(m) {
    const have = Object.entries(m.reactions || {});
    const pills = have.map(([e, people]) => {
      const names = people.map((p) => this.app.person(p).name).join(', ');
      return `<button type="button" class="pill ${people.includes('you') ? 'mine' : ''}" data-react="${esc(e)}" title="${esc(names)}">${esc(e)}<span>${people.length}</span></button>`;
    }).join('');
    return `<div class="reacts ${have.length ? 'some' : ''}">${pills}<button type="button" class="add" data-pick aria-label="Add reaction" aria-haspopup="dialog" title="React">☺︎+</button></div>`;
  }

  react(id, emoji) {
    api(`/api/chat/${id}/react`, { emoji }).catch((err) => this.toast(err.message, 'bad'));
  }

  // One shared picker, placed beside whichever message asked for it.
  openPicker(btn) {
    const id = btn.closest('.msg').dataset.id;
    let el = $('emojiPicker');
    if (el?.dataset.for === id) return this.closePicker();
    if (!el) {
      el = document.createElement('div');
      el.id = 'emojiPicker';
      el.className = 'emoji-picker';
      el.setAttribute('role', 'dialog');
      el.setAttribute('aria-label', 'Pick a reaction');
      document.body.append(el);
      el.onclick = (e) => {
        const b = e.target.closest('[data-emoji]');
        if (!b) return;
        const emoji = b.dataset.emoji;
        const recent = [emoji, ...this.recentEmoji().filter((x) => x !== emoji)].slice(0, 8);
        localStorage.setItem('office.recentEmoji', JSON.stringify(recent));
        this.react(el.dataset.for, emoji);
        this.closePicker();
      };
      document.addEventListener('pointerdown', (e) => {
        if (!el.hidden && !el.contains(e.target) && !e.target.closest('[data-pick]')) this.closePicker();
      });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el.hidden) this.closePicker(); });
    }
    const groups = [['Recent', this.recentEmoji()], ...EMOJI_GROUPS];
    el.innerHTML = groups.map(([name, list]) => `<p>${name}</p><div class="grid">${[...list].map((e) => `<button type="button" data-emoji="${esc(e)}">${esc(e)}</button>`).join('')}</div>`).join('');
    el.dataset.for = id;
    el.hidden = false;
    const r = btn.getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = Math.max(8, Math.min(r.right - w, innerWidth - w - 8)) + 'px';
    el.style.top = (r.bottom + h + 8 < innerHeight ? r.bottom + 6 : Math.max(8, r.top - h - 6)) + 'px';
    el.querySelector('button')?.focus();
  }

  closePicker() {
    const el = $('emojiPicker');
    if (el) { el.hidden = true; el.dataset.for = ''; }
  }

  recentEmoji() {
    try { return JSON.parse(localStorage.getItem('office.recentEmoji')) || DEFAULT_EMOJI; } catch { return DEFAULT_EMOJI; }
  }

  // The server caps how much small talk it keeps; these are the lines that
  // fell off the end, so they go from the map and the screen too.
  forget(ids = []) {
    for (const id of ids) {
      this.chat?.delete(id);
      for (const box of [$('msgs'), $('threadMsgs')]) box.querySelector(`.msg[data-id="${CSS.escape(id)}"]`)?.remove();
    }
  }

  // A voice note catching up with its message: slot the player in without
  // disturbing the rest of the bubble.
  addVoice(id, file) {
    const m = this.chat?.get(id);
    if (m) m.files = [...(m.files || []), file];
    const files = m ? m.files : [file];
    let el = null;
    for (const box of [$('msgs'), $('threadMsgs')]) {
      const found = box.querySelector(`.msg[data-id="${CSS.escape(id)}"]`);
      if (!found) continue;
      const frag = document.createRange().createContextualFragment(fileList(files));
      const had = found.querySelector('.files');
      if (had) had.replaceWith(frag);
      else (found.querySelector('.body') || found.querySelector('.who')).after(frag);
      el = found;
    }
    return el?.querySelector('audio.voice') || null;
  }

  setReactions(id, reactions) {
    const m = this.chat?.get(id);
    if (m) m.reactions = reactions;
    for (const box of [$('msgs'), $('threadMsgs')]) {
      const el = box.querySelector(`.msg[data-id="${CSS.escape(id)}"]`);
      el?.querySelector('.reacts').replaceWith(document.createRange().createContextualFragment(this.reactionRow({ reactions })));
    }
  }

  chiefBusy(on) {
    $('typing').hidden = !on;
    if (on) this.scrollChat();
  }

  // ---------- moments ----------

  // An action turns the toast into something you can click, so it stays up longer.
  toast(text, kind = '', action = null) {
    const t = $('toast');
    t.textContent = text;
    if (action) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = action.label;
      b.onclick = () => { t.className = 'toast'; action.run(); };
      t.append(' ', b);
    }
    t.className = `toast show ${kind} ${action ? 'act' : ''}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (t.className = 'toast'), action ? 6000 : 3200);
  }

  async post(path) {
    try {
      const { text } = await api(path, {});
      if (text) this.toast(text, 'good');
    } catch (err) {
      this.toast(err.message, 'bad');
    }
  }

  // ---------- team ----------

  // Everyone on the payroll, hired or not yet. One profile opens at a
  // time; what they say here goes into their prompt on their next job.
  bindTeam() {
    const el = $('team');
    el.onclick = (e) => {
      const head = e.target.closest('[data-member]');
      if (!head) return;
      const id = head.dataset.member;
      if (this.editing === id && !this.dirty()) this.editing = null;
      else if (this.editing !== id) {
        if (this.dirty() && !confirm('Discard your changes?')) return;
        this.editing = id;
      }
      this.renderTeam(true);
      el.querySelector('.member.open input')?.focus();
    };
    el.onsubmit = async (e) => {
      e.preventDefault();
      const form = e.target;
      const btn = form.querySelector('[type=submit]');
      btn.disabled = true;
      try {
        const p = await api(`/api/staff/${form.dataset.id}/profile`, Object.fromEntries(new FormData(form)));
        Object.assign(this.app.staff.find((x) => x.id === form.dataset.id) || {}, p);
        this.toast(`Saved. ${this.app.staffName(form.dataset.id)} takes it from their next job.`, 'good');
        this.editing = null;
        this.renderTeam(true);
      } catch (err) {
        this.toast(err.message, 'bad');
        btn.disabled = false;
      }
    };
    el.addEventListener('click', (e) => {
      if (!e.target.closest('[data-cancel]')) return;
      this.editing = null;
      this.renderTeam(true);
    });
  }

  dirty() {
    const form = $('team').querySelector('form');
    if (!form) return false;
    const s = this.app.staff.find((x) => x.id === form.dataset.id) || {};
    return ['role', 'personality', 'background'].some((k) => form.elements[k].value.trim() !== (s[k] || ''));
  }

  // Live updates wait while a form has unsaved edits, so typing is never lost.
  renderTeam(force = false) {
    if ($('teamPane').hidden || (!force && this.dirty())) return;
    const { staff, progress, dismissed } = this.app;
    const cap = progress?.capacity || 0;
    $('team').innerHTML = staff.map((s, i) => {
      const status = i >= cap ? 'Not hired yet' : dismissed.has(s.id) ? 'Gone home' : '';
      const open = this.editing === s.id;
      const head = `<button type="button" class="head" data-member="${esc(s.id)}" aria-expanded="${open}">
          <i style="background:${esc(s.shirt)}"></i>
          <span class="n">${esc(s.name)}${status ? ` <em>${status}</em>` : ''}</span>
          <span class="r">${esc(s.role || 'No role yet')}</span>
        </button>`;
      if (!open) return `<div class="member${i >= cap ? ' later' : ''}">${head}${s.personality ? `<p class="p">${esc(s.personality)}</p>` : ''}</div>`;
      return `<div class="member open">${head}
        <form data-id="${esc(s.id)}">
          <label>Role<input name="role" maxlength="80" value="${esc(s.role)}" placeholder="Backend engineer" /></label>
          <label>Personality<textarea name="personality" rows="3" maxlength="600" placeholder="How they come across: calm, chatty, blunt, funny…">${esc(s.personality)}</textarea></label>
          <label>Background<textarea name="background" rows="3" maxlength="600" placeholder="Where they've worked, what they know best">${esc(s.background)}</textarea></label>
          <p class="hint-t">Shapes how ${esc(s.name)} writes and who the chief sends their way. It never lowers the bar on the work.</p>
          <div class="row"><button type="button" class="ghost small" data-cancel>Cancel</button><button type="submit" class="primary small">Save</button></div>
        </form>
      </div>`;
    }).join('');
  }

  // Who's gone home, each a click away from coming back.
  renderAway(staff) {
    const el = $('away');
    el.hidden = !staff.length;
    el.innerHTML = staff.length
      ? `<span>Gone home</span>${staff.map((s) => `<button type="button" data-recall="${esc(s.id)}" title="Call ${esc(s.name)} back"><i style="background:${esc(s.shirt)}"></i>${esc(s.name)}</button>`).join('')}`
      : '';
  }

  banner(title, sub) {
    const b = $('banner');
    b.innerHTML = `<b>${esc(title)}</b><span>${esc(sub)}</span>`;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }
}
