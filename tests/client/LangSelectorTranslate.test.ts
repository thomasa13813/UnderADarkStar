import { afterEach, describe, expect, it, vi } from "vitest";
import { LangSelector } from "../../src/client/LangSelector";

// applyTranslation/changeLanguage are private; drive them through a cast, the
// same way GameInfoView.test.ts does. Constructing without attaching skips
// connectedCallback's full language bootstrap.
function makeSelector(translations: Record<string, string>): LangSelector {
  const selector = new LangSelector();
  selector.translations = translations;
  selector.defaultTranslations = translations;
  return selector;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("LangSelector applyTranslation", () => {
  it("writes resolved data-i18n keys and skips unresolvable ones", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    document.body.innerHTML = `
      <span data-i18n="test.hello"></span>
      <span data-i18n="test.bogus">untouched</span>
    `;
    const selector = makeSelector({
      "main.title": "OpenFront",
      "test.hello": "Hello",
      // Malformed map value: translateText hands it back as null, which the
      // loop must skip with a warning instead of blanking the node.
      "test.bogus": null as unknown as string,
    });

    (selector as unknown as { applyTranslation(): void }).applyTranslation();

    expect(
      document.querySelector('[data-i18n="test.hello"]')!.textContent,
    ).toBe("Hello");
    expect(
      document.querySelector('[data-i18n="test.bogus"]')!.textContent,
    ).toBe("untouched");
    expect(warn).toHaveBeenCalledWith("Translation key not found: test.bogus");
    expect(document.title).toBe("OpenFront");
  });
});

describe("LangSelector translateText", () => {
  it("warns and returns the key itself when it is not found", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const selector = makeSelector({});

    expect(selector.translateText("missing.key")).toBe("missing.key");
    expect(warn).toHaveBeenCalledWith("Translation key not found: missing.key");
  });

  it("substitutes {placeholders} from params", () => {
    const selector = makeSelector({
      "test.greeting": "Hello {name}, {count} new messages",
    });

    expect(
      selector.translateText("test.greeting", { name: "Sam", count: 3 }),
    ).toBe("Hello Sam, 3 new messages");
  });
});

describe("LangSelector language loading", () => {
  it("flattens fetched translations, warning on non-string non-object values", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          main: { title: "Titre" },
          bogus: [1, 2],
        }),
      })),
    );
    const selector = makeSelector({});

    await (
      selector as unknown as { changeLanguage(lang: string): Promise<void> }
    ).changeLanguage("fr");

    expect(selector.currentLang).toBe("fr");
    expect(selector.translations).toEqual({ "main.title": "Titre" });
    // The array value is dropped, not flattened.
    expect(warn).toHaveBeenCalledWith("Unknown type", "object", [1, 2]);
  });
});

describe("LangSelector English only (Under a Dark Star)", () => {
  it("ignores the browser language and a saved choice, and shows no flag", async () => {
    vi.spyOn(navigator, "language", "get").mockReturnValue("fr-FR");
    localStorage.setItem("lang", "de");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const selector = new LangSelector();
    document.body.appendChild(selector);
    await vi.waitFor(() => expect(selector.translations).toBeDefined());
    await selector.updateComplete;

    expect(selector.currentLang).toBe("en");
    expect(selector.translateText("main.title")).toBe("Under a Dark Star");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(selector.querySelector("#lang-selector")).toBeNull();

    // A stray language-selected event changes nothing either.
    window.dispatchEvent(
      new CustomEvent("language-selected", { detail: { lang: "fr" } }),
    );
    expect(selector.currentLang).toBe("en");
    localStorage.removeItem("lang");
  });
});
