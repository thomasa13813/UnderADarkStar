import { html, LitElement, TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { DISCORD_INVITE_URL } from "../CommunityLinks";
import "./SoundToggle";

/**
 * The help "?" and settings cogwheel as icon buttons. Help is a link: it opens
 * the player wiki (/wiki/, built from wiki/pages/) in a new tab, so a lobby or
 * a half-filled form on the home page survives it. The Discord mark beside it
 * opens the community server's permanent invite the same way.
 *
 * Shared by the desktop nav bar and the mobile top bar so both read as the same
 * cluster next to the profile control — they're utility affordances rather than
 * page links, which is why they've left the nav item lists. The cogwheel sits
 * last among the page links, immediately left of the profile control, and is a
 * plain page link with no auth dependency: it looks and behaves the same
 * signed in or out. The speaker (quick mute, 2026-10-25) sits immediately
 * right of the cogwheel; the power button, when it renders, after that.
 */
@customElement("nav-utility-icons")
export class NavUtilityIcons extends LitElement {
  /** Mobile trims the hit area to fit the top bar beside the logo. */
  @property({ type: String }) size: "desktop" | "mobile" = "desktop";

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this._onShowPage);
  }

  disconnectedCallback() {
    window.removeEventListener("showPage", this._onShowPage);
    super.disconnectedCallback();
  }

  // The active page drives the highlight, and Navigation only updates
  // `.nav-menu-item` classes for elements that exist at click time.
  private _onShowPage = () => {
    this.requestUpdate();
  };

  private buttonClass(): string {
    const box = this.size === "mobile" ? "w-9 h-9" : "w-10 h-10";
    return (
      `nav-menu-item flex items-center justify-center ${box} rounded-full ` +
      "text-white/70 hover:text-malibu-blue cursor-pointer transition-colors " +
      "[&.active]:text-malibu-blue"
    );
  }

  render(): TemplateResult {
    const currentPage = window.currentPageId;
    return html`
      <div class="flex items-center gap-1">
        <a
          class="${this.buttonClass()}"
          href="/wiki/"
          target="_blank"
          rel="noopener"
          data-i18n-aria-label="main.help"
          data-i18n-title="main.help"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-6 h-6 pointer-events-none"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.4-2.8 4" />
            <line x1="12" y1="17.5" x2="12.01" y2="17.5" />
          </svg>
        </a>
        <!-- The community Discord (2026-10-25), in a new tab like help. -->
        <a
          class="${this.buttonClass()}"
          href=${DISCORD_INVITE_URL}
          target="_blank"
          rel="noopener noreferrer"
          data-i18n-aria-label="main.discord"
          data-i18n-title="main.discord"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            class="w-6 h-6 pointer-events-none"
            aria-hidden="true"
          >
            <path
              d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .078-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.009c.12.099.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03ZM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418Zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418Z"
            />
          </svg>
        </a>
        <button
          class="${this.buttonClass()} ${currentPage === "page-settings"
            ? "active"
            : ""}"
          data-page="page-settings"
          data-i18n-aria-label="main.settings"
          data-i18n-title="main.settings"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="w-6 h-6 pointer-events-none"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="3" />
            <path
              d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
            />
          </svg>
        </button>
        <sound-toggle .buttonClass=${this.buttonClass()}></sound-toggle>
      </div>
    `;
  }
}
