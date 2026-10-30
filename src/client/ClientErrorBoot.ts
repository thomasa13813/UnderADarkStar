import { installClientErrorReporter } from "./ClientErrorReporter";

// Imported first by Main.ts, so the errors of everything loaded after it are
// reported (docs/DarkStar-Lobbies.md §14.8).
installClientErrorReporter();
