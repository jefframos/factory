import ViewUtils from "@core/utils/ViewUtils";
import * as PIXI from "pixi.js";
import { getColorValueById, GridCellData, HexPos, HexUtils } from "./HexTypes";
import { ClusterView } from "./cluster/ClusterView";


export class HexGridView extends PIXI.Container {

    private readonly Z_BACKGROUND = 0;
    private readonly Z_PIECES = 10;
    private readonly Z_HINT = 100;

    // Stores the background "slots" - can be either Graphics or Sprites
    private cellGraphics: Map<string, PIXI.Graphics | PIXI.Sprite> = new Map();
    private occupiedTiles: Map<string, ClusterView> = new Map();
    private gridTexture?: PIXI.Texture;
    private hintLayer: PIXI.Container = new PIXI.Container();

    constructor() {
        super();
        this.sortableChildren = true;
    }

    /**
     * Completely rebuilds the grid for a new level.
     */
    public init(gridData: Map<string, GridCellData>, texture?: PIXI.Texture): void {
        this.gridTexture = texture;
        this.reset(); // Clear logical pieces

        // Clear visual background hexes
        this.cellGraphics.forEach(hex => hex.destroy());
        this.cellGraphics.clear();
        this.removeChildren(); // Final sweep

        // Render new grid
        this.renderGrid(gridData);
        this.calculateVisualPivot();
    }

    /**
     * Clears logic and pieces, but keeps the background grid tiles.
     */
    public reset(): void {
        this.occupiedTiles.clear();
        this.clearPreview();
        // Remove only ClusterViews, leave the background Graphics/Sprites
        this.children.forEach(child => {
            if (child instanceof ClusterView) {
                this.removeChild(child);
            }
        });
    }
    /**
     * Iterates through all ClusterViews and extracts their individual TileViews
     */
    public getAllTiles(): PIXI.Container[] {
        const allTiles: PIXI.Container[] = [];

        this.children.forEach(child => {
            if (child instanceof ClusterView) {
                // We access the internal 'tiles' array from ClusterView
                // Use (child as any) if the tiles property is private, 
                // but making it public or adding a getter is cleaner.
                const cluster = child as any;
                if (cluster.tiles) {
                    cluster.tiles.forEach((tile: PIXI.Container) => {
                        if (tile.visible) {
                            allTiles.push(tile);
                        }
                    });
                }
            }
        });

        return allTiles;
    }
    private renderGrid(gridData: Map<string, GridCellData>): void {
        gridData.forEach((cell, key) => {
            const [q, r] = key.split(',').map(Number);
            const pos = HexUtils.offsetToPixel(q, r);

            const hex = this.gridTexture
                ? new PIXI.Sprite(this.gridTexture)
                : new PIXI.Graphics();

            if (this.gridTexture) {
                // Use Sprite-based rendering
                hex.anchor.set(0.5, 0.5); // Center the sprite on the position
                hex.scale.set(ViewUtils.elementScaler(hex, HexUtils.HEX_SIZE * 2))
                hex.position.set(pos.x, pos.y); hex

                this.addChild(hex);
                this.cellGraphics.set(key, hex);
            } else {
                // Use Graphics-based rendering (original approach)
                hex.lineStyle(2, 0xFFFFFF, 0.1);
                hex.beginFill(0xFFFFFF, 0.5);

                const size = HexUtils.HEX_SIZE;
                const points = [];
                for (let i = 0; i < 6; i++) {
                    const angle = (Math.PI / 180) * (60 * i - 30);
                    points.push(pos.x + size * Math.cos(angle), pos.y + size * Math.sin(angle));
                }

                hex.drawPolygon(points);
                hex.endFill();

                this.addChild(hex);
                this.cellGraphics.set(key, hex);
            }
            hex.zIndex = this.Z_BACKGROUND; // Base layer
            this.addChild(hex);
            this.cellGraphics.set(key, hex);
        });
    }
    public getOccupantAt(q: number, r: number): ClusterView | null {
        return this.occupiedTiles.get(`${q},${r}`) || null;
    }
    // Inside HexGridView.ts

    public blinkTiles(coords: HexPos[], color: number = 0xFF00FF): any {
        const affectedHexes: { hex: PIXI.Graphics | PIXI.Sprite }[] = [];

        coords.forEach(pos => {
            const hex = this.cellGraphics.get(`${pos.q},${pos.r}`) as PIXI.Graphics | PIXI.Sprite;
            if (hex) {
                affectedHexes.push({ hex });
                hex.zIndex = this.Z_HINT; // Move to the very top
            }
        });

        this.sortChildren(); // Apply the high z-index immediately

        let count = 0;
        const intervalId = setInterval(() => {
            if (!affectedHexes.length) {
                clearInterval(intervalId);
                return;
            }

            affectedHexes.forEach(item => {
                if (item.hex && !item.hex.destroyed) {
                    item.hex.tint = (count % 2 === 0) ? color : 0xFFFFFF;
                }
            });

            count++;
            if (count > 10) {
                this.stopBlink({ interval: intervalId, affectedHexes });
            }
        }, 250);

        return { interval: intervalId, affectedHexes };
    }

    public stopBlink(hintObj: any): void {
        if (!hintObj || !hintObj.affectedHexes) return;

        if (hintObj.interval) {
            clearInterval(hintObj.interval);
        }

        hintObj.affectedHexes.forEach((item: any) => {
            if (item.hex && !item.hex.destroyed) {
                item.hex.tint = 0xFFFFFF;
                item.hex.alpha = 1;
                item.hex.zIndex = this.Z_BACKGROUND; // Move back to bottom
            }
        });

        this.sortChildren(); // Re-sort so background goes back behind pieces
        hintObj.affectedHexes = [];
    }
    private calculateVisualPivot(): void {
        if (this.cellGraphics.size === 0) return;

        let minX = Infinity;
        let maxX = -Infinity;
        let minY = Infinity;
        let maxY = -Infinity;

        // Iterate through rendered graphics/sprites to find true visual boundaries
        if (this.gridTexture) {

            this.cellGraphics.forEach((hex) => {
                // Use the hex's position directly (works for both centered sprites and polygons)
                const x = hex.x;
                const y = hex.y;

                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
            });
        } else {
            this.cellGraphics.forEach((hex) => {
                const b = hex.getBounds(true); // Get local bounds of the hex
                if (b.x < minX) minX = b.x;
                if (b.x + b.width > maxX) maxX = b.x + b.width;
                if (b.y < minY) minY = b.y;
                if (b.y + b.height > maxY) maxY = b.y + b.height;
            });
        }

        // The pivot is the mid-point of the actual rendered hexes
        const centerX = minX + (maxX - minX) / 2;
        const centerY = minY + (maxY - minY) / 2;

        this.pivot.set(centerX, centerY);
    }

    public highlight(coords: HexPos[], color: string): void {
        this.clearPreview();
        coords.forEach(pos => {
            const hex = this.cellGraphics.get(`${pos.q},${pos.r}`);
            if (hex) {
                hex.tint = getColorValueById(color);
                hex.alpha = 0.8;
            }
        });
    }

    public clearPreview(): void {
        this.cellGraphics.forEach(hex => {
            hex.tint = 0xFFFFFF;
            hex.alpha = this.gridTexture ? 1 : 1;
        });
    }

    public canFit(coords: HexPos[]): boolean {
        return coords.every(pos => {
            const key = `${pos.q},${pos.r}`;
            // Must exist in grid AND not be occupied
            return this.cellGraphics.has(key) && !this.occupiedTiles.has(key);
        });
    }

    public placePiece(piece: ClusterView, coords: HexPos[]): void {
        piece.zIndex = this.Z_PIECES; // Above background, below hint
        coords.forEach(pos => {
            this.occupiedTiles.set(`${pos.q},${pos.r}`, piece);
        });
        this.sortChildren();
    }

    public isGridFull(): boolean {
        // Check if every background cell has an entry in occupiedTiles
        return this.occupiedTiles.size === this.cellGraphics.size;
    }

    public removePiece(piece: ClusterView): void {
        const toDelete: string[] = [];
        this.occupiedTiles.forEach((p, key) => {
            if (p === piece) {
                toDelete.push(key);
            }
        });

        for (const k of toDelete) {
            this.occupiedTiles.delete(k);
        }
    }
}