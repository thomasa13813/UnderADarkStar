import {
  Difficulty,
  Execution,
  Game,
  Gold,
  Player,
  PlayerID,
  PlayerType,
} from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { assertNever, toInt } from "../Util";
import { EmojiExecution } from "./EmojiExecution";
import {
  EMOJI_DONATION_OK,
  EMOJI_DONATION_TOO_SMALL,
  EMOJI_LOVE,
} from "./nation/NationEmojiBehavior";
import { TransferFlight } from "./TransferFlight";

export class DonateGoldExecution implements Execution {
  private recipient: Player;
  private gold: Gold | null = null;

  private mg: Game;
  private random: PseudoRandom;

  private active = true;
  // Under a Dark Star the gold flies (GN2): set from launch to landing.
  private flight: TransferFlight | null = null;

  constructor(
    private sender: Player,
    private recipientID: PlayerID,
    goldNum: number | null,
  ) {
    this.gold = goldNum !== null ? toInt(goldNum) : null;
  }

  init(mg: Game, ticks: number): void {
    this.mg = mg;
    this.random = new PseudoRandom(mg.ticks());

    if (!mg.hasPlayer(this.recipientID)) {
      console.warn(
        `DonateGoldExecution recipient ${this.recipientID} not found`,
      );
      this.active = false;
      return;
    }

    this.recipient = mg.player(this.recipientID);
    this.gold ??= this.sender.gold() / 3n;
  }

  tick(ticks: number): void {
    if (this.gold === null) throw new Error("not initialized");

    if (this.flight !== null) {
      const landing = this.flight.tick();
      if (landing === null) return;
      if (landing.gold > 0n) this.landed(landing.gold, ticks);
      this.active = false;
      return;
    }

    if (!this.sender.canDonateGold(this.recipient)) {
      console.warn(
        `cannot send gold from ${this.sender.name()} to ${this.recipient.name()}`,
      );
      this.active = false;
      return;
    }

    // Under a Dark Star the gold flies from a gate and lands on impact (GN2).
    if (this.mg.config().hegemonConfig().enabled) {
      this.flight = TransferFlight.launch(
        this.mg,
        this.sender,
        this.recipient,
        0,
        this.gold,
        ticks,
      );
      if (this.flight === null) this.active = false;
      return;
    }

    if (this.sender.donateGold(this.recipient, this.gold)) {
      this.landed(this.gold, ticks);
    }
    this.active = false;
  }

  // The gold has reached the recipient.
  private landed(gold: Gold, ticks: number): void {
    // Give relation points based on how much gold was donated
    const relationUpdate = this.calculateRelationUpdate(gold, ticks);
    if (relationUpdate > 0) {
      this.recipient.updateRelation(this.sender, relationUpdate);
    }

    // Only AI nations auto-respond with emojis, human players should not
    if (
      this.recipient.type() === PlayerType.Nation &&
      this.recipient.canSendEmoji(this.sender)
    ) {
      // Select emoji based on donation value
      const emoji =
        relationUpdate >= 50
          ? EMOJI_LOVE
          : relationUpdate > 0
            ? EMOJI_DONATION_OK
            : EMOJI_DONATION_TOO_SMALL;

      this.mg.addExecution(
        new EmojiExecution(
          this.recipient,
          this.sender.id(),
          this.random.randElement(emoji),
        ),
      );
    }
  }

  private getGoldChunkSize(): number {
    const { difficulty } = this.mg.config().gameConfig();
    switch (difficulty) {
      case Difficulty.Easy:
        return 2_500;
      case Difficulty.Medium:
        return 5_000;
      case Difficulty.Hard:
        return 12_500;
      case Difficulty.Impossible:
        return 25_000;
      default:
        assertNever(difficulty);
    }
  }

  private calculateRelationUpdate(goldSent: Gold, ticks: number): number {
    const chunkSize = this.getGoldChunkSize();
    // For every 5 minutes that pass, multiply the chunk size to scale with game progression
    const chunkSizeMultiplier =
      ticks / (3000 + this.mg.config().numSpawnPhaseTurns());
    const adjustedChunkSize = BigInt(
      Math.round(chunkSize + chunkSize * chunkSizeMultiplier),
    );
    // Calculate how many complete chunks were donated
    const chunks = Number(goldSent / adjustedChunkSize);
    // Each chunk gives 5 relation points
    const relationUpdate = chunks * 5;
    // Cap at 100 relation points
    if (relationUpdate > 100) return 100;
    return relationUpdate;
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
