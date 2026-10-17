import lordNamesData from "resources/lordNames.json";
import { PseudoRandom } from "../PseudoRandom";
import { GameStartInfo } from "../Schemas";
import {
  Cell,
  GameMapSize,
  GameMode,
  GameType,
  HumansVsNations,
  Nation,
  PlayerInfo,
  PlayerType,
} from "./Game";
import { AdditionalNation, Nation as ManifestNation } from "./TerrainMapLoader";

/** The shared Lord name pool (resources/lordNames.json). */
interface LordNamePool {
  /** Complete names, each used at most once per game. */
  names: string[];
  /** Star names; a generated name is `<star> <polity>`. */
  stars: string[];
  polities: string[];
}

const lordNames: LordNamePool = lordNamesData;

/**
 * An endless, repeat-free supply of Lord names from the one pool, in an order
 * fixed by `random`. The pool's fixed names are scattered through the first
 * pass of star-and-polity pairs, so a map gets a few of them among its own
 * combinations; later passes pair each star with a different polity. Once
 * every pair is spent (far beyond any map's Lord count) the pairs repeat with
 * a number.
 */
export function* lordNameSupply(random: PseudoRandom): Generator<string> {
  const stars = random.shuffleArray(lordNames.stars);
  const polities = random.shuffleArray(lordNames.polities);
  const pairs = (pass: number): string[] =>
    stars.map(
      (star, i) => `${star} ${polities[(i + pass * 7) % polities.length]}`,
    );
  const given = new Set<string>();
  const offer = function* (names: string[]): Generator<string> {
    for (const name of names) {
      if (given.has(name)) continue;
      given.add(name);
      yield name;
    }
  };
  yield* offer(random.shuffleArray([...lordNames.names, ...pairs(0)]));
  for (let pass = 1; pass < polities.length; pass++) {
    yield* offer(pairs(pass));
  }
  for (let counter = 2; ; counter++) {
    yield* offer(pairs(0).map((name) => `${name} ${counter}`));
  }
}

/**
 * Creates the nations (Lords) for a game. Every Lord is named from the one
 * pool (`lordNameSupply`), whatever its map's manifest calls it, and carries
 * no flag; the manifest only decides where Lords start.
 *
 * If config.nations is a number (custom count), uses that exact count:
 * starting points come from the manifest, then from `additionalNations`,
 * and any remainder spawns at random.
 * If config.nations is "disabled", returns no nations.
 * If config.nations is "default":
 *   - Public HumansVsNations: matches nation count to human player count
 *   - Public compact maps: uses 25% of manifest nations
 *   - Otherwise: uses all manifest nations
 */
export function createNationsForGame(
  gameStart: GameStartInfo,
  manifestNations: ManifestNation[],
  additionalNations: AdditionalNation[],
  numHumans: number,
  random: PseudoRandom,
): Nation[] {
  const configNations = gameStart.config.nations;
  if (configNations === "disabled") {
    return [];
  }

  const isPublic = gameStart.config.gameType === GameType.Public;
  const isCompactMap = gameStart.config.gameMapSize === GameMapSize.Compact;
  const isHumansVsNations =
    gameStart.config.gameMode === GameMode.Team &&
    gameStart.config.playerTeams === HumansVsNations;

  let spawns: (Cell | undefined)[];
  if (typeof configNations === "number") {
    spawns = chooseSpawns(
      configNations,
      manifestNations,
      additionalNations,
      random,
    );
  } else if (isPublic && isHumansVsNations) {
    // For HvN, balance nation count to match human count
    spawns = chooseSpawns(
      numHumans,
      manifestNations,
      additionalNations,
      random,
    );
  } else if (isPublic && isCompactMap) {
    // For compact maps, use only 25% of nations (minimum 1)
    const targetCount = getCompactMapNationCount(manifestNations.length, true);
    spawns = random
      .shuffleArray(manifestNations)
      .slice(0, targetCount)
      .map(toCell);
  } else {
    spawns = manifestNations.map(toCell);
  }

  const names = lordNameSupply(random);
  return spawns.map(
    (cell) =>
      new Nation(
        cell,
        new PlayerInfo(
          names.next().value as string,
          PlayerType.Nation,
          null,
          random.nextID(),
        ),
      ),
  );
}

function toCell(n: ManifestNation | AdditionalNation): Cell | undefined {
  return n.coordinates !== undefined
    ? new Cell(n.coordinates[0], n.coordinates[1])
    : undefined;
}

/**
 * Starting points for exactly `targetCount` Lords: the manifest's first, then
 * `additionalNations`, then random spawns (an undefined cell).
 */
function chooseSpawns(
  targetCount: number,
  manifestNations: ManifestNation[],
  additionalNations: AdditionalNation[],
  random: PseudoRandom,
): (Cell | undefined)[] {
  const spawns = random
    .shuffleArray(manifestNations)
    .slice(0, targetCount)
    .map(toCell);
  if (spawns.length < targetCount) {
    spawns.push(
      ...random
        .shuffleArray(additionalNations)
        .slice(0, targetCount - spawns.length)
        .map(toCell),
    );
  }
  while (spawns.length < targetCount) {
    spawns.push(undefined);
  }
  return spawns;
}

// For compact maps, only 25% of nations are used (minimum 1).
export function getCompactMapNationCount(
  manifestNationCount: number,
  isCompactMap: boolean,
): number {
  if (manifestNationCount === 0) {
    return 0;
  }
  if (isCompactMap) {
    return Math.max(1, Math.floor(manifestNationCount * 0.25));
  }
  return manifestNationCount;
}
