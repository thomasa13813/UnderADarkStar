import { html, LitElement, PropertyValues, TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import {
  MAX_SOLO_PRESETS,
  SOLO_PRESET_NAME_MAX,
  SoloPreset,
  SoloPresetSettings,
} from "../../core/SoloPresets";
import { SoloPresetsResult, soloPresetStore } from "../SoloPresetsApi";
import { translateText } from "../Utils";

// Under a Dark Star: the solo screen's saved setups
// (docs/DarkStar-Accounts.md §12.11). One chip per setup loads it; Save
// stores what the screen shows under a name (the last loaded setup's name is
// offered, so saving again updates it). The modal owns the settings: it
// hands over `capture` and applies what `preset-apply` carries.

export interface PresetApplyDetail {
  name: string;
  settings: SoloPresetSettings;
}

type Notice = { tone: "ok" | "error"; text: string } | null;

@customElement("solo-presets-bar")
export class SoloPresetsBar extends LitElement {
  // Where the list lives: the account when signed in, else this browser.
  @property({ type: Boolean }) signedIn = false;
  // Bumped by the modal each time it opens, so a setup saved on another
  // device shows without a page reload.
  @property({ type: Number }) refreshKey = 0;
  @property({ attribute: false }) capture: () => SoloPresetSettings =
    () => ({});

  @state() private presets: SoloPreset[] = [];
  @state() private loadFailed = false;
  @state() private naming = false;
  @state() private nameDraft = "";
  @state() private busy = false;
  @state() private pendingDeleteId: string | null = null;
  @state() private lastLoaded: string | null = null;
  @state() private notice: Notice = null;
  // Each load's answer is used only if no later load has started.
  private loadSeq = 0;

  createRenderRoot() {
    return this;
  }

  protected willUpdate(changed: PropertyValues<this>): void {
    if (changed.has("signedIn") || changed.has("refreshKey")) {
      if (changed.has("signedIn")) this.lastLoaded = null;
      this.naming = false;
      this.pendingDeleteId = null;
      this.notice = null;
      void this.load();
    }
  }

  private get store() {
    return soloPresetStore(this.signedIn);
  }

  private async load() {
    const seq = ++this.loadSeq;
    const result = await this.store.list();
    if (seq !== this.loadSeq) return;
    this.loadFailed = !result.ok;
    if (result.ok) this.presets = result.presets;
  }

  private applyPreset(preset: SoloPreset) {
    this.pendingDeleteId = null;
    this.lastLoaded = preset.name;
    this.notice = {
      tone: "ok",
      text: translateText("solo_presets.loaded", { name: preset.name }),
    };
    this.dispatchEvent(
      new CustomEvent<PresetApplyDetail>("preset-apply", {
        detail: { name: preset.name, settings: preset.settings },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private startNaming() {
    this.pendingDeleteId = null;
    this.notice = null;
    this.nameDraft = this.lastLoaded ?? "";
    this.naming = true;
    void this.updateComplete.then(() => {
      const input = this.querySelector<HTMLInputElement>("#solo-preset-name");
      input?.focus();
      input?.select();
    });
  }

  private async save() {
    const name = this.nameDraft.trim();
    if (name === "" || this.busy) return;
    const replacing = this.presets.some(
      (p) => p.name.toLowerCase() === name.toLowerCase(),
    );
    this.busy = true;
    const result = await this.store.save(name, this.capture());
    this.busy = false;
    if (this.settle(result)) {
      this.naming = false;
      this.lastLoaded = name;
      this.notice = {
        tone: "ok",
        text: translateText(
          replacing ? "solo_presets.updated" : "solo_presets.saved",
          { name },
        ),
      };
    }
  }

  private async deletePreset(preset: SoloPreset) {
    if (this.pendingDeleteId !== preset.id) {
      this.pendingDeleteId = preset.id;
      return;
    }
    if (this.busy) return;
    this.busy = true;
    const result = await this.store.remove(preset.id);
    this.busy = false;
    this.pendingDeleteId = null;
    if (this.settle(result)) {
      if (this.lastLoaded === preset.name) this.lastLoaded = null;
      this.notice = {
        tone: "ok",
        text: translateText("solo_presets.deleted", { name: preset.name }),
      };
    }
  }

  // Takes the list from a successful answer; otherwise says what went wrong.
  private settle(result: SoloPresetsResult): boolean {
    if (result.ok) {
      this.presets = result.presets;
      this.loadFailed = false;
      return true;
    }
    const key =
      result.code === "full"
        ? "solo_presets.full"
        : result.code === "invalid"
          ? "solo_presets.invalid_name"
          : "solo_presets.failed";
    this.notice = {
      tone: "error",
      text: translateText(key, {
        max: MAX_SOLO_PRESETS,
        length: SOLO_PRESET_NAME_MAX,
      }),
    };
    return false;
  }

  private onNameKeyDown = (e: KeyboardEvent) => {
    // Keep Enter and Escape from reaching the modal (Escape closes it).
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      void this.save();
    } else if (e.key === "Escape") {
      this.naming = false;
    }
  };

  render(): TemplateResult {
    return html`
      <div
        class="rounded-xl border border-white/10 bg-white/5 px-4 py-3 space-y-3"
      >
        <div class="flex flex-wrap items-center gap-2">
          <span
            class="text-xs font-bold uppercase tracking-wider text-white/60 mr-1"
            >${translateText("solo_presets.title")}</span
          >
          ${this.presets.length === 0
            ? html`<span class="text-xs text-white/40"
                >${translateText(
                  this.loadFailed
                    ? "solo_presets.load_failed"
                    : "solo_presets.empty",
                )}</span
              >`
            : this.presets.map((preset) => this.renderChip(preset))}
          ${this.naming
            ? null
            : html`<button
                class="ml-auto px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider border border-malibu-blue/40 text-malibu-blue hover:bg-malibu-blue/10 transition-all disabled:opacity-40"
                ?disabled=${this.busy}
                @click=${this.startNaming}
              >
                ${translateText("solo_presets.save")}
              </button>`}
        </div>
        ${this.naming ? this.renderNameRow() : null}
        ${this.notice
          ? html`<p
              class="text-xs ${this.notice.tone === "ok"
                ? "text-green-400"
                : "text-red-400"}"
              role="status"
            >
              ${this.notice.text}
            </p>`
          : null}
        ${this.signedIn
          ? null
          : html`<p class="text-xs text-white/40">
              ${translateText("solo_presets.guest_hint")}
            </p>`}
      </div>
    `;
  }

  private renderChip(preset: SoloPreset): TemplateResult {
    const confirming = this.pendingDeleteId === preset.id;
    return html`<span
      class="inline-flex items-stretch rounded-lg border overflow-hidden ${this
        .lastLoaded === preset.name
        ? "border-malibu-blue/60 bg-malibu-blue/15"
        : "border-white/15 bg-black/30"}"
    >
      <button
        class="px-3 py-1.5 text-sm text-white hover:bg-white/10 transition-all max-w-[14rem] truncate"
        title=${translateText("solo_presets.load_title", { name: preset.name })}
        ?disabled=${this.busy}
        @click=${() => this.applyPreset(preset)}
      >
        ${preset.name}
      </button>
      <button
        class="px-2 text-xs border-l border-white/10 transition-all ${confirming
          ? "bg-red-500/30 text-red-200 font-bold uppercase"
          : "text-white/40 hover:text-white hover:bg-white/10"}"
        aria-label=${translateText("solo_presets.delete_title", {
          name: preset.name,
        })}
        title=${translateText("solo_presets.delete_title", {
          name: preset.name,
        })}
        ?disabled=${this.busy}
        @click=${() => void this.deletePreset(preset)}
        @blur=${() => {
          if (this.pendingDeleteId === preset.id) this.pendingDeleteId = null;
        }}
      >
        ${confirming ? translateText("solo_presets.confirm_delete") : "✕"}
      </button>
    </span>`;
  }

  private renderNameRow(): TemplateResult {
    return html`<div class="flex flex-wrap items-center gap-2">
      <input
        id="solo-preset-name"
        type="text"
        class="flex-1 min-w-[10rem] px-3 py-1.5 rounded-lg text-sm bg-black/40 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:border-malibu-blue/50"
        maxlength=${SOLO_PRESET_NAME_MAX}
        placeholder=${translateText("solo_presets.name_placeholder")}
        aria-label=${translateText("solo_presets.name_placeholder")}
        .value=${this.nameDraft}
        @input=${(e: Event) =>
          (this.nameDraft = (e.target as HTMLInputElement).value)}
        @keydown=${this.onNameKeyDown}
      />
      <button
        class="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider bg-malibu-blue/80 text-white hover:bg-malibu-blue transition-all disabled:opacity-40"
        ?disabled=${this.busy || this.nameDraft.trim() === ""}
        @click=${() => void this.save()}
      >
        ${translateText("solo_presets.confirm_save")}
      </button>
      <button
        class="px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider text-white/60 hover:text-white hover:bg-white/10 transition-all"
        @click=${() => (this.naming = false)}
      >
        ${translateText("common.cancel")}
      </button>
    </div>`;
  }
}
