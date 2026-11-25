import * as PIXI from 'pixi.js';
import { Signal } from 'signals';

export default class AnalogInput {
    public onMove: Signal<{ direction: PIXI.Point; magnitude: number }> = new Signal();

    private container: PIXI.Container;
    private bg: PIXI.DisplayObject;
    private knob: PIXI.DisplayObject;
    private radius: number;
    private center = new PIXI.Point();
    private active = false;
    /**
     * Which pointer (finger) is actually driving the stick — checked in
     * onPointerMove/onPointerUp so a second, unrelated pointer (e.g. a finger
     * on a DOM control stacked over the canvas, like a mobile boost button)
     * can't feed or end an already-active drag just because some event of
     * its own reached this container. `active` alone was never enough to
     * guarantee that: it's a single flag with no notion of *whose* touch set
     * it, so any pointer event landing back inside the (whole-screen) hitArea
     * was treated as continuing the current drag regardless of pointerId.
     */
    private activePointerId: number | null = null;
    /** It's a finger driving it (not a mouse). */
    private byTouch = false;
    /** See setExclusionZone. */
    private exclusionZone: ((clientX: number, clientY: number) => boolean) | null = null;

    constructor(
        container: PIXI.Container,
        options?: {
            radius?: number;
            backgroundTexture?: PIXI.Texture;
            knobTexture?: PIXI.Texture;
        }
    ) {
        this.container = container;
        this.radius = options?.radius ?? 50;

        // Background
        if (options?.backgroundTexture) {
            const sprite = new PIXI.Sprite(options.backgroundTexture);
            sprite.anchor.set(0.5);
            sprite.visible = false;
            sprite.width = sprite.height = this.radius * 2;
            this.bg = sprite;
        } else {
            const graphics = new PIXI.Graphics();
            graphics.beginFill(0x000000, 0.3);
            graphics.drawCircle(0, 0, this.radius);
            graphics.endFill();
            graphics.visible = false;
            this.bg = graphics;
        }
        this.container.addChild(this.bg);

        // Knob
        if (options?.knobTexture) {
            const sprite = new PIXI.Sprite(options.knobTexture);
            sprite.anchor.set(0.5);
            sprite.visible = false;
            sprite.width = sprite.height = this.radius * 0.8;
            this.knob = sprite;
        } else {
            const graphics = new PIXI.Graphics();
            graphics.beginFill(0xffffff, 0.6);
            graphics.drawCircle(0, 0, 20);
            graphics.endFill();
            graphics.visible = false;
            this.knob = graphics;
        }
        this.container.addChild(this.knob);

        this.container.eventMode = 'static';
        this.container.on('pointerdown', this.onPointerDown);
        this.container.on('pointerup', this.onPointerUp);
        this.container.on('pointerupoutside', this.onPointerUp);
        this.container.on('pointermove', this.onPointerMove);
        // Pixi only hears of a release over the page: a finger sliding off the screen's edge is cancelled by the browser
        // (or just gone), which it doesn't pass on. Caught here, so the stick never stays pushed.
        window.addEventListener('pointerup', this.onNativeEnd, true);
        window.addEventListener('pointercancel', this.onNativeEnd, true);
        window.addEventListener('touchend', this.onTouchEnd, true);
        window.addEventListener('touchcancel', this.onTouchEnd, true);
        window.addEventListener('blur', this.release);
        document.addEventListener('visibilitychange', this.onHidden);
    }

    /** The finger (or mouse) driving the stick let go, or was taken by the browser (an edge swipe). */
    private readonly onNativeEnd = (e: PointerEvent): void => {
        if (this.active && e.pointerId === this.activePointerId) this.release();
    };

    /** No finger's left on the screen: whichever drove the stick is gone too. */
    private readonly onTouchEnd = (e: TouchEvent): void => {
        if (this.active && this.byTouch && e.touches.length === 0) this.release();
    };

    private readonly onHidden = (): void => {
        if (document.hidden) this.release();
    };

    /** Lets go of the stick. */
    private readonly release = (): void => {
        if (!this.active) return;
        this.active = false;
        this.activePointerId = null;
        this.bg.visible = false;
        this.knob.visible = false;
        this.onMove.dispatch({ direction: new PIXI.Point(0, 0), magnitude: 0 });
    };

    private onPointerDown = (e: PIXI.FederatedPointerEvent) => {
        // Bail before touching any state — a second finger landing on a DOM
        // control stacked over the canvas (e.g. a mobile boost button) would
        // otherwise still hit this handler (the joystick's hitArea covers the
        // whole screen so it can float to wherever the player first touches)
        // and re-center/hijack an already-active drag from the first finger.
        // Checked only on the initial touch-down, not every subsequent move —
        // a drag that's already running shouldn't be interrupted just
        // because the finger crosses over the excluded area mid-gesture.
        if (this.exclusionZone?.(e.clientX, e.clientY)) return;
        // A drag is already running under a different finger — ignore a
        // second pointer's down entirely rather than re-centering onto it.
        // (Unless it's the only one down: the first one's end was never heard of.)
        if (this.active && e.pointerId !== this.activePointerId && !e.isPrimary) return;

        const globalPos = new PIXI.Point(e.global.x, e.global.y);
        const local = this.container.toLocal(globalPos);

        this.active = true;
        this.activePointerId = e.pointerId;
        this.byTouch = e.pointerType === 'touch';
        this.center.copyFrom(local);
        this.bg.position.copyFrom(this.center);
        this.knob.position.copyFrom(this.center);
        this.bg.visible = true;
        this.knob.visible = true;
    };

    private onPointerMove = (e: PIXI.FederatedPointerEvent) => {
        if (!this.active || e.pointerId !== this.activePointerId) return;
        // (A mouse let go of outside the window comes back with no button down.)
        if (e.pointerType === 'mouse' && e.buttons === 0) {
            this.release();
            return;
        }

        const globalPos = new PIXI.Point(e.global.x, e.global.y);
        const local = this.container.toLocal(globalPos);

        const dx = local.x - this.center.x;
        const dy = local.y - this.center.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx);

        const clampedDist = Math.min(this.radius, dist);
        const norm = clampedDist / this.radius;
        const direction = new PIXI.Point(Math.cos(angle), Math.sin(angle));

        this.knob.position.set(
            this.center.x + direction.x * clampedDist,
            this.center.y + direction.y * clampedDist
        );

        this.onMove.dispatch({ direction, magnitude: norm });
    };

    private onPointerUp = (e: PIXI.FederatedPointerEvent) => {
        // Some other pointer releasing (e.g. the boost button's finger,
        // if any of its events even reach this far) shouldn't end a drag
        // that's actually being driven by a different, still-down finger.
        if (this.active && e.pointerId !== this.activePointerId) return;
        this.release();
    };

    /**
     * Registers a screen-space (raw CSS-pixel, i.e. PointerEvent.clientX/Y)
     * dead zone — any pointerdown landing inside it is ignored entirely
     * instead of starting/re-centering the joystick. For carving out a DOM
     * control (e.g. a boost button) that sits visually on top of the canvas
     * but shares its underlying huge hitArea. Pass null to clear.
     */
    public setExclusionZone(check: ((clientX: number, clientY: number) => boolean) | null): void {
        this.exclusionZone = check;
    }

    /** Disables/re-enables the touch drag area — e.g. while the boot menu is up and there's no live player to move yet. Force-hides and resets an in-progress drag so disabling mid-touch can't leave the graphic stuck visible. */
    public setEnabled(enabled: boolean): void {
        this.container.eventMode = enabled ? 'static' : 'none';
        if (!enabled) this.release();
    }

    public destroy() {
        this.container.off('pointerdown', this.onPointerDown);
        this.container.off('pointerup', this.onPointerUp);
        this.container.off('pointerupoutside', this.onPointerUp);
        this.container.off('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onNativeEnd, true);
        window.removeEventListener('pointercancel', this.onNativeEnd, true);
        window.removeEventListener('touchend', this.onTouchEnd, true);
        window.removeEventListener('touchcancel', this.onTouchEnd, true);
        window.removeEventListener('blur', this.release);
        document.removeEventListener('visibilitychange', this.onHidden);
        this.bg.destroy();
        this.knob.destroy();
    }
}
