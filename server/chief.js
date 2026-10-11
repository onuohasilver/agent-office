// The chief of staff: a fast model that reads each chat message and decides
// who should handle it. It never touches a project; it only routes.

import { spawn } from 'node:child_process';

const SCHEMA = {
  type: 'object',
  properties: {
    action: { type: 'string', enum: ['followup', 'new', 'dismiss', 'recall', 'standup', 'ask', 'chat'] },
    jobId: { type: 'string' },
    agentId: { type: 'string' },
    agentIds: { type: 'array', items: { type: 'string' } },
    repo: { type: 'string' },
    brief: { type: 'string' },
    say: { type: 'string' },
  },
  required: ['action', 'say'],
  additionalProperties: false,
};

const SYSTEM = `You are the chief of staff in an office of coding agents. The boss posts messages in the office chat. For each one, decide who handles it.

Actions:
- "followup": the message adds to, corrects, or asks about a job that already exists (working, queued or recently finished). Give its jobId. Prefer this whenever the message plausibly relates to an open job, especially the job of an agent the boss tagged.
- "new": a new piece of work. Give "repo" (exactly one name from Projects), "brief" (the task in the boss's own words, plus any context from recent chat that the agent needs; never add requirements), and "agentId" (the tagged agent's id; otherwise a free agent whose role in Staff clearly fits the work; otherwise "" for whoever is free). Never pick a busy or dismissed agent unless the boss tagged them.
- "dismiss": the boss wants agents sent home (dismissed, let go for now, off the floor). Give "agentIds": the ids of exactly who they mean, worked out from Staff (e.g. "everyone who's free except Mira" means every free agent but Mira). Only free agents can go; leave out anyone working.
- "recall": the boss wants dismissed agents back in. Give "agentIds" (every dismissed agent if they say "everyone").
- "standup": the boss wants the team to hold a standup now (e.g. "standup time", "let's do standup", "gather everyone for a status update").
- "ask": you can't tell which project new work belongs to, or the request is too unclear to start. Ask one short question.
- "chat": greetings, thanks, or questions about the office itself (who is doing what). Answer from the context given.

A message you passed to an agent ("Passed to…", "Adding this to…" in the chat) is now theirs and in hand; don't say it is waiting.

"say" is one short, warm line for the chat, in plain words, e.g. "Ada's on it." or "Passing that to Tunde, it fits what they're doing." Refer to agents only by name or as "they"; never "he", "she", "him" or "her". Never claim work is done.`;

export function route(context, { bin = 'claude', model = 'haiku', timeoutMs = 60000 } = {}) {
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
        const decision = r.structured_output || JSON.parse(r.result);
        resolve({ ...decision, cost: r.total_cost_usd || 0 });
      } catch {
        reject(new Error(err.trim().split('\n').pop() || 'The chief could not decide.'));
      }
    });
    child.stdin.end(context);
  });
}
