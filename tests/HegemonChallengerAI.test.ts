import { NationHegemonBehavior } from "../src/core/execution/nation/NationHegemonBehavior";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let hegemon: Player;
let east: Player;
let west: Player;
let eastAI: NationHegemonBehavior;

// A block of land on the moat's outer shore, east (+1) or west (-1).
function settleOuterShore(player: Player, side: 1 | -1) {
  const g = game.darkStar()!;
  const outer = g.radius + g.moatWidth;
  game.forEachTile((tile) => {
    const dx = (game.x(tile) - g.cx) * side - outer;
    const dy = game.y(tile) - g.cy;
    if (dx >= 0 && dx < 12 && Math.abs(dy) < 6 && game.isLand(tile)) {
      player.conquer(tile);
    }
  });
}

function boatsToDarkStar(player: Player) {
  return player
    .units(UnitType.TransportShip)
    .filter((b) => game.isInDarkStar(b.targetTile()!));
}

beforeEach(async () => {
  game = await setup(
    "big_plains",
    { hegemon: { enabled: true }, disableNavMesh: false, maxTimerValue: 2 },
    [
      new PlayerInfo("east", PlayerType.Nation, null, "east"),
      new PlayerInfo("west", PlayerType.Nation, null, "west"),
    ],
  );
  hegemon = game.hegemon()!;
  east = game.player("east");
  west = game.player("west");
  settleOuterShore(east, 1);
  settleOuterShore(west, -1);
  while (game.inSpawnPhase()) game.executeNextTick();
  eastAI = new NationHegemonBehavior(game, east);
});

describe("AI challengers treat the throne as the objective", () => {
  test("a nation that matches the Hegemon's troops invades with most of its army", () => {
    const cfg = game.config().hegemonConfig();
    east.setTroops(hegemon.troops());
    const troops = east.troops();
    expect(eastAI.considerInvasion()).toBe(true);
    executeTicks(game, 2);

    const boats = boatsToDarkStar(east);
    expect(boats).toHaveLength(1);
    expect(boats[0].troops()).toBe(
      Math.floor((troops * cfg.aiInvasionSendPercent) / 100),
    );
    // One fleet at a time.
    expect(eastAI.considerInvasion()).toBe(false);
  });

  test("a weak nation bides its time, and grows bolder as the round runs out", () => {
    east.setTroops(Math.floor(hegemon.troops() * 0.6));
    expect(eastAI.considerInvasion()).toBe(false);
    executeTicks(game, 5);
    expect(boatsToDarkStar(east)).toHaveLength(0);

    // A 2-minute round: by 1m50s the bar is down to ~54% of the Hegemon's troops.
    executeTicks(game, 1100);
    east.setTroops(Math.floor(hegemon.troops() * 0.6));
    expect(eastAI.considerInvasion()).toBe(true);
  });

  test("it does not try while someone else holds the slot, or during its cooldown", () => {
    const g = game.darkStar()!;
    east.setTroops(hegemon.troops());
    west.conquer(game.ref(g.cx - g.radius, g.cy));
    expect(eastAI.considerInvasion()).toBe(false);

    hegemon.conquer(game.ref(g.cx - g.radius, g.cy));
    east.conquer(game.ref(g.cx + g.radius, g.cy));
    hegemon.conquer(game.ref(g.cx + g.radius, g.cy)); // evicted: cooldown
    expect(eastAI.considerInvasion()).toBe(false);
  });

  test("while it holds the slot it pushes on with everything above its reserve", () => {
    const g = game.darkStar()!;
    const cfg = game.config().hegemonConfig();
    east.conquer(game.ref(g.cx + g.radius, g.cy));
    east.setTroops(game.config().maxTroops(east));
    const reserve =
      (game.config().maxTroops(east) * cfg.aiInvasionReservePercent) / 100;

    expect(eastAI.considerInvasion()).toBe(true);
    executeTicks(game, 2);
    const attacks = east.outgoingAttacks();
    expect(attacks).toHaveLength(1);
    expect(attacks[0].target()).toBe(hegemon);
    expect(east.troops()).toBeLessThanOrEqual(Math.ceil(reserve));

    // Nothing to spare: it leaves the turn to its other business.
    expect(eastAI.considerInvasion()).toBe(false);
  });

  test("the Hegemon itself, and games without one, are left alone", async () => {
    expect(new NationHegemonBehavior(game, hegemon).considerInvasion()).toBe(
      false,
    );
    const plain = await setup("big_plains", {}, [
      new PlayerInfo("solo", PlayerType.Nation, null, "solo"),
    ]);
    const solo = plain.player("solo");
    expect(new NationHegemonBehavior(plain, solo).considerInvasion()).toBe(
      false,
    );
  });
});
