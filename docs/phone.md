# On your phone

The office is a progressive web app: open it in a phone browser and use
**Add to Home Screen** (Safari) or **Install app** (Chrome) and it opens
full-screen with its own icon. The same works on a desktop, in Chrome or Edge,
for an office in its own window.

The app shell is cached so it opens when the connection drops; live office
state never is, because a stale office is worse than none.

## Reaching your machine

The server only listens on `127.0.0.1`, so a phone can't reach it directly.
The supported way is [Tailscale](https://tailscale.com): put the office behind
`tailscale serve` on this machine, then tell the office to accept that name.

```bash
tailscale serve --bg 4317
OFFICE_ALLOWED_HOSTS=my-mac.tail1234.ts.net npm start
```

`OFFICE_ALLOWED_HOSTS` takes exact hostnames, comma-separated. Every other
host and origin is still refused.

On the phone, open the tailnet address once with the office key on the end,
`https://my-mac.tail1234.ts.net/?key=…` (the key is in the link the office
printed, or `agentoffice --link`). The phone keeps it after that.

**Read this first.** Whoever can open that address can run Claude in your
projects with full autonomy, and — if `OFFICE_TERMINAL=1` — get a shell on
this machine. Only expose it on a tailnet that is just you. Never put it on
the open internet. See [Security](security.md).
