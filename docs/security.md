# Security

The office starts Claude in your projects, can give it full autonomy, and can
hand out a shell. It is built to be used by one person, on their own machine.

## Who can reach it

- The server listens on `127.0.0.1` only.
- Every request's `Host` and `Origin` must be local (or a name in
  `OFFICE_ALLOWED_HOSTS`), which keeps other websites and DNS-rebinding
  attacks out of it.
- Agents call back into the office (the roster, messages, hand-offs) with a
  per-job token that dies with the job.

Don't put it behind a public URL. If you reach it from your phone, do it over
a private network that is only you — see [On your phone](phone.md).

## What jobs may do

Each job runs with the clearance you picked — *Plan only*, *Edit files* or
*Full autonomy* — enforced by Claude Code's own permission modes, and leaves a
full log in its drawer. Full autonomy means what it says: the agent can run any
command you could.

## Claude credentials

- With the **Claude Code login**, the office never sees your credentials; the
  `claude` it starts reads them. The plan meters read the login's access token
  to ask for usage, and nothing else.
- With an **API key**, the key is checked with Anthropic, stored in
  `data/auth.json` with mode `0600`, passed only to the `claude` processes the
  office starts, and never sent to the browser, which sees the last four
  characters.
- `data/` is git-ignored.

## The leaderboard

Off until you join, and then the only thing besides Claude that the office
talks to. It sends a handle and three counters per day (jobs, tokens, agent
time) to the service named by `OFFICE_LEADERBOARD_URL`, signed with a random
secret kept in `data/leaderboard.json` (mode `0600`). Never prompts, projects,
files, chat or cost. Details in [The leaderboard](leaderboard.md).

## The terminal

Off unless `OFFICE_TERMINAL=1`. A session needs a single-use ticket from the
origin-checked API, no agent can open one, and keystrokes are never logged. It
is not a sandbox. Details in [The terminal](terminal.md).
