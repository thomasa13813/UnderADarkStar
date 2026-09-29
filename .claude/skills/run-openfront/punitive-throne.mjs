// Punitive strikes (H19) from the throne: play the human Hegemon on Event
// Horizon, wait for a nation's missile launch, look at the badge on its gate,
// open the radial there, order the Punish slot, and watch the strike.
//   node .claude/skills/run-openfront/punitive-throne.mjs [--out DIR] [--wait SECONDS]
import fs from "fs";
import { gotoHome, launch, openSoloModal } from "./driver.mjs";
import {
  clickWorld,
  panTo,
  startSoloGame,
  waitForGameReady,
  waitForSpawnPhaseEnd,
} from "./game.mjs";

const oi = process.argv.indexOf("--out");
const OUT =
  oi >= 0
    ? process.argv[oi + 1]
    : "<scratchpad>/ba39f6b1-5c29-4f2a-baf2-5b9d59ba6f24/scratchpad/browser";
fs.mkdirSync(OUT, { recursive: true });
const wi = process.argv.indexOf("--wait");
const WAIT = (wi >= 0 ? Number(process.argv[wi + 1]) : 540) * 1000;

const { browser, page } = await launch();
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => {
  const t = m.text();
  if (
    /fetch|CORS|ERR_|ramp|Ramp|cosmetics|GPT|JWT|Audigent|gpp|Lit is in dev/i.test(
      t,
    )
  )
    return;
  if (
    m.type() === "error" ||
    /leaving|version|mismatch|reload|update|closing|stop|error|Error/.test(t)
  )
    console.log(`CONSOLE[${m.type()}]:`, t.slice(0, 3000));
});
page.on("framenavigated", (f) => console.log("NAV:", f.url()));
await gotoHome(page);
await openSoloModal(page);
await page.evaluate(() => {
  document.querySelector("single-player-modal").playAsHegemon = true;
});
await startSoloGame(page, { bots: 10, map: "Event Horizon" });
await page.waitForTimeout(4000);
await waitForGameReady(page);
await waitForSpawnPhaseEnd(page, 90_000);
await page.waitForFunction(
  () => !document.querySelector("build-menu")?.game?.inOpening(),
  undefined,
  { timeout: 120_000, polling: 500 },
);

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
    const flagged = g
      .units("Stargate")
      .filter((u) => (u.state.punitiveWarhead ?? null) !== null)
      .map((u) => ({
        id: u.id(),
        x: g.x(u.tile()),
        y: g.y(u.tile()),
        warhead: u.state.punitiveWarhead,
        expires: u.state.punitiveExpiresTick,
        owner: u.owner().name(),
        ownerTiles: u.owner().numTilesOwned(),
      }));
    return {
      ticks: g.ticks(),
      me: {
        name: me?.name(),
        hegemon: me?.isHegemon(),
        troops: Math.round(me?.troops() ?? 0),
      },
      flagged,
      outgoing: (me?.outgoingAttacks() ?? []).map((a) => ({
        troops: Math.round(a.troops),
        isStrike: a.isStrike ?? false,
        isPunitive: a.isPunitive ?? false,
        landsAtTick: a.landsAtTick ?? null,
        target: g.playerBySmallID(a.targetID)?.name(),
      })),
      bubble: g.hegemonBubbleTiles?.() ?? null,
    };
  });
const log = (label, s) => console.log(label, JSON.stringify(s));
log("play begins", await evalState());

// Wait for a nation's launch.
const t0 = Date.now();
let flagged = null;
while (Date.now() - t0 < WAIT) {
  const s = await evalState();
  if (s.flagged.length > 0) {
    flagged = s.flagged[0];
    log("flag seen", s);
    break;
  }
  await page.waitForTimeout(2000);
}
if (flagged === null) {
  log("no launch within the wait", await evalState());
  await browser.close();
  process.exit(2);
}

await page.evaluate(() => {
  const t = document.querySelector("build-menu").transformHandler;
  t.clearTarget();
  t.scale = 4;
});
await panTo(page, flagged.x, flagged.y);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/throne-1-badge.png` });
// The badge at other zooms: it should follow the structure icon's size.
for (const scale of [0.6, 1.8]) {
  await page.evaluate((sc) => {
    document.querySelector("build-menu").transformHandler.scale = sc;
  }, scale);
  await panTo(page, flagged.x, flagged.y);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/throne-1-badge-zoom${scale}.png` });
}
await page.evaluate(() => {
  document.querySelector("build-menu").transformHandler.scale = 4;
});
await panTo(page, flagged.x, flagged.y);

// A plain click on the ring itself (at zoom 4 the ring is ~8.6 tiles out;
// aim 7 tiles off, on the ring's inner edge) is the strike. Fall back to
// the radial if it did not take.
await clickWorld(page, flagged.x + 6, flagged.y + 4, "left");
await page.waitForTimeout(1500);
{
  const s0 = await evalState();
  log("after direct click", s0);
  if (s0.outgoing.some((a) => a.isPunitive)) {
    await page.screenshot({ path: `${OUT}/throne-2-direct-click.png` });
  }
}
// The radial on the silo's tile, then its Punish slot (a no-op if the
// direct click already ordered the strike: the option is gone).
await clickWorld(page, flagged.x, flagged.y, "right");
await page.waitForTimeout(1200);
const radial = await page.evaluate(() => {
  const el = document.querySelector(".radial-menu-container");
  return {
    open: el !== null && el.style.display !== "none",
    slots: Array.from(document.querySelectorAll("path[data-id]")).map((p) =>
      p.getAttribute("data-id"),
    ),
  };
});
log("radial", radial);
await page.screenshot({ path: `${OUT}/throne-2-radial.png` });
await page.evaluate(() => {
  const p = document.querySelector('path[data-id="attack"]');
  p?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
});
await page.waitForTimeout(1500);
let s = await evalState();
log("after punish click", s);
if (!s.outgoing.some((a) => a.isPunitive)) {
  await page.screenshot({ path: `${OUT}/throne-2b-no-strike.png` });
  await browser.close();
  process.exit(3);
}
await page.screenshot({ path: `${OUT}/throne-3-inflight.png` });

await page.waitForFunction(
  () =>
    document
      .querySelector("build-menu")
      ?.game?.myPlayer()
      ?.outgoingAttacks()
      .some((a) => a.isPunitive && a.landsAtTick === undefined),
  undefined,
  { timeout: 90_000, polling: 250 },
);
await page.waitForTimeout(8000);
s = await evalState();
log("razing", s);
await panTo(page, flagged.x, flagged.y);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/throne-4-razing.png` });

await page.waitForFunction(
  () =>
    !document
      .querySelector("build-menu")
      ?.game?.myPlayer()
      ?.outgoingAttacks()
      .some((a) => a.isPunitive),
  undefined,
  { timeout: 300_000, polling: 500 },
);
await page.waitForTimeout(2000);
s = await evalState();
const siloAlive = await page.evaluate(
  (id) =>
    document.querySelector("build-menu").game.unit(id)?.isActive() ?? false,
  flagged.id,
);
log("over", { ...s, siloAlive });
await panTo(page, flagged.x, flagged.y);
await page.waitForTimeout(800);
await page.screenshot({ path: `${OUT}/throne-5-popped.png` });
await browser.close();
