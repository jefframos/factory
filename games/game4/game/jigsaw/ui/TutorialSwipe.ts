import * as PIXI from "pixi.js";
import { JigsawCluster } from "./JigsawCluster";

export interface TutorialSwipeConfig {
    handTexturePath: string;
    /** Speed in pixels per second */
    velocity: number;
    /** Time to wait on the piece before moving (ms) */
    pauseAtStart: number;
    /** Delay before restarting the loop after reaching the target (ms) */
    repeatDelay: number;
    originOffset?: PIXI.IPointData;
    targetOffset?: PIXI.IPointData;
}

enum TutorialState {
    WAITING_START,
    MOVING,
    WAITING_END
}

export default class TutorialSwipe extends PIXI.Container {
    private handSprite!: PIXI.Sprite;
    private config: Required<TutorialSwipeConfig>;

    private originCluster: JigsawCluster | null = null;
    private targetCluster: JigsawCluster | null = null;

    private state: TutorialState = TutorialState.WAITING_START;
    private stateTimer = 0;
    private currentPos = new PIXI.Point();
    private isVisible = false;

    constructor(config: TutorialSwipeConfig) {
        super();
        this.config = {
            originOffset: { x: 0, y: 0 },
            targetOffset: { x: 0, y: 0 },
            ...config
        };
        this.init();
    }

    private async init() {
        this.handSprite = PIXI.Sprite.from(this.config.handTexturePath);
        this.handSprite.anchor.set(0.5, 0.2);
        this.handSprite.alpha = 0;
        this.addChild(this.handSprite);
    }

    public setGuidance(origin: JigsawCluster, target: JigsawCluster) {
        this.originCluster = origin;
        this.targetCluster = target;
        this.isVisible = true;
        this.resetLoop();
    }

    private resetLoop() {
        this.state = TutorialState.WAITING_START;
        this.stateTimer = 0;
        if (this.originCluster) {
            const start = this.getClusterCenter(this.originCluster, this.config.originOffset);
            this.currentPos.copyFrom(start);
        }
    }

    public update(delta: number) {
        if (!this.isVisible || !this.originCluster || !this.targetCluster || !this.handSprite) return;

        const dt = PIXI.Ticker.shared.deltaMS;
        const startPos = this.getClusterCenter(this.originCluster, this.config.originOffset);
        const endPos = this.getClusterCenter(this.targetCluster, this.config.targetOffset);

        switch (this.state) {
            case TutorialState.WAITING_START:
                this.stateTimer += dt;
                this.currentPos.copyFrom(startPos);
                // Fade in during the wait
                this.handSprite.alpha = Math.min(1, this.stateTimer / 200);
                // Scale pulse to show "touching"
                this.handSprite.scale.set(1 - Math.sin(this.stateTimer * 0.01) * 0.1);

                if (this.stateTimer >= this.config.pauseAtStart) {
                    this.state = TutorialState.MOVING;
                }
                break;

            case TutorialState.MOVING:
                const dx = endPos.x - this.currentPos.x;
                const dy = endPos.y - this.currentPos.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                // Constant velocity movement
                const moveDist = (this.config.velocity) * dt;

                if (dist <= moveDist) {
                    this.currentPos.copyFrom(endPos);
                    this.state = TutorialState.WAITING_END;
                    this.stateTimer = 0;
                } else {
                    this.currentPos.x += (dx / dist) * moveDist;
                    this.currentPos.y += (dy / dist) * moveDist;
                }
                this.handSprite.scale.set(1);
                break;

            case TutorialState.WAITING_END:
                this.stateTimer += dt;
                // Fade out
                this.handSprite.alpha = Math.max(0, 1 - this.stateTimer / 300);

                if (this.stateTimer >= this.config.repeatDelay) {
                    this.resetLoop();
                }
                break;
        }

        this.handSprite.position.copyFrom(this.currentPos);
    }

    private getClusterCenter(cluster: JigsawCluster, offset: PIXI.IPointData): PIXI.Point {
        const bounds = cluster.container.getLocalBounds();
        const centerX = cluster.container.x + (bounds.x + bounds.width / 2) - cluster.container.pivot.x;
        const centerY = cluster.container.y + (bounds.y + bounds.height / 2) - cluster.container.pivot.y;
        return new PIXI.Point(centerX + offset.x, centerY + offset.y);
    }
}