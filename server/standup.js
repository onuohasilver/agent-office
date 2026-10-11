// The daily standup: everyone on the floor says what they got done, what's
// next and what's in their way, and the chief wraps up. One model call
// writes every update from the job history, so it costs about one chat
// message. If that call fails, the updates are built from the facts alone.

import { spawn } from 'node:child_process';

const SCHEMA = {
  type: 'object',
  properties: {
    updates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          agentId: { type: 'string' },
          done: { type: 'string' },
          today: { type: 'string' },
          blockers: { type: 'string' },
        },
        required: ['agentId', 'done', 'today', 'blockers'],
        additionalProperties: false,
      },
    },
    wrap: { type: 'string' },
  },
  required: ['updates', 'wrap'],
  additionalProperties: false,
};

const SYSTEM = `You run the daily standup in an office of coding agents. You get each agent's facts: jobs they finished since the last standup, what they're on now, what's queued for them, and anything that went wrong.

Write one update per agent, in that agent's own voice (first person, casual, like a real startup standup):
- "done": what they finished, in a sentence or two. Name the project. Say plainly if something failed or was stopped. "Nothing shipped since last standup." if there's nothing.
- "today": what they're on now or picking up next. If nothing, they're free and say so.
- "blockers": what's in their way (failed jobs, missing clearance, waiting on someone), or "" if nothing.

Then "wrap": the chief of staff closing the standup in one to three short sentences: what the office is focused on, anything at risk, and who's free to take work. If two agents are in the same project, point it out so they can sync.

Use only the facts given; never invent work, results or blockers. Refer to agents by name or as "they"; never "he", "she", "him" or "her". Plain words, no markdown, no emoji.`;

export function writeStandup(context, { bin = 'claude', model = 'sonnet', timeoutMs = 90000 } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', '--model', model, '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA),
      '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence',
      '--system-prompt', SYSTEM,
    ];
    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out);
        const notes = r.structured_output || JSON.parse(r.result);
        resolve({ ...notes, cost: r.total_cost_usd || 0 });
      } catch {
        reject(new Error(err.trim().split('\n').pop() || 'Could not write the standup.'));
      }
    });
    child.stdin.end(context);
  });
}

// When today's standup is due, as a timestamp, or null if there's none today.
// `at` is "HH:MM" local time; standups are weekdays only unless `weekends`.
export function dueToday(at, weekends, now = new Date()) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(at || '').trim());
  if (!m) return null;
  if (!weekends && (now.getDay() === 0 || now.getDay() === 6)) return null;
  const due = new Date(now);
  due.setHours(Number(m[1]), Number(m[2]), 0, 0);
  return due.getTime();
}
