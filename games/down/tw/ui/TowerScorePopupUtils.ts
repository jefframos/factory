// TowerScorePopupUtils.ts

import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';

const POP_TEXT_STYLE: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Baloo2-ExtraBold',
    fontWeight: 'bold',
    fontSize: 30,
    fill: 0xffe066,
    stroke: 0x000000,
    strokeThickness: 4,
};

export type ScoreLabelPositionGetter = () => { x: number; y: number };

/**
 * Flying "+N" score-popup — pops from a raw screen position (see popAt())
 * to the score label, purely cosmetic: score itself is already applied by
 * FaceTowerGameController.handleMerge() the instant the merge resolves, so
 * this never gates or defers it (unlike the old zone-popup flow, which
 * awaited a whole sequence of these before advancing any game state).
 *
 * `enabled` is the flag to turn the whole thing off — popAt() then just
 * resolves immediately with no visuals.
 */
export class TowerScorePopupUtils {
    /** Set false to skip the popup animation entirely. */
    public static enabled = true;

    // ── Timings — tune here ─────────────────────────────────────────────────
    /** Seconds for the initial pop-in scale bounce, right as the number appears. */
    public static popInDuration = 0.52;
    /** Seconds the number takes to travel from its start position to the score panel. */
    public static travelDuration = 0.35;
    /** Seconds for the shrink+fade-out, played AFTER the travel finishes (not during it — see popAt()). */
    public static arriveDuration = 0.1;

    /** Fired once per pop, the instant it actually starts — hook a sound here. See IslandViewScene.build(), the intended place to wire this. */
    public static onPop: (() => void) | null = null;

    private static overlayLayer: PIXI.Container | null = null;
    private static labelPositionGetter: ScoreLabelPositionGetter | null = null;

    /**
     * Call once — see IslandViewScene.build(). `overlayLayer` is the
     * screen-space container the flying number sprites get added to (e.g.
     * GameHud's own container, NOT the panned 2D world container — the
     * numbers fly in screen space toward a screen-space label);
     * `labelPositionGetter` returns the score label's current screen
     * position each time it's needed (called once per pop, so it stays
     * correct even if the label itself moves/resizes between calls).
     */
    public static build(overlayLayer: PIXI.Container, labelPositionGetter: ScoreLabelPositionGetter): void {
        this.overlayLayer = overlayLayer;
        this.labelPositionGetter = labelPositionGetter;
    }

    public static destroy(): void {
        this.overlayLayer = null;
        this.labelPositionGetter = null;
        this.onPop = null;
    }

    /**
     * Pops a "+N" flying number from `start` (a raw screen position — no
     * block required, since a top-tier + top-tier merge despawns both
     * pieces with nothing left to anchor a popup to) to the score label.
     * No-ops (resolves immediately) if disabled or build() hasn't run.
     */
    public static popAt(start: { x: number; y: number }, points: number): Promise<void> {
        if (!this.enabled || !this.overlayLayer || !this.labelPositionGetter) {
            return Promise.resolve();
        }

        this.onPop?.();

        return new Promise(resolve => {
            const label = new PIXI.Text(`+${points}`, POP_TEXT_STYLE);
            label.anchor.set(0.5);
            label.position.set(start.x, start.y);
            label.scale.set(0.4);
            this.overlayLayer!.addChild(label);

            const target = this.labelPositionGetter!();

            // Pop-in, THEN travel, THEN shrink+fade — each stage queues
            // after the previous one finishes (gsap's default with no
            // position arg), so it stays visible for the whole trip and
            // only fades once it's actually arrived.
            gsap.timeline({
                onComplete: () => {
                    label.destroy();
                    resolve();
                },
            })
                .to(label.scale, { x: 1.2, y: 1.2, duration: this.popInDuration, ease: 'back.out(3)' })
                .to(label, {
                    x: target.x,
                    y: target.y,
                    duration: this.travelDuration,
                    ease: 'power2.in',
                })
                .to(label.scale, { x: 0.3, y: 0.3, duration: this.arriveDuration })
                .to(label, { alpha: 0, duration: this.arriveDuration }, '<');
        });
    }
}
