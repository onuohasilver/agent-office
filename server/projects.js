// Where the office's projects are. A project is a name the boss can say (#web)
// and the folder it stands for. Three sources, in this order:
//   1. the git repo the office was started inside (zero config), or, when it
//      was started anywhere else, the subfolders of that folder (the original
//      behaviour, and still what OFFICE_ROOT asks for);
//   2. folders the boss added from the UI, remembered in the office's state.
// Names are the folder's own, so existing jobs and #mentions keep working.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// The top of the git working tree `dir` is in, or null.
export function gitTop(dir) {
  try {
    const top = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
    }).trim();
    return top ? fs.realpathSync(top) : null;
  } catch { return null; }
}

// What `agentoffice` should use as its projects, given where it was started.
// An OFFICE_ROOT the user set always wins: that is how it worked before, and
// anyone who relies on it keeps it. Otherwise a git repo is the one project,
// and anywhere else the folder's subfolders are, as before.
// Returns { root, project } (project is the single repo's path, or '').
export function startupProjects({ cwd, env = process.env, top = gitTop }) {
  if (env.OFFICE_ROOT) return { root: env.OFFICE_ROOT, project: '' };
  const repo = top(cwd);
  return repo ? { root: repo, project: repo } : { root: cwd, project: '' };
}

const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
const byName = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' });
const visible = (name) => !!name && !name.startsWith('.') && name !== 'node_modules';

// A folder's name as a project, or '' when it can't be one.
const nameFor = (dir) => path.basename(dir).replace(/^\.+/, '');

// name -> absolute folder. `added` is the remembered extra folders; one that
// has since gone is skipped, not forgotten, in case a drive is only unplugged.
export function projectMap({ root, project = '', added = [] }) {
  const map = new Map();
  if (project) {
    if (isDir(project) && visible(nameFor(project))) map.set(nameFor(project), project);
  } else {
    let entries = [];
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch {}
    const dirs = entries.filter((d) => d.isDirectory() && visible(d.name))
      .map((d) => d.name).sort(byName);
    for (const name of dirs) map.set(name, path.join(root, name));
  }
  const have = new Set([...map.values()]);
  for (const dir of added) {
    if (have.has(dir) || !isDir(dir)) continue;
    let name = nameFor(dir);
    if (!name) continue;
    // Two folders called "api": the second is "parent-api", then numbered.
    if (map.has(name)) name = `${nameFor(path.dirname(dir))}-${name}`;
    for (let n = 2; map.has(name); n++) name = `${nameFor(dir)}-${n}`;
    map.set(name, dir);
    have.add(dir);
  }
  return map;
}

// Checks a folder the boss wants to add and returns its real path, or throws
// an error with a message fit to show them (code 400).
export function acceptFolder(input, { home = os.homedir() } = {}) {
  const fail = (m) => Object.assign(new Error(m), { code: 400 });
  if (typeof input !== 'string' || !input.trim()) throw fail('Give the folder’s path.');
  let p = input.trim();
  if (p === '~' || p.startsWith('~/')) p = path.join(home, p.slice(1));
  if (!path.isAbsolute(p)) throw fail('Use the full path, like /Users/you/code/storefront or ~/code/storefront.');
  let real;
  try { real = fs.realpathSync(p); } catch { throw fail(`There is no folder at ${p}.`); }
  if (!isDir(real)) throw fail(`${p} is a file, not a folder.`);
  if (real === path.parse(real).root || real === fs.realpathSync(home)) {
    throw fail('That is too broad to be one project. Add the project’s own folder, or start the office from the folder that holds your projects.');
  }
  if (!visible(path.basename(real))) throw fail('A project folder can’t start with a dot.');
  return real;
}
