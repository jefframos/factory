import gsap from "gsap";
import * as PIXI from "pixi.js";
import { ClusterView } from "../cluster/ClusterView";
import HexAssets from "../HexAssets";
import { HexGameMediator } from "../HexGameMediator";
import { HexUtils } from "../HexTypes";

export enum FTUEMode {
    FIRST_TIME = "first-time",
}

export class FTUEService {
    private handCursor: PIXI.Sprite;
    private activePiece?: ClusterView;
    private ghostPiece?: PIXI.Container;
    private animationTimeline?: gsap.core.Timeline;

    constructor(private mediator: HexGameMediator) {
        this.handCursor = new PIXI.Sprite(PIXI.Texture.from(HexAssets.Textures.Icons.Finger));
        this.handCursor.anchor.set(0.5, 0.1);
        this.handCursor.visible = false;
        this.handCursor.zIndex = 2000; // High Z-Index

        this.mediator.gameRoot.addChild(this.handCursor);
    }

    public async startFTUE(mode: FTUEMode): Promise<void> {
        this.stop(); // Always clear previous state
        if (mode === FTUEMode.FIRST_TIME) {
            await this.runFirstTimeSequence();
        }
    }

    private async runFirstTimeSequence(): Promise<void> {
        const pieces = this.mediator.clusterManager.getPieces();
        if (pieces.length === 0) return;

        this.mediator.setInputEnabled(false);
        this.activePiece = pieces[0];

        // 1. Create Ghost and setup initial state
        this.ghostPiece = this.activePiece.cloneVisual();
        this.mediator.gameRoot.addChild(this.ghostPiece);
        this.mediator.gameRoot.addChild(this.handCursor);

        // 2. Calculate Positions in gameRoot space
        const startGlobal = this.activePiece.getGlobalPosition();
        const startPos = this.mediator.gameRoot.toLocal(startGlobal);

        // Get target global from Grid logic
        const targetGridPixel = HexUtils.offsetToPixel(
            this.activePiece.data.rootPos.q,
            this.activePiece.data.rootPos.r
        );
        const targetGlobal = this.mediator.gridView.toGlobal(targetGridPixel);
        const endPos = this.mediator.gameRoot.toLocal(targetGlobal);

        // 3. Align Ghost to the real piece's current state
        this.ghostPiece.position.copyFrom(startPos);
        // Important: Match the world scale (the tray/manager scale)
        const worldScale = this.activePiece.worldTransform.decompose(new PIXI.Transform()).scale;
        this.ghostPiece.scale.copyFrom(worldScale);
        this.ghostPiece.alpha = 0;

        this.handCursor.position.copyFrom(startPos);
        this.handCursor.alpha = 0;
        this.handCursor.visible = true;

        const b = this.ghostPiece.getBounds()

        this.handCursor.pivot.x = -b.width / 2
        this.handCursor.pivot.y = -b.height / 2

        // 4. Animation Timeline
        this.animationTimeline = gsap.timeline({ repeat: -1, repeatDelay: 1 });

        this.animationTimeline
            .set([this.handCursor, this.ghostPiece], {
                x: startPos.x,
                y: startPos.y,
                alpha: 0
            })
            .set([this.handCursor.scale, this.ghostPiece.scale], {
                x: worldScale.x,
                y: worldScale.y
            })
            .to([this.handCursor, this.ghostPiece], { alpha: 1, duration: 0.3 })
            // Visual "Pick up" effect: slightly scale up the ghost and hand
            .to([this.handCursor.scale, this.ghostPiece.scale], {
                x: worldScale.x * 1.1,
                y: worldScale.y * 1.1,
                duration: 0.2
            })
            .to(this.handCursor, {
                x: endPos.x,
                y: endPos.y,
                duration: 2.0,
                ease: "power1.inOut",
                onUpdate: () => {
                    // Sync ghost position with hand cursor
                    if (this.ghostPiece) {
                        this.ghostPiece.x = this.handCursor.x;
                        this.ghostPiece.y = this.handCursor.y;
                    }
                    this.syncHighlight();
                }
            })
            .to([this.handCursor, this.ghostPiece], { alpha: 0, duration: 0.3, delay: 0.5 });
    }

    private syncHighlight(): void {
        if (!this.ghostPiece || !this.activePiece) return;

        // Convert ghost position to Grid Local space to calculate "fake" snapping
        const ghostGlobal = this.ghostPiece.getGlobalPosition();
        const gridLocal = this.mediator.gridView.toLocal(ghostGlobal);

        // Use the mediator's internal grid math (accessed via casting or helper)
        const r = Math.round(gridLocal.y / HexUtils.VERTICAL_SPACING);
        const isOdd = r % 2 !== 0;
        const xOffset = isOdd ? (HexUtils.WIDTH / 2) : 0;
        const q = Math.round((gridLocal.x - xOffset) / HexUtils.WIDTH);

        // If ghost is near the correct spot, highlight the grid
        if (q === this.activePiece.data.rootPos.q && r === this.activePiece.data.rootPos.r) {
            const snappedCoords = this.activePiece.data.coords.map(c => ({
                q: q + c.q,
                r: r + c.r
            }));
            //this.mediator.gridView.highlight(snappedCoords, this.activePiece.data.color);
        } else {
            //this.mediator.gridView.clearPreview();
        }
    }

    public stop(): void {
        this.animationTimeline?.kill();
        if (this.ghostPiece) {
            this.ghostPiece.destroy({ children: true });
            this.ghostPiece = undefined;
        }
        this.handCursor.visible = false;
        //this.mediator.gridView.clearPreview();
        //this.mediator.setInputEnabled(true);
    }

    public update(delta: number) { }
}