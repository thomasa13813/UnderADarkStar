// Soak test (Launch doc, "Watching it"): N scripted browsers join the throne
// the hero card shows, wait for the countdown, launch into the round, expand
// for a few minutes, and report what the server did under that load as seen
// from the clients: join latency, time to start, tick rate per client, any
// disconnect, refusal or page error. Run from the repo root:
//
//   node .claude/skills/run-openfront/soak.mjs <url> [clients=10] [minutes=6]
//   node .claude/skills/run-openfront/soak.mjs https://darkstar.january-games.com 10 6
//
// While it runs it prints "PEAK" once the round is under way; that is the
// moment to read the server's load and logs (docs-private/server.cmd).
// Output: out/browser/soak-*.png and a JSON summary on stdout, also written
// to out/browser/soak-summary.json. One browser, one context per client, so
// each client is its own guest identity; all share this machine's IP.
import fs from "fs";

if (process.argv[2]) process.env.OPENFRONT_URL = process.argv[2];
const N = Number(process.argv[3] ?? 10);
const MINUTES = Number(process.argv[4] ?? 6);
const { gotoHome, launch } = await import("./driver.mjs");
const { clickWorld, findExpansionTile, gameState, attack } =
  await import("./game.mjs");

const OUT = process.env.OUT ?? "out/browser";
fs.mkdirSync(OUT, { recursive: true });
const RAF_MS = 2000; // keep N WebGL pages cheap; the sim runs in a worker
const JOIN_STAGGER_MS = 1500;
const JOIN_TIMEOUT_MS = 45_000;
const START_TIMEOUT_MS = 6 * 60_000; // countdown is 2 min on the live site
const SAMPLE_MS = 15_000;

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
const clients = [];
const summary = {
  url: process.env.OPENFRONT_URL ?? "http://localhost:9000",
  clients: N,
  minutes: MINUTES,
  lobby: null,
  joinMs: [],
  refused: [],
  startedAt: null,
  countdownSeenMs: null,
  spawned: 0,
  tickRates: [], // per sample: {t, rates: [ticks/s per client]}
  dialogs: [],
  pageErrors: [],
  debug: [],
  stalls: 0,
  verdict: "unknown",
};

const { browser, page: firstPage } = await launch({
  rafIntervalMs: RAF_MS,
  viewport: { width: 1000, height: 700 },
});

async function newClient(i) {
  let page = firstPage;
  if (i > 0) {
    const context = await browser.newContext({
      viewport: { width: 1000, height: 700 },
    });
    await context.addInitScript((interval) => {
      let last = 0;
      window.requestAnimationFrame = (cb) => {
        const now = performance.now();
        const wait = Math.max(0, interval - (now - last));
        return setTimeout(() => {
          last = performance.now();
          cb(last);
        }, wait);
      };
      window.cancelAnimationFrame = (id) => clearTimeout(id);
    }, RAF_MS);
    page = await context.newPage();
  }
  const c = {
    i,
    page,
    joined: false,
    inGame: false,
    spawned: false,
    ticks: [],
  };
  page.on("dialog", async (d) => {
    summary.dialogs.push(`c${i}: ${d.message().slice(0, 160)}`);
    log(`c${i} DIALOG: ${d.message().slice(0, 120)}`);
    await d.dismiss();
  });
  page.on("pageerror", (e) => {
    const m = e.message.split("\n")[0];
    if (!/inSpawnPhase/.test(m))
      summary.pageErrors.push(`c${i}: ${m.slice(0, 160)}`);
  });
  page.on("crash", () => summary.pageErrors.push(`c${i}: PAGE CRASHED`));
  // The runner logs "clicked cell" on every map click and the sim warns when
  // a spawn cannot be placed; both tell us whether the opening click landed.
  page.on("console", (m) => {
    const t = m.text();
    if (
      /clicked cell|spawn|opening|cannot/i.test(t) &&
      summary.debug.length < 60
    ) {
      summary.debug.push(`c${i}: ${t.slice(0, 140)}`);
    }
  });
  return c;
}

const readModal = (page) =>
  page.evaluate(() => {
    const m = document.querySelector("join-lobby-modal");
    if (!m) return null;
    const players = m.players ?? [];
    return {
      lobbyId: m.currentLobbyId ?? "",
      connecting: m.isConnecting,
      players: players.length,
      inList: players.some((p) => p.clientID === m.currentClientID),
      throne: m.throne?.name ?? null,
      startAt: m.lobbyStartAt ?? null,
    };
  });

async function join(c) {
  const { page } = c;
  await gotoHome(page);
  await page
    .waitForFunction(
      () => !!document.querySelector("game-mode-selector")?.lobbies,
      {
        timeout: 30_000,
      },
    )
    .catch(() => {});
  const t0 = Date.now();
  const ok = await page.evaluate(() =>
    document.querySelector("game-mode-selector")?.joinHeroLobby?.(),
  );
  if (!ok) throw new Error("no hero throne card to join");
  while (Date.now() - t0 < JOIN_TIMEOUT_MS) {
    const m = await readModal(page);
    if (m && m.lobbyId && !m.connecting && m.inList) {
      c.joined = true;
      c.joinMs = Date.now() - t0;
      summary.joinMs.push(c.joinMs);
      summary.lobby ??= { id: m.lobbyId, throne: m.throne };
      if (m.startAt && summary.countdownSeenMs === null) {
        summary.countdownSeenMs = Date.now();
      }
      log(
        `c${c.i} joined ${m.lobbyId} (${m.throne}) in ${c.joinMs} ms; ${m.players} in lobby`,
      );
      return;
    }
    const dialog = summary.dialogs.find((d) => d.startsWith(`c${c.i}:`));
    if (dialog) throw new Error(`refused: ${dialog}`);
    await page.waitForTimeout(500);
  }
  throw new Error("join timed out");
}

// ---- 1. join, staggered ----------------------------------------------------
for (let i = 0; i < N; i++) {
  const c = await newClient(i);
  clients.push(c);
  try {
    await join(c);
  } catch (e) {
    summary.refused.push(`c${i}: ${e.message}`);
    log(`c${i} NOT joined: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, JOIN_STAGGER_MS));
}
await clients[0].page.screenshot({ path: `${OUT}/soak-lobby.png` });
const joined = clients.filter((c) => c.joined);
log(`${joined.length}/${N} joined`);
if (joined.length === 0) {
  summary.verdict = "no client could join";
  await finish();
}

// ---- 2. wait for the round to start ---------------------------------------
log("waiting for the countdown and the start");
const inGame = (page) =>
  page.evaluate(() => {
    const g = document.querySelector("build-menu")?.game;
    return !!g && g.ticks() > 0;
  });
const tStart = Date.now();
while (Date.now() - tStart < START_TIMEOUT_MS) {
  for (const c of joined) {
    if (!c.inGame && (await inGame(c.page).catch(() => false))) {
      c.inGame = true;
      summary.startedAt ??= Date.now();
      log(`c${c.i} is in the game`);
    }
  }
  if (joined.every((c) => c.inGame)) break;
  // Once the round is under way, stragglers (a client that joined after the
  // countdown ran out, as happens with the dev server's 5 s countdown) get a
  // short grace, then the test goes on without them.
  if (summary.startedAt !== null && Date.now() - summary.startedAt > 30_000) {
    break;
  }
  await new Promise((r) => setTimeout(r, 1000));
}
const playing = joined.filter((c) => c.inGame);
log(`${playing.length}/${joined.length} reached the game`);
if (playing.length === 0) {
  summary.verdict = "the round never started";
  await finish();
}
summary.timeToStartMs = summary.startedAt - tStart;

// ---- 3. launch from the Dark Star (the spawn click) ------------------------
// A spawn click must land on unowned land (ClientGameRunner). On a galaxy
// map most land is a Lord's, so scan every tile rather than sample, and give
// each client a different pick; clickWorld pans the camera to it.
const findLandingTile = (page, seed) =>
  page.evaluate((s) => {
    const g = document.querySelector("build-menu")?.game;
    if (!g) return null;
    const w = g.width();
    const h = g.height();
    const free = [];
    for (let y = 2; y < h - 2; y += 2) {
      for (let x = 2; x < w - 2; x += 2) {
        const ref = g.ref(x, y);
        if (g.isLand(ref) && !g.hasOwner(ref)) free.push([x, y]);
      }
    }
    if (free.length === 0) return null;
    const [x, y] = free[(s * 7919) % free.length];
    return { x, y, candidates: free.length };
  }, seed);

for (const c of playing) {
  try {
    await c.page.waitForTimeout(1500);
    const tile = await findLandingTile(c.page, c.i + 1);
    if (!tile) throw new Error("no unowned land anywhere on the map");
    await clickWorld(c.page, tile.x, tile.y);
    c.spawnTile = tile;
    await c.page.waitForTimeout(4000);
    const after = await c.page.evaluate(
      ([x, y]) => {
        const g = document.querySelector("build-menu")?.game;
        if (!g) return "no game";
        const ref = g.ref(x, y);
        const o = g.opening?.();
        return JSON.stringify({
          tick: g.ticks(),
          inSpawnPhase: g.inSpawnPhase(),
          me: g.myPlayer() ? g.myPlayer().name() : null,
          inFlight: o ? Array.from(o.unitsInFlight?.() ?? []).length : null,
          tileOwned: g.hasOwner(ref),
          tileLand: g.isLand(ref),
        });
      },
      [tile.x, tile.y],
    );
    summary.debug.push(
      `c${c.i}: after click (${tile.x},${tile.y}) of ${tile.candidates} free: ${after}`,
    );
    log(`c${c.i} after click: ${after}`);
  } catch (e) {
    summary.pageErrors.push(
      `c${c.i}: spawn click failed: ${e.message.slice(0, 120)}`,
    );
  }
}
// The multiplayer spawn phase is 20 s (200 turns) and the flights land up to
// 15 s after it, so land is counted lazily in the play loop below.
await new Promise((r) => setTimeout(r, 40_000));
await playing[0].page.screenshot({ path: `${OUT}/soak-spawned.png` });
console.log(
  "\n==== PEAK: the round is under way. Read the server now, e.g.\n" +
    '  .\\docs-private\\server.cmd "docker stats --no-stream && docker logs --tail 80 deploy-game-1"\n',
);

// ---- 4. play: expand every sample, measure the tick rate ------------------
const tEnd = Date.now() + MINUTES * 60_000;
let last = null;
while (Date.now() < tEnd) {
  const now = Date.now();
  const sample = {
    t: Math.round((now - summary.startedAt) / 1000),
    rates: [],
    land: [],
  };
  for (const c of playing) {
    const s = await gameState(c.page).catch(() => null);
    if (!s) {
      sample.rates.push(null);
      sample.land.push(null);
      continue;
    }
    sample.land.push(s.myPlayer?.tilesOwned ?? 0);
    if (!c.spawned && s.myPlayer?.tilesOwned > 0) {
      c.spawned = true;
      summary.spawned++;
      summary.firstLandingS ??= sample.t;
    }
    const prev = c.ticks.at(-1);
    c.ticks.push({ t: now, ticks: s.ticks });
    if (prev) {
      const rate = ((s.ticks - prev.ticks) / (now - prev.t)) * 1000;
      sample.rates.push(Math.round(rate * 10) / 10);
      if (rate < 7) summary.stalls++;
    } else {
      sample.rates.push(null);
    }
    if (c.spawned && !s.inSpawnPhase && s.myPlayer?.isAlive) {
      try {
        const target = await findExpansionTile(c.page, c.spawnTile);
        if (target) await attack(c.page, target.x, target.y);
      } catch {
        /* a failed click is not a server fault */
      }
    }
  }
  if (last !== null) {
    summary.tickRates.push(sample);
    log(
      `t+${sample.t}s ticks/s per client: ${sample.rates.join(" ")} | land: ${sample.land.join(" ")}`,
    );
  }
  last = sample;
  await new Promise((r) => setTimeout(r, SAMPLE_MS));
}
await playing[0].page.screenshot({ path: `${OUT}/soak-end.png` });
summary.verdict =
  summary.refused.length === 0 &&
  summary.stalls === 0 &&
  summary.dialogs.length === 0
    ? "clean"
    : "see refused / stalls / dialogs";
await finish();

async function finish() {
  const rates = summary.tickRates.flatMap((s) =>
    s.rates.filter((r) => r !== null),
  );
  if (rates.length > 0) {
    summary.tickRateMin = Math.min(...rates);
    summary.tickRateAvg =
      Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 10) / 10;
  }
  await browser.close().catch(() => {});
  fs.writeFileSync(
    `${OUT}/soak-summary.json`,
    JSON.stringify(summary, null, 2),
  );
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}
