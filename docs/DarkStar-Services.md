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

| Job               | What it does                                                                                                                                                       | Where in the dashboard                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Registrar and DNS | Owns `january-games.com` (bought 2026-10-06) and answers "which address is this name?" for the game and the API hostnames. The free certificate makes the `https`. | Domain Registration; DNS → Records     |
| Tunnel            | A connection the server opens _outward_ to Cloudflare. Players' requests ride down it. Nothing on the server listens to the internet except SSH.                   | Zero Trust → Networks → Tunnels        |
| Turnstile         | The bot check. The page asks Cloudflare for a one-time token when a player joins; our API confirms it with Cloudflare using the secret key.                        | Turnstile → widget "Under a Dark Star" |
| Email Routing     | Forwards `hello@january-games.com` to the studio mailbox. No mailbox of its own; replies go out through the mail client's "Send mail as".                          | Email → Email Routing                  |

- **If it is down:** the whole site is unreachable, since every request passes through it. Rare;
  check <https://www.cloudflarestatus.com>.
- **Gotcha:** the free certificate covers `january-games.com` and names _one_ level below it.
  That is why the API is `darkstar-api.january-games.com` and not `api.darkstar.…`.

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

| Thing                 | What it does                                                                                                                                                                       | Where                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Developer application | "Sign in with Discord". Discord tells our API who the player is (their Discord user id and display name, nothing else: scope `identify`). Needs a client ID (public) and a secret. | <https://discord.com/developers> → application "Under a Dark Star" |
| Community server      | Where players report bugs and talk. Five channels: welcome, announcements, general, bug-reports, suggestions. Invite: <https://discord.gg/vTjcPKadD>                               | The Discord app                                                    |

- **The redirects** (OAuth2 page): `http://localhost:8787/auth/callback/discord` for development
  and `https://darkstar-api.january-games.com/auth/callback/discord` for production. A sign-in
  fails with a Discord error page if the API's address ever changes and this list is not updated.
- **If Discord is down:** sign-in fails; guests still play. Sessions already signed in keep
  working (they refresh against our own API, not Discord).

### 2.5 Google

- **Later:** a Google Cloud OAuth client for "Sign in with Google" (Launch doc, Stage 6). Google
  requires a public privacy policy on a verified domain before that can leave test mode.

### 2.6 Quiet dependencies

Things nobody signed up for that the build still needs.

- **Docker Hub** supplies the base images: `node:24-slim` (the game) and
  `cloudflare/cloudflared` (the tunnel). Pulled during a deploy; an outage delays a deploy, not
  the running game.
- **npm registry** supplies the JavaScript packages at build time. Same: deploys only.
- **Cloudflare's Turnstile script** (`challenges.cloudflare.com`) loads in every player's browser.

### 2.7 Planned, not yet in use

- **Backups** of the account database and signing key, nightly, off the server (Cloudflare R2 or
  similar). Accounts doc §10, step B6. Until then, §2.2's volume is a single point of loss.
- **Google sign-in** (Stage 6, after the privacy policy).
- **An uptime check** on `/api/health` and the API's `/health` (Stage 6).
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
server's data volume. Which ones there are:

| Secret                | What it unlocks                               |
| --------------------- | --------------------------------------------- |
| Discord client secret | Pretending to be our sign-in                  |
| Turnstile secret key  | Forging "this join passed the bot check"      |
| Tunnel token          | Attaching a different server to our hostnames |
| `API_KEY`             | Calling the API as the game server            |
| Token signing key     | Minting login tokens for any account          |

Public, not secret: the Discord client ID, the Turnstile site key and the tunnel's name. If a
secret may have leaked, rotate it first and investigate second; the rotation steps are in the
private operations doc.

## 5. Changelog

- **2026-10-12** — Cut down to the architecture for the public repository. The server's address
  and access, account ownership, the secrets' locations, the troubleshooting runbook and the
  costs moved to `docs-private/DarkStar-Operations.md` (git-ignored).
- **2026-10-07** — Created, the day the site first went live.
