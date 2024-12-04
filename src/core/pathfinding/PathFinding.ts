import { Cell, Game, TerrainTile, TerrainType, Tile } from "../game/Game";
import { manhattanDist } from "../Util";
import { AStar, PathFindResultType, SearchNode, TileResult } from "./AStar";
import { ParallelAStar, WorkerClient } from "../worker/WorkerClient";
import { SerialAStar } from "./SerialAStar";
import { MiniAStar } from "./MiniAStar";

export class PathFinder {

    private curr: Tile = null
    private dst: Tile = null
    private path: Cell[]
    private aStar: AStar
    private computeFinished = true

    private constructor(
        private game: Game,
        private newAStar: (curr: Tile, dst: Tile) => AStar
    ) { }


    public static Mini(game: Game, iterations: number, canMove: (s: SearchNode) => boolean, maxTries: number = 20) {
        return new PathFinder(
            game,
            (curr: Tile, dst: Tile) => {
                return new MiniAStar(
                    game.terrainMap(),
                    game.terrainMiniMap(),
                    curr,
                    dst,
                    canMove,
                    iterations,
                    maxTries
                )
            }
        )
    }

    public static Serial(game: Game, iterations: number, canMove: (t: Tile) => boolean, maxTries: number = 20): PathFinder {
        return new PathFinder(
            game,
            (curr: Tile, dst: Tile) => {
                return new SerialAStar(
                    curr,
                    dst,
                    canMove,
                    iterations,
                    maxTries
                )
            }
        )
    }

    public static Parallel(game: Game, worker: WorkerClient, numTicks: number, ...types: TerrainType[]): PathFinder {
        if (types.length == 0) {
            types = [TerrainType.Ocean]
        }
        return new PathFinder(
            game,
            (curr: Tile, dst: Tile) => {
                return worker.createParallelAStar(curr, dst, numTicks, types)
            }
        )
    }

    nextTile(curr: Tile, dst: Tile, dist: number = 1): TileResult {
        if (curr == null) {
            console.error('curr is null')
        }
        if (dst == null) {
            console.error('dst is null')
        }

        if (manhattanDist(curr.cell(), dst.cell()) < dist) {
            return { type: PathFindResultType.Completed, tile: curr }
        }

        if (this.computeFinished) {
            if (this.shouldRecompute(curr, dst)) {
                this.curr = curr
                this.dst = dst
                this.path = null
                this.aStar = this.newAStar(curr, dst)
                this.computeFinished = false
                return this.nextTile(curr, dst)
            } else {
                return { type: PathFindResultType.NextTile, tile: this.game.tile(this.path.shift()) }
            }
        }

        switch (this.aStar.compute()) {
            case PathFindResultType.Completed:
                this.computeFinished = true
                this.path = this.aStar.reconstructPath()
                // Remove the start tile
                this.path.shift()
                return this.nextTile(curr, dst)
            case PathFindResultType.Pending:
                return { type: PathFindResultType.Pending }
            case PathFindResultType.PathNotFound:
                return { type: PathFindResultType.PathNotFound }
        }
    }

    private shouldRecompute(curr: Tile, dst: Tile) {
        if (this.path == null || this.curr == null || this.dst == null) {
            return true
        }
        const dist = manhattanDist(curr.cell(), dst.cell())
        let tolerance = 10
        if (dist > 50) {
            tolerance = 10
        } else if (dist > 25) {
            tolerance = 5
        } else if (dist > 10) {
            tolerance = 3
        } else {
            tolerance = 0
        }
        if (manhattanDist(this.dst.cell(), dst.cell()) > tolerance) {
            return true
        }
        return false
    }
}
