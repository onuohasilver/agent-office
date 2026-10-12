# Agent Office leaderboard and relay

A Cloudflare Worker with a D1 database and a `Mailbox` Durable Object per
office. It keeps a claimed handle per office and, per UTC day, jobs finished,
tokens and seconds of agent time. See [the leaderboard doc](../docs/leaderboard.md)
for what the office sends. It is also the relay for linked offices: invite
codes, links, and one socket per office that passes frames between linked
offices. See [the linked offices spec](../docs/proposals/linked-offices.md).

## Deploy

```
cd leaderboard
npm install
npx wrangler d1 create agent-office-leaderboard   # paste the id into wrangler.toml
npm run db:remote                                  # creates the tables; safe to run again after a schema change
npm run deploy
```

The public board is deployed at https://agent-office-leaderboard.agent-office-leaderboard.workers.dev
and is the office's built-in default (`DEFAULT_URL` in `server/leaderboard.js`).
To point an office at another deployment, set `OFFICE_LEADERBOARD_URL`.

## Try it locally

```
npm install
npm run db:local
npm run dev                  # http://localhost:8787
node test.mjs                # in another terminal; claims and deletes its own handles
```

`test.mjs` makes 6 claim attempts and several code redemptions. The service
allows 100 claims per hour per address but only a few redemptions a minute, so
a second run within the minute fails. Locally, reset the database
(`rm -rf .wrangler`, then `npm run db:local`) and restart `npm run dev`.
Against a real deployment (`node test.mjs <url>`), wait a minute. A failed run
still deletes its handles.

## API

| | |
|---|---|
| `POST /v1/claim` `{handle}` | claim a handle; `Authorization: Bearer <secret>` |
| `PUT /v1/days` `{days:[{day,jobs,tokens,seconds}]}` | set day counters |
| `GET /v1/me` / `DELETE /v1/me` | who am I / forget me |
| `DELETE /v1/days` | off the board; the handle and links stay |
| `GET /v1/board?period=week\|all` | public; top 50 by jobs, tokens and time; cached 60 s |
| `POST /v1/invites` `{kind}` | `link` or `guest`; a one-time code for 24 hours |
| `POST /v1/invites/redeem` `{code}` | link with whoever made the code |
| `GET /v1/links` / `DELETE /v1/links/:id` | list / unlink; both sides get an `unlink` frame |
| `GET /v1/socket` | WebSocket for relay frames, one per office |

A user is the SHA-256 of their secret, which is never stored. Days must be
within the last 14 days (or tomorrow), each at most 500 jobs, 500M tokens and
1,000,000 seconds; anything else is refused rather than clamped. One sync per
20 seconds per user, 100 claims per hour per address. 20 open invites per
office, 3 redeem tries a minute. Frames up to 64 KB, 20 a second on average
with bursts of 60. Invite codes are kept only as hashes, and the relay stores
no frames: an office's last presence lives in its Mailbox's memory.

## Running it

- The board is public by design; it shows handles and totals only.
- Handles are claimed first come, first served. There is no moderation tool.
  Remove one with `npx wrangler d1 execute agent-office-leaderboard --remote
  --command "DELETE FROM users WHERE handle = 'name'"` (days go with it).
- Old rows in the `claims` table can be cleared at any time.
