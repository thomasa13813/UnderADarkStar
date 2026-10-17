import { lordNameSupply } from "../../core/game/NationCreation";
import { PseudoRandom } from "../../core/PseudoRandom";
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

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

/**
 * Names for a map's Lords, from the one pool the game uses
 * (src/core/game/NationCreation.ts), in an order fixed by the map's name.
 * They label the Lords in info.json; at game start every Lord is named afresh
 * from the same pool.
 */
function nationNames(mapId: string): Generator<string> {
  return lordNameSupply(new PseudoRandom(hash(mapId)));
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
 * one in the previous info.json keeps that nation's name (and flag), so an
 * info.json edited by hand survives a rebuild; the rest draw new names. The
 * game ignores these at game start and names every Lord from the pool.
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
