import * as PIXI from "pixi.js";
import { GridCellData, HexPos, HexUtils } from "./HexTypes";
import { ClusterView } from "./cluster/ClusterView";

export class HexGridView extends PIXI.Container {
    // Stores the background "slots"
    private cellGraphics: Map<string, PIXI.Graphics> = new Map();
    // Stores which pieces are currently locked into the grid
    private occupiedTiles: Map<string, ClusterView> = new Map();

    constructor(gridData: Map<string, GridCellData>, bounds: PIXI.Rectangle) {
        super();
        this.pivot.set(bounds.width / 2 - (HexUtils.WIDTH / 2), bounds.height / 2 - (HexUtils.HEIGHT / 2));
        this.renderGrid(gridData);
        this.calculateVisualPivot();
    }

    private renderGrid(gridData: Map<string, GridCellData>): void {
        gridData.forEach((cell, key) => {
            const [q, r] = key.split(',').map(Number);
            const pos = HexUtils.offsetToPixel(q, r);

            const hex = new PIXI.Graphics();
            hex.lineStyle(2, 0xFFFFFF, 0.1);
            hex.beginFill(0xFFFFFF, 0.05);

            const size = HexUtils.HEX_SIZE;
            const points = [];
            for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 180) * (60 * i - 30);
                points.push(pos.x + size * Math.cos(angle), pos.y + size * Math.sin(angle));
            }

            hex.drawPolygon(points);
            hex.endFill();

            this.addChild(hex);
            // Store the graphic using the "q,r" key for quick lookup
            this.cellGraphics.set(key, hex);
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

        // Iterate through rendered graphics to find true visual boundaries
        this.cellGraphics.forEach((hex) => {
            const b = hex.getBounds(true); // Get local bounds of the hex
            if (b.x < minX) minX = b.x;
            if (b.x + b.width > maxX) maxX = b.x + b.width;
            if (b.y < minY) minY = b.y;
            if (b.y + b.height > maxY) maxY = b.y + b.height;
        });

        // The pivot is the mid-point of the actual rendered hexes
        const centerX = minX + (maxX - minX) / 2;
        const centerY = minY + (maxY - minY) / 2;

        this.pivot.set(centerX, centerY);
    }

    public highlight(coords: HexPos[], color: number): void {
        this.clearPreview();
        coords.forEach(pos => {
            const hex = this.cellGraphics.get(`${pos.q},${pos.r}`);
            if (hex) {
                hex.tint = color;
                hex.alpha = 0.6;
            }
        });
    }

    public clearPreview(): void {
        this.cellGraphics.forEach(hex => {
            hex.tint = 0xFFFFFF;
            hex.alpha = 1;
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