import { GameMapType } from "../core/game/Game";
import { nextReign } from "../core/Reign";
import {
  TeamCountConfig,
  ThroneInfo,
  ThroneSeatState,
  ThroneType,
} from "../core/Schemas";
import { ThroneModifier } from "../core/ThroneModifiers";
import { ThroneRoundOutcome } from "./IPCBridgeSchema";

// Under a Dark Star: the master's record of its public thrones
// (docs/DarkStar-Lobbies.md §3, §5.1, and the launch queues of L16-L27). A
// throne is a public lobby that runs rounds back to back under one name, and
// the winner of a round is the Hegemon of the next. This class is pure state
// and transitions, no I/O and no clock of its own: the master feeds it what
// the workers report and a timestamp, and it answers with the actions to
// take. Everything lives in memory (L12): a restart opens a fresh floor of
// thrones with the AI seated.
//
// Each throne's lobby moves through these phases:
//
//   deciding   — the round's winner holds a reservation on the seat and has
//                the winner's window (L4) to pick the next map and say
//                whether they stay or step down. The successor lobby is
//                already open so players can gather, but the throne is not
//                in line until the window resolves (L23).
//   gathering  — in line, waiting for its turn or for THRONE_MIN_PLAYERS
//                humans (L9). No countdown.
//   countdown  — this type's one running countdown (L17); startsAt was sent
//                to the worker (L10). A dip below the minimum HOLDS it: the
//                remaining time is kept and the worker's startsAt is
//                withdrawn. The time is kept only until another throne of
//                the type starts counting.
//   running    — the game started. The worker reports it until it is
//                reaped, so the lobby browser can list it (T3).
//
// The launch queue (L16-L22). Thrones of one type that are gathering or
// counting down form a line, ordered: the counting throne, then the thrones
// that came back from a round with a human on the seat (by arrival), then
// the rest (by arrival). Only one throne per type counts down, and it is the
// first in line with the minimum number of humans; a running countdown is
// never interrupted. Each line keeps at least `floor` thrones (a new one is
// opened at the back when it runs short) and loses its surplus thrones that
// nobody is in.
//
// A round ends when the worker reports it (throneRound, from the winner
// vote) or when the game vanishes from every worker's report for longer
// than the grace period (reaped empty, crashed, cancelled). Either way the
// throne opens the next lobby at once (§3.2).
//
// Identity is the browser's persistentID (L3), kept here and in the IPC and
// never sent to a client (§5.10): clients see the holder's name.

export type ThronePhase = "deciding" | "gathering" | "countdown" | "running";

export const THRONE_TYPES: readonly ThroneType[] = ["ffa", "team", "special"];

export interface ThroneHolder {
  persistentID: string;
  name: string;
}

export interface Throne {
  readonly throneID: string;
  readonly name: string;
  readonly type: ThroneType;
  // Consecutive rounds the holder has kept the seat (§3.1): a slayer starts
  // at 1, a timer win adds 1, an AI or vacated seat resets to 0.
  reign: number;
  // The human who holds the seat for the coming round (confirmed winner).
  // Players who claim an open seat in the lobby are the worker's business
  // and are not recorded here; their first timer win makes them the holder.
  holder: ThroneHolder | null;
  seat: ThroneSeatState;
  // The winner the seat is reserved for while deciding; after a "stay" the
  // same person, kept so the lobby reseats them if they leave and return.
  heir: ThroneHolder | null;
  reservationUntil: number | null;
  // What the heir's reign will be if they stay.
  pendingReign: number;
  // The finished game the heir's pick must come from.
  previousGameID: string | null;
  // The lobby or running game, null between a round ending and its successor
  // being created (only while creation is refused, e.g. an inactive
  // deployment).
  gameID: string | null;
  phase: ThronePhase;
  // The countdown the master last sent, while in countdown.
  startsAt: number | null;
  // A held countdown's remaining time (L10), carried into the next resume.
  remainingMs: number | null;
  // When a worker last reported gameID (or when it was created): a game not
  // seen for vanishGraceMs is taken to be gone.
  lastSeenAt: number;
  // Rounds this throne has finished since boot (telemetry, T6).
  roundsPlayed: number;
  // In line: came back from a round with a human on the seat, so it stands
  // ahead of the thrones that did not (L19). Fixed at entry (L24).
  priority: boolean;
  // In line: order of arrival, lower is earlier.
  enteredSeq: number;
  // Connected non-spectators, as last reported.
  numPlayers: number;
  // In line: since when the lobby has had no humans at all (L20).
  emptySince: number | null;
}

// What a worker's lobby list says about a throne's game this tick.
export interface ThroneObservation {
  // Connected non-spectators.
  numPlayers: number;
  // The round is in progress.
  running: boolean;
}

// The winner's answer (§5.5): the map, if they chose one, on a special
// throne the modifiers, if they chose any (§5.4), on a team throne the team
// split, if they chose one (L30), and whether they keep the seat.
export interface ThronePick {
  gameMap?: GameMapType;
  modifiers?: ThroneModifier[];
  playerTeams?: TeamCountConfig;
  stay: boolean;
}

export type ThroneAction =
  // Open a lobby for the throne under this game id. previousGameID names the
  // finished game whose players should be told about the successor; null when
  // there is nobody to tell (boot, a new throne, or a game that vanished).
  // The throne's heir and reservationUntil ride along to the worker.
  | {
      kind: "create";
      throne: Throne;
      gameID: string;
      previousGameID: string | null;
    }
  // This throne is its type's head and has the minimum: start (or resume)
  // the countdown.
  | { kind: "countdown"; gameID: string; startsAt: number }
  // The count dipped below the minimum: withdraw the countdown.
  | { kind: "hold"; gameID: string }
  // The window resolved: the winner answered, or it ran out and they keep
  // the seat on a random map (L4). Apply the map and keep or clear the heir.
  | {
      kind: "pick";
      gameID: string;
      pick: ThronePick;
      heir: ThroneHolder | null;
      reign: number;
    }
  // A surplus throne nobody is in was retired (L20): close its lobby.
  | { kind: "retire"; throneID: string; gameID: string | null };

export interface ThroneRegistryOptions {
  // Throne names (resources/thrones.json), handed out in order and reused
  // once a throne that carried one has been retired.
  names: readonly string[];
  // Thrones each type's line keeps open (L16). 0 switches the type off.
  floor: Readonly<Record<ThroneType, number>>;
  // Humans needed to fire (L9).
  minPlayers: number;
  // Countdown length once met (L10).
  countdownMs: number;
  // The winner's window (L4).
  windowMs: number;
  // How long a game may be missing from every worker's report before its
  // round is taken to be over.
  vanishGraceMs: number;
  // How long a surplus throne must have had nobody in it before it is
  // retired (L20). Longer than the vanish grace: the players of the round
  // that just ended are still on its win screen.
  cullGraceMs: number;
  mintGameID: () => string;
}

export const DEFAULT_VANISH_GRACE_MS = 10_000;

export class ThroneRegistry {
  private readonly thrones: Throne[] = [];
  private readonly byGameID = new Map<string, Throne>();
  private idSeq = 0;
  private lineSeq = 0;
  private nameCursor = 0;

  constructor(private readonly opts: ThroneRegistryOptions) {
    if (opts.names.length === 0) {
      throw new Error("ThroneRegistry: no throne names");
    }
    // The opening floor, FFA first, then team, then special (L2).
    for (const type of THRONE_TYPES) {
      for (let i = 0; i < Math.max(0, opts.floor[type]); i++) {
        this.addThrone(type);
      }
    }
  }

  all(): readonly Throne[] {
    return this.thrones;
  }

  minPlayers(): number {
    return this.opts.minPlayers;
  }

  get(throneID: string): Throne | undefined {
    return this.thrones.find((t) => t.throneID === throneID);
  }

  byGame(gameID: string): Throne | undefined {
    return this.byGameID.get(gameID);
  }

  // The game ids the thrones currently run. A worker keeps reporting a
  // finished round while its players sit on the win screen; entries for games
  // not in this set are stale and must not be advertised.
  currentGameIDs(): Set<string> {
    return new Set(this.byGameID.keys());
  }

  // A type's line in launch order (L16-L19): the counting throne, the
  // returned winners by arrival, then the rest by arrival.
  line(type: ThroneType): Throne[] {
    return this.thrones
      .filter((t) => t.type === type && inLine(t))
      .sort(
        (a, b) =>
          Number(b.phase === "countdown") - Number(a.phase === "countdown") ||
          Number(b.priority) - Number(a.priority) ||
          a.enteredSeq - b.enteredSeq,
      );
  }

  // A throne's place in its line, 1 for the next to launch; undefined while
  // it is deciding or running.
  placeOf(throne: Throne): number | undefined {
    if (!inLine(throne)) return undefined;
    const index = this.line(throne.type).indexOf(throne);
    return index < 0 ? undefined : index + 1;
  }

  // The throne's public face for lobby info and the lobby browser.
  info(throne: Throne): ThroneInfo {
    return {
      throneID: throne.throneID,
      name: throne.name,
      type: throne.type,
      reign: throne.reign,
      holderName: (throne.heir ?? throne.holder)?.name,
      seat: throne.seat,
      reservationUntil: throne.reservationUntil ?? undefined,
      place: this.placeOf(throne),
    };
  }

  // One scheduling pass. `reports` maps game id to what the workers last said
  // about it; a throne's game missing from it for longer than the grace
  // period ends the round. `allowCreate` is false on an inactive deployment,
  // which finishes what it runs but opens no new lobby and no new throne.
  observe(
    now: number,
    reports: ReadonlyMap<string, ThroneObservation>,
    allowCreate = true,
  ): ThroneAction[] {
    const actions: ThroneAction[] = [];

    // 1. Each throne: the window, the lobby, what the workers say.
    for (const throne of [...this.thrones]) {
      // The window runs on the master's clock whether or not the lobby exists
      // yet. No answer keeps the winner on the seat, on a random map (L4).
      if (
        throne.phase === "deciding" &&
        now > (throne.reservationUntil ?? now)
      ) {
        actions.push(...this.resolveWindow(throne, { stay: true }));
      }
      if (throne.gameID === null) {
        if (allowCreate) actions.push(this.create(throne, null, now));
        continue;
      }
      const report = reports.get(throne.gameID);
      if (report === undefined) {
        if (now - throne.lastSeenAt > this.opts.vanishGraceMs) {
          // Gone. A throne that was in line keeps its place; one that was
          // running or deciding joins the back with the seat open.
          const keepsPlace = inLine(throne);
          this.endRound(throne);
          this.openSeat(throne);
          if (keepsPlace) {
            throne.phase = "gathering";
          } else {
            this.enterLine(throne, false);
          }
          if (allowCreate) actions.push(this.create(throne, null, now));
        }
        continue;
      }
      throne.lastSeenAt = now;
      throne.numPlayers = report.numPlayers;
      if (report.running) {
        throne.phase = "running";
        throne.startsAt = null;
        throne.remainingMs = null;
        throne.emptySince = null;
        continue;
      }
      if (inLine(throne)) {
        throne.emptySince =
          report.numPlayers === 0 ? (throne.emptySince ?? now) : null;
      }
    }

    // 2. Each line: its one countdown (L17, L18, L26).
    for (const type of THRONE_TYPES) {
      let counting = this.thrones.find(
        (t) => t.type === type && t.phase === "countdown",
      );
      if (
        counting !== undefined &&
        counting.numPlayers < this.opts.minPlayers
      ) {
        counting.remainingMs = Math.max(0, (counting.startsAt ?? now) - now);
        counting.startsAt = null;
        counting.phase = "gathering";
        if (counting.gameID !== null) {
          actions.push({ kind: "hold", gameID: counting.gameID });
        }
        counting = undefined;
      }
      if (counting !== undefined) continue;
      const line = this.line(type);
      const head = line.find(
        (t) => t.gameID !== null && t.numPlayers >= this.opts.minPlayers,
      );
      if (head === undefined || head.gameID === null) continue;
      const startsAt = now + (head.remainingMs ?? this.opts.countdownMs);
      // The time a held throne had left is its own only until another takes
      // the countdown: the meter starts afresh for everyone else.
      for (const other of line) other.remainingMs = null;
      head.phase = "countdown";
      head.startsAt = startsAt;
      actions.push({ kind: "countdown", gameID: head.gameID, startsAt });
    }

    // 3. Each line keeps its floor: a new throne joins the back (L16).
    if (allowCreate) {
      for (const type of THRONE_TYPES) {
        while (this.line(type).length < this.opts.floor[type]) {
          actions.push(this.create(this.addThrone(type), null, now));
        }
      }
    }

    // 4. Surplus thrones nobody is in are retired, last in line first (L20).
    for (const type of THRONE_TYPES) {
      for (;;) {
        const line = this.line(type);
        if (line.length <= this.opts.floor[type]) break;
        const victim = line
          .reverse()
          .find(
            (t) =>
              t.phase === "gathering" &&
              t.emptySince !== null &&
              now - t.emptySince >= this.opts.cullGraceMs,
          );
        if (victim === undefined) break;
        actions.push(this.retire(victim));
      }
    }
    return actions;
  }

  // A worker reports a round's result. Ignored for a game that is not a
  // throne's current one (a repeat, or a round the registry already closed as
  // vanished). Opens the successor at once, naming the finished game so its
  // win screen can announce it (§5.8). A human winner gets the seat reserved
  // for the window (L4) and the throne waits out of line until it resolves
  // (L23); anything else opens the seat and joins the back (L19).
  roundEnded(
    gameID: string,
    outcome: ThroneRoundOutcome,
    winner: ThroneHolder | undefined,
    now: number,
    allowCreate = true,
  ): ThroneAction[] {
    const throne = this.byGameID.get(gameID);
    if (throne === undefined) return [];
    const previousHolder = throne.holder;
    this.endRound(throne);
    if (
      winner !== undefined &&
      (outcome === "timer" || outcome === "overthrown")
    ) {
      throne.seat = "reserved";
      throne.heir = winner;
      throne.reservationUntil = now + this.opts.windowMs;
      throne.previousGameID = gameID;
      throne.phase = "deciding";
      throne.emptySince = null;
      // A timer win extends the sitting holder's reign; a slayer, or a
      // claimant who held the timer, starts one (§3.1). The rule itself is
      // nextReign, shared with the results ingest (Accounts §5.4): the
      // reign brought into the round is the holder's, or 0 for anyone else.
      const reignBefore =
        previousHolder?.persistentID === winner.persistentID ? throne.reign : 0;
      throne.pendingReign = nextReign(outcome, reignBefore);
    } else {
      this.openSeat(throne);
      this.enterLine(throne, false);
    }
    return allowCreate ? [this.create(throne, gameID, now)] : [];
  }

  // The winner's answer from the finished game's socket (§5.5). Accepted
  // only from the heir, only while the window is open, only once (the phase
  // leaves deciding), and only from the game they won.
  pickReceived(
    throneID: string,
    fromGameID: string,
    persistentID: string,
    pick: ThronePick,
    now: number,
  ): ThroneAction[] {
    const throne = this.get(throneID);
    if (
      throne === undefined ||
      throne.phase !== "deciding" ||
      throne.previousGameID !== fromGameID ||
      throne.heir === null ||
      throne.heir.persistentID !== persistentID ||
      now > (throne.reservationUntil ?? now)
    ) {
      return [];
    }
    return this.resolveWindow(throne, pick);
  }

  // The window is over, by an answer or by the clock: seat or unseat the
  // winner and put the throne in line (L23). Staying stands it ahead of the
  // open thrones; stepping down sends it to the back (L19).
  private resolveWindow(throne: Throne, pick: ThronePick): ThroneAction[] {
    if (pick.stay && throne.heir !== null) {
      throne.holder = throne.heir;
      throne.reign = throne.pendingReign;
      throne.seat = "seated";
    } else {
      this.openSeat(throne);
    }
    throne.reservationUntil = null;
    throne.pendingReign = 0;
    this.enterLine(throne, throne.seat === "seated");
    if (throne.gameID === null) return [];
    return [
      {
        kind: "pick",
        gameID: throne.gameID,
        pick,
        heir: throne.heir,
        reign: throne.reign,
      },
    ];
  }

  // Nobody human holds or is owed the seat: the AI takes it at start (R6).
  private openSeat(throne: Throne) {
    throne.seat = "open";
    throne.holder = null;
    throne.heir = null;
    throne.reservationUntil = null;
    throne.pendingReign = 0;
    throne.reign = 0;
  }

  private enterLine(throne: Throne, priority: boolean) {
    throne.phase = "gathering";
    throne.priority = priority;
    throne.enteredSeq = ++this.lineSeq;
    throne.startsAt = null;
    throne.remainingMs = null;
    throne.emptySince = null;
  }

  private endRound(throne: Throne) {
    if (throne.gameID !== null) this.byGameID.delete(throne.gameID);
    throne.gameID = null;
    throne.previousGameID = null;
    throne.startsAt = null;
    throne.remainingMs = null;
    throne.numPlayers = 0;
    throne.roundsPlayed++;
  }

  private create(
    throne: Throne,
    previousGameID: string | null,
    now: number,
  ): ThroneAction {
    const gameID = this.opts.mintGameID();
    throne.gameID = gameID;
    throne.startsAt = null;
    throne.remainingMs = null;
    throne.numPlayers = 0;
    throne.lastSeenAt = now;
    this.byGameID.set(gameID, throne);
    return { kind: "create", throne, gameID, previousGameID };
  }

  // A new throne at the back of its type's line, the AI seated.
  private addThrone(type: ThroneType): Throne {
    const throne: Throne = {
      throneID: `throne-${String(++this.idSeq).padStart(2, "0")}`,
      name: this.nextName(),
      type,
      reign: 0,
      holder: null,
      seat: "open",
      heir: null,
      reservationUntil: null,
      pendingReign: 0,
      previousGameID: null,
      gameID: null,
      phase: "gathering",
      startsAt: null,
      remainingMs: null,
      lastSeenAt: 0,
      roundsPlayed: 0,
      priority: false,
      enteredSeq: ++this.lineSeq,
      numPlayers: 0,
      emptySince: null,
    };
    this.thrones.push(throne);
    return throne;
  }

  private retire(throne: Throne): ThroneAction {
    const gameID = throne.gameID;
    if (gameID !== null) this.byGameID.delete(gameID);
    this.thrones.splice(this.thrones.indexOf(throne), 1);
    return { kind: "retire", throneID: throne.throneID, gameID };
  }

  // The next name no living throne carries, in list order. With every name
  // taken (more thrones than names) the next in order is reused.
  private nextName(): string {
    const names = this.opts.names;
    const taken = new Set(this.thrones.map((t) => t.name));
    for (let i = 0; i < names.length; i++) {
      const name = names[(this.nameCursor + i) % names.length];
      if (!taken.has(name)) {
        this.nameCursor = (this.nameCursor + i + 1) % names.length;
        return name;
      }
    }
    const name = names[this.nameCursor % names.length];
    this.nameCursor = (this.nameCursor + 1) % names.length;
    return name;
  }
}

function inLine(throne: Throne): boolean {
  return throne.phase === "gathering" || throne.phase === "countdown";
}
