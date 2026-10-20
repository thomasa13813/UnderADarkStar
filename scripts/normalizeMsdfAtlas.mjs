// Brings a fresh msdf-bmfont atlas onto the old one's vertical convention
// (baseline at y=36 for a 48px face) and swaps in fontTools' kerning.
import fs from "node:fs";
const [src, kernPath, outPath] = process.argv.slice(2);
const a = JSON.parse(fs.readFileSync(src, "utf8"));
const pad = a.info.padding[0];
const A = a.chars.find((c) => c.char === "A");
const BASE = 36;
const delta = BASE - (A.yoffset + A.height - pad);
for (const c of a.chars) c.yoffset += delta;
a.common.base = BASE;
a.common.lineHeight = 48;
a.kernings = JSON.parse(fs.readFileSync(kernPath, "utf8"));
a.info.face = "tektur-bold";
a.pages = ["tektur-bold.png"];
fs.writeFileSync(outPath, JSON.stringify(a));
console.log(
  "delta",
  delta,
  "chars",
  a.chars.length,
  "kernings",
  a.kernings.length,
);
