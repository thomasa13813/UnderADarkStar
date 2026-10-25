import { html, LitElement, nothing } from "lit";
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
import { renderFolderHeader } from "../SettingsFolder";
import "./MapDisplay";
import { getFavoriteMaps, toggleFavoriteMap } from "./MapFavorites";
const randomMap = assetUrl("images/RandomMap.svg");

/**
 * The map picker: every map in one grid, alphabetical by its translated name,
 * with the favourites star and a search box. The Random card takes the first
 * slot (it hides while searching). Upstream grouped maps into
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

  private renderMapGrid(mapList: MapInfo[], withRandom = false) {
    // Keyed by map so cards keep their identity when the list shifts —
    // positional reuse would leave stale thumbnails behind.
    return html`<div
      class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4"
    >
      ${withRandom ? this.renderRandomCard() : nothing}
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
      ${this.renderMapGrid(this.sortedMaps, true)}
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
    return renderFolderHeader({
      label: translateText("map_component.folder"),
      summary: this.selectedMapName,
      open: this.folderOpen,
      onToggle: this.toggleFolder,
    });
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
    return this.searchQuery.trim()
      ? this.renderSearchResults()
      : this.renderAllMaps();
  }

  private renderRandomCard() {
    return html`<button
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
    </button>`;
  }
}
