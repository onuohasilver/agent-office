# Configuration

Everything is set with environment variables when the server starts, e.g.
`PORT=4400 CHIEF_MODEL=haiku npm start`. In-app choices — Claude access, the
voice toggle, team profiles, theme — are made in the office and remembered.

**Settings page.** Open the sliders icon in the office header to change the owner, token limit, compaction point, chief model, standup time and weekends, sharing of job titles, and the break-room talk without restarting. A value saved there wins over the environment variable below, which becomes the default; "Use the default" puts it back. Everything else here is environment-only.

## The office

| Env | Default | |
|---|---|---|
| `OFFICE_ROOT` | the folder above this one; with `agentoffice`, the folder you run it from | its subfolders are the projects |
| `OFFICE_DATA` | `data/` here; with `agentoffice`, `~/.agent-office` | where the office keeps its state |
| `PORT` | `4317` | with `agentoffice`, a free port is chosen if this is taken (or `--port <n>`); one you set is used as given |
| `OFFICE_ALLOWED_HOSTS` | none | extra hostnames to accept, comma-separated; see [On your phone](phone.md) |
| `OFFICE_SHARE_JOB_TITLES` | unset | `1` lets linked offices see your agents' job titles, not just that they're busy |

## Claude

| Env | Default | |
|---|---|---|
| `CLAUDE_BIN` | `claude` | the Claude Code binary |
| `ANTHROPIC_API_KEY` | none | used when Claude access is set to *API key* and none was pasted; see [Claude access](claude-access.md) |
| `CLAUDE_CODE_OAUTH_TOKEN` | none | a Claude Code login token, for the login mode and the plan meters |
| `CHIEF_MODEL` | `sonnet` | the chief of staff, and the standup write-up |
| `AGENT_COMPACT_PCT` | `60` | how full an agent's context gets before Claude Code compacts it |
| `AGENT_CLEAR_TOKENS` | `150000` | context size past which an agent's next message nudges it to `clear_context` and start fresh; `0` turns the nudge off; the limit set in the office (Claude access menu) overrides it |

## Standup and the break room

| Env | Default | |
|---|---|---|
| `STANDUP_AT` | `09:30` | local time, or `off` |
| `STANDUP_WEEKENDS` | unset | `1` holds standups on weekends too |
| `BANTER` | on | `off` keeps break-room talk to the canned lines |
| `BANTER_MODEL` | `haiku` | the model that writes break-room talk |
| `BANTER_GAP_SECONDS` | `120` | at most one written conversation per this many seconds |

## Voice

| Env | Default | |
|---|---|---|
| `WHISPER_BIN` | `whisper-cli` | |
| `WHISPER_MODEL` | the best model in `data/whisper` | point it at a bigger one (`ggml-small.en.bin`) to trade speed for accuracy |
| `PIPER_BIN` | `data/piper/venv/bin/python` | the voices live in `data/piper/voices` |
| `FFMPEG_BIN` | `ffmpeg` | |

## Terminal

| Env | Default | |
|---|---|---|
| `OFFICE_LEADERBOARD_URL` | the hosted board | address of a different leaderboard service; see [The leaderboard](leaderboard.md) |
| `OFFICE_TERMINAL` | unset | `1` opens the in-app terminal |
| `OFFICE_TERMINAL_SHELL` | your `$SHELL` | |
| `OFFICE_TERMINAL_MAX` | `4` | sessions at once |
| `OFFICE_TERMINAL_IDLE_MIN` | `30` | `0` never closes an idle shell |
