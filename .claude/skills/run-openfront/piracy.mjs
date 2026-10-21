// Piracy slice C playthrough: die, embrace, raid, land. Screenshots in OUT.
import fs from "fs";
import { gotoHome, launch, openSoloModal } from "./driver.mjs";
import {
  clickWorld,
  panTo,
  setAttackRatio,
  startSoloGame,
  waitForGameReady,
} from "./game.mjs";

const OUT = process.env.OUT ?? "out/piracy";
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const shot = (page, name) =>
  page
    .screenshot({ path: `${OUT}/${name}.png` })
    .then(() => log(`shot ${name}`));

const { browser, page } = await launch({
  viewport: { width: 1400, height: 900 },
});
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => {
  const t = m.text();
  if (/pirat|corsair|embrace/i.test(t)) console.log("CONSOLE:", t);
});
await gotoHome(page);
await openSoloModal(page);
await page.evaluate(() => {
  const modal = document.querySelector("single-player-modal");
  modal.piracy = true;
});
await startSoloGame(page, { bots: 200, difficulty: "Hard" });
await page.waitForTimeout(4000);
await waitForGameReady(page);
log("game ready");

const me = () =>
  page.evaluate(() => {
    const g = document.querySelector("build-menu")?.game;
    const p = g?.myPlayer();
    if (!g || !p) return null;
    const ship = g
      .units("Warship")
      .find((u) => u.isActive() && u.owner().smallID() === p.smallID());
    const q = (sel) => document.querySelector(sel)?.textContent?.trim() ?? null;
    return {
      ticks: g.ticks(),
      spawnPhase: g.inSpawnPhase(),
      opening: g.inOpening(),
      alive: p.isAlive(),
      pirate: p.isPirate(),
      tiles: p.numTilesOwned(),
      troops: p.troops(),
      gold: String(p.gold()),
      respawnAt: p.pirateRespawnAt(),
      landing: p.pirateLanding(),
      ship: ship
        ? {
            id: ship.id(),
            x: g.x(ship.tile()),
            y: g.y(ship.tile()),
            hold: ship.troops(),
            hp: ship.health(),
          }
        : null,
      panel: q("pirate-hold-panel [data-pirate-status]"),
      hold: q("pirate-hold-panel [data-pirate-hold]"),
      modal: !!document.querySelector(
        "win-modal div:not(.hidden) [data-embrace-piracy]",
      ),
    };
  });

// Spawn next to a Lord (Nation): it will answer an attack and finish us.
await page.waitForTimeout(3000);
const spawnTile = await page.evaluate(() => {
  const g = document.querySelector("build-menu").game;
  const w = g.width();
  const h = g.height();
  let best = null;
  for (let i = 0; i < 60000 && best === null; i++) {
    const x = (i * 79) % w;
    const y = (i * 131) % h;
    if (!g.isValidCoord(x, y)) continue;
    const ref = g.ref(x, y);
    if (!g.isLand(ref) || g.hasOwner(ref)) continue;
    for (let dx = -6; dx <= 6 && best === null; dx += 2) {
      for (let dy = -6; dy <= 6; dy += 2) {
        const nx = x + dx;
        const ny = y + dy;
        if (!g.isValidCoord(nx, ny)) continue;
        const r = g.ref(nx, ny);
        if (!g.hasOwner(r)) continue;
        const o = g.owner(r);
        if (o.isPlayer() && o.type() === "NATION" && !o.isHegemon()) {
          best = { x, y, lord: o.name() };
          break;
        }
      }
    }
  }
  return best;
});
log("spawn near", spawnTile);
if (spawnTile === null) throw new Error("no spawn beside a Lord");
await panTo(page, spawnTile.x, spawnTile.y);
await clickWorld(page, spawnTile.x, spawnTile.y);
await page.waitForFunction(
  () =>
    (document.querySelector("build-menu")?.game?.myPlayer()?.numTilesOwned() ??
      0) > 0,
  undefined,
  { timeout: 30000, polling: 250 },
);
log("spawned", await me());

// Wait out the spawn phase and the opening.
await page.waitForFunction(
  () => {
    const g = document.querySelector("build-menu")?.game;
    return g && !g.inSpawnPhase() && !g.inOpening();
  },
  undefined,
  { timeout: 240000, polling: 1000 },
);
log("round on", await me());

// Provoke: throw everything at the Lord until it finishes us.
await setAttackRatio(page, 1.0);
const lordTile = async () =>
  page.evaluate(
    ([sx, sy]) => {
      const g = document.querySelector("build-menu").game;
      const p = g.myPlayer();
      let best = null;
      let bd = 1e9;
      for (let dx = -30; dx <= 30; dx++) {
        for (let dy = -30; dy <= 30; dy++) {
          const x = sx + dx;
          const y = sy + dy;
          if (!g.isValidCoord(x, y)) continue;
          const r = g.ref(x, y);
          if (!g.isLand(r) || !g.hasOwner(r)) continue;
          const o = g.owner(r);
          if (
            !o.isPlayer() ||
            o.smallID() === p.smallID() ||
            o.isHegemon() ||
            o.type() === "HUMAN"
          )
            continue;
          const d = Math.abs(dx) + Math.abs(dy);
          if (d < bd) {
            bd = d;
            best = { x, y, who: o.name() };
          }
        }
      }
      return best;
    },
    [spawnTile.x, spawnTile.y],
  );
const deadline = Date.now() + 8 * 60_000;
while (Date.now() < deadline) {
  const s = await me();
  if (!s.alive) break;
  const t = await lordTile();
  if (t) {
    try {
      await clickWorld(page, t.x, t.y);
    } catch (e) {
      log("click failed", e.message);
    }
  }
  log("poke", t?.who, "tiles", s.tiles, "troops", s.troops);
  await page.waitForTimeout(10000);
}
let s = await me();
if (s.alive) throw new Error("never died");
await page.waitForTimeout(1500);
log("dead", s);
await shot(page, "01-death-screen");

// Embrace.
await page
  .locator("win-modal [data-embrace-piracy] button:visible")
  .first()
  .click();
await page.waitForTimeout(800);
await shot(page, "02-embraced");
log("after embrace", await me());

// Launch in deep space outside the Dark Star and its moat, near home.
const spawnWater = await page.evaluate(
  ([sx, sy]) => {
    const g = document.querySelector("build-menu").game;
    const ds = g.darkStar();
    const bad = (x, y) =>
      ds && (x - ds.cx) ** 2 + (y - ds.cy) ** 2 <= ds.outerSq;
    for (let r = 3; r < 80; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (const dy of [-r, r]) {
          for (const [x, y] of [
            [sx + dx, sy + dy],
            [sx + dy, sy + dx],
          ]) {
            if (!g.isValidCoord(x, y)) continue;
            const ref = g.ref(x, y);
            if (g.isWater(ref) && !bad(x, y)) return { x, y };
          }
        }
      }
    }
    return null;
  },
  [spawnTile.x, spawnTile.y],
);
log("launch at", spawnWater);
await panTo(page, spawnWater.x, spawnWater.y);
await clickWorld(page, spawnWater.x, spawnWater.y);
await page.waitForFunction(
  () => {
    const g = document.querySelector("build-menu")?.game;
    const p = g?.myPlayer();
    return (
      p?.isPirate() &&
      g
        .units("Warship")
        .some((u) => u.isActive() && u.owner().smallID() === p.smallID())
    );
  },
  undefined,
  { timeout: 30000, polling: 250 },
);
await page.waitForTimeout(1500);
s = await me();
log("at sea", s);
await panTo(page, s.ship.x, s.ship.y);
await page.waitForTimeout(800);
await shot(page, "03-at-sea");

// Raid: patrol where the freighters are.
const nearestFreighter = async () =>
  page.evaluate(() => {
    const g = document.querySelector("build-menu").game;
    const p = g.myPlayer();
    const ship = g
      .units("Warship")
      .find((u) => u.isActive() && u.owner().smallID() === p.smallID());
    if (!ship) return null;
    let best = null;
    let bd = 1e9;
    for (const f of g.units("TradeShip")) {
      if (!f.isActive() || !g.isWater(f.tile())) continue;
      const d = g.manhattanDist(ship.tile(), f.tile());
      if (d < bd) {
        bd = d;
        best = { x: g.x(f.tile()), y: g.y(f.tile()), d };
      }
    }
    return best;
  });
const raidDeadline = Date.now() + 5 * 60_000;
let repoint = 0;
while (Date.now() < raidDeadline) {
  s = await me();
  if (s.ship === null) {
    log("corsair lost", s);
    break;
  }
  if (s.ship.hold > 0) break;
  if (Date.now() >= repoint) {
    const f = await nearestFreighter();
    if (f) {
      await panTo(page, f.x, f.y);
      try {
        await clickWorld(page, f.x, f.y);
        log("patrol to freighter", f);
      } catch (e) {
        log("click failed", e.message);
      }
    }
    repoint = Date.now() + 25000;
  }
  await page.waitForTimeout(3000);
}
s = await me();
log("after raiding", s);
if (s.ship) {
  await panTo(page, s.ship.x, s.ship.y);
  await page.waitForTimeout(800);
}
await shot(page, "04-raided");

// Land: the nearest coast not the Hegemon's.
const coast = await page.evaluate(() => {
  const g = document.querySelector("build-menu").game;
  const p = g.myPlayer();
  const ship = g
    .units("Warship")
    .find((u) => u.isActive() && u.owner().smallID() === p.smallID());
  if (!ship) return null;
  const sx = g.x(ship.tile());
  const sy = g.y(ship.tile());
  let best = null;
  let bd = 1e9;
  for (let dx = -60; dx <= 60; dx++) {
    for (let dy = -60; dy <= 60; dy++) {
      const x = sx + dx;
      const y = sy + dy;
      if (!g.isValidCoord(x, y)) continue;
      const r = g.ref(x, y);
      if (!g.isLand(r) || g.isInDarkStar(r)) continue;
      const o = g.owner(r);
      if (o.isPlayer() && o.isHegemon()) continue;
      const d = Math.abs(dx) + Math.abs(dy);
      if (d < bd) {
        bd = d;
        best = { x, y, who: o.isPlayer() ? o.name() : "neutral" };
      }
    }
  }
  return best;
});
log("land at", coast);
if (coast) {
  await panTo(page, coast.x, coast.y);
  await clickWorld(page, coast.x, coast.y);
  await page.waitForTimeout(1500);
  log("ordered", await me());
  await shot(page, "05-landing-ordered");
  await page
    .waitForFunction(
      () => document.querySelector("build-menu")?.game?.myPlayer()?.isAlive(),
      undefined,
      { timeout: 240000, polling: 500 },
    )
    .catch((e) => log("landing wait:", e.message));
  await page.waitForTimeout(2000);
  s = await me();
  log("landed", s);
  await shot(page, "06-landed");
}
await browser.close();
