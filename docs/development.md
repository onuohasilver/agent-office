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

Server changes need a restart, and stopping the server stops every running
job (they resume when it comes back). If you are an agent working inside the
office, **never restart the server you are running under**: its shutdown ends
your own process. Ask the person at the keyboard to do it.

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
`npm pack` and `npm install -g ./onuohasilver-agent-office-*.tgz`.

## The launch video

`launch/` holds the tooling that recorded the launch video: `setup.sh` resets a
sandbox office on port 4399 under `/tmp/office-demo`, `stub.mjs` plays the
scripted agents, and the Python scripts drive and capture the browser. The
rendered video itself isn't kept in git.
