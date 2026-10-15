# Changelog

Notable changes to Agent Office. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## 0.9.0 — 2026-10-15

### Added
- **Edit files in the office.** Each project has an Edit files button that opens its folders and text files; Cmd/Ctrl+S saves, and a save is refused if the file changed on disk meanwhile. The editor is CodeMirror, with syntax highlighting by file type, line numbers, folding, bracket matching, find (Cmd/Ctrl+F) and undo, coloured from the office theme, and it loads only when opened.
- A job's "What changed" list has an Edit button on each changed file. Jobs also remember the files their agent wrote to, and where git can't say what changed they show them as "Files edited", each with an Edit button.
- **A desktop app** (Tauri) with a designed DMG installer. The dmg is ad-hoc signed as a whole bundle so a downloaded copy isn't reported damaged; the README covers the Gatekeeper workaround.
- Chief can hand out several jobs from one message, at most one per person.
- Quality badges: Straight through, Second wind, Team player, Second pair of eyes and Quick study.

### Security
- Two hardening passes over guests, links and the office page. The key cookie holds a MAC of the key, and the office page sends a CSP that limits images and forms. Leaderboard rate limits use the IPv6 /64.
- Guests: a guest's cache tokens are counted call by call (reads at a tenth), their replies and open jobs are held to the host's current limits, an unlinked guest's open jobs are stopped, and `guests.json` is written private to the account.
- Link handles and project names match exactly (case aside), and prototype names are refused as link ids.
- Snapshotting never runs a project's clean or smudge filters. Away jobs are limited to roster, flag and clear_context. Below Full autonomy, `attach_files` takes only files in the job's project. Job tokens stay out of the projects folder.
- Desktop: the office is proved before its key is sent, IPC is scoped to its port, and `tauri.localhost` is allowed only on Windows on its default port.

### Fixed
- A process-group kill happens only when the group's leader is the process we saw.
- A bet on a job handed over by one of its parties is voided.
- Visits drop copies with nothing to review and cap copies per guest.
- The installed-package check in CI looked for a page title the app dropped on Oct 12, which kept CI red on master.

## 0.8.1 — 2026-10-13

### Added
- Agents no longer leave processes running. Whatever a job started and left behind (dev servers, watchers, background test runs, test copies of a server) is stopped when the job ends. An agent can keep one with the new `keep_running` tool, and you are told what was kept and how to stop it.
- Heavy builds and full test suites take turns. Agents call the new `heavy_work` tool before a Gradle, Xcode or emulator run, a whole-app jest or vitest run, or a docker build. While one is running, the next waits for its turn and you get a **Delayed** notice in #general.
- New jobs wait while the machine is struggling: when the number of working agents reaches **Agents working at once** in Settings (default 4, `OFFICE_MAX_AGENTS`), or, once 3 or more agents are working, when the machine is swapping memory hard or the processor is badly overloaded. Up to 3 agents always start, whatever else the laptop is doing. You get an **On hold** notice in #general and a desktop notification saying why, and the job starts by itself when that changes.

### Changed
- Agents are told to run jest with `--maxWorkers=2`.

## 0.8.0 — 2026-10-13

### Added
- Switch a job's model from its card. The Model row in the job's details is now a picker; a running job finishes its turn, then resumes the same session on the new model. A job the chief sized stops climbing on its own once you choose. Jobs on someone else's account stay as they are.
- Agents can show you files. A new `attach_files` office tool stages images or files (screenshots, say), up to 6 of 25 MB each, and they ride on the agent's next message to you: its final reply, a flag or a channel post.
- A "needs you" strip above the message box lists each job still waiting on you, with a link that scrolls to the message.
- Open the office on a phone from anywhere. The phone button in the side panel is always there: **Make a public address** starts a Cloudflare quick tunnel and shows a QR code for it once the address works from outside. Nothing to install: `cloudflared` is used from the PATH, or a pinned, checksum-verified release is downloaded once. Off until you press it, closed when you press it again or the office stops, and the key stays the only way in. See [On your phone](docs/phone.md).
- Open the office on a phone by scanning a QR code. `agentoffice --phone` (or `OFFICE_LAN=1`) also listens on your local network, prints a QR code with the link at start, and shows the same code under the new phone button in the side panel. Off unless you ask: by default the office still listens on `127.0.0.1` only. It is plain `http` with the key in the link, so home Wi-Fi only; see [On your phone](docs/phone.md).

### Changed
- A job's details fold away behind a **Details** row that summarises model, cost and time, and remembers whether you left it open.
- On a phone the 3D view renders lighter (no ambient-occlusion pass, a small shadow map, no antialiasing, a lower pixel ratio). Add `?lite=0` or `?lite=1` to the address to override the guess.
- The side panel's usage meters sit in a two-column grid, and its popovers no longer overflow narrow screens.

## 0.7.0 — 2026-10-12

### Added
- A host's lent agent can work in your own projects. Make the host your guest as well, with **Their agents** on and the project shared, then tag it as usual: `@Ada@friend #mine ...`. The agent runs at the host, on the host's account and within your token allowance there, and reaches your project through the same six file tools, in a copy you review and apply like any other visit. Both offices need 0.7.0 or later; if something is missing, the chief says what to change instead of running the agent in the host's folder. See [Linked offices](docs/linked-offices.md#using-a-lent-agent-in-your-own-projects).

## 0.6.0 — 2026-10-12

### Added
- A guest's own agents can work in your projects. A guest invite can now let their agents in (*Read only* or *Edit a copy*) as well as, or instead of, lending yours. They run on the guest's machine and account, reach your files only through list, read, search, find, write and edit tools that cross the link, and change a copy of the project that you review and apply or discard. On the guest's side, `#web@host` sends one of your agents there. See [Linked offices](docs/linked-offices.md#letting-a-guests-own-agents-work-in-your-projects).
- Rename your agents. Onboarding now ends with a **Meet your team** step, and the Team tab has a Name field. A name is one word (letters, numbers or hyphens) so `@mentions` keep working, and two agents can't share one. The new name reaches chat, desk plates, labels and the agent's own prompt from its next job.
- A guest wing. The office is wider, and east of a glass partition visitors from linked offices get their own space: twelve hot desks, a coffee bar and sofa, and a table for their meetings. The door and the Chief of Staff's reception moved to its entrance. Up to ten visitors are on the floor at once (was six).

### Changed
- A host's agents can be tagged from your own office chat once it makes you its guest, the same as your own (`@Ada`, or `@Ada@host` when the name is taken). Their jobs show in your Jobs list, threads carry follow-ups, and the project is picked for you instead of needing a `#project` tag. The Links panel's **Visit** button is gone.

## 0.5.0 — 2026-10-12

### Added
- A list/icons toggle on the Team and Projects tabs, to see them as rows or as a grid of icons.

### Changed
- The Jobs list is restyled: each row leads with the ask itself rather than the "The boss says" preamble, with the full brief in the tooltip.
- Chat shows each sender's avatar, drawn from their office look (a plain silhouette for the boss), instead of a coloured dot beside their name.

### Removed
- The in-app browser terminal: the drawer under the office, its `/api/terminal` and `/ws/terminal` endpoints, and the `OFFICE_TERMINAL*` settings. The `xterm` and `node-pty` dependencies go with it, so installing no longer needs `allow-scripts` and npm stops warning about `node-pty`'s install scripts.

## 0.4.0 — 2026-10-12

### Added
- Clearing context no longer erases what an agent was doing. The boss's "clear context" keeps a note of each job's last report (or brief), logs it, and feeds it back on the next reply and to the agent's later jobs.
- Agents can clear their own context. A new `clear_context` tool takes notes to self; once the turn ends, the job restarts in a fresh session with the brief and those notes, so long jobs stop paying for their whole history on every turn. Past `AGENT_CLEAR_TOKENS` of context (default 150,000, `0` to disable) the agent's next message nudges it to do so. The limit can also be set from the office, in the Claude access menu, and takes effect straight away. See [Jobs](docs/jobs.md).
- The chief of staff can clear context directly. Telling it "clear context" (for everyone, or for named agents) clears their sessions with no job handed out.

### Changed
- The office header shows whose office it is (`OFFICE_OWNER`, else the first name on the account), your level as a progress ring, and the usage gauges as rings behind a fold button. The glass styling is reworked to match.
- A Settings page, from the sliders icon in the header. It changes the owner, token limit, compaction point, chief model, standup time and weekends, sharing of job titles, and the break-room talk without restarting. A value saved there wins over its environment variable, which becomes the default; "Use the default" puts it back. A context limit set before upgrading carries over. See [Configuration](docs/configuration.md).

### Fixed
- An agent whose brief was itself "clear your context" looped on `clear_context`: each fresh session re-read the brief and cleared again until the cap. The restart now says the clear is done and not to repeat it.

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
