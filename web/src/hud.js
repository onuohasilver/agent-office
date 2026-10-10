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

    $('clear').onclick = async () => { await api('/api/jobs/clear', {}); this.closeDetail(); };
    $('jobs').onclick = (e) => {
      const btn = e.target.closest('[data-id]');
      if (btn) this.app.openJob(btn.dataset.id);
    };
    document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => this.tab(b.dataset.tab)));
    this.bindChat();
    addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
      if ((e.key === 'n' || e.key === '/') && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); this.focusInput(); }
      if (e.key === 'Escape' && !typing) this.closeDetail();
    });
    setInterval(() => this.tick(), 1000);
  }

  // ---------- top bar ----------

  renderLevel(p) {
    $('lv').textContent = `Level ${p.level}`;
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
      el.querySelector('.r').textContent = left === null ? '' : left <= 0 ? 'Resetting now' : `Resets ${resetsAt(m.resetsAt)} · in ${countdown(left)}`;
      el.querySelector('.r').title = m.resetsAt ? new Date(m.resetsAt).toLocaleString() : '';
    }
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
    if (this.usage) this.renderUsage();
  }

  // ---------- chat ----------

  tab(name) {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    $('chatPane').hidden = name !== 'chat';
    $('jobsPane').hidden = name !== 'jobs';
    if (name === 'chat') this.scrollChat(true);
  }

  focusInput(prefix = '') {
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
    $('msgs').onclick = (e) => {
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

  autosize() {
    const input = $('input');
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }

  async send() {
    const input = $('input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    this.autosize();
    $('ac').hidden = true;
    try {
      await api('/api/chat', { text, mode: $('mode').value, model: $('model').value });
    } catch (err) {
      input.value = text;
      this.toast(err.message, 'bad');
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
    $('msgs').innerHTML = messages.length
      ? messages.map((m) => this.message(m)).join('')
      : `<p class="empty">Tell the office what you need. Tag someone with @, or a project with #. The chief of staff hands everything else to whoever fits.</p>`;
    this.scrollChat(true);
  }

  addMessage(m) {
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

  message(m) {
    const who = this.app.person(m.from);
    const to = m.to && this.app.person(m.to);
    const time = new Date(m.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const body = m.from === 'you'
      ? `<p>${esc(m.text).replace(/(^|\s)([@#][\w.-]+)/g, '$1<span class="tag">$2</span>')}</p>`
      : rich(m.text);
    const long = m.from !== 'you' && m.from !== 'chief' && !m.to && m.text.length > 420;
    const extras = [
      long ? '<button type="button" class="link" data-more>Show all</button>' : '',
      m.jobId && m.from !== 'you' ? `<button type="button" class="link" data-open="${m.jobId}">Open job</button>` : '',
      m.denials?.length ? `<button type="button" class="primary small" data-grant="${m.jobId}">Grant full autonomy and continue</button>` : '',
    ].filter(Boolean).join('');
    return `
      <div class="msg from-${m.from === 'you' ? 'you' : m.from === 'chief' ? 'chief' : 'agent'} ${m.kind || ''} ${m.status || ''} ${long ? 'clamp' : ''}">
        <div class="who"><i style="background:${who.color}"></i><b>${esc(who.name)}</b>${to ? `<span class="arrow">→</span><i style="background:${to.color}"></i><b>${esc(to.name)}</b>` : ''}<time>${time}</time></div>
        ${m.kind === 'handoff' ? `<p class="kind">Handed off · ${esc(m.project || '')}</p>` : ''}
        <div class="body md">${body}</div>
        ${m.denials?.length ? `<p class="blocked">Blocked from using ${m.denials.map(esc).join(', ')}.</p>` : ''}
        ${extras ? `<div class="acts">${extras}</div>` : ''}
      </div>`;
  }

  chiefBusy(on) {
    $('typing').hidden = !on;
    if (on) this.scrollChat();
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
