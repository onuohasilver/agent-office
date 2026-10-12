# Packaging roadmap

How the office gets from "clone the repo" to something people install. This is
a plan, not shipped work.

## Where it stands

The office is a single-user tool that runs locally: one Node server, a web
build in `dist/`, and the user's own `claude` CLI doing the work. Everyone who
can use it already has a terminal and Claude Code, which decides the shape of
the package.

## Options

| Option | Fit | Cost | Main problem |
|---|---|---|---|
| **npm CLI** (`npx agent-office`) | Best: the audience already has Node and Claude Code | ~1 week | data and project root must move out of the package |
| **Homebrew tap** | Good extra for Mac users | ~1 day on top of npm | another channel to release to |
| **Desktop app** (Electron) | Friendlier, but still needs the `claude` CLI | 3–5 weeks | signing and notarisation, auto-update, `node-pty` rebuilds |
| **Docker** | Poor for a local tool | ~1 week | agents edit *host* repos: bind mounts, file ownership, git/SSH keys, login inside the container |
| **Hosted** | A different product | months | accounts, a sandbox per user, repos via GitHub, a database, API billing; the local-only security model goes |

**Plan:** ship the npm CLI first, with the PWA ([On your phone](phone.md))
standing in for a desktop window; add Homebrew next; build a desktop app only
if users ask for one; leave hosted until the local version has users.

## Steps

- [x] **Claude access:** users choose the Claude Code login or an API key
      ([Claude access](claude-access.md)).
- [x] **Licence:** MIT ([`LICENSE`](../LICENSE)).
- [ ] **npm name:** confirm `agent-office` is free, or pick another.
- [ ] **Data directory:** `~/.agent-office` (or `$XDG_DATA_HOME`) with an
      `OFFICE_DATA` override, migrating an existing `<app>/data` on first run.
- [ ] **Project root:** default to the current directory, `--root <dir>`,
      remembered after the first run.
- [ ] **`bin/agent-office.js`:** `--port`, `--root`, `--open`, `--terminal`;
      pick another port if 4317 is taken; open the browser.
- [ ] **Preflight:** `claude` on `PATH`, recent enough, and signed in or given a
      key — one clear fix for each problem.
- [ ] **Package:** publish a prebuilt `dist/`; move the web-only dependencies
      (`three`, `marked`, `xterm`, fonts) to devDependencies so the runtime
      needs only `ws`.
- [ ] **Terminal:** a `node-pty` build with prebuilt binaries, still optional.
- [ ] **Voice:** `agent-office voice setup` in place of the two npm scripts.
- [ ] **Plan meters:** hide quietly if the usage endpoint goes away.
- [ ] **Platforms:** CI on clean macOS and Ubuntu; Windows via WSL.
- [ ] **Releases:** on a tag, a smoke test against a stub `claude`, then
      `npm publish --provenance` and a Homebrew bump; a CHANGELOG.
