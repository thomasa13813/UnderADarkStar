// Under a Dark Star: the name filter (docs/DarkStar-Accounts.md §10, B6).
//
// An offensive word in a player's name is masked letter for letter with
// MASK_CHAR, and only the word: "ass-player" is shown as "***-player". The
// player is never told. The server masks the name everyone else receives,
// and the player's own client puts back the name they typed (GameView for
// the round, LobbyPlayerView for the lobby, the leaderboard's own row).
//
// The list is written for few false positives (the Scunthorpe problem). Each
// term carries a rule for where it may sit:
//
//  - "anywhere": inside any word. Only for terms no ordinary word contains
//    ("fuck", "hitler"); the allowlist covers the rare exception
//    ("Scunthorpe").
//  - "word": only as a whole word, plural allowed ("ass", "asses", but not
//    "assignment", "class" or "Assassin"). Words are split on spaces,
//    punctuation, digits and camelCase, so "AssPlayer" and "ass_player" are
//    caught and "assplayer" is not: the price of leaving "assault" alone.
//  - "start": at the start of a word, anything after ("retarded").
//  - "phrase": like "anywhere", and also across spaces and punctuation
//    ("White Power").
//
// Spellings it sees through: case, accents ("hïtler"), digits for letters
// ("sh1t", "n4z1"), stretched letters ("fuuuck") and a word spelled out
// letter by letter ("f.u.c.k"). Edit TERMS and ALLOWED to tune it; the tests
// in tests/server/Censor.test.ts pin the cases that matter.

export const MASK_CHAR = "*";

type Placement = "anywhere" | "word" | "start" | "phrase";

interface Term {
  word: string;
  at: Placement;
  // Letters that may not follow the term (shit, not Ishita or shitake).
  notBefore?: string;
}

const anywhere = (...words: string[]): Term[] =>
  words.map((word) => ({ word, at: "anywhere" }));
const whole = (...words: string[]): Term[] =>
  words.map((word) => ({ word, at: "word" }));
const start = (...words: string[]): Term[] =>
  words.map((word) => ({ word, at: "start" }));
const phrase = (...words: string[]): Term[] =>
  words.map((word) => ({ word, at: "phrase" }));

const TERMS: Term[] = [
  // Slurs and hate.
  ...anywhere(
    "nigger",
    "nigga",
    "faggot",
    "hitler",
    "auschwitz",
    "kkk",
    "tranny",
    "wetback",
    "raghead",
    "towelhead",
  ),
  ...phrase("whitepower", "siegheil"),
  ...start("nazi", "retard"),
  ...whole(
    "heil",
    "adolf",
    "spic",
    "chink",
    "kike",
    "coon",
    "gook",
    "dyke",
    "fag",
    "paki",
    "beaner",
    "tard",
  ),
  // Profanity and sex.
  ...anywhere(
    "fuck",
    "cunt",
    "bitch",
    "whore",
    "slut",
    "cocksucker",
    "dickhead",
    "asshole",
    "asshat",
    "asswipe",
    "assface",
    "dumbass",
    "jackass",
    "arsehole",
    "vagina",
    "jizz",
    "dildo",
    "porn",
    "cumshot",
    "molest",
    "pedophile",
    "paedophile",
    "wanker",
    "bollocks",
    "bastard",
  ),
  { word: "shit", at: "anywhere", notBefore: "ao" },
  ...whole(
    "ass",
    "arse",
    "cock",
    "dick",
    "pussy",
    "pussies",
    "penis",
    "tit",
    "tits",
    "titty",
    "titties",
    "boob",
    "boobs",
    "boobies",
    "cum",
    "rape",
    "raped",
    "raping",
    "rapist",
    "pedo",
    "paedo",
    "twat",
    "wank",
    "piss",
    "pissed",
    "prick",
    "anus",
    "anal",
  ),
];

// Ordinary words and names that contain an "anywhere" or "start" term. A hit
// that lies wholly inside one of these is not a hit.
const ALLOWED = [
  "snigger",
  "niggard",
  "scunthorpe",
  "ashkenazi",
  "nazir",
  "nazim",
  "nazif",
  "nazia",
  "nazih",
  "retardant",
  "slutsk",
  "shiitake",
];

// Digits read as the letters they stand in for. "1" is tried as both i and l.
const DIGIT_LETTERS: Record<string, string> = {
  "0": "o",
  "3": "e",
  "4": "a",
  "5": "s",
  "7": "t",
  "8": "b",
  "9": "g",
};

// A term as a pattern that also matches stretched letters: "ass" is a+ss+,
// so "asss" is caught and "as" is not.
function termPattern(word: string): RegExp {
  let source = "";
  for (let i = 0; i < word.length; ) {
    let j = i;
    while (j < word.length && word[j] === word[i]) j++;
    source += j - i === 1 ? `${word[i]}+` : `${word[i]}{${j - i},}`;
    i = j;
  }
  return new RegExp(source, "g");
}

const COMPILED = TERMS.map((term) => ({
  ...term,
  pattern: termPattern(term.word),
}));

// One lowercase ASCII letter per character, or a space for anything that is
// not a letter. Same length as the name, so positions carry over.
type DigitReading = "i" | "l" | "none";

function readLetters(name: string, digits: DigitReading): string {
  let out = "";
  for (const ch of name) {
    const base = ch.normalize("NFKD")[0].toLowerCase();
    if (base >= "a" && base <= "z") {
      out += base;
    } else if (digits !== "none" && ch === "1") {
      out += digits;
    } else if (digits !== "none" && DIGIT_LETTERS[ch] !== undefined) {
      out += DIGIT_LETTERS[ch];
    } else {
      out += " ";
    }
  }
  return out;
}

const isUpper = (ch: string | undefined) =>
  ch !== undefined && ch !== ch.toLowerCase();
const isLower = (ch: string | undefined) =>
  ch !== undefined && ch !== ch.toUpperCase();

// Where words start: after a space or punctuation, and at camelCase seams
// ("assPlayer", "ASSPlayer").
function wordStarts(name: string, letters: string): boolean[] {
  const chars = Array.from(name);
  return chars.map((ch, i) => {
    if (letters[i] === " ") return false;
    if (i === 0 || letters[i - 1] === " ") return true;
    if (!isUpper(ch)) return false;
    return (
      isLower(chars[i - 1]) || (isUpper(chars[i - 1]) && isLower(chars[i + 1]))
    );
  });
}

function insideAllowed(letters: string, from: number, to: number): boolean {
  for (const word of ALLOWED) {
    let at = letters.indexOf(word);
    while (at !== -1) {
      if (at <= from && to <= at + word.length) return true;
      at = letters.indexOf(word, at + 1);
    }
  }
  return false;
}

// Mark the positions of every accepted hit in one reading of the name.
function markHits(
  name: string,
  letters: string,
  marked: boolean[],
  placements: readonly Placement[],
): void {
  const starts = wordStarts(name, letters);
  const endsWord = (at: number) =>
    at === letters.length || letters[at] === " " || starts[at];
  for (const term of COMPILED) {
    if (!placements.includes(term.at)) continue;
    for (const hit of letters.matchAll(term.pattern)) {
      const from = hit.index;
      let to = from + hit[0].length;
      if ((term.at === "word" || term.at === "start") && !starts[from]) {
        continue;
      }
      if (term.at === "word" && !endsWord(to)) {
        const plural = ["s", "es"].find(
          (suffix) =>
            letters.startsWith(suffix, to) && endsWord(to + suffix.length),
        );
        if (plural === undefined) continue;
        to += plural.length;
      }
      if (term.notBefore?.includes(letters[to] ?? " ")) continue;
      if (insideAllowed(letters, from, to)) continue;
      for (let i = from; i < to; i++) marked[i] = true;
    }
  }
}

// The letters read with the gaps closed: phrases ("White Power") always, and
// a word spelled out with gaps ("f.u.c.k", "fu ck", "n i g g e r") where at
// most one piece is longer than two letters, so "Bus Hit" or "Shi Tzu" never
// join into a word.
function markAcrossGaps(name: string, marked: boolean[]): void {
  const letters = readLetters(name, "i");
  const positions: number[] = [];
  // Each letter's run of letters: where it starts and how long it is.
  const runStart: number[] = [];
  const runLength: number[] = [];
  for (let i = 0; i < letters.length; ) {
    let j = i;
    while (j < letters.length && letters[j] !== " ") j++;
    for (let k = i; k < j; k++) {
      positions.push(k);
      runStart[k] = i;
      runLength[k] = j - i;
    }
    i = j === i ? i + 1 : j;
  }
  if (positions.length === letters.length) return;
  const joined = positions.map((i) => letters[i]).join("");

  const phraseMarks = new Array<boolean>(joined.length).fill(false);
  markHits(joined, joined, phraseMarks, ["phrase"]);
  phraseMarks.forEach((hit, k) => {
    if (hit) marked[positions[k]] = true;
  });

  const wordMarks = new Array<boolean>(joined.length).fill(false);
  markHits(joined, joined, wordMarks, ["anywhere"]);
  for (let i = 0; i < joined.length; ) {
    if (!wordMarks[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < joined.length && wordMarks[j]) j++;
    const span = positions.slice(i, j);
    const crossesGap = span[span.length - 1] - span[0] + 1 > span.length;
    const longRuns = new Set(
      span.filter((p) => runLength[p] > 2).map((p) => runStart[p]),
    );
    if (crossesGap && longRuns.size <= 1) {
      for (const p of span) marked[p] = true;
    }
    i = j;
  }
}

const ALL_PLACEMENTS: readonly Placement[] = [
  "anywhere",
  "word",
  "start",
  "phrase",
];

function hitPositions(name: string): boolean[] {
  const marked = new Array<boolean>(Array.from(name).length).fill(false);
  for (const digits of ["i", "l", "none"] as const) {
    markHits(name, readLetters(name, digits), marked, ALL_PLACEMENTS);
  }
  markAcrossGaps(name, marked);
  return marked;
}

/** The name with every offensive word masked, or the name itself if clean. */
export function maskName(name: string): string {
  const marked = hitPositions(name);
  if (!marked.includes(true)) return name;
  return Array.from(name, (ch, i) => (marked[i] ? MASK_CHAR : ch)).join("");
}

export function nameIsClean(name: string): boolean {
  return !hitPositions(name).includes(true);
}

/**
 * The name a signed-in player joins under (docs/DarkStar-Accounts.md A13,
 * revised 2026-10-25): their account's one name, masked, whatever the
 * browser sent. Falls back to the screened join name when the account
 * lookup has no name.
 */
export function accountJoinName(
  accountName: string | null | undefined,
  screenedJoinName: string,
): string {
  return typeof accountName === "string" && accountName !== ""
    ? maskName(accountName)
    : screenedJoinName;
}

// Clan tags too short to read as words but used as slurs.
const BLOCKED_TAGS = new Set(["ss", "nig", "nigg"]);

/**
 * The (username, clanTag) pair as everyone else sees it: offensive words in
 * the name masked; an offensive tag, or one that spells a slur together with
 * the start of the name ("HIT" + "LER"), dropped; a surviving tag
 * uppercased. Shared by the API's join_verify and the game server's local
 * fallback, so the two agree.
 */
export function censorPlayer(
  username: string,
  clanTag: string | null,
): { username: string; clanTag: string | null } {
  if (clanTag === null || clanTag === "") {
    return { username: maskName(username), clanTag: null };
  }
  const tagLength = Array.from(clanTag).length;
  const combined = hitPositions(clanTag + username);
  const spansSeam = combined[tagLength - 1] && combined[tagLength];
  const tagIsBad =
    !nameIsClean(clanTag) ||
    BLOCKED_TAGS.has(clanTag.toLowerCase()) ||
    spansSeam;
  let masked = maskName(username);
  if (spansSeam) {
    const nameMarks = combined.slice(tagLength);
    masked = Array.from(masked, (ch, i) =>
      nameMarks[i] ? MASK_CHAR : ch,
    ).join("");
  }
  return {
    username: masked,
    clanTag: tagIsBad ? null : clanTag.toUpperCase(),
  };
}
