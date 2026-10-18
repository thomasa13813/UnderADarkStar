import { html, TemplateResult } from "lit";
import { GameEnv } from "../core/configuration/Config";
import { getApiBase } from "./ApiBase";
import { expectSession } from "./Auth";
import { ClientEnv } from "./ClientEnv";
import { translateText } from "./Utils";

// Under a Dark Star: starting a sign-in (docs/DarkStar-Accounts.md §4.2).
// Sign-in is a page navigation: the browser goes to the API's login route,
// from there to the provider, and comes back to `redirectTo` with the
// refresh cookie set. Shared by the Sign in button on the home page and the
// win screen's prompt, so both offer the same providers the same way.

export type SignInProvider = "discord" | "google" | "dev";

// Whether the API offers Google (GET /auth/providers): false until it has
// answered, so the button never appears on a server without Google's keys.
let googleOffered = false;
let providersLoad: Promise<void> | null = null;

// The providers to offer: Discord, Google when the API has it, and the dev
// provider in dev only.
export function signInProviders(): SignInProvider[] {
  const providers: SignInProvider[] = ["discord"];
  if (googleOffered) providers.push("google");
  if (ClientEnv.env() === GameEnv.Dev) providers.push("dev");
  return providers;
}

// Asks the API once which providers it offers. Never throws: an API that
// cannot be reached leaves the list as it was (no Google).
export function loadSignInProviders(): Promise<void> {
  providersLoad ??= (async () => {
    try {
      const res = await fetch(`${getApiBase()}/auth/providers`);
      if (!res.ok) return;
      const body = (await res.json()) as { providers?: unknown };
      googleOffered =
        Array.isArray(body.providers) && body.providers.includes("google");
    } catch {
      // No API, no Google; Discord's button behaves as before.
    }
  })();
  return providersLoad;
}

export function providerLabel(provider: SignInProvider): string {
  return translateText(`account.provider_${provider}`);
}

export interface SignInOptions {
  // Where to land after the sign-in; the current page by default.
  redirectTo?: string;
  // The dev provider's name (the whole sign-in, nothing to visit).
  name?: string;
}

export function startSignIn(
  provider: SignInProvider,
  options: SignInOptions = {},
): void {
  const back =
    options.redirectTo ?? window.location.origin + window.location.pathname;
  const params = new URLSearchParams({ redirect: back });
  if (options.name !== undefined) params.set("name", options.name);
  expectSession();
  window.location.assign(
    `${getApiBase()}/auth/login/${provider}?${params.toString()}`,
  );
}

// The dev provider asks for a name first; cancelling the prompt is no
// sign-in. Returns whether one was started.
export function startSignInWith(
  provider: SignInProvider,
  options: SignInOptions = {},
): boolean {
  if (provider === "dev") {
    const name = window.prompt(translateText("account.dev_name_prompt"), "");
    if (name === null) return false;
    startSignIn("dev", {
      ...options,
      name: name.trim() === "" ? "Dev" : name.trim(),
    });
    return true;
  }
  startSignIn(provider, options);
  return true;
}

export function providerIcon(provider: SignInProvider): TemplateResult {
  return provider === "discord"
    ? discordIcon()
    : provider === "google"
      ? googleIcon()
      : userIcon();
}

export function userIcon(): TemplateResult {
  return html`<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.8"
    stroke-linecap="round"
    stroke-linejoin="round"
    class="h-5 w-5 shrink-0 pointer-events-none"
    aria-hidden="true"
  >
    <circle cx="12" cy="8" r="4"></circle>
    <path d="M4 21a8 8 0 0 1 16 0"></path>
  </svg>`;
}

// Discord's mark, simplified to one path so it inherits the text colour.
export function discordIcon(): TemplateResult {
  return html`<svg
    viewBox="0 0 24 24"
    fill="currentColor"
    class="h-5 w-5 shrink-0 pointer-events-none"
    aria-hidden="true"
  >
    <path
      d="M19.6 5.3A17 17 0 0 0 15.4 4l-.2.4a15.6 15.6 0 0 1 3.8 1.9 13.5 13.5 0 0 0-14 0A15.6 15.6 0 0 1 8.8 4.4L8.6 4a17 17 0 0 0-4.2 1.3C1.7 9.3 1 13.2 1.3 17a17 17 0 0 0 5.2 2.6l1.1-1.8a11 11 0 0 1-1.8-.9l.4-.3a12.2 12.2 0 0 0 11.6 0l.4.3c-.6.4-1.2.7-1.8.9l1.1 1.8a17 17 0 0 0 5.2-2.6c.4-4.4-.7-8.3-3.1-11.7ZM8.7 14.7c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Zm6.6 0c-1 0-1.9-1-1.9-2.1s.8-2.1 1.9-2.1 1.9 1 1.9 2.1-.8 2.1-1.9 2.1Z"
    ></path>
  </svg>`;
}

// Google's "G" in its own four colours: Google's sign-in branding rules ask
// for the standard mark, unlike Discord's, which may take the text colour.
export function googleIcon(): TemplateResult {
  return html`<svg
    viewBox="0 0 48 48"
    class="h-5 w-5 shrink-0 pointer-events-none"
    aria-hidden="true"
  >
    <path
      fill="#EA4335"
      d="M24 9.5c3.5 0 6.7 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.2C12.5 13.7 17.8 9.5 24 9.5z"
    ></path>
    <path
      fill="#4285F4"
      d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.7 6c4.5-4.2 6.6-10.3 6.6-17.3z"
    ></path>
    <path
      fill="#FBBC05"
      d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.9-6.2C1 16.5 0 20.1 0 24s1 7.5 2.7 10.7l7.8-6z"
    ></path>
    <path
      fill="#34A853"
      d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.2 1.5-4.9 2.3-8.2 2.3-6.2 0-11.5-4.2-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z"
    ></path>
  </svg>`;
}
