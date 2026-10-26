import { vi } from "vitest";

// Keep lit and the DOM out of this unit test.
vi.mock("../../src/client/hud/layers/BuildMenu", () => ({
  BuildMenu: class {},
  flattenedBuildTable: [],
}));
vi.mock("../../src/client/Utils", () => ({
  translateText: (k: string) => k,
  renderTroops: (n: number) => String(n),
  renderNumber: (n: number) => String(n),
  getSvgAspectRatio: async () => 1,
}));

import {
  attackMenuElement,
  centerButtonElement,
  handshakeMenuElement,
  MenuElement,
  type MenuElementParams,
  rootMenuElement,
  Slot,
} from "../../src/client/hud/layers/RadialMenuElements";
import { PlayerType } from "../../src/core/game/Game";

// The handshake (docs/DarkStar-Rework.md GN8-GN10): the ally slot opens a
// submenu holding every transfer, the alliance and, for the throne, the
// gift. The centre button is always the ground attack and the attack slot
// always the stargate menu (GN9).

const player = (id: string, hegemon = false) =>
  ({
    id: () => id,
    isHegemon: () => hegemon,
    isAlliedWith: () => false,
    isFriendly: () => true,
    isTraitor: () => false,
    isDisconnected: () => false,
    displayName: () => id,
    isPlayer: () => true,
    troops: () => 10_000,
    type: () => PlayerType.Human,
  }) as any;

interface Opts {
  tithe?: {
    readyInTicks: number | null;
    payers: { name: string; gold: bigint }[];
  };
  me?: any;
  them?: any;
  canDonateGold?: boolean;
  canDonateTroops?: boolean;
  inGateReach?: boolean;
  giftHost?: string;
  donationsOn?: boolean;
}

function params(o: Opts = {}): MenuElementParams {
  const me = o.me ?? player("me");
  const them = o.them ?? player("them");
  return {
    myPlayer: me,
    selected: them,
    tile: 0 as any,
    playerActions: {
      canAttack: true,
      giftHost: o.giftHost,
      tithe: o.tithe,
      interaction: {
        canBreakAlliance: false,
        canSendAllianceRequest: true,
        canDonateGold: o.canDonateGold ?? true,
        canDonateTroops: o.canDonateTroops ?? true,
        inGateReach: o.inGateReach ?? true,
        canEmbargo: false,
      },
    } as any,
    game: {
      inSpawnPhase: () => false,
      isLand: () => true,
      owner: () => them,
      playerViews: () => [],
      isInDarkStar: () => false,
      config: () => ({
        donateGold: () => o.donationsOn ?? true,
        donateTroops: () => o.donationsOn ?? true,
        maxTroops: () => 1_000_000,
        isRandomSpawn: () => false,
        isUnitDisabled: () => false,
      }),
    } as any,
    buildMenu: {} as any,
    emojiTable: {} as any,
    playerActionHandler: {
      handleAttack: vi.fn(),
      handleDonateTroops: vi.fn(),
      handleAllianceRequest: vi.fn(),
      handleTithe: vi.fn(),
    } as any,
    playerPanel: { openSendGoldModal: vi.fn() } as any,
    chatIntegration: { createQuickChatMenu: vi.fn(() => []) } as any,
    eventBus: {} as any,
    uiState: { attackRatio: 0.5 } as any,
    closeMenu: vi.fn(),
  };
}

function slot(p: MenuElementParams, id: string): MenuElement {
  const item = rootMenuElement.subMenu!(p).find((i) => i.id === id);
  if (item === undefined) throw new Error(`no ${id} slot`);
  return item;
}

function handshake(p: MenuElementParams): MenuElement[] {
  return slot(p, Slot.Ally).subMenu!(p);
}

describe("The handshake (GN8)", () => {
  test("between challengers: Donate troops, Donate gold, Propose alliance", () => {
    const items = handshake(params());
    expect(items.map((i) => i.id)).toEqual([
      "ally_donate_troops",
      "ally_donate_gold",
      "ally_request",
    ]);
    expect(items.every((i) => !i.disabled(params()))).toBe(true);
  });

  test("Donate troops sends the slider's share", () => {
    const p = params();
    const troops = handshake(p).find((i) => i.id === "ally_donate_troops")!;
    troops.action!(p);
    expect(p.playerActionHandler.handleDonateTroops).toHaveBeenCalledWith(
      p.selected,
      5_000,
    );
  });

  test("Donate gold opens the gold dialog", () => {
    const p = params();
    handshake(p).find((i) => i.id === "ally_donate_gold")!.action!(p);
    expect(p.playerPanel.openSendGoldModal).toHaveBeenCalled();
  });

  test("out of reach: greyed, and the tooltip says why", () => {
    const p = params({
      canDonateGold: false,
      canDonateTroops: false,
      inGateReach: false,
    });
    const items = handshake(p);
    const troops = items.find((i) => i.id === "ally_donate_troops")!;
    expect(troops.disabled(p)).toBe(true);
    expect(troops.tooltipItems!.map((t) => t.text)).toContain(
      "handshake.out_of_reach",
    );
    // Alliances are not limited by range (GN7).
    expect(items.find((i) => i.id === "ally_request")!.disabled(p)).toBe(false);
  });

  test("in reach but refused: the lobby's toggle, else the cooldown", () => {
    const off = params({ canDonateGold: false, donationsOn: false });
    const gold = handshake(off).find((i) => i.id === "ally_donate_gold")!;
    expect(gold.tooltipItems!.map((t) => t.text)).toContain(
      "handshake.toggle_off",
    );
    const cooling = params({ canDonateGold: false });
    const gold2 = handshake(cooling).find((i) => i.id === "ally_donate_gold")!;
    expect(gold2.tooltipItems!.map((t) => t.text)).toContain(
      "handshake.cooldown",
    );
  });

  test("the throne's handshake: Gift, Donate army, Donate troops, Donate gold (GN10)", () => {
    // The throne's root menu is tested elsewhere (its strike slot); its ally
    // slot is this element.
    const throneHandshake = (q: MenuElementParams) =>
      handshakeMenuElement(q).subMenu!(q);
    const p = params({ me: player("throne", true), giftHost: "them" });
    expect(throneHandshake(p).map((i) => i.id)).toEqual([
      "ally_gift",
      "ally_donate_army",
      "ally_donate_troops",
      "ally_donate_gold",
    ]);
    // With no army on the host's build list, Donate army is offered but off.
    const army = throneHandshake(p).find((i) => i.id === "ally_donate_army")!;
    expect(army.disabled(p)).toBe(true);
    // No host on offer: no gift, no army.
    const q = params({ me: player("throne", true) });
    expect(throneHandshake(q).map((i) => i.id)).toEqual([
      "ally_donate_troops",
      "ally_donate_gold",
    ]);
  });

  test("on the Hegemon a challenger reinforces or sends gold, gated by reach (GN5)", () => {
    const p = params({
      them: player("throne", true),
      canDonateTroops: false,
      inGateReach: false,
    });
    const items = handshake(p);
    expect(items.map((i) => i.name)).toEqual(["reinforce", "donate_gold"]);
    expect(items[0].disabled(p)).toBe(true);
    expect(items[0].tooltipItems!.map((t) => t.text)).toContain(
      "handshake.throne_out_of_reach",
    );
  });
});

describe("The tithe in the throne's stargate menu (TI7)", () => {
  const tithe = (p: MenuElementParams) =>
    attackMenuElement.subMenu!(p).find((i) => i.id === "attack_tithe");
  const texts = (item: MenuElement | undefined) =>
    (item?.tooltipItems ?? []).map((t) => t.text);

  test("ready: who would pay, and the total; a click launches it", () => {
    const p = params({
      me: player("throne", true),
      tithe: {
        readyInTicks: 0,
        payers: [
          { name: "a", gold: 1_000_000n },
          { name: "b", gold: 3_000_000n },
        ],
      },
    });
    const item = tithe(p)!;
    expect(item.disabled(p)).toBe(false);
    expect(texts(item)).toEqual([
      "tithe.tooltip",
      "tithe.payer",
      "tithe.payer",
      "tithe.total",
    ]);
    item.action!(p);
    expect(p.playerActionHandler.handleTithe).toHaveBeenCalledWith(p.tile);
  });

  test("cooling down or in flight: greyed, and says so", () => {
    const cooling = params({
      me: player("throne", true),
      tithe: { readyInTicks: 40, payers: [] },
    });
    expect(tithe(cooling)!.disabled(cooling)).toBe(true);
    expect(texts(tithe(cooling))).toContain("tithe.cooldown");
    expect(texts(tithe(cooling))).toContain("tithe.nobody");
    const flying = params({
      me: player("throne", true),
      tithe: { readyInTicks: null, payers: [] },
    });
    expect(tithe(flying)!.disabled(flying)).toBe(true);
    expect(texts(tithe(flying))).toContain("tithe.in_flight");
  });

  test("never in a challenger's menu", () => {
    const p = params({ tithe: { readyInTicks: 0, payers: [] } });
    expect(tithe(p)).toBeUndefined();
  });
});

describe("Donating has one home (GN9)", () => {
  test("the attack slot is the stargate menu even on a friend", () => {
    expect(slot(params(), Slot.Attack)).toBe(attackMenuElement);
  });

  test("the centre button attacks, never donates", () => {
    const p = params();
    centerButtonElement.action(p);
    expect(p.playerActionHandler.handleAttack).toHaveBeenCalled();
    expect(p.playerActionHandler.handleDonateTroops).not.toHaveBeenCalled();
  });
});
