/**
 * The player wiki: Markdown pages in wiki/pages/ become static HTML under
 * resources/public/wiki/, served verbatim at /wiki/<slug>/ like the Terms and
 * Privacy pages. Static pages are what search engines index; the game itself
 * is a single-page app they cannot read.
 *
 * Page syntax beyond Markdown:
 * - Front matter between `---` lines: title, description, section, order,
 *   related (comma-separated slugs), and optionally source (a repo file whose
 *   body is the page, e.g. docs/DarkStar-Buildings.md).
 * - `{{name}}` is a number from the core defaults (wikiParams), so the text
 *   cannot drift from the simulation. An unknown name fails the build.
 * - `[[slug]]`, `[[slug|text]]` and `[[slug#anchor|text]]` link another page.
 *   An unknown slug fails the build.
 *
 * Run `npm run wiki` after editing a page; tests/wiki/Wiki.test.ts fails while
 * the committed output is stale.
 */
import fs from "fs";
import { Marked, RendererThis, Tokens } from "marked";
import path from "path";
import { CONTACT_EMAIL, DISCORD_INVITE_URL } from "../client/CommunityLinks";
import {
  ARMY_DEFAULTS,
  HEGEMON_DEFAULTS,
  PIRACY_DEFAULTS,
  SHIELD_ARRAY_DEFAULTS,
  STARGATE_DEFAULTS,
  UNIT_SUPPORT_DEFAULTS,
} from "../core/configuration/Config";

export const SITE_ORIGIN = "https://darkstar.january-games.com";
export const WIKI_SOURCE_DIR = path.join("wiki", "pages");
export const WIKI_OUTPUT_DIR = path.join("resources", "public", "wiki");
export const SITEMAP_PATH = path.join("resources", "public", "sitemap.xml");

/** The sidebar's sections, in order. Every page names one of these. */
export const WIKI_SECTIONS = [
  "Start here",
  "The throne",
  "Challengers",
  "The galaxy",
  "Reference",
] as const;
type WikiSection = (typeof WIKI_SECTIONS)[number];

export interface WikiPage {
  slug: string;
  title: string;
  description: string;
  section: WikiSection;
  order: number;
  related: string[];
  /** Markdown with front matter removed and tokens still in place. */
  markdown: string;
}

// "1M", "500k", "10,000": the style of the buildings reference.
function gold(n: number): string {
  if (n >= 1_000_000 && n % 1_000_000 === 0) return `${n / 1_000_000}M`;
  if (n >= 100_000 && n % 1_000 === 0) return `${n / 1_000}k`;
  return n.toLocaleString("en-US");
}

/** The numbers the pages quote, read from the core defaults. */
export function wikiParams(): Record<string, string> {
  const h = HEGEMON_DEFAULTS;
  const g = STARGATE_DEFAULTS;
  const a = SHIELD_ARRAY_DEFAULTS;
  const p = PIRACY_DEFAULTS;
  const army = ARMY_DEFAULTS;
  const params: Record<string, string | number> = {
    minutes: h.defaultRoundMinutes,
    ceiling: h.troopCeilingPercentOfWholeMapCap,
    refill: h.refillMinutes,
    tax: h.shadowTaxPercent,
    leveller: h.levellerFullPercent,
    threat: h.levellerThreatPercentOfCeiling,
    laststand: h.lastStandDomainLostPercent,
    reserve: h.lastStandReservePercent,
    raze: h.razeAttackerLossPercent / 100,
    free: h.tyrannyFreePermille / 10,
    floor: h.tyrannyFloorPermille / 10,
    stall: h.invasionStallSeconds,
    flag: h.punitiveFlagSeconds,
    levyN: h.punitiveLevyPercentNuclear,
    levyA: h.punitiveLevyPercentAntimatter,
    pRadius: h.punitiveRadius,
    halt: h.punitiveHaltSeconds,
    gateCost: gold(g.costGold),
    gateBase: g.rangeBase,
    gatePer: g.rangePerLevel,
    gateReload: g.cooldownSeconds,
    gateBuild: g.constructionSeconds,
    // The warhead prices under a Dark Star (Config.unitInfo, S6).
    nukeCost: gold(1_000_000),
    hCost: gold(5_000_000),
    shieldCost: gold(a.costGold),
    shieldR: a.radius,
    shieldBuild: a.constructionSeconds,
    armyPatrol: army.patrolRange,
    armyRange: army.shotRange,
    armyReload: army.shotCooldownSeconds,
    armyKill: army.casualtyPercent,
    armiesPerLevel: UNIT_SUPPORT_DEFAULTS.armiesPerFactoryLevel,
    destroyersPerLevel: UNIT_SUPPORT_DEFAULTS.destroyersPerPortLevel,
    // Piracy (docs/DarkStar-Piracy.md). Troops are engine units, ten times
    // the figure on screen.
    pirateWait: p.respawnSeconds,
    pirateWaitCap: p.respawnCapSeconds,
    raidGold: gold(p.raidGold),
    raidTroops: (p.raidTroops / 10).toLocaleString("en-US"),
    holdCap: (p.holdCap / 10).toLocaleString("en-US"),
    claimTiles: p.landingTiles,
    landingClose: p.landingClosesSeconds,
    // The winner's window is server configuration (ThroneRegistry windowMs).
    window: 30,
    discord: DISCORD_INVITE_URL,
    email: CONTACT_EMAIL,
  };
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, String(v)]),
  );
}

/**
 * `{{mapTable}}` and `{{mapCount}}`: the map library as shipped, read from
 * each map's manifest and its display name in en.json.
 */
export function mapParams(rootDir: string): Record<string, string> {
  const mapsDir = path.join(rootDir, "resources", "maps");
  const names: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(rootDir, "resources", "lang", "en.json"), "utf8"),
  ).map;
  const rows = fs
    .readdirSync(mapsDir)
    .filter((d) => fs.existsSync(path.join(mapsDir, d, "manifest.json")))
    .map((d) => {
      const manifest = JSON.parse(
        fs.readFileSync(path.join(mapsDir, d, "manifest.json"), "utf8"),
      );
      return {
        name: names[d] ?? manifest.name ?? d,
        size: `${manifest.map.width} × ${manifest.map.height}`,
        lords: (manifest.nations ?? []).length,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  const table = [
    "| Map | Size (tiles) | Lords |",
    "| --- | --- | --- |",
    ...rows.map((r) => `| **${r.name}** | ${r.size} | ${r.lords} |`),
  ].join("\n");
  return { mapTable: table, mapCount: String(rows.length) };
}

function parseFrontMatter(
  text: string,
  file: string,
): { meta: Record<string, string>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!match) throw new Error(`${file}: missing front matter`);
  const meta: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (line.trim() === "") continue;
    const colon = line.indexOf(":");
    if (colon < 0) throw new Error(`${file}: bad front matter line "${line}"`);
    meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { meta, body: text.slice(match[0].length) };
}

// A source document's maintainer comment and H1 are not part of the page:
// the page has its own title.
function stripSourceHeader(text: string): string {
  return text
    .replace(/^\s*<!--[\s\S]*?-->\s*/, "")
    .replace(/^# .*\r?\n/, "")
    .trimStart();
}

export function loadPages(rootDir: string): WikiPage[] {
  const dir = path.join(rootDir, WIKI_SOURCE_DIR);
  const pages = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((file): WikiPage => {
      const { meta, body } = parseFrontMatter(
        fs.readFileSync(path.join(dir, file), "utf8"),
        file,
      );
      const slug = file.replace(/\.md$/, "");
      for (const key of ["title", "description", "section", "order"]) {
        if (!meta[key]) throw new Error(`${file}: front matter needs ${key}`);
      }
      if (!(WIKI_SECTIONS as readonly string[]).includes(meta.section)) {
        throw new Error(`${file}: unknown section "${meta.section}"`);
      }
      const markdown = meta.source
        ? `${body.trim()}\n\n${stripSourceHeader(
            fs.readFileSync(path.join(rootDir, meta.source), "utf8"),
          )}`
        : body;
      return {
        slug,
        title: meta.title,
        description: meta.description,
        section: meta.section as WikiSection,
        order: Number(meta.order),
        related: meta.related
          ? meta.related
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)
          : [],
        markdown,
      };
    });
  const slugs = new Set(pages.map((p) => p.slug));
  for (const page of pages) {
    for (const r of page.related) {
      if (!slugs.has(r)) {
        throw new Error(`${page.slug}: related page "${r}" does not exist`);
      }
    }
  }
  return pages.sort(
    (a, b) =>
      WIKI_SECTIONS.indexOf(a.section) - WIKI_SECTIONS.indexOf(b.section) ||
      a.order - b.order ||
      a.slug.localeCompare(b.slug),
  );
}

export function pageUrl(slug: string): string {
  return slug === "index" ? "/wiki/" : `/wiki/${slug}/`;
}

function expandTokens(
  markdown: string,
  page: WikiPage,
  pages: Map<string, WikiPage>,
  params: Record<string, string>,
): string {
  return (
    markdown
      .replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
        const value = params[name];
        if (value === undefined) {
          throw new Error(`${page.slug}: unknown number {{${name}}}`);
        }
        return value;
      })
      // Inside a table cell the separator is written `\|`.
      .replace(
        /\[\[([\w-]+)(#[\w-]+)?(?:\\?\|([^\]]+))?\]\]/g,
        (_, slug: string, anchor: string | undefined, text?: string) => {
          const target = pages.get(slug);
          if (!target) throw new Error(`${page.slug}: no page "${slug}"`);
          return `[${text ?? target.title}](${pageUrl(slug)}${anchor ?? ""})`;
        },
      )
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&#?\w+;/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

interface RenderedBody {
  html: string;
  toc: { id: string; text: string }[];
}

function renderMarkdown(markdown: string): RenderedBody {
  const toc: { id: string; text: string }[] = [];
  const used = new Set<string>();
  const marked = new Marked({
    gfm: true,
    renderer: {
      heading(this: RendererThis, { tokens, depth }: Tokens.Heading): string {
        const inner = this.parser.parseInline(tokens);
        let id = headingId(inner) || "section";
        for (let n = 2; used.has(id); n++) id = `${headingId(inner)}-${n}`;
        used.add(id);
        if (depth === 2) toc.push({ id, text: inner.replace(/<[^>]+>/g, "") });
        return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
      },
      // Wide tables scroll inside their own box on a phone.
      table(this: RendererThis, token: Tokens.Table): string {
        const cell = (c: Tokens.TableCell, tag: string): string => {
          const align = c.align ? ` style="text-align:${c.align}"` : "";
          return `<${tag}${align}>${this.parser.parseInline(
            c.tokens,
          )}</${tag}>`;
        };
        const head = token.header.map((c) => cell(c, "th")).join("");
        const rows = token.rows
          .map((r) => `<tr>${r.map((c) => cell(c, "td")).join("")}</tr>`)
          .join("\n");
        return `<div class="table-wrap"><table>\n<thead><tr>${head}</tr></thead>\n<tbody>\n${rows}\n</tbody></table></div>\n`;
      },
    },
  });
  const html = marked.parse(markdown, { async: false }) as string;
  return { html, toc };
}

const STYLE = `
:root{color-scheme:dark;--bg:#0b0d14;--panel:#141824;--line:rgba(255,255,255,.1);--text:#e4e4e7;--muted:#a1a1aa;--head:#fff;--accent:#93c5fd;--accent-strong:#60a5fa}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;line-height:1.6}
a{color:var(--accent)}
a:hover{color:#bfdbfe}
.topbar{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:16px;padding:10px 16px;background:rgba(11,13,20,.92);backdrop-filter:blur(6px);border-bottom:1px solid var(--line)}
.brand{color:var(--head);text-decoration:none;font-weight:700;letter-spacing:.06em;text-transform:uppercase;font-size:.95rem}
.brand span{color:var(--accent);font-weight:600}
.topbar .spacer{flex:1}
.play{background:var(--accent-strong);color:#0b0d14;text-decoration:none;font-weight:700;padding:6px 14px;border-radius:999px;font-size:.9rem;white-space:nowrap}
.play:hover{background:#93c5fd;color:#0b0d14}
.layout{display:grid;grid-template-columns:240px minmax(0,1fr);gap:40px;max-width:1120px;margin:0 auto;padding:24px 16px 64px}
nav.side{position:sticky;top:64px;align-self:start;max-height:calc(100vh - 80px);overflow:auto;font-size:.92rem}
nav.side h2{font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted);margin:18px 0 6px;border:0;padding:0}
nav.side ul{list-style:none;margin:0;padding:0}
nav.side a{display:block;padding:3px 10px;border-radius:6px;color:var(--text);text-decoration:none}
nav.side a:hover{background:rgba(255,255,255,.06)}
nav.side a[aria-current]{background:rgba(96,165,250,.15);color:var(--head);font-weight:600}
details.mobile-nav{display:none}
main{min-width:0}
.crumbs{font-size:.85rem;color:var(--muted);margin:0 0 4px}
.crumbs a{color:var(--muted)}
h1{margin:0 0 6px;font-size:2.1rem;color:var(--head);line-height:1.2}
.lede{color:var(--muted);margin:0 0 20px;font-size:1.05rem}
h2{margin-top:40px;padding-bottom:4px;border-bottom:1px solid var(--line);font-size:1.4rem;color:var(--head)}
h3{margin:26px 0 6px;font-size:1.12rem;color:#f4f4f5}
h4{margin:20px 0 4px;color:#f4f4f5}
code{font-size:.9em;background:rgba(255,255,255,.07);padding:1px 5px;border-radius:4px}
kbd{display:inline-block;min-width:1.6em;text-align:center;font:600 .82em/1.4 ui-monospace,monospace;padding:1px 6px;border:1px solid rgba(255,255,255,.3);border-bottom-width:2px;border-radius:5px;background:rgba(255,255,255,.06);color:var(--head)}
.table-wrap{overflow-x:auto;margin:12px 0}
table{width:100%;border-collapse:collapse;font-size:.93rem}
th,td{padding:7px 9px;border:1px solid var(--line);text-align:left;vertical-align:top}
th{background:rgba(255,255,255,.06)}
blockquote{margin:16px 0;padding:6px 16px;background:var(--panel);border-left:3px solid var(--accent-strong);border-radius:0 8px 8px 0}
.toc{margin:16px 0 8px;padding:10px 18px;background:var(--panel);border:1px solid var(--line);border-radius:10px;font-size:.92rem}
.toc strong{display:block;color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;margin-bottom:4px}
.toc ol{margin:0;padding-left:20px}
.related{margin-top:48px;padding:14px 18px;background:var(--panel);border:1px solid var(--line);border-radius:10px}
.related h2{margin:0 0 6px;font-size:1rem;border:0;padding:0}
.related ul{margin:0;padding-left:20px}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px;margin:12px 0 8px;padding:0;list-style:none}
.cards a{display:block;height:100%;padding:12px 14px;background:var(--panel);border:1px solid var(--line);border-radius:10px;text-decoration:none;color:var(--text)}
.cards a:hover{border-color:var(--accent-strong)}
.cards strong{display:block;color:var(--head);margin-bottom:2px}
.cards span{font-size:.88rem;color:var(--muted)}
footer{border-top:1px solid var(--line);padding:20px 16px 40px;text-align:center;font-size:.85rem;color:var(--muted)}
footer a{color:var(--muted);margin:0 8px}
@media (max-width:820px){
.layout{display:block;padding-top:12px}
nav.side{display:none}
details.mobile-nav{display:block;margin-bottom:16px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 14px}
details.mobile-nav summary{cursor:pointer;font-weight:600}
details.mobile-nav nav.side{display:block;position:static;max-height:none}
h1{font-size:1.7rem}
}
`.trim();

function renderNav(pages: WikiPage[], current: string): string {
  const sections = WIKI_SECTIONS.map((section) => {
    const items = pages
      .filter((p) => p.section === section && p.slug !== "index")
      .map(
        (p) =>
          `<li><a href="${pageUrl(p.slug)}"${
            p.slug === current ? ' aria-current="page"' : ""
          }>${escapeHtml(p.title)}</a></li>`,
      )
      .join("");
    return items ? `<h2>${section}</h2><ul>${items}</ul>` : "";
  }).join("");
  const home = `<ul><li><a href="/wiki/"${
    current === "index" ? ' aria-current="page"' : ""
  }>Wiki home</a></li></ul>`;
  return `<nav class="side" aria-label="Wiki pages">${home}${sections}</nav>`;
}

/** The home page's card grid: every page, by section. */
function renderIndexCards(pages: WikiPage[]): string {
  return WIKI_SECTIONS.map((section) => {
    const cards = pages
      .filter((p) => p.section === section && p.slug !== "index")
      .map(
        (p) =>
          `<li><a href="${pageUrl(p.slug)}"><strong>${escapeHtml(
            p.title,
          )}</strong><span>${escapeHtml(p.description)}</span></a></li>`,
      )
      .join("");
    return cards
      ? `<h2 id="${headingId(section)}">${section}</h2><ul class="cards">${cards}</ul>`
      : "";
  }).join("\n");
}

function renderPage(
  page: WikiPage,
  pages: WikiPage[],
  bySlug: Map<string, WikiPage>,
  params: Record<string, string>,
): string {
  const body = renderMarkdown(
    expandTokens(page.markdown, page, bySlug, params),
  );
  const isIndex = page.slug === "index";
  const url = `${SITE_ORIGIN}${pageUrl(page.slug)}`;
  const docTitle = isIndex
    ? "Under a Dark Star Wiki"
    : `${page.title} - Under a Dark Star Wiki`;
  const toc =
    body.toc.length >= 3
      ? `<div class="toc"><strong>On this page</strong><ol>${body.toc
          .map((t) => `<li><a href="#${t.id}">${t.text}</a></li>`)
          .join("")}</ol></div>`
      : "";
  const related = page.related.length
    ? `<aside class="related"><h2>Related pages</h2><ul>${page.related
        .map((slug) => {
          const r = bySlug.get(slug)!;
          return `<li><a href="${pageUrl(slug)}">${escapeHtml(
            r.title,
          )}</a> - ${escapeHtml(r.description)}</li>`;
        })
        .join("")}</ul></aside>`
    : "";
  const crumbs = isIndex
    ? ""
    : `<p class="crumbs"><a href="/wiki/">Wiki</a> / ${page.section}</p>`;
  const nav = renderNav(pages, page.slug);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${escapeHtml(docTitle)}</title>
<meta name="description" content="${escapeHtml(page.description)}" />
<link rel="canonical" href="${url}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="Under a Dark Star" />
<meta property="og:title" content="${escapeHtml(docTitle)}" />
<meta property="og:description" content="${escapeHtml(page.description)}" />
<meta property="og:url" content="${url}" />
<meta name="twitter:card" content="summary" />
<style>${STYLE}</style>
</head>
<body>
<header class="topbar">
<a class="brand" href="/wiki/">Under a Dark Star <span>Wiki</span></a>
<span class="spacer"></span>
<a class="play" href="/">Play now</a>
</header>
<div class="layout">
${nav}
<main>
<details class="mobile-nav"><summary>All wiki pages</summary>${nav}</details>
${crumbs}
<h1>${escapeHtml(isIndex ? "Under a Dark Star Wiki" : page.title)}</h1>
<p class="lede">${escapeHtml(page.description)}</p>
${toc}
${body.html}
${isIndex ? renderIndexCards(pages) : ""}
${related}
</main>
</div>
<footer>
<a href="/">Play Under a Dark Star</a>
<a href="${escapeHtml(DISCORD_INVITE_URL)}" rel="noopener">Discord</a>
<a href="mailto:${CONTACT_EMAIL}">${CONTACT_EMAIL}</a>
<a href="/terms.html">Terms</a>
<a href="/privacy.html">Privacy</a>
<p>Under a Dark Star by January Games, LLC. Built on OpenFront.</p>
</footer>
</body>
</html>
`;
}

function renderSitemap(pages: WikiPage[]): string {
  const urls = [
    `${SITE_ORIGIN}/`,
    ...pages.map((p) => `${SITE_ORIGIN}${pageUrl(p.slug)}`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}
</urlset>
`;
}

// A link to /wiki/<slug>/#<anchor> must name a heading on that page, so a
// renamed heading in a source document fails the build rather than the reader.
function checkAnchors(out: Map<string, string>, outDir: string): void {
  const ids = new Map<string, Set<string>>();
  for (const [rel, html] of out) {
    if (!rel.endsWith("index.html")) continue;
    const url = `/${rel.slice(outDir.indexOf("wiki")).replace(/index\.html$/, "")}`;
    ids.set(
      url,
      new Set([...html.matchAll(/ id="([^"]+)"/g)].map((m) => m[1])),
    );
  }
  for (const [rel, html] of out) {
    for (const m of html.matchAll(/href="(\/wiki\/[^"#]*)#([^"]+)"/g)) {
      if (!ids.get(m[1])?.has(m[2])) {
        throw new Error(`${rel}: link to missing anchor ${m[1]}#${m[2]}`);
      }
    }
  }
}

/**
 * Every output file, keyed by its path relative to rootDir (posix
 * separators): one index.html per page, plus the sitemap.
 */
export function buildWiki(rootDir: string): Map<string, string> {
  const pages = loadPages(rootDir);
  if (!pages.some((p) => p.slug === "index")) {
    throw new Error("wiki/pages/index.md is missing");
  }
  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const params = { ...wikiParams(), ...mapParams(rootDir) };
  const out = new Map<string, string>();
  const outDir = WIKI_OUTPUT_DIR.split(path.sep).join("/");
  for (const page of pages) {
    const rel =
      page.slug === "index"
        ? `${outDir}/index.html`
        : `${outDir}/${page.slug}/index.html`;
    out.set(rel, renderPage(page, pages, bySlug, params));
  }
  checkAnchors(out, outDir);
  out.set(SITEMAP_PATH.split(path.sep).join("/"), renderSitemap(pages));
  return out;
}

/** Rewrites the wiki output, removing pages that no longer exist. */
export function writeWiki(rootDir: string): number {
  const files = buildWiki(rootDir);
  fs.rmSync(path.join(rootDir, WIKI_OUTPUT_DIR), {
    recursive: true,
    force: true,
  });
  for (const [rel, content] of files) {
    const target = path.join(rootDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return files.size;
}
