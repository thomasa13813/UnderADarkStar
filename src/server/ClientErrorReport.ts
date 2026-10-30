import express, {
  type Express,
  type Request,
  type RequestHandler,
} from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { simpleHash } from "../core/Util";

// Under a Dark Star (docs/DarkStar-Lobbies.md §14.8): error reports from
// players' browsers. The client catches uncaught errors and rejected promises
// and posts each here (POST /api/client-error); the server writes one
// structured line to its log, where the deploy runbook already reads. No
// third-party service.
//
// What a report carries is the error, where in the game it happened and the
// build: nothing about the player. The browser's user agent is read from the
// request's own header. The IP address is used in memory only, to drop
// repeats of the same error from one client, and never logged.
//
// The body is plain text holding JSON, as navigator.sendBeacon sends it:
// a text/plain POST needs no CORS preflight, so a page served from the CDN
// can report to its game server, and a beacon survives the page unloading.

export const CLIENT_ERROR_PATH = "/api/client-error";

// What one report may hold. The client cuts to these first; the server
// refuses anything larger rather than trusting it to.
export const CLIENT_ERROR_LIMITS = {
  message: 1_000,
  stack: 4_000,
  source: 300,
  userAgent: 300,
  body: 8 * 1024,
} as const;

// The same error from the same client is logged once per window.
export const CLIENT_ERROR_REPEAT_MS = 10 * 60 * 1000;
// Remembered errors, oldest dropped first; bounds the memory a flood can use.
const MAX_REMEMBERED = 5_000;

export const ClientErrorPageSchema = z.enum([
  "home",
  "lobby",
  "game",
  "catching_up",
  "replay",
  "other",
]);
export type ClientErrorPage = z.infer<typeof ClientErrorPageSchema>;

export const ClientErrorReportSchema = z.object({
  kind: z.enum(["error", "unhandledrejection"]),
  message: z.string().max(CLIENT_ERROR_LIMITS.message),
  stack: z.string().max(CLIENT_ERROR_LIMITS.stack).optional(),
  // The script and position the error came from, "file:line:col".
  source: z.string().max(CLIENT_ERROR_LIMITS.source).optional(),
  page: ClientErrorPageSchema,
  // The build's gitCommit, as the page was served it.
  commit: z.string().max(64),
});
export type ClientErrorReport = z.infer<typeof ClientErrorReportSchema>;

export interface ClientErrorLog {
  warn(message: string, meta: Record<string, unknown>): void;
}

// Remembers which errors it has logged, per client, for the repeat window.
export class ClientErrorRepeats {
  private readonly seen = new Map<string, number>();

  constructor(private readonly windowMs = CLIENT_ERROR_REPEAT_MS) {}

  // True the first time this client sends this error in the window.
  firstTime(client: string, report: ClientErrorReport, now: number): boolean {
    const key = `${client}|${simpleHash(
      `${report.kind}|${report.message}|${report.stack ?? ""}`,
    )}`;
    const last = this.seen.get(key);
    if (last !== undefined && now - last < this.windowMs) return false;
    this.seen.delete(key);
    this.seen.set(key, now);
    while (this.seen.size > MAX_REMEMBERED) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
    return true;
  }
}

// Parse a request body as a report: the JSON in a text body, or an object
// a JSON body parser already made. Null when it is not a report.
export function parseClientErrorReport(
  body: unknown,
): ClientErrorReport | null {
  let value = body;
  if (typeof body === "string") {
    if (body.length > CLIENT_ERROR_LIMITS.body) return null;
    try {
      value = JSON.parse(body);
    } catch {
      return null;
    }
  }
  const result = ClientErrorReportSchema.safeParse(value);
  return result.success ? result.data : null;
}

// The route's handler. Every outcome answers 204: a browser has nothing to
// do with a refusal, and a uniform answer tells a prober nothing.
export function clientErrorHandler(
  log: ClientErrorLog,
  repeats = new ClientErrorRepeats(),
  now: () => number = Date.now,
): RequestHandler {
  return (req: Request, res) => {
    const report = parseClientErrorReport(req.body);
    if (report !== null && repeats.firstTime(clientKey(req), report, now())) {
      log.warn("client error", {
        kind: report.kind,
        page: report.page,
        // Not "message": the logger folds that into the line's own message.
        error: report.message,
        stack: report.stack,
        source: report.source,
        commit: report.commit,
        userAgent: (req.get("user-agent") ?? "").slice(
          0,
          CLIENT_ERROR_LIMITS.userAgent,
        ),
      });
    }
    res.status(204).end();
  };
}

function clientKey(req: Request): string {
  return req.ip ?? req.socket?.remoteAddress ?? "unknown";
}

// At most this many reports a minute from one address.
export const CLIENT_ERROR_RATE_PER_MINUTE = 10;

// The route on an Express app: the rate limit, the plain-text body (as
// sendBeacon sends it) and the handler.
export function mountClientErrorRoute(app: Express, log: ClientErrorLog): void {
  app.post(
    CLIENT_ERROR_PATH,
    rateLimit({ windowMs: 60_000, limit: CLIENT_ERROR_RATE_PER_MINUTE }),
    express.text({ type: "text/plain", limit: CLIENT_ERROR_LIMITS.body }),
    clientErrorHandler(log),
  );
}
