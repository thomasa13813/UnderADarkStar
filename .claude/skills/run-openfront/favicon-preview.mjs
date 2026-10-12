// Renders branding/images/Favicon.svg at tab-icon sizes on light and dark
// tab bars. Usage: node .claude/skills/run-openfront/favicon-preview.mjs <out.png>
import { readFileSync } from "node:fs";
import { chromium } from "playwright";
const svg = readFileSync("branding/images/Favicon.svg", "utf8");
const data = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
const row = (bg, fg) =>
  `<div style="background:${bg};color:${fg};padding:16px;display:flex;gap:24px;align-items:center;font:14px sans-serif">
     ${[16, 24, 32, 64].map((s) => `<img src="${data}" width="${s}" height="${s}"> <span>${s}px</span>`).join("")}
   </div>`;
const html = `<body style="margin:0">${row("#202124", "#eee")}${row("#f1f3f4", "#222")}</body>`;
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 520, height: 200 },
  deviceScaleFactor: 2,
});
await page.setContent(html);
await page.screenshot({ path: process.argv[2] ?? "favicon-preview.png" });
await browser.close();
