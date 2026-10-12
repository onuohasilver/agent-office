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

// Where the hosted service lives (leaderboard/, deployed on Cloudflare).
// OFFICE_LEADERBOARD_URL overrides it, for a self-hosted board or a test.
const DEFAULT_URL = 'https://agent-office-leaderboard.agent-office-leaderboard.workers.dev';
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
    this.dirty = this.joined;
    this.timer = null;
    this.saveTimer = null;
    this.busy = false;
    if (this.dirty) this.later(15 * 1000);
  }

  get url() { return (process.env.OFFICE_LEADERBOARD_URL || DEFAULT_URL).replace(/\/+$/, ''); }
  // A handle is this office's name to the service, and linked offices need
  // one too. Being on the board is a separate choice: `share` is false for an
  // office that only claimed a handle. Older files have no `share`, and they
  // all joined to share.
  get named() { return !!(this.me.secret && this.me.handle); }
  get joined() { return this.named && this.me.share !== false; }

  status() {
    return {
      configured: !!this.url,
      joined: this.joined,
      sharing: this.joined,
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

  // The service address, checked, for anything that talks to it: https (or
  // this machine), and, when the office's secret goes along, the very service
  // that secret was made for. Older files don't say which that was, so the
  // first service they are used with is taken as it.
  endpoint({ withSecret = true } = {}) {
    const url = this.url;
    if (!url) throw fail(400, 'No leaderboard is set up for this office yet. Set OFFICE_LEADERBOARD_URL.');
    if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/.test(url)) throw fail(400, 'The leaderboard address must be https.');
    if (withSecret && this.me.secret) {
      if (!this.me.service) {
        this.me.service = url;
        writeAtomic(this.idFile, this.me, 0o600);
      } else if (this.me.service !== url) {
        throw fail(421, `This office’s handle belongs to ${this.me.service}, so its secret isn’t sent to ${url}. Set OFFICE_LEADERBOARD_URL back to use it.`);
      }
    }
    return url;
  }

  async call(method, route, { body, secret = this.me.secret } = {}) {
    // A brand-new secret (a first claim) is made for whichever service this is.
    const url = this.endpoint({ withSecret: !!secret && secret === this.me.secret });
    let res;
    try {
      res = await fetch(url + route, {
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

  // Claims a handle without joining the board. An office that already has
  // one keeps it; the service holds one handle per secret.
  async claim(handle) {
    if (this.named && (handle === undefined || String(handle).trim().toLowerCase() === this.me.handle.toLowerCase())) return this.status();
    handle = String(handle ?? '').trim();
    if (!HANDLE_RE.test(handle)) throw fail(400, 'A handle is 3 to 20 letters, numbers, - or _.');
    // A secret made once and kept: if the answer to a claim is lost, asking
    // again with the same secret is safe.
    const secret = this.me.secret || crypto.randomBytes(32).toString('hex');
    const out = await this.call('POST', '/v1/claim', { body: { handle }, secret });
    this.me = { share: false, ...this.me, secret, service: this.url, handle: out.handle, lastSync: 0 };
    writeAtomic(this.idFile, this.me, 0o600);
    this.error = null;
    this.onChange();
    return this.status();
  }

  async join(handle) {
    await this.claim(handle);
    this.me.share = true;
    writeAtomic(this.idFile, this.me, 0o600);
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

  // Stops sharing and asks the service to delete the counters. With
  // `keepHandle` (the office has linked offices) the handle stays, so the
  // links do; otherwise the service forgets this office entirely. If it can't
  // be reached nothing local changes, so the boss can try again rather than
  // be left believing it is gone.
  async leave({ keepHandle = false } = {}) {
    if (keepHandle && this.named) {
      try { await this.call('DELETE', '/v1/days'); }
      catch (err) { if (err.code !== 401) throw err; }
      clearTimeout(this.timer);
      this.me.share = false;
      writeAtomic(this.idFile, this.me, 0o600);
      this.dirty = false;
      this.error = null;
      return this.status();
    }
    if (this.named) {
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
