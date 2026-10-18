# Under a Dark Star — Accounts and the Leaderboard

> Design and implementation plan for the account system and the reign leaderboard: the small backend
> that replaces OpenFront's closed API. Drafted 2026-10-01. Rows marked **Decided** are Tom's
> decisions of that day; rows marked **Proposed** are recommendations waiting for his review (§15).
> Companion to `DarkStar-Roadmap.md` phase P5, which this document expands and supersedes, and to
> `DarkStar-Lobbies.md` (thrones, seats, reigns). Where it sits in the order of work is in
> `DarkStar-Launch.md`. B1 (2026-10-03, §12.1), B2 (2026-10-07, §12.2), B3 (2026-10-07, §12.3), B4 (2026-10-11, §12.4) and B5 (2026-10-12, §12.5; one list with victories since 2026-10-17, §12.6) are built; B6–B7 are not. Changelog at the end.

## 1. Goals

- **G1 — An authoritative record.** Who you are is established by the server (a sign-in it
  verified), and what you achieved is written by the server, never claimed by a browser.
- **G2 — A leaderboard of victories and reigns.** Three numbers per account: victories (rounds
  won), reigns (rounds played as Hegemon) and longest reign (the most consecutive of them on one
  throne).
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

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Status   |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| A1  | **Accounts are in the launch scope.** The server holds the account record and a leaderboard database.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Decided  |
| A2  | **Sign in with Discord or Google.** No passwords. An account can carry several sign-ins, so email can be added later without rework.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Decided  |
| A3  | **Guests play and may hold a throne;** a guest's results are not recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Decided  |
| A4  | **Every public throne round counts,** including the two-human minimum of L9. No higher bar for the leaderboard.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Decided  |
| A5  | **The board shows victories, reigns and longest reign, as one list sorted by any of them.** A victory is every round won, by overthrowing the Hegemon or by holding the throne to the timer, whether or not the winner then takes the throne. A reign is a round played as Hegemon, won or lost; a slayer who declines the throne has a victory and nothing more. Longest reign is the most consecutive rounds as Hegemon on one throne (A15). Thrones taken and rounds held are still stored, no longer shown. (Revised 2026-10-01 from three numbers; revised 2026-10-17 by Tom: one list instead of two tabs, victories in place of the taken/held split, reigns counting time on the throne rather than wins.) | Decided  |
| A6  | **Free launch.** Store and cosmetics come after it (P7).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Decided  |
| A7  | **One small service in this repository** (`src/api/`), Node and TypeScript like the game server, running in the same container on port 8787 and reached at `api.<DOMAIN>`: the address the game server and client already use.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Proposed |
| A8  | **SQLite.** The whole database is one file on a disk volume, copied off the server nightly.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Proposed |
| A9  | **Keep the token format the code already speaks:** a 15-minute signed token (EdDSA JWT) held in memory, renewed from a 30-day refresh cookie that rotates on each use (`docs/Auth.md`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Proposed |
| A10 | **Guests in production.** The game server accepts the anonymous browser ID in every environment; today it refuses it outside dev (`jwt.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Proposed |
| A11 | **Only verified sign-ins are credited.** The game record marks which players joined with a signed token; the API ignores everyone else.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Proposed |
| A12 | **Stored about a person:** the provider's user ID, a display name, timestamps. No email address, no avatar, no IP address in the database.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Proposed |
| A13 | **Account name:** taken from the provider at first sign-in, screened by the name filter, editable. Shown with a four-digit tag (`Tom.4471`) so two players with one name can be told apart. A signed-in player may play a round under any name they type.                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Decided  |
| A14 | **Results arrive through the existing archive call.** The game server already posts each finished game to the API; the record gains a throne block. Private and solo games are not recorded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Proposed |
| A15 | **Longest reign is consecutive rounds as Hegemon on one throne.** The run continues while the same holder wins and keeps the seat; it ends on a loss, on stepping down (a seat claimed again in the lobby is a new run), on a server restart (L12), and it never carries to another throne: a Hegemon who quits one throne for an open seat elsewhere starts at one. The throne card's badge keeps its own rule (Lobbies §3.1: the win that takes a throne is 1, each timer win adds 1), which for a slayer who stays equals the run so far. (Revised 2026-10-17; until then, consecutive wins counted from the taking win, shared with the badge.)                                                                | Decided  |
| A16 | **All-time boards only,** top 100 each, at launch. Weekly or seasonal boards later.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Proposed |
| A17 | **An account can delete itself.** Sign-ins and sessions are erased; its rounds stay as anonymous history and leave the board.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Proposed |
| A18 | **Moderation by command line.** A ban is a role on the account, carried in the token; the game server already refuses a banned token. Tom runs ban, unban and rename from a script on the server. No admin web page at launch.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Proposed |
| A19 | **Full game records are kept 30 days,** compressed on disk, then deleted. They are for bug reports and for replay-checking a disputed result (§5.5); the leaderboard does not need them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Proposed |
| A20 | **Listing a private lobby publicly is off at launch.** Upstream sold it with a subscription; thrones are our public offer. Decided 2026-10-07.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Decided  |
| A21 | **Guests do not choose a name.** The server gives a guest the name `Anon` plus five digits (`Anon48213`), derived from their browser ID so it stays the same between games. Choosing a name is a reason to sign in.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Decided  |

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
   (the winner is the Hegemon), `ai` (a nation won: the AI Hegemon held the round, or a nation
   landed the killing blow), `void` (no winner). `ai` and `void` are recorded as rounds and credit
   nobody; the registry reports the same four outcomes.
5. Write one `rounds` row, and one `round_players` row per verified player.
6. Update the winner's stats, if the winner is verified (§5.4). All of 5 and 6 happen in one
   transaction.

A verified flag counts only while the account behind it exists and is not deleted; anything else
is treated as a guest. The answer is 201 for a recorded round, 202 for a record kept without a
round (private, solo, or no throne block), 200 for a repeat, 400 for a record that does not parse
(the game server validated it before posting, so that is version skew, logged, never stored).

### 5.4 The numbers

`nextReign(outcome, reignBefore)` is one pure function in `src/core`, used by the throne registry
for the badge on screen and kept by the API on each round as `reign_after`: `overthrown` gives 1,
`timer` gives `reignBefore + 1`, `void` gives 0. The board's numbers are counted from the rounds
themselves (revised 2026-10-17; until then reigns were wins and the longest reign the badge):

| The round ended with…                 | For a verified winner                                                     | For a verified Hegemon who did not win     | For anyone else |
| ------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------ | --------------- |
| A challenger overthrowing the Hegemon | victories +1 (thrones taken +1)                                           | reigns +1; the run may raise longest reign | Nothing         |
| The Hegemon holding to the timer      | victories +1 (rounds held +1), reigns +1; the run may raise longest reign | —                                          | Nothing         |
| No winner (void), or the AI winning   | Nothing                                                                   | reigns +1; the run may raise longest reign | Nothing         |

**Victories** is the total of rounds won: thrones taken plus rounds held, whether or not the
winner then takes the throne. **Reigns** is the total of rounds played as Hegemon, won or lost.
**Longest reign** is the longest run of consecutive rounds as Hegemon on one throne. The run
(`hegemon_run` on the round, `hegemonRun` in `Results.ts`) continues from the throne's previous
round when the same account sat there, won it, and came back as its confirmed holder
(`reignBefore` above 0); a holder who steps down and claims the seat again in the lobby starts
afresh, as the badge does, and a seat on another throne is always a new run. A guest's or the AI's
time on a throne records nothing, and a slayer who declines the throne has a victory and nothing
more. A server restart opens every seat and resets reign counters (L12), which ends a run on
screen and on the board alike; persisting seats is B7.

### 5.5 Rebuilding and checking

The `stats` table is a cache of the `rounds` table: a script recomputes it from scratch, each
round's `hegemon_run` first from its throne's history in order, which is also how a ban or a
deleted account is taken off the board. Migration 3 (2026-10-17) ran that rebuild once, so the
rounds recorded before it count under the new rule. While a full record is on disk (30
days), the same deterministic simulation the clients ran can be replayed from it to confirm the
winner. That is not launch work; it is the answer if farming or disputes become real.

## 6. The leaderboard

- **`GET /leaderboard?sort=victories|reigns|longest`** returns the top 100 of one list: rank,
  public ID, name with tag, victories, reigns and longest reign, ranked on the number the sort
  names (victories by default). Public, no sign-in, cached for a minute per sort. A caller who
  sends their token also gets their own row (`me`), read live: ranked when they are on the list,
  `rank: null` with their zeros when nothing is recorded yet. An account is on the list once it
  has a victory or a reign; a rank is shared on a tie of the sorting number (1, 2, 2, 4), the
  other numbers and then the name settling display order. Banned and deleted accounts are left
  off (§10); a lifted ban puts the account back.
- **Client:** a **Leaderboard** page in the nav beside Play: one list with a sort control
  (Victories by default, Reigns, Longest reign), every row showing all three numbers with the
  sorting one emphasised, the signed-in player's own row highlighted in the list or pinned at the
  bottom when they are outside the top 100; a player with nothing recorded is told how to get on
  the list, a guest to sign in. The account panel shows the same numbers and links to the page.
  (Until 2026-10-17: two tabs, Reigns and Longest reign, with a taken/held column.)
- **Win screen:** the player a public throne round credits (the slayer, or the Hegemon holding to
  the timer) gets the reign prompt. A guest sees "Sign in to record your victories" with the
  provider buttons (the sign-in lands on the home page: the round is over). A signed-in winner
  sees the numbers that just changed: the record lands a few seconds after the winner vote, so
  the account is polled until its victories move, then shown with the gains marked (a Hegemon
  who held the timer sees the reign numbers move too; a slayer only the victory).
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
| `GET /cluster.json`                                           | client      | 200 with an empty list (a 404 until 2026-10-17). The client reads that as "reachable, one server" and uses the page's own values.                                        |
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

| Table           | Columns                                                                                                                                                                                                     | Notes                                                                                                                                                                                                                                                  |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `accounts`      | `id` (UUID), `public_id`, `name`, `tag`, `name_changed_at`, `role`, `ban_reason`, `ban_until`, `created_at`, `deleted_at`                                                                                   | `id` is the game's `persistentID`.                                                                                                                                                                                                                     |
| `identities`    | `provider`, `provider_user_id`, `account_id`, `created_at`                                                                                                                                                  | Key `(provider, provider_user_id)`. Email later is a new provider.                                                                                                                                                                                     |
| `sessions`      | `id`, `account_id`, `token_hash`, `created_at`, `expires_at`, `revoked_at`                                                                                                                                  | The refresh cookie's hash, never the cookie itself.                                                                                                                                                                                                    |
| `rounds`        | `game_id`, `throne_id`, `throne_name`, `throne_type`, `map`, `started_at`, `ended_at`, `humans`, `outcome`, `hegemon_account`, `winner_account`, `reign_after`, `git_commit`, `reign_before`, `hegemon_run` | One row per public throne round. Account columns are null for guests and the AI. `hegemon_run` is the seated Hegemon's consecutive rounds on this throne, this one included (§5.4); `reign_before` the badge they brought in, null before migration 3. |
| `round_players` | `game_id`, `account_id`, `was_hegemon`, `won`                                                                                                                                                               | Verified players only. Feeds "games played" and later profiles.                                                                                                                                                                                        |
| `stats`         | `account_id`, `thrones_taken`, `rounds_held`, `hegemon_rounds`, `longest_reign`, `games_played`, `updated_at`                                                                                               | A cache of `rounds`; rebuildable (§5.5). Victories is `thrones_taken + rounds_held`; reigns is `hegemon_rounds`.                                                                                                                                       |

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

| Setting                                      | Where            | Notes                                                                                                                                                                                                                                             |
| -------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOMAIN`                                     | both programs    | The site; the API is `api.<DOMAIN>`. Already exists.                                                                                                                                                                                              |
| `API_DOMAIN`                                 | both programs    | The API's hostname when it is not `api.<DOMAIN>`. At launch `darkstar-api.january-games.com` beside `DOMAIN=darkstar.january-games.com` (Launch §6.2: the free certificate covers one level). The page learns it as `BOOTSTRAP_CONFIG.apiOrigin`. |
| `API_KEY`                                    | both programs    | Shared secret for server-to-API calls. Already exists.                                                                                                                                                                                            |
| `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | API              | From a Discord developer application (Tom creates it).                                                                                                                                                                                            |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`   | API              | From a Google Cloud OAuth client (Tom creates it).                                                                                                                                                                                                |
| `TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY` | game server, API | From the Cloudflare dashboard. The site key already exists.                                                                                                                                                                                       |
| `DATA_DIR`                                   | API              | `/data` in the container; `.data/` (git-ignored) in dev.                                                                                                                                                                                          |
| Record retention, name-change wait           | API constants    | 30 days each.                                                                                                                                                                                                                                     |

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

### 12.1 As built: B1 (2026-10-03)

The skeleton, as code only: Tom asked (2026-10-03) that nothing needing a sign-up or a server
be done yet, so the container wiring of §9 (Dockerfile, supervisord, nginx) waits for the first
deployment (Launch 3b) and the providers for B2.

- **`src/api/`**: `Config.ts` (the environment: `GAME_ENV`, `DOMAIN`, `API_KEY`, `API_PORT`
  default 8787, `DATA_DIR` default `.data` in dev and `/data` otherwise; `issuerFor` mirrors
  `ServerEnv.jwtIssuer`; `allowedOrigin` is the site, or any localhost port in dev), `Db.ts`
  (Node's built-in `node:sqlite`, confirmed working on Node 24; WAL; the §8 tables in two numbered
  migrations applied once at boot in a `schema_migrations` table), `Keys.ts` (an Ed25519 pair
  generated once into `signing-key.json`, mode 600, reloaded with the same `kid`; the JWKS
  document in the exact shape `ServerEnv.jwkPublicKey` validates; `signToken` for B2), `App.ts`
  (express factory: `/health`, `/.well-known/jwks.json` cacheable, `/cluster.json` 404, JSON
  404s, CORS with credentials for the page's origin only, `no-store` by default) and `Server.ts`
  (the entry point).
- **`npm run dev`** now starts the API beside the client and the game server
  (`start:api-dev`), with the dev `API_KEY` the game server already uses. Its data lands in
  `.data/` (git-ignored). The client's backend check passes against it, which removes the "backend
  unreachable" refusal of Host and Join that local testing could hit.
- **Tests**: `tests/api/ApiSkeleton.test.ts` (12): config and origins, migrations idempotent and
  the foreign key enforced, the key persisted and a token it signs verifying exactly as `jwt.ts`
  does, and every route of the skeleton over a real socket.
- **Not yet**: the game server never fetches the key in dev (dev tokens are browser IDs), so the
  "Done when" of B1 is met by the test that verifies a signed token with the served JWKS, and by
  the client's health check.

### 12.2 As built: B2 (2026-10-07)

Sign-in, sessions and the account's own view, as code, verified in the browser the same day
(the dev provider: sign in, reload and stay signed in, host a lobby as `Tom.4413`, a guest
joins it as `Anon04113`, sign out). The Discord keys are in Tom's `.env`; the Discord round
trip itself is exercised against a stubbed Discord in the tests and for real at H5.

- **`src/api/`**: `Config.ts` gains `siteOrigin` (where a sign-in sends the browser back;
  `SITE_ORIGIN`, default the Vite page in dev and `https://<DOMAIN>` otherwise) and
  `discord` (both `DISCORD_CLIENT_*` keys or neither; one alone fails the boot). `Sessions.ts`:
  the refresh cookie `ds_refresh` (HttpOnly, SameSite=Lax, `Path=/auth`, 30 days, Secure
  outside dev), SHA-256 of the secret in `sessions.token_hash`, rotation on every refresh,
  revoke one or all. `Accounts.ts`: find-or-create by `(provider, provider_user_id)`; the
  account name is the provider's display name reduced to the account alphabet (spaces to
  underscores), clamped to 20, through the name filter, else `Player`; a random four-digit
  tag; a random public ID; the ban → `role: "banned"` rule; and `/users/@me` in the shape
  the client and the game server parse today (the upstream fields carry their empty
  values until the schema is cut down with their last users; `adfree: true`,
  `trustTier: "trusted"`). `Providers.ts`: `dev` (GAME_ENV=dev only; `?name=` is the
  sign-in; the same name is the same account) and `discord` (authorization code, scope
  `identify`, exchange server to server; `global_name` else `username` as the display
  name). `AuthRoutes.ts`: `GET /auth/login/:provider` (a `redirect` on our origin is
  honoured, anything else goes to the page; a state cookie `ds_oauth` carries the one-time
  value and the return URL), `GET /auth/callback/:provider` (state checked, failures send
  the browser back to the page with `#signin=failed`), `POST /auth/refresh` (rotates,
  issues a 15-minute token with `provider` and `role`; a 401 clears the cookie),
  `/auth/logout`, `/auth/revoke`, `GET /users/@me` (Bearer, verified as `jwt.ts` does).
  `App.ts` mounts them; its deps take an injectable `fetch` and clock for the tests.
- **Game server**: `jwt.ts` accepts the anonymous browser ID in every environment as a
  guest (A10). `Worker.ts` replaces a guest's name with `guestName(persistentId)` after the
  screening and before the rejoin (A21). `src/core/GuestName.ts`: `Anon` + five digits,
  FNV-1a over the ID, shared with the client.
- **Client**: `components/AccountButton.ts` (`<account-button>`, in the identity row
  beside the name): signed out, a Sign in button with Discord and, in dev, the developer
  sign-in (a name prompt); signed in, `Name.1234` and a panel with the provider, a note
  that the numbers come with the leaderboard, Sign out and Sign out everywhere (both
  through `Auth.logOut`, then `invalidateUserMe`). It notices `#signin=failed` once.
  `UsernameInput.ts`: signed out (`userMe === false`) the box, the tag picker and the
  errors give way to the guest chip (the assigned name and a hint); `resolvedName()`
  returns the guest name and `canPlay()` is true; signed in, the box starts with the
  account name when the stored one was generated, a guest name or empty, and the upstream
  verified-name toggle shows only to an eligible account (none here). `HelpModal.ts`:
  the Discord invite and `hello@` at the foot of Troubleshooting (`CommunityLinks.ts`).
  New strings under `account.*` and `help_modal.community_*`.
- **Tests**: `tests/api/Auth.test.ts` (dev provider end to end; rotation and the refused
  old cookie; logout; revoke; expiry on an injected clock; same login same account;
  redirect safety; `/users/@me` 401s; bans in token and profile; the Discord round trip
  against a stubbed Discord, state mismatch, denial, a refused code; providers offered
  per environment; Secure cookies in prod; half a provider refused), `tests/GuestName.test.ts`,
  `tests/server/GuestToken.test.ts`. `tests/UsernameInput.test.ts` and
  `UsernameInputValidation.test.ts` seed a signed-in profile where they test the box;
  the "held bare name" cases and `UsernameVerifiedRoute.test.ts` were removed (names
  need not be unique here, A13, and the route led to a modal removed in P1).
- **Not yet**: rename and delete (B6, with the panel's buttons for them), rate limits
  (B6), the Google provider (after the privacy policy), the schema cut-down, and the
  production redirect URI in the Discord application (needs the hostname, Launch §6.2).

### 12.3 As built: B3 (2026-10-07)

The production join path, audited the same day: a container built on Tom's PC with
`GAME_ENV=prod` and no OpenFront API anywhere ran a lobby with a signed-in account
(`Auditor.0001`, a session planted in the container's database, since the production API has no
dev provider) and a guest (`Anon82577`, the same name in the identity row and the lobby); the
host started the game, both spawned, and the simulation ran past tick 150 with 427 players on
the map. The container's logs showed no call to a missing endpoint. Cloudflare's always-pass
Turnstile test keys were used so headless Chromium could pass the bot check; the real keys are
in Tom's `.env` and are exercised at H5.

- **`src/api/JoinRoutes.ts`**: `POST /join_verify` (shared key required): the Turnstile
  `siteverify` call with the secret, the token and the joiner's IP, then the name filter
  (`Censor.ts`) on the typed name and tag, answering in the shape `JoinVerify.verifyJoin`
  parses (`approved` with the display-ready pair, or `rejected` with Cloudflare's reason). A
  null token skips Cloudflare (an admitted reconnect) and still screens the name. Cloudflare
  itself failing answers 5xx, so the game server fails open to its local filter as before.
  Without a secret (dev only) every token passes with one warning. The stubs of §7:
  `GET /cosmetics.json` (empty catalogue the schema accepts), `GET /reserved_clan_tags` (`[]`),
  `GET /custom_tribes` (`{tribes: []}`), `POST /archive_singleplayer_game` (202, discarded),
  `POST /game/:id` (shared key; 202, logged, discarded until B4), `GET /game/:id` (404).
- **`Config.ts`**: `TURNSTILE_SECRET_KEY` (required outside dev). A `localhost` DOMAIN keeps the
  localhost CORS rule in every environment, which is what lets a production container be
  audited on one PC. `API_DOMAIN` may carry a port for localhost (`localhost:8790`, plain http),
  for the same reason: the dev stack holds 8787.
- **Game server**: ranked matchmaking's `/matchmaking/checkin` poll is off unless
  `RANKED_MATCHMAKING=on` (`ServerEnv.rankedMatchmaking`); it was the one call to a missing
  endpoint the first audit run showed, every five seconds from every worker. A20 needs no server
  change: the worker already refuses to list a lobby when `/users/@me` grants no
  `canCreatePublicLobbies`, which ours never does; the client's Private/Public switch is hidden
  (`HostLobbyModal.ts`, `PUBLIC_LISTING_OFFERED`).
- **Two production-only bugs found by the audit**, neither visible under `npm run dev`:
  the game worker is inlined (a `blob:` URL), so with no `CDN_BASE` its relative asset fetches
  could not be resolved and no game could start; `workerAssetBase` (`AssetUrls.ts`) now hands
  it the page's origin when there is no CDN. And `Auth.clearLocalSession` dropped the guest's
  browser ID on every page load (the refresh answers 401 for a guest), so a guest got a new
  `Anon` name on every visit; the ID is now dropped only on an actual sign-out.
- **Container**: `supervisord.conf` runs the API as a third program (`npm run start:api`, user
  `node`, port 8787 or `API_PORT`); the `Dockerfile` creates the `/data` volume for the database
  and signing key and drops upstream's 25-hour staging timeout from the start script;
  `generate-nginx-api.sh` writes a `server` block for `API_DOMAIN` to `127.0.0.1:8787` at start
  (none for a localhost `API_DOMAIN`, which is reached on its published port directly).
- **Tests**: `tests/api/JoinVerify.test.ts` (the Cloudflare call and verdicts against a stubbed
  `siteverify`, the null-token path, fail-open on a Cloudflare 5xx, the shared key, the dev
  no-secret path, every stub route against its schema), `tests/AssetUrls.test.ts`
  (`workerAssetBase`), `tests/server/ServerEnv.test.ts` (`API_DOMAIN`, localhost with a port,
  `RANKED_MATCHMAKING`), `tests/core/configuration/ConfigLoader.test.ts` (`apiOrigin` on the
  client, `getApiBase` on localhost).
- **Not yet**: the results ingest behind `POST /game/:id` (B4); rate limits (B6); the game
  server reaching the API by its public name from inside the container (an internal origin
  setting would save the round trip through Cloudflare; decide at H2).

### 12.4 As built: B4 (2026-10-11)

The results ingest, as code on `feat/team-thrones`, with the account panel's numbers pulled
forward from B5 so the Sign in menu's promise ("have your reigns recorded") holds at the friends
test. Tom confirmed the same day: only public throne rounds count; on a team throne the reign
goes to the player who landed the killing blow and teammates get nothing; seats and reigns
surviving a restart stay B7.

- **`src/core/Reign.ts`**: `nextReign(outcome, reignBefore)` (§5.4), the one rule for the
  number on screen and on the board; `ThroneRegistry.roundEnded` now calls it with the
  holder's reign (0 for anyone but the sitting holder). Outcomes are the registry's four.
- **Record (§5.2)**: `RecordThroneSchema` (`throneID`, `name`, `type`, `reignBefore`) as
  `info.throne`, and `verified` on each player record, both optional and written only when
  set, so the records of other games and the wire transcript are unchanged.
  `GameServer.archiveGame` writes `verified: true` for a client whose token carried claims,
  and `recordThrone()` sets `reignBefore` to the assignment's reign when the heir is the
  seated Hegemon and 0 otherwise (a claimant, or the AI), the same distinction the registry
  makes when it extends a reign.
- **API**: `Records.ts` (`RecordStore`: one gzip file per game under `<DATA_DIR>/records`,
  written PII-scrubbed, pruned past 30 days at boot and hourly by `Server.ts`; the game ID
  is validated before it touches a path). `Results.ts` (`ingestRecord`: the steps of §5.3 in
  one transaction, idempotent on the game ID, credit only to verified players whose account
  exists; `statsFor`; `rebuildStats`, the §5.5 recompute, which also drops a deleted
  account). `ResultRoutes.ts` (`POST /game/:id` with its own 64 MB body limit, since a
  record carries every turn; `GET /game/:id` serving the kept record, cacheable for five
  minutes, 404 after pruning). `npm run api:rebuild-stats` runs the recompute against the
  configured `DATA_DIR`.
- **Account panel**: `/users/@me` gains `player.reigns` (`reigns`, `longestReign`,
  `thronesTaken`, `roundsHeld`, `gamesPlayed`; optional in `UserMeResponseSchema`), and
  `AccountButton` shows reigns and longest reign with the split beneath, falling back to the
  "numbers soon" line against an API without the field.
- **Tests**: `tests/api/Ingest.test.ts` (refusals; a challenger overthrowing a signed-in
  Hegemon; timer wins extending a reign and a loss leaving the longest reign standing; the
  "done when" sequence of three rounds with a guest winner and a void round; an AI win; a
  verified flag with no account behind it; the repeat post; private, solo and throne-less
  records kept but not recorded; a 3 MB record; the scrubbed read-back; 404s for unknown, bad
  and pruned IDs; the rebuild with a deleted account), `tests/core/NextReign.test.ts`,
  `tests/server/ArchivePlayerRecord.test.ts` (the `verified` flag; `reignBefore` for the
  heir, a claimant and the AI; no block on a non-throne game). The harness's `makeClient`
  takes `claims`.
- **Not yet**: the leaderboard endpoint and page and the win-screen prompt (B5); a retry
  when the API is down at round end (§14); a `rounds` row for a round whose record never
  arrived.

### 12.5 As built: B5 (2026-10-12)

The leaderboard, as code on `feat/leaderboard`. With it, Stage 4's "done when" (a reign won on
the live server appears on the live board) is reachable once the branch is deployed.

- **API**: `Leaderboard.ts` (`leaderboard(db, board, now)`: the top 100 of a board from the
  `stats` cache joined to `accounts`, one window-function query per board so the rank read for
  one account agrees with the rank in the list; `ownRow`: the caller's row, ranked or not).
  `LeaderboardRoutes.ts` (`GET /leaderboard?board=`, 400 on an unknown board, `reigns` by
  default; the top list held in memory for a minute, the own row live; `Cache-Control: public,
max-age=60` for an anonymous answer, `private` with a token; `Vary: Authorization`).
  `Bearer.ts` (`BearerVerifier`, the token check `/users/@me` used, now shared).
- **Schema**: `LeaderboardBoardSchema`, `LeaderboardEntrySchema`, `LeaderboardResponseSchema`
  in `ApiSchemas.ts`.
- **Client**: `LeaderboardApi.ts` (`fetchLeaderboard`, the token along when there is one, a
  10-second timeout, null on any failure). `LeaderboardModal.ts` (`<leaderboard-modal
id="page-leaderboard" inline>` in `index.html`, router name `leaderboard`; tabs per board;
  read on every open and once per tab visit; an answer arriving after the page closed is
  dropped; spinner, empty board, unreachable API with a retry). A **Leaderboard** item after
  Play in both nav bars (a text item until Tom draws it a pixel-art button like Play's), and a
  Leaderboard entry in the Sign in menu and the account panel. `SignIn.ts` (`startSignInWith`,
  `signInProviders`, the provider icons) is the sign-in start the account button and the win
  screen now share. `hud/layers/ReignPrompt.ts` (`<reign-prompt>`): the win screen renders it
  with `active` set for the credited winner on a throne round (`wonRound` and a current throne);
  it asks `isLoggedIn`, then either offers the providers or polls `fetchUserMeUncached` every
  3 s, up to 12 times, until `reigns` exceeds the cached profile's, and shows the last numbers
  read without a mark if they never move. Whatever fails inside it leaves the win screen as it
  was.
- **Strings**: `main.leaderboard`, `account.view_leaderboard`, `leaderboard.*` (the page; the
  object already held the in-game stats panel's column names) and `win_modal.reign_*`.
- **Tests**: `tests/api/Leaderboard.test.ts` (the empty board; an unknown board; the two orders
  with shared ranks; the own row ranked, unranked and anonymous; banned, expired-ban and deleted
  accounts; the top-100 cut with the caller ranked beyond it; the minute's cache against the
  live own row and the headers). `tests/client/LeaderboardModal.test.ts` (rows and the split,
  the tabs and the once-per-visit read, the highlighted and the pinned own row, the two hints,
  the empty board, the retry, a stale answer). `tests/client/graphics/layers/ReignPrompt.test.ts`
  (nothing when inactive; the guest's providers and the home redirect; the numbers moving on the
  second poll with both marks; the reign mark alone; the poll limit; no cached profile; removal
  stops the polling). `WinModalReign.test.ts` (who gets the prompt: the slayer and the timer
  Hegemon; not the overthrown, a bystander, a slayer's teammate, or anyone off a throne round).
  `tests/client/NavBars.leaderboard.test.ts` (the item after Play in both bars, its translation
  hooks, the highlight).
- **Not yet**: Google among the providers (after the privacy policy, B2's note); a weekly
  board, profiles behind a row (B7); the pixel-art nav button.

### 12.6 Revised: one list, victories, reigns as rounds on the throne (2026-10-17)

Tom's call before the friends test: two tabs were one too many, and the taken/held column was
confusing. Built on `feat/piracy`.

- **Rule** (A5, A15, §5.4): victories replace the old reigns number (same count, every round
  won); reigns now count rounds played as Hegemon, won or lost; longest reign the most consecutive
  of them on one throne. A slayer who declines the throne has a victory and nothing more; a run
  never crosses thrones; stepping down and claiming the seat again starts a new run.
- **API**: migration 3 (`Db.ts`) adds `rounds.reign_before`, `rounds.hegemon_run` and
  `stats.hegemon_rounds`, then rebuilds the cache in the same transaction (`Migration.after`,
  `rebuildStatsWithin`), so the live numbers follow the new rule on the first boot. `Results.ts`:
  `hegemonRun` (the one rule, shared by the ingest and the rebuild, which recomputes every
  round's run from its throne's history in order), `victories()` in place of `reigns()`,
  `AccountStats.reigns`. `Leaderboard.ts` and `LeaderboardRoutes.ts`: `?sort=`, three orders
  over one eligibility (a victory or a reign), 400 on an unknown sort. `/users/@me` sends
  `player.record` (`victories`, `reigns`, `longestReign`, `gamesPlayed`) in place of
  `player.reigns` and the split.
- **Client**: `LeaderboardModal.ts` is one list with a `styledSelect` sort control (kept across
  openings in a session), three number columns, the sorting one emphasised; `AccountButton` shows
  the three numbers and the rounds played; `ReignPrompt` polls until victories move and marks
  whichever of the three grew. Strings: `leaderboard.about_*`, `col_victories`, `sort_by`,
  `account.victories`, `account.rounds_played`, the `win_modal.reign_*` wordings, and the help
  page's throne rule names the three numbers.
- **Tests**: `Leaderboard.test.ts` (the three sorts and their ties; a Hegemon who sat and lost
  is listed with no victory; a run across rounds on one throne, never across thrones, and the
  claim after stepping down), `Ingest.test.ts` (the new numbers per row of §5.4, `hegemonRun`
  on its own, the rebuild recomputing runs), `LeaderboardModal.test.ts` (the sort control),
  `ReignPrompt.test.ts` (three figures).

## 13. Tests

API tests run against an in-memory database, under `tests/api/`, added to `npm test`.

- `Auth.test.ts`: the dev provider end to end; refresh rotates the cookie; a reused old cookie is
  refused; logout and revoke; an expired session.
- `Jwks.test.ts`: a token the API issues passes `verifyClientToken`; a guest ID passes in
  production as a guest; a forged token fails.
- `Ingest.test.ts` (built, §12.4, §12.6): every row of §5.4; unverified winners; idempotent
  repeat; private and solo records kept but not recorded; a wrong API key; the read-back and the
  pruning; the rebuild, runs included; `hegemonRun` on its own.
- `NextReign.test.ts` (core, built): the four outcomes.
- `Leaderboard.test.ts` (built, §12.5, §12.6): the three sorts, ordering and ties; a Hegemon
  listed on reigns alone; runs within and across thrones; banned and deleted accounts absent;
  the caller's own row; the top-100 cut; the cache.
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
| A signed-in Hegemon wins on the timer, then steps down   | The victory and the round seated count (victories +1, reigns +1, the run +1); the run ends there. |
| A slayer declines the throne                             | A victory; no reign, no run.                                                                      |
| A Hegemon quits one throne for an open seat on another   | A new run of one on the new throne; longest reign never spans thrones (A15).                      |
| A banned player's old rounds                             | Kept as history; the account leaves the board.                                                    |
| Server restart mid-reign                                 | Seats open, counters reset (L12). The longest reign already recorded stands.                      |
| The provider's display name fails the name filter        | The account gets a neutral generated name and may rename at once.                                 |
| Two guests in one lobby are given the same `Anon` number | The later joiner's number is moved to the next free one for that game.                            |

## 15. Open questions for Tom

- **Q1 — The proposed rows of §2.** A7 to A12, A14 and A16 to A19 are still recommendations (A20
  was decided 2026-10-07). The one most worth a look is A17 (deletion).
- ~~**Q2 — Playing under another name.**~~ Answered 2026-10-01: a signed-in player may type any
  name; a guest may not and is given an `Anon` name (A13, A21).
- **Q3 — Minimum age.** The terms need one; 13 is the usual floor for Discord and Google accounts.
- **Q4 — A contact address** for privacy requests and ban appeals.
- **Q5 — Record retention.** 30 days of full game records (A19), or none at all?

## 16. Changelog

- **2026-10-17** — **One list, victories, reigns as rounds on the throne** (§12.6). Tom's call:
  the two tabs become one list with a sort control (Victories by default); the taken/held
  column becomes Victories (every round won, throne taken or not); Reigns now count rounds played
  as Hegemon and Longest reign the most consecutive of them on one throne, a declined throne
  counting for nothing but the victory. A5 and A15 revised, §5.4 recounted, migration 3 rebuilds
  the recorded numbers.
- **2026-10-12** — **B5 built** (§12.5): `GET /leaderboard` with the caller's own row, the
  Leaderboard page beside Play with its two tabs, the win screen's reign prompt (sign-in for a
  guest winner, the numbers moving for a signed-in one), and the sign-in start shared between
  the account button and the win screen. §6 records the tie rule and who is left off.
- **2026-10-11** — **B4 built** (§12.4): the throne block and `verified` on the record,
  `nextReign` in core shared with the registry, the ingest into `rounds`, `round_players` and
  `stats`, kept records with 30-day pruning, the rebuild script, and the account panel's numbers
  (from B5). Tom confirmed: only public throne rounds count; team-throne reigns go to the
  killing blow alone; persisting seats across restarts stays B7. §5.3 names the `ai` outcome
  and the response codes.
- **2026-10-07** — **B3 built and audited** (§12.3): `join_verify` with Turnstile and the name
  filter, the stub endpoints, A20 in the client, the API as a third program in the container
  with a `/data` volume. The production-mode container played a game with an account and a
  guest on Tom's PC with no call to a missing endpoint. Two production-only bugs fixed on the
  way (the inlined worker's asset base; a guest's browser ID dropped on every load). Ranked
  matchmaking's poll is now off by default. Stage 3a is done.
- **2026-10-07** — `API_DOMAIN` added (§11): the API hostname no longer has to be `api.<DOMAIN>`;
  at launch it is `darkstar-api.january-games.com`. Wherever this document says `api.<DOMAIN>`,
  read "the API's hostname".
- **2026-10-07** — Tom decided A20: private lobbies cannot be listed publicly at launch (built in B3).
  Turnstile keys issued and placed in `.env` the same day.
- **2026-10-07** — **B2 built as code** (§12.2): the dev and Discord providers, sessions
  with a rotating refresh cookie, refresh/logout/revoke, `/users/@me`, guests accepted in
  every environment with the assigned `Anon#####` name, the Sign in button and account
  panel, the guest chip in the identity row, and the help page's Discord and email links.
  Verified in the browser with the dev provider; Discord against a stub until H5.
- **2026-10-03** — **B1 built as code** (§12.1): `src/api/` skeleton on SQLite with the signing
  key and the JWKS, started by `npm run dev`. Container wiring and the sign-in providers are
  deferred with the first deployment at Tom's request.
- **2026-10-01** — Created. Tom's decisions A1–A6 (accounts at launch, Discord and Google, guests
  unrecorded, every public round counts, three numbers, store later); A7–A20 proposed: a small
  service in the repo on SQLite, the existing token format, guests accepted in production, results
  through the existing archive call with a throne block, steps B1–B7.
- **2026-10-01** — Tom's review of the open points. A13 decided (four-digit tag; a signed-in player
  may play under any name). A21 added: guests are given `Anon` plus five digits and cannot choose.
  A5 revised: the board shows reigns (every win is one reign) and longest reign, with thrones
  taken and rounds held kept as the split. A15 decided: longest reign is consecutive wins. Hosting
  confirmed (see `DarkStar-Launch.md`).
