import { readFileSync } from "fs";
import { ANON_WORDS } from "../../src/core/AnonNames";
import { DisplayUsernameSchema, UsernameSchema } from "../../src/core/Schemas";
import {
  accountJoinName,
  censorPlayer,
  MASK_CHAR,
  maskName,
  nameIsClean,
} from "../../src/server/Censor";

// The name filter (B6, docs/DarkStar-Accounts.md §10): offensive words are
// masked letter for letter, ordinary words that contain them are left alone.

const masked = (name: string) => MASK_CHAR.repeat(Array.from(name).length);

describe("maskName", () => {
  test("masks the offending word only", () => {
    expect(maskName("ass-player")).toBe("***-player");
    expect(maskName("AssPlayer")).toBe("***Player");
    expect(maskName("ASSPlayer")).toBe("***Player");
    expect(maskName("Ass69")).toBe("***69");
    expect(maskName("bullshit")).toBe("bull****");
    expect(maskName("ShitLord")).toBe("****Lord");
    expect(maskName("IloveNazi")).toBe("Ilove****");
    expect(maskName("Nazis")).toBe("****s");
    expect(maskName("KKKlover")).toBe("***lover");
    expect(maskName("xXfaggotXx")).toBe("xX******Xx");
    expect(maskName("retarded")).toBe("******ed");
  });

  test("masks whole words", () => {
    for (const name of [
      "fuck",
      "cunt",
      "bitch",
      "asshole",
      "dumbass",
      "asses",
      "cock",
      "dick",
      "heil",
      "spic",
      "adolf",
      "hitler",
      "nigger",
      "nigga",
      "faggot",
      "kkk",
      "rapist",
      "cum",
      "tits",
    ]) {
      expect(maskName(name), name).toBe(masked(name));
    }
  });

  test("leaves ordinary words that contain a listed one alone", () => {
    for (const name of [
      "assignment",
      "Assassin",
      "classic",
      "Bass",
      "assess",
      "Glasses",
      "Passholder",
      "Cassandra",
      "Grass Hopper",
      "Scunthorpe",
      "cockpit",
      "Hitchcock",
      "Peacock",
      "Hancock",
      "Dickens",
      "therapist",
      "Spica",
      "spicy",
      "Heiland",
      "Adolfo",
      "retardant",
      "shitake",
      "shiitake",
      "Ishita",
      "Matsushita",
      "Yoshito",
      "Cumulus",
      "penistone",
      "Arsenal",
      "Uranus",
      "Analyst",
      "Titan",
      "Sussex",
      "Nazir",
      "Ashkenazi",
      "Niger",
      "nigerian",
      "Snigger",
      "Slutsky",
      "CocaCola",
      "Hegemon",
    ]) {
      expect(maskName(name), name).toBe(name);
      expect(nameIsClean(name), name).toBe(true);
    }
  });

  test("does not join separate words into one", () => {
    for (const name of ["Bus Hit", "Shi Tzu", "Bob Itch", "Mass Hit"]) {
      expect(maskName(name), name).toBe(name);
    }
  });

  test("sees through case, accents, digits and stretched letters", () => {
    for (const name of [
      "FUCK",
      "FÜCK",
      "hïtler",
      "nâzi",
      "fàggot",
      "níggér",
      "sh1t",
      "b1tch",
      "s1ut",
      "n4z1",
      "h1tl3r",
      "f4gg0t",
      "a55",
      "fuuuuck",
      "hiiitler",
      "niiiigger",
    ]) {
      expect(maskName(name), name).toBe(masked(name));
    }
  });

  test("catches words spelled out with gaps, and phrases", () => {
    expect(maskName("n.i.g.g.e.r")).toBe("*.*.*.*.*.*");
    expect(maskName("f.u.c.k")).toBe("*.*.*.*");
    expect(maskName("fu ck")).toBe("** **");
    expect(maskName("hello n.i.g.g.e.r world")).toBe("hello *.*.*.*.*.* world");
    expect(maskName("White_Power")).toBe("*****_*****");
    expect(maskName("Sieg Heil")).toBe("**** ****");
  });

  test("leaves ordinary and accented names alone", () => {
    for (const name of [
      "CoolPlayer",
      "GameMaster",
      "xXx_Sniper_xXx",
      "ProGamer123",
      "NightOwl",
      "DragonSlayer",
      "José",
      "Müller",
      "Bjørn",
      "Renée",
    ]) {
      expect(maskName(name), name).toBe(name);
    }
  });

  test("never masks a guest's assigned words or the game's own names", () => {
    for (const word of ANON_WORDS) {
      expect(maskName(word), word).toBe(word);
    }
    const themes = readFileSync("resources/tribeNameThemes.json", "utf8");
    for (const quoted of themes.match(/"[^"]{2,}"/g) ?? []) {
      const name = quoted.slice(1, -1);
      expect(maskName(name), name).toBe(name);
    }
  });
});

describe("the mask on the wire", () => {
  test("a masked name is a valid display name, never a valid join name", () => {
    const name = maskName("ass-player");
    expect(DisplayUsernameSchema.safeParse(name).success).toBe(true);
    expect(UsernameSchema.safeParse(name).success).toBe(false);
    expect(DisplayUsernameSchema.safeParse(maskName("fuck")).success).toBe(
      true,
    );
  });
});

describe("accountJoinName", () => {
  test("a signed-in player joins under the account's name, masked", () => {
    expect(accountJoinName("StarLord", "WhateverWasSent")).toBe("StarLord");
    expect(accountJoinName("ass-player", "Innocent")).toBe("***-player");
  });

  test("falls back to the screened join name without an account name", () => {
    expect(accountJoinName(null, "Typed")).toBe("Typed");
    expect(accountJoinName(undefined, "Typed")).toBe("Typed");
    expect(accountJoinName("", "Typed")).toBe("Typed");
  });
});

describe("censorPlayer", () => {
  test("masks the name and keeps a clean tag, uppercased", () => {
    expect(censorPlayer("CoolPlayer", null)).toEqual({
      username: "CoolPlayer",
      clanTag: null,
    });
    expect(censorPlayer("ass-player", "pro")).toEqual({
      username: "***-player",
      clanTag: "PRO",
    });
  });

  test("drops an offensive tag", () => {
    for (const tag of ["NAZI", "N4Z1", "NAZIS", "HEIL", "KKK", "SS", "ss"]) {
      expect(censorPlayer("CoolPlayer", tag).clanTag, tag).toBeNull();
    }
    for (const tag of ["NIG", "NIGG", "NIGGA", "CHINK", "SPIC", "KIKE"]) {
      expect(censorPlayer("CoolPlayer", tag).clanTag, tag).toBeNull();
    }
  });

  test("drops a tag that spells a slur with the start of the name", () => {
    expect(censorPlayer("LER", "HIT")).toEqual({
      username: "***",
      clanTag: null,
    });
    expect(censorPlayer("gger", "NI")).toEqual({
      username: "****",
      clanTag: null,
    });
    expect(censorPlayer("g3r", "N1G").clanTag).toBeNull();
  });

  test("is deterministic", () => {
    expect(censorPlayer("hitler", "COOL")).toEqual(
      censorPlayer("hitler", "COOL"),
    );
  });
});
