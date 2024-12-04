import { Cell, Game, TerrainMap, TerrainTile, TerrainType } from "../game/Game";
import { AStar, PathFindResultType, Point, SearchNode } from "./AStar";
import { SerialAStar } from "./SerialAStar";

// TODO: test this, get it work
export class MiniAStar implements AStar {

    private aStar: SerialAStar

    constructor(
        private terrainMap: TerrainMap,
        private miniMap: TerrainMap,
        private src: SearchNode,
        private dst: SearchNode,
        private canMove: (t: SearchNode) => boolean,
        private iterations: number,
        private maxTries: number
    ) {
        const miniSrc = miniMap.terrain(new Cell(Math.floor(src.cell().x / 2), Math.floor(src.cell().y / 2)))
        const miniDst = miniMap.terrain(new Cell(Math.floor(dst.cell().x / 2), Math.floor(dst.cell().y / 2)))
        this.aStar = new SerialAStar(
            miniSrc,
            miniDst,
            canMove,
            iterations,
            maxTries
        )
    }

    compute(): PathFindResultType {
        return this.aStar.compute()
    }

    reconstructPath(): Cell[] {
        const upscaled = upscalePath(this.aStar.reconstructPath())
        upscaled.push(this.dst.cell())
        return upscaled
    }

}

function upscalePath(path: Cell[], scaleFactor: number = 2): Cell[] {
    // Scale up each point
    const scaledPath = path.map(point => (new Cell(
       point.x * scaleFactor,
       point.y * scaleFactor
    )));

    const smoothPath: Cell[] = [];

    for (let i = 0; i < scaledPath.length - 1; i++) {
        const current = scaledPath[i];
        const next = scaledPath[i + 1];

        // Add the current point
        smoothPath.push(current);

        // Always interpolate between scaled points
        const dx = next.x - current.x;
        const dy = next.y - current.y;

        // Calculate number of steps needed
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        const steps = distance;

        // Add intermediate points
        for (let step = 1; step < steps; step++) {
            smoothPath.push(new Cell(
                Math.round(current.x + (dx * step) / steps),
                Math.round(current.y + (dy * step) / steps)
            ));
        }
    }

    // Add the last point
    if (scaledPath.length > 0) {
        smoothPath.push(scaledPath[scaledPath.length - 1]);
    }

    return smoothPath;
}