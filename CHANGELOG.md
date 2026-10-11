# Changelog

Notable changes to Agent Office. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added
- **An npm package.** `npm install -g @onuohasilver/agent-office`, then
  `agent-office` in the folder that holds your projects. It checks the machine
  first, uses the next free port if 4317 is taken, opens the browser, and
  keeps its data in `~/.agent-office`. `agent-office doctor` checks without
  starting; `agent-office voice` downloads the speech models.
- `OFFICE_DATA` chooses where the office keeps its data.
- CI installs the packed package and runs it; pushing a version tag publishes
  to npm.

### Security
- `ws` 8.22.0: fixes a memory-exhaustion denial of service and an
  uninitialised-memory disclosure in the websocket server.
- Vite 6.4.3 and esbuild 0.25 for development and builds, clearing
  `server.fs.deny` bypasses and the dev server answering other sites.

### Changed
- three.js r186, xterm.js 6, and minor updates to the fonts and the
  terminal's fit add-on.
- node-pty stays on 1.0.0: 1.1.0 can't start a shell on macOS.

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
