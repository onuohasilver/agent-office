// Everything that lives in the DOM: the level bar, the job list, the
// job detail drawer and the new-job dialog.

import { Marked } from 'marked';

const $ = (id) => document.getElementById(id);
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

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export class Hud {
  constructor(app) {
    this.app = app;
    this.openId = null;
    this.repos = null;

    $('newJob').onclick = () => this.openDialog();
    $('cancel').onclick = () => $('dlg').close();
    $('clear').onclick = async () => { await api('/api/jobs/clear', {}); this.closeDetail(); };
    $('jobForm').onsubmit = (e) => this.submit(e);
    $('jobs').onclick = (e) => {
      const btn = e.target.closest('[data-id]');
      if (btn) this.app.openJob(btn.dataset.id);
    };
    addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
      if (e.key === 'n' && !typing && !e.metaKey && !e.ctrlKey && !$('dlg').open) { e.preventDefault(); this.openDialog(); }
      if (e.key === 'Escape' && !$('dlg').open) this.closeDetail();
    });
    setInterval(() => this.tick(), 1000);
  }

  // ---------- top bar ----------

  renderLevel(p) {
    $('lv').textContent = `Level ${p.level}`;
    $('xpbar').style.width = `${Math.min(100, ((p.xp - p.floor) / (p.next - p.floor)) * 100)}%`;
    $('xptext').textContent = `${p.xp - p.floor} / ${p.next - p.floor} XP`;
  }

  renderStats(jobs) {
    const count = (s) => jobs.filter((j) => j.status === s).length;
    const spent = jobs.reduce((a, j) => a + (j.cost || 0), 0);
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
      : `<p class="empty">The office is quiet. Hand someone a job.</p>`;
    $('clear').hidden = !list.some((j) => order[j.status] === 2);
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
    if (!meta) return;
    const end = job.status === 'working' || job.status === 'queued' ? Date.now() : job.endedAt || Date.now();
    const rows = [
      ['Project', job.repo],
      ['Agent', job.agentId ? this.app.staffName(job.agentId) : 'Unassigned'],
      ['Clearance', this.app.modes[job.mode] || job.mode],
      ['Time', job.startedAt ? duration(end - job.startedAt) : '—'],
      ['Cost', `$${(job.cost || 0).toFixed(3)}`],
      ['XP', job.xp ? `+${job.xp}` : '—'],
    ];
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
        <textarea name="message" rows="2" placeholder="Follow up with ${esc(this.app.staffName(job.agentId) || 'them')}…"></textarea>
        <div class="row">
          <select name="mode">${Object.entries(this.app.modes).map(([k, v]) => `<option value="${k}" ${k === job.mode ? 'selected' : ''}>${v}</option>`).join('')}</select>
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
      form.onsubmit = (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        act(() => api(`/api/jobs/${job.id}/reply`, { message: fd.get('message'), mode: fd.get('mode') }));
      };
      form.message.onkeydown = (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); };
    }
  }

  tick() {
    const job = this.openId && this.app.job(this.openId);
    if (job && (job.status === 'working' || job.status === 'queued')) this.renderMeta(job);
  }

  // ---------- dialog ----------

  async openDialog(prefill = {}) {
    const form = $('jobForm');
    $('formErr').textContent = '';
    form.repo.value = prefill.repo || store('office.repo') || '';
    form.prompt.value = '';
    const mode = store('office.mode');
    if (mode) form.querySelector(`input[name="mode"][value="${mode}"]`)?.click();
    $('dlg').showModal();
    (form.repo.value ? form.prompt : form.repo).focus();
    if (!this.repos) {
      try {
        this.repos = (await api('/api/repos')).repos;
        $('repos').innerHTML = this.repos.map((r) => `<option value="${esc(r)}"></option>`).join('');
      } catch (err) { $('formErr').textContent = err.message; }
    }
  }

  async submit(e) {
    e.preventDefault();
    const fd = new FormData(e.target);
    const body = Object.fromEntries(fd.entries());
    if (this.repos && !this.repos.includes(body.repo)) { $('formErr').textContent = 'Pick a project from the list.'; return; }
    try {
      const job = await api('/api/jobs', body);
      store('office.repo', body.repo);
      store('office.mode', body.mode);
      $('dlg').close();
      this.toast('Handed over. Someone will pick it up.');
      this.app.openJob(job.id);
    } catch (err) {
      $('formErr').textContent = err.message;
    }
  }

  // ---------- moments ----------

  toast(text, kind = '') {
    const t = $('toast');
    t.textContent = text;
    t.className = `toast show ${kind}`;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => (t.className = 'toast'), 3200);
  }

  banner(title, sub) {
    const b = $('banner');
    b.innerHTML = `<b>${esc(title)}</b><span>${esc(sub)}</span>`;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
  }
}
