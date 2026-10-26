import { assetUrl } from "../../../core/AssetUrls";
import { Config } from "../../../core/configuration/Config";
import {
  AllPlayers,
  BuildableAttacks,
  bulkCost,
  maxBulkAmount,
  PlayerActions,
  PlayerBuildableUnitType,
  PlayerType,
  STRUCTURE_BULK_STEPS,
  Structures,
  UnitType,
} from "../../../core/game/Game";
import { TileRef } from "../../../core/game/GameMap";
import { Emoji, findClosestBy, flattenedEmojiTable } from "../../../core/Util";
import { UIState } from "../../UIState";
import { renderNumber, renderTroops, translateText } from "../../Utils";
import { GameView, PlayerView } from "../../view";
import { BuildItemDisplay, BuildMenu, flattenedBuildTable } from "./BuildMenu";
import { ChatIntegration } from "./ChatIntegration";
import { EmojiTable } from "./EmojiTable";
import { PlayerActionHandler } from "./PlayerActionHandler";
import { PlayerPanel } from "./PlayerPanel";
import { TooltipItem } from "./RadialMenu";

import { EventBus } from "../../../core/EventBus";
import {
  BuildUnitIntentEvent,
  GiftUnitIntentEvent,
  SendUpgradeStructureIntentEvent,
} from "../../Transport";
const allianceIcon = assetUrl("images/AllianceIconWhite.svg");
const fleetIcon = assetUrl("images/FleetIconWhite.svg");
const stargateIcon = assetUrl("images/StargateIconWhite.svg");
const buildIcon = assetUrl("images/BuildIconWhite.svg");
const chatIcon = assetUrl("images/ChatIconWhite.svg");
const donateGoldIcon = assetUrl("images/DonateGoldIconWhite.svg");
const donateTroopIcon = assetUrl("images/DonateTroopIconWhite.svg");
const emojiIcon = assetUrl("images/EmojiIconWhite.svg");
const goldCoinIcon = assetUrl("images/GoldCoinIcon.svg");
const infoIcon = assetUrl("images/InfoIcon.svg");
const swordIcon = assetUrl("images/SwordIconWhite.svg");
const targetIcon = assetUrl("images/TargetIconWhite.svg");
const traitorIcon = assetUrl("images/TraitorIconWhite.svg");
const xIcon = assetUrl("images/XIcon.svg");

export interface MenuElementParams {
  myPlayer: PlayerView;
  selected: PlayerView | null;
  tile: TileRef;
  playerActions: PlayerActions;
  game: GameView;
  buildMenu: BuildMenu;
  emojiTable: EmojiTable;
  playerActionHandler: PlayerActionHandler;
  playerPanel: PlayerPanel;
  chatIntegration: ChatIntegration;
  eventBus: EventBus;
  uiState?: UIState;
  closeMenu: () => void;
}

export interface MenuElement {
  id: string;
  name: string;
  displayed?: boolean | ((params: MenuElementParams) => boolean);
  color?: string | ((params: MenuElementParams) => string);
  icon?: string;
  text?: string;
  fontSize?: string;
  tooltipItems?: TooltipItem[];
  tooltipKeys?: TooltipKey[];

  cooldown?: (params: MenuElementParams) => number;
  disabled: (params: MenuElementParams) => boolean;
  action?: (params: MenuElementParams) => void; // For leaf items that perform actions
  subMenu?: (params: MenuElementParams) => MenuElement[]; // For non-leaf items that open submenus

  renderType?: string;

  timerFraction?: (params: MenuElementParams) => number; // 0..1, for arc timer overlay
}

export interface TooltipKey {
  key: string;
  className: string;
  params?: Record<string, string | number>;
}

export interface CenterButtonElement {
  disabled: (params: MenuElementParams) => boolean;
  action: (params: MenuElementParams) => void;
}

export const COLORS = {
  build: "#e6c74a",
  building: "#1e3a5f",
  boat: "#2a82c9",
  disabled: "#94a3b8",
  ally: "#4ade80",
  breakAlly: "#dc2626",
  breakAllyNoDebuff: "#d97706",
  delete: "#ef4444",
  info: "#475569",
  target: "#ef4444",
  attack: "#ef4444",
  strike: "#a855f7",
  punishNuclear: "#ef4444",
  punishAntimatter: "#e2e8f0",
  infoDetails: "#7f8c8d",
  infoEmoji: "#fbbf24",
  trade: "#0891b2",
  donateGold: "#f59e0b",
  tithe: "#d4a017",
  embargo: "#7c3aed",
  tooltip: {
    cost: "#f59e0b",
    count: "#94a3b8",
  },
  chat: {
    default: "#6366f1",
    help: "#22c55e",
    attack: "#ef4444",
    defend: "#3b82f6",
    greet: "#f97316",
    misc: "#a855f7",
    warnings: "#fbbf24",
  },
};

export enum Slot {
  Info = "info",
  Boat = "boat",
  Build = "build",
  Attack = "attack",
  Ally = "ally",
  Back = "back",
  Delete = "delete",
}

function isFriendlyTarget(params: MenuElementParams): boolean {
  const selectedPlayer = params.selected;
  if (selectedPlayer === null) return false;
  const isFriendly = (selectedPlayer as PlayerView).isFriendly;
  if (typeof isFriendly !== "function") return false;
  return isFriendly.call(selectedPlayer, params.myPlayer);
}

function isDisconnectedTarget(params: MenuElementParams): boolean {
  const selectedPlayer = params.selected;
  if (selectedPlayer === null) return false;
  const isDisconnected = (selectedPlayer as PlayerView).isDisconnected;
  if (typeof isDisconnected !== "function") return false;
  return isDisconnected.call(selectedPlayer);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const infoChatElement: MenuElement = {
  id: "info_chat",
  name: "chat",
  disabled: () => false,
  color: COLORS.chat.default,
  icon: chatIcon,
  subMenu: (params: MenuElementParams) =>
    params.chatIntegration
      .createQuickChatMenu(params.selected!)
      .map((item) => ({
        ...item,
        action: item.action
          ? (_params: MenuElementParams) => item.action!(params)
          : undefined,
      })),
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyTargetElement: MenuElement = {
  id: "ally_target",
  name: "target",
  disabled: (params: MenuElementParams): boolean => {
    if (params.selected === null) return true;
    return !params.playerActions.interaction?.canTarget;
  },
  color: COLORS.target,
  icon: targetIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleTargetPlayer(params.selected!.id());
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyTradeElement: MenuElement = {
  id: "ally_trade",
  name: "trade",
  disabled: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canEmbargo,
  displayed: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canEmbargo,
  color: COLORS.trade,
  text: translateText("player_panel.start_trade"),
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleEmbargo(params.selected!, "stop");
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const allyEmbargoElement: MenuElement = {
  id: "ally_embargo",
  name: "embargo",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canEmbargo,
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canEmbargo,
  color: COLORS.embargo,
  text: translateText("player_panel.stop_trade"),
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleEmbargo(params.selected!, "start");
    params.closeMenu();
  },
};

const allyRequestElement: MenuElement = {
  id: "ally_request",
  name: "request",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canSendAllianceRequest,
  displayed: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canBreakAlliance,
  color: COLORS.ally,
  icon: allianceIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleAllianceRequest(
      params.myPlayer,
      params.selected!,
    );
    params.closeMenu();
  },
};

const allyExtendElement: MenuElement = {
  id: "ally_extend",
  name: "extend",
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.allianceInfo?.inExtensionWindow,
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.allianceInfo?.canExtend,
  color: COLORS.ally,
  icon: allianceIcon,
  action: (params: MenuElementParams) => {
    if (!params.playerActions?.interaction?.allianceInfo?.canExtend) return;
    params.playerActionHandler.handleExtendAlliance(params.selected!);
    params.closeMenu();
  },
  timerFraction: (params: MenuElementParams): number => {
    const interaction = params.playerActions?.interaction;
    if (!interaction?.allianceInfo) return 1;
    const remaining = Math.max(
      0,
      interaction.allianceInfo.expiresAt - params.game.ticks(),
    );
    const extensionWindow = Math.max(
      1,
      params.game.config().allianceExtensionPromptOffset(),
    );
    return Math.max(0, Math.min(1, remaining / extensionWindow));
  },
  renderType: "allyExtend",
};

const allyBreakElement: MenuElement = {
  id: "ally_break",
  name: "break",
  disabled: (params: MenuElementParams) =>
    !params.playerActions?.interaction?.canBreakAlliance,
  displayed: (params: MenuElementParams) =>
    !!params.playerActions?.interaction?.canBreakAlliance,
  color: (params: MenuElementParams) =>
    params.selected?.isTraitor() || params.selected?.isDisconnected()
      ? COLORS.breakAllyNoDebuff
      : COLORS.breakAlly,
  icon: traitorIcon,
  action: (params: MenuElementParams) => {
    params.playerActionHandler.handleBreakAlliance(
      params.myPlayer,
      params.selected!,
    );
    params.closeMenu();
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const infoPlayerElement: MenuElement = {
  id: "info_player",
  name: "player",
  disabled: () => false,
  color: COLORS.info,
  icon: infoIcon,
  action: (params: MenuElementParams) => {
    params.playerPanel.show(params.playerActions, params.tile);
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const infoEmojiElement: MenuElement = {
  id: "info_emoji",
  name: "emoji",
  disabled: () => false,
  color: COLORS.infoEmoji,
  icon: emojiIcon,
  subMenu: (params: MenuElementParams) => {
    const emojiElements: MenuElement[] = [
      {
        id: "emoji_more",
        name: "more",
        disabled: () => false,
        color: COLORS.infoEmoji,
        icon: emojiIcon,
        action: (params: MenuElementParams) => {
          params.emojiTable.showTable((emoji) => {
            const targetPlayer =
              params.selected === params.game.myPlayer()
                ? AllPlayers
                : params.selected;
            params.playerActionHandler.handleEmoji(
              targetPlayer!,
              flattenedEmojiTable.indexOf(emoji as Emoji),
            );
            params.emojiTable.hideTable();
          });
        },
      },
    ];

    const emojiCount = 8;
    for (let i = 0; i < emojiCount; i++) {
      emojiElements.push({
        id: `emoji_${i}`,
        name: flattenedEmojiTable[i],
        text: flattenedEmojiTable[i],
        disabled: () => false,
        fontSize: "25px",
        action: (params: MenuElementParams) => {
          const targetPlayer =
            params.selected === params.game.myPlayer()
              ? AllPlayers
              : params.selected;
          params.playerActionHandler.handleEmoji(targetPlayer!, i);
          params.closeMenu();
        },
      });
    }

    return emojiElements;
  },
};

export const infoMenuElement: MenuElement = {
  id: Slot.Info,
  name: "info",
  disabled: (params: MenuElementParams) =>
    !params.selected || params.game.inSpawnPhase(),
  icon: infoIcon,
  color: COLORS.info,
  action: (params: MenuElementParams) => {
    params.playerPanel.show(params.playerActions, params.tile);
  },
};

function getAllEnabledUnits(
  myPlayer: boolean,
  config: Config,
): Set<PlayerBuildableUnitType> {
  const units: Set<PlayerBuildableUnitType> =
    new Set<PlayerBuildableUnitType>();

  const addIfEnabled = (unitType: PlayerBuildableUnitType) => {
    if (!config.isUnitDisabled(unitType)) {
      units.add(unitType);
    }
  };

  if (myPlayer) {
    Structures.types.forEach(addIfEnabled);
  } else {
    BuildableAttacks.types.forEach(addIfEnabled);
  }

  return units;
}

// "gift" (H18): the Hegemon's build submenu on a challenger's tile. The
// worker has already computed `buildableUnits` for the host with the throne
// paying, so the entries read like the host's own; only the intent differs.
function createMenuElements(
  params: MenuElementParams,
  filterType: "attack" | "build" | "gift",
  elementIdPrefix: string,
): MenuElement[] {
  const unitTypes: Set<PlayerBuildableUnitType> = getAllEnabledUnits(
    params.selected === params.myPlayer || filterType === "gift",
    params.game.config(),
  );
  const giftHost = filterType === "gift" ? params.playerActions.giftHost : null;

  return flattenedBuildTable
    .filter(
      (item) =>
        unitTypes.has(item.unitType) &&
        (filterType === "attack"
          ? BuildableAttacks.has(item.unitType)
          : !BuildableAttacks.has(item.unitType)),
    )
    .map((item: BuildItemDisplay) => {
      return {
        id: `${elementIdPrefix}_${item.unitType}`,
        name: item.key
          ? item.key.replace("unit_type.", "")
          : item.unitType.toString(),
        disabled: (p: MenuElementParams) =>
          !p.buildMenu.canBuildOrUpgrade(item),
        color: (p: MenuElementParams) =>
          p.buildMenu.canBuildOrUpgrade(item)
            ? filterType === "attack"
              ? COLORS.attack
              : COLORS.building
            : COLORS.building,
        icon: item.icon,
        tooltipItems: [
          { text: translateText(item.key ?? ""), className: "title" },
          {
            text: translateText(item.description ?? ""),
            className: "description",
          },
          {
            text: `${renderNumber(params.buildMenu.cost(item))} ${translateText("player_panel.gold")}`,
            className: "cost",
          },
          item.countable
            ? {
                // A gift counts the host's structures, not the throne's.
                text: `${
                  giftHost
                    ? (params.selected?.totalUnitLevels(item.unitType) ?? 0)
                    : params.buildMenu.count(item)
                }x`,
                className: "count",
              }
            : null,
        ].filter(
          (tooltipItem): tooltipItem is TooltipItem => tooltipItem !== null,
        ),
        subMenu: (params: MenuElementParams) => {
          const buildableUnit = params.playerActions.buildableUnits.find(
            (bu) => bu.type === item.unitType,
          );
          if (!buildableUnit) {
            return [];
          }
          // Bulk buys are for structure upgrades only. Warheads always go
          // one at a time: a stack of bombs on one tile all land on the same
          // spot, so buying several at once only wastes gold.
          if (
            buildableUnit.canUpgrade === false ||
            !params.buildMenu.canBuildOrUpgrade(item)
          ) {
            return [];
          }
          // Always four slots in fixed positions for muscle memory — laid
          // out clockwise from the top: x1, the two fixed steps, then the
          // largest amount the player can execute right now (top x1, right
          // x5, bottom x10, left xMax). max is capped by gold; slots beyond
          // it render disabled. With no executable amount past x1 there is
          // nothing to choose — return no submenu so the click falls through
          // to an immediate x1 (see action below).
          const myPlayer = params.game.myPlayer();
          const maxAmount = maxBulkAmount(
            buildableUnit,
            myPlayer?.gold() ?? 0n,
          );
          if (maxAmount <= 1) {
            return [];
          }
          const slots = [1, ...STRUCTURE_BULK_STEPS, maxAmount];
          return slots.map((amount, i) => {
            const isMaxSlot = i === slots.length - 1;
            const executable = amount <= maxAmount;
            const cost = bulkCost(buildableUnit, amount);
            return {
              id: isMaxSlot
                ? `upgrade_${item.unitType}_max`
                : `upgrade_${item.unitType}_${amount}`,
              name: translateText("build_menu.upgrade_amount", {
                amount: amount.toString(),
              }),
              text: translateText("build_menu.upgrade_amount", {
                amount: amount.toString(),
              }),
              fontSize: "20px",
              color: (p: MenuElementParams) =>
                executable && (p.game.myPlayer()?.gold() ?? 0n) >= cost
                  ? COLORS.building
                  : COLORS.disabled,
              icon: "",
              tooltipItems: [
                {
                  text: translateText("radial_menu.upgrade_x", {
                    amount: amount.toString(),
                  }),
                  className: "title",
                },
                {
                  text: `${renderNumber(cost)} ${translateText("player_panel.gold")}`,
                  className: "cost",
                },
              ],
              disabled: (p: MenuElementParams) =>
                !executable || (p.game.myPlayer()?.gold() ?? 0n) < cost,
              action: (p: MenuElementParams) => {
                if (giftHost) {
                  p.eventBus.emit(
                    new GiftUnitIntentEvent(
                      buildableUnit.type,
                      p.tile,
                      giftHost,
                      amount,
                    ),
                  );
                } else {
                  p.eventBus.emit(
                    new SendUpgradeStructureIntentEvent(
                      buildableUnit.canUpgrade as number,
                      buildableUnit.type,
                      amount,
                    ),
                  );
                }
                p.closeMenu();
              },
            };
          });
        },
        action: (params: MenuElementParams) => {
          const buildableUnit = params.playerActions.buildableUnits.find(
            (bu) => bu.type === item.unitType,
          );
          if (buildableUnit === undefined) {
            return;
          }
          if (params.buildMenu.canBuildOrUpgrade(item)) {
            if (giftHost) {
              // The sim decides between placing and upgrading (GiftExecution).
              params.eventBus.emit(
                new GiftUnitIntentEvent(
                  buildableUnit.type,
                  params.tile,
                  giftHost,
                ),
              );
            } else if (buildableUnit.canUpgrade !== false) {
              params.eventBus.emit(
                new SendUpgradeStructureIntentEvent(
                  buildableUnit.canUpgrade,
                  buildableUnit.type,
                ),
              );
            } else if (buildableUnit.canBuild !== false) {
              const rocketDirectionUp =
                item.unitType === UnitType.AtomBomb ||
                item.unitType === UnitType.HydrogenBomb
                  ? params.uiState?.rocketDirectionUp
                  : undefined;
              params.eventBus.emit(
                new BuildUnitIntentEvent(
                  buildableUnit.type,
                  params.tile,
                  rocketDirectionUp,
                ),
              );
            }
          }
          params.closeMenu();
        },
      };
    });
}

// A stargate shot (C4) at the clicked tile, offered in the stargate submenu
// whenever one of the player's gates has the tile in range; sized by the
// troop slider like a fleet. It carries the sword: the one entry in that
// menu that sends troops. The sim refuses what the tooltip cannot know
// (the Dark Star's slot and cooldown, a strike's bubble).
function gateShotMenuElement(params: MenuElementParams): MenuElement | null {
  const option = params.playerActions?.gateShot;
  if (option === undefined || params.myPlayer.isHegemon()) return null;
  const troops = Math.floor(
    (params.uiState?.attackRatio ?? 1) * params.myPlayer.troops(),
  );
  const reloading = option.readyInTicks > 0;
  const tooltipItems: TooltipItem[] = [
    {
      text: translateText("stargate.shot_tooltip", {
        troops: renderTroops(troops),
      }),
      className: "text-white font-bold",
    },
    {
      text: translateText("stargate.shot_gate", {
        level: option.level,
        range: option.range,
      }),
      className: "text-slate-300",
    },
  ];
  if (reloading) {
    tooltipItems.push({
      text: translateText("stargate.shot_reloading", {
        seconds: Math.ceil(option.readyInTicks / 10),
      }),
      className: "text-yellow-300",
    });
  }
  return {
    id: "attack_gate_shot",
    name: "gate_shot",
    icon: swordIcon,
    color: COLORS.attack,
    tooltipItems,
    disabled: () =>
      params.game.inSpawnPhase() ||
      reloading ||
      troops < 1 ||
      params.selected?.id() === params.myPlayer.id() ||
      isFriendlyTarget(params),
    action: () => {
      params.playerActionHandler.handleGateShot(params.myPlayer, params.tile);
      params.closeMenu();
    },
  };
}

// How many payers the tithe's tooltip lists by name before summing the rest.
const TITHE_PAYERS_SHOWN = 5;

// The throne's tithe (TI1, TI7): in its stargate menu, on the clicked tile.
// The tooltip shows the cooldown and who the ring would take from if it
// landed now. Null for anyone but the throne, or on the Dark Star.
function titheMenuElement(params: MenuElementParams): MenuElement | null {
  const option = params.playerActions?.tithe;
  if (option === undefined || !params.myPlayer.isHegemon()) return null;
  const tooltipItems: TooltipItem[] = [
    {
      text: translateText("tithe.tooltip"),
      className: "text-white font-bold",
    },
  ];
  if (option.readyInTicks === null) {
    tooltipItems.push({
      text: translateText("tithe.in_flight"),
      className: "text-yellow-300",
    });
  } else if (option.readyInTicks > 0) {
    tooltipItems.push({
      text: translateText("tithe.cooldown", {
        seconds: Math.ceil(option.readyInTicks / 10),
      }),
      className: "text-yellow-300",
    });
  }
  if (option.payers.length === 0) {
    tooltipItems.push({
      text: translateText("tithe.nobody"),
      className: "text-slate-300",
    });
  } else {
    const payers = [...option.payers].sort((a, b) =>
      b.gold > a.gold ? 1 : b.gold < a.gold ? -1 : 0,
    );
    for (const payer of payers.slice(0, TITHE_PAYERS_SHOWN)) {
      tooltipItems.push({
        text: translateText("tithe.payer", {
          name: payer.name,
          gold: renderNumber(payer.gold),
        }),
        className: "text-slate-300",
      });
    }
    if (payers.length > TITHE_PAYERS_SHOWN) {
      tooltipItems.push({
        text: translateText("tithe.more", {
          count: payers.length - TITHE_PAYERS_SHOWN,
        }),
        className: "text-slate-300",
      });
    }
    const total = payers.reduce((sum, p) => sum + p.gold, 0n);
    tooltipItems.push({
      text: translateText("tithe.total", { gold: renderNumber(total) }),
      className: "text-amber-300",
    });
  }
  return {
    id: "attack_tithe",
    name: "tithe",
    icon: goldCoinIcon,
    color: COLORS.tithe,
    tooltipItems,
    disabled: () => params.game.inSpawnPhase() || option.readyInTicks !== 0,
    action: () => {
      params.playerActionHandler.handleTithe(params.tile);
      params.closeMenu();
    },
  };
}

// The stargate menu (Tom, 2026-10-09): everything in it is fired from a
// gate (or, for the Hegemon, from the Dark Star itself), so the slot wears
// the gate and the gate shot inside wears the sword. The centre button
// keeps the sword for the ground attack. The throne's holds its tithe too.
export const attackMenuElement: MenuElement = {
  id: Slot.Attack,
  name: "radial_attack",
  disabled: (params: MenuElementParams) => params.game.inSpawnPhase(),
  icon: stargateIcon,
  color: COLORS.attack,

  subMenu: (params: MenuElementParams) => {
    if (params === undefined) return [];
    const items = createMenuElements(params, "attack", "attack");
    const tithe = titheMenuElement(params);
    if (tithe !== null) items.push(tithe);
    const gateShot = gateShotMenuElement(params);
    return gateShot === null ? items : [...items, gateShot];
  },
};

export const deleteUnitElement: MenuElement = {
  id: Slot.Delete,
  name: "delete",
  cooldown: (params: MenuElementParams) => params.myPlayer.deleteUnitCooldown(),
  disabled: (params: MenuElementParams) => {
    const tileOwner = params.game.owner(params.tile);
    const isLand = params.game.isLand(params.tile);

    if (!tileOwner.isPlayer() || tileOwner.id() !== params.myPlayer.id()) {
      return true;
    }

    if (!isLand) {
      return true;
    }

    if (params.game.inSpawnPhase()) {
      return true;
    }

    if (params.myPlayer.deleteUnitCooldown() > 0) {
      return true;
    }

    const DELETE_SELECTION_RADIUS = 5;
    const myUnits = params.myPlayer
      .units()
      .filter(
        (unit) =>
          !unit.isUnderConstruction() &&
          unit.markedForDeletion() === false &&
          Structures.has(unit.type()) &&
          params.game.manhattanDist(unit.tile(), params.tile) <=
            DELETE_SELECTION_RADIUS,
      );

    return myUnits.length === 0;
  },
  icon: xIcon,
  color: COLORS.delete,
  tooltipKeys: [
    {
      key: "radial_menu.delete_unit_title",
      className: "title",
    },
    {
      key: "radial_menu.delete_unit_description",
      className: "description",
    },
  ],
  action: (params: MenuElementParams) => {
    const DELETE_SELECTION_RADIUS = 5;
    const myUnits = params.myPlayer
      .units()
      .filter(
        (unit) =>
          !unit.isUnderConstruction() &&
          unit.markedForDeletion() === false &&
          Structures.has(unit.type()) &&
          params.game.manhattanDist(unit.tile(), params.tile) <=
            DELETE_SELECTION_RADIUS,
      );

    const closestUnit = findClosestBy(myUnits, (unit) =>
      params.game.manhattanDist(unit.tile(), params.tile),
    );
    if (closestUnit) {
      params.playerActionHandler.handleDeleteUnit(closestUnit.id());
    }

    params.closeMenu();
  },
};

export const buildMenuElement: MenuElement = {
  id: Slot.Build,
  name: "build",
  disabled: (params: MenuElementParams) => params.game.inSpawnPhase(),
  icon: buildIcon,
  color: COLORS.build,

  subMenu: (params: MenuElementParams) => {
    if (params === undefined) return [];
    return createMenuElements(params, "build", "build");
  },
};

// A gift (H18): the Hegemon builds on a challenger's land at its own cost
// and the host owns the result. The first item of the throne's handshake
// (GN10); shown only when the worker offered a host.
export function giftMenuElement(params: MenuElementParams): MenuElement {
  const host = params.selected;
  return {
    id: "ally_gift",
    name: "gift",
    disabled: (p: MenuElementParams) =>
      p.game.inSpawnPhase() || p.playerActions.giftHost === undefined,
    icon: buildIcon,
    color: COLORS.build,
    tooltipItems: [
      {
        text: translateText("dark_star.gift_tooltip", {
          name: host?.displayName() ?? "",
        }),
        className: "title",
      },
      {
        text: translateText("dark_star.gift_description"),
        className: "description",
      },
    ],
    subMenu: (p: MenuElementParams) => {
      if (p === undefined || p.playerActions.giftHost === undefined) return [];
      return createMenuElements(p, "gift", "gift");
    },
  };
}

// Reinforce the throne (H9, GN5): a challenger's Donate troops when the
// target is the Hegemon, who allies with nobody; it needs a gate that
// reaches the Dark Star. Sends troops sized by the attack ratio; the sim
// clamps to the room on the throne and, while someone holds the Dark Star,
// throws them into the counter-attack.
export function reinforceThroneElement(params: MenuElementParams): MenuElement {
  const throne = params.selected;
  const room =
    throne === null
      ? 0
      : Math.max(0, params.game.config().maxTroops(throne) - throne.troops());
  // Shown as sized by the slider; what is sent stops at the room left.
  const offered = Math.floor(
    (params.uiState?.attackRatio ?? 1) * params.myPlayer.troops(),
  );
  const troops = Math.min(room, offered);
  const canDonate = params.playerActions.interaction?.canDonateTroops === true;
  const invader =
    params.game.playerViews().find((p) => p.domainTilesHeld() > 0) ?? null;
  const tooltipItems: TooltipItem[] = [
    {
      text: translateText("dark_star.reinforce_tooltip", {
        troops: renderTroops(offered),
      }),
      className: "text-white font-bold",
    },
  ];
  const reach = params.playerActions.interaction?.inGateReach === true;
  if (!reach) {
    tooltipItems.push({
      text: translateText("handshake.throne_out_of_reach"),
      className: "text-red-400",
    });
  } else if (room === 0) {
    tooltipItems.push({
      text: translateText("dark_star.reinforce_full"),
      className: "text-red-400",
    });
  } else {
    tooltipItems.push({
      text: translateText("dark_star.reinforce_room", {
        troops: renderTroops(room),
      }),
      className: "text-slate-300",
    });
    if (!canDonate) {
      tooltipItems.push({
        text: translateText("dark_star.reinforce_wait"),
        className: "text-yellow-300",
      });
    }
  }
  if (invader !== null) {
    tooltipItems.push({
      text: translateText("dark_star.reinforce_counterattack", {
        name: invader.displayName(),
      }),
      className: "text-green-400",
    });
  } else {
    tooltipItems.push({
      text: translateText("dark_star.reinforce_description"),
      className: "description",
    });
  }
  return {
    id: "ally_donate_troops",
    name: "reinforce",
    icon: donateTroopIcon,
    color: COLORS.ally,
    tooltipItems,
    disabled: (p: MenuElementParams) =>
      p.game.inSpawnPhase() || !canDonate || troops < 1,
    action: (p: MenuElementParams) => {
      if (throne !== null && troops >= 1) {
        p.playerActionHandler.handleDonateTroops(throne, troops);
      }
      p.closeMenu();
    },
  };
}

// Why a transfer to the selected player is refused, for the greyed item's
// tooltip (GN8): out of reach, the lobby's toggle (between challengers,
// GN11), or the donation cooldown. Null when it is allowed.
function transferBlockReason(
  params: MenuElementParams,
  kind: "gold" | "troops",
): string | null {
  const interaction = params.playerActions.interaction;
  const allowed =
    kind === "gold"
      ? interaction?.canDonateGold === true
      : interaction?.canDonateTroops === true;
  if (allowed) return null;
  if (interaction?.inGateReach !== true) {
    return translateText("handshake.out_of_reach");
  }
  const selected = params.selected;
  const config = params.game.config();
  const toggled = kind === "gold" ? config.donateGold() : config.donateTroops();
  if (
    !toggled &&
    selected !== null &&
    !selected.isHegemon() &&
    !params.myPlayer.isHegemon() &&
    selected.type() === PlayerType.Human
  ) {
    return translateText("handshake.toggle_off");
  }
  return translateText("handshake.cooldown");
}

function reasonTooltip(title: string, reason: string | null): TooltipItem[] {
  const items: TooltipItem[] = [
    { text: title, className: "text-white font-bold" },
  ];
  if (reason !== null) items.push({ text: reason, className: "text-red-400" });
  return items;
}

// Donate troops (GN8): the troop slider's share of your troops, to anyone
// within your gates' reach (the throne reaches everyone).
function donateTroopsElement(params: MenuElementParams): MenuElement {
  const troops = Math.floor(
    (params.uiState?.attackRatio ?? 1) * params.myPlayer.troops(),
  );
  const reason = transferBlockReason(params, "troops");
  return {
    id: "ally_donate_troops",
    name: "donate_troops",
    icon: donateTroopIcon,
    color: COLORS.ally,
    tooltipItems: reasonTooltip(
      translateText("handshake.donate_troops", {
        troops: renderTroops(troops),
        name: params.selected?.displayName() ?? "",
      }),
      reason,
    ),
    disabled: (p: MenuElementParams) =>
      p.game.inSpawnPhase() || reason !== null || troops < 1,
    action: (p: MenuElementParams) => {
      if (p.selected !== null && troops >= 1) {
        p.playerActionHandler.handleDonateTroops(p.selected, troops);
      }
      p.closeMenu();
    },
  };
}

// Donate gold (GN8): opens the gold dialog.
function donateGoldElement(params: MenuElementParams): MenuElement {
  const reason = transferBlockReason(params, "gold");
  return {
    id: "ally_donate_gold",
    name: "donate_gold",
    icon: donateGoldIcon,
    color: COLORS.donateGold,
    tooltipItems: reasonTooltip(
      translateText("handshake.donate_gold", {
        name: params.selected?.displayName() ?? "",
      }),
      reason,
    ),
    disabled: (p: MenuElementParams) =>
      p.game.inSpawnPhase() || reason !== null,
    action: (p: MenuElementParams) => {
      if (p.selected === null) return;
      p.playerPanel.openSendGoldModal(p.playerActions, p.tile, p.selected);
    },
  };
}

// Propose an alliance, or extend one in its extension window (GN7: no range
// limit), with a reason when it is not available.
function allianceElement(params: MenuElementParams): MenuElement {
  const extending =
    params.playerActions.interaction?.allianceInfo?.inExtensionWindow === true;
  const base = extending ? allyExtendElement : allyRequestElement;
  const available = !base.disabled(params);
  return {
    ...base,
    displayed: true,
    tooltipItems: reasonTooltip(
      translateText(extending ? "handshake.extend" : "handshake.propose", {
        name: params.selected?.displayName() ?? "",
      }),
      available ? null : translateText("handshake.proposal_unavailable"),
    ),
  };
}

// The handshake (GN8, GN10): the ally slot opens Donate troops, Donate gold
// and, between challengers, Propose alliance (or Extend). For the throne it
// opens Gift (when the worker offered a host), Donate troops and Donate
// gold; on the Hegemon, a challenger's Donate troops is the reinforcement.
export function handshakeMenuElement(params: MenuElementParams): MenuElement {
  return {
    id: Slot.Ally,
    name: "handshake",
    icon: allianceIcon,
    color: COLORS.ally,
    tooltipItems: [
      {
        text: translateText("handshake.title", {
          name: params.selected?.displayName() ?? "",
        }),
        className: "title",
      },
    ],
    disabled: (p: MenuElementParams) => p.game.inSpawnPhase(),
    subMenu: (p: MenuElementParams) => {
      if (p === undefined) return [];
      if (p.myPlayer.isHegemon()) {
        return [
          ...(p.playerActions.giftHost !== undefined
            ? [giftMenuElement(p)]
            : []),
          donateTroopsElement(p),
          donateGoldElement(p),
        ];
      }
      if (p.selected?.isHegemon()) {
        return [reinforceThroneElement(p), donateGoldElement(p)];
      }
      return [donateTroopsElement(p), donateGoldElement(p), allianceElement(p)];
    },
  };
}

export const boatMenuElement: MenuElement = {
  id: Slot.Boat,
  name: "boat",
  disabled: (params: MenuElementParams) =>
    !params.playerActions.buildableUnits.some(
      (unit) => unit.type === UnitType.TransportShip && unit.canBuild,
    ),
  icon: fleetIcon,
  color: COLORS.boat,

  action: async (params: MenuElementParams) => {
    params.playerActionHandler.handleBoatAttack(params.myPlayer, params.tile);

    params.closeMenu();
  },
};

// The Hegemon's strike (H8, H16): aimed at any challenger tile beyond the
// Dark Star, sized by the troop slider, no fleet. Built per opening so the
// tooltip can show the tyranny cost for this target.
export function strikeMenuElement(params: MenuElementParams): MenuElement {
  const owner = params.game.owner(params.tile);
  const target = owner.isPlayer() ? (owner as PlayerView) : null;
  const inDarkStar = params.game.isInDarkStar(params.tile);
  let tyranny: number | null = null;
  let busy = false;
  if (target !== null && !inDarkStar) {
    tyranny = params.game
      .config()
      .hegemonTyrannyLossPercent(
        target.numTilesOwned() - target.domainTilesHeld(),
      );
    busy = params.myPlayer
      .outgoingAttacks()
      .some((a) => a.isStrike && a.targetID === target.smallID());
  }
  const troops = Math.floor(
    (params.uiState?.attackRatio ?? 1) * params.myPlayer.troops(),
  );
  const tooltipItems: TooltipItem[] = [];
  if (target !== null && !inDarkStar) {
    tooltipItems.push({
      text: translateText("dark_star.strike_tooltip", {
        name: target.displayName(),
        troops: renderTroops(troops),
      }),
      className: "text-white font-bold",
    });
    if (busy) {
      tooltipItems.push({
        text: translateText("dark_star.strike_busy"),
        className: "text-yellow-300",
      });
    } else if (tyranny === null) {
      tooltipItems.push({
        text: translateText("dark_star.strike_tyranny_immune"),
        className: "text-red-400",
      });
    } else if (tyranny > 100) {
      tooltipItems.push({
        text: translateText("dark_star.strike_tyranny_cost", {
          mult: tyranny > 9900 ? "99+" : (tyranny / 100).toFixed(1),
        }),
        className: "text-orange-300",
      });
    } else {
      tooltipItems.push({
        text: translateText("dark_star.strike_tyranny_free"),
        className: "text-green-400",
      });
    }
  }
  return {
    id: Slot.Boat,
    name: "strike",
    icon: targetIcon,
    color: COLORS.strike,
    tooltipItems,
    disabled: () =>
      params.game.inSpawnPhase() ||
      target === null ||
      target.id() === params.myPlayer.id() ||
      inDarkStar ||
      tyranny === null ||
      busy ||
      troops < 1,
    action: () => {
      params.playerActionHandler.handleStrike(params.myPlayer, params.tile);
      params.closeMenu();
    },
  };
}

// A punitive strike (H19): the Hegemon answers a flagged silo. Takes the
// attack slot on that silo's tile (the throne attacks nothing beyond the
// Dark Star), coloured for the warhead that flagged it, and shown only
// while the worker offers the option: a live flag and no strike on the
// owner. The levy is the galaxy's, so there is no troop slider.
export function punishMenuElement(params: MenuElementParams): MenuElement {
  const option = params.playerActions.punitiveStrike!;
  // The silo the click meant may sit a few tiles from the clicked tile.
  const owner = params.game.owner(option.siloTile);
  const target = owner.isPlayer() ? (owner as PlayerView) : null;
  const antimatter = option.warhead === UnitType.HydrogenBomb;
  const seconds = Math.max(
    0,
    Math.ceil((option.expiresTick - params.game.ticks()) / 10),
  );
  return {
    id: Slot.Attack,
    name: "punish",
    icon: targetIcon,
    color: antimatter ? COLORS.punishAntimatter : COLORS.punishNuclear,
    tooltipItems: [
      {
        text: translateText("dark_star.punish_tooltip", {
          name: target?.displayName() ?? "",
          warhead: translateText(
            antimatter ? "dark_star.warhead_grb" : "dark_star.warhead_reaction",
          ),
        }),
        className: "text-white font-bold",
      },
      {
        text: translateText("dark_star.punish_levy", {
          percent: option.levyPercent,
          troops: renderTroops(option.levyTroops),
        }),
        className: antimatter ? "text-slate-100" : "text-red-300",
      },
      {
        text: translateText("dark_star.punish_expires", { seconds }),
        className: "text-yellow-300",
      },
      {
        text: translateText("dark_star.punish_description"),
        className: "description",
      },
    ],
    disabled: () =>
      params.game.inSpawnPhase() || target === null || seconds <= 0,
    action: () => {
      params.playerActionHandler.handlePunitiveStrike(option.siloTile);
      params.closeMenu();
    },
  };
}

export const centerButtonElement: CenterButtonElement = {
  disabled: (params: MenuElementParams): boolean => {
    const tileOwner = params.game.owner(params.tile);
    const isLand = params.game.isLand(params.tile);
    if (!isLand) {
      return true;
    }
    if (params.game.inSpawnPhase()) {
      if (params.game.config().isRandomSpawn()) {
        return true;
      }
      if (tileOwner.isPlayer()) {
        return true;
      }
      return false;
    }

    // Always the ground attack (GN9): donations live in the handshake.
    return !params.playerActions.canAttack;
  },
  action: (params: MenuElementParams) => {
    if (params.game.inSpawnPhase()) {
      // The throne has no spawn to place.
      if (!params.myPlayer.isHegemon()) {
        params.playerActionHandler.handleSpawn(params.tile);
      }
    } else {
      params.playerActionHandler.handleAttack(
        params.myPlayer,
        params.selected?.id() ?? null,
      );
    }
    params.closeMenu();
  },
};

export const rootMenuElement: MenuElement = {
  id: "root",
  name: "root",
  disabled: () => false,
  icon: infoIcon,
  color: COLORS.info,
  subMenu: (params: MenuElementParams) => {
    const isAllied = params.selected?.isAlliedWith(params.myPlayer);
    const isDisconnected = isDisconnectedTarget(params);

    const tileOwner = params.game.owner(params.tile);
    const isOwnTerritory =
      tileOwner.isPlayer() &&
      (tileOwner as PlayerView).id() === params.myPlayer.id();

    const menuItems: (MenuElement | null)[] = [
      infoMenuElement,
      ...(isOwnTerritory
        ? [deleteUnitElement, allyRequestElement, buildMenuElement]
        : [
            // The Hegemon sends no fleets: its boat slot is the strike (H8).
            params.myPlayer.isHegemon()
              ? strikeMenuElement(params)
              : isAllied && !isDisconnected
                ? allyBreakElement
                : boatMenuElement,
            // The handshake: every transfer, the gift and the alliance
            // (GN8-GN10).
            handshakeMenuElement(params),
            // A flagged silo (H19): the throne's attack slot is Punish;
            // otherwise always the stargate menu (GN9).
            params.playerActions.punitiveStrike !== undefined &&
            params.myPlayer.isHegemon()
              ? punishMenuElement(params)
              : attackMenuElement,
          ]),
    ];

    return menuItems.filter((item): item is MenuElement => item !== null);
  },
};
