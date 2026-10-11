// A tiny MCP server (stdio, JSON-RPC) that gives an agent the office: who's
// around, messaging colleagues, handing work off, and the chat channels. It
// just relays to the office server, which knows which job is calling from
// OFFICE_JOB/OFFICE_TOKEN.

import readline from 'node:readline';

const URL_BASE = process.env.OFFICE_URL || 'http://127.0.0.1:4317';
const JOB = process.env.OFFICE_JOB;
const TOKEN = process.env.OFFICE_TOKEN;

const TOOLS = [
  {
    name: 'office_roster',
    description: 'See who is in the office right now and what each colleague is working on (project and task), or whether they are free.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'message_colleague',
    description: 'Send a short message to a colleague. It reaches them mid-task, or picks their last job back up if they finished it in the last few hours (so you can answer someone who is waiting to hear from you). Use it to ask a question, share something they need, or coordinate. Set wait_for_reply when you cannot continue without their answer; your session then pauses until they reply (up to 10 minutes).',
    inputSchema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'Colleague name, e.g. "Ada"' },
        message: { type: 'string' },
        wait_for_reply: { type: 'boolean', default: false },
      },
      required: ['to', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: 'hand_off',
    description: 'Hand a piece of work to a free colleague, in this project or another one. Their final answer comes back to you as a message. By default you wait for it; set wait=false to carry on in parallel (their result still reaches you if you are still working). Fails if nobody suitable is free.',
    inputSchema: {
      type: 'object',
      properties: {
        project: { type: 'string', description: 'Project folder name; office_roster lists them' },
        brief: { type: 'string', description: 'Everything they need to do the work without asking you' },
        to: { type: 'string', description: 'Colleague name, or omit for whoever is free' },
        wait: { type: 'boolean', default: true },
      },
      required: ['project', 'brief'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_channels',
    description: 'The office chat is split into channels, the way Slack is. This lists them: what each one is for, who is in it, and which one your own work is being discussed in.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'create_channel',
    description: 'Open a new channel for a strand of work, and put the colleagues who need to follow it in it. Use it when something deserves its own place to be discussed — a release, an incident, one long-running project — rather than everyday talk, which belongs in #general. The boss sees every channel.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short channel name, e.g. "releases" (lowercased and hyphenated for you)' },
        purpose: { type: 'string', description: 'One line on what the channel is for, shown to everyone' },
        invite: { type: 'array', items: { type: 'string' }, description: 'Colleague names to add, e.g. ["Ada", "Tunde"]' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'invite_to_channel',
    description: 'Add colleagues to a channel that already exists, so they get what is said in it from now on. It does not show them what was said before they joined.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name, with or without the #' },
        who: { type: 'array', items: { type: 'string' }, description: 'Colleague names, e.g. ["Mira"]' },
      },
      required: ['channel', 'who'],
      additionalProperties: false,
    },
  },
  {
    name: 'post_to_channel',
    description: 'Say something in a channel. Everyone in it who is on a job gets it straight away, the way message_colleague reaches one person; anyone free reads it in the channel when they are next working. Posting in a channel also puts you in it. Use it for something the whole group needs; for one person, message_colleague is better.',
    inputSchema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name, with or without the #' },
        message: { type: 'string' },
      },
      required: ['channel', 'message'],
      additionalProperties: false,
    },
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
