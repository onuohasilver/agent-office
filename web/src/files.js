// The office's own file editor: a project's folders on the left, the file in
// a code editor on the right (code.js, loaded on first open). Cmd/Ctrl+S saves; a save is refused if the file changed on
// disk since it was opened (an agent may be mid-job), and says so.

import { api } from './hud.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const kb = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`);
const q = (o) => new URLSearchParams(o).toString();
const FOLDER = '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>';
const FILE = '<path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/>';

let app = null;
let root = null;
let repo = null;
let onClose = null;
let tree = new Map();   // folder path -> entries | 'loading' | { error }
let open = new Set();   // folders showing their contents
let file = null;        // { path, mtime, size, base } once loaded
let state = 'idle';     // idle | loading | ready | saving | error
let message = '';
let dirty = false;
let cm = null;          // the code view, while a file is showing
let Code = null;        // code.js, once loaded

const loadCode = async () => { Code ??= await import('./code.js'); };

export function initFiles(a) { app = a; }

export async function openFiles(name, back = null, startPath = '') {
  onClose = back;
  repo = name; tree = new Map(); open = new Set(['']); file = null; state = 'idle'; message = ''; dirty = false;
  if (!root) build();
  loadCode().catch(() => {});
  root.hidden = false;
  root.parentElement.classList.add('fe-open');
  paint();
  await loadDir('');
  root.querySelector('.fe-x').focus();
  if (startPath) await reveal(startPath);
}

export function closeFiles(force = false) {
  if (!root || root.hidden) return;
  if (dirty && !force && !confirm('Close without saving your changes?')) return;
  root.hidden = true;
  root.parentElement.classList.remove('fe-open');
  repo = null; file = null; dirty = false;
  cm?.destroy(); cm = null;
  onClose?.();
}

// Opens a file given by path, with its folders expanded in the tree.
async function reveal(p) {
  const was = repo;
  const parts = p.split('/').filter(Boolean);
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join('/');
    open.add(dir);
    if (!Array.isArray(tree.get(dir))) await loadDir(dir);
    if (repo !== was) return;
  }
  paintTree();
  await openFile(parts.join('/'), true);
}


function build() {
  root = document.createElement('section');
  root.className = 'fedit';
  root.setAttribute('aria-label', 'File editor');
  root.hidden = true;
  document.getElementById('view').append(root);
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    if (act === 'close') closeFiles();
    else if (act === 'dir') toggle(t.dataset.path);
    else if (act === 'file') openFile(t.dataset.path);
    else if (act === 'save') save();
    else if (act === 'reload') openFile(file.path, true);
    else if (act === 'retry') loadDir(t.dataset.path);
    else if (act === 'tree') root.classList.toggle('fe-tree-open');
  });
  addEventListener('keydown', (e) => {
    if (root.hidden) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); e.stopPropagation(); save(); }
    // Esc in the find bar closes the find bar, not the editor.
    else if (e.key === 'Escape' && !e.defaultPrevented && !e.target.closest?.('.cm-panels')) { e.stopPropagation(); closeFiles(); }
  }, true);
  addEventListener('beforeunload', (e) => { if (dirty && root && !root.hidden) { e.preventDefault(); e.returnValue = ''; } });
}

function paint() {
  if (!root || root.hidden) return;
  root.innerHTML = `
    <header class="fe-bar">
      <button type="button" class="fe-x" data-act="close" aria-label="Close editor (Esc)" title="Close (Esc)"><svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button>
      <button type="button" class="fe-toggle" data-act="tree" aria-label="Show files" title="Files"><svg viewBox="0 0 24 24">${FOLDER}</svg></button>
      <div class="fe-title"><b>${esc(repo)}</b><span class="fe-sub"></span></div>
      <span class="fe-fill"></span>
      <span class="fe-note" role="status"></span>
      <button type="button" class="fe-save" data-act="save" disabled>Save</button>
    </header>
    <div class="fe-body">
      <nav class="fe-tree" aria-label="Files"></nav>
      <div class="fe-main"></div>
    </div>
    <footer class="fe-foot"><span class="fe-pos"></span><span class="fe-size"></span></footer>`;
  paintTree();
  paintMain();
  paintBar();
}

function paintBar() {
  if (!root || root.hidden) return;
  root.querySelector('.fe-sub').textContent = file ? `${file.path}${dirty ? ' · unsaved' : ''}` : 'Pick a file';
  root.querySelector('.fe-save').disabled = !file || !dirty || state === 'saving';
  root.querySelector('.fe-save').textContent = state === 'saving' ? 'Saving…' : 'Save';
  const note = root.querySelector('.fe-note');
  note.textContent = message;
  note.dataset.kind = state === 'error' ? 'bad' : '';
}

function paintStatus(line, col) {
  if (!root || root.hidden) return;
  root.querySelector('.fe-pos').textContent = cm ? `Ln ${line}, Col ${col}` : '';
  root.querySelector('.fe-size').textContent = cm ? kb(new Blob([cm.text()]).size) : '';
}

function edited() {
  if (!dirty) { dirty = true; paintBar(); }
}

function paintTree() {
  const nav = root?.querySelector('.fe-tree');
  if (!nav) return;
  const rows = (dir, depth) => {
    const got = tree.get(dir);
    if (got === 'loading' || got === undefined) return `<div class="fe-skel" style="--d:${depth}" aria-hidden="true"><i></i><i></i><i></i></div>`;
    if (got.error) return `<div class="fe-err" style="--d:${depth}">${esc(got.error)} <button type="button" data-act="retry" data-path="${esc(dir)}">Retry</button></div>`;
    if (!got.length) return `<div class="fe-none" style="--d:${depth}">Empty folder</div>`;
    return got.map((e) => {
      const p = dir ? `${dir}/${e.name}` : e.name;
      if (e.dir) {
        const on = open.has(p);
        return `<button type="button" class="fe-row dir" style="--d:${depth}" data-act="dir" data-path="${esc(p)}" aria-expanded="${on}"><span class="fe-caret" aria-hidden="true">›</span><svg viewBox="0 0 24 24" aria-hidden="true">${FOLDER}</svg><span>${esc(e.name)}</span></button>${on ? rows(p, depth + 1) : ''}`;
      }
      return `<button type="button" class="fe-row" style="--d:${depth}" data-act="file" data-path="${esc(p)}" aria-current="${file?.path === p}"><span class="fe-caret"></span><svg viewBox="0 0 24 24" aria-hidden="true">${FILE}</svg><span>${esc(e.name)}</span></button>`;
    }).join('');
  };
  nav.innerHTML = rows('', 0);
}

function paintMain(text = '') {
  const main = root?.querySelector('.fe-main');
  if (!main) return;
  cm?.destroy(); cm = null;
  if (state === 'loading') main.innerHTML = `<div class="fe-skel big" aria-busy="true" aria-label="Opening file"><i></i><i></i><i></i><i></i><i></i></div>`;
  else if (state === 'error' && !file) main.innerHTML = `<p class="fe-empty">${esc(message)}</p>`;
  else if (!file) main.innerHTML = `<p class="fe-empty">Pick a file to edit it here. Cmd/Ctrl+S saves.</p>`;
  else {
    main.innerHTML = `${state === 'error' && /changed on disk|deleted/.test(message) ? `<div class="fe-conflict">${esc(message)} <button type="button" data-act="reload">Reload from disk</button></div>` : ''}<div class="fe-code"></div>`;
    cm = Code.mountCode(main.querySelector('.fe-code'), text, file.path, { change: edited, cursor: paintStatus, save });
  }
  paintStatus(1, 1);
}

async function loadDir(dir) {
  const was = repo;
  tree.set(dir, 'loading');
  paintTree();
  try {
    const r = await api(`/api/files?${q({ repo, path: dir, dir: 1 })}`);
    if (repo !== was) return;
    tree.set(dir, r.entries);
  } catch (err) {
    if (repo !== was) return;
    tree.set(dir, { error: err.message });
  }
  paintTree();
}

function toggle(p) {
  if (open.has(p)) open.delete(p);
  else { open.add(p); if (!Array.isArray(tree.get(p))) loadDir(p); }
  paintTree();
}

async function openFile(p, force = false) {
  if (!force && dirty && !confirm('Open another file without saving your changes?')) return;
  const was = repo;
  state = 'loading'; message = ''; dirty = false;
  file = null;
  paintMain(); paintBar();
  root.classList.remove('fe-tree-open');
  try {
    const [r] = await Promise.all([api(`/api/files?${q({ repo, path: p })}`), loadCode()]);
    if (repo !== was) return;
    file = { path: r.path, mtime: r.mtime, size: r.size };
    state = 'ready';
    paintMain(r.text);
    cm.focus();
  } catch (err) {
    if (repo !== was) return;
    state = 'error'; message = err.message;
    paintMain();
  }
  paintTree(); paintBar();
}

async function save() {
  if (!file || !dirty || state === 'saving') return;
  const was = repo;
  state = 'saving'; message = ''; paintBar();
  try {
    const r = await api('/api/files', { repo, path: file.path, text: cm.text(), mtime: file.mtime }, 'PUT');
    if (repo !== was) return;
    file.mtime = r.mtime; file.size = r.size;
    dirty = false; state = 'ready'; message = 'Saved';
    setTimeout(() => { if (message === 'Saved') { message = ''; paintBar(); } }, 1600);
  } catch (err) {
    if (repo !== was) return;
    state = 'error'; message = err.message;
    // A conflict puts its banner above the text; the text stays as typed.
    paintMain(cm.text());
    if (/changed on disk|deleted/.test(err.message)) message = '';
    else app?.hud?.toast?.(err.message, 'bad');
  }
  paintBar();
}
