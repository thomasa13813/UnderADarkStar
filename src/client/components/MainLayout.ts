import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";

@customElement("main-layout")
export class MainLayout extends LitElement {
  private _initialChildren: Node[] = [];
  // Under a Dark Star: the home page carries the leaderboard to the right of
  // the menu on xl screens (<leaderboard-panel>), so the column widens by the
  // panel and its gap there; every other page keeps the narrower column.
  @state() private home = true;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    if (this._initialChildren.length === 0 && this.childNodes.length > 0) {
      this._initialChildren = Array.from(this.childNodes);
    }
    super.connectedCallback();
    window.addEventListener("showPage", this.onShowPage);
  }

  disconnectedCallback() {
    window.removeEventListener("showPage", this.onShowPage);
    super.disconnectedCallback();
  }

  private onShowPage = (event: Event) => {
    this.home = (event as CustomEvent).detail === "page-play";
  };

  render() {
    const width = this.home
      ? "lg:max-w-[20cm] xl:max-w-[calc(20cm+26rem)] 2xl:max-w-[calc(24cm+26rem)]"
      : "lg:max-w-[20cm] 2xl:max-w-[24cm]";
    return html`
      <main
        class="relative [.in-game_&]:hidden flex flex-col flex-1 min-h-0 w-full px-0 lg:px-[clamp(1.5rem,3vw,3rem)] pt-0 lg:pt-[clamp(0.75rem,1.5vw,1.5rem)] pb-0 lg:pb-[clamp(0.375rem,0.75vw,0.75rem)]"
      >
        <div
          class="w-full ${width} desktop:lg:max-w-[min(100%,clamp(80rem,50%,90rem))] mx-auto flex flex-col flex-1 min-h-0 gap-0 lg:gap-[clamp(1.5rem,3vw,3rem)] overflow-x-clip sm:px-4 lg:px-0"
        >
          ${this._initialChildren}
        </div>
      </main>
    `;
  }
}
