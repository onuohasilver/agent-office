# How the office works

## Jobs are `claude` processes

Every job is one headless `claude` process whose stdin stays open, so new
messages can reach it mid-task. What they do on screen is
driven by the tool calls in its stream:

| Work | Where they go |
|---|---|
| Read, Grep, Glob | Library |
| Bash | Server room |
| WebSearch, WebFetch, MCP tools | Research window |
| Plans, todos, sub-agents | Whiteboard |
| Edits and writing | Their desk |

The server (`server/index.js`) keeps the office state, routes chat through the
chief of staff, starts and supervises those processes, and pushes everything
to the browser over one websocket. The browser draws the office with three.js
and moves each agent to wherever their latest tool call says they are.

The chief of staff, standup and break-room talk are short `claude -p` calls
too, with no tools, a JSON schema for the answer and no session kept.

## Agents talk to each other

Every agent gets three office tools (a small MCP server, `server/office-mcp.js`):

- `office_roster`: who's around and what they're on.
- `message_colleague`: reaches a working colleague mid-task. With
  `wait_for_reply`, the sender's session pauses until the answer comes (10
  minute limit).
- `hand_off`: gives work in any project to a free colleague. Their result goes
  back to the sender, who waits for it by default.

Hand-offs only go to someone free right now, so two agents can never wait on
each other. A job can be handed down at most twice. The sender walks over to
the colleague, and the exchange shows in the chat as "Ada → Tunde".

When someone ships you hear a chime, and if the tab is in the background you
get a desktop notification. The speaker in the top right mutes it.

If the server restarts mid-job, jobs with a session resume where they left off.

## Where things are kept

The **data folder** is `~/.agent-office` for the installed command (or
`--data <dir>`), and `data/` in a clone.

| Path | What |
|---|---|
| `state.json` | jobs, chat, channels, XP, team profiles |
| `auth.json` | how Claude is signed in to, and the API key if you gave one (mode `0600`) |
| `uploads/` | attachments and voice notes |
| `whisper/`, `piper/` | speech models, if you installed them |
| `terminal.log` | when terminal sessions opened and closed |

In a clone, `data/` is git-ignored. State is written shortly after every change, and the server stops its jobs cleanly on Ctrl-C so they can resume.

## Source layout

| Path | What |
|---|---|
| `server/index.js` | HTTP + websocket server, jobs, chat, chief, standup, break room |
| `server/office-mcp.js` | the MCP server that gives agents the office tools |
| `server/chief.js` | the chief of staff's routing call |
| `server/standup.js`, `server/banter.js` | standup write-up, break-room small talk |
| `server/auth.js` | Claude access: login or API key |
| `server/usage.js` | plan usage meters |
| `server/changes.js` | the "what changed" snapshots and diffs |
| `server/voice.js` | whisper.cpp transcription and Piper voices |
| `server/terminal.js` | the in-app terminal |
| `server/procstat.js` | agents' CPU and memory |
| `bin/agent-office.js` | the `agent-office` command: checks, port, data folder, browser |
| `web/src/main.js` | browser entry: socket, state, wiring |
| `web/src/office.js`, `figure.js`, `agent.js` | the 3D office and the people in it |
| `web/src/hud.js` | sidebar, chat, job drawer |
| `web/src/breakroom.js`, `pool.js`, `pool-sim.js` | break-room talk and eight-ball |
| `web/public/` | PWA manifest, service worker, icons |
| `shared/` | code used by both sides |
