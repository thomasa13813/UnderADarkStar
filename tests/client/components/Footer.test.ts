import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClientEnv } from "../../../src/client/ClientEnv";
import { Footer } from "../../../src/client/components/Footer";

// Tom, 2026-10-25: the footer no longer names the build. Releases are not
// tagged with enough discipline for a public version label.
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
    ClientEnv.reset();
  });

  it("shows no version", async () => {
    footer = document.createElement("page-footer") as Footer;
    document.body.appendChild(footer);
    await footer.updateComplete;

    expect(footer.querySelector(".footer-version")).toBeNull();
    expect(footer.textContent).not.toMatch(/\bv\d+\.\d+/i);
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

describe("page-footer legal links", () => {
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

  // Google's OAuth review needs the privacy policy linked from the home page,
  // and both pages are root files shipped from resources/public/.
  it("links the Terms of Service and the Privacy Policy", async () => {
    footer = document.createElement("page-footer") as Footer;
    document.body.appendChild(footer);
    await footer.updateComplete;

    const terms = footer.querySelector<HTMLAnchorElement>("a.footer-terms");
    const privacy = footer.querySelector<HTMLAnchorElement>("a.footer-privacy");
    expect(terms?.getAttribute("href")).toBe("/terms.html");
    expect(terms?.getAttribute("data-i18n")).toBe("main.terms");
    expect(privacy?.getAttribute("href")).toBe("/privacy.html");
    expect(privacy?.getAttribute("data-i18n")).toBe("main.privacy");
  });
});
