import { describe, expect, it, vi } from "vitest";
import { Difficulty, GameMapType, GameMode } from "../../src/core/game/Game";
import { GameConfigSchema } from "../../src/core/Schemas";
import {
  THRONE_EXCLUSIVE_PAIRS,
  THRONE_MAX_MODIFIERS,
  THRONE_MODIFIER_WHITELIST,
  isThroneModifier,
  validateThroneModifiers,
} from "../../src/core/ThroneModifiers";
import {
  MUTUALLY_EXCLUSIVE_MODIFIERS,
  MapPlaylist,
  SPECIAL_MODIFIER_POOL,
} from "../../src/server/MapPlaylist";
import {
  modifierKeysOf,
  throneConfigPatch,
} from "../../src/server/MasterLobbyService";

vi.mock("../../src/server/Logger", () => ({
  logger: { child: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) },
}));
vi.mock("../../src/server/MapLandTiles", () => ({
  getMapLandTiles: async () => 1_000_000,
}));

// Under a Dark Star, T4 (docs/DarkStar-Lobbies.md §5.4): what a special
// throne's winner may set. The whitelist is a subset of the playlist's pool,
// its exclusivity table agrees with the playlist's, a pick is validated, and
// the playlist can rebuild a special round from an explicit modifier set
// without rolling anything.

describe("the throne modifier whitelist", () => {
  it("is a subset of the special modifier pool", () => {
    for (const key of THRONE_MODIFIER_WHITELIST) {
      expect(SPECIAL_MODIFIER_POOL).toContain(key);
    }
  });

  it("holds back the modifiers Tom kept for a balance pass, and the moot ones", () => {
    for (const held of [
      "startingGold25M",
      "isDoomsdayClock",
      "isNukesDisabled",
      "isSAMsDisabled",
      "isWaterNukes",
    ]) {
      expect(isThroneModifier(held)).toBe(false);
    }
  });

  it("lists every exclusive pair of the playlist that falls inside the whitelist", () => {
    const inside = MUTUALLY_EXCLUSIVE_MODIFIERS.filter(
      ([a, b]) => isThroneModifier(a) && isThroneModifier(b),
    );
    expect(inside.length).toBeGreaterThan(0);
    for (const [a, b] of inside) {
      expect(
        THRONE_EXCLUSIVE_PAIRS.some(
          ([x, y]) => (x === a && y === b) || (x === b && y === a),
        ),
      ).toBe(true);
    }
    expect(THRONE_EXCLUSIVE_PAIRS).toHaveLength(inside.length);
  });

  it("validates a pick: whitelist, no repeats, at most two, no exclusive pair", () => {
    expect(validateThroneModifiers([])).toEqual([]);
    expect(validateThroneModifiers(["isCompact"])).toEqual(["isCompact"]);
    expect(validateThroneModifiers(["isCompact", "goldMultiplier"])).toEqual([
      "isCompact",
      "goldMultiplier",
    ]);
    expect(THRONE_MAX_MODIFIERS).toBe(2);
    expect(
      validateThroneModifiers(["isCompact", "goldMultiplier", "isPeaceTime"]),
    ).toBeNull();
    expect(validateThroneModifiers(["isCompact", "isCompact"])).toBeNull();
    expect(validateThroneModifiers(["startingGold25M"])).toBeNull();
    expect(validateThroneModifiers(["not-a-modifier"])).toBeNull();
    expect(
      validateThroneModifiers(["startingGold1M", "startingGold5M"]),
    ).toBeNull();
  });
});

describe("MapPlaylist.throneSpecialConfig", () => {
  it("builds an FFA special round from exactly the chosen modifiers", async () => {
    const playlist = new MapPlaylist();
    const config = await playlist.throneSpecialConfig(
      GameMapType.EventHorizon,
      ["startingGold5M", "isHardNations"],
    );
    expect(GameConfigSchema.safeParse(config).success).toBe(true);
    expect(config.gameMode).toBe(GameMode.FFA);
    expect(config.gameMap).toBe(GameMapType.EventHorizon);
    expect(config.hegemon).toEqual({ enabled: true });
    expect(config.publicGameModifiers).toMatchObject({
      startingGold: 5_000_000,
      isHardNations: true,
    });
    expect(config.startingGold).toBe(5_000_000);
    expect(config.difficulty).toBe(Difficulty.Hard);
    // Nothing else was rolled in.
    expect(modifierKeysOf(config.publicGameModifiers).sort()).toEqual([
      "isHardNations",
      "startingGold5M",
    ]);
    expect(config.trusted).toBeUndefined();
  });

  it("gives an empty pick a plain special round, and is deterministic", async () => {
    const playlist = new MapPlaylist();
    for (let i = 0; i < 5; i++) {
      const config = await playlist.throneSpecialConfig(GameMapType.Sol, []);
      expect(modifierKeysOf(config.publicGameModifiers)).toEqual([]);
      expect(config.startingGold).toBeUndefined();
      expect(config.difficulty).toBe(Difficulty.Medium);
      expect(config.gameMode).toBe(GameMode.FFA);
    }
  });

  it("does not advance the trusted rotation", async () => {
    const playlist = new MapPlaylist();
    for (let i = 0; i < 6; i++) {
      await playlist.throneSpecialConfig(GameMapType.Sol, ["isCompact"]);
    }
    expect((await playlist.gameConfig("ffa")).trusted).toBeUndefined();
  });

  it("rolls FFA for a special throne when asked", async () => {
    const playlist = new MapPlaylist();
    for (let i = 0; i < 6; i++) {
      const config = await playlist.gameConfig("special", {
        mode: GameMode.FFA,
      });
      expect(config.gameMode).toBe(GameMode.FFA);
      expect(config.hegemon).toEqual({ enabled: true });
    }
  });
});

describe("modifierKeysOf and throneConfigPatch", () => {
  it("round-trips the rolled modifiers into keys", () => {
    expect(
      modifierKeysOf({
        isCompact: true,
        startingGold: 1_000_000,
        goldMultiplier: 2,
        isPeaceTime: true,
      }).sort(),
    ).toEqual(["goldMultiplier", "isCompact", "isPeaceTime", "startingGold1M"]);
    expect(modifierKeysOf(undefined)).toEqual([]);
  });

  it("carries every key the pick may change, explicit undefined included", async () => {
    const config = await new MapPlaylist().throneSpecialConfig(
      GameMapType.Sol,
      [],
    );
    const patch = throneConfigPatch(config);
    expect(Object.keys(patch).sort()).toEqual(
      [
        "bots",
        "difficulty",
        "disableAlliances",
        "disabledUnits",
        "doomsdayClock",
        "gameMap",
        "gameMapSize",
        "goldMultiplier",
        "maxPlayers",
        "nations",
        "publicGameModifiers",
        "randomSpawn",
        "spawnImmunityDuration",
        "startingGold",
        "waterNukes",
      ].sort(),
    );
    expect("startingGold" in patch).toBe(true);
    expect(patch.startingGold).toBeUndefined();
    expect("gameType" in patch).toBe(false);
    expect("hegemon" in patch).toBe(false);
  });
});
