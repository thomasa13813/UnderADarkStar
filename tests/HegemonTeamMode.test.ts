import { WinCheckExecution } from "../src/core/execution/WinCheckExecution";
import {
  ColoredTeams,
  Duos,
  Game,
  GameMode,
  HumansVsNations,
  Player,
  PlayerInfo,
  PlayerType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// Under a Dark Star, T5 (docs/DarkStar-Lobbies.md §5.9): a team game with a
// throne. The Hegemon is a team of one outside the team count, the land-share
// team win is off, and the throne's donation rules (H9) hold whatever the
// lobby's team toggles say.

function human(name: string, isHegemon = false): PlayerInfo {
  return new PlayerInfo(
    name,
    PlayerType.Human,
    `client-${name}`,
    name,
    false,
    null,
    [],
    null,
    null,
    isHegemon,
  );
}

// A land tile well away from the Dark Star, one per player, so each is alive.
function settle(game: Game, player: Player, corner: number): TileRef {
  const g = game.darkStar()!;
  const keepOut = g.radius + g.moatWidth + 10;
  let found: TileRef | null = null;
  game.forEachTile((tile) => {
    if (found !== null) return;
    const x = game.x(tile);
    const y = game.y(tile);
    const dx = x - g.cx;
    const dy = y - g.cy;
    const quadrant = (dx < 0 ? 0 : 1) + (dy < 0 ? 0 : 2);
    if (
      quadrant === corner &&
      game.isLand(tile) &&
      dx * dx + dy * dy > keepOut * keepOut
    ) {
      found = tile;
    }
  });
  if (found === null) throw new Error("no land in that corner");
  player.conquer(found);
  player.setTroops(10_000);
  return found;
}

describe("A team game under a Dark Star (T5)", () => {
  test("the AI throne is a team of one that no team list contains", async () => {
    const game = await setup(
      "big_plains",
      { hegemon: { enabled: true }, gameMode: GameMode.Team, playerTeams: 2 },
      [human("east"), human("west")],
    );
    const hegemon = game.hegemon()!;
    expect(game.config().hegemonConfig().enabled).toBe(true);
    expect(hegemon.team()).toBe(ColoredTeams.Hegemon);
    expect(game.teams()).toEqual([
      ColoredTeams.Bot,
      ColoredTeams.Red,
      ColoredTeams.Blue,
    ]);
    const east = game.player("east");
    const west = game.player("west");
    expect(east.team()).not.toBe(west.team());
    for (const p of [east, west]) {
      expect(p.isOnSameTeam(hegemon)).toBe(false);
      expect(hegemon.isOnSameTeam(p)).toBe(false);
      expect(hegemon.isFriendly(p)).toBe(false);
    }
  });

  test("a seated human is the Hegemon team, not counted in the team split", async () => {
    // Duos: four challengers make two teams; counting the throne too would
    // make three.
    const game = await setup(
      "big_plains",
      {
        hegemon: { enabled: true },
        gameMode: GameMode.Team,
        playerTeams: Duos,
      },
      [human("a"), human("b"), human("c"), human("d"), human("throne", true)],
    );
    const throne = game.player("throne");
    expect(game.hegemon()).toBe(throne);
    expect(throne.isHegemon()).toBe(true);
    expect(throne.team()).toBe(ColoredTeams.Hegemon);
    expect(game.teams()).toEqual([
      ColoredTeams.Bot,
      ColoredTeams.Red,
      ColoredTeams.Blue,
    ]);
    const teams = ["a", "b", "c", "d"].map((n) => game.player(n).team());
    expect(
      teams.every((t) => t === ColoredTeams.Red || t === ColoredTeams.Blue),
    ).toBe(true);
    expect(teams.filter((t) => t === ColoredTeams.Red)).toHaveLength(2);
    expect(game.player("a").isOnSameTeam(throne)).toBe(false);
  });

  test("Humans vs Nations keeps the seated human off the Humans side", async () => {
    const game = await setup(
      "big_plains",
      {
        hegemon: { enabled: true },
        gameMode: GameMode.Team,
        playerTeams: HumansVsNations,
      },
      [human("a"), human("throne", true)],
    );
    expect(game.player("a").team()).toBe(ColoredTeams.Humans);
    expect(game.player("throne").team()).toBe(ColoredTeams.Hegemon);
    expect(game.hegemon()).toBe(game.player("throne"));
  });

  describe("donations and alliances (H9) with the team toggles on", () => {
    let game: Game;
    let hegemon: Player;
    let a: Player;
    let b: Player;
    let c: Player;

    beforeEach(async () => {
      game = await setup(
        "big_plains",
        {
          hegemon: { enabled: true },
          gameMode: GameMode.Team,
          playerTeams: Duos,
          donateGold: true,
          donateTroops: true,
        },
        [human("a"), human("b"), human("c"), human("d")],
      );
      hegemon = game.hegemon()!;
      a = game.player("a");
      b = game.player("b");
      c = game.player("c");
      settle(game, a, 0);
      settle(game, b, 1);
      settle(game, c, 2);
      settle(game, game.player("d"), 3);
    });

    test("teammates donate to each other as the engine has it", () => {
      expect(a.isOnSameTeam(b)).toBe(true);
      expect(a.isOnSameTeam(c)).toBe(false);
      expect(a.canDonateTroops(b)).toBe(true);
      expect(a.canDonateGold(b)).toBe(true);
      expect(a.canDonateTroops(c)).toBe(false);
    });

    test("anyone reinforces the throne, the throne reinforces anyone, gold stays closed", () => {
      const max = game.config().maxTroops(hegemon);
      expect(hegemon.troops()).toBe(max);
      expect(a.canDonateTroops(hegemon)).toBe(false);
      hegemon.setTroops(max - 1);
      expect(a.canDonateTroops(hegemon)).toBe(true);
      expect(c.canDonateTroops(hegemon)).toBe(true);
      expect(hegemon.canDonateTroops(a)).toBe(true);
      expect(hegemon.canDonateTroops(c)).toBe(true);
      expect(hegemon.canDonateGold(a)).toBe(false);
      expect(a.canDonateGold(hegemon)).toBe(false);
    });

    test("the throne allies with no one", () => {
      expect(a.canSendAllianceRequest(hegemon)).toBe(false);
      expect(hegemon.canSendAllianceRequest(a)).toBe(false);
      expect(a.canSendAllianceRequest(c)).toBe(true);
    });
  });

  describe("the round ends only through the throne (R1)", () => {
    let game: Game;
    let hegemon: Player;
    let east: Player;

    beforeEach(async () => {
      game = await setup(
        "big_plains",
        {
          hegemon: { enabled: true },
          gameMode: GameMode.Team,
          playerTeams: 2,
          maxTimerValue: 1,
        },
        [human("east"), human("west")],
      );
      hegemon = game.hegemon()!;
      east = game.player("east");
      settle(game, game.player("west"), 0);
      game.addExecution(new WinCheckExecution());
    });

    test("a team holding nearly all the land does not win", () => {
      game.forEachTile((tile) => {
        if (game.isLand(tile) && !game.hasOwner(tile)) east.conquer(tile);
      });
      const land = game.numLandTiles() - game.numTilesWithFallout();
      const share = (east.numTilesOwned() * 100) / land;
      expect(share).toBeGreaterThan(
        game.config().percentageTilesOwnedToWin(game.elapsedGameSeconds()),
      );
      executeTicks(game, 20);
      expect(game.getWinner()).toBeNull();
    });

    test("the killing blow wins for the slayer, not their team (L8)", () => {
      settle(game, east, 1);
      for (const tile of Array.from(hegemon.tiles())) east.conquer(tile);
      game.conquerPlayer(east, hegemon);
      expect(hegemon.isAlive()).toBe(false);
      executeTicks(game, 20);
      expect(game.getWinner()).toBe(east);
      expect(game.hegemonSlayer()).toBe(east);
    });

    test("the timer gives the round to the throne", () => {
      settle(game, east, 1);
      executeTicks(game, 620);
      expect(game.getWinner()).toBe(hegemon);
    });
  });
});
