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
- [x] **npm name:** `@onuohasilver/agent-office` (`agent-office` is taken).
- [x] **Data folder:** `~/.agent-office`, `--data` or `OFFICE_DATA` to change it.
- [x] **Project root:** the folder it's started in, or `agent-office <folder>`.
- [x] **`bin/agent-office.js`:** `--port`, `--no-open`, `--terminal`, `--data`;
      the next free port if 4317 is taken; opens the browser.
- [x] **Preflight:** `agent-office doctor`, and the same checks on start.
- [x] **Package:** ships a built `dist/`; the runtime needs only `ws`.
- [ ] **Terminal:** a `node-pty` with working prebuilt binaries (1.1.0's macOS
      helper isn't executable; waiting for a fixed stable release).
- [x] **Voice:** `agent-office voice`.
- [ ] **Migrate a clone's `data/`** into `~/.agent-office` for people moving
      from a clone to the package.
- [ ] **Publish** the first version to npm.
- [ ] **Plan meters:** hide quietly if the usage endpoint goes away.
- [x] **Platforms:** CI on clean macOS and Ubuntu, including installing the
      packed package; Windows via WSL.
- [x] **Releases:** pushing a `v*` tag runs the checks, publishes to npm with
      provenance and creates the GitHub release from the CHANGELOG.
- [ ] **Homebrew** formula.
