# Agent Office leaderboard service

A Cloudflare Worker with a D1 database. It keeps a claimed handle per office
and, per UTC day, jobs finished, tokens and seconds of agent time. See
[the leaderboard doc](../docs/leaderboard.md) for what the office sends.

## Deploy

```
cd leaderboard
npm install
npx wrangler d1 create agent-office-leaderboard   # paste the id into wrangler.toml
npm run db:remote                                  # creates the tables
npm run deploy
```

Then run the office with `OFFICE_LEADERBOARD_URL` set to the Worker's address.
To make it the default for everyone, set `DEFAULT_URL` in
`server/leaderboard.js`.

## Try it locally

```
npm install
npm run db:local
npm run dev                  # http://localhost:8787
node test.mjs                # in another terminal; claims and deletes its own handles
```

`test.mjs` claims handles from one address and the service allows 10 claims per
hour, so wait or reset the local database (`rm -rf .wrangler`) between runs.

## API

| | |
|---|---|
| `POST /v1/claim` `{handle}` | claim a handle; `Authorization: Bearer <secret>` |
| `PUT /v1/days` `{days:[{day,jobs,tokens,seconds}]}` | set day counters |
| `GET /v1/me` / `DELETE /v1/me` | who am I / forget me |
| `GET /v1/board?period=week\|all` | public; top 50 by jobs, tokens and time; cached 60 s |

A user is the SHA-256 of their secret, which is never stored. Days must be
within the last 14 days (or tomorrow), each at most 500 jobs, 500M tokens and
1,000,000 seconds; anything else is refused rather than clamped. One sync per
20 seconds per user, 10 claims per hour per address.

## Running it

- The board is public by design; it shows handles and totals only.
- Handles are claimed first come, first served. There is no moderation tool.
  Remove one with `npx wrangler d1 execute agent-office-leaderboard --remote
  --command "DELETE FROM users WHERE handle = 'name'"` (days go with it).
- Old rows in the `claims` table can be cleared at any time.
