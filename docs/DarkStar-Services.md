# Under a Dark Star — The Services Behind the Game

> A plain-language guide to every third-party service the game depends on, what each one does
> and how they fit together. Written 2026-10-07, the day the site first went live; cut down to
> the architecture on 2026-10-12, when the repository was prepared for public release. The
> operational half (the server's address and access, which account owns which service, where
> every secret lives, the troubleshooting steps, the costs) is in the private operations doc,
> `docs-private/DarkStar-Operations.md`, which is git-ignored and never published. Companion
> to `DarkStar-Launch.md` (the steps to release) and `DarkStar-Accounts.md` (the account
> system's design).

## 1. The map

One rented computer runs the whole game. Everything else is a service that stands in front of
it, hands it secrets, or sends it code.

```
  Player's browser
        │  https://darkstar.january-games.com   (and darkstar-api.january-games.com)
        ▼
  ┌─────────────────────────── Cloudflare ────────────────────────────┐
  │ owns the domain · answers DNS · holds the https certificate       │
  │ Turnstile: "is this a real person?" check on every join           │
  │ Tunnel: a private pipe from Cloudflare down into our server       │
  │ Email Routing: hello@january-games.com → the studio mailbox       │
  └───────────────────────────────┬───────────────────────────────────┘
                                  │  the tunnel (outbound from the server, nothing inbound)
                                  ▼
  ┌──────────────────────── the game server (VPS) ────────────────────┐
  │ Ubuntu · Docker                                                   │
  │                                                                   │
  │  container "cloudflared"  ──── keeps the tunnel open              │
  │  container "game"                                                 │
  │     nginx :80 ─┬─► game server (master :3000, workers :3001…)     │
  │                └─► account API :8787 ──► SQLite on volume /data   │
  │                        │                                          │
  │                        ├──► Discord (sign-in: "who is this?")     │
  │                        └──► Cloudflare Turnstile (verify a join)  │
  └───────────────────────────────▲───────────────────────────────────┘
                                  │  git pull
                            GitHub (the code)
```

Beside the game: the **Discord server** where players report bugs, and the studio mailbox,
which receives `hello@`.

## 2. The services, one by one

### 2.1 Cloudflare

The front door. Four jobs under one account.

| Job               | What it does                                                                                                                                                        | Where in the dashboard                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Registrar and DNS | Owns `january-games.com` (bought 2026-10-06) and answers "which address is this name?" for the game and the API hostnames. The free certificate makes the `https`.  | Domain Registration; DNS → Records        |
| Tunnel            | A connection the server opens _outward_ to Cloudflare. Players' requests ride down it. Nothing on the server listens to the internet except SSH.                    | Zero Trust → Networks → Tunnels           |
| Turnstile         | The bot check. The page asks Cloudflare for a one-time token when a player joins; our API confirms it with Cloudflare using the secret key.                         | Turnstile → widget "Under a Dark Star"    |
| Email Routing     | Forwards `hello@january-games.com` to the studio mailbox. No mailbox of its own; replies go out through the mail client's "Send mail as".                           | Email → Email Routing                     |
| Web Analytics     | Counts visits: page views, referring sites, countries, devices, load times. Cookieless; Cloudflare adds its beacon to our HTML pages at the edge (automatic setup). | Observability → Analytics → Web analytics |
| R2 (backups)      | Holds the nightly backup of the account database and signing key, thirty nights deep, in a private bucket. Free tier; see "Nightly backups" below.                  | Storage & databases → R2 Object Storage   |

- **If it is down:** the whole site is unreachable, since every request passes through it. Rare;
  check <https://www.cloudflarestatus.com>.
- **Gotcha:** the free certificate covers `january-games.com` and names _one_ level below it.
  That is why the API is `darkstar-api.january-games.com` and not `api.darkstar.…`.

**Web Analytics.** Nothing to set up: Cloudflare created it with automatic setup when the domain
was added (about 2026-10-06), and it has run since. The repository holds no script and no token;
Cloudflare adds its beacon to every HTML page as it passes through. As seen on 2026-10-25:

- **Seeing the numbers.** In the dashboard's left sidebar, **Observability → Analytics → Web
  analytics**. One site card, `january-games.com`, labelled _Automatic setup_, shows page views
  and visits for the last 24 hours. Click the site name (or **View Web Analytics for all
  sites**) for the full charts: visits, page views, top pages, referrers, countries, browsers,
  devices and load times, over a chosen period.
- **The setting.** **Manage site** on the card shows _Configured hostname(s):
  january-games.com_ and four choices under _Real User Measurements (RUM)_. Ours is **Enable,
  excluding visitor data in the EU** (Cloudflare's default, kept by Tom 2026-10-25): visitors from the EU get no beacon
  and are not counted. **Enable** would count them too; the Privacy Policy covers either. The
  other two (manual snippet, Disable) are not wanted. Press **Update** only after changing it.
- **Checking it works.** On `https://darkstar.january-games.com/`, view the page source (Ctrl+U)
  and look for `static.cloudflareinsights.com/beacon.min.js` near the end (absent from an EU
  connection). Checked 2026-10-25 on the home page, the wiki and the Privacy Policy.

What it measures: each page load, including the wiki, the Terms and the Privacy Policy. The
game itself is one page, so it shows how many arrive, where from, and how many leave without a
second page, not where they leave inside a round. Nothing in the game's code depends on it.

**Nightly backups (R2).** The account API uploads its database and signing key every night at
09:00 UTC (Accounts doc §12.10) to a private bucket. Free: R2 gives 10 GB of storage, a million
writes and ten million reads a month at no charge; thirty nights of two small files use a few
megabytes and about 60 writes. As set up on 2026-10-25:

- **R2 itself**: **Storage & databases → R2 Object Storage**. The first visit offered **Add R2
  subscription to my account** ($0.00 due, the card on file charged only above the free
  limits); Tom added it.
- **The bucket**: `darkstar-backups`, location Automatic (Eastern North America), default storage
  class **Standard**. Never pick Infrequent Access: it has no free allowance. Public access is
  off, and must stay off (the backups hold the signing key).
- **The 30-day rule**: the bucket's **Settings → Object Lifecycle Rules**: rule
  `delete-after-30-days`, prefix `nightly/`, **Delete uploaded objects after 30 Days**. Leave
  "Transition objects to Infrequent Access" unticked. The default multipart rule stays too.
- **The access key** (Tom, once): R2 Object Storage overview → **Manage API Tokens** → **Create
  Account API token**. Token name `darkstar-backup`; Permissions **Object Read & Write**;
  Specify bucket(s) **Apply to specific buckets only** → `darkstar-backups`; TTL **Forever**; no IP
  filtering (the restore drill runs from the PC). **Create Account API Token**. The next page
  shows the secret once: copy **Access Key ID** into `R2_ACCESS_KEY_ID` and **Secret Access Key**
  into `R2_SECRET_ACCESS_KEY` in the root `.env`. The token value and the endpoint on that page
  are not needed. `R2_ACCOUNT_ID` (shown on the R2 overview under Account Details) and
  `R2_BUCKET=darkstar-backups` are already there.
- **Check the key from the PC**: `npm run api:backup -- list` prints `(no backups)` (or the
  nights). A `403 SignatureDoesNotMatch` means the secret is wrong: the Secret Access Key is 64
  characters, the Access Key ID 32. If the secret was lost (it is shown once), the token's
  **⋯ → Roll** on Manage API Tokens issues a new one; copy both keys from the page it shows.
- **To the server**: push the env (the private operations doc's helper), deploy, then take the
  first backup by hand with `api:backup -- now` (operations doc §6a). The API log then says
  `nightly backup at 9:00 UTC to R2` at every start.
- **The restore drill** (from the PC, the live server untouched): `npm run api:backup -- fetch
latest .restore-drill` prints `integrity: ok` and the account and round counts, which should
  match the live board. Delete the folder afterwards (it holds the signing key).
- **Keeping it free**: the R2 overview's Billing Dashboard shows the month's billable usage
  ($0.00 so far) and offers **Add Budget Alert**, an email if charges ever start. The API also
  logs a warning if one night's backup passes 300 MB.

### 2.2 The server

One virtual private server (a DigitalOcean Droplet) running Docker on Ubuntu. Two cores are
plenty: the simulation runs in the players' browsers, so the server mostly relays, and resizing
is a few clicks if a launch day needs it.

- **Holds:** the running containers, the code checkout at `/opt/darkstar/repo`, the environment
  file `/opt/darkstar/.env` (every production secret, §4), and the Docker volume
  `deploy_darkstar-data`: the account database `darkstar.sqlite` and the token signing key
  `signing-key.json`. **That volume is the one thing on this machine that cannot be rebuilt
  from elsewhere** until backups exist (Accounts doc §10, planned at B6).
- **Reaches the internet only outward:** the firewall allows SSH alone, rate-limited; players
  arrive through the tunnel.
- **If it is down:** the site is down. The provider's web console can reboot it even when SSH
  cannot reach it.

### 2.3 GitHub

Where the code lives: <https://github.com/thomasa13813/UnderADarkStar>, a fork of OpenFront.io.

- **How the server gets the code:** the deploy script (`deploy/deploy.sh`) pulls the branch
  named by `DEPLOY_BRANCH` in the server's env file, builds the image, and restarts the game.
- **Licence note:** the game is AGPL. The footer's Source link points at this repository at the
  deployed commit, so the repository must be public whenever strangers can play (Launch doc,
  Stage 6 licence items).
- **Workflows:** only `ci.yml` (build, tests, lint on pushes and pull requests) lives under
  `.github/workflows/`.

### 2.4 Discord

Two unrelated things under one account.

| Thing                 | What it does                                                                                                                                                                                          | Where                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Developer application | "Sign in with Discord". Discord tells our API who the player is (their Discord user id and display name, nothing else: scope `identify`). Needs a client ID (public) and a secret.                    | <https://discord.com/developers> → application "Under a Dark Star" |
| Community server      | Where players report bugs and talk. Five channels: welcome, announcements, general, bug-reports, suggestions. Invite: <https://discord.gg/RWZWsxzhB3> (permanent, to the welcome channel; 2026-10-25) | The Discord app                                                    |

- **The redirects** (OAuth2 page): `http://localhost:8787/auth/callback/discord` for development
  and `https://darkstar-api.january-games.com/auth/callback/discord` for production. A sign-in
  fails with a Discord error page if the API's address ever changes and this list is not updated.
- **If Discord is down:** sign-in fails; guests still play. Sessions already signed in keep
  working (they refresh against our own API, not Discord).

### 2.5 Google

A Google Cloud OAuth client for "Sign in with Google" (Launch doc, Stage 6). Google tells our API
who the player is: their Google account ID (`sub`) and name, nothing else (scopes `openid
profile`; never `email`). That is exactly what the Privacy Policy (§6 of `privacy.html`) promises,
so the scopes must never grow without the policy changing first. Needs a client ID (public) and a
secret. The code is built (Accounts doc §12.7) and **live in production since 2026-10-18**.

- **The redirects** (Authorized redirect URIs on the OAuth client):
  `http://localhost:8787/auth/callback/google` for development and
  `https://darkstar-api.january-games.com/auth/callback/google` for production. As with Discord,
  a sign-in fails with a Google error page (`redirect_uri_mismatch`) if the API's address changes
  and this list is not updated. No "Authorized JavaScript origins" are needed: the browser never
  talks to Google's scripts, only the API does.
- **Test mode.** Until Google approves the app, only the test users listed on the client can sign
  in. Google requires the privacy policy to be public on a verified domain before the app can be
  published. While in test mode, leave the keys off the production server (so players never see a
  button that refuses them) and try it in dev.
- **If Google is down:** as Discord: sign-in with Google fails; guests and signed-in sessions
  carry on.

**Setting it up (Tom, in a browser, once).** Google renames these pages from time to time; the
names below are those of the "Google Auth Platform" menu.

1. Open <https://console.cloud.google.com/>, signed in with the Google account that should own
   the app. At the top, click the project picker → **New project**. Name: `Under a Dark Star`.
   **Create**, then make sure the new project is selected in the picker.
2. Open <https://console.cloud.google.com/auth/overview> and click **Get started**.
   - App name: `Under a Dark Star`. User support email: `hello@january-games.com` (if the list
     offers only your own address, pick it here and change it later under **Branding**).
   - Audience: **External**.
   - Contact information: `hello@january-games.com`. Agree to the policy, **Create**.
3. **Branding** (left menu). Fill in, then **Save**:
   - App home page: `https://darkstar.january-games.com`
   - Privacy policy: `https://darkstar.january-games.com/privacy.html`
   - Terms of service: `https://darkstar.january-games.com/terms.html`
   - Authorized domains: **Add domain** → `january-games.com`
4. **Data access** (left menu) → **Add or remove scopes**. Tick exactly two: `openid` and
   `.../auth/userinfo.profile`. Leave `.../auth/userinfo.email` **unticked**. **Update**, then
   **Save**.
5. **Audience** (left menu). Leave Publishing status on **Testing**. Under **Test users** →
   **Add users**, add your own Google address (and any friend who will try it). **Save**.
6. **Clients** (left menu) → **Create client**.
   - Application type: **Web application**. Name: `DarkStar API`.
   - Authorized JavaScript origins: leave empty.
   - Authorized redirect URIs: **Add URI** twice and paste
     `http://localhost:8787/auth/callback/google` and
     `https://darkstar-api.january-games.com/auth/callback/google`.
   - **Create**. A box shows the **Client ID** and **Client secret**. Click **Download JSON** and
     keep the file somewhere private (Google may not show the secret again).
7. On your PC, open the root `.env` of the repository (git-ignored; never the committed
   `deploy/env.example`) and add two lines, pasting the values from that box after the `=`, with
   no spaces or quotes:

   ```text
   GOOGLE_CLIENT_ID=
   GOOGLE_CLIENT_SECRET=
   ```

   Restart `npm run dev`; the account menu now shows **Google** under Discord.

8. **Going live** (after the privacy policy is deployed): **Audience** → **Publish app**, and
   ask Google for brand verification if it offers it. Only `openid profile` are asked for, which
   Google counts as non-sensitive, so no security review is needed. Then push the keys to the
   server with `deploy/push-env.sh` (the exact command is in the private operations doc) and
   redeploy.

### 2.6 Quiet dependencies

Things nobody signed up for that the build still needs.

- **Docker Hub** supplies the base images: `node:24-slim` (the game) and
  `cloudflare/cloudflared` (the tunnel). Pulled during a deploy; an outage delays a deploy, not
  the running game.
- **npm registry** supplies the JavaScript packages at build time. Same: deploys only.
- **Cloudflare's Turnstile script** (`challenges.cloudflare.com`) loads in every player's browser.
- **Cloudflare's Web Analytics beacon** (`static.cloudflareinsights.com`), added at the edge
  (§2.1). If it is blocked or down, only the visit counts suffer.

### 2.7 Planned, not yet in use

- **Backups** of the account database and signing key, nightly, to Cloudflare R2: built
  2026-10-25 (§2.1, "Nightly backups"), running once the R2 keys reach the server. Until then,
  §2.2's volume is a single point of loss.
- ~~**Google sign-in**~~ live since 2026-10-18 (§2.5).
- ~~**An uptime check**~~ in place since 2026-10-12 (UptimeRobot, both health endpoints).
- **itch.io** listing (open question, Launch doc §6).

## 3. How they work together

Four stories, each a chain of services.

**A page load.** The browser asks DNS for `darkstar.january-games.com` → Cloudflare answers with
its own addresses → the request arrives at Cloudflare, which forwards it down the tunnel → the
`cloudflared` container hands it to nginx in the `game` container → nginx serves the page from
the game server. The page carries its settings (which environment, the API's address, the
Turnstile site key) injected by the server at that moment.

**A sign-in.** Sign in → Discord: the browser goes to our API's login route → the API sends it to
Discord with a one-time state value → the player approves → Discord sends the browser back to the
API's callback with a code → the API exchanges the code for the player's Discord id (server to
server, with the client secret) → finds or creates the account → sets the refresh cookie → sends
the browser back to the page. From then on the page calls the API every fifteen minutes for a
fresh token; Discord is not involved again.

**A join.** The player clicks a lobby → the page asks Cloudflare Turnstile for a token (usually
invisibly; sometimes a checkbox) → the game server receives the join with the token → asks our
API to verify it → the API asks Cloudflare with the secret key and runs the name filter → the
player is admitted under their account name or, as a guest, under `Anon` plus five digits.

**A deploy.** One SSH command → the script on the server pulls the branch from GitHub → Docker
builds the image (about six minutes) → the game container restarts with the new image (the
tunnel container keeps running, so the site never drops) → the script waits for the health
check → old images are pruned.

## 4. The secrets

A secret is anything that lets someone act as us. None is in this repository; `deploy/env.example`
lists the keys the server needs and `deploy/push-env.sh` writes them to the server from a
developer's git-ignored `.env`. Each exists only at its source (the dashboard or portal that
issued it) and in the server's environment file; the token signing key exists only on the
server's data volume and in the nightly backups (§2.1, a private R2 bucket). Which ones there are:

| Secret                | What it unlocks                               |
| --------------------- | --------------------------------------------- |
| Discord client secret | Pretending to be our sign-in                  |
| Google client secret  | Pretending to be our sign-in                  |
| Turnstile secret key  | Forging "this join passed the bot check"      |
| Tunnel token          | Attaching a different server to our hostnames |
| `API_KEY`             | Calling the API as the game server            |
| Token signing key     | Minting login tokens for any account          |
| R2 secret access key  | Reading the backups (accounts, signing key)   |

Public, not secret: the Discord and Google client IDs, the Turnstile site key and the tunnel's name. If a
secret may have leaked, rotate it first and investigate second; the rotation steps are in the
private operations doc.

## 5. Changelog

- **2026-10-25, later** — §2.1's Web Analytics rewritten from the dashboard itself: it was
  already on (automatic setup since the domain was added, EU visitors excluded), so the setup
  steps became where to read the numbers and what the setting is. The revised Privacy Policy is
  live; the earlier version said the site used no analytics while this ran.
- **2026-10-25** — Cloudflare Web Analytics added to §2.1 (Tom's choice): automatic setup from the
  dashboard, steps and limits; the Privacy Policy describes it. §2.7 brought up to date (Google
  sign-in and the uptime check are live).
- **2026-10-17** — §2.5 Google filled in: the provider is built (off until its keys are set),
  the scopes, the redirect URIs and the step-by-step Google Cloud setup.

- **2026-10-12** — Cut down to the architecture for the public repository. The server's address
  and access, account ownership, the secrets' locations, the troubleshooting runbook and the
  costs moved to `docs-private/DarkStar-Operations.md` (git-ignored).
- **2026-10-07** — Created, the day the site first went live.
