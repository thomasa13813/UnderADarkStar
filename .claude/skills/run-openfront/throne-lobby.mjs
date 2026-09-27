// P0 step 1: a private lobby with a human on the throne.
// Host (page A) opens a private lobby; a second client (page B, its own
// browser context = its own identity) joins by URL; the host turns the Dark
// Star on, seats B, starts; both pages report who holds the throne.
import fs from "fs";
import { gotoHome, launch } from "./driver.mjs";
import { waitForGameReady } from "./game.mjs";

const OUT =
  process.env.OUT ??
  "<scratchpad>/96e665c0-6749-4e32-a4d1-dab51e4e1065/scratchpad/browser";
fs.mkdirSync(OUT, { recursive: true });

const { browser, page: host } = await launch();
host.on("pageerror", (e) => console.log("A PAGEERROR:", e.message));
await gotoHome(host);

// Open the host modal programmatically (it creates the lobby on open).
await host.evaluate(() => document.querySelector("host-lobby-modal").open());
await host.waitForFunction(
  () => (document.querySelector("host-lobby-modal")?.lobbyId ?? "") !== "",
  undefined,
  { timeout: 30_000 },
);
await host.waitForTimeout(2000);
const lobbyId = await host.evaluate(
  () => document.querySelector("host-lobby-modal").lobbyId,
);
const lobbyUrl = host.url();
console.log("lobby", lobbyId, lobbyUrl);

// Second identity.
const ctxB = await browser.newContext({
  viewport: { width: 1400, height: 1000 },
});
const joiner = await ctxB.newPage();
joiner.on("pageerror", (e) => console.log("B PAGEERROR:", e.message));
await joiner.goto(lobbyUrl, { waitUntil: "load" });
await joiner.waitForTimeout(4000);

// Host sees two clients.
await host.waitForFunction(
  () => (document.querySelector("host-lobby-modal")?.clients ?? []).length >= 2,
  undefined,
  { timeout: 30_000 },
);
const clients = await host.evaluate(() =>
  document.querySelector("host-lobby-modal").clients.map((c) => ({
    clientID: c.clientID,
    username: c.username,
  })),
);
const hostID = await host.evaluate(
  () => document.querySelector("host-lobby-modal").lobbyCreatorClientID,
);
const other = clients.find((c) => c.clientID !== hostID);
console.log("clients", JSON.stringify(clients), "host", hostID);

// Before: no Dark Star toggle checked, no crown buttons.
const before = await host.evaluate(() => ({
  crowns: document.querySelectorAll("button[aria-pressed]").length,
  hegemon: document.querySelector("host-lobby-modal").hegemon,
}));
console.log("before", JSON.stringify(before));

// Turn the throne on through the same handler the toggle uses, then seat B.
await host.evaluate(() => {
  const m = document.querySelector("host-lobby-modal");
});
await host.waitForTimeout(500);
await host.evaluate((id) => {
  document.querySelector("host-lobby-modal").seatHegemon(id);
}, other.clientID);
await host.waitForTimeout(1500);

const hostView = await host.evaluate(() => {
  const m = document.querySelector("host-lobby-modal");
  const view = document.querySelector("host-lobby-modal lobby-player-view");
  return {
    hegemon: m.hegemon,
    seat: m.hegemonSeat,
    maxTimer: m.maxTimer,
    maxTimerValue: m.maxTimerValue,
    crowns: view ? view.querySelectorAll("button[aria-pressed]").length : -1,
    pressed: view
      ? view.querySelectorAll('button[aria-pressed="true"]').length
      : -1,
    badges: view ? (view.textContent.match(/\(Hegemon\)/g)?.length ?? 0) : -1,
    text: view?.textContent.replace(/\s+/g, " ").trim(),
  };
});
console.log("host view", JSON.stringify(hostView));
await host.screenshot({ path: `${OUT}/throne-1-host-lobby.png` });

// Joiner sees the badge and the settings card.
await joiner.waitForTimeout(1500);
const joinView = await joiner.evaluate(() => {
  const jm = document.querySelector("join-lobby-modal");
  const view = document.querySelector("join-lobby-modal lobby-player-view");
  return {
    seatInConfig: jm?.gameConfig?.hegemon,
    badges: view ? (view.textContent.match(/\(Hegemon\)/g)?.length ?? 0) : -1,
    crowns: view ? view.querySelectorAll("button[aria-pressed]").length : -1,
    cards: Array.from(
      document.querySelectorAll("join-lobby-modal lobby-config-item"),
    ).map((c) => c.textContent.replace(/\s+/g, " ").trim()),
  };
});
console.log("join view", JSON.stringify(joinView));
await joiner.screenshot({ path: `${OUT}/throne-2-join-lobby.png` });

// Start.
await host.evaluate(() =>
  document.querySelector("host-lobby-modal").toggleGameStartTimer(),
);
await Promise.all([
  waitForGameReady(host, 120_000),
  waitForGameReady(joiner, 120_000),
]);
await host.waitForTimeout(3000);

const who = async (page) =>
  page.evaluate(() => {
    const g = document.querySelector("build-menu")?.game;
    const me = g?.myPlayer();
    const h = g?.hegemon();
    return {
      ticks: g?.ticks(),
      me: me
        ? {
            name: me.name(),
            isHegemon: me.isHegemon(),
            troops: me.troops(),
            tiles: me.numTilesOwned(),
          }
        : null,
      hegemon: h
        ? { name: h.name(), type: h.type(), troops: h.troops() }
        : null,
      panel: document
        .querySelector("dark-star-panel")
        ?.textContent.replace(/\s+/g, " ")
        .trim()
        .slice(0, 200),
    };
  });
console.log("A in game", JSON.stringify(await who(host)));
console.log("B in game", JSON.stringify(await who(joiner)));
await host.screenshot({ path: `${OUT}/throne-3-host-game.png` });
await joiner.screenshot({ path: `${OUT}/throne-4-joiner-game.png` });
await browser.close();
