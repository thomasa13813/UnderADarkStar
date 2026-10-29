import { Config, HEGEMON_DEFAULTS } from "./configuration/Config";
import { GameConfig } from "./Schemas";

// Under a Dark Star: no drop-in in a room round's last 3 minutes
// (docs/DarkStar-Lobbies.md L48). Shared by the server, which decides
// (src/server/DropIn.ts), and the client, which says so to a watcher.
export const DROP_IN_CUTOFF_TURNS = 3 * 60 * 10;

// The turn (one per tick) after which nobody drops in: the round's timer
// ends at about the spawn phase plus the round's minutes. The opening (a few
// seconds of flights) is left out, so the cutoff falls that much early,
// never late.
export function dropInCutoffTurn(config: GameConfig): number {
  const spawnTurns = new Config(config, null, false).numSpawnPhaseTurns();
  const minutes = config.maxTimerValue ?? HEGEMON_DEFAULTS.defaultRoundMinutes;
  return spawnTurns + minutes * 60 * 10 - DROP_IN_CUTOFF_TURNS;
}
