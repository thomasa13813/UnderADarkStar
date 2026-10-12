// Under a Dark Star: the reign counter (docs/DarkStar-Lobbies.md §3.1,
// docs/DarkStar-Accounts.md §5.4). A reign is the run of consecutive rounds
// a player has held one throne: the win that takes a throne is 1, and each
// timer win after it adds 1. This one function gives the number on screen
// (ThroneRegistry) and the number on the board (the API's results ingest),
// so the two cannot disagree.

// How a throne round ended. `overthrown`: a challenger landed the killing
// blow. `timer`: the Hegemon held to the end. `ai`: the AI Hegemon outlasted
// the round, or a nation landed the killing blow. `void`: no winner at all.
export type ReignOutcome = "overthrown" | "timer" | "ai" | "void";

// The winner's reign after a round. `reignBefore` is the reign the winner
// brought into the round as the seated Hegemon: 0 for a challenger, for a
// claimant who took an open seat in the lobby, and for the AI.
export function nextReign(outcome: ReignOutcome, reignBefore: number): number {
  switch (outcome) {
    case "overthrown":
      return 1;
    case "timer":
      return Math.max(0, Math.floor(reignBefore)) + 1;
    case "ai":
    case "void":
      return 0;
  }
}
