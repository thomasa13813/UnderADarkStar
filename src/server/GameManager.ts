import { Config } from "../core/configuration/Config";
import { ClientID, GameConfig, GameID } from "../core/Schemas";
import { v4 as uuidv4 } from 'uuid';
import { Client } from "./Client";
import { GamePhase, GameServer } from "./GameServer";
import { Difficulty, GameMap } from "../core/game/Game";



export class GameManager {

    private lastNewLobby: number = 0

    private games: GameServer[] = []

    constructor(private config: Config) { }

    gamesByPhase(phase: GamePhase): GameServer[] {
        return this.games.filter(g => g.phase() == phase)
    }

    addClient(client: Client, gameID: GameID, lastTurn: number) {
        const game = this.games.find(g => g.id == gameID)
        if (!game) {
            console.log(`game id ${gameID} not found`)
            return
        }
        game.addClient(client, lastTurn)
    }

    updateGameConfig(gameID: GameID, gameConfig: GameConfig) {
        const game = this.games.find(g => g.id == gameID)
        if (game == null) {
            console.warn(`game ${gameID} not found`)
            return
        }
        game.updateGameConfig(gameConfig)
    }

    createPrivateGame(): string {
        const id = genSmallGameID()
        this.games.push(new GameServer(id, Date.now(), false, this.config, { gameMap: GameMap.World, difficulty: Difficulty.Medium }))
        return id
    }

    hasActiveGame(gameID: GameID): boolean {
        const game = this.games.filter(g => g.phase() == GamePhase.Lobby || g.phase() == GamePhase.Active).find(g => g.id == gameID)
        return game != null
    }

    // TODO: stop private games to prevent memory leak.
    startPrivateGame(gameID: GameID) {
        const game = this.games.find(g => g.id == gameID)
        console.log(`found game ${game}`)
        if (game) {
            game.start()
        } else {
            throw new Error(`cannot start private game, game ${gameID} not found`)
        }
    }

    tick() {
        const lobbies = this.gamesByPhase(GamePhase.Lobby)
        const active = this.gamesByPhase(GamePhase.Active)
        const finished = this.gamesByPhase(GamePhase.Finished)

        const now = Date.now()
        if (now > this.lastNewLobby + this.config.gameCreationRate()) {
            this.lastNewLobby = now
            const id = uuidv4()
            lobbies.push(new GameServer(id, now, true, this.config, { gameMap: GameMap.World, difficulty: Difficulty.Medium }))
        }

        active.filter(g => !g.hasStarted() && g.isPublic).forEach(g => {
            g.start()
        })
        finished.map(g => g.endGame());  // Fire and forget
        this.games = [...lobbies, ...active]
    }
}

function genSmallGameID(): string {
    // Generate a UUID
    const uuid: string = uuidv4();

    // Convert UUID to base64
    const base64: string = btoa(uuid);

    // Take the first 4 characters of the base64 string
    return base64.slice(0, 4);
}