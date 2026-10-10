# Agent Office

A 3D office where the staff are Claude Code agents. Hand someone a job and they
walk to a desk and do it for real, in that project folder, with `claude -p`.

```bash
npm install
npm start            # builds, then serves on http://localhost:4317
npm run dev          # hot reload on http://localhost:5317
```

## How the office works

Every staff member is one headless `claude` process. What they do on screen is
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

The server only listens on 127.0.0.1 and refuses requests from other origins,
because it can start Claude with full permissions. State lives in
`data/state.json`.
