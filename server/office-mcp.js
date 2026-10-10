// A tiny MCP server (stdio, JSON-RPC) that gives an agent the office: who's
// around, messaging colleagues, and handing work off. It just relays to the
// office server, which knows which job is calling from OFFICE_JOB/OFFICE_TOKEN.

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
    description: 'Send a short message to a colleague who is working right now. It reaches them mid-task. Use it to ask a question, share something they need, or coordinate. Set wait_for_reply when you cannot continue without their answer; your session then pauses until they reply (up to 10 minutes).',
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
