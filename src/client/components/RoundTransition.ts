import { html, LitElement, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { translateText } from "../Utils";

// Under a Dark Star (docs/DarkStar-Lobbies.md L41, §14.1): the generic
// transition between a room's rounds. The finished round's win screen sends
// the player to a lobby by loading its page; this plays over the lobby as it
// opens: the galaxy fades to dark and back while the Hegemon turns back time.
// The rewound round (§14.3) is to replace it later.

const KEY = "darkstar.roundTransition";
const DURATION_MS = 2600;

/** Ask the next page to open with the transition. */
export function requestRoundTransition(): void {
  try {
    sessionStorage.setItem(KEY, "1");
  } catch {
    // Storage blocked: the lobby simply opens without it.
  }
}

function takeRequest(): boolean {
  try {
    const wanted = sessionStorage.getItem(KEY) === "1";
    sessionStorage.removeItem(KEY);
    return wanted;
  } catch {
    return false;
  }
}

@customElement("round-transition")
export class RoundTransition extends LitElement {
  @state() private playing = false;

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    if (!takeRequest()) return;
    this.playing = true;
    window.setTimeout(() => {
      this.playing = false;
    }, DURATION_MS);
  }

  render() {
    if (!this.playing) return nothing;
    return html`
      <style>
        @keyframes round-transition-fade {
          0% {
            opacity: 1;
          }
          70% {
            opacity: 1;
          }
          100% {
            opacity: 0;
          }
        }
        @keyframes round-transition-spin {
          from {
            transform: rotate(0deg) scale(1.2);
          }
          to {
            transform: rotate(-120deg) scale(0.6);
          }
        }
      </style>
      <div
        class="fixed inset-0 z-[20000] flex items-center justify-center bg-black pointer-events-none"
        style="animation: round-transition-fade ${DURATION_MS}ms ease-in forwards"
        data-round-transition
        aria-hidden="true"
      >
        <div
          class="absolute size-[60vmin] rounded-full border-2 border-dashed border-purple-400/40"
          style="animation: round-transition-spin ${DURATION_MS}ms ease-in-out forwards"
        ></div>
        <p
          class="relative font-pixel text-lg sm:text-2xl tracking-widest text-purple-200 text-center px-6"
        >
          ${translateText("rooms.transition")}
        </p>
      </div>
    `;
  }
}
