import ViewUtils from "@core/utils/ViewUtils";
import * as PIXI from "pixi.js";
import { getColorValueById, GridCellData, HexPos, HexUtils } from "./HexTypes";
import { ClusterView } from "./cluster/ClusterView";

export class HexGridView extends PIXI.Container {
    // Stores the background "slots" - can be either Graphics or Sprites
    private cellGraphics: Map<string, PIXI.Graphics | PIXI.Sprite> = new Map();
    private occupiedTiles: Map<string, ClusterView> = new Map();
    private gridTexture?: PIXI.Texture;

    constructor() {
        super();
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

    private renderGrid(gridData: Map<string, GridCellData>): void {
        gridData.forEach((cell, key) => {
            const [q, r] = key.split(',').map(Number);
            const pos = HexUtils.offsetToPixel(q, r);

            if (this.gridTexture) {
                // Use Sprite-based rendering
                const sprite = new PIXI.Sprite(this.gridTexture);
                sprite.anchor.set(0.5, 0.5); // Center the sprite on the position
                sprite.scale.set(ViewUtils.elementScaler(sprite, HexUtils.HEX_SIZE * 2))
                sprite.position.set(pos.x, pos.y);

                this.addChild(sprite);
                this.cellGraphics.set(key, sprite);
            } else {
                // Use Graphics-based rendering (original approach)
                const hex = new PIXI.Graphics();
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
        });
    }
    public getOccupantAt(q: number, r: number): ClusterView | null {
        return this.occupiedTiles.get(`${q},${r}`) || null;
    }

    public blinkTiles(coords: HexPos[], color: number = 0x00AAFF): void {
        coords.forEach(pos => {
            const hex = this.cellGraphics.get(`${pos.q},${pos.r}`);
            if (!hex) return;

            // Simple blink animation using PIXI.Ticker or a timeout loop
            let count = 0;
            const interval = setInterval(() => {
                hex.tint = (count % 2 === 0) ? color : 0xFFFFFF;
                hex.alpha = (count % 2 === 0) ? 0.8 : 1;
                count++;
                if (count > 5) {
                    clearInterval(interval);
                    hex.tint = 0xFFFFFF;
                    hex.alpha = 1;
                }
            }, 200);
        });
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
                hex.alpha = 0.6;
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
        coords.forEach(pos => {
            this.occupiedTiles.set(`${pos.q},${pos.r}`, piece);
        });
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