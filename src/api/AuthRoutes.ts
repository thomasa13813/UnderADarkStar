import { randomBytes } from "crypto";
import { Express, Response } from "express";
import { DatabaseSync } from "node:sqlite";
import { uuidToBase64url } from "../core/Base64";
import {
  accountById,
  accountProvider,
  findOrCreateAccount,
  ProviderIdentity,
  tokenRole,
  userMeResponse,
} from "./Accounts";
import { BearerVerifier } from "./Bearer";
import { allowedOrigin, ApiConfig, issuerFor } from "./Config";
import { SigningKey, signToken } from "./Keys";
import { FetchLike, providersFor } from "./Providers";
import { statsFor } from "./Results";
import {
  clearedRefreshCookieHeader,
  cookieHeader,
  createSession,
  parseCookies,
  REFRESH_COOKIE,
  refreshCookieHeader,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  sessionAccount,
} from "./Sessions";

// Under a Dark Star: sign-in, sessions and the account's own view
// (docs/DarkStar-Accounts.md §4.2, §4.3, §7). The browser is sent to the
// provider from /auth/login, comes back to /auth/callback with a code, and
// leaves with the refresh cookie; the page then calls POST /auth/refresh
// (Auth.ts does this today) for a 15-minute token. /users/@me is what the
// client and the game server read with that token.

export const TOKEN_TTL_SECONDS = 15 * 60;
export const STATE_COOKIE = "ds_oauth";
const STATE_TTL_SECONDS = 10 * 60;
// Appended to the page's URL when a sign-in did not complete, so the page
// can say so; nothing else is told.
export const SIGN_IN_FAILED_FRAGMENT = "#signin=failed";

export interface AuthDeps {
  config: ApiConfig;
  db: DatabaseSync;
  key: SigningKey;
  log: Pick<Console, "info" | "warn" | "error">;
  fetch?: FetchLike;
  // The clock, replaceable so tests can expire a session.
  now?: () => number;
}

export function mountAuthRoutes(app: Express, deps: AuthDeps): void {
  const { config, db, key, log } = deps;
  const now = deps.now ?? (() => Date.now());
  const providers = providersFor(
    config,
    deps.fetch ?? ((input, init) => fetch(input, init)),
  );
  const issuer = issuerFor(config);
  const audience = config.domain;
  const bearer = new BearerVerifier(key, config);

  const callbackUri = (provider: string) =>
    `${issuer}/auth/callback/${provider}`;

  // Where to send the browser after sign-in: the login link's `redirect`
  // when it is on our site, else the page. A stranger's URL is never used,
  // so this cannot be turned into an open redirect.
  const safeRedirect = (raw: unknown): string => {
    if (typeof raw !== "string" || raw === "") return config.siteOrigin;
    try {
      const url = new URL(raw);
      return allowedOrigin(config, url.origin)
        ? url.toString()
        : config.siteOrigin;
    } catch {
      return config.siteOrigin;
    }
  };

  const finishSignIn = (
    res: Response,
    identity: ProviderIdentity,
    redirectTo: string,
  ) => {
    const { account, created } = findOrCreateAccount(db, identity, now());
    log.info(
      `${created ? "new" : "returning"} account via ${identity.provider}: ${account.public_id}`,
    );
    const cookie = createSession(db, account.id, now());
    res.append("Set-Cookie", refreshCookieHeader(config, cookie));
    res.redirect(302, redirectTo);
  };

  const failSignIn = (res: Response, redirectTo: string, why: string) => {
    log.warn(`sign-in did not complete: ${why}`);
    res.append("Set-Cookie", cookieHeader(config, STATE_COOKIE, "", 0));
    res.redirect(302, redirectTo + SIGN_IN_FAILED_FRAGMENT);
  };

  app.get("/auth/login/:provider", async (req, res, next) => {
    try {
      const provider = providers.get(String(req.params.provider));
      if (provider === undefined) {
        res.status(404).json({ error: "unknown provider" });
        return;
      }
      const redirectTo = safeRedirect(req.query.redirect);
      const redirectUri = callbackUri(provider.name);
      const state = randomBytes(16).toString("base64url");
      const url = provider.authorizeUrl({
        state,
        redirectUri,
        query: req.query as Record<string, unknown>,
      });
      if (url === null) {
        // Dev: nothing to visit. The name in the link is the whole sign-in.
        const name = typeof req.query.name === "string" ? req.query.name : "";
        const identity = await provider.complete({ code: name, redirectUri });
        finishSignIn(res, identity, redirectTo);
        return;
      }
      res.append(
        "Set-Cookie",
        cookieHeader(
          config,
          STATE_COOKIE,
          encodeState(state, redirectTo),
          STATE_TTL_SECONDS,
        ),
      );
      res.redirect(302, url);
    } catch (error) {
      next(error);
    }
  });

  app.get("/auth/callback/:provider", async (req, res, next) => {
    try {
      const provider = providers.get(String(req.params.provider));
      if (provider === undefined) {
        res.status(404).json({ error: "unknown provider" });
        return;
      }
      const stored = decodeState(
        parseCookies(req.headers.cookie)[STATE_COOKIE],
      );
      const redirectTo = stored?.redirectTo ?? config.siteOrigin;
      if (stored === null || req.query.state !== stored.state) {
        failSignIn(res, redirectTo, "state mismatch or missing");
        return;
      }
      if (typeof req.query.error === "string") {
        failSignIn(res, redirectTo, `provider error: ${req.query.error}`);
        return;
      }
      if (typeof req.query.code !== "string" || req.query.code === "") {
        failSignIn(res, redirectTo, "no code");
        return;
      }
      let identity: ProviderIdentity;
      try {
        identity = await provider.complete({
          code: req.query.code,
          redirectUri: callbackUri(provider.name),
        });
      } catch (error) {
        failSignIn(res, redirectTo, `${provider.name}: ${String(error)}`);
        return;
      }
      res.append("Set-Cookie", cookieHeader(config, STATE_COOKIE, "", 0));
      finishSignIn(res, identity, redirectTo);
    } catch (error) {
      next(error);
    }
  });

  // Rotate the cookie and issue a token. A 401 also clears the cookie, so
  // the browser stops presenting a dead one.
  app.post("/auth/refresh", async (req, res, next) => {
    try {
      const cookie = parseCookies(req.headers.cookie)[REFRESH_COOKIE];
      const rotated = cookie ? rotateSession(db, cookie, now()) : null;
      const account =
        rotated === null ? null : accountById(db, rotated.accountId);
      if (rotated === null || account === null || account.deleted_at !== null) {
        res.append("Set-Cookie", clearedRefreshCookieHeader(config));
        res.status(401).json({ error: "no session" });
        return;
      }
      const jwt = await signToken(
        key,
        {
          sub: uuidToBase64url(account.id),
          provider: accountProvider(db, account.id) ?? undefined,
          role: tokenRole(account, now()),
        },
        { issuer, audience, ttlSeconds: TOKEN_TTL_SECONDS },
      );
      res.append(
        "Set-Cookie",
        refreshCookieHeader(config, rotated.cookieValue),
      );
      // `token` is RefreshResponseSchema; `jwt` and `expiresIn` are what
      // Auth.ts reads. Both until the client settles on one.
      res.json({ token: jwt, jwt, expiresIn: TOKEN_TTL_SECONDS });
    } catch (error) {
      next(error);
    }
  });

  // End this session. Always succeeds: a cookie that is already dead is
  // the outcome the caller wanted.
  app.post("/auth/logout", (req, res) => {
    const cookie = parseCookies(req.headers.cookie)[REFRESH_COOKIE];
    if (cookie) revokeSession(db, cookie, now());
    res.append("Set-Cookie", clearedRefreshCookieHeader(config));
    res.json({ ok: true });
  });

  // End every session of the account behind this cookie.
  app.post("/auth/revoke", (req, res) => {
    const cookie = parseCookies(req.headers.cookie)[REFRESH_COOKIE];
    const accountId = cookie ? sessionAccount(db, cookie, now()) : null;
    const ended =
      accountId === null ? 0 : revokeAllSessions(db, accountId, now());
    res.append("Set-Cookie", clearedRefreshCookieHeader(config));
    res.json({ ok: true, ended });
  });

  // The account behind a token: the client's and the game server's view.
  app.get("/users/@me", async (req, res, next) => {
    try {
      const accountId = await bearer.accountId(req);
      const account = accountId === null ? null : accountById(db, accountId);
      if (account === null || account.deleted_at !== null) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
      res.json(userMeResponse(account, now(), statsFor(db, account.id)));
    } catch (error) {
      next(error);
    }
  });
}

// The state cookie: the one-time value and where to send the browser after,
// packed so one cookie carries both across the provider round trip.
function encodeState(state: string, redirectTo: string): string {
  return `${state}.${Buffer.from(redirectTo, "utf8").toString("base64url")}`;
}

function decodeState(
  raw: string | undefined,
): { state: string; redirectTo: string } | null {
  if (raw === undefined || raw === "") return null;
  const dot = raw.indexOf(".");
  if (dot === -1) return null;
  const state = raw.slice(0, dot);
  if (state === "") return null;
  try {
    const redirectTo = Buffer.from(raw.slice(dot + 1), "base64url").toString(
      "utf8",
    );
    return redirectTo === "" ? null : { state, redirectTo };
  } catch {
    return null;
  }
}
