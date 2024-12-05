import { Cell, DefenseBonus, Execution, MutableGame, MutablePlayer, MutableUnit, PlayerID, Tile, UnitType } from "../game/Game";
import { bfs, dist } from "../Util";

export class CityExecution implements Execution {

    private player: MutablePlayer
    private mg: MutableGame
    private city: MutableUnit
    private tile: Tile
    private active: boolean = true

    constructor(private ownerId: PlayerID, private cell: Cell) { }

    init(mg: MutableGame, ticks: number): void {
        this.mg = mg
        this.tile = mg.tile(this.cell)
        this.player = mg.player(this.ownerId)
    }

    tick(ticks: number): void {
        if (this.city == null) {
            const spawnTile = this.player.canBuild(UnitType.City, this.tile)
            if (spawnTile == false) {
                console.warn('cannot build Defense Post')
                this.active = false
                return
            }
            this.city = this.player.buildUnit(UnitType.City, 0, spawnTile)
        }
        if (!this.city.isActive()) {
            this.active = false
            return
        }
    }

    owner(): MutablePlayer {
        return null
    }

    isActive(): boolean {
        return this.active
    }

    activeDuringSpawnPhase(): boolean {
        return false
    }

}