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
- [x] Choose the domain name (needed by 3b). **Done 2026-10-06:** `january-games.com`, a studio
      domain, registered at Cloudflare (at cost, already the DNS host); .io ruled out (price,
      repeated wholesale rises, Chagos sovereignty risk, and it would echo openfront.io).
      Studio email is Cloudflare Email Routing: `hello@january-games.com` forwards to Tom's
      personal Gmail. The game's hostname under it is still to pick (see §6.2).
- [x] Set the launch map count: at least six new maps (2026-10-01). Which of the 13 inherited
      maps stay is still open.
- [x] Commit the uncommitted work (the 09-30 balance pass, the documents of 10-01). Done; the
      tree was clean at 2026-10-06 (`LobbyWork`).

### Stage 1 — Unblock the content track (S)

- [x] **Map authoring kit** (P3): a friendly-palette PNG in, the generator's encoding and
      `info.json` out, plus a one-page guide. From here Tom draws maps while engineering continues.
      Built 2026-10-01: `npm run map`, guide in `docs/MapMaking.md`.

_Done when_ Tom has turned one drawing into a playable map without help. **Passed 2026-10-04** (Tom).

### Stage 2 — Public thrones on the dev server (T1 → T2 → T3; M each)

- [x] **T1** The throne registry and back-to-back named lobbies with the AI seated. Built
      2026-10-03 (Lobbies doc §10.1).
- [x] **T2** The seat: the winner's window, map pick, keep or step down, claim and leave. Built
      2026-10-03, server side with tests (Lobbies doc §10.2); the browser cannot exercise it until
      T3 adds the panel and the buttons.
- [x] **T3** The client: throne cards, the Thrones tab with Watch, lobby seat buttons, the
      win-screen panel, the name and reign on the Dark Star panel. Built 2026-10-03 (Lobbies doc
      §10.3); Tom's browser pass is the stage's _Done when_.
- [x] A list of throne names (`resources/thrones.json`, 80 real star names; Tom may edit or add
      invented ones later).

_Done when_ three public rounds in a row on one throne pass the seat correctly between two
browsers under `npm run dev`, including a winner who walks away. **Passed 2026-10-04:** Tom
accepted public thrones after his browser pass. (B1 now removes the "backend unreachable" refusal
that this testing could hit.)

### Stage 3 — Accounts core and the first deployment

**3a. Accounts core (B1 → B2 → B3; M, L, M)**

- [x] **B1** The API skeleton, running under `npm run dev` (built 2026-10-03, Accounts doc §12.1).
      The container part waits for 3b.
- [x] **B2** Sign-in (the dev provider and Discord first), sessions, the account panel; guests
      accepted in production. Built 2026-10-07 (Accounts doc §12.2); the Discord round trip runs
      for real at H5, once the production redirect URI exists.
- [x] **B3** The production join path: bot check, name filter, stub endpoints, and the audit.
      Built and audited 2026-10-07 (Accounts doc §12.3): the production-mode container on Tom's
      PC played a game with an account and a guest, no call to a missing endpoint.

_Done when_ a container built on Tom's PC in production mode plays a public round with a guest and
a signed-in account, with no call to OpenFront's API. **Passed 2026-10-07** with a hosted lobby
(the public thrones need two humans and a countdown, which the same two browsers can also do; the
join path is identical).

**3b. First deployment (M)**

- [x] **H1** Accounts and purchases: ~~the domain, on Cloudflare~~ (done 2026-10-06,
      `january-games.com`, Cloudflare account on an address outside the domain with Email Routing);
      the server: done 2026-10-07, a DigitalOcean Droplet named `darkstar`, Basic Premium AMD,
      2 vCPU / 4 GB / 80 GB, New York (NYC1), $28 a month, image "Docker on Ubuntu 22.04",
      `<server>`, root over SSH with the key `~/.ssh/<key>`. Two cores
      rather than four: the simulation runs in the browsers, the server only relays; resize
      later if a launch day needs it. The DigitalOcean account is on a studio-controlled Google
      account, not `hello@` (a departure from the 10-06 rule; move or accept at leisure).
- [x] **H2** The server set up: Docker, a compose file with two containers (the game, and
      `cloudflared` for the tunnel), a `/data` volume, the two hostnames
      (`darkstar.january-games.com` and `darkstar-api.january-games.com`) routed through the
      tunnel. Also at H2: the production redirect
      `https://darkstar-api.january-games.com/auth/callback/discord` added to the Discord
      application. **In progress 2026-10-07.** Done on the server: 2 GB swap (the image build
      peaks above 4 GB), the Docker API ports closed in ufw (SSH alone stays open; players
      arrive through the tunnel), `/opt/darkstar`, a read-only deploy key for GitHub. In the
      repository: `deploy/docker-compose.yml` (the game image built from the checkout, the
      `darkstar-data` volume, nothing published on the host; `cloudflared` with its token).
      **Done 2026-10-07:** Tom created the tunnel `darkstar` with both public hostnames
      pointing at `http://game:80`, added the deploy key (read-only) and the Discord redirect;
      the repository is cloned at `/opt/darkstar/repo`; the first deploy ran and both
      containers are up, the tunnel connected.
- [x] **H3** The environment file with the production settings and secrets (Accounts §11), kept
      off the repository. Written 2026-10-07. `deploy/push-env.sh` writes it to `/opt/darkstar/.env` from the
      developer's local `.env` and a freshly generated `API_KEY`, printing nothing;
      `deploy/env.example` lists every key. Known so far: `GAME_ENV=prod`, `DOMAIN=darkstar.january-games.com`,
      `API_DOMAIN=darkstar-api.january-games.com`, `NUM_WORKERS` (about the core count),
      `INSTANCE_LETTER=a`, `API_KEY` (a long random secret shared by the two programs),
      `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` (Tom's, from `.env`), `DISCORD_CLIENT_ID`
      and `DISCORD_CLIENT_SECRET`, `DATA_DIR=/data`. `CDN_BASE` stays unset (assets come from the
      game server); `RANKED_MATCHMAKING` stays unset (off).
- [x] **H4** A deploy script of our own (pull, build, restart), replacing upstream's `deploy.sh`,
      `update.sh`, `build.sh`, `build-deploy.sh`, `setup.sh` and GitHub workflows, which target
      OpenFront's infrastructure. Built 2026-10-07: `deploy/deploy.sh` runs on the server
      (`ssh root@<server> /opt/darkstar/repo/deploy/deploy.sh`): fetch the deploy branch, build
      the image, restart the game container (the tunnel never drops), wait for the health check,
      prune old images. Upstream's five scripts and their tests are removed; the workflows under
      `.github/workflows/` that target OpenFront's infrastructure (deploy, release, PR and issue
      bots, the Claude review) are for Tom to delete, keeping `ci.yml`.
- [x] **H5** Smoke test: a public round over the internet from two different networks; sign in
      with Discord on the real domain. **Passed 2026-10-07:** two real browsers on the live
      domain with a Discord sign-in (the studio account), then a phone on mobile data joined the
      PC's round (the second network). **Automated half passed 2026-10-07:** over the internet,
      the page serves at `https://darkstar.january-games.com` (production build, commit
      `72e9fe4`, the right API origin in its bootstrap), the API answers health and JWKS at
      `https://darkstar-api.january-games.com`, the Discord login route sends the browser to
      Discord with the production redirect, the master opened its ten throne lobbies, and the
      home page shows them with the guest name and the Sign in button. Cloudflare's bot check
      showed its "Verify you are human" box to the headless browser and refused it, as it
      should, so the join itself could not be automated. **Tom's half:** two real browsers on
      two networks (a PC and a phone on mobile data will do): sign in with Discord on one, join
      the same throne or a hosted lobby from both, play into the round, check the account
      panel and the guest's `Anon` name.

_Done when_ Tom deploys a new commit with one command and a round completes on the public address.
**Stage 3 passed 2026-10-07.** The per-deploy check from here is the two-minute one (page, both
health endpoints, one round starts); the two-network and sign-in checks are repeated only when a
change touches the server, the join path, accounts or the lobbies.
The command, from any machine with the key:

```
ssh -i ~/.ssh/<key> root@<server> /opt/darkstar/repo/deploy/deploy.sh
```

It deploys whatever `DEPLOY_BRANCH` in the server's env file names: `main` since 2026-10-07,
when the feature branch was merged (fast-forward) and the server switched over. The server's firewall rate-limits SSH to six
connections per thirty seconds; a "connection timed out" means wait half a minute.
The site is live but unannounced from here on. This is the earliest point an informal test with
friends is possible.

### Stage 4 — The leaderboard and special thrones

- [ ] **B4** Results: the record additions, ingest, reigns and longest reign (M).
- [ ] **B5** The leaderboard page, the account panel's numbers, the win-screen prompt (M).
- [x] **T4** Special thrones: the modifier whitelist and picker (S). Built 2026-10-03 (Lobbies doc
      §10.4), ahead of Stage 3 at Tom's request.

_Done when_ a reign won on the live server appears on the live board.

### Stage 5 — Content lands (Track B merges)

- [x] **Maps**: at least six new ones, each run once in `HegemonSim` (Lord count, Lords
      reach the moat) and played once by Tom. Accepted by Tom 2026-10-04 with the map kit (Stage
      1). Still open: which inherited maps to remove (Stage 0 / §6.3); one config edit when he
      decides.
- [ ] **Sound** (P4): the menu theme and gameplay music replacing the silent placeholders, the new
      cues wired, the four orphan files resolved, every sound credited.
- [ ] **Brand** (P1 step E): ~~font~~ (Tektur, 2026-10-07), logo, wordmark, favicon and the
      home-screen title. Decided 2026-10-07: the January Games wreath wordmark stays as the
      studio mark; the game's working mark is the black disc with a purple border (the
      Hegemon). The title treatment around the font is still to design.

_Done when_ nothing a player sees or hears is a placeholder.

### Stage 6 — Release preparation (M)

- [ ] **B6** Bans and the admin script, rate limits, rename and delete, nightly backups, and one
      restore actually tried.
- [ ] **Legal pages**: Terms of Service and Privacy Policy, linked from the footer, with a contact
      address. Then publish the Google sign-in (it needs the privacy policy on the live domain)
      and add the Google provider to production.
- [x] **Help and tutorial** rewritten for the Hegemon rules; the solo screen explains the throne.
      Built 2026-10-04 in three parts (below): the help page's rulebook, the in-game tutorial,
      and a one-line note under the solo screen's "Play as the Hegemon" toggle.
- [ ] **Licence items**: the Source link points at the deployed commit; `CREDITS.md` complete; the
      attribution line present.
- [ ] **Production keys**: ~~real Turnstile keys~~ (issued 2026-10-07, in `.env`); secrets rotated
      from anything used in testing (the `API_KEY` of the audit was a throwaway).
- [ ] **Throne launch lines** (was: throne count for the opening). Decided 2026-10-06 as
      L16-L28 in `DarkStar-Lobbies.md`: per-type lines with a floor of five, one countdown per
      line. The server side is built (Lobbies §10.5); the client (home cards per line head,
      place in line, the win screen's stay-or-join-the-head choice) remains. Team thrones (T5)
      built 2026-10-10 on `feat/team-thrones` (Lobbies §10.6), not yet deployed.
- [ ] **Watching it**: an uptime check on `/api/health` and the API's `/health`; a look at the
      server's logs and load with a dozen clients connected.
- [x] **Somewhere to report bugs** (a Discord server or an email address; Tom's choice). Done
      2026-10-07: the Discord server "Under a Dark Star" (invite `https://discord.gg/vTjcPKadD`,
      five channels: welcome, announcements, general, bug-reports, suggestions), owned by the
      `hello@` account, plus `hello@january-games.com`. Roles and channel permissions are still
      default; Tom tidies them before the friends test. The link goes on the help page in B2.
- [ ] Walk the launch checklist in roadmap P8.

_Done when_ the checklist is clean. This build is the release candidate.

### Stage 7 — The friends test (the gate)

- [ ] Tom and friends play an evening on the live server: several thrones, guests and accounts,
      a winner who keeps the seat, one who leaves, a loser who stays with their throne and one
      who joins the head of the line, a restart in the middle.
- [ ] Collect what broke, what confused, and whether it was fun. Fix what must be fixed; adjust
      balance (the numbers from M4 are expected to move).

### Stage 8 — Go or no-go

- [ ] **Tom decides.** Go: announce, add the itch.io listing, watch the first week closely, then
      take up the post-launch list (T5, T6, B7, P7). No-go: the site can stay up at a few dollars
      a month or be switched off; the database backup and the repository preserve everything.

## 5. Things only Tom can do

| What                                              | Needed by | Notes                                                                   |
| ------------------------------------------------- | --------- | ----------------------------------------------------------------------- |
| The decisions of Stage 0                          | Stage 0   |                                                                         |
| Maps                                              | Stage 5   | Starts after Stage 1's kit.                                             |
| Sound and music                                   | Stage 5   | Tom's plan; each file needs a licence that permits this use.            |
| Logo, wordmark, font                              | Stage 5   | The text wordmark and Overpass stay until then.                         |
| ~~A Discord developer application~~               | B2        | Done 2026-10-07 on `hello@`; keys go in the git-ignored `.env`.         |
| ~~A domain name~~                                 | 3b        | Done 2026-10-06: `january-games.com` at Cloudflare.                     |
| ~~A Cloudflare account, with the domain on it~~   | 3b        | Done 2026-10-06. Free plan. Also issues the Turnstile keys.             |
| A server (VPS) account                            | 3b        | About $10–30 a month from this point.                                   |
| A Google Cloud OAuth client                       | Stage 6   | Free. Cannot go public before the privacy policy is live.               |
| ~~A contact address and a place for bug reports~~ | Stage 6   | Done: `hello@january-games.com` (10-06) and the Discord server (10-07). |
| Reading and approving the Terms and Privacy pages | Stage 6   | Claude can draft them; they are Tom's undertakings, not Claude's.       |
| The go or no-go                                   | Stage 8   |                                                                         |

## 6. Open questions

1. ~~Hosting shape.~~ Confirmed 2026-10-01: one VPS behind Cloudflare. Which provider is still
   open (decide at H1).
2. ~~The domain name.~~ Bought 2026-10-06: `january-games.com` at Cloudflare. ~~Still open: the
   game's hostname.~~ Decided 2026-10-07: the game lives at `darkstar.january-games.com`, the
   studio page can take the root later. The API is `darkstar-api.january-games.com`, not
   `api.darkstar.…`: Cloudflare's free certificate covers `january-games.com` and one level of
   names under it, and a second level would need the paid certificate. The code takes the API
   hostname from `API_DOMAIN` (default `api.<DOMAIN>`), and the page learns it from
   `BOOTSTRAP_CONFIG.apiOrigin`.
3. ~~The launch map count~~ (at least six new maps, 2026-10-01); which of the 13 inherited maps
   stay is still open.
4. How many thrones to open with (suggest 3 to 5).
5. Whether "January Games" is a legal entity yet. It matters for the Terms now and for taking
   payments later; not legal advice.
6. An itch.io listing at launch, or after the first week?

## 7. Changelog

- **2026-10-11** — **Launch-lines client built** on `feat/team-thrones` (Lobbies §10.7): the
  win screen's stay-or-join-the-head choice, the place in line in the lobby and the browser,
  the rulebook line. The branch type-checks again (the throne test's mock lacked
  `throneTeamSplit`).

- **2026-10-10** — **Team thrones built (T5)** on `feat/team-thrones`, not merged: the team
  line opens at the same floor as the FFA and special lines once deployed (Lobbies §10.6).
- **2026-10-10** — **Second deploy.** `feat/nomenclature` fast-forwarded into `main` (commit
  `e3cf93a`, "LobbyUpdates": the tutorial line, the feudal nomenclature, the fleet icons, the
  stacked title, the PLAY nav item, the range-hover controller, the lobby browser panes L29)
  and deployed: build from cache, healthy, the page serves `e3cf93a`, both health endpoints
  answer. `compose up` left `cloudflared` running this time, so the 10-07 tunnel blip did
  not repeat. Routine from here: merge, push `main`, run the deploy command, the two-minute
  check.
- **2026-10-07** — **Nomenclature:** Nations are Lords and Tribes are Barons in all player-facing
  text and the docs; code identifiers unchanged (design doc §1, glossary).
- **2026-10-07** — **Main is the live branch.** `feat/hegemon-toolkit` fast-forwarded into `main`
  (commit `d4371c2`, "ItsAlive"), `DEPLOY_BRANCH=main` on the server and in the local `.env`, and
  Tom redeployed: 18-second build from cache, healthy, the page serves Tektur and `V0.01`, both
  health endpoints answer. Workflow from here: branches for new work, merge to `main` when
  finished, deploy as a separate command. Observed: `compose up` recreated the `cloudflared`
  container as well as the game, so the tunnel did drop for a few seconds. Its only input is
  `TUNNEL_TOKEN`, which did not change, so the cause is open; watch the next deploy.
- **2026-10-07** — **Tektur is the display font** (Google Fonts, OFL): the Latin and Latin-extended
  variable subsets in `resources/fonts/`, loaded in `Main.ts` ahead of Overpass, `--font-display`
  updated, the title's letterspacing tightened, credited in `CREDITS.md`. The version label is
  now `V0.01` (`resources/version.txt`; the version helper accepts two-part labels and keeps a
  capital V). Tom's priorities for the friends test set the same day: H5 by hand, commit the
  tree, the throne lines client, the uptime check; soundtrack deferred to a free weekend.
- **2026-10-07** — `DarkStar-Services.md` created: the guide to the third-party services (Cloudflare,
  DigitalOcean, GitHub, Discord, Gmail), who owns each, the secrets inventory, and what to check
  when the site misbehaves.
- **2026-10-07** — **The site is live, unannounced.** First deploy to the DigitalOcean server
  through the Cloudflare tunnel; the build took about six minutes on two cores; the game
  container uses about 470 MB and the tunnel 22 MB. H2, H3 and H4 done; H5's automated checks
  pass (page, API, JWKS, Discord redirect, thrones open); the two-network round with a real
  Discord sign-in is Tom's. Observed on the way: the SSH rate limit, and that the headless
  browser cannot pass the real Turnstile check (by design).
- **2026-10-07** — **H1 done, H2 begun, H4 built.** Tom bought the server (DigitalOcean, NYC1,
  2 vCPU / 4 GB Premium AMD, $28/month). Server prepared over SSH (swap, firewall, folders,
  deploy key); `deploy/` gains the compose file, the deploy script and the env pusher;
  upstream's deploy scripts and their tests are gone. Remaining for Tom before the first deploy:
  the Cloudflare tunnel token into the local `.env`, the deploy key on GitHub (or a public
  repository), `git push`, the Discord production redirect. Then: push the env, run the deploy,
  H5 smoke test.
- **2026-10-07** — **B3 built and Stage 3a passed** (Accounts doc §12.3). The production-mode
  container, built and run on Tom's PC through Docker Desktop, served the page, verified an
  account's token, passed a guest through the Turnstile check (test keys), and ran a game with
  both. The audit found and fixed two bugs that only production mode shows: the inlined game
  worker could not resolve asset URLs without a CDN (no game could start), and a guest's browser
  ID was dropped on every page load (a new `Anon` name every visit). The ranked matchmaking poll
  is off by default. Next: 3b, the first deployment (H1: the VPS).
- **2026-10-07** — **Hostnames decided** (§6.2): `darkstar.january-games.com` for the game,
  `darkstar-api.january-games.com` for the API (Tom spotted that `api.darkstar.…` falls outside
  the free certificate). `API_DOMAIN` added across the server, the page bootstrap, the client and
  the API so the two names need not be related. Turnstile widget hostnames set by Tom
  (127.0.0.1, darkstar.january-games.com, january-games.com, localhost); the Turnstile keys are in
  `.env`; the Discord production redirect waits for H2. A20 decided (Accounts doc).
- **2026-10-07** — **Discord developer application created** by Tom on the studio Discord account
  (`hello@january-games.com`), with the dev redirect `http://localhost:8787/auth/callback/discord`
  registered; the production redirect waits for the hostname decision (§6.2). The client ID and
  secret live in the root `.env` (git-ignored, read by the API through dotenv at boot), never in
  the chat or the repository. Tom also chose a Discord server for bug reports (Stage 6) and
  created it the same day: `https://discord.gg/vTjcPKadD`.
- **2026-10-07** — **B2 built** (Accounts doc §12.2): sign-in with the dev provider and Discord,
  sessions, `/users/@me`, guests as `Anon#####` everywhere, the Sign in button and account
  panel, the help page's Discord and email links. Checked in the browser with the dev provider:
  sign in, reload, host a lobby, a guest joins it, sign out. Next: B3, the production join path.
- **2026-10-06** — **Domain bought:** `january-games.com` at Cloudflare, with Email Routing
  forwarding `hello@january-games.com` to a mailbox outside the domain; .io ruled out. Order of operations agreed: the Cloudflare account on a studio-controlled
  Gmail (never on an address at the domain, or a lockout would also cut off the recovery mail),
  then the domain, then Cloudflare Email Routing (free forwarding, no mailbox) so that
  `hello@january-games.com` lands in that Gmail. The VPS, Discord developer, itch.io and Google
  Cloud accounts are then opened on `hello@` so they belong to the studio. Replies as `hello@`
  go through Gmail's "Send mail as"; Google Workspace only if proper outbound mail is ever needed.
- **2026-10-01** — Created. Scope of the minimum public release fixed from Tom's decisions of the
  day; the friends playtest moved from 2026-10-04 to Stage 7 as the go/no-go gate; stages 0–8
  ordered; hosting recorded as proposed, not confirmed.
- **2026-10-01** — Tom confirmed the hosting shape (a rented server behind Cloudflare, for now) and
  set the map target at a minimum of six new maps. Scope wording follows the accounts decisions of
  the same day (guest names assigned; the board shows reigns and longest reign).
- **2026-10-01** — Stage 1's map kit built (`npm run map`, `docs/MapMaking.md`). The stage is done
  when Tom has taken one drawing of his own through it.
- **2026-10-03** — Six new maps exist (No Moon, Nucleic Acid, Nucleus, Jovian System, Bullseye,
  Cube), each generated from one of Tom's sketches and run three times in `HegemonSim`. Stage 5's
  map item stays open until Tom has played each and the inherited maps have been culled.
- **2026-10-03** — Stage 2's T1 built: the master runs a fixed pool of named throne lobbies back
  to back (`src/server/ThroneRegistry.ts`), FFA only, AI seated, two humans to fire with a hold,
  the next lobby opened the moment a round ends. The home cards and the lobby browser show them
  with a thin shim; the Thrones tab, Watch and the seat buttons wait for T3. Names drafted as 80
  real star names.
- **2026-10-03** — Stage 2's T2 built on the server: the winner's reservation and 30-second window,
  the `throne_pick` message (map, keep or step down), `claim_seat` / `leave_seat`, heir seating
  and unseating, reigns. Nothing in the browser sends these yet: T3 is next.
- **2026-10-03** — Stage 2's T3 built: throne cards name the holder, the lobby browser's Thrones
  pane watches running rounds, the lobby has Claim / Give up and "reserved for", the win screen
  has the winner's Next-round panel (map picker, Keep the throne / Step down, 30-second bar), and
  the Dark Star panel shows the throne and reign. The stage's three-rounds-in-a-row check is
  Tom's to run.
- **2026-10-03** — Tom reviewed Stage 2 in the browser (join prompt, the winner picking the map,
  reign counts, spectating a running round) and called it sufficient. He asked to defer the
  accounts work: Stage 4's T4 was pulled forward and built; B1 follows as code only, with the
  sign-in providers and the first deployment postponed until he is closer to wanting a real
  address.
- **2026-10-03** — B1 built as code: the account API skeleton starts with `npm run dev`, serves
  its signing key and clears the client's backend check. B2's providers, B3 and the first
  deployment (3b) stay postponed.
- **2026-10-04** — Stage 6's help rewrite, part one: the help page opens with a technical
  rulebook (Tom's choice over flavour text) in eight numbered sections: the round, the Dark
  Star, the Hegemon, strikes, invading, stargates/warheads/shields, gifts and the economy,
  thrones. Every number in it is read from the core defaults (`HEGEMON_DEFAULTS`,
  `STARGATE_DEFAULTS`, `SHIELD_ARRAY_DEFAULTS`, now exported from `Config.ts`) so the text
  cannot drift; only the winner's 30-second window (server config) and the warhead prices are
  written in. The build table lost the silo, SAM and MIRV rows and gained the stargate;
  troubleshooting moved to the foot of the page. Still to do: the in-game tutorial (its SAM and
  spawn steps are OpenFront's) and the solo screen's throne note.
- **2026-10-04** — Stage 6's help rewrite, part two: the in-game tutorial adapted to the Dark
  Star. New steps: the Dark Star explainer right after spawning (the Hegemon is the marked
  player, so Go to flies there), build a Stargate, fire a gate shot (with a loading text while
  the gate builds or reloads), warheads and the punitive flag, the Shield Array, the throne's
  strike and how to fight its bubble, and how the round is won. Gone: the silo, atom launch,
  atom/hydrogen/MIRV/SAM steps. The Dark Star steps drop out in a game without a throne; the
  gate and shield steps drop out when those units are off. A seated Hegemon gets no tutorial
  (its spawn and build prompts never fitted the throne); a throne track is a possible follow-up.
  Numbers in the step texts (flag seconds, stall seconds, shield radius) come from the core
  defaults. `tests/Tutorial.test.ts` reworked (15 tests).
- **2026-10-04** — Tom marked Stage 1 (the map kit), Stage 2 (public thrones) and Stage 5's maps
  item as passing. The engineering track from here is Stage 3 onward: B2, B3, the first
  deployment, then B4–B6 and the Stage 6 checklist. Open on the content side: sound (P4), the
  wordmark and font, and the inherited-map cull.
- **2026-10-04** — Stage 6's help rewrite, part three: the solo screen's "Play as the Hegemon"
  card carries a one-line description (every game has a Dark Star; the AI holds the throne unless
  you take the seat). The shared toggle card gained an optional `descriptionKey`. The Help and
  tutorial item is ticked.
- **2026-10-04** — Hotkeys brought in line with the Dark Star (Tom chose the compact form). The
  help page's Hotkeys table gains one row for the hotbar's build keys (1 to 9, shown as a range)
  and rows for the fleet, ground attack, retaliate, request-alliance and break-alliance keys,
  none of which it listed; combos such as Shift+R render as separate badges. The settings
  screen's keybind list loses its Missile Silo, SAM Launcher and MIRV rows, and the Stargate and
  Shield Array rows no longer talk about sharing a key. The default bindings themselves are
  unchanged.
- **2026-10-05** — The silo, SAM and MIRV key bindings are gone for good (Tom: the vanilla path
  is dropped). Removed from the default keybinds, the input handler's build-key lists and the
  in-game hotbar, which now shows nine units (1 to 9) with the Shield Array on 5 and the Stargate
  on 6 unconditionally. Side effect fixed: the hidden bindings no longer block a player from
  rebinding another action to 5, 6 or 0. Input handler tests retargeted.
- **2026-10-05** — Tom set the direction for throne launches: per-type launch queues with a
  floor of five, replacing the Stage 6 throne-count item (Lobbies doc §13). Opening numbers
  stay 15 thrones, 5 of each type.
- **2026-10-06** — Throne launch lines decided (L16-L28) and built on the server: the registry
  runs one line per type with a floor of five, counts down only the head, puts a kept seat
  second, and retires surplus empty thrones. An unanswered winner's window now keeps the
  winner on the seat. The client work and team thrones (T5) are next.
