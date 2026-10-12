// P0 step 2: the successor lobby inherits the round and seats the winner.
// Host A + joiner B play a 1-minute Hegemon round with B on the throne (B wins
// on the timer); A clicks "New Lobby"; the new host view must show the old
// settings, and B, hopping over from the prompt, must arrive already seated.
import fs from "fs";
import { gotoHome, launch } from "./driver.mjs";
import { waitForGameReady } from "./game.mjs";

const OUT = process.env.OUT ?? "out/browser";
fs.mkdirSync(OUT, { recursive: true });

const { browser, page: host } = await launch();
host.on("pageerror", (e) => console.log("A PAGEERROR:", e.message));
await gotoHome(host);
await host.evaluate(() => document.querySelector("host-lobby-modal").open());
await host.waitForFunction(
  () => (document.querySelector("host-lobby-modal")?.lobbyId ?? "") !== "",
  undefined,
  { timeout: 30_000 },
);
await host.waitForTimeout(2000);
const lobbyUrl = host.url();
const firstLobby = await host.evaluate(
  () => document.querySelector("host-lobby-modal").lobbyId,
);
console.log("first lobby", firstLobby);

const ctxB = await browser.newContext({
  viewport: { width: 1400, height: 1000 },
});
const joiner = await ctxB.newPage();
joiner.on("pageerror", (e) => console.log("B PAGEERROR:", e.message));
await joiner.goto(lobbyUrl, { waitUntil: "load" });
await host.waitForFunction(
  () => (document.querySelector("host-lobby-modal")?.clients ?? []).length >= 2,
  undefined,
  { timeout: 30_000 },
);
const hostID = await host.evaluate(
  () => document.querySelector("host-lobby-modal").lobbyCreatorClientID,
);
const other = await host.evaluate(
  (id) =>
    document
      .querySelector("host-lobby-modal")
      .clients.find((c) => c.clientID !== id),
  hostID,
);

// The round's settings: Event Horizon, 30 tribes, the throne on, 1 minute.
await host.evaluate((seat) => {
  const m = document.querySelector("host-lobby-modal");
  m.selectedMap = "Event Horizon";
  m.bots = 30;
  m.maxTimerValue = 1;
  m.seatHegemon(seat);
}, other.clientID);
await host.waitForTimeout(2500);
console.log(
  "round config",
  JSON.stringify(
    await host.evaluate(() => {
      const m = document.querySelector("host-lobby-modal");
      return {
        map: m.selectedMap,
        bots: m.bots,
        hegemon: m.hegemon,
        seat: m.hegemonSeat,
        timer: m.maxTimerValue,
      };
    }),
  ),
);
await host.evaluate(() =>
  document.querySelector("host-lobby-modal").toggleGameStartTimer(),
);
await Promise.all([
  waitForGameReady(host, 120_000),
  waitForGameReady(joiner, 120_000),
]);
console.log("in game; waiting for the timer to end the round");

// The round ends on the timer: the win modal shows on both.
await host.waitForFunction(
  () => {
    const w = document.querySelector("win-modal");
    return w !== null && w.isVisible === true;
  },
  undefined,
  { timeout: 300_000, polling: 1000 },
);
await host.waitForTimeout(4000);
console.log(
  "win text A:",
  await host.evaluate(() =>
    document
      .querySelector("win-modal")
      ?.textContent.replace(/\s+/g, " ")
      .trim()
      .slice(0, 160),
  ),
);
await host.screenshot({ path: `${OUT}/succ-1-win.png` });

// A: New Lobby (the sidebar's icon, then the in-game confirm).
await host.evaluate(() => {
  const btn = Array.from(
    document.querySelectorAll("game-right-sidebar div[title]"),
  ).find((d) => d.getAttribute("title") === "New Lobby");
  btn.click();
});
await host.waitForSelector("confirm-dialog", {
  state: "attached",
  timeout: 10_000,
});
await host.evaluate(() =>
  document.querySelector("confirm-dialog").dispatchEvent(new Event("confirm")),
);
await host.waitForURL(/\?host/, { timeout: 30_000 });
await host.waitForFunction(
  () => {
    const m = document.querySelector("host-lobby-modal");
    return m && m.lobbyId !== "" && m.selectedMap === "Event Horizon";
  },
  undefined,
  { timeout: 30_000 },
);
await host.waitForTimeout(1500);
const hydrated = await host.evaluate(() => {
  const m = document.querySelector("host-lobby-modal");
  return {
    lobby: m.lobbyId,
    map: m.selectedMap,
    bots: m.bots,
    hegemon: m.hegemon,
    seat: m.hegemonSeat,
    timer: m.maxTimerValue,
    maxTimer: m.maxTimer,
    nations: m.nations,
  };
});
console.log("successor host view", JSON.stringify(hydrated));
await host.screenshot({ path: `${OUT}/succ-2-host-attached.png` });

// B: the prompt, then hop over.
await joiner.waitForSelector("new-lobby-prompt o-button", { timeout: 30_000 });
await joiner.evaluate(() =>
  document.querySelector("new-lobby-prompt o-button").click(),
);
await joiner.waitForFunction(
  () =>
    document.querySelector("join-lobby-modal")?.gameConfig?.hegemon !==
    undefined,
  undefined,
  { timeout: 30_000 },
);
await joiner.waitForTimeout(2500);
const joinView = await joiner.evaluate(() => {
  const jm = document.querySelector("join-lobby-modal");
  const view = document.querySelector("join-lobby-modal lobby-player-view");
  return {
    me: jm.currentClientID,
    hegemon: jm.gameConfig?.hegemon,
    map: jm.gameConfig?.gameMap,
    timer: jm.gameConfig?.maxTimerValue,
    badges: view ? (view.textContent.match(/\(Hegemon\)/g)?.length ?? 0) : -1,
    cards: Array.from(
      document.querySelectorAll("join-lobby-modal lobby-config-item"),
    ).map((c) => c.textContent.replace(/\s+/g, " ").trim()),
  };
});
console.log("successor join view", JSON.stringify(joinView));
const hostAfter = await host.evaluate(() => {
  const m = document.querySelector("host-lobby-modal");
  const view = document.querySelector("host-lobby-modal lobby-player-view");
  return {
    seat: m.hegemonSeat,
    clients: m.clients.map((c) => c.clientID),
    text: view?.textContent.replace(/\s+/g, " ").trim(),
  };
});
console.log("successor host after join", JSON.stringify(hostAfter));
await host.screenshot({ path: `${OUT}/succ-3-host-seated.png` });
await joiner.screenshot({ path: `${OUT}/succ-4-joiner-seated.png` });
await browser.close();
