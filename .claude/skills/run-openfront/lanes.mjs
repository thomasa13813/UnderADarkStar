// Trade lanes (S7, §6.19) in the real client: play a challenger on Event
// Horizon, build a factory and two cities on my land, and photograph the
// straight lanes between them, plus the ghost lane while placing a third.
//   node .claude/skills/run-openfront/lanes.mjs [--out DIR]
import fs from "fs";
import { gotoHome, launch, openSoloModal } from "./driver.mjs";
import {
  attack,
  findExpansionTile,
  panTo,
  setAttackRatio,
  spawn,
  startSoloGame,
  waitForGameReady,
  worldToScreen,
} from "./game.mjs";

const oi = process.argv.indexOf("--out");
const OUT =
  oi >= 0
    ? process.argv[oi + 1]
    : "<scratchpad>/bf36e29c-c56d-490f-bb8b-194f3fa0565d/scratchpad/browser";
fs.mkdirSync(OUT, { recursive: true });

const { browser, page } = await launch();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 2000));
});
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
    return g && !g.inSpawnPhase() && !g.inOpening();
  },
  undefined,
  { timeout: 120_000, polling: 500 },
);
await page.waitForTimeout(3000);

async function evalState() {
  for (let attempt = 0; ; attempt++) {
    try {
      return await evalStateOnce();
    } catch (e) {
      if (attempt >= 3) throw e;
      console.log("state read failed (client refresh?), waiting:", e.message);
      await page.waitForTimeout(3000);
      await waitForGameReady(page, 120_000);
    }
  }
}
const evalStateOnce = () =>
  page.evaluate(() => {
    const g = document.querySelector("build-menu").game;
    const me = g.myPlayer();
    const mine = (type) =>
      g
        .units(type)
        .filter((u) => u.owner().id() === me.id())
        .map((u) => ({ x: g.x(u.tile()), y: g.y(u.tile()) }));
    return {
      ticks: g.ticks(),
      tiles: me.numTilesOwned(),
      factories: mine("Factory"),
      cities: mine("City"),
      ports: mine("Port"),
      trains: g.units("Train").length,
      lanes: g.frameData().railSegmentCount,
    };
  });
const log = (label, s) => console.log(label, JSON.stringify(s));
log("after opening", await evalState());

// Grow: the opening lands a small core; lanes need stations 18+ tiles apart.
await setAttackRatio(page, 0.4);
const t0 = Date.now();
while (Date.now() - t0 < 150_000) {
  const st = await evalState();
  if (st.tiles >= 3000) break;
  try {
    const t = await findExpansionTile(page);
    if (t) await attack(page, t.x, t.y);
  } catch (e) {
    console.log("expand:", e.message);
  }
  await page.waitForTimeout(4000);
}
log("grown", await evalState());

// My land: the name location and the farthest owned tiles along the
// diagonals from it, so the lanes run at an angle.
const spots = await page.evaluate(() => {
  const g = document.querySelector("build-menu").game;
  const me = g.myPlayer();
  const loc = me.nameLocation();
  const home = { x: Math.round(loc.x), y: Math.round(loc.y) };
  const id = me.smallID();
  const far = (dx, dy) => {
    let best = null;
    for (let d = 1; d < 120; d++) {
      const x = home.x + dx * d;
      const y = home.y + dy * d;
      if (!g.isValidCoord(x, y)) break;
      const t = g.ref(x, y);
      if (g.isLand(t) && g.ownerID(t) === id) best = { x, y, d };
    }
    return best;
  };
  return { home, ne: far(1, -1), sw: far(-1, 1), e: far(1, 0), n: far(0, -1) };
});
log("spots", spots);

// Hover first so the ghost's playerActions round-trip lands before the click.
async function placeAt(type, x, y) {
  await page.evaluate((t) => {
    const bm = document.querySelector("build-menu");
    bm.transformHandler.clearTarget();
    bm.uiState.ghostStructure = t;
  }, type);
  await page.waitForTimeout(300);
  await panTo(page, x, y);
  const s = await worldToScreen(page, x + 0.5, y + 0.5);
  if (s === null) throw new Error(`(${x},${y}) off-screen`);
  await page.mouse.move(s.x, s.y);
  await page.waitForTimeout(900);
  await page.mouse.move(s.x + 1, s.y);
  await page.waitForTimeout(400);
  await page.mouse.click(s.x, s.y);
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.querySelector("build-menu").uiState.ghostStructure = null;
  });
}

const pick = (a, b) => (a && a.d >= 18 ? a : b && b.d >= 18 ? b : null);
const first = pick(spots.ne, spots.e);
const second = pick(spots.sw, spots.n);
await placeAt("Factory", spots.home.x, spots.home.y);
if (first) await placeAt("City", first.x, first.y);
if (second) await placeAt("City", second.x, second.y);
await page.waitForTimeout(3000);
log("built", await evalState());

async function shot(name, scale, x, y) {
  await page.evaluate((sc) => {
    const t = document.querySelector("build-menu").transformHandler;
    t.clearTarget();
    t.scale = sc;
  }, scale);
  await panTo(page, x, y);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/${name}.png` });
}
await shot("lanes-1-close", 8, spots.home.x, spots.home.y);
await shot("lanes-2-mid", 4, spots.home.x, spots.home.y);
await shot("lanes-3-far", 2, spots.home.x, spots.home.y);

// The ghost lane while placing a third city off to one side.
const third = spots.n && spots.n.d >= 12 ? spots.n : spots.e;
if (third) {
  await page.evaluate(() => {
    const bm = document.querySelector("build-menu");
    bm.transformHandler.clearTarget();
    bm.transformHandler.scale = 5;
    bm.uiState.ghostStructure = "City";
  });
  await panTo(page, spots.home.x, spots.home.y);
  const s = await worldToScreen(page, third.x + 0.5, third.y + 0.5);
  if (s !== null) {
    await page.mouse.move(s.x, s.y);
    await page.waitForTimeout(900);
    await page.mouse.move(s.x + 1, s.y);
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/lanes-4-ghost.png` });
  }
  await page.evaluate(() => {
    document.querySelector("build-menu").uiState.ghostStructure = null;
  });
}

// Let a train or two roll, then one more look.
await page.waitForTimeout(15_000);
log("later", await evalState());
await shot("lanes-5-trains", 6, spots.home.x, spots.home.y);
await browser.close();
