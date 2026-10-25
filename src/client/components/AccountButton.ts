import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../../core/ApiSchemas";
import { assetUrl } from "../../core/AssetUrls";
import { invalidateUserMe } from "../Api";
import { logOut, userAuth } from "../Auth";
import { showInGameAlert } from "../InGameModal";
import {
  loadSignInProviders,
  providerIcon,
  providerLabel,
  signInProviders,
  startSignInWith,
  userIcon,
} from "../SignIn";
import { translateText } from "../Utils";

/**
 * The Sign in button and the account panel (docs/DarkStar-Accounts.md §9,
 * accounts step B2). Signed out, it offers the providers; signed in, it shows
 * the account name and opens a small panel with the numbers (reigns,
 * longest reign, B4/B5), links to the leaderboard page and to the settings
 * page's Account tab (where the account can be deleted, A17), sign out and
 * sign out everywhere; rename comes with B6.
 *
 * Sign-in is a page navigation (SignIn.ts): the browser goes to the API's
 * login route, from there to the provider, and comes back to this page with
 * the refresh cookie set. Main then runs its normal startup path (userAuth,
 * getUserMe) and dispatches userMeResponse, which this listens for, so there
 * is no sign-in state of its own to keep.
 */
@customElement("account-button")
export class AccountButton extends LitElement {
  @state() private userMe: UserMeResponse | false | null = null;
  @state() private provider: string | null = null;
  @state() private open = false;
  @state() private busy = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener("userMeResponse", this.onUserMe);
    document.addEventListener("session-cleared", this.onSessionCleared);
    document.addEventListener("pointerdown", this.onDocumentPointerDown, {
      capture: true,
    });
    this.noticeFailedSignIn();
    void loadSignInProviders().then(() => this.requestUpdate());
  }

  disconnectedCallback() {
    document.removeEventListener("userMeResponse", this.onUserMe);
    document.removeEventListener("session-cleared", this.onSessionCleared);
    document.removeEventListener("pointerdown", this.onDocumentPointerDown, {
      capture: true,
    });
    super.disconnectedCallback();
  }

  private onUserMe = (event: Event) => {
    this.userMe = (event as CustomEvent).detail as UserMeResponse | false;
    this.open = false;
    if (this.userMe === false) {
      this.provider = null;
      return;
    }
    void userAuth(false).then((auth) => {
      this.provider = auth === false ? null : (auth.claims.provider ?? null);
    });
  };

  private onSessionCleared = () => {
    this.userMe = false;
    this.provider = null;
    this.open = false;
  };

  private onDocumentPointerDown = (e: Event) => {
    if (!this.open) return;
    if (e.target instanceof Node && this.contains(e.target)) return;
    this.open = false;
  };

  // The API sends the browser back with #signin=failed when a sign-in did
  // not complete (AuthRoutes.SIGN_IN_FAILED_FRAGMENT). Say so once and clear
  // it, so a reload does not say it again.
  private noticeFailedSignIn() {
    if (!window.location.hash.includes("signin=failed")) return;
    history.replaceState(
      null,
      "",
      window.location.pathname + window.location.search,
    );
    void showInGameAlert(translateText("account.sign_in_failed"));
  }

  // The leaderboard page, from either menu (it reads with or without an
  // account).
  private openLeaderboard() {
    this.open = false;
    window.showPage?.("page-leaderboard");
  }

  // The settings page's Account tab: sign out and delete the account (A17).
  private openAccountSettings() {
    this.open = false;
    const settings = document.getElementById("page-settings") as
      | (HTMLElement & { open(args?: Record<string, unknown>): void })
      | null;
    settings?.open({ tab: "account" });
  }

  private async signOut(everywhere: boolean) {
    if (this.busy) return;
    this.busy = true;
    try {
      await logOut(everywhere);
    } finally {
      // Whatever the API said, the local session is gone (logOut clears it
      // in its finally); the profile cache must not outlive it.
      invalidateUserMe();
      this.busy = false;
      this.open = false;
    }
  }

  private toggle = () => {
    this.open = !this.open;
  };

  render(): TemplateResult {
    const signedIn = this.userMe !== false && this.userMe !== null;
    return html`
      <div class="relative h-full shrink-0">
        ${signedIn ? this.renderAccountTrigger() : this.renderSignInTrigger()}
        ${this.open
          ? signedIn
            ? this.renderAccountPanel()
            : this.renderSignInMenu()
          : nothing}
      </div>
    `;
  }

  private triggerClass(): string {
    return (
      "flex h-full max-h-[44px] items-center gap-2 rounded-lg border px-3 " +
      "text-sm font-semibold uppercase tracking-wider transition-colors " +
      "cursor-pointer select-none focus-visible:outline-none " +
      "focus-visible:ring-2 focus-visible:ring-malibu-blue/60 " +
      (this.open
        ? "border-malibu-blue/80 bg-malibu-blue/20 text-white"
        : "border-malibu-blue/50 bg-malibu-blue/10 text-white/90 hover:border-malibu-blue/80 hover:bg-malibu-blue/20")
    );
  }

  // Tom's pixel-art Sign in button (branding/images/btn-sign-in.svg,
  // 2026-10-10): the label is drawn into the image, so the translation is its
  // alt text. 38px is an exact 2x of its 19-unit height. The signed-in
  // trigger below keeps the plain style: it shows the account name.
  private renderSignInTrigger(): TemplateResult {
    return html`
      <button
        type="button"
        id="account-sign-in"
        class="relative flex h-full items-center cursor-pointer select-none rounded-sm transition-all duration-200 hover:brightness-[1.12] active:brightness-[0.95] hover:drop-shadow-[0_0_12px_rgba(168,85,247,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malibu-blue/60 ${this
          .open
          ? "brightness-[1.12] drop-shadow-[0_0_12px_rgba(168,85,247,0.45)]"
          : ""}"
        aria-haspopup="menu"
        aria-expanded=${this.open ? "true" : "false"}
        title=${translateText("account.sign_in")}
        @click=${this.toggle}
      >
        <img
          src=${assetUrl("images/btn-sign-in.svg")}
          alt=${translateText("account.sign_in")}
          class="h-[38px] max-h-full w-auto object-contain"
          draggable="false"
        />
      </button>
    `;
  }

  private renderAccountTrigger(): TemplateResult {
    const me = this.userMe as UserMeResponse;
    const name = me.player.username ?? "";
    return html`
      <button
        type="button"
        id="account-trigger"
        class=${this.triggerClass()}
        aria-haspopup="dialog"
        aria-expanded=${this.open ? "true" : "false"}
        title=${translateText("account.panel_title")}
        @click=${this.toggle}
      >
        ${userIcon()}
        <span
          class="max-w-[9rem] truncate normal-case tracking-normal text-base"
          >${name}</span
        >
      </button>
    `;
  }

  private panelClass(): string {
    return (
      "absolute right-0 top-full z-50 mt-1.5 w-[17rem] max-w-[85vw] rounded-xl " +
      "border border-white/15 bg-surface/95 p-1.5 shadow-xl backdrop-blur-md"
    );
  }

  private itemClass(): string {
    return (
      "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm " +
      "font-medium text-white/90 transition-colors cursor-pointer " +
      "hover:bg-white/10 disabled:opacity-50 disabled:cursor-default"
    );
  }

  private renderSignInMenu(): TemplateResult {
    return html`
      <div id="account-sign-in-menu" role="menu" class=${this.panelClass()}>
        <div
          class="px-3 pt-1 pb-1.5 text-[11px] font-bold uppercase tracking-wider text-white/40"
        >
          ${translateText("account.sign_in_with")}
        </div>
        ${signInProviders().map(
          (provider) =>
            html`<button
              type="button"
              role="menuitem"
              class=${this.itemClass()}
              data-provider=${provider}
              @click=${() => startSignInWith(provider)}
            >
              ${providerIcon(provider)}
              <span>${providerLabel(provider)}</span>
            </button>`,
        )}
        <p class="px-3 pt-2 pb-1 text-xs text-white/50">
          ${translateText("account.sign_in_why")}
        </p>
        <div class="my-1 h-px bg-white/10"></div>
        <button
          type="button"
          role="menuitem"
          class=${this.itemClass()}
          data-leaderboard
          @click=${() => this.openLeaderboard()}
        >
          ${translateText("account.view_leaderboard")}
        </button>
      </div>
    `;
  }

  private renderAccountPanel(): TemplateResult {
    const me = this.userMe as UserMeResponse;
    const providerKey =
      this.provider === "discord"
        ? "account.provider_discord"
        : this.provider === "google"
          ? "account.provider_google"
          : this.provider === "dev"
            ? "account.provider_dev"
            : null;
    return html`
      <div
        id="account-panel"
        role="dialog"
        aria-labelledby="account-trigger"
        class=${this.panelClass()}
      >
        <div class="px-3 pt-2 pb-1">
          <div class="truncate text-base font-semibold text-white">
            ${me.player.username ?? ""}
          </div>
          ${providerKey !== null
            ? html`<div class="text-xs text-white/50">
                ${translateText("account.signed_in_with", {
                  provider: translateText(providerKey),
                })}
              </div>`
            : nothing}
          ${me.ban
            ? html`<div class="mt-1 text-xs text-red-300">
                ${translateText("account.banned")}
              </div>`
            : nothing}
        </div>
        ${this.renderNumbers(me)}
        <div class="my-1 h-px bg-white/10"></div>
        <button
          type="button"
          class=${this.itemClass()}
          data-leaderboard
          @click=${() => this.openLeaderboard()}
        >
          ${translateText("account.view_leaderboard")}
        </button>
        <button
          type="button"
          class=${this.itemClass()}
          data-account-settings
          @click=${() => this.openAccountSettings()}
        >
          ${translateText("account.account_settings")}
        </button>
        <button
          type="button"
          class=${this.itemClass()}
          ?disabled=${this.busy}
          @click=${() => this.signOut(false)}
        >
          ${translateText("account.sign_out")}
        </button>
        <button
          type="button"
          class=${this.itemClass()}
          ?disabled=${this.busy}
          title=${translateText("account.sign_out_everywhere_hint")}
          @click=${() => this.signOut(true)}
        >
          ${translateText("account.sign_out_everywhere")}
        </button>
      </div>
    `;
  }

  // The account's numbers (Accounts §6): victories, reigns and longest reign
  // as the leaderboard shows them, the rounds played beneath. An API without
  // the results ingest sends none, and the panel says the numbers are still
  // to come.
  private renderNumbers(me: UserMeResponse): TemplateResult {
    const n = me.player.record;
    if (n === undefined) {
      return html`<p class="px-3 pb-2 text-xs text-white/50">
        ${translateText("account.numbers_soon")}
      </p>`;
    }
    const figure = (value: number, label: string) => html`
      <div>
        <div class="text-lg font-semibold leading-tight text-white">
          ${value}
        </div>
        <div class="text-[11px] uppercase tracking-wider text-white/50">
          ${label}
        </div>
      </div>
    `;
    return html`
      <div id="account-numbers" class="px-3 pb-2">
        <div class="flex gap-4">
          ${figure(n.victories, translateText("account.victories"))}
          ${figure(n.reigns, translateText("account.reigns"))}
          ${figure(n.longestReign, translateText("account.longest_reign"))}
        </div>
        <div class="mt-1 text-xs text-white/50">
          ${translateText("account.rounds_played", { played: n.gamesPlayed })}
        </div>
      </div>
    `;
  }
}
