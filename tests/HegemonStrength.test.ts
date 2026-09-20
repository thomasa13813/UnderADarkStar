import { AttackLogicInput, Config } from "../src/core/configuration/Config";
import { AttackExecution } from "../src/core/execution/AttackExecution";
import { HegemonExecution } from "../src/core/execution/HegemonExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { TestConfig } from "./util/TestConfig";
import { executeTicks } from "./util/utils";

const seenDefenderTiles: number[] = [];
const seenInputs: AttackLogicInput[] = [];
class RecordingConfig extends TestConfig {
  attackLogic(input: AttackLogicInput) {
    seenInputs.push(input);
    if (input.defender !== null)
      seenDefenderTiles.push(input.defender.numTiles);
    return super.attackLogic(input);
  }
}

let game: Game;
let hegemon: Player;
let invader: Player;

// big_plains has 40,000 land tiles before the Dark Star is carved into it.
const BIG_PLAINS_LAND = 40_000;

describe("Hegemon strength", () => {
  beforeEach(async () => {
    seenDefenderTiles.length = 0;
    seenInputs.length = 0;
    game = await setup(
      "big_plains",
      { hegemon: { enabled: true } },
      [new PlayerInfo("invader", PlayerType.Human, "client1", "invader")],
      undefined,
      RecordingConfig,
    );
    hegemon = game.hegemon()!;
    invader = game.player("invader");
  });

  test("starts at a ceiling set by the map as authored (H2, H3)", () => {
    const config = game.config();
    // The whole-map cap: what one player owning every land tile could field.
    expect(config.hegemonMaxTroops()).toBe(
      Math.floor(2 * (Math.pow(BIG_PLAINS_LAND, 0.6) * 1000 + 50000)),
    );
    expect(game.numLandTiles()).toBeLessThan(BIG_PLAINS_LAND);
    expect(hegemon.troops()).toBe(config.hegemonMaxTroops());
    expect(config.maxTroops(hegemon)).toBe(config.hegemonMaxTroops());
    // Far beyond what its own territory would support.
    expect(config.hegemonMaxTroops()).toBeGreaterThan(
      4 * (2 * (Math.pow(hegemon.numTilesOwned(), 0.6) * 1000 + 50000)),
    );
    expect(config.goldAdditionRate(hegemon)).toBe(80n);
  });

  test("is decoupled from the territory it still holds (H5)", () => {
    const config = game.config();
    const maxTroops = config.maxTroops(hegemon);
    const gold = config.goldAdditionRate(hegemon);
    hegemon.setTroops(maxTroops / 2);
    const regen = config.troopIncreaseRate(hegemon);

    const g = game.darkStar()!;
    for (const tile of Array.from(hegemon.tiles())) {
      if (game.x(tile) > g.cx) invader.conquer(tile);
    }
    expect(hegemon.numTilesOwned()).toBeLessThan(g.domainTileCount * 0.6);

    expect(config.maxTroops(hegemon)).toBe(maxTroops);
    expect(config.goldAdditionRate(hegemon)).toBe(gold);
    expect(config.troopIncreaseRate(hegemon)).toBe(regen);
  });

  test("regenerates up to the ceiling and no further", () => {
    const config = game.config();
    expect(config.troopIncreaseRate(hegemon)).toBe(0);
    hegemon.setTroops(config.hegemonMaxTroops() / 2);
    expect(config.troopIncreaseRate(hegemon)).toBeGreaterThan(1);

    // HegemonExecution gives the seat its PlayerExecution, which applies it.
    game.addExecution(new HegemonExecution());
    const before = hegemon.troops();
    const goldBefore = hegemon.gold();
    executeTicks(game, 12);
    expect(hegemon.troops()).toBeGreaterThan(before);
    expect(hegemon.gold()).toBeGreaterThan(goldBefore);
  });

  test("bleeds troops per tile as if it held the whole domain (H5)", () => {
    const g = game.darkStar()!;
    for (const tile of Array.from(hegemon.tiles())) {
      if (game.x(tile) > g.cx) invader.conquer(tile);
    }
    const held = hegemon.numTilesOwned();
    game.addExecution(new AttackExecution(10_000, invader, hegemon.id()));
    executeTicks(game, 5);

    expect(hegemon.numTilesOwned()).toBeLessThan(held);
    expect(seenDefenderTiles.length).toBeGreaterThan(0);
    for (const numTiles of seenDefenderTiles) {
      expect(numTiles).toBe(g.domainTileCount);
    }
  });

  test("the Dark Star is a fortress, but only while the Hegemon holds it", () => {
    const g = game.darkStar()!;
    for (const tile of Array.from(hegemon.tiles())) {
      if (game.x(tile) > g.cx) invader.conquer(tile);
    }
    invader.setTroops(1_000_000);
    game.addExecution(new AttackExecution(10_000, invader, hegemon.id()));
    executeTicks(game, 5);
    expect(seenInputs.length).toBeGreaterThan(0);
    expect(seenInputs.every((i) => i.hegemonDomain === true)).toBe(true);
    const input = seenInputs[0];

    // The Hegemon retaking its own tiles meets no such resistance.
    seenInputs.length = 0;
    game.addExecution(new AttackExecution(10_000, hegemon, invader.id()));
    executeTicks(game, 5);
    const retaking = seenInputs.filter(
      (i) => i.defender?.type === PlayerType.Human,
    );
    expect(retaking.length).toBeGreaterThan(0);
    expect(retaking.every((i) => i.hegemonDomain === false)).toBe(true);

    // The multipliers themselves, through the real combat formula.
    const cfg = game.config().hegemonConfig();
    const real = (i: AttackLogicInput) =>
      Config.prototype.attackLogic.call(game.config(), i);
    const plain = real({ ...input, hegemonDomain: false });
    const fortress = real({ ...input, hegemonDomain: true });
    expect(fortress.attackerTroopLoss).toBeCloseTo(
      (plain.attackerTroopLoss * cfg.domainAttackerLossPercent) / 100,
    );
    expect(fortress.tickFraction).toBeCloseTo(
      (plain.tickFraction * cfg.domainConquestSlowPercent) / 100,
    );
    expect(fortress.defenderTroopLoss).toBe(plain.defenderTroopLoss);
  });
});
