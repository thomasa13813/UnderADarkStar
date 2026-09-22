/**
 * Headless AI-only Hegemon round, for calibrating Hegemon strength (F1 in
 * docs/DarkStar-Design.md). Runs the real pipeline (GameRunner, nations from
 * the map manifest, bots) with hegemon mode on and prints, once per game
 * minute, how the Hegemon compares with its challengers, then how the round
 * ended.
 *
 * Usage:
 *   npx tsx tests/perf/fullgame/HegemonSim.ts [--map milkyway] [--bots 400]
 *                                             [--minutes 20] [--seed hegemon-sim]
 *                                             [--loss 100] [--slow 100] [--ceiling 100]
 *
 * Troop figures are the sim's; the HUD shows them divided by 10.
 */
import path from "path";
import { fileURLToPath } from "url";
import { Config } from "../../../src/core/configuration/Config";
import { Executor } from "../../../src/core/execution/ExecutionManager";
import {
  Difficulty,
  GameMapSize,
  GameMapType,
  GameMode,
  GameType,
  Player,
  UnitType,
} from "../../../src/core/game/Game";
import { createGame } from "../../../src/core/game/GameImpl";
import { GameUpdateType, WinUpdate } from "../../../src/core/game/GameUpdates";
import { createNationsForGame } from "../../../src/core/game/NationCreation";
import { loadTerrainMap } from "../../../src/core/game/TerrainMapLoader";
import { GameRunner } from "../../../src/core/GameRunner";
import { PseudoRandom } from "../../../src/core/PseudoRandom";
import { GameConfig, GameStartInfo } from "../../../src/core/Schemas";
import { simpleHash } from "../../../src/core/Util";
import { NodeGameMapLoader } from "./NodeGameMapLoader";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] !== undefined
    ? process.argv[i + 1]
    : fallback;
}

function resolveMap(name: string): GameMapType {
  const key = Object.keys(GameMapType).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  if (key === undefined) throw new Error(`unknown map "${name}"`);
  return GameMapType[key as keyof typeof GameMapType];
}

const k = (n: number): string => `${Math.round(n / 1000)}k`;

async function main(): Promise<void> {
  console.debug = () => {};
  const log = console.log;
  console.log = () => {}; // the sim is chatty
  const minutes = Number(arg("minutes", "20"));

  const gameConfig: GameConfig = {
    gameMap: resolveMap(arg("map", "milkyway")),
    gameMapSize: GameMapSize.Normal,
    gameMode: GameMode.FFA,
    gameType: GameType.Public,
    difficulty: Difficulty.Medium,
    nations: "default",
    donateGold: false,
    donateTroops: false,
    bots: Number(arg("bots", "400")),
    infiniteGold: false,
    infiniteTroops: false,
    instantBuild: false,
    randomSpawn: false,
    maxTimerValue: minutes,
    hegemon: { enabled: true },
  };
  const gameStart: GameStartInfo = {
    gameID: arg("seed", "hegemon-sim"),
    lobbyCreatedAt: 0,
    config: gameConfig,
    players: [],
  };

  // --loss / --slow / --ceiling try out HEGEMON_DEFAULTS values without editing them.
  class SimConfig extends Config {
    hegemonConfig() {
      const d = super.hegemonConfig();
      // --set razeSlowPercent=200,tyrannyFloorPermille=0 overrides any tunable.
      const set: Record<string, number> = {};
      for (const pair of arg("set", "").split(",")) {
        const [key, value] = pair.split("=");
        if (key === "") continue;
        if (!(key in d)) throw new Error(`--set: no tunable ${key}`);
        set[key] = Number(value);
      }
      return {
        ...d,
        ...set,
        domainAttackerLossPercent: Number(
          arg("loss", String(d.domainAttackerLossPercent)),
        ),
        domainConquestSlowPercent: Number(
          arg("slow", String(d.domainConquestSlowPercent)),
        ),
        troopCeilingPercentOfWholeMapCap: Number(
          arg("ceiling", String(d.troopCeilingPercentOfWholeMapCap)),
        ),
      };
    }
  }
  const config = new SimConfig(gameConfig, null, false);
  const terrain = await loadTerrainMap(
    gameConfig.gameMap,
    gameConfig.gameMapSize,
    new NodeGameMapLoader(path.join(PROJECT_ROOT, "resources/maps")),
  );
  const nations = createNationsForGame(
    gameStart,
    terrain.nations,
    terrain.additionalNations,
    0,
    new PseudoRandom(simpleHash(gameStart.gameID)),
  );
  const game = createGame(
    [],
    nations,
    terrain.gameMap,
    terrain.miniGameMap,
    config,
    terrain.teamGameSpawnAreas,
  );

  let win: WinUpdate | undefined;
  let fatal: string | undefined;
  const runner = new GameRunner(
    game,
    new Executor(game, gameStart.gameID, undefined),
    (gu) => {
      if ("errMsg" in gu) {
        fatal = `${gu.errMsg}\n${gu.stack ?? ""}`;
        return;
      }
      const wins = gu.updates[GameUpdateType.Win] as WinUpdate[];
      if (wins.length > 0) win = wins[0];
    },
  );
  runner.init();

  const hegemon = game.hegemon()!;
  const g = game.darkStar()!;
  log(
    `${gameConfig.gameMap}: domain r=${g.radius} (${g.domainTileCount} tiles), ` +
      `moat ${g.moatWidth}, Hegemon ceiling ${k(config.hegemonMaxTroops())}, ` +
      `gold/tick ${config.hegemonGoldPerTick()}`,
  );
  log(
    "min | heg troops | heg tiles | invaders | strongest challenger (troops, tiles) | all challengers' troops",
  );

  // Round summary: every landing (a new holder of the invasion slot), and how
  // close the Dark Star came to falling.
  const landings: string[] = [];
  let lastInvader: Player | null = null;
  let lowestTiles = g.domainTileCount;
  let lowestTroops = hegemon.troops();
  let turn = 0;
  let startTurn: number | null = null;
  let strike: {
    target: Player;
    tiles: number;
    troops: number;
    cities: number;
    sent: number;
    left: number;
    start: number;
    minTiles: number;
    maxBubble: number;
    fought: boolean; // the target counter-attacked the bubble
    popped: number; // tiles left neutral when the bubble popped
  } | null = null;
  const strikeTotals = { count: 0, sent: 0, lost: 0, popped: 0, fought: 0 };
  while (win === undefined && fatal === undefined) {
    runner.addTurn({ turnNumber: turn++, intents: [] });
    runner.executeNextTick();
    if (game.inSpawnPhase()) continue;
    startTurn ??= turn;
    const elapsed = turn - startTurn;

    const invader = game.darkStarInvader();
    if (invader !== null && invader !== lastInvader) {
      landings.push(`${invader.name()}@${(elapsed / 600).toFixed(1)}`);
    }
    lastInvader = invader;
    lowestTiles = Math.min(lowestTiles, game.hegemonDomainTiles());
    lowestTroops = Math.min(lowestTroops, hegemon.troops());

    // Raze strikes (H8/H11): logged as they land and as they end.
    const razing = hegemon
      .outgoingAttacks()
      .find((a) => a.sourceTile() !== null);
    if (razing !== undefined && strike === null) {
      const target = razing.target() as Player;
      strike = {
        target,
        tiles: target.numTilesOwned(),
        troops: target.troops(),
        cities: target.units(UnitType.City).length,
        sent: razing.troops(),
        left: razing.troops(),
        start: elapsed,
        minTiles: target.numTilesOwned(),
        maxBubble: 0,
        fought: false,
        popped: 0,
      };
    } else if (razing !== undefined && strike !== null) {
      strike.left = razing.troops();
      strike.minTiles = Math.min(
        strike.minTiles,
        strike.target.numTilesOwned(),
      );
      const bubble = game.hegemonBubbleTiles();
      strike.maxBubble = Math.max(strike.maxBubble, bubble);
      // Last seen bubble: what pops if the strike ends now.
      strike.popped = bubble;
      strike.fought ||= strike.target
        .outgoingAttacks()
        .some((a) => a.target() === hegemon);
    } else if (razing === undefined && strike !== null) {
      const t = strike.target;
      log(
        `      strike @${(strike.start / 600).toFixed(2)} on ${t.name()}: sent ${k(strike.sent)}, ` +
          `${((elapsed - strike.start) / 10).toFixed(0)}s, ~${k(strike.left)} left at the end; ` +
          `target tiles ${strike.tiles} -> ${t.numTilesOwned()}, troops ${k(strike.troops)} -> ${k(t.troops())}, ` +
          `cities ${strike.cities} -> ${t.units(UnitType.City).length}; ` +
          `bubble peaked at ${strike.maxBubble}, popped ${strike.popped} to neutral${strike.fought ? ", fought" : ""}`,
      );
      strikeTotals.count++;
      strikeTotals.sent += strike.sent;
      strikeTotals.lost += strike.sent - strike.left;
      strikeTotals.popped += strike.popped;
      if (strike.fought) strikeTotals.fought++;
      strike = null;
    }

    // Once a minute, and every 5 seconds while the Dark Star is under attack.
    const underAttack = game.darkStarInvader() !== null;
    if (elapsed % (underAttack ? 50 : 600) !== 0) continue;

    const challengers = game.players().filter((p) => p !== hegemon);
    const invaders = new Set<string>();
    for (const p of challengers) {
      if (p.numTilesOwned() === 0) continue;
      // Cheap: sample the player's border tiles rather than every tile.
      for (const t of p.borderTiles()) {
        if (game.isInDarkStar(t)) {
          invaders.add(p.name());
          break;
        }
      }
    }
    const strongest = challengers
      .slice()
      .sort((a, b) => b.troops() - a.troops())[0];
    const total = challengers.reduce((sum, p) => sum + p.troops(), 0);
    log(
      `${(elapsed / 600).toFixed(2).padStart(5)} | ${k(hegemon.troops()).padStart(10)} | ` +
        `${String(hegemon.numTilesOwned()).padStart(9)} | ` +
        `${[...invaders].join(", ") || "-"} | ` +
        `${strongest?.name()} (${k(strongest?.troops() ?? 0)}, ${strongest?.numTilesOwned()}) | ${k(total)}`,
    );
  }

  if (fatal !== undefined) throw new Error(fatal);
  log(
    `Summary: ${landings.length} landings [${landings.join(", ")}]; domain low ` +
      `${Math.round((lowestTiles * 100) / g.domainTileCount)}%, Hegemon troops low ${k(lowestTroops)}`,
  );
  log(
    `Strikes: ${strikeTotals.count} (${strikeTotals.fought} fought), sent ${k(strikeTotals.sent)}, lost ${k(strikeTotals.lost)}, popped ${strikeTotals.popped} tiles to neutral` +
      (strikeTotals.popped > 0
        ? ` = ${Math.round(strikeTotals.lost / strikeTotals.popped)} troops/tile`
        : ""),
  );
  const seconds = Math.round((turn - (startTurn ?? turn)) / 10);
  log(
    `Round over after ${Math.floor(seconds / 60)}m${seconds % 60}s: winner ${JSON.stringify(win!.winner)}` +
      (game.hegemonSlayer()
        ? ` (slayer: ${game.hegemonSlayer()!.name()})`
        : ""),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
