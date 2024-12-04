import { Unit, Cell, Execution, MutableUnit, MutableGame, MutablePlayer, Player, PlayerID, TerraNullius, Tile, TileEvent, UnitType, TerrainType } from "../game/Game";
import { and, bfs, manhattanDistWrapped, sourceDstOceanShore, targetTransportTile } from "../Util";
import { AttackExecution } from "./AttackExecution";
import { DisplayMessageEvent, MessageType } from "../../client/graphics/layers/EventsDisplay";
import { PathFinder } from "../pathfinding/PathFinding";
import { PathFindResultType } from "../pathfinding/AStar";
import { SerialAStar } from "../pathfinding/SerialAStar";

export class TransportShipExecution implements Execution {

    private lastMove: number

    // TODO: make this configurable
    private ticksPerMove = 1

    private active = true

    private mg: MutableGame
    private attacker: MutablePlayer
    private target: MutablePlayer | TerraNullius

    // TODO make private
    public path: Tile[]
    private src: Tile | null
    private dst: Tile | null


    private boat: MutableUnit

    private pathFinder: PathFinder

    constructor(
        private attackerID: PlayerID,
        private targetID: PlayerID | null,
        private cell: Cell,
        private troops: number | null,
    ) { }

    activeDuringSpawnPhase(): boolean {
        return false
    }

    init(mg: MutableGame, ticks: number) {
        this.lastMove = ticks
        this.mg = mg
        this.pathFinder = PathFinder.Mini(mg, 10_000, t => t.terrainType() == TerrainType.Ocean, 2)

        this.attacker = mg.player(this.attackerID)

        if (this.attacker.units(UnitType.TransportShip).length >= mg.config().boatMaxNumber()) {
            mg.displayMessage(`No boats available, max ${mg.config().boatMaxNumber()}`, MessageType.WARN, this.attackerID)
            this.active = false
            this.attacker.addTroops(this.troops)
            return
        }

        if (this.targetID == null || this.targetID == this.mg.terraNullius().id()) {
            this.target = mg.terraNullius()
        } else {
            this.target = mg.player(this.targetID)
        }

        if (this.troops == null) {
            this.troops = this.mg.config().boatAttackAmount(this.attacker, this.target)
        }

        this.troops = Math.min(this.troops, this.attacker.troops())

        this.dst = targetTransportTile(this.mg, this.mg.tile(this.cell))
        if (this.dst == null) {
            console.warn(`${this.attacker} cannot send ship to ${this.target}, cannot find attack tile`)
            this.active = false
            return
        }
        const src = this.attacker.canBuild(UnitType.TransportShip, this.dst)
        if (src == false) {
            console.warn(`can't build transport ship`)
            this.active = false
            return
        }

        this.src = src

        this.boat = this.attacker.buildUnit(UnitType.TransportShip, this.troops, this.src)
    }

    tick(ticks: number) {
        if (!this.active) {
            return
        }
        if (!this.boat.isActive()) {
            this.active = false
            return
        }
        if (ticks - this.lastMove < this.ticksPerMove) {
            return
        }
        this.lastMove = ticks

        const result = this.pathFinder.nextTile(this.boat.tile(), this.dst)
        switch (result.type) {
            case PathFindResultType.Completed:
                if (this.dst.owner() == this.attacker) {
                    this.attacker.addTroops(this.troops)
                    this.boat.delete()
                    this.active = false
                    return
                }
                if (this.target.isPlayer() && this.attacker.isAlliedWith(this.target)) {
                    this.target.addTroops(this.troops)
                } else {
                    this.attacker.conquer(this.dst)
                    this.mg.addExecution(
                        new AttackExecution(this.troops, this.attacker.id(), this.targetID, this.dst.cell(), null, false)
                    )
                }
                this.boat.delete()
                this.active = false
                return
            case PathFindResultType.NextTile:
                this.boat.move(result.tile)
                break
            case PathFindResultType.Pending:
                break
            case PathFindResultType.PathNotFound:
                // TODO: add to poisoned port list
                console.warn(`path not found tot dst`)
                this.boat.delete()
                this.active = false
                return

        }
    }

    owner(): MutablePlayer {
        return this.attacker
    }

    isActive(): boolean {
        return this.active
    }

}

