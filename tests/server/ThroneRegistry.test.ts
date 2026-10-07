import { describe, expect, it } from "vitest";
import {
  Throne,
  ThroneAction,
  ThroneObservation,
  ThroneRegistry,
} from "../../src/server/ThroneRegistry";

// Under a Dark Star (docs/DarkStar-Lobbies.md §3.2, §5.1, §5.7, L16-L27): the
// master's throne registry as pure state. Boot, the minimum to fire, the hold
// that keeps a countdown's remaining time, running rounds, a round ending
// (reported or vanished), the inactive deployment, the winner's window and
// seat, and the launch queue: one countdown per type, the order of the line,
// the floor and the retirement of surplus empty thrones.

const NAMES = ["Vega", "Sirius", "Altair", "Deneb", "Rigel"];
const T0 = 1_700_000_000_000;
const COUNTDOWN = 120_000;
const GRACE = 10_000;
const CULL = 60_000;
const WINDOW = 30_000;

function registry(ffa = 3, minPlayers = 2, special = 0, names = NAMES) {
  let n = 0;
  return new ThroneRegistry({
    names,
    floor: { ffa, team: 0, special },
    minPlayers,
    countdownMs: COUNTDOWN,
    windowMs: WINDOW,
    vanishGraceMs: GRACE,
    cullGraceMs: CULL,
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

function ids(thrones: readonly Throne[]): string[] {
  return thrones.map((t) => t.throneID);
}

function throne(reg: ThroneRegistry, n: number): Throne {
  const found = reg.get(`throne-${String(n).padStart(2, "0")}`);
  if (found === undefined) throw new Error(`no throne ${n}`);
  return found;
}

describe("ThroneRegistry", () => {
  it("names and types the opening floor in order, FFA first (L2, L14, L16)", () => {
    const reg = registry(2, 2, 1);
    expect(reg.all().map((t) => [t.throneID, t.name, t.type])).toEqual([
      ["throne-01", "Vega", "ffa"],
      ["throne-02", "Sirius", "ffa"],
      ["throne-03", "Altair", "special"],
    ]);
    // A floor of zero switches a type off.
    expect(reg.line("team")).toEqual([]);
    expect(() => registry(1, 2, 0, [])).toThrow(/names/);
  });

  it("starts every throne in line with the AI seated, reign 0 and no game (L12)", () => {
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
      place: 1,
    });
    expect(reg.info(reg.all()[1]).place).toBe(2);
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
    ).toBe(true);
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
    const t = reg.all()[0];
    expect(t.phase).toBe("gathering");
    expect(t.remainingMs).toBe(COUNTDOWN - 30_000);
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

  it("marks a reported running round, and opens a new throne to keep the floor (L16)", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { numPlayers: 2 } }));
    const started = reg.observe(
      T0 + 1000,
      reports({ g01: { numPlayers: 0, running: true } }),
    );
    expect(started).toEqual([
      {
        kind: "create",
        throne: throne(reg, 2),
        gameID: "g02",
        previousGameID: null,
      },
    ]);
    expect(throne(reg, 1).phase).toBe("running");
    expect(reg.placeOf(throne(reg, 1))).toBeUndefined();
    expect(throne(reg, 2)).toMatchObject({
      name: "Sirius",
      type: "ffa",
      seat: "open",
      phase: "gathering",
    });
    // A long round is not a vanished game while the worker keeps reporting it.
    expect(
      reg.observe(
        T0 + 3_600_000,
        reports({ g01: { numPlayers: 0, running: true }, g02: {} }),
      ),
    ).toEqual([]);
  });

  it("opens the successor the moment a round is reported over, at the back of the line (§5.8, L19)", () => {
    const reg = registry(2);
    reg.observe(T0, new Map());
    // throne-01 runs; throne-03 opens to keep the floor of two.
    reg.observe(T0, reports({ g01: { running: true }, g02: {} }));
    expect(ids(reg.line("ffa"))).toEqual(["throne-02", "throne-03"]);

    const actions = reg.roundEnded("g01", "ai", undefined, T0 + 1000);
    expect(actions).toEqual([
      {
        kind: "create",
        throne: throne(reg, 1),
        gameID: "g04",
        previousGameID: "g01",
      },
    ]);
    const t = throne(reg, 1);
    expect(t.gameID).toBe("g04");
    expect(t.phase).toBe("gathering");
    expect(t.roundsPlayed).toBe(1);
    expect(t.seat).toBe("open");
    expect(t.reign).toBe(0);
    expect(ids(reg.line("ffa"))).toEqual([
      "throne-02",
      "throne-03",
      "throne-01",
    ]);
    // The finished game is no longer current, so its lingering report is
    // stale and a repeat of its result is ignored.
    expect(reg.currentGameIDs().has("g01")).toBe(false);
    expect(reg.roundEnded("g01", "ai", undefined, T0 + 2000)).toEqual([]);
    expect(reg.roundEnded("never-ours", "void", undefined, T0 + 2000)).toEqual(
      [],
    );
  });

  it("records the winner's outcome without seating them yet", () => {
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

  it("recycles a lobby that vanished from every report past the grace period, keeping its place", () => {
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
    expect(ids(reg.line("ffa"))).toEqual(["throne-01", "throne-02"]);
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

  // --- The seat (§3.1, §3.2, §5.5, L4, L23) ---

  const ADA = { persistentID: "ada-pid", name: "Ada" };
  const BOB = { persistentID: "bob-pid", name: "Bob" };

  // throne-01's first round (g01) won by a human. Its start opened throne-02
  // (g02) to keep the floor of one, so the successor lobby is g03.
  function afterWin(
    outcome: "timer" | "overthrown",
    winner = ADA,
    reg = registry(1),
  ) {
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { running: true } }));
    const actions = reg.roundEnded("g01", outcome, winner, T0 + 1000);
    return { reg, actions, throne: throne(reg, 1) };
  }

  it("reserves the seat for a human winner, opens the successor at once and keeps it out of line (L4, L23)", () => {
    const { reg, actions, throne: t } = afterWin("overthrown");
    expect(actions).toEqual([
      { kind: "create", throne: t, gameID: "g03", previousGameID: "g01" },
    ]);
    expect(t).toMatchObject({
      phase: "deciding",
      seat: "reserved",
      heir: ADA,
      reservationUntil: T0 + 1000 + WINDOW,
      previousGameID: "g01",
      pendingReign: 1,
      holder: null,
      reign: 0,
    });
    expect(reg.info(t)).toMatchObject({
      seat: "reserved",
      holderName: "Ada",
      reservationUntil: T0 + 1000 + WINDOW,
    });
    expect(reg.placeOf(t)).toBeUndefined();
    expect(ids(reg.line("ffa"))).toEqual(["throne-02"]);
  });

  it("does not count down while the winner is choosing", () => {
    const { reg } = afterWin("overthrown");
    expect(
      reg.observe(T0 + 2000, reports({ g03: { numPlayers: 5 }, g02: {} })),
    ).toEqual([]);
  });

  it("seats a slayer who stays with a reign of 1, applies their map and puts the throne in line", () => {
    const { reg, throne: t } = afterWin("overthrown");
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
        gameID: "g03",
        pick: { gameMap: "Vega", stay: true },
        heir: ADA,
        reign: 1,
      },
    ]);
    expect(t).toMatchObject({
      phase: "gathering",
      seat: "seated",
      holder: ADA,
      heir: ADA,
      reign: 1,
      reservationUntil: null,
      priority: true,
    });
    // Nothing is counting down, so the kept seat is the head (L19).
    expect(ids(reg.line("ffa"))).toEqual(["throne-01", "throne-02"]);
    expect(
      kinds(
        reg.observe(T0 + 6000, reports({ g03: { numPlayers: 2 }, g02: {} })),
      ),
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
    reg.observe(T0 + 3000, reports({ g03: { running: true }, g02: {} }));
    reg.roundEnded("g03", "timer", ADA, T0 + 4000);
    expect(throne(reg, 1).pendingReign).toBe(2);
    reg.pickReceived(
      "throne-01",
      "g03",
      ADA.persistentID,
      { stay: true },
      T0 + 5000,
    );
    expect(throne(reg, 1).reign).toBe(2);

    // Ada steps away; Bob claims in the lobby (unknown to the registry) and
    // holds the timer: a reign of his own begins.
    reg.observe(T0 + 6000, reports({ g04: { running: true }, g02: {} }));
    reg.roundEnded("g04", "timer", BOB, T0 + 7000);
    expect(throne(reg, 1).pendingReign).toBe(1);
    reg.pickReceived(
      "throne-01",
      "g04",
      BOB.persistentID,
      { stay: true },
      T0 + 8000,
    );
    expect(throne(reg, 1)).toMatchObject({ holder: BOB, reign: 1 });
  });

  it("opens the seat, keeps the map and joins the back when the winner steps down (L5, L19)", () => {
    const { reg, throne: t } = afterWin("timer");
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
        gameID: "g03",
        pick: { gameMap: "Vega", stay: false },
        heir: null,
        reign: 0,
      },
    ]);
    expect(t).toMatchObject({
      phase: "gathering",
      seat: "open",
      holder: null,
      heir: null,
      reign: 0,
      priority: false,
    });
    expect(ids(reg.line("ffa"))).toEqual(["throne-02", "throne-01"]);
  });

  it("keeps the winner on the seat with a random map when the window runs out (L4)", () => {
    const { reg, throne: t } = afterWin("overthrown");
    const waiting = reports({ g03: { numPlayers: 2 }, g02: {} });
    expect(reg.observe(T0 + 1000 + WINDOW, waiting)).toEqual([]);
    const actions = reg.observe(T0 + 1001 + WINDOW, waiting);
    // Resolved, and with two players waiting the countdown starts in the
    // same pass.
    expect(kinds(actions)).toEqual(["pick", "countdown"]);
    expect(actions[0]).toEqual({
      kind: "pick",
      gameID: "g03",
      pick: { stay: true },
      heir: ADA,
      reign: 1,
    });
    expect(t).toMatchObject({
      seat: "seated",
      holder: ADA,
      heir: ADA,
      reign: 1,
      priority: true,
    });
    // A late answer is ignored.
    expect(
      reg.pickReceived(
        "throne-01",
        "g01",
        ADA.persistentID,
        { stay: false },
        T0 + 2000 + WINDOW,
      ),
    ).toEqual([]);
    expect(t.seat).toBe("seated");
  });

  it("ignores a pick from the wrong person, the wrong game, or a second one", () => {
    const { reg } = afterWin("overthrown");
    const pick = { stay: true };
    expect(
      reg.pickReceived("throne-01", "g01", BOB.persistentID, pick, T0 + 2000),
    ).toEqual([]);
    expect(
      reg.pickReceived("throne-01", "g03", ADA.persistentID, pick, T0 + 2000),
    ).toEqual([]);
    expect(
      reg.pickReceived("throne-99", "g01", ADA.persistentID, pick, T0 + 2000),
    ).toEqual([]);
    expect(throne(reg, 1).phase).toBe("deciding");
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
    expect(throne(reg, 1).seat).toBe("seated");
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
    reg.observe(T0 + 3000, reports({ g03: { running: true }, g02: {} }));
    reg.roundEnded("g03", "ai", undefined, T0 + 4000);
    expect(throne(reg, 1)).toMatchObject({
      phase: "gathering",
      seat: "open",
      holder: null,
      heir: null,
      reign: 0,
      previousGameID: null,
      priority: false,
    });
  });

  it("carries the reservation into a lobby created late, and resolves it there", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { running: true } }));
    // Inactive: no successor yet.
    expect(reg.roundEnded("g01", "overthrown", ADA, T0 + 1000, false)).toEqual(
      [],
    );
    expect(throne(reg, 1)).toMatchObject({
      gameID: null,
      phase: "deciding",
      heir: ADA,
    });
    // Active again inside the window: the create carries the heir.
    const actions = reg.observe(T0 + 2000, reports({ g02: {} }), true);
    expect(kinds(actions)).toEqual(["create"]);
    expect(throne(reg, 1).heir).toEqual(ADA);
    // Window over: the winner keeps the seat, and the (now existing) lobby
    // is told.
    expect(
      reg.observe(T0 + 2000 + WINDOW, reports({ g03: {}, g02: {} })),
    ).toEqual([
      {
        kind: "pick",
        gameID: "g03",
        pick: { stay: true },
        heir: ADA,
        reign: 1,
      },
    ]);
  });

  // --- The launch queue (L16-L22, L26) ---

  it("counts down only the head of a line (L17)", () => {
    const reg = registry(3);
    reg.observe(T0, new Map());
    const full = reports({
      g01: { numPlayers: 2 },
      g02: { numPlayers: 4 },
      g03: { numPlayers: 2 },
    });
    expect(reg.observe(T0, full)).toEqual([
      { kind: "countdown", gameID: "g01", startsAt: T0 + COUNTDOWN },
    ]);
    expect(reg.observe(T0 + 1000, full)).toEqual([]);
    expect(reg.all().map((t) => t.phase)).toEqual([
      "countdown",
      "gathering",
      "gathering",
    ]);
  });

  it("takes as head the first throne in line that has met the minimum (L18)", () => {
    const reg = registry(3);
    reg.observe(T0, new Map());
    expect(
      reg.observe(
        T0,
        reports({ g01: { numPlayers: 1 }, g02: {}, g03: { numPlayers: 3 } }),
      ),
    ).toEqual([{ kind: "countdown", gameID: "g03", startsAt: T0 + COUNTDOWN }]);
    // The throne that was passed over keeps its place behind the countdown.
    expect(ids(reg.line("ffa"))).toEqual([
      "throne-03",
      "throne-01",
      "throne-02",
    ]);
    expect(reg.info(throne(reg, 3)).place).toBe(1);
    expect(reg.info(throne(reg, 1)).place).toBe(2);
  });

  it("never interrupts a running countdown, and gives the next head a full one (L26)", () => {
    const reg = registry(3);
    reg.observe(T0, new Map());
    reg.observe(
      T0,
      reports({ g01: { numPlayers: 1 }, g02: {}, g03: { numPlayers: 3 } }),
    );
    // throne-01, ahead in line, now has the minimum too: it waits.
    expect(
      reg.observe(
        T0 + 1000,
        reports({ g01: { numPlayers: 5 }, g02: {}, g03: { numPlayers: 3 } }),
      ),
    ).toEqual([]);
    // throne-03 launches: throne-01 is head with a fresh two minutes, and a
    // new throne opens at the back.
    const actions = reg.observe(
      T0 + COUNTDOWN,
      reports({ g01: { numPlayers: 5 }, g02: {}, g03: { running: true } }),
    );
    expect(actions).toEqual([
      {
        kind: "countdown",
        gameID: "g01",
        startsAt: T0 + COUNTDOWN + COUNTDOWN,
      },
      {
        kind: "create",
        throne: throne(reg, 4),
        gameID: "g04",
        previousGameID: null,
      },
    ]);
    expect(ids(reg.line("ffa"))).toEqual([
      "throne-01",
      "throne-02",
      "throne-04",
    ]);
  });

  it("runs one countdown per type: the lines are independent (L16)", () => {
    const reg = registry(1, 2, 1);
    reg.observe(T0, new Map());
    expect(
      reg.observe(
        T0,
        reports({ g01: { numPlayers: 2 }, g02: { numPlayers: 2 } }),
      ),
    ).toEqual([
      { kind: "countdown", gameID: "g01", startsAt: T0 + COUNTDOWN },
      { kind: "countdown", gameID: "g02", startsAt: T0 + COUNTDOWN },
    ]);
  });

  it("drops a held throne's remaining time once another throne takes the countdown", () => {
    const reg = registry(2);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { numPlayers: 2 }, g02: {} }));
    expect(
      reg.observe(
        T0 + 30_000,
        reports({ g01: { numPlayers: 1 }, g02: { numPlayers: 2 } }),
      ),
    ).toEqual([
      { kind: "hold", gameID: "g01" },
      { kind: "countdown", gameID: "g02", startsAt: T0 + 30_000 + COUNTDOWN },
    ]);
    expect(throne(reg, 1).remainingMs).toBeNull();
  });

  it("puts a kept seat second, behind a running countdown and ahead of the open thrones (L19)", () => {
    const reg = registry(3);
    reg.observe(T0, new Map());
    // throne-01 runs; throne-04 opens to keep the floor.
    reg.observe(T0, reports({ g01: { running: true }, g02: {}, g03: {} }));
    // throne-02 starts counting down.
    expect(
      kinds(
        reg.observe(
          T0 + 1000,
          reports({
            g01: { running: true },
            g02: { numPlayers: 2 },
            g03: {},
            g04: {},
          }),
        ),
      ),
    ).toEqual(["countdown"]);
    reg.roundEnded("g01", "overthrown", ADA, T0 + 2000);
    reg.pickReceived(
      "throne-01",
      "g01",
      ADA.persistentID,
      { stay: true },
      T0 + 3000,
    );
    expect(ids(reg.line("ffa"))).toEqual([
      "throne-02",
      "throne-01",
      "throne-03",
      "throne-04",
    ]);
    expect(reg.info(throne(reg, 1)).place).toBe(2);
    expect(throne(reg, 2).phase).toBe("countdown");
  });

  it("orders several returning winners by arrival, and sends an open return to the back (L19)", () => {
    const reg = registry(3);
    reg.observe(T0, new Map());
    // All three run; three new thrones keep the floor.
    reg.observe(
      T0,
      reports({
        g01: { running: true },
        g02: { running: true },
        g03: { running: true },
      }),
    );
    expect(ids(reg.line("ffa"))).toEqual([
      "throne-04",
      "throne-05",
      "throne-06",
    ]);
    reg.roundEnded("g02", "overthrown", BOB, T0 + 1000);
    reg.roundEnded("g01", "overthrown", ADA, T0 + 2000);
    reg.roundEnded("g03", "ai", undefined, T0 + 3000);
    reg.pickReceived(
      "throne-02",
      "g02",
      BOB.persistentID,
      { stay: true },
      T0 + 4000,
    );
    reg.pickReceived(
      "throne-01",
      "g01",
      ADA.persistentID,
      { stay: true },
      T0 + 5000,
    );
    expect(ids(reg.line("ffa"))).toEqual([
      "throne-02",
      "throne-01",
      "throne-04",
      "throne-05",
      "throne-06",
      "throne-03",
    ]);
  });

  it("retires a surplus throne nobody is in after the cull grace, last in line first (L20)", () => {
    const reg = registry(2);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { running: true }, g02: {} }));
    // throne-01's round ends for the AI: it returns to the back, and the
    // line holds three against a floor of two.
    reg.roundEnded("g01", "ai", undefined, T0 + 1000);
    expect(ids(reg.line("ffa"))).toEqual([
      "throne-02",
      "throne-03",
      "throne-01",
    ]);
    const empty = reports({ g02: {}, g03: {}, g04: {} });
    expect(reg.observe(T0 + 2000, empty)).toEqual([]);
    expect(reg.observe(T0 + 2000 + CULL, empty)).toEqual([
      { kind: "retire", throneID: "throne-01", gameID: "g04" },
    ]);
    expect(reg.get("throne-01")).toBeUndefined();
    expect(reg.byGame("g04")).toBeUndefined();
    expect(ids(reg.line("ffa"))).toEqual(["throne-02", "throne-03"]);
    // At the floor: nothing more goes, however long it stays empty.
    expect(reg.observe(T0 + 2000 + 10 * CULL, quiet(reg))).toEqual([]);
  });

  it("retires the empty throne, not the one with someone in it (L20)", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { running: true } }));
    reg.roundEnded("g01", "ai", undefined, T0 + 1000);
    // One player followed throne-01 into its next lobby; throne-02 is empty.
    const followed = reports({ g02: {}, g03: { numPlayers: 1 } });
    expect(reg.observe(T0 + 2000, followed)).toEqual([]);
    expect(reg.observe(T0 + 2000 + CULL, followed)).toEqual([
      { kind: "retire", throneID: "throne-02", gameID: "g02" },
    ]);
    expect(ids(reg.line("ffa"))).toEqual(["throne-01"]);
  });

  it("hands names out in order and reuses them once it runs out", () => {
    const reg = registry(1, 2, 0, ["Vega", "Sirius"]);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { running: true } }));
    expect(throne(reg, 2).name).toBe("Sirius");
    reg.observe(
      T0 + 1000,
      reports({ g01: { running: true }, g02: { running: true } }),
    );
    expect(throne(reg, 3).name).toBe("Vega");
  });
});
