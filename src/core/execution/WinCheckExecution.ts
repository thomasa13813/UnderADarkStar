import { GameEvent } from "../EventBus";
import {
  ColoredTeams,
  Execution,
  Game,
  GameMode,
  Player,
  PlayerType,
  RankedType,
  Team,
} from "../game/Game";

export class WinEvent implements GameEvent {
  constructor(public readonly winner: Player) {}
}

export class WinCheckExecution implements Execution {
  private active = true;

  private mg: Game | null = null;

  private checkedRankedSpawns = false;

  // Hard time limit (in seconds) to force a winner before the server's
  // maxGameDuration hard kill. 170mins (10 mins before 3hrs)
  private static readonly HARD_TIME_LIMIT_SECONDS = 170 * 60;

  constructor() {}

  init(mg: Game, ticks: number) {
    this.mg = mg;
  }

  tick(ticks: number) {
    if (ticks % 10 !== 0) {
      return;
    }
    if (this.mg === null) throw new Error("Not initialized");

    if (this.checkRanked2v2Cancelled()) {
      return;
    }

    // Under a Dark Star the round ends only through the throne (R1): the
    // land-share win, FFA or team, is off while a Hegemon sits.
    if (this.mg.config().hegemonConfig().enabled) {
      this.checkWinnerHegemon();
      return;
    }
    if (this.mg.config().gameConfig().gameMode === GameMode.FFA) {
      this.checkWinnerFFA();
    } else {
      this.checkWinnerTeam();
    }
  }

  // A ranked 2v2 match is void unless all four matched players actually
  // spawned — a player who never joined isn't in the game at all, and one who
  // idled through the spawn phase never placed a spawn. Either way the match
  // would be lopsided, so end it with no winner (the record is archived
  // winnerless and never ranked). Runs once, on the first check after the
  // spawn phase ends (this execution is inactive during the spawn phase).
  private checkRanked2v2Cancelled(): boolean {
    if (this.mg === null) throw new Error("Not initialized");
    if (this.checkedRankedSpawns) {
      return false;
    }
    this.checkedRankedSpawns = true;
    const gameConfig = this.mg.config().gameConfig();
    if (gameConfig.rankedType !== RankedType.TwoVTwo) {
      return false;
    }
    // allPlayers: players() hides tile-less players, which is exactly what a
    // never-spawned player is.
    const spawned = this.mg
      .allPlayers()
      .filter((p) => p.type() === PlayerType.Human && p.hasSpawned()).length;
    const expected = gameConfig.maxPlayers ?? 0;
    if (spawned >= expected) {
      return false;
    }
    console.log(
      `ranked 2v2 cancelled: only ${spawned}/${expected} players spawned`,
    );
    this.mg.setWinner(null, this.mg.stats().stats());
    this.active = false;
    return true;
  }

  checkWinnerFFA(): void {
    if (this.mg === null) throw new Error("Not initialized");
    const sorted = this.mg
      .players()
      .sort((a, b) => b.numTilesOwned() - a.numTilesOwned());
    if (sorted.length === 0) {
      return;
    }

    if (this.mg.config().gameConfig().rankedType === RankedType.OneVOne) {
      const humans = sorted.filter(
        (p) => p.type() === PlayerType.Human && !p.isDisconnected(),
      );
      if (humans.length === 1) {
        this.mg.setWinner(humans[0], this.mg.stats().stats());
        console.log(`${humans[0].name()} has won the game`);
        this.active = false;
        return;
      }
    }

    const max = sorted[0];
    if (this.hasWon(max.numTilesOwned())) {
      this.mg.setWinner(max, this.mg.stats().stats());
      console.log(`${max.name()} has won the game`);
      this.active = false;
    }
  }

  // Hegemon mode: victory runs through the Hegemon (R1). Holding land wins
  // nothing; the round ends when the Hegemon is eliminated, and its slayer wins
  // (R2, R3), or when the timer expires, and the Hegemon wins (R4).
  private checkWinnerHegemon(): void {
    if (this.mg === null) throw new Error("Not initialized");
    const hegemon = this.mg.hegemon();
    if (hegemon === null) return;

    if (!hegemon.isAlive()) {
      const winner =
        this.mg.hegemonSlayer() ??
        this.mg
          .players()
          .sort((a, b) => b.numTilesOwned() - a.numTilesOwned())[0];
      if (winner === undefined) return;
      this.mg.setWinner(winner, this.mg.stats().stats());
      console.log(`${winner.name()} has overthrown the Hegemon`);
      this.active = false;
      return;
    }

    // A round is always timed (R5): an unset or disabled timer is the default.
    const roundMinutes =
      this.mg.config().gameConfig().maxTimerValue ??
      this.mg.config().hegemonConfig().defaultRoundMinutes;
    const timeElapsed = this.mg.elapsedGameSeconds();
    if (
      timeElapsed >= roundMinutes * 60 ||
      timeElapsed >= WinCheckExecution.HARD_TIME_LIMIT_SECONDS
    ) {
      this.mg.setWinner(hegemon, this.mg.stats().stats());
      console.log(`${hegemon.name()} endures`);
      this.active = false;
    }
  }

  // Hold more than the required share of non-fallout land, or outlast the
  // lobby timer / hard limit.
  private hasWon(tilesOwned: number): boolean {
    if (this.mg === null) throw new Error("Not initialized");
    const timeElapsed = this.mg.elapsedGameSeconds();
    // null (host lobby, timer off) means no timer, same as undefined.
    const maxTimerValue = this.mg.config().gameConfig().maxTimerValue;
    if (
      maxTimerValue !== undefined &&
      maxTimerValue !== null &&
      timeElapsed >= maxTimerValue * 60
    ) {
      return true;
    }
    if (timeElapsed >= WinCheckExecution.HARD_TIME_LIMIT_SECONDS) {
      return true;
    }
    const numTilesWithoutFallout =
      this.mg.numLandTiles() - this.mg.numTilesWithFallout();
    // Cross-multiplied: the threshold is a whole percentage, so this is
    // exact integer math.
    return (
      tilesOwned * 100 >
      numTilesWithoutFallout *
        this.mg.config().percentageTilesOwnedToWin(timeElapsed)
    );
  }

  checkWinnerTeam(): void {
    if (this.mg === null) throw new Error("Not initialized");

    if (this.mg.config().gameConfig().rankedType === RankedType.TwoVTwo) {
      // players() only returns alive players, so a team drops out of this set
      // once every member is dead or disconnected.
      const teamsRemaining = new Set<Team>();
      for (const player of this.mg.players()) {
        if (player.type() !== PlayerType.Human || player.isDisconnected()) {
          continue;
        }
        const team = player.team();
        if (team !== null) {
          teamsRemaining.add(team);
        }
      }
      if (teamsRemaining.size === 1) {
        const [winner] = teamsRemaining;
        this.mg.setWinner(winner, this.mg.stats().stats());
        console.log(`${winner} has won the game`);
        this.active = false;
        return;
      }
    }

    const teamToTiles = new Map<Team, number>();
    for (const player of this.mg.players()) {
      const team = player.team();
      // Sanity check, team should not be null here
      if (team === null) continue;
      teamToTiles.set(
        team,
        (teamToTiles.get(team) ?? 0) + player.numTilesOwned(),
      );
    }
    const sorted = Array.from(teamToTiles.entries()).sort(
      (a, b) => b[1] - a[1],
    );
    if (sorted.length === 0) {
      return;
    }
    const max = sorted[0];
    if (this.hasWon(max[1])) {
      if (max[0] === ColoredTeams.Bot) return;
      this.mg.setWinner(max[0], this.mg.stats().stats());
      console.log(`${max[0]} has won the game`);
      this.active = false;
    }
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return false;
  }
}
