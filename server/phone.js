// The phone link: where a phone can reach this office, and a QR code for it.
//
// By default the office listens on 127.0.0.1 only, so there is nothing for a
// phone to reach. Two ways in, both opt-in:
//   - OFFICE_ALLOWED_HOSTS names a host that fronts the office (Tailscale);
//     the link points at that name.
//   - OFFICE_LAN=1 listens on the local network too, and the link points at
//     this machine's private addresses. Plain http, so anyone else on that
//     Wi-Fi who sees the key can open the office: home networks only.

import os from 'node:os';
import qrcode from 'qrcode-generator';

// Private IPv4 addresses (10/8, 172.16/12, 192.168/16), the only ones we
// would put a key behind. Link-local, CGNAT and public ones are skipped.
export function lanAddresses(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const list of Object.values(ifaces)) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const [p, q] = a.address.split('.').map(Number);
      if (p === 10 || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168)) out.push(a.address);
    }
  }
  return out;
}

// The links a phone could use, best first: named hosts over https, then LAN.
export function phoneLinks({ key, port, lan, hosts = [], addresses = lanAddresses() }) {
  const links = hosts
    .filter((h) => !['localhost', '127.0.0.1', '[::1]'].includes(h))
    .map((h) => ({ kind: 'host', label: h, url: `https://${h}/?key=${key}` }));
  if (lan) for (const a of addresses) links.push({ kind: 'lan', label: `${a}:${port}`, url: `http://${a}:${port}/?key=${key}` });
  return links;
}

const code = (text) => {
  const qr = qrcode(0, 'M'); // type 0: smallest version that fits
  qr.addData(text);
  qr.make();
  return qr;
};

// An SVG with a quiet zone, which scanners need. Dark on white whatever the
// theme: they read contrast, not colours.
export function qrSvg(text) {
  const qr = code(text), n = qr.getModuleCount(), q = 4;
  let d = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + q} ${r + q}h1v1h-1z`;
  const s = n + q * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s} ${s}" shape-rendering="crispEdges"><rect width="${s}" height="${s}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
}

// Half-blocks for a terminal: two module rows per text row. Inverted (light
// modules drawn as blocks) so it reads on a dark terminal, which is most.
export function qrText(text) {
  const qr = code(text), n = qr.getModuleCount(), q = 2;
  const dark = (r, c) => r >= q && c >= q && r < n + q && c < n + q && qr.isDark(r - q, c - q);
  const s = n + q * 2;
  const rows = [];
  for (let r = 0; r < s; r += 2) {
    let line = '';
    for (let c = 0; c < s; c++) {
      const top = !dark(r, c), bottom = r + 1 < s ? !dark(r + 1, c) : true;
      line += top && bottom ? '█' : top ? '▀' : bottom ? '▄' : ' ';
    }
    rows.push(line);
  }
  return rows.join('\n');
}
