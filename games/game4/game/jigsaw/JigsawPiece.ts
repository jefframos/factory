import { PieceDefinition } from "games/game4/types";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { JigsawCluster } from "./JigsawCluster";
import { buildJigsawPath } from "./paths/buildJigsawPath";

export class JigsawPiece extends PIXI.Container {
    public readonly definition: PieceDefinition;

    // Signals (piece does not subscribe to input events)
    public readonly onSelected: Signal = new Signal();

    private sprite: PIXI.Sprite;
    private maskGfx?: PIXI.Graphics;
    private outlineGfx?: PIXI.Graphics;
    public cluster!: JigsawCluster

    // Cached local hit rect (fast + stable)
    private hitRect: PIXI.Rectangle;

    public constructor(definition: PieceDefinition) {
        super();

        this.definition = definition;

        const e = definition.edges;
        if (![-1, 0, 1].includes(e.left) || ![-1, 0, 1].includes(e.right) ||
            ![-1, 0, 1].includes(e.top) || ![-1, 0, 1].includes(e.bottom)) {
            throw new Error(`Invalid edges for ${definition.id}: ${JSON.stringify(e)}`);
        }


        // Visuals
        this.sprite = new PIXI.Sprite(definition.texture);
        //this.sprite.position.set(definition.pad, definition.pad);
        this.sprite.position.set(definition.spriteOffsetX, definition.spriteOffsetY);

        this.addChild(this.sprite);

        if (definition.pad > 0) {
            const w = definition.pieceW;
            const h = definition.pieceH;
            const tab = definition.pad;

            const poly = buildJigsawPath(w, h, tab, definition.edges, definition.edgeVariants);

            this.maskGfx = new PIXI.Graphics()
                .beginFill(0xffffff)
                .drawPolygon(poly)
                .endFill();

            this.outlineGfx = new PIXI.Graphics()
                .lineStyle({ width: 2, color: 0xFFFFFF, alpha: 0.25 })
                //.beginFill(0xffffff, 0.25)
                .drawPolygon(poly);

            this.sprite.mask = this.maskGfx;

            this.addChildAt(this.maskGfx, 0);
            this.addChild(this.outlineGfx);

            this.cacheAsBitmap = true
        }

        // The manager will do hit-testing; we keep a stable rect that includes padding.
        const totalW = definition.pieceW + definition.pad * 2;
        const totalH = definition.pieceH + definition.pad * 2;
        this.hitRect = new PIXI.Rectangle(0, 0, totalW, totalH);

        // Important: do not set eventMode here. Input is handled by the manager.
        // (If you want hover cursor, do it in manager with custom logic.)
    }

    /** Called by the input manager when this piece is selected. */
    public notifySelected(): void {
        this.onSelected.dispatch(this);
    }

    /**
     * Manual hit test in local space (stable and fast).
     * You can swap this later for pixel-perfect / mask-aware hit testing if needed.
     */
    public hitTestGlobal(global: PIXI.IPointData): boolean {
        const local = this.toLocal(global as PIXI.Point);
        return this.hitRect.contains(local.x, local.y);
    }

    public getCoreOriginGlobal(out: PIXI.Point = new PIXI.Point()): PIXI.Point {
        // toGlobal converts local point to global
        return this.toGlobal(new PIXI.Point(this.definition.pad, this.definition.pad), out);
    }
}
