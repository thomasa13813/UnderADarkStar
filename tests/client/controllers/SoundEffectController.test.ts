import { SoundEffectController } from "../../../src/client/controllers/SoundEffectController";
import { PlaySoundEffectEvent } from "../../../src/client/sound/Sounds";
import { SendSpawnIntentEvent } from "../../../src/client/Transport";
import { EventBus } from "../../../src/core/EventBus";
import { MessageType, PlayerType, UnitType } from "../../../src/core/game/Game";
import { GameUpdateType } from "../../../src/core/game/GameUpdates";

describe("SoundEffectController", () => {
  let eventBus: EventBus;
  let played: string[];
  let tick: number;
  let units: Map<number, any>;
  let game: any;
  let controller: SoundEffectController;

  function makeDetonatedWarhead(id: number) {
    return {
      id: () => id,
      type: () => UnitType.MIRVWarhead,
      isActive: () => false,
      reachedTarget: () => true,
      createdAt: () => 0,
      owner: () => ({}),
    };
  }

  function tickWithUnits(...us: Array<{ id: () => number }>) {
    tick++;
    units = new Map(us.map((u) => [u.id(), u]));
    game.updatesSinceLastTick = () => ({
      [GameUpdateType.Unit]: us.map((u) => ({ id: u.id() })),
    });
    controller.tick();
  }

  beforeEach(() => {
    eventBus = new EventBus();
    played = [];
    eventBus.on(PlaySoundEffectEvent, (e) => played.push(e.effect));
    tick = 0;
    game = {
      ticks: () => tick,
      unit: (id: number) => units.get(id),
      myPlayer: () => null,
      updatesSinceLastTick: () => undefined,
    };
    controller = new SoundEffectController(game, eventBus);
  });

  it("plays at most one warhead boom per interval", () => {
    // 10 warheads detonate on the same tick — one boom.
    tickWithUnits(
      ...Array.from({ length: 10 }, (_, i) => makeDetonatedWarhead(i)),
    );
    expect(played).toEqual(["atom-hit"]);

    // More warheads land on the next few ticks — still inside the interval.
    tickWithUnits(makeDetonatedWarhead(20));
    tickWithUnits(makeDetonatedWarhead(21));
    expect(played).toEqual(["atom-hit"]);

    // Once the interval has passed, the next detonation booms again.
    tick += 5;
    tickWithUnits(makeDetonatedWarhead(30));
    expect(played).toEqual(["atom-hit", "atom-hit"]);
  });

  it("does not play a boom for intercepted warheads", () => {
    const intercepted = {
      id: () => 1,
      type: () => UnitType.MIRVWarhead,
      isActive: () => false,
      reachedTarget: () => false,
      createdAt: () => 0,
      owner: () => ({}),
    };
    tickWithUnits(intercepted);
    expect(played).toEqual([]);
  });

  // createdAt reads `tick` lazily, so the unit counts as created on whichever
  // tick tickWithUnits delivers it.
  function makeCreatedUnit(id: number, type: UnitType, owner: object) {
    return {
      id: () => id,
      type: () => type,
      isActive: () => true,
      reachedTarget: () => false,
      createdAt: () => tick,
      owner: () => owner,
      hasTrainStation: () => false,
    };
  }

  it("plays the battle cue for conquering a player, ka-ching for tribes", () => {
    game.myPlayer = () => ({ id: () => "me" });
    game.inSpawnPhase = () => false;
    const types: Record<string, PlayerType> = {
      human: PlayerType.Human,
      bot: PlayerType.Bot,
      nation: PlayerType.Nation,
    };
    game.player = (id: string) => ({ type: () => types[id] });
    game.updatesSinceLastTick = () => ({
      [GameUpdateType.ConquestEvent]: [
        { conquerorId: "me", conqueredId: "human" },
        { conquerorId: "me", conqueredId: "bot" },
        { conquerorId: "me", conqueredId: "nation" },
        { conquerorId: "other", conqueredId: "human" },
      ],
    });
    controller.tick();
    expect(played).toEqual(["conquered", "ka-ching", "ka-ching"]);
  });

  it("plays game-start when the spawn phase ends", () => {
    game.updatesSinceLastTick = () => ({
      [GameUpdateType.SpawnPhaseEnd]: [{ startTick: 10 }],
    });
    controller.tick();
    expect(played).toEqual(["game-start"]);
  });

  it("plays spawn on every spawn placement", () => {
    game.myPlayer = () => ({ isHegemon: () => false });
    controller.init();
    eventBus.emit(new SendSpawnIntentEvent(0 as never));
    eventBus.emit(new SendSpawnIntentEvent(1 as never));
    expect(played).toEqual(["spawn", "spawn"]);
  });

  it("the throne never hears a spawn cue: it has no spawn to place", () => {
    game.myPlayer = () => ({ isHegemon: () => true });
    controller.init();
    eventBus.emit(new SendSpawnIntentEvent(0 as never));
    expect(played).toEqual([]);
  });

  it("does not play spawn for spectators", () => {
    controller.init();
    eventBus.emit(new SendSpawnIntentEvent(0 as never));
    expect(played).toEqual([]);
  });

  it("plays nuke-warning only for nukes inbound to my player", () => {
    game.myPlayer = () => ({ smallID: () => 7 });
    game.inSpawnPhase = () => false;
    game.updatesSinceLastTick = () => ({
      [GameUpdateType.UnitIncoming]: [
        { playerID: 7, messageType: MessageType.NUKE_INBOUND },
        { playerID: 8, messageType: MessageType.HYDROGEN_BOMB_INBOUND },
        { playerID: 7, messageType: MessageType.NAVAL_INVASION_INBOUND },
      ],
    });
    controller.tick();
    expect(played).toEqual(["nuke-warning"]);
  });

  it("does not stack nuke warnings within the throttle interval", () => {
    game.myPlayer = () => ({ smallID: () => 7 });
    game.inSpawnPhase = () => false;
    game.updatesSinceLastTick = () => ({
      [GameUpdateType.UnitIncoming]: [
        { playerID: 7, messageType: MessageType.NUKE_INBOUND },
        { playerID: 7, messageType: MessageType.MIRV_INBOUND },
      ],
    });
    controller.tick();
    tick += 1;
    controller.tick();
    expect(played).toEqual(["nuke-warning"]);

    // Once the interval has passed, the next inbound nuke warns again.
    tick += 10;
    controller.tick();
    expect(played).toEqual(["nuke-warning", "nuke-warning"]);
  });

  it("plays build sounds only for my own factory and transport ship", () => {
    const me = {};
    game.myPlayer = () => me;
    game.inSpawnPhase = () => false;
    tickWithUnits(
      makeCreatedUnit(1, UnitType.Factory, me),
      makeCreatedUnit(2, UnitType.TransportShip, me),
      makeCreatedUnit(3, UnitType.Factory, {}),
      makeCreatedUnit(4, UnitType.TransportShip, {}),
    );
    expect(played).toEqual(["build-factory", "transport-ship"]);
  });

  describe("projectiles", () => {
    const TILE = 42;
    const me = { smallID: () => 1, isHegemon: () => false };
    const rival = { smallID: () => 2, isHegemon: () => false };
    const third = { smallID: () => 3, isHegemon: () => false };
    const throne = { smallID: () => 9, isHegemon: () => true };
    let tileOwner: any;

    beforeEach(() => {
      game.myPlayer = () => me;
      game.owner = (tile: number) => {
        expect(tile).toBe(TILE);
        return tileOwner;
      };
    });

    function asOwner(p: { smallID: () => number }) {
      return { isPlayer: () => true, smallID: p.smallID };
    }
    const noOwner = { isPlayer: () => false };

    // One projectile across its life: created at the gate, in flight, landed.
    function shot(id: number, owner: object) {
      const state = { created: true, active: true, landed: false };
      const unit = {
        id: () => id,
        type: () => UnitType.Projectile,
        isActive: () => state.active,
        reachedTarget: () => state.landed,
        createdAt: () => (state.created ? tick : -1),
        owner: () => owner,
        targetTile: () => TILE,
        hasTrainStation: () => false,
      };
      return {
        unit,
        fly() {
          state.created = false;
        },
        land() {
          state.created = false;
          state.active = false;
          state.landed = true;
        },
        recall() {
          state.created = false;
          state.active = false;
        },
      };
    }

    it("plays launch and landing for my own stargate shot", () => {
      tileOwner = asOwner(rival);
      const s = shot(1, me);
      tickWithUnits(s.unit);
      s.fly();
      tickWithUnits(s.unit);
      s.land();
      // The sim conquers the aimed tile as the shot lands: by now it is mine.
      tileOwner = asOwner(me);
      tickWithUnits(s.unit);
      expect(played).toEqual(["launch", "landing"]);
    });

    it("plays launch and landing for a shot coming down on my land", () => {
      tileOwner = asOwner(me);
      const s = shot(1, rival);
      tickWithUnits(s.unit);
      s.fly();
      tickWithUnits(s.unit);
      s.land();
      tileOwner = asOwner(rival);
      tickWithUnits(s.unit);
      expect(played).toEqual(["launch", "landing"]);
    });

    it("stays silent for a shot between two other players", () => {
      tileOwner = asOwner(rival);
      const s = shot(1, third);
      tickWithUnits(s.unit);
      s.fly();
      tickWithUnits(s.unit);
      s.land();
      tileOwner = asOwner(third);
      tickWithUnits(s.unit);
      expect(played).toEqual([]);
    });

    it("remembers the defender from the flight, not the landing tick", () => {
      // My land when launched at; conquered by the shooter as it lands.
      tileOwner = asOwner(me);
      const s = shot(1, rival);
      tickWithUnits(s.unit);
      s.land();
      tileOwner = asOwner(rival);
      tickWithUnits(s.unit);
      expect(played).toEqual(["launch", "landing"]);
      expect((controller as any).shotDefender.size).toBe(0);
    });

    it("hears a shot aimed at my land only once it is mine", () => {
      // Unclaimed when launched; I take the tile while the shot is in the air.
      tileOwner = noOwner;
      const s = shot(1, rival);
      tickWithUnits(s.unit);
      expect(played).toEqual([]);
      s.fly();
      tileOwner = asOwner(me);
      tickWithUnits(s.unit);
      s.land();
      tileOwner = asOwner(rival);
      tickWithUnits(s.unit);
      expect(played).toEqual(["landing"]);
    });

    it("plays nothing for a recalled shot and forgets it", () => {
      tileOwner = asOwner(rival);
      const s = shot(1, me);
      tickWithUnits(s.unit);
      s.recall();
      tickWithUnits(s.unit);
      expect(played).toEqual(["launch"]);
      expect((controller as any).shotDefender.size).toBe(0);
    });

    it("plays one landing cue when several shots come down together", () => {
      tileOwner = asOwner(rival);
      const shots = [shot(1, me), shot(2, me), shot(3, me)];
      tickWithUnits(...shots.map((s) => s.unit));
      shots.forEach((s) => s.land());
      tileOwner = asOwner(me);
      tickWithUnits(...shots.map((s) => s.unit));
      expect(played).toEqual(["launch", "launch", "launch", "landing"]);
    });

    it("treats the throne's strike as an invasion of my land", () => {
      tileOwner = asOwner(me);
      const s = shot(1, throne);
      tickWithUnits(s.unit);
      s.land();
      tileOwner = asOwner(throne);
      tickWithUnits(s.unit);
      expect(played).toEqual(["launch", "landing"]);
      expect((controller as any).shotDefender.size).toBe(0);
    });

    it("plays the throne's own strike to the throne, not to a bystander", () => {
      game.myPlayer = () => throne;
      tileOwner = asOwner(rival);
      const s = shot(1, throne);
      tickWithUnits(s.unit);
      s.land();
      tileOwner = asOwner(throne);
      tickWithUnits(s.unit);
      expect(played).toEqual(["launch", "landing"]);

      // A rival's shot at a third player: the throne is not involved.
      played.length = 0;
      tileOwner = asOwner(third);
      const other = shot(2, rival);
      tickWithUnits(other.unit);
      other.land();
      tileOwner = asOwner(rival);
      tickWithUnits(other.unit);
      expect(played).toEqual([]);
    });

    function missile(id: number, type: UnitType, owner: object) {
      const state = { created: true, active: true, hit: false };
      const unit = {
        id: () => id,
        type: () => type,
        isActive: () => state.active,
        reachedTarget: () => state.hit,
        createdAt: () => (state.created ? tick : -1),
        owner: () => owner,
        targetTile: () => TILE,
        hasTrainStation: () => false,
      };
      return {
        unit,
        detonate() {
          state.created = false;
          state.active = false;
          state.hit = true;
        },
      };
    }

    it("plays the missile cue to the launcher and the target, never the atom launch", () => {
      tileOwner = asOwner(rival);
      const mine = missile(1, UnitType.AtomBomb, me);
      tickWithUnits(mine.unit);
      expect(played).toEqual(["missile"]);

      tileOwner = asOwner(me);
      const atMe = missile(2, UnitType.HydrogenBomb, rival);
      tickWithUnits(atMe.unit);
      expect(played).toEqual(["missile", "missile"]);

      tileOwner = asOwner(third);
      const elsewhere = missile(3, UnitType.MIRV, rival);
      tickWithUnits(elsewhere.unit);
      expect(played).toEqual(["missile", "missile"]);
    });

    it("plays every missile launch to the Hegemon", () => {
      game.myPlayer = () => throne;
      tileOwner = asOwner(third);
      const m = missile(1, UnitType.AtomBomb, rival);
      tickWithUnits(m.unit);
      expect(played).toEqual(["missile"]);
    });

    it("plays a detonation to everyone", () => {
      tileOwner = asOwner(third);
      const m = missile(1, UnitType.HydrogenBomb, rival);
      tickWithUnits(m.unit);
      m.detonate();
      tickWithUnits(m.unit);
      expect(played).toEqual(["hydrogen-hit"]);
    });

    it("plays nothing to a spectator", () => {
      game.myPlayer = () => null;
      tileOwner = asOwner(rival);
      const s = shot(1, third);
      tickWithUnits(s.unit);
      s.land();
      tickWithUnits(s.unit);
      expect(played).toEqual([]);
    });
  });

  it("plays build-train-station when my structure gains a station", () => {
    const me = {};
    game.myPlayer = () => me;
    game.inSpawnPhase = () => false;
    let hasStation = false;
    const city = {
      id: () => 1,
      type: () => UnitType.City,
      isActive: () => true,
      reachedTarget: () => false,
      createdAt: () => 0,
      owner: () => me,
      hasTrainStation: () => hasStation,
    };
    tickWithUnits(city);
    expect(played).toEqual([]);
    hasStation = true;
    tickWithUnits(city);
    expect(played).toEqual(["build-train-station"]);
    tickWithUnits(city);
    expect(played).toEqual(["build-train-station"]);
  });

  it("plays one train-station cue when several structures gain stations at once", () => {
    const me = {};
    game.myPlayer = () => me;
    game.inSpawnPhase = () => false;
    let hasStation = false;
    const makeStructure = (id: number) => ({
      id: () => id,
      type: () => UnitType.City,
      isActive: () => true,
      reachedTarget: () => false,
      createdAt: () => 0,
      owner: () => me,
      hasTrainStation: () => hasStation,
    });
    const structures = [makeStructure(1), makeStructure(2), makeStructure(3)];
    tickWithUnits(...structures);
    hasStation = true;
    tickWithUnits(...structures);
    expect(played).toEqual(["build-train-station"]);
  });

  it("forgets structures that vanish without going inactive", () => {
    const me = {};
    game.myPlayer = () => me;
    game.inSpawnPhase = () => false;
    const city = {
      id: () => 1,
      type: () => UnitType.City,
      isActive: () => true,
      reachedTarget: () => false,
      createdAt: () => 0,
      owner: () => me,
      hasTrainStation: () => false,
    };
    tickWithUnits(city);
    const tracked = (controller as any).hadTrainStation as Map<number, boolean>;
    expect(tracked.size).toBe(1);

    // Out of view, and no inactive update ever arrives for it.
    for (let i = 0; i < 120; i++) tickWithUnits();

    expect(tracked.size).toBe(0);
  });

  it("does not replay the cue for a structure that comes back with a station", () => {
    // The reason handleTrainStation tests `prev === false` and not a falsy
    // value: a pruned structure reads as undefined when it returns, which has
    // to mean "first seen" and stay silent, not "was false" and fire.
    const me = {};
    game.myPlayer = () => me;
    game.inSpawnPhase = () => false;
    let hasStation = false;
    const city = {
      id: () => 1,
      type: () => UnitType.City,
      isActive: () => true,
      reachedTarget: () => false,
      createdAt: () => 0,
      owner: () => me,
      hasTrainStation: () => hasStation,
    };
    tickWithUnits(city);
    for (let i = 0; i < 120; i++) tickWithUnits();
    expect((controller as any).hadTrainStation.size).toBe(0);

    hasStation = true;
    tickWithUnits(city);

    expect(played).toEqual([]);
  });

  it("stays silent for a structure first seen with a station already", () => {
    const me = {};
    game.myPlayer = () => me;
    game.inSpawnPhase = () => false;
    const city = {
      id: () => 1,
      type: () => UnitType.City,
      isActive: () => true,
      reachedTarget: () => false,
      createdAt: () => 0,
      owner: () => me,
      hasTrainStation: () => true,
    };
    tickWithUnits(city);
    expect(played).toEqual([]);
  });
});
