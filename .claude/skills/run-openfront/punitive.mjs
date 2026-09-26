// Punitive strikes (H19) in the real client: play a challenger on Event
// Horizon against the AI Hegemon, build a silo, fire a Nuclear Warhead at
// the Dark Star, and watch the badge on the silo. NOTE: the AI throne spares
// a player under punitiveAIMinLandPermille of the map, which a fresh human
// always is, so the strike never comes — the wait after the badge times out.
// punitive-throne.mjs covers the strike itself, from the throne's side.
//   node .claude/skills/run-openfront/punitive.mjs [--out DIR]
import fs from "fs";
import { gotoHome, launch, openSoloModal } from "./driver.mjs";
import {
  panTo,
  spawn,
  startSoloGame,
  waitForGameReady,
  worldToScreen,
} from "./game.mjs";

const oi = process.argv.indexOf("--out");
const OUT =
  oi >= 0
    ? process.argv[oi + 1]
    : "<scratchpad>/ba39f6b1-5c29-4f2a-baf2-5b9d59ba6f24/scratchpad/browser";
fs.mkdirSync(OUT, { recursive: true });

const { browser, page } = await launch();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => {
  if (m.type() === "error") console.log("CONSOLE:", m.text().slice(0, 3000));
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

// The client reloads itself ('/#refresh', then the game URL with ?live) at
// least once after a solo game starts; a read during that transient throws.
// Wait the game back and retry.
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
    const silos = g
      .units("Missile Silo")
      .filter((u) => u.owner().id() === me.id())
      .map((u) => ({
        id: u.id(),
        x: g.x(u.tile()),
        y: g.y(u.tile()),
        warhead: u.state.punitiveWarhead ?? null,
        expires: u.state.punitiveExpiresTick ?? null,
        owner: u.owner().name(),
      }));
    const allFlagged = g
      .units("Missile Silo")
      .filter((u) => (u.state.punitiveWarhead ?? null) !== null).length;
    return {
      ticks: g.ticks(),
      me: {
        name: me.name(),
        tiles: me.numTilesOwned(),
        troops: Math.round(me.troops()),
        gold: String(me.gold()),
      },
      silos,
      allFlagged,
      incoming: me.incomingAttacks().map((a) => ({
        troops: Math.round(a.troops),
        isStrike: a.isStrike ?? false,
        isPunitive: a.isPunitive ?? false,
        landsAtTick: a.landsAtTick ?? null,
        aimTile: a.aimTile ?? null,
      })),
      hegemonBubble: g.hegemonBubbleTiles?.() ?? null,
      events: Array.from(
        document.querySelectorAll(
          "events-display .event-text, events-display td, events-display span",
        ),
      )
        .map((e) => e.textContent?.trim() ?? "")
        .filter((t) => /levied|punitive|Punitive|missile/.test(t))
        .slice(-4),
    };
  });

const log = (label, s) => console.log(label, JSON.stringify(s));
log("after opening", await evalState());

// A tile of mine well inside my land: the name location.
const home = await page.evaluate(() => {
  const g = document.querySelector("build-menu").game;
  const loc = g.myPlayer().nameLocation();
  return { x: Math.round(loc.x), y: Math.round(loc.y) };
});

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

await placeAt("Missile Silo", home.x, home.y);
let s = await evalState();
log("after silo", s);
if (s.silos.length === 0) {
  await page.screenshot({ path: `${OUT}/punitive-0-no-silo.png` });
  throw new Error("no silo built");
}
const silo = s.silos[0];

const centre = await page.evaluate(() => {
  const g = document.querySelector("build-menu").game;
  const d = g.darkStar();
  return { x: d.cx, y: d.cy };
});
await placeAt("Atom Bomb", centre.x, centre.y);
await page.waitForTimeout(1500);
s = await evalState();
log("after launch", s);

// The badge on my own silo (the owner sees it).
await page.evaluate(() => {
  const t = document.querySelector("build-menu").transformHandler;
  t.clearTarget();
  t.scale = 8;
});
await panTo(page, silo.x, silo.y);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/punitive-1-badge.png` });

// The AI throne answers within a second; the flight takes a few.
await page.waitForFunction(
  () =>
    document
      .querySelector("build-menu")
      ?.game?.myPlayer()
      ?.incomingAttacks()
      .some((a) => a.isPunitive),
  undefined,
  { timeout: 60_000, polling: 250 },
);
s = await evalState();
log("strike ordered", s);
await page.evaluate(() => {
  const t = document.querySelector("build-menu").transformHandler;
  t.scale = 1.8;
});
await panTo(page, silo.x, silo.y);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/punitive-2-inbound.png` });

// Landed: the row loses its landing tick.
await page.waitForFunction(
  () =>
    document
      .querySelector("build-menu")
      ?.game?.myPlayer()
      ?.incomingAttacks()
      .some((a) => a.isPunitive && a.landsAtTick === undefined),
  undefined,
  { timeout: 60_000, polling: 250 },
);
await page.waitForTimeout(6000);
s = await evalState();
log("razing", s);
await page.evaluate(() => {
  document.querySelector("build-menu").transformHandler.scale = 4;
});
await panTo(page, silo.x, silo.y);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/punitive-3-razing.png` });

// Over: the bubble pops, the silo dies.
await page.waitForFunction(
  () =>
    !document
      .querySelector("build-menu")
      ?.game?.myPlayer()
      ?.incomingAttacks()
      .some((a) => a.isPunitive),
  undefined,
  { timeout: 300_000, polling: 500 },
);
await page.waitForTimeout(2000);
s = await evalState();
log("over", s);
await panTo(page, silo.x, silo.y);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/punitive-4-popped.png` });
await browser.close();
