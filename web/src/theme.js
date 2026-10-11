// Appearance: a palette (data-theme) and light / dark / auto (data-mode on <html>).
// index.html applies the saved choice before first paint; this wires the picker
// and keeps "auto" following the system.

const THEMES = [
  { id: 'paper', name: 'Paper' },
  { id: 'ocean', name: 'Ocean' },
  { id: 'forest', name: 'Forest' },
  { id: 'sunset', name: 'Sunset' },
  { id: 'lavender', name: 'Lavender' },
];
const MODES = [
  { id: 'light', name: 'Light' },
  { id: 'dark', name: 'Dark' },
  { id: 'auto', name: 'Auto' },
];

const root = document.documentElement;
const dark = matchMedia('(prefers-color-scheme: dark)');
const read = (k, fallback, valid) => {
  try {
    const v = localStorage.getItem(k);
    return valid.some((x) => x.id === v) ? v : fallback;
  } catch { return fallback; }
};
const save = (k, v) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

let theme = read('office.theme', 'paper', THEMES);
let mode = read('office.mode', 'auto', MODES);

const btn = document.getElementById('themeBtn');
const pop = document.getElementById('themePop');

function apply() {
  const resolved = mode === 'dark' || (mode === 'auto' && dark.matches) ? 'dark' : 'light';
  root.dataset.theme = theme;
  root.dataset.mode = resolved;
  // The browser / installed-app chrome follows the paper colour.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(root).getPropertyValue('--paper').trim() || meta.content;
  render();
}

function render() {
  if (!pop) return;
  pop.replaceChildren();
  const label = (text) => Object.assign(document.createElement('p'), { className: 'theme-k', textContent: text });
  const group = (items, current, onPick, cls) => {
    const row = document.createElement('div');
    row.className = cls;
    row.setAttribute('role', 'radiogroup');
    for (const it of items) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.t = it.id;
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(it.id === current));
      b.innerHTML = cls === 'theme-swatches' ? '<i></i><span></span>' : '<span></span>';
      b.querySelector('span').textContent = it.name;
      b.addEventListener('click', () => onPick(it.id));
      row.appendChild(b);
    }
    return row;
  };
  pop.append(
    label('Theme'),
    group(THEMES, theme, (id) => { theme = id; save('office.theme', id); apply(); }, 'theme-swatches'),
    label('Mode'),
    group(MODES, mode, (id) => { mode = id; save('office.mode', id); apply(); }, 'theme-modes'),
  );
}

function open(on) {
  pop.hidden = !on;
  btn.setAttribute('aria-expanded', String(on));
  if (on) pop.querySelector('[aria-checked="true"]')?.focus();
}

btn?.addEventListener('click', (e) => { e.stopPropagation(); open(pop.hidden); });
pop?.addEventListener('click', (e) => e.stopPropagation());
document.addEventListener('click', () => { if (pop && !pop.hidden) open(false); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pop && !pop.hidden) { open(false); btn.focus(); }
});
dark.addEventListener('change', () => { if (mode === 'auto') apply(); });

apply();
