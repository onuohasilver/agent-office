// Onboarding, second step: meet the team and, if you like, rename them.
// Names save through the same profile route as the Team tab, so the server's
// rules (one taggable word, unique) apply here too.
import { api } from './hud.js';

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
const key = (n) => n.toLowerCase().replace(/[^a-z0-9]/g, '');

// The staff list arrives over the socket; the welcome can beat it.
function ready(app) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (app.staff.length && app.progress) return resolve(true);
      if (Date.now() - start > 15000) return resolve(false);
      setTimeout(tick, 200);
    };
    tick();
  });
}

export async function meetTeam(app) {
  if (!(await ready(app))) return;
  const team = app.staff.slice(0, app.progress.capacity || 0);
  if (!team.length) return;

  const dlg = el('dialog', { className: 'name-ask meet' });
  const form = el('form', { method: 'dialog' });
  const list = el('div', { className: 'meet-list' });
  const inputs = team.map((s) => {
    const row = el('label', { className: 'meet-row' });
    const dot = el('i');
    dot.style.background = s.shirt;
    const input = el('input', {
      type: 'text', value: s.name, maxLength: 20, required: true, autocomplete: 'off', spellcheck: false,
      pattern: '[A-Za-z][A-Za-z0-9\\-]*', title: 'One word: letters, numbers or hyphens',
    });
    input.setAttribute('aria-label', `Name for your ${s.role || 'agent'}`);
    const role = el('span', { className: 'meet-role', textContent: s.role || '' });
    row.append(dot, input, role);
    list.append(row);
    return { s, input };
  });
  const err = el('p', { className: 'acct-note acct-err', hidden: true });
  const go = el('button', { type: 'submit', className: 'primary small', textContent: 'Done' });
  const skip = el('button', { type: 'button', className: 'acct-forget', textContent: 'Keep these names' });
  const foot = el('div', { className: 'meet-foot' });
  foot.append(skip, go);
  form.append(
    el('h2', { textContent: 'Meet your team' }),
    el('p', { className: 'acct-note', textContent: 'These are the agents on your floor. Keep their names or give them your own. You tag them in chat by name, and you can rename them any time in the Team tab.' }),
    list, err, foot);
  dlg.append(form);
  const close = () => { dlg.close(); dlg.remove(); };
  skip.addEventListener('click', close);
  dlg.addEventListener('cancel', close);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    const changed = inputs.filter(({ s, input }) => input.value.trim() !== s.name);
    // Two of them can't share a name, even before the server is asked.
    const seen = new Map();
    for (const { input } of inputs) {
      const k = key(input.value);
      if (seen.has(k)) return fail(`Two agents can't both be ${input.value.trim()}.`, input);
      seen.set(k, input);
    }
    go.disabled = true;
    // Save one at a time, so a swap (A↔B) never trips on a name held by the
    // other half-way through. Anything the server turns down stays open.
    for (const { s, input } of order(changed)) {
      try {
        app.applyProfile(s.id, await api(`/api/staff/${s.id}/profile`, { name: input.value.trim() }));
      } catch (ex) {
        go.disabled = false;
        return fail(`${s.name}: ${ex.message}`, input);
      }
    }
    close();
  });

  function fail(text, input) {
    err.textContent = text;
    err.hidden = false;
    input.focus();
    input.select();
  }

  // Whoever is taking a name that someone else is giving up goes after them.
  // A straight swap is a cycle no order can fix; the server says so plainly.
  function order(list) {
    const out = [];
    const left = [...list];
    while (left.length) {
      const i = left.findIndex(({ input }) => !left.some((o) => key(o.s.name) === key(input.value)));
      out.push(...left.splice(i < 0 ? 0 : i, 1));
    }
    return out;
  }

  document.body.append(dlg);
  dlg.showModal();
  inputs[0].input.focus();
  inputs[0].input.select();
}
