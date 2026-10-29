import { describe, expect, it } from "vitest";
import {
  Difficulty,
  GameMapType,
  GameMode,
  Trios,
} from "../../src/core/game/Game";
import {
  cleanSoloPresetName,
  cleanSoloPresetSettings,
  SOLO_PRESET_NAME_MAX,
  SoloPresetSettingsSchema,
} from "../../src/core/SoloPresets";

// Under a Dark Star, saved solo setups (docs/DarkStar-Accounts.md §12.11):
// the shared format reads leniently, so a setup outlives a map or unit that
// goes away, and names are cleaned the same way on the page and the API.

describe("SoloPresetSettingsSchema", () => {
  it("keeps every value the solo screen can hold", () => {
    const full = {
      map: GameMapType.EventHorizon,
      randomMap: false,
      difficulty: Difficulty.Impossible,
      gameMode: GameMode.Team,
      teamCount: Trios,
      bots: 0,
      nations: 400,
      compactMap: true,
      playAsHegemon: true,
      piracy: false,
      instantBuild: true,
      randomSpawn: true,
      infiniteGold: true,
      infiniteTroops: true,
      doomsdayClock: true,
      doomsdayClockSpeed: "veryfast",
      maxTimer: true,
      maxTimerMinutes: 120,
      goldMultiplier: true,
      goldMultiplierValue: 0.1,
      startingGold: true,
      startingGoldValue: 1000,
      customAlliances: true,
      customAllianceMinutes: 0,
      overtime: true,
      overtimeStartMinutes: 1,
      disabledUnits: ["Warship", "Atom Bomb"],
    };
    expect(SoloPresetSettingsSchema.parse(full)).toEqual(full);
    expect(SoloPresetSettingsSchema.parse({ teamCount: 7 })).toEqual({
      teamCount: 7,
    });
  });

  it("reads an unknown or out-of-range value as absent, not as an error", () => {
    const parsed = SoloPresetSettingsSchema.parse({
      map: "Retired Map",
      difficulty: "Nightmare",
      teamCount: "Octets",
      bots: 401,
      nations: -1,
      doomsdayClockSpeed: "ludicrous",
      maxTimerMinutes: 1.5,
      goldMultiplierValue: 0,
      customAllianceMinutes: 16,
      piracy: "yes",
      disabledUnits: "Warship",
      instantBuild: true,
    });
    expect(cleanSoloPresetSettings(parsed)).toEqual({ instantBuild: true });
  });
});

describe("cleanSoloPresetSettings", () => {
  it("drops fields it does not know and refuses what is not an object", () => {
    expect(cleanSoloPresetSettings({ bots: 3, colour: "red" })).toEqual({
      bots: 3,
    });
    for (const raw of [null, undefined, [], "x", 4]) {
      expect(cleanSoloPresetSettings(raw)).toBeNull();
    }
  });
});

describe("cleanSoloPresetName", () => {
  it("trims and folds whitespace", () => {
    expect(cleanSoloPresetName("  Hard   Hegemon  ")).toBe("Hard Hegemon");
    expect(cleanSoloPresetName("x".repeat(SOLO_PRESET_NAME_MAX))).toHaveLength(
      SOLO_PRESET_NAME_MAX,
    );
  });

  it("refuses empty, long, control-character and non-string names", () => {
    for (const raw of [
      "",
      "   ",
      "x".repeat(SOLO_PRESET_NAME_MAX + 1),
      "line\nbreak",
      null,
      7,
    ]) {
      expect(cleanSoloPresetName(raw)).toBeNull();
    }
  });
});
