# On your phone

The office is a progressive web app: open it in a phone browser and use
**Add to Home Screen** (Safari) or **Install app** (Chrome) and it opens
full-screen with its own icon. The same works on a desktop, in Chrome or Edge,
for an office in its own window.

The app shell is cached so it opens when the connection drops; live office
state never is, because a stale office is worse than none.

## From anywhere: a public address

Press the phone button at the top of the side panel, then **Make a public
address**. The office starts a [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/do-more-with-tunnels/trycloudflare/)
(it needs `cloudflared`: `brew install cloudflared`; no account), waits for it
to connect, and shows a QR code for a random `https://….trycloudflare.com`
address with the office key on the end. Scan it from any network, mobile data
included. Nothing else on your machine is opened, and the tunnel goes out from
your machine, so no router settings change.

It is off until you press the button, closes when you press it again or the
office stops, and the address is different every time. The key is what protects
it: 64 random hex digits, over https. Treat the link like a password. Whoever
has it can run Claude in your projects with the clearance you give it. To sign
every browser out, delete `data/office-key` and restart.

## Scan a QR code (same Wi-Fi)

The quickest way, for a phone on the same Wi-Fi as this machine:

```bash
agentoffice --phone
```

That also listens on your local network, and prints a QR code in the terminal
after the usual link. Scan it with the phone's camera and the office opens, key
included. The same code is in the office itself, under the phone button at the
top of the side panel. `OFFICE_LAN=1` does what `--phone` does.

Only this machine's own private addresses (`192.168.x.x`, `10.x.x.x`,
`172.16-31.x.x`) are accepted as the address, and the page still needs the key.
But it is plain `http`, and the link carries the key, so anyone who can watch
that network's traffic could copy it and run Claude in your projects. Use it at
home, never on a café, hotel or office network; elsewhere use Tailscale below.
With `OFFICE_ALLOWED_HOSTS` set, the QR points at that name instead.

## Reaching your machine from anywhere

By default the server only listens on `127.0.0.1`, so a phone can't reach it
directly. Away from home, the supported way is [Tailscale](https://tailscale.com): put the office behind
`tailscale serve` on this machine, then tell the office to accept that name.

```bash
tailscale serve --bg 4317
OFFICE_ALLOWED_HOSTS=my-mac.tail1234.ts.net agent-office
```

`OFFICE_ALLOWED_HOSTS` takes exact hostnames, comma-separated. Every other
host and origin is still refused.

On the phone, open the tailnet address once with the office key on the end,
`https://my-mac.tail1234.ts.net/?key=…` (the key is in the link the office
printed, or `agentoffice --link`). The phone keeps it after that.

**Read this first.** Whoever can open that address can run Claude in your
projects with full autonomy. Only expose it on a tailnet that is just you. Never put it on
the open internet. See [Security](security.md).
