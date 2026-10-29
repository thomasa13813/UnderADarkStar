import { randomUUID } from "crypto";
import { DatabaseSync } from "node:sqlite";
import {
  MAX_SOLO_PRESETS,
  SoloPreset,
  SoloPresetSettings,
  SoloPresetSettingsSchema,
} from "../core/SoloPresets";

// Under a Dark Star: a signed-in player's saved solo setups
// (docs/DarkStar-Accounts.md §12.11). At most MAX_SOLO_PRESETS per account,
// one per name (names compare without case); saving under a name the player
// already has replaces that setup. Private to the account and erased with it
// (deleteAccount).

interface PresetRow {
  id: string;
  name: string;
  settings: string;
  updated_at: number;
}

export function soloPresetsFor(
  db: DatabaseSync,
  accountId: string,
): SoloPreset[] {
  const rows = db
    .prepare(
      "SELECT id, name, settings, updated_at FROM solo_presets WHERE account_id = ? ORDER BY name",
    )
    .all(accountId) as unknown as PresetRow[];
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    settings: readSettings(row.settings),
    updatedAt: row.updated_at,
  }));
}

export type SaveSoloPresetOutcome = "saved" | "full";

// Stores a setup under `name`, replacing the one already there; "full" when
// the name is new and the account already holds the most it may. The name
// and settings arrive cleaned (cleanSoloPresetName, cleanSoloPresetSettings).
export function saveSoloPreset(
  db: DatabaseSync,
  accountId: string,
  name: string,
  settings: SoloPresetSettings,
  now: number,
): SaveSoloPresetOutcome {
  const json = JSON.stringify(settings);
  db.exec("BEGIN");
  try {
    const replaced = db
      .prepare(
        "UPDATE solo_presets SET name = ?, settings = ?, updated_at = ? WHERE account_id = ? AND name = ?",
      )
      .run(name, json, now, accountId, name);
    if (replaced.changes === 0) {
      const { count } = db
        .prepare(
          "SELECT COUNT(*) AS count FROM solo_presets WHERE account_id = ?",
        )
        .get(accountId) as { count: number };
      if (count >= MAX_SOLO_PRESETS) {
        db.exec("ROLLBACK");
        return "full";
      }
      db.prepare(
        `INSERT INTO solo_presets (id, account_id, name, settings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(randomUUID(), accountId, name, json, now, now);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return "saved";
}

// Removes one of the account's setups; false when it has none by that ID.
export function deleteSoloPreset(
  db: DatabaseSync,
  accountId: string,
  id: string,
): boolean {
  return (
    db
      .prepare("DELETE FROM solo_presets WHERE account_id = ? AND id = ?")
      .run(accountId, id).changes > 0
  );
}

// A stored row reads through the same lenient schema the page uses, so a
// setup saved before a map or unit went away still lists.
function readSettings(json: string): SoloPresetSettings {
  try {
    return SoloPresetSettingsSchema.parse(JSON.parse(json));
  } catch {
    return {};
  }
}
