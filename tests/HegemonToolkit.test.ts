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

  test("gold stays closed, and challengers among themselves are unchanged", () => {
    expect(hegemon.canDonateGold(east)).toBe(false);
    expect(east.canDonateGold(hegemon)).toBe(false);
    // Allies only, toggle on, as the engine has it.
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

describe("Anyone reinforces the throne (H9)", () => {
  beforeEach(() => start());

  // The eastern half of the domain to east, who keeps nothing beyond the moat:
  // an exhausted invader whose troop cap has collapsed (H5).
  function strandedInvader() {
    const g = game.darkStar()!;
    for (const tile of Array.from(hegemon.tiles())) {
      if (game.x(tile) > g.cx) east.conquer(tile);
    }
    // One nebula left beyond the moat: with none it would be out (H20).
    const homeland = Array.from(east.tiles()).filter(
      (t) => !game.isInDarkStar(t),
    );
    for (const tile of homeland.slice(1)) west.conquer(tile);
    east.setTroops(0);
    expect(game.darkStarInvader()).toBe(east);
  }

  test("any challenger may donate troops to the Hegemon while its pool has room", () => {
    expect(game.config().donateTroops()).toBe(false);
    expect(east.isFriendly(hegemon)).toBe(false);
    // The pool starts full: nothing fits until the throne has spent some.
    const max = game.config().maxTroops(hegemon);
    expect(hegemon.troops()).toBe(max);
    expect(east.canDonateTroops(hegemon)).toBe(false);
    hegemon.setTroops(max - 1);
    expect(east.canDonateTroops(hegemon)).toBe(true);
    expect(west.canDonateTroops(hegemon)).toBe(true);
  });

  test("with nobody on the Dark Star the troops join the pool, up to the ceiling", () => {
    const max = game.config().maxTroops(hegemon);
    hegemon.setTroops(max - 10_000);
    game.addExecution(new DonateTroopsExecution(east, hegemon.id(), 50_000));
    executeTicks(game, 3);
    expect(hegemon.troops()).toBe(max);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);
    // Only the room there was is taken from the donor (east started at 200k).
    expect(east.troops()).toBeLessThan(195_000);
    expect(east.troops()).toBeGreaterThan(185_000);
    // The engine's cooldown applies to the throne as to any recipient.
    hegemon.setTroops(max - 10_000);
    expect(east.canDonateTroops(hegemon)).toBe(false);
    expect(west.canDonateTroops(hegemon)).toBe(true);
  });

  test("while someone holds the Dark Star they are thrown at the invader at once", () => {
    east.conquer(domainShore(1));
    expect(game.darkStarInvader()).toBe(east);
    hegemon.setTroops(100_000);
    expect(hegemon.outgoingAttacks()).toHaveLength(0);

    game.addExecution(new DonateTroopsExecution(west, hegemon.id(), 50_000));
    executeTicks(game, 2);
    const attacks = hegemon.outgoingAttacks();
    expect(attacks).toHaveLength(1);
    expect(attacks[0].target()).toBe(east);
    expect(attacks[0].troops()).toBe(50_000);
    // The pool itself is untouched: the attack carries the donation only.
    expect(hegemon.troops()).toBeGreaterThanOrEqual(100_000);
    expect(hegemon.troops()).toBeLessThan(110_000);
    expect(west.troops()).toBeLessThan(160_000);

    executeTicks(game, 100);
    expect(game.darkStarInvader()).toBeNull();
  });

  test("and so a third player breaks a deadlocked invasion", () => {
    strandedInvader();
    const held = east.domainTilesHeld();
    hegemon.setTroops(0); // the throne emptied by the fight
    executeTicks(game, 50);
    // Nobody can move: the invader has no cap to rebuild, the throne no troops.
    expect(east.domainTilesHeld()).toBe(held);
    expect(game.darkStarInvader()).toBe(east);

    game.addExecution(new DonateTroopsExecution(west, hegemon.id(), 150_000));
    executeTicks(game, 2);
    expect(hegemon.outgoingAttacks()).toHaveLength(1);
    expect(hegemon.outgoingAttacks()[0].troops()).toBe(150_000);

    executeTicks(game, 600);
    expect(game.darkStarInvader()).toBeNull();
    expect(east.domainTilesHeld()).toBe(0);
    expect(hegemon.numTilesOwned()).toBe(game.darkStar()!.domainTileCount);
    // The slot is free again for whoever wants it.
    expect(game.canInvadeDarkStar(west)).toBe(true);
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
