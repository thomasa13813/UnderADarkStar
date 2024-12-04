import { Cell, TerrainType, Tile } from "../game/Game";

export interface AStar {
    compute(): PathFindResultType
    reconstructPath(): Cell[]
}

export enum PathFindResultType {
    NextTile,
    Pending,
    Completed,
    PathNotFound
} export type TileResult = {
    type: PathFindResultType.NextTile;
    tile: Tile;
} | {
    type: PathFindResultType.Pending;
} | {
    type: PathFindResultType.Completed;
    tile: Tile;
} | {
    type: PathFindResultType.PathNotFound;
};

export interface SearchNode {
    cost(): number
    cell(): Cell
    neighbors(): SearchNode[]
    terrainType(): TerrainType
}
export interface Point {
    x: number;
    y: number;
}

