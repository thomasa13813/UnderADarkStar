import { z } from "zod";
import { GameEnv } from "../core/configuration/Config";
import { ProviderIdentity } from "./Accounts";
import { ApiConfig } from "./Config";

// Under a Dark Star: the sign-in providers (docs/DarkStar-Accounts.md §4.2).
// Discord is the launch provider; Google is built and offered once its keys
// are set, which waits on the privacy policy being live (§10); `dev` exists
// only when GAME_ENV=dev and signs in as any name with no external service,
// so tests and local play can exercise accounts.

export type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Response>;

export interface AuthorizeArgs {
  // The one-time value the callback must echo (the state cookie holds it).
  state: string;
  // Our callback URL for this provider, which the provider must send the
  // browser back to and which the token exchange repeats.
  redirectUri: string;
  // The login request's query, for providers that take a hint from it.
  query: Record<string, unknown>;
}

export interface CompleteArgs {
  // The code the provider sent back (for dev, the name to sign in as).
  code: string;
  redirectUri: string;
}

export interface Provider {
  readonly name: string;
  // Where to send the browser to sign in, or null to finish at once (dev).
  authorizeUrl(args: AuthorizeArgs): string | null;
  // Turns the provider's code into who signed in. Throws on any failure;
  // the caller logs and sends the browser back to the page.
  complete(args: CompleteArgs): Promise<ProviderIdentity>;
}

export const DEV_PROVIDER = "dev";
export const DISCORD_PROVIDER = "discord";

export const DISCORD_AUTHORIZE_URL = "https://discord.com/oauth2/authorize";
export const DISCORD_TOKEN_URL = "https://discord.com/api/oauth2/token";
export const DISCORD_USER_URL = "https://discord.com/api/users/@me";

export const GOOGLE_PROVIDER = "google";

export const GOOGLE_AUTHORIZE_URL =
  "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL =
  "https://openidconnect.googleapis.com/v1/userinfo";

// The providers this configuration offers, by name.
export function providersFor(
  config: ApiConfig,
  fetchImpl: FetchLike,
): Map<string, Provider> {
  const providers = new Map<string, Provider>();
  if (config.env === GameEnv.Dev) {
    providers.set(DEV_PROVIDER, devProvider());
  }
  if (config.discord !== null) {
    providers.set(
      DISCORD_PROVIDER,
      discordProvider(
        config.discord.clientId,
        config.discord.clientSecret,
        fetchImpl,
      ),
    );
  }
  if (config.google !== null) {
    providers.set(
      GOOGLE_PROVIDER,
      googleProvider(
        config.google.clientId,
        config.google.clientSecret,
        fetchImpl,
      ),
    );
  }
  return providers;
}

// Signs in as the name in the login link (?name=Tom; "Dev" when absent).
// The same name is the same account every time, so a dev session can sign
// out and back in and find its reigns.
function devProvider(): Provider {
  return {
    name: DEV_PROVIDER,
    authorizeUrl: () => null,
    complete: async ({ code }) => {
      const name = code.trim() === "" ? "Dev" : code.trim();
      return {
        provider: DEV_PROVIDER,
        providerUserId: name.toLowerCase(),
        displayName: name,
      };
    },
  };
}

const DiscordTokenSchema = z.object({ access_token: z.string().min(1) });
const DiscordMeSchema = z.object({
  id: z.string().min(1),
  username: z.string(),
  global_name: z.string().nullable().optional(),
});

// OAuth2 authorization code, scope `identify` only: the user ID and names,
// no email, no guilds. The code is exchanged server to server with the client
// secret, so the browser never sees it.
function discordProvider(
  clientId: string,
  clientSecret: string,
  fetchImpl: FetchLike,
): Provider {
  return {
    name: DISCORD_PROVIDER,
    authorizeUrl: ({ state, redirectUri }) => {
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: "identify",
        state,
      });
      return `${DISCORD_AUTHORIZE_URL}?${params.toString()}`;
    },
    complete: async ({ code, redirectUri }) => {
      const tokenResponse = await fetchImpl(DISCORD_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }).toString(),
      });
      if (!tokenResponse.ok) {
        throw new Error(
          `discord token exchange failed: ${tokenResponse.status}`,
        );
      }
      const token = DiscordTokenSchema.parse(await tokenResponse.json());

      const meResponse = await fetchImpl(DISCORD_USER_URL, {
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      if (!meResponse.ok) {
        throw new Error(`discord user lookup failed: ${meResponse.status}`);
      }
      const me = DiscordMeSchema.parse(await meResponse.json());
      return {
        provider: DISCORD_PROVIDER,
        providerUserId: me.id,
        displayName: me.global_name ?? me.username,
      };
    },
  };
}

const GoogleTokenSchema = z.object({ access_token: z.string().min(1) });
// Only the two fields we keep are read; anything else Google sends (the
// picture, the locale) is dropped by the parse.
const GoogleUserInfoSchema = z.object({
  sub: z.string().min(1),
  name: z.string().optional(),
});

// OpenID Connect authorization code, scopes `openid profile` only: the
// account's stable ID (`sub`) and its name, no email (the privacy policy
// promises exactly this). Like Discord, the code is exchanged server to
// server with the client secret, and the name comes from the userinfo
// endpoint with the access token, so the ID token is never needed. A
// missing name becomes the fallback account name.
function googleProvider(
  clientId: string,
  clientSecret: string,
  fetchImpl: FetchLike,
): Provider {
  return {
    name: GOOGLE_PROVIDER,
    authorizeUrl: ({ state, redirectUri }) => {
      const params = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: "openid profile",
        state,
      });
      return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
    },
    complete: async ({ code, redirectUri }) => {
      const tokenResponse = await fetchImpl(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }).toString(),
      });
      if (!tokenResponse.ok) {
        throw new Error(
          `google token exchange failed: ${tokenResponse.status}`,
        );
      }
      const token = GoogleTokenSchema.parse(await tokenResponse.json());

      const infoResponse = await fetchImpl(GOOGLE_USERINFO_URL, {
        headers: { authorization: `Bearer ${token.access_token}` },
      });
      if (!infoResponse.ok) {
        throw new Error(`google user lookup failed: ${infoResponse.status}`);
      }
      const info = GoogleUserInfoSchema.parse(await infoResponse.json());
      return {
        provider: GOOGLE_PROVIDER,
        providerUserId: info.sub,
        displayName: info.name ?? "",
      };
    },
  };
}
