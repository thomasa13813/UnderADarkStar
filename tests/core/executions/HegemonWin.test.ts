import { AttackExecution } from "../../../src/core/execution/AttackExecution";
import { NukeExecution } from "../../../src/core/execution/NukeExecution";
import { PlayerExecution } from "../../../src/core/execution/PlayerExecution";
import { WinCheckExecution } from "../../../src/core/execution/WinCheckExecution";
import { isInDarkStarOrMoat } from "../../../src/core/game/DarkStar";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  UnitType,
} from "../../../src/core/game/Game";
import { TileRef } from "../../../src/core/game/GameMap";
import { setup } from "../../util/Setup";
import { TestConfig } from "../../util/TestConfig";
import { executeTicks } from "../../util/utils";

let game: Game;
let hegemon: Player;
let challenger: Player;
let rival: Player;
let setWinner: ReturnType<typeof vi.spyOn>;

// Hand every domain tile but `keep` to `to`, as a long invasion would.
function shrinkDomain(to: Player, keep: (tile: TileRef) => boolean) {
  for (const tile of Array.from(hegemon.tiles())) {
    if (!keep(tile)) to.conquer(tile);
  }
}

describe("Hegemon win rules", () => {
  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { hegemon: { enabled: true }, infiniteGold: true, instantBuild: true },
      [
        new PlayerInfo("challenger", PlayerType.Human, "client1", "challenger"),
        new PlayerInfo("rival", PlayerType.Human, "client2", "rival"),
      ],
    );
    hegemon = game.hegemon()!;
    challenger = game.player("challenger");
    rival = game.player("rival");
    setWinner = vi.spyOn(game, "setWinner");
    game.addExecution(new WinCheckExecution());
  });

  test("the timer favours the throne (R4)", () => {
    vi.spyOn(game.config(), "gameConfig").mockReturnValue({
      ...game.config().gameConfig(),
      maxTimerValue: 1,
    });
    challenger.conquer(game.ref(0, 0));
    executeTicks(game, 590);
    expect(setWinner).not.toHaveBeenCalled();
    executeTicks(game, 30);
    expect(setWinner).toHaveBeenCalledWith(hegemon, expect.anything());
  });

  test("an untimed round lasts the default 20 minutes (R5)", () => {
    const elapsed = vi.spyOn(game, "elapsedGameSeconds");
    elapsed.mockReturnValue(20 * 60 - 1);
    executeTicks(game, 20);
    expect(setWinner).not.toHaveBeenCalled();
    elapsed.mockReturnValue(20 * 60);
    executeTicks(game, 20);
    expect(setWinner).toHaveBeenCalledWith(hegemon, expect.anything());
  });

  test("holding the galaxy wins nothing (R1)", () => {
    const g = game.darkStar()!;
    game.forEachTile((tile) => {
      if (!isInDarkStarOrMoat(g, game.x(tile), game.y(tile))) {
        challenger.conquer(tile);
      }
    });
    expect(challenger.numTilesOwned() * 100).toBeGreaterThan(
      game.numLandTiles() * 95,
    );
    executeTicks(game, 30);
    expect(setWinner).not.toHaveBeenCalled();
  });

  test("the killing blow wins, and nobody else inherits the throne's land (R2, R3, H7)", () => {
    const g = game.darkStar()!;
    // The Hegemon is down to a 3-tile strip; the rival holds the strip beside
    // it, the challenger everything else.
    const strip = (tile: TileRef) =>
      game.y(tile) === g.cy && Math.abs(game.x(tile) - g.cx) <= 1;
    const rivalStrip = (tile: TileRef) =>
      game.y(tile) === g.cy + 1 && Math.abs(game.x(tile) - g.cx) <= 1;
    shrinkDomain(challenger, strip);
    for (const tile of Array.from(challenger.tiles())) {
      if (rivalStrip(tile)) rival.conquer(tile);
    }
    hegemon.setTroops(10);
    const rivalTiles = rival.numTilesOwned();

    game.addExecution(new AttackExecution(1000, challenger, hegemon.id()));
    executeTicks(game, 30);

    expect(hegemon.isAlive()).toBe(false);
    expect(rival.numTilesOwned()).toBe(rivalTiles);
    expect(game.hegemonSlayer()).toBe(challenger);
    expect(setWinner).toHaveBeenCalledWith(challenger, expect.anything());
  });

  test("an enclosed remnant of the domain is not annexed (H7)", () => {
    const g = game.darkStar()!;
    shrinkDomain(
      challenger,
      (tile) =>
        Math.abs(game.x(tile) - g.cx) <= 1 &&
        Math.abs(game.y(tile) - g.cy) <= 1,
    );
    expect(hegemon.numTilesOwned()).toBe(9);
    game.addExecution(new PlayerExecution(hegemon));
    executeTicks(game, 60);
    expect(hegemon.numTilesOwned()).toBe(9);
    expect(setWinner).not.toHaveBeenCalled();
  });

  test("the Dark Star cannot be nuked (H7)", () => {
    const g = game.darkStar()!;
    (game.config() as TestConfig).nukeMagnitudes = vi.fn(() => ({
      inner: 30,
      outer: 30,
    }));
    // The challenger holds the moat's outer shore east of the Dark Star; an
    // invader holds part of the domain. The blast covers both and the moat.
    const outer = g.radius + g.moatWidth;
    const target = game.ref(g.cx + outer + 2, g.cy);
    game.forEachTile((tile) => {
      const dx = game.x(tile) - game.x(target);
      const dy = game.y(tile) - g.cy;
      if (dx >= 0 && dx < 10 && Math.abs(dy) < 10) challenger.conquer(tile);
    });
    for (const tile of Array.from(hegemon.tiles())) {
      if (game.x(tile) > g.cx + 5) challenger.conquer(tile);
    }
    // A homeland beyond the blast, or the invader would be out with the
    // shore (H20).
    challenger.conquer(game.ref(game.width() - 2, game.height() - 2));
    const challengerBefore = challenger.numTilesOwned();
    const hegemonBefore = hegemon.numTilesOwned();
    const domainHeld = Array.from(challenger.tiles()).filter((t) =>
      game.isInDarkStar(t),
    ).length;

    rival.conquer(game.ref(1, 1));
    rival.buildUnit(UnitType.Stargate, game.ref(1, 1), {});
    game.addExecution(
      new NukeExecution(UnitType.AtomBomb, rival, target, game.ref(1, 1)),
    );
    executeTicks(game, 300);

    expect(challenger.numTilesOwned()).toBeLessThan(challengerBefore);
    expect(hegemon.numTilesOwned()).toBe(hegemonBefore);
    expect(
      Array.from(challenger.tiles()).filter((t) => game.isInDarkStar(t)).length,
    ).toBe(domainHeld);
    game.forEachTile((tile) => {
      if (game.isInDarkStar(tile)) expect(game.isLand(tile)).toBe(true);
    });
  });

  test("the Hegemon allies with no one (H9)", () => {
    challenger.conquer(game.ref(0, 0));
    expect(challenger.canSendAllianceRequest(hegemon)).toBe(false);
    expect(hegemon.canSendAllianceRequest(challenger)).toBe(false);
    // Control: challengers can still ally with each other.
    rival.conquer(game.ref(5, 5));
    expect(challenger.canSendAllianceRequest(rival)).toBe(true);
  });
});
