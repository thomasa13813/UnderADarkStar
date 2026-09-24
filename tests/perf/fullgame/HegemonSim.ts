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
 *                                             [--set key=value,...] [--human]
 *                                             [--difficulty easy|medium|hard|impossible]
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
  PlayerInfo,
  PlayerType,
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

function resolveDifficulty(name: string): Difficulty {
  const key = Object.keys(Difficulty).find(
    (k) => k.toLowerCase() === name.toLowerCase(),
  );
  if (key === undefined) throw new Error(`unknown difficulty "${name}"`);
  return Difficulty[key as keyof typeof Difficulty];
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
    difficulty: resolveDifficulty(arg("difficulty", "medium")),
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
  // --human seats a human on the throne who does nothing at all: no response
  // waves, no punitive strikes — only the stall routing every Hegemon gets
  // (H13). The floor a real player starts from.
  const humans = process.argv.includes("--human")
    ? [
        new PlayerInfo(
          "You",
          PlayerType.Human,
          "human",
          "human",
          false,
          null,
          [],
          null,
          null,
          true,
        ),
      ]
    : [];
  const game = createGame(
    humans,
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

  // AI stargates (C4, §6.8 stage 5): every gate built or upgraded, every
  // shot and its fate (landed / turned back / joined; the pocket still held
  // 30 s after landing), Dark Star landings by gate versus fleet, and the
  // landlocked beachhead pockets alive at the end (the exclave question).
  const gateLevels = new Map<number, number>();
  const gateOwners = new Set<string>();
  const gateTotals = { built: 0, upgrades: 0 };
  interface ShotLog {
    unitId: number;
    owner: Player;
    target: number;
    targetName: string;
    troops: number;
    start: number;
    landedAt: number;
  }
  const shotsInAir = new Map<number, ShotLog>();
  const heldChecks: ShotLog[] = [];
  const shotTotals = {
    fired: 0,
    landed: 0,
    back: 0,
    joined: 0,
    held: 0,
    checked: 0,
    darkStar: 0,
  };
  const gateLandingTick = new Map<Player, number>();
  let darkStarByGate = 0;
  let darkStarByFleet = 0;
  const minute = (t: number) => (t / 600).toFixed(2);
  const moatDist = (tile: number) =>
    Math.round(
      Math.sqrt(game.euclideanDistSquared(tile, game.ref(g.cx, g.cy))) -
        g.radius,
    );
  while (win === undefined && fatal === undefined) {
    runner.addTurn({ turnNumber: turn++, intents: [] });
    runner.executeNextTick();
    if (game.inSpawnPhase()) continue;
    startTurn ??= turn;
    const elapsed = turn - startTurn;

    // Gates: new ones and upgrades, sampled every second.
    if (elapsed % 10 === 0) {
      for (const p of game.players()) {
        if (p === hegemon) continue;
        for (const gate of p.units(UnitType.Stargate)) {
          if (gate.isUnderConstruction()) continue;
          const seen = gateLevels.get(gate.id());
          if (seen === undefined) {
            gateTotals.built++;
            gateOwners.add(p.name());
            log(
              `      gate @${minute(elapsed)} built by ${p.name()} at ${game.x(gate.tile())},${game.y(gate.tile())}, ` +
                `${moatDist(gate.tile())} tiles from the moat (range ${config.stargateRange(gate.level())})`,
            );
          } else if (gate.level() > seen) {
            gateTotals.upgrades++;
            log(
              `      gate @${minute(elapsed)} ${p.name()} upgraded to level ${gate.level()} ` +
                `(range ${config.stargateRange(gate.level())}, ${moatDist(gate.tile())} tiles from the moat)`,
            );
          }
          gateLevels.set(gate.id(), gate.level());
        }
      }
    }

    // Shots: launches, and how each one ended.
    const inFlight = new Set<number>();
    for (const shot of game.gateShotsInFlight()) {
      inFlight.add(shot.unitId());
      if (shotsInAir.has(shot.unitId())) continue;
      const owner = shot.owner();
      const target = shot.targetTile();
      const targetOwner = game.owner(target);
      const entry: ShotLog = {
        unitId: shot.unitId(),
        owner,
        target,
        targetName: targetOwner.isPlayer()
          ? targetOwner.name()
          : game.isInDarkStar(target)
            ? "the Dark Star"
            : "neutral land",
        troops: game.unit(shot.unitId())?.troops() ?? 0,
        start: elapsed,
        landedAt: -1,
      };
      shotsInAir.set(entry.unitId, entry);
      shotTotals.fired++;
    }
    for (const [unitId, entry] of shotsInAir) {
      if (inFlight.has(unitId)) continue;
      shotsInAir.delete(unitId);
      const target = entry.target;
      let fate: string;
      if (
        game.owner(target) === entry.owner &&
        entry.owner.isBeachhead(target)
      ) {
        fate = "landed";
        shotTotals.landed++;
        entry.landedAt = elapsed;
        heldChecks.push(entry);
        if (game.isInDarkStar(target)) {
          shotTotals.darkStar++;
          gateLandingTick.set(entry.owner, elapsed);
        }
      } else if (game.owner(target) === entry.owner) {
        fate = "joined (ours by then)";
        shotTotals.joined++;
      } else {
        fate = "turned back";
        shotTotals.back++;
      }
      log(
        `      shot @${minute(entry.start)} ${entry.owner.name()} -> ${entry.targetName} ` +
          `(${k(entry.troops)} troops, ${game.x(target)},${game.y(target)}): ${fate} @${minute(elapsed)}`,
      );
    }
    // The pocket 30 s after landing: still ours if the landing tile is.
    while (heldChecks.length > 0 && elapsed - heldChecks[0].landedAt >= 300) {
      const entry = heldChecks.shift()!;
      const held = entry.owner.isBeachhead(entry.target);
      shotTotals.checked++;
      if (held) shotTotals.held++;
      log(
        `      pocket of ${entry.owner.name()} on ${entry.targetName} (landed @${minute(entry.landedAt)}): ` +
          `${held ? "held" : "lost"} after 30 s`,
      );
    }

    const invader = game.darkStarInvader();
    if (invader !== null && invader !== lastInvader) {
      const byGate = (gateLandingTick.get(invader) ?? -Infinity) >= elapsed - 2;
      if (byGate) darkStarByGate++;
      else darkStarByFleet++;
      landings.push(
        `${invader.name()}@${(elapsed / 600).toFixed(1)}${byGate ? " by gate" : ""}`,
      );
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
  // Landlocked pockets: a beachhead whose territory touches no water and is
  // not the owner's mainland stands only by the tag (§6.10).
  const exclaves: string[] = [];
  let beachheadTiles = 0;
  for (const p of game.players()) {
    if (p === hegemon || !p.isAlive()) continue;
    const visited = new Set<number>();
    for (const head of p.beachheads()) {
      beachheadTiles++;
      if (visited.has(head)) continue;
      const queue = [head];
      visited.add(head);
      let touchesWater = false;
      let size = 0;
      while (queue.length > 0 && size < 20000) {
        const tile = queue.pop()!;
        size++;
        if (game.isShore(tile)) touchesWater = true;
        game.forEachNeighbor(tile, (n) => {
          if (!visited.has(n) && game.owner(n) === p) {
            visited.add(n);
            queue.push(n);
          }
        });
      }
      if (!touchesWater && size * 2 < p.numTilesOwned()) {
        exclaves.push(
          `${p.name()} ${size}t at ${game.x(head)},${game.y(head)}`,
        );
      }
    }
  }
  log(
    `Gates: ${gateTotals.built} built by ${gateOwners.size} nations, ${gateTotals.upgrades} upgrades; ` +
      `shots: ${shotTotals.fired} fired, ${shotTotals.landed} landed (${shotTotals.darkStar} on the Dark Star), ` +
      `${shotTotals.back} turned back, ${shotTotals.joined} joined; pockets held after 30 s: ${shotTotals.held}/${shotTotals.checked}`,
  );
  log(
    `Dark Star landings: ${darkStarByGate} by gate, ${darkStarByFleet} by fleet; ` +
      `beachhead tiles held at the end: ${beachheadTiles}; landlocked pockets: ${exclaves.length}` +
      (exclaves.length > 0 ? ` [${exclaves.join(", ")}]` : ""),
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
