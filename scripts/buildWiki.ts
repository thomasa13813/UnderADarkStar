// Builds the player wiki: wiki/pages/*.md -> resources/public/wiki/ and
// resources/public/sitemap.xml (src/wiki/WikiBuilder.ts). Run after editing a
// page, or docs/DarkStar-Buildings.md, which the Buildings page includes.
import { writeWiki } from "../src/wiki/WikiBuilder";

const count = writeWiki(process.cwd());
console.log(`Wiki built: ${count} files.`);
