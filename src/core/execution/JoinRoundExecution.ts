import {
  ColoredTeams,
  Execution,
  Game,
  GameMode,
  PlayerInfo,
  PlayerType,
  Team,
} from "../game/Game";
import { PseudoRandom } from "../PseudoRandom";
import { ClientID } from "../Schemas";
import { simpleHash } from "../Util";

// Seconds after the round's first tick of play before a player who never
// spawned may launch a corsair (docs/DarkStar-Lobbies.md L36): the opening's
// flights have landed and the board has settled.
export const DROP_IN_PIRATE_DELAY_TICKS = 30 * 10;

// A drop-in (docs/DarkStar-Lobbies.md L36, L37, §14.4): a player arrives in
// a room's round after it started. The server issues the join into the turn
// stream and every client creates the same player on the same tick.
//
// During the spawn phase the newcomer spawns as everyone else does. After it
// they are a pirate-to-be: EmbracePiracyExecution lets a player who never
// spawned launch their first corsair from DROP_IN_PIRATE_DELAY_TICKS after
// play began. In a team game the newcomer joins the team with the fewest
// players (an imbalance of one is accepted); FFA has no teams.
//
// Refused, as a deterministic no-op: a clientID that already has a player
// (a rejoin keeps its own player, L42; the Executor also checks), and a
// round already won.
export class JoinRoundExecution implements Execution {
  private mg: Game;
  private active = true;

  constructor(
    private readonly clientID: ClientID,
    private readonly username: string,
    private readonly clanTag: string | null,
  ) {}

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    this.active = false;
    const mg = this.mg;
    if (mg.getWinner() !== null) return;
    if (mg.playerByClientID(this.clientID) !== null) return;
    const info = new PlayerInfo(
      this.username,
      PlayerType.Human,
      this.clientID,
      this.playerID(ticks),
      false,
      this.clanTag,
    );
    mg.addPlayer(info, this.team());
  }

  // Deterministic and fresh: drawn from the joiner and the tick, so every
  // client draws the same; drawn again on the (unlikely) clash.
  private playerID(ticks: number): string {
    const random = new PseudoRandom(simpleHash(this.clientID) + ticks);
    let id = random.nextID();
    while (this.mg.hasPlayer(id)) id = random.nextID();
    return id;
  }

  // The challengers' team with the fewest players (L37), first in team
  // order on a tie. Not the Barons' team, nor the throne's.
  private team(): Team | null {
    const mg = this.mg;
    if (mg.config().gameConfig().gameMode !== GameMode.Team) return null;
    const teams = mg
      .teams()
      .filter((t) => t !== ColoredTeams.Bot && t !== ColoredTeams.Hegemon);
    if (teams.length === 0) return null;
    const counts = new Map<Team, number>(teams.map((t) => [t, 0]));
    for (const p of mg.allPlayers()) {
      const team = p.team();
      if (team !== null && counts.has(team)) {
        counts.set(team, counts.get(team)! + 1);
      }
    }
    let best = teams[0];
    for (const t of teams) {
      if (counts.get(t)! < counts.get(best)!) best = t;
    }
    return best;
  }

  isActive(): boolean {
    return this.active;
  }

  // A join lands in any part of the round: the spawn phase (L36's
  // challenger), the opening, or play.
  activeDuringSpawnPhase(): boolean {
    return true;
  }

  activeDuringOpening(): boolean {
    return true;
  }
}
