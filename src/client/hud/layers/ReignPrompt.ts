import { html, LitElement, nothing, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { UserMeResponse } from "../../../core/ApiSchemas";
import { fetchUserMeUncached, getUserMe } from "../../Api";
import { isLoggedIn } from "../../Auth";
import {
  providerIcon,
  providerLabel,
  SignInProvider,
  signInProviders,
  startSignInWith,
} from "../../SignIn";
import { homeHref, translateText } from "../../Utils";

// Under a Dark Star: the win screen's reign prompt (docs/DarkStar-Accounts.md
// §6, accounts step B5). Shown to the player who won a public throne round.
// A guest is told their victory was not recorded and offered the sign-in
// providers (the sign-in lands on the home page: the round is over). A
// signed-in winner sees their numbers change: the game server posts the
// record once the winner vote resolves, so the account's victories are polled
// for a short while until they move, then shown with the gains marked. If
// they never move in that time (the API is down, §14), the last numbers
// read are shown without a mark.

type Numbers = NonNullable<UserMeResponse["player"]["record"]>;

export const REIGN_POLL_MS = 3000;
export const REIGN_POLL_LIMIT = 12;

@customElement("reign-prompt")
export class ReignPrompt extends LitElement {
  // True while the local player is the credited winner of a public throne
  // round; the prompt starts when it turns true.
  @property({ type: Boolean }) active = false;

  @state() private signedIn: boolean | null = null;
  @state() private providers: SignInProvider[] = [];
  @state() private baseline: Numbers | null = null;
  @state() private latest: Numbers | null = null;
  @state() private settled = false;
  private timer: number | null = null;
  private polls = 0;
  private started = false;

  createRenderRoot() {
    return this;
  }

  protected updated(): void {
    if (this.active && !this.started) {
      this.started = true;
      void this.start();
    }
  }

  disconnectedCallback() {
    this.stopPolling();
    super.disconnectedCallback();
  }

  // The prompt is an extra on the win screen: whatever goes wrong in here
  // (no account API, a page without its bootstrap config) leaves the screen
  // as it was, with no prompt.
  private async start(): Promise<void> {
    try {
      const signedIn = await isLoggedIn();
      if (!signedIn) {
        this.providers = signInProviders();
        this.signedIn = false;
        return;
      }
      const me = await getUserMe();
      this.baseline = me === false ? null : (me.player.record ?? null);
      this.signedIn = true;
      this.poll();
    } catch (error) {
      console.warn("reign prompt not shown", error);
      this.signedIn = null;
    }
  }

  private poll(): void {
    this.timer = window.setTimeout(async () => {
      this.timer = null;
      this.polls++;
      const me = await fetchUserMeUncached();
      const numbers = me === false ? null : (me.player.record ?? null);
      if (numbers !== null) this.latest = numbers;
      // The credited winner always gains a victory; the reign numbers only
      // move for a Hegemon who held the timer.
      const moved =
        numbers !== null &&
        (this.baseline === null || numbers.victories > this.baseline.victories);
      if (moved || this.polls >= REIGN_POLL_LIMIT) {
        this.settled = true;
        return;
      }
      this.poll();
    }, REIGN_POLL_MS);
  }

  private stopPolling(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private signIn(provider: SignInProvider) {
    startSignInWith(provider, {
      redirectTo: new URL(homeHref(), window.location.href).toString(),
    });
  }

  render(): TemplateResult | typeof nothing {
    if (!this.active || this.signedIn === null) return nothing;
    return html`
      <div
        class="mb-3 flex flex-col gap-2 rounded-lg border border-amber-300/40 bg-black/30 p-3"
        data-reign-prompt=${this.signedIn ? "numbers" : "sign-in"}
      >
        ${this.signedIn ? this.renderNumbers() : this.renderSignIn()}
      </div>
    `;
  }

  private renderSignIn(): TemplateResult {
    return html`
      <span class="font-bold tracking-wide text-amber-200">
        ${translateText("win_modal.reign_sign_in_title")}
      </span>
      <p class="text-xs text-white/70">
        ${translateText("win_modal.reign_sign_in_body")}
      </p>
      <div class="flex flex-wrap gap-2">
        ${this.providers.map(
          (provider) =>
            html`<button
              type="button"
              class="flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-white/20 cursor-pointer"
              data-provider=${provider}
              @click=${() => this.signIn(provider)}
            >
              ${providerIcon(provider)}
              <span
                >${translateText("win_modal.reign_sign_in_with", {
                  provider: providerLabel(provider),
                })}</span
              >
            </button>`,
        )}
      </div>
    `;
  }

  private renderNumbers(): TemplateResult {
    const shown = this.latest ?? this.baseline;
    if (!this.settled || shown === null) {
      return html`<p class="text-xs text-white/70" data-reign-recording>
        ${translateText("win_modal.reign_recording")}
      </p>`;
    }
    const up = (key: keyof Numbers) =>
      this.baseline !== null && shown[key] > this.baseline[key];
    const gained = up("victories");
    const figure = (value: number, up: boolean, label: string) => html`
      <div>
        <div class="text-lg font-semibold leading-tight text-white">
          ${value}${up
            ? html`<span class="ml-1 text-sm text-amber-300" data-reign-up
                >+1</span
              >`
            : nothing}
        </div>
        <div class="text-[11px] uppercase tracking-wider text-white/50">
          ${label}
        </div>
      </div>
    `;
    return html`
      <span class="font-bold tracking-wide text-amber-200">
        ${translateText(
          gained ? "win_modal.reign_recorded" : "win_modal.reign_pending",
        )}
      </span>
      <div class="flex gap-5" data-reign-numbers>
        ${figure(shown.victories, gained, translateText("account.victories"))}
        ${figure(shown.reigns, up("reigns"), translateText("account.reigns"))}
        ${figure(
          shown.longestReign,
          up("longestReign"),
          translateText("account.longest_reign"),
        )}
      </div>
    `;
  }
}
