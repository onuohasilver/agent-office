#!/usr/bin/env node
// A stand-in for `claude` used only by the launch-video sandbox (port 4399).
// No model is called. It speaks just enough of the CLI's stream-json to drive
// the office: the chief's routing call gets a fixed decision, and each job
// plays a short script of tool calls. The capture script decides when each
// step happens by writing a number into GATE/<job> (how many steps may run),
// so what the camera sees is timed to the frame, not to the wall clock.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const GATE = process.env.STUB_GATE || '/tmp/office-demo/gate';
const args = process.argv.slice(2);
const out = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (s) => fs.appendFileSync(path.join(GATE, 'stub.log'), `${new Date().toISOString()} ${process.pid} ${s}\n`);
fs.mkdirSync(GATE, { recursive: true });

// Waits until the gate file allows step `n` (1-based).
async function gate(name, n) {
  const f = path.join(GATE, name);
  for (;;) {
    let v = 0;
    try { v = parseInt(fs.readFileSync(f, 'utf8'), 10) || 0; } catch {}
    if (v >= n) return;
    await sleep(40);
  }
}

// Gives up after half an hour so a forgotten stub never lingers.
setTimeout(() => process.exit(0), 30 * 60 * 1000).unref();

// ---------- the chief ----------
if (args.includes('--json-schema')) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => (input += d));
  process.stdin.on('end', async () => {
    const said = (input.match(/New message from the boss: (.*)/) || [])[1] || '';
    log(`chief: ${said}`);
    await gate('chief', 1);
    const d = /checkout/i.test(said)
      ? { action: 'new', repo: 'storefront', agentId: 'ada', model: 'sonnet',
          brief: 'The checkout button is cut off on small phones. Fix it so it fits on narrow screens.',
          say: "Ada's on it. It's front-end work." }
      : { action: 'chat', say: 'Happy to help. What do you need?' };
    out({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(d), structured_output: d, total_cost_usd: 0.0031 });
    process.exit(0);
  });
} else {
  runJob();
}

// ---------- a job ----------

const SCRIPTS = {
  // Ada: the checkout button.
  ada: {
    match: /checkout/i,
    model: 'claude-sonnet-5-5',
    steps: [
      { tool: 'TodoWrite', input: { todos: [
        { content: 'Find the checkout bar styles', status: 'in_progress' },
        { content: 'Let the button shrink on narrow screens', status: 'pending' },
        { content: 'Check it at 320px', status: 'pending' } ] } },
      { tool: 'Grep', input: { pattern: 'checkout-button' } },
      { tool: 'Read', input: { file_path: 'src/components/CheckoutBar.css' } },
      { text: 'The button has a fixed 360px width, so it runs off anything narrower.' },
      { tool: 'Edit', input: { file_path: 'src/components/CheckoutBar.css' }, edit: 'checkoutCss' },
      { tool: 'Edit', input: { file_path: 'src/components/CheckoutBar.jsx' }, edit: 'checkoutJsx' },
      { tool: 'Bash', input: { command: 'npm test -- CheckoutBar', description: 'Running the CheckoutBar tests' } },
      { result: 'Fixed. The checkout button had a fixed 360px width; it now fills the bar up to 360px and wraps its label on narrow screens. Tested at 320px. Changed CheckoutBar.css and CheckoutBar.jsx.', cost: 0.41 },
    ],
  },
  tunde: {
    match: /webhook/i,
    model: 'claude-sonnet-5-5',
    steps: [
      { tool: 'Glob', input: { pattern: 'src/webhooks/**/*.js' } },
      { tool: 'Read', input: { file_path: 'src/webhooks/sender.js' } },
      { tool: 'Edit', input: { file_path: 'src/webhooks/sender.js' }, edit: 'retry' },
      { tool: 'Bash', input: { command: 'npm test', description: 'Running the webhook tests' } },
      { result: 'Webhook sends now retry up to 3 times with backoff (1s, 4s, 9s), and only on network errors and 5xx. Tests pass.', cost: 0.33 },
    ],
  },
  mira: {
    match: /changelog|docs/i,
    model: 'claude-haiku-5-5',
    steps: [
      { tool: 'Read', input: { file_path: 'CHANGELOG.md' } },
      { tool: 'Bash', input: { command: 'git log --oneline -12', description: 'Reading the last dozen commits' } },
      { tool: 'Edit', input: { file_path: 'CHANGELOG.md' }, edit: 'changelog' },
      { result: 'Added a 2.4.0 entry to the changelog: the narrow-screen checkout fix and webhook retries.', cost: 0.09 },
    ],
  },
};

const EDITS = {
  checkoutCss: (cwd) => rewrite(cwd, 'src/components/CheckoutBar.css', (s) => s
    .replace('  width: 360px;\n', '  width: 100%;\n  max-width: 360px;\n  min-width: 0;\n')
    .replace('  white-space: nowrap;\n', '  white-space: normal;\n  overflow-wrap: anywhere;\n')),
  checkoutJsx: (cwd) => rewrite(cwd, 'src/components/CheckoutBar.jsx', (s) => s
    .replace('<button className="checkout-button">', '<button className="checkout-button" type="submit">')),
  retry: (cwd) => rewrite(cwd, 'src/webhooks/sender.js', (s) => s
    .replace("export async function send(url, body) {\n  return post(url, body);\n}",
      "const RETRIES = 3;\n\nexport async function send(url, body) {\n  for (let attempt = 1; ; attempt++) {\n    try {\n      return await post(url, body);\n    } catch (err) {\n      if (attempt > RETRIES || !retryable(err)) throw err;\n      await wait(attempt * attempt * 1000);\n    }\n  }\n}\n\nconst retryable = (err) => err.network || err.status >= 500;\nconst wait = (ms) => new Promise((r) => setTimeout(r, ms));")),
  changelog: (cwd) => rewrite(cwd, 'CHANGELOG.md', (s) => s
    .replace('# Changelog\n', '# Changelog\n\n## 2.4.0\n\n- Checkout button fits narrow phones.\n- Webhook sends retry with backoff.\n')),
};

function rewrite(cwd, rel, fn) {
  const f = path.join(cwd, rel);
  try { fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8'))); } catch (e) { log(`edit failed ${rel}: ${e.message}`); }
}

function runJob() {
  let buf = '';
  let started = false;
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i);
      buf = buf.slice(i + 1);
      let m;
      try { m = JSON.parse(line); } catch { continue; }
      const text = typeof m.message?.content === 'string' ? m.message.content : '';
      if (!started) { started = true; play(text); } else log(`job got: ${text.slice(0, 80)}`);
    }
  });
  // The office closes stdin once the last turn is over.
  process.stdin.on('end', () => process.exit(0));
}

async function play(prompt) {
  const [name, script] = Object.entries(SCRIPTS).find(([, s]) => s.match.test(prompt)) || ['other', null];
  log(`job ${name}: ${prompt.slice(0, 80)}`);
  const session = crypto.randomUUID();
  out({ type: 'system', subtype: 'init', session_id: session, model: script?.model || 'claude-sonnet-5-5', tools: [] });
  if (!script) {
    out({ type: 'result', subtype: 'success', is_error: false, result: 'Done.', total_cost_usd: 0.01, session_id: session });
    return;
  }
  let n = 0;
  for (const step of script.steps) {
    n++;
    await gate(name, n);
    if (step.tool) {
      out({ type: 'assistant', session_id: session, message: { role: 'assistant', content: [
        { type: 'tool_use', id: `toolu_${n}`, name: step.tool, input: step.input } ] } });
      if (step.edit) EDITS[step.edit](process.cwd());
      out({ type: 'user', session_id: session, message: { role: 'user', content: [
        { type: 'tool_result', tool_use_id: `toolu_${n}`, content: 'ok' } ] } });
    } else if (step.text) {
      out({ type: 'assistant', session_id: session, message: { role: 'assistant', content: [{ type: 'text', text: step.text }] } });
    } else if (step.result) {
      out({ type: 'assistant', session_id: session, message: { role: 'assistant', content: [{ type: 'text', text: step.result }] } });
      out({ type: 'result', subtype: 'success', is_error: false, result: step.result, total_cost_usd: step.cost,
        duration_ms: 90000, session_id: session, usage: { input_tokens: 2100, cache_read_input_tokens: 31000, cache_creation_input_tokens: 4200 } });
    }
  }
}
