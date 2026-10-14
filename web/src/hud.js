// Everything that lives in the DOM: the level bar, the job list, the
// job detail drawer and the new-job dialog.

import { Marked } from 'marked';
import { recorder, voiceFile, speech } from './voice.js';
import { LOOKS } from './figure.js';
import { allowRepos, jobPath, replyBody, visitJob, visiting } from './links.js';
import { PAY, modelPay, naira } from '../../shared/shop.js';

import { openJourneys } from './journeys.js';
import { openFiles } from './files.js';

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
// A visited host's jobs reach this page too, so a value that lands in markup
// as a class or a number is held to the ones we know.
const known = (map, k) => (typeof k === 'string' && Object.hasOwn(map, k) ? k : '');
const statusText = (s) => STATUS[known(STATUS, s)] || '';
// Briefs the chief writes open with "The boss says: "…"", which buries the ask
// under the same words on every row; the list shows the quote, the tooltip the lot.
const askOf = (t) => {
  const q = /^the boss (?:says|asks|wants)\s*[:,]?\s*["“](.+?)(?:["”]|$)[\s.,:;]*(.*)/is.exec(String(t || ''));
  // A one-word ask ("restart") says too little alone, so it keeps the brief after it.
  const s = (q ? (q[1].length < 24 && q[2] ? `${q[1].replace(/[.!]$/, '')}: ${q[2]}` : q[1]) : String(t || '')).trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const since = (ms) => {
  if (!ms) return '';
  const m = Math.max(0, Math.round((Date.now() - ms) / 60000));
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
};
const num = (n) => (Number.isFinite(n) ? n : 0);
// Colours go into style attributes, so only a hex colour gets through.
const hex = (c) => (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : '#999');

// A project shows its own app icon or favicon when the server finds one
// (/api/repos/icon); until then, or when it has none, a tinted initial.
// Image load and error events stop at document; they never reach window.
const iconSeen = new Map(); // project -> true | false once the browser has tried it
const projectIcon = (name) => {
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const initial = (String(name).match(/[a-z0-9]/i) || ['#'])[0].toUpperCase();
  const seen = iconSeen.get(name);
  const img = seen === false ? '' : `<img src="/api/repos/icon?name=${encodeURIComponent(name)}" alt="" data-pico="${esc(name)}" draggable="false">`;
  return `<span class="pico${seen ? ' has' : ''}" style="--h:${h}" aria-hidden="true">${esc(initial)}${img}</span>`;
};
document.addEventListener('load', (e) => {
  const img = e.target;
  if (!img?.dataset?.pico) return;
  iconSeen.set(img.dataset.pico, true);
  img.parentElement.classList.add('has');
}, true);
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!img?.dataset?.pico) return;
  iconSeen.set(img.dataset.pico, false);
  img.remove();
}, true);

// Each person's face, drawn from the same skin, hair and shirt the office
// figure wears, so the portrait is recognisably them.
export const portrait = (s) => {
  const look = LOOKS[s.id] || {};
  const skin = hex(s.skin), hair = hex(s.hair), shirt = hex(s.shirt);
  const style = look.hair || 'short';
  const back = {
    afro: `<circle cx="24" cy="18" r="13.5" fill="${hair}"/>`,
    bob: `<path d="M10 40V19a14 14 0 0 1 28 0v21z" fill="${hair}"/>`,
    long: `<path d="M9 44V19a15 15 0 0 1 30 0v25z" fill="${hair}"/>`,
    ponytail: `<path d="M33 14c8 1 10 9 6 19-1-6-3-9-6-10z" fill="${hair}"/>`,
    bun: `<circle cx="24" cy="6.5" r="4.5" fill="${hair}"/>`,
  }[style] || '';
  const front = {
    afro: `<path d="M15 17a9 9 0 0 1 18 0c-3-3-6-4-9-4s-6 1-9 4z" fill="${hair}"/>`,
    short: `<path d="M15 18a9 9 0 0 1 18 0c-4-1-6-3-9-5-2 3-5 4-9 5z" fill="${hair}"/>`,
    buzz: `<path d="M15.2 17.5a8.8 8.8 0 0 1 17.6 0c-5-2-12.6-2-17.6 0z" fill="${hair}"/>`,
    spiky: `<path d="M15 18l1-7 3 4 2-7 3 6 3-6 2 7 3-4 1 7c-4-2-6-3-9-3s-5 1-9 3z" fill="${hair}"/>`,
    bob: `<path d="M15 19a9 9 0 0 1 18 0c-5 0-9-2-11-5-1 3-3 5-7 5z" fill="${hair}"/>`,
    long: `<path d="M15 19a9 9 0 0 1 18 0c-5 0-9-2-11-5-1 3-3 5-7 5z" fill="${hair}"/>`,
    ponytail: `<path d="M15 18a9 9 0 0 1 18 0c-4-1-7-3-9-5-2 3-5 4-9 5z" fill="${hair}"/>`,
    bun: `<path d="M15 18a9 9 0 0 1 18 0c-4-1-7-3-9-5-2 3-5 4-9 5z" fill="${hair}"/>`,
  }[style] || '';
  const extra = look.extra === 'glasses'
    ? '<g fill="none" stroke="#2b2b2b" stroke-width="1.2"><circle cx="20.5" cy="22" r="3"/><circle cx="27.5" cy="22" r="3"/><path d="M23.5 22h1"/></g>'
    : look.extra === 'headphones'
      ? '<path d="M14.5 22v-4a9.5 9.5 0 0 1 19 0v4" fill="none" stroke="#2b2b2b" stroke-width="2"/><rect x="12.5" y="20" width="4" height="7" rx="2" fill="#2b2b2b"/><rect x="31.5" y="20" width="4" height="7" rx="2" fill="#2b2b2b"/>'
      : '';
  return `<svg class="face" viewBox="0 0 48 48" aria-hidden="true" style="background:${shirt}33">
    ${back}
    <path d="M6 48c1-9 8-13 18-13s17 4 18 13z" fill="${shirt}"/>
    <rect x="20.5" y="27" width="7" height="9" rx="3" fill="${skin}"/>
    <ellipse cx="24" cy="22" rx="9" ry="10" fill="${skin}"/>
    ${front}
    <circle cx="20.5" cy="22.5" r="1.2" fill="#2b2118"/><circle cx="27.5" cy="22.5" r="1.2" fill="#2b2118"/>
    <path d="M21.5 27.5q2.5 2 5 0" fill="none" stroke="#2b2118" stroke-width="1.1" stroke-linecap="round" opacity=".7"/>
    ${extra}
  </svg>`;
};

// A sender's avatar: their portrait, or a plain silhouette for the boss.
const avatar = (p, cls = '') => `<span class="av ${cls}">${p.look
  ? portrait(p.look)
  : '<svg class="face" viewBox="0 0 48 48" aria-hidden="true" style="background:#c9c1b455"><path d="M6 48c1-9 8-13 18-13s17 4 18 13z" fill="#a39a8a"/><ellipse cx="24" cy="21" rx="9" ry="10" fill="#a39a8a"/></svg>'}</span>`;

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
// A coin amount, with the little gold coin the shop uses.
const coinsOf = (v, cls = '') => `<span class="coins ${cls}">${naira(num(v))}</span>`;
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
    window.addEventListener('focus', () => this.syncRepos());
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.syncRepos(); });
    this.channels = [{ id: 'general', name: 'general' }];
    this.channel = store('office.channel') || 'general';
    this.unread = new Map();

    $('clear').onclick = async () => { await api('/api/jobs/clear', {}); this.closeDetail(); };
    $('away').onclick = (e) => {
      const b = e.target.closest('[data-recall]');
      if (b) this.app.recall(b.dataset.recall);
    };
    $('attn').onclick = (e) => {
      const b = e.target.closest('[data-attn]');
      if (b) this.jumpTo(b.dataset.attn);
    };
    $('jobs').onclick = (e) => {
      const btn = e.target.closest('[data-id]');
      if (btn) this.app.openJob(btn.dataset.id);
    };
    $('projects').onclick = (e) => {
      const job = e.target.closest('.job[data-id]');
      if (job) return this.app.openJob(job.dataset.id);
      const map = e.target.closest('[data-journeys]');
      if (map) {
        // On a phone the map takes the office's half; closing it comes back here.
        this.mobile('office');
        return openJourneys(map.dataset.journeys, () => { if ($('app').dataset.m === 'office' && matchMedia('(max-width: 860px)').matches) this.tab('projects'); });
      }
      const edit = e.target.closest('[data-files]');
      if (edit) {
        this.mobile('office');
        return openFiles(edit.dataset.files, () => { if ($('app').dataset.m === 'office' && matchMedia('(max-width: 860px)').matches) this.tab('projects'); });
      }
      const add = e.target.closest('[data-new]');
      if (add) return this.focusInput(`#${add.dataset.new.replace(/\s+/g, '-')} `);
      const head = e.target.closest('[data-project]');
      if (head) {
        this.projectOpen = this.projectOpen === head.dataset.project ? null : head.dataset.project;
        this.renderProjects();
      }
    };
    document.querySelectorAll('.tabs button').forEach((b) => (b.onclick = () => this.tab(b.dataset.tab)));
    document.querySelectorAll('#mnav button').forEach((b) => (b.onclick = () => {
      if (b.dataset.m === 'office') this.mobile('office');
      else this.tab(b.dataset.m);
    }));
    this.bindViewToggle();
    this.bindTeam();
    this.bindChat();
    this.bindChannels();
    this.bindFold();
    this.renderChannels();
    addEventListener('keydown', (e) => {
      const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
      if ((e.key === 'n' || e.key === '/') && !typing && !e.metaKey && !e.ctrlKey) { e.preventDefault(); this.focusInput(); }
      if (e.key === 'Escape' && !typing) this.closeDetail();
    });
    setInterval(() => this.tick(), 1000);
  }

  // ---------- top bar ----------

  renderOwner(name) {
    name = String(name || '').trim();
    const title = name ? `${name}${/s$/i.test(name) ? '’' : '’s'} Office` : 'Your Office';
    $('officeName').textContent = title;
    document.title = title;
  }

  bindFold() {
    const btn = $('fold'), box = $('gaugesBox');
    const set = (open) => {
      box.hidden = !open;
      btn.setAttribute('aria-expanded', String(open));
      const t = open ? 'Hide usage' : 'Show usage';
      btn.setAttribute('aria-label', t); btn.title = t;
      try { localStorage.setItem('office.gauges', open ? '1' : '0'); } catch {}
    };
    let open = false;
    try { open = localStorage.getItem('office.gauges') === '1'; } catch {}
    set(open);
    btn.addEventListener('click', () => set(box.hidden));
    $('officeName').addEventListener('click', () => set(box.hidden));
  }

  renderLevel(p) {
    const into = `${p.xp - p.floor} / ${p.next - p.floor} XP`;
    $('lvNum').textContent = p.level;
    $('lv').title = `Level ${p.level} · ${into}`;
    $('lv').setAttribute('aria-label', `Level ${p.level}, ${into}`);
    $('lv').style.setProperty('--p', Math.min(100, ((p.xp - p.floor) / (p.next - p.floor)) * 100));
    $('xptext').textContent = into;
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
      el.style.setProperty('--p', Math.min(100, m.pct));
      el.querySelector('.v').textContent = `${m.pct}%`;
      el.querySelector('.r').textContent = left === null ? '' : left <= 0 ? 'Resetting now' : `Resets in ${countdown(left)}`;
      el.title = [m.resetsAt ? `Resets ${resetsAt(m.resetsAt)}` : '', el.querySelector('.r').textContent].filter(Boolean).join(' · ');
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
    el.style.setProperty('--p', Math.min(100, share));
    el.querySelector('.v').textContent = value;
    el.querySelector('.r').textContent = note;
    el.title = `${title} · ${note}`;
  }

  renderStats(jobs, extra = 0) {
    const count = (s) => jobs.filter((j) => j.status === s && !j.awaitingBoss).length;
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
    const row = (j) => `
        <button class="job ${j.id === this.openId ? 'open' : ''}" data-id="${esc(j.id)}">
          <span class="dot ${known(STATUS, j.status)}"></span>
          <span class="t" title="${esc(j.title)}">${esc(askOf(j.title))}</span>
          <time class="w">${order[j.status] < 2 ? '' : since(j.endedAt || j.queuedAt)}</time>
          <span class="m">${j.from ? `<b class="from">from ${esc(j.from)}</b> · ` : ''}${projectIcon(j.repo)}<span class="r">${esc(j.repo)}</span>${j.agentId ? ' · ' + esc(staffName(j.agentId)) : j.visitor ? ' · ' + esc(j.visitor.name) : ''}${j.status === 'done' ? '' : ` · <span class="s ${known(STATUS, j.status)}">${statusText(j.status)}</span>`}</span>
        </button>`;
    const live = list.filter((j) => order[j.status] < 2);
    const past = list.filter((j) => order[j.status] === 2);
    const group = (label, js) => (js.length ? `<h3 class="jgroup">${label}<span>${js.length}</span></h3>${js.map(row).join('')}` : '');
    $('jobs').innerHTML = list.length
      ? group('In progress', live) + group('Finished', past)
      : `<p class="empty">No jobs yet. Ask for something in the chat.</p>`;
    $('clear').hidden = !list.some((j) => order[j.status] === 2);
    const open = list.filter((j) => order[j.status] < 2).length;
    $('jobCount').textContent = open ? String(open) : '';
    $('mJobCount').textContent = open ? String(open) : '';
    this.renderProjects(jobs);
  }

  // Projects and Team share one list/icons choice, remembered per browser.
  bindViewToggle() {
    this.view = store('office.view') === 'icons' ? 'icons' : 'list';
    const paint = () => {
      document.querySelectorAll('.viewbar [data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === this.view)));
      $('team').classList.toggle('icons', this.view === 'icons');
      $('projects').classList.toggle('icons', this.view === 'icons');
    };
    document.querySelectorAll('.viewbar').forEach((bar) => bar.addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (!b || b.dataset.view === this.view) return;
      if (this.dirty() && !confirm('Discard your changes?')) return;
      this.view = b.dataset.view;
      store('office.view', this.view);
      paint();
      this.renderProjects();
      this.renderTeam(true);
    }));
    paint();
  }

  // ---------- projects ----------

  // The folder list is fetched when the tab opens, so a new project shows up
  // without a reload; the jobs half is live and redraws with every job update.
  async loadProjects() {
    try { this.repos = allowRepos((await api('/api/repos')).repos); } catch { this.repos ||= []; }
    this.renderProjects();
  }

  // A project created while the office is open (an agent scaffolding a new
  // repo) joins the list by itself: re-read the folders when the page comes
  // back, when a job turns up in a project we don't know, and every so often.
  syncRepos() {
    const now = Date.now();
    if (this.repos && now - (this.reposAt || 0) < 3000) return;
    this.reposAt = now;
    api('/api/repos').then((r) => {
      const next = allowRepos(r.repos);
      if (this.repos && next.join('\n') === this.repos.join('\n')) return;
      this.repos = next;
      this.renderProjects();
    }).catch(() => {});
  }

  renderProjects(jobs = this.lastJobs || []) {
    this.lastJobs = jobs;
    if ($('projectsPane').hidden) return;
    if (!this.repos) {
      $('projects').innerHTML = `<p class="empty">Looking for projects…</p>`;
      return;
    }
    const by = new Map();
    for (const j of jobs) (by.get(j.repo) || by.set(j.repo, []).get(j.repo)).push(j);
    // `web@host` is a host's project, never on this machine's list.
    if ([...by.keys()].some((name) => !name.includes('@') && !this.repos.includes(name))) this.syncRepos();
    const at = (j) => j.endedAt || j.startedAt || j.queuedAt || 0;
    const rows = [...by].filter(([name]) => this.repos.includes(name)).map(([name, js]) => {
      js.sort((a, b) => at(b) - at(a));
      const live = js.filter((j) => j.status === 'working').length;
      const queued = js.filter((j) => j.status === 'queued').length;
      const state = live ? 'working' : queued ? 'queued' : js[0].status === 'failed' ? 'failed' : 'done';
      const note = live ? esc(this.app.busyIn(name)) : queued ? `${queued} queued` : `Last: ${esc(js[0].title)}`;
      return { name, js, live, queued, state, note, last: at(js[0]) };
    }).sort((a, b) => (!!b.live - !!a.live) || b.last - a.last).slice(0, 8);
    if (!rows.length) {
      $('projects').innerHTML = `<p class="empty">No projects worked on yet. Ask for something in the chat.</p>`;
      return;
    }
    const sub = (p) => `<div class="sub">${visiting.on ? '' : `<button type="button" class="map" data-journeys="${esc(p.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="9" width="6" height="6" rx="1.5"/><rect x="15" y="4" width="6" height="6" rx="1.5"/><rect x="15" y="14" width="6" height="6" rx="1.5"/><path d="M9 12c3 0 3-5 6-5M9 12c3 0 3 5 6 5"/></svg><span>User journeys</span><span class="go" aria-hidden="true">→</span></button><button type="button" class="map" data-files="${esc(p.name)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path d="M13.5 6.5l4 4"/></svg><span>Edit files</span><span class="go" aria-hidden="true">→</span></button>`}${p.js.length ? p.js.slice(0, 8).map((j) => `
          <button class="job" data-id="${esc(j.id)}"><span class="dot ${known(STATUS, j.status)}"></span><span class="t" title="${esc(j.title)}">${esc(askOf(j.title))}</span>
            <span class="m">${j.agentId ? esc(this.app.staffName(j.agentId)) + ' · ' : ''}${statusText(j.status)}</span></button>`).join('')
      : `<p class="none">Nothing has run here yet.</p>`}
          <button type="button" class="ghost" data-new="${esc(p.name)}"><span aria-hidden="true">+</span> New job in ${esc(p.name)}</button></div>`;
    const count = (p) => (p.js.length ? `${p.js.length} job${p.js.length === 1 ? '' : 's'}` : '');
    if (this.view === 'icons') {
      const openP = rows.find((p) => p.name === this.projectOpen);
      $('projects').innerHTML = `<div class="tiles">${rows.map((p) => `
        <button type="button" class="tile${p.name === this.projectOpen ? ' open' : ''}" data-project="${esc(p.name)}" aria-expanded="${p.name === this.projectOpen}" title="${esc(p.name)}${count(p) ? ` · ${count(p)}` : ''}">
          <span class="art">${projectIcon(p.name)}<span class="dot ${p.state}"></span></span>
          <span class="n">${esc(p.name)}</span>
          <span class="c">${count(p) || 'No jobs'}</span>
        </button>`).join('')}</div>${openP ? `<div class="project open">${openP.live || openP.queued ? `<p class="note">${openP.note}</p>` : ''}${sub(openP)}</div>` : ''}`;
      return;
    }
    $('projects').innerHTML = rows.map((p) => {
      const open = this.projectOpen === p.name;
      return `<div class="project${open ? ' open' : ''}">
        <button type="button" class="head" data-project="${esc(p.name)}" aria-expanded="${open}">
          <span class="dot ${p.state}"></span>
          <span class="n">${esc(p.name)}</span>
          <span class="c">${count(p)}</span>
          <span class="m">${p.note}</span>
        </button>
        ${open ? sub(p) : ''}
      </div>`;
    }).join('');
  }

  // ---------- detail drawer ----------

  async openDetail(id) {
    this.openId = id;
    let job = await api(jobPath(id));
    if (this.openId !== id) return;
    if (visiting.on) job = job.job;
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
        <span class="pill ${known(STATUS, job.status)}">${statusText(job.status)}</span>
        <button class="x" title="Close (Esc)">×</button>
      </div>
      <h2>${esc(job.title)}</h2>
      <div class="meta-wrap" id="metaWrap">
        <button type="button" class="meta-fold" id="metaFold" aria-controls="meta"><span class="chev" aria-hidden="true">▾</span> Details <span class="meta-sum" id="metaSum"></span></button>
        <dl class="meta" id="meta"></dl>
      </div>
      <div id="changes"></div>
      <div class="log" id="log">${job.log.map((e, i) => this.entry(e, null, job.log[i - 1])).join('')}</div>
      <div class="d-foot">${this.footer(job)}</div>`;
    el.querySelector('.x').onclick = () => this.closeDetail();
    const fold = (open) => {
      $('metaWrap').classList.toggle('shut', !open);
      $('metaFold').setAttribute('aria-expanded', String(open));
    };
    let open = false;
    try { open = localStorage.getItem('office.meta') === '1'; } catch {}
    fold(open);
    $('metaFold').onclick = () => {
      open = !open;
      fold(open);
      try { localStorage.setItem('office.meta', open ? '1' : '0'); } catch {}
    };
    this.renderMeta(job);
    this.renderChanges(job);
    this.renderKudos();
    const log = $('log');
    log.scrollTop = log.scrollHeight;
    this.bindFooter(job);
  }

  // "What changed": a one-line summary by default, the file list on a click,
  // and a file's patch only when asked for. Open state survives re-renders.
  renderChanges(job) {
    const box = $('changes');
    const c = job.changes;
    if (!box) return;
    if (!c || !c.count) {
      box.innerHTML = c ? `<div class="changes none">No files changed.</div>` : '';
      return;
    }
    const open = this.changesOpen === job.id;
    const status = { added: 'A', modified: 'M', deleted: 'D' };
    const editable = !visiting.on && !job.visitor && !job.away;
    box.innerHTML = `
      <div class="changes">
        <button class="c-head" aria-expanded="${open}">
          <span class="c-title">What changed</span>
          <span class="c-sum">${num(c.count)} file${c.count === 1 ? '' : 's'} <b class="add">+${num(c.add)}</b> <b class="del">−${num(c.del)}</b></span>
          <span class="c-caret">${open ? '▾' : '▸'}</span>
        </button>
        ${open ? `<ul class="c-files">${c.files.map((f, i) => `
          <li class="c-li"><button class="c-file" data-i="${i}" aria-expanded="false">
            <span class="st ${known(status, f.status)}">${status[known(status, f.status)] || ''}</span><span class="p" title="${esc(f.path)}">${esc(f.path)}</span>
            <span class="n">${f.binary ? 'binary' : `<b class="add">+${num(f.add)}</b> <b class="del">−${num(f.del)}</b>`}</span>
          </button>${editable && f.status !== 'deleted' && !f.binary ? `<button class="c-open" data-path="${esc(f.path)}" title="Open in the editor" aria-label="Edit ${esc(f.path)}">Edit</button>` : ''}</li>`).join('')}${c.count > c.files.length ? `<li class="more">and ${num(c.count - c.files.length)} more</li>` : ''}</ul>` : ''}
      </div>`;
    box.querySelector('.c-head').onclick = () => {
      this.changesOpen = open ? null : job.id;
      this.renderChanges(job);
    };
    box.querySelectorAll('.c-open').forEach((b) => (b.onclick = () => {
      this.mobile('office');
      openFiles(job.repo, () => { if ($('app').dataset.m === 'office' && matchMedia('(max-width: 860px)').matches) this.tab('projects'); }, b.dataset.path);
    }));
    box.querySelectorAll('.c-file').forEach((b) => (b.onclick = async () => {
      const li = b.parentElement;
      const shown = li.querySelector('pre');
      if (shown) { shown.remove(); b.setAttribute('aria-expanded', 'false'); return; }
      b.setAttribute('aria-expanded', 'true');
      const pre = document.createElement('pre');
      pre.className = 'c-diff';
      pre.textContent = 'Loading…';
      li.append(pre);
      try {
        const { diff } = await api(jobPath(job.id, `/diff?path=${encodeURIComponent(c.files[b.dataset.i].path)}`));
        pre.innerHTML = diff.split('\n').filter((l) => !/^(diff --git|index |--- |\+\+\+ )/.test(l))
          .map((l) => `<span class="${l[0] === '+' ? 'add' : l[0] === '-' ? 'del' : l[0] === '@' ? 'hunk' : ''}">${esc(l) || ' '}</span>`).join('\n') || 'No textual changes.';
      } catch (err) { pre.textContent = err.message; }
    }));
  }

  renderMeta(job) {
    const meta = $('meta');
    if (!meta || !job) return;
    // The model picker lives in here; a refresh must not close it under a click.
    if (meta.contains(document.activeElement) && document.activeElement.tagName === 'SELECT') return;
    const end = job.status === 'working' || job.status === 'queued' ? Date.now() : job.endedAt || Date.now();
    // A guest's own agent: it runs on their machine and account, so no model, cost or XP here.
    if (job.visitor) {
      meta.innerHTML = [
        ['Project', `${job.repo} (a copy)`],
        ['From', job.from],
        ['Agent', [job.visitor.name, job.visitor.role].filter(Boolean).join(' · ')],
        ['Access', job.access === 'edit' ? 'Edit a copy' : 'Read only'],
        ['Time', job.startedAt ? duration(end - job.startedAt) : '—'],
      ].map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('');
      return;
    }
    const rows = [
      ['Project', job.repo],
      ...(job.from && !visiting.on ? [['From', `${job.from} (guest)`]] : []),
      ...(job.remote ? [['Office', `@${job.remote.host}`]] : []),
      ['Agent', job.agentId ? this.app.staffName(job.agentId) : 'Unassigned'],
      ['Clearance', this.app.modes[job.mode] || job.mode],
      ['Model', this.modelPicker(job)],
      ['Context', job.context ? `${(job.context / 1000).toFixed(1)}k tokens` : '—'],
      ['Time', job.startedAt ? duration(end - job.startedAt) : '—'],
      ['Cost', `$${(job.cost || 0).toFixed(3)}`],
      ['XP', job.xp ? `+${job.xp}` : '—'],
      ...(job.earned ? [['Pay', naira(job.earned)]] : []),
    ];
    // Live machine cost, only while this job's process is actually up.
    const p = this.procs?.[job.id];
    if (p) {
      rows.push(['CPU', p.cpu === null ? 'measuring…' : `${Math.round(p.cpu)}%`]);
      rows.push(['Memory', bytes(p.mem)]);
      rows.push(['Processes', String(p.procs)]);
    }
    const sum = $('metaSum');
    if (sum) sum.textContent = [modelLabel(job.model), `$${(job.cost || 0).toFixed(2)}`, job.startedAt ? duration(end - job.startedAt) : ''].filter(Boolean).join(' · ');
    meta.innerHTML = rows.map(([k, v]) => (v && v.html ? `<div><dt>${k}</dt><dd>${v.html}</dd></div>` : `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`)).join('');
    meta.onchange = (e) => {
      if (e.target.name !== 'model') return;
      const pick = e.target.value;
      e.target.disabled = true;
      api(jobPath(job.id, '/model'), { model: pick })
        .then(() => this.toast(job.status === 'working' ? 'Switching after this turn' : 'Model changed', 'good'))
        .catch((err) => this.toast(err.message, 'bad'))
        .finally(() => this.renderMeta(this.app.job(job.id)));
    };
  }

  // The same models as the composer's picker, minus "Chief picks": the boss is
  // choosing now. A guest's job isn't ours to switch.
  modelPicker(job) {
    const note = [job.autoModel && 'chief’s pick', job.escalations ? `moved up ${job.escalations}×` : ''].filter(Boolean).join(' · ');
    if (job.guest || job.away) return [modelLabel(job.model), note].filter(Boolean).join(' · ');
    const src = $('model');
    const opt = (o) => `<option value="${esc(o.value)}"${o.value === job.model ? ' selected' : ''}>${esc(o.textContent)}</option>`;
    const groups = [...(src?.querySelectorAll('optgroup') || [])]
      .map((g) => `<optgroup label="${esc(g.label)}">${[...g.querySelectorAll('option')].map(opt).join('')}</optgroup>`).join('');
    // A family alias ("sonnet") is what the chief sizes jobs to; it isn't in the list.
    const known = [...(src?.options || [])].some((o) => o.value === job.model);
    const current = known || !job.model ? '' : `<option value="${esc(job.model)}" selected>${esc(modelLabel(job.model))}</option>`;
    return { html: `<select name="model" class="model-pick" aria-label="Model for this job">${current}${groups}</select>${note ? `<small class="model-note">${esc(note)}</small>` : ''}` };
  }

  // The final answer usually repeats the last message; show it once.
  entry(e, lastEl, prev) {
    const echo = e.kind === 'result' && (prev ? prev.kind === 'text' && prev.summary === e.summary : lastEl?.dataset.text === e.summary);
    switch (e.kind) {
      case 'user': return `<div class="e user"><span class="who">You</span><p>${esc(e.summary)}</p></div>`;
      case 'system': return `<div class="e sys">${esc(e.summary)}</div>`;
      case 'thinking': return `<div class="e sys">thinking…</div>`;
      case 'tool': return `<div class="e tool"><span class="st ${known(STATION, e.station)}" title="${STATION[known(STATION, e.station)] || ''}"></span>${esc(e.summary)}</div>`;
      case 'text': return `<div class="e text md" data-text="${esc(e.summary)}">${rich(e.summary)}</div>`;
      case 'error': return `<div class="e err">${esc(e.summary)}</div>`;
      case 'result': return `<div class="e result ${e.ok ? 'ok' : 'bad'}"><span class="who">${e.ok ? 'Result' : 'Ended early'}${num(e.ms) ? ` · ${duration(e.ms)}` : ''}${num(e.cost) ? ` · $${e.cost.toFixed(3)}` : ''}</span>${echo ? '' : `<div class="md">${rich(e.summary)}</div>`}</div>`;
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

  // A guest's agent's work: Stop while it runs, then Apply or Discard. They
  // can't be replied to here; the guest follows up from their own office.
  visitFooter(job) {
    const who = `${esc(job.visitor.name)} from ${esc(job.from)}`;
    if (job.status === 'working') return `<button class="ghost danger" data-act="stop">Stop work</button>`;
    const when = (t) => new Date(t).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    if (job.applied) return `<div class="notice visit-review"><span class="done">Applied to ${esc(job.repo)} ${esc(when(job.applied))}.</span></div>`;
    if (job.discarded) return `<div class="notice visit-review"><span class="done">Thrown away ${esc(when(job.discarded))}. Nothing reached ${esc(job.repo)}.</span></div>`;
    if (!job.changes?.count) return `<div class="notice visit-review"><span class="done">${job.access === 'edit' ? 'No files changed, so there’s nothing to apply.' : `Read only: ${who} couldn’t change anything.`}</span></div>`;
    const err = this.applyError?.id === job.id ? `<span class="bad" role="alert">${esc(this.applyError.text)}</span>` : '';
    return `<div class="notice visit-review">
        <span>${who} changed ${num(job.changes.count)} file${job.changes.count === 1 ? '' : 's'} in a copy. Review them above; nothing reaches ${esc(job.repo)} until you apply.</span>
        ${err}
        <div class="link-row">
          <button class="primary small" data-act="apply">Apply to ${esc(job.repo)}</button>
          <button class="ghost small danger" data-act="discard">Discard</button>
        </div>
      </div>`;
  }

  footer(job) {
    if (job.visitor) return this.visitFooter(job);
    if (job.status === 'working') return `<button class="ghost danger" data-act="stop">Stop work</button>`;
    if (job.status === 'queued') return `<button class="ghost danger" data-act="stop">Pull from queue</button>`;
    const blocked = job.denials?.length
      ? `<div class="notice">Blocked from using <b>${job.denials.map(esc).join(', ')}</b>.
           <button class="primary small" data-act="grant">Grant full autonomy and continue</button></div>`
      : '';
    const plan = job.mode === 'plan' && job.status === 'done'
      ? `<div class="notice">That's the plan. <button class="primary small" data-act="approve">Approve and build it</button></div>`
      : '';
    return `${blocked}${plan}<div id="kudosSlot"></div>
      <form class="reply" data-act="reply">
        <div class="tray" hidden></div>
        <textarea name="message" rows="2" placeholder="Follow up with ${esc(this.app.staffName(job.agentId) || 'them')}…"></textarea>
        <div class="row">
          <select name="mode">${Object.entries(this.app.modes).map(([k, v]) => `<option value="${esc(k)}" ${k === job.mode ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select>
          <button type="button" class="attach" title="Attach files or images" aria-label="Attach files">
            <svg viewBox="0 0 24 24"><path d="M21 11.5l-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/></svg>
          </button>
          <input type="file" multiple hidden />
          <button class="primary small" type="submit">Send</button>
        </div>
      </form>`;
  }

  // The boss's "great work" on a finished job: pays its finish bonus again,
  // once. Redrawn on its own when the books change, so the reply box keeps
  // whatever is being typed.
  renderKudos() {
    const slot = $('kudosSlot');
    const job = this.openId && this.app.job(this.openId);
    if (!slot || !job) return;
    const econ = this.app.economy;
    const ok = econ && job.status === 'done' && !job.awaitingBoss && !job.guest && !job.visitor && job.agentId && !visiting.on;
    if (!ok) { slot.innerHTML = ''; return; }
    const who = esc(this.app.staffName(job.agentId) || 'them');
    const given = econ.kudos?.includes(job.id);
    const bonus = Math.round(PAY.finishBonus * modelPay(job.model));
    const paid = job.earned ? `${who} earned ${coinsOf(job.earned)} for this.` : '';
    slot.className = `notice kudos${given ? ' given' : ''}`;
    slot.innerHTML = given
      ? `<span>${paid} You gave kudos. 👏</span>`
      : `<span>${paid || `Happy with ${who}’s work?`}</span><button type="button" class="ghost small" data-act="kudos">👏 Kudos <span class="kudos-amt">+${naira(bonus)}</span></button>`;
    const b = slot.querySelector('[data-act="kudos"]');
    if (b) b.onclick = async () => {
      b.disabled = true;
      try {
        this.app.setEconomy?.(await api('/api/economy/kudos', { jobId: job.id }));
      } catch (err) {
        this.toast(err.message, 'bad');
        b.disabled = false;
      }
    };
  }

  bindFooter(job) {
    const foot = $('detail').querySelector('.d-foot');
    const act = async (fn) => {
      try { await fn(); } catch (err) { this.toast(err.message, 'bad'); }
    };
    foot.querySelectorAll('[data-act="apply"]').forEach((b) => (b.onclick = async () => {
      b.disabled = true;
      b.textContent = 'Applying…';
      this.applyError = null;
      try {
        await api(jobPath(job.id, '/apply'), {});
        this.toast(`Applied to ${job.repo}`, 'good');
      } catch (err) {
        // A 409 says, in plain words, why the changes no longer fit.
        this.applyError = { id: job.id, text: err.message };
      }
      if (this.openId === job.id) this.renderDetail();
    }));
    foot.querySelectorAll('[data-act="discard"]').forEach((b) => (b.onclick = () => {
      if (!confirm(`Throw away ${job.visitor.name}’s changes? Nothing reaches ${job.repo}, and they can’t be got back.`)) return;
      this.applyError = null;
      act(() => api(jobPath(job.id, '/discard'), {}));
    }));
    foot.querySelectorAll('[data-act="stop"]').forEach((b) => (b.onclick = () => act(() => api(jobPath(job.id, '/stop'), {}))));
    foot.querySelectorAll('[data-act="grant"]').forEach((b) => (b.onclick = () => act(() => api(jobPath(job.id, '/reply'),
      replyBody('You now have permission to run the commands that were blocked. Carry on from where you stopped.', 'auto')))));
    foot.querySelectorAll('[data-act="approve"]').forEach((b) => (b.onclick = () => act(() => api(jobPath(job.id, '/reply'), replyBody('Approved. Go ahead and implement the plan.', 'edit')))));
    const form = foot.querySelector('form.reply');
    if (form) {
      const tray = new Tray(form.querySelector('.tray'), (m) => this.toast(m, 'bad'));
      bindFiles(tray, { zone: form, input: form.message, picker: form.querySelector('input[type=file]'), button: form.querySelector('.attach') });
      form.onsubmit = (e) => {
        e.preventDefault();
        const fd = new FormData(form);
        act(async () => {
          const files = await tray.ids();
          await api(jobPath(job.id, '/reply'), replyBody(fd.get('message'), fd.get('mode'), files));
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
    // While visiting, links.js words it as starting a job at the host.
    if (!visiting.on) $('input').placeholder = `Message #${this.channel} · @agent #project`;
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

  // On a phone the office and the sidebar take turns on one screen; the
  // bottom bar picks which, and any tab() call (a thread, the chief) brings
  // the sidebar forward. On a wide screen data-m does nothing.
  mobile(m) {
    $('app').dataset.m = m === 'office' ? 'office' : 'side';
    if (m === 'chat') $('mChatDot').hidden = true;
    document.querySelectorAll('#mnav button').forEach((b) => b.classList.toggle('on', b.dataset.m === m));
  }

  tab(name) {
    this.mobile(name);
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
    $('chatPane').hidden = name !== 'chat' || !!this.thread;
    $('threadPane').hidden = name !== 'chat' || !this.thread;
    $('jobsPane').hidden = name !== 'jobs';
    $('teamPane').hidden = name !== 'team';
    $('projectsPane').hidden = name !== 'projects';
    if (name === 'team') this.renderTeam();
    if (name === 'projects') this.loadProjects();
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
      // Only a value the picker offers: anything else leaves it blank and
      // the server turns the message away.
      if (saved !== null && [...$(id).options].some((o) => o.value === saved)) $(id).value = saved;
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
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || (ac.classList.contains('faces') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight'))) {
          e.preventDefault();
          const next = (at + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
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
      if (visiting.on) {
        const job = await visitJob({ text, mode: $('mode').value, model: $('model').value });
        if (job) { this.app.jobs.set(job.id, job); this.app.refreshLists(); this.app.openJob(job.id); }
        return;
      }
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
    // `#web@host` and `@Ada@host` keep the menu open past the second @.
    const m = before.match(/(^|\s)([@#])([\w.-]*(?:@[\w-]*)?)$/);
    const ac = $('ac');
    if (!m) { ac.hidden = true; return; }
    const [, , sigil, typed] = m;
    const q = typed.toLowerCase().replace(/[^a-z0-9]/g, '');
    let items;
    if (sigil === '@') {
      items = this.app.roster().map((a) => ({ insert: a.insert || `@${a.name}`, label: a.name, key: a.host && `${a.name}${a.host}`, note: a.note, dot: a.color, look: a.look, host: a.host }));
    } else {
      if (!this.repos) {
        try { this.repos = allowRepos((await api('/api/repos')).repos); } catch { this.repos = []; }
      } else {
        this.syncRepos();
      }
      items = this.repos.map((r) => ({ insert: `#${r.replace(/\s+/g, '-')}`, label: r, note: this.app.busyIn(r) }));
      // Projects at a host that lets our own agents in: `#web@host`.
      if (!visiting.on) {
        items.push(...this.app.away.map((a) => ({
          insert: `#${a.repo.replace(/\s+/g, '-')}@${a.host}`, label: a.repo, host: a.host, key: `${a.repo}${a.host}`,
          note: `@${a.host} · ${a.access === 'edit' ? 'edit a copy' : 'read only'}`,
        })));
      }
    }
    const key = (i) => (i.key || i.label).toLowerCase().replace(/[^a-z0-9]/g, '');
    items = items.filter((i) => key(i).includes(q))
      .sort((a, b) => key(a).indexOf(q) - key(b).indexOf(q))
      .slice(0, sigil === '@' ? 40 : 8);
    if (!items.length) { ac.hidden = true; return; }
    ac.classList.toggle('faces', sigil === '@');
    if (sigil === '@') {
      ac.innerHTML = items.map((i, k) => `
      <div class="item ${k === 0 ? 'on' : ''}" data-insert="${esc(i.insert)}" data-len="${typed.length + 1}" title="${esc(i.label)}${i.note ? ` · ${esc(i.note)}` : ''}">
        ${avatar({ look: i.look }, i.host ? 'away' : '')}<span>${esc(i.label)}</span>${i.host ? `<small>@${esc(i.host)}</small>` : ''}${i.note ? `<em class="${i.note.endsWith('free') ? 'free' : 'busy'}"></em>` : ''}
      </div>`).join('');
      ac.hidden = false;
      return;
    }
    ac.innerHTML = items.map((i, k) => `
      <div class="item ${k === 0 ? 'on' : ''}" data-insert="${esc(i.insert)}" data-len="${typed.length + 1}">
        ${i.dot ? `<i style="background:${hex(i.dot)}"></i>` : '<i class="hash">#</i>'}
        <span>${esc(i.label)}${i.host ? `<small>@${esc(i.host)}</small>` : ''}</span>${i.note ? `<em>${esc(i.host ? i.note.replace(`@${i.host} · `, '') : i.note)}</em>` : ''}
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
    this.renderAttention();
  }

  // Messages that need the boss: for each job still waiting on them, the latest
  // flag or "waiting on you" line. Gone once the job is answered or moves on.
  attention() {
    const latest = new Map();
    for (const m of this.chat?.values() || []) {
      if (m.from !== 'chief' || !m.jobId) continue;
      if (m.kind !== 'flag' && !(m.kind === 'finished' && m.awaiting)) continue;
      if (m.kind === 'flag' && m.flag === 'review') continue;
      if (!this.app.jobs.get(m.jobId)?.awaitingBoss) continue;
      latest.set(m.jobId, m);
    }
    return [...latest.values()];
  }

  renderAttention() {
    const box = $('attn');
    if (!box) return;
    const items = this.attention();
    box.hidden = !items.length;
    box.innerHTML = items.map((m) => {
      const job = this.app.jobs.get(m.jobId);
      const text = m.text.replace(/\*\*/g, '').replace(/^[^·]*·\s*/, '');
      return `<button type="button" class="attn-item" data-attn="${esc(m.id)}" title="${esc(text)}" aria-label="${esc(this.app.doer(job))} needs you: ${esc(job.title)}. Go to message"><i aria-hidden="true">!</i><span><b>${esc(this.app.doer(job))} needs you</b> ${esc(job.title)}</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>`;
    }).join('');
  }

  jumpTo(id) {
    const m = this.chat.get(id);
    if (!m) return;
    if (this.thread) this.closeThread();
    if (!this.here(m)) this.selectChannel(m.channel || 'general');
    this.tab('chat');
    const el = $('msgs').querySelector(`.msg[data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.remove('ping');
    void el.offsetWidth;
    el.classList.add('ping');
  }

  // Just this channel's messages, newest at the bottom.
  paintChat() {
    const roots = [...this.chat.values()].filter((m) => this.here(m) && !this.inThread(m));
    $('msgs').innerHTML = roots.length
      ? roots.map((m) => this.message(m)).join('')
      : `<p class="empty">${visiting.on
        ? `Start a job${visiting.host ? ` at @${esc(visiting.host)}` : ''}: say what you need and tag ${visiting.repos?.length === 1 ? 'the project' : 'one of your projects'} with #${visiting.repos?.length ? ` (${visiting.repos.map((r) => esc(`#${r.replace(/\s+/g, '-')}`)).join(', ')})` : ''}. Only your own jobs show here.`
        : this.channel === 'general'
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
    this.renderAttention();
    if (m.from !== 'you' && $('app').dataset.m === 'office') $('mChatDot').hidden = false;
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
      .map((p) => avatar(this.app.person(p))).join('');
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
      ? `<p>${esc(m.text).replace(/(^|\s)([@#][\w.-]+(?:@[\w-]+)?)/g, '$1<span class="tag">$2</span>')}</p>`
      : rich(m.text);
    const long = m.from !== 'you' && m.from !== 'chief' && !m.to && m.text.length > 420;
    const project = m.project || (m.jobId && this.app.jobs.get(m.jobId)?.repo) || '';
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
        <div class="who">${avatar(who)}<b>${esc(who.name)}</b>${to ? `<span class="arrow">→</span>${avatar(to)}<b>${esc(to.name)}</b>` : ''}<time>${time}</time>${project ? `<span class="ptag" title="Project: ${esc(project)}" role="img" aria-label="Project: ${esc(project)}">${projectIcon(project)}</span>` : ''}</div>
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
      this.renderAttention();
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
        const before = this.app.staffName(form.dataset.id);
        const p = await api(`/api/staff/${form.dataset.id}/profile`, Object.fromEntries(new FormData(form)));
        this.app.applyProfile(form.dataset.id, p);
        const now = this.app.staffName(form.dataset.id);
        this.toast(now !== before ? `${before} is now ${now}. Tag them as @${now}; it reaches their prompt from their next job.` : `Saved. ${now} takes it from their next job.`, 'good');
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
    return ['name', 'role', 'personality', 'background'].some((k) => form.elements[k].value.trim() !== (s[k] || ''));
  }

  // Live updates wait while a form has unsaved edits, so typing is never lost.
  renderTeam(force = false) {
    if ($('teamPane').hidden || (!force && this.dirty())) return;
    const { staff, progress, dismissed } = this.app;
    const cap = progress?.capacity || 0;
    const form = (s) => `<form data-id="${esc(s.id)}">
          <label>Name<input name="name" maxlength="20" value="${esc(s.name)}" required pattern="[A-Za-z][A-Za-z0-9\\-]*" title="One word: letters, numbers or hyphens" autocomplete="off" spellcheck="false" /></label>
          <label>Role<input name="role" maxlength="80" value="${esc(s.role)}" placeholder="Backend engineer" /></label>
          <label>Personality<textarea name="personality" rows="3" maxlength="600" placeholder="How they come across: calm, chatty, blunt, funny…">${esc(s.personality)}</textarea></label>
          <label>Background<textarea name="background" rows="3" maxlength="600" placeholder="Where they've worked, what they know best">${esc(s.background)}</textarea></label>
          <p class="hint-t">Shapes how ${esc(s.name)} writes and who the chief sends their way. It never lowers the bar on the work.</p>
          <div class="row"><button type="button" class="ghost small" data-cancel>Cancel</button><button type="submit" class="primary small">Save</button></div>
        </form>`;
    const statusOf = (s, i) => (i >= cap ? 'Not hired yet' : dismissed.has(s.id) ? 'Gone home' : '');
    const econ = this.app.economy;
    const wallet = (s, i) => (econ && i < cap ? coinsOf(econ.wallets?.[s.id] || 0, 'tile-coins') : '');
    if (this.view === 'icons') {
      const openS = staff.find((s) => s.id === this.editing);
      $('team').innerHTML = `<div class="tiles">${staff.map((s, i) => {
        const status = statusOf(s, i);
        return `<button type="button" class="tile${i >= cap ? ' later' : ''}${s.id === this.editing ? ' open' : ''}" data-member="${esc(s.id)}" aria-expanded="${s.id === this.editing}" title="${esc(s.name)} · ${esc(s.role || 'No role yet')}${status ? ` · ${status}` : ''}">
          <span class="art">${portrait(s)}</span>
          <span class="n">${esc(s.name)}</span>
          <span class="c">${status || esc(s.role || 'No role yet')}</span>
          ${wallet(s, i)}
        </button>`;
      }).join('')}</div>${openS ? `<div class="member open">${form(openS)}</div>` : ''}`;
      return;
    }
    $('team').innerHTML = staff.map((s, i) => {
      const status = statusOf(s, i);
      const open = this.editing === s.id;
      const head = `<button type="button" class="head" data-member="${esc(s.id)}" aria-expanded="${open}">
          <i style="background:${hex(s.shirt)}"></i>
          <span class="n">${esc(s.name)}${status ? ` <em>${status}</em>` : ''}${wallet(s, i)}</span>
          <span class="r">${esc(s.role || 'No role yet')}</span>
        </button>`;
      if (!open) return `<div class="member${i >= cap ? ' later' : ''}">${head}${s.personality ? `<p class="p">${esc(s.personality)}</p>` : ''}</div>`;
      return `<div class="member open">${head}${form(s)}</div>`;
    }).join('');
  }

  // Who's gone home, each a click away from coming back.
  renderAway(staff) {
    const el = $('away');
    el.hidden = !staff.length;
    el.innerHTML = staff.length
      ? `<span>Gone home</span>${staff.map((s) => `<button type="button" data-recall="${esc(s.id)}" title="Call ${esc(s.name)} back"><i style="background:${hex(s.shirt)}"></i>${esc(s.name)}</button>`).join('')}`
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
