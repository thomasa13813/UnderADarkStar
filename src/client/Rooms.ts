import { PublicGameInfo, PublicGames } from "../core/Schemas";

// Under a Dark Star: reading the persistent rooms off the public lobby list
// (docs/DarkStar-Lobbies.md §14, L32-L48). The list carries each room once:
// its lobby, or its round while one runs. Shared by the home page (the
// steering button and the cards), the win and death screens (another room)
// and the lobby browser.

export type Games = PublicGames["games"] | undefined | null;

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

/** Every room, as the master lists them. */
export function rooms(games: Games): PublicGameInfo[] {
  return (games?.throne ?? []).filter((lobby) => lobby.throne !== undefined);
}

/** The room holds its cap of humans (L33). The master counts players only. */
export function roomIsFull(lobby: PublicGameInfo): boolean {
  const cap = lobby.gameConfig?.maxPlayers;
  return cap !== undefined && lobby.numClients >= cap;
}

export type RoomState = "countdown" | "running" | "gathering" | "empty";

export function roomState(lobby: PublicGameInfo): RoomState {
  if (lobby.throne?.running === true) return "running";
  if (lobby.startsAt !== undefined) return "countdown";
  return lobby.numClients > 0 ? "gathering" : "empty";
}

const STEERING_RANK: Record<RoomState, number> = {
  countdown: 0,
  running: 1,
  gathering: 2,
  empty: 3,
};

/**
 * Rooms under their cap in the steering order (L38): about to launch,
 * soonest first; then rounds in progress, longest running first (the likeliest
 * to start again soonest, joined as a pirate or held for the next round);
 * then lobbies with humans and no countdown yet; then empty ones.
 */
export function steeringOrder(games: Games): PublicGameInfo[] {
  return rooms(games)
    .filter((lobby) => !roomIsFull(lobby))
    .sort((a, b) => {
      const sa = roomState(a);
      const sb = roomState(b);
      if (sa !== sb) return STEERING_RANK[sa] - STEERING_RANK[sb];
      if (sa === "countdown") return a.startsAt! - b.startsAt!;
      if (sa === "running") {
        return (
          (a.throne?.startedAt ?? Number.MAX_SAFE_INTEGER) -
          (b.throne?.startedAt ?? Number.MAX_SAFE_INTEGER)
        );
      }
      return b.numClients - a.numClients;
    });
}

/** Where the home page's main button sends a player (L38). */
export function steerTarget(games: Games): PublicGameInfo | undefined {
  return steeringOrder(games)[0];
}

/**
 * The rooms a player may go to instead of their own (the death screen, L46;
 * the round's end, L47), in the steering order.
 */
export function otherRooms(
  games: Games,
  ownThroneID: string | undefined,
): PublicGameInfo[] {
  return steeringOrder(games).filter(
    (lobby) => lobby.throne?.throneID !== ownThroneID,
  );
}
