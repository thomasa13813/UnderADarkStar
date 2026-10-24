"""Builds the DarkStar Pixel webfont from its glyph source.

    python build.py branding/pixel-font/glyphs.txt branding/fonts

Writes darkstar-pixel.woff2 (what the game loads) and darkstar-pixel.ttf (to
install on a desktop for drawing mock-ups). Needs fontTools and brotli:
`pip install fonttools brotli`. See README.md.
"""

import sys
from pathlib import Path

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen

FAMILY = "DarkStar Pixel"
PS_NAME = "DarkStarPixel-Regular"
VERSION = "1.000"

# One pixel is 100 units and the em is 12 pixels, so the face is pixel-exact
# at 12px and its multiples (24, 36, 48...). Caps are 9 pixels tall; the
# ascent and descent leave room for the outline and glow and keep the line
# box centred on the capitals.
PX = 100
UPM = 12 * PX
CAP = 9 * PX
ASCENT = 11 * PX
DESCENT = -2 * PX
SIDE = 1 * PX  # half the 2-pixel gap between letters, on each side
SPACE = 4 * PX  # with the side bearings, a word gap of 5 pixels
EPOCH = 3_875_644_800  # 2026-10-24 (first build), in the head table's 1904-based seconds


def parse(path):
    glyphs = {}
    current = None
    for n, raw in enumerate(Path(path).read_text(encoding="utf-8").splitlines(), 1):
        line = raw.rstrip()
        if not line or line.startswith(";"):
            current = None
            continue
        if len(line) == 3 and line[0] == "[" and line[2] == "]":
            current = line[1]
            if current in glyphs:
                sys.exit(f"{path}:{n}: {current!r} is defined twice")
            glyphs[current] = []
            continue
        if current is None:
            sys.exit(f"{path}:{n}: rows outside a glyph")
        if set(line) - {"#", "."}:
            sys.exit(f"{path}:{n}: rows use only '#' and '.'")
        rows = glyphs[current]
        if rows and len(line) != len(rows[0]):
            sys.exit(f"{path}:{n}: {current!r} rows differ in width")
        rows.append(line)
    for ch, rows in glyphs.items():
        if len(rows) not in (9, 10):
            sys.exit(f"{path}: {ch!r} has {len(rows)} rows, not 9 or 10")
    return glyphs


def contours(rows):
    """Outlines of the inked pixels, merged into polygons.

    Every inked cell contributes its four edges clockwise (y up); an edge
    shared with an inked neighbour cancels, leaving the boundary. Outer
    contours come out clockwise and holes anticlockwise, as TrueType wants.
    """
    edges = {}
    for r, row in enumerate(rows):
        y = 8 - r  # row 9 (index 8) sits on the baseline
        for x, bit in enumerate(row):
            if bit != "#":
                continue
            for a, b in (((x, y), (x, y + 1)), ((x, y + 1), (x + 1, y + 1)),
                         ((x + 1, y + 1), (x + 1, y)), ((x + 1, y), (x, y))):
                if (b, a) in edges:
                    del edges[(b, a)]
                else:
                    edges[(a, b)] = True
    out = {}
    for a, b in edges:
        out.setdefault(a, []).append(b)

    def turn(prev, cur, nxt):
        # Cross product: negative is a right turn. Where two cells touch only
        # at a corner, taking the right turn keeps them separate contours.
        return ((cur[0] - prev[0]) * (nxt[1] - cur[1])
                - (cur[1] - prev[1]) * (nxt[0] - cur[0]))

    loops = []
    while out:
        start = next(iter(out))
        loop, prev, cur = [start], None, start
        while True:
            options = out[cur]
            nxt = options[0] if prev is None or len(options) == 1 else min(
                options, key=lambda o: turn(prev, cur, o))
            options.remove(nxt)
            if not options:
                del out[cur]
            prev, cur = cur, nxt
            if cur == start:
                break
            loop.append(cur)
        # Drop the points in the middle of straight runs.
        loops.append([p for i, p in enumerate(loop)
                      if turn(loop[i - 1], p, loop[(i + 1) % len(loop)]) != 0])
    return loops


def glyph_name(ch):
    return "space" if ch == " " else f"uni{ord(ch):04X}"


def build(glyphs, out_dir):
    order = [".notdef", "space"] + [glyph_name(ch) for ch in sorted(glyphs, key=ord)]
    cmap = {32: "space", 160: "space"}
    for ch in glyphs:
        cmap[ord(ch)] = glyph_name(ch)
        if "A" <= ch <= "Z":
            cmap[ord(ch.lower())] = glyph_name(ch)

    outlines, metrics = {}, {}
    pen = TTGlyphPen(None)
    outlines[".notdef"] = pen.glyph()
    metrics[".notdef"] = (SPACE, 0)
    outlines["space"] = TTGlyphPen(None).glyph()
    metrics["space"] = (SPACE, 0)
    for ch, rows in glyphs.items():
        pen = TTGlyphPen(None)
        for loop in contours(rows):
            pen.moveTo((loop[0][0] * PX + SIDE, loop[0][1] * PX))
            for x, y in loop[1:]:
                pen.lineTo((x * PX + SIDE, y * PX))
            pen.closePath()
        name = glyph_name(ch)
        outlines[name] = pen.glyph()
        metrics[name] = (len(rows[0]) * PX + 2 * SIDE, SIDE)

    fb = FontBuilder(UPM, isTTF=True)
    fb.setupGlyphOrder(order)
    fb.setupCharacterMap(cmap)
    fb.setupGlyf(outlines)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=ASCENT, descent=DESCENT)
    fb.setupNameTable({
        "familyName": FAMILY,
        "styleName": "Regular",
        "uniqueFontIdentifier": f"{PS_NAME};{VERSION}",
        "fullName": FAMILY,
        "psName": PS_NAME,
        "version": f"Version {VERSION}",
        "copyright": "© 2026 January Games",
        "manufacturer": "January Games",
    })
    fb.setupOS2(
        version=4, sTypoAscender=ASCENT, sTypoDescender=DESCENT, sTypoLineGap=0,
        usWinAscent=ASCENT, usWinDescent=-DESCENT,
        sxHeight=CAP, sCapHeight=CAP, fsSelection=0x40 | 0x80,  # REGULAR, USE_TYPO_METRICS
        achVendID="JANG",
    )
    fb.setupPost()
    # A fixed date, so rebuilding unchanged glyphs gives identical files.
    fb.font["head"].created = fb.font["head"].modified = EPOCH
    fb.font.recalcTimestamp = False

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    fb.save(str(out / "darkstar-pixel.ttf"))
    fb.font.flavor = "woff2"
    fb.save(str(out / "darkstar-pixel.woff2"))
    print(f"{len(glyphs)} glyphs -> {out / 'darkstar-pixel.woff2'}, {out / 'darkstar-pixel.ttf'}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    build(parse(sys.argv[1]), sys.argv[2])
