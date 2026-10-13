// A public address for the office, so a phone can reach it from anywhere: a
// Cloudflare quick tunnel. `cloudflared` dials out from this machine and gives
// back a random https://….trycloudflare.com name that forwards to the office,
// so nothing listens on the network and no router is touched. No account.
//
// It is only ever started by an explicit click, never at boot, and it dies
// with the office. The address is new every time. Whoever has the link with
// the key can run Claude here, so the key stays the one thing that matters.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// cloudflared reads ~/.cloudflared/config.yml even for a quick tunnel, and a
// named tunnel's ingress there (ending, as they do, in http_status:404) then
// answers every request to our address with an empty 404: a blank page on the
// phone. So it gets a config of its own, with nothing in it.
function emptyConfig() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'office-tunnel-')), 'config.yml');
  fs.writeFileSync(file, '');
  return file;
}

const URL_RE = /https:\/\/([a-z0-9-]+\.trycloudflare\.com)/i;

export class Tunnel {
  // allow(host) lets the office accept that Host; forget(host) takes it back.
  constructor({ port, allow, forget, bin = process.env.OFFICE_CLOUDFLARED || 'cloudflared', onChange = () => {} }) {
    Object.assign(this, { port, allow, forget, bin, onChange });
    this.state = 'off'; // off | starting | on | error
    this.host = null;
    this.error = null;
    this.child = null;
  }

  status() {
    return { state: this.state, url: this.state === 'on' ? `https://${this.host}` : null, error: this.error };
  }

  set(state, extra = {}) {
    Object.assign(this, { state, error: null, ...extra });
    this.onChange(this.status());
  }

  start() {
    if (this.child) return this.status();
    this.set('starting', { host: null });
    let child;
    try {
      child = spawn(this.bin, ['tunnel', '--config', emptyConfig(), '--no-autoupdate', '--url', `http://127.0.0.1:${this.port}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (err) { this.set('error', { error: err.message }); return this.status(); }
    this.child = child;
    let tail = '';
    const timer = setTimeout(() => { if (this.child === child && this.state === 'starting') this.fail('Timed out waiting for Cloudflare. Check your connection and try again.'); }, 30000);
    // The name is printed about a second before the connection to Cloudflare
    // is up, and a QR for a name that isn't routed yet shows an error page. So
    // wait for the registration line before calling it on.
    let host = null;
    child.stderr.on('data', (d) => {
      tail = (tail + d).slice(-4000);
      if (this.child !== child || this.state !== 'starting') return;
      const m = !host && URL_RE.exec(tail);
      if (m && m[1] !== 'api.trycloudflare.com') { host = m[1]; this.allow(host); this.host = host; }
      if (host && /Registered tunnel connection/.test(tail)) {
        clearTimeout(timer);
        this.set('on', { host });
      }
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      if (this.child !== child) return;
      this.fail(err.code === 'ENOENT' ? 'cloudflared isn’t installed. Install it (brew install cloudflared) and try again.' : err.message);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      if (this.child !== child) return; // we stopped it ourselves
      this.fail(this.state === 'on' ? 'The tunnel closed.' : `cloudflared stopped (${code}).`);
    });
    return this.status();
  }

  fail(message) {
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
    this.drop();
    this.set('off', { host: null });
    return this.status();
  }
}
