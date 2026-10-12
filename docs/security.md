# Security

The office starts Claude in your projects, can give it full autonomy, and can
hand out a shell. It is built to be used by one person, on their own machine.

## Who can reach it

- The server listens on `127.0.0.1` only.
- Every request's `Host` and `Origin` must be local (or a name in
  `OFFICE_ALLOWED_HOSTS`), which keeps other websites and DNS-rebinding
  attacks out of it. A page on another localhost port counts as another
  website.
- The office has a key, made on first start and kept in `data/office-key` with
  mode `0600`. Other accounts on the machine can reach `127.0.0.1` too, so the
  page, the API and the socket all need the key. The address the office prints
  when it starts carries the key once; your browser keeps it in a cookie
  (HttpOnly, SameSite=Strict). `agentoffice --link` prints that address again.
  Delete `data/office-key` and restart to sign every browser out.
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
  `auth.json` in the data folder with mode `0600`, passed only to the `claude` processes the
  office starts, and never sent to the browser, which sees the last four
  characters.
- The data folder is outside the package (`~/.agent-office`), or git-ignored `data/` in a clone.

## The leaderboard

Off until you join, and then the only thing besides Claude that the office
talks to. It sends a handle and three counters per day (jobs, tokens, agent
time) to the hosted leaderboard service (or the one named by
`OFFICE_LEADERBOARD_URL`), signed with a random
secret kept in `data/leaderboard.json` (mode `0600`). Never prompts, projects,
files, chat or cost. Details in [The leaderboard](leaderboard.md).

## Linked offices and guests

Off until you make or enter a code. The office only ever connects out to the
service, so nothing listens for other offices. A link shares your agents' names,
roles, looks and states (working, on a break and so on), and nothing else. Job
titles stay home, since a title is the first line of a prompt;
`OFFICE_SHARE_JOB_TITLES=1` shares them. Everything a linked office
sends is checked and trimmed before your browser sees it.

A **guest** runs jobs on your machine, on your Claude account. Everything is
enforced on your side and the guest's office is never trusted:

- only the projects you picked;
- at or below the clearance cap you set;
- within the tokens per day you set;
- no terminal, settings, chat, or other people's jobs;
- their agents can't reach your other agents;
- their jobs don't get your MCP servers or claude.ai connectors, your
  user-level Claude Code settings and hooks, or your Claude Code memory.

Even *Edit files* can change scripts or hooks that run later, so invite only
people you would trust with those projects. Details in
[Linked offices](linked-offices.md).

## The terminal

Off unless started with `--terminal` (`OFFICE_TERMINAL=1`). A session needs a single-use ticket from the
origin-checked API, no agent can open one, and keystrokes are never logged. It
is not a sandbox. Details in [The terminal](terminal.md).
