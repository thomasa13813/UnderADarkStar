import { GameEnv, parseGameEnv } from "../core/configuration/Config";

// Under a Dark Star: the account API's settings (docs/DarkStar-Accounts.md
// §11). Read once at boot from the environment; nothing here is secret except
// API_KEY, which the game server shares for server-to-API calls.

export interface ApiConfig {
  env: GameEnv;
  // The port the API listens on. nginx fronts it as api.<DOMAIN>; the game
  // server and the client reach it at http://localhost:8787 in dev.
  port: number;
  // Where the database and the signing key live: /data in the container
  // (a volume), .data/ in dev (git-ignored).
  dataDir: string;
  // The site. The API is api.<DOMAIN>, which is also the token issuer the game
  // server checks (ServerEnv.jwtIssuer); DOMAIN is the token audience.
  domain: string;
  // Shared secret for server-to-API calls (x-api-key).
  apiKey: string;
}

export function apiConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): ApiConfig {
  const gameEnv = parseGameEnv(env.GAME_ENV);
  const domain = env.DOMAIN;
  if (!domain) throw new Error("DOMAIN not set");
  const apiKey = env.API_KEY;
  if (!apiKey) throw new Error("API_KEY not set");
  const rawPort = env.API_PORT;
  const port = rawPort === undefined || rawPort === "" ? 8787 : Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid API_PORT: ${JSON.stringify(rawPort)}`);
  }
  const dataDir =
    env.DATA_DIR && env.DATA_DIR.length > 0
      ? env.DATA_DIR
      : gameEnv === GameEnv.Dev
        ? ".data"
        : "/data";
  return { env: gameEnv, port, dataDir, domain, apiKey };
}

// The token issuer, as the game server and the client derive it from the
// domain (ServerEnv.jwtIssuer, ClientEnv.jwtIssuer): one rule in three
// places, so a token minted here is accepted there.
export function issuerFor(config: ApiConfig): string {
  return config.domain === "localhost"
    ? `http://localhost:${config.port}`
    : `https://api.${config.domain}`;
}

// Browser origins the API answers cross-origin requests from: the site, and
// in dev the Vite page and the game server on any localhost port.
export function allowedOrigin(config: ApiConfig, origin: string): boolean {
  if (config.env === GameEnv.Dev) {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  }
  return (
    origin === `https://${config.domain}` ||
    origin === `https://www.${config.domain}`
  );
}
