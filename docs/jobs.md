# Jobs

A job is one piece of work given to one agent in one project folder. You start
one by asking in the chat; the agent posts its result back there, and the
job's drawer (click the job, or the agent) shows everything it did.

## Clearance

**Clearance** decides what a job may do: *Plan only* changes nothing, *Edit
files* can edit but shell commands get blocked, *Full autonomy* runs anything.
When a job gets blocked, its drawer offers to grant clearance and continue the
same session. A finished plan can be approved and built the same way.

## Sizing the work

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

An agent can also clear its own context. Its `clear_context` tool takes notes
to itself (what is done, what is left, what it learned); when it ends its
turn the office closes the session and starts the job again fresh, carrying the
brief, those notes and any message that arrived meanwhile. The history is what
costs tokens on every turn, so this is the way to shed it at a natural break.
Once a session's context passes `AGENT_CLEAR_TOKENS` (150,000 by default, `0` to
turn it off), the next message the agent receives carries a one-time nudge to do
this. Clearing is still the agent's call. The log records each clear, and it is
capped at five per job.

The boss can also just say "clear context" in chat, for everyone or for named
agents. The chief of staff does it directly: a working agent restarts fresh when
its current turn ends (carrying its last reply as notes), and a finished job
forgets its session so the next reply starts clean.

Neither kind of clear loses track of the work. The office keeps a short note on
the job (`lastClear`: the agent's last report, or the brief if it had not
reported) and shows it in the job's log. A reply to a cleared job carries the
note and the brief into the fresh session, and any new job the agent takes
mentions what they were last on, so "what were you doing?" still has an answer.

## What changed

When a job starts, the office snapshots the project's working tree; when it
finishes, it snapshots it again and diffs the two. The drawer shows the result
as one line — files changed, lines added and removed — that opens into the
file list, and any file opens into its patch.

The snapshots are git tree objects built from a throwaway index, so nothing in
the repo's own index, stash or history is touched, and untracked files are
included (ignored ones aren't). A job resumed with a reply keeps its first
snapshot, so the card covers the whole job. Projects that aren't git
repositories don't get a card.

## When the server restarts

Jobs with a session resume where they left off. A restart asked for from
inside the office (`/restart`, or an agent's `restart_office`) waits for
everyone to finish their turn first; see
[Development](development.md#shipping-a-server-change).
