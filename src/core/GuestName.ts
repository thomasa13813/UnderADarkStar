// Under a Dark Star: the name a guest plays under (docs/DarkStar-Accounts.md
// §4.4, decision A21). A guest cannot choose a name: the game server replaces
// whatever the browser sent with "Anon" plus five digits worked out from the
// guest's browser ID, so the same guest is the same Anon48213 from game to
// game, and the name cannot be forged by editing the page. The client shows
// the same name where the name box would be, so it needs the same function,
// which is why this lives in core. Pure integer arithmetic (FNV-1a, 32-bit):
// no floating point, deterministic everywhere.

export const GUEST_NAME_PREFIX = "Anon";
const GUEST_NAME_DIGITS = 5;
// 10 to the power of GUEST_NAME_DIGITS, written out: `**` is banned in core.
const GUEST_NAME_MODULUS = 100000;

export function guestName(persistentId: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < persistentId.length; i++) {
    hash ^= persistentId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const digits = (hash % GUEST_NAME_MODULUS)
    .toString()
    .padStart(GUEST_NAME_DIGITS, "0");
  return `${GUEST_NAME_PREFIX}${digits}`;
}

// Whether a name has the shape the server assigns to guests. Shape only: a
// signed-in player may type such a name for a round, so this is a hint for
// the client's display, never a proof of guesthood.
export function isGuestName(name: string): boolean {
  return new RegExp(`^${GUEST_NAME_PREFIX}\\d{${GUEST_NAME_DIGITS}}$`).test(
    name,
  );
}
