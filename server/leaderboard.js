// The leaderboard, from this machine's side.
//
// Two things live here. The ledger always runs: per UTC day, how many jobs
// finished, how many tokens were used and how long the agents spent working, kept in data/activity.json so it
// survives clearing the job list. Sharing is separate and off until the boss
// joins: then the last two weeks of those counters, under a claimed handle,
// go to the leaderboard service. Nothing else is ever sent, no prompts, repos,
// file names, chat or cost. See docs/leaderboard.md.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

// Where the hosted service lives. OFFICE_LEADERBOARD_URL overrides it.
const DEFAULT_URL = '';
const WINDOW_DAYS = 14;
const DEBOUNCE_MS = 45 * 1000;
const RETRY_MS = 10 * 60 * 1000;
const HANDLE_RE = /^[a-z0-9][a-z0-9_-]{2,19}$/i;

const utcDay = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
const fail = (code, message) => Object.assign(new Error(message), { code });

function writeAtomic(file, data, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data), { mode });
  fs.renameSync(tmp, file);
}

export class Leaderboard {
  constructor(dataDir, { onChange = () => {} } = {}) {
    this.ledgerFile = path.join(dataDir, 'activity.json');
    this.idFile = path.join(dataDir, 'leaderboard.json');
    this.onChange = onChange;
    this.days = {};
    try { this.days = JSON.parse(fs.readFileSync(this.ledgerFile, 'utf8')).days || {}; } catch {}
    this.me = {};
    try { this.me = JSON.parse(fs.readFileSync(this.idFile, 'utf8')); } catch {}
    this.error = null;
    this.lastSync = this.me.lastSync || 0;
    this.dirty = !!this.me.secret;
    this.timer = null;
    this.saveTimer = null;
    this.busy = false;
    if (this.dirty) this.later(15 * 1000);
  }

  get url() { return (process.env.OFFICE_LEADERBOARD_URL || DEFAULT_URL).replace(/\/+$/, ''); }
  get joined() { return !!(this.me.secret && this.me.handle); }

  status() {
    return {
      configured: !!this.url,
      joined: this.joined,
      handle: this.me.handle || null,
      lastSync: this.lastSync || null,
      error: this.error,
      today: this.total(1),
      week: this.total(7),
    };
  }

  // Counters over the last `n` UTC days, today included.
  total(n) {
    const out = { jobs: 0, tokens: 0, seconds: 0, activeDays: 0 };
    for (let i = 0; i < n; i++) {
      const d = this.days[utcDay(Date.now() - i * 86_400_000)];
      if (!d) continue;
      out.jobs += d.jobs;
      out.tokens += d.tokens;
      out.seconds += Math.round(d.seconds || 0);
      if (d.jobs > 0) out.activeDays++;
    }
    return out;
  }

  // ---------- the ledger ----------

  bump(field, n) {
    if (!(n > 0)) return;
    const key = utcDay();
    const d = (this.days[key] ||= { jobs: 0, tokens: 0, seconds: 0 });
    d[field] ||= 0;
    d[field] += n; // seconds stay fractional so short turns add up; they are rounded on the way out
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flush(), 2000);
    if (this.joined) { this.dirty = true; this.later(DEBOUNCE_MS); }
  }
  // Input plus output tokens. Cached context is left out: it is the same
  // tokens read again, and counting it would only reward long sessions.
  addTokens(n) { this.bump('tokens', n); }
  addJob() { this.bump('jobs', 1); }
  // Agent time: the time agents spent on turns, summed. Two agents working
  // side by side for an hour is two hours; waiting on someone isn't counted.
  addTime(ms) { this.bump('seconds', ms / 1000); }

  flush() {
    clearTimeout(this.saveTimer);
    writeAtomic(this.ledgerFile, { days: this.days });
  }

  // ---------- sharing ----------

  later(ms) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.sync().catch(() => {}), ms);
    this.timer.unref?.();
  }

  async call(method, route, { body, secret = this.me.secret } = {}) {
    if (!this.url) throw fail(400, 'No leaderboard is set up for this office yet. Set OFFICE_LEADERBOARD_URL.');
    if (!/^https:\/\//.test(this.url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(this.url)) throw fail(400, 'The leaderboard address must be https.');
    let res;
    try {
      res = await fetch(this.url + route, {
        method,
        headers: { 'content-type': 'application/json', ...(secret ? { authorization: `Bearer ${secret}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      throw fail(502, 'Couldn’t reach the leaderboard.');
    }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw fail(res.status, out.error || `The leaderboard answered ${res.status}.`);
    return out;
  }

  async join(handle) {
    handle = String(handle ?? '').trim();
    if (!HANDLE_RE.test(handle)) throw fail(400, 'A handle is 3 to 20 letters, numbers, - or _.');
    // A secret made once and kept: if the answer to a claim is lost, asking
    // again with the same secret is safe.
    const secret = this.me.secret || crypto.randomBytes(32).toString('hex');
    const out = await this.call('POST', '/v1/claim', { body: { handle }, secret });
    this.me = { ...this.me, secret, handle: out.handle, lastSync: 0 };
    writeAtomic(this.idFile, this.me, 0o600);
    this.error = null;
    this.dirty = true;
    this.later(500);
    return this.status();
  }

  async sync() {
    if (!this.joined || !this.dirty || this.busy) return;
    this.busy = true;
    try {
      const since = utcDay(Date.now() - WINDOW_DAYS * 86_400_000);
      const days = Object.entries(this.days)
        .filter(([day]) => day >= since)
        .map(([day, d]) => ({ day, jobs: d.jobs, tokens: d.tokens, seconds: Math.round(d.seconds || 0) }));
      if (days.length) await this.call('PUT', '/v1/days', { body: { days } });
      this.dirty = false;
      this.error = null;
      this.lastSync = Date.now();
      this.me.lastSync = this.lastSync;
      writeAtomic(this.idFile, this.me, 0o600);
    } catch (err) {
      this.error = err.message;
      // Too fast or the network is down: try again in a while. A refusal that
      // won't change (401) is left for the boss to see rather than hammered.
      if (err.code !== 401 && err.code !== 400) this.later(err.code === 429 ? DEBOUNCE_MS : RETRY_MS);
    } finally {
      this.busy = false;
      this.onChange();
    }
  }

  // Stops sharing and asks the service to forget this office. If it can't be
  // reached nothing local changes, so the boss can try again rather than be
  // left believing it is gone.
  async leave() {
    if (this.joined) {
      try { await this.call('DELETE', '/v1/me'); }
      catch (err) { if (err.code !== 401) throw err; } // 401: the service has already forgotten it
    }
    clearTimeout(this.timer);
    this.me = {};
    try { fs.rmSync(this.idFile, { force: true }); } catch {}
    this.dirty = false;
    this.error = null;
    this.lastSync = 0;
    return this.status();
  }

  async board(period) {
    return this.call('GET', `/v1/board?period=${period === 'all' ? 'all' : 'week'}`, { secret: null });
  }
}
