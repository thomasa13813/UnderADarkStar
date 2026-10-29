import { Express, Request } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { ApiConfig } from "./Config";

// Under a Dark Star: rate limits on the account API (docs/DarkStar-Accounts.md
// §10, B6). Per visitor IP, per minute, in memory (one API process; a restart
// forgets the counts). Generous for a person and their browser, tight enough
// that a script cannot hammer sign-in or fill the database. The game
// server's own calls (join_verify, results) carry the shared key and are not
// counted. A refused request gets 429 and Retry-After.

export interface RateLimitRule {
  windowMs: number;
  max: number;
}

const MINUTE = 60 * 1000;

export const RATE_LIMITS = {
  // Starting a sign-in and the provider's return: a person needs a handful.
  signIn: { windowMs: MINUTE, max: 20 },
  // Every page load and every 15 minutes of play; a household or a school
  // shares one IP, so this one is wide.
  refresh: { windowMs: MINUTE, max: 60 },
  // Sign out, sign out everywhere, delete the account.
  session: { windowMs: MINUTE, max: 10 },
  // Renames are unlimited for a person (A13); this only stops a script.
  rename: { windowMs: MINUTE, max: 20 },
  // Saved solo setups: listed when the solo screen opens, saved by hand.
  soloPresets: { windowMs: MINUTE, max: 30 },
  // Everything else, as one budget: the board, /users/@me, stored records.
  everything: { windowMs: MINUTE, max: 300 },
} satisfies Record<string, RateLimitRule>;

// The visitor's address. Cloudflare's header first: every request arrives
// through the tunnel and nginx, so the socket address is the proxy's.
// IPv6 is counted per /56, as one household.
export function visitorKey(req: Request): string {
  const header = req.headers["cf-connecting-ip"];
  const ip =
    typeof header === "string" && header !== ""
      ? header
      : (req.ip ?? req.socket.remoteAddress ?? "unknown");
  return ipKeyGenerator(ip);
}

export function mountRateLimits(
  app: Express,
  config: ApiConfig,
  rules: typeof RATE_LIMITS = RATE_LIMITS,
): void {
  const limiter = (rule: RateLimitRule) =>
    rateLimit({
      windowMs: rule.windowMs,
      limit: rule.max,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      keyGenerator: visitorKey,
      skip: (req) => req.headers["x-api-key"] === config.apiKey,
      handler: (_req, res) => {
        res.status(429).json({ error: "too many requests" });
      },
      // The key is ours (visitorKey), not req.ip, so the library's checks
      // of the proxy setup do not apply.
      validate: { trustProxy: false, xForwardedForHeader: false },
    });
  app.use(limiter(rules.everything));
  app.use(["/auth/login", "/auth/callback"], limiter(rules.signIn));
  app.use("/auth/refresh", limiter(rules.refresh));
  app.use("/users/@me/username", limiter(rules.rename));
  app.use("/users/@me/solo-presets", limiter(rules.soloPresets));
  app.use(
    ["/auth/logout", "/auth/revoke", "/auth/delete"],
    limiter(rules.session),
  );
}
