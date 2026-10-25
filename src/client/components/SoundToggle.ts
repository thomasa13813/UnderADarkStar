import { html, LitElement, svg, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  USER_SETTINGS_CHANGED_EVENT,
  UserSettings,
} from "../../core/game/UserSettings";
import { translateText } from "../Utils";

// Either can change what the icon shows: the mute itself, and master, which
// the Audio tab's slider or toggleSound's lift-from-zero can move.
const WATCHED = ["settings.audio.muted", "settings.audio.master"].map(
  (key) => `${USER_SETTINGS_CHANGED_EVENT}:${key}`,
);

/**
 * The speaker icon: one click mutes or unmutes the whole game, with no volume
 * control of its own (that stays in Settings > Audio). Sits immediately right
 * of the settings cogwheel, on the home nav bars and in the in-game panel;
 * each host passes its own button and icon classes so it matches its row,
 * and `solid` fills the speaker to sit with the HUD's filled glyphs.
 */
@customElement("sound-toggle")
export class SoundToggle extends LitElement {
  @property({ type: String }) buttonClass = "";
  @property({ type: String }) iconClass = "w-6 h-6";
  @property({ type: Boolean }) solid = false;

  @state() private on = false;

  private readonly userSettings = new UserSettings();

  createRenderRoot() {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.refresh();
    for (const type of WATCHED) {
      globalThis.addEventListener(type, this.refresh);
    }
  }

  disconnectedCallback() {
    for (const type of WATCHED) {
      globalThis.removeEventListener(type, this.refresh);
    }
    super.disconnectedCallback();
  }

  private refresh = () => {
    this.on = this.userSettings.soundOn();
  };

  private onClick = () => {
    this.userSettings.toggleSound();
    this.refresh();
  };

  render(): TemplateResult {
    const label = translateText(
      this.on ? "main.sound_mute" : "main.sound_unmute",
    );
    return html`
      <button
        type="button"
        class=${this.buttonClass}
        aria-label=${label}
        aria-pressed=${this.on ? "false" : "true"}
        title=${label}
        data-sound-on=${this.on ? "true" : "false"}
        @click=${this.onClick}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="1.8"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="${this.iconClass} pointer-events-none"
          aria-hidden="true"
        >
          <path
            d="M11 5 6 9H3v6h3l5 4V5Z"
            fill=${this.solid ? "currentColor" : "none"}
          />
          ${this.on
            ? svg`<path d="M15.5 8.5a5 5 0 0 1 0 7" />
                <path d="M18.6 5.4a9.5 9.5 0 0 1 0 13.2" />`
            : svg`<line x1="16" y1="9" x2="22" y2="15" />
                <line x1="22" y1="9" x2="16" y2="15" />`}
        </svg>
      </button>
    `;
  }
}
