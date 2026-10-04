import { describe, expect, it } from "vitest";
import {
  ThroneAction,
  ThroneObservation,
  ThroneRegistry,
  throneTypes,
} from "../../src/server/ThroneRegistry";

// Under a Dark Star, T1 (docs/DarkStar-Lobbies.md §3.2, §5.1, §5.7): the
// master's throne registry as pure state. Every transition the first version
// has: boot, the minimum to fire, the hold that keeps a countdown's remaining
// time, running rounds, a round ending (reported or vanished), the inactive
// deployment, and the restart state.

const NAMES = ["Vega", "Sirius", "Altair", "Deneb", "Rigel"];
const T0 = 1_700_000_000_000;
const COUNTDOWN = 120_000;
const GRACE = 10_000;
const WINDOW = 30_000;

function registry(count = 3, minPlayers = 2) {
  let n = 0;
  return new ThroneRegistry({
    names: NAMES,
    count,
    mix: { ffa: count, team: 0, special: 0 },
    minPlayers,
    countdownMs: COUNTDOWN,
    windowMs: WINDOW,
    vanishGraceMs: GRACE,
    mintGameID: () => `g${String(++n).padStart(2, "0")}`,
  });
}

function reports(
  entries: Record<string, Partial<ThroneObservation>>,
): Map<string, ThroneObservation> {
  return new Map(
    Object.entries(entries).map(([gameID, o]) => [
      gameID,
      { numPlayers: o.numPlayers ?? 0, running: o.running ?? false },
    ]),
  );
}

// All thrones' current games, reported as lobbies with no players.
function quiet(reg: ThroneRegistry): Map<string, ThroneObservation> {
  const m = new Map<string, ThroneObservation>();
  for (const t of reg.all()) {
    if (t.gameID !== null) m.set(t.gameID, { numPlayers: 0, running: false });
  }
  return m;
}

function kinds(actions: ThroneAction[]): string[] {
  return actions.map((a) => a.kind);
}

describe("ThroneRegistry", () => {
  it("names and types the pool in order, FFA first (L1, L2, L14)", () => {
    const reg = registry(3);
    expect(reg.all().map((t) => [t.throneID, t.name, t.type])).toEqual([
      ["throne-01", "Vega", "ffa"],
      ["throne-02", "Sirius", "ffa"],
      ["throne-03", "Altair", "ffa"],
    ]);
    expect(throneTypes(5, { ffa: 2, team: 1, special: 1 })).toEqual([
      "ffa",
      "ffa",
      "team",
      "special",
      "ffa",
    ]);
    expect(throneTypes(2, { ffa: 1, team: 3, special: 3 })).toEqual([
      "ffa",
      "team",
    ]);
    expect(() => registry(NAMES.length + 1)).toThrow(/names/);
  });

  it("starts every throne with the AI seated, reign 0 and no game (L12)", () => {
    const reg = registry(2);
    for (const t of reg.all()) {
      expect(t.seat).toBe("open");
      expect(t.holder).toBeNull();
      expect(t.reign).toBe(0);
      expect(t.gameID).toBeNull();
      expect(t.phase).toBe("gathering");
    }
    expect(reg.info(reg.all()[0])).toEqual({
      throneID: "throne-01",
      name: "Vega",
      type: "ffa",
      reign: 0,
      holderName: undefined,
      seat: "open",
    });
  });

  it("opens one lobby per throne on the first pass, and only then", () => {
    const reg = registry(3);
    const first = reg.observe(T0, new Map());
    expect(kinds(first)).toEqual(["create", "create", "create"]);
    expect(first.map((a) => a.kind === "create" && a.gameID)).toEqual([
      "g01",
      "g02",
      "g03",
    ]);
    expect(
      first.every((a) => a.kind === "create" && a.previousGameID === null),
    );
    expect(reg.byGame("g02")?.throneID).toBe("throne-02");
    expect([...reg.currentGameIDs()].sort()).toEqual(["g01", "g02", "g03"]);

    // The workers have not reported the new games yet: within the grace
    // period that is not a vanished game.
    expect(reg.observe(T0 + GRACE, new Map())).toEqual([]);
    expect(reg.observe(T0 + GRACE, quiet(reg))).toEqual([]);
  });

  it("opens nothing on an inactive deployment, and catches up when active", () => {
    const reg = registry(2);
    expect(reg.observe(T0, new Map(), false)).toEqual([]);
    expect(reg.all().every((t) => t.gameID === null)).toBe(true);
    expect(kinds(reg.observe(T0 + 1000, new Map(), true))).toEqual([
      "create",
      "create",
    ]);
  });

  it("starts the countdown when the minimum is met, once (L9, L10)", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    const r = reports({ g01: { numPlayers: 1 } });
    expect(reg.observe(T0 + 1000, r)).toEqual([]);

    const met = reports({ g01: { numPlayers: 2 } });
    expect(reg.observe(T0 + 2000, met)).toEqual([
      { kind: "countdown", gameID: "g01", startsAt: T0 + 2000 + COUNTDOWN },
    ]);
    expect(reg.all()[0].phase).toBe("countdown");
    // More players, or the same report again, do not restart it.
    expect(reg.observe(T0 + 3000, reports({ g01: { numPlayers: 5 } }))).toEqual(
      [],
    );
  });

  it("holds a countdown on a dip and resumes it with the time that was left", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { numPlayers: 2 } }));

    // 30 s in, one player leaves: the countdown is withdrawn, 90 s kept.
    expect(
      reg.observe(T0 + 30_000, reports({ g01: { numPlayers: 1 } })),
    ).toEqual([{ kind: "hold", gameID: "g01" }]);
    const throne = reg.all()[0];
    expect(throne.phase).toBe("gathering");
    expect(throne.remainingMs).toBe(COUNTDOWN - 30_000);
    // Still short: nothing more to say.
    expect(
      reg.observe(T0 + 60_000, reports({ g01: { numPlayers: 1 } })),
    ).toEqual([]);
    // Two again, much later: 90 s from now, not a fresh two minutes.
    expect(
      reg.observe(T0 + 600_000, reports({ g01: { numPlayers: 2 } })),
    ).toEqual([
      {
        kind: "countdown",
        gameID: "g01",
        startsAt: T0 + 600_000 + COUNTDOWN - 30_000,
      },
    ]);
  });

  it("holds at zero when the dip comes after the countdown ran out", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { numPlayers: 2 } }));
    // The worker has not started it (its own guard) and reports the dip.
    expect(
      reg.observe(T0 + COUNTDOWN + 5000, reports({ g01: { numPlayers: 1 } })),
    ).toEqual([{ kind: "hold", gameID: "g01" }]);
    expect(reg.all()[0].remainingMs).toBe(0);
    // Back to two: starts now.
    expect(
      reg.observe(T0 + COUNTDOWN + 9000, reports({ g01: { numPlayers: 2 } })),
    ).toEqual([
      { kind: "countdown", gameID: "g01", startsAt: T0 + COUNTDOWN + 9000 },
    ]);
  });

  it("marks a reported running round and leaves it alone", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { numPlayers: 2 } }));
    expect(
      reg.observe(
        T0 + 1000,
        reports({ g01: { numPlayers: 0, running: true } }),
      ),
    ).toEqual([]);
    expect(reg.all()[0].phase).toBe("running");
    // A long round is not a vanished game while the worker keeps reporting it.
    expect(
      reg.observe(
        T0 + 3_600_000,
        reports({ g01: { numPlayers: 0, running: true } }),
      ),
    ).toEqual([]);
  });

  it("opens the successor the moment a round is reported over (§5.8)", () => {
    const reg = registry(2);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { running: true }, g02: {} }));

    const actions = reg.roundEnded("g01", "ai", undefined, T0 + 1000);
    expect(actions).toEqual([
      {
        kind: "create",
        throne: reg.all()[0],
        gameID: "g03",
        previousGameID: "g01",
      },
    ]);
    const throne = reg.all()[0];
    expect(throne.gameID).toBe("g03");
    expect(throne.phase).toBe("gathering");
    expect(throne.roundsPlayed).toBe(1);
    // T1: the seat stays the AI's whatever the outcome.
    expect(throne.seat).toBe("open");
    expect(throne.reign).toBe(0);
    // The finished game is no longer current, so its lingering report is
    // stale and a repeat of its result is ignored.
    expect(reg.currentGameIDs().has("g01")).toBe(false);
    expect(reg.roundEnded("g01", "ai", undefined, T0 + 2000)).toEqual([]);
    expect(reg.roundEnded("never-ours", "void", undefined, T0 + 2000)).toEqual(
      [],
    );
  });

  it("records the winner's outcome without seating them yet (T2 does)", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    const winner = { persistentID: "p-1", name: "Ada" };
    expect(kinds(reg.roundEnded("g01", "overthrown", winner, T0))).toEqual([
      "create",
    ]);
    expect(reg.all()[0].holder).toBeNull();
  });

  it("does not open the successor on an inactive deployment", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    expect(reg.roundEnded("g01", "void", undefined, T0, false)).toEqual([]);
    expect(reg.all()[0].gameID).toBeNull();
    // Reactivated: the next pass opens it.
    expect(kinds(reg.observe(T0 + 1000, new Map(), true))).toEqual(["create"]);
  });

  it("recycles a game that vanished from every report past the grace period", () => {
    const reg = registry(2);
    reg.observe(T0, new Map());
    reg.observe(T0 + 1000, quiet(reg));
    // g02 drops out of the reports (reaped empty, worker crash, ...).
    const only1 = reports({ g01: {} });
    expect(reg.observe(T0 + 1000 + GRACE, only1)).toEqual([]);
    const actions = reg.observe(T0 + 1000 + GRACE + 1, only1);
    expect(actions).toEqual([
      {
        kind: "create",
        throne: reg.all()[1],
        gameID: "g03",
        previousGameID: null,
      },
    ]);
    expect(reg.all()[1].roundsPlayed).toBe(1);
    expect(reg.byGame("g02")).toBeUndefined();
  });

  it("forgets a held countdown when the round ends", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { numPlayers: 2 } }));
    reg.observe(T0 + 10_000, reports({ g01: { numPlayers: 1 } }));
    expect(reg.all()[0].remainingMs).toBe(COUNTDOWN - 10_000);
    reg.roundEnded("g01", "void", undefined, T0 + 20_000);
    expect(reg.all()[0].remainingMs).toBeNull();
    // The new lobby counts down from the full length.
    expect(
      reg.observe(T0 + 30_000, reports({ g02: { numPlayers: 2 } })),
    ).toEqual([
      { kind: "countdown", gameID: "g02", startsAt: T0 + 30_000 + COUNTDOWN },
    ]);
  });

  it("fires with the configured minimum, so one player can smoke-test in dev", () => {
    const reg = registry(1, 1);
    reg.observe(T0, new Map());
    expect(kinds(reg.observe(T0, reports({ g01: { numPlayers: 1 } })))).toEqual(
      ["countdown"],
    );
  });

  // --- T2: the seat (§3.1, §3.2, §5.5) ---

  const ADA = { persistentID: "ada-pid", name: "Ada" };
  const BOB = { persistentID: "bob-pid", name: "Bob" };

  function afterWin(
    outcome: "timer" | "overthrown",
    winner = ADA,
    reg = registry(1),
  ) {
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { running: true } }));
    const actions = reg.roundEnded("g01", outcome, winner, T0 + 1000);
    return { reg, actions, throne: reg.all()[0] };
  }

  it("reserves the seat for a human winner and opens the successor at once", () => {
    const { actions, throne } = afterWin("overthrown");
    expect(actions).toEqual([
      { kind: "create", throne, gameID: "g02", previousGameID: "g01" },
    ]);
    expect(throne).toMatchObject({
      phase: "deciding",
      seat: "reserved",
      heir: ADA,
      reservationUntil: T0 + 1000 + WINDOW,
      previousGameID: "g01",
      pendingReign: 1,
      holder: null,
      reign: 0,
    });
    expect(reg_info(throne)).toMatchObject({
      seat: "reserved",
      holderName: "Ada",
      reservationUntil: T0 + 1000 + WINDOW,
    });
  });

  function reg_info(
    throne: ReturnType<
      typeof registry
    >["all"] extends () => readonly (infer T)[]
      ? T
      : never,
  ) {
    return registry(1).info(throne);
  }

  it("does not count down while the winner is choosing", () => {
    const { reg } = afterWin("overthrown");
    expect(reg.observe(T0 + 2000, reports({ g02: { numPlayers: 5 } }))).toEqual(
      [],
    );
  });

  it("seats a slayer who stays with a reign of 1 and applies their map", () => {
    const { reg, throne } = afterWin("overthrown");
    const actions = reg.pickReceived(
      "throne-01",
      "g01",
      ADA.persistentID,
      { gameMap: "Vega" as any, stay: true },
      T0 + 5000,
    );
    expect(actions).toEqual([
      {
        kind: "pick",
        gameID: "g02",
        pick: { gameMap: "Vega", stay: true },
        heir: ADA,
        reign: 1,
      },
    ]);
    expect(throne).toMatchObject({
      phase: "gathering",
      seat: "seated",
      holder: ADA,
      heir: ADA,
      reign: 1,
      reservationUntil: null,
    });
    // The lobby may count down now.
    expect(
      kinds(reg.observe(T0 + 6000, reports({ g02: { numPlayers: 2 } }))),
    ).toEqual(["countdown"]);
  });

  it("extends the reign on a timer win by the holder, and starts one for anyone else", () => {
    const { reg } = afterWin("overthrown");
    reg.pickReceived(
      "throne-01",
      "g01",
      ADA.persistentID,
      { stay: true },
      T0 + 2000,
    );
    reg.observe(T0 + 3000, reports({ g02: { running: true } }));
    reg.roundEnded("g02", "timer", ADA, T0 + 4000);
    expect(reg.all()[0].pendingReign).toBe(2);
    reg.pickReceived(
      "throne-01",
      "g02",
      ADA.persistentID,
      { stay: true },
      T0 + 5000,
    );
    expect(reg.all()[0].reign).toBe(2);

    // Ada steps away; Bob claims in the lobby (unknown to the registry) and
    // holds the timer: a reign of his own begins.
    reg.observe(T0 + 6000, reports({ g03: { running: true } }));
    reg.roundEnded("g03", "timer", BOB, T0 + 7000);
    expect(reg.all()[0].pendingReign).toBe(1);
    reg.pickReceived(
      "throne-01",
      "g03",
      BOB.persistentID,
      { stay: true },
      T0 + 8000,
    );
    expect(reg.all()[0]).toMatchObject({ holder: BOB, reign: 1 });
  });

  it("opens the seat and keeps the map when the winner steps down (L5)", () => {
    const { reg, throne } = afterWin("timer");
    const actions = reg.pickReceived(
      "throne-01",
      "g01",
      ADA.persistentID,
      { gameMap: "Vega" as any, stay: false },
      T0 + 5000,
    );
    expect(actions).toEqual([
      {
        kind: "pick",
        gameID: "g02",
        pick: { gameMap: "Vega", stay: false },
        heir: null,
        reign: 0,
      },
    ]);
    expect(throne).toMatchObject({
      phase: "gathering",
      seat: "open",
      holder: null,
      heir: null,
      reign: 0,
    });
  });

  it("opens the seat when the window runs out, random map, reign 0", () => {
    const { reg, throne } = afterWin("overthrown");
    expect(
      reg.observe(T0 + 1000 + WINDOW, reports({ g02: { numPlayers: 2 } })),
    ).toEqual([]);
    const actions = reg.observe(
      T0 + 1001 + WINDOW,
      reports({ g02: { numPlayers: 2 } }),
    );
    // Expired, and with two players waiting the countdown starts in the
    // same pass.
    expect(kinds(actions)).toEqual(["expire", "countdown"]);
    expect(actions[0]).toEqual({ kind: "expire", gameID: "g02" });
    expect(throne).toMatchObject({ seat: "open", heir: null, reign: 0 });
    // A late answer is ignored.
    expect(
      reg.pickReceived(
        "throne-01",
        "g01",
        ADA.persistentID,
        { stay: true },
        T0 + 2000 + WINDOW,
      ),
    ).toEqual([]);
  });

  it("ignores a pick from the wrong person, the wrong game, or a second one", () => {
    const { reg } = afterWin("overthrown");
    const pick = { stay: true };
    expect(
      reg.pickReceived("throne-01", "g01", BOB.persistentID, pick, T0 + 2000),
    ).toEqual([]);
    expect(
      reg.pickReceived("throne-01", "g02", ADA.persistentID, pick, T0 + 2000),
    ).toEqual([]);
    expect(
      reg.pickReceived("throne-99", "g01", ADA.persistentID, pick, T0 + 2000),
    ).toEqual([]);
    expect(reg.all()[0].phase).toBe("deciding");
    expect(
      kinds(
        reg.pickReceived("throne-01", "g01", ADA.persistentID, pick, T0 + 2000),
      ),
    ).toEqual(["pick"]);
    expect(
      reg.pickReceived(
        "throne-01",
        "g01",
        ADA.persistentID,
        { stay: false },
        T0 + 2500,
      ),
    ).toEqual([]);
    expect(reg.all()[0].seat).toBe("seated");
  });

  it("opens the seat for an AI or void round, dropping any holder", () => {
    const { reg } = afterWin("overthrown");
    reg.pickReceived(
      "throne-01",
      "g01",
      ADA.persistentID,
      { stay: true },
      T0 + 2000,
    );
    reg.observe(T0 + 3000, reports({ g02: { running: true } }));
    reg.roundEnded("g02", "ai", undefined, T0 + 4000);
    expect(reg.all()[0]).toMatchObject({
      phase: "gathering",
      seat: "open",
      holder: null,
      heir: null,
      reign: 0,
      previousGameID: null,
    });
  });

  it("carries the reservation into a lobby created late, and lets it expire there", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { running: true } }));
    // Inactive: no successor yet.
    expect(reg.roundEnded("g01", "overthrown", ADA, T0 + 1000, false)).toEqual(
      [],
    );
    expect(reg.all()[0]).toMatchObject({
      gameID: null,
      phase: "deciding",
      heir: ADA,
    });
    // Active again inside the window: the create carries the heir.
    const actions = reg.observe(T0 + 2000, new Map(), true);
    expect(kinds(actions)).toEqual(["create"]);
    expect(reg.all()[0].heir).toEqual(ADA);
    // Window over: opened, and told to the (now existing) lobby.
    expect(reg.observe(T0 + 2000 + WINDOW, reports({ g02: {} }))).toEqual([
      { kind: "expire", gameID: "g02" },
    ]);
  });
});
