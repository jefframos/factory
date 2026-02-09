import * as PIXI from "pixi.js";
import { ClusterData, getColorValueById, HexUtils } from "../HexTypes";

export class PieceOverlayView extends PIXI.Container {
    private g: PIXI.Graphics = new PIXI.Graphics();

    public constructor() {
        super();
        this.addChild(this.g);
        this.eventMode = "none"; // IMPORTANT: do not block clicks

        this.hitArea = null as any; // ensure it never participates
        this.eventMode = "none";
        this.interactiveChildren = false;

    }


    public setPieces(pieces: ClusterData[], selectedIndex: number) {
        this.g.clear();
        pieces.forEach((p, i) => {
            const alpha = (i === selectedIndex) ? 0.75 : 0.25;

            // --- THE FIX: Resolve ID to Number ---
            // If p.color is "color_6", this turns it into 0x00CED1
            const hexColor = getColorValueById(p.color);

            p.coords.forEach(c => {
                const pos = HexUtils.offsetToPixel(p.rootPos.q + c.q, p.rootPos.r + c.r);
                // Use hexColor here, NOT p.color
                this.drawHex(pos.x, pos.y, HexUtils.HEX_SIZE, hexColor, alpha);
            });
        });
    }

    private drawHex(x: number, y: number, size: number, color: number, alpha: number) {
        const pts: number[] = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 180) * (60 * i - 30);
            pts.push(x + size * Math.cos(angle), y + size * Math.sin(angle));
        }
        // PIXI now receives a valid number (color), not a string ("color_6")
        this.g.beginFill(color, alpha).drawPolygon(pts).endFill();
    }


    public clear(): void {
        this.g.clear();
    }

}
