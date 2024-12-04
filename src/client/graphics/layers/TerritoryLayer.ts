import { PriorityQueue } from "@datastructures-js/priority-queue";
import { Cell, Game, Player, Tile, TileEvent, UnitEvent, UnitType } from "../../../core/game/Game";
import { PseudoRandom } from "../../../core/PseudoRandom";
import { colord, Colord } from "colord";
import { bfs, dist } from "../../../core/Util";
import { Theme } from "../../../core/configuration/Config";
import { Layer } from "./Layer";
import { TransformHandler } from "../TransformHandler";
import { EventBus } from "../../../core/EventBus";

export class TerritoryLayer implements Layer {
    private canvas: HTMLCanvasElement
    private context: CanvasRenderingContext2D
    private imageData: ImageData

    private tileToRenderQueue: PriorityQueue<{ tile: Tile, lastUpdate: number }> = new PriorityQueue((a, b) => { return a.lastUpdate - b.lastUpdate })
    private random = new PseudoRandom(123)
    private theme: Theme = null

    constructor(private game: Game, eventBus: EventBus) {
        this.theme = game.config().theme()
        eventBus.on(TileEvent, e => this.tileUpdate(e))
    }

    shouldTransform(): boolean {
        return true
    }

    tick() {
    }

    init(game: Game) {
        this.canvas = document.createElement('canvas');
        this.context = this.canvas.getContext("2d")

        this.imageData = this.context.getImageData(0, 0, this.game.width(), this.game.height())
        this.initImageData()
        this.canvas.width = this.game.width();
        this.canvas.height = this.game.height();
        this.context.putImageData(this.imageData, 0, 0);
    }

    initImageData() {
        this.game.forEachTile((tile) => {
            const index = (tile.cell().y * this.game.width()) + tile.cell().x
            const offset = index * 4
            this.imageData.data[offset + 3] = 0
        })
    }

    renderLayer(context: CanvasRenderingContext2D) {
        this.renderTerritory()
        this.context.putImageData(this.imageData, 0, 0);
        context.drawImage(
            this.canvas,
            -this.game.width() / 2,
            -this.game.height() / 2,
            this.game.width(),
            this.game.height()
        )
    }

    renderTerritory() {
        let numToRender = Math.floor(this.tileToRenderQueue.size() / 10)
        if (numToRender == 0) {
            numToRender = this.tileToRenderQueue.size()
        }

        while (numToRender > 0) {
            numToRender--
            const tile = this.tileToRenderQueue.pop().tile
            this.paintTerritory(tile)
            tile.neighbors().forEach(t => this.paintTerritory(t))
        }
    }

    paintTerritory(tile: Tile) {
        if (!tile.hasOwner()) {
            this.clearCell(tile.cell())
            return
        }
        const owner = tile.owner() as Player
        if (tile.isBorder()) {
            if (tile.defenseBonuses().filter(db => db.unit.owner() == owner).length > 0) {
                this.paintCell(
                    tile.cell(),
                    this.theme.defendedBorderColor(owner.info()),
                    255
                )
            } else {
                this.paintCell(
                    tile.cell(),
                    this.theme.borderColor(owner.info()),
                    255
                )
            }
        } else {
            this.paintCell(
                tile.cell(),
                this.theme.territoryColor(owner.info()),
                110
            )
        }
    }

    paintCell(cell: Cell, color: Colord, alpha: number) {
        const index = (cell.y * this.game.width()) + cell.x
        const offset = index * 4
        this.imageData.data[offset] = color.rgba.r;
        this.imageData.data[offset + 1] = color.rgba.g;
        this.imageData.data[offset + 2] = color.rgba.b;
        this.imageData.data[offset + 3] = alpha
    }

    clearCell(cell: Cell) {
        const index = (cell.y * this.game.width()) + cell.x;
        const offset = index * 4;
        this.imageData.data[offset + 3] = 0; // Set alpha to 0 (fully transparent)
    }

    unitEvent(event: UnitEvent) {
        if (event.unit.type() == UnitType.DefensePost) {
            bfs(
                event.unit.tile(),
                dist(event.unit.tile(), this.game.config().defensePostRange())
            ).forEach(t => {
                if (t.isBorder()) {
                    this.enqueue(t)
                }
            })
        }
    }

    tileUpdate(event: TileEvent) {
        this.enqueue(event.tile)
    }

    enqueue(tile: Tile) {
        this.tileToRenderQueue.push({ tile: tile, lastUpdate: this.game.ticks() + this.random.nextFloat(0, .5) })
    }
}