// Verify the Stargate on the quick-build hotbar (UnitDisplay) in a Dark Star game.
import fs from "fs";
import { gotoHome, launch, openSoloModal } from "./driver.mjs";
import { spawn, startSoloGame, waitForGameReady } from "./game.mjs";

const OUT = process.env.OUT ?? "out/browser";
fs.mkdirSync(OUT, { recursive: true });

const { browser, page } = await launch();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await gotoHome(page);
await openSoloModal(page);
await startSoloGame(page, {
  bots: 10,
  map: "Event Horizon",
  instantBuild: true,
  infiniteGold: true,
});
await page.waitForTimeout(4000);
await waitForGameReady(page);
await spawn(page);
await page.waitForFunction(
  () => {
    const g = document.querySelector("build-menu")?.game;
    return g && !g.inSpawnPhase();
  },
  undefined,
  { timeout: 120_000, polling: 500 },
);
await page.waitForTimeout(3000);

const read = () =>
  page.evaluate(() => {
    const ud = document.querySelector("unit-display");
    const tiles = [...ud.querySelectorAll("img[alt]")].map((img) => {
      const tile = img.closest(".flex.flex-col");
      return {
        alt: img.alt,
        text: tile?.innerText.replace(/\s+/g, " ").trim(),
      };
    });
    const bm = document.querySelector("build-menu");
    return {
      tiles,
      ghost: bm.uiState.ghostStructure,
      samDisabled: bm.game.config().isUnitDisabled("SAM Launcher"),
    };
  });
let before;
for (let i = 0; ; i++) {
  try {
    before = await read();
    break;
  } catch (e) {
    if (i >= 3) throw e;
    await page.waitForTimeout(3000);
    await waitForGameReady(page);
  }
}
console.log("tiles:", JSON.stringify(before.tiles));
console.log("samDisabled:", before.samDisabled, "ghost before:", before.ghost);

await page.locator("unit-display").screenshot({ path: `${OUT}/hotbar.png` });

await page.keyboard.press("Digit6");
await page.waitForTimeout(500);
const afterKey = await read();
console.log("ghost after Digit6:", afterKey.ghost);
await page
  .locator("unit-display")
  .screenshot({ path: `${OUT}/hotbar-selected.png` });

// Click the tile: with the gate selected this deselects it.
await page.locator('unit-display img[alt="stargate"]').click();
await page.waitForTimeout(300);
console.log("ghost after clicking tile:", (await read()).ghost);
await page.locator('unit-display img[alt="stargate"]').hover();
await page.waitForTimeout(400);
await page.screenshot({
  path: `${OUT}/hotbar-tooltip.png`,
  clip: { x: 0, y: 500, width: 1280, height: 220 },
});
await browser.close();
