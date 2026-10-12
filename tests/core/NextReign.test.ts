import { describe, expect, it } from "vitest";
import { nextReign } from "../../src/core/Reign";

// Under a Dark Star: the one reign rule the throne registry and the results
// ingest share (docs/DarkStar-Accounts.md §5.4).
describe("nextReign", () => {
  it("starts a reign at 1 for a challenger who overthrows the Hegemon", () => {
    expect(nextReign("overthrown", 0)).toBe(1);
    // Whatever the fallen Hegemon's reign was, the slayer starts afresh.
    expect(nextReign("overthrown", 7)).toBe(1);
  });

  it("extends the sitting Hegemon's reign by one on a timer win", () => {
    expect(nextReign("timer", 0)).toBe(1); // a claimant who took an open seat
    expect(nextReign("timer", 1)).toBe(2);
    expect(nextReign("timer", 11)).toBe(12);
  });

  it("gives nothing for a void round or an AI win", () => {
    expect(nextReign("void", 0)).toBe(0);
    expect(nextReign("void", 5)).toBe(0);
    expect(nextReign("ai", 0)).toBe(0);
    expect(nextReign("ai", 3)).toBe(0);
  });

  it("tolerates a malformed reign going in", () => {
    expect(nextReign("timer", -4)).toBe(1);
    expect(nextReign("timer", 2.9)).toBe(3);
  });
});
