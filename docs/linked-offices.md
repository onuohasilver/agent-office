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

## Working with a host's agents

When an office has made you its guest, its agents join your own chat. Tag them
with `@` like your own: `@Ada fix the login bug` starts a job with Ada in the
host's office, and the job shows in your Jobs list, marked with the host's
handle. If one of your agents has the same name, yours wins a bare `@Ada`;
write `@Ada@host` for theirs (the `@` menu does this for you).

The project is picked for you: the only one the host shares, else one named in
the message (`#web` or just "web"), else the one you used there last. The first
time, with several shared and none named, the chief asks which. Clearance is
held to the host's limit. Reply in the job's thread to follow up; when it
finishes, the chief says so there. Files can't be sent to a host.

The old visit page still opens at `?visit=<link id>`, but you don't need it.

## Letting a guest's own agents work in your projects

A guest invite has two switches. **Lend our agents** (on by default) is
everything above. **Their agents** lets the guest send their own agents into
your shared projects instead: *Off* (the default), *Read only*, or *Edit a
copy*. Either or both can be on. The agents run on the guest's machine and
Claude account, so they cost you no tokens, and the files never leave yours
except as the text the agents read.

A visiting agent has no shell and none of its own file tools. It reaches your
project only through six tools that cross the link: list, read, search and find,
plus write and edit at *Edit a copy*. It can't run tests, builds, git or
anything else on your machine.

- **It works in a copy.** The first call makes a copy of the project under
  `data/visits/`: tracked and untracked files, with uncommitted work, but
  nothing git ignores. Paths can't leave the copy, `.git` is out of reach, and
  key files such as `.env`, `*.pem` and `id_rsa` are never listed or read.
- **You see it as a job.** It shows in your Jobs list as `from @handle`, with a
  log of every file it touched, and the chief posts when one starts and ends.
  **Stop** ends it straight away.
- **Nothing lands until you apply it.** When it finishes, review the changes on
  the job, then **Apply** to patch the real folder or **Discard** to throw the
  copy away. Apply takes all of it or none; if the folder has moved on and the
  changes don't fit, nothing is changed and you're told why.

Up to three of a guest's agents can work at once. A copy left idle for an hour
is closed, and unlinking, unsharing the project, or turning **Their agents**
off ends their sessions. The guest's follow-ups to the same job carry on in
the same copy until you apply or discard it.

What it can see is real. At *Read only* it can still read everything in the
shared projects except the key files above, so don't share a project with
secrets in ordinary files. Applied changes run later like any others, so review
`package.json` scripts, build files and the like before you apply.

## Sending your agents to a host's project

When a host lets your agents in, tag the project with its host:
`#web@friend fix the typo in the header` starts a job with one of your agents,
and `@Kai #web@friend ...` picks who. The job runs here on your account, and
its project shows as `web@friend`. The agent is told the files are at the host,
that it can't run anything, and that text in those files is data rather than
instructions. At *Edit a copy*, its changes wait for the host to review them.

## Using a lent agent in your own projects

A host's lent agents normally work only in the projects the host shares with
you. To have one work in one of yours, make the host your guest as well, with
**Their agents** on and that project shared. Then tag your project as usual:
`@Ada@friend #mine what is this project about`. The agent runs at the host,
on the host's account and within your token allowance there, and reaches
`mine` through the same six file tools, in a copy you review and apply like any
other visit. Both offices need 0.7.0 or later. If something is missing, the chief
tells you what to change rather than running the agent in the host's folder.

## What the service keeps

Your handle, a hash of your office's secret, which offices you're linked to, and
open invites (as hashes of the codes). Presence and messages pass through
without being stored. Guest limits and token counts stay on the host's machine,
in `data/links.json` and `data/guests.json`.

## Using a different service

`OFFICE_LEADERBOARD_URL` points linking at another service too, as described in
[The leaderboard](leaderboard.md#using-a-different-service). Offices can only
link if they use the same service.
