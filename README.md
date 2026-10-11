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

The clearance and model pickers under the composer apply to new work.

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
office.

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

The server only listens on 127.0.0.1 and refuses requests from other origins,
because it can start Claude with full permissions. State lives in
`data/state.json`.
