// Reinforce the throne (H9) in the real client: play a challenger on Event
// Horizon against the AI Hegemon, right-click the Dark Star, and check the
// radial menu's ally slot is the reinforcement, with its tooltip.
//   node .claude/skills/run-openfront/reinforce.mjs [--out DIR]
import fs from "fs";
import { gotoHome, launch, openSoloModal } from "./driver.mjs";
import {
  clickWorld,
  panTo,
  spawn,
  startSoloGame,
  waitForGameReady,
} from "./game.mjs";

const oi = process.argv.indexOf("--out");
const OUT =
  oi >= 0
    ? process.argv[oi + 1]
    : "<scratchpad>/8d83e349-ae61-4036-8781-cedc7b5ec36e/scratchpad/browser";
fs.mkdirSync(OUT, { recursive: true });

const { browser, page } = await launch();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await gotoHome(page);
await openSoloModal(page);
await startSoloGame(page, { bots: 10, map: "Event Horizon" });
await page.waitForTimeout(4000);
await waitForGameReady(page);
await spawn(page);
await page.waitForFunction(
  () => {
    const g = document.querySelector("build-menu")?.game;
    return g && !g.inSpawnPhase() && !g.inOpening();
  },
  undefined,
  { timeout: 120_000, polling: 500 },
);
await page.waitForTimeout(3000);
await waitForGameReady(page);

// A Hegemon-owned land tile near the Dark Star's centre.
const target = await page.evaluate(() => {
  const g = document.querySelector("build-menu").game;
  const d = g.darkStar();
  for (let r = 0; r < 40; r++) {
    for (const [dx, dy] of [
      [r, 0],
      [-r, 0],
      [0, r],
      [0, -r],
    ]) {
      const x = d.cx + dx;
      const y = d.cy + dy;
      const t = g.ref(x, y);
      if (!g.isLand(t) || !g.hasOwner(t)) continue;
      const o = g.owner(t);
      if (o.isPlayer() && o.isHegemon()) {
        return { x, y, throne: o.name(), troops: o.troops() };
      }
    }
  }
  return null;
});
console.log("target:", JSON.stringify(target));
if (target === null) throw new Error("no Hegemon tile found");

await panTo(page, target.x, target.y);
await page.waitForTimeout(500);
await clickWorld(page, target.x, target.y, "right");
await page.waitForTimeout(1000);

const menu = await page.evaluate(() => {
  const c = document.querySelector(".radial-menu-container");
  const open = c !== null && c.style.display !== "none";
  const items = Array.from(
    document.querySelectorAll(".menu-item-content[data-id]"),
  ).map((el) => ({
    id: el.getAttribute("data-id"),
    icon: (el.querySelector("image")?.getAttribute("href") ?? "")
      .split("/")
      .pop(),
  }));
  const path = document.querySelector('.menu-item-path[data-id="ally"]');
  let tooltip = null;
  let fill = null;
  if (path) {
    fill = path.getAttribute("fill");
    path.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    const tt = document.querySelector(".radial-tooltip");
    tooltip = tt ? Array.from(tt.children).map((d) => d.textContent) : null;
  }
  const me = document.querySelector("build-menu").game.myPlayer();
  return { open, items, fill, tooltip, myTroops: me.troops() };
});
console.log("menu:", JSON.stringify(menu, null, 2));
await page.screenshot({ path: `${OUT}/reinforce-radial.png` });
console.log("screenshot:", `${OUT}/reinforce-radial.png`);
await browser.close();
