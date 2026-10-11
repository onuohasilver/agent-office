# Configuration

The common choices are options to the command — the projects folder, `--port`,
`--data`, `--terminal`, `--no-open`; see
[Getting started](getting-started.md#options). Everything else is an
environment variable, e.g. `CHIEF_MODEL=haiku agent-office`. In-app choices — Claude access, the
voice toggle, team profiles, theme — are made in the office and remembered.

## The office

| Env | Default | |
|---|---|---|
| `OFFICE_ROOT` | where you start it (a clone: the folder above it) | its subfolders are the projects |
| `OFFICE_DATA` | `~/.agent-office` (a clone: `data/`) | where state, attachments and models are kept |
| `PORT` | `4317`, or the next free one | |
| `OFFICE_ALLOWED_HOSTS` | none | extra hostnames to accept, comma-separated; see [On your phone](phone.md) |

## Claude

| Env | Default | |
|---|---|---|
| `CLAUDE_BIN` | `claude` | the Claude Code binary |
| `ANTHROPIC_API_KEY` | none | used when Claude access is set to *API key* and none was pasted; see [Claude access](claude-access.md) |
| `CLAUDE_CODE_OAUTH_TOKEN` | none | a Claude Code login token, for the login mode and the plan meters |
| `CHIEF_MODEL` | `sonnet` | the chief of staff, and the standup write-up |
| `AGENT_COMPACT_PCT` | `60` | how full an agent's context gets before Claude Code compacts it |

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
| `WHISPER_MODEL` | the best model in `whisper/` in the data folder | point it at a bigger one (`ggml-small.en.bin`) to trade speed for accuracy |
| `PIPER_BIN` | `piper/venv/bin/python` in the data folder | the voices live in `piper/voices` |
| `FFMPEG_BIN` | `ffmpeg` | |

## Terminal

| Env | Default | |
|---|---|---|
| `OFFICE_TERMINAL` | unset | `1` opens the in-app terminal |
| `OFFICE_TERMINAL_SHELL` | your `$SHELL` | |
| `OFFICE_TERMINAL_MAX` | `4` | sessions at once |
| `OFFICE_TERMINAL_IDLE_MIN` | `30` | `0` never closes an idle shell |
