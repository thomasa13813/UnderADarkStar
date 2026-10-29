import { describe, expect, it } from "vitest";
import {
  Throne,
  ThroneAction,
  ThroneHolder,
  ThroneObservation,
  ThroneRegistry,
} from "../../src/server/ThroneRegistry";

// Under a Dark Star (docs/DarkStar-Lobbies.md §3.2, §14, L32-L35, L39, L47):
// the master's room registry as pure state. The opening rooms, the minimum to
// fire, each room's own countdown and the hold that keeps its remaining time,
// running rounds, a round ending (reported or vanished), the inactive
// deployment, the winner's window (the countdown runs through it but never
// fires inside it; no answer opens the seat), and rooms opening at 75 % and
// closing after a minute empty.

const NAMES = ["Vega", "Sirius", "Altair", "Deneb", "Rigel"];
const T0 = 1_700_000_000_000;
const COUNTDOWN = 60_000;
const GRACE = 10_000;
const CLOSE = 60_000;
const WINDOW = 30_000;
const CAP = 50;
// 75 % of 50, rounded up.
const NEARLY_FULL = 38;

const ADA: ThroneHolder = { persistentID: "p-ada", name: "Ada" };
const BOB: ThroneHolder = { persistentID: "p-bob", name: "Bob" };

function registry(
  ffa = 1,
  team = 0,
  minPlayers = 2,
  names: readonly string[] = NAMES,
) {
  let n = 0;
  return new ThroneRegistry({
    names,
    rooms: { ffa, team, special: 0 },
    cap: CAP,
    minPlayers,
    countdownMs: COUNTDOWN,
    windowMs: WINDOW,
    vanishGraceMs: GRACE,
    closeGraceMs: CLOSE,
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

function kinds(actions: ThroneAction[]): string[] {
  return actions.map((a) => a.kind);
}

function throne(reg: ThroneRegistry, n: number): Throne {
  const found = reg.get(`throne-${String(n).padStart(2, "0")}`);
  if (found === undefined) throw new Error(`no throne ${n}`);
  return found;
}

// One FFA room whose first round (g01) ran and was won by `winner`; the
// successor lobby is g02.
function afterWin(outcome: "overthrown" | "timer", winner: ThroneHolder = ADA) {
  const reg = registry(1);
  reg.observe(T0, new Map());
  reg.observe(T0, reports({ g01: { running: true, numPlayers: 3 } }));
  const actions = reg.roundEnded("g01", outcome, winner, T0 + 1000);
  return { reg, actions, throne: throne(reg, 1) };
}

describe("ThroneRegistry rooms", () => {
  it("opens one FFA and one team room, FFA first, the AI seated (L32, L12)", () => {
    const reg = registry(1, 1);
    expect(reg.all().map((t) => [t.throneID, t.name, t.type])).toEqual([
      ["throne-01", "Vega", "ffa"],
      ["throne-02", "Sirius", "team"],
    ]);
    for (const t of reg.all()) {
      expect(t).toMatchObject({
        seat: "open",
        holder: null,
        reign: 0,
        gameID: null,
        phase: "gathering",
      });
    }
    expect(reg.info(reg.all()[0])).toEqual({
      throneID: "throne-01",
      name: "Vega",
      type: "ffa",
      reign: 0,
      holderName: undefined,
      seat: "open",
      reservationUntil: undefined,
    });
    expect(reg.cap()).toBe(CAP);
    expect(reg.roomsOf("special")).toEqual([]);
    expect(() => registry(1, 0, 2, [])).toThrow(/names/);
  });

  it("opens one lobby per room on the first pass, and only then", () => {
    const reg = registry(1, 1);
    const first = reg.observe(T0, new Map());
    expect(first.map((a) => a.kind === "create" && a.gameID)).toEqual([
      "g01",
      "g02",
    ]);
    expect(
      first.every((a) => a.kind === "create" && a.previousGameID === null),
    ).toBe(true);
    expect(reg.byGame("g02")?.throneID).toBe("throne-02");
    // Not yet reported: within the grace that is not a vanished game.
    expect(reg.observe(T0 + GRACE, new Map())).toEqual([]);
    expect(reg.observe(T0 + GRACE, reports({ g01: {}, g02: {} }))).toEqual([]);
  });

  it("opens nothing on an inactive deployment, and catches up when active", () => {
    const reg = registry(1, 1);
    expect(reg.observe(T0, new Map(), false)).toEqual([]);
    expect(kinds(reg.observe(T0 + 1000, new Map(), true))).toEqual([
      "create",
      "create",
    ]);
  });

  it("counts down a room once it has two humans, a minute (L34)", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    expect(reg.observe(T0 + 1000, reports({ g01: { numPlayers: 1 } }))).toEqual(
      [],
    );
    expect(reg.observe(T0 + 2000, reports({ g01: { numPlayers: 2 } }))).toEqual(
      [{ kind: "countdown", gameID: "g01", startsAt: T0 + 62_000 }],
    );
    expect(throne(reg, 1).phase).toBe("countdown");
    // Once only.
    expect(reg.observe(T0 + 3000, reports({ g01: { numPlayers: 3 } }))).toEqual(
      [],
    );
  });

  it("holds a countdown on a dip and resumes it with the time that was left (L10)", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { numPlayers: 2 } }));
    expect(
      reg.observe(T0 + 20_000, reports({ g01: { numPlayers: 1 } })),
    ).toEqual([{ kind: "hold", gameID: "g01" }]);
    expect(throne(reg, 1)).toMatchObject({
      phase: "gathering",
      startsAt: null,
      remainingMs: 40_000,
    });
    expect(
      reg.observe(T0 + 100_000, reports({ g01: { numPlayers: 2 } })),
    ).toEqual([{ kind: "countdown", gameID: "g01", startsAt: T0 + 140_000 }]);
  });

  it("runs every room's countdown on its own: no line (L34)", () => {
    const reg = registry(2);
    reg.observe(T0, new Map());
    // Two rooms open to start with, so both count down at once.
    expect(
      reg.observe(
        T0 + 1000,
        reports({ g01: { numPlayers: 2 }, g02: { numPlayers: 3 } }),
      ),
    ).toEqual([
      { kind: "countdown", gameID: "g01", startsAt: T0 + 61_000 },
      { kind: "countdown", gameID: "g02", startsAt: T0 + 61_000 },
    ]);
  });

  it("fires with the configured minimum, so one player can smoke-test in dev", () => {
    const reg = registry(1, 0, 1);
    reg.observe(T0, new Map());
    expect(
      kinds(reg.observe(T0 + 1000, reports({ g01: { numPlayers: 1 } }))),
    ).toEqual(["countdown"]);
  });

  it("opens the successor the moment a round ends with no human winner, seat open (L35)", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { running: true, numPlayers: 4 } }));
    expect(throne(reg, 1).phase).toBe("running");
    const actions = reg.roundEnded("g01", "ai", undefined, T0 + 1000);
    expect(actions).toEqual([
      {
        kind: "create",
        throne: throne(reg, 1),
        gameID: "g02",
        previousGameID: "g01",
      },
    ]);
    expect(throne(reg, 1)).toMatchObject({
      phase: "gathering",
      seat: "open",
      heir: null,
      roundsPlayed: 1,
    });
    // A repeat of the report is ignored.
    expect(reg.roundEnded("g01", "ai", undefined, T0 + 1100)).toEqual([]);
  });

  it("ends a round whose game vanished as void and gathers again (L39)", () => {
    const { reg } = afterWin("overthrown");
    reg.pickReceived("throne-01", "g01", ADA.persistentID, { stay: true }, T0);
    reg.observe(T0 + 2000, reports({ g02: { running: true } }));
    expect(throne(reg, 1).seat).toBe("seated");
    // Everyone left; the worker reaps the game and stops reporting it.
    expect(reg.observe(T0 + 2000 + GRACE, new Map())).toEqual([]);
    const actions = reg.observe(T0 + 3000 + GRACE, new Map());
    expect(kinds(actions)).toEqual(["create"]);
    expect(throne(reg, 1)).toMatchObject({
      phase: "gathering",
      seat: "open",
      holder: null,
      reign: 0,
      gameID: "g03",
    });
  });

  it("reserves the seat for a human winner and opens the successor at once (L4)", () => {
    const { reg, actions, throne: t } = afterWin("overthrown");
    expect(actions).toEqual([
      { kind: "create", throne: t, gameID: "g02", previousGameID: "g01" },
    ]);
    expect(t).toMatchObject({
      phase: "deciding",
      seat: "reserved",
      heir: ADA,
      reservationUntil: T0 + 1000 + WINDOW,
      previousGameID: "g01",
      pendingReign: 1,
      holder: null,
    });
    expect(reg.info(t)).toMatchObject({
      seat: "reserved",
      holderName: "Ada",
      reservationUntil: T0 + 1000 + WINDOW,
    });
  });

  it("counts down during the winner's window, never ending inside it (L34)", () => {
    const { reg } = afterWin("overthrown");
    // A minute from now is past the window: the countdown runs as usual.
    expect(reg.observe(T0 + 2000, reports({ g02: { numPlayers: 2 } }))).toEqual(
      [{ kind: "countdown", gameID: "g02", startsAt: T0 + 62_000 }],
    );
    expect(throne(reg, 1).phase).toBe("deciding");
    // The winner answers: the countdown carries on.
    expect(
      kinds(
        reg.pickReceived(
          "throne-01",
          "g01",
          ADA.persistentID,
          { stay: true },
          T0 + 5000,
        ),
      ),
    ).toEqual(["pick"]);
    expect(throne(reg, 1)).toMatchObject({
      phase: "countdown",
      startsAt: T0 + 62_000,
    });
    expect(reg.observe(T0 + 6000, reports({ g02: { numPlayers: 2 } }))).toEqual(
      [],
    );
  });

  it("never ends a countdown inside the window, even a short one", () => {
    // Dev's 5 s countdown is shorter than the window.
    const reg = new ThroneRegistry({
      names: NAMES,
      rooms: { ffa: 1, team: 0, special: 0 },
      cap: CAP,
      minPlayers: 2,
      countdownMs: 5_000,
      windowMs: WINDOW,
      vanishGraceMs: GRACE,
      closeGraceMs: CLOSE,
      mintGameID: (() => {
        let n = 0;
        return () => `g${String(++n).padStart(2, "0")}`;
      })(),
    });
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { running: true } }));
    reg.roundEnded("g01", "overthrown", ADA, T0 + 1000);
    expect(reg.observe(T0 + 2000, reports({ g02: { numPlayers: 2 } }))).toEqual(
      [{ kind: "countdown", gameID: "g02", startsAt: T0 + 1000 + WINDOW }],
    );
  });

  it("seats a slayer who stays with a reign of 1 and applies their map", () => {
    const { reg, throne: t } = afterWin("overthrown");
    expect(
      reg.pickReceived(
        "throne-01",
        "g01",
        ADA.persistentID,
        { gameMap: "Vega" as any, stay: true },
        T0 + 5000,
      ),
    ).toEqual([
      {
        kind: "pick",
        gameID: "g02",
        pick: { gameMap: "Vega", stay: true },
        heir: ADA,
        reign: 1,
      },
    ]);
    expect(t).toMatchObject({
      phase: "gathering",
      seat: "seated",
      holder: ADA,
      reign: 1,
      reservationUntil: null,
    });
  });

  it("extends the reign on a timer win by the holder, and starts one for anyone else", () => {
    const { reg } = afterWin("overthrown");
    reg.pickReceived("throne-01", "g01", ADA.persistentID, { stay: true }, T0);
    reg.observe(T0 + 2000, reports({ g02: { running: true } }));
    reg.roundEnded("g02", "timer", ADA, T0 + 3000);
    expect(throne(reg, 1).pendingReign).toBe(2);
    reg.pickReceived("throne-01", "g02", ADA.persistentID, { stay: true }, T0);
    reg.observe(T0 + 4000, reports({ g03: { running: true } }));
    reg.roundEnded("g03", "timer", BOB, T0 + 5000);
    expect(throne(reg, 1).pendingReign).toBe(1);
  });

  it("opens the seat and keeps the map when the winner steps down (L5)", () => {
    const { reg, throne: t } = afterWin("overthrown");
    expect(
      reg.pickReceived(
        "throne-01",
        "g01",
        ADA.persistentID,
        { gameMap: "Vega" as any, stay: false },
        T0 + 5000,
      ),
    ).toEqual([
      {
        kind: "pick",
        gameID: "g02",
        pick: { gameMap: "Vega", stay: false },
        heir: null,
        reign: 0,
      },
    ]);
    expect(t).toMatchObject({ seat: "open", holder: null, phase: "gathering" });
  });

  it("opens the seat on a random map when the winner never answers (L47)", () => {
    const { reg, throne: t } = afterWin("overthrown");
    expect(reg.observe(T0 + 1000 + WINDOW, reports({ g02: {} }))).toEqual([]);
    expect(
      reg.observe(T0 + 1001 + WINDOW, reports({ g02: { numPlayers: 1 } })),
    ).toEqual([
      {
        kind: "pick",
        gameID: "g02",
        pick: { stay: false },
        heir: null,
        reign: 0,
      },
    ]);
    expect(t).toMatchObject({
      seat: "open",
      holder: null,
      heir: null,
      reign: 0,
      phase: "gathering",
    });
    // Too late to answer now.
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

  it("carries the reservation into a lobby created late", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { running: true } }));
    expect(reg.roundEnded("g01", "overthrown", ADA, T0 + 1000, false)).toEqual(
      [],
    );
    expect(throne(reg, 1)).toMatchObject({ gameID: null, phase: "deciding" });
    expect(kinds(reg.observe(T0 + 2000, new Map(), true))).toEqual(["create"]);
    expect(throne(reg, 1).heir).toEqual(ADA);
  });

  // --- Opening and closing rooms (L32) ---

  it("opens another room once every room of the type holds 75 % of the cap", () => {
    const reg = registry(1, 1);
    reg.observe(T0, new Map());
    // FFA nearly full in its lobby, team not: one more FFA room.
    const actions = reg.observe(
      T0 + 1000,
      reports({
        g01: { numPlayers: NEARLY_FULL - 1 },
        g02: { numPlayers: 3 },
      }),
    );
    expect(kinds(actions)).toEqual(["countdown", "countdown"]);
    const opened = reg.observe(
      T0 + 2000,
      reports({ g01: { numPlayers: NEARLY_FULL, running: true }, g02: {} }),
    );
    expect(kinds(opened)).toContain("create");
    expect(reg.roomsOf("ffa").map((t) => t.name)).toEqual(["Vega", "Altair"]);
    expect(reg.roomsOf("team")).toHaveLength(1);
    // The new room is empty, so nothing more opens.
    expect(
      kinds(
        reg.observe(
          T0 + 3000,
          reports({
            g01: { numPlayers: CAP, running: true },
            g02: {},
            g03: {},
          }),
        ),
      ),
    ).not.toContain("create");
  });

  it("closes an added room after a minute with nobody in it, newest first", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { numPlayers: NEARLY_FULL } }));
    expect(reg.roomsOf("ffa")).toHaveLength(2);
    // The first room's round thins out; the added one stays empty.
    reg.observe(
      T0 + 1000,
      reports({ g01: { running: true, numPlayers: 10 }, g02: {} }),
    );
    expect(
      kinds(
        reg.observe(
          T0 + 1000 + CLOSE - 1,
          reports({ g01: { running: true, numPlayers: 10 }, g02: {} }),
        ),
      ),
    ).toEqual([]);
    const closing = reg.observe(
      T0 + 2000 + CLOSE,
      reports({ g01: { running: true, numPlayers: 10 }, g02: {} }),
    );
    expect(closing).toEqual([
      { kind: "retire", throneID: "throne-02", gameID: "g02" },
    ]);
    expect(reg.roomsOf("ffa").map((t) => t.throneID)).toEqual(["throne-01"]);
    expect(reg.byGame("g02")).toBeUndefined();
  });

  it("never closes the last room of a type, however long it is empty", () => {
    const reg = registry(1, 1);
    reg.observe(T0, new Map());
    expect(reg.observe(T0 + 10 * CLOSE, reports({ g01: {}, g02: {} }))).toEqual(
      [],
    );
    expect(reg.all()).toHaveLength(2);
  });

  it("does not close an empty room while the others would at once open another", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { numPlayers: NEARLY_FULL } }));
    expect(reg.roomsOf("ffa")).toHaveLength(2);
    reg.observe(
      T0 + 1000,
      reports({ g01: { running: true, numPlayers: NEARLY_FULL }, g02: {} }),
    );
    expect(
      reg.observe(
        T0 + 2000 + CLOSE,
        reports({ g01: { running: true, numPlayers: NEARLY_FULL }, g02: {} }),
      ),
    ).toEqual([]);
    expect(reg.roomsOf("ffa")).toHaveLength(2);
  });

  it("does not close a room someone is in, nor one whose round is running", () => {
    const reg = registry(1);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { numPlayers: NEARLY_FULL } }));
    reg.observe(
      T0 + 1000,
      reports({ g01: { numPlayers: 5 }, g02: { numPlayers: 1 } }),
    );
    expect(
      kinds(
        reg.observe(
          T0 + 2000 + CLOSE,
          reports({ g01: { numPlayers: 5 }, g02: { numPlayers: 1 } }),
        ),
      ),
    ).not.toContain("retire");
    reg.observe(
      T0 + 3000 + CLOSE,
      reports({ g01: { numPlayers: 5 }, g02: { running: true } }),
    );
    expect(
      kinds(
        reg.observe(
          T0 + 4000 + 3 * CLOSE,
          reports({ g01: { numPlayers: 5 }, g02: { running: true } }),
        ),
      ),
    ).not.toContain("retire");
  });

  it("hands names out in order and reuses them once a room has closed", () => {
    const reg = registry(1, 0, 2, ["Vega", "Sirius"]);
    reg.observe(T0, new Map());
    reg.observe(T0, reports({ g01: { numPlayers: NEARLY_FULL } }));
    expect(throne(reg, 2).name).toBe("Sirius");
    reg.observe(
      T0 + 1000,
      reports({
        g01: { numPlayers: NEARLY_FULL },
        g02: { numPlayers: NEARLY_FULL },
      }),
    );
    // Every name taken: the next in order is reused.
    expect(throne(reg, 3).name).toBe("Vega");
  });
});
