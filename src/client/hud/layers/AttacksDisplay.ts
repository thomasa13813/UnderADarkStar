import { html, LitElement } from "lit";
import { customElement, state } from "lit/decorators.js";
import { assetUrl } from "../../../core/AssetUrls";
import { EventBus } from "../../../core/EventBus";
import { MessageType, PlayerType, UnitType } from "../../../core/game/Game";
import {
  AttackUpdate,
  GameUpdateType,
  UnitIncomingUpdate,
} from "../../../core/game/GameUpdates";
import { Controller } from "../../Controller";
import { themeProvider } from "../../theme/ThemeProvider";
import {
  GoToPlayerEvent,
  GoToPositionEvent,
  GoToUnitEvent,
} from "../../TransformHandler";
import {
  CancelAttackIntentEvent,
  CancelBoatIntentEvent,
  SendAttackIntentEvent,
} from "../../Transport";
import { UIState } from "../../UIState";
import { renderTroops, translateText } from "../../Utils";
import { GameView, PlayerView, UnitView } from "../../view";
import { getColoredSprite } from "../SpriteLoader";
const soldierIcon = assetUrl("images/SoldierIcon.svg");
const swordIcon = assetUrl("images/SwordIcon.svg");
const stargateIcon = assetUrl("images/StargateIconWhite.svg");

@customElement("attacks-display")
export class AttacksDisplay extends LitElement implements Controller {
  public eventBus: EventBus;
  public game: GameView;
  public uiState: UIState;

  private active: boolean = false;
  private incomingBoatIDs: Set<number> = new Set();
  private spriteDataURLCache: Map<string, string> = new Map();
  @state() private _isVisible: boolean = false;
  @state() private incomingAttacks: AttackUpdate[] = [];
  @state() private outgoingAttacks: AttackUpdate[] = [];
  @state() private outgoingLandAttacks: AttackUpdate[] = [];
  @state() private outgoingBoats: UnitView[] = [];
  @state() private incomingBoats: UnitView[] = [];

  createRenderRoot() {
    return this;
  }

  init() {}

  tick() {
    this.active = true;

    if (!this._isVisible && !this.game.inSpawnPhase()) {
      this._isVisible = true;
    }

    const myPlayer = this.game.myPlayer();
    if (!myPlayer || !myPlayer.isAlive()) {
      if (this._isVisible) {
        this._isVisible = false;
      }
      return;
    }

    // Track incoming boat unit IDs from UnitIncoming events
    const updates = this.game.updatesSinceLastTick();
    if (updates) {
      for (const event of updates[
        GameUpdateType.UnitIncoming
      ] as UnitIncomingUpdate[]) {
        if (
          event.playerID === myPlayer.smallID() &&
          event.messageType === MessageType.NAVAL_INVASION_INBOUND
        ) {
          this.incomingBoatIDs.add(event.unitID);
        }
      }
    }

    // Resolve incoming boats from tracked IDs, remove inactive ones
    const resolvedIncomingBoats: UnitView[] = [];
    for (const unitID of this.incomingBoatIDs) {
      const unit = this.game.unit(unitID);
      if (
        unit &&
        unit.isActive() &&
        (unit.type() === UnitType.TransportShip ||
          unit.type() === UnitType.Projectile)
      ) {
        resolvedIncomingBoats.push(unit);
      } else {
        this.incomingBoatIDs.delete(unitID);
      }
    }
    this.incomingBoats = resolvedIncomingBoats;

    this.incomingAttacks = myPlayer.incomingAttacks().filter((a) => {
      const t = (this.game.playerBySmallID(a.attackerID) as PlayerView).type();
      return t !== PlayerType.Bot;
    });

    this.outgoingAttacks = myPlayer
      .outgoingAttacks()
      .filter((a) => a.targetID !== 0);

    this.outgoingLandAttacks = myPlayer
      .outgoingAttacks()
      .filter((a) => a.targetID === 0);

    // A challenger's projectiles are its stargate shots (C4): they ride the
    // boat rows (troops, target, ETA, recall). The Hegemon's are strikes.
    this.outgoingBoats = myPlayer
      .units()
      .filter(
        (u) =>
          u.type() === UnitType.TransportShip ||
          (u.type() === UnitType.Projectile && !myPlayer.isHegemon()),
      );

    this.requestUpdate();
  }

  private renderButton(options: {
    content: any;
    onClick?: () => void;
    className?: string;
    disabled?: boolean;
    translate?: boolean;
    hidden?: boolean;
  }) {
    const {
      content,
      onClick,
      className = "",
      disabled = false,
      translate = true,
      hidden = false,
    } = options;

    if (hidden) {
      return html``;
    }

    return html`
      <button
        class="${className}"
        @click=${onClick}
        ?disabled=${disabled}
        ?translate=${translate}
      >
        ${content}
      </button>
    `;
  }

  private emitCancelAttackIntent(id: string) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    this.eventBus.emit(new CancelAttackIntentEvent(id));
  }

  private emitBoatCancelIntent(id: number) {
    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;
    this.eventBus.emit(new CancelBoatIntentEvent(id));
  }

  private emitGoToPlayerEvent(attackerID: number) {
    const attacker = this.game.playerBySmallID(attackerID) as PlayerView;
    this.eventBus.emit(new GoToPlayerEvent(attacker));
  }

  private getBoatSpriteDataURL(unit: UnitView): string {
    const owner = unit.owner();
    const key = `boat-${owner.id()}`;
    const cached = this.spriteDataURLCache.get(key);
    if (cached) return cached;
    try {
      const canvas = getColoredSprite(unit, themeProvider.current());
      const dataURL = canvas.toDataURL();
      this.spriteDataURLCache.set(key, dataURL);
      return dataURL;
    } catch {
      return "";
    }
  }

  private async attackWarningOnClick(attack: AttackUpdate) {
    if (attack.aimTile !== undefined) {
      // A strike: jump to where it fell (or will fall).
      this.eventBus.emit(
        new GoToPositionEvent(
          this.game.x(attack.aimTile),
          this.game.y(attack.aimTile),
        ),
      );
      return;
    }
    const playerView = this.game.playerBySmallID(attack.attackerID);
    if (playerView !== undefined) {
      if (playerView instanceof PlayerView) {
        const attacks = await playerView.attackClusteredPositions(attack.id);
        const pos = attacks[0]?.positions[0];

        if (!pos) {
          this.emitGoToPlayerEvent(attack.attackerID);
        } else {
          this.eventBus.emit(new GoToPositionEvent(pos.x, pos.y));
        }
      }
    } else {
      this.emitGoToPlayerEvent(attack.attackerID);
    }
  }

  private handleRetaliate(attack: AttackUpdate) {
    const attacker = this.game.playerBySmallID(attack.attackerID) as PlayerView;
    if (!attacker) return;

    const myPlayer = this.game.myPlayer();
    if (!myPlayer) return;

    const counterTroops = Math.min(
      attack.troops,
      this.uiState.attackRatio * myPlayer.troops(),
    );
    this.eventBus.emit(new SendAttackIntentEvent(attacker.id(), counterTroops));
  }

  private renderIncomingAttacks() {
    if (this.incomingAttacks.length === 0) return html``;

    return this.incomingAttacks.map((attack) =>
      attack.isStrike
        ? this.renderStrike(attack)
        : html`
            <div
              class="flex items-center gap-0.5 w-full bg-gray-800/92 backdrop-blur-sm sm:rounded-lg px-1.5 py-0.5 overflow-hidden"
            >
              ${this.renderButton({
                content: html`<span class="inline-flex items-center"
                    ><img
                      src="${soldierIcon}"
                      class="h-4 w-4"
                      style="filter: brightness(0) saturate(100%) invert(27%) sepia(91%) saturate(4551%) hue-rotate(348deg) brightness(89%) contrast(97%)"
                    />↓</span
                  ><span class="ml-1">${renderTroops(attack.troops)}</span>
                  <span class="truncate ml-1"
                    >${(
                      this.game.playerBySmallID(attack.attackerID) as PlayerView
                    )?.displayName()}</span
                  >
                  ${attack.retreating
                    ? `(${translateText("events_display.retreating")}...)`
                    : ""} `,
                onClick: () => this.attackWarningOnClick(attack),
                className:
                  "text-left text-red-400 inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
                translate: false,
              })}
              ${!attack.retreating
                ? this.renderButton({
                    content: html`<img
                      src="${swordIcon}"
                      class="h-4 w-4"
                      style="filter: brightness(0) saturate(100%) invert(27%) sepia(91%) saturate(4551%) hue-rotate(348deg) brightness(89%) contrast(97%)"
                    />`,
                    onClick: () => this.handleRetaliate(attack),
                    className:
                      "ml-auto inline-flex items-center justify-center cursor-pointer bg-red-900/50 hover:bg-red-800/70 sm:rounded-lg px-1.5 py-1 border border-red-700/50",
                    translate: false,
                  })
                : ""}
            </div>
          `,
    );
  }

  // A Dark Star strike (H17): the Hegemon's bubble borders us, so the
  // ordinary attack order is the counter-attack — the engine costs bubble
  // tiles to the strike's own troops.
  // Seconds until a strike in flight lands; null once it has.
  private landingIn(attack: AttackUpdate): number | null {
    if (attack.landsAtTick === undefined) return null;
    return Math.max(
      0,
      Math.ceil((attack.landsAtTick - this.game.ticks()) / 10),
    );
  }

  private renderStrike(attack: AttackUpdate) {
    const landing = this.landingIn(attack);
    return html`
      <div
        class="flex items-center gap-1 w-full bg-purple-950/92 backdrop-blur-sm sm:rounded-lg px-1.5 py-1 overflow-hidden border border-purple-500/70"
      >
        ${this.renderButton({
          content: html`<span class="font-bold whitespace-nowrap"
              >${translateText("dark_star.strike_label")}
              ${renderTroops(attack.troops)}</span
            >
            <span class="text-xs whitespace-nowrap text-purple-300"
              >${landing !== null
                ? translateText("dark_star.strike_inbound_hint", {
                    seconds: landing,
                  })
                : attack.retreating
                  ? `${translateText("events_display.retreating")}...`
                  : translateText("dark_star.strike_hint")}</span
            >`,
          onClick: () => this.attackWarningOnClick(attack),
          className: "text-left text-purple-200 flex flex-col min-w-0",
          translate: false,
        })}
        ${attack.retreating || landing !== null
          ? ""
          : this.renderButton({
              content: translateText("dark_star.strike_counter"),
              onClick: () => this.handleRetaliate(attack),
              className:
                "ml-auto cursor-pointer font-bold text-white bg-green-700/80 hover:bg-green-600 sm:rounded-lg px-2 py-1 border border-green-400/70 whitespace-nowrap",
              translate: false,
            })}
      </div>
    `;
  }

  // The Hegemon's own strike (H8): where it is, what it is doing, and Recall
  // (the ordinary cancel-attack order; in flight the troops come home whole,
  // on the ground the engine's retreat malus applies).
  private renderOutgoingStrike(attack: AttackUpdate) {
    const landing = this.landingIn(attack);
    const target = this.game.playerBySmallID(attack.targetID) as
      | PlayerView
      | undefined;
    const status = attack.retreating
      ? `${translateText("events_display.retreating")}...`
      : landing !== null
        ? translateText("dark_star.strike_landing", { seconds: landing })
        : translateText("dark_star.strike_razing");
    return html`
      <div
        class="flex items-center gap-1 w-full bg-purple-950/92 backdrop-blur-sm sm:rounded-lg px-1.5 py-1 overflow-hidden border border-purple-500/70"
      >
        ${this.renderButton({
          content: html`<span class="font-bold whitespace-nowrap"
              >${translateText("dark_star.strike_outgoing", {
                name: target?.displayName() ?? "",
              })}
              ${renderTroops(attack.troops)}</span
            >
            <span class="text-xs whitespace-nowrap text-purple-300"
              >${status}</span
            >`,
          onClick: () => this.attackWarningOnClick(attack),
          className: "text-left text-purple-200 flex flex-col min-w-0",
          translate: false,
        })}
        ${attack.retreating
          ? ""
          : this.renderButton({
              content: translateText("dark_star.strike_recall"),
              onClick: () => this.emitCancelAttackIntent(attack.id),
              className:
                "ml-auto cursor-pointer font-bold text-white bg-purple-700/80 hover:bg-purple-600 sm:rounded-lg px-2 py-1 border border-purple-400/70 whitespace-nowrap",
              translate: false,
            })}
      </div>
    `;
  }

  private renderOutgoingAttacks() {
    if (this.outgoingAttacks.length === 0) return html``;

    return this.outgoingAttacks.map((attack) =>
      attack.isStrike
        ? this.renderOutgoingStrike(attack)
        : html`
            <div
              class="flex items-center gap-0.5 w-full bg-gray-800/92 backdrop-blur-sm sm:rounded-lg px-1.5 py-0.5 overflow-hidden"
            >
              ${this.renderButton({
                content: html`<span class="inline-flex items-center"
                    ><img
                      src="${soldierIcon}"
                      class="h-4 w-4"
                      style="filter: brightness(0) saturate(100%) invert(62%) sepia(80%) saturate(500%) hue-rotate(175deg) brightness(100%)"
                    />↑</span
                  ><span class="ml-1">${renderTroops(attack.troops)}</span>
                  <span class="truncate ml-1"
                    >${(
                      this.game.playerBySmallID(attack.targetID) as PlayerView
                    )?.displayName()}</span
                  > `,
                onClick: async () => this.attackWarningOnClick(attack),
                className:
                  "text-left text-aquarius inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
                translate: false,
              })}
              ${!attack.retreating
                ? this.renderButton({
                    content: "❌",
                    onClick: () => this.emitCancelAttackIntent(attack.id),
                    className: "ml-auto text-left shrink-0",
                    disabled: attack.retreating,
                  })
                : html`<span class="ml-auto truncate text-aquarius"
                    >(${translateText("events_display.retreating")}...)</span
                  >`}
            </div>
          `,
    );
  }

  private renderOutgoingLandAttacks() {
    if (this.outgoingLandAttacks.length === 0) return html``;

    return this.outgoingLandAttacks.map(
      (landAttack) => html`
        <div
          class="flex items-center gap-0.5 w-full bg-gray-800/92 backdrop-blur-sm sm:rounded-lg px-1.5 py-0.5 overflow-hidden"
        >
          ${this.renderButton({
            content: html`<span class="inline-flex items-center"
                ><img
                  src="${soldierIcon}"
                  class="h-4 w-4"
                  style="filter: brightness(0) saturate(100%) invert(62%) sepia(80%) saturate(500%) hue-rotate(175deg) brightness(100%)"
                />↑</span
              ><span class="ml-1">${renderTroops(landAttack.troops)}</span>
              ${translateText("help_modal.ui_wilderness")}`,
            className:
              "text-left text-aquarius inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
            translate: false,
          })}
          ${!landAttack.retreating
            ? this.renderButton({
                content: "❌",
                onClick: () => this.emitCancelAttackIntent(landAttack.id),
                className: "ml-auto text-left shrink-0",
                disabled: landAttack.retreating,
              })
            : html`<span class="ml-auto truncate text-aquarius"
                >(${translateText("events_display.retreating")}...)</span
              >`}
        </div>
      `,
    );
  }

  private getBoatTargetName(boat: UnitView): string {
    const target = boat.targetTile();
    if (target === undefined) return "";
    const ownerID = this.game.ownerID(target);
    if (ownerID === 0) return translateText("help_modal.ui_wilderness");
    const player = this.game.playerBySmallID(ownerID) as PlayerView;
    return player?.displayName() ?? "";
  }

  private renderBoatIcon(boat: UnitView) {
    if (boat.type() === UnitType.Projectile) {
      return html`<img src="${stargateIcon}" class="h-4 w-4 inline-block" />`;
    }
    const dataURL = this.getBoatSpriteDataURL(boat);
    if (!dataURL) return html``;
    return html`<img
      src="${dataURL}"
      class="h-5 w-5 inline-block"
      style="image-rendering: pixelated"
    />`;
  }

  private getBoatETA(boat: UnitView): string {
    const plan = this.game.motionPlans().get(boat.id());
    if (!plan) return "";

    const planSteps = plan.path.length;
    const planTicks = planSteps * plan.ticksPerStep;
    const planEndTick = plan.startTick + planTicks;

    const remainingTicks = planEndTick - this.game.ticks();
    if (remainingTicks <= 0) return "0s";
    const remainingMs = remainingTicks * this.game.config().msPerTick();
    const remainingSeconds = Math.ceil(remainingMs / 1000);

    // e.g. return 1s, 35s, 59s, 1m, 1m1s, 1m59s, 2m, etc
    const m = Math.floor(remainingSeconds / 60); // minutes
    const s = remainingSeconds % 60; // seconds
    return (m ? `${m}m` : "") + (s ? `${s}s` : "");
  }

  private renderBoats() {
    if (this.outgoingBoats.length === 0) return html``;

    return this.outgoingBoats.map(
      (boat) => html`
        <div
          class="flex items-center gap-0.5 w-full bg-gray-800/92 backdrop-blur-sm sm:rounded-lg px-1.5 py-0.5 overflow-hidden"
        >
          ${this.renderButton({
            content: html`${this.renderBoatIcon(boat)}
              <span class="inline-block min-w-[3rem] text-right"
                >${renderTroops(boat.troops())}</span
              >
              <span class="truncate text-xs ml-1"
                >${this.getBoatTargetName(boat)}</span
              >
              <span class="text-xs ml-1 text-slate-300"
                >${this.getBoatETA(boat)}</span
              >`,
            onClick: () => this.eventBus.emit(new GoToUnitEvent(boat)),
            className:
              "text-left text-aquarius inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
            translate: false,
          })}
          ${boat.transportShipState().isRetreating
            ? html`<span class="ml-auto truncate text-aquarius"
                >(${translateText("events_display.retreating")}...)</span
              >`
            : this.renderButton({
                content: "\u274C",
                onClick: () => this.emitBoatCancelIntent(boat.id()),
                className: "ml-auto text-left shrink-0",
                disabled: boat.transportShipState().isRetreating,
              })}
        </div>
      `,
    );
  }

  private renderIncomingBoats() {
    if (this.incomingBoats.length === 0) return html``;

    return this.incomingBoats.map(
      (boat) => html`
        <div
          class="flex items-center gap-0.5 w-full bg-gray-800/92 backdrop-blur-sm sm:rounded-lg px-1.5 py-0.5 overflow-hidden"
        >
          ${this.renderButton({
            content: html`${this.renderBoatIcon(boat)}
              <span class="inline-block min-w-[3rem] text-right"
                >${renderTroops(boat.troops())}</span
              >
              <span class="truncate text-xs ml-1"
                >${boat.owner()?.displayName()}</span
              >
              <span class="text-xs ml-1 text-slate-300"
                >${this.getBoatETA(boat)}</span
              >`,
            onClick: () => this.eventBus.emit(new GoToUnitEvent(boat)),
            className:
              "text-left text-red-400 inline-flex items-center gap-0.5 lg:gap-1 min-w-0",
            translate: false,
          })}
        </div>
      `,
    );
  }

  render() {
    if (!this.active || !this._isVisible) {
      return html``;
    }

    const hasAnything =
      this.outgoingAttacks.length > 0 ||
      this.outgoingLandAttacks.length > 0 ||
      this.outgoingBoats.length > 0 ||
      this.incomingAttacks.length > 0 ||
      this.incomingBoats.length > 0;

    if (!hasAnything) {
      return html``;
    }

    return html`
      <div
        class="w-full mb-1 mt-1 sm:mt-0 pointer-events-auto grid grid-cols-2 gap-1 text-white text-sm lg:text-base max-h-[7rem] overflow-y-auto"
      >
        ${this.renderOutgoingAttacks()} ${this.renderOutgoingLandAttacks()}
        ${this.renderBoats()} ${this.renderIncomingAttacks()}
        ${this.renderIncomingBoats()}
      </div>
    `;
  }
}
