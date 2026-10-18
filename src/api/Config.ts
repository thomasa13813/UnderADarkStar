import { GameEnv, parseGameEnv } from "../core/configuration/Config";

// Under a Dark Star: the account API's settings (docs/DarkStar-Accounts.md
// §11). Read once at boot from the environment; nothing here is secret except
// API_KEY, which the game server shares for server-to-API calls, and the
// sign-in providers' client secrets. In dev those come from the root `.env`
// (git-ignored), which Server.ts loads through dotenv.

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ApiConfig {
  env: GameEnv;
  // The port the API listens on. nginx fronts it as api.<DOMAIN>; the game
  // server and the client reach it at http://localhost:8787 in dev.
  port: number;
  // Where the database and the signing key live: /data in the container
  // (a volume), .data/ in dev (git-ignored).
  dataDir: string;
  // The site. DOMAIN is the token audience; the API's own hostname is
  // apiDomain, or api.<DOMAIN> when that is not set, and its origin is the
  // token issuer the game server checks (ServerEnv.jwtIssuer).
  domain: string;
  // API_DOMAIN: the API's hostname when it is not api.<DOMAIN>. At launch it
  // is darkstar-api.january-games.com, because Cloudflare's free certificate
  // covers one level of names under the registered domain only.
  apiDomain: string | null;
  // Shared secret for server-to-API calls (x-api-key).
  apiKey: string;
  // The page's origin, where a sign-in sends the browser back when the login
  // link names nowhere (or somewhere that is not ours). SITE_ORIGIN overrides
  // it; the default is the Vite page in dev and https://<DOMAIN> otherwise.
  siteOrigin: string;
  // Discord sign-in (§4.2). Null when the keys are not set: the provider is
  // then not offered, which is how a fresh checkout runs with the dev
  // provider alone.
  discord: ProviderCredentials | null;
  // Google sign-in (§4.2), the same way: null, and not offered, unless both
  // GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set.
  google: ProviderCredentials | null;
  // Cloudflare Turnstile's secret, for the join bot check (§7, join_verify).
  // Required outside dev; in dev it may be absent, and every token passes.
  turnstileSecret: string | null;
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
  const siteOrigin =
    env.SITE_ORIGIN && env.SITE_ORIGIN.length > 0
      ? env.SITE_ORIGIN.replace(/\/+$/, "")
      : domain === "localhost"
        ? "http://localhost:9000"
        : `https://${domain}`;
  const apiDomain =
    env.API_DOMAIN && env.API_DOMAIN.length > 0 ? env.API_DOMAIN : null;
  const turnstileSecret =
    env.TURNSTILE_SECRET_KEY && env.TURNSTILE_SECRET_KEY.trim().length > 0
      ? env.TURNSTILE_SECRET_KEY.trim()
      : null;
  if (turnstileSecret === null && gameEnv !== GameEnv.Dev) {
    throw new Error("TURNSTILE_SECRET_KEY not set");
  }
  return {
    env: gameEnv,
    port,
    dataDir,
    domain,
    apiDomain,
    apiKey,
    siteOrigin,
    discord: providerCredentials(
      "DISCORD",
      env.DISCORD_CLIENT_ID,
      env.DISCORD_CLIENT_SECRET,
    ),
    google: providerCredentials(
      "GOOGLE",
      env.GOOGLE_CLIENT_ID,
      env.GOOGLE_CLIENT_SECRET,
    ),
    turnstileSecret,
  };
}

// Both keys or neither: one without the other is a misconfiguration worth
// failing loudly on, not a provider that half works.
function providerCredentials(
  name: string,
  clientId: string | undefined,
  clientSecret: string | undefined,
): ProviderCredentials | null {
  const id = clientId?.trim() ?? "";
  const secret = clientSecret?.trim() ?? "";
  if (id === "" && secret === "") return null;
  if (id === "" || secret === "") {
    throw new Error(
      `${name}_CLIENT_ID and ${name}_CLIENT_SECRET must be set together`,
    );
  }
  return { clientId: id, clientSecret: secret };
}

// The token issuer, as the game server and the client derive it from the
// domain (ServerEnv.jwtIssuer, ClientEnv.jwtIssuer): one rule in three
// places, so a token minted here is accepted there.
export function issuerFor(config: ApiConfig): string {
  if (config.apiDomain !== null) {
    // Same rule as ServerEnv.apiOriginFor: localhost is plain http.
    return /^localhost(:\d+)?$/.test(config.apiDomain)
      ? `http://${config.apiDomain}`
      : `https://${config.apiDomain}`;
  }
  return config.domain === "localhost"
    ? `http://localhost:${config.port}`
    : `https://api.${config.domain}`;
}

// Browser origins the API answers cross-origin requests from: the site, and
// in dev the Vite page and the game server on any localhost port. A
// localhost DOMAIN is never a public site, so it keeps the localhost rule in
// every environment: that is how a production-mode container is audited on
// one PC (Launch stage 3a).
export function allowedOrigin(config: ApiConfig, origin: string): boolean {
  if (config.env === GameEnv.Dev || config.domain === "localhost") {
    return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  }
  return (
    origin === `https://${config.domain}` ||
    origin === `https://www.${config.domain}`
  );
}
