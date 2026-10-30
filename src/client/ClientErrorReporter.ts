import { ClientEnv } from "./ClientEnv";

// Under a Dark Star (docs/DarkStar-Lobbies.md §14.8): tells the game server
// when the game fails in this browser. Uncaught errors and rejected promises
// are posted to /api/client-error (src/server/ClientErrorReport.ts), which
// writes one line to the server's log: the message, a stack cut to a few KB,
// where in the game it happened, and the build. Nothing about the player.
//
// Sent as a beacon with a text/plain body: no CORS preflight, so a page
// served from the CDN reaches its game server, and a report written as the
// page unloads still goes. The same error goes once per page load, and a
// page sends at most MAX_REPORTS; the server drops repeats and rate-limits
// too.

export type ReportPage =
  | "home"
  | "lobby"
  | "game"
  | "catching_up"
  | "replay"
  | "other";

// Kept in step with CLIENT_ERROR_LIMITS on the server.
const LIMITS = { message: 1_000, stack: 4_000, source: 300 } as const;
const MAX_REPORTS = 10;

// What the game tells the reporter about itself, once a game runs.
interface GameState {
  isCatchingUp(): boolean;
  config(): { isReplay(): boolean };
}

let game: GameState | null = null;

/** The game this page now runs, or null when it no longer does. */
export function setReportedGame(state: GameState | null): void {
  game = state;
}

function currentPage(): ReportPage {
  if (game !== null) {
    try {
      if (game.config().isReplay()) return "replay";
      return game.isCatchingUp() ? "catching_up" : "game";
    } catch {
      return "game";
    }
  }
  switch (window.currentPageId) {
    case "page-play":
    case undefined:
      return "home";
    case "page-join-lobby":
    case "page-host-lobby":
      return "lobby";
    default:
      return "other";
  }
}

// Errors no player can be helped with, or not ours: a cross-origin script's
// opaque "Script error.", the browser's resize-observer notice, extensions.
function ignored(message: string, source: string | undefined): boolean {
  if (/^Script error\.?$/.test(message.trim())) return true;
  if (message.includes("ResizeObserver loop")) return true;
  return (
    source !== undefined &&
    /^(chrome|moz|safari(-web)?)-extension:/.test(source)
  );
}

function describe(reason: unknown): { message: string; stack?: string } {
  if (reason instanceof Error) {
    return {
      message: `${reason.name}: ${reason.message}`,
      stack: reason.stack,
    };
  }
  try {
    return { message: String(reason) };
  } catch {
    return { message: "unprintable rejection" };
  }
}

function commit(): string {
  try {
    return ClientEnv.gitCommit();
  } catch {
    // The bootstrap config is missing: the page failed very early.
    return "unknown";
  }
}

function endpoint(): string {
  try {
    return `${ClientEnv.serverHttpBase()}/api/client-error`;
  } catch {
    return "/api/client-error";
  }
}

export class ClientErrorReporter {
  private readonly sent = new Set<string>();
  private count = 0;

  constructor(
    private readonly send: (url: string, body: string) => void = beacon,
  ) {}

  report(
    kind: "error" | "unhandledrejection",
    message: string,
    stack: string | undefined,
    source: string | undefined,
  ): void {
    if (ignored(message, source)) return;
    const key = `${kind}|${message}|${stack ?? ""}`;
    if (this.sent.has(key) || this.count >= MAX_REPORTS) return;
    this.sent.add(key);
    this.count++;
    const body = JSON.stringify({
      kind,
      message: message.slice(0, LIMITS.message),
      stack: stack?.slice(0, LIMITS.stack),
      source: source?.slice(0, LIMITS.source),
      page: currentPage(),
      commit: commit().slice(0, 64),
    });
    try {
      this.send(endpoint(), body);
    } catch {
      // Reporting must never be the next error.
    }
  }

  install(target: Window = window): void {
    target.addEventListener("error", (event: ErrorEvent) => {
      const source = event.filename
        ? `${event.filename}:${event.lineno}:${event.colno}`
        : undefined;
      const { message, stack } =
        event.error instanceof Error
          ? describe(event.error)
          : { message: event.message ?? "", stack: undefined };
      this.report("error", message || event.message || "", stack, source);
    });
    target.addEventListener(
      "unhandledrejection",
      (event: PromiseRejectionEvent) => {
        const { message, stack } = describe(event.reason);
        this.report("unhandledrejection", message, stack, undefined);
      },
    );
  }
}

function beacon(url: string, body: string): void {
  const blob = new Blob([body], { type: "text/plain" });
  if (navigator.sendBeacon?.(url, blob)) return;
  void fetch(url, {
    method: "POST",
    body: blob,
    mode: "no-cors",
    keepalive: true,
  }).catch(() => {});
}

let installed: ClientErrorReporter | null = null;

/** Start reporting this page's errors; once per page. */
export function installClientErrorReporter(): void {
  if (installed !== null) return;
  installed = new ClientErrorReporter();
  installed.install();
}
