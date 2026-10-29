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

// Under a Dark Star: the master's record of its public rooms
// (docs/DarkStar-Lobbies.md §3 and the persistent rooms of §14, L32-L48). A
// room is a throne: a public lobby that runs rounds back to back under one
// name, and the winner of a round is the Hegemon of the next. This class is
// pure state and transitions, no I/O and no clock of its own: the master
// feeds it what the workers report and a timestamp, and it answers with the
// actions to take. Everything lives in memory (L12): a restart opens the
// opening rooms afresh with the AI seated.
//
// Each room's lobby moves through these phases:
//
//   deciding   — the round's winner holds a reservation on the seat and has
//                the winner's window (L4) to pick the next map and say
//                whether they stay or step down. The successor lobby is
//                already open, and its countdown may already run (L34), but
//                it never fires before the window closes.
//   gathering  — waiting for THRONE_MIN_PLAYERS humans (L9). No countdown.
//   countdown  — startsAt was sent to the worker (L10, L34). A dip below the
//                minimum HOLDS it: the remaining time is kept and the
//                worker's startsAt is withdrawn.
//   running    — the game started. The worker reports it until it is
//                reaped, so the lobby browser can list it (T3).
//
// Every room counts down on its own (L34); there is no line between them.
// Each type opens with `rooms` rooms. When every room of a type holds
// ROOM_OPEN_FRACTION of the cap, another opens (L32); a room added that way
// closes once it has had nobody in it for `closeGraceMs`, and a type never
// drops below its opening rooms.
//
// A round ends when the worker reports it (throneRound, from the winner
// vote) or when the game vanishes from every worker's report for longer
// than the grace period (reaped empty, crashed, cancelled): a round whose
// last human left ends void that way (L39). Either way the room opens the
// next lobby at once (§3.2, L35).
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
  // Connected non-spectators, as last reported.
  numPlayers: number;
  // While gathering: since when the lobby has had no humans at all (L32).
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
  // The room has the minimum: start (or resume) the countdown (L34).
  | { kind: "countdown"; gameID: string; startsAt: number }
  // The count dipped below the minimum: withdraw the countdown.
  | { kind: "hold"; gameID: string }
  // The window resolved: the winner answered, or it ran out and the seat
  // opens on a random map (L47). Apply the map and keep or clear the heir.
  | {
      kind: "pick";
      gameID: string;
      pick: ThronePick;
      heir: ThroneHolder | null;
      reign: number;
    }
  // An added room nobody is in was closed (L32): close its lobby.
  | { kind: "retire"; throneID: string; gameID: string | null };

export interface ThroneRegistryOptions {
  // Room names (resources/thrones.json), handed out in order and reused
  // once a room that carried one has been closed.
  names: readonly string[];
  // Rooms each type opens with and never drops below (L32). 0 switches the
  // type off.
  rooms: Readonly<Record<ThroneType, number>>;
  // Humans a room holds (L33); ROOM_OPEN_FRACTION of it opens another room.
  cap: number;
  // Humans needed to fire (L9, L34).
  minPlayers: number;
  // Countdown length once met (L34).
  countdownMs: number;
  // The winner's window (L4).
  windowMs: number;
  // How long a game may be missing from every worker's report before its
  // round is taken to be over.
  vanishGraceMs: number;
  // How long an added room must have had nobody in it before it closes
  // (L32).
  closeGraceMs: number;
  mintGameID: () => string;
}

// Every room of a type at this share of the cap opens another (L32).
export const ROOM_OPEN_FRACTION = 0.75;

export const DEFAULT_VANISH_GRACE_MS = 10_000;

export class ThroneRegistry {
  private readonly thrones: Throne[] = [];
  private readonly byGameID = new Map<string, Throne>();
  private idSeq = 0;
  private nameCursor = 0;

  constructor(private readonly opts: ThroneRegistryOptions) {
    if (opts.names.length === 0) {
      throw new Error("ThroneRegistry: no throne names");
    }
    // The opening rooms, FFA first, then team, then special (L32).
    for (const type of THRONE_TYPES) {
      for (let i = 0; i < Math.max(0, opts.rooms[type]); i++) {
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

  // The humans a room holds (L33).
  cap(): number {
    return this.opts.cap;
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

  // The rooms of a type, in the order they opened.
  roomsOf(type: ThroneType): Throne[] {
    return this.thrones.filter((t) => t.type === type);
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
    };
  }

  // One scheduling pass. `reports` maps game id to what the workers last said
  // about it; a throne's game missing from it for longer than the grace
  // period ends the round. `allowCreate` is false on an inactive deployment,
  // which finishes what it runs but opens no new lobby and no new room.
  observe(
    now: number,
    reports: ReadonlyMap<string, ThroneObservation>,
    allowCreate = true,
  ): ThroneAction[] {
    const actions: ThroneAction[] = [];

    // 1. Each room: the window, the lobby, what the workers say.
    for (const throne of [...this.thrones]) {
      // The window runs on the master's clock whether or not the lobby exists
      // yet. No answer opens the seat, on a random map (L47).
      if (
        throne.phase === "deciding" &&
        now > (throne.reservationUntil ?? now)
      ) {
        actions.push(...this.resolveWindow(throne, { stay: false }));
      }
      if (throne.gameID === null) {
        if (allowCreate) actions.push(this.create(throne, null, now));
        continue;
      }
      const report = reports.get(throne.gameID);
      if (report === undefined) {
        if (now - throne.lastSeenAt > this.opts.vanishGraceMs) {
          // Gone: a round nobody stayed in (L39), a crash, a cancel. The
          // seat opens and the room gathers again.
          this.endRound(throne);
          this.openSeat(throne);
          this.gather(throne);
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
      throne.emptySince =
        throne.phase === "gathering" && report.numPlayers === 0
          ? (throne.emptySince ?? now)
          : null;
      actions.push(...this.meter(throne, now));
    }

    // 2. Every room of a type nearly full: open another (L32).
    if (allowCreate) {
      for (const type of THRONE_TYPES) {
        if (this.opts.rooms[type] <= 0) continue;
        if (this.wantsRoom(this.roomsOf(type))) {
          actions.push(this.create(this.addThrone(type), null, now));
        }
      }
    }

    // 3. An added room nobody is in closes, newest first (L32). Never below
    // the opening rooms, and never while the rooms left would at once ask
    // for another.
    for (const type of THRONE_TYPES) {
      for (;;) {
        const rooms = this.roomsOf(type);
        if (rooms.length <= Math.max(1, this.opts.rooms[type])) break;
        const victim = [...rooms]
          .reverse()
          .find(
            (t) =>
              t.phase === "gathering" &&
              t.emptySince !== null &&
              now - t.emptySince >= this.opts.closeGraceMs,
          );
        if (victim === undefined) break;
        if (this.wantsRoom(rooms.filter((t) => t !== victim))) break;
        actions.push(this.retire(victim));
      }
    }
    return actions;
  }

  // The room's own countdown (L34): start it at the minimum, hold it on a
  // dip (L10). While the winner decides it may run, but it never ends before
  // the window does.
  private meter(throne: Throne, now: number): ThroneAction[] {
    if (throne.gameID === null) return [];
    const met = throne.numPlayers >= this.opts.minPlayers;
    if (throne.startsAt !== null) {
      if (met) return [];
      throne.remainingMs = Math.max(0, throne.startsAt - now);
      throne.startsAt = null;
      if (throne.phase === "countdown") throne.phase = "gathering";
      return [{ kind: "hold", gameID: throne.gameID }];
    }
    if (!met) return [];
    let startsAt = now + (throne.remainingMs ?? this.opts.countdownMs);
    if (throne.phase === "deciding" && throne.reservationUntil !== null) {
      startsAt = Math.max(startsAt, throne.reservationUntil);
    } else {
      throne.phase = "countdown";
    }
    throne.startsAt = startsAt;
    throne.remainingMs = null;
    return [{ kind: "countdown", gameID: throne.gameID, startsAt }];
  }

  // Every room of the type holds at least ROOM_OPEN_FRACTION of the cap.
  private wantsRoom(rooms: readonly Throne[]): boolean {
    const threshold = Math.ceil(this.opts.cap * ROOM_OPEN_FRACTION);
    return rooms.length > 0 && rooms.every((t) => t.numPlayers >= threshold);
  }

  // A worker reports a round's result. Ignored for a game that is not a
  // room's current one (a repeat, or a round the registry already closed as
  // vanished). Opens the successor at once, naming the finished game so its
  // win screen can announce it (§5.8, L35). A human winner gets the seat
  // reserved for the window (L4); anything else opens the seat.
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
      this.gather(throne);
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
  // winner. A countdown that started during the window carries on (L34).
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
    throne.phase = throne.startsAt !== null ? "countdown" : "gathering";
    throne.emptySince = null;
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

  private gather(throne: Throne) {
    throne.phase = "gathering";
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

  // A new room of the type, the AI seated.
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

  // The next name no living room carries, in list order. With every name
  // taken (more rooms than names) the next in order is reused.
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
