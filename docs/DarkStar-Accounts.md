# Under a Dark Star — Accounts and the Leaderboard

> Design and implementation plan for the account system and the reign leaderboard: the small backend
> that replaces OpenFront's closed API. Drafted 2026-10-01. Rows marked **Decided** are Tom's
> decisions of that day; rows marked **Proposed** are recommendations waiting for his review (§15).
> Companion to `DarkStar-Roadmap.md` phase P5, which this document expands and supersedes, and to
> `DarkStar-Lobbies.md` (thrones, seats, reigns). Where it sits in the order of work is in
> `DarkStar-Launch.md`. Nothing here is built yet. Changelog at the end.

## 1. Goals

- **G1 — An authoritative record.** Who you are is established by the server (a sign-in it
  verified), and what you achieved is written by the server, never claimed by a browser.
- **G2 — A leaderboard of reigns.** Two headline numbers per account: reigns (rounds won) and
  longest reign (most wins in a row).
- **G3 — Guests are never turned away.** Anyone may play a public round and sit on a throne without
  an account (Lobbies L3). An account only adds a record.
- **G4 — The smallest thing that works.** No passwords, no email addresses, one extra process, one
  database file. A solo developer must be able to run, back up and restore it.
- **G5 — Cut the cord.** A deployed server runs in production mode with no call to OpenFront's API.
- **G6 — Room to grow.** Email login, the store's entitlements, profiles and seats that survive a
  restart can all be added without redoing identity.

Non-goals for launch: profiles, friends, clans, ranked play or ratings, cosmetics and the store
(P7), replays, email login, linking two sign-ins to one account, more than one server.

## 2. Decisions

Numbered so the code and tests can cite them. Build steps are B1–B7 (§12).

| #   | Decision                                                                                                                                                                                                                                                                                                                       | Status   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| A1  | **Accounts are in the launch scope.** The server holds the account record and a leaderboard database.                                                                                                                                                                                                                          | Decided  |
| A2  | **Sign in with Discord or Google.** No passwords. An account can carry several sign-ins, so email can be added later without rework.                                                                                                                                                                                           | Decided  |
| A3  | **Guests play and may hold a throne;** a guest's results are not recorded.                                                                                                                                                                                                                                                     | Decided  |
| A4  | **Every public throne round counts,** including the two-human minimum of L9. No higher bar for the leaderboard.                                                                                                                                                                                                                | Decided  |
| A5  | **The board shows reigns and longest reign.** Every round won is one reign, whether by overthrowing the Hegemon or by holding the throne to the timer. Longest reign is the most wins in a row. The split of reigns into thrones taken and rounds held is stored and shown as detail. (Revised 2026-10-01 from three numbers.) | Decided  |
| A6  | **Free launch.** Store and cosmetics come after it (P7).                                                                                                                                                                                                                                                                       | Decided  |
| A7  | **One small service in this repository** (`src/api/`), Node and TypeScript like the game server, running in the same container on port 8787 and reached at `api.<DOMAIN>`: the address the game server and client already use.                                                                                                 | Proposed |
| A8  | **SQLite.** The whole database is one file on a disk volume, copied off the server nightly.                                                                                                                                                                                                                                    | Proposed |
| A9  | **Keep the token format the code already speaks:** a 15-minute signed token (EdDSA JWT) held in memory, renewed from a 30-day refresh cookie that rotates on each use (`docs/Auth.md`).                                                                                                                                        | Proposed |
| A10 | **Guests in production.** The game server accepts the anonymous browser ID in every environment; today it refuses it outside dev (`jwt.ts`).                                                                                                                                                                                   | Proposed |
| A11 | **Only verified sign-ins are credited.** The game record marks which players joined with a signed token; the API ignores everyone else.                                                                                                                                                                                        | Proposed |
| A12 | **Stored about a person:** the provider's user ID, a display name, timestamps. No email address, no avatar, no IP address in the database.                                                                                                                                                                                     | Proposed |
| A13 | **Account name:** taken from the provider at first sign-in, screened by the name filter, editable. Shown with a four-digit tag (`Tom.4471`) so two players with one name can be told apart. A signed-in player may play a round under any name they type.                                                                      | Decided  |
| A14 | **Results arrive through the existing archive call.** The game server already posts each finished game to the API; the record gains a throne block. Private and solo games are not recorded.                                                                                                                                   | Proposed |
| A15 | **Longest reign is consecutive wins:** the highest value the on-screen reign counter reached (Lobbies §3.1: the win that takes a throne is 1, each timer win after it adds 1). One rule, shared by the throne registry and the API.                                                                                            | Decided  |
| A16 | **All-time boards only,** top 100 each, at launch. Weekly or seasonal boards later.                                                                                                                                                                                                                                            | Proposed |
| A17 | **An account can delete itself.** Sign-ins and sessions are erased; its rounds stay as anonymous history and leave the board.                                                                                                                                                                                                  | Proposed |
| A18 | **Moderation by command line.** A ban is a role on the account, carried in the token; the game server already refuses a banned token. Tom runs ban, unban and rename from a script on the server. No admin web page at launch.                                                                                                 | Proposed |
| A19 | **Full game records are kept 30 days,** compressed on disk, then deleted. They are for bug reports and for replay-checking a disputed result (§5.5); the leaderboard does not need them.                                                                                                                                       | Proposed |
| A20 | **Listing a private lobby publicly is off at launch.** Upstream sold it with a subscription; thrones are our public offer.                                                                                                                                                                                                     | Proposed |
| A21 | **Guests do not choose a name.** The server gives a guest the name `Anon` plus five digits (`Anon48213`), derived from their browser ID so it stays the same between games. Choosing a name is a reason to sign in.                                                                                                            | Decided  |

## 3. How the pieces fit

Three programs run in one container on one server:

```
 browser ──HTTPS──► Cloudflare ──► nginx ─┬─► game server  (master :3000, workers :3001+)
                                          │      │  asks: is this token real? is this name allowed?
                                          │      │  tells: here is the finished round
                                          │      ▼
                                          └─► API (:8787) ──► SQLite file on /data
                                                 ▲
 browser ── sign in, refresh token, leaderboard ─┘   (same nginx, hostname api.<DOMAIN>)
```

- The **game server** is unchanged in role: it relays moves and runs lobbies. It trusts the API for
  identity and reports results to it.
- The **API** is new. It signs people in, issues tokens, screens joins, stores accounts and rounds,
  and serves the leaderboard.
- The **browser** talks to both. It already knows the API's address: `api.<DOMAIN>` in production,
  `http://localhost:8787` in dev (`ApiBase.ts`, `ServerEnv.jwtIssuer`).

Because the API lives in this repository and runs as part of the program we host, its source is
published with everything else (AGPL). Secrets stay out of the repository, in the server's
environment file.

## 4. Identity

### 4.1 Accounts and sign-ins

An **account** is a row with a random ID (a UUID). That ID is the `persistentID` the game server
already keys everything on, so thrones, reservations and records need no new concept. It is never
shown to other players. A short **public ID** is what appears in URLs and on the board.

A **sign-in** (identity) links one provider login to one account: `(discord, 1234567)` or
`(google, abc…)`. One account may have several. At launch each new provider login creates its own
account; linking a second login to an existing account, and email as a third provider, are B7.

### 4.2 Signing in

1. The player clicks **Sign in** and picks Discord or Google. The browser goes to
   `api.<DOMAIN>/auth/login/<provider>`.
2. The API sends them to the provider with a one-time state value; the provider sends them back to
   `api.<DOMAIN>/auth/callback/<provider>` with a code.
3. The API exchanges the code for the provider's user ID (Discord scope `identify`; Google scope
   `openid` plus `profile` for a starting name). It finds the account for that sign-in or creates
   one.
4. The API sets the **refresh cookie** (HttpOnly, Secure, SameSite=Lax, path `/auth`, 30 days) and
   sends the browser back to the game.
5. The game calls `POST /auth/refresh` (`Auth.ts` does this today) and receives a 15-minute token.
   The cookie is replaced on every refresh; a stolen old cookie stops working.

The page (`<DOMAIN>`) and the API (`api.<DOMAIN>`) are the same site as far as browsers are
concerned, so the cookie is sent without third-party-cookie trouble. This is also why an embedded
copy of the game on another site (an itch.io frame) cannot keep a session.

In dev there is a third provider, `dev`, which signs in as any name with no external service. It
exists only when `GAME_ENV=dev`, so tests and local play can exercise accounts.

### 4.3 Tokens

The token is what upstream's was: an EdDSA-signed JWT whose subject is the account ID, with issuer
`api.<DOMAIN>`, audience `<DOMAIN>`, an optional `role` and the `provider`
(`TokenPayloadSchema`). The game server fetches the public key from
`/.well-known/jwks.json` and checks the token once, when the socket connects (`jwt.ts`). None of
that code changes.

The signing key is generated on first boot and kept on the data volume beside the database, so it
is backed up with it.

### 4.4 Guests

A guest has no token. The browser sends its anonymous ID from localStorage, as it does in dev
today. The one change (A10) is that `verifyClientToken` accepts it in production too, as a guest
(`claims: null`). A guest gets the bot check like anyone else and can hold a throne (L3); nothing
about them is written to the database.

A guest cannot choose a name (A21). At join the game server replaces whatever name the browser
sent with `Anon` plus five digits worked out from the guest's browser ID, so the same guest is the
same `Anon48213` from game to game and the name cannot be forged by editing the page. This applies
to every multiplayer game, private lobbies included. The client shows a guest their assigned name
where the name box would be, with a prompt to sign in to choose one.

Signing in changes a player's ID from the anonymous one to the account's. A guest who signs in
while holding a throne reservation loses it. The win screen therefore says "sign in to record your
next reign", not this one (§14).

### 4.5 Names

The account name (A13) starts as the provider's display name, passes through the name filter
(`Censor.ts`), and can be changed in the account panel (a 30-day wait between changes, as
upstream). Names need not be unique; the four-digit tag tells namesakes apart, and the client's
existing helpers already understand the `Name.1234` form (`isVerifiedUsername`,
`UsernameInput`).

In a game, a signed-in player's name box is pre-filled with the account name, and they may type
any other name for the round (A13); it passes the name filter as today. The leaderboard always
shows the account name. Guests have no name box (§4.4).

## 5. Recording results

### 5.1 What the server knows

The game server does not run the simulation. It learns a round's winner from the majority vote of
the players' browsers, one vote per IP address (`GameServer.handleWinner`), and then posts a
record of the game to the API (`Archive.ts`, `POST /game/:id`, authenticated with the shared
`API_KEY`). The record already names every player, who was the Hegemon (`isHegemon`) and who won.
Accepted limit (roadmap P5): a two-person round can be farmed. The hardening, if ever needed, is
§5.5.

### 5.2 Additions to the record

- **`throne`** on the record's info: `{ throneID, name, type, reignBefore }`, set by the worker
  from the `createGame.throne` data the master already sends it (Lobbies §5.3). `reignBefore` is
  the seated Hegemon's reign going into the round (0 for a claimant or the AI).
- **`verified`** on each player record: true when the player joined with a signed token (A11).
  The server knows this at join (`claims !== null`).

Both are optional fields, so old records and private games still parse.

### 5.3 What the API does with a record

1. Reject anything without the API key. Ignore a game it has already stored (the game ID is the
   key), so a retry is harmless.
2. Store the compressed record on disk for 30 days (A19).
3. If the game is not a public throne round, stop. Private lobbies and solo games are not
   recorded.
4. Work out the outcome: `overthrown` (the winner is a player who was not the Hegemon), `timer`
   (the winner is the Hegemon), `void` (no winner).
5. Write one `rounds` row, and one `round_players` row per verified player.
6. Update the winner's stats, if the winner is verified (§5.4). All of 5 and 6 happen in one
   transaction.

### 5.4 The numbers

`nextReign(outcome, reignBefore)` is one pure function in `src/core`, used by the throne registry
for the number on screen and by the API for the number on the board, so they cannot disagree:
`overthrown` gives 1, `timer` gives `reignBefore + 1`, `void` gives 0.

| The round ended with…                 | Recorded for a verified winner                              | For anyone else |
| ------------------------------------- | ----------------------------------------------------------- | --------------- |
| A challenger overthrowing the Hegemon | reigns +1 (thrones taken +1); the streak is now 1           | Nothing         |
| The Hegemon holding to the timer      | reigns +1 (rounds held +1); the streak is `reignBefore + 1` | Nothing         |
| No winner (void), or the AI winning   | Nothing                                                     | Nothing         |

**Reigns** is the total of rounds won: thrones taken plus rounds held. **Longest reign** is the
longest run of consecutive wins, which is the largest streak value an account has ever reached. The
run is on one throne: it ends when the holder loses, steps down, or misses a round. A guest's or the AI's
time on a throne records nothing, and a verified player who overthrows a guest starts at 1 like
any slayer. A server restart opens every seat and resets reign counters (L12), which ends a streak
on screen and on the board alike; persisting seats is B7.

### 5.5 Rebuilding and checking

The `stats` table is a cache of the `rounds` table: a script recomputes it from scratch, which is
also how a ban or a deleted account is taken off the board. While a full record is on disk (30
days), the same deterministic simulation the clients ran can be replayed from it to confirm the
winner. That is not launch work; it is the answer if farming or disputes become real.

## 6. The leaderboard

- **`GET /leaderboard?board=reigns|longest`** returns the top 100: rank, public ID, name with
  tag, reigns, longest reign, and the split of reigns into thrones taken and rounds held. Public,
  no sign-in, cached for a minute.
- **Client:** a **Leaderboard** page in the nav beside Play, two tabs (Reigns, Longest reign), the
  signed-in player's own row pinned at the bottom when they are outside the top 100. The account
  panel shows the same numbers.
- **Win screen:** a guest who wins sees "Sign in to record your reigns" with the two provider
  buttons. A signed-in winner sees the numbers that just changed.
- **Thrones:** the holder's name on a throne card stays the name they are playing under; nothing on
  the card depends on an account.

All strings go through `translateText` with keys in `resources/lang/en.json` (`account.*`,
`leaderboard.*`).

## 7. API surface

What the game server and client call at `api.<DOMAIN>`, and what answers at launch.

| Endpoint                                                      | Called by   | At launch                                                                                                                                                                |
| ------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /.well-known/jwks.json`                                  | game server | The public signing key.                                                                                                                                                  |
| `GET /auth/login/:provider`, `/callback/…`                    | browser     | New. Discord, Google, and `dev` in dev only.                                                                                                                             |
| `POST /auth/refresh`, `/logout`, `/revoke`                    | client      | Rotate the cookie and issue a token; end this session; end every session.                                                                                                |
| `GET /users/@me`                                              | both        | Account name, public ID, ban, the numbers. `UserMeResponseSchema` is cut to these.                                                                                       |
| `PUT /users/@me/username`, `DELETE /users/@me`                | client      | Rename (A13); delete the account (A17).                                                                                                                                  |
| `POST /join_verify`                                           | game server | Cloudflare Turnstile check plus the name filter, as the server expects today.                                                                                            |
| `POST /game/:id`                                              | game server | Result ingest (§5.3).                                                                                                                                                    |
| `GET /game/:id`                                               | both        | The stored record while it is kept; 404 after.                                                                                                                           |
| `GET /leaderboard`                                            | client      | New (§6).                                                                                                                                                                |
| `GET /cluster.json`                                           | client      | 404. The client reads that as "reachable, one server" and uses the page's own values.                                                                                    |
| `GET /cosmetics.json`, `/custom_tribes`                       | both        | Empty catalogue, empty list (the server already fails open on both).                                                                                                     |
| `POST /archive_singleplayer_game`                             | client      | Accepted and discarded.                                                                                                                                                  |
| `/cluster/checkin`, `/matchmaking/checkin`, lobby coordinator | game server | Not called: a server with no `SUBDOMAIN` never registers (`ClusterCheckin.checkinBody`), ranked is not offered, and the coordinator is off by default. B3 confirms each. |
| `GET /health`                                                 | monitoring  | New.                                                                                                                                                                     |

The client's 30-second poll of `/cluster.json` doubles as its "is the backend up" check; two
failures in a row block Host and Join (`ServerList.backendUnreachableConfirmed`). Once the API
runs in dev (B1) that check passes, which also removes the block that local testing can hit today.

## 8. Database

SQLite, opened by the API only. Node 24 ships a SQLite module (`node:sqlite`), which adds no
native dependency; `npm ci --ignore-scripts` would not build one. B1 confirms it is stable enough,
with `better-sqlite3` as the fallback.

| Table           | Columns                                                                                                                                                                      | Notes                                                                             |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `accounts`      | `id` (UUID), `public_id`, `name`, `tag`, `name_changed_at`, `role`, `ban_reason`, `ban_until`, `created_at`, `deleted_at`                                                    | `id` is the game's `persistentID`.                                                |
| `identities`    | `provider`, `provider_user_id`, `account_id`, `created_at`                                                                                                                   | Key `(provider, provider_user_id)`. Email later is a new provider.                |
| `sessions`      | `id`, `account_id`, `token_hash`, `created_at`, `expires_at`, `revoked_at`                                                                                                   | The refresh cookie's hash, never the cookie itself.                               |
| `rounds`        | `game_id`, `throne_id`, `throne_name`, `throne_type`, `map`, `started_at`, `ended_at`, `humans`, `outcome`, `hegemon_account`, `winner_account`, `reign_after`, `git_commit` | One row per public throne round. Account columns are null for guests and the AI.  |
| `round_players` | `game_id`, `account_id`, `was_hegemon`, `won`                                                                                                                                | Verified players only. Feeds "games played" and later profiles.                   |
| `stats`         | `account_id`, `thrones_taken`, `rounds_held`, `longest_reign`, `games_played`, `updated_at`                                                                                  | A cache of `rounds`; rebuildable (§5.5). Reigns is `thrones_taken + rounds_held`. |

Schema changes are numbered migration files applied at boot.

## 9. Changes outside the API

**Game server (`src/server`)**

- `jwt.ts`: accept the anonymous ID in production as a guest (A10).
- `Worker.ts`: the join path reads the slimmer `/users/@me` (no flares, friends, clans or trust
  tier; those take their defaults). A guest's name is replaced with the assigned `Anon` name
  (A21). Listing a private lobby is refused (A20).
- `GameServer.archiveGame` and `Schemas.ts`: the `throne` block and the per-player `verified` flag
  (§5.2).
- `Dockerfile`, `supervisord.conf`, `nginx.conf`: a third program for the API, a `server` block
  for `api.<DOMAIN>`, a `/data` volume. The `openfront.dev` test left in the Dockerfile's start
  script goes.
- `package.json`: `npm run dev` starts the API beside the client and server.

**Client (`src/client`)**

- A **Sign in** button and an account panel (name, the numbers, sign out, sign out everywhere,
  delete account). For a guest, `UsernameInput` shows the assigned name and a sign-in prompt
  instead of a text box. The upstream account pages were removed in P1; `Auth.ts` kept the
  refresh, logout and play-token paths these build on.
- The Leaderboard page (§6) and the win-screen prompt.
- `ApiSchemas.ts`: `UserMeResponseSchema` cut down; a `LeaderboardResponseSchema` added; the dead
  upstream schemas (store, clans, ranked, tribes) removed with their last users.

**Core (`src/core`)**: `nextReign` with tests. Nothing else; the simulation is untouched.

## 10. Moderation, privacy and operations

- **Bans.** `role: "banned"` on the account goes into the next token (within 15 minutes);
  `Worker.ts` already closes a banned connection. A ban removes the account from the board. Guests
  cannot be banned by account; the bot check, the name filter and per-IP rate limits are what
  restrain them, plus an IP block list in the game server if it comes to that.
- **Admin.** `npx tsx src/api/admin.ts ban|unban|rename|rebuild-stats|delete <public id>`, run on
  the server. The game's existing admin-bot key stays for ending a game.
- **Rate limits** on the sign-in and refresh endpoints and on renames.
- **Privacy.** What is held is in A12. The privacy policy (roadmap P8) says so, names Discord and
  Google as sign-in providers and Cloudflare as the network in front, and gives the deletion route
  (the account panel, and an email address for people who cannot sign in). Server logs keep IP
  addresses for a short, stated period.
- **Backups.** A nightly consistent copy of the database and signing key, sent off the server (an
  R2 bucket or similar), with a restore tried once before launch. Losing the file loses every
  account and the board; this is the one part of the system that is not rebuildable.
- **Google's rule.** A Google sign-in cannot leave test mode until the app has a public privacy
  policy on a verified domain. So the legal pages come before Google sign-in goes live; Discord
  has no such gate.

## 11. Configuration

| Setting                                      | Where            | Notes                                                       |
| -------------------------------------------- | ---------------- | ----------------------------------------------------------- |
| `DOMAIN`                                     | both programs    | The site; the API is `api.<DOMAIN>`. Already exists.        |
| `API_KEY`                                    | both programs    | Shared secret for server-to-API calls. Already exists.      |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | API              | From a Discord developer application (Tom creates it).      |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`   | API              | From a Google Cloud OAuth client (Tom creates it).          |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | game server, API | From the Cloudflare dashboard. The site key already exists. |
| `DATA_DIR`                                   | API              | `/data` in the container; `.data/` (git-ignored) in dev.    |
| Record retention, name-change wait           | API constants    | 30 days each.                                               |

## 12. Implementation order

| Step | Scope                                                                                                                                                                                                           | Size | Needs  |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------ |
| B1   | **Skeleton.** `src/api/` server on 8787, config, SQLite with migrations, signing key and `jwks.json`, `/health`, CORS, `/cluster.json` 404; runs under `npm run dev` and in the container.                      | M    | —      |
| B2   | **Sign-in.** The `dev`, Discord and Google providers; sessions, refresh, logout, revoke; `/users/@me` and the slim schema; guests accepted in production (A10); the Sign in button and account panel.           | L    | B1     |
| B3   | **Production join path.** `join_verify` (Turnstile and the name filter); the stub endpoints of §7; private-lobby listing off; an audit that a container with `GAME_ENV=prod` and no OpenFront API runs a round. | M    | B2     |
| B4   | **Results.** The record additions, ingest, `rounds`, `round_players`, `stats`, `nextReign`, record retention, the rebuild script.                                                                               | M    | B3, T2 |
| B5   | **Leaderboard.** The endpoint, the page, the account panel's numbers, the win-screen prompt.                                                                                                                    | M    | B4     |
| B6   | **Moderation and operations.** Bans and the admin script, rate limits, rename and delete, backups and a restore drill.                                                                                          | M    | B2     |
| B7   | **After launch.** Email sign-in; linking sign-ins; seats and reigns that survive a restart (Lobbies Q4); replay-checking results; profiles; weekly boards.                                                      | —    | —      |

**Done when**, per step: B1, the game server in dev fetches its key from the local API and the
client's backend check passes. B2, a player signs in locally, reloads and is still signed in,
joins a lobby with a token, and a guest joins the same lobby. B3, a locally built container in
production mode plays a public round start to finish with a guest and an account, and its logs
show no call to a missing endpoint. B4, three throne rounds produce the right numbers,
including a guest winner and a void round. B5, the board shows them. B6, a banned account cannot
join, and a database restored from last night's backup serves the same board.

## 13. Tests

API tests run against an in-memory database, under `tests/api/`, added to `npm test`.

- `Auth.test.ts`: the dev provider end to end; refresh rotates the cookie; a reused old cookie is
  refused; logout and revoke; an expired session.
- `Jwks.test.ts`: a token the API issues passes `verifyClientToken`; a guest ID passes in
  production as a guest; a forged token fails.
- `Ingest.test.ts`: every row of §5.4; unverified winners; idempotent repeat; private and solo
  records ignored; a wrong API key.
- `NextReign.test.ts` (core): the three outcomes.
- `Leaderboard.test.ts`: ordering and ties; banned and deleted accounts absent; the caller's own
  row.
- `Account.test.ts`: rename rules and the wait; deletion erases sign-ins and sessions and
  anonymises rounds.
- Server: `tests/server/GameServerJoin` gains the guest-in-production, assigned-guest-name
  (stable per browser ID, typed name ignored) and slim-`@me` cases;
  `ArchivePlayerRecord` gains `verified` and `throne`.

## 14. Edge cases

| Case                                                     | Behaviour                                                                                         |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| The API is down when a round ends                        | The archive call fails and is logged; the round is not recorded. A retry queue is B6 if it bites. |
| The API is down when someone joins                       | Tokens already issued keep working for 15 minutes; `join_verify` fails open to the local filter.  |
| The API is down at sign-in or refresh                    | The player continues as a guest; nothing is recorded until they have a token again.               |
| A guest signs in while holding a reservation             | Their ID changes; the reservation lapses (§4.4).                                                  |
| The same person signs in with Discord, later with Google | Two accounts until linking exists (B7).                                                           |
| One account in two browsers in the same round            | The game server already keys clients on `persistentID`; the second connection replaces the first. |
| A signed-in Hegemon wins on the timer, then steps down   | The win counts (reigns +1, streak +1); the streak ends there.                                     |
| A banned player's old rounds                             | Kept as history; the account leaves the board.                                                    |
| Server restart mid-reign                                 | Seats open, counters reset (L12). The longest reign already recorded stands.                      |
| The provider's display name fails the name filter        | The account gets a neutral generated name and may rename at once.                                 |
| Two guests in one lobby are given the same `Anon` number | The later joiner's number is moved to the next free one for that game.                            |

## 15. Open questions for Tom

- **Q1 — The proposed rows of §2.** A7 to A12, A14 and A16 to A20 are still recommendations. The
  ones most worth a look are A17 (deletion) and A20 (no public listing of private lobbies).
- ~~**Q2 — Playing under another name.**~~ Answered 2026-10-01: a signed-in player may type any
  name; a guest may not and is given an `Anon` name (A13, A21).
- **Q3 — Minimum age.** The terms need one; 13 is the usual floor for Discord and Google accounts.
- **Q4 — A contact address** for privacy requests and ban appeals.
- **Q5 — Record retention.** 30 days of full game records (A19), or none at all?

## 16. Changelog

- **2026-10-01** — Created. Tom's decisions A1–A6 (accounts at launch, Discord and Google, guests
  unrecorded, every public round counts, three numbers, store later); A7–A20 proposed: a small
  service in the repo on SQLite, the existing token format, guests accepted in production, results
  through the existing archive call with a throne block, steps B1–B7.
- **2026-10-01** — Tom's review of the open points. A13 decided (four-digit tag; a signed-in player
  may play under any name). A21 added: guests are given `Anon` plus five digits and cannot choose.
  A5 revised: the board shows reigns (every win is one reign) and longest reign, with thrones
  taken and rounds held kept as the split. A15 decided: longest reign is consecutive wins. Hosting
  confirmed (see `DarkStar-Launch.md`).
