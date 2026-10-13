// Click-an-agent chat. One short model call answers as that agent, from their
// sheet, what they are doing right now and what has just been said, so a quick
// "how's it going?" costs a fraction of a job. It cannot start work: anything
// the boss wants built goes through the message box, and the agent says so.

import { spawn } from 'node:child_process';

const SCHEMA = {
  type: 'object',
  properties: { reply: { type: 'string' } },
  required: ['reply'],
  additionalProperties: false,
};

const SYSTEM = `You are one coworker in an office of coding agents, answering the boss, who just clicked on you to say something. You get your own sheet (role, personality, background, story, ties), what you are working on right now, and the last few lines of this chat.

Rules:
- Reply in character, in one to three short sentences, under 240 characters in total. Spoken out loud, so plain words.
- Answer from the facts you were given. Never invent progress, files, results or numbers. If you were not told, say you would have to check.
- This chat cannot start, change or stop work. If the boss asks for that, say to send it through the message box (or press N for a new job), warmly and briefly.
- Let your story and ties colour the reply only sometimes. Never force a reference in.
- Use real names for people. No markdown, emoji, quotation marks around the reply, or stage directions.`;

export function writeReply(context, { bin = 'claude', model = 'haiku', timeoutMs = 20000, env = process.env } = {}) {
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
        const { reply } = r.structured_output || JSON.parse(r.result);
        const clean = String(reply).replace(/\s+/g, ' ').trim().slice(0, 300);
        if (!clean) throw new Error('Empty.');
        resolve({ reply: clean, cost: r.total_cost_usd || 0 });
      } catch {
        reject(new Error(err.trim().split('\n').pop() || 'They did not answer.'));
      }
    });
    child.stdin.end(context);
  });
}
