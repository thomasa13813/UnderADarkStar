import { LitElement, html } from "lit";
import { customElement } from "lit/decorators.js";
import { assetUrl } from "../../core/AssetUrls";
import "./AccountButton";
import "./LeaderboardPanel";
import "./NavUtilityIcons";

@customElement("play-page")
export class PlayPage extends LitElement {
  createRenderRoot() {
    return this;
  }

  render() {
    // The xl grid is gated on :not(.hidden): showPage() hides this page with
    // the `hidden` class, and a bare xl:grid outranks it, which left the menu
    // and leaderboard showing behind every lobby on wide screens.
    return html`
      <div
        id="page-play"
        class="flex flex-col gap-2 w-full px-0 lg:px-4 min-h-0 xl:[&:not(.hidden)]:grid xl:grid-cols-[minmax(0,1fr)_24rem] xl:grid-rows-[auto_1fr] xl:gap-x-8"
      >
        <!-- Mobile: Fixed top bar -->
        <div
          class="lg:hidden fixed left-0 right-0 top-0 z-40 pt-[env(safe-area-inset-top)] bg-surface border-b border-white/10"
        >
          <!-- A flex row, not a three-column grid: the grid split the two
               sides evenly, and the four utility icons outgrew their half
               and ran over the title on a phone. Here the title takes what
               the button and the icons leave and shrinks to fit. -->
          <div class="flex items-center h-14 px-2 gap-2">
            <button
              id="hamburger-btn"
              class="h-10 shrink-0 aspect-[4/3] flex text-white/90 rounded-md items-center justify-center transition-colors"
              data-i18n-aria-label="main.menu"
              aria-expanded="false"
              aria-controls="sidebar-menu"
              aria-haspopup="dialog"
              data-i18n-title="main.menu"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="size-8"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5"
                />
              </svg>
            </button>

            <!-- Tom's stacked pixel-art title, as in the desktop nav bar. -->
            <img
              src=${assetUrl("images/TitleStacked.svg")}
              alt="Under a Dark Star"
              data-i18n-alt="main.title"
              class="flex-1 min-w-0 h-8 object-contain select-none pointer-events-none"
              draggable="false"
            />
            <!-- Right slot: help and settings. -->
            <div class="shrink-0 flex items-center gap-0.5">
              <nav-utility-icons size="mobile"></nav-utility-icons>
            </div>
          </div>
        </div>

        <!-- Top strip: the identity row. -->
        <div
          class="w-full pb-4 lg:pb-0 flex flex-col gap-4 sm:-mx-4 sm:w-[calc(100%+2rem)] lg:mx-0 lg:w-full lg:gap-4 lg:items-stretch"
        >
          <!-- Mobile: spacer for fixed top bar -->
          <div
            class="lg:hidden h-[calc(env(safe-area-inset-top)+56px)] -mb-4"
          ></div>
          <div class="flex flex-col gap-2 min-w-0">
            <!-- Identity row: the username, and the account (sign in, or
                 the account name and its panel; Accounts doc §9). -->
            <div
              class="relative bg-surface border-y border-white/10 overflow-visible flex items-center sm:min-h-[60px] sm:flex-1 sm:z-20 sm:border-y-0 sm:rounded-xl"
            >
              <div
                class="relative z-10 flex h-full w-full min-w-0 items-center gap-1.5 sm:gap-2 bg-surface/80 p-1 sm:rounded-xl"
              >
                <username-input
                  class="flex-1 min-w-0 h-10 sm:h-[50px]"
                ></username-input>
                <account-button
                  class="shrink-0 h-10 sm:h-[50px]"
                ></account-button>
              </div>
            </div>
          </div>
        </div>

        <game-mode-selector></game-mode-selector>

        <!-- The leaderboard: right of the menu on wide screens, under it
             on narrow ones (Accounts doc §6). -->
        <leaderboard-panel
          class="block pb-4 sm:pb-0 xl:col-start-2 xl:row-start-1 xl:row-span-2"
        ></leaderboard-panel>
      </div>
    `;
  }
}
