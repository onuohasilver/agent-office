# Desktop app (Tauri)

The desktop app is a thin Tauri shell around the same office server and web UI you get from `agentoffice`. The shell lives in `desktop/`; this page covers how the web side behaves inside it.

## How the shell starts the office

1. Binds `127.0.0.1:0` to get a free port `N`.
2. Runs `$SHELL -lc 'exec node <Resources>/app/bin/agentoffice.js --port N'`. The login shell means a Finder-launched app still finds `node` and `claude` on `PATH`.
3. Sets `OFFICE_ROOT` (the folder you pick on first run, remembered), leaves `OFFICE_DATA` at `~/.agent-office`, and sets `OFFICE_DESKTOP=1`.
4. Waits until `N` accepts connections, reads `~/.agent-office/office-key`, and points the window at `http://127.0.0.1:N/?key=…`.
5. On quit, sends `SIGTERM` to the server and waits, so it flushes its state.

The server needs no desktop-specific behaviour: the phone QR code only prints with `--phone`, which the shell never passes.

## External links

The webview drops `target="_blank"` links and `window.open`. `web/src/desktop.js` detects `window.__TAURI__` and sends those URLs to the opener plugin (`window.__TAURI__.opener.openUrl`). It handles:

- links to other sites (`https:`, `http:`, `mailto:`),
- `window.open(url)`.

It also adds a `desktop` class to `<html>` so CSS can adapt. In a normal browser the module does nothing.

Links to the office itself are left alone: the system browser doesn't have the webview's HttpOnly key cookie and would get a 401, and the key is stripped from the page URL so it can't be appended.

The shell must enable the opener plugin with a capability that allows the localhost page to call it.

## Building it

```
cd desktop && npm install
npm run dev     # runs the repo; needs a built dist/
npm run build   # stages from HEAD, writes src-tauri/target/release/bundle/{macos,dmg}
```

Rust comes via rustup. The build log goes to `~/.agent-office/desktop.log`.
