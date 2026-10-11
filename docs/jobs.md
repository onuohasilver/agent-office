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

Jobs with a session resume where they left off.
