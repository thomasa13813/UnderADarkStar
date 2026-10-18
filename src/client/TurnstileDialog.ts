/**
 * The popup that frames the bot check (Cloudflare Turnstile) when a challenge
 * needs the player.
 *
 * The widget renders with `appearance: "interaction-only"`, so most browsers
 * pass the check without anything appearing. When Turnstile decides the
 * player must act, the widget becomes visible inside its container -- which
 * used to be a bare centred div in the page flow, so the box floated over the
 * lobby cards at phone width and over "Connecting to lobby..." on desktop.
 * The container now lives inside `#turnstile-dialog` (index.html), a
 * full-screen backdrop with a short explanation, revealed by
 * `requestTurnstileToken`'s `onInteractive` hook and hidden again when the
 * player's part is over or the request settles.
 *
 * The dialog idles as `invisible` rather than `hidden`: visibility keeps the
 * widget's iframe loading and running its silent check, which display:none
 * would not guarantee.
 */
export const TURNSTILE_DIALOG_ID = "turnstile-dialog";

/** Where `requestTurnstileToken` renders the widget: inside the dialog. */
export const TURNSTILE_CONTAINER_SELECTOR = "#turnstile-container";

export function setTurnstileDialogVisible(visible: boolean): void {
  const dialog = document.getElementById(TURNSTILE_DIALOG_ID);
  if (dialog === null) return;
  dialog.classList.toggle("invisible", !visible);
  dialog.classList.toggle("pointer-events-none", !visible);
}
