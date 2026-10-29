import { ThroneInfo } from "../core/Schemas";

// Under a Dark Star: what this tab knows about the throne its current game
// runs for (docs/DarkStar-Lobbies.md §6). The lobby info carries the throne
// until the game starts; the HUD (the Dark Star panel) and the win screen need
// it afterwards, when no lobby info arrives any more. The game runner keeps it
// here per join; a new join clears it.

let throne: ThroneInfo | undefined;
// This tab asked to play a room's round in its last 3 minutes and watches
// instead (docs/DarkStar-Lobbies.md L48): the round's successor takes it.
let heldForNextRound = false;

export function isHeldForNextRound(): boolean {
  return heldForNextRound;
}

export function setHeldForNextRound(held: boolean): void {
  heldForNextRound = held;
}

export function currentThrone(): ThroneInfo | undefined {
  return throne;
}

export function setCurrentThrone(info: ThroneInfo | undefined): void {
  throne = info;
}

export function resetThroneState(): void {
  throne = undefined;
  heldForNextRound = false;
}
