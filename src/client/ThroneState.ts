import { ThroneInfo } from "../core/Schemas";

// Under a Dark Star: what this tab knows about the throne its current game
// runs for (docs/DarkStar-Lobbies.md §6). The lobby info carries the throne
// until the game starts; the HUD (the Dark Star panel) and the win screen need
// it afterwards, when no lobby info arrives any more. The game runner keeps it
// here per join; a new join clears it.

let throne: ThroneInfo | undefined;
// Whether the round just played was won by this client (the win screen sets
// it): the new-lobby announcement then belongs to the winner's Next-round
// panel, not to the join prompt everyone else gets.
let wonRound = false;

export function currentThrone(): ThroneInfo | undefined {
  return throne;
}

export function setCurrentThrone(info: ThroneInfo | undefined): void {
  throne = info;
}

export function setWonRound(won: boolean): void {
  wonRound = won;
}

export function didWinRound(): boolean {
  return wonRound;
}

export function resetThroneState(): void {
  throne = undefined;
  wonRound = false;
}
