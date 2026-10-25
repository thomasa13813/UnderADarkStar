// Under a Dark Star: the name this browser joined its current lobby with.
//
// The server masks offensive words in a name for everyone (the name filter,
// src/server/Censor.ts, B6), the player's own lobby entry included. The
// player is never told: their own row shows the name they typed. GameView
// does the same for the round from the name it is handed at start; this
// carries the name to the lobby list, which only sees the server's copy.

let ownName: { username: string; clanTag: string | null } | null = null;

export function setOwnJoinName(username: string, clanTag: string | null) {
  ownName = { username, clanTag };
}

export function ownJoinName(): {
  username: string;
  clanTag: string | null;
} | null {
  return ownName;
}
