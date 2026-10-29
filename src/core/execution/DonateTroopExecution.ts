import {
  Difficulty,
  Execution,
  Game,
  Player,
  PlayerID,
  PlayerType,
} from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { assertNever } from "../Util";
import { AttackExecution } from "./AttackExecution";
import { EmojiExecution } from "./EmojiExecution";
import {
  EMOJI_DONATION_TOO_SMALL,
  EMOJI_LOVE,
} from "./nation/NationEmojiBehavior";
import { TransferFlight } from "./TransferFlight";

export class DonateTroopsExecution implements Execution {
  private recipient: Player;

  private random: PseudoRandom;
  private mg: Game;

  private active = true;
  // Under a Dark Star the troops fly (GN2): set from launch to landing.
  private flight: TransferFlight | null = null;

  constructor(
    private sender: Player,
    private recipientID: PlayerID,
    private troops: number | null,
  ) {}

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());

    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `DonateTroopExecution recipient ${this.recipientID} not found`,
      );
      this.active = false;
      return;
    }

    this.recipient = mg.player(this.recipientID);
    this.troops ??= mg.config().defaultDonationAmount(this.sender);
    const maxDonation =
      mg.config().maxTroops(this.recipient) - this.recipient.troops();
    this.troops = Math.min(this.troops, maxDonation);

    if (this.troops <= 0) {
      this.active = false;
    }
  }

  tick(ticks: number): void {
    if (this.troops === null) throw new Error("not initialized");

    if (this.flight !== null) {
      const landing = this.flight.tick();
      if (landing === null) return;
      if (landing.troops > 0) this.landed(landing.troops);
      this.active = false;
      return;
    }

    if (!this.sender.canDonateTroops(this.recipient)) {
      console.warn(
        `cannot send troops from ${this.sender} to ${this.recipient}`,
      );
      this.active = false;
      return;
    }

    // Under a Dark Star the troops fly from a gate and land on impact (GN2).
    if (this.mg.config().hegemonConfig().enabled) {
      this.flight = TransferFlight.launch(
        this.mg,
        this.sender,
        this.recipient,
        this.troops,
        0n,
        ticks,
      );
      if (this.flight === null) this.active = false;
      return;
    }

    const held = this.recipient.troops();
    if (this.sender.donateTroops(this.recipient, this.troops)) {
      this.landed(this.recipient.troops() - held);
    }
    this.active = false;
  }

  // The troops have reached the recipient.
  private landed(troops: number): void {
    const minTroops = this.getMinTroopsForRelationUpdate();

    // Prevent players from just buying a good relation by sending 1% troops. Instead, a minimum is needed, and it's random.
    if (troops >= minTroops) {
      this.recipient.updateRelation(this.sender, 50);
    }

    // Reinforcements for the throne fight at once (H9, H13): while someone
    // holds the Dark Star, every troop that lands for the Hegemon goes
    // straight into the counter-attack against them, stalled or not — a
    // human Hegemon cannot sit on them, and other challengers can finish off
    // an exhausted invader whose own cap has collapsed, freeing the slot.
    // The attack takes the troops back out of the pool when it starts, at
    // the end of this tick, so H13's stall pin never sees them.
    if (this.recipient.isHegemon()) {
      const invader = this.mg.darkStarInvader();
      if (invader !== null && troops >= 1) {
        this.mg.addExecution(
          new AttackExecution(troops, this.recipient, invader.id()),
        );
      }
    }

    // Only AI nations auto-respond with emojis, human players should not
    if (
      this.recipient.type() === PlayerType.Nation &&
      this.recipient.canSendEmoji(this.sender)
    ) {
      this.mg.addExecution(
        new EmojiExecution(
          this.recipient,
          this.sender.id(),
          this.random.randElement(
            troops >= minTroops ? EMOJI_LOVE : EMOJI_DONATION_TOO_SMALL,
          ),
        ),
      );
    }
  }

  private getMinTroopsForRelationUpdate(): number {
    const { difficulty } = this.mg.config().gameConfig();
    const recipientMaxTroops = this.mg.config().maxTroops(this.recipient);

    switch (difficulty) {
      // ~7.7k - ~9.1k troops (for 100k troops)
      case Difficulty.Easy:
        return this.random.nextInt(
          recipientMaxTroops / 13,
          recipientMaxTroops / 11,
        );
      // ~9.1k - ~11.1k troops (for 100k troops)
      case Difficulty.Medium:
        return this.random.nextInt(
          recipientMaxTroops / 11,
          recipientMaxTroops / 9,
        );
      // ~11.1k - ~14.3k troops (for 100k troops)
      case Difficulty.Hard:
        return this.random.nextInt(
          recipientMaxTroops / 9,
          recipientMaxTroops / 7,
        );
      // ~14.3k - ~20k troops (for 100k troops)
      case Difficulty.Impossible:
        return this.random.nextInt(
          recipientMaxTroops / 7,
          recipientMaxTroops / 5,
        );
      default:
        assertNever(difficulty);
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
