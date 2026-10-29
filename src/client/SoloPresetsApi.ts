import { z } from "zod";
import {
  cleanSoloPresetName,
  cleanSoloPresetSettings,
  MAX_SOLO_PRESETS,
  SoloPreset,
  SoloPresetSchema,
  SoloPresetSettings,
  SoloPresetsResponseSchema,
} from "../core/SoloPresets";
import { getApiBase } from "./ApiBase";
import { getAuthHeader } from "./Auth";
import { generateCryptoRandomUUID } from "./Utils";

// Under a Dark Star: where the solo screen's saved setups live
// (docs/DarkStar-Accounts.md §12.11). A signed-in player's are on the account
// (SoloPresetRoutes.ts) and follow them to any device; a guest's stay in this
// browser under the same rules (MAX_SOLO_PRESETS, one per name). The two are
// separate lists: signing in shows the account's, signing out the browser's.

export const SOLO_PRESETS_TIMEOUT_MS = 10_000;
export const LOCAL_SOLO_PRESETS_KEY = "darkstar_solo_presets";

export type SoloPresetsResult =
  | { ok: true; presets: SoloPreset[] }
  // full: a new name past MAX_SOLO_PRESETS; invalid: a name or settings
  // outside the rules; failed: the API could not be reached or refused.
  | { ok: false; code: "full" | "invalid" | "failed" };

export interface SoloPresetStore {
  list(): Promise<SoloPresetsResult>;
  save(name: string, settings: SoloPresetSettings): Promise<SoloPresetsResult>;
  remove(id: string): Promise<SoloPresetsResult>;
}

export function soloPresetStore(signedIn: boolean): SoloPresetStore {
  return signedIn ? accountStore : new LocalSoloPresetStore();
}

const accountStore: SoloPresetStore = {
  list: () => request("GET", ""),
  save: (name, settings) =>
    request("PUT", "", JSON.stringify({ name, settings })),
  remove: (id) => request("DELETE", `/${encodeURIComponent(id)}`),
};

async function request(
  method: "GET" | "PUT" | "DELETE",
  suffix: string,
  body?: string,
): Promise<SoloPresetsResult> {
  try {
    const auth = await getAuthHeader();
    if (auth === "") return { ok: false, code: "failed" };
    const response = await fetch(
      `${getApiBase()}/users/@me/solo-presets${suffix}`,
      {
        method,
        headers: {
          Authorization: auth,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body,
        signal: AbortSignal.timeout(SOLO_PRESETS_TIMEOUT_MS),
      },
    );
    if (response.status === 409) return { ok: false, code: "full" };
    if (response.status === 400) return { ok: false, code: "invalid" };
    if (!response.ok) {
      console.warn(`solo presets: ${response.status}`);
      return { ok: false, code: "failed" };
    }
    const parsed = SoloPresetsResponseSchema.safeParse(await response.json());
    if (!parsed.success) {
      console.warn("solo presets: unexpected answer", parsed.error);
      return { ok: false, code: "failed" };
    }
    return { ok: true, presets: parsed.data.presets };
  } catch (error) {
    console.warn("solo presets: unreachable", error);
    return { ok: false, code: "failed" };
  }
}

// A guest's setups, in localStorage. Storage that is blocked or full reads
// as empty and refuses to save.
export class LocalSoloPresetStore implements SoloPresetStore {
  constructor(private readonly now: () => number = () => Date.now()) {}

  async list(): Promise<SoloPresetsResult> {
    return { ok: true, presets: this.read() };
  }

  async save(
    rawName: string,
    rawSettings: SoloPresetSettings,
  ): Promise<SoloPresetsResult> {
    const name = cleanSoloPresetName(rawName);
    const settings = cleanSoloPresetSettings(rawSettings);
    if (name === null || settings === null) {
      return { ok: false, code: "invalid" };
    }
    const presets = this.read();
    const existing = presets.find(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    );
    if (existing === undefined && presets.length >= MAX_SOLO_PRESETS) {
      return { ok: false, code: "full" };
    }
    const saved: SoloPreset = {
      id: existing?.id ?? generateCryptoRandomUUID(),
      name,
      settings,
      updatedAt: this.now(),
    };
    return this.write([...presets.filter((p) => p !== existing), saved]);
  }

  async remove(id: string): Promise<SoloPresetsResult> {
    return this.write(this.read().filter((p) => p.id !== id));
  }

  private read(): SoloPreset[] {
    try {
      const raw = localStorage.getItem(LOCAL_SOLO_PRESETS_KEY);
      if (raw === null) return [];
      const parsed = z.array(SoloPresetSchema).safeParse(JSON.parse(raw));
      return parsed.success ? byName(parsed.data) : [];
    } catch {
      return [];
    }
  }

  private write(presets: SoloPreset[]): SoloPresetsResult {
    try {
      localStorage.setItem(LOCAL_SOLO_PRESETS_KEY, JSON.stringify(presets));
      return { ok: true, presets: byName(presets) };
    } catch {
      return { ok: false, code: "failed" };
    }
  }
}

// The order the API lists them in: by name, any case.
function byName(presets: SoloPreset[]): SoloPreset[] {
  return [...presets].sort((a, b) =>
    a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
  );
}
