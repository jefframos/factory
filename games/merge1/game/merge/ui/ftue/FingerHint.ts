import ViewUtils from "@core/utils/ViewUtils";
import * as PIXI from "pixi.js";

export type FingerMode = "hidden" | "hover" | "drag";

export class FingerHint extends PIXI.Container {
    private readonly finger: PIXI.Sprite;

    private mode: FingerMode = "hidden";

    // --- Hover params ---
    private hoverBasePos: PIXI.Point = new PIXI.Point();
    private hoverTime: number = 0;

    private hoverBobAmp: number = 10;
    private hoverBobSpeed: number = 3.5;
    private hoverPulseAmp: number = 0.05;
    private hoverPulseSpeed: number = 3.0;

    // --- Drag params ---
    private dragFrom: PIXI.Point = new PIXI.Point();
    private dragTo: PIXI.Point = new PIXI.Point();

    private dragTime: number = 0;
    private dragDuration: number = 2; // seconds for a full A->B travel
    private dragPause: number = 0.15;   // pause at ends (seconds)
    private dragPhase: number = 0;      // accumulates in seconds

    // Derived each update
    private dragTotalCycle: number = 0;

    public constructor(texture: PIXI.Texture) {
        super();

        this.finger = new PIXI.Sprite(texture);
        this.addChild(this.finger);

        this.finger.anchor.set(-0.1, -0.1);
        this.finger.scale.set(ViewUtils.elementScaler(this.finger, 100))

        this.visible = false;
        this.alpha = 0;
        this.scale.set(1);
    }

    public hide(immediate: boolean = true): void {
        this.mode = "hidden";
        if (immediate) {
            this.visible = false;
            this.alpha = 0;
        }
    }
    public getMode(): FingerMode {
        return this.mode;
    }

    public ensureHover(basePos: PIXI.Point): void {
        if (!this.visible || this.mode !== "hover" || this.alpha <= 0.001) {
            this.showHover(basePos);
        } else {
            this.setHoverBase(basePos);
        }
    }

    public ensureDragLoop(from: PIXI.Point, to: PIXI.Point, durationSec: number, pauseSec: number): void {
        if (!this.visible || this.mode !== "drag" || this.alpha <= 0.001) {
            this.showDragLoop(from, to, durationSec, pauseSec);
        } else {
            this.setDragTargets(from, to);
        }
    }

    public showHover(basePos: PIXI.Point): void {
        this.mode = "hover";
        this.visible = true;
        this.alpha = 1;

        this.hoverBasePos.copyFrom(basePos);
        this.hoverTime = 0;

        this.position.copyFrom(basePos);
        this.scale.set(1);
    }

    public showDragLoop(from: PIXI.Point, to: PIXI.Point, durationSec: number = 0.8, pauseSec: number = 0.15): void {
        this.mode = "drag";
        this.visible = true;
        this.alpha = 1;

        this.dragFrom.copyFrom(from);
        this.dragTo.copyFrom(to);

        this.dragDuration = Math.max(0.2, durationSec);
        this.dragPause = Math.max(0, pauseSec);

        this.dragPhase = 0;
        this.dragTotalCycle = this.dragPause + this.dragDuration + this.dragPause; // pause + travel + pause

        this.position.copyFrom(from);
        this.scale.set(1);
    }

    /**
     * Update dynamic targets (used when entities move while we animate)
     */
    public setDragTargets(from: PIXI.Point, to: PIXI.Point): void {
        this.dragFrom.copyFrom(from);
        this.dragTo.copyFrom(to);
    }

    public setHoverBase(basePos: PIXI.Point): void {
        this.hoverBasePos.copyFrom(basePos);
    }

    public update(deltaSeconds: number): void {
        if (!this.visible) return;

        if (this.mode === "hover") {
            this.hoverTime += deltaSeconds;

            const bob = Math.sin(this.hoverTime * this.hoverBobSpeed) * this.hoverBobAmp;
            const pulse = 1.0 + (Math.sin(this.hoverTime * this.hoverPulseSpeed) * this.hoverPulseAmp);

            this.position.set(this.hoverBasePos.x, this.hoverBasePos.y + bob);
            this.scale.set(pulse);

            return;
        }

        if (this.mode === "drag") {
            // Deterministic loop in [0..cycle)
            this.dragPhase += deltaSeconds;

            if (this.dragTotalCycle <= 0) {
                this.dragTotalCycle = this.dragPause + this.dragDuration + this.dragPause;
            }

            // Wrap
            while (this.dragPhase >= this.dragTotalCycle) {
                this.dragPhase -= this.dragTotalCycle;
            }

            // Map phase -> normalized t across travel portion
            // [0..pause) -> at start
            // [pause..pause+travel) -> lerp
            // [pause+travel..end) -> at end
            const p = this.dragPhase;

            let t: number = 0;

            if (p < this.dragPause) {
                t = 0;
            } else if (p < this.dragPause + this.dragDuration) {
                t = (p - this.dragPause) / this.dragDuration;
            } else {
                t = 1;
            }

            // Smoothstep for nicer motion, still deterministic
            t = t * t * (3 - 2 * t);

            const x = this.dragFrom.x + (this.dragTo.x - this.dragFrom.x) * t;
            const y = this.dragFrom.y + (this.dragTo.y - this.dragFrom.y) * t;

            this.position.set(x, y);

            // Optional: tiny press effect near start/end
            const press = 1.0 - (0.05 * (1.0 - Math.abs(2 * t - 1.0))); // smallest in middle
            this.scale.set(press);

            return;
        }
    }
}
