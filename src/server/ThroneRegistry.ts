import { GameMapType } from "../core/game/Game";
import { ThroneInfo, ThroneSeatState, ThroneType } from "../core/Schemas";
import { ThroneModifier } from "../core/ThroneModifiers";
import { ThroneRoundOutcome } from "./IPCBridgeSchema";

// Under a Dark Star: the master's record of its public thrones
// (docs/DarkStar-Lobbies.md §3, §5.1). A throne is a persistent public lobby
// slot: it runs rounds back to back under one name, and the winner of a round
// is the Hegemon of the next. This class is pure state and transitions, no
// I/O and no clock of its own: the master feeds it what the workers report
// and a timestamp, and it answers with the actions to take. Everything lives
// in memory (L12): a restart reopens every throne with the AI seated.
//
// Each throne's lobby moves through these phases:
//
//   deciding   — the round's winner holds a reservation on the seat and has
//                the winner's window (L4) to pick the next map and say
//                whether they stay or step down. The successor lobby is
//                already open so players can gather, but it does not count
//                down until the window resolves.
//   gathering  — the lobby is open and waiting for THRONE_MIN_PLAYERS humans
//                (L9). No countdown.
//   countdown  — the minimum was met; startsAt was sent to the worker (L10).
//                A dip below the minimum HOLDS the countdown: the remaining
//                time is kept and the worker's startsAt is withdrawn, so
//                reaching the minimum again resumes without resetting.
//   running    — the game started. The worker reports it until it is
//                reaped, so the Thrones tab can list it (T3).
//
// A round ends when the worker reports it (throneRound, from the winner
// vote) or when the game vanishes from every worker's report for longer
// than the grace period (reaped empty, crashed, cancelled). Either way the
// throne opens the next lobby at once (§3.2).
//
// Identity is the browser's persistentID (L3), kept here and in the IPC and
// never sent to a client (§5.10): clients see the holder's name.

export type ThronePhase = "deciding" | "gathering" | "countdown" | "running";

export interface ThroneHolder {
  persistentID: string;
  name: string;
}

export interface Throne {
  readonly throneID: string;
  readonly name: string;
  readonly type: ThroneType;
  // Consecutive rounds the holder has kept the seat (§3.1): a slayer starts
  // at 1, a timer win adds 1, an AI, vacated or expired seat resets to 0.
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
}

// What a worker's lobby list says about a throne's game this tick.
export interface ThroneObservation {
  // Connected non-spectators.
  numPlayers: number;
  // The round is in progress.
  running: boolean;
}

// The winner's answer (§5.5): the map, if they chose one, on a special
// throne the modifiers, if they chose any (§5.4), and whether they keep the
// seat.
export interface ThronePick {
  gameMap?: GameMapType;
  modifiers?: ThroneModifier[];
  stay: boolean;
}

export type ThroneAction =
  // Open a lobby for the throne under this game id. previousGameID names the
  // finished game whose players should be told about the successor; null when
  // there is nobody to tell (boot, or a game that vanished). The throne's
  // heir and reservationUntil ride along to the worker.
  | {
      kind: "create";
      throne: Throne;
      gameID: string;
      previousGameID: string | null;
    }
  // The minimum was met: start (or resume) the countdown.
  | { kind: "countdown"; gameID: string; startsAt: number }
  // The count dipped below the minimum: withdraw the countdown.
  | { kind: "hold"; gameID: string }
  // The winner answered: apply their map and keep or clear the heir.
  | {
      kind: "pick";
      gameID: string;
      pick: ThronePick;
      heir: ThroneHolder | null;
      reign: number;
    }
  // The winner's window ran out: the seat opens.
  | { kind: "expire"; gameID: string };

export interface ThroneRegistryOptions {
  // Fixed names, in order (resources/thrones.json). There must be at least
  // `count` of them.
  names: readonly string[];
  // Pool size (L1).
  count: number;
  // How many thrones of each type, in that order (L2). Counts beyond `count`
  // are cut; a shortfall is filled with FFA thrones.
  mix: { ffa: number; team: number; special: number };
  // Humans needed to fire (L9).
  minPlayers: number;
  // Countdown length once met (L10).
  countdownMs: number;
  // The winner's window (L4).
  windowMs: number;
  // How long a game may be missing from every worker's report before its
  // round is taken to be over.
  vanishGraceMs: number;
  mintGameID: () => string;
}

export const DEFAULT_VANISH_GRACE_MS = 10_000;

export class ThroneRegistry {
  private readonly thrones: Throne[] = [];
  private readonly byGameID = new Map<string, Throne>();

  constructor(private readonly opts: ThroneRegistryOptions) {
    if (opts.names.length < opts.count) {
      throw new Error(
        `ThroneRegistry: ${opts.count} thrones but only ${opts.names.length} names`,
      );
    }
    const types = throneTypes(opts.count, opts.mix);
    for (let i = 0; i < opts.count; i++) {
      this.thrones.push({
        throneID: `throne-${String(i + 1).padStart(2, "0")}`,
        name: opts.names[i],
        type: types[i],
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
      });
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
  // which finishes what it runs but opens no new lobby.
  observe(
    now: number,
    reports: ReadonlyMap<string, ThroneObservation>,
    allowCreate = true,
  ): ThroneAction[] {
    const actions: ThroneAction[] = [];
    for (const throne of this.thrones) {
      // The window runs on the master's clock whether or not the lobby exists
      // yet (L4): no answer means the seat opens.
      if (
        throne.phase === "deciding" &&
        now > (throne.reservationUntil ?? now)
      ) {
        this.openSeat(throne);
        throne.phase = "gathering";
        if (throne.gameID !== null) {
          actions.push({ kind: "expire", gameID: throne.gameID });
        }
      }
      if (throne.gameID === null) {
        if (allowCreate) actions.push(this.create(throne, null, now));
        continue;
      }
      const report = reports.get(throne.gameID);
      if (report === undefined) {
        if (now - throne.lastSeenAt > this.opts.vanishGraceMs) {
          this.endRound(throne);
          this.openSeat(throne);
          throne.phase = "gathering";
          if (allowCreate) actions.push(this.create(throne, null, now));
        }
        continue;
      }
      throne.lastSeenAt = now;
      if (report.running) {
        throne.phase = "running";
        throne.startsAt = null;
        throne.remainingMs = null;
        continue;
      }
      // No countdown while the winner is choosing: the round must not start
      // under a map they have not picked yet (§3.2).
      if (throne.phase === "deciding") continue;
      if (report.numPlayers >= this.opts.minPlayers) {
        if (throne.phase !== "countdown") {
          const startsAt = now + (throne.remainingMs ?? this.opts.countdownMs);
          throne.phase = "countdown";
          throne.startsAt = startsAt;
          throne.remainingMs = null;
          actions.push({ kind: "countdown", gameID: throne.gameID, startsAt });
        }
      } else if (throne.phase === "countdown") {
        throne.remainingMs = Math.max(0, (throne.startsAt ?? now) - now);
        throne.startsAt = null;
        throne.phase = "gathering";
        actions.push({ kind: "hold", gameID: throne.gameID });
      }
    }
    return actions;
  }

  // A worker reports a round's result. Ignored for a game that is not a
  // throne's current one (a repeat, or a round the registry already closed as
  // vanished). Opens the successor at once, naming the finished game so its
  // win screen can announce it (§5.8). A human winner gets the seat reserved
  // for the window (L4); anything else opens it (L6, R6).
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
      // A timer win extends the sitting holder's reign; a slayer, or a
      // claimant who held the timer, starts one (§3.1).
      throne.pendingReign =
        outcome === "timer" &&
        previousHolder?.persistentID === winner.persistentID
          ? throne.reign + 1
          : 1;
    } else {
      this.openSeat(throne);
      throne.phase = "gathering";
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
    if (pick.stay) {
      throne.holder = throne.heir;
      throne.reign = throne.pendingReign;
      throne.seat = "seated";
    } else {
      this.openSeat(throne);
    }
    throne.reservationUntil = null;
    throne.pendingReign = 0;
    throne.phase = "gathering";
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

  private endRound(throne: Throne) {
    if (throne.gameID !== null) this.byGameID.delete(throne.gameID);
    throne.gameID = null;
    throne.previousGameID = null;
    throne.startsAt = null;
    throne.remainingMs = null;
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
    throne.lastSeenAt = now;
    this.byGameID.set(gameID, throne);
    return { kind: "create", throne, gameID, previousGameID };
  }
}

// The type of each throne, FFA first, then team, then special (L2). A mix
// that does not add up to `count` is cut or padded with FFA thrones.
export function throneTypes(
  count: number,
  mix: { ffa: number; team: number; special: number },
): ThroneType[] {
  const types: ThroneType[] = [
    ...Array<ThroneType>(Math.max(0, mix.ffa)).fill("ffa"),
    ...Array<ThroneType>(Math.max(0, mix.team)).fill("team"),
    ...Array<ThroneType>(Math.max(0, mix.special)).fill("special"),
  ].slice(0, count);
  while (types.length < count) types.push("ffa");
  return types;
}
