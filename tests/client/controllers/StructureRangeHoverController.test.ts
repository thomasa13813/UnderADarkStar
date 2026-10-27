import { PlayerInfo, PlayerType, UnitType } from "src/core/game/Game";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SHIELD_RANGE_COLOR,
  STARGATE_RANGE_COLOR,
  StructureRangeHoverController,
  structureHitRadius,
} from "../../../src/client/controllers/StructureRangeHoverController";
import { MouseMoveEvent } from "../../../src/client/InputHandler";
import { setup } from "../../util/Setup";

const STRUCTURE_SETTINGS = {
  iconSize: 60,
  dotsZoomThreshold: 1.2,
  dotScale: 0.3,
  iconScaleFactorZoomedOut: 3,
  iconGrowZoom: 7,
};

describe("structureHitRadius", () => {
  it("mirrors the sprite's half size in tiles and never drops below the floor", () => {
    // Dots: 60 * 0.3 * 0.5 / 1 = 9 tiles.
    expect(structureHitRadius(1, STRUCTURE_SETTINGS)).toBeCloseTo(9);
    // Mid zoom: 60 * min(1, 4/3) * 0.5 / 4 = 7.5 tiles.
    expect(structureHitRadius(4, STRUCTURE_SETTINGS)).toBeCloseTo(7.5);
    // World-anchored past iconGrowZoom: a constant 60 / 7 / 2 = 4.29 tiles.
    expect(structureHitRadius(14, STRUCTURE_SETTINGS)).toBeCloseTo(60 / 14);
    expect(structureHitRadius(1000, STRUCTURE_SETTINGS)).toBeCloseTo(60 / 14);
    // No zoom or no settings: the floor.
    expect(structureHitRadius(0, STRUCTURE_SETTINGS)).toBe(2);
    expect(structureHitRadius(3, undefined)).toBe(2);
  });
});

describe("StructureRangeHoverController", () => {
  let game: any;
  let eventBus: any;
  let transformHandler: any;
  let view: any;
  let controller: StructureRangeHoverController;
  let handler: (e: MouseMoveEvent) => void;

  beforeEach(async () => {
    game = await setup(
      "giantworldmap",
      { infiniteGold: true, instantBuild: true },
      [new PlayerInfo("player1", PlayerType.Human, null, "player1_id")],
    );
    eventBus = { on: vi.fn() };
    transformHandler = {
      scale: 4,
      screenToWorldCoordinates: vi
        .fn()
        .mockImplementation((x, y) => ({ x, y })),
    };
    view = {
      updateHoverRange: vi.fn(),
      getSettings: () => ({ structure: STRUCTURE_SETTINGS }),
    };
    controller = new StructureRangeHoverController(
      game,
      eventBus,
      transformHandler,
      view,
    );
    controller.init();
    expect(eventBus.on).toHaveBeenCalledWith(
      MouseMoveEvent,
      expect.any(Function),
    );
    handler = eventBus.on.mock.calls[0][1];
  });

  it("shows a stargate's range when the cursor rests on it", () => {
    const player = game.player("player1_id");
    const tile = game.ref(200, 200);
    expect(game.isLand(tile)).toBe(true);
    player.conquer(tile);
    const gate = player.buildUnit(UnitType.Stargate, tile, {});

    // Within the hit radius (7.5 tiles at zoom 4), not on the exact tile.
    handler(new MouseMoveEvent(203, 202));

    expect(view.updateHoverRange).toHaveBeenCalledTimes(1);
    expect(view.updateHoverRange).toHaveBeenCalledWith({
      x: 200,
      y: 200,
      r: game.config().stargateRange(gate.level()),
      color: STARGATE_RANGE_COLOR,
    });

    // Staying on the same gate pushes nothing new.
    handler(new MouseMoveEvent(201, 201));
    expect(view.updateHoverRange).toHaveBeenCalledTimes(1);

    // Leaving it clears the disc, once.
    handler(new MouseMoveEvent(230, 230));
    handler(new MouseMoveEvent(240, 240));
    expect(view.updateHoverRange).toHaveBeenCalledTimes(2);
    expect(view.updateHoverRange).toHaveBeenLastCalledWith(null);
  });

  it("shows a shield array's dome in the shield colour", () => {
    const player = game.player("player1_id");
    const tile = game.ref(200, 200);
    player.conquer(tile);
    player.buildUnit(UnitType.ShieldArray, tile, {});

    handler(new MouseMoveEvent(200, 200));

    expect(view.updateHoverRange).toHaveBeenCalledWith({
      x: 200,
      y: 200,
      r: game.config().shieldArrayRadius(1),
      color: SHIELD_RANGE_COLOR,
    });
  });

  it("ignores other structures and tiles off the map", () => {
    const player = game.player("player1_id");
    const tile = game.ref(200, 200);
    player.conquer(tile);
    player.buildUnit(UnitType.City, tile, {});

    handler(new MouseMoveEvent(200, 200));
    handler(new MouseMoveEvent(-5, -5));
    expect(view.updateHoverRange).not.toHaveBeenCalled();
  });

  it("grows with an upgrade and clears when the gate is gone", () => {
    const player = game.player("player1_id");
    const tile = game.ref(200, 200);
    player.conquer(tile);
    const gate = player.buildUnit(UnitType.Stargate, tile, {});
    handler(new MouseMoveEvent(200, 200));
    expect(view.updateHoverRange).toHaveBeenCalledTimes(1);

    gate.increaseLevel();
    controller.tick();
    expect(view.updateHoverRange).toHaveBeenCalledTimes(2);
    expect(view.updateHoverRange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        r: game.config().stargateRange(gate.level()),
      }),
    );

    gate.delete(false);
    controller.tick();
    expect(view.updateHoverRange).toHaveBeenCalledTimes(3);
    expect(view.updateHoverRange).toHaveBeenLastCalledWith(null);
  });
});
