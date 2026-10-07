import { createHash, randomBytes, randomUUID } from "crypto";
import { DatabaseSync } from "node:sqlite";
import { GameEnv } from "../core/configuration/Config";
import { ApiConfig } from "./Config";

// Under a Dark Star: refresh sessions (docs/DarkStar-Accounts.md §4.2, §8).
// A sign-in creates a session and hands the browser a refresh cookie; every
// POST /auth/refresh rotates the cookie's secret and issues a 15-minute
// token. The database holds only the SHA-256 of the secret, so a copy of the
// database cannot be turned into a cookie; and a cookie that was rotated away
// is refused, so a stolen old copy stops working at the next refresh.

export const REFRESH_COOKIE = "ds_refresh";
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface RotatedSession {
  accountId: string;
  // The new cookie value; the old one is dead from here on.
  cookieValue: string;
}

interface SessionRow {
  id: string;
  account_id: string;
  expires_at: number;
  revoked_at: number | null;
}

// Opens a session for an account and returns the cookie value to hand the
// browser. The value is 32 random bytes, base64url; only its hash is stored.
export function createSession(
  db: DatabaseSync,
  accountId: string,
  now: number,
): string {
  const secret = newSecret();
  db.prepare(
    `INSERT INTO sessions (id, account_id, token_hash, created_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  ).run(randomUUID(), accountId, hashSecret(secret), now, now + SESSION_TTL_MS);
  return secret;
}

// The live session behind a cookie value, or null when the cookie is unknown,
// revoked or expired. The three are not told apart to the caller: each means
// "sign in again".
function liveSession(
  db: DatabaseSync,
  cookieValue: string,
  now: number,
): SessionRow | null {
  const row = db
    .prepare(
      "SELECT id, account_id, expires_at, revoked_at FROM sessions WHERE token_hash = ?",
    )
    .get(hashSecret(cookieValue)) as SessionRow | undefined;
  if (row === undefined) return null;
  if (row.revoked_at !== null) return null;
  if (row.expires_at <= now) return null;
  return row;
}

// Rotates the session's secret: the cookie presented is replaced by a new one
// and can never be used again. Null when the cookie is not a live session.
export function rotateSession(
  db: DatabaseSync,
  cookieValue: string,
  now: number,
): RotatedSession | null {
  const session = liveSession(db, cookieValue, now);
  if (session === null) return null;
  const secret = newSecret();
  db.prepare("UPDATE sessions SET token_hash = ? WHERE id = ?").run(
    hashSecret(secret),
    session.id,
  );
  return { accountId: session.account_id, cookieValue: secret };
}

// The account behind a live cookie, without rotating it.
export function sessionAccount(
  db: DatabaseSync,
  cookieValue: string,
  now: number,
): string | null {
  return liveSession(db, cookieValue, now)?.account_id ?? null;
}

// Ends the session behind a cookie (logout). Returns the account it belonged
// to, or null when there was no live session to end.
export function revokeSession(
  db: DatabaseSync,
  cookieValue: string,
  now: number,
): string | null {
  const session = liveSession(db, cookieValue, now);
  if (session === null) return null;
  db.prepare("UPDATE sessions SET revoked_at = ? WHERE id = ?").run(
    now,
    session.id,
  );
  return session.account_id;
}

// Ends every live session of an account ("sign out everywhere"). Returns how
// many were ended.
export function revokeAllSessions(
  db: DatabaseSync,
  accountId: string,
  now: number,
): number {
  const result = db
    .prepare(
      "UPDATE sessions SET revoked_at = ? WHERE account_id = ? AND revoked_at IS NULL",
    )
    .run(now, accountId);
  return Number(result.changes);
}

function newSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

// --- Cookies -------------------------------------------------------------

// The refresh cookie as §4.2 specifies it: HttpOnly, SameSite=Lax, scoped to
// /auth so no other route ever sees it, Secure outside dev (the dev page is
// plain http on localhost). Max-Age matches the session's life.
export function refreshCookieHeader(config: ApiConfig, value: string): string {
  return cookieHeader(config, REFRESH_COOKIE, value, SESSION_TTL_MS / 1000);
}

export function clearedRefreshCookieHeader(config: ApiConfig): string {
  return cookieHeader(config, REFRESH_COOKIE, "", 0);
}

export function cookieHeader(
  config: ApiConfig,
  name: string,
  value: string,
  maxAgeSeconds: number,
): string {
  const parts = [
    `${name}=${value}`,
    "Path=/auth",
    `Max-Age=${Math.floor(maxAgeSeconds)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (config.env !== GameEnv.Dev) parts.push("Secure");
  return parts.join("; ");
}

// The request's cookies by name. Values are returned as sent: every value
// this API sets is base64url or a simple token, so nothing needs decoding.
export function parseCookies(
  header: string | undefined,
): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (header === undefined) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    if (name === "") continue;
    cookies[name] = part.slice(eq + 1).trim();
  }
  return cookies;
}
