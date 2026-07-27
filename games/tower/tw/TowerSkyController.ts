// TowerSkyController.ts

import * as THREE from 'three';
import FourCornersGradientBuilder from '../game/vfx/FourCornersGradientBuilder';
import { lerpColorRgb, parseHexColor, saturateColor, shadeColor } from '../game/world/IslandStorage';

/** Seconds a level-up's sky transition takes to fully settle — see transitionTo(). */
const TRANSITION_DURATION = 1.6;
/** How much MORE saturated the top corners are than the bottom ones — see deriveTopColor(). */
const TOP_SATURATION_OFFSET = 0.35;
/**
 * How much DARKER the top corners are on top of that saturation bump — see
 * deriveTopColor(). saturateColor() alone can look identical to its input
 * once the base color is already near-maximum saturation (a vivid sky blue
 * commonly sits above 90%) — there's simply no headroom left for "more
 * saturated" to visibly move the color. Pairing it with a small, reliable
 * darken keeps the top corners visibly distinct from the bottom ones no
 * matter how saturated the level's own color already is.
 */
const TOP_DARKEN_OFFSET = 0.14;

/**
 * Degenerate 'four corners' sky (see FourCornersGradientBuilder's 'simple'
 * mode — top-left/top-right share one color, bottom-left/bottom-right share
 * another) driven by the level/island progression instead of a flat
 * THREE.Color background. Only ever built once an island whose
 * IslandConfig.skyGradient is set is reached — a plain (no-gradient) island
 * keeps using IslandViewScene's original flat scene.background, "as is".
 *
 * On every zone/level advance, the sky doesn't snap straight to the new
 * color: it eases FROM the sky's current bottom color TO the next zone's
 * bottom color, over TRANSITION_DURATION seconds, with the top corners
 * recomputed as a saturated + darkened version of the lerping bottom color
 * every frame (see deriveTopColor()) — so the transition is one continuous
 * motion with no discontinuity at its start, and the top/bottom split stays
 * consistent throughout instead of the two corners cross-fading
 * independently.
 */
export class TowerSkyController {
    private readonly gradient = new FourCornersGradientBuilder();
    private built = false;

    private fromColor = 0;
    private toColor = 0;
    /** >= TRANSITION_DURATION means "settled" — see currentBottom()/update(). */
    private elapsed = TRANSITION_DURATION;

    public isBuilt(): boolean {
        return this.built;
    }

    /** Builds the gradient sky attached to `camera`, starting flat at `baseColorHex` — no transition, since this is the first time a gradient-enabled island is reached, not a level-up crossfade. Caller should null out scene.background first (see IslandViewScene.applyLevelIsland()). */
    public build(camera: THREE.PerspectiveCamera, baseColorHex: string): void {
        const base = parseHexColor(baseColorHex);

        this.fromColor = base;
        this.toColor = base;
        this.elapsed = TRANSITION_DURATION;
        this.built = true;

        this.gradient.build({
            camera,
            mode: 'simple',
            distance: 30,
            simple: {
                bottomColor: base,
                topColor: TowerSkyController.deriveTopColor(base),
            },
        });
    }

    /**
     * Kicks off a smooth transition from the sky's current (settled or
     * mid-transition) BOTTOM color to `nextBottomColorHex` — see
     * FaceTowerGameEvents.onMilestoneReached wiring in IslandViewScene. No-op
     * before build().
     *
     * Starts from currentBottom(), not its derived (saturated/darkened) top
     * variant — starting from the top would make the very first frame of
     * the transition instantly recolor the bottom corners to that darker
     * shade before any easing even begins, reading as a hard cut followed
     * by a transition rather than one continuous motion. Since the top
     * corners are always recomputed as deriveTopColor(bottom) every frame
     * (both here and at rest — see update()), starting the bottom exactly
     * where it already is keeps the WHOLE gradient continuous at t=0.
     */
    public transitionTo(nextBottomColorHex: string): void {
        if (!this.built) {
            return;
        }

        this.fromColor = this.currentBottom();
        this.toColor = parseHexColor(nextBottomColorHex);
        this.elapsed = 0;
    }

    public update(delta: number): void {
        if (!this.built) {
            return;
        }

        this.gradient.update(delta);

        if (this.elapsed >= TRANSITION_DURATION) {
            return;
        }

        this.elapsed = Math.min(TRANSITION_DURATION, this.elapsed + delta);

        const bottom = this.currentBottom();
        const top = TowerSkyController.deriveTopColor(bottom);

        this.gradient.setSimpleColors(top, bottom);
    }

    public resize(): void {
        this.gradient.resize();
    }

    public destroy(): void {
        this.gradient.destroy();
        this.built = false;
    }

    /** The bottom color as of RIGHT NOW — `toColor` once settled, else the eased point between `fromColor` and `toColor`. */
    private currentBottom(): number {
        if (this.elapsed >= TRANSITION_DURATION) {
            return this.toColor;
        }

        const t = TowerSkyController.easeInOut(this.elapsed / TRANSITION_DURATION);
        return lerpColorRgb(this.fromColor, this.toColor, t);
    }

    private static easeInOut(t: number): number {
        return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
    }

    /** The top corners' color for a given bottom color — more saturated AND slightly darker (see TOP_DARKEN_OFFSET's doc for why saturation alone isn't reliable here). */
    private static deriveTopColor(bottomColor: number): number {
        return shadeColor(saturateColor(bottomColor, TOP_SATURATION_OFFSET), -TOP_DARKEN_OFFSET);
    }
}
