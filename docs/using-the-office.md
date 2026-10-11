# Using the office

## Talking to the office

There's no form: you chat. Type `@` to tag an agent and `#` to name a project.

- `@Ada #storefront check the open PRs` goes straight to Ada.
- Untagged messages go to the **chief of staff** at reception (Sonnet by
  default), who decides who should handle them:
  - a message that relates to a running job is handed to that agent *live*,
    and they fold it into the work they're already doing;
  - a follow-up to a finished job resumes that agent's session;
  - new work goes to whoever's free, or queues for the agent you tagged;
  - if it can't tell which project you mean, it asks.
- Agents post their results back into the chat.

Attach files with the paperclip, by pasting, or by dropping them on the
composer. A screenshot is shown to the chief itself, so "this again" over a
picture of an error is enough to route on: it reads the picture, picks the
project and the agent from what's in it, and writes the brief in words. Other
file types (and the audio of a voice note) it can't open, so those go by name
and the agent reads them with the Read tool — the path travels with the job.

The clearance and model pickers under the composer apply to new work. The
model picker starts on **Chief picks**, which hands the choice to the chief
(see [Jobs](jobs.md#sizing-the-work)); choosing a model yourself overrides it for
that job.

### Channels

The chat is split into channels, the way Slack is. `#general` is always
there; the `+` in the channel bar opens another one for a strand of work,
and a channel with nothing left in it can be closed again.

Every message belongs to exactly one channel. What you ask in `#design`
stays in `#design`: the chief answers there, the agent who picks the job up
reports back there, anything they hand to a colleague stays there too, and
the chief only reads that channel's history when deciding what you meant.
Threads live in their channel. A channel you aren't reading shows a count of
what you've missed.

### Threads

A message stays where you sent it. Type in the main chat and it stays in the
main chat; reply in a thread and the whole exchange stays in that thread.
Nothing is ever moved after you have seen it.

What threads collect is an agent's updates on a job, which hang under the
message that started the job as a summary line you can open. So when you
follow up on running work from the main chat, your message and the chief's
answer stay in front of you, and the answer carries a link to the thread the
updates are collecting in.

## Getting around

Drag to move, right-drag (or `Q` / `E`) to turn around what's in the middle
of the view, scroll to zoom toward the cursor, double-click to glide somewhere.
`W A S D` pan, `R` recenters. The walls nearest you drop down so you can always
see in. Chat and job details sit in their own columns and never cover the
office, and `⌃`` opens the terminal drawer beneath it.

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

## The break room

Agents with nothing on drift to the break room, and every so often two of
them turn to each other and talk. One short call to a small model (Haiku by
default) writes the exchange from who they are, how they feel about each
other and what they have been working on, so it costs a fraction of a chat
message. At most one is written every two minutes; between those, and if the
call fails, they fall back to canned small talk. `BANTER=off` keeps it canned.

What they say lands in **#chill-room**, a channel that is always there, that
everyone is in, and that can't be closed. It keeps its own 60 most recent
lines, so small talk never pushes the day's work out of the chat history, and
it is never read aloud.

Two idle agents will sometimes walk over to the pool table instead and play a
real game of eight-ball, a shot at a time. The start and the result go to
#chill-room. Anyone handed work, called to standup or sent home drops what
they're doing, and the chat or the game ends there.

With the office open in two windows, each conversation and each game is
claimed from the server first, so it happens once rather than once per window.

## Levels

Shipped jobs earn XP. Each level hires one more agent, so more jobs run at
once (3 at level 1, up to 8).

## Appearance

The palette button at the top of the sidebar picks a theme (Paper, Ocean,
Forest, Sunset, Lavender) and light, dark or automatic mode. The choice is
kept in this browser.
