# Agent Office

A 3D office where the staff are Claude Code agents. Hand someone a job and they
walk to a desk and do it for real, in that project folder, with `claude -p`.

```bash
npm install
npm start            # builds, then serves on http://localhost:4317
npm run dev          # hot reload on http://localhost:5317
```

## Talking to the office

There's no form: you chat. Type `@` to tag an agent and `#` to name a project.

- `@Ada #Afriex check the open PRs` goes straight to Ada.
- Untagged messages go to the **chief of staff** at reception (Sonnet by
  default), who decides who should handle them:
  - a message that relates to a running job is handed to that agent *live*,
    and they fold it into the work they're already doing;
  - a follow-up to a finished job resumes that agent's session;
  - new work goes to whoever's free, or queues for the agent you tagged;
  - if it can't tell which project you mean, it asks.
- Agents post their results back into the chat.

Attach files with the paperclip, by pasting, or by dropping them on the
composer. A screenshot is shown to the chief itself, so "this again" over a
picture of an error is enough to route on: it reads the picture, picks the
project and the agent from what's in it, and writes the brief in words. Other
file types (and the audio of a voice note) it can't open, so those go by name
and the agent reads them with the Read tool — the path travels with the job.

The clearance and model pickers under the composer apply to new work. The
model picker starts on **Chief picks**, which hands the choice to the chief
(see *Sizing the work* below); choosing a model yourself overrides it for
that job.

### Channels

The chat is split into channels, the way Slack is. `#general` is always
there; the `+` in the channel bar opens another one for a strand of work,
and a channel with nothing left in it can be closed again.

Every message belongs to exactly one channel. What you ask in `#design`
stays in `#design`: the chief answers there, the agent who picks the job up
reports back there, anything they hand to a colleague stays there too, and
the chief only reads that channel's history when deciding what you meant.
Threads live in their channel. A channel you aren't reading shows a count of
what you've missed.

### Threads

A message stays where you sent it. Type in the main chat and it stays in the
main chat; reply in a thread and the whole exchange stays in that thread.
Nothing is ever moved after you have seen it.

What threads collect is an agent's updates on a job, which hang under the
message that started the job as a summary line you can open. So when you
follow up on running work from the main chat, your message and the chief's
answer stay in front of you, and the answer carries a link to the thread the
updates are collecting in.

## Talking out loud

You can say it instead of typing it, and hear the answer back. None of it
leaves the machine: `whisper.cpp` does the listening and the system voices do
the talking.

```bash
brew install ffmpeg whisper-cpp
npm run voice:model        # ~148 MB, ears
npm run voice:piper        # ~700 MB, voices
```

The microphone sits next to the paperclip, and `⌥M` works from anywhere.
Click once to start, again to stop. What you said lands **in the composer**
rather than going straight out, so you can fix a misheard name before anyone
acts on it, and the recording rides along attached so you can hear what you
actually said. Escape throws a recording away.

The office knows its own vocabulary, so spoken names come back spelled the way
the chief can route on them: "Ada, check the open PRs in Afriex" arrives as
*Afriex*, not *a freaks*. Say `@` and `#` tags as plain names — the chief reads
them either way.

The speaker button in the top right turns on replies in kind. The chief and
the agents reporting back to you each record a **voice note** in their own
voice, attached to the message: it plays as it lands and stays there to
replay. Everyone sounds different, so you know who's talking without looking,
and standup becomes something you can listen to while doing something else.

The voices are [Piper](https://github.com/OHF-Voice/piper1-gpl), a neural
text-to-speech model that runs here — Apple's built-in voices are a decade
older and sound it. A line takes a few seconds to record, which is why agents
send notes rather than narrating live: the text lands immediately and the
voice catches up. Without Piper installed the office falls back to the system
voices, spoken live by the browser.

Agent-to-agent asides and break-room talk stay unspoken; they'd be constant,
and they aren't for you. Markdown, code blocks and file paths are stripped
before anything is said, because nobody wants to hear "backtick slash server
slash index dot j s backtick" — the bubble keeps the detail. The small speaker
on any message replays just that one.

Agents never hear audio themselves: `claude -p` takes text, so a voice note
reaches them as its transcript.

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

## Daily standup

Every weekday at 9:30 the team gathers in a circle by the whiteboard. One at
a time, everyone on the floor says what they got done since the last standup,
what they're on today and what's blocking them, and the chief wraps up: the
focus, the risks and who's free. Agents who've gone home don't attend. The
updates come from the job history, written up by one call to the chief's
model; a quiet office skips that call, and if it fails the updates are built
from the facts alone.

Call one any time with the people button in the top right, `/standup` in the
chat, or just by asking ("standup time"). If the office opens after 9:30, the
day's standup happens then, but not after 6pm, and a day with nothing to
report is skipped. Jobs keep running during standup, and agents who start work
later in the day are told what the team said.

## Getting around

Drag to move, right-drag (or `Q` / `E`) to turn around what's in the middle
of the view, scroll to zoom toward the cursor, double-click to glide somewhere.
`W A S D` pan, `R` recenters. The walls nearest you drop down so you can always
see in. Chat and job details sit in their own columns and never cover the
office, and `⌃`` opens the terminal drawer beneath it.

## A terminal, if you want one

There is a real shell in the drawer under the office: `⌃``, or the terminal
button in the top right. Tabs across the top, `+` opens another, and the picker
beside it chooses which project folder the next one starts in. Drag the top
edge to resize — the office makes room rather than hiding behind it. It is a
proper pty, so `vim`, `top`, `git add -p`, colours and your own prompt all work
the way they do in a terminal app.

It is off until you ask for it:

```bash
OFFICE_TERMINAL=1 npm start
```

That switch exists because shell access is the one door in the building that
doesn't care about clearance. A job runs with the mode you picked and leaves a
log; a shell is you, with everything you can do, and no record of what it did.
So:

- **Off by default.** No flag, no terminal — the socket won't even open.
- **This machine's browser only.** The server already refuses any request whose
  host or origin isn't local. On top of that, a session needs a single-use
  ticket that expires in ten seconds, and tickets are only handed out on that
  origin-checked route — the socket accepts nothing else.
- **Not for the staff.** No agent can open one. There's no office tool and no
  `/api/agent` route that reaches it, and a shell never inherits the job
  credentials the office gives its own children.
- **Nothing is kept.** Not in `data/state.json`, not in the chat, not on the
  main socket. Scrollback lives in the tab and dies with it. `data/terminal.log`
  records when sessions opened and closed and in which folder — never
  keystrokes, because a log of what you typed into a shell is a file full of
  passwords.
- **It tidies up.** Closing a tab hangs up the shell, a session with nothing
  happening closes itself after 30 minutes, and there's a cap on how many can
  be open at once.

What it is *not* is a sandbox. The shell runs as you and `cd ..` walks out of
whichever folder it started in; picking the folder is a convenience, not a
boundary. Leave it off on any machine where "whoever has the browser" isn't
just you.

The terminal needs [`node-pty`](https://github.com/microsoft/node-pty), which
builds natively — it's an optional dependency, so `npm install` on a machine
without build tools still gets you the whole office, just without this. On
macOS: `xcode-select --install`, then `npm install`.

## How the office works

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

Under the level bar, two meters show how much of your Claude plan is used:
**This session** (the 5-hour window) and **This week**, each with when it
resets and a countdown. They turn amber at 70% and red at 90%. The server reads
the same numbers as Claude Code's `/usage`, using the login Claude Code keeps
on this machine (the macOS keychain, `~/.claude/.credentials.json`, or
`CLAUDE_CODE_OAUTH_TOKEN`). It checks every two minutes and shortly after each
turn finishes.

Shipped jobs earn XP. Each level hires one more agent, so more jobs run at
once (3 at level 1, up to 8).

### Sizing the work

Most jobs don't need the most capable model, so the chief picks one when the
model picker is left on **Chief picks**: *Haiku* for small mechanical changes,
*Sonnet* for ordinary work, *Opus* for genuinely hard work. The rung it chose
is shown beside its reply in the chat, and in the job's drawer.

A job that **fails** on a model the chief picked goes back in the queue one
rung up — Haiku to Sonnet to Opus — and the chat says so. So does a finished
job you send back as wrong or incomplete. Escalation stops at Opus, and a job
that failed before the model ever got a turn (a missing folder, a binary that
won't start) stays where it is: a dearer model would fail the same way.

The retry starts a fresh session carrying the brief and a summary of what the
last attempt reported, rather than resuming it. The prompt cache belongs to
the model that filled it, so resuming would have the dearer model read the
whole failed transcript at full price. A job you picked the model for yourself
never moves on its own.

The drawer shows each job's model and how much context its last turn carried,
so a session that has grown expensive is visible rather than guessed at.

**Clearance** decides what a job may do: *Plan only* changes nothing, *Edit
files* can edit but shell commands get blocked, *Full autonomy* runs anything.
When a job gets blocked, its drawer offers to grant clearance and continue the
same session. A finished plan can be approved and built the same way.

## Settings

| Env | Default |
|---|---|
| `OFFICE_ROOT` | the folder above this one; its subfolders are the projects |
| `PORT` | `4317` |
| `CLAUDE_BIN` | `claude` |
| `CHIEF_MODEL` | `sonnet` |
| `STANDUP_AT` | `09:30` (local time), or `off` |
| `STANDUP_WEEKENDS` | unset; `1` holds standups on weekends too |
| `WHISPER_MODEL` | the best model in `data/whisper`; point it at a bigger one (`ggml-small.en.bin`) to trade speed for accuracy |
| `PIPER_BIN` | `data/piper/venv/bin/python`; the voices live in `data/piper/voices` |
| `WHISPER_BIN` | `whisper-cli` |
| `FFMPEG_BIN` | `ffmpeg` |
| `OFFICE_TERMINAL` | unset; `1` opens the in-app terminal |
| `OFFICE_TERMINAL_SHELL` | your `$SHELL` |
| `OFFICE_TERMINAL_MAX` | `4` sessions at once |
| `OFFICE_TERMINAL_IDLE_MIN` | `30`; `0` never closes an idle shell |

The server only listens on 127.0.0.1 and refuses requests from other origins,
because it can start Claude with full permissions — and, if you turned it on,
hand out a shell. State lives in `data/state.json`.
