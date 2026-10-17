// Under a Dark Star: the reign counter on screen (docs/DarkStar-Lobbies.md
// §3.1, docs/DarkStar-Accounts.md §5.4). The badge on a throne card counts
// consecutive wins on one throne: the win that takes a throne is 1, and each
// timer win after it adds 1. This one function gives the number on screen
// (ThroneRegistry) and the `reign_after` the API keeps on each round. The
// leaderboard's reigns and longest reign count rounds actually played as
// Hegemon instead (Accounts §5.4, `hegemonRun` in the ingest): a throne
// declined is a victory and nothing more.

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
