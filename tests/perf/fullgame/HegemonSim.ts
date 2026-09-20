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
      return {
        ...d,
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

  let turn = 0;
  let startTurn: number | null = null;
  while (win === undefined && fatal === undefined) {
    runner.addTurn({ turnNumber: turn++, intents: [] });
    runner.executeNextTick();
    if (game.inSpawnPhase()) continue;
    startTurn ??= turn;
    const elapsed = turn - startTurn;
    // Once a minute, and every 5 seconds while the Dark Star is under attack.
    const underAttack = hegemon.numTilesOwned() < g.domainTileCount;
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
