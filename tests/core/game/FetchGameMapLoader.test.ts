import { describe, expect, test, vi } from "vitest";
import { FetchGameMapLoader } from "../../../src/core/game/FetchGameMapLoader";
import { GameMapType } from "../../../src/core/game/Game";

describe("FetchGameMapLoader", () => {
  test("resolves each map file through the provided path resolver", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(0),
      json: async () => ({ url }),
      statusText: "OK",
    }));
    vi.stubGlobal("fetch", fetchMock);

    const loader = new FetchGameMapLoader(
      (path) => `/_assets/maps/${path}.hashed`,
    );
    const mapData = loader.getMapData(GameMapType.MilkyWay);

    expect(mapData.webpPath).toBe(
      "/_assets/maps/milkyway/thumbnail.webp.hashed",
    );

    await mapData.manifest();

    expect(fetchMock).toHaveBeenCalledWith(
      "/_assets/maps/milkyway/manifest.json.hashed",
    );
  });

  test("retries a download cut off mid-body, then succeeds", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls++;
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        arrayBuffer: async () => {
          if (calls === 1) {
            throw new TypeError(
              "Content-Length header of network response exceeds response Body.",
            );
          }
          return new Uint8Array([7, 8, 9]).buffer;
        },
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const loader = new FetchGameMapLoader("/maps", [0, 0]);
    const bin = await loader.getMapData(GameMapType.MilkyWay).mapBin();

    expect(Array.from(bin)).toEqual([7, 8, 9]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("retries a failed connection and a 5xx", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Load failed"))
      .mockResolvedValueOnce({ ok: false, status: 502, statusText: "Bad" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({ name: "ok" }),
      });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const loader = new FetchGameMapLoader("/maps", [0, 0]);
    const manifest = await loader.getMapData(GameMapType.MilkyWay).manifest();

    expect(manifest).toEqual({ name: "ok" });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("gives up after the last retry", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Load failed"));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const loader = new FetchGameMapLoader("/maps", [0, 0]);
    await expect(
      loader.getMapData(GameMapType.MilkyWay).mapBin(),
    ).rejects.toThrow("Load failed");
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("does not retry a 404", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 404, statusText: "Not Found" });
    vi.stubGlobal("fetch", fetchMock);

    const loader = new FetchGameMapLoader("/maps", [0, 0]);
    await expect(
      loader.getMapData(GameMapType.MilkyWay).mapBin(),
    ).rejects.toThrow("Not Found");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
