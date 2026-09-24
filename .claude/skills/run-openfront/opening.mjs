// Watch the opening (C3) on Event Horizon: start a solo game, spawn, and
// record the flights, the hidden owners and the camera while immunity runs.
//   node .claude/skills/run-openfront/opening.mjs [--hegemon] [--map "Event Horizon"]
import fs from "fs";
import { gotoHome, launch, openSoloModal } from "./driver.mjs";
import { spawn, startSoloGame, waitForGameReady } from "./game.mjs";

const OUT =
  "<scratchpad>/dfaf8ef6-83fa-4a25-a2f6-a2964bb196ae/scratchpad/browser";
fs.mkdirSync(OUT, { recursive: true });
const asHegemon = process.argv.includes("--hegemon");
const mi = process.argv.indexOf("--map");
const mapName = mi >= 0 ? process.argv[mi + 1] : "Event Horizon";
const tag = asHegemon ? "throne" : "challenger";

const { browser, page } = await launch();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
await gotoHome(page);
await openSoloModal(page);
if (asHegemon) {
  await page.evaluate(() => {
    const modal = document.querySelector("single-player-modal");
    modal.playAsHegemon = true;
  });
}
await startSoloGame(page, { bots: 30, map: mapName });
// The client refreshes itself once shortly after a solo game starts.
await page.waitForTimeout(4000);
await waitForGameReady(page);

const state = () =>
  page.evaluate(() => {
    const bm = document.querySelector("build-menu");
    const g = bm?.game;
    if (!g) return null;
    const o = g.opening();
    const th = bm.transformHandler;
    return {
      ticks: g.ticks(),
      inSpawnPhase: g.inSpawnPhase(),
      inOpening: g.inOpening(),
      sinceStart: g.ticksSinceStart(),
      openingTicks: g.openingTicks(),
      immunity: g.isSpawnImmunityActive(),
      darkStar: g.darkStar(),
      opening: o
        ? {
            active: o.isActive(),
            start: o.startTick(),
            end: o.endTick(),
            hidden: o.hiddenOwners().size,
            inFlight: Array.from(o.unitsInFlight()).length,
            landedNow: o.landedThisTick().length,
          }
        : null,
      realProjectiles: g.units("Projectile").length,
      scale: th?.scale,
      me: g.myPlayer()
        ? {
            name: g.myPlayer().name(),
            tiles: g.myPlayer().numTilesOwned(),
            hegemon: g.myPlayer().isHegemon(),
          }
        : null,
      flyers: g.players().filter((p) => p.type() !== "BOT" && !p.isHegemon())
        .length,
    };
  });

console.log("before spawn", JSON.stringify(await state()));
await page.screenshot({ path: `${OUT}/${tag}-0-spawn-phase.png` });

if (!asHegemon) {
  await spawn(page);
} else {
  // The throne does not spawn: the phase ends on its own timer.
  await page.waitForFunction(
    () => !document.querySelector("build-menu")?.game?.inSpawnPhase(),
    undefined,
    { timeout: 60_000, polling: 250 },
  );
}

const log = [];
const t0 = Date.now();
let shots = 0;
const shotAt = [0.6, 2.5, 5, 8, 11, 14, 17];
while (Date.now() - t0 < 20_000) {
  const s = await state();
  const elapsed = (Date.now() - t0) / 1000;
  log.push({ elapsed: elapsed.toFixed(1), ...s });
  if (shots < shotAt.length && elapsed >= shotAt[shots]) {
    await page.screenshot({
      path: `${OUT}/${tag}-${shots + 1}-t${shotAt[shots]}s.png`,
    });
    shots++;
  }
  if (s && !s.inOpening && s.opening && !s.opening.active && elapsed > 6) {
    // Let the camera's glide home finish before the last look.
    await page.waitForTimeout(2500);
    log.push({ elapsed: "+2.5", ...(await state()) });
    await page.screenshot({ path: `${OUT}/${tag}-9-play-begins.png` });
    break;
  }
  await page.waitForTimeout(400);
}
for (const l of log) {
  console.log(
    `${l.elapsed}s tick ${l.ticks} opening ${l.inOpening} since ${l.sinceStart} window ${l.openingTicks} imm ${l.immunity} ` +
      `opening ${JSON.stringify(l.opening)} real ${l.realProjectiles} scale ${l.scale?.toFixed(3)} me ${JSON.stringify(l.me)} flyers ${l.flyers}`,
  );
}
await browser.close();
