import { html, svg, TemplateResult } from "lit";
import { translateText } from "../Utils";

/**
 * The folder header used by the solo and private-lobby setup: a bar naming the
 * current choice that opens and closes its section. The maps folder started
 * this; every settings section uses it now (only the maps folder starts open).
 */
export function renderFolderHeader(opts: {
  /** Shown before the choice; omitted when the section title already says it. */
  label?: string;
  summary: string;
  open: boolean;
  onToggle: () => void;
}): TemplateResult {
  const { label, summary, open, onToggle } = opts;
  return html`<button
    type="button"
    class="w-full flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all duration-200 ${open
      ? "bg-white/5 border-white/10 hover:bg-white/10"
      : "bg-malibu-blue/20 border-malibu-blue/50 hover:bg-malibu-blue/30"}"
    aria-expanded=${open}
    @click=${onToggle}
  >
    <svg
      class="w-5 h-5 text-aquarius shrink-0"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      ${open
        ? svg`<path d="M19.906 9c.382 0 .749.057 1.094.162V9a3 3 0 00-3-3h-3.879a.75.75 0 01-.53-.22L11.47 3.66A2.25 2.25 0 009.879 3H6a3 3 0 00-3 3v3.162A3.756 3.756 0 014.094 9h15.812zM4.094 10.5a2.25 2.25 0 00-2.227 2.568l.857 6A2.25 2.25 0 004.951 21H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-2.227-2.568H4.094z" />`
        : svg`<path d="M19.5 21a3 3 0 003-3v-4.5a3 3 0 00-3-3h-15a3 3 0 00-3 3V18a3 3 0 003 3h15zM1.5 10.146V6a3 3 0 013-3h5.379a2.25 2.25 0 011.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 013 3v1.146A4.483 4.483 0 0019.5 9h-15a4.483 4.483 0 00-3 1.146z" />`}
    </svg>
    ${label
      ? html`<span
          class="text-sm font-bold text-white uppercase tracking-wider"
        >
          ${label}
        </span>`
      : null}
    <span class="text-sm text-white/60 truncate text-left">${summary}</span>
    <span
      class="ml-auto text-xs text-white/50 uppercase tracking-wider shrink-0"
    >
      ${open
        ? translateText("map_component.folder_close")
        : translateText("map_component.folder_change")}
    </span>
    <svg
      class="w-4 h-4 text-white/50 shrink-0 transition-transform duration-200 ${open
        ? "rotate-180"
        : ""}"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fill-rule="evenodd"
        d="M5.22 8.22a.75.75 0 011.06 0L10 11.94l3.72-3.72a.75.75 0 111.06 1.06l-4.25 4.25a.75.75 0 01-1.06 0L5.22 9.28a.75.75 0 010-1.06z"
        clip-rule="evenodd"
      />
    </svg>
  </button>`;
}
