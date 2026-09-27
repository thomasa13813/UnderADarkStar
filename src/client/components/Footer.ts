import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import { currentGameVersion } from "../GameVersion";

/**
 * Public repository of this fork. The AGPL obliges us to offer players the
 * source of the server they are playing on; this link is how we do it, so it
 * must always point at the code that is actually deployed.
 */
export const SOURCE_URL = "https://github.com/thomasa13813/UnderADarkStar";

@customElement("page-footer")
export class Footer extends LitElement {
  // Per instance, not at module scope: currentGameVersion reads
  // BOOTSTRAP_CONFIG, which the server injects into the page and which is not
  // guaranteed to exist at the moment this module is first imported.
  private readonly versionLabel = currentGameVersion();

  createRenderRoot() {
    return this;
  }

  render() {
    return html`
      <footer
        class="[.in-game_&]:hidden bg-zinc-900/90 backdrop-blur-md flex flex-col items-center justify-center gap-1 pt-1 pb-3 text-white/50 w-full border-t border-white/10 shrink-0 relative z-50"
      >
        <div class="flex w-full flex-col items-center gap-1">
          <!-- Source link: the AGPL §13 offer of source to network users,
               and the licence's §7 attribution line right under it. -->
          <div
            class="flex items-center justify-center gap-4 lg:gap-6 pt-2 w-full relative"
          >
            <a
              href=${SOURCE_URL}
              target="_blank"
              rel="noopener noreferrer"
              class="flex items-center gap-2 opacity-60 hover:opacity-100 transition-all"
            >
              <img
                src=${assetUrl("icons/github-mark-white.svg")}
                alt=""
                class="h-6 w-6 lg:h-7 lg:w-7 object-contain pointer-events-none"
                draggable="false"
              />
              <span data-i18n="main.source"></span>
            </a>
          </div>
          <!-- The nav bar shows the tagged version; the full string, commit
               included, lives down here where a player can quote it in a bug
               report. -->
          <div class="footer-version text-xs mt-1 lg:mt-2 text-center px-4">
            ${this.versionLabel}
          </div>
          <div
            class="text-xs mt-1 lg:mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 text-center"
          >
            <span data-i18n="main.by_line"></span>
            <span data-i18n="main.copyright"></span>
          </div>
        </div>

        <!-- Single instance: translateText() resolves the active language via
             document.querySelector("lang-selector"), so a second one would
             shadow it. -->
        <lang-selector
          class="absolute right-4 top-3 lg:top-1/2 lg:-translate-y-1/2"
        ></lang-selector>
      </footer>
    `;
  }
}
