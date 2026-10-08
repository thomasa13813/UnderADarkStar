# Making a map

How to turn a drawing into a playable map with the map kit. You draw one picture in any paint
program; the kit works out the rest. Written for MS Paint on Windows, but any program that saves a
PNG will do.

## The short version

```
npm run map new "Twin Suns"     makes map-generator/drawings/Twin Suns.png to start from
(draw on it in Paint and save)
npm run map "Twin Suns"         builds the map and adds it to the game
```

Then restart `npm run dev` and pick the map in the solo or lobby map list.

## The palette

Seven colours, all on Paint's default colour bar. Pick them from the bar rather than mixing them.

| Draw this                   | In this colour (Paint's name) | Red, green, blue |
| --------------------------- | ----------------------------- | ---------------- |
| Deep space (ships cross it) | Indigo                        | 63, 72, 204      |
| Void (nothing crosses it)   | Black                         | 0, 0, 0          |
| Land, plains                | White                         | 255, 255, 255    |
| Land, highland              | Gray-25% (the light grey)     | 195, 195, 195    |
| Land, mountain              | Gray-50% (the darker grey)    | 127, 127, 127    |
| A Lord's starting point     | Red (a dot)                   | 237, 28, 36      |
| The Dark Star               | Yellow (one circle)           | 255, 242, 0      |

Turquoise and pure blue also count as space, pure red as a Lord and pure yellow as the Dark
Star, so a different paint program's defaults work too.

**Elevation matters in play.** Highland and mountain cost more troops to take and slow an attack.
A map that is all white is fine.

## Drawing

- **Start from the template** (`npm run map new "Name"`). It is 1800 x 1800 pixels, all space,
  with the Dark Star drawn in the centre at its standard size. One pixel is one tile in the game.
  For another size add it at the end: `npm run map new "Name" 1600`. Bigger than about 2000 is slow
  on weaker computers.
- **Any tool is fine**: pencil, brush, fill, shapes. Paint smooths the edges of brushes and shapes
  with in-between colours; the kit cleans those up.
- **High ground must be at least 3 pixels thick.** Thinner grey lines are treated as smoothing and
  become plains.
- **Lord dots** (Lords are the map's AI players, the `nations` of `info.json`): one red dot per
  Lord, on land, a few pixels across (a brush click). The kit
  uses the centre of the dot, and the dot itself becomes land.
- **The Dark Star**: move or resize the yellow circle if you want it somewhere other than the
  centre. Filled or just an outline both work. Its size on the map is the size you draw. Leave it
  out entirely and it goes in the centre at the standard size.
- **Around the Dark Star**: the game always keeps a ring of open space around it (the moat, 18
  tiles wide on an 1800 map). Land drawn there is removed. A Lord dot within 30 tiles of the moat
  is ignored and that Lord starts somewhere random.
- **Save as PNG** (File > Save as > PNG picture). Not JPEG: it blurs every colour.

In Paint the cursor's position shows in the bottom-left corner of the window. The kit's messages
give positions the same way, so "near (1051, 151)" is a place you can find.

## What makes a map play well

- **Every Lord needs a way to the Dark Star**: a coast facing it, since the last step is always
  across the moat by fleet or stargate.
- **Leave room around each Lord dot.** A Lord on a sliver of land goes nowhere.
- **Space between landmasses is the map's character.** Narrow gaps are crossed early by fleet;
  wide ones need stargates. Void walls force routes.
- **Very small pieces disappear.** Islands under 30 tiles are deleted and patches of space under
  200 tiles are filled in. The kit tells you when that will happen and where.
- **Aim for roughly 400,000 to 600,000 land tiles** on an 1800 x 1800 map. Event Horizon has about
  450,000. The kit prints the count.

## The commands

| Command                     | What it does                                             |
| --------------------------- | -------------------------------------------------------- |
| `npm run map`               | Lists your drawings and whether each has been built.     |
| `npm run map new "Name"`    | Makes a starting drawing.                                |
| `npm run map check "Name"`  | Reads the drawing and reports on it. Changes nothing.    |
| `npm run map "Name"`        | Builds the map and adds it to the game (about a minute). |
| `npm run map remove "Name"` | Takes the map out of the game. Your drawing is kept.     |

The drawing's file name is the map's name: `Twin Suns.png` becomes the map "Twin Suns". Use
letters, digits and spaces.

**Changing a map**: edit the drawing, save, and run `npm run map "Name"` again.

**Renaming a map**: `npm run map remove "Old Name"`, rename the drawing file, then build it under
the new name.

## Reading the report

Building or checking prints three lists:

- **About the map**: its size, land tiles, how many separate landmasses, how many Lords.
- **Worth a look**: things that will work but may not be what you meant, such as a tiny island
  about to be deleted, two Lord dots almost on top of each other, or a large area in a colour the
  kit does not know.
- **Must be fixed**: things that stop the build, such as a Lord dot out in space, two Dark Stars,
  or a Dark Star hanging off the edge. Nothing is written until these are gone.

## Lord names

The kit gives each Lord a science-fiction name. To change one, edit `name` in
`map-generator/assets/maps/<folder>/info.json` and build again. Your names are kept on later
builds as long as the Lord's dot has not moved more than 40 tiles. The same file holds
`multiplayer_frequency` (how often the map comes up in public lobbies; 0 for never), which is also
kept.

## After building

- **Restart `npm run dev`**, then find the map in the map list.
- **Try an AI-only round** to see whether the Lords can reach the Dark Star:
  `npx tsx tests/perf/fullgame/HegemonSim.ts --map <folder> --seed a` (about a minute; `<folder>`
  is the map's name in lower case without spaces, which the build prints).
- **Commit** the drawing, the `map-generator/assets/maps/<folder>` folder, the
  `resources/maps/<folder>` folder, and the changes to `src/core/game/Maps.gen.ts` and
  `resources/lang/en.json`.

## What the kit needs

Go, which the map builder is written in. The kit looks on the PATH and in `go-sdk\go\bin` under
your user folder. If it cannot find it, it says so.

## How it works

`src/scripts/makeMap.ts` reads the PNG (`mapkit/Png.ts`), converts it (`mapkit/Convert.ts`), writes
the Lords and the Dark Star into `info.json` (`mapkit/Info.ts`), and runs the Go map-generator
(`map-generator/README.md`), which produces the files the game loads. Tests are in
`tests/MapKit.test.ts`.

## Generated drawings

A drawing can also be written by a script instead of painted, which suits maps built from shapes
(a helix, an atom, a beam): change a number, run the script, build again. The scripts live in
`src/scripts/drawings/`, one per map, on the shared tools in `src/scripts/drawings/Drawing.ts`
(the palette canvas, seeded noise, blobs, strokes, a Lord placer and the PNG writer). Each
writes its drawing to `map-generator/drawings/<Map Name>.png`, and from there the map is built
like any other:

```
npx tsx src/scripts/drawings/NoMoon.ts
npm run map "No Moon"
```

The sketches the scripts were made from are kept in `MapImages/`.
