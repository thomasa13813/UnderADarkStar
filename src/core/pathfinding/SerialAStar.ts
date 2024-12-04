import { PriorityQueue } from "@datastructures-js/priority-queue";
import { AStar, SearchNode } from "./AStar";
import { PathFindResultType } from "./AStar";
import { Cell } from "../game/Game";


export class SerialAStar implements AStar {
    private fwdOpenSet: PriorityQueue<{ tile: SearchNode; fScore: number; }>;
    private bwdOpenSet: PriorityQueue<{ tile: SearchNode; fScore: number; }>;
    private fwdCameFrom: Map<SearchNode, SearchNode>;
    private bwdCameFrom: Map<SearchNode, SearchNode>;
    private fwdGScore: Map<SearchNode, number>;
    private bwdGScore: Map<SearchNode, number>;
    private meetingPoint: SearchNode | null;
    public completed: boolean;

    constructor(
        private src: SearchNode,
        private dst: SearchNode,
        private canMove: (t: SearchNode) => boolean,
        private iterations: number,
        private maxTries: number
    ) {
        this.fwdOpenSet = new PriorityQueue<{ tile: SearchNode; fScore: number; }>(
            (a, b) => a.fScore - b.fScore
        );
        this.bwdOpenSet = new PriorityQueue<{ tile: SearchNode; fScore: number; }>(
            (a, b) => a.fScore - b.fScore
        );
        this.fwdCameFrom = new Map<SearchNode, SearchNode>();
        this.bwdCameFrom = new Map<SearchNode, SearchNode>();
        this.fwdGScore = new Map<SearchNode, number>();
        this.bwdGScore = new Map<SearchNode, number>();
        this.meetingPoint = null;
        this.completed = false;

        // Initialize forward search
        this.fwdGScore.set(src, 0);
        this.fwdOpenSet.enqueue({ tile: src, fScore: this.heuristic(src, dst) });

        // Initialize backward search
        this.bwdGScore.set(dst, 0);
        this.bwdOpenSet.enqueue({ tile: dst, fScore: this.heuristic(dst, src) });
    }

    compute(): PathFindResultType {
        if (this.completed) return PathFindResultType.Completed;

        this.maxTries -= 1;
        let iterations = this.iterations;

        while (!this.fwdOpenSet.isEmpty() && !this.bwdOpenSet.isEmpty()) {
            iterations--;
            if (iterations <= 0) {
                if (this.maxTries <= 0) {
                    return PathFindResultType.PathNotFound;
                }
                return PathFindResultType.Pending;
            }

            // Process forward search
            const fwdCurrent = this.fwdOpenSet.dequeue()!.tile;
            if (this.bwdGScore.has(fwdCurrent)) {
                // We found a meeting point!
                this.meetingPoint = fwdCurrent;
                this.completed = true;
                return PathFindResultType.Completed;
            }

            this.expandSearchNode(fwdCurrent, true);

            // Process backward search
            const bwdCurrent = this.bwdOpenSet.dequeue()!.tile;
            if (this.fwdGScore.has(bwdCurrent)) {
                // We found a meeting point!
                this.meetingPoint = bwdCurrent;
                this.completed = true;
                return PathFindResultType.Completed;
            }

            this.expandSearchNode(bwdCurrent, false);
        }

        return this.completed ? PathFindResultType.Completed : PathFindResultType.PathNotFound;
    }

    private expandSearchNode(current: SearchNode, isForward: boolean) {
        for (const neighbor of current.neighbors()) {
            if (neighbor !== (isForward ? this.dst : this.src) && !this.canMove(neighbor)) continue;

            const gScore = isForward ? this.fwdGScore : this.bwdGScore;
            const openSet = isForward ? this.fwdOpenSet : this.bwdOpenSet;
            const cameFrom = isForward ? this.fwdCameFrom : this.bwdCameFrom;

            let tentativeGScore = gScore.get(current)! + neighbor.cost();

            if (!gScore.has(neighbor) || tentativeGScore < gScore.get(neighbor)!) {
                cameFrom.set(neighbor, current);
                gScore.set(neighbor, tentativeGScore);
                const fScore = tentativeGScore + this.heuristic(
                    neighbor,
                    isForward ? this.dst : this.src
                );
                openSet.enqueue({ tile: neighbor, fScore: fScore });
            }
        }
    }

    private heuristic(a: SearchNode, b: SearchNode): number {
        // TODO use wrapped
        try {
            return 1.1 * Math.abs(a.cell().x - b.cell().x) + Math.abs(a.cell().y - b.cell().y);
        } catch {
            console.log('uh oh')
        }
    }

    public reconstructPath(): Cell[] {
        if (!this.meetingPoint) return [];

        // Reconstruct path from start to meeting point
        const fwdPath: SearchNode[] = [this.meetingPoint];
        let current = this.meetingPoint;
        while (this.fwdCameFrom.has(current)) {
            current = this.fwdCameFrom.get(current)!;
            fwdPath.unshift(current);
        }

        // Reconstruct path from meeting point to goal
        current = this.meetingPoint;
        while (this.bwdCameFrom.has(current)) {
            current = this.bwdCameFrom.get(current)!;
            fwdPath.push(current);
        }

        return fwdPath.map(sn => sn.cell());
    }
}
