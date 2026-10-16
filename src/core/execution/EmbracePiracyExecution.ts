import { Execution, Game, Player, PlayerType, UnitType } from "../game/Game";
import { TileRef } from "../game/GameMap";
import { WarshipExecution } from "./WarshipExecution";

// Piracy (docs/DarkStar-Piracy.md, PR1–PR3, PR10): an eliminated challenger
// embraces piracy from the death screen, or spawns their next corsair after
// a sinking, by pointing at a deep-space tile. One intent for both: the
// pirate state is set by the first corsair that actually spawns, so a
// refused click leaves the player exactly where they were.
//
// Refused, as a deterministic no-op on every client: the toggle off; anyone
// but a challenger (the Hegemon's fall ends the round, Lords and Barons do
// not pirate); a player who is alive, has not spawned, or whose round is
// over; a pirate who still has a corsair; and any tile the pirate branch of
// PlayerImpl.warshipSpawn refuses (land, the disc, the moat, the cooldown,
// the exclusion around the last sinking). The client says why; the sim
// only declines.
//
// The work is done from tick(), not init(): an execution added during the
// init pass is lost, and the corsair needs its WarshipExecution.
export class EmbracePiracyExecution implements Execution {
  private mg: Game;
  private active = true;

  constructor(
    private readonly player: Player,
    private readonly tile: TileRef,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(_ticks: number): void {
    this.active = false;
    const mg = this.mg;
    const player = this.player;
    if (!mg.config().piracyConfig().enabled) {
      return;
    }
    if (player.type() !== PlayerType.Human || player.isHegemon()) {
      return;
    }
    if (
      player.isAlive() ||
      !player.hasSpawned() ||
      mg.inSpawnPhase() ||
      mg.inOpening() ||
      mg.getWinner() !== null
    ) {
      return;
    }
    if (!mg.isValidRef(this.tile)) {
      console.warn(`EmbracePiracyExecution: invalid tile ${this.tile}`);
      return;
    }
    // One ship (PR2): the next corsair waits for the sinking of this one.
    if (player.units(UnitType.Warship).some((u) => u.isActive())) {
      return;
    }

    // The gates the corsair needs open read the pirate state, so it is set
    // before the spawn is tried and taken back if the tile is refused.
    const wasPirate = player.isPirate();
    player.embracePiracy();
    const spawn = player.canBuild(UnitType.Warship, this.tile);
    if (spawn === false) {
      if (!wasPirate) player.endPiracy();
      return;
    }
    const corsair = player.buildUnit(UnitType.Warship, spawn, {
      patrolTile: spawn,
    });
    player.recordCorsairSpawned();
    mg.addExecution(new WarshipExecution(corsair));
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
