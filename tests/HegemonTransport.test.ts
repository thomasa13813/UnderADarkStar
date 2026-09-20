import { TransportShipExecution } from "../src/core/execution/TransportShipExecution";
import { Game, Player, PlayerInfo, PlayerType } from "../src/core/game/Game";
import { canBuildTransportShip } from "../src/core/game/TransportShipUtils";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

let game: Game;
let hegemon: Player;
let challenger: Player;

// The moat is how the Dark Star is invaded (H14): it must be water that
// transports can cross, even where, as on this all-land map, it is a ring lake
// with no ocean anywhere. Runs with the real water graph.
describe("Crossing the moat", () => {
  beforeEach(async () => {
    game = await setup(
      "big_plains",
      { hegemon: { enabled: true }, disableNavMesh: false },
      [new PlayerInfo("challenger", PlayerType.Human, "client1", "challenger")],
    );
    hegemon = game.hegemon()!;
    challenger = game.player("challenger");
  });

  test("a challenger on the outer shore can land on the Dark Star", () => {
    const g = game.darkStar()!;
    const outer = g.radius + g.moatWidth;
    // A block of land on the moat's outer shore, due east.
    game.forEachTile((tile) => {
      const dx = game.x(tile) - (g.cx + outer);
      const dy = game.y(tile) - g.cy;
      if (dx >= 0 && dx < 12 && Math.abs(dy) < 6 && game.isLand(tile)) {
        challenger.conquer(tile);
      }
    });
    challenger.setTroops(100_000);

    const domainShore = game.ref(g.cx + g.radius, g.cy);
    expect(game.owner(domainShore)).toBe(hegemon);
    expect(canBuildTransportShip(game, challenger, domainShore)).not.toBe(
      false,
    );

    game.addExecution(
      new TransportShipExecution(challenger, domainShore, 50_000),
    );
    executeTicks(game, 200);

    const landed = Array.from(challenger.tiles()).filter((t) =>
      game.isInDarkStar(t),
    );
    expect(landed.length).toBeGreaterThan(0);
  });
});
