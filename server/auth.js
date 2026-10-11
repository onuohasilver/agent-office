// How the office's claude processes sign in: the Claude Code login already on
// this machine, or an Anthropic API key the boss gives it. The key lives in
// its own file, readable only by you, and never goes to the browser: the
// page only ever learns which way is chosen and the key's last four.

import fs from 'node:fs';
import path from 'node:path';

const MODES = ['login', 'apikey'];

export class Auth {
  constructor(dataDir) {
    this.file = path.join(dataDir, 'auth.json');
    let saved = {};
    try { saved = JSON.parse(fs.readFileSync(this.file, 'utf8')); } catch {}
    this.key = typeof saved.key === 'string' ? saved.key : '';
    // Until someone chooses, a key already in the environment is the choice,
    // which is what `claude` itself would have done with it.
    this.mode = MODES.includes(saved.mode) ? saved.mode : process.env.ANTHROPIC_API_KEY ? 'apikey' : 'login';
  }

  // The key that will be used: the one saved here, else the environment's.
  current() { return this.key || process.env.ANTHROPIC_API_KEY || ''; }

  status() {
    const k = this.current();
    return { mode: this.mode, keySet: !!k, keyHint: k ? k.slice(-4) : null, keyFrom: this.key ? 'office' : k ? 'env' : null };
  }

  // The environment for a claude child. With the login chosen, a key lying
  // around in the shell must not quietly take over (claude prefers a key to
  // the login); with a key chosen, nothing else may outrank it.
  env(base = process.env) {
    const env = { ...base };
    delete env.ANTHROPIC_API_KEY;
    if (this.mode === 'apikey') {
      delete env.ANTHROPIC_AUTH_TOKEN;
      delete env.CLAUDE_CODE_OAUTH_TOKEN;
      const k = this.current();
      if (k) env.ANTHROPIC_API_KEY = k;
    }
    return env;
  }

  async set({ mode, key }) {
    if (!MODES.includes(mode)) throw Object.assign(new Error('Pick the Claude Code login or an API key.'), { code: 400 });
    key = typeof key === 'string' ? key.trim() : '';
    if (key) {
      if (!/^sk-ant-[\w-]{20,}$/.test(key)) throw Object.assign(new Error("That doesn't look like an Anthropic API key (sk-ant-…)."), { code: 400 });
      await check(key);
      this.key = key;
    }
    if (mode === 'apikey' && !this.current()) throw Object.assign(new Error('Paste an API key first.'), { code: 400 });
    this.mode = mode;
    this.save();
    return this.status();
  }

  forget() {
    this.key = '';
    if (this.mode === 'apikey' && !this.current()) this.mode = 'login';
    this.save();
    return this.status();
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ mode: this.mode, key: this.key || undefined }), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    fs.chmodSync(this.file, 0o600);
  }
}

// One cheap call that costs no tokens, so a typo is caught here rather than
// as a failed job five minutes later.
async function check(key) {
  let res;
  try {
    res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw Object.assign(new Error("Couldn't reach Anthropic to check the key. Try again."), { code: 502 });
  }
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error('Anthropic rejected that key.'), { code: 400 });
  if (!res.ok && res.status !== 429) throw Object.assign(new Error(`Couldn't check the key (${res.status}).`), { code: 502 });
}
