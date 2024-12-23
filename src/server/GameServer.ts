import { ClientID, ClientMessage, ClientMessageSchema, GameConfig, GameRecordSchema, Intent, PlayerRecord, ServerPingMessageSchema, ServerStartGameMessage, ServerStartGameMessageSchema, ServerTurnMessageSchema, Turn } from "../core/Schemas";
import { Config } from "../core/configuration/Config";
import { Client } from "./Client";
import WebSocket from 'ws';
import { slog } from "./StructuredLog";
import { Storage } from '@google-cloud/storage';
import { CreateGameRecord } from "../core/Util";
import { archive } from "./Archive";
import { arc } from "d3";


export enum GamePhase {
    Lobby = 'LOBBY',
    Active = 'ACTIVE',
    Finished = 'FINISHED'
}

export class GameServer {


    private maxGameDuration = 5 * 60 * 60 * 1000 // 5 hours

    private turns: Turn[] = []
    private intents: Intent[] = []
    private activeClients: Client[] = []
    // Used for record record keeping
    private allClients: Map<ClientID, Client> = new Map()
    private _hasStarted = false
    private _startTime: number = null

    private endTurnIntervalID

    private lastPingUpdate = 0

    constructor(
        public readonly id: string,
        public readonly createdAt: number,
        public readonly isPublic: boolean,
        private config: Config,
        private gameConfig: GameConfig,

    ) { }

    public updateGameConfig(gameConfig: GameConfig): void {
        if (gameConfig.gameMap != null) {
            this.gameConfig.gameMap = gameConfig.gameMap
        }
        if (gameConfig.difficulty != null) {
            this.gameConfig.difficulty = gameConfig.difficulty
        }
    }

    public addClient(client: Client, lastTurn: number) {
        console.log(`game ${this.id} adding client ${client.id}`)
        slog('client_joined_game', `client ${client.id} (re)joining game ${this.id}`, {
            clientID: client.id,
            clientIP: client.ip,
            gameID: this.id,
            isRejoin: lastTurn > 0
        })
        // Remove stale client if this is a reconnect
        const existing = this.activeClients.find(c => c.id == client.id)
        if (existing != null) {
            existing.ws.removeAllListeners('message')
        }
        this.activeClients = this.activeClients.filter(c => c.id != client.id)
        this.activeClients.push(client)
        client.lastPing = Date.now()

        this.allClients.set(client.id, client)

        client.ws.on('message', (message: string) => {
            try {
                const clientMsg: ClientMessage = ClientMessageSchema.parse(JSON.parse(message))
                if (clientMsg.type == "intent") {
                    if (clientMsg.gameID == this.id) {
                        this.addIntent(clientMsg.intent)
                    } else {
                        console.warn(`client ${clientMsg.clientID} sent to wrong game`)
                    }
                }
                if (clientMsg.type == "ping") {
                    this.lastPingUpdate = Date.now()
                    client.lastPing = Date.now()
                }
            } catch (error) {
                console.log(`error handling message in game server: ${error}`)
            }
        })
        client.ws.on('close', () => {
            console.log(`client ${client.id} disconnected`)
            this.activeClients = this.activeClients.filter(c => c.id != client.id)
        })

        // In case a client joined the game late and missed the start message.
        if (this._hasStarted) {
            this.sendStartGameMsg(client.ws, lastTurn)
        }
    }

    public numClients(): number {
        return this.activeClients.length
    }

    public startTime(): number {
        if (this._startTime > 0) {
            return this._startTime
        } else {
            //game hasn't started yet, only works for public games
            return this.createdAt + this.config.lobbyLifetime()
        }
    }

    public start() {
        this._hasStarted = true
        this._startTime = Date.now()

        this.endTurnIntervalID = setInterval(() => this.endTurn(), this.config.turnIntervalMs());
        this.activeClients.forEach(c => {
            console.log(`game ${this.id} sending start message to ${c.id}`)
            this.sendStartGameMsg(c.ws, 0)
        })
    }

    private addIntent(intent: Intent) {
        this.intents.push(intent)
    }

    private sendStartGameMsg(ws: WebSocket, lastTurn: number) {
        ws.send(JSON.stringify(ServerStartGameMessageSchema.parse(
            {
                type: "start",
                turns: this.turns.slice(lastTurn),
                config: this.gameConfig
            }
        )))
    }

    private endTurn() {
        const pastTurn: Turn = {
            turnNumber: this.turns.length,
            gameID: this.id,
            intents: this.intents
        }
        this.turns.push(pastTurn)
        this.intents = []

        const msg = JSON.stringify(ServerTurnMessageSchema.parse(
            {
                type: "turn",
                turn: pastTurn
            }
        ))
        this.activeClients.forEach(c => {
            c.ws.send(msg)
        })
    }

    async endGame() {
        // Close all WebSocket connections
        clearInterval(this.endTurnIntervalID);
        this.activeClients.forEach(client => {
            client.ws.removeAllListeners('message'); // TODO: remove this?
            if (client.ws.readyState === WebSocket.OPEN) {
                client.ws.close(1000, "game has ended");
            }
        });
        console.log(`ending game ${this.id} with ${this.turns.length} turns`)
        try {
            if (this.allClients.size > 0) {
                const playerRecords: PlayerRecord[] = Array.from(this.allClients.values()).map(client => ({
                    ip: client.ip,
                    clientID: client.id,
                }));
                const record = CreateGameRecord(this.id, this.gameConfig, playerRecords, this.turns, this._startTime, Date.now())
                archive(record)
            } else {
                console.log(`game ${this.id} no clients joined, not archiving game`)
            }
        } catch (error) {
            console.log('error writing game to gcs: ' + error)
        }
    }

    phase(): GamePhase {
        const now = Date.now()
        const alive = []
        for (const client of this.activeClients) {
            if (now - client.lastPing > 60_000) {
                console.log(`no pings from ${client.id}, terminating connection`)
                if (client.ws.readyState === WebSocket.OPEN) {
                    client.ws.close(1000, "no heartbeats received, closing connection");
                }
            } else {
                alive.push(client)
            }
        }
        this.activeClients = alive
        if (now > this.createdAt + this.config.lobbyLifetime() + this.maxGameDuration) {
            console.warn(`game past max duration ${this.id}`)
            return GamePhase.Finished
        }

        const noRecentPings = now > this.lastPingUpdate + 20 * 1000
        const noActive = this.activeClients.length == 0

        if (!this.isPublic) {
            if (this._hasStarted) {
                if (noActive && noRecentPings) {
                    console.log(`private game: ${this.id} complete`)
                    return GamePhase.Finished
                } else {
                    return GamePhase.Active
                }
            } else {
                return GamePhase.Lobby
            }
        }

        if (now - this.createdAt < this.config.lobbyLifetime()) {
            return GamePhase.Lobby
        }
        const warmupOver = now > this.createdAt + this.config.lobbyLifetime() + 30 * 1000
        if (noActive && warmupOver && noRecentPings) {
            return GamePhase.Finished
        }

        return GamePhase.Active
    }

    hasStarted(): boolean {
        return this._hasStarted
    }
}