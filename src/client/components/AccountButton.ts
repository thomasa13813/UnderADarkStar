import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { UserMeResponse } from "../../core/ApiSchemas";
import { GameEnv } from "../../core/configuration/Config";
import { invalidateUserMe } from "../Api";
import { getApiBase } from "../ApiBase";
import { logOut, userAuth } from "../Auth";
import { ClientEnv } from "../ClientEnv";
import { showInGameAlert } from "../InGameModal";
import { translateText } from "../Utils";

/**
 * The Sign in button and the account panel (docs/DarkStar-Accounts.md §9,
 * accounts step B2). Signed out, it offers the providers; signed in, it shows
 * the account name and opens a small panel with sign out and sign out
 * everywhere. The numbers (reigns, longest reign) join the panel with the
 * leaderboard (B5); rename and delete with B6.
 *
 * Sign-in is a page navigation: the browser goes to the API's login route,
 * from there to the provider, and comes back to this page with the refresh
 * cookie set. Main then runs its normal startup path (userAuth, getUserMe)
 * and dispatches userMeResponse, which this listens for, so there is no
 * sign-in state of its own to keep.
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

  private signIn(provider: string, name?: string) {
    const back = window.location.origin + window.location.pathname;
    const params = new URLSearchParams({ redirect: back });
    if (name !== undefined) params.set("name", name);
    window.location.assign(
      `${getApiBase()}/auth/login/${provider}?${params.toString()}`,
    );
  }

  private signInDev() {
    const name = window.prompt(translateText("account.dev_name_prompt"), "");
    if (name === null) return;
    this.signIn("dev", name.trim() === "" ? "Dev" : name.trim());
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

  private get isDev(): boolean {
    return ClientEnv.env() === GameEnv.Dev;
  }

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

  private renderSignInTrigger(): TemplateResult {
    return html`
      <button
        type="button"
        id="account-sign-in"
        class=${this.triggerClass()}
        aria-haspopup="menu"
        aria-expanded=${this.open ? "true" : "false"}
        title=${translateText("account.sign_in")}
        @click=${this.toggle}
      >
        ${userIcon()}
        <span class="whitespace-nowrap"
          >${translateText("account.sign_in")}</span
        >
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
        <button
          type="button"
          role="menuitem"
          class=${this.itemClass()}
          @click=${() => this.signIn("discord")}
        >
          ${discordIcon()}
          <span>${translateText("account.provider_discord")}</span>
        </button>
        ${this.isDev
          ? html`<button
              type="button"
              role="menuitem"
              class=${this.itemClass()}
              @click=${() => this.signInDev()}
            >
              ${userIcon()}
              <span>${translateText("account.provider_dev")}</span>
            </button>`
          : nothing}
        <p class="px-3 pt-2 pb-1 text-xs text-white/50">
          ${translateText("account.sign_in_why")}
        </p>
      </div>
    `;
  }

  private renderAccountPanel(): TemplateResult {
    const me = this.userMe as UserMeResponse;
    const providerKey =
      this.provider === "discord"
        ? "account.provider_discord"
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
        <p class="px-3 pb-2 text-xs text-white/50">
          ${translateText("account.numbers_soon")}
        </p>
        <div class="my-1 h-px bg-white/10"></div>
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
}

function userIcon(): TemplateResult {
  return html`<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="h-5 w-5 shrink-0 pointer-events-none"
    aria-hidden="true"
  >
    <circle cx="12" cy="8" r="4"></circle>
    <path d="M4 21a8 8 0 0 1 16 0"></path>
  </svg>`;
}

// Discord's mark, simplified to one path so it inherits the text colour.
function discordIcon(): TemplateResult {
  return html`<svg
    viewBox="0 0 24 24"
    fill="currentColor"
    class="h-5 w-5 shrink-0 pointer-events-none"
    aria-hidden="true"
  >
    <path
      d="M19.6 5.3A17 17 0 0 0 15.4 4l-.2.4a15.6 15.6 0 0 1 3.8 1.9 13.5 13.5 0 0 0-14 0A15.6 15.6 0 0 1 8.8 4.4L8.6 4a17 17 0 0 0-4.2 1.3C1.7 9.3 1 13.2 1.3 17a17 17 0 0 0 5.2 2.6l1.1-1.8a11 11 0 0 1-1.8-.9l.4-.3a12.2 12.2 0 0 0 11.6 0l.4.3c-.6.4-1.2.7-1.8.9l1.1 1.8a17 17 0 0 0 5.2-2.6c.4-4.4-.7-8.3-3.1-11.7ZM8.7 14.7c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Zm6.6 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Z"
    ></path>
  </svg>`;
}
