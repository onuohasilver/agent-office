// User journey maps, one per project: the routes a person takes through the
// app, as steps and the arrows between them. An agent reads the project and
// writes the map; the browser draws it as a flow canvas.
//
// Maps live in the office's data folder, not the project, so mapping never
// leaves a file in someone's repo. Whatever the agent wrote is cut down to
// the shape below before the browser sees it.

import fs from 'node:fs';
import path from 'node:path';

export const KINDS = ['entry', 'screen', 'action', 'decision', 'system', 'end'];
const MAX_JOURNEYS = 24;
const MAX_STEPS = 60;
const MAX_EDGES = 120;
const ID_RE = /^[A-Za-z0-9_.-]{1,48}$/;

const text = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export class Journeys {
  constructor(dataDir) {
    this.dir = path.join(dataDir, 'journeys');
  }

  file(repo) {
    return path.join(this.dir, `${repo}.json`);
  }

  ensureDir() {
    fs.mkdirSync(this.dir, { recursive: true });
    return this.dir;
  }

  read(repo) {
    let raw;
    try { raw = JSON.parse(fs.readFileSync(this.file(repo), 'utf8')); } catch { return null; }
    let at = 0;
    try { at = fs.statSync(this.file(repo)).mtimeMs; } catch {}
    return clean(raw, at);
  }

  // What the mapping agent is told. It writes one file and touches nothing else.
  brief(repo) {
    const file = this.file(repo);
    return [
      `Map the user journeys of ${repo}.`,
      '',
      'Read the project to find every route a person takes through it: signing up, the main tasks, settings, payments, errors and dead ends. ' +
      'Use the code (routes, screens, handlers, API calls) as the source of truth, not the README alone. Do not change any file in the project.',
      '',
      `Write the map as JSON to ${file} (create it, or replace the old one). That is the only file you write. Shape:`,
      '',
      '{ "summary": "one line on what the product is",',
      '  "journeys": [ { "id": "signup", "name": "Sign up", "summary": "what the person is trying to do",',
      '    "steps": [ { "id": "s1", "kind": "entry", "label": "Lands on home", "detail": "one or two lines", "where": "src/pages/Home.tsx" } ],',
      '    "edges": [ { "from": "s1", "to": "s2", "label": "optional, e.g. \\"valid\\" or \\"no account\\"" } ] } ] }',
      '',
      `kind is one of: ${KINDS.join(', ')}. entry is where the journey starts; screen a page or view; action something the person does; ` +
      'decision a branch (label its edges); system work the app does out of sight (an API call, an email, a job); end where the journey finishes, good or bad.',
      'Keep labels short (under 40 characters). Ids are letters, digits, dashes. Order journeys by how often a person would take them. ' +
      `At most ${MAX_JOURNEYS} journeys and ${MAX_STEPS} steps each. If the project has no user-facing flow (a library, a CLI), map how a developer uses it instead.`,
      '',
      'When the file is written, reply with one line per journey.',
    ].join('\n');
  }
}

// Only the shape the canvas draws gets through: known kinds, short strings,
// edges between steps that exist.
function clean(raw, at) {
  if (!raw || !Array.isArray(raw.journeys)) return null;
  const journeys = [];
  for (const j of raw.journeys.slice(0, MAX_JOURNEYS)) {
    if (!j || !Array.isArray(j.steps)) continue;
    const steps = [];
    const ids = new Set();
    for (const s of j.steps.slice(0, MAX_STEPS)) {
      const id = typeof s?.id === 'string' && ID_RE.test(s.id) ? s.id : null;
      if (!id || ids.has(id)) continue;
      ids.add(id);
      steps.push({
        id,
        kind: KINDS.includes(s.kind) ? s.kind : 'screen',
        label: text(s.label, 60) || id,
        detail: text(s.detail, 400),
        where: text(s.where, 200),
      });
    }
    if (!steps.length) continue;
    const edges = (Array.isArray(j.edges) ? j.edges : []).slice(0, MAX_EDGES)
      .filter((e) => ids.has(e?.from) && ids.has(e?.to) && e.from !== e.to)
      .map((e) => ({ from: e.from, to: e.to, label: text(e.label, 30) }));
    journeys.push({
      id: typeof j.id === 'string' && ID_RE.test(j.id) ? j.id : `j${journeys.length + 1}`,
      name: text(j.name, 60) || `Journey ${journeys.length + 1}`,
      summary: text(j.summary, 300),
      steps, edges,
    });
  }
  return { summary: text(raw.summary, 300), updatedAt: at, journeys };
}
