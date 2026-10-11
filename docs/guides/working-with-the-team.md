# Working with the team

Habits that get better work out of the office for less.

## Write briefs like you would for a colleague

The agent starts knowing nothing but the project folder and what you wrote.

- **Say what done looks like.** *"Make the tests pass"* is clearer than
  *"look at the tests"*.
- **Point at the place.** A file, a route, an error message. Paste the error
  or drop a screenshot on the composer — the chief can read screenshots.
- **Say what not to touch** if it matters: *"don't change the public API"*.
- **One job, one outcome.** Three unrelated fixes are three jobs; they can run
  at the same time with three agents.

## Pick the clearance for the job, not the agent

| Job | Clearance |
|---|---|
| "How does X work?", "plan the migration" | **Plan only** — nothing changes |
| Most code changes | **Edit files** — no commands |
| Needs tests, builds, git, installs | **Full autonomy** |

You don't have to guess right. An *Edit files* job that needs a command stops
and asks, and you can grant it then. A *Plan only* job ends with a plan you
can approve and have built.

## Let the chief pick the model

**Chief picks** sends small mechanical work to Haiku, ordinary work to Sonnet
and hard work to Opus, and steps up a rung on its own when a job fails.
Choose a model yourself only when you know better — and then it won't change.

## Use channels for strands of work

Everything said in a channel stays in it, and the chief only reads that
channel's history when working out what you mean. A `#billing` channel for a
week of billing work keeps the context tight and the chief's answers sharp.

## Follow up in the thread

Replying in a job's thread resumes the same agent's session, so they keep
everything they already read. A new message in the main chat may go to
someone else, who starts from scratch.

## Keep an eye on cost

- The bar at the top shows what's working, queued, shipped and spent.
- On the Claude Code login, the **Session** and **Week** meters show how much
  of your plan is used. They turn amber at 70% and red at 90%.
- Each job's drawer shows its model and how much context its last turn
  carried. A long-running session gets expensive; a fresh job with a good
  brief is often cheaper than one more follow-up.
- Break-room talk uses a small model at most once every two minutes. Turn it
  off with `BANTER=off` if you'd rather it didn't.
