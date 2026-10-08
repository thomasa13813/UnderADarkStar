# Under a Dark Star — The Services Behind the Game

> A plain-language guide to every third-party service the game depends on, who owns each
> account, what each one holds, how they fit together, and what to do when one misbehaves. A
> living document: add a row when a service joins, strike it when one leaves, and keep §7's
> changelog. Written 2026-10-07, the day the site first went live. Companion to
> `DarkStar-Launch.md` (the steps to release) and `DarkStar-Accounts.md` (the account system's
> design).

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
  │ Email Routing: hello@january-games.com → a mailbox outside the domain              │
  └───────────────────────────────┬───────────────────────────────────┘
                                  │  the tunnel (outbound from the server, nothing inbound)
                                  ▼
  ┌──────────────────── DigitalOcean server "darkstar" ───────────────┐
  │ Ubuntu 22.04 · Docker · 2 cores · 4 GB · New York                 │
  │                                                                   │
  │  container "cloudflared"  ──── keeps the tunnel open              │
  │  container "game"                                                 │
  │     nginx :80 ─┬─► game server (master :3000, workers :3001…)     │
  │                └─► account API :8787 ──► SQLite on volume /data   │
  │                        │                                          │
  │                        ├──► Discord (sign-in: "who is this?")     │
  │                        └──► Cloudflare Turnstile (verify a join)  │
  └───────────────────────────────▲───────────────────────────────────┘
                                  │  git pull over SSH with a deploy key
                            GitHub (the code)
```

Beside the game: the **Discord server** where players report bugs, and **Gmail**, which receives
`hello@`.

## 2. The services, one by one

Each entry answers the same questions: what it does for us, which login owns it, what it costs,
what it holds that we would miss, and where to look when it breaks.

### 2.1 Cloudflare

The front door. Four jobs under one account.

| Job               | What it does                                                                                                                                                       | Where in the dashboard                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- |
| Registrar and DNS | Owns `january-games.com` (bought 2026-10-06) and answers "which address is this name?" for the game and the API hostnames. The free certificate makes the `https`. | Domain Registration; DNS → Records     |
| Tunnel            | A connection the server opens _outward_ to Cloudflare. Players' requests ride down it. Nothing on the server listens to the internet except SSH.                   | Zero Trust → Networks → Tunnels        |
| Turnstile         | The bot check. The page asks Cloudflare for a one-time token when a player joins; our API confirms it with Cloudflare using the secret key.                        | Turnstile → widget "Under a Dark Star" |
| Email Routing     | Forwards `hello@january-games.com` to a mailbox outside the domain. No mailbox; replies go out through Gmail's "Send mail as".                                                      | Email → Email Routing                  |

- **Account:** an address outside the domain. Deliberate: if it were on an address _at_ the domain, a
  lockout would also cut off the recovery mail.
- **Cost:** the domain's yearly fee at cost. Everything else is on the free plan.
- **Holds:** the tunnel's token (also in the server's env file), the Turnstile site key (public)
  and secret key, the DNS records, the hostname list the Turnstile widget accepts
  (`127.0.0.1`, `localhost`, `january-games.com`, `darkstar.january-games.com`).
- **If it is down:** the whole site is unreachable, since every request passes through it. Rare;
  check <https://www.cloudflarestatus.com>.
- **Gotcha:** the free certificate covers `january-games.com` and names _one_ level below it.
  That is why the API is `darkstar-api.january-games.com` and not `api.darkstar.…`.

### 2.2 DigitalOcean

The one computer the game runs on. They call it a Droplet; ours is named `darkstar`.

- **What:** Ubuntu 22.04 with Docker preinstalled, 2 cores, 4 GB memory, 80 GB disk, New York
  (NYC1), IP `<server>`. A 2 GB swap file was added because building the game's image
  peaks above 4 GB.
- **Account:** a studio-controlled Google account (not `hello@`; a departure from the rule in §5,
  harmless for now).
- **Cost:** $28 a month, billed hourly. Resizing to 4 cores / 8 GB is a few clicks if a launch
  day needs it; the simulation runs in the players' browsers, so the server mostly relays.
- **Access:** SSH as `root` with the key file `~/.ssh/<key>`. The firewall
  (ufw) allows SSH only, rate-limited to six connections per thirty seconds.
- **Holds:** the running containers, the code checkout at `/opt/darkstar/repo`, the environment
  file `/opt/darkstar/.env` (every production secret, §4), and the Docker volume
  `deploy_darkstar-data`: the account database `darkstar.sqlite` and the token signing key
  `signing-key.json`. **That volume is the one thing on this machine that cannot be rebuilt
  from elsewhere** until backups exist (Accounts doc §10, planned at B6).
- **If it is down:** the site is down. DigitalOcean's console (the web page) can reboot it even
  when SSH cannot reach it.

### 2.3 GitHub

Where the code lives: <https://github.com/thomasa13813/UnderADarkStar>, a fork of OpenFront.io,
private at the moment.

- **Account:** Tom's GitHub account `thomasa13813`.
- **Cost:** free.
- **How the server gets the code:** a read-only _deploy key_ named "darkstar server" is registered
  on the repository; its private half lives on the server at `/root/.ssh/darkstar_deploy`. The
  deploy script (`deploy/deploy.sh`) pulls the branch named by `DEPLOY_BRANCH` in the server's
  env file, builds the image, and restarts the game.
- **Licence note:** the game is AGPL. The footer's Source link points at this repository, so it
  will have to be public by the time strangers can play (Launch doc, Stage 6 licence items).
- **Workflows:** only `ci.yml` (build and tests on pushes) should remain under
  `.github/workflows/`; the rest targeted OpenFront's own infrastructure.

### 2.4 Discord

Two unrelated things under one account.

| Thing                 | What it does                                                                                                                                                                              | Where                                                              |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Developer application | "Sign in with Discord". Discord tells our API who the player is (their Discord user id and display name, nothing else: scope `identify`). Needs a client ID (public) and a secret.        | <https://discord.com/developers> → application "Under a Dark Star" |
| Community server      | Where players report bugs and talk. Five channels: welcome, announcements, general, bug-reports, suggestions. Roles and permissions still default. Invite: <https://discord.gg/vTjcPKadD> | The Discord app                                                    |

- **Account:** `hello@january-games.com`. Two-factor authentication should be on; this account
  owns the application whose secret lets anyone impersonate our sign-in.
- **Cost:** free.
- **The redirects** (OAuth2 page): `http://localhost:8787/auth/callback/discord` for development
  and `https://darkstar-api.january-games.com/auth/callback/discord` for production. A sign-in
  fails with a Discord error page if the API's address ever changes and this list is not updated.
- **If Discord is down:** sign-in fails; guests still play. Sessions already signed in keep
  working (they refresh against our own API, not Discord).

### 2.5 Google (Gmail)

- **What:** the destination of `hello@january-games.com` through Cloudflare's forwarding, and
  the owner of the Cloudflare and DigitalOcean accounts.
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

Listed so the picture is complete; each gets a full entry when it arrives.

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

**A deploy.** You run one SSH command → the script on the server pulls the branch from GitHub
with the deploy key → Docker builds the image (about six minutes) → the game container restarts
with the new image (the tunnel container keeps running, so the site never drops) → the script
waits for the health check → old images are pruned.

## 4. The secrets, and where each one lives

A secret is anything that lets someone act as us. Each should exist in exactly the places listed,
and nowhere else: not in chat, not in the repository, not in a screenshot.

| Secret                          | What it unlocks                               | Lives in                                                                  |
| ------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------- |
| Discord client secret           | Pretending to be our sign-in                  | Discord developer portal; Tom's local `.env`; server `/opt/darkstar/.env` |
| Turnstile secret key            | Forging "this join passed the bot check"      | Cloudflare dashboard; Tom's local `.env`; server env                      |
| Tunnel token                    | Attaching a different server to our hostnames | Cloudflare dashboard; Tom's local `.env`; server env                      |
| `API_KEY`                       | Calling the API as the game server            | Server env only (generated by `deploy/push-env.sh`)                       |
| Token signing key               | Minting login tokens for any account          | Server volume `/data/signing-key.json` only                               |
| SSH key `<key>` | Full control of the server                    | Tom's PC, `~/.ssh/`                                                       |
| Deploy key `darkstar_deploy`    | Reading the private repository                | Server, `/root/.ssh/`; public half registered on GitHub                   |
| Account passwords and 2FA       | Everything above                              | Tom's password manager                                                    |

Public, not secret: the Discord client ID, the Turnstile site key, the server's IP address, the
tunnel's name.

**To rotate one:** change it at its source (the dashboard or portal), update Tom's local `.env`,
run `sh deploy/push-env.sh root@<server> ~/.ssh/<key>` to rewrite the
server's env file, then run the deploy command so the containers restart with it. The pusher keeps
the existing `API_KEY` unless the file is removed first. If a secret may have leaked, rotate it
first and investigate second.

## 5. Who owns what

The rule from 2026-10-06: studio services live on `hello@january-games.com`, so they belong to
January Games rather than to a person; the Cloudflare account is the one exception, kept on the
personal Gmail so a domain problem cannot lock out its own recovery mail.

| Service                | Login                         | Fits the rule?                                   |
| ---------------------- | ----------------------------- | ------------------------------------------------ |
| Cloudflare             | an address outside the domain          | Yes (the designed exception)                     |
| DigitalOcean           | a studio-controlled Google account | No. Move to `hello@` when convenient, or accept. |
| GitHub                 | `thomasa13813`                | Personal; fine while one person develops.        |
| Discord (app + server) | `hello@january-games.com`     | Yes                                              |
| Google Cloud (later)   | `hello@january-games.com`     | Planned                                          |

Two-factor authentication belongs on every one of these.

## 6. When something is wrong

Start at the top; each step tells you which service to suspect.

1. **Does <https://www.cloudflarestatus.com> show trouble?** If so, wait.
2. **Does `https://darkstar-api.january-games.com/health` answer `{"status":"ok"}`?** If the page
   is down but this answers, the problem is in the game container, not the tunnel.
3. **Does `https://darkstar.january-games.com/api/health` answer?** That is the game server
   through nginx and the tunnel.
4. **Can you SSH in?** `ssh -i ~/.ssh/<key> root@<server>`. A timeout
   usually means the six-per-thirty-seconds limit; wait and retry. If SSH is truly dead, reboot
   from the DigitalOcean console.
5. **On the server:**
   - `docker ps` should list `deploy-game-1 (healthy)` and `deploy-cloudflared-1`.
   - `docker logs --tail 100 deploy-game-1` for the game and the API; `docker logs --tail 50
deploy-cloudflared-1` for the tunnel ("Registered tunnel connection" is good).
   - `docker compose -f /opt/darkstar/repo/deploy/docker-compose.yml --env-file /opt/darkstar/.env restart`
     restarts both containers without rebuilding.
   - `/opt/darkstar/repo/deploy/deploy.sh` rebuilds and redeploys the current branch.
   - `free -m` and `df -h /` for memory and disk.
6. **Sign-in fails but the game works:** Discord's status page, then the redirect list in the
   Discord application (§2.4), then the API log for "sign-in did not complete".
7. **Nobody can join but the page loads:** Turnstile. Check the widget's hostname list (§2.1) and
   the API log for "join refused by Turnstile".

The deploy command, for reference:

```
ssh -i ~/.ssh/<key> root@<server> /opt/darkstar/repo/deploy/deploy.sh
```

## 7. Costs

| Item                 | Cost             | Billed               |
| -------------------- | ---------------- | -------------------- |
| Domain               | about $10 a year | Cloudflare, yearly   |
| DigitalOcean Droplet | $28 a month      | Monthly, by the hour |
| Everything else      | $0               |                      |

About $350 a year at today's shape.

## 8. Changelog

- **2026-10-07** — Created on the day of the first deployment, from the Launch doc's steps H1–H5
  and the Accounts doc's §11. Services in use: Cloudflare (registrar, DNS, tunnel, Turnstile,
  Email Routing), DigitalOcean, GitHub, Discord (application and server), Gmail; planned:
  backups, Google sign-in, uptime check, itch.io.
