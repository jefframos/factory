// TowerRewardFlyUtils.ts

import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';

/** Seconds between each icon starting its flight, when count > 1 — see fly(). */
const STAGGER_DELAY = 0.08;
/** How far above the straight line from `from` to `to` the arc peaks. */
const ARC_HEIGHT = 140;
/** How far apart (px) multiple icons fan out around the arc's midpoint. */
const ARC_SPREAD = 50;

/**
 * Static, purely-cosmetic "fly N icons from A to B" helper — built for the
 * level-up popup's COLLECT flow (fly the granted powerup icon(s) from where
 * the popup shows them to their slot on the powerup belt) but deliberately
 * generic and self-contained: it doesn't touch game state, inventory
 * counts, or any other system — build()/track two screen positions, call
 * fly(), done. Doesn't reuse PowerupBelt/LevelUpNotification's own icon-
 * building code on purpose — callers just hand over a ready-made icon
 * factory each time, so this stays a drop-in visual flourish that can't
 * affect anything else even if it's wrong.
 */
export class TowerRewardFlyUtils {
    private static overlayLayer: PIXI.Container | null = null;

    /** Fired the instant an individual icon actually lands on `to` (not when its cosmetic shrink/fade tail finishes) — hook a "collected" sound here. See IslandViewScene.build(). */
    public static onArrive: (() => void) | null = null;

    /** Call once — see IslandViewScene.build(). `overlayLayer` is the screen-space container flying icons get added to (e.g. GameHud's hudContainer). */
    public static build(overlayLayer: PIXI.Container): void {
        this.overlayLayer = overlayLayer;
    }

    public static destroy(): void {
        this.overlayLayer = null;
        this.onArrive = null;
    }

    /**
     * Flies `count` copies of whatever `buildIcon()` returns from `from` to
     * `to`, each along its own gentle arc — a single icon for count 1, a
     * staggered fan of `count` icons (offset around the arc's midpoint) for
     * more, e.g. after a rewarded-video multiplier. `buildIcon` is called
     * once per icon (not shared) since each flies/dies independently.
     *
     * `from`/`to` are GLOBAL (stage-space) coordinates — e.g. straight from
     * PIXI.DisplayObject.getGlobalPosition(), same as
     * LevelUpNotification.getIconGlobalPosition()/PowerupBelt.
     * getButtonGlobalPosition() return. Converted here into overlayLayer's
     * own LOCAL space via toLocal() before use — overlayLayer sits under
     * Game.overlayContainer, which carries its own scale/offset (see
     * Game.onResize), so placing raw global pixels directly as this
     * container's local position would land wrong by however much that
     * transform differs from identity.
     */
    public static fly(
        buildIcon: () => PIXI.Container,
        from: { x: number; y: number },
        to: { x: number; y: number },
        count: number = 1,
    ): void {
        if (!this.overlayLayer || count <= 0) {
            return;
        }

        const localFrom = this.overlayLayer.toLocal(new PIXI.Point(from.x, from.y));
        const localTo = this.overlayLayer.toLocal(new PIXI.Point(to.x, to.y));

        for (let i = 0; i < count; i++) {
            gsap.delayedCall(i * STAGGER_DELAY, () => this.flyOne(buildIcon(), localFrom, localTo, i, count));
        }
    }

    private static flyOne(
        icon: PIXI.Container,
        from: { x: number; y: number },
        to: { x: number; y: number },
        index: number,
        count: number,
    ): void {
        if (!this.overlayLayer) {
            icon.destroy();
            return;
        }

        icon.position.set(from.x, from.y);
        icon.scale.set(0.5);
        icon.alpha = 1;
        this.overlayLayer.addChild(icon);

        // Multiple icons fan out around the straight-line midpoint instead
        // of all tracing the exact same arc on top of each other.
        const spread = count > 1 ? (index - (count - 1) / 2) * ARC_SPREAD : 0;
        const midX = (from.x + to.x) / 2 + spread;
        const midY = (from.y + to.y) / 2 - ARC_HEIGHT;

        const path = { t: 0 };

        gsap.timeline({
            onComplete: () => icon.destroy(),
        })
            .to(icon.scale, { x: 1, y: 1, duration: 0.15, ease: 'back.out(2)' }, 0)
            .to(path, {
                t: 1,
                duration: 0.55,
                ease: 'power1.inOut',
                onUpdate: () => {
                    const t = path.t;
                    const oneMinusT = 1 - t;

                    // Quadratic bezier through (from, mid, to) — no plugin
                    // dependency, just the standard formula.
                    icon.position.set(
                        oneMinusT * oneMinusT * from.x + 2 * oneMinusT * t * midX + t * t * to.x,
                        oneMinusT * oneMinusT * from.y + 2 * oneMinusT * t * midY + t * t * to.y,
                    );
                },
                onComplete: () => this.onArrive?.(),
            }, 0)
            .to(icon.scale, { x: 0.4, y: 0.4, duration: 0.15, ease: 'power1.in' }, '-=0.15')
            .to(icon, { alpha: 0, duration: 0.15 }, '<');
    }
}
