import { z } from "zod";
import {
  DOOMSDAY_CLOCK_SPEEDS,
  DoomsdayClockSpeed,
} from "./game/DoomsdayClock";
import {
  Difficulty,
  Duos,
  GameMapType,
  GameMode,
  HumansVsNations,
  Quads,
  Trios,
} from "./game/Game";

// Under a Dark Star: saved solo setups (docs/DarkStar-Accounts.md §12.11).
// A player names the solo screen's settings and loads them again later; a
// signed-in player's setups live in the account API, a guest's in their
// browser. The settings are what the solo screen shows, not a GameConfig:
// the screen turns them into one when the game starts, as it always has.
//
// Every field is optional and reads leniently: a value the game no longer
// knows (a map taken out, a unit renamed, a range tightened) reads as
// "absent", and the screen keeps its default for it. So a setup saved long
// ago still loads, minus what has gone, and the API can store what a newer
// page sends without knowing every field.

export const MAX_SOLO_PRESETS = 5;
export const SOLO_PRESET_NAME_MAX = 32;

const TEAM_COUNTS = [Duos, Trios, Quads, HumansVsNations] as const;

// A value that reads as absent when it is anything else.
function lenient<T extends z.ZodType>(schema: T) {
  return schema.optional().catch(undefined);
}

const minutes = (min: number, max: number) =>
  lenient(z.number().int().min(min).max(max));

export const SoloPresetSettingsSchema = z.object({
  map: lenient(z.enum(GameMapType)),
  randomMap: lenient(z.boolean()),
  difficulty: lenient(z.enum(Difficulty)),
  gameMode: lenient(z.enum(GameMode)),
  teamCount: lenient(
    z.union([z.number().int().min(2).max(64), z.enum(TEAM_COUNTS)]),
  ),
  bots: lenient(z.number().int().min(0).max(400)),
  nations: lenient(z.number().int().min(0).max(400)),
  compactMap: lenient(z.boolean()),
  playAsHegemon: lenient(z.boolean()),
  piracy: lenient(z.boolean()),
  instantBuild: lenient(z.boolean()),
  randomSpawn: lenient(z.boolean()),
  infiniteGold: lenient(z.boolean()),
  infiniteTroops: lenient(z.boolean()),
  doomsdayClock: lenient(z.boolean()),
  doomsdayClockSpeed: lenient(
    z.enum(
      DOOMSDAY_CLOCK_SPEEDS as [DoomsdayClockSpeed, ...DoomsdayClockSpeed[]],
    ),
  ),
  maxTimer: lenient(z.boolean()),
  maxTimerMinutes: minutes(1, 120),
  goldMultiplier: lenient(z.boolean()),
  goldMultiplierValue: lenient(z.number().min(0.1).max(1000)),
  startingGold: lenient(z.boolean()),
  startingGoldValue: lenient(z.number().min(0.1).max(1000)),
  customAlliances: lenient(z.boolean()),
  customAllianceMinutes: minutes(0, 15),
  overtime: lenient(z.boolean()),
  overtimeStartMinutes: minutes(1, 120),
  // Unit type names; the screen keeps only the ones it still knows.
  disabledUnits: lenient(z.array(z.string().max(40)).max(40)),
});
export type SoloPresetSettings = z.infer<typeof SoloPresetSettingsSchema>;

export const SoloPresetSchema = z.object({
  id: z.string(),
  name: z.string(),
  settings: SoloPresetSettingsSchema,
  updatedAt: z.number(),
});
export type SoloPreset = z.infer<typeof SoloPresetSchema>;

export const SoloPresetsResponseSchema = z.object({
  presets: z.array(SoloPresetSchema),
});
export type SoloPresetsResponse = z.infer<typeof SoloPresetsResponseSchema>;

// A setup's name as stored: trimmed, inner runs of whitespace made one space,
// 1 to SOLO_PRESET_NAME_MAX characters, no control characters. Null when
// nothing usable is left. Names are private to their owner, so the name
// filter does not apply.
export function cleanSoloPresetName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(raw)) return null;
  const name = raw.trim().replace(/\s+/g, " ");
  if (name === "" || [...name].length > SOLO_PRESET_NAME_MAX) return null;
  return name;
}

// The settings to store, or null when the body is not an object. Values the
// schema does not accept are dropped, not refused (above); its bounds keep a
// stored setup under about 2 KB, so there is no separate size limit.
export function cleanSoloPresetSettings(
  raw: unknown,
): SoloPresetSettings | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const parsed = SoloPresetSettingsSchema.safeParse(raw);
  return parsed.success ? dropAbsent(parsed.data) : null;
}

function dropAbsent(settings: SoloPresetSettings): SoloPresetSettings {
  return Object.fromEntries(
    Object.entries(settings).filter(([, v]) => v !== undefined),
  ) as SoloPresetSettings;
}
