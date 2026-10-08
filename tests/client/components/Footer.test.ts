import version from "resources/version.txt?raw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClientEnv } from "../../../src/client/ClientEnv";
import {
  composeGameVersion,
  taggedGameVersion,
} from "../../../src/client/GameVersion";
import { Footer } from "../../../src/client/components/Footer";

const SHA = "bf739f86c4e1d2a3b5c6d7e8f90123456789abcd";

// version.txt is a build-time placeholder in the repo, so derive the expected
// label from the same source the component reads rather than hardcoding it.
// These mount tests set no BOOTSTRAP_CONFIG, so composeGameVersion has no
// commit to fall back to and returns the file's value -- which keeps this
// the right expectation for the mounted component below. The choice itself is
// covered in tests/client/GameVersion.test.ts.
const gameVersion = taggedGameVersion(version);

describe("page-footer version line", () => {
  let footer: Footer;

  beforeEach(() => {
    if (!customElements.get("page-footer")) {
      customElements.define("page-footer", Footer);
    }
    ClientEnv.reset();
  });

  afterEach(() => {
    footer?.remove();
    delete (window as { BOOTSTRAP_CONFIG?: unknown }).BOOTSTRAP_CONFIG;
    ClientEnv.reset();
  });

  async function mount(): Promise<Footer> {
    footer = document.createElement("page-footer") as Footer;
    document.body.appendChild(footer);
    await footer.updateComplete;
    return footer;
  }

  it("renders the game version", async () => {
    await mount();

    const line = footer.querySelector(".footer-version");
    expect(line?.textContent?.trim()).toBe(gameVersion);
  });

  // End to end through the component: with a real BOOTSTRAP_CONFIG in the
  // page and the placeholder still in version.txt, the line must name the
  // commit rather than "vx.xx.xx". Expectation derived from the same helper
  // so committing a real version.txt does not turn this red.
  it("shows the commit rather than the placeholder on an untagged build", async () => {
    (window as { BOOTSTRAP_CONFIG?: unknown }).BOOTSTRAP_CONFIG = {
      gameEnv: "prod",
      numWorkers: 1,
      turnstileSiteKey: "1x00000000000000000000AA",
      jwtAudience: "openfront.io",
      instanceId: "test",
      gitCommit: SHA,
    };
    await mount();

    const line = footer.querySelector(".footer-version");
    expect(line?.textContent?.trim()).toBe(composeGameVersion(version, SHA));
  });
});

describe("page-footer studio wordmark", () => {
  let footer: Footer;

  beforeEach(() => {
    if (!customElements.get("page-footer")) {
      customElements.define("page-footer", Footer);
    }
    ClientEnv.reset();
  });

  afterEach(() => {
    footer?.remove();
    ClientEnv.reset();
  });

  // The by-line is the January Games wordmark from branding/ on md+ screens,
  // with the "Made by January Games" string kept as its alt text so screen
  // readers and the language switcher (data-i18n-alt) still carry the
  // attribution; narrow screens hide the image and show the text span.
  it("shows the January Games wordmark with the by-line as alt text", async () => {
    footer = document.createElement("page-footer") as Footer;
    document.body.appendChild(footer);
    await footer.updateComplete;

    const img = footer.querySelector<HTMLImageElement>("img.studio-wordmark");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toContain(
      "images/JanuaryGamesWordmarkDark.svg",
    );
    expect(img?.getAttribute("data-i18n-alt")).toBe("main.by_line");
    expect(img?.alt).toBe("Made by January Games");

    // The text fallback exists for narrow screens, where the image is hidden.
    const span = footer.querySelector('span[data-i18n="main.by_line"]');
    expect(span?.classList.contains("md:hidden")).toBe(true);
  });
});
