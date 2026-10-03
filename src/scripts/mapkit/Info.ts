import { ConvertedMap } from "./Convert";

// The map kit's info.json writer (docs/MapMaking.md): the map's identity from
// the drawing's file name, the Dark Star and the nations from the drawing,
// and names for the nations.

export interface MapIdentity {
  /** The canonical name, e.g. "Twin Suns" (the GameMapType value). */
  name: string;
  /** UpperCamelCase, e.g. "TwinSuns" (the GameMapType key). */
  id: string;
  /** The folder under map-generator/assets/maps, e.g. "twinsuns". */
  folder: string;
}

/**
 * A map's identity from its display name. Throws an Error with a message for
 * the author when the name cannot be used.
 */
export function mapIdentity(displayName: string): MapIdentity {
  const name = displayName.trim().replace(/\s+/g, " ");
  if (!/^[A-Za-z][A-Za-z0-9 ]*$/.test(name)) {
    throw new Error(
      `"${displayName}" cannot be a map name. Use letters, digits and spaces, starting with a letter.`,
    );
  }
  const id = name
    .split(" ")
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
  return { name, id, folder: id.toLowerCase() };
}

const STARS = [
  "Orion",
  "Vega",
  "Tau Ceti",
  "Kepler",
  "Rigel",
  "Cygnus",
  "Lyra",
  "Draco",
  "Sirius",
  "Altair",
  "Procyon",
  "Aldebaran",
  "Deneb",
  "Antares",
  "Fomalhaut",
  "Arcturus",
  "Capella",
  "Betelgeuse",
  "Polaris",
  "Spica",
  "Regulus",
  "Canopus",
  "Andromeda",
  "Perseus",
  "Achernar",
  "Bellatrix",
  "Castor",
  "Pollux",
  "Mira",
  "Hadar",
  "Mizar",
  "Alcyone",
  "Izar",
  "Wezen",
  "Gienah",
  "Sabik",
  "Naos",
  "Kochab",
  "Thuban",
  "Zosma",
  "Algol",
  "Merak",
  "Saiph",
  "Tarazed",
  "Vindemiatrix",
  "Rasalhague",
  "Eltanin",
  "Menkar",
];

const POLITIES = [
  "Combine",
  "Ascendancy",
  "Concord",
  "Directorate",
  "Syndicate",
  "Dominion",
  "Commonwealth",
  "Protectorate",
  "Republic",
  "Mandate",
  "Free Worlds",
  "Sovereignty",
  "Collective",
  "Crown",
  "Assembly",
  "Covenant",
  "Trade League",
  "Marches",
  "Order",
  "Confederation",
  "Authority",
  "Union",
  "Compact",
  "Reach",
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

function shuffled<T>(items: T[], rand: () => number): T[] {
  const a = items.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** An endless, repeat-free supply of nation names, different for each map. */
function* nationNames(mapId: string): Generator<string> {
  const rand = mulberry32(hash(mapId));
  const stars = shuffled(STARS, rand);
  const polities = shuffled(POLITIES, rand);
  // Each pass pairs every star with a different polity than the last pass.
  for (let pass = 0; ; pass++) {
    for (let i = 0; i < stars.length; i++) {
      yield `${stars[i]} ${polities[(i + pass * 7) % polities.length]}`;
    }
  }
}

export interface NationEntry {
  coordinates: [number, number];
  name: string;
  flag: string;
}

// How far a nation dot may move between builds and keep its name.
const SAME_NATION_DISTANCE = 40;

/**
 * Names for the nations of a converted drawing. A nation within 40 tiles of
 * one in the previous info.json keeps that nation's name (and flag), so names
 * edited by hand survive a rebuild; the rest draw new names.
 */
export function nameNations(
  mapId: string,
  spawns: [number, number][],
  previous: NationEntry[],
): NationEntry[] {
  const kept = new Map<number, NationEntry>();
  const claimed = new Set<number>();
  // Closest pairs first, so two dots near one old nation resolve sensibly.
  const pairs: { spawn: number; old: number; d: number }[] = [];
  spawns.forEach((p, spawn) => {
    previous.forEach((n, old) => {
      if (!Array.isArray(n.coordinates)) return;
      const d = Math.hypot(n.coordinates[0] - p[0], n.coordinates[1] - p[1]);
      if (d <= SAME_NATION_DISTANCE) pairs.push({ spawn, old, d });
    });
  });
  pairs.sort((a, b) => a.d - b.d);
  for (const pair of pairs) {
    if (kept.has(pair.spawn) || claimed.has(pair.old)) continue;
    kept.set(pair.spawn, previous[pair.old]);
    claimed.add(pair.old);
  }
  const used = new Set([...kept.values()].map((n) => n.name));
  const fresh = nationNames(mapId);
  return spawns.map((p, i) => {
    const old = kept.get(i);
    if (old !== undefined) {
      return { coordinates: p, name: old.name, flag: old.flag ?? "" };
    }
    let name = fresh.next().value as string;
    while (used.has(name)) name = fresh.next().value as string;
    used.add(name);
    return { coordinates: p, name, flag: "" };
  });
}

/**
 * The info.json for a converted drawing. Fields of a previous info.json that
 * the kit does not own (frequencies, a display name, custom tribes) are kept.
 */
export function buildInfo(
  identity: MapIdentity,
  converted: ConvertedMap,
  previous: Record<string, unknown> | null,
): Record<string, unknown> {
  if (converted.darkStar === null) {
    throw new Error("buildInfo needs a converted map with a Dark Star");
  }
  const previousNations = Array.isArray(previous?.nations)
    ? (previous.nations as NationEntry[])
    : [];
  const owned = new Set([
    "id",
    "name",
    "translation_key",
    "hegemon",
    "nations",
  ]);
  const rest = Object.fromEntries(
    Object.entries(previous ?? {}).filter(([key]) => !owned.has(key)),
  );
  return {
    id: identity.id,
    name: identity.name,
    translation_key: `map.${identity.folder}`,
    categories: ["cosmic"],
    multiplayer_frequency: 4,
    themes: ["space"],
    ...rest,
    hegemon: {
      center: converted.darkStar.center,
      radius: converted.darkStar.radius,
      moat: converted.darkStar.moat,
    },
    nations: nameNations(identity.id, converted.nations, previousNations),
  };
}
