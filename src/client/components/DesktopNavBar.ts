import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
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
        <button
          class="nav-menu-item ${currentPage === "page-play"
            ? "active"
            : ""} text-white/70 hover:text-malibu-blue  font-medium tracking-wider uppercase cursor-pointer transition-colors [&.active]:text-malibu-blue "
          data-page="page-play"
          data-join-hero
          data-i18n="main.play"
        ></button>
        <!-- Utility cluster: help and settings are utility affordances rather
             than page links, so they sit behind a divider. -->
        <div class="flex items-center gap-1 pl-5 ml-1 border-l border-white/10">
          <nav-utility-icons size="desktop"></nav-utility-icons>
        </div>
      </nav>
    `;
  }
}
