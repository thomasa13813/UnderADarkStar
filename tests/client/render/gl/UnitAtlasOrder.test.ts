/**
 * The unit atlas and UnitPass's column order must agree: the shader divides
 * the atlas into UNIT_ORDER.length columns, so one extra or missing entry
 * shifts every unit's sprite sampling (2026-10-23: a duplicated army entry
 * drew armies as the projectile glyph and nudged every other unit sideways).
 */

import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { UNIT_ORDER } from "../../../../src/client/render/gl/passes/UnitPass";

const UNIT_CELL = 13;

function pngSize(file: string): { width: number; height: number } {
  const buf = fs.readFileSync(file);
  // IHDR: width and height, big-endian, right after the signature and chunk header.
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe("unit atlas column order", () => {
  it("lists every column once", () => {
    expect(new Set(UNIT_ORDER).size).toBe(UNIT_ORDER.length);
  });

  it("has exactly as many columns as the generated atlas", () => {
    const { width, height } = pngSize(
      path.join(__dirname, "../../../../resources/atlases/unit-atlas.png"),
    );
    expect(height).toBe(UNIT_CELL);
    expect(width).toBe(UNIT_ORDER.length * UNIT_CELL);
  });
});
