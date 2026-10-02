# Under a Dark Star — The launch sequence

> One ordered list from today to the minimum public release. Drafted 2026-10-01. It adds no new
> design: each step points at the document that holds the detail (`DarkStar-Roadmap.md` phases
> P0–P8, `DarkStar-Lobbies.md` steps T1–T6, `DarkStar-Accounts.md` steps B1–B7). Tick steps off
> here as they are done and record changes in the changelog at the end.

## 1. The minimum public release

**In scope**

- **Public thrones**: FFA and special thrones (T1–T4), with the winner's seat, map pick and the
  Thrones tab.
- **Accounts and the leaderboard** (B1–B6): Discord and Google sign-in, guests welcome under
  assigned names, reigns and longest reign on the board.
- **The map pool**: at least six new maps of Tom's on top of the kept ones, each map checked in
  the simulator (P3).
- **Sound**: a legal soundtrack and the new cues (P4, Tom's plan).
- **The brand**: logo, wordmark and font on the home screen (P1 step E).
- **One server** on a rented machine behind Cloudflare, on our own domain, deployed by one command
  and backed up nightly.
- **The paperwork**: Terms, Privacy Policy, credits, the Source link the licence requires, and a
  help page that teaches the Hegemon rules.
- English only. Free to play.

**Out of scope until after launch**

Team thrones (T5), throne scaling (T6), the store and cosmetics (P7), email sign-in and account
linking (B7), profiles, replays, translations, an embedded itch.io build (a listing that links to
the site is fine), a second server or region.

## 2. The gate

Decided 2026-10-01: the friends playtest planned for 2026-10-04 is postponed. Tom takes the game
to the release candidate first, tests it with friends on the live server (Stage 7), and decides
there whether to open it to the public and keep working on the project.

What this trades away: the first feedback from human opponents, and the first human check of the
balance numbers, now arrive at the end. The sequence keeps one early exit open at no extra cost:
from the end of Stage 3 the game is on a real address, so an informal test can be called at any
point after that.

## 3. Two tracks

- **Track A — engineering**, in sessions with Claude: the stages below.
- **Track B — Tom's own work**, in parallel: maps, sound, the logo, and the sign-ups only he can
  do (§5). Track B has no dependency on Track A after Stage 1, and lands in Stage 5.

## 4. The sequence

Sizes as in the roadmap: S is a session, M a few, L a week or more of sessions.

### Stage 0 — Decisions (Tom, no code)

- [ ] Review `DarkStar-Accounts.md` §15 and the rows still marked Proposed. (Names, guest names
      and the board's numbers were settled 2026-10-01.)
- [x] Confirm the hosting shape: one rented server (VPS) running our Docker container, Cloudflare's
      free plan in front through a named tunnel. Confirmed 2026-10-01, "for now"; the provider is
      chosen at H1.
- [ ] Choose the domain name (needed by 3b).
- [x] Set the launch map count: at least six new maps (2026-10-01). Which of the 13 inherited
      maps stay is still open.
- [ ] Commit the uncommitted work (the 09-30 balance pass, the documents of 10-01).

### Stage 1 — Unblock the content track (S)

- [ ] **Map authoring kit** (P3): a friendly-palette PNG in, the generator's encoding and
      `info.json` out, plus a one-page guide. From here Tom draws maps while engineering continues.

_Done when_ Tom has turned one drawing into a playable map without help.

### Stage 2 — Public thrones on the dev server (T1 → T2 → T3; M each)

- [ ] **T1** The throne registry and back-to-back named lobbies with the AI seated.
- [ ] **T2** The seat: the winner's window, map pick, keep or step down, claim and leave.
- [ ] **T3** The client: throne cards, the Thrones tab with Watch, lobby seat buttons, the
      win-screen panel, the name and reign on the Dark Star panel.
- [ ] A list of throne names (`resources/thrones.json`, at least 60; Claude drafts, Tom edits).

_Done when_ three public rounds in a row on one throne pass the seat correctly between two
browsers under `npm run dev`, including a winner who walks away. If Host or Join is refused with
"backend unreachable" during this testing, do B1 first: it removes the cause.

### Stage 3 — Accounts core and the first deployment

**3a. Accounts core (B1 → B2 → B3; M, L, M)**

- [ ] **B1** The API skeleton, running under `npm run dev` and in the container.
- [ ] **B2** Sign-in (the dev provider and Discord first), sessions, the account panel; guests
      accepted in production.
- [ ] **B3** The production join path: bot check, name filter, stub endpoints, and the audit.

_Done when_ a container built on Tom's PC in production mode plays a public round with a guest and
a signed-in account, with no call to OpenFront's API.

**3b. First deployment (M)**

- [ ] **H1** Accounts and purchases: the domain, on Cloudflare; the server (about 4 cores).
- [ ] **H2** The server set up: Docker, a compose file with two containers (the game, and
      `cloudflared` for the tunnel), a `/data` volume, the two hostnames (`<domain>` and
      `api.<domain>`) routed through the tunnel.
- [ ] **H3** The environment file with the production settings and secrets (Accounts §11), kept
      off the repository.
- [ ] **H4** A deploy script of our own (pull, build, restart), replacing upstream's `deploy.sh`,
      `update.sh`, `build.sh`, `build-deploy.sh`, `setup.sh` and GitHub workflows, which target
      OpenFront's infrastructure.
- [ ] **H5** Smoke test: a public round over the internet from two different networks; sign in
      with Discord on the real domain.

_Done when_ Tom deploys a new commit with one command and a round completes on the public address.
The site is live but unannounced from here on. This is the earliest point an informal test with
friends is possible.

### Stage 4 — The leaderboard and special thrones

- [ ] **B4** Results: the record additions, ingest, reigns and longest reign (M).
- [ ] **B5** The leaderboard page, the account panel's numbers, the win-screen prompt (M).
- [ ] **T4** Special thrones: the modifier whitelist and picker (S).

_Done when_ a reign won on the live server appears on the live board.

### Stage 5 — Content lands (Track B merges)

- [ ] **Maps**: at least six new ones; unwanted inherited maps removed; each one run once in
      `HegemonSim` (nation count, nations reach the moat) and played once by Tom.
- [ ] **Sound** (P4): the menu theme and gameplay music replacing the silent placeholders, the new
      cues wired, the four orphan files resolved, every sound credited.
- [ ] **Brand** (P1 step E): logo, wordmark, font, favicon and the home-screen title.

_Done when_ nothing a player sees or hears is a placeholder.

### Stage 6 — Release preparation (M)

- [ ] **B6** Bans and the admin script, rate limits, rename and delete, nightly backups, and one
      restore actually tried.
- [ ] **Legal pages**: Terms of Service and Privacy Policy, linked from the footer, with a contact
      address. Then publish the Google sign-in (it needs the privacy policy on the live domain)
      and add the Google provider to production.
- [ ] **Help and tutorial** rewritten for the Hegemon rules; the solo screen explains the throne.
- [ ] **Licence items**: the Source link points at the deployed commit; `CREDITS.md` complete; the
      attribution line present.
- [ ] **Production keys**: real Turnstile keys; secrets rotated from anything used in testing.
- [ ] **Throne count for the opening.** With few players online, 15 thrones spread them too thin
      to reach two humans in one lobby. Open with 3 to 5 (it is one config value) and raise it
      with the population.
- [ ] **Watching it**: an uptime check on `/api/health` and the API's `/health`; a look at the
      server's logs and load with a dozen clients connected.
- [ ] **Somewhere to report bugs** (a Discord server or an email address; Tom's choice).
- [ ] Walk the launch checklist in roadmap P8.

_Done when_ the checklist is clean. This build is the release candidate.

### Stage 7 — The friends test (the gate)

- [ ] Tom and friends play an evening on the live server: several thrones, guests and accounts,
      a winner who keeps the seat, one who leaves, a restart in the middle.
- [ ] Collect what broke, what confused, and whether it was fun. Fix what must be fixed; adjust
      balance (the numbers from M4 are expected to move).

### Stage 8 — Go or no-go

- [ ] **Tom decides.** Go: announce, add the itch.io listing, watch the first week closely, then
      take up the post-launch list (T5, T6, B7, P7). No-go: the site can stay up at a few dollars
      a month or be switched off; the database backup and the repository preserve everything.

## 5. Things only Tom can do

| What                                              | Needed by | Notes                                                             |
| ------------------------------------------------- | --------- | ----------------------------------------------------------------- |
| The decisions of Stage 0                          | Stage 0   |                                                                   |
| Maps                                              | Stage 5   | Starts after Stage 1's kit.                                       |
| Sound and music                                   | Stage 5   | Tom's plan; each file needs a licence that permits this use.      |
| Logo, wordmark, font                              | Stage 5   | The text wordmark and Overpass stay until then.                   |
| A Discord developer application                   | B2        | Free. Gives the client ID and secret for Discord sign-in.         |
| A domain name                                     | 3b        | About $10–15 a year.                                              |
| A Cloudflare account, with the domain on it       | 3b        | Free plan. Also issues the Turnstile keys.                        |
| A server (VPS) account                            | 3b        | About $10–30 a month from this point.                             |
| A Google Cloud OAuth client                       | Stage 6   | Free. Cannot go public before the privacy policy is live.         |
| A contact address and a place for bug reports     | Stage 6   |                                                                   |
| Reading and approving the Terms and Privacy pages | Stage 6   | Claude can draft them; they are Tom's undertakings, not Claude's. |
| The go or no-go                                   | Stage 8   |                                                                   |

## 6. Open questions

1. ~~Hosting shape.~~ Confirmed 2026-10-01: one VPS behind Cloudflare. Which provider is still
   open (decide at H1).
2. The domain name.
3. ~~The launch map count~~ (at least six new maps, 2026-10-01); which of the 13 inherited maps
   stay is still open.
4. How many thrones to open with (suggest 3 to 5).
5. Whether "January Games" is a legal entity yet. It matters for the Terms now and for taking
   payments later; not legal advice.
6. An itch.io listing at launch, or after the first week?

## 7. Changelog

- **2026-10-01** — Created. Scope of the minimum public release fixed from Tom's decisions of the
  day; the friends playtest moved from 2026-10-04 to Stage 7 as the go/no-go gate; stages 0–8
  ordered; hosting recorded as proposed, not confirmed.
- **2026-10-01** — Tom confirmed the hosting shape (a rented server behind Cloudflare, for now) and
  set the map target at a minimum of six new maps. Scope wording follows the accounts decisions of
  the same day (guest names assigned; the board shows reigns and longest reign).
