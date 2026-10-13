// Open the office on a phone: a QR code to scan with the camera. The office
// only offers one when it can be reached from a phone at all (a named host in
// front of it, or --phone on the local network), and says how otherwise.

const btn = document.getElementById('phoneBtn');
const pop = document.getElementById('phonePop');

const el = (tag, props = {}) => Object.assign(document.createElement(tag), props);
let data = null; // { lan, links: [{ kind, label, url, svg }] }
let note = '';
let copied = false;

function render() {
  if (!pop) return;
  pop.replaceChildren(el('p', { className: 'theme-k', textContent: 'On your phone' }));
  const say = (text, cls = 'acct-note') => pop.append(el('p', { className: cls, textContent: text }));
  if (!data) return say(note || 'Checking…', note ? 'acct-note acct-err' : 'acct-note');
  const link = data.links[0];
  if (!link) {
    say('A phone can’t reach this office yet: it only listens on this machine.');
    say('Restart it with agentoffice --phone to listen on your Wi-Fi and get a QR code here, or put it behind Tailscale (see the phone guide).');
    return;
  }
  // The code is SVG from our own server, shown as an image so it can't run anything.
  const img = el('img', { className: 'phone-qr', alt: `QR code that opens the office at ${link.label}`, src: `data:image/svg+xml,${encodeURIComponent(link.svg)}` });
  pop.append(img);
  say(`Scan it with your phone’s camera. It opens ${link.label}.`);
  const copy = el('button', { type: 'button', className: 'acct-forget', textContent: copied ? 'Link copied' : 'Copy the link' });
  copy.addEventListener('click', () => {
    navigator.clipboard?.writeText(link.url).then(() => { copied = true; render(); setTimeout(() => { copied = false; if (!pop.hidden) render(); }, 1800); }, () => {});
  });
  pop.append(copy);
  say(link.kind === 'lan'
    ? 'This is plain http on your local network, and the link carries the office key. Use it on a Wi-Fi you trust, and never a shared or public one.'
    : 'The link carries the office key, so keep it to yourself.', 'acct-note acct-fine');
}

function open(on) {
  pop.hidden = !on;
  btn.setAttribute('aria-expanded', String(on));
  if (!on) { copied = false; return; }
  render();
  fetch('/api/phone').then((r) => (r.ok ? r.json() : Promise.reject(new Error('Restart the office server to use this.'))))
    .then((d) => { data = d; note = ''; render(); }, (err) => { note = err.message; render(); });
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
