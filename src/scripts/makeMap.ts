/**
 * The map kit (docs/MapMaking.md): turns a drawing made in any paint program
 * into a playable map.
 *
 *   npm run map                      list the drawings
 *   npm run map new "Twin Suns"      make a starting drawing
 *   npm run map check "Twin Suns"    report on a drawing, change nothing
 *   npm run map "Twin Suns"          build the map from its drawing
 *   npm run map remove "Twin Suns"   take a map out of the game
 *
 * Drawings live in map-generator/drawings/<Map Name>.png; the file name is
 * the map's name. Building writes map-generator/assets/maps/<folder>/
 * (image.png and info.json) and runs the Go map-generator on it.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { convertDrawing, templateDrawing } from "./mapkit/Convert";
import { buildInfo, MapIdentity, mapIdentity } from "./mapkit/Info";
import { decodePng, encodePng } from "./mapkit/Png";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const GENERATOR = path.join(ROOT, "map-generator");
const DRAWINGS = path.join(GENERATOR, "drawings");
const ASSETS = path.join(GENERATOR, "assets", "maps");
const RESOURCES = path.join(ROOT, "resources", "maps");
const EN_JSON = path.join(ROOT, "resources", "lang", "en.json");
const DEFAULT_SIZE = 1800;

class KitError extends Error {}

function drawingPath(identity: MapIdentity): string {
  return path.join(DRAWINGS, `${identity.name}.png`);
}

/** The drawing for a name, matched without regard to case or spacing. */
function findDrawing(identity: MapIdentity): string | null {
  if (!fs.existsSync(DRAWINGS)) return null;
  for (const file of fs.readdirSync(DRAWINGS)) {
    if (!file.toLowerCase().endsWith(".png")) continue;
    try {
      if (mapIdentity(file.slice(0, -4)).folder === identity.folder) {
        return path.join(DRAWINGS, file);
      }
    } catch {
      // Not a usable map name; `list` reports it.
    }
  }
  return null;
}

function readJson(file: string): Record<string, unknown> | null {
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
}

/** Runs a command, echoing its output; false when it failed or is missing. */
function run(command: string, args: string[], cwd: string): boolean {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  return result.status === 0;
}

/** Formats a file the kit wrote, as `npm run format` would. */
function format(file: string): void {
  const prettier = path.join(ROOT, "node_modules/prettier/bin/prettier.cjs");
  run(
    process.execPath,
    [prettier, "--write", "--log-level", "warn", file],
    ROOT,
  );
}

/** The Go compiler: on the PATH, or in the usual install places. */
function findGo(): string | null {
  const exe = process.platform === "win32" ? "go.exe" : "go";
  const candidates = [
    process.env.GO,
    ...(process.env.PATH ?? "")
      .split(path.delimiter)
      .map((dir) => path.join(dir, exe)),
    path.join(os.homedir(), "go-sdk", "go", "bin", exe),
    path.join(os.homedir(), "go", "bin", exe),
    path.join("C:\\Program Files\\Go\\bin", exe),
    path.join("/usr/local/go/bin", exe),
  ];
  for (const candidate of candidates) {
    if (
      candidate !== undefined &&
      candidate !== "" &&
      fs.existsSync(candidate)
    ) {
      return candidate;
    }
  }
  return null;
}

/**
 * Runs the Go map-generator on one map folder. It also rewrites Maps.gen.ts
 * and the map names in en.json from every info.json, which is what makes a
 * new map appear in the game and a removed one disappear.
 */
function generate(folder: string): void {
  const go = findGo();
  if (go === null) {
    throw new KitError(
      "Go is not installed (or not where the kit looks). Install it from https://go.dev/doc/install, or set the GO environment variable to the path of go.exe.",
    );
  }
  console.log(
    `\nRunning the map generator on ${folder} (this takes a minute)...`,
  );
  if (!run(go, ["run", ".", `--maps=${folder}`], GENERATOR)) {
    throw new KitError("The map generator failed; its messages are above.");
  }
}

function report(title: string, lines: string[]): void {
  if (lines.length === 0) return;
  console.log(`\n${title}`);
  for (const line of lines) console.log(`  - ${line}`);
}

function list(): void {
  console.log("Drawings in map-generator/drawings:");
  const files = fs.existsSync(DRAWINGS)
    ? fs.readdirSync(DRAWINGS).filter((f) => f.toLowerCase().endsWith(".png"))
    : [];
  if (files.length === 0) console.log("  (none yet)");
  for (const file of files) {
    try {
      const identity = mapIdentity(file.slice(0, -4));
      const built = fs.existsSync(path.join(ASSETS, identity.folder));
      console.log(
        `  ${identity.name}  ${built ? "(built)" : "(not built yet)"}`,
      );
    } catch (e) {
      console.log(`  ${file}  (${(e as Error).message})`);
    }
  }
  console.log(
    '\nnpm run map new "Map Name"      make a starting drawing\n' +
      'npm run map check "Map Name"    report on a drawing, change nothing\n' +
      'npm run map "Map Name"          build the map\n' +
      'npm run map remove "Map Name"   take a map out of the game\n' +
      "\nThe guide is docs/MapMaking.md.",
  );
}

function create(identity: MapIdentity, size: number): void {
  const existing = findDrawing(identity);
  if (existing !== null) {
    throw new KitError(
      `There is already a drawing for this map: ${path.relative(ROOT, existing)}`,
    );
  }
  if (!Number.isInteger(size) || size < 200 || size > 2400 || size % 4 !== 0) {
    throw new KitError(
      "The size must be a whole number between 200 and 2400 that divides by 4 (1800 is the usual).",
    );
  }
  fs.mkdirSync(DRAWINGS, { recursive: true });
  const file = drawingPath(identity);
  fs.writeFileSync(file, encodePng(templateDrawing(size)));
  console.log(
    `Made ${path.relative(ROOT, file)} (${size} x ${size}).\n` +
      "It is all space, with the Dark Star as a yellow disc in the centre.\n" +
      `Open it in Paint, draw the map (palette in docs/MapMaking.md), save, then run:  npm run map "${identity.name}"`,
  );
}

function build(identity: MapIdentity, checkOnly: boolean): void {
  const drawing = findDrawing(identity);
  if (drawing === null) {
    throw new KitError(
      `No drawing found at ${path.relative(ROOT, drawingPath(identity))}. Make one with:  npm run map new "${identity.name}"`,
    );
  }
  // The drawing's own file name is the map's name.
  identity = mapIdentity(path.basename(drawing).slice(0, -4));
  const assetDir = path.join(ASSETS, identity.folder);
  const infoPath = path.join(assetDir, "info.json");
  const previous = readJson(infoPath);
  if (previous !== null && previous.name !== identity.name) {
    throw new KitError(
      `The folder "${identity.folder}" already holds the map "${String(previous.name)}". Give the drawing a different name.`,
    );
  }

  console.log(`${identity.name}: reading ${path.relative(ROOT, drawing)}`);
  let image;
  try {
    image = decodePng(fs.readFileSync(drawing));
  } catch (e) {
    throw new KitError((e as Error).message);
  }
  const converted = convertDrawing(image);
  report("About the map", converted.notes);
  report("Worth a look", converted.warnings);
  report("Must be fixed before the map can be built", converted.errors);
  if (converted.errors.length > 0 || converted.image === null) {
    throw new KitError("Nothing was written. Fix the drawing and run again.");
  }
  const info = buildInfo(identity, converted, previous);
  const nations = info.nations as { name: string; coordinates: number[] }[];
  if (nations.length > 0) {
    console.log("\nNations (edit the names in info.json if you like):");
    for (const n of nations) {
      console.log(`  ${n.name.padEnd(28)} at (${n.coordinates.join(", ")})`);
    }
  }
  if (checkOnly) {
    console.log("\nCheck only: nothing was written.");
    return;
  }

  fs.mkdirSync(assetDir, { recursive: true });
  fs.writeFileSync(
    path.join(assetDir, "image.png"),
    encodePng(converted.image),
  );
  fs.writeFileSync(infoPath, JSON.stringify(info, null, 2) + "\n");
  format(infoPath);
  generate(identity.folder);
  console.log(
    `\n${previous === null ? "New map" : "Updated map"} "${identity.name}" is in the game.\n` +
      `  Picture the game reads:  map-generator/assets/maps/${identity.folder}/image.png\n` +
      `  Names and settings:      map-generator/assets/maps/${identity.folder}/info.json\n` +
      "  Restart `npm run dev`, then pick it in the solo or lobby map list.\n" +
      `  A quick AI-only round:   npx tsx tests/perf/fullgame/HegemonSim.ts --map ${identity.folder} --seed a`,
  );
}

function remove(identity: MapIdentity): void {
  const assetDir = path.join(ASSETS, identity.folder);
  if (!fs.existsSync(assetDir)) {
    throw new KitError(`There is no map "${identity.name}" to remove.`);
  }
  const remaining = fs
    .readdirSync(ASSETS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== identity.folder)
    .map((d) => d.name);
  if (remaining.length === 0) {
    throw new KitError("This is the last map; the game needs at least one.");
  }
  fs.rmSync(assetDir, { recursive: true, force: true });
  fs.rmSync(path.join(RESOURCES, identity.folder), {
    recursive: true,
    force: true,
  });
  // The generator only ever adds map names to en.json.
  const en = readJson(EN_JSON);
  const names = en?.map as Record<string, string> | undefined;
  if (en !== null && names?.[identity.folder] !== undefined) {
    delete names[identity.folder];
    fs.writeFileSync(EN_JSON, JSON.stringify(en, null, 2) + "\n");
  }
  // Any one map will do: the run rewrites the map list from what is left.
  generate(remaining[0]);
  const drawing = findDrawing(identity);
  console.log(
    `\nRemoved "${identity.name}" from the game.` +
      (drawing === null
        ? ""
        : ` Its drawing is still at ${path.relative(ROOT, drawing)}.`),
  );
}

/** The map a command names. A name typed without quotes is several words. */
function named(words: string[], usage: string): MapIdentity {
  if (words.length === 0) throw new KitError(`Usage: npm run map ${usage}`);
  try {
    return mapIdentity(words.join(" ").replace(/\.png$/i, ""));
  } catch (e) {
    throw new KitError((e as Error).message);
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const [command, ...rest] = args;
  if (command === undefined || command === "list") {
    list();
  } else if (command === "new") {
    const last = rest[rest.length - 1];
    const sized = last !== undefined && /^\d+$/.test(last);
    create(
      named(sized ? rest.slice(0, -1) : rest, 'new "Map Name" [size]'),
      sized ? Number(last) : DEFAULT_SIZE,
    );
  } else if (command === "check") {
    build(named(rest, 'check "Map Name"'), true);
  } else if (command === "remove") {
    remove(named(rest, 'remove "Map Name"'));
  } else {
    build(named(args, '"Map Name"'), false);
  }
}

try {
  main();
} catch (e) {
  if (!(e instanceof KitError)) throw e;
  console.error(`\n${e.message}`);
  process.exit(1);
}
