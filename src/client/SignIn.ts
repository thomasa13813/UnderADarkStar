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

export type SignInProvider = "discord" | "dev";

// The providers to offer: Discord, and the dev provider in dev only.
export function signInProviders(): SignInProvider[] {
  return ClientEnv.env() === GameEnv.Dev ? ["discord", "dev"] : ["discord"];
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
  return provider === "discord" ? discordIcon() : userIcon();
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
