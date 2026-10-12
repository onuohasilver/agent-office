# Linked offices

Status: agreed with the boss on 2026-10-12, being built. The contract below is
what every piece builds against. Change it here first, then tell the others.

Two Agent Offices, anywhere, can link with a code. Linked offices see each
other's agents walk into their 3D office as visitors. An office can also invite
a **guest**, who can then start and run jobs with the host's agents.

## Decisions

- **One default relay on Cloudflare** (the leaderboard Worker, grown, at
  `https://agent-office-leaderboard.agent-office-leaderboard.workers.dev`, which
  is `DEFAULT_URL` in `server/leaderboard.js`), so any
  install works with no setup: get a code, enter a code, connected.
  `OFFICE_LEADERBOARD_URL` still overrides it for people who host their own.
- **Every office has its own key:** the random secret it already makes. It
  claims a handle once, and the handle no longer means "on the leaderboard".
- **Presence shares** each agent's name, role, look and state. Job titles
  are off by default since Ada's security sweep (approved by the boss);
  `OFFICE_SHARE_JOB_TITLES=1` turns them on. It doesn't share repos, logs, prompts or chat.
- **In 3D,** visitors walk into our office. We don't build a second room.
- **Guests** can use and run the host's agents, within limits the host sets per
  invite (below).

## Shape

```
 office A (127.0.0.1)  ──wss──▶  relay  ◀──wss──  office B (127.0.0.1)
   browser ◀── ws ── server                      server ── ws ──▶ browser
```

Offices only ever connect out. The server holds the relay socket, not the
browser. It decides what leaves the machine and checks everything that arrives.
The relay stamps who a frame is from, and offices never trust a self-reported
identity.

## Relay (leaderboard Worker plus a `Mailbox` Durable Object per office)

HTTP, `Authorization: Bearer <secret>` as today:

| Route | Body | Answer |
|---|---|---|
| `POST /v1/claim` | `{ handle }` | unchanged |
| `DELETE /v1/days` | | Removes counters only, so you're off the board but keep the handle and links. |
| `DELETE /v1/me` | | unchanged, and also drops links and invites |
| `POST /v1/invites` | `{ kind: "link" \| "guest" }` | `{ id, code, expiresAt }` |
| `POST /v1/invites/redeem` | `{ code }` | `{ link }` |
| `GET /v1/links` | | `{ links: [link] }` |
| `DELETE /v1/links/:id` | | `{ ok }`. Both sides get an `unlink` frame. |
| `GET /v1/socket` | WebSocket upgrade | One socket per office, held by its Mailbox |

- `link` is `{ id, peer: "<handle>", kind: "link" | "guest", role: "peer" | "host" | "guest", invite, createdAt }`.
  `invite` is the id of the invite that made the link. Only the side that made
  the invite gets it. That is how the host matches a guest link to the limits
  it set when it made the invite.
- An invite code is 8 Crockford base32 characters shown as `K7QX-M2PD`. The relay
  accepts any case, ignores dashes and spaces, and reads I/L as 1 and O as 0. It works
  once and lasts 24 hours. An office can have 20 open invites and 3 redeem tries
  a minute.
- D1 gets two new tables: `invites(code_hash, user_id, kind, expires_at)` and
  `links(id, a_user, b_user, kind, created_at)`. For a guest link, `a_user` is
  the host.
- The Mailbox keeps the socket using hibernation. It holds the office's last
  `presence` in memory, so a peer that connects later gets it straight away.
  Nothing else is stored.
- A frame can be at most 64 KB. Each office can send at most 20 frames a second
  on average, with bursts of up to 60.
- `role` is the receiving office's own role in the link: `host` or `guest` on a
  guest link, `peer` on a `link` link.
- The socket authenticates with `Authorization: Bearer <secret>` on the upgrade.
  A second socket from the same office replaces the first, which is closed with
  code `4000`; an office that sees `4000` doesn't reconnect, since another copy of
  it has taken over. Code `4001` means the office deleted itself (`DELETE /v1/me`). Once a socket opens, the relay sends `links`, then the
  latest presence from each linked office.
- Hibernation drops the in-memory presence. When a peer needs it and there is
  none, the relay sends the office `{ t: "want-presence" }`, and the office
  answers at once with a `presence` frame sent `all: true`, outside the 5 second
  gap. Only presence sent `all: true` is remembered; a presence sent to one link
  is never replayed to others.
- When an office's socket closes (other than by replacement), its peers get a
  `presence` with `agents: []` from it, so its visitors walk out.
- `{ "t": "ping" }` is answered `{ "t": "pong" }` without waking the Mailbox, for
  keepalives.

### Frames

Every frame is JSON with `t`. To send, an office sets `link` (to one link) or
`all: true` (presence only). The relay checks that the sender is on that link,
adds `from: "<handle>"`, and delivers it to the peer's Mailbox.

Delivered frames carry `from: "<peer handle>"` and `link: "<link id>"`, with
`all` removed. Each copy of an `all: true` presence gets its own link's id.

Directions are enforced: `presence` on any link; `req` from the guest only;
`res` and `feed` from the host only. Any other frame is dropped, as is one that
is too big, over the rate limit, or for a link the sender isn't on. The sender
gets `{ t: "error", error }` back for each dropped frame.

| `t` | Direction | Body |
|---|---|---|
| `presence` | office → its linked offices | `{ agents: [{ id, name, role, look: { shirt, hair, skin }, state, job: { title } \| null }] }`. `look` holds `#rrggbb` colours from STAFF. Hairstyle and outfit come from the `id`, through the table in `web/src/figure.js`. `state` is `working`, `idle`, `break`, `meeting` or `away`. Sent on change, at most once every 5 seconds. |
| `links` | relay → office, on connect | `{ links: [link] }` |
| `link` / `unlink` | relay → both offices | `{ link }` / `{ link: { id } }` |
| `req` / `res` | guest ⇄ host | `{ id, op, args }` / `{ id, ok, body \| code, error }`. `code` is an HTTP status (403 over a limit, 404 not yours, 429 out of tokens or jobs). |
| `feed` | host → guest | `{ msgs: [...] }`: the host's `job`, `log` and `staff` messages for the guest's own jobs, batched every 250 ms to stay under the frame rate |
| `want-presence` | relay → office | `{}`. Answer with presence at once. |
| `error` | relay → office | `{ error }`, for a dropped frame |

## Office server (`server/links.js`)

- Connects to `/v1/socket` once the office has a handle and at least one link.
  Reconnects with backoff from 1 s up to 60 s, plus jitter.
- Builds `presence` from staff and job state and sends it when it changes, at
  most every 5 seconds.
- Validates every inbound frame against the shapes above and drops anything
  else. Text is cut to fixed lengths: names 40, roles 60, titles 120.
- Sends these to the browser:
  - `{ t: 'visitors', offices: [{ link, handle, agents: [...] }] }`
  - `{ t: 'links', links: [...] }`
  `hello` carries both as `links` (the status below) and `visitors` (the
  `offices` array).
- API, behind the existing origin checks. "Status" means `{ handle,
  connected, error, links: [link + guest?] }`. `guest` holds `{ repos,
  clearance, tokensPerDay }` and appears only on links where we are the host.

| Route | Body | Answer |
|---|---|---|
| `GET /api/links` | | status |
| `POST /api/links/invite` | `{ kind, guest?: { repos, clearance, tokensPerDay }, handle? }` | `201 { id, code: "K7QX-M2PD", kind, expiresAt, guest }` |
| `POST /api/links/redeem` | `{ code, handle? }` | status |
| `DELETE /api/links/:id` | | status |

  If the office has no handle yet, `handle` claims one first.
- The handle is separate from the board (`server/leaderboard.js`):
  - The status adds `sharing`, which has the same value as `joined`.
  - `POST /api/leaderboard { handle }` still joins.
  - `POST /api/leaderboard/handle { handle }` only claims a handle.
  - `DELETE /api/leaderboard` deletes the counters (`DELETE /v1/days`) and keeps
    the handle while links exist. With no links, it forgets the office as
    before.

A guest's policy (`repos`, `clearance`, `tokensPerDay`) is kept on the host in
`data/links.json`. The relay never sees it.

## 3D visitors (`web/src/main.js`, `agent.js`)

- Each `visitors` agent becomes an `Agent`. It walks in at `office.door` and
  walks out when it is `away`, unlinked, or no longer listed.
- Visitors never sit at our 8 desks. When `working` they stand at a hot-desk
  spot. On `break` they go to the pool or the coffee table. In a `meeting` they
  stand around the break-room table.
- They have a visitor tint, and their nameplate shows `Name · @handle`. The
  hover card shows their role and job title.
- At most 6 visitors are shown, across all links. The rest go on a sign at the
  door: `+3 from @handle`.

## Guests

The host makes a `guest` invite and chooses, per guest:

- **Repos**, at least one. Guests can't see or touch any other repo.
- **Clearance cap:** Plan only, or Edit files (the default). Full autonomy has
  to be ticked explicitly, under a warning that the guest can then run any
  command on the host's machine.
- **Tokens per day**, by default 2M. Guest jobs run on the host's Claude account
  and plan.

The guest's office proxies the host's office through the relay. On the
guest's server, the visit stream's `hello` carries `visiting: { link, host,
repos, clearance, tokensPerDay }`, and new jobs go to
`POST /api/visit/:link/jobs`, which becomes a `req` with op `createJob`. The guest's
server serves `/ws/visit/:link`, which replays the host's `feed`, so the same
`main.js` renders the host's office with `visiting: true` and the controls a
guest can't use hidden.

On the guest's server, behind the usual origin checks: `POST /api/visit/:link/jobs`
`{ repo, prompt, mode, model }`, `GET /api/visit/:link/jobs/:id` (`{ job }`, 500 log
lines), `GET .../:id/diff?path=`, `POST .../:id/reply { text, mode }` and
`POST .../:id/stop`. Each one waits up to 15 s for the host (504 after that). The visit
socket closes `4404` when there is no such guest link or it is unlinked, and `4502`
when the host can't be reached. The visit hello carries `visiting: { link, host,
repos, clearance, tokensPerDay, tokensToday }`. A guest can have 3 jobs queued or
working at once.

A guest **can**:

- start jobs in their allowed repos, at or below their cap (`req` ops
  `createJob`, `reply`, `stop`; and to read: `hello`, `job`, `diff`);
- see the jobs they started, with their logs and diffs;
- see the host's office in 3D, through presence plus their own jobs.

A guest **can't**:

- restart the office, change staff, auth, leaderboard or
  links, or clear jobs;
- see or steer the host's other jobs, chat or channels.

The host enforces all of this. The guest's server is never trusted.

- **Agents on guest jobs:** their office tools are limited to `office_roster`
  and `flag_for_boss`, so a guest can't message the host's other agents or
  hand work to them.
- **Labelling:** guest jobs are tagged `from @handle` in the host's feed. The
  host can stop any of them.
- **Revoking:** unlinking a guest stops their running jobs and closes their view
  immediately.

## Build order

1. This contract. **Zola, done.**
2. In parallel, each built against the contract and tested with fakes:
   - **A. Relay**, the Worker plus `Mailbox`, routes, tests in `test.mjs`.
     **Tunde.**
   - **B. Office server link client**, `server/links.js`, the API and the
     handle/board split in `leaderboard.js`. **Zola, done.** It is tested
     against a fake relay, and end to end through the local relay with two
     offices (`/tmp/zola-links-test/e2e.mjs`). The smoke test passes.
   - **C. 3D visitors**, built against a fake `visitors` message. **Kai, done.**
     Visitors are in `web/src/visitors.js` and `visitors.css`, with spots added
     in `office.js`. When idle they go to break spots, and the meeting spot is
     the communal table.
   - **D. Links panel UI:** making and entering codes, the link list, guest
     invite settings and the visiting-mode controls. **Mira, done.** The panel
     is `web/src/links.js`, and the leaderboard has a "Share my counters"
     toggle.
3. **E. Guest access on the server:** `req` ops, the filtered `feed`, policy
   enforcement and `/ws/visit`. **Tunde, after A.**
4. Default URL, deploying the relay to Cloudflare, docs, changelog and the
   release. **Zola.**

Later: a shared `#with-<handle>` channel per link, with untrusted-input
labelling and outbound approval. That is the old phase 2, and it isn't in this
round.

## Release checklist (Zola)

- [ ] `e2e.mjs` passes against production, including want-presence after
      the Mailbox goes cold. **Tunde, still to run.**
- [x] In a copied tree, two offices on separate ports and data folders are
      linked with a real code through the local relay
      (`/tmp/zola-links-test/two-offices.mjs`, 11 checks). hello.visitors works
      on a fresh page. In a headless browser, the visitors are drawn within
      160 ms of a reload, with no console errors. Unlinking clears both sides.
      Leaving with no links forgets the handle. The door sign overflow was
      checked only with Kai's fakes (a pair has just 3 agents).
- [x] Links panel: make, enter and unlink a code, and the guest form's limits
      reach the host (Mira, real two-office run through the UI). A handle
      without joining the board is checked in the two-offices script
      (`sharing: false`).
- [x] Guest access, checked by Mira through the browser with two copied offices:
      only the shared project, the clearance cap, a job that shipped, its diff
      and a reply, the `from @guest` label on the host, and unlinking ending
      the visit. Not triggered: the 4th-job 429 and the token cap (Tunde's
      unit checks cover them).
- [x] Guest-side boundary cleaning in `guests.js` (cleanStaff, cleanJob,
      cleanEntry, cleanFeed, cleanHello), with a hostile-host test in
      `scripts/guests.mjs`. The browser side is escaped too (Mira) and labels are
      built from nodes (Zola).
- [x] Clearance names agree: `auto` is Full autonomy, everywhere.
- [x] `npm test` passes on the final tree.
- [x] The user guide is in `docs/linked-offices.md`. The docs index,
      security.md, leaderboard.md (Leaving) and the CHANGELOG are updated.
- [x] Relay deployed by Kai at 07:58:10Z (version
      00a7a58a-2ecd-47ec-831b-7e46db9f0896, cron `17 * * * *`), with Obi's
      throttles, IP_KEY and claimsPerHour 100. test.mjs ran once against
      production: 73/73, with its handles cleaned up. The claim 500 window was
      about 34 s, because an office restart fell between db:remote and deploy.
      The sha256 of the deployed files is in `/tmp/zola-links-test/deployed.sha256`,
      and the working tree matched it at the time it was checked. Check it
      again before committing (`shasum -a 256 -c`).
- [x] The test scripts send the office key. Final run on the combined tree:
      `npm test` (64 checks), links unit, e2e and two real offices all pass.
- [ ] The boss approves, then it is committed and the version bumped.
