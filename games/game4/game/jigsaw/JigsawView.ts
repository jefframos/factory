import { JigsawBuildOptions } from "games/game4/types";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { IJigsawPuzzleGenerator } from "./IJigsawPuzzleGenerator";
import { JigsawClusterManager } from "./JigsawClusterManager";
import { JigsawInputManager } from "./JigsawInputManager";
import { JigsawPiece } from "./JigsawPiece";
import { JigsawPuzzleFactory } from "./JigsawPuzzleFactory";
import { JigsawScatterUtils } from "./paths/JigsawScatterUtils";
import { JigsawSnapUtils } from "./vfx/JigsawSnapUtils";

export default class JigsawView extends PIXI.Container {
    private piecesLayer: PIXI.Container = new PIXI.Container();
    private scatterRect: PIXI.Sprite = PIXI.Sprite.from(PIXI.Texture.WHITE);
    private safeRect: PIXI.Sprite = PIXI.Sprite.from(PIXI.Texture.WHITE);
    private pieces: JigsawPiece[] = [];

    private clusterManager: JigsawClusterManager;
    public input?: JigsawInputManager;

    private _stage?: PIXI.Container;
    private _snapTween?: gsap.core.Tween;
    private _safeRect?: PIXI.Rectangle;


    private _solvedOrigin: PIXI.Point = new PIXI.Point(0, 0);

    public readonly onPieceConnected: Signal = new Signal();
    public readonly onPuzzleCompleted: Signal = new Signal();

    public constructor() {
        super();
        this.addChild(this.piecesLayer);

        this.clusterManager = new JigsawClusterManager(this.piecesLayer);
    }
    private rectEquals(a: PIXI.Rectangle, b: PIXI.Rectangle): boolean {
        return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
    }

    public buildFromSprite(
        stage: PIXI.Container,
        targetSprite: PIXI.Sprite,
        generator: IJigsawPuzzleGenerator,
        options: JigsawBuildOptions
    ): void {
        this._stage = stage;

        this.piecesLayer.removeChildren();
        this.pieces = [];

        const built = JigsawPuzzleFactory.build(targetSprite.texture, generator, options);
        this.pieces = built.pieces;

        this.clusterManager.registerPieces(this.pieces);

        this.clusterManager.signals.onPieceConnected.removeAll();
        this.clusterManager.signals.onPuzzleCompleted.removeAll();

        this.clusterManager.signals.onPieceConnected.add((e) => this.onPieceConnected.dispatch(e));
        this.clusterManager.signals.onPuzzleCompleted.add((e) => this.onPuzzleCompleted.dispatch(e));

        const clusters = this.clusterManager.createInitialClusters(this.pieces);

        this._safeRect = options.safeRect
            ? options.safeRect.clone?.() ?? new PIXI.Rectangle(options.safeRect.x, options.safeRect.y, options.safeRect.width, options.safeRect.height)
            : options.scatterRect
                ? options.scatterRect.clone?.() ?? new PIXI.Rectangle(options.scatterRect.x, options.scatterRect.y, options.scatterRect.width, options.scatterRect.height)
                : undefined;

        if (options.scatterRect) {
            if (options.scatterRect) {
                // Build items list (use LOCAL bounds, not container.width/height)
                const items = clusters.map((c) => {
                    c.rebuildPivotFromBounds();
                    const lb = c.container.getLocalBounds();

                    return {
                        id: c.id,
                        width: Math.max(1, lb.width),
                        height: Math.max(1, lb.height),
                    };
                });

                const rng = JigsawScatterUtils.createSeededRng((Date.now() & 0xffffffff) >>> 0);

                const placements = JigsawScatterUtils.computeBlueNoisePlacements({
                    scatterRect: options.scatterRect,
                    items,
                    candidatesPerItem: 24,        // good default
                    padding: 6,                   // small margin
                    separationMultiplier: 1.05,   // slightly more spread
                    rng,
                });

                for (let i = 0; i < clusters.length; i++) {
                    const c = clusters[i];

                    const lb = c.container.getLocalBounds();
                    const pos = placements[i];

                    if (options.allowRation) {
                        const r = Math.floor(Math.random() * 4)
                        for (let index = 0; index < r; index++) {
                            c.rotateCW()
                        }
                    }

                    // Place so bounds top-left matches placement top-left
                    c.container.position.set(
                        pos.x - lb.x + c.container.pivot.x,
                        pos.y - lb.y + c.container.pivot.y
                    );

                    if (this._safeRect) {
                        this.clampClusterToSafeRect(c.container, this._safeRect);
                    }
                }


                stage.addChildAt(this.scatterRect, 0);

                this.scatterRect.x = options.scatterRect.x;
                this.scatterRect.y = options.scatterRect.y;
                this.scatterRect.width = options.scatterRect.width;
                this.scatterRect.height = options.scatterRect.height;
                this.scatterRect.alpha = 0.1;
            }


            stage.addChildAt(this.scatterRect, 0);
            stage.addChildAt(this.safeRect, 0);

            this.scatterRect.x = options.scatterRect.x;
            this.scatterRect.y = options.scatterRect.y;
            this.scatterRect.width = options.scatterRect.width;
            this.scatterRect.height = options.scatterRect.height;
            this.scatterRect.alpha = 0.1;

            if (this._safeRect) {
                this.safeRect.x = this._safeRect.x;
                this.safeRect.y = this._safeRect.y;
                this.safeRect.width = this._safeRect.width;
                this.safeRect.height = this._safeRect.height;
                this.safeRect.alpha = 0.1;
                this.safeRect.tint = 0xFF0000;
            }
        } else {
            for (const p of this.pieces) {
                p.cluster.container.position.set(
                    p.definition.col * p.definition.pieceW - targetSprite.width / 2,
                    p.definition.row * p.definition.pieceH - targetSprite.height / 2
                );
            }
        }

        this._solvedOrigin.set(-targetSprite.width * 0.5, -targetSprite.height * 0.5);

        this.input?.destroy();
        this.input = new JigsawInputManager(stage, this.piecesLayer, this.clusterManager);

        // Send safe area to input. If undefined, input will not clamp.
        this.input.setSafeAreaRect(this._safeRect);
    }

    updateSafeAre(x: number, y: number, width: number, height: number) {
        if (!this._safeRect) {
            return;
        }
        if (this._safeRect.x !== x || this._safeRect.y !== y || this._safeRect.width !== width || this._safeRect.height !== height) {
            this._safeRect.x = x;
            this._safeRect.y = y;
            this._safeRect.width = width;
            this._safeRect.height = height;

            if (this._safeRect) {
                this.safeRect.x = this._safeRect.x;
                this.safeRect.y = this._safeRect.y;
                this.safeRect.width = this._safeRect.width;
                this.safeRect.height = this._safeRect.height;
                this.safeRect.alpha = 0.1;
                this.safeRect.tint = 0xFF0000;
            }

            this.input?.setSafeAreaRect(this._safeRect);

        }
    }
    private clampClusterToSafeRect(clusterContainer: PIXI.Container, safeRect: PIXI.Rectangle): void {
        // Clamp using the cluster's bounds in piecesLayer local space
        const b = clusterContainer.getBounds();

        // Convert bounds top-left from global to piecesLayer local
        // (b is global). We want to clamp in piecesLayer space, where clusterContainer.x/y lives.
        const tlLocal = this.piecesLayer.toLocal(new PIXI.Point(b.x, b.y));
        const brLocal = this.piecesLayer.toLocal(new PIXI.Point(b.x + b.width, b.y + b.height));

        const minX = safeRect.x;
        const minY = safeRect.y;
        const maxX = safeRect.x + safeRect.width;
        const maxY = safeRect.y + safeRect.height;

        const overflowLeft = minX - tlLocal.x;
        const overflowTop = minY - tlLocal.y;
        const overflowRight = brLocal.x - maxX;
        const overflowBottom = brLocal.y - maxY;

        let dx = 0;
        let dy = 0;

        if (overflowLeft > 0) dx += overflowLeft;
        if (overflowRight > 0) dx -= overflowRight;
        if (overflowTop > 0) dy += overflowTop;
        if (overflowBottom > 0) dy -= overflowBottom;

        if (dx !== 0 || dy !== 0) {
            clusterContainer.position.set(clusterContainer.x + dx, clusterContainer.y + dy);
        }
    }

    public async snapCompletedPuzzleToSolvedPose(opts?: {
        duration?: number;
        ease?: string;
    }): Promise<void> {
        await JigsawSnapUtils.tweenClusterToSolvedPose({
            piecesLayer: this.piecesLayer,
            pieces: this.pieces,
            solvedOrigin: this._solvedOrigin,
            duration: opts?.duration,
            ease: opts?.ease,
            killTweensForTarget: true,
        });
    }

    public dispose() {
        this.clusterManager.dispose();
        this.piecesLayer.removeChildren()
        this.pieces = [];
    }

}