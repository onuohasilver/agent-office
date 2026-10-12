# The leaderboard

An optional board where offices compare how much they got done. It is off
until you join. Every office uses the same hosted service, https://agent-office-leaderboard.agent-office-leaderboard.workers.dev,
so there is nothing to set up (the service's code is in
[`leaderboard/`](../leaderboard/README.md)).

## What is ranked

Three boards, each for this week (Monday to Sunday, UTC) or all time:

- **Jobs**: jobs finished. Failed and stopped jobs don't count.
- **Tokens**: input plus output tokens your agents used. Cached context is left
  out, since it is the same tokens read again.
- **Time**: agent time, the time agents spent working on turns, added up. Two
  agents working side by side for an hour is two hours. Waiting on a colleague
  or on you isn't counted.

Tokens and time reward using the office more, not doing better work, so treat
the board as a bit of fun. Counts are reported by each office and can't be
verified.

## Your own counters

The office keeps the day-by-day counters in `data/activity.json` whether or not
you join, so they survive clearing the job list. They are three numbers per UTC
day. Nothing leaves your machine until you join.

## Joining

1. Open the trophy button in the sidebar header.
2. Pick a handle (3 to 20 letters, numbers, `-` or `_`). Handles are first come,
   first served, and not case-sensitive.
3. The office makes a random secret, claims the handle with it, and starts
   sharing.

Joining shares the last 14 days of your counters, then each change a minute or
so after it happens. A day's numbers are set, not added, so a retry never
counts twice.

## What is shared

Per UTC day: jobs finished, tokens, seconds of agent time. Plus the handle.
That is all: no prompts, project or file names, chat, cost, plan usage, or
anything that identifies you beyond the handle you picked.

The service stores a hash of your secret (never the secret), your handle, and
those day counters. Boards list handles and totals.

## Leaving

"Leave and delete my data" asks the service to delete your handle and counters,
then forgets the secret here. If you have [linked offices](linked-offices.md), only your counters are deleted: the handle stays, because the links need it. If the service can't be reached, nothing changes
and you can try again. Your local `data/activity.json` stays; delete it if you
want that gone too.

## Using a different service

The hosted address is built in. To use a board you host yourself instead, set
its address and restart the office:

```
OFFICE_LEADERBOARD_URL=https://your-service.example npm start
```

It must be `https` (plain `http` works only for `localhost`). Either way,
nothing is sent until you join.
