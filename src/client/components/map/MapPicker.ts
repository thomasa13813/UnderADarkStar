import { html, LitElement, nothing, svg } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { assetUrl } from "../../../core/AssetUrls";
import {
  Difficulty,
  GameMapType,
  MapInfo,
  maps,
} from "../../../core/game/Game";
import { translateText } from "../../Utils";
import "./MapDisplay";
import { getFavoriteMaps, toggleFavoriteMap } from "./MapFavorites";
const randomMap = assetUrl("images/RandomMap.webp");

/**
 * The map picker: every map in one grid, alphabetical by its translated name,
 * with the favourites star and a search box. Upstream grouped maps into
 * featured, regional and arcade categories; the pool is small and space-only
 * now (roadmap P3), so the categories went with the Earth maps.
 *
 * With `collapsible` set (solo and private lobbies), the maps sit in a folder that
 * closes when a map is picked, so the settings below come into view; its
 * header names the pick and reopens the folder.
 */
@customElement("map-picker")
export class MapPicker extends LitElement {
  @property({ type: String }) selectedMap: GameMapType =
    GameMapType.EventHorizon;
  @property({ type: Boolean }) useRandomMap = false;
  @property({ type: Boolean }) showMedals = false;
  @property({ type: Boolean }) randomMapDivider = false;
  @property({ type: String }) searchQuery = "";
  @property({ type: Boolean }) collapsible = false;
  @property({ attribute: false }) mapWins: Map<GameMapType, Set<Difficulty>> =
    new Map();
  @property({ attribute: false }) onSelectMap?: (map: GameMapType) => void;
  @property({ attribute: false }) onSelectRandom?: () => void;
  @state() private favorites: GameMapType[] = getFavoriteMaps();
  @state() private folderOpen = true;

  createRenderRoot() {
    return this;
  }

  private handleToggleFavorite(mapValue: GameMapType) {
    this.favorites = toggleFavoriteMap(mapValue);
  }

  willUpdate(changed: Map<string, unknown>) {
    // A search is pointless behind a closed folder.
    if (changed.has("searchQuery") && this.searchQuery.trim()) {
      this.folderOpen = true;
    }
  }

  private handleMapSelection(mapValue: GameMapType) {
    this.onSelectMap?.(mapValue);
    this.closeFolder();
  }

  private handleSelectRandomMap = () => {
    this.onSelectRandom?.();
    this.closeFolder();
  };

  /** Close on a pick, and keep the header (now naming the pick) in view. */
  private closeFolder() {
    if (!this.collapsible) return;
    this.folderOpen = false;
    void this.updateComplete.then(() =>
      this.querySelector("button[aria-expanded]")?.scrollIntoView({
        block: "nearest",
      }),
    );
  }

  private toggleFolder = () => {
    this.folderOpen = !this.folderOpen;
  };

  private get selectedMapName(): string {
    if (this.useRandomMap) return translateText("map.random");
    const map = maps.find((m) => m.type === this.selectedMap);
    return map ? this.mapName(map) : "";
  }

  private preventImageDrag(event: DragEvent) {
    event.preventDefault();
  }

  private mapName(map: MapInfo): string {
    return translateText(map.translationKey);
  }

  /** Every map, alphabetical by the name the player sees. */
  private get sortedMaps(): MapInfo[] {
    return [...maps].sort((a, b) =>
      this.mapName(a).localeCompare(this.mapName(b)),
    );
  }

  private get filteredMaps(): MapInfo[] {
    if (!this.searchQuery.trim()) return [];
    const query = this.searchQuery.trim().toLowerCase();
    return this.sortedMaps.filter((m) => {
      const name = this.mapName(m).toLowerCase();
      const id = m.id.toLowerCase();
      return name.includes(query) || id.includes(query);
    });
  }

  private getWins(mapValue: GameMapType): Set<Difficulty> {
    return this.mapWins?.get(mapValue) ?? new Set();
  }

  private renderMapCard(map: MapInfo) {
    return html`
      <div
        @click=${() => this.handleMapSelection(map.type)}
        class="cursor-pointer"
      >
        <map-display
          .mapKey=${map.id}
          .selected=${!this.useRandomMap && this.selectedMap === map.type}
          .showMedals=${this.showMedals}
          .wins=${this.getWins(map.type)}
          .favorite=${this.favorites.includes(map.type)}
          .onToggleFavorite=${() => this.handleToggleFavorite(map.type)}
          .translation=${this.mapName(map)}
        ></map-display>
      </div>
    `;
  }

  private renderMapGrid(mapList: MapInfo[]) {
    // Keyed by map so cards keep their identity when the list shifts —
    // positional reuse would leave stale thumbnails behind.
    return html`<div
      class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
    >
      ${repeat(
        mapList,
        (map) => map.id,
        (map) => this.renderMapCard(map),
      )}
    </div>`;
  }

  private renderSectionHeading(label: string) {
    return html`<h4
      class="text-xs font-bold text-white/40 uppercase tracking-widest mb-4 pl-2"
    >
      ${label}
    </h4>`;
  }

  private renderAllMaps() {
    return html`<div class="w-full">
      ${this.renderSectionHeading(translateText("map.all"))}
      ${this.renderMapGrid(this.sortedMaps)}
    </div>`;
  }

  private renderSearchResults() {
    const results = this.filteredMaps;
    if (results.length === 0) {
      return html`<div
        class="w-full flex flex-col items-center justify-center gap-3 py-12 px-4 text-center rounded-xl border border-dashed border-white/10 bg-black/20"
      >
        <svg
          class="w-8 h-8 text-white/30"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fill-rule="evenodd"
            d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
            clip-rule="evenodd"
          />
        </svg>
        <p class="text-sm text-white/50 leading-relaxed max-w-xs">
          ${translateText("map_component.no_results")}
        </p>
      </div>`;
    }
    return html`<div class="w-full">
      ${this.renderSectionHeading(
        `${translateText("map_component.search_results")} (${results.length})`,
      )}
      ${this.renderMapGrid(results)}
    </div>`;
  }

  private renderFolderHeader() {
    return html`<button
      type="button"
      class="w-full flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-all duration-200 ${this
        .folderOpen
        ? "bg-white/5 border-white/10 hover:bg-white/10"
        : "bg-malibu-blue/20 border-malibu-blue/50 hover:bg-malibu-blue/30"}"
      aria-expanded=${this.folderOpen}
      @click=${this.toggleFolder}
    >
      <svg
        class="w-5 h-5 text-aquarius shrink-0"
        viewBox="0 0 24 24"
        fill="currentColor"
      >
        ${this.folderOpen
          ? svg`<path d="M19.906 9c.382 0 .749.057 1.094.162V9a3 3 0 00-3-3h-3.879a.75.75 0 01-.53-.22L11.47 3.66A2.25 2.25 0 009.879 3H6a3 3 0 00-3 3v3.162A3.756 3.756 0 014.094 9h15.812zM4.094 10.5a2.25 2.25 0 00-2.227 2.568l.857 6A2.25 2.25 0 004.951 21H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-2.227-2.568H4.094z" />`
          : svg`<path d="M19.5 21a3 3 0 003-3v-4.5a3 3 0 00-3-3h-15a3 3 0 00-3 3V18a3 3 0 003 3h15zM1.5 10.146V6a3 3 0 013-3h5.379a2.25 2.25 0 011.59.659l2.122 2.121c.14.141.331.22.53.22H19.5a3 3 0 013 3v1.146A4.483 4.483 0 0019.5 9h-15a4.483 4.483 0 00-3 1.146z" />`}
      </svg>
      <span class="text-sm font-bold text-white uppercase tracking-wider">
        ${translateText("map_component.folder")}
      </span>
      <span class="text-sm text-white/60 truncate">
        ${this.selectedMapName}
      </span>
      <span
        class="ml-auto text-xs text-white/50 uppercase tracking-wider shrink-0"
      >
        ${this.folderOpen
          ? translateText("map_component.folder_close")
          : translateText("map_component.folder_change")}
      </span>
      <svg
        class="w-4 h-4 text-white/50 shrink-0 transition-transform duration-200 ${this
          .folderOpen
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

  render() {
    if (!this.collapsible) return this.renderMaps();
    return html`<div class="space-y-4">
      ${this.renderFolderHeader()}
      ${this.folderOpen
        ? html`<div class="pl-2 border-l-2 border-white/10">
            ${this.renderMaps()}
          </div>`
        : nothing}
    </div>`;
  }

  private renderMaps() {
    const isSearching = this.searchQuery.trim().length > 0;
    return html`
      <div class="space-y-8">
        ${isSearching ? this.renderSearchResults() : this.renderAllMaps()}
        <div
          class="w-full ${this.randomMapDivider
            ? "pt-4 border-t border-white/5"
            : ""}"
        >
          ${this.renderSectionHeading(translateText("map_categories.special"))}
          <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            <button
              type="button"
              class="w-full h-full p-3 flex flex-col items-center justify-between rounded-xl border cursor-pointer transition-all duration-200 active:scale-95 gap-3 group ${this
                .useRandomMap
                ? "bg-malibu-blue/20 border-malibu-blue/50 shadow-[var(--shadow-malibu-blue-strong)]"
                : "bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 hover:-translate-y-1"}"
              @click=${this.handleSelectRandomMap}
            >
              <div
                class="w-full aspect-[2/1] relative overflow-hidden rounded-lg bg-black/20"
              >
                <img
                  src=${randomMap}
                  alt=${translateText("map.random")}
                  draggable="false"
                  @dragstart=${this.preventImageDrag}
                  class="w-full h-full object-cover ${this.useRandomMap
                    ? "opacity-100"
                    : "opacity-80"} group-hover:opacity-100 transition-opacity duration-200"
                />
              </div>
              <div
                class="text-xs font-bold text-white uppercase tracking-wider text-center leading-tight break-words hyphens-auto"
              >
                ${translateText("map.random")}
              </div>
            </button>
          </div>
        </div>
      </div>
    `;
  }
}
