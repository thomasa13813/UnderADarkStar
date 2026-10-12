import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import { translateText } from "../Utils";
import "./NavUtilityIcons";

@customElement("desktop-nav-bar")
export class DesktopNavBar extends LitElement {
  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    window.addEventListener("showPage", this._onShowPage);

    const current = window.currentPageId;
    if (current) {
      // Wait for render
      this.updateComplete.then(() => {
        this._updateActiveState(current);
      });
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    window.removeEventListener("showPage", this._onShowPage);
  }

  private _onShowPage = (e: Event) => {
    const pageId = (e as CustomEvent).detail;
    this._updateActiveState(pageId);
  };

  private _updateActiveState(pageId: string) {
    this.querySelectorAll(".nav-menu-item").forEach((el) => {
      if ((el as HTMLElement).dataset.page === pageId) {
        el.classList.add("active");
      } else {
        el.classList.remove("active");
      }
    });
  }

  render() {
    window.currentPageId ??= "page-play";
    const currentPage = window.currentPageId;

    return html`
      <nav
        class="hidden lg:flex w-full bg-zinc-900/90 backdrop-blur-md items-center justify-center gap-8 py-4 shrink-0 z-50 relative"
      >
        <!-- Stacked pixel-art title (Tom's title-stacked.svg, 2026-10-08).
             No version under it (2026-10-08): the footer names the build,
             and 56px is what the old wordmark + version column measured, so
             the ribbon keeps its height. -->
        <img
          src=${assetUrl("images/TitleStacked.svg")}
          alt="Under a Dark Star"
          data-i18n-alt="main.title"
          class="h-14 w-auto object-contain select-none pointer-events-none"
          draggable="false"
        />
        <!-- Play routes home like any nav item, then hops into the throne
             shown first on the page (data-join-hero; see Navigation.ts). -->
        <!-- Tom's pixel-art Play button (branding/images/btn-play.svg,
             2026-10-10). The label is drawn into the image, so the
             translation is its alt text; data-i18n would overwrite the
             image with text on a language change, hence data-i18n-alt. The
             image is 19 units tall and 38px is an exact 2x. -->
        <button
          class="nav-menu-item ${currentPage === "page-play"
            ? "active"
            : ""} inline-flex items-center cursor-pointer select-none rounded-sm transition-all duration-200 hover:brightness-[1.12] hover:drop-shadow-[0_0_12px_rgba(168,85,247,0.45)] active:brightness-[0.95] [&.active]:brightness-[1.12] [&.active]:drop-shadow-[0_0_12px_rgba(168,85,247,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malibu-blue/60"
          data-page="page-play"
          data-join-hero
          title=${translateText("main.play")}
          data-i18n-title="main.play"
        >
          <img
            src=${assetUrl("images/btn-play.svg")}
            alt=${translateText("main.play")}
            data-i18n-alt="main.play"
            class="h-[38px] w-auto object-contain"
            draggable="false"
          />
        </button>
        <!-- The leaderboard page (Accounts doc §6): a text item until Tom
             draws it a pixel-art button like Play's. -->
        <button
          class="nav-menu-item ${currentPage === "page-leaderboard"
            ? "active"
            : ""} inline-flex items-center cursor-pointer select-none rounded-sm px-1 text-lg font-bold uppercase tracking-[0.08em] text-white/70 transition-all duration-200 hover:text-malibu-blue hover:drop-shadow-[0_0_12px_rgba(168,85,247,0.45)] [&.active]:text-malibu-blue [&.active]:drop-shadow-[0_0_12px_rgba(168,85,247,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malibu-blue/60"
          data-page="page-leaderboard"
          title=${translateText("main.leaderboard")}
          data-i18n-title="main.leaderboard"
        >
          <span data-i18n="main.leaderboard"
            >${translateText("main.leaderboard")}</span
          >
        </button>
        <!-- Utility cluster: help and settings are utility affordances rather
             than page links, so they sit behind a divider. -->
        <div class="flex items-center gap-1 pl-5 ml-1 border-l border-white/10">
          <nav-utility-icons size="desktop"></nav-utility-icons>
        </div>
      </nav>
    `;
  }
}
