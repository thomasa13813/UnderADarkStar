import { GameMapType } from "./Game";
import { GameMapLoader, MapData } from "./GameMapLoader";

/**
 * Pauses before each retry of a map download. Phones lose downloads mid-way
 * (iOS Safari drops an in-flight fetch when the player switches apps, and a
 * cellular hand-off can cut one short: "Content-Length header of network
 * response exceeds response body"), and a single lost download used to end
 * the game start.
 */
const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [500, 1500];

/** A response the server gave deliberately; retrying will not change it. */
class MapFetchRejected extends Error {}

export class FetchGameMapLoader implements GameMapLoader {
  private maps: Map<GameMapType, MapData>;

  public constructor(
    private readonly pathResolver: string | ((path: string) => string),
    private readonly retryDelaysMs: readonly number[] = DEFAULT_RETRY_DELAYS_MS,
  ) {
    this.maps = new Map<GameMapType, MapData>();
  }

  public getMapData(map: GameMapType): MapData {
    const cachedMap = this.maps.get(map);
    if (cachedMap) {
      return cachedMap;
    }

    const key = Object.keys(GameMapType).find(
      (k) => GameMapType[k as keyof typeof GameMapType] === map,
    );
    const fileName = key?.toLowerCase();

    if (!fileName) {
      throw new Error(`Unknown map: ${map}`);
    }

    const mapData = {
      mapBin: () => this.loadBinaryFromUrl(this.url(fileName, "map.bin")),
      map4xBin: () => this.loadBinaryFromUrl(this.url(fileName, "map4x.bin")),
      map16xBin: () => this.loadBinaryFromUrl(this.url(fileName, "map16x.bin")),
      manifest: () => this.loadJsonFromUrl(this.url(fileName, "manifest.json")),
      webpPath: this.url(fileName, "thumbnail.webp"),
      layerPng: (layerId: string) =>
        this.loadImageBitmap(this.url(fileName, `${layerId}.png`)),
    } satisfies MapData;

    this.maps.set(map, mapData);
    return mapData;
  }

  private resolveUrl(path: string): string {
    if (typeof this.pathResolver === "function") {
      return this.pathResolver(path);
    }
    return `${this.pathResolver}/${path}`;
  }

  private url(map: string, path: string) {
    return this.resolveUrl(`${map}/${path}`);
  }

  /**
   * Fetch `url` and read its body with `read`, retrying a lost download.
   * The body read sits inside the retry because that is where a truncated
   * transfer surfaces. A 4xx is the server's answer, not a lost download, so
   * it fails at once; network errors and 5xx retry after each delay.
   */
  private async fetchWithRetry<T>(
    url: string,
    read: (response: Response) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          const message = `Failed to load ${url}: ${response.statusText}`;
          if (response.status < 500) throw new MapFetchRejected(message);
          throw new Error(message);
        }
        return await read(response);
      } catch (err) {
        if (err instanceof MapFetchRejected) throw err;
        if (attempt >= this.retryDelaysMs.length) throw err;
        console.warn(
          `[MapLoader] ${url}: attempt ${attempt + 1} failed, retrying`,
          err,
        );
        await new Promise((resolve) =>
          setTimeout(resolve, this.retryDelaysMs[attempt]),
        );
      }
    }
  }

  private async loadBinaryFromUrl(url: string) {
    const startTime = performance.now();
    const data = await this.fetchWithRetry(url, (res) => res.arrayBuffer());
    console.log(
      `[MapLoader] ${url}: ${(performance.now() - startTime).toFixed(0)}ms`,
    );
    return new Uint8Array(data);
  }

  private async loadJsonFromUrl(url: string) {
    return this.fetchWithRetry(url, (res) => res.json());
  }

  private async loadImageBitmap(url: string): Promise<ImageBitmap> {
    const startTime = performance.now();
    const blob = await this.fetchWithRetry(url, (res) => res.blob());
    const bitmap = await createImageBitmap(blob);
    console.log(
      `[MapLoader] ${url}: ${(performance.now() - startTime).toFixed(0)}ms`,
    );
    return bitmap;
  }
}
