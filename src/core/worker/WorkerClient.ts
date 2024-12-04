import { Cell, Game, GameMap, TerrainTile, TerrainType, Tile } from "../game/Game";
import { AStar, PathFindResultType } from "../pathfinding/AStar";
import { MiniAStar } from "../pathfinding/MiniAStar";


export class WorkerClient {
    private worker: Worker;
    private isInitialized = false;

    constructor(private game: Game, private gameMap: GameMap) {
        // Create a new worker using webpack worker-loader
        // The import.meta.url ensures webpack can properly bundle the worker
        this.worker = new Worker(new URL('./Worker.worker.ts', import.meta.url));
    }

    initialize(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.worker.postMessage({
                type: 'init',
                gameMap: this.gameMap
            });

            const handler = (e: MessageEvent) => {
                if (e.data.type === 'initialized') {
                    this.worker.removeEventListener('message', handler);
                    this.isInitialized = true;
                    resolve();
                } else {
                    this.worker.removeEventListener('message', handler);
                    reject('Failed to initialize pathfinder');
                }
            };

            this.worker.addEventListener('message', handler);
        });
    }

    createParallelAStar(src: Tile, dst: Tile, numTicks: number, types: TerrainType[]): ParallelAStar {
        if (!this.isInitialized) {
            throw new Error('PathFinder not initialized');
        }
        return new ParallelAStar(this.game, this.worker, src, dst, numTicks, types);
    }

    cleanup() {
        this.worker.terminate();
    }
}

export class ParallelAStar implements AStar {
    private path: Cell[] | 'NOT_FOUND' | null = null;
    private promise: Promise<void>;

    constructor(
        private game: Game,
        private worker: Worker,
        private src: Tile,
        private dst: Tile,
        private numTicks: number,
        private terrainTypes: TerrainType[]
    ) { }

    findPath(): Promise<void> {
        const requestId = crypto.randomUUID();
        this.promise = new Promise((resolve, reject) => {

            const handler = (e: MessageEvent) => {
                if (e.data.requestId != requestId) {
                    return;
                }
                this.worker.removeEventListener('message', handler);

                if (e.data.type === 'pathFound') {
                    this.path = e.data.path
                    resolve();
                } else if (e.data.type === 'pathNotFound') {
                    this.path = 'NOT_FOUND';
                } else {
                    reject(e.data.reason || "Path not found");
                }
            };

            this.worker.addEventListener('message', handler);
            this.worker.postMessage({
                type: 'findPath',
                requestId: requestId,
                terrainTypes: this.terrainTypes,
                currentTick: this.game.ticks(),
                duration: this.numTicks,
                start: { x: this.src.cell().x, y: this.src.cell().y },
                end: { x: this.dst.cell().x, y: this.dst.cell().y }
            });
        });

        return this.promise;
    }

    // TODO: rename to poll?
    compute(): PathFindResultType {
        if (this.promise == null) {
            this.findPath();
        }
        this.numTicks--;
        if (this.numTicks <= 0) {
            if (this.path == 'NOT_FOUND') {
                return PathFindResultType.PathNotFound;
            }
            if (this.path != null) {
                return PathFindResultType.Completed;
            }
            // Path was not found in worker thread in time, so now we need
            // to recompute it in main thread. This will lock up game.
            console.warn(`path not completed in worker thread, recomputing`)
            const local = new MiniAStar(
                this.game.terrainMap(),
                this.game.terrainMiniMap(),
                this.src, this.dst,
                (t: TerrainTile) => t.terrainType() == TerrainType.Ocean,
                100_000_000,
                20
            )
            const result = local.compute()
            switch (result) {
                case PathFindResultType.Completed:
                    console.log('recomputed path in worker client')
                    this.path = local.reconstructPath()
                    break
                case PathFindResultType.PathNotFound:
                    this.path = "NOT_FOUND"
                    break
                case PathFindResultType.Pending:
                    // TODO: make sure same number of tries as worker thread.
                    console.warn("path not found after many tries")
                    this.path = "NOT_FOUND"
                    break
            }
            if (result == PathFindResultType.Completed) {
                this.path = local.reconstructPath()
            }
            return result
        }
        return PathFindResultType.Pending;
    }

    reconstructPath(): Cell[] {
        if (this.path == "NOT_FOUND" || this.path == null) {
            throw Error(`cannot reconstruct path: ${this.path}`);
        }
        return this.path
    }

}
