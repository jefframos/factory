import * as PIXI from 'pixi.js';
import { Signal } from 'signals';

/**
 * Alternative to the virtual joystick (see AnalogInput): rather than reading
 * a fixed drag vector, this just remembers where the pointer/finger
 * currently is, in raw CSS-pixel space (matching ThreeScene.worldToScreen).
 * The caller recomputes a follow direction against the player's current
 * on-screen position every frame, since that position drifts under camera
 * follow independent of any pointer event — there is deliberately no onMove
 * signal here.
 *
 * Movement only starts on an explicit tap/click, not on hover alone: Pixi
 * replays the last real pointer position as a synthetic document-level
 * pointermove on every idle tick (see @pixi/events EventsTicker.update()),
 * so honoring hover-only movement made the character lurch toward wherever
 * the pointer last happened to be (e.g. a "Tap to Start" button) the instant
 * this got (re-)enabled. Requiring a real pointerdown to begin sidesteps that
 * entirely, since Pixi never synthesizes pointerdown. Once started, plain
 * pointer movement (no held button needed) keeps steering — only the pointer
 * being *down* is tied to the boost.
 */
export default class PointerFollowInput {
    /** Fires whenever the held-boost state flips — active for exactly as long as the pointer/finger stays down (click or tap), not a fixed duration. */
    public onBoostChange: Signal<{ active: boolean }> = new Signal();

    private container: PIXI.Container;
    private latest: { x: number; y: number } | null = null;
    /** True once the first tap/click has started movement — see class doc. Before that, getPointerPosition() reports null and pointermove is ignored. */
    private tracking = false;
    private pointerDown = false;

    constructor(container: PIXI.Container) {
        this.container = container;
        this.container.eventMode = 'static';
        this.container.on('pointermove', this.onPointerMove);
        this.container.on('pointerdown', this.onPointerDown);
        this.container.on('pointerup', this.onPointerUp);
        this.container.on('pointerupoutside', this.onPointerUp);
        // Safety nets for a release Pixi's own pointerup/pointerupoutside
        // handling can miss — e.g. the button is released after the cursor
        // has been dragged outside the browser window entirely (no DOM event
        // fires there at all), or the tab/window loses focus mid-press.
        // Without these the boost would otherwise get stuck on forever.
        window.addEventListener('blur', this.onWindowBlur);
    }

    private onPointerMove = (e: PIXI.FederatedPointerEvent) => {
        if (!this.tracking) return;
        // e.buttons reflects the CURRENT physical button state regardless of
        // whether we ever saw the matching pointerup — catches the
        // released-outside-the-window case as soon as the pointer wanders
        // back over the game with the button no longer held.
        if (this.pointerDown && (e.buttons & 1) === 0) this.releaseBoost();
        this.latest = { x: e.clientX, y: e.clientY };
    };

    private onPointerDown = (e: PIXI.FederatedPointerEvent) => {
        this.tracking = true;
        this.latest = { x: e.clientX, y: e.clientY };
        this.pointerDown = true;
        this.onBoostChange.dispatch({ active: true });
    };

    private onPointerUp = () => {
        this.releaseBoost();
    };

    private onWindowBlur = () => {
        this.releaseBoost();
    };

    private releaseBoost(): void {
        if (!this.pointerDown) return;
        this.pointerDown = false;
        this.onBoostChange.dispatch({ active: false });
    }

    /** Latest known pointer position in raw CSS-pixel space, or null before the first tap/click since the last enable (see class doc). */
    public getPointerPosition(): { x: number; y: number } | null {
        return this.latest;
    }

    /** Disables/re-enables tracking — e.g. while the boot menu is up. Resets everything so re-enabling later doesn't cause an instant lurch, and force-releases an in-progress hold so disabling mid-press can't leave the boost stuck on. */
    public setEnabled(enabled: boolean): void {
        this.container.eventMode = enabled ? 'static' : 'none';
        if (!enabled) {
            this.latest = null;
            this.tracking = false;
            this.releaseBoost();
        }
    }

    public destroy(): void {
        this.container.off('pointermove', this.onPointerMove);
        this.container.off('pointerdown', this.onPointerDown);
        this.container.off('pointerup', this.onPointerUp);
        this.container.off('pointerupoutside', this.onPointerUp);
        window.removeEventListener('blur', this.onWindowBlur);
    }
}
