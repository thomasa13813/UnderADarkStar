/**
 * Draws the map "Periodic" (map-generator/drawings/Periodic.png).
 *
 *   npx tsx src/scripts/drawings/Periodic.ts    writes the drawing
 *   npm run map "Periodic"                      builds the map from it
 *
 * The idea (Tom, 2026-10-27, from a picture of the periodic table): each
 * element is a card, a rectangle of nebula, with a narrow lane of deep space
 * between cards. The table keeps its real shape: the tall s-block columns at
 * the left, the p-block at the right, the transition metals between, and
 * the lanthanides and actinides pulled out in two rows below. The two cards
 * that stand for them in the main table (57-71 and 89-103) are left out, a
 * pocket of space. The Dark Star sits in the bay above the transition
 * metals, near the top centre of the table.
 *
 * Each card carries its element's symbol in highland, drawn in the game's
 * pixel face (branding/pixel-font/glyphs.txt): the first letter large, the
 * second smaller, as on a printed table.
 *
 * Play: 118 small islands, every move between them a short fleet hop. The
 * Dark Star faces the transition metals across a short gap and the s- and
 * p-block shores across the open bay. Lords sit on cards spread farthest
 * first beyond STAR_EXCLUSION, round the rim of the table and on the
 * pulled-out rows; the cards nearer the star are Baron land.
 */
import fs from "fs";
import path from "path";
import { Cell, dist, Drawing, Nation, Point, ROOT } from "./Drawing";

// The table ------------------------------------------------------------------

/** The main table, one string per period; "." is no card. */
// prettier-ignore
const PERIODS: string[][] = [
  ["H", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", "He"],
  ["Li", "Be", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", "B", "C", "N", "O", "F", "Ne"],
  ["Na", "Mg", ".", ".", ".", ".", ".", ".", ".", ".", ".", ".", "Al", "Si", "P", "S", "Cl", "Ar"],
  ["K", "Ca", "Sc", "Ti", "V", "Cr", "Mn", "Fe", "Co", "Ni", "Cu", "Zn", "Ga", "Ge", "As", "Se", "Br", "Kr"],
  ["Rb", "Sr", "Y", "Zr", "Nb", "Mo", "Tc", "Ru", "Rh", "Pd", "Ag", "Cd", "In", "Sn", "Sb", "Te", "I", "Xe"],
  // The lanthanides' card (57-71) is left blank: a pocket of space.
  ["Cs", "Ba", ".", "Hf", "Ta", "W", "Re", "Os", "Ir", "Pt", "Au", "Hg", "Tl", "Pb", "Bi", "Po", "At", "Rn"],
  // And the actinides' (89-103).
  ["Fr", "Ra", ".", "Rf", "Db", "Sg", "Bh", "Hs", "Mt", "Ds", "Rg", "Cn", "Nh", "Fl", "Mc", "Lv", "Ts", "Og"],
];
/** The two pulled-out rows, under groups 4 to 18 as on the printed table. */
// prettier-ignore
const F_BLOCK: string[][] = [
  ["La", "Ce", "Pr", "Nd", "Pm", "Sm", "Eu", "Gd", "Tb", "Dy", "Ho", "Er", "Tm", "Yb", "Lu"],
  ["Ac", "Th", "Pa", "U", "Np", "Pu", "Am", "Cm", "Bk", "Cf", "Es", "Fm", "Md", "No", "Lr"],
];
const F_BLOCK_FIRST_GROUP = 4;

// Sizes ------------------------------------------------------------------------

/** A card, and the space between cards. */
const CARD_W = 64;
const CARD_H = 72;
const LANE = 18;
const PITCH_X = CARD_W + LANE;
const PITCH_Y = CARD_H + LANE;
/** Extra space between the main table and the pulled-out rows. */
const F_GAP = 32;
/** Space round the table. */
const MARGIN_X = 61;
const MARGIN_TOP = 60;
const MARGIN_BOTTOM = 60;

const TABLE_W = 17 * PITCH_X + CARD_W;
const W = TABLE_W + 2 * MARGIN_X;
const F_TOP = MARGIN_TOP + 7 * PITCH_Y + F_GAP;
const H = F_TOP + PITCH_Y + CARD_H + MARGIN_BOTTOM;

const cardLeft = (group: number): number => MARGIN_X + (group - 1) * PITCH_X;
const cardTop = (period: number): number => MARGIN_TOP + (period - 1) * PITCH_Y;

// The Dark Star ----------------------------------------------------------------

/** Centred across the bay between Be/Mg and B/Al. */
const STAR_X = Math.round((cardLeft(2) + CARD_W + cardLeft(13)) / 2);
const STAR_R = 110;
/** The kit's moat on a map whose shorter side is under 1500 (its floor). */
const MOAT = 15;
/** Open space between the moat and the transition metals' top edge. */
const STAR_CLEAR = 36;
const STAR: Point = [STAR_X, cardTop(4) - STAR_CLEAR - MOAT - STAR_R];

// Lords ----------------------------------------------------------------------

/**
 * No Lord whose card centre is nearer the star than this. AI rounds
 * (2026-10-27, three seeds each): at 520 the throne fell at 13, 19 and 19
 * min; at 600 at 12 and 12 and held once; at 600 with the star lifted 64
 * tiles further from the transition metals (STAR_CLEAR 100) it fell at 11,
 * 14 and 16, so the star stays close.
 */
const STAR_EXCLUSION = 600;
const LORDS = 18;

// The symbols ------------------------------------------------------------------

/** First letter, and the letters after it, in pixels per font pixel. */
const BIG = 3;
const SMALL = 2;
/** Space between the letters, and the symbol's top below the card's top. */
const LETTER_GAP = 3;
const SYMBOL_TOP = 12;

/** The pixel face's capitals: each a list of rows, true for ink. */
function loadGlyphs(): Map<string, boolean[][]> {
  const file = path.join(ROOT, "branding", "pixel-font", "glyphs.txt");
  const glyphs = new Map<string, boolean[][]>();
  let current: boolean[][] | null = null;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.startsWith(";")) continue;
    const header = /^\[(.)\]$/.exec(line);
    if (header) {
      current = [];
      glyphs.set(header[1], current);
    } else if (current !== null && /^[#.]+$/.test(line)) {
      current.push([...line].map((ch) => ch === "#"));
    }
  }
  return glyphs;
}

// ---------------------------------------------------------------------------

interface Card {
  symbol: string;
  left: number;
  top: number;
}

function cards(): Card[] {
  const out: Card[] = [];
  PERIODS.forEach((row, p) =>
    row.forEach((symbol, g) => {
      if (symbol === ".") return;
      out.push({ symbol, left: cardLeft(g + 1), top: cardTop(p + 1) });
    }),
  );
  F_BLOCK.forEach((row, r) =>
    row.forEach((symbol, i) => {
      out.push({
        symbol,
        left: cardLeft(F_BLOCK_FIRST_GROUP + i),
        top: F_TOP + r * PITCH_Y,
      });
    }),
  );
  return out;
}

const centre = (c: Card): Point => [c.left + CARD_W / 2, c.top + CARD_H / 2];

function paintCard(
  d: Drawing,
  card: Card,
  glyphs: Map<string, boolean[][]>,
): void {
  for (let y = card.top; y < card.top + CARD_H; y++) {
    for (let x = card.left; x < card.left + CARD_W; x++) {
      d.put(x, y, Cell.Plains);
    }
  }
  const letters = [...card.symbol.toUpperCase()].map((ch, i) => {
    const glyph = glyphs.get(ch);
    if (glyph === undefined) throw new Error(`No glyph for ${ch}`);
    const scale = i === 0 ? BIG : SMALL;
    return { glyph, scale, w: Math.round(glyph[0].length * scale) };
  });
  const width =
    letters.reduce((sum, l) => sum + l.w, 0) +
    LETTER_GAP * (letters.length - 1);
  let x0 = card.left + Math.round((CARD_W - width) / 2);
  // The letters stand on one baseline, under the large first letter.
  const baseline = card.top + SYMBOL_TOP + Math.round(9 * BIG);
  for (const l of letters) {
    const h = Math.round(l.glyph.length * l.scale);
    for (let ty = 0; ty < h; ty++) {
      for (let tx = 0; tx < l.w; tx++) {
        const row = l.glyph[Math.floor(ty / l.scale)];
        if (row?.[Math.floor(tx / l.scale)]) {
          d.put(x0 + tx, baseline - h + ty, Cell.Highland);
        }
      }
    }
    x0 += l.w + LETTER_GAP;
  }
}

/** Lords on cards beyond the exclusion, spread farthest first. */
function placeLords(all: Card[]): Nation[] {
  const open = all.filter((c) => dist(centre(c), STAR) >= STAR_EXCLUSION);
  console.log(
    `${open.length} of ${all.length} cards lie ${STAR_EXCLUSION}+ tiles from the star`,
  );
  const chosen: Card[] = [];
  // Start from the card farthest from the star.
  chosen.push(
    open.reduce((a, b) =>
      dist(centre(b), STAR) > dist(centre(a), STAR) ? b : a,
    ),
  );
  while (chosen.length < LORDS && chosen.length < open.length) {
    let best = open[0];
    let bestD = -1;
    for (const c of open) {
      const dd = Math.min(...chosen.map((q) => dist(centre(q), centre(c))));
      if (dd > bestD) {
        bestD = dd;
        best = c;
      }
    }
    chosen.push(best);
  }
  // The dot goes under the symbol, where the card is plain.
  return chosen.map((c) => ({
    at: [c.left + CARD_W / 2, c.top + CARD_H - 16] as Point,
    where: `${c.symbol}, ${Math.round(dist(centre(c), STAR))} from the star`,
  }));
}

function main(): void {
  const d = new Drawing(W, H);
  const glyphs = loadGlyphs();
  const all = cards();
  for (const card of all) paintCard(d, card, glyphs);
  d.clearDisc(STAR, STAR_R + MOAT);
  console.log(
    `Map ${W} x ${H}, ${all.length} cards, star at (${STAR[0]}, ${STAR[1]})`,
  );
  d.write("Periodic", { at: STAR, r: STAR_R }, placeLords(all));
}

main();
