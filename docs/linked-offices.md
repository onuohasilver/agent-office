# Linked offices

Two Agent Offices on different machines can link with a code. Linked offices see
each other's agents walk into their 3D office as visitors. An office can also
invite a **guest**, who can then start jobs with the host's agents, within limits
the host sets.

Linking is off until you make or enter a code. It uses the same hosted service
as [the leaderboard](leaderboard.md), so there is nothing to set up.

## Linking two offices

1. One of you opens the chain button in the sidebar header and picks **Invite
   an office**. If your office has no handle yet, it asks for one first. A
   handle doesn't put you on the leaderboard.
2. Send the code (it looks like `K7QX-M2PD`) to the other person however you
   like. It works once and expires after 24 hours.
3. They open the chain button, pick **Enter a code**, and paste it in. Case,
   dashes and spaces don't matter.

Either of you can **Unlink** from the same panel at any time.

## What a linked office sees

Your agents' names, roles, looks, what they are doing (working, idle, on a
break, in a meeting, gone home). That's all: no job titles, projects, files,
logs, prompts, chat or cost. To let linked offices see the titles of the jobs
your agents are on, start the office with `OFFICE_SHARE_JOB_TITLES=1`.

Their agents walk in at the door, wear a visitor tint, and carry the office's
handle on their nameplate (`Kai · @friend`). They don't use your desks. When
they're working they stand at the hot desks, and on a break they join the pool
table or the coffee. Up to six visitors are shown at once; the rest are counted
on a sign by the door.

## Inviting a guest

A guest can start jobs with your agents, in your projects, on your Claude
account. Pick **Invite a guest** and choose:

- **Projects:** at least one. The guest can't see or touch any other project.
- **Clearance cap:** *Plan only*, or *Edit files* (the default). *Full autonomy*
  has to be ticked on its own. It lets the guest run any command on this
  machine.
- **Tokens per day:** 2,000,000 by default. Once a guest has used their tokens,
  their running jobs stop and new ones are refused until midnight UTC.

A guest can start up to three jobs at a time, reply to them, stop them, and see
their logs and changes. They can't see your other jobs, chat or channels, and
they can't restart the office, or change staff or settings.
Their jobs show `from @handle` in your job list, and you can stop any of them.
Agents working for a guest can't message or hand work to your other agents.
They also don't get your MCP servers or claude.ai connectors (mail, Slack,
calendar and so on), your user-level Claude Code settings and hooks, your
Claude Code memory, or your attachments.
Unlinking a guest stops their running jobs straight away.

Even at *Edit files*, a guest can change files that run later, such as
`package.json` scripts, build files or git hooks. Only invite someone you would
trust with those projects. *Plan only* is the safe choice.

## Visiting as a guest

When an office has made you its guest, its row in the Links panel has **Visit
@host**. It opens the host's office, showing their agents and your jobs there.
A bar at the top shows whose office you're in and your limits, and **Back to my
office** takes you home. Only the projects and clearances you're allowed are
offered.

## What the service keeps

Your handle, a hash of your office's secret, which offices you're linked to, and
open invites (as hashes of the codes). Presence and messages pass through
without being stored. Guest limits and token counts stay on the host's machine,
in `data/links.json` and `data/guests.json`.

## Using a different service

`OFFICE_LEADERBOARD_URL` points linking at another service too, as described in
[The leaderboard](leaderboard.md#using-a-different-service). Offices can only
link if they use the same service.
