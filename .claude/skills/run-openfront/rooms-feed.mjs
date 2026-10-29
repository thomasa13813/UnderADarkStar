// Scratch check for the rooms (feat/rooms): what the public feed says about
// each room, and the titles the home cards give them.
import { launch, gotoHome } from "./driver.mjs";

const { browser, page } = await launch();
await gotoHome(page);
await page.waitForFunction(
  () => !!document.querySelector("game-mode-selector")?.lobbies,
  { timeout: 30_000 },
);
const rooms = await page.evaluate(() => {
  const sel = document.querySelector("game-mode-selector");
  return (sel.lobbies.games.throne ?? []).map((g) => ({
    name: g.throne?.name,
    type: g.throne?.type,
    map: g.gameConfig?.gameMap,
    max: g.gameConfig?.maxPlayers,
    playerTeams: g.gameConfig?.playerTeams,
    title: sel.getModeTitle?.(g),
  }));
});
console.log(JSON.stringify(rooms, null, 1));
await browser.close();
