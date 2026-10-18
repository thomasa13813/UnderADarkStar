import { decodeJwt } from "jose";
import { UserSettings } from "src/core/game/UserSettings";
import { z } from "zod";
import { TokenPayload, TokenPayloadSchema } from "../core/ApiSchemas";
import { base64urlToUuid } from "../core/Base64";
import { getApiBase, getAudience } from "./Api";
import { generateCryptoRandomUUID } from "./Utils";

export type UserAuth = { jwt: string; claims: TokenPayload } | false;

const PERSISTENT_ID_KEY = "player_persistent_id";
// Under a Dark Star: "none" once this browser is known to hold no refresh
// cookie, so a guest's page load skips POST /auth/refresh (which can only
// answer 401) instead of logging the failure on every visit. The cookie
// itself is HttpOnly and on the API's host, so the page cannot look for it.
// Absent means unknown and refreshes as before; starting a sign-in clears it.
const SESSION_HINT_KEY = "darkstar_session_hint";

let __jwt: string | null = null;
let __refreshPromise: Promise<void> | null = null;
let __expiresAt: number = 0;

export async function getAuthHeader(): Promise<string> {
  const userAuthResult = await userAuth();
  if (!userAuthResult) return "";
  const { jwt } = userAuthResult;
  return `Bearer ${jwt}`;
}

export async function logOut(allSessions: boolean = false): Promise<boolean> {
  try {
    const response = await fetch(
      getApiBase() + (allSessions ? "/auth/revoke" : "/auth/logout"),
      {
        method: "POST",
        credentials: "include",
      },
    );

    if (response.ok === false) {
      console.error("Logout failed", response);
      return false;
    }

    return true;
  } catch (e) {
    console.error("Logout failed", e);
    return false;
  } finally {
    clearLocalSession();
  }
}

// Drop all client-side auth state without calling the API. Used after account
// deletion (DELETE /users/@me), where the server has already revoked every
// session and cleared the refresh cookie, so /auth/logout must not be called.
// Announce a logout that nothing asked for. Consumers holding account state
// can't infer it: every failing call just resolves false, which is also what a
// transient network error looks like. Dispatched from clearLocalSession so it
// covers all of them — an expired refresh token, a JWT issued for another
// origin, a 401 on any endpoint — rather than the one branch that prompted it.
//
// Distinct from userMeResponse, which Main dispatches: account state lives
// partly outside that event (the nav button's imperative avatar and its cached
// profile, window.adsEnabled), so Main answers this by running the same
// no-session path it runs at startup, which broadcasts userMeResponse itself.
function announceLoggedOut(): void {
  document.dispatchEvent(
    new CustomEvent("session-cleared", { bubbles: true, cancelable: true }),
  );
}

export function clearLocalSession(): void {
  const hadSession = __jwt !== null;
  __jwt = null;
  // Under a Dark Star (docs/DarkStar-Accounts.md A21): a guest's browser ID
  // is their identity, and the name the server assigns is derived from it.
  // Every page load of a signed-out player ends here (the refresh answers
  // 401), so dropping the ID unconditionally, as upstream did, would hand
  // the guest a new name on every visit. Only an actual sign-out forgets
  // it: the account's identity should not leak into the guest that follows.
  if (hadSession) localStorage.removeItem(PERSISTENT_ID_KEY);
  // Every path here ends the cookie too (logout, revoke, deletion, a refresh
  // the API refused), so there is nothing left to refresh.
  setSessionHint("none");
  // Switch cosmetics back to the logged-out scope. The player's own
  // selections stay stored under their publicId and are restored on the
  // next login (#4955).
  UserSettings.setPlayerId(null);
  if (hadSession) announceLoggedOut();
}

export async function isLoggedIn(): Promise<boolean> {
  const userAuthResult = await userAuth();
  return userAuthResult !== false;
}

// True when the in-memory session still belongs to the given player. Lets
// callers of authenticated endpoints discard a response that arrived after a
// logout or session change invalidated the request's session.
//
// `sub` is the dashed UUID TokenPayloadSchema transforms the claim into --
// what every caller holds -- while the JWT carries the base64url form, so the
// two have to be brought to the same encoding before comparing. Converting
// here rather than at the call sites means no caller has to know which
// encoding this wants.
export function isSessionActive(sub: string): boolean {
  if (__jwt === null) return false;
  try {
    const raw = decodeJwt(__jwt).sub;
    if (raw === undefined) return false;
    // Throws on a subject that is not a base64url UUID, which the catch
    // below answers the same way as an undecodable JWT: not this session.
    return base64urlToUuid(raw) === sub;
  } catch {
    return false;
  }
}

export async function userAuth(
  shouldRefresh: boolean = true,
): Promise<UserAuth> {
  try {
    const jwt = __jwt;
    if (!jwt) {
      if (!shouldRefresh) {
        console.warn("No JWT found and shouldRefresh is false");
        return false;
      }
      console.log("No JWT found");
      await refreshJwt();
      return userAuth(false);
    }

    // Verify the JWT (requires browser support)
    // const jwks = createRemoteJWKSet(
    //   new URL(getApiBase() + "/.well-known/jwks.json"),
    // );
    // const { payload, protectedHeader } = await jwtVerify(token, jwks, {
    //   issuer: getApiBase(),
    //   audience: getAudience(),
    // });

    const payload = decodeJwt(jwt);
    const { iss, aud } = payload;

    if (iss !== getApiBase()) {
      // JWT was not issued by the correct server
      console.error('unexpected "iss" claim value');
      logOut();
      return false;
    }
    const myAud = getAudience();
    if (myAud !== "localhost" && aud !== myAud) {
      // JWT was not issued for this website
      console.error('unexpected "aud" claim value');
      logOut();
      return false;
    }
    if (Date.now() >= __expiresAt - 3 * 60 * 1000) {
      console.log("jwt expired or about to expire");
      if (!shouldRefresh) {
        console.error("jwt expired and shouldRefresh is false");
        return false;
      }
      await refreshJwt();

      // Try to get login info again after refreshing
      return userAuth(false);
    }

    const result = TokenPayloadSchema.safeParse(payload);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Invalid payload", error);
      return false;
    }

    const claims = result.data;
    return { jwt, claims };
  } catch (e) {
    console.error("isLoggedIn failed", e);
    return false;
  }
}

function setSessionHint(value: "none" | null): void {
  try {
    if (value === null) localStorage.removeItem(SESSION_HINT_KEY);
    else localStorage.setItem(SESSION_HINT_KEY, value);
  } catch {
    // Storage blocked: the hint is an optimisation, refreshing still works.
  }
}

function knownGuest(): boolean {
  try {
    return localStorage.getItem(SESSION_HINT_KEY) === "none";
  } catch {
    return false;
  }
}

// Called just before the page navigates to the API's login route: the
// browser is about to receive a refresh cookie, so the next load must ask.
export function expectSession(): void {
  setSessionHint(null);
}

async function refreshJwt(): Promise<void> {
  if (knownGuest()) return;
  if (__refreshPromise) {
    return __refreshPromise;
  }
  __refreshPromise = doRefreshJwt();
  try {
    await __refreshPromise;
  } finally {
    __refreshPromise = null;
  }
}

async function doRefreshJwt(): Promise<void> {
  try {
    console.log("Refreshing jwt");
    // Bounded: userAuth() awaits this, and every
    // authenticated path awaits userAuth(), so a response that never settles
    // stops the client joining anything at all. An abort lands in the catch
    // below, which already treats an unreachable server as "clear the jwt" —
    // the same outcome, now reached in bounded time.
    const response = await fetch(getApiBase() + "/auth/refresh", {
      method: "POST",
      credentials: "include",
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status !== 200) {
      console.error("Refresh failed", response);
      logOut();
      return;
    }
    const json = await response.json();
    const { jwt, expiresIn } = json;
    __expiresAt = Date.now() + expiresIn * 1000;
    console.log("Refresh succeeded");
    __jwt = jwt;
  } catch (e) {
    console.error("Refresh failed", e);
    // if server unreachable, just clear jwt
    __jwt = null;
    return;
  }
}

export async function getPlayToken(): Promise<string> {
  const result = await userAuth();
  if (result !== false) return result.jwt;
  return getPersistentIDFromLocalStorage();
}

// WARNING: DO NOT EXPOSE THIS ID
export function getPersistentID(): string {
  const jwt = __jwt;
  if (!jwt) return getPersistentIDFromLocalStorage();
  const payload = decodeJwt(jwt);
  const sub = payload.sub;
  if (!sub) return getPersistentIDFromLocalStorage();
  return base64urlToUuid(sub);
}

// WARNING: DO NOT EXPOSE THIS ID
function getPersistentIDFromLocalStorage(): string {
  // Try to get existing localStorage
  const value = localStorage.getItem(PERSISTENT_ID_KEY);
  if (value) return value;

  // If no localStorage exists, create new ID and set localStorage
  const newID = generateCryptoRandomUUID();
  localStorage.setItem(PERSISTENT_ID_KEY, newID);

  return newID;
}
