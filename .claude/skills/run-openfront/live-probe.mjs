// Live-site probe (Launch doc, "Watching it"): one scripted browser loads the
// site named by OPENFRONT_URL, joins the throne the hero card shows, exactly
// as the nav bar's Play does, and reports whether the join went through: the
// question is whether Cloudflare Turnstile admits an automated browser. It
// then leaves. Run from the repo root:
//
//   node .claude/skills/run-openfront/live-probe.mjs https://darkstar.january-games.com
//
// (The URL may also come from OPENFRONT_URL; no argument and no variable
// means the local dev server.) Output: out/browser/live-probe-*.png and a
// JSON summary on stdout. Validated against the dev server 2026-10-12: the
// join lands in the throne lobby in about a second.
import fs from "fs";

if (process.argv[2]) process.env.OPENFRONT_URL = process.argv[2];
const { gotoHome, launch } = await import("./driver.mjs");

const OUT = process.env.OUT ?? "out/browser";
fs.mkdirSync(OUT, { recursive: true });
const JOIN_TIMEOUT_MS = Number(process.env.JOIN_TIMEOUT_MS ?? 45000);
const LINGER_MS = Number(process.env.LINGER_MS ?? 5000);

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const summary = {
  dialogs: [],
  consoleErrors: [],
  pageErrors: [],
  lobby: null,
  joinMs: null,
  verdict: "unknown",
};

const { browser, page } = await launch();
page.on("dialog", async (d) => {
  summary.dialogs.push(d.message());
  log("DIALOG:", d.message());
  await d.dismiss();
});
page.on("pageerror", (e) => summary.pageErrors.push(e.message.split("\n")[0]));
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error" || /turnstile|join|refus|reject/i.test(t)) {
    summary.consoleErrors.push(t.slice(0, 200));
  }
});

await gotoHome(page);
log("home loaded:", page.url());
await page.screenshot({ path: `${OUT}/live-probe-home.png` });

// Wait for the throne cards (the master's lobby list) to arrive: the selector
// keeps them as a PublicGames object, and joinHeroLobby() needs a hero card.
const cards = await page
  .waitForFunction(
    () => {
      const sel = document.querySelector("game-mode-selector");
      return sel?.lobbies ? true : false;
    },
    { timeout: 30000 },
  )
  .then(() => true)
  .catch(() => false);
log("lobby list on the page:", cards);

const t0 = Date.now();
const clicked = await page.evaluate(() =>
  document.querySelector("game-mode-selector")?.joinHeroLobby?.(),
);
log("joinHeroLobby() returned", clicked);

const readModal = () =>
  page.evaluate(() => {
    const m = document.querySelector("join-lobby-modal");
    if (!m) return null;
    // `players` is the server's client list (set on every lobby update);
    // `playerCount` is a different, later-arriving figure, so joined means
    // we appear in the list.
    return {
      lobbyId: m.currentLobbyId ?? "",
      connecting: m.isConnecting,
      players: (m.players ?? []).length,
      inList: (m.players ?? []).some((c) => c.clientID === m.currentClientID),
      clientId: m.currentClientID ?? "",
      throne: m.throne?.name ?? null,
      startAt: m.lobbyStartAt ?? null,
    };
  });

let joined = false;
while (Date.now() - t0 < JOIN_TIMEOUT_MS) {
  const m = await readModal();
  if (m && m.lobbyId && !m.connecting && m.inList) {
    summary.lobby = m;
    summary.joinMs = Date.now() - t0;
    joined = true;
    break;
  }
  if (summary.dialogs.length > 0) break; // Turnstile alerted: the join is dead
  await page.waitForTimeout(500);
}
await page.screenshot({ path: `${OUT}/live-probe-after-join.png` });

if (joined) {
  log(
    `JOINED lobby ${summary.lobby.lobbyId} in ${summary.joinMs} ms`,
    summary.lobby,
  );
  await page.waitForTimeout(LINGER_MS);
  summary.lobby = await readModal();
  summary.verdict = "joined";
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent("leave-lobby", { bubbles: true })),
  );
  await page.waitForTimeout(1000);
} else {
  summary.verdict = summary.dialogs.length > 0 ? "refused" : "timeout";
  log("NOT JOINED:", summary.verdict, await readModal());
}

await browser.close();
console.log(JSON.stringify(summary, null, 2));
