// TowerScorePopupUtils.ts

import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import type { FaceTowerBlock } from '../FaceTowerTypes';
import { getPiecePoints } from '../PieceStorage';
import { TowerVfxUtils } from '../TowerVfxUtils';
import PromiseUtils from 'core/utils/PromiseUtils';

const POP_TEXT_STYLE: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Baloo2-ExtraBold',
    fontWeight: 'bold',
    fontSize: 30,
    fill: 0xffe066,
    stroke: 0x000000,
    strokeThickness: 4,
};

export type ScreenPositionFor = (block: FaceTowerBlock) => { x: number; y: number };
export type ScoreLabelPositionGetter = () => { x: number; y: number };

/**
 * Static "zone complete" score-popup sequence — for each piece that just
 * built the completed zone (see FaceTowerGameEvents.onZoneScorePopup, the
 * sole call site via FaceTowerGameController.runZoneScorePopup), pops a 3D
 * particle burst on the piece (see TowerVfxUtils.onScorePopVfx) plus a
 * flying "+N" number that travels from the piece's own screen position to
 * the score label — one piece at a time, each only starting once the
 * previous one's travel/fade finishes, since playZoneComplete() awaits
 * popOne() inside a plain for-loop rather than firing them all at once.
 *
 * `enabled` is the flag to turn the whole thing off — playZoneComplete()
 * then just awards every block's points instantly with no visuals, so the
 * zone transition (which awaits this) is never held up.
 */
export class TowerScorePopupUtils {
    /** Set false to skip the popup animation entirely — every block's points are awarded instantly instead, and the zone transition proceeds right away. */
    public static enabled = true;

    // ── Timings — tune here ─────────────────────────────────────────────────
    /** Seconds for the initial pop-in scale bounce, right as the number appears on the piece. */
    public static popInDuration = 0.52;
    /** Seconds the number takes to travel from the piece to the score panel. */
    public static travelDuration = 0.35;
    /** Seconds for the shrink+fade-out, played AFTER the travel finishes (not during it — see popOne()). */
    public static arriveDuration = 0.1;

    /**
     * Fired once per piece, the instant its own pop actually starts (before
     * the particle burst/flying number animate) — hook a sound here. See
     * IslandViewScene.build(), the intended place to wire this.
     */
    public static onPop: ((block: FaceTowerBlock) => void) | null = null;

    private static overlayLayer: PIXI.Container | null = null;
    private static labelPositionGetter: ScoreLabelPositionGetter | null = null;

    /**
     * Call once — see IslandViewScene.build(). `overlayLayer` is the
     * screen-space container the flying number sprites get added to (e.g.
     * GameHud's own container, NOT the panned 2D world container — the
     * numbers fly in screen space toward a screen-space label);
     * `labelPositionGetter` returns the score label's current screen
     * position each time it's needed (called once per popped piece, so it
     * stays correct even if the label itself moves/resizes between calls).
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
     * Pops each of `blocks` one by one, calling `onPointsAwarded` as each
     * one lands so the score updates incrementally rather than all at once.
     * Resolves once every block has popped — or instantly, with every
     * block's points awarded up front, when disabled or build() hasn't run.
     */
    public static async playZoneComplete(
        blocks: readonly FaceTowerBlock[],
        screenPositionFor: ScreenPositionFor,
        onPointsAwarded: (points: number) => void,
    ): Promise<void> {
        if (!this.enabled || !this.overlayLayer || !this.labelPositionGetter) {
            for (const block of blocks) {
                onPointsAwarded(getPiecePoints(block.piece));
            }

            return;
        }

        for (const block of blocks) {
            void this.popOne(block, screenPositionFor(block), onPointsAwarded);
            await PromiseUtils.await(150)
        }

        await PromiseUtils.await(850)

    }

    private static popOne(
        block: FaceTowerBlock,
        start: { x: number; y: number },
        onPointsAwarded: (points: number) => void,
    ): Promise<void> {
        return new Promise(resolve => {
            const points = getPiecePoints(block.piece);

            this.onPop?.(block);
            TowerVfxUtils.onScorePopVfx(block);

            const label = new PIXI.Text(`+${points}`, POP_TEXT_STYLE);
            label.anchor.set(0.5);
            label.position.set(start.x, start.y);
            label.scale.set(0.4);
            this.overlayLayer!.addChild(label);

            const target = this.labelPositionGetter!();

            // Pop-in, THEN travel, THEN shrink+fade — the shrink/fade used
            // to run '<' (at the same TIME as the travel's own start), so
            // the label was already invisible well before it actually
            // reached the score panel. Each stage here queues after the
            // previous one finishes (gsap's default with no position arg),
            // so it stays visible for the whole trip and only fades once
            // it's actually arrived.
            gsap.timeline({
                onComplete: () => {
                    label.destroy();
                    onPointsAwarded(points);
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
