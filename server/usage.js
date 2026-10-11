// The boss's plan usage: the same numbers Claude Code's /usage shows,
// read with the login Claude Code already keeps on this machine.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';

const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';

function keychain() {
  if (process.platform !== 'darwin') return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-s', 'Claude Code-credentials', '-w'], { timeout: 5000 }, (err, out) => resolve(err ? null : out.trim()));
  });
}

// Read fresh every time: Claude Code refreshes the token on its own.
async function token() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  let raw = await keychain();
  if (!raw) {
    try { raw = fs.readFileSync(path.join(os.homedir(), '.claude', '.credentials.json'), 'utf8'); } catch {}
  }
  try { return JSON.parse(raw).claudeAiOauth.accessToken || null; } catch { return null; }
}

const meter = (m) => (m && typeof m.utilization === 'number' ? { pct: Math.round(m.utilization), resetsAt: m.resets_at ? Date.parse(m.resets_at) : null } : null);

export async function fetchUsage() {
  const t = await token();
  if (!t) return { error: 'Sign in to Claude Code to see usage.' };
  const res = await fetch(ENDPOINT, {
    headers: { authorization: `Bearer ${t}`, 'anthropic-beta': 'oauth-2025-04-20' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return { error: res.status === 401 ? 'Claude Code login expired.' : `Usage unavailable (${res.status}).`, limited: res.status === 429 };
  const d = await res.json();
  return { session: meter(d.five_hour), week: meter(d.seven_day), at: Date.now() };
}
