import { JigsawBuildOptions } from "games/game4/types";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { IJigsawPuzzleGenerator } from "./IJigsawPuzzleGenerator";
import { JigsawClusterManager } from "./JigsawClusterManager";
import { JigsawInputManager } from "./JigsawInputManager";
import { JigsawPiece } from "./JigsawPiece";
import { JigsawPuzzleFactory } from "./JigsawPuzzleFactory";
import { JigsawScatterUtils } from "./paths/JigsawScatterUtils";
import { PuzzlePreview } from "./ui/PuzzlePreview";
import { JigsawSnapUtils } from "./vfx/JigsawSnapUtils";

export default class JigsawView extends PIXI.Container {
    private piecesLayer: PIXI.Container = new PIXI.Container();
    private scatterRect: PIXI.Sprite = PIXI.Sprite.from(PIXI.Texture.WHITE);
    private safeRect: PIXI.TilingSprite = new PIXI.TilingSprite(PIXI.Texture.from('card-background'));
    private safeRectFrame: PIXI.NineSlicePlane = new PIXI.NineSlicePlane(PIXI.Texture.from('frame'), 40, 40, 40, 40);
    private pieces: JigsawPiece[] = [];

    private clusterManager: JigsawClusterManager;
    public input?: JigsawInputManager;

    private _stage?: PIXI.Container;
    private _snapTween?: gsap.core.Tween;
    private _safeRect?: PIXI.Rectangle;

    private targetSprite!: PIXI.Sprite;


    private _solvedOrigin: PIXI.Point = new PIXI.Point(0, 0);

    private previewPopup?: PuzzlePreview;

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
        this.targetSprite = targetSprite;
        this.piecesLayer.removeChildren();

        if (this.previewPopup) this.previewPopup.destroy();
        this.previewPopup = new PuzzlePreview(targetSprite);

        // 1. Generate pieces and clusters
        const built = JigsawPuzzleFactory.build(targetSprite.texture, generator, options);
        this.pieces = built.pieces;

        this.clusterManager.registerPieces(this.pieces);
        this.clusterManager.signals.onPieceConnected.removeAll();
        this.clusterManager.signals.onPuzzleCompleted.removeAll();
        this.clusterManager.signals.onPieceConnected.add((e) => this.onPieceConnected.dispatch(e));
        this.clusterManager.signals.onPuzzleCompleted.add((e) => this.onPuzzleCompleted.dispatch(e));

        const clusters = this.clusterManager.createInitialClusters(this.pieces);

        // 2. Setup Rects
        this._safeRect = options.safeRect
            ? options.safeRect.clone?.() ?? new PIXI.Rectangle(options.safeRect.x, options.safeRect.y, options.safeRect.width, options.safeRect.height)
            : options.scatterRect
                ? options.scatterRect.clone?.() ?? new PIXI.Rectangle(options.scatterRect.x, options.scatterRect.y, options.scatterRect.width, options.scatterRect.height)
                : undefined;

        this._solvedOrigin.set(-targetSprite.width * 0.5, -targetSprite.height * 0.5);

        // 3. Positioning Logic
        if (options.scatterRect) {
            // A. Set EVERY piece to its solved position first
            for (const p of this.pieces) {
                p.cluster.container.position.set(
                    p.definition.col * p.definition.pieceW + this._solvedOrigin.x,
                    p.definition.row * p.definition.pieceH + this._solvedOrigin.y
                );
            }

            // B. Decide which clusters to move away
            // If isFirst is true, we only scatter the last 2. Otherwise, scatter all.
            const clustersToScatter = options.isFirst ? clusters.slice(-2) : clusters;

            const items = clustersToScatter.map((c) => {
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
                candidatesPerItem: 24,
                padding: 6,
                separationMultiplier: 1.05,
                rng,
            });

            // C. Apply scattering/rotation only to chosen clusters
            for (let i = 0; i < clustersToScatter.length; i++) {
                const c = clustersToScatter[i];
                const pos = placements[i];

                if (options.allowRation) {
                    const r = i % 3;
                    for (let index = 0; index < r; index++) { c.rotateCW(); }
                }

                c.rebuildPivotFromBounds();
                const lb = c.container.getLocalBounds();
                c.container.position.set(
                    pos.x - lb.x + c.container.pivot.x,
                    pos.y - lb.y + c.container.pivot.y
                );
            }

            // D. Background/UI visibility setup
            this.setupBackgroundRects(stage, options.scatterRect);

        } else {
            // Fallback: Just put everything in solved position if no scatterRect provided
            for (const p of this.pieces) {
                p.cluster.container.position.set(
                    p.definition.col * p.definition.pieceW + this._solvedOrigin.x,
                    p.definition.row * p.definition.pieceH + this._solvedOrigin.y
                );
            }
        }

        // 4. Input Management
        this.input?.destroy();
        this.input = new JigsawInputManager(stage, this.piecesLayer, this.clusterManager);
        this.input.setSafeAreaRect(this._safeRect);
    }

    /** * Helper to keep the main function readable
     */
    private setupBackgroundRects(stage: PIXI.Container, scatterRect: PIXI.Rectangle): void {
        stage.addChildAt(this.scatterRect, 0);
        this.scatterRect.setTransform(scatterRect.x, scatterRect.y);
        this.scatterRect.width = scatterRect.width;
        this.scatterRect.height = scatterRect.height;
        this.scatterRect.alpha = 0;

        if (this._safeRect) {
            stage.addChildAt(this.safeRect, 0);
            this.safeRect.setTransform(this._safeRect.x, this._safeRect.y);
            this.safeRect.width = this._safeRect.width;
            this.scatterRect.height = this._safeRect.height;
            this.safeRect.alpha = 0;
            stage.addChildAt(this.safeRectFrame, 2);
        }
    }
    hidePreview() {
        this.previewPopup?.hide();
    }
    showPreview(): void {
        if (!this.previewPopup || !this._stage) {
            return;
        }

        //this.input?.setEnabled(false)

        // Ensure it's attached to stage
        if (this.previewPopup.parent !== this._stage) {
            this._stage.addChild(this.previewPopup);
        }
        else {
            // Move to top if already present
            this._stage.setChildIndex(
                this.previewPopup,
                this._stage.children.length - 1
            );
        }

        this.previewPopup.show();
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
                this.safeRectFrame.width = this._safeRect.width - 160
                this.safeRectFrame.height = this._safeRect.height + 5

                this.safeRectFrame.x = this._safeRect.x + 80
                this.safeRectFrame.y = this._safeRect.y - 85

                this.safeRect.x = this.safeRectFrame.x + 10;
                this.safeRect.y = this.safeRectFrame.y + 10;
                this.safeRect.width = this.safeRectFrame.width - 20;
                this.safeRect.height = this.safeRectFrame.height - 25;
                this.safeRect.alpha = 0.9;
                this.safeRect.tint = 0xFFFFFF;


                this.safeRect.visible = true;
                this.safeRectFrame.visible = true;

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
        this.previewPopup?.hide();
        this.clusterManager.dispose();
        this.piecesLayer.removeChildren()
        this.safeRect.visible = false;
        this.safeRectFrame.visible = false;
        this.pieces = [];
    }

}