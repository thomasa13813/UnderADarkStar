import { z } from "zod";
import {
  GameConfigSchema,
  PublicGameInfoSchema,
  PublicGameTypeSchema,
  ThroneTypeSchema,
} from "../core/Schemas";

export type InternalGameInfo = z.infer<typeof InternalGameInfoSchema>;
export type InternalPublicGames = z.infer<typeof InternalPublicGamesSchema>;
export type WorkerLobbyList = z.infer<typeof WorkerLobbyListSchema>;
export type WorkerReady = z.infer<typeof WorkerReadySchema>;
export type MasterLobbiesBroadcast = z.infer<
  typeof MasterLobbiesBroadcastSchema
>;

export type MasterUpdateGame = z.infer<typeof MasterUpdateGameSchema>;
export type MasterCreateGame = z.infer<typeof MasterCreateGameSchema>;
export type MasterSuccessorCreated = z.infer<
  typeof MasterSuccessorCreatedSchema
>;
export type ThroneAssignment = z.infer<typeof ThroneAssignmentSchema>;
export type WorkerThroneRound = z.infer<typeof WorkerThroneRoundSchema>;
export type ThroneRoundReport = Omit<WorkerThroneRound, "type">;
export type WorkerThronePick = z.infer<typeof WorkerThronePickSchema>;
export type ThronePickReport = Omit<WorkerThronePick, "type">;
export type MasterThroneUpdate = NonNullable<MasterUpdateGame["throne"]>;
export type ThroneRoundOutcome = WorkerThroneRound["outcome"];
export type WorkerMessage = z.infer<typeof WorkerMessageSchema>;
export type MasterMessage = z.infer<typeof MasterMessageSchema>;

// Master/worker-internal lobby info: PublicGameInfo plus the hashed creator
// ID (hosted lobbies only) used for the one-listed-lobby-per-creator check,
// and the lobby's creation time (used for queue order).
// Never sent to browsers — WorkerLobbyService.sanitizeGames converts to plain
// PublicGameInfo before anything reaches a client.
export const InternalGameInfoSchema = PublicGameInfoSchema.extend({
  creatorID: z.string().optional(),
  // When the worker created the lobby. The master orders the queue behind the
  // counting-down lobby by this, so lobbies advance one place as the front one
  // starts instead of shuffling when a new one spawns.
  createdAt: z.number().optional(),
  // Connected non-spectators. A throne fires on humans who will play (L9), so
  // the master counts these rather than numClients. Absent means numClients.
  numPlayers: z.number().int().min(0).optional(),
});

export const InternalPublicGamesSchema = z.object({
  serverTime: z.number(),
  games: z.partialRecord(PublicGameTypeSchema, z.array(InternalGameInfoSchema)),
});

// --- Worker Messages ---

// Worker tells the master about its lobbies. Entries are deliberately not
// validated here: the master checks each against InternalGameInfoSchema and
// drops bad ones (MasterLobbyService.validLobbies), so a single malformed
// lobby can't invalidate the whole report and freeze the master's view of
// this worker's lobbies.
const WorkerLobbyListSchema = z.object({
  type: z.literal("lobbyList"),
  lobbies: z.array(z.unknown()),
  // Games this worker is running, lobbies included. The master sums them
  // for the cluster check-in (ClusterCheckin.ts), so an operator can tell
  // when a draining server is empty. Optional for a worker build that
  // predates it; absent counts as zero.
  liveGames: z.number().int().min(0).optional(),
});

const WorkerReadySchema = z.object({
  type: z.literal("workerReady"),
  workerId: z.number(),
});

// Under a Dark Star: a throne's round ended (docs/DarkStar-Lobbies.md §5.8).
// Sent from GameServer.archiveGame, where the winner vote has resolved. The
// outcome follows the vote: a player who was the Hegemon held the timer, any
// other player overthrew them, a nation means the AI won (the AI Hegemon
// outlasted the round, or a nation landed the killing blow), and void is a
// round with no winner at all. The master opens the successor lobby on it.
const WorkerThroneRoundSchema = z.object({
  type: z.literal("throneRound"),
  throneID: z.string(),
  gameID: z.string(),
  outcome: z.enum(["overthrown", "timer", "ai", "void"]),
  winner: z
    .object({
      persistentID: z.string(),
      name: z.string(),
    })
    .optional(),
});

// Under a Dark Star: the winner's answer from the finished game's socket
// (§5.5), relayed verbatim for the master to validate against the registry
// (the heir, the window) and the map list.
const WorkerThronePickSchema = z.object({
  type: z.literal("thronePick"),
  throneID: z.string(),
  // The finished game the pick came from.
  gameID: z.string(),
  persistentID: z.string(),
  gameMap: z.string().optional(),
  modifiers: z.array(z.string()).optional(),
  stay: z.boolean(),
});

export const WorkerMessageSchema = z.discriminatedUnion("type", [
  WorkerLobbyListSchema,
  WorkerReadySchema,
  WorkerThroneRoundSchema,
  WorkerThronePickSchema,
]);

// --- Master Messages ---

const ThroneHolderSchema = z.object({
  persistentID: z.string(),
  name: z.string(),
});

const MasterUpdateGameSchema = z.object({
  type: z.literal("updateLobby"),
  gameID: z.string(),
  // null holds a throne lobby: its countdown is withdrawn until the minimum
  // number of players is back (docs/DarkStar-Lobbies.md §5.7). Absent leaves
  // the countdown alone (a throne update that carries only the pick).
  startsAt: z.number().nullable().optional(),
  // Under a Dark Star: the winner's pick, merged on the lobby's config (§5.5).
  gameConfig: GameConfigSchema.partial().optional(),
  // Under a Dark Star: the seat after the winner answered or the window ran
  // out. heir null opens the seat (the worker unseats a seated heir); a heir
  // keeps or takes it as they join (GameServer.seatHeir).
  throne: z
    .object({
      heir: ThroneHolderSchema.nullable(),
      reign: z.number().int().min(0),
    })
    .optional(),
});

// Under a Dark Star: the throne a public lobby runs for. The worker keeps it
// on the GameServer (lobby info, the lobby-browser entry, the round report)
// and holds the start while fewer than minPlayers humans are connected.
const ThroneAssignmentSchema = z.object({
  throneID: z.string(),
  name: z.string(),
  type: ThroneTypeSchema,
  reign: z.number().int().min(0),
  minPlayers: z.number().int().min(1),
  // The previous round's winner, owed the seat (§3.1): seated as they join,
  // and while they are the heir nobody else may claim.
  heir: ThroneHolderSchema.optional(),
  // While the heir is still choosing: when their window closes (L4).
  reservationUntil: z.number().optional(),
});

// Under a Dark Star: the master opened the next round's lobby for a finished
// throne game. The worker hands the id to the finished game, which broadcasts
// new_lobby so everyone still on the win screen can hop over (§5.8).
const MasterSuccessorCreatedSchema = z.object({
  type: z.literal("successorCreated"),
  // The finished game (routes the message to its worker).
  gameID: z.string(),
  successorID: z.string(),
  // While the winner's window is open (L4): forwarded in new_lobby so the
  // winner's client can show the window.
  reservationUntil: z.number().optional(),
});

// Broadcasts all public game info to all workers.
// Workers need information on all public lobbies so
// it can send it to the client.
const MasterLobbiesBroadcastSchema = z.object({
  type: z.literal("lobbiesBroadcast"),
  publicGames: InternalPublicGamesSchema,
  // Hosted lobbies the master wants delisted: a creator got two lobbies
  // listed concurrently on different workers, and only the dedup winner may
  // stay advertised. The owning worker clears the loser's listed flag so
  // worker state, host UI, and the broadcast agree.
  delistGameIDs: z.array(z.string()).optional(),
  // Whether this deployment is the one the load balancer routes to. Workers
  // stamp it onto the public-lobby feed so pinned homepage tabs on a draining
  // deployment learn to reload (see PublicLobbyFullSchema.active). Optional
  // only for old fixtures; the master always sends it, absent means active.
  active: z.boolean().optional(),
});

// Master sends a message to worker to schedule a new public game/lobby.
const MasterCreateGameSchema = z.object({
  type: z.literal("createGame"),
  gameID: z.string(),
  gameConfig: GameConfigSchema,
  publicGameType: PublicGameTypeSchema,
  throne: ThroneAssignmentSchema.optional(),
});

export const MasterMessageSchema = z.discriminatedUnion("type", [
  MasterLobbiesBroadcastSchema,
  MasterCreateGameSchema,
  MasterUpdateGameSchema,
  MasterSuccessorCreatedSchema,
]);
