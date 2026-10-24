/**
 * The player wiki (src/wiki/WikiBuilder.ts): wiki/pages/*.md is built into
 * resources/public/wiki/ and committed, so the deploy needs no build step.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, test } from "vitest";
import { getDefaultKeybinds } from "../../src/core/game/UserSettings";
import {
  buildWiki,
  loadPages,
  WIKI_OUTPUT_DIR,
} from "../../src/wiki/WikiBuilder";

const root = process.cwd();

function listFiles(dir: string): string[] {
  return fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) =>
      path
        .relative(root, path.join(d.parentPath, d.name))
        .split(path.sep)
        .join("/"),
    )
    .sort();
}

describe("the wiki", () => {
  const built = buildWiki(root);

  test("the committed pages are up to date (run `npm run wiki`)", () => {
    for (const [rel, content] of built) {
      const onDisk = fs.readFileSync(path.join(root, rel), "utf8");
      expect(onDisk, `${rel} is stale: run npm run wiki`).toBe(content);
    }
    const expected = [...built.keys()]
      .filter((rel) => rel.startsWith("resources/public/wiki/"))
      .sort();
    expect(listFiles(path.join(root, WIKI_OUTPUT_DIR))).toEqual(expected);
  });

  test("every page has a search-result-sized description", () => {
    for (const page of loadPages(root)) {
      expect(page.description.length, page.slug).toBeGreaterThanOrEqual(50);
      expect(page.description.length, page.slug).toBeLessThanOrEqual(170);
    }
  });

  test("the sitemap lists the home page and every wiki page", () => {
    const sitemap = built.get("resources/public/sitemap.xml")!;
    expect(sitemap).toContain("https://darkstar.january-games.com/</loc>");
    for (const page of loadPages(root)) {
      const url = page.slug === "index" ? "/wiki/" : `/wiki/${page.slug}/`;
      expect(sitemap).toContain(`${url}</loc>`);
    }
  });

  test("the controls page shows every default key", () => {
    const html = built.get("resources/public/wiki/controls/index.html")!;
    const labels: Record<string, string> = { Comma: ",", Period: "." };
    for (const code of Object.values(getDefaultKeybinds(false))) {
      for (const part of code.split("+")) {
        const label = part.startsWith("Key")
          ? part.slice(3)
          : part.startsWith("Digit")
            ? part.slice(5)
            : labels[part];
        if (label === undefined) continue; // modifiers, Space: written out
        expect(html, `${code} missing`).toContain(`<kbd>${label}</kbd>`);
      }
    }
  });
});

describe("the wiki build refuses", () => {
  function fixture(pages: Record<string, string>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wiki-"));
    fs.mkdirSync(path.join(dir, "wiki", "pages"), { recursive: true });
    fs.mkdirSync(path.join(dir, "resources", "maps"), { recursive: true });
    fs.mkdirSync(path.join(dir, "resources", "lang"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "resources", "lang", "en.json"),
      JSON.stringify({ map: {} }),
    );
    for (const [slug, body] of Object.entries(pages)) {
      fs.writeFileSync(
        path.join(dir, "wiki", "pages", `${slug}.md`),
        `---\ntitle: ${slug}\ndescription: d\nsection: Start here\norder: 1\n---\n${body}\n`,
      );
    }
    return dir;
  }

  test("an unknown number", () => {
    expect(() => buildWiki(fixture({ index: "{{nope}}" }))).toThrow(
      /unknown number \{\{nope\}\}/,
    );
  });

  test("a link to a missing page", () => {
    expect(() => buildWiki(fixture({ index: "[[nowhere]]" }))).toThrow(
      /no page "nowhere"/,
    );
  });

  test("a link to a missing heading", () => {
    const dir = fixture({
      index: "[[other#gone|there]]",
      other: "## Here",
    });
    expect(() => buildWiki(dir)).toThrow(/missing anchor \/wiki\/other\/#gone/);
  });
});
