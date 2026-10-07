import express, { Express, NextFunction, Request, Response } from "express";
import { DatabaseSync } from "node:sqlite";
import { mountAuthRoutes } from "./AuthRoutes";
import { allowedOrigin, ApiConfig } from "./Config";
import { jwksDocument, SigningKey } from "./Keys";
import { FetchLike } from "./Providers";

// Under a Dark Star: the account API (docs/DarkStar-Accounts.md §3, §7), the
// small service that replaces OpenFront's closed one. B1 is the skeleton: it
// serves its signing key, answers the health check, and tells the client
// there is no cluster list (which the client reads as "reachable, one
// server"). B2 adds sign-in, sessions and /users/@me (AuthRoutes.ts). The
// join path, results and the board follow (B3–B5).
//
// Built as a factory so tests mount it on an ephemeral port; Server.ts is the
// one place that reads the environment and listens.

export interface ApiDeps {
  config: ApiConfig;
  db: DatabaseSync;
  key: SigningKey;
  log: Pick<Console, "info" | "warn" | "error">;
  // Outbound HTTP (the providers' token exchange); tests stub it.
  fetch?: FetchLike;
  // The clock; tests move it.
  now?: () => number;
}

export function createApiApp(deps: ApiDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(express.json({ limit: "1mb" }));
  app.use(cors(deps.config));
  app.use(noStore);

  // Monitoring and the container's health check (Launch stage 6).
  app.get("/health", (_req, res) => {
    let database = "ok";
    try {
      deps.db.prepare("SELECT 1").get();
    } catch {
      database = "error";
    }
    res.status(database === "ok" ? 200 : 503).json({
      status: database === "ok" ? "ok" : "degraded",
      database,
    });
  });

  // The public signing key the game server verifies tokens with
  // (ServerEnv.jwkPublicKey). Cacheable: the key changes only when the file
  // is replaced, and a restart follows that.
  app.get("/.well-known/jwks.json", (_req, res) => {
    res.setHeader("Cache-Control", "public, max-age=300");
    res.json(jwksDocument(deps.key));
  });

  // There is one server and no registry (A7). The client's poll of this
  // (ServerList) treats a 404 as a reachable backend with no list and keeps
  // the page's own server values; anything 5xx would count as an outage.
  app.get("/cluster.json", (_req, res) => {
    res.status(404).json({ error: "no cluster list: single server" });
  });

  mountAuthRoutes(app, deps);

  app.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    deps.log.error("api request failed", err);
    res.status(500).json({ error: "internal error" });
  });

  return app;
}

// Cross-origin access for the page: credentials allowed (the refresh cookie),
// only from the site's origin (dev: any localhost port). Other origins get no
// CORS headers, so the browser refuses them the response.
function cors(config: ApiConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (origin !== undefined && allowedOrigin(config, origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Vary", "Origin");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, X-Api-Key",
      );
      res.setHeader(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, OPTIONS",
      );
      res.setHeader("Access-Control-Max-Age", "600");
    }
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

// Account answers are personal and change: never cached by a shared proxy.
// The JWKS route overrides this with its own header.
function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store");
  next();
}
