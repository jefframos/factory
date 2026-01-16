import { JigsawBuildOptions } from "games/game4/types";
import gsap from "gsap";
import * as PIXI from "pixi.js";
import { Signal } from "signals";
import { IJigsawPuzzleGenerator } from "./IJigsawPuzzleGenerator";
import { JigsawCluster } from "./JigsawCluster";
import { JigsawClusterManager } from "./JigsawClusterManager";
import { JigsawInputManager } from "./JigsawInputManager";
import { JigsawPiece } from "./JigsawPiece";
import { JigsawPuzzleFactory } from "./JigsawPuzzleFactory";

export default class JigsawView extends PIXI.Container {
    private piecesLayer: PIXI.Container = new PIXI.Container();
    private scatterRect: PIXI.Sprite = PIXI.Sprite.from(PIXI.Texture.WHITE);
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

        this.clusterManager.signals.onPieceConnected.add((e) => this.onPieceConnected.dispatch(e));
        this.clusterManager.signals.onPuzzleCompleted.add((e) => this.onPuzzleCompleted.dispatch(e));

        const clusters = this.clusterManager.createInitialClusters(this.pieces);

        // Safe area selection:
        // - If user specified safeRect, use it
        // - Else if scatterRect exists, safeRect defaults to scatterRect
        // - Else no safe rect (undefined)
        this._safeRect = options.safeRect
            ? options.safeRect.clone?.() ?? new PIXI.Rectangle(options.safeRect.x, options.safeRect.y, options.safeRect.width, options.safeRect.height)
            : options.scatterRect
                ? options.scatterRect.clone?.() ?? new PIXI.Rectangle(options.scatterRect.x, options.scatterRect.y, options.scatterRect.width, options.scatterRect.height)
                : undefined;

        if (options.scatterRect) {
            for (const c of clusters) {
                c.container.position.set(
                    options.scatterRect.x + Math.random() * (options.scatterRect.width - c.container.width),
                    options.scatterRect.y + Math.random() * (options.scatterRect.height - c.container.height)
                );

                // Ensure initial scatter respects safe rect too (if safeRect differs from scatterRect).
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
        const duration = opts?.duration ?? 0.7;
        const ease = opts?.ease ?? "power3.out";

        if (this.pieces.length === 0) {
            return;
        }

        // 1) Pick winning cluster (largest by piece count)
        const clusterToCount = new Map<JigsawCluster, number>();
        for (const p of this.pieces) {
            clusterToCount.set(p.cluster, (clusterToCount.get(p.cluster) ?? 0) + 1);
        }

        let winner: JigsawCluster | null = null;
        let best = -1;

        for (const [c, count] of clusterToCount.entries()) {
            if (count > best) {
                best = count;
                winner = c;
            }
        }

        if (!winner) {

            return;
        }

        const winnerContainer = winner.container;

        // 2) Choose an anchor piece inside the winner cluster.
        // Prefer the true top-left (row=0,col=0). If not found, take smallest (row,col).
        let anchor: JigsawPiece | null = null;

        for (const p of this.pieces) {
            if (p.cluster !== winner) {
                continue;
            }
            if (p.definition.row === 0 && p.definition.col === 0) {
                anchor = p;
                break;
            }
            if (!anchor) {
                anchor = p;
            } else {
                const a = anchor.definition;
                const d = p.definition;
                if (d.row < a.row || (d.row === a.row && d.col < a.col)) {
                    anchor = p;
                }
            }
        }

        if (!anchor) {

            return;
        }

        // 3) Compute where the anchor piece SHOULD be in piecesLayer local space in solved layout
        // Solved position of a piece's origin:
        // x = solvedOrigin.x + col * pieceW
        // y = solvedOrigin.y + row * pieceH
        const pieceW = anchor.definition.pieceW;
        const pieceH = anchor.definition.pieceH;

        const desiredAnchorLocal = new PIXI.Point(
            this._solvedOrigin.x + anchor.definition.col * pieceW,
            this._solvedOrigin.y + anchor.definition.row * pieceH
        );

        // 4) Compute where the anchor piece currently is in piecesLayer local space
        // Use global -> piecesLayer local conversion to avoid merge-order/local-origin issues.
        const currentAnchorGlobal = anchor.getGlobalPosition(new PIXI.Point(), false);
        const currentAnchorLocal = this.piecesLayer.toLocal(currentAnchorGlobal);

        // 5) Delta needed to move the whole winner cluster so the anchor lands exactly on desired solved position
        const dx = desiredAnchorLocal.x - currentAnchorLocal.x;
        const dy = desiredAnchorLocal.y - currentAnchorLocal.y;

        await new Promise<void>((resolve) => {
            gsap.to(winnerContainer.position, {
                x: winnerContainer.position.x + dx,
                y: winnerContainer.position.y + dy,
                duration,
                ease,
                onComplete: () => resolve(),
                onInterrupt: () => resolve(),
            });
        });


    }
}