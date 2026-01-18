import * as PIXI from "pixi.js";
import { JigsawPiece } from "./JigsawPiece";
import { shortestDeltaRad } from "./vfx/JigsawMergeUtils";

let _clusterId = 0;
const RAD90 = Math.PI * 0.5;

export type QuarterTurns = 0 | 1 | 2 | 3;

export class JigsawCluster {
    public readonly id: number = ++_clusterId;
    public readonly container: PIXI.Container = new PIXI.Container();
    public readonly debugContainer: PIXI.Container = new PIXI.Container();
    public readonly pieces: Set<JigsawPiece> = new Set();

    private _rotationQ: QuarterTurns = 0;
    public set rotationQ(value: QuarterTurns) {
        this._rotationQ = value;

        this._rotationQ = (this._rotationQ % 4 + 4) % 4
    }

    public get rotationQ() {
        return this._rotationQ
    }

    // If you want to block rotate during drags, your input system can set this.
    public isHeld: boolean = false;

    // Cache pivot center in local space (recomputed when cluster content changes)
    private _pivotLocal: PIXI.Point = new PIXI.Point(0, 0);

    public addPiece(piece: JigsawPiece): void {
        this.pieces.add(piece);
        piece.cluster = this;
        this.container.addChild(piece);


        // const text = new PIXI.Text(piece.definition.col + '/' + piece.definition.row)
        // this.debugContainer.addChild(text);
        // text.style.fill = 0xFFffff
        // text.style.stroke = 0//0xFF0000
        // text.style.strokeThickness = 8



        // if (piece.definition.edges.top) {
        //     const textBottom = new PIXI.Text(piece.definition.edges.top)
        //     this.debugContainer.addChild(textBottom);
        //     textBottom.style.fill = 0xFFffff
        //     textBottom.style.stroke = 0xFF0000
        //     textBottom.style.strokeThickness = 8
        //     textBottom.x = piece.definition.pieceW / 2
        // }

        // if (piece.definition.edges.left) {
        //     const textBottom = new PIXI.Text(piece.definition.edges.left)
        //     this.debugContainer.addChild(textBottom);
        //     textBottom.style.fill = 0xFFffff
        //     textBottom.style.stroke = 0xFF0000
        //     textBottom.style.strokeThickness = 8
        //     textBottom.x = 0
        //     textBottom.y = piece.definition.pieceH / 2
        // }

        // if (piece.definition.edges.right) {
        //     const textBottom = new PIXI.Text(piece.definition.edges.right)
        //     this.debugContainer.addChild(textBottom);
        //     textBottom.style.fill = 0xFFffff
        //     textBottom.style.stroke = 0xFF0000
        //     textBottom.style.strokeThickness = 8
        //     textBottom.x = piece.definition.pieceW
        //     textBottom.y = piece.definition.pieceH / 2
        // }

        // if (piece.definition.edges.bottom) {
        //     const textBottom = new PIXI.Text(piece.definition.edges.bottom)
        //     this.debugContainer.addChild(textBottom);
        //     textBottom.style.fill = 0xFFffff
        //     textBottom.style.stroke = 0xFF0000
        //     textBottom.style.strokeThickness = 8
        //     textBottom.x = piece.definition.pieceW / 2
        //     textBottom.y = piece.definition.pieceH
        // }


        // this.textRot = new PIXI.Text(this.rotationQ)
        // this.debugContainer.addChild(this.textRot);
        // this.textRot.style.fill = 0xFFffff
        // this.textRot.style.stroke = 0xFF00ff
        // this.textRot.style.strokeThickness = 8
        // this.textRot.x = piece.definition.pieceW / 2
        // this.textRot.y = piece.definition.pieceH / 2
        this.rebuildPivotFromBounds();
    }
    private textRot!: PIXI.Text;
    /**
     * Rotate 90deg clockwise around the cluster's visual center,
     * keeping the cluster's world position stable (no "jump" on tap).
     */
    public rotateCW(): void {
        const parent = this.container.parent;
        if (!parent) {
            this.rotationQ = (((this.rotationQ + 1) & 3) as QuarterTurns);
            this.container.rotation = this.rotationQ * RAD90;

            if (this.textRot) this.textRot.text = this.rotationQ
            return;
        }

        // Ensure pivot is right before rotation
        this.rebuildPivotFromBounds();

        const pivotWorldBefore = this.container.toGlobal(this.container.pivot.clone());

        this.rotationQ = (((this.rotationQ + 1) & 3) as QuarterTurns);
        if (this.textRot) this.textRot.text = this.rotationQ
        this.container.rotation = this.rotationQ * RAD90;

        const pivotWorldAfter = this.container.toGlobal(this.container.pivot.clone());

        this.container.position.x += (pivotWorldBefore.x - pivotWorldAfter.x);
        this.container.position.y += (pivotWorldBefore.y - pivotWorldAfter.y);
    }
    public async rotateCW_Tween(durationMs: number = 140): Promise<void> {
        const parent = this.container.parent;
        if (!parent) {
            this.rotateCW();
            return;
        }

        this.rebuildPivotFromBounds();

        const c = this.container;

        // ---- CONFIG (tweak freely) ----
        const jumpHeight = 10;      // pixels up
        const scaleUp = 1.06;       // scale pop
        const bounce = 4;           // small overshoot on landing
        const rotEase = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
        const jumpEaseUp = (t: number) => t * t;               // easeIn
        const jumpEaseDown = (t: number) => 1 - Math.pow(1 - t, 2); // easeOut
        // --------------------------------

        // Preserve pivot world position during rotation
        const pivotWorld = c.toGlobal(c.pivot.clone());

        const startRot = c.rotation;
        const startY = c.y;
        const startScale = c.scale.x; // assume uniform scale

        const startQ = this.rotationQ;
        const endQ = (((startQ + 1) & 3) as QuarterTurns);
        const targetRot = endQ * RAD90;

        // Shortest angular delta
        const dRot = shortestDeltaRad(startRot, targetRot);

        await new Promise<void>((resolve) => {
            const d = Math.max(1, durationMs);
            const t0 = performance.now();

            const tick = () => {
                const t1 = performance.now();
                const t = Math.min(1, (t1 - t0) / d);

                // ---- ROTATION ----
                const kr = rotEase(t);
                c.rotation = startRot + dRot * kr;

                // ---- JUMP PROFILE ----
                let yOffset = 0;
                let s = 1;

                if (t < 0.5) {
                    // Going up
                    const u = jumpEaseUp(t / 0.5);
                    yOffset = -jumpHeight * u;
                    s = 1 + (scaleUp - 1) * u;
                }
                else {
                    // Falling + small bounce
                    const u = jumpEaseDown((t - 0.5) / 0.5);
                    yOffset = -jumpHeight * (1 - u) + Math.sin(u * Math.PI) * bounce;
                    s = scaleUp - (scaleUp - 1) * u;
                }

                c.y = startY + yOffset;
                c.scale.set(startScale * s);

                // ---- KEEP PIVOT WORLD-LOCKED ----
                const pivotAfter = c.toGlobal(c.pivot.clone());
                c.position.x += (pivotWorld.x - pivotAfter.x);
                c.position.y += (pivotWorld.y - pivotAfter.y);

                if (t < 1) {
                    requestAnimationFrame(tick);
                }
                else {
                    resolve();
                }
            };

            requestAnimationFrame(tick);
        });

        // ---- SNAP TO CLEAN FINAL STATE ----
        this.rotationQ = endQ;
        if (this.textRot) this.textRot.text = this.rotationQ
        c.rotation = targetRot;
        c.scale.set(startScale);
        c.y = startY;

        const pivotFinal = c.toGlobal(c.pivot.clone());
        c.position.x += (pivotWorld.x - pivotFinal.x);
        c.position.y += (pivotWorld.y - pivotFinal.y);
    }



    /**
   * Recomputes a stable rotation center:
   * - Uses local bounds of container contents.
   * - Sets container.pivot to bounds center.
   * - Tracks pivot in _pivotLocal for world-stable rotation logic.
   *
   * Call after:
   * - add/remove piece
   * - merge clusters
   * - any operation that changes visuals/layout
   */
    public rebuildPivotFromBounds(): void {
        const parent = this.container.parent;

        // Preserve the container's local origin (0,0) in world space.
        // This makes pivot changes not "teleport" the cluster.
        let originWorldBefore: PIXI.Point | null = null;

        if (parent) {
            originWorldBefore = this.container.toGlobal(new PIXI.Point(0, 0));
        }

        const b = this.container.getLocalBounds();
        const cx = b.x + b.width * 0.5;
        const cy = b.y + b.height * 0.5;

        this._pivotLocal.set(cx, cy);

        this.container.pivot.set(cx, cy);

        if (parent && originWorldBefore) {
            const originWorldAfter = this.container.toGlobal(new PIXI.Point(0, 0));
            this.container.position.x += (originWorldBefore.x - originWorldAfter.x);
            this.container.position.y += (originWorldBefore.y - originWorldAfter.y);
        }
    }



}