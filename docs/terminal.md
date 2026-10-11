# The terminal

There is a real shell in the drawer under the office: `⌃``, or the terminal
button in the top right. Tabs across the top, `+` opens another, and the picker
beside it chooses which project folder the next one starts in. Drag the top
edge to resize — the office makes room rather than hiding behind it. It is a
proper pty, so `vim`, `top`, `git add -p`, colours and your own prompt all work
the way they do in a terminal app.

It is off until you ask for it:

```bash
OFFICE_TERMINAL=1 npm start
```

That switch exists because shell access is the one door in the building that
doesn't care about clearance. A job runs with the mode you picked and leaves a
log; a shell is you, with everything you can do, and no record of what it did.
So:

- **Off by default.** No flag, no terminal — the socket won't even open.
- **This machine's browser only.** The server already refuses any request whose
  host or origin isn't local. On top of that, a session needs a single-use
  ticket that expires in ten seconds, and tickets are only handed out on that
  origin-checked route — the socket accepts nothing else.
- **Not for the staff.** No agent can open one. There's no office tool and no
  `/api/agent` route that reaches it, and a shell never inherits the job
  credentials the office gives its own children.
- **Nothing is kept.** Not in `data/state.json`, not in the chat, not on the
  main socket. Scrollback lives in the tab and dies with it. `data/terminal.log`
  records when sessions opened and closed and in which folder — never
  keystrokes, because a log of what you typed into a shell is a file full of
  passwords.
- **It tidies up.** Closing a tab hangs up the shell, a session with nothing
  happening closes itself after 30 minutes, and there's a cap on how many can
  be open at once.

What it is *not* is a sandbox. The shell runs as you and `cd ..` walks out of
whichever folder it started in; picking the folder is a convenience, not a
boundary. Leave it off on any machine where "whoever has the browser" isn't
just you.

The terminal needs [`node-pty`](https://github.com/microsoft/node-pty), which
builds natively — it's an optional dependency, so `npm install` on a machine
without build tools still gets you the whole office, just without this. On
macOS: `xcode-select --install`, then `npm install`.
