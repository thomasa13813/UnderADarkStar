# Security

Under a Dark Star is a small game run by one studio, and the code in this
repository is what the live site at <https://darkstar.january-games.com> runs.
If you find a way to break it, cheat with it, or get at something you should
not be able to see, please tell us privately first.

## Reporting a problem

Email **hello@january-games.com** with "Security" in the subject. Please do not
open a public GitHub issue or post in the Discord server for a problem that
could be used against the live site or its players until it is fixed.

Helpful to include:

- What you found and why it matters (what an attacker could do with it).
- Steps to reproduce, or the request, intent or code path involved.
- The build you tested: the version string in the page footer, or the commit.

We will acknowledge the report within a few days, keep you informed as it is
fixed, and credit you in the release notes if you would like. There is no bug
bounty programme.

## Scope

In scope:

- The code in this repository: the game client, the game server, the account
  API, the deploy scripts.
- The live site and its API (`darkstar.january-games.com`,
  `darkstar-api.january-games.com`).

Out of scope, or better reported elsewhere:

- Vulnerabilities in the services the site runs on (Cloudflare, DigitalOcean,
  Discord). Report those to the vendor.
- Volumetric denial of service, rate-limit probing and automated scanning of
  the live site. Please run that kind of test against your own local build
  (`npm run dev`), never against the public server.
- Social engineering of the studio or of players.

When testing, do not access, change or delete other players' data, and stop
and report as soon as you have shown that a problem is real.

## Supported versions

Only the `main` branch, which is what the live site is deployed from. Older
commits are not patched; the footer's Source link names the deployed commit.

## What we do with the code

Secrets are never in this repository (`deploy/env.example` lists the keys the
server needs; the values live only on the server). Dependencies are installed
with `npm ci --ignore-scripts` so a published package cannot run code at
install time. Reports about the practices themselves are as welcome as reports
about the code.
