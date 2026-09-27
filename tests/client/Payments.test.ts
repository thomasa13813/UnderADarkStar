import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/client/Api", () => ({
  createPaymentsCheckout: vi.fn(),
  finalizeSteamOrder: vi.fn(),
  invalidateUserMe: vi.fn(),
}));

vi.mock("../../src/client/Utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../src/client/Utils")>()),
  translateText: vi.fn((key: string) => key),
}));

import type { PaymentsCheckoutResult } from "../../src/client/Api";
import {
  createPaymentsCheckout,
  finalizeSteamOrder,
  invalidateUserMe,
} from "../../src/client/Api";
import {
  classifyPurchaseReturn,
  drainPendingSteamAuthorizations,
  paymentsProvider,
  purchaseOutcomeMessage,
  reportPendingSteamAuthorizations,
  startPurchase,
  steamMicroTxn,
} from "../../src/client/Payments";
import { translateText } from "../../src/client/Utils";

const checkoutMock = createPaymentsCheckout as unknown as ReturnType<
  typeof vi.fn
>;
const finalizeMock = finalizeSteamOrder as unknown as ReturnType<typeof vi.fn>;

function okRedirect(url: string): PaymentsCheckoutResult {
  return {
    ok: true,
    data: {
      orderId: "1234",
      provider: "stripe",
      kind: "currency_pack",
      handoff: "redirect",
      redirectUrl: url,
      clientSecret: null,
      expiresAt: null,
    },
  };
}

const PACK: Parameters<typeof startPurchase>[0] = {
  kind: "currency_pack",
  packName: "starter_pack",
};

let navigate: ReturnType<typeof vi.fn<(url: string) => void>>;

beforeEach(() => {
  navigate = vi.fn();
  checkoutMock.mockReset();
  finalizeMock.mockReset();
  vi.mocked(invalidateUserMe).mockClear();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("paymentsProvider", () => {
  it("is stripe on the plain web build", () => {
    expect(paymentsProvider()).toBe("stripe");
  });
});

describe("steamMicroTxn", () => {
  it("is null on the web", () => {
    expect(steamMicroTxn()).toBeNull();
  });
});

// The main process parks authorizations in a queue and its "something
// arrived" nudge is contentless: if that nudge fires before any window exists,
// nobody hears it and the authorization sits parked. subscribe() alone will
// never surface it, so draining at mount is REQUIRED, not an optimisation.
describe("drainPendingSteamAuthorizations", () => {
  it("returns nothing without a bridge", async () => {
    await expect(drainPendingSteamAuthorizations()).resolves.toEqual([]);
  });
});

// An authorization carries only Steam's own order id, so an approval drained
// at mount cannot be finalized -- we no longer hold the internal order id it
// belongs to. It is still real, and the server sweeper settles it, so the
// player is told it is processing rather than left with silence.
describe("reportPendingSteamAuthorizations", () => {
  let stopListening: (() => void) | undefined;
  afterEach(() => {
    stopListening?.();
    stopListening = undefined;
  });

  function toasts() {
    const seen: string[] = [];
    const onToast = (e: Event) => seen.push((e as CustomEvent).detail.message);
    window.addEventListener("show-message", onToast);
    stopListening = () => window.removeEventListener("show-message", onToast);
    return seen;
  }

  it("says nothing when the queue is empty", async () => {
    const seen = toasts();

    expect(await reportPendingSteamAuthorizations()).toBe(false);
    expect(seen).toEqual([]);
  });

  it("is silent and harmless on the web", async () => {
    expect(await reportPendingSteamAuthorizations()).toBe(false);
  });
});

describe("startPurchase — redirect handoff", () => {
  it("navigates to redirectUrl verbatim", async () => {
    const url = "https://checkout.stripe.com/c/pay/cs_test_a1?x=1&y=2#frag";
    checkoutMock.mockResolvedValue(okRedirect(url));

    const result = await startPurchase(PACK, { navigate });

    expect(result).toEqual({ outcome: "redirecting" });
    expect(navigate).toHaveBeenCalledWith(url);
  });
});

describe("startPurchase — error mapping", () => {
  async function failWith(result: PaymentsCheckoutResult) {
    checkoutMock.mockResolvedValue(result);
    return startPurchase(PACK, { navigate });
  }

  it("shows the generic checkout failure for a client bug", async () => {
    expect(await failWith({ ok: false, code: "client_bug" })).toEqual({
      outcome: "error",
      message: "store.checkout_failed",
      refetchCatalog: false,
    });
  });

  it("asks for a catalog refetch on a stale listing", async () => {
    expect(await failWith({ ok: false, code: "listing_stale" })).toEqual({
      outcome: "error",
      message: "store.checkout_listing_stale",
      refetchCatalog: true,
    });
  });

  it("says try again later when the listing has not synced", async () => {
    expect(await failWith({ ok: false, code: "retry_later" })).toMatchObject({
      message: "store.checkout_retry_later",
    });
  });

  it("maps kind_unavailable_on_provider to its own message", async () => {
    expect(
      await failWith({
        ok: false,
        code: "kind_unavailable_on_provider",
        provider: "steam",
        kind: "custom_currency",
      }),
    ).toMatchObject({ message: "store.checkout_kind_unavailable" });
  });

  it("prompts re-auth when the rail account is missing", async () => {
    expect(
      await failWith({
        ok: false,
        code: "provider_account_required",
        provider: "steam",
      }),
    ).toMatchObject({ message: "store.checkout_reauth_required" });
    expect(translateText).toHaveBeenCalledWith(
      "store.checkout_reauth_required",
      { provider: "Steam" },
    );
  });

  it("asks the player to log in on 401", async () => {
    expect(await failWith({ ok: false, code: "unauthorized" })).toMatchObject({
      message: "store.login_required",
    });
  });

  // The server's message names the rail, so it is shown as-is rather than
  // replaced by a key that would have to re-derive it.
  it("shows the server's own text for a subscription exclusivity conflict", async () => {
    expect(
      await failWith({
        ok: false,
        code: "subscription_exclusivity",
        message: "You already subscribe through Stripe.",
        existingProvider: "stripe",
        existingTier: "supporter",
      }),
    ).toEqual({
      outcome: "error",
      message: "You already subscribe through Stripe.",
      refetchCatalog: false,
    });
  });

  it("uses the store's own copy for a tier the player already holds", async () => {
    expect(
      await failWith({
        ok: false,
        code: "already_subscribed",
        existingTier: "supporter",
      }),
    ).toEqual({
      outcome: "error",
      message: "store.already_subscribed",
      refetchCatalog: false,
    });
  });

  it("shows the server's text when the rail refuses a tier change, and names the rail without one", async () => {
    expect(
      await failWith({
        ok: false,
        code: "tier_change_unavailable_on_provider",
        provider: "steam",
        message: "Cancel it in your Steam account first.",
      }),
    ).toEqual({
      outcome: "error",
      message: "Cancel it in your Steam account first.",
      refetchCatalog: false,
    });
    expect(
      await failWith({
        ok: false,
        code: "tier_change_unavailable_on_provider",
        provider: "steam",
        message: "",
      }),
    ).toEqual({
      outcome: "error",
      message: "store.checkout_tier_change_unavailable",
      refetchCatalog: false,
    });
  });

  it("names the rail when an earlier transaction is still open", async () => {
    expect(
      await failWith({
        ok: false,
        code: "pending_provider_transaction",
        provider: "steam",
      }),
    ).toMatchObject({ message: "store.pending_provider_transaction" });
    expect(translateText).toHaveBeenCalledWith(
      "store.pending_provider_transaction",
      { provider: "Steam" },
    );
  });

  it("backs off on 429", async () => {
    expect(
      await failWith({
        ok: false,
        code: "rate_limited",
        retryAfterSeconds: 42,
      }),
    ).toMatchObject({ message: "store.checkout_rate_limited" });
  });

  it("says the rail is off on 501 rather than reporting a breakage", async () => {
    expect(
      await failWith({
        ok: false,
        code: "provider_unavailable",
        provider: "steam",
      }),
    ).toMatchObject({ message: "store.checkout_rail_unavailable" });
  });

  it("invites a retry for a retryable provider error", async () => {
    expect(
      await failWith({
        ok: false,
        code: "provider_error",
        provider: "steam",
        providerCode: "k_EResultTimeout",
        retryable: true,
      }),
    ).toMatchObject({ message: "store.checkout_retry_later" });
  });

  it("does not invite a retry for a non-retryable provider error", async () => {
    expect(
      await failWith({
        ok: false,
        code: "provider_error",
        provider: "steam",
        providerCode: "k_EResultInvalidParam",
        retryable: false,
      }),
    ).toMatchObject({ message: "store.checkout_failed" });
  });
});

describe("classifyPurchaseReturn", () => {
  it("treats status=true as success", () => {
    expect(classifyPurchaseReturn("true")).toBe("success");
  });

  // The credit lands seconds later; the order is durable and something else
  // owns it. Falling into the failure branch (the old behaviour) tells a
  // paying player their purchase failed when it did not.
  it("treats status=pending as pending, NOT as a failure", () => {
    expect(classifyPurchaseReturn("pending")).toBe("pending");
  });

  it("treats status=false as a failure", () => {
    expect(classifyPurchaseReturn("false")).toBe("failed");
  });

  // Only an EXPLICIT "false" is a failure. Anything unrecognised degrades to
  // pending, which points the player at their order history instead of
  // asserting something we do not know. Defaulting the unknown case to
  // "failed" repeats the exact bug this classifier exists to fix: if the rail
  // ever grows a fourth status value, a player whose purchase is fine would
  // be told it failed. The asymmetry is deliberate -- wrongly saying "still
  // processing" costs a little confusion, wrongly saying "failed" costs a
  // support ticket from someone who has been charged.
  it("treats a missing or unknown status as pending, not as a failure", () => {
    expect(classifyPurchaseReturn(null)).toBe("pending");
    expect(classifyPurchaseReturn("wat")).toBe("pending");
  });
});

describe("purchaseOutcomeMessage", () => {
  it("says nothing while the page is navigating away", () => {
    expect(
      purchaseOutcomeMessage({ outcome: "redirecting" }, "store.ok"),
    ).toBeNull();
  });

  it("uses the caller's success message when the purchase completed", () => {
    expect(purchaseOutcomeMessage({ outcome: "completed" }, "store.ok")).toBe(
      "store.ok",
    );
  });

  it("reassures the player that a cancelled overlay charged nothing", () => {
    expect(purchaseOutcomeMessage({ outcome: "cancelled" }, "store.ok")).toBe(
      "store.steam_overlay_cancelled",
    );
  });

  // Never "purchase failed": the order is durable and something else owns it.
  it("points a pending purchase at order history, not at a failure", () => {
    expect(purchaseOutcomeMessage({ outcome: "pending" }, "store.ok")).toBe(
      "store.purchase_pending",
    );
  });

  it("passes an error's already-resolved message straight through", () => {
    expect(
      purchaseOutcomeMessage(
        {
          outcome: "error",
          message: "You already subscribe through Stripe.",
          refetchCatalog: false,
        },
        "store.ok",
      ),
    ).toBe("You already subscribe through Stripe.");
  });
});
