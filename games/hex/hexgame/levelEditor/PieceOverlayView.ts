import * as PIXI from "pixi.js";
import { ClusterData, HexUtils } from "../HexTypes";

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

    public setPieces(pieces: ClusterData[], selectedIndex: number): void {
        this.g.clear();

        for (let i = 0; i < pieces.length; i++) {
            const p = pieces[i];
            const alpha = (i === selectedIndex) ? 0.75 : 0.25;
            const color = p.color ?? 0xffffff;

            for (const c of p.coords) {
                const aq = p.rootPos.q + c.q; // absolute axial
                const ar = p.rootPos.r + c.r;

                //const off = LevelMatrixCodec.axialToOffset(aq, ar);
                //const pos = HexUtils.offsetToPixel(off.q, off.r);
                const pos = HexUtils.offsetToPixel(aq, ar);

                this.drawHex(pos.x, pos.y, HexUtils.HEX_SIZE, color, alpha);
            }
        }
    }

    public clear(): void {
        this.g.clear();
    }

    private drawHex(x: number, y: number, size: number, color: number, alpha: number): void {
        const pts: number[] = [];
        for (let i = 0; i < 6; i++) {
            const angle = (Math.PI / 180) * (60 * i - 30);
            pts.push(x + size * Math.cos(angle), y + size * Math.sin(angle));
        }

        this.g.beginFill(color, alpha);
        this.g.drawPolygon(pts);
        this.g.endFill();
    }
}
