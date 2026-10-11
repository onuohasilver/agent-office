# Updating

Your office's state — jobs, chat, channels, XP, team profiles, Claude access —
lives in `data/`, which updates never touch.

## From a git clone

```bash
cd agent-office
git pull
npm install
npm run build
```

Then stop the office (Ctrl-C in its terminal) and start it again with
`npm start`. Running jobs are stopped cleanly and resume when it comes back.

Read [CHANGELOG.md](../../CHANGELOG.md) for what changed, and anything you
need to do.

## Pinning a version

To stay on a release rather than the latest code:

```bash
git fetch --tags
git checkout v0.1.0
npm install && npm run build
```

## If something breaks

- `npm install` failing on `node-pty` is harmless: it's optional, and only
  the terminal needs it. See [Troubleshooting](troubleshooting.md#the-terminal-wont-open).
- To keep a way back, copy `data/` before updating. Going back is then: stop
  the office, check out the previous tag, restore `data/`, build and start.
