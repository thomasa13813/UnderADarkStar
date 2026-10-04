import { Worker } from "cluster";
import throneNames from "resources/thrones.json";
import winston from "winston";
import { GameMapType } from "../core/game/Game";
import {
  GameConfig,
  MAX_HOSTED_LOBBIES,
  PublicGameType,
  SCHEDULED_PUBLIC_GAME_TYPES,
} from "../core/Schemas";
import {
  InternalGameInfo,
  InternalGameInfoSchema,
  MasterCreateGame,
  MasterLobbiesBroadcast,
  MasterSuccessorCreated,
  MasterUpdateGame,
  WorkerMessageSchema,
  WorkerThronePick,
  WorkerThroneRound,
} from "./IPCBridgeSchema";
import {
  CoordinatorCreateGame,
  CoordinatorHandlers,
  CoordinatorRoster,
  CoordinatorUpdateLobby,
  LobbyCoordinatorClient,
} from "./LobbyCoordinatorClient";
import { logger } from "./Logger";
import { MapPlaylist } from "./MapPlaylist";
import { startPolling } from "./PollingLoop";
import { ServerEnv } from "./ServerEnv";
import {
  DEFAULT_VANISH_GRACE_MS,
  Throne,
  ThroneAction,
  ThroneObservation,
  ThronePick,
  ThroneRegistry,
} from "./ThroneRegistry";

const GAME_MAPS = new Set<string>(Object.values(GameMapType));
function isGameMap(name: string): name is GameMapType {
  return GAME_MAPS.has(name);
}

export interface MasterLobbyServiceOptions {
  playlist: MapPlaylist;
  log: typeof logger;
}

/**
 * Lobbies the master keeps open per scheduled type: the one counting down
 * plus the queue behind it. The whole queue is advertised, so the Detailed
 * View can show what's coming, not just the lobby about to start.
 */
export const QUEUED_LOBBIES_PER_TYPE = 6;

// Under a Dark Star: the throne pool from the environment
// (docs/DarkStar-Lobbies.md §9), or null when the server runs upstream's
// per-type queues instead (PUBLIC_LOBBIES=queue). FFA thrones only until
// special (T4) and team (T5) thrones ship.
export function throneRegistryFromEnv(): ThroneRegistry | null {
  if (ServerEnv.publicLobbyMode() !== "thrones") return null;
  const count = ServerEnv.throneCount();
  return new ThroneRegistry({
    names: throneNames,
    count,
    mix: { ffa: count, team: 0, special: 0 },
    minPlayers: ServerEnv.throneMinPlayers(),
    countdownMs: ServerEnv.throneCountdownMs(),
    windowMs: ServerEnv.throneWindowMs(),
    vanishGraceMs: DEFAULT_VANISH_GRACE_MS,
    mintGameID: () => ServerEnv.generateGameId(),
  });
}

export class MasterLobbyService {
  private readonly workers = new Map<number, Worker>();
  // Worker id => the lobbies it owns.
  private readonly workerLobbies = new Map<number, InternalGameInfo[]>();
  // Worker id => games it last reported running (lobbies included).
  private readonly workerLiveGames = new Map<number, number>();
  private readonly readyWorkers = new Set<number>();
  // gameID => consecutive broadcast cycles a hosted lobby has lost the
  // per-creator dedup or overflowed the cluster-wide cap. Losing once can be
  // a stale worker report (a delisted lobby lingers for one report
  // round-trip); losing twice means the conflict is real, and the loser gets
  // delisted.
  private readonly loserStreaks = new Map<string, number>();
  private started = false;
  // False once the load balancer points at another deployment: this one only
  // finishes the games it has and stops scheduling public lobbies, so nobody
  // can farm empty games on the deployment that's being retired.
  private active: boolean;
  // Clients read a broadcast active:false as "reload, this deployment was
  // retired", and workers stop ranked matchmaking on it. A server still
  // waiting for its first API answer is neither, so until setActive is
  // called the broadcast says active while scheduling stays off.
  private stateKnown: boolean;

  // Two modes (infra docs/lobby-coordinator.md, "The master: two modes"):
  //
  //   coordinated: the site's lobby coordinator holds one roster for every
  //     master on this build. It decides which lobby counts down and which
  //     server creates the next one; this master obeys createGame /
  //     updateLobby and feeds workers the coordinator's roster.
  //   local: today's single-server behaviour — schedule over own workers,
  //     advertise own lobbies only.
  //
  // Mode is a function of one thing: has a roster arrived in the last
  // COORDINATOR_STALE_MS. Not "is the socket open" — a socket can be open and
  // dead. Without a coordinator attached (LOBBY_COORDINATOR unset, local
  // dev) the master is local forever and this code path is today's, byte for
  // byte on the wire.
  private coordinator: LobbyCoordinatorClient | null = null;
  private coordinated = false;
  private roster: CoordinatorRoster | null = null;
  // Delists the coordinator asked for, forwarded on the next broadcast. A
  // set rather than the roster's own field so a roster that arrives twice
  // between broadcasts does not lose the first one's delists.
  private readonly pendingDelist = new Set<string>();

  // Under a Dark Star: the persistent public lobbies this master runs
  // (docs/DarkStar-Lobbies.md). With a registry the master schedules thrones
  // and nothing else; null keeps the per-type queues. Defaults from the
  // environment; tests pass their own.
  private readonly thrones: ThroneRegistry | null;
  // The config each current throne lobby was created with, so a picked map
  // can be given the cap the playlist would have rolled for it.
  private readonly throneConfigs = new Map<string, GameConfig>();

  constructor(
    private playlist: MapPlaylist,
    private log: winston.Logger,
    awaitApiState = false,
    thrones: ThroneRegistry | null | undefined = undefined,
  ) {
    this.active = !awaitApiState;
    this.stateKnown = !awaitApiState;
    this.thrones = thrones === undefined ? throneRegistryFromEnv() : thrones;
  }

  throneRegistry(): ThroneRegistry | null {
    return this.thrones;
  }

  registerWorker(workerId: number, worker: Worker) {
    this.workers.set(workerId, worker);

    worker.on("message", (raw: unknown) => {
      const result = WorkerMessageSchema.safeParse(raw);
      if (!result.success) {
        this.log.error("Invalid IPC message from worker:", raw);
        return;
      }

      const msg = result.data;
      switch (msg.type) {
        case "workerReady":
          this.handleWorkerReady(msg.workerId);
          break;
        case "lobbyList":
          this.workerLobbies.set(workerId, this.validLobbies(msg.lobbies));
          this.workerLiveGames.set(workerId, msg.liveGames ?? 0);
          // The client coalesces: at most one report a second, plus a
          // heartbeat. Every change is offered so a numClients-only change
          // still reaches the site roster within a second.
          this.coordinator?.report(this.ownLobbies(), this.liveGames());
          break;
        case "throneRound":
          this.handleThroneRound(msg).catch((error) => {
            this.log.error("throne round handling failed:", error);
          });
          break;
        case "thronePick":
          this.handleThronePick(msg).catch((error) => {
            this.log.error("throne pick handling failed:", error);
          });
          break;
      }
    });
  }

  // Lobby entries are validated individually so one malformed entry only
  // drops itself. Rejecting the whole report would freeze this worker's
  // lobbies in the master's view for as long as the bad entry exists —
  // stale broadcasts to every client, countdown resets, and duplicate
  // scheduling.
  private validLobbies(lobbies: unknown[]): InternalGameInfo[] {
    const valid: InternalGameInfo[] = [];
    for (const lobby of lobbies) {
      const result = InternalGameInfoSchema.safeParse(lobby);
      if (result.success) {
        valid.push(result.data);
      } else {
        this.log.error("Dropping invalid lobby in worker report:", lobby);
      }
    }
    return valid;
  }

  removeWorker(workerId: number) {
    this.workers.delete(workerId);
    this.workerLobbies.delete(workerId);
    this.workerLiveGames.delete(workerId);
    this.readyWorkers.delete(workerId);
  }

  // Games running on this server, summed over the workers' last reports.
  // Reported to the API at check-in (ClusterCheckin.ts).
  liveGames(): number {
    let total = 0;
    for (const n of this.workerLiveGames.values()) total += n;
    return total;
  }

  isHealthy(): boolean {
    // We consider the lobby service healthy if at least half of the workers are ready.
    // This allows for some leeway if a worker crashes.
    const minWorkers = Math.max(ServerEnv.numWorkers() / 2, 1);
    return this.started && this.readyWorkers.size >= minWorkers;
  }

  /**
   * Join the site's shared roster. The client owns the socket; this service
   * owns what a roster or a command means. Attach before workers are ready
   * so a coordinated master never schedules locally at boot: scheduling only
   * starts once all workers are ready, by which time the socket has normally
   * delivered a roster.
   */
  attachCoordinator(client: LobbyCoordinatorClient) {
    this.coordinator = client;
  }

  coordinatorHandlers(): CoordinatorHandlers {
    return {
      onRoster: (roster) => this.handleRoster(roster),
      onCreateGame: (msg) => {
        this.handleCoordinatorCreate(msg).catch((error) => {
          this.log.error("coordinator createGame failed:", error);
        });
      },
      onUpdateLobby: (msg) => this.handleCoordinatorUpdate(msg),
    };
  }

  private handleRoster(roster: CoordinatorRoster) {
    this.roster = roster;
    for (const gameID of roster.delistGameIDs) this.pendingDelist.add(gameID);
  }

  // "You create the next lobby of this type." The coordinator only asks
  // masters the registry reports open; the active check is belt and braces.
  // Before all workers are ready the create is refused too: the
  // coordinator's pending slot expires in 10s and goes to another server.
  // recentMaps (what the site just played) is not yet fed to the playlist —
  // its no-consecutive-repeat rule stays per server for now.
  private async handleCoordinatorCreate(msg: CoordinatorCreateGame) {
    if (!this.active || !this.started) {
      this.log.info(
        `refusing coordinator createGame (${msg.publicGameType}): ${
          this.active ? "workers not ready" : "deployment inactive"
        }`,
      );
      return;
    }
    this.sendMessageToWorker({
      type: "createGame",
      gameID: ServerEnv.generateGameId(),
      gameConfig: await this.playlist.gameConfig(msg.publicGameType),
      publicGameType: msg.publicGameType,
    } satisfies MasterCreateGame);
  }

  // The countdown for one of this master's lobbies. The coordinator sends it
  // to the owner; a foreign id would hash to one of our workers anyway, so
  // check ownership rather than forward a countdown for a game we don't run.
  private handleCoordinatorUpdate(msg: CoordinatorUpdateLobby) {
    if (!this.ownLobbies().some((l) => l.gameID === msg.gameID)) {
      this.log.warn(`ignoring coordinator updateLobby for foreign lobby`, {
        gameID: msg.gameID,
      });
      return;
    }
    this.sendMessageToWorker({
      type: "updateLobby",
      gameID: msg.gameID,
      startsAt: msg.startsAt,
    });
  }

  private ownLobbies(): InternalGameInfo[] {
    return Array.from(this.workerLobbies.values()).flat();
  }

  // Re-evaluates the mode and logs a flip. Called from both loops so the
  // decision is made at most twice a second and the log says which way.
  private isCoordinated(): boolean {
    const next = this.coordinator?.isCoordinated() ?? false;
    if (next !== this.coordinated) {
      this.coordinated = next;
      this.log.info(
        next
          ? "lobby coordinator roster received, switching to coordinated mode"
          : "no lobby coordinator roster for 5s, switching to single-server mode",
      );
    }
    return next;
  }

  setActive(active: boolean) {
    this.stateKnown = true;
    if (active === this.active) return;
    this.active = active;
    this.log.info(
      active
        ? "deployment is active, scheduling public lobbies"
        : "deployment is no longer active, stopping public lobby scheduling",
    );
  }

  private handleWorkerReady(workerId: number) {
    this.readyWorkers.add(workerId);
    this.log.info(
      `Worker ${workerId} is ready. (${this.readyWorkers.size}/${ServerEnv.numWorkers()} ready)`,
    );
    if (this.readyWorkers.size === ServerEnv.numWorkers() && !this.started) {
      this.started = true;
      this.log.info("All workers ready, starting game scheduling");
      startPolling(async () => this.broadcastLobbies(), 500);
      startPolling(async () => await this.maybeScheduleLobby(), 1000);
    }
  }

  private getAllLobbies(): {
    games: Record<PublicGameType, InternalGameInfo[]>;
    losers: string[];
  } {
    const lobbies = this.ownLobbies();

    const result: Record<PublicGameType, InternalGameInfo[]> = {
      ffa: [],
      team: [],
      special: [],
      hosted: [],
      throne: [],
    };

    for (const lobby of lobbies) {
      result[lobby.publicGameType].push(lobby);
    }

    // Thrones: only the games the registry currently runs. A worker keeps
    // reporting a finished round while its players sit on the win screen,
    // and that round's successor is already listed in its place.
    if (this.thrones !== null) {
      const current = this.thrones.currentGameIDs();
      result.throne = result.throne.filter((l) => current.has(l.gameID));
    }
    // Soonest to start first (L13): counting down by startsAt, then open
    // lobbies by how many are waiting, then by name so the order is stable;
    // running rounds last.
    result.throne.sort((a, b) => {
      const aRunning = a.throne?.running === true ? 1 : 0;
      const bRunning = b.throne?.running === true ? 1 : 0;
      if (aRunning !== bRunning) return aRunning - bRunning;
      if (a.startsAt !== undefined || b.startsAt !== undefined) {
        if (a.startsAt === undefined) return 1;
        if (b.startsAt === undefined) return -1;
        if (a.startsAt !== b.startsAt) return a.startsAt - b.startsAt;
      }
      const aPlayers = a.numPlayers ?? a.numClients;
      const bPlayers = b.numPlayers ?? b.numClients;
      if (aPlayers !== bPlayers) return bPlayers - aPlayers;
      return (a.throne?.name ?? "").localeCompare(b.throne?.name ?? "");
    });

    for (const type of Object.keys(result) as PublicGameType[]) {
      if (type === "throne") continue;
      result[type].sort((a, b) => {
        if (a.startsAt === undefined && b.startsAt === undefined) {
          // Queue order: oldest first, so a lobby moves up a place each time
          // the one in front of it starts, and a newly created lobby joins the
          // back instead of landing in the middle. Game id only breaks ties
          // for lobbies from a build that didn't report createdAt.
          if (a.createdAt !== b.createdAt) {
            return (a.createdAt ?? 0) - (b.createdAt ?? 0);
          }
          return a.gameID > b.gameID ? 1 : -1;
        }
        // If a lobby has startsAt set, we assume it's the active one.
        if (a.startsAt === undefined) return 1;
        if (b.startsAt === undefined) return -1;
        return a.startsAt - b.startsAt;
      });
    }

    // One listed lobby per creator, cluster-wide. Workers enforce this at
    // listing time, but two workers can list concurrently between broadcasts;
    // dropping duplicates here (deterministically, after the sort above)
    // keeps the extra lobby from ever being advertised. Losers are reported
    // so broadcastLobbies can tell the owning worker to clear the loser's
    // listed flag — otherwise it would stay flagged Public on its worker
    // while never appearing in any browser.
    const seenCreators = new Set<string>();
    const losers: string[] = [];
    result.hosted = result.hosted.filter((lobby) => {
      if (lobby.creatorID === undefined) return true;
      if (seenCreators.has(lobby.creatorID)) {
        losers.push(lobby.gameID);
        return false;
      }
      seenCreators.add(lobby.creatorID);
      return true;
    });

    // Featured lobbies keep their place when the list overflows. They are
    // announced events with a published start time, and delisting is permanent
    // — the worker clears listedAt, so an event lobby that loses the cap never
    // comes back and its audience arrives to nothing. Only an admin bot can set
    // featured, and the per-creator dedup above already caps each host at one
    // listing, so this cannot be used to crowd the list. Stable within each
    // group: the sort above still decides order among featured and among the
    // rest.
    result.hosted = [
      ...result.hosted.filter((l) => l.featured),
      ...result.hosted.filter((l) => !l.featured),
    ];

    // Cluster-wide cap to prevent listing spam. Workers reject listings past
    // the cap too, but their view lags by a broadcast round-trip; overflow
    // (deterministically the sort losers) is delisted like dedup losers.
    if (result.hosted.length > MAX_HOSTED_LOBBIES) {
      for (const lobby of result.hosted.slice(MAX_HOSTED_LOBBIES)) {
        losers.push(lobby.gameID);
      }
      result.hosted = result.hosted.slice(0, MAX_HOSTED_LOBBIES);
    }

    return { games: result, losers };
  }

  // Losers (creator dedup or cap overflow) are only delisted after losing
  // two consecutive broadcast cycles: a single loss can be a stale worker
  // report (a just-delisted lobby lingers for one report round-trip), and
  // delisting on it would clear a legitimately listed lobby.
  private delistGameIDs(losers: string[]): string[] {
    const loserSet = new Set(losers);
    for (const gameID of this.loserStreaks.keys()) {
      if (!loserSet.has(gameID)) this.loserStreaks.delete(gameID);
    }
    const delist: string[] = [];
    for (const gameID of losers) {
      const streak = (this.loserStreaks.get(gameID) ?? 0) + 1;
      this.loserStreaks.set(gameID, streak);
      if (streak >= 2) delist.push(gameID);
    }
    if (delist.length > 0) {
      this.log.info(
        `delisting hosted lobbies (duplicate creator or over cap): ${delist.join(", ")}`,
      );
    }
    return delist;
  }

  private broadcastLobbies() {
    let games: Record<PublicGameType, InternalGameInfo[]>;
    let delist: string[];
    if (this.isCoordinated() && this.roster !== null) {
      // The site's merged roster for this build, stamped with our own
      // active flag. Dedup, cap and the two-strike delist rule ran on the
      // coordinator; it only names lobbies this master owns.
      games = this.roster.games;
      delist = [...this.pendingDelist];
      this.pendingDelist.clear();
      if (delist.length > 0) {
        this.log.info(
          `delisting hosted lobbies at coordinator's request: ${delist.join(", ")}`,
        );
      }
    } else {
      const own = this.getAllLobbies();
      games = own.games;
      delist = this.delistGameIDs(own.losers);
    }
    const msg = {
      type: "lobbiesBroadcast",
      publicGames: {
        serverTime: Date.now(),
        games,
      },
      delistGameIDs: delist.length > 0 ? delist : undefined,
      active: this.active || !this.stateKnown,
    } satisfies MasterLobbiesBroadcast;
    for (const [workerId, worker] of this.workers.entries()) {
      worker.send(msg, (e) => {
        if (e) {
          this.log.error(
            `Failed to send lobbies broadcast to worker ${workerId}, killing worker:`,
            e,
          );
          worker.kill();
        }
      });
    }
  }

  private async maybeScheduleLobby() {
    // Coordinated: the site's queue depth and countdowns are the
    // coordinator's; adding our own here would double-schedule.
    if (this.isCoordinated()) return;

    // Under a Dark Star: thrones replace the per-type queues.
    if (this.thrones !== null) {
      await this.scheduleThrones();
      return;
    }

    const lobbiesByType = this.getAllLobbies().games;

    // Scheduled types only: hosted lobbies are started by their host, never
    // given a countdown or replaced by the master.
    for (const type of SCHEDULED_PUBLIC_GAME_TYPES) {
      const lobbies = lobbiesByType[type];

      // Always ensure the next lobby has a timer, even if the queue is
      // already full. This prevents a race where two lobbies are created before
      // either receives a startsAt (IPC round-trip delay), leaving both stuck
      // without a countdown.
      const nextLobby = lobbies[0];
      if (nextLobby && nextLobby.startsAt === undefined) {
        this.sendMessageToWorker({
          type: "updateLobby",
          gameID: nextLobby.gameID,
          startsAt: Date.now() + ServerEnv.gameCreationRate(),
        });
      }

      // An inactive deployment still starts what it already queued (the
      // countdown above), it just stops adding to the queue.
      if (!this.active || lobbies.length >= QUEUED_LOBBIES_PER_TYPE) {
        continue;
      }

      this.sendMessageToWorker({
        type: "createGame",
        gameID: ServerEnv.generateGameId(),
        gameConfig: await this.playlist.gameConfig(type),
        publicGameType: type,
      } satisfies MasterCreateGame);
    }
  }

  // --- Under a Dark Star: thrones (docs/DarkStar-Lobbies.md §5) ---

  // One pass over the pool: open lobbies for thrones without one, start or
  // withdraw countdowns on the players reported, and recycle games that
  // vanished. An inactive deployment finishes its rounds but opens nothing.
  private async scheduleThrones() {
    if (this.thrones === null) return;
    const actions = this.thrones.observe(
      Date.now(),
      this.throneReports(),
      this.active,
    );
    await this.runThroneActions(actions);
  }

  // What the workers last reported about each throne game.
  private throneReports(): Map<string, ThroneObservation> {
    const reports = new Map<string, ThroneObservation>();
    for (const lobby of this.ownLobbies()) {
      if (lobby.publicGameType !== "throne") continue;
      reports.set(lobby.gameID, {
        numPlayers: lobby.numPlayers ?? lobby.numClients,
        running: lobby.throne?.running === true,
      });
    }
    return reports;
  }

  // A round ended on a worker: open the successor at once, so the lobby is
  // gathering while the win screen is still up (§5.8).
  private async handleThroneRound(msg: WorkerThroneRound) {
    if (this.thrones === null) return;
    this.log.info("throne round ended", {
      throneID: msg.throneID,
      gameID: msg.gameID,
      outcome: msg.outcome,
      winner: msg.winner?.name,
    });
    const actions = this.thrones.roundEnded(
      msg.gameID,
      msg.outcome,
      msg.winner,
      Date.now(),
      this.active,
    );
    await this.runThroneActions(actions);
  }

  // The winner's answer (§5.5). The registry checks the heir and the window;
  // the map is checked here against the full list (L7). A map that is not a
  // map is a protocol error (the picker cannot produce it): the random one
  // stands and the stay/leave answer is kept.
  private async handleThronePick(msg: WorkerThronePick) {
    if (this.thrones === null) return;
    let gameMap: GameMapType | undefined;
    if (msg.gameMap !== undefined) {
      if (isGameMap(msg.gameMap)) {
        gameMap = msg.gameMap;
      } else {
        this.log.warn("throne pick named an unknown map, keeping random", {
          throneID: msg.throneID,
          gameMap: msg.gameMap,
        });
      }
    }
    const actions = this.thrones.pickReceived(
      msg.throneID,
      msg.gameID,
      msg.persistentID,
      { gameMap, stay: msg.stay },
      Date.now(),
    );
    if (actions.length === 0) {
      this.log.info("throne pick ignored", {
        throneID: msg.throneID,
        gameID: msg.gameID,
      });
    }
    await this.runThroneActions(actions);
  }

  private async runThroneActions(actions: ThroneAction[]) {
    for (const action of actions) {
      switch (action.kind) {
        case "create": {
          const { throne, gameID, previousGameID } = action;
          this.log.info("opening throne lobby", {
            throneID: throne.throneID,
            name: throne.name,
            gameID,
            previousGameID,
            heir: throne.heir?.name,
          });
          const gameConfig = await this.throneGameConfig(throne);
          this.throneConfigs.set(gameID, gameConfig);
          this.pruneThroneConfigs();
          this.sendMessageToWorker({
            type: "createGame",
            gameID,
            gameConfig,
            publicGameType: "throne",
            throne: {
              throneID: throne.throneID,
              name: throne.name,
              type: throne.type,
              reign: throne.reign,
              minPlayers: this.thrones!.minPlayers(),
              heir: throne.heir ?? undefined,
              reservationUntil: throne.reservationUntil ?? undefined,
            },
          } satisfies MasterCreateGame);
          if (previousGameID !== null) {
            this.sendMessageToWorker({
              type: "successorCreated",
              gameID: previousGameID,
              successorID: gameID,
              reservationUntil: throne.reservationUntil ?? undefined,
            } satisfies MasterSuccessorCreated);
          }
          break;
        }
        case "countdown":
          this.sendMessageToWorker({
            type: "updateLobby",
            gameID: action.gameID,
            startsAt: action.startsAt,
          });
          break;
        case "hold":
          this.log.info("holding throne lobby, too few players", {
            gameID: action.gameID,
          });
          this.sendMessageToWorker({
            type: "updateLobby",
            gameID: action.gameID,
            startsAt: null,
          });
          break;
        case "pick": {
          const gameConfig = await this.pickedConfig(
            action.gameID,
            action.pick,
          );
          this.log.info("throne pick applied", {
            gameID: action.gameID,
            gameMap: action.pick.gameMap,
            stay: action.pick.stay,
            reign: action.reign,
          });
          this.sendMessageToWorker({
            type: "updateLobby",
            gameID: action.gameID,
            gameConfig,
            throne: { heir: action.heir, reign: action.reign },
          } satisfies MasterUpdateGame);
          break;
        }
        case "expire":
          this.log.info("winner's window expired, throne open", {
            gameID: action.gameID,
          });
          this.sendMessageToWorker({
            type: "updateLobby",
            gameID: action.gameID,
            throne: { heir: null, reign: 0 },
          } satisfies MasterUpdateGame);
          break;
      }
    }
  }

  // The config patch for a pick: the map and the cap the playlist would give
  // it; nothing when no map was chosen (the random one stands).
  private async pickedConfig(
    gameID: string,
    pick: ThronePick,
  ): Promise<Partial<GameConfig> | undefined> {
    if (pick.gameMap === undefined) return undefined;
    const base = this.throneConfigs.get(gameID);
    const patch: Partial<GameConfig> = { gameMap: pick.gameMap };
    if (base !== undefined) {
      patch.maxPlayers = await this.playlist.maxPlayersForMap(
        pick.gameMap,
        base,
      );
      this.throneConfigs.set(gameID, { ...base, ...patch });
    }
    return patch;
  }

  private pruneThroneConfigs() {
    const current = this.thrones?.currentGameIDs();
    if (current === undefined) return;
    for (const gameID of this.throneConfigs.keys()) {
      if (!current.has(gameID)) this.throneConfigs.delete(gameID);
    }
  }

  // A throne round's config: the playlist's usual roll for the throne's type
  // (map rotation, player cap, the throne enabled), never trusted-only (a
  // throne is open to everyone, L3). T2 merges the winner's pick on top.
  private async throneGameConfig(throne: Throne): Promise<GameConfig> {
    const config = await this.playlist.gameConfig(throne.type);
    delete config.trusted;
    config.hegemon = { ...config.hegemon, enabled: true };
    return config;
  }

  private sendMessageToWorker(
    msg: MasterCreateGame | MasterUpdateGame | MasterSuccessorCreated,
  ): void {
    const workerId = ServerEnv.workerIndex(msg.gameID);
    const worker = this.workers.get(workerId);
    if (!worker) {
      this.log.error(`Worker ${workerId} not found`);
      return;
    }
    worker.send(msg, (e) => {
      if (e) {
        this.log.error(
          `Failed to send message to worker ${workerId}, killing worker:`,
          e,
        );
        worker.kill();
      }
    });
  }
}
