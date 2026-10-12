import { PublicGameInfo, PublicGames, ThroneType } from "../core/Schemas";
import { translateText } from "./Utils";

// Under a Dark Star: reading the launch lines off the public lobby list
// (docs/DarkStar-Lobbies.md L16-L19, L27). The master stamps each throne
// lobby with its place in its type's line; this is the client's view of it,
// shared by the win screen (stay with my throne or join the head), the lobby
// (my place) and the lobby browser (the pill).

type Games = PublicGames["games"] | undefined | null;

function all(games: Games): PublicGameInfo[] {
  return Object.values(games ?? {}).flat();
}

/** The listing of one lobby, whichever bucket it is filed under. */
export function findLobby(
  games: Games,
  gameID: string | null,
): PublicGameInfo | undefined {
  if (gameID === null) return undefined;
  return all(games).find((lobby) => lobby.gameID === gameID);
}

/**
 * One line, head first: the thrones of a type that are gathering or counting
 * down. A throne whose winner is still choosing, or whose round is running,
 * has no place and is not in line.
 */
export function throneLine(games: Games, type: ThroneType): PublicGameInfo[] {
  return all(games)
    .filter(
      (lobby) =>
        lobby.throne?.type === type &&
        lobby.throne.running !== true &&
        lobby.throne.place !== undefined,
    )
    .sort((a, b) => a.throne!.place! - b.throne!.place!);
}

/** The next throne of a type to launch, if any is in line. */
export function lineHead(
  games: Games,
  type: ThroneType,
): PublicGameInfo | undefined {
  return throneLine(games, type)[0];
}

/**
 * A place in line as the player reads it: "Next to launch" at the head,
 * "N ahead in line" behind it. Undefined when the place is not known.
 */
export function placeLabel(place: number | undefined): string | undefined {
  if (place === undefined) return undefined;
  if (place <= 1) return translateText("throne.line_place_next");
  return translateText("throne.line_place_ahead", {
    count: String(place - 1),
  });
}
