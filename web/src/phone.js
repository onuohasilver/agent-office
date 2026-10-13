// Open the office on a phone: a QR code to scan with the camera. It is always
// here; the QR appears once the office can be reached from a phone, which the
// button below makes happen (a temporary public address), or --phone on the
// local network.

const btn = document.getElementById('phoneBtn');
const pop = document.getElementById('phonePop');

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
let data = null; // { lan, links: [{ kind, label, url, svg }] }
let note = '';
let copied = false;

const call = (path, body) => fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  .then((r) => (r.ok ? r.json() : Promise.reject(new Error('Restart the office server to use this.'))));
let poll = 0;

function render() {
  if (!pop) return;
  pop.replaceChildren(el('p', { className: 'theme-k', textContent: 'On your phone' }));
  const say = (text, cls = 'acct-note') => pop.append(el('p', { className: cls, textContent: text }));
  if (!data) return say(note || 'Checking…', note ? 'acct-note acct-err' : 'acct-note');
  const t = data.tunnel || { state: 'off' };
  const link = data.links[0];

  if (link) {
    // The code is SVG from our own server, shown as an image so it can't run anything.
    pop.append(el('img', { className: 'phone-qr', alt: `QR code that opens the office at ${link.label}`, src: `data:image/svg+xml,${encodeURIComponent(link.svg)}` }));
    say(`Scan it with your phone’s camera. It opens ${link.label}.`);
    const copy = el('button', { type: 'button', className: 'acct-forget', textContent: copied ? 'Link copied' : 'Copy the link' });
    copy.addEventListener('click', () => {
      const done = () => { copied = true; note = ''; render(); setTimeout(() => { copied = false; if (!pop.hidden) render(); }, 1800); };
      const failed = () => { note = 'Couldn’t copy it. Select the whole link below and copy it by hand; it ends with the key.'; render(); };
      // No clipboard API over plain http (the local-network link), so fall back.
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(link.url).then(done, () => (copyByHand(link.url) ? done() : failed()));
      else if (copyByHand(link.url)) done(); else failed();
    });
    pop.append(copy);
    if (note) pop.append(Object.assign(el('input', { readOnly: true, value: link.url, onfocus: (e) => e.target.select() }), { style: 'width:100%;font:12px ui-monospace,monospace;margin-top:6px' }));
    say(link.kind === 'lan'
      ? 'This is plain http on your local network, and the link carries the office key. Use it on a Wi-Fi you trust.'
      : 'The link carries the office key, so keep it to yourself.', 'acct-note acct-fine');
  }

  if (t.state === 'starting') say({
    download: 'Getting Cloudflare’s tunnel. This happens once, and takes a minute.',
    check: 'Checking the address works from outside…',
  }[t.step] || 'Connecting to Cloudflare…');
  if (t.error) say(t.error, 'acct-note acct-err');
  if (note) say(note, 'acct-note acct-err');
  if (t.state === 'on') {
    say('This office is reachable from the internet while this is on. It turns off when you press the button or the office restarts.', 'acct-note acct-fine');
  } else if (t.state !== 'starting') {
    say('To open it from anywhere, not just this Wi-Fi, make a temporary public address through Cloudflare. Anyone with the link can run Claude in your projects, so share it with no one.');
  }
  const sw = el('button', { type: 'button', className: t.state === 'on' ? 'acct-forget' : 'primary small', disabled: t.state === 'starting', textContent: t.state === 'on' ? 'Turn off the public address' : t.state === 'starting' ? 'Starting…' : 'Make a public address' });
  sw.addEventListener('click', () => toggle(t.state !== 'on'));
  pop.append(sw);
}

function copyByHand(text) {
  const t = el('textarea', { value: text, readOnly: true });
  t.style.cssText = 'position:fixed;opacity:0';
  pop.append(t);
  t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch {}
  t.remove();
  return ok;
}

// Cloudflare takes a few seconds to hand back a name.
function watch() {
  clearTimeout(poll);
  if (pop.hidden || data?.tunnel?.state !== 'starting') return;
  poll = setTimeout(() => load(), 1000);
}

function load() {
  return call('/api/phone').then((d) => { data = d; note = ''; render(); watch(); }, (err) => { note = err.message; render(); });
}

function toggle(on) {
  note = '';
  call('/api/phone/tunnel', { on }).then(() => load(), (err) => { note = err.message; render(); });
}

function open(on) {
  pop.hidden = !on;
  btn.setAttribute('aria-expanded', String(on));
  if (!on) { copied = false; clearTimeout(poll); return; }
  render();
  load();
}

btn?.addEventListener('click', () => open(pop.hidden));
// These two keep their clicks from reaching the page, so close for them here.
for (const id of ['themeBtn', 'acctBtn']) document.getElementById(id)?.addEventListener('click', () => { if (!pop.hidden) open(false); });
document.addEventListener('click', (e) => {
  const path = e.composedPath();
  if (pop && !pop.hidden && !path.includes(pop) && !path.includes(btn)) open(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && pop && !pop.hidden) { open(false); btn.focus(); }
});
