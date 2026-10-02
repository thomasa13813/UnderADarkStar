# Under a Dark Star — the road to release

Written 2026-09-27 from Tom's seven-point list of non-gameplay work, checked against what the repo
actually contains. It supersedes M5–M9 of `docs/DarkStar-Design.md` §9 (M1–M4 stay there as history);
gameplay rules and their as-built notes remain in the design doc. Update this file and the design doc's
changelog when a phase changes.

**How to read it.** Phases are ordered by dependency, not by importance: identity (P5) has to exist
before a Hegemon can persist across rounds (P6) or buy anything (P7), and the strip-down (P1) makes
every later phase touch fewer files. Each phase lists what the repo already has, the work, the
decisions only Tom can make, and what "done" means. Sizes are relative: S = a session, M = a few
sessions, L = a week or more of sessions, XL = open-ended.

## 0. Assessment of the list

Tom's seven points cover the visible work. Three things are missing, and one is mis-sized:

- **Identity is the hinge, not a backend detail.** "The winner is next round's Hegemon" needs the
  server to know who _you_ are across page loads and reconnects, and the store needs it too. Today the
  only identity is a JWT minted by OpenFront's closed API (`docs/Auth.md`); without that API every
  join outside dev is rejected. So the smallest possible account system comes _before_ matchmaking,
  not after it as item 7 implies.
- **Public servers need anti-abuse from day one.** Upstream leans on the API for Turnstile bot checks,
  name censoring, reserved clan tags and bans. A public throne lobby with none of that is a griefing
  target: the seat can be squatted, names can be anything. Budget for it inside P5.
- **The AGPL obligations are work items, not a footnote.** Hosting a modified server publicly obliges
  us to offer the source to players; the licence's §7 terms require "© OpenFront and Contributors"
  visible and forbid "OpenFront" as the title. That means a public repository, a "Source" link in the
  footer, an attribution line on the splash page, and a `CREDITS.md` that names OpenFront for
  `resources/` (CC BY-SA 4.0 — anything derived from those assets is share-alike).
- **Matchmaking is smaller than feared, and the surrounding polish larger.** The engine already
  schedules public lobbies on a timer, has a "New lobby" successor flow, and archives each game with
  `isHegemon` on the record. The persistent seat is a few hundred lines on top of that once identity
  exists. What is _not_ built anywhere is the throne's identity on screen (reign counters, high scores)
  and the edge cases (F12: the Hegemon disconnects, an AI lands the killing blow).

Also worth naming: multiplayer has **no human Hegemon at all** (the seat is always the AI outside
singleplayer). Closing that gap is P0 because every later phase is easier to judge with friends in a
lobby.

## P0. Close the gameplay loop for private play (M) — built 2026-09-27, awaiting play

**Goal.** Tom can play Hegemon rounds with friends in a private lobby, with the seat handed to the
winner by hand, before any backend exists.

**Exists.** Singleplayer Hegemon (`SinglePlayerModal` sets `hegemon: {enabled}` and `isHegemon` on
the local player); the private "New lobby" successor flow (`Worker.ts` `create_game?previous=`,
`GameServer.setSuccessorLobby`, `NewLobbyPrompt`), which today inherits **no** config (the new game
gets the World/FFA/Easy defaults); the archive record carries `isHegemon`.

**Work.**

- A **Hegemon toggle in the private lobby** (`HostLobbyModal`; add `hegemon` to `ConfigPatch`'s
  `COPIED_KEYS` so `update_game_config` can set it). FFA only, as `Config.hegemonConfig` enforces.
- **A human seat in multiplayer.** The server sets `isHegemon` on one player at `start()`: the host's
  choice from the lobby roster ("Play as the Hegemon" on your own row, or "Give the throne to…"),
  else the AI. Validate that exactly one seat is set.
- **Successor lobby inherits the config** (map, mode, Hegemon on, timer) and **pre-seats the winner**
  when the previous round's winner is in the new lobby (the archive record and `hegemonSlayer` know
  who won). The host may still override.
- **Edge cases (F12), decided 2026-09-27:** a human Hegemon who leaves mid-round is simply absent —
  no AI or player swaps in, the round goes on (only H13 defends the disc); an AI killing blow leaves
  the seat **unclaimed** next round (in a public lobby anyone may claim it, else the AI holds it; an
  AI Hegemon's timer win leaves it open again); the invader disconnecting frees the slot when their
  tiles are gone (already true).

**Decided 2026-09-27.** The lobby creator seats the Hegemon; an absent Hegemon is nobody's problem but
their own.

**Done when** a group can play three rounds in a row in one private lobby with the winner seated each
time. [Built 2026-09-27, design doc §6.22: the seat, the host toggle and crown, the successor
inheriting the round and seating the winner. What remains is the play itself.]

## P1. Strip and rebrand (M)

**Goal.** A build that contains nothing OpenFront owns and nothing that only works with OpenFront's
API, with the attribution the licence requires. This is Tom's point 3 plus the design doc's §8 list.

**Exists.** The inventory (`docs/DarkStar-Design.md` §8 and the 2026-09-27 survey): `proprietary/`
holds 8 logo images, `OpenFront.ttf`, the favicon and three sound files (menu theme, gameplay music,
game-start alert), copied in by `vite.config.ts` and `Dockerfile:20`; the home page background is an
Earth map (`resources/images/background.webp`); 42 `en.json` strings and 41 other language files say
"OpenFront"; ads and analytics (`HomepagePromos`, `Admiral`, `AdGatekeeper`, `InGamePromo`, gtag and
Playwire in `index.html`); links to OpenFront's Discord, wiki, YouTube, Steam, GitHub, subreddit
(`Footer`, `WinModal`, `GameStartingModal`, `Utils`, `NewsMarkdown`, `SteamWishlist`); `og:` and
canonical tags, `resources/manifest.json` (PWA), `package.json` name `openfront-client`; server
strings (`GamePreviewBuilder`, `GameApiCors`, logger/metrics service names).

**Work, in steps Tom can playtest between.** Each step leaves the game playable (solo, create,
join) and is a commit of its own.

- **A. Build hygiene, ads, links and licence (built 2026-09-27, see below).** `proprietary/` out of
  the repo and the build; a `branding/` overlay (All Rights Reserved, January Games) on the same
  mechanism, holding a placeholder favicon; a text wordmark in the three nav bars and Overpass Bold
  as the placeholder display face; silent placeholder tracks for the menu theme, gameplay music
  and game-start alert; every ad, analytics and third-party script gone from `index.html`
  (Playwire, Admiral, gtag, Cloudflare Insights, CrazyGames SDK) with the modules behind them
  (`AdGatekeeper`, `Admiral`, `HomepagePromos`, `InGamePromo`, `FeaturedStream`, `StreamsFeed`,
  `StreamingNow`, `MarketingConsentToast`, `PurchaseNudgeModal`, Steam wishlist); the footer
  rebuilt with "Source" (this repository), "Made by January Games" and "© OpenFront and
  Contributors"; the game-start credits link, `og:` tags, `manifest.json` and `package.json`
  renamed; OpenFront's press kit, `ads.txt`, Apple Pay file and legal pages removed from
  `resources/public/`; `CREDITS.md`, `LICENSE-ASSETS`, `LICENSING.md` and `README.md` rewritten.
- **B. Remove the closed-API UI (built 2026-09-27, see below).** The pages and nav entries for store, inventory, leaderboard,
  clans, account, profile, game history, ranked queue, matchmaking, news and changelog, rewards,
  token login, creator codes, subscriptions, bans; the win screen's store promo; `news.json`,
  `changelog.md`, `lemon-drizzle.md`; their tests. Keep the plumbing modules the join path still
  calls (`Api`, `Auth`, `Cosmetics`, `ApiSchemas`, `CosmeticSchemas`, `PatternDecoder`) so P5 and
  P7 rebuild on them rather than from nothing; note in each what is dead. Playtest: the home page
  shows Play only; solo, create and join still work.
- **C. Strings and server names (built 2026-09-27, see below).** Every "OpenFront" left in `en.json` (about 40, mostly desktop
  and account copy that step D deletes anyway), `CONTRIBUTING.md`, the help page's OpenFront
  tutorial video, `GamePreviewBuilder`, logger and OpenTelemetry service names, metric names,
  hostname comments in `ServerEnv`/`ClientEnv`/`GameApiCors`. Playtest: quick smoke.
- **D. The platform layer (built 2026-09-27, see below).** The Steam desktop shell (`DesktopShell`, `SteamSDK`, `SteamLink`,
  `SteamHandoff`, `DesktopPresence`, `DesktopAchievements`, `DesktopRelease`, the `app://openfront`
  origin, `openfrontDesktop` in `index.html`) and CrazyGames (`CrazyGamesSDK`, 24 importers) are
  OpenFront's distribution deals; nothing of ours will ever run in them. Mechanical but wide
  (about 50 files, 30 tests). Playtest: full round in a lobby.
- **E. The home screen.** The space background is built (2026-09-27, below); the title
  treatment and play buttons wait on the logo, wordmark and font.

**Decided 2026-09-27.** Tom supplies the logo and wordmark when ready (text wordmark until then);
the font is revisited later (Overpass stays); no upstream community links; step D is in P1.

**As built, step A (2026-09-27).** The `proprietary/` overlay became `branding/`: `vite.config.ts`
serves it in dev and merges it into the hashed asset manifest in production, `Dockerfile` copies
it, `tsconfig.json` includes it, and `PublicAssetManifest.getBrandingDir` names it. Only
`images/Favicon.svg` has to exist there; everything else falls through to `resources/`. The three
music/alert files are silent MPEG frames written by hand (no encoder on the build machine) at the
old paths, so `MenuMusic`, `SoundManager` and their tests are untouched; P4 replaces the files.
The font is loaded through `assetUrl` in `Main.ts` (a CSS `url()` would miss the CDN hash);
`--font-display` in `styles.css` names it. OpenFront's Terms of Service and Privacy Policy were
removed rather than kept under our name; P8 now lists writing our own. Leftover after A: `grep -ri
openfront` over `src/`, `resources/` (minus `lang/`) and `index.html` finds 53 files, 352 of the
hits in `resources/changelog.md` (step B) and most of the rest in the desktop shell (step D).

**As built, step B (2026-09-27).** 101 client modules and 70 test files deleted: the store,
inventory, leaderboard, clan, account, profile, game-history, ranked/matchmaking, news, rewards,
token-login, creator-code, subscription and ban modals with their panels, the cosmetic card /
preview chain and the WebGL cosmetic preview renderer, `LinkResult`/`LoginResult`, `Markdown`,
`PlayerName` (the profile-link component), `news.json`, `changelog.md`, `lemon-drizzle.md`. The
graph was computed from imports (scratch script; anything reachable only through a deleted root
went too). Kept on purpose: `Api`, `Auth`, `Cosmetics`, `ApiSchemas`, `CosmeticSchemas`,
`PatternDecoder`, `BootInterrupts`, `PlayerName.ts` (the name resolver) and `UsernameInput`
(1,200 lines of clan-tag and verified-name logic that only activates with an account; P5 decides
its fate). Edits: `Main.ts` lost the modal router entries, the boot-interrupt sequence (lapse
notice, rewards, claim prompt), creator codes, `#purchase-completed`/`#token-login`/`#affiliate`
hashes and the matchmaking requeue; the nav bars keep Play plus the help and settings icons; the
solo modal's "sign in for achievements" banner is gone; the win screen keeps exit and keep/spectate
only; `UsernameInput` lost "Browse clans" and the join-modal link. 688 orphaned `en.json` keys
pruned (tests/TranslationSystem enforces that). Suite: 444 files pass; the two `update.sh` files
fail on Windows regardless.

**As built, step E part 1 (2026-09-27): the space background.** `scripts/generateStarfield.ts`
(no dependencies; seeded PRNG, value-noise nebulae, a tilted galactic band, tiered and tinted
stars, two small spirals, ordered dithering, a hand-rolled PNG writer) writes
`resources/images/background.png` at 640×360; the page scales it with
`image-rendering: pixelated`, so the file is 11 KB and the pixels stay crisp. `npx tsx
scripts/generateStarfield.ts [seed] [w] [h]` regenerates it; the Earth map with the hex grid is
gone. P2 reuses the generator for the in-map starfield.

**As built, step D (2026-09-27).** 19 modules and 31 test files deleted: the Steam desktop shell
(`DesktopShell`, `SteamSDK`, `SteamLink`/`SteamLinkModal`, `SteamHandoff`/`SteamHandoffModal`,
`DesktopPresence`, `PresenceGroup`, `DesktopAchievements`, `AchievementSignal`,
`DesktopSessionRecovery`, `DesktopDisplay`, `DesktopStatusBar`, the server's `DesktopRelease` and
`RenderDesktopDescriptor` with the `/desktop/*.json` routes), CrazyGames (`CrazyGamesSDK`,
`CrazyGamesAccountButton`), `ClientPlatform` (the join now always says `web`) and the friends invite
button. What their callers kept: `Auth.ts` is down to the JWT refresh, logout and play-token paths
(the Discord/Google/Steam/magic-link logins went with the account UI); `GameModeSelector` and the
lobby browser gate on backend reachability only; the settings modal lost its Display tab and the
Steam lobby-link toggle; the win screen no longer syncs achievements; the CORS allowlist no longer
admits `app://openfront`; nginx and Vite lost the `/link` alias. `ClientPlatformSchema` keeps its
`steam`/`crazygames` members because zbin ordinals are append-only. 88 more `en.json` keys pruned.

**As built, step C (2026-09-27).** Service names are `darkstar` (logger, OpenTelemetry resource,
metric names `darkstar.*`), the lobby preview title is "Under a Dark Star game", the nginx upstream
is `game_workers`, `package.json` lost the `dev:staging`/`dev:prod` scripts that pointed at
OpenFront's API, `CONTRIBUTING.md` is ours, the help page's OpenFront tutorial video is gone (P8:
record our own), and every hostname in a comment is an `example.com`/`example.dev` placeholder.
What `grep -ri openfront` still finds under `src/`, `resources/` and `index.html`: the attribution
line, and six comments that credit upstream code (`RailroadCache`, `TrailManager`, the railroad
shader) or cite upstream issues (`DisableSafariPinchZoom`). Those stay on purpose. Outside that
scope: `docs/` (engine docs), the GitHub workflows (upstream's CI, to be replaced in P8) and the 40
Crowdin language files (P8 decides). `LICENSING.md` and `CREDITS.md` name OpenFront as they must.

## P2. Map visuals: deep space (M)

**Goal.** Tom's point 4: deep space is transparent over a starfield and the whole game reads as a
galaxy. (Land as a flat colour was part of the goal until 2026-09-28; see the struck bullet below.)

**Exists.** Terrain colour is baked on the CPU (`ColorUtils.encodeTerrainTile`, alpha fixed at 255),
drawn by `TerrainPass` over a solid clear colour (`Renderer.drawBaseLayer`, `alpha: false` on the
context); there is no background layer of any kind. Deep water, shore water, plains, highland,
mountain, sand and impassable each have a colour in `render-settings.json`, user-overridable in the
advanced graphics settings. The Dark Star moat is plain water bytes. The generator distinguishes
shore water from ocean and encodes land elevation, which galaxy maps do not need.

**Work.**

- ~~**A background pass** drawn first: a static starfield texture (tiled or map-sized, generated
  once from the map seed so every client agrees, or a shipped image), with optional slow parallax
  on zoom. Then `TerrainPass` with water alpha 0 and blending on, so space shows through.~~ Built
  2026-09-28 (as-built note below); no parallax.
- ~~**Land as one colour** per map or per palette (the design doc's §5.3 gap: per-map palette in
  `info.json`); mountains and highlands collapse to the same colour unless a map opts in. Shores keep
  a faint rim so coastlines read.~~ **Dropped 2026-09-28 (Tom):** elevation is gameplay (highland
  and mountain tiles cost more troops to take and slow an attack, `terrainAttackBase` in
  `Config.ts`), the current plains/highland/mountain colours convey it intuitively, and the change
  was judged more trouble than it is worth. A more space-flavoured land palette may be considered
  later; it would be a palette swap in `render-settings.json`, not a map change.
- **The moat and disc**: the Dark Star gets its own look (a black disc with an accretion rim, the moat
  as a darker ring), driven by `DarkStar` geometry the client already has.
- Territory, borders, fog, night mode, the cosmetic preview renderer and the minimap all assume opaque
  terrain; check each. Screenshots at three zooms on Event Horizon and Milky Way.

**Decide.** ~~Starfield generated or painted~~ (generated, one shipped image, decided 2026-09-28);
whether nebulae tint the space behind particular regions (a per-map background image would make
that easy); ~~land colour per map or global~~ (moot, the land-colour bullet is dropped).

**Done when** Event Horizon plays with transparent space and the HUD, minimap and previews still
read.

**As built, first bullet (2026-09-28).** Tom compared plain black space with translucent grey
over the home page's starfield and chose the starfield. `StarfieldPass` draws
`resources/images/starfield-map.png` (the home page's sky rendered at 2048×2048 by
`scripts/generateStarfield.ts 11 2048 2048 starfield-map.png`, so its grain is about a tile per
pixel) over the map quad before the terrain, cover-fitted with the aspect kept; nothing draws
until the image loads. `encodeTerrainTile` takes a `waterAlpha`: deep space is `oceanColor` (now
a grey, `#8b929e`) at `terrain.oceanAlpha` (0.45) and shoreline water 30% of the way back to
opaque so coastlines read; land and void stay opaque, and void plus the area outside the map are
`backgroundColor`, now near-black (`#0b0b12`). `TerrainPass` now draws with blending on. Two
graphics overrides/UI controls under Terrain, kept as player preferences: "Starfield background"
(`terrain.spaceBackground`; off bakes the water opaque) and "Deep space opacity"
(`terrain.oceanAlpha`). Not done: the moat and disc look (Tom: the moat looks fine as it is, so
low priority) and the opaque-terrain audit (territory, borders, night mode and the previews looked right on Event
Horizon at three zooms; there is no minimap in this fork, so that item is moot). Screenshot
driver: `.claude/skills/run-openfront/space-shots.mjs`.

## P3. The map pool (L)

**Goal.** Tom's point 2: ship with a fresh set of galaxy maps authored by Tom, and remove the
inherited ones.

**Exists.** The Go generator (`map-generator/`) takes **one PNG per map** plus an `info.json` — so
yes, MS Paint images work directly. The encoding: any pixel with **blue = 106** (or alpha under 20)
is deep space; **pure black** is void (impassable, drawn as background); **anything else is land**,
with the blue channel setting elevation (blue below 159 is plains). Shores are computed. Islands under
30 px and lakes under 200 px are deleted. Recommended area 2–3M px (1800 × 1800 is what Event
Horizon uses); width and height are cropped to multiples of 4. `info.json` names the map, its
categories, its nations (`name`, optional `coordinates`, optional `flag`) and the Dark Star geometry
(`hegemon: {center, radius, moat}`; omitted means a centred disc sized from the map). The generator
writes `map.bin`, the 4x and 16x versions, the manifest, `thumbnail.webp`, `Maps.gen.ts` and the
`en.json` map names. `scripts/generateGalaxyMap.ts` makes procedural galaxies (Event Horizon is one).
Only Event Horizon is ours; Milky Way and Sol are upstream (CC BY-SA); everything else is Earth.

**Work.**

- **An authoring kit for Tom:** a one-page guide and a small script that takes an MS Paint PNG in a
  friendly palette (e.g. white = land, blue = space, black = void, red dots = nation spawns, a
  yellow circle = the Dark Star) and writes the generator's exact encoding plus the `info.json`.
  Then `npm run gen-maps`. Thumbnails come free; the picker needs no hand-made art.
- **The pool itself:** 10–20 maps (S9), each played once in `HegemonSim` for a sanity check (nation
  count, whether nations reach the moat, exclaves F18) and once by Tom.
- **Remove the inherited maps** (F17, map by map, Tom's call; the `GameMapType` enum is wire format
  but nothing outside this fork depends on it) and their `map-generator/assets` sources, and take the
  Earth entries out of `CREDITS.md`.
- **Nation names per map** with the `space` theme for Tribes; per-map palette (P2).
- The map picker and lobby map lists (`MapPicker`, `MapPlaylist` frequencies) rebuilt around the new
  categories.

**Decided 2026-09-27.** Milky Way and Sol stay (CC BY-SA, already credited; no new obligation).
Tom is happy for his own maps to ship CC BY-SA under `resources/` like the rest. Target pool: about
20 maps at launch; the picker is alphabetical with no categories. Open: whether every map's Dark
Star is central (H1) or `info.json` may place it.

**As built, step 1 (2026-09-27): the cull.** 112 inherited maps removed (sources under
`map-generator/assets/maps/`, outputs under `resources/maps/`, 224 directories). Fourteen remain:
Event Horizon, Milky Way, Sol, Traders Dream, Passage, Branching Paths, Chopping Block, More Than
Luck, Sierpinski, Warship Warship, and the four tourney maps renamed **Duel** (2 teams),
**Standoff** (3), **Corners** (4) and **Royale** (8) — new folders, ids and translation keys, so the
old `Tourney1`–`Tourney4` enum members are gone. The generator regenerated `Maps.gen.ts` and the
outputs; the stale `map.*` strings were pruned by hand (the generator only adds). `MapPicker` is one
alphabetical grid (by translated name) with search, the favourites star and the Random card; the
featured/all/favourites tabs and the category bars are gone, though `info.json` still needs a
category because the generator validates it. Every default that said World now says Event Horizon
(host and solo modals, the server's default config); the playlist's ranked lists point at Duel and
Standoff; the Four Islands special case is gone. `CREDITS.md` keeps only the Milky Way data source.
Tests that named an Earth map were repointed and the wire-transcript snapshot refreshed. Test
fixtures under `tests/testdata/maps/` (world, plains, …) are unaffected: they are copies, not
resources.

**Decided 2026-10-01.** The launch needs at least six new maps of Tom's (the earlier target was
about 20 in total).

**Done when** the pool reaches launch size, each map has a thumbnail and nations, and the sim runs
on every one.

## P4. Audio (M)

**Goal.** Tom's point 5 and S8: a legal soundtrack and cues for the things this game does that
OpenFront does not.

**Exists.** 34 effect files and 4 ambience loops in `resources/sounds` (CC BY-SA), played through
`Sounds.ts` → `AudioMixer` with per-category volumes; four files on disk are never referenced
(`warship-lost`, `warship-shot`, `sam-hit`, `sam-shoot`). Music is entirely proprietary: menu theme,
gameplay loop, game-start alert. No credits file for any sound.

**Work.**

- **Soundtrack:** one menu theme and one or more gameplay loops. Options, cheapest first: CC0 /
  CC BY music (Kevin MacLeod, Free Music Archive, OpenGameArt — attribution in `CREDITS.md`), a
  commissioned track, or generated music with a licence that permits commercial use. Streamed via the
  existing `SoundManager` / `MenuMusic` hooks; only the file paths change.
- **New cues:** strike inbound, strike landed, punitive levy, invasion landed on the Dark Star, the
  last stand, the Hegemon overthrown, timer victory, gate fired. Wire them where the events already
  exist (`events_display.*` in `en.json` marks the spots).
- **Verify effects play** in a real round (S8 says silence is a bug), reference or delete the four
  orphan files, and write the sound credits.

**Decide.** The soundtrack source and budget; whether the throne has its own ambience.

**Done when** the proprietary music is gone from the build, every cue has a file, and `CREDITS.md`
lists each one with its licence.

## P5. Identity and the minimal backend (L)

**Goal.** Replace the closed API with the smallest service that lets players be recognised across
rounds, keeps bots out of public lobbies, and records who won each game. Tom's point 7, first half.

**Design drafted 2026-10-01: `docs/DarkStar-Accounts.md`** (decisions A1–A20, the API surface, the
database, implementation steps B1–B7). It supersedes the outline below where they differ.

**Exists.** The server verifies an EdDSA JWT from `api.<DOMAIN>/.well-known/jwks.json` at websocket
connect and maps `clientID` to `persistentID` (`jwt.ts`); the client keeps a 15-minute token from a
30-day refresh cookie (`Auth.ts`); in dev a raw persistent ID is accepted. Server-side calls that
matter: `/join_verify` (Turnstile plus name censoring, fails open to a local censor), `/cluster/checkin`
(without it a hosted server never schedules public lobbies), `/game/:id` (archive), `/users/@me`,
`/cosmetics.json`, `/reserved_clan_tags`, `/custom_tribes`, `/matchmaking/checkin`, the lobby
coordinator websocket. Client-side: login via Discord/Google/Steam/magic link redirects, profiles,
leaderboards, news, friends, clans, the store. Deployment: one container (nginx, supervisord, Node
master on 3000, workers on 3001+) behind Cloudflare; `update.sh` registers with the API and uploads
assets to R2.

**Work.**

- **Choose the shape.** Recommendation: a small Node/TypeScript service in this repo (`src/api/`),
  Postgres or SQLite behind it, deployed beside the game server on the same box; it is what the
  server already expects to talk to, and it keeps the copyleft question simple (the API is part of the
  program we host, so it ships in the public repo). Upstream's Cloudflare Worker shape is an
  alternative if Tom prefers serverless.
- **Auth:** issue the same JWTs the server already verifies (JWKS, issuer, audience), from a **magic
  link by email** and/or **Discord OAuth**. Guests keep the localStorage UUID for private lobbies;
  public throne lobbies require a login.
- **Endpoints to implement, in this order:** `jwks.json`, `auth/*` (login, refresh, revoke),
  `join_verify` (Turnstile + censor), `cluster/checkin` (or remove the gate in `Master.ts`),
  `game/:id` archive POST/GET, `users/@me`, `public/player/:id` (games and reigns). Stub or delete
  the rest (cosmetics until P7; coordinator, ranked, clans, friends, news: delete).
- **Anti-abuse:** Turnstile on join, name censoring, a ban list keyed on account, rate limits on
  lobby creation, an admin endpoint to end a game or evict a seat.
- **Ops basics:** env and secrets, backups, a health page, structured logs (the OTel plumbing exists),
  and `update.sh` rewritten for our registry (or dropped for a plain `docker compose up`).

**Decide.** Hosted where (a Hetzner box like upstream, or a PaaS); login providers (email magic link is
the least friction and needs only an email sender; Discord fits the audience); whether guests may
play public rounds at all.

**Decided 2026-10-01.** Accounts are in the launch scope (Tom declined an accountless launch): the
server holds an authoritative account record and a **leaderboard database**. The first things
tracked are performance only: reigns as Hegemon and the longest consecutive streak. Profiles and
anything richer can wait. **Login:** Discord and Google at launch, built so an email login can be
added later (an account may carry several linked identities). **Guests** may play public rounds and
hold a throne (L3 stands); a guest's reign is simply not recorded. **Every public throne round
counts**, including the two-human minimum of L9; no higher bar for the leaderboard. **The board:**
reigns (every round won is one reign, by overthrow or by holding to the timer) and longest reign
(most consecutive wins), with thrones taken and rounds held kept as the split. **Names:** an
account name carries a four-digit tag and a signed-in player may play under any name; a guest is
given `Anon` plus five digits and cannot choose. Known and accepted: the server does not run the simulation, so the winner it
records is the majority vote of the clients in the game (`GameServer.handleWinner`, one vote per
IP), and a two-person round can be farmed. The hardening, if it is ever needed, is to replay the
archived turns on the server for rounds that count.

**Done when** a player logs in, joins a public lobby on a deployed server, plays, and their reign
appears on the leaderboard.

## P6. Matchmaking and the persistent Hegemon (L)

**Goal.** Tom's point 1: public "throne" lobbies where the winner of a round takes the seat for the
next one.

**Design decided 2026-09-29: `docs/DarkStar-Lobbies.md`** (decisions L1–L15, the throne state
machine, IPC and schema additions, implementation steps T1–T6). It supersedes the outline below
where they differ: no login is required to hold a seat, the pool starts at **15** named thrones of
fixed type, the winner may step down after picking, no reign cap, and a restart opens every seat.

**Exists.** `MasterLobbyService` schedules public lobbies per type (`ffa`, `team`, `special`; up to 6
queued per type, a new one every 2 minutes in prod), picks maps from a weighted playlist, and
assigns games to workers by hash. The successor flow and archive from P0. Nothing persists between
games server-side today.

**Tom's outline, and the recommended first version.** Thirty lobbies firing every minute is a target
for a large population; the mechanism should be the same at any count, so start with a handful of
**thrones** and let the number be config:

- A **throne** is a persistent public lobby with a name, a schedule and a seat. Its rounds run back to
  back: the lobby opens as soon as a round ends and starts at its interval or when full.
- **The seat.** After a round, the winner (Hegemon or slayer) holds a **reservation** on that throne's
  seat; they have the lobby wait (**30 s**, config) to **pick the map** and confirm they are staying.
  No pick, random map; no confirmation, the seat opens. An **open seat may be claimed** by any
  logged-in player in the lobby (first come); a seat nobody claims goes to the AI (R6). Reservations
  survive a reconnect but not a missed round.
- **Fairness guards, decided up front:** a maximum reign (say five rounds, then the seat opens — or no
  cap, Tom's call); the Hegemon cannot be a bot account (login required); the same account holds at
  most one seat.
- **Identity on screen (S5, F13):** the throne's name and reign count in the lobby and on the Dark Star
  panel; a "Thrones" page with who holds what; per-player reigns and overthrows on the profile; a
  high-score table (most reigns, longest reign) — all read from the archive records P5 keeps.
- **Edge cases:** the Hegemon disconnects (nothing happens: P0's answer), the winner leaves before confirming (seat
  opens), two winners? (impossible: R3 is unambiguous), a round with no challengers (do not start;
  keep the seat), a server restart mid-reign (persist reservations in the database, not memory).
- **Implementation sketch:** a new lobby type `throne` in `MasterLobbyService` with a `ThroneRegistry`
  backed by the API (seat holder, reign count, next map, reservation expiry); `GameServer.start()`
  sets `isHegemon` from the registry; `archiveGame` reports the outcome; the successor lobby is created
  by the master, not by a host. Client: a Thrones tab in the play page, the seat claim button, the map
  pick modal on the win screen.

**Decide.** Throne count at launch; reign cap; whether a timer-win Hegemon must re-confirm each round
or is assumed to stay; whether private lobbies get the same registry (recommended later).

**Done when** three consecutive public rounds on one throne pass the seat correctly with real
accounts, including a winner who walks away.

## P7. Store, cosmetics and payments (L)

**Goal.** Tom's point 6: our own cosmetic offerings and a way to pay for them. Only after P5, and
only if Tom wants monetisation at launch.

**Exists.** Complete client code for a store, inventory, patterns, flags, crowns, skins, effects,
packs, subscriptions and Stripe inline checkout (`Cosmetics.ts`, `Store.ts`, `Payments.ts`,
`StripeInline.ts`, the `Cosmetic*` components) — all driven by the API's `/cosmetics.json` and
`/shop/*` endpoints, none of which exist for us. **No catalogue or priced item ships in the repo**;
`CosmeticSchemas.ts` defines what a catalogue looks like. The Wikimedia flags (CC BY-SA) are the only
cosmetic assets present.

**Work.**

- **The catalogue:** our own patterns, crowns and (later) unit skins, authored to `CosmeticSchemas`;
  a `cosmetics.json` served by our API; entitlements per account.
- **Payments:** Stripe Checkout (hosted page, least compliance surface) or a merchant of record such
  as Paddle or Lemon Squeezy (they handle VAT and sales tax — worth it for a solo studio); webhooks
  into our API to grant entitlements; a soft currency is optional and adds accounting.
- **Legal:** terms of service, privacy policy, refund policy; age handling; the licences of any art we
  sell (our own or commissioned, All Rights Reserved in `branding/`).
- Re-enable the store UI from P1's flag, trimmed to what we sell.

**Decide.** Whether to monetise at all at launch (a free launch with cosmetics later is a legitimate
choice); MoR vs Stripe direct; the first catalogue and prices.

**Decided 2026-10-01.** Free launch; the store and cosmetics come some time after it.

**Done when** a test purchase grants a pattern that shows in a live game and survives logout.

## P8. Public release (M)

**Goal.** Ship. Tom's point 7, second half, plus the design doc's S4.

**Work.**

- **Source disclosure (AGPL):** the public repository (this one, made public, or a mirror), a
  "Source" link in the footer that points at the exact deployed commit (`GIT_COMMIT` is already in
  the build), `LICENSE` kept with the §7 terms, our additions under the same licence.
- **Hosting:** the game server and API on a VPS behind Cloudflare, assets on a CDN bucket
  (`CDN_BASE` is already wired), TLS, backups, a status page; capacity: one worker per core, the
  throne count sized to it.
- **Legal pages:** our own Terms of Service and Privacy Policy (OpenFront's were removed in P1
  step A, with the footer links), linked from the footer again; a contact address for support and
  account deletion.
- **Launch checklist:** P1's grep is clean; `CREDITS.md` complete; the tutorial rewritten for the
  Hegemon rules (the current one teaches OpenFront); the singleplayer modal explains the throne;
  the win screens; a bug-report path (email or Discord of our own); moderation tooling from P5
  reachable by Tom; localisation decision (English only at launch is fine — the other 40 language
  files are Crowdin-generated and full of "OpenFront").
- **Soft launch** with a small throne count and a feedback loop; the balance numbers from M4 are
  expected to move.

**Done when** a stranger can find the site, log in, play a public throne round, and read where the
source is.

## Sequence and sizes

| Phase | Name                                  | Size | Depends on                                        |
| ----- | ------------------------------------- | ---- | ------------------------------------------------- |
| P0    | Close the loop for private play       | M    | — (built 2026-09-27)                              |
| P1    | Strip and rebrand                     | M    | — (A–D, E1 built 2026-09-27; E waits on the logo) |
| P2    | Deep-space map visuals                | M    | P1 (background art)                               |
| P3    | The map pool                          | L    | P2 (palette)                                      |
| P4    | Audio                                 | M    | P1                                                |
| P5    | Identity and the minimal backend      | L    | P1                                                |
| P6    | Matchmaking and the persistent throne | L    | P0, P5                                            |
| P7    | Store and payments                    | L    | P5, P1 (schemas kept)                             |
| P8    | Public release                        | M    | all; P7 optional                                  |

P0 and P1 are independent and can go first in either order; P2–P4 are independent of each other and of
P5–P6, so they can be interleaved with the backend work as Tom's attention allows. The critical path
to a public throne is P1 → P5 → P6 → P8.

**The step-by-step order from 2026-10-01 to the minimum public release is
`docs/DarkStar-Launch.md`** (stages 0–8). It interleaves the remaining phases: thrones T1–T3
before the accounts core, the first deployment before the leaderboard, and the friends playtest as
the final go/no-go gate.

## Open questions for Tom

1. ~~Login: email magic link, Discord, or both? Guests in public rounds?~~ Answered 2026-10-01:
   Discord and Google, email later; guests play and may hold a throne, unrecorded (P5).
2. ~~Throne count at launch and whether a reign is capped.~~ Answered 2026-09-29: 15 thrones, no
   cap, no login needed (`docs/DarkStar-Lobbies.md` L1, L3, L11).
3. ~~Monetise at launch, or free launch and P7 later?~~ Answered 2026-10-01: free launch, P7
   later; accounts and a reign leaderboard are in the launch scope (P5).
4. Hosting preference (a VPS like upstream's Hetzner box, or a PaaS), and who holds the accounts.
   Answered 2026-10-01: one VPS behind Cloudflare's free plan through a named tunnel, for now
   (`docs/DarkStar-Launch.md` stage 0). The provider and the domain are still to choose.
5. Which upstream maps survive (Milky Way and Sol are eligible).
6. The logo, wordmark and font; the soundtrack budget.
7. Whether translations ship at launch (recommendation: English only).
