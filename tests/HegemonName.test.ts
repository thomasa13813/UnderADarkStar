import { placeName } from "../src/client/hud/NameBoxCalculator";
import {
  Cell,
  Game,
  Player,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import { setup } from "./util/Setup";

let game: Game;
let hegemon: Player;
let east: Player;

// A block of land beyond the moat's outer shore, east of the disc.
function settle(player: Player, depth: number, halfHeight: number) {
  const g = game.darkStar()!;
  const outer = g.radius + g.moatWidth;
  game.forEachTile((tile) => {
    const dx = game.x(tile) - g.cx - outer;
    const dy = game.y(tile) - g.cy;
    if (
      dx >= 0 &&
      dx < depth &&
      Math.abs(dy) < halfHeight &&
      game.isLand(tile)
    ) {
      player.conquer(tile);
    }
  });
}

beforeEach(async () => {
  game = await setup(
    "big_plains",
    { hegemon: { enabled: true }, disableNavMesh: false, instantBuild: true },
    [new PlayerInfo("east", PlayerType.Human, "client1", "east")],
  );
  hegemon = game.hegemon()!;
  east = game.player("east");
  settle(east, 20, 10);
});

describe("The Hegemon's name rests on the Dark Star", () => {
  test("its name sits on the disc's centre however large a strike's bubble grows", () => {
    const g = game.darkStar()!;
    const home = placeName(game, hegemon);
    expect(home.x).toBe(Math.ceil(g.cx));
    expect(home.y).toBe(Math.ceil(g.cy - home.size / 3));
    expect(home.size).toBeGreaterThan(0);

    // A bubble beyond the moat that outgrows the domain becomes the largest
    // cluster, which is what the generic placement follows.
    settle(hegemon, 80, 60);
    hegemon.largestClusterBoundingBox = {
      min: new Cell(g.cx + g.radius + g.moatWidth, g.cy - 60),
      max: new Cell(g.cx + g.radius + g.moatWidth + 80, g.cy + 60),
    };
    const struck = placeName(game, hegemon);
    expect(struck).toEqual(home);
  });

  test("a challenger's name still follows its largest cluster", () => {
    const g = game.darkStar()!;
    const loc = placeName(game, east);
    expect(loc.x).toBeGreaterThan(g.cx + g.radius);
    expect(loc.size).toBeGreaterThan(0);
  });
});
