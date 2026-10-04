import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { beforeAll, describe, expect, it } from "vitest";
import { OpeningController } from "../../src/client/controllers/OpeningController";
import { PlaySoundEffectEvent } from "../../src/client/sound/Sounds";
import { GoToPositionEvent } from "../../src/client/TransformHandler";
import { OpeningFlights } from "../../src/client/view/OpeningFlights";
import { EventBus } from "../../src/core/EventBus";
import { GameMap } from "../../src/core/game/GameMap";
import { flightPath } from "../../src/core/game/Opening";
import { genTerrainFromBin } from "../../src/core/game/TerrainMapLoader";

// The opening's flights (C3 in docs/DarkStar-Design.md, §6.12) are drawn by
// the client alone: launched the tick the spawn phase ends, on the strike's
// path, landing exactly when the sim's window says, hidden until then.

const SPEED = 10;
let map: GameMap;
let centre: number;

beforeAll(async () => {
  const dir = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../testdata/maps/big_plains",
  );
  const manifest = JSON.parse(
    fs.readFileSync(path.join(dir, "manifest.json"), "utf8"),
  );
  map = await genTerrainFromBin(
    manifest.map,
    fs.readFileSync(path.join(dir, "map.bin")),
  );
  centre = map.ref(100, 100);
});

describe("OpeningFlights", () => {
  it("launches at the start tick and lands when the sim's flight would", () => {
    const spawn = map.ref(20, 30);
    const path = flightPath(map, centre, spawn, SPEED);
    const opening = new OpeningFlights(map, centre, SPEED);
    opening.start(100, [{ smallID: 3, spawnTile: spawn }], 50);

    expect(opening.isActive()).toBe(true);
    expect(opening.startedThisTick()).toBe(true);
    expect(opening.isHidden(3)).toBe(true);
    expect(opening.landTickOf(3)).toBe(100 + path.length);

    // In the air: one phantom projectile on the path, aimed at the spawn.
    const positions: number[] = [];
    for (let tick = 100; tick < 100 + path.length; tick++) {
      opening.advance(tick);
      const units = Array.from(opening.unitsInFlight());
      expect(units).toHaveLength(1);
      expect(units[0].unitType).toBe("Projectile");
      expect(units[0].ownerID).toBe(3);
      expect(units[0].id).toBeLessThan(0);
      expect(units[0].targetTile).toBeNull(); // no ring
      expect(units[0].isActive).toBe(true);
      expect(path).toContain(units[0].pos);
      positions.push(units[0].pos);
      expect(opening.landedThisTick()).toHaveLength(0);
      expect(opening.isHidden(3)).toBe(true);
    }
    expect(positions[0]).toBe(centre);
    // Never backwards along the path.
    const indices = positions.map((p) => path.indexOf(p));
    for (let i = 1; i < indices.length; i++) {
      expect(indices[i]).toBeGreaterThanOrEqual(indices[i - 1]);
    }
    expect(opening.startedThisTick()).toBe(false);

    // The landing tick: reported once, the fill revealed, the phantom gone.
    opening.advance(100 + path.length);
    expect(opening.landedThisTick()).toEqual([{ smallID: 3, tile: spawn }]);
    expect(opening.landingsAsDeadUnits()).toEqual([
      {
        unitType: "Projectile",
        pos: spawn,
        reachedTarget: true,
        ownerSmallID: 3,
      },
    ]);
    expect(Array.from(opening.unitsInFlight())).toHaveLength(0);
    expect(opening.isHidden(3)).toBe(false);
    expect(opening.hiddenOwners().size).toBe(0);

    opening.advance(100 + path.length + 1);
    expect(opening.landedThisTick()).toHaveLength(0);
    // Still the window's length: play begins when it ends.
    expect(opening.isActive()).toBe(true);
    opening.advance(150);
    expect(opening.isActive()).toBe(false);
  });

  it("plays a flight longer than the window faster, landing as it ends", () => {
    const far = map.ref(2, 2);
    const path = flightPath(map, centre, far, SPEED);
    expect(path.length).toBeGreaterThan(6);
    const opening = new OpeningFlights(map, centre, SPEED);
    opening.start(10, [{ smallID: 5, spawnTile: far }], 6);
    expect(opening.landTickOf(5)).toBe(16);
    for (let tick = 10; tick < 16; tick++) {
      opening.advance(tick);
      expect(Array.from(opening.unitsInFlight())).toHaveLength(1);
    }
    opening.advance(16);
    expect(opening.landedThisTick()).toEqual([{ smallID: 5, tile: far }]);
    expect(opening.isActive()).toBe(false);
  });

  it("reports the hidden set once per change", () => {
    const opening = new OpeningFlights(map, centre, SPEED);
    opening.start(
      0,
      [
        { smallID: 1, spawnTile: map.ref(60, 100) },
        { smallID: 2, spawnTile: map.ref(20, 100) },
      ],
      50,
    );
    expect(opening.takeHiddenChanged()).toBe(true);
    expect(opening.takeHiddenChanged()).toBe(false);
    expect(Array.from(opening.hiddenOwners()).sort()).toEqual([1, 2]);
    const first = opening.landTickOf(1)!;
    const second = opening.landTickOf(2)!;
    expect(first).toBeLessThan(second);
    for (let tick = 0; tick < first; tick++) opening.advance(tick);
    expect(opening.takeHiddenChanged()).toBe(false);
    opening.advance(first);
    expect(opening.takeHiddenChanged()).toBe(true);
    expect(Array.from(opening.hiddenOwners())).toEqual([2]);
  });

  it("re-aims a flight whose spawn moved and flies a late spawner inside the window", () => {
    const opening = new OpeningFlights(map, centre, SPEED);
    opening.start(0, [{ smallID: 1, spawnTile: map.ref(60, 100) }], 50);
    opening.advance(0);
    opening.advance(1);
    const moved = map.ref(150, 140);
    opening.spawnChanged(1, moved, 1);
    expect(opening.landTickOf(1)).toBe(
      flightPath(map, centre, moved, SPEED).length,
    );
    expect(opening.landTickOf(1)).toBeGreaterThan(opening.startTick());

    // A human who spawns at tick 40 still lands by tick 50.
    opening.spawnChanged(7, map.ref(10, 10), 40);
    expect(opening.landTickOf(7)).toBe(50);
    expect(opening.isHidden(7)).toBe(true);

    // After the window nobody flies.
    opening.spawnChanged(8, map.ref(10, 190), 50);
    expect(opening.landTickOf(8)).toBeUndefined();
    expect(opening.isHidden(8)).toBe(false);
  });
});

describe("OpeningController", () => {
  function harness(opts: { me: { smallID: number; hegemon: boolean } | null }) {
    const eventBus = new EventBus();
    const events: unknown[] = [];
    eventBus.on(GoToPositionEvent, (e) => events.push(e));
    eventBus.on(PlaySoundEffectEvent, (e) => events.push(e));
    const opening = new OpeningFlights(map, centre, SPEED);
    let tick = 0;
    const me =
      opts.me === null
        ? null
        : {
            smallID: () => opts.me!.smallID,
            isHegemon: () => opts.me!.hegemon,
          };
    const game = {
      opening: () => opening,
      darkStar: () => ({ cx: 100, cy: 100 }),
      ticks: () => tick,
      myPlayer: () => me,
      x: (tile: number) => map.x(tile),
      y: (tile: number) => map.y(tile),
    };
    const camera = { fitAllScale: (fit: number) => 0.5 * fit };
    const controller = new OpeningController(game as never, eventBus, camera);
    const step = (t: number) => {
      tick = t;
      opening.advance(t);
      controller.tick();
    };
    return { opening, controller, events, step };
  }

  it("pulls the camera out at launch and brings a challenger home on landing", () => {
    const { opening, events, step } = harness({
      me: { smallID: 2, hegemon: false },
    });
    opening.start(
      0,
      [
        { smallID: 1, spawnTile: map.ref(60, 100) },
        { smallID: 2, spawnTile: map.ref(20, 100) },
      ],
      50,
    );
    step(0);
    expect(events).toHaveLength(2);
    const pullOut = events[0] as GoToPositionEvent;
    expect(pullOut).toBeInstanceOf(GoToPositionEvent);
    expect([pullOut.x, pullOut.y, pullOut.zoom]).toEqual([100, 100, 0.45]);
    expect((events[1] as PlaySoundEffectEvent).effect).toBe("launch");

    const first = opening.landTickOf(1)!;
    const mine = opening.landTickOf(2)!;
    for (let t = 1; t < first; t++) step(t);
    expect(events).toHaveLength(2);
    step(first);
    // Somebody else landed: nothing to hear, no camera move.
    expect(events).toHaveLength(2);
    for (let t = first + 1; t < mine; t++) step(t);
    step(mine);
    // My own landing: the landing cue, then the camera comes home.
    expect(events).toHaveLength(4);
    expect((events[2] as PlaySoundEffectEvent).effect).toBe("landing");
    const home = events[3] as GoToPositionEvent;
    expect(home).toBeInstanceOf(GoToPositionEvent);
    expect([home.x, home.y, home.zoom]).toEqual([20, 100, 8]);
  });

  it("plays no landing cue to the Hegemon and leaves its wide view alone", () => {
    const { opening, events, step } = harness({
      me: { smallID: 9, hegemon: true },
    });
    const spawns = [1, 2, 3].map((id) => ({
      smallID: id,
      spawnTile: map.ref(100 + id, 60),
    }));
    opening.start(0, spawns, 50);
    const landAt = opening.landTickOf(1)!;
    for (let t = 0; t <= landAt + 2; t++) step(t);
    const cues = events.filter(
      (e) => e instanceof PlaySoundEffectEvent && e.effect === "landing",
    );
    // Three challengers land; none of them is the throne.
    expect(cues).toHaveLength(0);
    // One camera move: the pull-out, never a return home.
    expect(events.filter((e) => e instanceof GoToPositionEvent)).toHaveLength(
      1,
    );
  });
});
