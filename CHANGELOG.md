# Changelog

Notable changes to Agent Office. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## Unreleased

### Security
- `ws` 8.22.0: fixes a memory-exhaustion denial of service and an
  uninitialised-memory disclosure in the websocket server. 0.3.0 and earlier
  shipped 8.18.0.
- Vite 6.4.3 and esbuild 0.25 for development and builds, clearing
  `server.fs.deny` bypasses and the dev server answering other sites.

### Changed
- three.js r186, xterm.js 6, marked 18, and minor updates to the fonts and the
  terminal's fit add-on. They are bundled into `dist/` at build time, so the
  package now installs only `ws` (and node-pty, optionally).
- node-pty stays on 1.0.0: 1.1.0 can't start a shell on macOS.
- Pushing a `v*` tag publishes to npm from CI.

## 0.3.0 — 2026-10-12

### Added
- Linked offices. Link two offices with a one-time code, and each sees the other's agents walk into its 3D office as visitors, showing their name, role and what they're doing. Job titles stay home unless `OFFICE_SHARE_JOB_TITLES=1`. You can also invite a guest to start jobs with your agents, limited to the projects, clearance and daily tokens you choose. See [Linked offices](docs/linked-offices.md).
- A handle without the leaderboard. Linking needs a handle, and sharing counters on the board is now a separate tickbox.

### Changed
- The leaderboard works out of the box: the office points at the hosted board by default. `OFFICE_LEADERBOARD_URL` still overrides it. Nothing is shared until you join.
- **The office has a key.** Other accounts on the same machine (or the tailnet) could reach the office's API and start jobs as you. The page, API and socket now need a key from `data/office-key` (mode `0600`). Open the office once with the link it prints at startup; `agentoffice --link` prints it again. After upgrading, open that link once.
- `agentoffice`/`agentstudio` now pick a free port (4317 if open, else any free one). `--port <n>` or `PORT` chooses one; a taken port you asked for stops with a clear message instead of restarting in a loop.

### Fixed
- "I couldn't route that one: The chief could not decide" now says why: the error `claude` reported (signed out, out of credit, a model the plan can't use), a timeout, or `claude` exiting without answering. [Troubleshooting](docs/guides/troubleshooting.md#jobs-dont-run) has the one-line check.

### Security
- Only the office's own page can call it: a page on another localhost port (a project's dev server, say) is refused like any other website.
- A malformed address (`/%E0`) no longer crashes the office.
- A guest's jobs don't get the host's MCP servers and claude.ai connectors, user-level Claude Code settings and hooks, or Claude Code memory.
- Git runs with `core.fsmonitor` off and no external diff or textconv drivers when the office records what a job changed.

## 0.2.0 — 2026-10-12

### Install
- Published as `agent-office-studio`. `npm install -g agent-office-studio`, then
  run `agentoffice` (or `agentstudio`) in the folder that holds your projects.
  State lives in `~/.agent-office`; `OFFICE_DATA` and `OFFICE_ROOT` override.

### Fixed
- A job whose agent flagged a question, decision or blocker is no longer
  reported as done when their turn ends. The chief posts "Waiting on you"
  instead, and no shipped count, XP or celebration is given until it resumes.

### Leaderboard
- An optional leaderboard: join under a claimed handle and compare jobs
  finished, tokens used and agent time, weekly and all time. Off until you
  join; only per-day counters are shared. The service is a Cloudflare Worker in
  `leaderboard/`. A local ledger (`data/activity.json`) now keeps those counters.

## 0.1.0 — 2026-10-11

The first public release.

### The office
- A 3D office where each agent is a Claude Code session. Agents walk to the
  library to read, the server room to run commands and their desk to write.
- Chat with `@agent` and `#project` tags; a chief of staff routes everything
  else, hands follow-ups to whoever is on the job, and asks when unsure.
- Slack-style channels and threads; attachments, including screenshots the
  chief can read.
- A daily standup at the whiteboard, and a break room where idle agents talk
  (in #chill-room) and play eight-ball.
- Levels: shipped jobs earn XP, and each level hires another agent.
- Themes, light and dark mode, and an installable app for desktop and phone.

### Jobs
- Clearance per job: plan only, edit files, or full autonomy, with the option
  to grant more mid-job.
- The chief picks Haiku, Sonnet or Opus to fit the work and steps up a rung
  when a job fails.
- Agents message each other and hand work to free colleagues.
- "What changed": each job's diff, from working-tree snapshots that never
  touch the repo's own index or history.
- Jobs resume after a server restart.

### Setup
- Claude access: the Claude Code login on the machine, or an Anthropic API key.
- Plan usage meters for the Claude Code login.
- Voice: dictation with whisper.cpp and a Piper voice per agent, all local.
- An opt-in terminal in a drawer under the office.
