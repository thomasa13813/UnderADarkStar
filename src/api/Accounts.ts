import { randomBytes, randomInt, randomUUID } from "crypto";
import { DatabaseSync } from "node:sqlite";
import { UserMeResponse } from "../core/ApiSchemas";
import {
  ACCOUNT_NAME_CHARS,
  MAX_ACCOUNT_USERNAME_LENGTH,
  MIN_ACCOUNT_USERNAME_LENGTH,
} from "../core/validations/username";
import { censorPlayer } from "../server/Censor";
import { AccountStats, EMPTY_STATS, victories } from "./Results";

// Under a Dark Star: accounts and sign-ins (docs/DarkStar-Accounts.md §4.1,
// §4.5, §8). An account is the row behind a persistentID; a sign-in links one
// provider login to it. At launch each new provider login creates its own
// account (linking is B7). What is stored about a person is A12: the
// provider's user ID, a display name, timestamps. No email, no avatar.

export interface AccountRow {
  id: string;
  public_id: string;
  name: string;
  tag: string;
  name_changed_at: number | null;
  role: string | null;
  ban_reason: string | null;
  ban_until: number | null;
  created_at: number;
  deleted_at: number | null;
}

export interface ProviderIdentity {
  provider: string;
  providerUserId: string;
  // The provider's display name, as it came: the account name is derived
  // from it (accountNameFrom).
  displayName: string;
}

export const FALLBACK_ACCOUNT_NAME = "Player";

// The account name an identity starts with (A13): the provider's display
// name reduced to the account alphabet (letters, digits, underscore, hyphen;
// spaces become underscores), clamped, and passed through the name filter.
// Anything that leaves nothing usable becomes "Player"; the tag tells
// namesakes apart.
export function accountNameFrom(displayName: string): string {
  const reduced = reduceToAccountAlphabet(displayName);
  const screened = reduceToAccountAlphabet(
    censorPlayer(reduced, null).username,
  );
  return screened.length >= MIN_ACCOUNT_USERNAME_LENGTH
    ? screened
    : FALLBACK_ACCOUNT_NAME;
}

function reduceToAccountAlphabet(raw: string): string {
  const allowed = new RegExp(`[^${ACCOUNT_NAME_CHARS}]`, "g");
  return raw
    .normalize("NFKD")
    .trim()
    .replace(/\s+/g, "_")
    .replace(allowed, "")
    .replace(/_{2,}/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, MAX_ACCOUNT_USERNAME_LENGTH);
}

// The four-digit tag shown after the name (Tom.4471). Random, zero-padded,
// kept as a string so a leading zero survives.
export function newTag(): string {
  return randomInt(0, 10000).toString().padStart(4, "0");
}

// The public, shareable ID (profiles, the leaderboard's own-row marker).
// Distinct from the account ID, which is the persistentID and never shown.
export function newPublicId(): string {
  return randomBytes(9).toString("base64url");
}

export interface FindOrCreateResult {
  account: AccountRow;
  created: boolean;
}

// The account behind a provider login, created on first sight.
export function findOrCreateAccount(
  db: DatabaseSync,
  identity: ProviderIdentity,
  now: number,
): FindOrCreateResult {
  const existing = db
    .prepare(
      "SELECT account_id FROM identities WHERE provider = ? AND provider_user_id = ?",
    )
    .get(identity.provider, identity.providerUserId) as
    | { account_id: string }
    | undefined;
  if (existing !== undefined) {
    const account = accountById(db, existing.account_id);
    if (account !== null && account.deleted_at === null) {
      return { account, created: false };
    }
    // The identity points at a deleted account, which deletion should have
    // prevented (A17 erases sign-ins). Treat it as new rather than resurrect
    // the old row.
    db.prepare(
      "DELETE FROM identities WHERE provider = ? AND provider_user_id = ?",
    ).run(identity.provider, identity.providerUserId);
  }

  const account: AccountRow = {
    id: randomUUID(),
    public_id: newPublicId(),
    name: accountNameFrom(identity.displayName),
    tag: newTag(),
    name_changed_at: null,
    role: null,
    ban_reason: null,
    ban_until: null,
    created_at: now,
    deleted_at: null,
  };
  db.exec("BEGIN");
  try {
    db.prepare(
      `INSERT INTO accounts (id, public_id, name, tag, name_changed_at, role, ban_reason, ban_until, created_at, deleted_at)
       VALUES (?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, NULL)`,
    ).run(account.id, account.public_id, account.name, account.tag, now);
    db.prepare(
      `INSERT INTO identities (provider, provider_user_id, account_id, created_at)
       VALUES (?, ?, ?, ?)`,
    ).run(identity.provider, identity.providerUserId, account.id, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { account, created: true };
}

export function accountById(db: DatabaseSync, id: string): AccountRow | null {
  const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id) as
    | AccountRow
    | undefined;
  return row ?? null;
}

// The provider an account signed up with. One per account until linking
// exists (B7); it goes into the token's `provider` claim.
export function accountProvider(
  db: DatabaseSync,
  accountId: string,
): string | null {
  const row = db
    .prepare(
      "SELECT provider FROM identities WHERE account_id = ? ORDER BY created_at LIMIT 1",
    )
    .get(accountId) as { provider: string } | undefined;
  return row?.provider ?? null;
}

export interface ActiveBan {
  reason: string | null;
  // Null for a permanent ban.
  until: number | null;
}

// The ban in force on an account, if any: a reason set with no end, or an
// end still in the future.
export function activeBan(account: AccountRow, now: number): ActiveBan | null {
  if (account.ban_reason === null && account.ban_until === null) return null;
  if (account.ban_until !== null && account.ban_until <= now) return null;
  return { reason: account.ban_reason, until: account.ban_until };
}

// The token's `role` claim (§10): "banned" while a ban is in force, else
// whatever the admin script set (mod, admin), else nothing.
export function tokenRole(
  account: AccountRow,
  now: number,
): string | undefined {
  if (activeBan(account, now) !== null) return "banned";
  return account.role ?? undefined;
}

// Name.1234, as the client's helpers already understand it (§4.5).
export function displayName(account: AccountRow): string {
  return `${account.name}.${account.tag}`;
}

// GET /users/@me (§7): the account name, public ID and ban, in the shape the
// client and the game server parse today. The upstream fields that no longer
// mean anything here (subscriptions, flares, friends, clans) carry their
// empty values until UserMeResponseSchema is cut down with their last users.
// `record` is the account's numbers (§5.4, §6): the board's three values and
// the rounds played.
export function userMeResponse(
  account: AccountRow,
  now: number,
  stats: AccountStats = EMPTY_STATS,
): UserMeResponse {
  const ban = activeBan(account, now);
  return {
    user: {},
    ban:
      ban === null
        ? null
        : {
            category: "ban",
            reason: ban.reason,
            expiresAt:
              ban.until === null ? null : new Date(ban.until).toISOString(),
          },
    player: {
      publicId: account.public_id,
      adfree: true,
      unlimitedRanked: false,
      canCreatePublicLobbies: false,
      trustTier: "trusted",
      username: displayName(account),
      usernameBase: account.name,
      usernameDiscriminator: account.tag,
      nextUsernameChangeAt:
        account.name_changed_at === null
          ? null
          : new Date(
              account.name_changed_at + NAME_CHANGE_WAIT_MS,
            ).toISOString(),
      flares: [],
      achievements: { singleplayerMap: [], player: [] },
      friends: [],
      clans: [],
      subscription: null,
      record: {
        victories: victories(stats),
        reigns: stats.reigns,
        longestReign: stats.longestReign,
        gamesPlayed: stats.gamesPlayed,
      },
    },
  };
}

// The wait between renames (§11): 30 days, as upstream.
export const NAME_CHANGE_WAIT_MS = 30 * 24 * 60 * 60 * 1000;
