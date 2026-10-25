import { Express, NextFunction, Request, Response } from "express";
import { z } from "zod";
import { GameEnv } from "../core/configuration/Config";
import { censorPlayer } from "../server/Censor";
import { ApiConfig } from "./Config";
import { FetchLike } from "./Providers";

// Under a Dark Star: the production join path (docs/DarkStar-Accounts.md §7,
// accounts step B3). What the game server asks the API when a player joins
// outside dev, and the upstream routes that still get called and must answer
// harmlessly so a production container runs a round with no call failing.

export const TURNSTILE_SITEVERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface JoinDeps {
  config: ApiConfig;
  log: Pick<Console, "info" | "warn" | "error">;
  fetch?: FetchLike;
}

// The game server's request (JoinVerify.verifyJoin): the joiner's IP, the
// Turnstile token (null for an already-admitted reconnect, whose single-use
// token is spent), and the typed identity to screen.
const JoinVerifyRequestSchema = z.object({
  ip: z.string(),
  token: z.string().nullable(),
  username: z.string(),
  clanTag: z.string().nullable().optional(),
});

const SiteverifySchema = z.object({
  success: z.boolean(),
  "error-codes": z.array(z.string()).optional(),
});

export function mountJoinRoutes(app: Express, deps: JoinDeps): void {
  const { config, log } = deps;
  const fetchImpl: FetchLike =
    deps.fetch ?? ((input, init) => fetch(input, init));
  let warnedNoSecret = false;

  // Server-to-API calls carry the shared key (ServerEnv.apiKey). Anything
  // else is not the game server.
  const requireApiKey = (req: Request, res: Response, next: NextFunction) => {
    if (req.headers["x-api-key"] !== config.apiKey) {
      res.status(401).json({ error: "bad api key" });
      return;
    }
    next();
  };

  // The bot check and the name filter in one call. `status` is the
  // Turnstile verdict; on approval the identity is display-ready (offensive
  // words in the name masked, a profane tag dropped, a surviving tag
  // uppercased), exactly what Censor.ts does locally, so the lobby never
  // shows a banned name. A null token skips the Turnstile check: the game
  // server sends that only for a reconnect it already admitted.
  app.post("/join_verify", requireApiKey, async (req, res, next) => {
    try {
      const parsed = JoinVerifyRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: z.prettifyError(parsed.error) });
        return;
      }
      const { ip, token, username, clanTag } = parsed.data;
      if (token !== null) {
        const verdict = await verifyTurnstile(token, ip);
        if (verdict !== "ok") {
          log.info(`join refused by Turnstile: ${verdict}`);
          res.json({ status: "rejected", reason: verdict });
          return;
        }
      }
      const screened = censorPlayer(username, clanTag ?? null);
      res.json({
        status: "approved",
        username: screened.username,
        clanTag: screened.clanTag,
      });
    } catch (error) {
      next(error);
    }
  });

  // Cloudflare's answer, or the reason it said no. Without a secret (dev
  // only; production refuses to boot without one, Config.ts) every token
  // passes, with one warning in the log.
  async function verifyTurnstile(
    token: string,
    ip: string,
  ): Promise<"ok" | string> {
    if (config.turnstileSecret === null) {
      if (!warnedNoSecret) {
        log.warn(
          "TURNSTILE_SECRET_KEY not set: join tokens are not checked (dev)",
        );
        warnedNoSecret = true;
      }
      return "ok";
    }
    const response = await fetchImpl(TURNSTILE_SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        secret: config.turnstileSecret,
        response: token,
        remoteip: ip,
      }).toString(),
    });
    if (!response.ok) {
      // Cloudflare itself failing is not the player's fault; the game
      // server treats a non-2xx from us as "error" and fails open to its
      // local filter, so answer the same way rather than refuse the player.
      throw new Error(`siteverify returned ${response.status}`);
    }
    const verdict = SiteverifySchema.safeParse(await response.json());
    if (!verdict.success) {
      throw new Error("siteverify returned a malformed answer");
    }
    if (verdict.data.success) return "ok";
    return (verdict.data["error-codes"] ?? ["turnstile-failed"]).join(",");
  }

  // --- Upstream routes that still get called; empty, harmless answers ---

  // The cosmetics catalogue (PrivilegeRefresher on every worker, the client
  // at startup). Empty: no store here (A5). CosmeticsSchema needs the two
  // records present.
  app.get("/cosmetics.json", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ patterns: {}, flags: {} });
  });

  // Clan tags held by subscribers: none.
  app.get("/reserved_clan_tags", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json([]);
  });

  // Bought tribe names: none. Tribes keep their defaults.
  app.get("/custom_tribes", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json({ tribes: [] });
  });

  // A finished solo game, which the client offers to the archive. Accepted
  // and discarded: solo rounds are not recorded (A4).
  app.post("/archive_singleplayer_game", (_req, res) => {
    res.status(202).json({ ok: true });
  });

  // A finished multiplayer game from the game server (Archive.archive) is
  // ResultRoutes.ts (B4).

  if (config.env !== GameEnv.Dev && config.turnstileSecret === null) {
    // Unreachable: Config.ts refuses the boot. Kept as a guard for a
    // config built by hand in a test.
    log.error("production API without TURNSTILE_SECRET_KEY");
  }
}
