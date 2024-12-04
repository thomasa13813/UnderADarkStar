import {Colord, colord, random} from "colord";
import {PlayerID, PlayerInfo, TerrainType, Tile} from "../game/Game";
import {Theme} from "./Config";
import {time} from "console";
import {PseudoRandom} from "../PseudoRandom";
import {simpleHash} from "../Util";

export const pastelTheme = new class implements Theme {
    
    private rand = new PseudoRandom(123)

    private background = colord({r: 60, g: 60, b: 60});
    private land = colord({r: 194, g: 193, b: 148});
    private shore = colord({r: 204, g: 203, b: 158});

    private water = colord({r: 75, g: 142, b: 190});
    private shorelineWater = colord({r: 100, g: 143, b: 255});

    private territoryColors: Colord[] = [
        colord({r: 230, g: 100, b: 100}), // Bright Red
        colord({r: 100, g: 180, b: 230}), // Sky Blue
        colord({r: 230, g: 180, b: 80}),  // Golden Yellow
        colord({r: 180, g: 100, b: 230}), // Purple
        colord({r: 80, g: 200, b: 120}),  // Emerald Green
        colord({r: 230, g: 130, b: 180}), // Pink
        colord({r: 100, g: 160, b: 80}),  // Olive Green
        colord({r: 230, g: 150, b: 100}), // Peach
        colord({r: 80, g: 130, b: 190}),  // Navy Blue
        colord({r: 210, g: 210, b: 100}), // Lime Yellow
        colord({r: 190, g: 100, b: 130}), // Maroon
        colord({r: 100, g: 210, b: 210}), // Turquoise
        colord({r: 210, g: 140, b: 80}),  // Light Orange
        colord({r: 150, g: 110, b: 190}), // Lavender
        colord({r: 180, g: 210, b: 120}), // Light Green
        colord({r: 210, g: 100, b: 160}), // Hot Pink
        colord({r: 100, g: 140, b: 110}), // Sea Green
        colord({r: 230, g: 180, b: 180}), // Light Pink
        colord({r: 120, g: 120, b: 190}), // Periwinkle
        colord({r: 190, g: 170, b: 100}), // Sand
        colord({r: 100, g: 180, b: 160}), // Aquamarine
        colord({r: 210, g: 160, b: 200}), // Orchid
        colord({r: 170, g: 190, b: 100}), // Yellow Green
        colord({r: 100, g: 130, b: 150}), // Steel Blue
        colord({r: 230, g: 140, b: 140}), // Salmon
        colord({r: 140, g: 180, b: 220}), // Light Blue
        colord({r: 200, g: 160, b: 110}), // Tan
        colord({r: 180, g: 130, b: 180}), // Plum
        colord({r: 130, g: 200, b: 130}), // Light Sea Green
        colord({r: 220, g: 120, b: 120}), // Coral
        colord({r: 120, g: 160, b: 200}), // Cornflower Blue
        colord({r: 200, g: 200, b: 140}), // Khaki
        colord({r: 160, g: 120, b: 160}), // Purple Gray
        colord({r: 140, g: 180, b: 140}), // Dark Sea Green
        colord({r: 200, g: 130, b: 110}), // Dark Salmon
        colord({r: 130, g: 170, b: 190}), // Cadet Blue
        colord({r: 190, g: 180, b: 160}), // Tan Gray
        colord({r: 170, g: 140, b: 190}), // Medium Purple
        colord({r: 160, g: 190, b: 160}), // Pale Green
        colord({r: 190, g: 150, b: 130}), // Rosy Brown
        colord({r: 140, g: 150, b: 180}), // Light Slate Gray
        colord({r: 180, g: 170, b: 140}), // Dark Khaki
        colord({r: 150, g: 130, b: 150}), // Thistle
        colord({r: 170, g: 190, b: 180}), // Pale Blue Green
        colord({r: 190, g: 140, b: 150}), // Puce
        colord({r: 130, g: 180, b: 170}), // Medium Aquamarine
        colord({r: 180, g: 160, b: 180}), // Mauve
        colord({r: 160, g: 180, b: 140}), // Dark Olive Green
        colord({r: 170, g: 150, b: 170}),  // Dusty Rose
        colord({r: 100, g: 180, b: 230}), // Sky Blue
        colord({r: 230, g: 180, b: 80}),  // Golden Yellow
        colord({r: 180, g: 100, b: 230}), // Purple
        colord({r: 80, g: 200, b: 120}),  // Emerald Green
        colord({r: 230, g: 130, b: 180}), // Pink
        colord({r: 100, g: 160, b: 80}),  // Olive Green
        colord({r: 230, g: 150, b: 100}), // Peach
        colord({r: 80, g: 130, b: 190}),  // Navy Blue
        colord({r: 210, g: 210, b: 100}), // Lime Yellow
        colord({r: 190, g: 100, b: 130}), // Maroon
        colord({r: 100, g: 210, b: 210}), // Turquoise
        colord({r: 210, g: 140, b: 80}),  // Light Orange
        colord({r: 150, g: 110, b: 190}), // Lavender
        colord({r: 180, g: 210, b: 120}), // Light Green
        colord({r: 210, g: 100, b: 160}), // Hot Pink
        colord({r: 100, g: 140, b: 110}), // Sea Green
        colord({r: 230, g: 180, b: 180}), // Light Pink
        colord({r: 120, g: 120, b: 190}), // Periwinkle
        colord({r: 190, g: 170, b: 100}), // Sand
        colord({r: 100, g: 180, b: 160}), // Aquamarine
        colord({r: 210, g: 160, b: 200}), // Orchid
        colord({r: 170, g: 190, b: 100}), // Yellow Green
        colord({r: 100, g: 130, b: 150}), // Steel Blue
        colord({r: 230, g: 140, b: 140}), // Salmon
        colord({r: 140, g: 180, b: 220}), // Light Blue
        colord({r: 200, g: 160, b: 110}), // Tan
        colord({r: 180, g: 130, b: 180}), // Plum
        colord({r: 130, g: 200, b: 130}), // Light Sea Green
        colord({r: 220, g: 120, b: 120}), // Coral
        colord({r: 120, g: 160, b: 200}), // Cornflower Blue
        colord({r: 200, g: 200, b: 140}), // Khaki
        colord({r: 160, g: 120, b: 160}), // Purple Gray
        colord({r: 140, g: 180, b: 140}), // Dark Sea Green
        colord({r: 200, g: 130, b: 110}), // Dark Salmon
        colord({r: 130, g: 170, b: 190}), // Cadet Blue
        colord({r: 190, g: 180, b: 160}), // Tan Gray
        colord({r: 170, g: 140, b: 190}), // Medium Purple
        colord({r: 160, g: 190, b: 160}), // Pale Green
        colord({r: 190, g: 150, b: 130}), // Rosy Brown
        colord({r: 140, g: 150, b: 180}), // Light Slate Gray
        colord({r: 180, g: 170, b: 140}), // Dark Khaki
        colord({r: 150, g: 130, b: 150}), // Thistle
        colord({r: 170, g: 190, b: 180}), // Pale Blue Green
        colord({r: 190, g: 140, b: 150}), // Puce
        colord({r: 130, g: 180, b: 170}), // Medium Aquamarine
        colord({r: 180, g: 160, b: 180}), // Mauve
        colord({r: 160, g: 180, b: 140}), // Dark Olive Green
        colord({r: 170, g: 150, b: 170})  // Dusty Rose
    ];

    playerInfoColor(id: PlayerID): Colord {
        return colord({r: 50, g: 50, b: 50})
    }

    territoryColor(playerInfo: PlayerInfo): Colord {
        return this.territoryColors[simpleHash(playerInfo.name) % this.territoryColors.length]
    }

    borderColor(playerInfo: PlayerInfo): Colord {
        const tc = this.territoryColor(playerInfo).rgba;
        return colord({
            r: Math.max(tc.r - 40, 0),
            g: Math.max(tc.g - 40, 0),
            b: Math.max(tc.b - 40, 0)
        })
    }
    defendedBorderColor(playerInfo: PlayerInfo): Colord {
        const bc = this.borderColor(playerInfo).rgba;
        return colord({
            r: Math.max(bc.r - 40, 0),
            g: Math.max(bc.g - 40, 0),
            b: Math.max(bc.b - 40, 0)
        })
    }

    terrainColor(tile: Tile): Colord {
        let mag = tile.magnitude()
        if (tile.isShore()) {
            return this.shore
        }
        switch (tile.terrain()) {
            case TerrainType.Ocean:
            case TerrainType.Lake:
                const w = this.water.rgba
                if (tile.isShorelineWater()) {
                    return this.shorelineWater
                }
                if (tile.magnitude() < 7) {
                    return colord({
                        r: Math.max(w.r - 7 + mag, 0),
                        g: Math.max(w.g - 7 + mag, 0),
                        b: Math.max(w.b - 7 + mag, 0)
                    })
                }
                return this.water
            case TerrainType.Plains:
                return colord({
                    r: 190,
                    g: 220 - 2 * mag,
                    b: 138
                })
            case TerrainType.Highland:
                return colord({
                    r: 200 + 2 * mag,
                    g: 183 + 2 * mag,
                    b: 138 + 2 * mag
                })
            case TerrainType.Mountain:
                return colord({
                    r: 230 + mag / 2,
                    g: 230 + mag / 2,
                    b: 230 + mag / 2
                })
        }
    }

    backgroundColor(): Colord {
        return this.background;
    }

    font(): string {
        return "Overpass, sans-serif";
    }
}