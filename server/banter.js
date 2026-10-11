// Break-room small talk, written by the model. Two agents idling in the break
// room trade a few lines; one short call writes the whole exchange from who
// they are, how they feel about each other, what they have been working on and
// what was said lately, so it costs a fraction of a chat message. If the call
// fails the browser falls back to its canned chats.

import { spawn } from 'node:child_process';

const SCHEMA = {
  type: 'object',
  properties: { lines: { type: 'array', items: { type: 'string' } } },
  required: ['lines'],
  additionalProperties: false,
};

const SYSTEM = `You write the small talk when two coworkers in an office of coding agents bump into each other in the break room. You get a sheet for each: role, personality, background, their story, and how they feel about colleagues. You also get what each has been working on and the last things said in the break room.

Write 4 to 6 lines, alternating speakers, starting with the first person named. Rules:
- Each line is one short sentence or two, under 110 characters, said out loud.
- Stay in character for each. Let their story, their ties to each other and their recent work colour it, but only sometimes: plenty of chats are just coffee, the weekend, a bad error message or a joke. Never force a reference in.
- Warm, funny, specific. A real exchange with a small turn or a punchline, not a recap of the sheets.
- Do not repeat or lightly reword anything in the recent lines; start somewhere new.
- Use real names for people. Never "he", "she", "him" or "her" about anyone.
- Plain words. No markdown, emoji, quotation marks around lines, speaker labels or stage directions.`;

export function writeBanter(context, { bin = 'claude', model = 'haiku', timeoutMs = 15000, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '-p', '--model', model, '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA),
      '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence',
      '--system-prompt', SYSTEM,
    ];
    const child = spawn(bin, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const r = JSON.parse(out);
        const { lines } = r.structured_output || JSON.parse(r.result);
        const clean = lines.map((l) => String(l).replace(/\s+/g, ' ').trim().slice(0, 200)).filter(Boolean).slice(0, 6);
        if (clean.length < 2) throw new Error('Too short.');
        resolve({ lines: clean, cost: r.total_cost_usd || 0 });
      } catch {
        reject(new Error(err.trim().split('\n').pop() || 'Could not write the banter.'));
      }
    });
    child.stdin.end(context);
  });
}
