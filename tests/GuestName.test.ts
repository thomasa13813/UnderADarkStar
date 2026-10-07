import { describe, expect, it } from "vitest";
import { guestName, isGuestName } from "../src/core/GuestName";

// Under a Dark Star, A21: a guest's name is Anon plus five digits worked out
// from their browser ID, the same every time, different for different IDs.

describe("guestName", () => {
  it("is stable for one ID and shaped Anon#####", () => {
    const id = "123e4567-e89b-12d3-a456-426614174000";
    const name = guestName(id);
    expect(name).toMatch(/^Anon\d{5}$/);
    expect(guestName(id)).toBe(name);
    expect(isGuestName(name)).toBe(true);
  });

  it("differs between IDs and keeps leading zeros", () => {
    const a = guestName("123e4567-e89b-12d3-a456-426614174000");
    const b = guestName("123e4567-e89b-12d3-a456-426614174001");
    expect(a).not.toBe(b);
    // Every result has exactly five digits, whatever the hash.
    for (let i = 0; i < 200; i++) {
      expect(guestName(`id-${i}`)).toMatch(/^Anon\d{5}$/);
    }
  });

  it("recognises only the assigned shape", () => {
    expect(isGuestName("Anon00042")).toBe(true);
    expect(isGuestName("Anon4242")).toBe(false);
    expect(isGuestName("AnonBunny7")).toBe(false);
    expect(isGuestName("Tom")).toBe(false);
  });
});
