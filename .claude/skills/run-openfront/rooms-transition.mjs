// Scratch check: the generic transition between a room's rounds (L41).
import { launch } from "./driver.mjs";
const out = process.argv[2];
const { browser, page } = await launch();
await page.goto("http://localhost:9000/");
await page.evaluate(() => sessionStorage.setItem("darkstar.roundTransition", "1"));
await page.goto("http://localhost:9000/");
await page.waitForTimeout(900);
console.log("overlay", await page.evaluate(() => !!document.querySelector("[data-round-transition]")));
await page.screenshot({ path: `${out}/s3-transition.png` });
await page.waitForTimeout(3000);
console.log("after", await page.evaluate(() => !!document.querySelector("[data-round-transition]")));
await browser.close();
