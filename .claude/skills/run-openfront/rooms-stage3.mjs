// Scratch check for the rooms' client (feat/rooms, stage 3): the home cards,
// the steering button into a running round, the drop-in's arrival screen, the
// watcher's switch to pirate, and the lone player's lobby hint.
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
      me: me ? { alive: me.isAlive(), spawned: me.hasSpawned() } : null,
    };
  });

const cards = (page) =>
  page.evaluate(() => {
    const sel = document.querySelector("game-mode-selector");
    return (sel.lobbies?.games?.throne ?? []).map((g) => ({
      id: g.gameID,
      type: g.throne?.type,
      running: !!g.throne?.running,
      players: g.numClients,
      title: sel.getModeTitle?.(g),
    }));
  });

async function home(page) {
  await gotoHome(page);
  await page.waitForFunction(() => !!document.querySelector("game-mode-selector")?.lobbies, { timeout: 30_000 });
}

async function play(page) {
  return page.evaluate(() => document.querySelector("game-mode-selector")?.joinHeroLobby?.());
}

// 1. Two players start the FFA room.
const players = [];
let ffaID = "";
for (let i = 0; i < 2; i++) {
  const page = await tab(i);
  players.push(page);
  await home(page);
  if (i === 0) log("feed at boot", JSON.stringify(await cards(page)));
  const ffa = (await cards(page)).find((c) => c.type === "ffa");
  await page.evaluate((id) => {
    const sel = document.querySelector("game-mode-selector");
    const lobby = sel.lobbies.games.throne.find((g) => g.gameID === id);
    sel.validateAndJoin(lobby);
  }, ffa.id);
  for (let t = 0; t < 40; t++) {
    const m = await readModal(page);
    if (m?.id && m.inList) {
      ffaID = m.id;
      break;
    }
    await page.waitForTimeout(500);
  }
  log(`tab${i} in FFA lobby`, ffaID);
}

// 2. A third tab alone in the team room's lobby: the lone hint.
const lone = await tab(9);
await home(lone);
const team = (await cards(lone)).find((c) => c.type === "team");
await lone.evaluate((id) => {
  const sel = document.querySelector("game-mode-selector");
  sel.validateAndJoin(sel.lobbies.games.throne.find((g) => g.gameID === id));
}, team.id);
await lone.waitForTimeout(4000);
log("lone hint shown", await lone.evaluate(() => !!document.querySelector("[data-lone-hint]")));
await lone.screenshot({ path: `${out}/s3-lone.png` });

// 3. Wait out the spawn phase and the opening of the FFA round.
for (let t = 0; t < 90; t++) {
  const s = await gameState(players[0]).catch(() => null);
  if (s && !s.spawnPhase && s.ticks > 260) break;
  await players[0].waitForTimeout(1000);
}
log("round state", JSON.stringify(await gameState(players[0])));

// 4. A newcomer presses Play: steered into the running FFA round, arrives as a pirate.
const late = await tab(2);
await home(late);
log("feed now", JSON.stringify(await cards(late)));
await late.screenshot({ path: `${out}/s3-home.png` });
log("play steers", await play(late));
await late.waitForTimeout(15_000);
log("late state", JSON.stringify(await gameState(late)));
const arrival = await late.evaluate(() => {
  const m = document.querySelector("win-modal");
  return {
    visible: m?.isVisible,
    title: m?.querySelector("h2")?.textContent?.trim(),
    piracy: !!m?.querySelector("[data-piracy-panel]"),
    rooms: m?.querySelector("[data-rooms-panel]")?.getAttribute("data-rooms-mode"),
  };
});
log("arrival screen", JSON.stringify(arrival));
await late.screenshot({ path: `${out}/s3-arrival.png` });

// 5. A watcher turns pirate.
const watcher = await tab(3);
await watcher.goto(`http://localhost:9000/game/${ffaID}?spectate`);
await watcher.waitForTimeout(15_000);
const bar = await watcher.evaluate(() => document.querySelector("[data-room-watch-bar]")?.textContent?.replace(/\s+/g, " ").trim() ?? null);
log("watch bar", bar);
await watcher.screenshot({ path: `${out}/s3-watch.png` });
await watcher.evaluate(() => document.querySelector("[data-watch-join]")?.click());
await watcher.waitForTimeout(5000);
log("watcher now", JSON.stringify(await gameState(watcher)));
log("watcher screen", await watcher.evaluate(() => document.querySelector("win-modal h2")?.textContent?.trim()));

await browser.close();
