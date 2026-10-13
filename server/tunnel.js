// A public address for the office, so a phone can reach it from anywhere: a
// Cloudflare quick tunnel. `cloudflared` dials out from this machine and gives
// back a random https://….trycloudflare.com name that forwards to the office,
// so nothing listens on the network and no router is touched. No account.
//
// It is only ever started by an explicit click, never at boot, and it dies
// with the office. The address is new every time. Whoever has the link with
// the key can run Claude here, so the key stays the one thing that matters.
//
// It is only called on once the address works from outside: a phone that
// looks a name up too early caches "no such name" for minutes, and a tunnel
// can connect yet route nowhere (see emptyConfig). Either way the phone would
// show a blank page, so the QR waits.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import https from 'node:https';
import { Resolver } from 'node:dns/promises';

// cloudflared reads ~/.cloudflared/config.yml even for a quick tunnel, and a
// named tunnel's ingress there (ending, as they do, in http_status:404) then
// answers every request to our address with an empty 404: a blank page on the
// phone. So it gets a config of its own, with nothing in it.
function emptyConfig() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'office-tunnel-')), 'config.yml');
  fs.writeFileSync(file, '');
  return file;
}

// Does https://host/ reach this office from the internet? Looked up on public
// resolvers, not this machine's, which may have cached the name as missing.
// The office answers a keyless visit with 401, which Cloudflare never sends.
const resolver = new Resolver({ timeout: 3000, tries: 1 });
resolver.setServers(['1.1.1.1', '8.8.8.8']);
export async function reachable(host) {
  let ip;
  try { [ip] = await resolver.resolve4(host); } catch { return false; }
  if (!ip) return false;
  return new Promise((resolve) => {
    const req = https.get({ host: ip, servername: host, headers: { host }, path: '/', timeout: 8000 }, (res) => { res.resume(); resolve(res.statusCode === 401); });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

const URL_RE = /https:\/\/([a-z0-9-]+\.trycloudflare\.com)/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Tunnel {
  // findBin() gives the cloudflared to run (it may download it, calling
  // onStep('download')); allow(host) lets the office accept that Host and
  // forget(host) takes it back; check(host) is the outside check.
  constructor({ port, allow, forget, findBin, check = reachable, onChange = () => {} }) {
    Object.assign(this, { port, allow, forget, findBin, check, onChange });
    this.state = 'off'; // off | starting | on | error
    this.step = null; // while starting: download | connect | check
    this.host = null;
    this.error = null;
    this.child = null;
    this.run = 0; // bumped by every start and stop, so a stale run stands down
  }

  status() {
    return { state: this.state, step: this.state === 'starting' ? this.step : null, url: this.state === 'on' ? `https://${this.host}` : null, error: this.error };
  }

  set(state, extra = {}) {
    Object.assign(this, { state, error: null, ...extra });
    this.onChange(this.status());
  }

  start() {
    if (this.state === 'starting' || this.state === 'on') return this.status();
    const run = ++this.run;
    this.set('starting', { host: null, step: 'connect' });
    this.boot(run).catch((err) => { if (run === this.run) this.fail(err.message); });
    return this.status();
  }

  async boot(run) {
    const bin = await this.findBin((step) => { if (run === this.run) this.set('starting', { step }); });
    if (run !== this.run) return;
    this.set('starting', { step: 'connect' });
    const host = await new Promise((resolve, reject) => {
      const child = spawn(bin, ['tunnel', '--config', emptyConfig(), '--no-autoupdate', '--url', `http://127.0.0.1:${this.port}`], { stdio: ['ignore', 'ignore', 'pipe'] });
      this.child = child;
      let tail = '', name = null;
      const timer = setTimeout(() => reject(new Error('Timed out waiting for Cloudflare. Check your connection and try again.')), 45000);
      const done = (fn, v) => { clearTimeout(timer); fn(v); };
      // The name is printed a second before the connection is up.
      child.stderr.on('data', (d) => {
        tail = (tail + d).slice(-4000);
        const m = !name && URL_RE.exec(tail);
        if (m && m[1] !== 'api.trycloudflare.com') name = m[1];
        if (name && /Registered tunnel connection/.test(tail)) done(resolve, name);
      });
      child.on('error', (err) => done(reject, new Error(err.code === 'ENOENT' ? 'cloudflared couldn’t be started.' : err.message)));
      child.on('exit', (code) => {
        if (this.child !== child) return; // stopped on purpose
        done(reject, new Error(this.state === 'on' ? 'The public address closed. Make a new one.' : `cloudflared stopped (${code}).`));
        if (this.state === 'on' && run === this.run) this.fail('The public address closed. Make a new one.');
      });
    });
    if (run !== this.run) return;
    this.allow(host);
    this.host = host;
    this.set('starting', { step: 'check' });
    for (const end = Date.now() + 90000; Date.now() < end; await sleep(2000)) {
      if (run !== this.run) return;
      if (await this.check(host)) { if (run === this.run) this.set('on', { host }); return; }
    }
    throw new Error('Cloudflare connected, but the address doesn’t reach this office from outside. Try again in a minute.');
  }

  fail(message) {
    this.run++;
    this.drop();
    this.set('error', { error: message, host: null });
  }

  drop() {
    const child = this.child;
    this.child = null;
    if (this.host) this.forget(this.host);
    if (child) { try { child.kill('SIGTERM'); } catch {} }
  }

  stop() {
    this.run++;
    this.drop();
    this.set('off', { host: null });
    return this.status();
  }
}
