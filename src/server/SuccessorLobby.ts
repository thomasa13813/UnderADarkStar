import { GameConfig } from "../core/Schemas";

// Under a Dark Star, P0: what a successor lobby ("New lobby" from the win
// screen) inherits from the finished round. Everything the host set carries
// over except identities that belong to the old lobby: name reveals are the
// old game's clientIDs, and the throne's seat is re-resolved from the round's
// winner — the heir — when they join the new lobby (GameServer.seatHeir).
export function successorConfig(previous: GameConfig): Partial<GameConfig> {
  const config: Partial<GameConfig> = { ...previous };
  delete config.nameReveals;
  if (previous.hegemon !== undefined) {
    config.hegemon = { enabled: previous.hegemon.enabled };
  }
  return config;
}
