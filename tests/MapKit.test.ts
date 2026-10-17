import zlib from "zlib";
import lordNames from "../resources/lordNames.json";
import { GameMapType } from "../src/core/game/Game";
import {
  convertDrawing,
  DARK_STAR_SIZING,
  defaultDarkStar,
  PALETTE,
  templateDrawing,
  Terrain,
  TerrainClass,
} from "../src/scripts/mapkit/Convert";
import {
  buildInfo,
  mapIdentity,
  nameNations,
} from "../src/scripts/mapkit/Info";
import { decodePng, encodePng, Image } from "../src/scripts/mapkit/Png";
import { setup } from "./util/Setup";

// ── A tiny paint program ────────────────────────────────────────────────────

type Rgb = [number, number, number];

function colour(terrain: TerrainClass): Rgb {
  return PALETTE.find((p) => p.terrain === terrain && p.primary)!.rgb;
}
const SPACE = colour(Terrain.Space);
const VOID = colour(Terrain.Void);
const PLAINS = colour(Terrain.Plains);
const HIGHLAND = colour(Terrain.Highland);
const MOUNTAIN = colour(Terrain.Mountain);
const NATION = colour(Terrain.Nation);
const STAR = colour(Terrain.DarkStar);

function canvas(size: number, fill: Rgb = SPACE): Image {
  const rgba = new Uint8Array(size * size * 4);
  const image = { width: size, height: size, rgba };
  rect(image, 0, 0, size, size, fill);
  return image;
}

function put(image: Image, x: number, y: number, rgb: Rgb) {
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const o = (y * image.width + x) * 4;
  image.rgba[o] = rgb[0];
  image.rgba[o + 1] = rgb[1];
  image.rgba[o + 2] = rgb[2];
  image.rgba[o + 3] = 255;
}

function rect(
  image: Image,
  x0: number,
  y0: number,
  w: number,
  h: number,
  rgb: Rgb,
) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) put(image, x, y, rgb);
  }
}

function disc(image: Image, cx: number, cy: number, r: number, rgb: Rgb) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) put(image, x, y, rgb);
    }
  }
}

function mix(a: Rgb, b: Rgb, t: number): Rgb {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

/** What the map-generator would make of an output pixel. */
function terrainAt(image: Image, x: number, y: number): string {
  const o = (y * image.width + x) * 4;
  const [r, g, b] = [image.rgba[o], image.rgba[o + 1], image.rgba[o + 2]];
  if (b === 106) return "space";
  if (r === 0 && g === 0 && b === 0) return "void";
  if (b < 159) return "plains";
  return b < 179 ? "highland" : "mountain";
}

/** A 400x400 map: a ring of land around the default Dark Star. */
function ringMap(): Image {
  const image = canvas(400);
  rect(image, 40, 40, 320, 320, PLAINS);
  return image;
}

// ── PNG ─────────────────────────────────────────────────────────────────────

/** Encodes RGB8 with the given filter type on every row, as an editor may. */
function encodeFilteredRgb(image: Image, filter: number): Buffer {
  const { width, height } = image;
  const row = width * 3;
  const rgb = new Uint8Array(row * height);
  for (let i = 0; i < width * height; i++) {
    rgb.set(image.rgba.subarray(i * 4, i * 4 + 3), i * 3);
  }
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c;
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  const raw = Buffer.alloc((row + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (row + 1)] = filter;
    for (let i = 0; i < row; i++) {
      const a = i >= 3 ? rgb[y * row + i - 3] : 0;
      const b = y > 0 ? rgb[(y - 1) * row + i] : 0;
      const c = y > 0 && i >= 3 ? rgb[(y - 1) * row + i - 3] : 0;
      const predicted = [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter];
      raw[y * (row + 1) + 1 + i] = (rgb[y * row + i] - predicted) & 0xff;
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(zlib.crc32(body), body.length + 4);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    // Split across two IDAT chunks, as real encoders do.
    ...(() => {
      const z = zlib.deflateSync(raw);
      const half = z.length >> 1;
      return [
        chunk("IDAT", z.subarray(0, half)),
        chunk("IDAT", z.subarray(half)),
      ];
    })(),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

describe("map kit: PNG", () => {
  const picture = (): Image => {
    const image = canvas(37);
    disc(image, 18, 18, 11, PLAINS);
    disc(image, 9, 25, 4, NATION);
    rect(image, 0, 0, 6, 37, VOID);
    return image;
  };

  test("what it writes, it reads back", () => {
    const image = picture();
    const back = decodePng(encodePng(image));
    expect(back.width).toBe(37);
    expect(back.height).toBe(37);
    expect(Buffer.from(back.rgba).equals(Buffer.from(image.rgba))).toBe(true);
  });

  test.each([0, 1, 2, 3, 4])("reads RGB rows with filter %i", (filter) => {
    const image = picture();
    const back = decodePng(encodeFilteredRgb(image, filter));
    expect(Buffer.from(back.rgba).equals(Buffer.from(image.rgba))).toBe(true);
  });

  test("a file that is not a PNG gets a message for the author", () => {
    expect(() => decodePng(Buffer.from("BM not a png at all"))).toThrow(
      /Save as > PNG/,
    );
  });
});

// ── Conversion ──────────────────────────────────────────────────────────────

describe("map kit: converting a drawing", () => {
  test("each palette colour becomes the generator's encoding", () => {
    const image = ringMap();
    rect(image, 0, 0, 30, 30, VOID);
    rect(image, 60, 60, 40, 40, HIGHLAND);
    rect(image, 70, 70, 20, 20, MOUNTAIN);
    const map = convertDrawing(image);
    expect(map.errors).toEqual([]);
    expect(terrainAt(map.image!, 10, 10)).toBe("void");
    expect(terrainAt(map.image!, 35, 200)).toBe("space");
    expect(terrainAt(map.image!, 50, 200)).toBe("plains");
    expect(terrainAt(map.image!, 62, 62)).toBe("highland");
    expect(terrainAt(map.image!, 80, 80)).toBe("mountain");
  });

  test("the sizing mirrors the engine's, and no circle means the default Dark Star", () => {
    const game = setup("plains", { hegemon: { enabled: true } });
    return game.then((g) => {
      const h = g.config().hegemonConfig();
      expect(DARK_STAR_SIZING).toEqual({
        domainRadiusPermille: h.domainRadiusPermille,
        moatWidthPermille: h.moatWidthPermille,
        moatMinTiles: h.moatMinTiles,
      });
      const map = convertDrawing(ringMap());
      expect(map.darkStar).toEqual({
        center: [200, 200],
        radius: 36,
        moat: 15,
        drawn: false,
      });
      // Disc and moat are open space in the picture; the engine carves them.
      expect(terrainAt(map.image!, 200, 200)).toBe("space");
      expect(terrainAt(map.image!, 200 + 50, 200)).toBe("space");
      expect(terrainAt(map.image!, 200 + 53, 200)).toBe("plains");
    });
  });

  test("a yellow circle places and sizes the Dark Star, filled or outlined", () => {
    const filled = ringMap();
    disc(filled, 150, 230, 30, STAR);
    expect(convertDrawing(filled).darkStar).toEqual({
      center: [150, 230],
      radius: 31,
      moat: 15,
      drawn: true,
    });

    const outlined = ringMap();
    disc(outlined, 150, 230, 30, STAR);
    disc(outlined, 150, 230, 26, PLAINS);
    const map = convertDrawing(outlined);
    expect(map.darkStar!.center).toEqual([150, 230]);
    expect(map.darkStar!.radius).toBe(31);
    expect(terrainAt(map.image!, 150, 230)).toBe("space");
  });

  test("a Dark Star that does not fit, or two of them, is an error", () => {
    const edge = ringMap();
    disc(edge, 30, 200, 28, STAR);
    expect(convertDrawing(edge).errors.join()).toMatch(/does not fit/);

    const two = ringMap();
    disc(two, 120, 200, 25, STAR);
    disc(two, 300, 200, 25, STAR);
    const map = convertDrawing(two);
    expect(map.errors.join()).toMatch(/2 separate yellow shapes/);
    expect(map.image).toBeNull();
  });

  test("red dots become nations at their centres, clockwise from north", () => {
    const image = ringMap();
    disc(image, 200, 80, 4, NATION); // north
    disc(image, 320, 200, 4, NATION); // east
    disc(image, 200, 330, 4, NATION); // south
    disc(image, 70, 200, 4, NATION); // west
    const map = convertDrawing(image);
    expect(map.errors).toEqual([]);
    expect(map.nations).toEqual([
      [200, 80],
      [320, 200],
      [200, 330],
      [70, 200],
    ]);
    // The dot itself is land again.
    expect(terrainAt(map.image!, 200, 80)).toBe("plains");
  });

  test("a dot just off the coast moves onto land; one far out is an error", () => {
    const near = ringMap();
    disc(near, 35, 200, 3, NATION);
    const moved = convertDrawing(near);
    expect(moved.errors).toEqual([]);
    expect(moved.nations).toEqual([[40, 200]]);

    const far = ringMap();
    disc(far, 15, 200, 3, NATION);
    const map = convertDrawing(far);
    expect(map.errors.join()).toMatch(
      /nation dot at \(15, 200\) is not on land/,
    );
  });

  test("warnings: a nation beside the Dark Star, twin dots, no nations", () => {
    const image = ringMap();
    disc(image, 200, 270, 3, NATION); // 70 from the centre; keep-out is 81
    disc(image, 80, 80, 3, NATION);
    disc(image, 95, 80, 3, NATION);
    const map = convertDrawing(image);
    expect(map.errors).toEqual([]);
    expect(map.warnings.join()).toMatch(/too close to the Dark Star/);
    expect(map.warnings.join()).toMatch(/less than 30 tiles apart/);
    expect(convertDrawing(ringMap()).warnings.join()).toMatch(
      /No red nation dots/,
    );
  });

  test("warnings: islands and patches of space too small to survive", () => {
    const image = ringMap();
    rect(image, 5, 5, 4, 4, PLAINS); // 16-tile island
    rect(image, 60, 300, 10, 10, SPACE); // 100-tile lake
    const map = convertDrawing(image);
    expect(map.errors).toEqual([]);
    expect(map.warnings.join()).toMatch(/1 island is smaller than 30 tiles/);
    expect(map.warnings.join()).toMatch(
      /1 patch of space is smaller than 200 tiles/,
    );
  });

  test("smoothed edges leave no rim of high ground or stray terrain", () => {
    // Land against void and against space, each with a two-pixel blend the
    // way a paint program's shape tools draw them. The greys between white
    // and black pass through both elevation colours.
    const image = canvas(400);
    rect(image, 40, 40, 320, 320, PLAINS);
    rect(image, 0, 0, 400, 40, VOID);
    for (let x = 0; x < 400; x++) {
      put(image, x, 39, mix(VOID, PLAINS, 0.25)); // near Gray-50%'s band
      put(image, x, 40, mix(VOID, PLAINS, 0.5)); // Gray-50% itself
      put(image, x, 41, mix(VOID, PLAINS, 0.76)); // Gray-25% itself
    }
    for (let y = 60; y < 340; y++) {
      put(image, 359, y, mix(PLAINS, SPACE, 0.3));
      put(image, 360, y, mix(PLAINS, SPACE, 0.7));
    }
    const map = convertDrawing(image);
    expect(map.errors).toEqual([]);
    let high = 0;
    for (let y = 0; y < 400; y++) {
      for (let x = 0; x < 400; x++) {
        const t = terrainAt(map.image!, x, y);
        if (t === "highland" || t === "mountain") high++;
      }
    }
    expect(high).toBe(0);
    expect(terrainAt(map.image!, 100, 30)).toBe("void");
    expect(terrainAt(map.image!, 100, 50)).toBe("plains");
    expect(terrainAt(map.image!, 365, 200)).toBe("space");
  });

  test("high ground three pixels thick survives; a hairline does not", () => {
    const image = ringMap();
    rect(image, 60, 60, 3, 40, HIGHLAND);
    rect(image, 100, 60, 1, 40, HIGHLAND);
    const map = convertDrawing(image);
    expect(terrainAt(map.image!, 61, 80)).toBe("highland");
    expect(terrainAt(map.image!, 100, 80)).toBe("plains");
  });

  test("colours outside the palette are reported and take their neighbours' terrain", () => {
    const image = ringMap();
    rect(image, 60, 60, 80, 80, [34, 177, 76]); // Paint's green
    const map = convertDrawing(image);
    expect(map.errors).toEqual([]);
    expect(map.warnings.join()).toMatch(/rgb\(34, 177, 76\) on 6400 pixels/);
    expect(terrainAt(map.image!, 100, 100)).toBe("plains");
  });

  test("the size is cropped to a multiple of four; too small is an error", () => {
    const image = canvas(403);
    rect(image, 40, 40, 320, 320, PLAINS);
    const map = convertDrawing(image);
    expect(map.image!.width).toBe(400);
    expect(map.image!.height).toBe(400);
    expect(map.notes.join()).toMatch(/Cropped from 403 x 403 to 400 x 400/);
    expect(convertDrawing(canvas(120)).errors.join()).toMatch(/at least 200/);
  });

  test("a drawing with no land is an error", () => {
    expect(convertDrawing(canvas(400)).errors.join()).toMatch(/no land/);
  });

  test("the template is a valid start: all space, the default Dark Star drawn", () => {
    const template = templateDrawing(400);
    rect(template, 40, 40, 100, 320, PLAINS);
    const map = convertDrawing(template);
    expect(map.errors).toEqual([]);
    const standard = defaultDarkStar(400, 400);
    expect(map.darkStar!.drawn).toBe(true);
    expect(map.darkStar!.center).toEqual(standard.center);
    expect(
      Math.abs(map.darkStar!.radius - standard.radius),
    ).toBeLessThanOrEqual(1);
  });
});

// ── info.json ───────────────────────────────────────────────────────────────

describe("map kit: info.json", () => {
  test("the file name gives the id, the folder and the translation key", () => {
    expect(mapIdentity("  twin   suns ")).toEqual({
      name: "twin suns",
      id: "TwinSuns",
      folder: "twinsuns",
    });
    expect(mapIdentity("Rift 9")).toEqual({
      name: "Rift 9",
      id: "Rift9",
      folder: "rift9",
    });
    expect(() => mapIdentity("9 Lives")).toThrow(/cannot be a map name/);
    expect(() => mapIdentity("Twin-Suns")).toThrow(/cannot be a map name/);
  });

  test("a kit map cannot shadow an existing map's id by accident", () => {
    // The CLI refuses when the folder holds a map of another name; the
    // identity of a shipped map is stable under the same rule.
    const horizon = mapIdentity("Event Horizon");
    expect(horizon.id).toBe("EventHorizon");
    expect(GameMapType.EventHorizon).toBe(horizon.name);
  });

  test("nation names are unique, repeatable, and differ between maps", () => {
    const spawns = Array.from(
      { length: 60 },
      (_, i) => [i * 50, 0] as [number, number],
    );
    const a = nameNations("TwinSuns", spawns, []).map((n) => n.name);
    expect(new Set(a).size).toBe(60);
    expect(nameNations("TwinSuns", spawns, []).map((n) => n.name)).toEqual(a);
    const b = nameNations("Rift9", spawns, []).map((n) => n.name);
    expect(b).not.toEqual(a);
  });

  test("a map's Lords draw on the shared pool: a few fixed names among star + polity pairs", () => {
    const spawns = Array.from(
      { length: 24 },
      (_, i) => [i * 50, 0] as [number, number],
    );
    const names = nameNations("EventHorizon", spawns, []).map((n) => n.name);
    const fixed = names.filter((n) => lordNames.names.includes(n));
    expect(fixed.length).toBeGreaterThan(0);
    expect(fixed.length).toBeLessThan(names.length);
    for (const name of names) {
      if (lordNames.names.includes(name)) continue;
      const ok = lordNames.stars.some(
        (s) =>
          name.startsWith(`${s} `) &&
          lordNames.polities.includes(name.slice(s.length + 1)),
      );
      expect(ok, name).toBe(true);
    }
  });

  test("a rebuilt map keeps hand-edited names for nations that barely moved", () => {
    const previous = [
      {
        coordinates: [100, 100] as [number, number],
        name: "Tom's Empire",
        flag: "",
      },
      { coordinates: [300, 300] as [number, number], name: "Gone", flag: "" },
    ];
    const named = nameNations(
      "TwinSuns",
      [
        [110, 95], // the first nation, nudged
        [500, 500], // a new one
      ],
      previous,
    );
    expect(named[0]).toEqual({
      coordinates: [110, 95],
      name: "Tom's Empire",
      flag: "",
    });
    expect(named[1].name).not.toBe("Gone");
    expect(named[1].name).not.toBe("Tom's Empire");
  });

  test("the info carries the Dark Star and nations, and keeps settings edited by hand", () => {
    const image = ringMap();
    disc(image, 200, 80, 4, NATION);
    const map = convertDrawing(image);
    const fresh = buildInfo(mapIdentity("Twin Suns"), map, null);
    expect(fresh).toMatchObject({
      id: "TwinSuns",
      name: "Twin Suns",
      translation_key: "map.twinsuns",
      categories: ["cosmic"],
      multiplayer_frequency: 4,
      themes: ["space"],
      hegemon: { center: [200, 200], radius: 36, moat: 15 },
    });
    expect((fresh.nations as unknown[]).length).toBe(1);

    const rebuilt = buildInfo(mapIdentity("Twin Suns"), map, {
      ...fresh,
      multiplayer_frequency: 9,
      display_name: "Twin Suns (Classic)",
      hegemon: { center: [1, 1], radius: 5 },
    });
    expect(rebuilt.multiplayer_frequency).toBe(9);
    expect(rebuilt.display_name).toBe("Twin Suns (Classic)");
    expect(rebuilt.hegemon).toEqual({
      center: [200, 200],
      radius: 36,
      moat: 15,
    });
    expect(rebuilt.nations).toEqual(fresh.nations);
  });
});
