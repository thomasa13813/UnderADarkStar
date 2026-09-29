import { DonateTroopsExecution } from "../src/core/execution/DonateTroopExecution";
import {
  Game,
  Player,
  PlayerInfo,
  PlayerType,
  Structures,
  UnitType,
} from "../src/core/game/Game";
import { TileRef } from "../src/core/game/GameMap";
import { setup } from "./util/Setup";
import { executeTicks } from "./util/utils";

// The throne's toolkit, chunk 1 (docs/DarkStar-Design.md §6.13): nothing is
// built on the Dark Star (H2), the Hegemon donates troops to anyone (H9), and
// MIRVs are off under a Dark Star (S6). H12's cooldown removal is covered in
// HegemonInvasion.test.ts.

let game: Game;
let hegemon: Player;
let east: Player;
let west: Player;

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
  player.setTroops(200_000);
}

function domainShore(side: 1 | -1): TileRef {
  const g = game.darkStar()!;
  return game.ref(g.cx + side * g.radius, g.cy);
}

function homeTile(player: Player): TileRef {
  const g = game.darkStar()!;
  const outer = g.radius + g.moatWidth;
  const side = player === east ? 1 : -1;
  return game.ref(g.cx + side * (outer + 6), g.cy);
}

async function start(hegemonEnabled = true) {
  game = await setup(
    "big_plains",
    { hegemon: { enabled: hegemonEnabled }, donateTroops: false },
    [
      new PlayerInfo("east", PlayerType.Human, "client1", "east"),
      new PlayerInfo("west", PlayerType.Human, "client2", "west"),
    ],
  );
  hegemon = game.hegemon()!; // null with Hegemon mode off
  east = game.player("east");
  west = game.player("west");
  if (game.darkStar() !== null) {
    settleOuterShore(east, 1);
    settleOuterShore(west, -1);
  }
  for (const p of [hegemon, east, west]) p?.addGold(1_000_000_000n);
}

describe("Nothing is built on the Dark Star (H2)", () => {
  beforeEach(() => start());

  test("the Hegemon can build no structure at all", () => {
    const centre = game.ref(game.darkStar()!.cx, game.darkStar()!.cy);
    for (const type of Structures.types) {
      expect(hegemon.canBuild(type, centre)).toBe(false);
    }
    // The build menu sees the same: every structure greyed out.
    for (const u of hegemon.buildableUnits(centre)) {
      if (Structures.has(u.type)) expect(u.canBuild).toBe(false);
    }
  });

  test("nor on a strike's bubble beyond the moat", () => {
    const tile = homeTile(east);
    hegemon.conquer(tile);
    expect(game.owner(tile)).toBe(hegemon);
    expect(hegemon.canBuild(UnitType.City, tile)).toBe(false);
    expect(hegemon.canBuild(UnitType.DefensePost, tile)).toBe(false);
  });

  test("an invader cannot fortify the domain tiles it holds", () => {
    const shore = domainShore(1);
    east.conquer(shore);
    expect(game.darkStarInvader()).toBe(east);
    for (const type of Structures.types) {
      expect(east.canBuild(type, shore)).toBe(false);
    }
    for (const u of east.buildableUnits(shore)) {
      if (Structures.has(u.type)) expect(u.canBuild).toBe(false);
    }
  });

  test("a domain tile is never chosen as the site for a nearby build", () => {
    // Give east a strip of domain tiles next to its shore landing, then ask
    // for a structure on one of them: the search must not slide onto any
    // other domain tile either.
    const g = game.darkStar()!;
    for (let dx = 0; dx < 6; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const t = game.ref(g.cx + g.radius - dx, g.cy + dy);
        if (game.isInDarkStar(t)) east.conquer(t);
      }
    }
    expect(east.canBuild(UnitType.City, domainShore(1))).toBe(false);
  });

  test("challengers still build on their own land as before", () => {
    const tile = homeTile(east);
    expect(game.owner(tile)).toBe(east);
    expect(east.canBuild(UnitType.City, tile)).toBe(tile);
    expect(east.canBuild(UnitType.DefensePost, tile)).toBe(tile);
    expect(east.canBuild(UnitType.Stargate, tile)).toBe(tile);
  });
});

describe("The Hegemon donates troops to anyone (H9)", () => {
  beforeEach(() => start());

  test("to any challenger, ally or not, whatever the lobby toggle says", () => {
    expect(game.config().donateTroops()).toBe(false);
    expect(hegemon.isFriendly(east)).toBe(false);
    expect(hegemon.canDonateTroops(east)).toBe(true);
    expect(hegemon.canDonateTroops(west)).toBe(true);
    // ...the invader included.
    east.conquer(domainShore(1));
    expect(game.darkStarInvader()).toBe(east);
    expect(hegemon.canDonateTroops(east)).toBe(true);
  });

  test("gold stays closed, and nobody donates to the throne", () => {
    expect(hegemon.canDonateGold(east)).toBe(false);
    expect(east.canDonateTroops(hegemon)).toBe(false);
    expect(east.canDonateGold(hegemon)).toBe(false);
    // Challengers among themselves are unchanged: allies only, toggle on.
    expect(east.canDonateTroops(west)).toBe(false);
  });

  test("the ordinary donation order carries the troops across", () => {
    east.setTroops(10_000);
    const before = hegemon.troops();
    game.addExecution(new DonateTroopsExecution(hegemon, east.id(), 50_000));
    executeTicks(game, 2);
    expect(east.troops()).toBeGreaterThanOrEqual(60_000);
    expect(hegemon.troops()).toBeLessThan(before);
    // The engine's donation cooldown applies to the throne as to anyone.
    expect(hegemon.canDonateTroops(east)).toBe(false);
    expect(hegemon.canDonateTroops(west)).toBe(true);
  });
});

describe("No MIRVs under a Dark Star (S6)", () => {
  test("MIRV is off in Hegemon mode, the other warheads stay", async () => {
    await start();
    const config = game.config();
    expect(config.isUnitDisabled(UnitType.MIRV)).toBe(true);
    // SAMs go the same way (S6, 2026-09-26): the punishment is the deterrent.
    expect(config.isUnitDisabled(UnitType.SAMLauncher)).toBe(true);
    expect(east.canBuild(UnitType.SAMLauncher, homeTile(east))).toBe(false);
    expect(config.isUnitDisabled(UnitType.AtomBomb)).toBe(false);
    expect(config.isUnitDisabled(UnitType.HydrogenBomb)).toBe(false);
    const tile = homeTile(east);
    expect(east.canBuild(UnitType.MIRV, homeTile(west))).toBe(false);
    const mirv = east
      .buildableUnits(tile)
      .find((u) => u.type === UnitType.MIRV);
    expect(mirv?.canBuild).toBe(false);
  });

  test("MIRV is untouched when Hegemon mode is off", async () => {
    await start(false);
    expect(game.hegemon()).toBeNull();
    expect(game.config().isUnitDisabled(UnitType.MIRV)).toBe(false);
  });
});
