// The terminal drawer: real shells on this machine, docked under the office.
//
// The browser never decides whether it may have one. It asks the server
// (/api/terminal), and when the answer is no it shows the reason instead of a
// prompt. Every session begins by asking for a single-use ticket, so a tab
// left open overnight holds nothing: after a restart its socket is dead and
// the next one has to ask again.

import '@xterm/xterm/css/xterm.css';

const $ = (id) => document.getElementById(id);
const HEIGHT_KEY = 'office.term.height';
const FOLDER_KEY = 'office.term.folder';
const MIN_H = 140;

// Warm dark, so a terminal reads as a panel in the same building rather than
// a browser window someone left open on top of it.
const THEME = {
  background: '#221e18',
  foreground: '#ece4d6',
  cursor: '#f2cc8f',
  cursorAccent: '#221e18',
  selectionBackground: 'rgba(242, 204, 143, 0.26)',
  black: '#3b342b', red: '#e4705c', green: '#8cc08a', yellow: '#e8bb63',
  blue: '#7fb2dd', magenta: '#cf9ad4', cyan: '#80c4bd', white: '#ded5c6',
  brightBlack: '#6f6454', brightRed: '#f2897a', brightGreen: '#a8d6a3',
  brightYellow: '#f6d088', brightBlue: '#a2cbf0', brightMagenta: '#e2b6e6',
  brightCyan: '#a3d9d2', brightWhite: '#fbf9f5',
};

let lib = null;
// xterm is a chunk of its own: nobody who never opens a terminal should pay
// for it on first paint.
async function load() {
  if (!lib) {
    const [{ Terminal }, { FitAddon }] = await Promise.all([import('@xterm/xterm'), import('@xterm/addon-fit')]);
    lib = { Terminal, FitAddon };
  }
  return lib;
}

export class TerminalDrawer {
  constructor({ api, toast }) {
    this.api = api;
    this.toast = toast;
    this.sessions = [];
    this.active = null;
    this.status = null;
    this.seq = 0;
    this.height = Number(localStorage.getItem(HEIGHT_KEY)) || 300;

    $('termToggle').onclick = () => this.toggle();
    $('termHide').onclick = () => this.hide();
    $('termNew').onclick = () => this.spawn();
    $('termTabs').onclick = (e) => {
      const close = e.target.closest('[data-close]');
      if (close) return this.close(close.dataset.close);
      const tab = e.target.closest('[data-tab]');
      if (tab) this.select(tab.dataset.tab);
    };
    $('termFolder').onchange = (e) => localStorage.setItem(FOLDER_KEY, e.target.value);
    this.bindGrip();

    addEventListener('keydown', (e) => {
      // Control-backtick, the shortcut everyone already has in their fingers.
      // It stays out of the way of ⌘` (next window) and of the plain keys the
      // camera uses.
      if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === '`' || e.code === 'Backquote')) {
        e.preventDefault();
        this.toggle();
      }
    });
    // A pty only wraps correctly if it knows the window size, and the window
    // changes when the detail drawer opens as well as when you resize.
    new ResizeObserver(() => this.fit()).observe($('termBody'));
    addEventListener('resize', () => { if (this.open) this.setHeight(this.height); });
  }

  // ---------- the drawer ----------

  get open() { return !$('term').hidden; }

  async toggle() { this.open ? this.hide() : this.show(); }

  hide() {
    $('term').hidden = true;
    $('termToggle').classList.remove('on');
    this.setHeight(0);
  }

  async show() {
    $('term').hidden = false;
    $('termToggle').classList.add('on');
    this.setHeight(this.height);
    await this.refresh();
    if (!this.status?.enabled) return;
    if (!this.sessions.length) this.spawn();
    else this.focus();
  }

  // The 3D view is sized off #stage, which this inset drives, so opening the
  // drawer shrinks the office rather than covering the bottom of it.
  setHeight(h) {
    $('view').style.setProperty('--term-h', `${Math.round(h && this.limit(h))}px`);
  }

  // A height remembered from a big window would swallow a small one whole, so
  // the office always keeps a strip of itself.
  limit(h) {
    return Math.min(Math.max(MIN_H, $('view').clientHeight - 120), Math.max(MIN_H, h));
  }

  bindGrip() {
    const grip = $('termGrip');
    grip.onpointerdown = (e) => {
      grip.setPointerCapture(e.pointerId);
      const startY = e.clientY;
      const startH = this.height;
      const move = (ev) => {
        this.height = this.limit(startH - (ev.clientY - startY));
        this.setHeight(this.height);
      };
      const up = () => {
        grip.onpointermove = grip.onpointerup = grip.onpointercancel = null;
        localStorage.setItem(HEIGHT_KEY, String(Math.round(this.height)));
      };
      grip.onpointermove = move;
      grip.onpointerup = grip.onpointercancel = up;
    };
    grip.onkeydown = (e) => {
      const step = e.key === 'ArrowUp' ? 32 : e.key === 'ArrowDown' ? -32 : 0;
      if (!step) return;
      e.preventDefault();
      this.height = this.limit(this.height + step);
      this.setHeight(this.height);
      localStorage.setItem(HEIGHT_KEY, String(Math.round(this.height)));
    };
  }

  // ---------- is there a terminal at all ----------

  async refresh() {
    try { this.status = await this.api('/api/terminal'); }
    catch (err) { this.status = { enabled: false, reason: err.message }; }

    const off = $('termOff');
    off.hidden = !!this.status.enabled;
    $('termBody').hidden = !this.status.enabled;
    $('termFolder').hidden = $('termNew').hidden = !this.status.enabled;
    if (!this.status.enabled) {
      off.innerHTML = `<p><b>No terminal.</b> ${esc(this.status.reason)}</p>
        <p class="term-why">Shell access is off by default because anything in this browser would get a shell
        as you — no clearance picker, no job log. Turn it on only on a machine you trust:</p>
        <pre>OFFICE_TERMINAL=1 npm start</pre>`;
      $('termNote').textContent = '';
      return;
    }

    const sel = $('termFolder');
    const want = sel.value || localStorage.getItem(FOLDER_KEY) || '';
    sel.innerHTML = [`<option value="">${esc(this.status.root)}</option>`,
      ...this.status.folders.map((f) => `<option value="${esc(f)}">${esc(f)}</option>`)].join('');
    sel.value = [...sel.options].some((o) => o.value === want) ? want : '';
    $('termNote').textContent = this.status.shell.split('/').pop();
    $('termNote').title = `${this.status.shell} · up to ${this.status.max} at once · closes itself after ${this.status.idleMinutes} min idle`;
  }

  // ---------- sessions ----------

  async spawn() {
    await this.refresh();
    if (!this.status?.enabled) return;
    const { Terminal, FitAddon } = await load();
    const folder = $('termFolder').value;

    let ticket;
    try { ticket = await this.api('/api/terminal/ticket', { folder }); }
    catch (err) { return this.toast(err.message, 'bad'); }

    const id = `t${++this.seq}`;
    // Two shells in one folder need telling apart, and a login shell titles
    // itself "you@host:/the/whole/path", which would push every other tab off
    // the bar. So a tab is its folder, numbered, and the title the shell sets
    // for itself lives in the tooltip where it costs no room.
    const taken = this.sessions.filter((s) => s.folder === folder).length;
    const el = document.createElement('div');
    el.className = 'term-pane';
    el.dataset.pane = id;
    $('termBody').append(el);

    const term = new Terminal({
      theme: THEME,
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: 12.5,
      lineHeight: 1.35,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: true,
      macOptionIsMeta: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);

    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws/terminal?ticket=${encodeURIComponent(ticket.ticket)}`);
    const label = taken ? `${ticket.cwd} ${taken + 1}` : ticket.cwd;
    const session = { id, folder, label, term, fit, ws, el, live: false };
    this.sessions.push(session);
    this.select(id);

    const size = () => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'size', cols: term.cols, rows: term.rows }));
    };
    ws.onopen = () => { this.fit(); size(); };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === 'ready') { session.live = true; size(); this.renderTabs(); }
      else if (m.t === 'out') term.write(m.d);
      else if (m.t === 'exit') {
        session.live = false;
        // The pane stays so you can read whatever the shell said on its way
        // out; closing the tab is yours to do.
        term.write(`\r\n\x1b[2m— ${m.why || `shell exited${m.code ? ` (${m.code})` : ''}`} —\x1b[0m\r\n`);
        this.renderTabs();
      }
    };
    ws.onerror = () => {};
    ws.onclose = (ev) => {
      if (!session.live && !ev.wasClean) term.write(`\r\n\x1b[2m— ${ev.reason || 'the office refused the terminal'} —\x1b[0m\r\n`);
      session.live = false;
      this.renderTabs();
    };

    term.onData((d) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: 'in', d })); });
    term.onResize(size);
    term.onTitleChange((title) => { session.title = title; this.renderTabs(); });
  }

  select(id) {
    const session = this.sessions.find((s) => s.id === id);
    if (!session) return;
    this.active = id;
    for (const s of this.sessions) s.el.classList.toggle('on', s === session);
    this.renderTabs();
    this.fit();
    this.focus();
  }

  focus() {
    this.sessions.find((s) => s.id === this.active)?.term.focus();
  }

  close(id) {
    const i = this.sessions.findIndex((s) => s.id === id);
    if (i < 0) return;
    const [s] = this.sessions.splice(i, 1);
    try { s.ws.close(); } catch {}
    s.term.dispose();
    s.el.remove();
    if (this.active !== id) return this.renderTabs();
    const next = this.sessions[i] || this.sessions[i - 1];
    this.active = null;
    if (next) this.select(next.id);
    else { this.renderTabs(); this.hide(); }
  }

  renderTabs() {
    $('termTabs').innerHTML = this.sessions.map((s) => {
      const tip = [s.label, s.live ? s.title : 'the shell has exited'].filter(Boolean).join(' · ');
      return `<span class="term-tab${s.id === this.active ? ' on' : ''}${s.live ? '' : ' dead'}">
        <button type="button" data-tab="${s.id}" role="tab" aria-selected="${s.id === this.active}" title="${esc(tip)}">${esc(s.label)}</button>
        <button type="button" class="x" data-close="${s.id}" aria-label="Close ${esc(s.label)}">
          <svg viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12"/></svg>
        </button></span>`;
    }).join('');
  }

  fit() {
    if (!this.open) return;
    const s = this.sessions.find((x) => x.id === this.active);
    if (!s || !s.el.clientHeight) return;
    try { s.fit.fit(); } catch {}
  }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
