// A tiny MCP server (stdio, JSON-RPC) that gives an agent the office: who's
// around, messaging colleagues, handing work off, and the chat channels. It
// just relays to the office server, which knows which job is calling from
// OFFICE_JOB/OFFICE_TOKEN.

import readline from 'node:readline';

const URL_BASE = process.env.OFFICE_URL || 'http://127.0.0.1:4317';
const JOB = process.env.OFFICE_JOB;
const TOKEN = process.env.OFFICE_TOKEN;

const NONE = { type: 'object', properties: {}, additionalProperties: false };
const obj = (properties, required) => ({ type: 'object', properties, required, additionalProperties: false });
const names = { type: 'array', items: { type: 'string' } };

const TOOLS = [
  { name: 'office_roster', description: 'Who is in the office and what each is working on, or free.', inputSchema: NONE },
  {
    name: 'message_colleague',
    description: 'Short message to a colleague. Reaches them mid-task, or reopens their last job if finished within hours. wait_for_reply pauses you until they answer (10 min max); use only when blocked.',
    inputSchema: obj({ to: { type: 'string' }, message: { type: 'string' }, wait_for_reply: { type: 'boolean' } }, ['to', 'message']),
  },
  {
    name: 'hand_off',
    description: 'Give work to a free colleague, in this or another project. Their answer returns as a message. wait=false to carry on meanwhile. Fails if nobody is free.',
    inputSchema: obj({
      project: { type: 'string', description: 'Folder name, per office_roster' },
      brief: { type: 'string', description: 'Everything they need, self-contained' },
      to: { type: 'string', description: 'Omit for whoever is free' },
      wait: { type: 'boolean' },
    }, ['project', 'brief']),
  },
  {
    name: 'flag_for_boss',
    description: 'Surface something in the main chat for the boss: a question, decision, blocker, or work ready to review. Not for routine progress. One or two self-contained sentences.',
    inputSchema: obj({ kind: { type: 'string', enum: ['question', 'decision', 'blocker', 'review'] }, summary: { type: 'string' } }, ['kind', 'summary']),
  },
  {
    name: 'restart_office',
    description: 'Restart the office server so changes to its own code (agent-office/server) take effect. Waits until nobody is mid-turn, so end your turn right after; you are messaged when it is back. Not needed for web changes: a build is enough.',
    inputSchema: obj({ now: { type: 'boolean', description: 'Skip the wait and interrupt anyone mid-turn. Only if asked to.' } }, []),
  },
  { name: 'list_channels', description: 'List chat channels: purpose, members, and which one your work is in.', inputSchema: NONE },
  {
    name: 'create_channel',
    description: 'Open a channel for a distinct strand of work (release, incident, long project) and invite colleagues. Everyday talk stays in #general.',
    inputSchema: obj({ name: { type: 'string' }, purpose: { type: 'string' }, invite: names }, ['name']),
  },
  {
    name: 'invite_to_channel',
    description: 'Add colleagues to a channel; they see it from now on, not earlier history.',
    inputSchema: obj({ channel: { type: 'string' }, who: names }, ['channel', 'who']),
  },
  {
    name: 'post_to_channel',
    description: 'Say something to everyone in a channel (you join it). Working members get it at once. For one person use message_colleague.',
    inputSchema: obj({ channel: { type: 'string' }, message: { type: 'string' } }, ['channel', 'message']),
  },
];

const out = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');

async function call(name, args) {
  const res = await fetch(`${URL_BASE}/api/agent/${name}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-office-job': JOB, 'x-office-token': TOKEN },
    body: JSON.stringify(args || {}),
  });
  const data = await res.json().catch(() => ({}));
  return { text: data.text || data.error || `Office error ${res.status}`, isError: !res.ok };
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', async (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  if (id === undefined) return; // notifications need no answer
  try {
    if (method === 'initialize') {
      out({ jsonrpc: '2.0', id, result: {
        protocolVersion: params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'office', version: '1.0.0' },
      } });
    } else if (method === 'tools/list') {
      out({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    } else if (method === 'tools/call') {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) throw new Error(`Unknown tool ${params?.name}`);
      const r = await call(tool.name, params.arguments);
      out({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: r.text }], isError: r.isError } });
    } else if (method === 'ping') {
      out({ jsonrpc: '2.0', id, result: {} });
    } else {
      out({ jsonrpc: '2.0', id, error: { code: -32601, message: `No method ${method}` } });
    }
  } catch (err) {
    out({ jsonrpc: '2.0', id, error: { code: -32000, message: err.message } });
  }
});
