import { Execution, Game, MessageType, Player, Unit } from "../game/Game";

export class UpgradeStructureExecution implements Execution {
  private structure: Unit | undefined;
  private cost: bigint;

  // `payer` is who is charged; a gift (H18) is the Hegemon paying to upgrade
  // a structure the host player owns.
  constructor(
    private player: Player,
    private unitId: number,
    private amount: number = 1,
    private payer: Player = player,
  ) {}

  init(mg: Game, ticks: number): void {
    this.structure = mg.unit(this.unitId);
    if (this.structure && this.structure.owner() !== this.player) {
      console.warn(`structure not owned by player`);
      this.structure = undefined;
    }

    if (this.structure === undefined) {
      console.warn(`structure is undefined`);
      return;
    }

    let upgraded = 0;
    for (let i = 0; i < this.amount; i++) {
      if (!this.player.canUpgradeUnit(this.structure, this.payer)) {
        if (i === 0) {
          console.warn(
            `[UpgradeStructureExecution] unit type ${this.structure.type()} cannot be upgraded`,
          );
        }
        break;
      }
      this.player.upgradeUnit(this.structure, this.payer);
      upgraded++;
    }
    if (upgraded > 0 && this.payer !== this.player) {
      // A gift (H18): tell the host what the throne has done for them.
      mg.displayMessage(
        "events_display.dark_star_gift_upgrade",
        MessageType.DONATION_RECEIVED,
        this.player.id(),
        undefined,
        { unit: this.structure.type(), level: this.structure.level() },
        this.structure.id(),
      );
    }
    return;
  }

  tick(ticks: number): void {
    return;
  }

  isActive(): boolean {
    return false;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
