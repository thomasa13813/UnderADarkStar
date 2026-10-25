// @vitest-environment node
import fs from "fs";
import { DatabaseSync } from "node:sqlite";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  accountById,
  AccountRow,
  activeBan,
  findOrCreateAccount,
  renameAccount,
  tokenRole,
} from "../../src/api/Accounts";
import {
  adminDeleteAccount,
  banAccount,
  bannedAccounts,
  DEFAULT_BAN_REASON,
  describeAccount,
  findAccount,
  roundAccounts,
  searchAccounts,
  signOutEverywhere,
  unbanAccount,
} from "../../src/api/Admin";
import { openDatabase } from "../../src/api/Db";
import { createSession } from "../../src/api/Sessions";

// Under a Dark Star, B6 (docs/DarkStar-Accounts.md A18, §10): the moderation
// command's operations against a real database. Finding an account the ways
// Tom will have it in hand, bans timed and permanent, the rename, sign out
// everywhere, and deletion on request.

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

let dir: string;
let db: DatabaseSync;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "darkstar-admin-"));
  db = openDatabase(dir);
});

afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

let nextUser = 0;
function account(name: string): AccountRow {
  return findOrCreateAccount(
    db,
    {
      provider: "dev",
      providerUserId: `user-${nextUser++}`,
      displayName: name,
    },
    NOW,
  ).account;
}

const fresh = (a: AccountRow) => accountById(db, a.id)!;

describe("finding an account", () => {
  it("by public ID, by Name.1234, and by a name only one account has", () => {
    const tom = account("Tom");
    for (const query of [tom.public_id, `Tom.${tom.tag}`, "tom"]) {
      const found = findAccount(db, query);
      expect(found.kind, query).toBe("found");
      expect(found.kind === "found" && found.account.id).toBe(tom.id);
    }
  });

  it("lists namesakes rather than guess, and never finds a deleted account", () => {
    const first = account("Echo");
    account("Echo");
    expect(findAccount(db, "Echo").kind).toBe("several");
    expect(findAccount(db, "Nobody").kind).toBe("none");
    adminDeleteAccount(db, first.id, NOW);
    expect(findAccount(db, first.public_id).kind).toBe("none");
  });

  it("searches by part of a name, wildcards taken literally", () => {
    account("StarLord");
    account("Lordling");
    account("Other");
    account("100_real");
    expect(
      searchAccounts(db, "lord")
        .map((a) => a.name)
        .sort(),
    ).toEqual(["Lordling", "StarLord"]);
    // "_" is SQL's any-one-character: only the name with a real underscore.
    expect(searchAccounts(db, "_").map((a) => a.name)).toEqual(["100_real"]);
    expect(searchAccounts(db, "%")).toEqual([]);
  });

  it("names the signed-in players of a recorded round", () => {
    const alpha = account("Alpha");
    account("Bravo");
    db.prepare(
      `INSERT INTO rounds (game_id, throne_id, throne_name, throne_type, map,
         started_at, ended_at, humans, outcome, reign_after)
       VALUES ('GAME0001', 'throne-01', 'Vega', 'ffa', 'Polar', ?, ?, 2, 'overthrown', 1)`,
    ).run(NOW - 1000, NOW);
    db.prepare(
      `INSERT INTO round_players (game_id, account_id, was_hegemon, won)
       VALUES ('GAME0001', ?, 0, 1)`,
    ).run(alpha.id);
    expect(roundAccounts(db, "GAME0001").map((a) => a.id)).toEqual([alpha.id]);
    expect(roundAccounts(db, "GAME9999")).toEqual([]);
  });
});

describe("bans", () => {
  it("bans for good, carries it in the token, lists it, and lifts it", () => {
    const rude = account("Rude");
    banAccount(db, rude.id, { reason: "slurs in chat" }, NOW);
    expect(activeBan(fresh(rude), NOW + 365 * DAY)).toEqual({
      reason: "slurs in chat",
      until: null,
    });
    expect(tokenRole(fresh(rude), NOW)).toBe("banned");
    expect(bannedAccounts(db, NOW).map((a) => a.id)).toEqual([rude.id]);
    expect(describeAccount(fresh(rude), NOW)).toContain("BANNED (permanent)");

    unbanAccount(db, rude.id);
    expect(activeBan(fresh(rude), NOW)).toBeNull();
    expect(tokenRole(fresh(rude), NOW)).toBeUndefined();
    expect(bannedAccounts(db, NOW)).toEqual([]);
  });

  it("runs a timed ban out by itself, with a default reason", () => {
    const rude = account("Rude");
    banAccount(db, rude.id, { days: 7 }, NOW);
    expect(activeBan(fresh(rude), NOW + 6 * DAY)).toEqual({
      reason: DEFAULT_BAN_REASON,
      until: NOW + 7 * DAY,
    });
    expect(activeBan(fresh(rude), NOW + 7 * DAY)).toBeNull();
    expect(bannedAccounts(db, NOW + 8 * DAY)).toEqual([]);
  });
});

describe("rename, sign out, delete", () => {
  it("renames under the account rules and keeps the tag", () => {
    const rude = account("ass-player");
    expect(renameAccount(db, rude.id, "Renamed_1", NOW)).toBe("renamed");
    expect(fresh(rude)).toMatchObject({ name: "Renamed_1", tag: rude.tag });
    expect(renameAccount(db, rude.id, "no.dots", NOW)).toBe("invalid");
    expect(renameAccount(db, rude.id, "ab", NOW)).toBe("invalid");
    expect(fresh(rude).name).toBe("Renamed_1");
  });

  it("signs an account out everywhere", () => {
    const rude = account("Rude");
    createSession(db, rude.id, NOW);
    createSession(db, rude.id, NOW);
    expect(signOutEverywhere(db, rude.id, NOW)).toBe(2);
  });

  it("deletes on request even while banned", () => {
    const rude = account("Rude");
    banAccount(db, rude.id, {}, NOW);
    expect(adminDeleteAccount(db, rude.id, NOW)).toBe(true);
    expect(fresh(rude).deleted_at).toBe(NOW);
  });
});
