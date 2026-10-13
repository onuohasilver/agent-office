import { api } from './hud.js';
import { TIP, naira } from '../../shared/shop.js';

// Click an agent and a small chat opens right above their head. It follows
// them as they walk (and as the camera moves), answers in character through
// one cheap call, and never starts a job: "Open job" hands over to the side
// panel for real work.

const KEEP = 6;

export class AgentChat {
  constructor(labels, { onDetails }) {
    this.onDetails = onDetails;
    this.agent = null;
    this.turns = [];
    this.busy = false;

    const el = (tag, cls, text) => {
      const n = document.createElement(tag);
      if (cls) n.className = cls;
      if (text) n.textContent = text;
      return n;
    };
    this.root = el('div', 'agent-chat');
    this.root.hidden = true;
    const head = el('div', 'ac-head');
    this.dot = el('i');
    this.title = el('b');
    this.sub = el('span', 'ac-sub');
    const open = el('button', 'ac-open', 'Open job');
    open.type = 'button';
    const x = el('button', 'ac-x', '×');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close chat');
    head.append(this.dot, this.title, this.sub, open, x);
    this.log = el('div', 'ac-log');
    this.log.setAttribute('aria-live', 'polite');
    const form = el('form', 'ac-form');
    this.input = el('input');
    this.input.maxLength = 400;
    this.input.autocomplete = 'off';
    this.input.placeholder = 'Say something…';
    const send = el('button', 'ac-send', '↑');
    send.type = 'submit';
    send.setAttribute('aria-label', 'Send');
    form.append(this.input, send);
    this.tail = el('i', 'ac-tail');
    const tips = el('div', 'ac-tips');
    tips.append(el('span', '', 'Tip from the pot'));
    for (const amount of TIP.presets) {
      const b = el('button', 'ac-tip', naira(amount));
      b.type = 'button';
      b.onclick = () => this.tip(amount);
      tips.append(b);
    }
    this.root.append(head, this.log, tips, form, this.tail);
    labels.appendChild(this.root);

    x.onclick = () => this.close();
    open.onclick = () => this.agent && this.onDetails(this.agent.id);
    form.onsubmit = (e) => { e.preventDefault(); this.send(); };
    this.root.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.close(); });
    // The 3D view listens for clicks and keys on its own; keep ours to ourselves.
    for (const t of ['pointerdown', 'pointerup', 'dblclick', 'wheel']) this.root.addEventListener(t, (e) => e.stopPropagation());
  }

  get id() { return this.agent?.id ?? null; }

  open(agent) {
    if (this.agent === agent && !this.root.hidden) { this.input.focus(); return; }
    this.agent = agent;
    this.turns = [];
    this.log.replaceChildren();
    this.dot.style.background = /^#[0-9a-f]{3,8}$/i.test(agent.staff.shirt ?? '') ? agent.staff.shirt : '';
    this.title.textContent = agent.name;
    this.refreshSub();
    this.root.hidden = false;
    this.add('them', this.greeting(agent));
    this.input.value = '';
    this.input.focus({ preventScroll: true });
  }

  greeting(agent) {
    const j = agent.job;
    if (j && j.id !== 'idle') return j.waiting ? `I'm waiting on you for "${j.title}".` : `Hi boss. Deep in "${j.title}" right now. What's up?`;
    return 'Hi boss. Between jobs. What’s up?';
  }

  refreshSub() {
    const j = this.agent?.job;
    this.sub.textContent = j && j.id !== 'idle' ? (j.waiting ? 'waiting on you' : 'working') : 'free';
  }

  close() {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.agent = null;
    this.onClose?.();
  }

  add(who, text, cls = '') {
    const m = document.createElement('p');
    m.className = `ac-msg ${who} ${cls}`.trim();
    m.textContent = text;
    this.log.appendChild(m);
    while (this.log.children.length > 40) this.log.firstChild.remove();
    this.log.scrollTop = this.log.scrollHeight;
    return m;
  }

  async tip(amount) {
    const agent = this.agent;
    if (!agent || this.tipping) return;
    this.tipping = true;
    try {
      await api('/api/economy/tip', { agentId: agent.id, amount });
      if (this.agent === agent) this.add('them', `Thank you! ${naira(amount)}, that's kind.`, 'tipped');
    } catch (err) {
      if (this.agent === agent) this.add('them', err.message, 'bad');
    } finally {
      this.tipping = false;
    }
  }

  async send() {
    const text = this.input.value.trim();
    if (!text || this.busy || !this.agent) return;
    const agent = this.agent;
    this.busy = true;
    this.input.value = '';
    this.add('you', text);
    const wait = this.add('them', '…', 'wait');
    agent.say('', '');
    try {
      const { reply } = await api(`/api/staff/${agent.id}/talk`, { text, history: this.turns.slice(-KEEP) });
      this.turns.push({ who: 'you', text }, { who: 'them', text: reply });
      if (this.agent === agent) { wait.textContent = reply; wait.classList.remove('wait'); }
      else wait.remove();
      agent.speak?.(reply.length > 90 ? reply.slice(0, 89) + '…' : reply);
    } catch (err) {
      wait.textContent = err.message;
      wait.className = 'ac-msg bad';
    } finally {
      this.busy = false;
      this.log.scrollTop = this.log.scrollHeight;
      if (this.agent === agent) this.input.focus({ preventScroll: true });
    }
  }

  // Sit just above the agent's name tag, kept inside the view.
  place(w) {
    const a = this.agent;
    if (this.root.hidden || !a) return;
    if (!a.onScreen) { this.root.style.visibility = 'hidden'; return; }
    this.root.style.visibility = '';
    this.refreshSub();
    const bw = this.root.offsetWidth, bh = this.root.offsetHeight;
    const x = Math.max(bw / 2 + 8, Math.min(w - bw / 2 - 8, a.anchorX));
    const top = Math.max(8, a.anchorY - (a.lift || 0) - (a.labelH || 0) - bh - 12);
    this.root.style.transform = `translate(${x - bw / 2}px, ${top}px)`;
    this.tail.style.left = `${Math.max(14, Math.min(bw - 14, a.anchorX - (x - bw / 2)))}px`;
  }
}
