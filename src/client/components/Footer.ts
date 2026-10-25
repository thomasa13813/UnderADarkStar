import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import { currentSourceUrl } from "../GameVersion";

@customElement("page-footer")
export class Footer extends LitElement {
  // The AGPL §13 offer of source, pointed at the deployed commit's tree so a
  // player reaches the code they are playing on (GameVersion.sourceUrlFor).
  // Per instance, not at module scope: it reads BOOTSTRAP_CONFIG, which the
  // server injects into the page and which is not guaranteed to exist at the
  // moment this module is first imported.
  private readonly sourceUrl = currentSourceUrl();

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
              href=${this.sourceUrl}
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
          <!-- No version line (Tom, 2026-10-25): releases are not tagged
               with enough discipline for a public version label. -->
          <div
            class="text-xs mt-1 lg:mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 px-4 text-center"
          >
            <!-- Text by-line only where the wordmark is hidden (narrow
                 screens), so the attribution is never shown twice. -->
            <span class="md:hidden" data-i18n="main.by_line"></span>
            <span data-i18n="main.copyright"></span>
            <!-- The legal pages are static files at the site root
                 (resources/public/). Google's sign-in review needs the
                 privacy policy linked from the home page. -->
            <a
              href="/terms.html"
              target="_blank"
              rel="noopener"
              class="footer-terms underline hover:text-white"
              data-i18n="main.terms"
            ></a>
            <a
              href="/privacy.html"
              target="_blank"
              rel="noopener"
              class="footer-privacy underline hover:text-white"
              data-i18n="main.privacy"
            ></a>
          </div>
        </div>

        <!-- The studio wordmark: pinned to the left edge and vertically
             centred, the mirror of the language selector on the right, and
             out of the flow so it does not add height to the centred rows.
             Hidden on narrow screens where it would run under the centred
             text; the span above carries the by-line there. It is 48px of
             pixel art (154x48 viewBox), shown at exactly 1:1 with
             image-rendering: pixelated to keep the pixels square; a
             fractional scale would smear them. The "dark" variant is the one
             with pale lettering, for this dark footer. -->
        <img
          src=${assetUrl("images/JanuaryGamesWordmarkDark.svg")}
          alt="Made by January Games"
          data-i18n-alt="main.by_line"
          class="studio-wordmark hidden md:block absolute left-4 top-1/2 -translate-y-1/2 h-12 w-auto object-contain [image-rendering:pixelated] pointer-events-none"
          draggable="false"
        />

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
