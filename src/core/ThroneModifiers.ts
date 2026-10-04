// Under a Dark Star: what the winner of a round on a special throne may set
// for the next round (docs/DarkStar-Lobbies.md §5.4, L7). Shared by the
// server, which validates the pick, and the client, which offers the chips.
//
// Tom's rule: nothing that tilts the round toward the throne. The held-back
// modifiers (startingGold25M, isDoomsdayClock, isNukesDisabled) wait for a
// balance pass after the first public playtests; isSAMsDisabled and
// isWaterNukes are moot under a Dark Star (SAMs and silos are off, S6).

export const THRONE_MODIFIER_WHITELIST = [
  "isRandomSpawn",
  "isCompact",
  "isCrowded",
  "isHardNations",
  "startingGold1M",
  "startingGold5M",
  "goldMultiplier",
  "isAlliancesDisabled",
  "isPeaceTime",
] as const;

export type ThroneModifier = (typeof THRONE_MODIFIER_WHITELIST)[number];

// At most this many per pick (L7).
export const THRONE_MAX_MODIFIERS = 2;

// Pairs that cannot be active together, restricted to the whitelist. The
// playlist's full exclusivity table is the source; a server test checks that
// every pair of it inside the whitelist is listed here.
export const THRONE_EXCLUSIVE_PAIRS: readonly [
  ThroneModifier,
  ThroneModifier,
][] = [["startingGold1M", "startingGold5M"]];

export function isThroneModifier(key: string): key is ThroneModifier {
  return (THRONE_MODIFIER_WHITELIST as readonly string[]).includes(key);
}

export function throneModifiersConflict(
  a: ThroneModifier,
  b: ThroneModifier,
): boolean {
  return THRONE_EXCLUSIVE_PAIRS.some(
    ([x, y]) => (a === x && b === y) || (a === y && b === x),
  );
}

// The winner's modifier pick, checked: every key on the whitelist, no
// repeats, at most THRONE_MAX_MODIFIERS, no exclusive pair. null when any
// rule fails (the client's picker cannot produce such a pick, so it is a
// protocol error and the random roll stands, §8).
export function validateThroneModifiers(
  keys: readonly string[],
): ThroneModifier[] | null {
  if (keys.length > THRONE_MAX_MODIFIERS) return null;
  const picked: ThroneModifier[] = [];
  for (const key of keys) {
    if (!isThroneModifier(key) || picked.includes(key)) return null;
    if (picked.some((other) => throneModifiersConflict(other, key))) {
      return null;
    }
    picked.push(key);
  }
  return picked;
}
