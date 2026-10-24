import { Config } from "../configuration/Config";
import { AbstractGraph } from "../pathfinding/algorithms/AbstractGraph";
import { PathFinder } from "../pathfinding/types";
import { AllPlayersStats, ClientID } from "../Schemas";
import { formatPlayerDisplayName } from "../Util";
import { DarkStarGeometry } from "./DarkStar";
import { GameMap, TileRef } from "./GameMap";
import {
  GameUpdate,
  GameUpdateType,
  PlayerUpdate,
  UnitUpdate,
} from "./GameUpdates";
import { Harbour } from "./Harbours";
import { MotionPlanRecord } from "./MotionPlans";
import { RailNetwork } from "./RailNetwork";
import { Stats } from "./Stats";
import { ReadonlyTileSet } from "./TileSet";
import { UnitPredicate } from "./UnitGrid";

function isEnumValue<T extends Record<string, string | number>>(
  enumObj: T,
  value: unknown,
): value is T[keyof T] {
  return Object.values(enumObj).includes(value as T[keyof T]);
}

export type PlayerID = string;
export type Tick = number;
export type Gold = bigint;

export type WarshipState = {
  state: "patrolling" | "retreating" | "docked";
  patrolTile?: TileRef;
  retreatPort?: TileRef;
  isInCombat?: boolean;
  lastCombatTick: number;
  // Veterancy level (0–max) plus a shared integer progress meter fed by
  // transport kills and trade captures (see UnitImpl.addVeterancyProgress).
  veterancy: number;
  veterancyProgress: number;
};

export type TransportShipState = {
  isRetreating: boolean;
  troops: number;
};

export type NukeState = {
  trajectory: TrajectoryTile[];
  trajectoryIndex: number;
  targetedBySam: boolean;
  waitTicks: number;
};

export type SamLauncherState = {
  upgradeStartTick?: number;
  startRange: number;
  targetLevel: number;
  duration: number;
};

export const AllPlayers = "AllPlayers" as const;

// export type GameUpdates = Record<GameUpdateType, GameUpdate[]>;
// Create a type that maps GameUpdateType to its corresponding update type
type UpdateTypeMap<T extends GameUpdateType> = Extract<GameUpdate, { type: T }>;

// Then use it to create the record type
export type GameUpdates = {
  [K in GameUpdateType]: UpdateTypeMap<K>[];
};

export interface MapPos {
  x: number;
  y: number;
}

export enum Difficulty {
  Easy = "Easy",
  Medium = "Medium",
  Hard = "Hard",
  Impossible = "Impossible",
}
export const isDifficulty = (value: unknown): value is Difficulty =>
  isEnumValue(Difficulty, value);

export type Team = string;

export interface SpawnArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type TeamGameSpawnAreas = Record<string, SpawnArea[]>;

export const Duos = "Duos" as const;
export const Trios = "Trios" as const;
export const Quads = "Quads" as const;
export const HumansVsNations = "Humans Vs Nations" as const;

export const ColoredTeams: Record<string, Team> = {
  Red: "Red",
  Blue: "Blue",
  Teal: "Teal",
  Purple: "Purple",
  Yellow: "Yellow",
  Orange: "Orange",
  Green: "Green",
  Bot: "Bot",
  Humans: "Humans",
  Nations: "Nations",
  // Under a Dark Star: in a team game the Hegemon is a team of one, outside
  // the playerTeams count (docs/DarkStar-Lobbies.md §5.9). Never assigned to
  // anyone else; null in FFA, as every team is.
  Hegemon: "Hegemon",
} as const;

// GameMapType and the maps list are generated from
// map-generator/assets/maps/<map>/info.json by the map-generator
// (`npm run gen-maps`).
export {
  GameMapType,
  mapCategoryOrder,
  maps,
  type CustomTribe,
  type GameMapName,
  type MapCategory,
  type MapInfo,
  type SpecialModifierKey,
} from "./Maps.gen";

export enum GameType {
  Singleplayer = "Singleplayer",
  Public = "Public",
  Private = "Private",
}
export const isGameType = (value: unknown): value is GameType =>
  isEnumValue(GameType, value);

export enum GameMode {
  FFA = "Free For All",
  Team = "Team",
}

export enum RankedType {
  OneVOne = "1v1",
  TwoVTwo = "2v2",
}

export const isGameMode = (value: unknown): value is GameMode =>
  isEnumValue(GameMode, value);

export enum GameMapSize {
  Compact = "Compact",
  Normal = "Normal",
}

export interface PublicGameModifiers {
  isCompact?: boolean;
  isRandomSpawn?: boolean;
  isCrowded?: boolean;
  isHardNations?: boolean;
  startingGold?: number;
  goldMultiplier?: number;
  isAlliancesDisabled?: boolean;
  isPortsDisabled?: boolean;
  isNukesDisabled?: boolean;
  isSAMsDisabled?: boolean;
  isPeaceTime?: boolean;
  isWaterNukes?: boolean;
  isDoomsdayClock?: boolean;
}

// Largest bulk-purchase amount an intent may carry (mirrored by the intent
// schemas' max). Also the length of BuildableUnit.upgradeCosts.
export const MAX_UPGRADE_AMOUNT = 50;

export interface UnitInfo {
  // extraUnits shifts the cost curve as if the player already had that many
  // additional units/levels — used to price the later steps of a bulk upgrade.
  // `payer` (default: the player) is who is charged: a gift (H18, the Hegemon
  // paying for a challenger's structure) is priced as the host's first of its
  // kind, whatever the host already has and however many steps are bought.
  cost: (
    game: Game,
    player: Player,
    extraUnits?: number,
    payer?: Player,
  ) => Gold;
  maxHealth?: number;
  damage?: number;
  constructionDuration?: number;
  upgradable?: boolean;
  // Highest level an upgrade may reach (unlimited when absent).
  maxLevel?: number;
}

function unitTypeGroup<T extends readonly UnitType[]>(types: T) {
  return {
    types,
    has(type: UnitType): type is T[number] {
      return (types as readonly UnitType[]).includes(type);
    },
  };
}

export enum UnitType {
  TransportShip = "Transport",
  Warship = "Warship",
  Shell = "Shell",
  SAMMissile = "SAMMissile",
  Port = "Port",
  AtomBomb = "Atom Bomb",
  HydrogenBomb = "Hydrogen Bomb",
  TradeShip = "Trade Ship",
  MissileSilo = "Missile Silo",
  DefensePost = "Defense Post",
  SAMLauncher = "SAM Launcher",
  City = "City",
  MIRV = "MIRV",
  MIRVWarhead = "MIRV Warhead",
  Train = "Train",
  Factory = "Factory",
  // DarkStar: the flying strike / stargate shot (§6.8). Appended: the enum
  // order is a zbin wire contract.
  Projectile = "Projectile",
  // DarkStar: the challenger structure that fires gate shots (C4). Appended.
  Stargate = "Stargate",
  // DarkStar: the structure whose perimeter no challenger's missile may
  // target (C5). Appended.
  ShieldArray = "Shield Array",
  // DarkStar: the defensive land unit an industrial zone supports (Tom,
  // 2026-10-23). Appended.
  Army = "Army",
}

export enum TrainType {
  Engine = "Engine",
  TailEngine = "TailEngine",
  Carriage = "Carriage",
}

export const Nukes = unitTypeGroup([
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRVWarhead,
  UnitType.MIRV,
] as const);

export const BuildableAttacks = unitTypeGroup([
  UnitType.AtomBomb,
  UnitType.HydrogenBomb,
  UnitType.MIRV,
  UnitType.Warship,
  UnitType.Army,
] as const);

export const Structures = unitTypeGroup([
  UnitType.City,
  UnitType.DefensePost,
  UnitType.SAMLauncher,
  UnitType.MissileSilo,
  UnitType.Port,
  UnitType.Factory,
  UnitType.Stargate,
  UnitType.ShieldArray,
] as const);

// DarkStar: the structures a missile launches from — the nearest ready one
// that has the target in reach (a silo has no range, a gate its own).
export const MissileLaunchers = unitTypeGroup([
  UnitType.MissileSilo,
  UnitType.Stargate,
] as const);

export const BuildMenus = unitTypeGroup([
  ...Structures.types,
  ...BuildableAttacks.types,
] as const);

export const PlayerBuildable = unitTypeGroup([
  ...BuildMenus.types,
  UnitType.TransportShip,
] as const);

export type PlayerBuildableUnitType = (typeof PlayerBuildable.types)[number];

export interface OwnerComp {
  owner: Player;
}

export type TrajectoryTile = {
  tile: TileRef;
  targetable: boolean;
};
export interface UnitParamsMap {
  [UnitType.TransportShip]: {
    troops?: number;
    targetTile?: TileRef;
  };

  [UnitType.Warship]: {
    patrolTile: TileRef;
  };

  [UnitType.Army]: {
    patrolTile: TileRef;
  };

  [UnitType.Shell]: Record<string, never>;

  [UnitType.SAMMissile]: {
    targetUnit: Unit;
  };

  [UnitType.Port]: Record<string, never>;

  [UnitType.AtomBomb]: {
    targetTile?: number;
    trajectory: TrajectoryTile[];
  };

  [UnitType.HydrogenBomb]: {
    targetTile?: number;
    trajectory: TrajectoryTile[];
  };

  [UnitType.MIRV]: {
    targetTile?: number;
    targetPlayer?: Player | TerraNullius;
  };

  [UnitType.MIRVWarhead]: {
    targetTile?: number;
    trajectory: TrajectoryTile[];
  };

  [UnitType.TradeShip]: {
    targetUnit: Unit;
    lastSetSafeFromPirates?: number;
  };

  [UnitType.Train]: {
    trainType: TrainType;
    targetUnit?: Unit;
    loaded?: boolean;
  };

  [UnitType.Factory]: Record<string, never>;

  [UnitType.MissileSilo]: Record<string, never>;

  [UnitType.DefensePost]: Record<string, never>;

  [UnitType.SAMLauncher]: Record<string, never>;

  [UnitType.City]: Record<string, never>;

  [UnitType.Projectile]: {
    targetTile?: number;
    trajectory: TrajectoryTile[];
    // A gate shot carries its troops (a strike's ride on the Attack instead).
    troops?: number;
  };

  [UnitType.Stargate]: Record<string, never>;

  [UnitType.ShieldArray]: Record<string, never>;
}

// Type helper to get params type for a specific unit type
export type UnitParams<T extends UnitType> = UnitParamsMap[T];

export type AllUnitParams = UnitParamsMap[keyof UnitParamsMap];

export enum Relation {
  Hostile = 0,
  Distrustful = 1,
  Neutral = 2,
  Friendly = 3,
}

export class Nation {
  constructor(
    public readonly spawnCell: Cell | undefined,
    public readonly playerInfo: PlayerInfo,
  ) {}
}

export class Cell {
  public index: number;

  private strRepr: string;

  constructor(
    public readonly x: number,
    public readonly y: number,
  ) {
    this.strRepr = `Cell[${this.x},${this.y}]`;
  }

  pos(): MapPos {
    return {
      x: this.x,
      y: this.y,
    };
  }

  toString(): string {
    return this.strRepr;
  }
}

export enum TerrainType {
  Plains,
  Highland,
  Mountain,
  Ocean,
  Impassable,
}

export enum PlayerType {
  Bot = "BOT",
  Human = "HUMAN",
  Nation = "NATION",
}

export interface Execution {
  isActive(): boolean;
  activeDuringSpawnPhase(): boolean;
  // Whether it also runs during the opening (C3), while the challengers'
  // flights are in the air and everything else waits. Only a spawn already
  // under way should.
  activeDuringOpening?(): boolean;
  init(mg: Game, ticks: number): void;
  tick(ticks: number): void;
}

export interface Attack {
  id(): string;
  retreating(): boolean;
  retreated(): boolean;
  orderRetreat(): void;
  executeRetreat(): void;
  target(): Player | TerraNullius;
  attacker(): Player;
  troops(): number;
  setTroops(troops: number): void;
  isActive(): boolean;
  delete(): void;
  // The tile the attack originated from, mostly used for boat attacks.
  sourceTile(): TileRef | null;
  addBorderTile(tile: TileRef): void;
  removeBorderTile(tile: TileRef): void;
  clearBorder(): void;
  borderSize(): number;
  clusteredPositions(): TileRef[];
  // The defender's tiles on the attack's front (an army aims at them).
  borderTiles(): ReadonlySet<TileRef>;
  // A Hegemon's strike (RazeExecution): its troops defend the bubble of land
  // it holds, and the target fights it by taking that land back.
  isStrike(): boolean;
  markStrike(): void;
  // A punitive strike (H19): a strike that answers a missile launch, funded
  // by the galaxy's levy; it cannot be recalled.
  isPunitive(): boolean;
  markPunitive(): void;
}

// A Hegemon strike between launch and landing (RazeExecution).
export interface StrikeInFlight {
  id(): string;
  targetPlayer(): Player;
  troopCount(): number;
  aimTile(): TileRef;
  landsAtTick(): number;
  recall(): void;
  isPunitive(): boolean;
}

// The warheads a silo fires: the atom bomb is the Nuclear Warhead, the
// hydrogen bomb the Antimatter Warhead (S6).
export type Warhead = UnitType.AtomBomb | UnitType.HydrogenBomb;

// A silo exposed to a punitive strike (H19): flagged by its latest missile
// launch, for the severer of the warheads it has fired since.
export interface PunitiveFlag {
  warhead: Warhead;
  expiresTick: Tick;
}

// A Hegemon strike from launch until its bubble has popped (RazeExecution).
// The bubble is the strike's own bookkeeping; this lets one strike's pop tell
// another live strike's land from an orphan (see RazeExecution.pop).
export interface HegemonStrike {
  targetPlayer(): Player;
  // Take in any Hegemon land beyond the moat that touches the bubble.
  adoptOrphans(): void;
  holdsTile(tile: TileRef): boolean;
  // The struck player commits troops against the landed strike (H17):
  // returns how many were spent cancelling it, at most the troops offered.
  counter(troops: number): number;
}

// A stargate shot between launch and landing (GateShotExecution): the HUD's
// recall (the cancel_boat order on the projectile's unit id) goes through it.
export interface GateShotInFlight {
  unitId(): number;
  owner(): Player;
  targetTile(): TileRef;
  recall(): void;
}

export interface AllianceRequest {
  accept(): void;
  reject(): void;
  requestor(): Player;
  recipient(): Player;
  createdAt(): Tick;
  status(): "pending" | "accepted" | "rejected";
}

export interface Alliance {
  requestor(): Player;
  recipient(): Player;
  createdAt(): Tick;
  expiresAt(): Tick;
  other(player: Player): Player;
}

export interface MutableAlliance extends Alliance {
  expire(): void;
  other(player: Player): Player;
  bothAgreedToExtend(): boolean;
  addExtensionRequest(player: Player): void;
  id(): number;
  extend(): void;
  onlyOneAgreedToExtend(): boolean;

  agreedToExtend(player: Player): boolean;
}

export class PlayerInfo {
  public readonly displayName: string;

  constructor(
    public readonly name: string,
    public readonly playerType: PlayerType,
    // null if tribe.
    public readonly clientID: ClientID | null,
    // TODO: make player id the small id
    public readonly id: PlayerID,
    public readonly isLobbyCreator: boolean = false,
    public readonly clanTag: string | null = null,
    public readonly friends: ClientID[] = [],
    // Server-pinned team slot (index into the game's team list) for
    // matchmade team games; null = assign normally.
    public readonly teamIndex: number | null = null,
    // Manifest flag code (e.g. "in", "pk") for PlayerType.Nation players.
    // Carried from the map manifest through to the client so it can render
    // the correct flag even when multiple nations on a map share a display
    // name (e.g. India's and Pakistan's "Punjab").
    public readonly nationFlag: string | null = null,
    // Holds the Hegemon seat (hegemon mode). A flag rather than a PlayerType
    // so a human or an AI can hold it.
    public readonly isHegemon: boolean = false,
  ) {
    this.displayName = formatPlayerDisplayName(this.name, this.clanTag);
  }
}

export function isUnit(unit: unknown): unit is Unit {
  return (
    unit &&
    typeof unit === "object" &&
    "isUnit" in unit &&
    typeof unit.isUnit === "function" &&
    unit.isUnit()
  );
}

export interface Unit {
  isUnit(): this is Unit;

  // Common properties.
  id(): number;
  type(): UnitType;
  owner(): Player;
  info(): UnitInfo;
  isMarkedForDeletion(): boolean;
  markForDeletion(): void;
  isOverdueDeletion(): boolean;
  delete(displayMessage?: boolean, destroyer?: Player): void;
  tile(): TileRef;
  lastTile(): TileRef;
  move(tile: TileRef): void;
  isActive(): boolean;
  setOwner(owner: Player): void;
  touch(): void;
  hash(): number;
  toUpdate(): UnitUpdate;
  hasTrainStation(): boolean;
  setTrainStation(trainStation: boolean): void;
  wasDestroyedByEnemy(): boolean;
  destroyer(): Player | undefined;

  // Train
  trainType(): TrainType | undefined;
  isLoaded(): boolean | undefined;
  setLoaded(loaded: boolean): void;

  // Targeting
  setTargetTile(cell: TileRef | undefined): void;
  targetTile(): TileRef | undefined;
  targetPlayer(): Player | TerraNullius | undefined;
  setTrajectoryIndex(i: number): void;
  trajectoryIndex(): number;
  trajectory(): TrajectoryTile[];
  setTargetUnit(unit: Unit | undefined): void;
  targetUnit(): Unit | undefined;
  setTargetedBySAM(targeted: boolean): void;
  targetedBySAM(): boolean;
  setReachedTarget(): void;
  reachedTarget(): boolean;
  isTargetable(): boolean;
  setTargetable(targetable: boolean): void;

  // Health
  hasHealth(): boolean;
  warshipState(): WarshipState;
  updateWarshipState(update: Partial<WarshipState>): void;
  transportShipState(): TransportShipState;
  updateTransportShipState(update: Partial<TransportShipState>): void;
  nukeState(): NukeState;
  updateNukeState(update: Partial<NukeState>): void;

  health(): number;
  /** Effective max health, including any warship veterancy bonus. */
  maxHealth(): number;
  modifyHealth(delta: number, attacker?: Player): void;

  // Warship veterancy
  /** Current veterancy level from warshipState (0 for non-warships). */
  veterancy(): number;
  /** Record this warship destroying an enemy unit (drives veterancy gain). */
  recordKill(targetType: UnitType): void;
  /** Record this warship capturing a trade ship (drives veterancy gain). */
  recordTradeCapture(): void;

  // Troops
  setTroops(troops: number): void;
  troops(): number;

  // --- UNIT SPECIFIC ---

  // SAMs & Missile Silos
  launch(): void;
  reloadMissile(): void;
  isInCooldown(): boolean;
  missileTimerQueue(): number[];
  // Punitive strikes (H19), missile launchers (stargates) only: the flag a
  // launch left, until it expires or a strike on the owner clears it.
  punitiveFlag(): PunitiveFlag | undefined;
  flagForPunishment(warhead: Warhead): void;
  clearPunitiveFlag(): void;
  samLauncherState(): SamLauncherState | undefined;

  // Trade Ships
  setSafeFromPirates(): void; // Only for trade ships
  isSafeFromPirates(): boolean; // Only for trade ships

  // Construction phase on structures
  isUnderConstruction(): boolean;
  setUnderConstruction(underConstruction: boolean): void;

  // Upgradable Structures
  level(): number;
  increaseLevel(): void;
  decreaseLevel(destroyer?: Player): void;
}

export interface TerraNullius {
  isPlayer(): false;
  id(): null;
  clientID(): ClientID;
  smallID(): number;
}

export interface Embargo {
  createdAt: Tick;
  isTemporary: boolean;
  target: Player;
}

export interface DisconnectSnapshot {
  currentTick: number;
  teamTiles: number;
  totalLand: number;
  wasAlive: boolean;
}

export interface Player {
  // Basic Info
  smallID(): number;
  info(): PlayerInfo;
  name(): string;
  displayName(): string;
  clanTag(): string | null;
  clientID(): ClientID | null;
  id(): PlayerID;
  type(): PlayerType;
  isPlayer(): this is Player;
  toString(): string;
  isLobbyCreator(): boolean;
  isHegemon(): boolean;
  // Dark Star tiles held by a challenger; they count for nothing (H5).
  domainTilesHeld(): number;
  // DarkStar beachheads (C4): a tile a stargate shot landed on. While the
  // player holds one, the pocket of land around it is never absorbed by the
  // enclave rule (PlayerExecution); the tag goes when the tile changes hands.
  markBeachhead(tile: TileRef): void;
  isBeachhead(tile: TileRef): boolean;
  beachheadCount(): number;
  beachheads(): ReadonlySet<TileRef>;

  // Piracy (docs/DarkStar-Piracy.md). A pirate is a third state beside alive
  // and dead: no tiles, but present, with one ship. isAlive() stays
  // `tiles > 0`; everything the engine denies a dead player it still denies
  // a pirate unless a gate says otherwise (the corsair's build and spawn).
  isPirate(): boolean;
  // Set when the first corsair spawns (PR1); cleared by a landing (PR7) or
  // when a leaving pirate's ship is scuttled (PR18).
  embracePiracy(): void;
  endPiracy(): void;
  // PR10: sinkings this round (the cooldown doubles with each), the tick the
  // next corsair may spawn. The count persists across returns.
  pirateSinkings(): number;
  pirateRespawnAt(): Tick;
  recordCorsairSunk(): void;
  // Called when the player is eliminated: the same wait before the first
  // corsair as between corsairs (every phase transition, Tom 2026-10-15).
  recordEliminated(): void;
  // PR14: raids and landings this round, for a later leaderboard line.
  pirateRaids(): number;
  recordPirateRaid(): void;
  pirateLandings(): number;
  recordPirateLanding(): void;
  // PR7: the shore the corsair is sailing to beach on, while a landing is
  // under way; the corsair's own execution stands down for the voyage.
  pirateLanding(): TileRef | undefined;
  setPirateLanding(shore: TileRef | undefined): void;

  // State & Properties
  isAlive(): boolean;
  isTraitor(): boolean;
  markTraitor(): void;
  // Doomsday Clock (anti-stall): marked when below the rising territory bar.
  inDoomsdayClock(): boolean;
  /** Territory is actively rotting away (the final doomsday phase). */
  isDecaying(): boolean;
  markRotted(): void;
  doomsdayClockTicks(): number;
  enterDoomsdayClock(): void;
  clearDoomsdayClock(): void;
  largestClusterBoundingBox: { min: Cell; max: Cell } | null;
  lastTileChange(): Tick;
  /** Counter bumped on every ownership change of one of this player's tiles (also when its border set can change). */
  tileChangeVersion(): number;

  isDisconnected(): boolean;
  markDisconnected(
    isDisconnected: boolean,
    snapshot?: DisconnectSnapshot,
  ): void;
  disconnectSnapshot(): DisconnectSnapshot | null;
  disconnectedAtTick(): number | null;

  hasSpawned(): boolean;
  setSpawnTile(spawnTile: TileRef): void;
  spawnTile(): TileRef | undefined;

  // Territory
  tiles(): ReadonlyTileSet;
  borderTiles(): ReadonlyTileSet;
  numTilesOwned(): number;
  conquer(tile: TileRef): void;
  relinquish(tile: TileRef): void;

  // Resources & Troops
  gold(): Gold;
  addGold(toAdd: Gold, tile?: TileRef): void;
  removeGold(toRemove: Gold): Gold;

  // Cumulative trade revenue, surfaced on the live PlayerUpdate so clients can
  // compute per-source gold rates (leaderboard "Ship/Train Trade Gold/min").
  // Mirrors StatsSchemas GOLD_INDEX_TRADE / GOLD_INDEX_TRAIN_* semantics.
  tradeGold(): Gold;
  addTradeGold(toAdd: Gold): void;
  trainGold(): Gold;
  addTrainGold(toAdd: Gold): void;

  // Cumulative piracy revenue (captured trade ships; GOLD_INDEX_STEAL).
  piracyGold(): Gold;
  addPiracyGold(toAdd: Gold): void;

  // Cumulative gold received from ALL sources (workers, trade, trains,
  // piracy, conquest, donations). Incremented inside addGold(); surfaced on
  // the live PlayerUpdate for the leaderboard "Gold Income/min" column.
  goldEarned(): Gold;
  troops(): number;
  setTroops(troops: number): void;
  addTroops(troops: number): void;
  removeTroops(troops: number): number;

  // Units
  // Fixed-arity + array overloads instead of a rest parameter: the rest array
  // would be allocated on every call, and this is one of the hottest calls in
  // the simulation. With no arguments the player's live unit array is
  // returned — do not mutate it; typed queries return a fresh snapshot array.
  units(): Unit[];
  units(types: readonly UnitType[]): Unit[];
  units(type: UnitType, type2?: UnitType, type3?: UnitType): Unit[];
  unitCount(type: UnitType): number;
  unitsConstructed(type: UnitType): number;
  unitsOwned(type: UnitType): number;
  // Destroyers a player's spaceports support, or armies its industrial
  // zones, one per level (null: no cap).
  unitSupport(unitType: UnitType): { used: number; cap: number } | null;
  // DarkStar: the stargate that would fire at the tile (C4), null when none
  // of the player's built gates has it in range.
  stargateFor(tile: TileRef): GateShotOption | null;
  // `payer` (default: this player) is whose gold is checked and charged —
  // a gift (H18) is the Hegemon paying for what the host builds and owns, at
  // the flat first-building price (UnitInfo.cost).
  buildableUnits(
    tile: TileRef | null,
    units?: readonly PlayerBuildableUnitType[],
    payer?: Player,
  ): BuildableUnit[];
  canBuild(
    type: UnitType,
    targetTile: TileRef,
    validTiles?: TileRef[] | null,
    payer?: Player,
  ): TileRef | false;
  buildUnit<T extends UnitType>(
    type: T,
    spawnTile: TileRef,
    params: UnitParams<T>,
    payer?: Player,
  ): Unit;

  // Returns the existing unit that can be upgraded,
  // or false if it cannot be upgraded.
  // New units of the same type can upgrade existing units.
  // e.g. if a place a new city here, can it upgrade an existing city?
  findUnitToUpgrade(
    type: UnitType,
    targetTile: TileRef,
    payer?: Player,
  ): Unit | false;
  canUpgradeUnit(unit: Unit, payer?: Player): boolean;
  upgradeUnit(unit: Unit, payer?: Player): void;
  captureUnit(unit: Unit): void;

  // Relations & Diplomacy
  nearby(): (Player | TerraNullius)[];
  sharesBorderWith(other: Player | TerraNullius): boolean;
  relation(other: Player): Relation;
  allRelationsSorted(): { player: Player; relation: Relation }[];
  updateRelation(other: Player, delta: number): void;
  decayRelations(): void;
  isOnSameTeam(other: Player): boolean;
  // Either allied or on same team.
  isFriendly(other: Player, treatAFKFriendly?: boolean): boolean;
  team(): Team | null;
  incomingAllianceRequests(): AllianceRequest[];
  outgoingAllianceRequests(): AllianceRequest[];
  alliances(): MutableAlliance[];
  expiredAlliances(): Alliance[];
  allies(): Player[];
  isAlliedWith(other: Player): boolean;
  allianceWith(other: Player): MutableAlliance | null;
  allianceInfo(other: Player): AllianceInfo | null;
  canSendAllianceRequest(other: Player): boolean;
  breakAlliance(alliance: Alliance): void;
  removeAllAlliances(): void;
  createAllianceRequest(recipient: Player): AllianceRequest | null;
  betrayals(): number;

  // Targeting
  canTarget(other: Player): boolean;
  target(other: Player): void;
  targets(): Player[];
  transitiveTargets(): Player[];

  // Communication
  canSendEmoji(recipient: Player | typeof AllPlayers): boolean;
  outgoingEmojis(): EmojiMessage[];
  sendEmoji(recipient: Player | typeof AllPlayers, emoji: string): void;
  canSendQuickChat(recipient: Player): boolean;
  recordQuickChat(recipient: Player): void;

  // Donation
  canDonateGold(recipient: Player): boolean;
  canDonateTroops(recipient: Player): boolean;
  donateTroops(recipient: Player, troops: number): boolean;
  donateGold(recipient: Player, gold: Gold): boolean;
  canDeleteUnit(): boolean;
  recordDeleteUnit(): void;
  canEmbargoAll(): boolean;
  recordEmbargoAll(): void;

  // Embargo
  hasEmbargoAgainst(other: Player): boolean;
  tradingPartners(): Player[];
  addEmbargo(other: Player, isTemporary: boolean): void;
  getEmbargoes(): Embargo[];
  stopEmbargo(other: Player): void;
  endTemporaryEmbargo(other: Player): void;
  canTrade(other: Player): boolean;

  // Attacking.
  canAttack(tile: TileRef): boolean;
  canAttackPlayer(player: Player, treatAFKFriendly?: boolean): boolean;
  // A Hegemon's strike is razing this player's land (H17).
  isStruckBy(hegemon: Player): boolean;
  isImmune(): boolean;

  createAttack(
    target: Player | TerraNullius,
    troops: number,
    sourceTile: TileRef | null,
    border: Set<number>,
    // A strike keeps the id it had in flight, so the HUD row is one row.
    id?: string,
  ): Attack;
  outgoingAttacks(): Attack[];
  incomingAttacks(): Attack[];
  orderRetreat(attackID: string): void;
  executeRetreat(attackID: string): void;

  // Misc
  toUpdate(
    statsOut?: number[],
    attackTroopsOut?: number[],
  ): PlayerUpdate | null;
  playerProfile(): PlayerProfile;
  // WARNING: this operation is expensive.
  bestTransportShipSpawn(tile: TileRef): TileRef | false;
}

export interface Game extends GameMap {
  // Map & Dimensions
  isOnMap(cell: Cell): boolean;
  width(): number;
  height(): number;
  map(): GameMap;
  miniMap(): GameMap;
  forEachTile(fn: (tile: TileRef) => void): void;
  // Zero-allocation neighbor iteration (cardinal only), in the same N, S, W, E
  // order as neighbors().
  forEachNeighbor(tile: TileRef, callback: (neighbor: TileRef) => void): void;
  // Writes the cardinal neighbors of ref into out (same N, S, W, E order as
  // neighbors()) and returns the count. Reuse out across calls to avoid
  // allocation.
  neighbors4(ref: TileRef, out: TileRef[]): number;
  neighbors8(ref: TileRef, out: TileRef[]): number;
  // Zero-allocation neighbor iteration for performance-critical cluster calculation
  // Alternative to neighborsWithDiag() that returns arrays
  // Avoids creating intermediate arrays and uses a callback for better performance
  forEachNeighborWithDiag(
    tile: TileRef,
    callback: (neighbor: TileRef) => void,
  ): void;

  // Player Management
  player(id: PlayerID): Player;
  players(): Player[];
  allPlayers(): Player[];
  playerByClientID(id: ClientID): Player | null;
  playerBySmallID(id: number): Player | TerraNullius;
  hasPlayer(id: PlayerID): boolean;
  addPlayer(playerInfo: PlayerInfo): Player;
  terraNullius(): TerraNullius;
  owner(ref: TileRef): Player | TerraNullius;

  teams(): Team[];
  teamTilesOwned(team: Team): number;
  totalLandTiles(): number;
  teamSpawnArea(team: Team): SpawnArea | undefined;

  // Alliances
  expireAlliance(alliance: Alliance): void;

  // Immunity timer
  isSpawnImmunityActive(): boolean;
  isNationSpawnImmunityActive(): boolean;
  // Hegemon mode: how long the opening's flights take (C3), fixed when the
  // spawn phase ends; the round begins when they have landed. 0 otherwise.
  openingTicks(): number;
  // Between the spawn phase and the round's first tick, while the opening's
  // flights are in the air: nothing runs and nothing counts.
  inOpening(): boolean;
  elapsedGameSeconds(): number;

  // Game State
  ticks(): Tick;
  inSpawnPhase(): boolean;
  endSpawnPhase(): void;
  executeNextTick(): GameUpdates;
  drainPackedTileUpdates(): Uint32Array;
  recordMotionPlan(record: MotionPlanRecord): void;
  drainPackedMotionPlans(): Uint32Array | null;
  drainPackedPlayerUpdates(): Float64Array | null;
  drainPackedAttackUpdates(): Float64Array | null;
  // null ends the game with no winner (a cancelled match, e.g. a ranked game
  // that didn't fill): the record is archived winnerless and never ranked.
  setWinner(
    winner: Player | Team | null,
    allPlayersStats: AllPlayersStats,
  ): void;
  getWinner(): Player | Team | null;
  config(): Config;
  isPaused(): boolean;
  setPaused(paused: boolean): void;

  // Units
  unit(id: number): Unit | undefined;
  // See Player.units() for why this is not a rest parameter.
  units(): Unit[];
  units(types: readonly UnitType[]): Unit[];
  units(type: UnitType, type2?: UnitType, type3?: UnitType): Unit[];
  unitCount(type: UnitType): number;
  unitInfo(type: UnitType): UnitInfo;
  hasUnitNearby(
    tile: TileRef,
    searchRange: number,
    type: UnitType,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean;
  anyUnitNearby(
    tile: TileRef,
    searchRange: number,
    types: readonly UnitType[],
    predicate: (unit: Unit) => boolean,
    playerId?: PlayerID,
    includeUnderConstruction?: boolean,
  ): boolean;
  nearbyUnits(
    tile: TileRef,
    searchRange: number,
    types: UnitType | readonly UnitType[],
    predicate?: UnitPredicate,
    includeUnderConstruction?: boolean,
  ): Array<{ unit: Unit; distSquared: number }>;

  addExecution(...exec: Execution[]): void;
  displayMessage(
    message: string,
    type: MessageType,
    playerID: PlayerID | null,
    goldAmount?: bigint,
    params?: Record<string, string | number>,
    unitID?: number,
    focusPlayerID?: PlayerID,
  ): void;
  displayIncomingUnit(
    unitID: number,
    message: string,
    type: MessageType,
    playerID: PlayerID | null,
  ): void;

  displayChat(
    message: string,
    category: string,
    target: PlayerID | undefined,
    playerID: PlayerID | null,
    isFrom: boolean,
    recipient: string,
  ): void;

  // Nations
  nations(): Nation[];

  numTilesWithFallout(): number;
  stats(): Stats;

  addUpdate(update: GameUpdate): void;
  railNetwork(): RailNetwork;
  conquerPlayer(conqueror: Player, conquered: Player): void;

  // Hegemon mode (docs/DarkStar-Design.md); null/false when the mode is off.
  darkStar(): DarkStarGeometry | null;
  isInDarkStar(tile: TileRef): boolean;
  // Moat water: the ring of deep space around the disc (H14).
  isInMoat(tile: TileRef): boolean;
  hegemon(): Player | null;
  // Whoever eliminated the Hegemon, once it has fallen.
  hegemonSlayer(): Player | null;
  // The invasion slot (H6, H12): the one challenger holding domain tiles.
  darkStarInvader(): Player | null;
  domainTilesHeldBy(player: Player): number;
  // Dark Star tiles the Hegemon still holds, and its land beyond the moat —
  // the bubbles of its strikes (H17).
  hegemonDomainTiles(): number;
  hegemonBubbleTiles(): number;
  // Strikes launched but not yet landed (H8). A landed strike is an Attack
  // (Attack.isStrike); in flight it exists only here, so the HUD can show it
  // and a recall can reach it.
  strikesInFlight(): StrikeInFlight[];
  addStrikeInFlight(strike: StrikeInFlight): void;
  removeStrikeInFlight(strike: StrikeInFlight): void;
  // Every strike alive, in flight or landed (H8): while this is empty the
  // Hegemon owns nothing beyond the moat.
  hegemonStrikes(): HegemonStrike[];
  addHegemonStrike(strike: HegemonStrike): void;
  removeHegemonStrike(strike: HegemonStrike): void;
  // One live strike per target: in flight or landed.
  hegemonStrikeOn(target: Player): boolean;
  // Stargate shots in the air (C4).
  gateShotsInFlight(): GateShotInFlight[];
  addGateShotInFlight(shot: GateShotInFlight): void;
  removeGateShotInFlight(shot: GateShotInFlight): void;
  lastInvaderGainTick(): number;
  // Set by HegemonExecution: the current invasion has stalled (H13).
  invasionStalled(): boolean;
  setInvasionStalled(stalled: boolean): void;
  canInvadeDarkStar(player: Player): boolean;
  miniWaterHPA(): PathFinder<number> | null;
  miniWaterGraph(): AbstractGraph | null;
  getWaterComponent(tile: TileRef): number | null;
  hasWaterComponent(tile: TileRef, component: number): boolean;
  /**
   * Returns the approximate number of water tiles in the component
   * containing `tile`, or null if the tile has no water component. Useful for
   * filtering tiny water bodies (e.g. preventing AI port placement on ponds).
   */
  getWaterComponentSize(tile: TileRef): number | null;
  /**
   * Returns the set of water components that `player` shares with at least one
   * valid trade partner (cached). Used by nation AI for port-placement
   * heuristics. `null` means no usable water body for ports.
   */
  sharedWaterComponents(player: Player): Set<number> | null;
  /**
   * A spaceport's harbours (S7, §6.17): the nearest deep space reachable over
   * land from the port tile, one per body of space, with the overland path.
   * Cached; terrain only.
   */
  harbours(portTile: TileRef): readonly Harbour[];
  /** Incremented each time the water navigation graph is rebuilt (e.g. after nuke terrain change). */
  waterGraphVersion(): number;

  /** Queue a land tile for conversion to water (batched every few ticks). Tile must be unowned. */
  queueWaterConversion(tile: TileRef): void;

  /** Queue a tile that was inside a nuke blast radius (for nukeable layer destruction). */
  queueNukeImpact(tile: TileRef): void;

  /** Drain all tiles from nuke impacts this tick. Called once per tick. */
  drainNukeImpacts(): TileRef[];
}

export interface PlayerActions {
  canAttack: boolean;
  buildableUnits: BuildableUnit[];
  canSendEmojiAllPlayers: boolean;
  canEmbargoAll?: boolean;
  interaction?: PlayerInteraction;
  // DarkStar: the stargate that would fire at the queried tile, if any (C4).
  gateShot?: GateShotOption;
  // DarkStar: set when the querying player is the Hegemon and the tile is a
  // challenger's — `buildableUnits` is then that host's list with the Hegemon
  // paying, for a gift (H18).
  giftHost?: PlayerID;
  // DarkStar: set when the querying player is the Hegemon and the tile holds
  // a challenger's silo flagged by a missile launch (H19).
  punitiveStrike?: PunitiveStrikeOption;
}

// A flagged silo the Hegemon may punish: the warhead that flagged it, when
// the flag expires, and the levy the strike would take from every challenger.
export interface PunitiveStrikeOption {
  // The silo the click means (the nearest flagged one within reach of the
  // clicked tile); the strike is aimed here.
  siloTile: TileRef;
  warhead: Warhead;
  expiresTick: Tick;
  levyPercent: number;
  // The levy as it stands now, in troops.
  levyTroops: number;
}

// The nearest of a player's built stargates whose range covers a tile:
// ready to fire, or reloading for readyInTicks more ticks.
export interface GateShotOption {
  gateId: number;
  gateTile: TileRef;
  level: number;
  range: number;
  readyInTicks: number;
}

export interface BuildableUnit {
  canBuild: TileRef | false;
  // unit id of the existing unit that can be upgraded, or false if it cannot be upgraded.
  canUpgrade: number | false;
  type: PlayerBuildableUnitType;
  cost: Gold;
  // Cumulative cost of upgrading 1..MAX_UPGRADE_AMOUNT times (upgrade costs
  // escalate per level, so a bulk total is NOT cost * amount). Only set when
  // canUpgrade is not false.
  upgradeCosts?: Gold[];
  overlappingRailroads: TileRef[];
  ghostRailPaths: TileRef[][];
}

// Total price of buying `amount` of a buildable in one intent. Upgrades use
// the escalating totals from core; flat-cost units (nukes) scale linearly.
export function bulkCost(bu: BuildableUnit, amount: number): Gold {
  return bu.upgradeCosts?.[amount - 1] ?? bu.cost * BigInt(amount);
}

// Largest amount (up to MAX_UPGRADE_AMOUNT) whose bulk total fits in `gold`.
// 0 when not even a single purchase is affordable.
export function maxBulkAmount(bu: BuildableUnit, gold: Gold): number {
  let max = 0;
  for (let n = 1; n <= MAX_UPGRADE_AMOUNT; n++) {
    // Never price upgrades past the shipped totals — beyond the array,
    // bulkCost would silently fall back to linear pricing.
    if (bu.upgradeCosts !== undefined && n > bu.upgradeCosts.length) {
      break;
    }
    if (bulkCost(bu, n) > gold) {
      break;
    }
    max = n;
  }
  return max;
}

// Fixed mid-ladder steps for the structure bulk-upgrade menu. Warheads are
// never bought in bulk: a stack on one tile all lands on the same spot.
export const STRUCTURE_BULK_STEPS: readonly number[] = [5, 10];

export interface PlayerProfile {
  relations: Record<number, Relation>;
  alliances: number[];
}

export interface PlayerBorderTiles {
  borderTiles: ReadonlySet<TileRef>;
}

export interface AllianceInfo {
  expiresAt: Tick;
  inExtensionWindow: boolean;
  myPlayerAgreedToExtend: boolean;
  otherAgreedToExtend: boolean;
  canExtend: boolean;
}

export interface PlayerInteraction {
  sharedBorder: boolean;
  canSendEmoji: boolean;
  canSendAllianceRequest: boolean;
  canBreakAlliance: boolean;
  canTarget: boolean;
  canDonateGold: boolean;
  canDonateTroops: boolean;
  canEmbargo: boolean;
  allianceInfo?: AllianceInfo;
}

export interface EmojiMessage {
  message: string;
  senderID: number;
  recipientID: number | typeof AllPlayers;
  createdAt: Tick;
}

export enum MessageType {
  ATTACK_FAILED,
  ATTACK_CANCELLED,
  ATTACK_REQUEST,
  CONQUERED_PLAYER,
  MIRV_INBOUND,
  NUKE_INBOUND,
  NUKE_DETONATED,
  HYDROGEN_BOMB_INBOUND,
  NAVAL_INVASION_INBOUND,
  SAM_MISS,
  SAM_HIT,
  CAPTURED_ENEMY_UNIT,
  UNIT_DESTROYED,
  ALLIANCE_ACCEPTED,
  ALLIANCE_REJECTED,
  ALLIANCE_REQUEST,
  ALLIANCE_BROKEN,
  ALLIANCE_EXPIRED,
  DONATION_SENT,
  DONATION_RECEIVED,
  CHAT,
  RENEW_ALLIANCE,
}

// Piracy (docs/DarkStar-Piracy.md, PR7): the two messages a landing sends,
// to the pirate and to the coast's owner. Named here so the client's sound
// controller recognises them (the beaching cue) without importing the
// execution.
export const PIRATE_LANDED_MESSAGE = "events_display.pirate_landed";
export const PIRATE_LANDING_MESSAGE = "events_display.pirate_landing";

// Message categories used for filtering events in the EventsDisplay
export enum MessageCategory {
  ATTACK = "ATTACK",
  NUKE = "NUKE",
  ALLIANCE = "ALLIANCE",
  TRADE = "TRADE",
  CHAT = "CHAT",
}

// Ensures that all message types are included in a category
export const MESSAGE_TYPE_CATEGORIES: Record<MessageType, MessageCategory> = {
  [MessageType.ATTACK_FAILED]: MessageCategory.ATTACK,
  [MessageType.ATTACK_CANCELLED]: MessageCategory.ATTACK,
  [MessageType.ATTACK_REQUEST]: MessageCategory.ATTACK,
  [MessageType.CONQUERED_PLAYER]: MessageCategory.ATTACK,
  [MessageType.MIRV_INBOUND]: MessageCategory.NUKE,
  [MessageType.NUKE_INBOUND]: MessageCategory.NUKE,
  [MessageType.NUKE_DETONATED]: MessageCategory.NUKE,
  [MessageType.HYDROGEN_BOMB_INBOUND]: MessageCategory.NUKE,
  [MessageType.NAVAL_INVASION_INBOUND]: MessageCategory.ATTACK,
  [MessageType.SAM_MISS]: MessageCategory.ATTACK,
  [MessageType.SAM_HIT]: MessageCategory.ATTACK,
  [MessageType.CAPTURED_ENEMY_UNIT]: MessageCategory.ATTACK,
  [MessageType.UNIT_DESTROYED]: MessageCategory.ATTACK,
  [MessageType.ALLIANCE_ACCEPTED]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_REJECTED]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_REQUEST]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_BROKEN]: MessageCategory.ALLIANCE,
  [MessageType.ALLIANCE_EXPIRED]: MessageCategory.ALLIANCE,
  [MessageType.RENEW_ALLIANCE]: MessageCategory.ALLIANCE,
  [MessageType.DONATION_SENT]: MessageCategory.TRADE,
  [MessageType.DONATION_RECEIVED]: MessageCategory.TRADE,
  [MessageType.CHAT]: MessageCategory.CHAT,
} as const;

/**
 * Get the category of a message type
 */
export function getMessageCategory(messageType: MessageType): MessageCategory {
  return MESSAGE_TYPE_CATEGORIES[messageType];
}

export interface NameViewData {
  x: number;
  y: number;
  size: number;
}
