import express, { Express, NextFunction, Request, Response } from "express";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { GameRecordSchema, ID } from "../core/Schemas";
import { ApiConfig } from "./Config";
import { RecordStore } from "./Records";
import { ingestRecord } from "./Results";

// Under a Dark Star: the game record routes (docs/DarkStar-Accounts.md §5.3,
// §7, accounts step B4). The game server posts a finished game's record
// here (Archive.archive); the API keeps it for a while and, for a public
// throne round, records the result. Anyone may read a kept record back.

export interface ResultDeps {
  config: ApiConfig;
  db: DatabaseSync;
  records: RecordStore;
  log: Pick<Console, "info" | "warn" | "error">;
  now?: () => number;
}

// A full record carries every turn of the round: far more than the API's
// usual 1 MB JSON limit. Bounded all the same, so a runaway record cannot
// fill memory.
export const RECORD_BODY_LIMIT = "64mb";

export function mountResultRoutes(app: Express, deps: ResultDeps): void {
  const { config, db, records, log } = deps;
  const now = deps.now ?? (() => Date.now());
  const recordBody = express.json({ limit: RECORD_BODY_LIMIT });

  const requireApiKey = (req: Request, res: Response, next: NextFunction) => {
    if (req.headers["x-api-key"] !== config.apiKey) {
      res.status(401).json({ error: "bad api key" });
      return;
    }
    next();
  };

  // A finished multiplayer game from the game server. 201 recorded (a public
  // throne round), 202 kept but not a round, 200 seen before. A record that
  // does not parse is refused: the game server validated it before posting,
  // so this is a version skew worth a log line, never something to store.
  app.post("/game/:id", requireApiKey, recordBody, (req, res, next) => {
    try {
      const gameID = req.params.id;
      if (!ID.safeParse(gameID).success) {
        res.status(400).json({ error: "bad game ID" });
        return;
      }
      const parsed = GameRecordSchema.safeParse(req.body);
      if (!parsed.success) {
        log.warn(
          `game record ${gameID} refused: ${z.prettifyError(parsed.error).slice(0, 500)}`,
        );
        res.status(400).json({ error: "invalid game record" });
        return;
      }
      const record = parsed.data;
      if (record.info.gameID !== gameID) {
        res.status(400).json({ error: "game ID mismatch" });
        return;
      }
      if (records.has(gameID)) {
        res.status(200).json({ ok: true, duplicate: true });
        return;
      }
      const result = ingestRecord(db, record, now());
      records.write(record);
      if (result.kind === "recorded") {
        log.info(
          `round recorded: ${gameID} on ${record.info.throne?.name} ` +
            `${result.outcome}, reign ${result.reignAfter}, ` +
            `${result.verifiedPlayers} signed in, winner ` +
            (result.winnerAccount === null ? "unverified" : "credited"),
        );
        res.status(201).json({ ok: true, recorded: true });
      } else if (result.kind === "duplicate") {
        res.status(200).json({ ok: true, duplicate: true });
      } else {
        log.info(`game record kept, not a round (${result.reason}): ${gameID}`);
        res.status(202).json({ ok: true, recorded: false });
      }
    } catch (error) {
      next(error);
    }
  });

  // A kept record, PII scrubbed, for the client's replay check and the
  // preview route. 404 once retention has removed it, or for a game that was
  // never posted.
  app.get("/game/:id", (req, res) => {
    const json = records.readJson(req.params.id);
    if (json === null) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    res.type("application/json").send(json);
  });
}
