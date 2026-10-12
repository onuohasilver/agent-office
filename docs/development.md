# Development

```bash
npm install
npm run dev          # server with --watch on :4317, Vite with hot reload on :5317
```

Use <http://localhost:5317> while developing; Vite proxies `/api` and `/ws`
to the server.

## Checking a change

```bash
npm run build
npm test
```

`npm test` is a smoke test: it starts the office from a temporary copy with
its own data, against a stand-in `claude`, and checks that it serves the app,
refuses other sites, runs a job with the right clearance and records what
changed. It costs no tokens and can't touch an office you're using. CI runs
it on macOS and Linux for every push and pull request.

## Shipping a web change

`npm run build` writes `dist/`, which the server reads from disk on every
request. A web-only change goes live with a build and a reload — no server
restart.

## Shipping a server change

Server changes need a restart. `npm start` runs the server under a small
supervisor (`server/supervise.js`) so the office can restart itself:

- **You:** type `/restart` in the chat (`/restart now` skips the wait).
- **An agent:** calls its `restart_office` tool, then ends its turn. It gets a
  message when the office is back, so it can check its change.

A restart waits until nobody is mid-turn (up to 10 minutes, then it goes
anyway), exits with code 75, and the supervisor starts a fresh server. Open
jobs resume on their sessions. Before exiting, the server checks that its own
code parses and loads, and refuses if it doesn't, because a broken server would
leave nothing running to fix it. If the server crashes three times in a row
within seconds of starting, the supervisor gives up.

A server started with plain `node server/index.js`, or with `npm run dev`, has
no supervisor and refuses to restart itself. Agents must never kill the server
by signal: its shutdown ends their own process along with everyone else's.

## Testing without touching the live office

A second server pointed at the same `data/` resumes the live office's jobs.
Test from a copy instead, on another port, with its own data and a scratch
project folder:

```bash
rsync -a --exclude data --exclude dist --exclude .git --exclude node_modules ./ /tmp/office-test/
ln -s "$PWD/node_modules" /tmp/office-test/node_modules
cd /tmp/office-test && npx vite build
PORT=4398 OFFICE_ROOT=/tmp/office-test-projects CLAUDE_BIN=/path/to/stub \
  STANDUP_AT=off BANTER=off node server/index.js
```

`CLAUDE_BIN` can point at a stub that records its arguments and environment,
so you can check what a job was started with without spending tokens.
`launch/stub.mjs` is a fuller one that plays scripted jobs.

When you stop a test server, kill it by PID, not with `pkill -f`, which can't
tell it from the live one.

## Releasing

1. Move the changelog's *Unreleased* entries under a new version heading,
   `## 0.2.0 — <date>`.
2. Set the same version in `package.json` (`npm version 0.2.0 --no-git-tag-version`).
3. Commit, then tag and push: `git tag v0.2.0 && git push origin master v0.2.0`.

The *Release* workflow checks the tag matches `package.json`, runs the build,
the smoke test and `scripts/pack-smoke.sh` (which installs the packed package
the way a user would), publishes to npm with provenance, and creates the
GitHub release from that changelog section. It needs an npm access token in
the repository secret `NPM_TOKEN`.

To try the package locally without publishing: `sh scripts/pack-smoke.sh`, or
`npm pack` and `npm install -g ./agent-office-studio-*.tgz`.

## The launch video

`launch/` holds the tooling that recorded the launch video: `setup.sh` resets a
sandbox office on port 4399 under `/tmp/office-demo`, `stub.mjs` plays the
scripted agents, and the Python scripts drive and capture the browser. The
rendered video itself isn't kept in git.
