import { ThroneInfo } from "../core/Schemas";

// Under a Dark Star: what this tab knows about the throne its current game
// runs for (docs/DarkStar-Lobbies.md §6). The lobby info carries the throne
// until the game starts; the HUD (the Dark Star panel) and the win screen need
// it afterwards, when no lobby info arrives any more. The game runner keeps it
// here per join; a new join clears it.

let throne: ThroneInfo | undefined;

export function currentThrone(): ThroneInfo | undefined {
  return throne;
}

export function setCurrentThrone(info: ThroneInfo | undefined): void {
  throne = info;
}

export function resetThroneState(): void {
  throne = undefined;
}
