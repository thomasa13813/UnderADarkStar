// Screenshots of the deep-space look (starfield under translucent space) on
// Event Horizon at three zooms, once per graphics-override variant. Usage:
//   node .claude/skills/run-openfront/space-shots.mjs <outDir>
import { gotoHome, launch, openSoloModal } from "./driver.mjs";
import { panTo, spawn, startSoloGame, waitForGameReady } from "./game.mjs";

const out = process.argv[2] ?? "./space-shots";
// Add entries to compare looks, e.g. { terrain: { oceanAlpha: 0.7 } }.
const variants = {
  starfield: {}, // the defaults
};

for (const [name, overrides] of Object.entries(variants)) {
  const { browser, page } = await launch({
    viewport: { width: 1600, height: 900 },
  });
  page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
  page.on("console", (m) => {
    if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 400));
  });
  // UserSettings reads localStorage on first use, so seed it before load.
  await page.addInitScript((o) => {
    localStorage.setItem("settings.graphics", JSON.stringify(o));
  }, overrides);
  await gotoHome(page);
  await openSoloModal(page);
  await startSoloGame(page, { bots: 10, map: "Event Horizon" });
  await page.waitForTimeout(4000);
  await waitForGameReady(page);
  const home = await spawn(page);
  await page.waitForTimeout(3000);

  const shot = async (label) => {
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${out}/${name}-${label}.png` });
    console.log("wrote", `${name}-${label}`);
  };
  await page.evaluate(() => {
    const th = document.querySelector("build-menu").transformHandler;
    th.clearTarget();
    th.centerAll(0.95);
  });
  await shot("overview");
  // Close-ups around the player's spawn (land, shore and deep space).
  await panTo(page, home.x, home.y);
  await page.mouse.move(800, 450);
  for (let i = 0; i < 5; i++) {
    await page.mouse.wheel(0, -250);
    await page.waitForTimeout(100);
  }
  await shot("mid");
  for (let i = 0; i < 6; i++) {
    await page.mouse.wheel(0, -250);
    await page.waitForTimeout(100);
  }
  await shot("close");
  await browser.close();
}
