import { Express, Request, Response } from "express";
import { DatabaseSync } from "node:sqlite";
import {
  cleanSoloPresetName,
  cleanSoloPresetSettings,
  MAX_SOLO_PRESETS,
  SoloPresetsResponse,
} from "../core/SoloPresets";
import { accountById } from "./Accounts";
import { BearerVerifier } from "./Bearer";
import { ApiConfig } from "./Config";
import { SigningKey } from "./Keys";
import {
  deleteSoloPreset,
  saveSoloPreset,
  soloPresetsFor,
} from "./SoloPresets";

// Under a Dark Star: saved solo setups (docs/DarkStar-Accounts.md §12.11).
//
//   GET    /users/@me/solo-presets       the account's setups
//   PUT    /users/@me/solo-presets       { name, settings }: save under name
//   DELETE /users/@me/solo-presets/:id   remove one
//
// Each answers with the whole list (SoloPresetsResponseSchema), so the page
// redraws from one reply. 401 without a signed-in player; 400 for a name or
// settings outside the rules; 409 when a new name would pass
// MAX_SOLO_PRESETS; 404 for a setup the account does not have.

export interface SoloPresetDeps {
  config: ApiConfig;
  db: DatabaseSync;
  key: SigningKey;
  now?: () => number;
}

export const SOLO_PRESETS_PATH = "/users/@me/solo-presets";

export function mountSoloPresetRoutes(
  app: Express,
  deps: SoloPresetDeps,
): void {
  const { db } = deps;
  const now = deps.now ?? (() => Date.now());
  const bearer = new BearerVerifier(deps.key, deps.config);

  // The live account behind the request, or null after a 401 is sent.
  async function signedIn(req: Request, res: Response): Promise<string | null> {
    const accountId = await bearer.accountId(req);
    const account = accountId === null ? null : accountById(db, accountId);
    if (account === null || account.deleted_at !== null) {
      res.status(401).json({ error: "unauthorized" });
      return null;
    }
    return account.id;
  }

  const list = (accountId: string): SoloPresetsResponse => ({
    presets: soloPresetsFor(db, accountId),
  });

  app.get(SOLO_PRESETS_PATH, async (req, res, next) => {
    try {
      const accountId = await signedIn(req, res);
      if (accountId === null) return;
      res.json(list(accountId));
    } catch (error) {
      next(error);
    }
  });

  app.put(SOLO_PRESETS_PATH, async (req, res, next) => {
    try {
      const accountId = await signedIn(req, res);
      if (accountId === null) return;
      const name = cleanSoloPresetName(req.body?.name);
      const settings = cleanSoloPresetSettings(req.body?.settings);
      if (name === null || settings === null) {
        res.status(400).json({ error: "invalid preset" });
        return;
      }
      if (saveSoloPreset(db, accountId, name, settings, now()) === "full") {
        res
          .status(409)
          .json({ error: "too many presets", max: MAX_SOLO_PRESETS });
        return;
      }
      res.json(list(accountId));
    } catch (error) {
      next(error);
    }
  });

  app.delete(`${SOLO_PRESETS_PATH}/:id`, async (req, res, next) => {
    try {
      const accountId = await signedIn(req, res);
      if (accountId === null) return;
      if (!deleteSoloPreset(db, accountId, req.params.id)) {
        res.status(404).json({ error: "no such preset" });
        return;
      }
      res.json(list(accountId));
    } catch (error) {
      next(error);
    }
  });
}
