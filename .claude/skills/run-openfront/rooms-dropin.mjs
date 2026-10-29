// Scratch check for the rooms (feat/rooms, stage 2): two tabs start a room's
// round, a third opens the running game's link and should drop in as a
// player the server created mid-round.
import { launch, gotoHome } from "./driver.mjs";

const out = process.argv[2];
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const { browser } = await launch();

async function tab(i) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => {
    if (!/inSpawnPhase/.test(e.message)) log(`tab${i} PAGEERROR`, e.message);
  });
  return page;
}

const readModal = (page) =>
  page.evaluate(() => {
    const m = document.querySelector("join-lobby-modal");
    return m
      ? { id: m.currentLobbyId ?? "", inList: (m.players ?? []).some((p) => p.clientID === m.currentClientID) }
      : null;
  });

const gameState = (page) =>
  page.evaluate(() => {
    const g = document.querySelector("build-menu")?.game;
    if (!g) return null;
    const me = g.myPlayer();
    return {
      ticks: g.ticks(),
      spawnPhase: g.inSpawnPhase(),
      players: g.playerViews().length,
      me: me ? { name: me.name(), alive: me.isAlive() } : null,
    };
  });

const pages = [];
let gameID = "";
for (let i = 0; i < 2; i++) {
  const page = await tab(i);
  pages.push(page);
  await gotoHome(page);
  await page.waitForFunction(() => !!document.querySelector("game-mode-selector")?.lobbies, { timeout: 30_000 });
  const ok = await page.evaluate(() => document.querySelector("game-mode-selector")?.joinHeroLobby?.());
  log(`tab${i} joinHero`, ok);
  for (let t = 0; t < 40; t++) {
    const m = await readModal(page);
    if (m?.id && m.inList) {
      gameID = m.id;
      break;
    }
    await page.waitForTimeout(500);
  }
  log(`tab${i} in lobby`, gameID);
}

for (let t = 0; t < 60; t++) {
  const s = await gameState(pages[0]).catch(() => null);
  if (s && s.ticks > 0) {
    log("round running", JSON.stringify(s));
    break;
  }
  await pages[0].waitForTimeout(1000);
}

const late = await tab(2);
await late.goto(`http://localhost:9000/game/${gameID}`);
await late.waitForTimeout(12_000);
log("late tab", JSON.stringify(await gameState(late).catch((e) => String(e))));
log("tab0 sees", JSON.stringify(await gameState(pages[0])));
await late.screenshot({ path: `${out}/dropin-late.png` });
await pages[0].screenshot({ path: `${out}/dropin-tab0.png` });
await browser.close();
