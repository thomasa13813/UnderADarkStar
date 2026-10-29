import { dropInCutoffTurn } from "../core/DropIn";
import { GameConfig } from "../core/Schemas";

// Under a Dark Star: whether a player arriving at a running round of a room
// may drop into it (docs/DarkStar-Lobbies.md L33, L36, L43, L48). Pure, so
// every case is table-testable; GameServer feeds it the room's state.
//
//   join  — a player from now: the server issues join_round (L36).
//   held  — the round's last 3 minutes: an observer, shown that the next
//           round starts after this one, and placed in its lobby (L48).
//   full  — the room holds its cap of humans (L33): watch only.
//   null  — not a room, or a round drop-in does not apply to (it is over,
//           piracy is off, names are hidden): today's late-joiner rules.

export type DropInVerdict = "join" | "held" | "full";

export interface DropInState {
  // The game runs for a public room (a throne).
  isRoom: boolean;
  config: GameConfig;
  // Turns played so far: one per tick.
  turns: number;
  // Connected humans playing (spectators excluded).
  players: number;
  // The round has a winner, or the game ended.
  over: boolean;
}

export function dropInVerdict(state: DropInState): DropInVerdict | null {
  const { config } = state;
  if (!state.isRoom || state.over) return null;
  if (config.piracy?.enabled !== true || config.anonymizeNames === true) {
    return null;
  }
  if (state.turns >= dropInCutoffTurn(config)) return "held";
  if (config.maxPlayers !== undefined && state.players >= config.maxPlayers) {
    return "full";
  }
  return "join";
}
