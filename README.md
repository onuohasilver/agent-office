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
- Untagged messages go to the **chief of staff** at reception, a fast model
  (Haiku by default) that decides who should handle them:
  - a message that relates to a running job is handed to that agent *live*,
    and they fold it into the work they're already doing;
  - a follow-up to a finished job resumes that agent's session;
  - new work goes to whoever's free, or queues for the agent you tagged;
  - if it can't tell which project you mean, it asks.
- Agents post their results back into the chat.

The clearance and model pickers under the composer apply to new work.

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
| `CHIEF_MODEL` | `haiku` |

The server only listens on 127.0.0.1 and refuses requests from other origins,
because it can start Claude with full permissions. State lives in
`data/state.json`.
