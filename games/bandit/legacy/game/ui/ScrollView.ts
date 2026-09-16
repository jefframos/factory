// ScrollView.ts
//
// Generic vertical drag-to-scroll clip region — wraps an existing content
// container (`target`) inside a fixed `width` x `height` viewport, masks
// away anything outside it, and lets a drag anywhere within that viewport
// scroll `target` between its natural top (y=0) and the point its own
// bottom edge reaches the viewport's bottom edge.
//
// Gesture detection is done at the NATIVE window level (pointerdown/move/up),
// not through Pixi's own hit-tested events — see onNativePointerDown()'s own
// doc for why: Pixi only ever delivers a pointerdown to the SINGLE topmost
// interactive object at that pixel, so a plain "transparent grip sprite
// behind the content" (this file's own earlier shape) silently never sees a
// drag that happens to START on top of a real button (a Buy/Sell/Craft row
// action, ...) — exactly the rows this kind of list most often has. Tracking
// natively instead means a drag can start ANYWHERE in the viewport,
// regardless of what's visually underneath the pointer.
//
// That same "started on top of a button" case creates a second problem once
// scrolling actually works: if the gesture ends with the pointer resting
// back over a button (very likely — the content just moved under a
// stationary finger), that button would otherwise receive a spurious tap on
// release, even though the player was scrolling, not tapping. The instant a
// drag is CONFIRMED (DRAG_MOVE_THRESHOLD crossed, or held past
// DRAG_HOLD_THRESHOLD_SEC without releasing), `target.interactiveChildren`
// is set false for the rest of that gesture — this disables hit-testing for
// EVERY interactive descendant of `target` in one shot, so no button inside
// it can receive pointerup/pointertap at all while it's off, regardless of
// where the pointer ends up. Restored the instant the gesture ends
// (stopDragging()). Deliberately NOT the "add a transparent layer on top
// and let Pixi's own down/up target-matching mismatch" trick this file used
// to use — that relies on EventBoundary's own ancestor-walking algorithm
// doing what its source implies, which turned out not to reliably suppress
// the tap in practice; toggling interactiveChildren is a single documented
// Pixi flag with no such assumption baked in.
//
// A visible scrollbar (thin track + thumb, right edge of the viewport)
// shows/hides itself based on whether there's anything to scroll at all —
// see refresh()'s own doc — so a player can tell a section scrolls before
// ever touching it, not just discover it by accidentally dragging.
//
// A no-op whenever `target`'s own measured height is <= the viewport
// height — see refresh()'s own doc. Vertical-only for now: every current
// caller (InventoryPopup's tab body) only ever overflows downward, never
// sideways, so horizontal scrolling isn't built until something actually
// needs it.
//
// Doesn't own `target`'s own content — the caller builds/rebuilds whatever
// lives inside it and calls refresh() afterward; nothing here watches for
// content changes automatically, same "caller re-measures after it changes
// something" convention AutoFitFrame.fit()/Popup.refitFrame() already use.

import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';

export interface ScrollViewOptions {
    /** The content to scroll — reparented under this ScrollView (added as its own child, masked and vertically repositioned by it). The caller still owns building/rebuilding whatever's INSIDE it, and must call refresh() after doing so. */
    target: PIXI.Container;
    /** Viewport size — content outside this rect (relative to the ScrollView's own origin) is clipped, not just visually hidden. */
    width: number;
    height: number;
}

/** How far a single mouse-wheel notch moves the content — desktop convenience alongside touch/click-drag (see this file's own top doc: "should work touch and mouse"). */
const WHEEL_STEP = 60;
const SCROLLBAR_WIDTH = 7;
/** Gap between the scrollbar and the viewport's own right edge. */
const SCROLLBAR_MARGIN = -8;
const SCROLLBAR_TRACK_COLOR = 0xffffff;
const SCROLLBAR_TRACK_ALPHA = 0.12;
const SCROLLBAR_THUMB_COLOR = 0xffffff;
const SCROLLBAR_THUMB_ALPHA = 0.5;
/** A thumb never renders shorter than this, however small the viewport-to-content ratio gets — a sliver a few px tall stops reading as a thumb at all. */
const SCROLLBAR_MIN_THUMB_HEIGHT = 28;

/** How far (px, in ScrollView-local space) the pointer has to move from its own down position before a gesture counts as a genuine drag rather than a tap — see this file's own top doc. */
const DRAG_MOVE_THRESHOLD = 6;
/** How long (sec) the pointer can stay down without crossing DRAG_MOVE_THRESHOLD before the gesture STILL counts as a drag — catches a slow, barely-moving press that has clearly stopped being a quick tap. Either condition (moved far enough, or held long enough) is enough — see onNativePointerMove(). */
const DRAG_HOLD_THRESHOLD_SEC = 0.2;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export default class ScrollView extends PIXI.Container {
    private readonly target: PIXI.Container;
    private readonly viewportWidth: number;
    private readonly viewportHeight: number;
    /** Transparent, spans the full viewport, BELOW `target` — purely a cursor affordance ('grab'/'grabbing' over empty space); the actual gesture is detected at the native window level (see onNativePointerDown()'s own doc), independent of whatever Pixi object visually received the pointerdown. */
    private readonly background: PIXI.Graphics;
    private readonly maskGraphics: PIXI.Graphics;
    private readonly scrollbarTrack: PIXI.Graphics;
    private readonly scrollbarThumb: PIXI.Graphics;

    /** How far `target` is currently allowed to travel — 0 means "content fits, scrolling is disabled entirely" (see refresh()). */
    private maxScroll = 0;
    /** True from the moment a pointerdown lands inside this viewport until pointerup/cancel — NOT the same as "is this a confirmed drag yet," see `dragConfirmed`. */
    private pointerDown = false;
    /** True once the CURRENT gesture has crossed DRAG_MOVE_THRESHOLD or DRAG_HOLD_THRESHOLD_SEC — see this file's own top doc for what flipping this actually does. */
    private dragConfirmed = false;
    private downGlobalX = 0;
    private downGlobalY = 0;
    private downTargetY = 0;
    private downTimeMs = 0;
    /** Reused across every native pointer event to avoid allocating a new Point every frame of a drag. */
    private readonly tempGlobalPoint = new PIXI.Point();

    public constructor(options: ScrollViewOptions) {
        super();
        this.target = options.target;
        this.viewportWidth = options.width;
        this.viewportHeight = options.height;

        this.background = new PIXI.Graphics();
        this.background.beginFill(0x000000, 0).drawRect(0, 0, this.viewportWidth, this.viewportHeight).endFill();
        this.background.eventMode = 'static';
        this.background.cursor = 'grab';
        this.addChild(this.background);

        // renderable = false — this shape exists ONLY to be assigned as target.mask below, not to
        // be drawn as a normal child. Pixi's mask system renders a mask's geometry through its
        // own dedicated path regardless of `renderable`, so this still works as a mask; without
        // this flag it would ALSO render normally as an opaque white rectangle sitting on top of
        // everything, since it's a real child of this container too (needed so its own transform
        // tracks this ScrollView's position/scale automatically, same as target does).
        this.maskGraphics = new PIXI.Graphics();
        this.maskGraphics.beginFill(0xffffff).drawRect(0, 0, this.viewportWidth, this.viewportHeight).endFill();
        this.maskGraphics.renderable = false;
        this.addChild(this.maskGraphics);

        this.addChild(this.target);
        this.target.mask = this.maskGraphics;

        // Scrollbar — drawn on top of target's own content. Visibility/geometry both fully owned
        // by refresh()/updateScrollbarThumb(); starts hidden, same "nothing to scroll yet"
        // resting state maxScroll itself starts at.
        this.scrollbarTrack = new PIXI.Graphics();
        this.scrollbarThumb = new PIXI.Graphics();
        this.scrollbarTrack.visible = false;
        this.scrollbarThumb.visible = false;
        this.addChild(this.scrollbarTrack, this.scrollbarThumb);

        this.background.on('wheel', this.onWheel);
        window.addEventListener('pointerdown', this.onNativePointerDown);

        this.refresh();
    }

    /**
     * Re-measures `target`'s own current content height, re-clamps its scroll offset, and
     * redraws the scrollbar — call any time content added/removed inside `target` could have
     * changed its size (e.g. every InventoryPopup.renderActiveTab() rebuild). Snaps `target`
     * back to the top (y=0) and hides the scrollbar the moment its content no longer overflows
     * the viewport at all, so a caller never has to check "is this still scrolled/scrollable"
     * itself before rebuilding shorter content.
     */
    public refresh(): void {
        const bounds = this.target.getLocalBounds();
        const contentBottom = bounds.y + bounds.height;
        this.maxScroll = Math.max(0, contentBottom - this.viewportHeight);
        this.target.y = this.maxScroll > 0 ? clamp(this.target.y, -this.maxScroll, 0) : 0;

        if (this.maxScroll <= 0) {
            this.stopDragging();
        }
        this.redrawScrollbar(contentBottom);
    }

    /** Track always spans the full viewport height when visible; thumb height matches the viewport-to-content ratio (floored at SCROLLBAR_MIN_THUMB_HEIGHT) and its position tracks target's own current scroll fraction — called by refresh() (content/visibility changed) and every scroll step (position only). */
    private redrawScrollbar(contentHeight: number): void {
        const scrollable = this.maxScroll > 0;
        this.scrollbarTrack.visible = scrollable;
        this.scrollbarThumb.visible = scrollable;
        if (!scrollable) {
            return;
        }

        const trackX = this.viewportWidth - SCROLLBAR_WIDTH - SCROLLBAR_MARGIN;
        this.scrollbarTrack.clear()
            .beginFill(SCROLLBAR_TRACK_COLOR, SCROLLBAR_TRACK_ALPHA)
            .drawRoundedRect(trackX, 0, SCROLLBAR_WIDTH, this.viewportHeight, SCROLLBAR_WIDTH / 2)
            .endFill();

        const thumbHeight = Math.max(
            SCROLLBAR_MIN_THUMB_HEIGHT,
            (this.viewportHeight / contentHeight) * this.viewportHeight,
        );
        this.scrollbarThumb.clear()
            .beginFill(SCROLLBAR_THUMB_COLOR, SCROLLBAR_THUMB_ALPHA)
            .drawRoundedRect(trackX, 0, SCROLLBAR_WIDTH, thumbHeight, SCROLLBAR_WIDTH / 2)
            .endFill();

        this.positionScrollbarThumb(thumbHeight);
    }

    /** thumbHeight passed in by redrawScrollbar() (which just redrew the thumb at that height); recomputed from the thumb's own current height on every subsequent scroll step, where the shape itself doesn't change. */
    private positionScrollbarThumb(thumbHeight = this.scrollbarThumb.height): void {
        const scrollFraction = this.maxScroll > 0 ? -this.target.y / this.maxScroll : 0;
        this.scrollbarThumb.y = scrollFraction * (this.viewportHeight - thumbHeight);
    }

    /**
     * Native (not Pixi-hit-tested) window listener, live for as long as this ScrollView exists —
     * see this file's own top doc for why: a Pixi pointerdown only ever reaches the single
     * topmost interactive object at that pixel, so a drag STARTING on top of a real button (a
     * row's own Buy/Sell/Craft action) would otherwise never be seen at all. Converts the native
     * event into ScrollView-local space and simply checks whether it landed inside this
     * viewport's own rect — completely independent of which Pixi object (if any) the SAME event
     * also got dispatched to through Pixi's own hit-testing.
     */
    private readonly onNativePointerDown = (e: PointerEvent): void => {
        if (this.maxScroll <= 0) {
            return;
        }
        const events = Game.renderer?.events;
        if (!events) {
            return;
        }

        events.mapPositionToPoint(this.tempGlobalPoint, e.clientX, e.clientY);
        const local = this.toLocal(this.tempGlobalPoint);
        if (local.x < 0 || local.x > this.viewportWidth || local.y < 0 || local.y > this.viewportHeight) {
            return;
        }

        this.pointerDown = true;
        this.dragConfirmed = false;
        this.downGlobalX = this.tempGlobalPoint.x;
        this.downGlobalY = this.tempGlobalPoint.y;
        this.downTargetY = this.target.y;
        this.downTimeMs = performance.now();

        window.addEventListener('pointermove', this.onNativePointerMove);
        window.addEventListener('pointerup', this.onNativePointerUp);
        window.addEventListener('pointercancel', this.onNativePointerUp);
    };

    /**
     * The actual scroll-continuation path. Doesn't move `target` at all until the gesture is
     * CONFIRMED a drag (`dragConfirmed`) — a plain tap that never moves/holds long enough leaves
     * `target` untouched and `target.interactiveChildren` on, so it behaves exactly like a tap
     * always did.
     */
    private readonly onNativePointerMove = (e: PointerEvent): void => {
        if (!this.pointerDown) {
            return;
        }
        const events = Game.renderer?.events;
        if (!events) {
            return;
        }

        events.mapPositionToPoint(this.tempGlobalPoint, e.clientX, e.clientY);
        const dx = this.tempGlobalPoint.x - this.downGlobalX;
        const dy = this.tempGlobalPoint.y - this.downGlobalY;

        if (!this.dragConfirmed) {
            const heldSec = (performance.now() - this.downTimeMs) / 1000;
            if (Math.hypot(dx, dy) < DRAG_MOVE_THRESHOLD && heldSec < DRAG_HOLD_THRESHOLD_SEC) {
                return;
            }
            this.dragConfirmed = true;
            // See this file's own top doc — the actual "block the eventual tap" switch.
            this.target.interactiveChildren = false;
            this.background.cursor = 'grabbing';
        }

        this.target.y = clamp(this.downTargetY + dy, -this.maxScroll, 0);
        this.positionScrollbarThumb();
    };

    private readonly onNativePointerUp = (): void => {
        this.stopDragging();
    };

    private stopDragging(): void {
        this.pointerDown = false;
        this.dragConfirmed = false;
        this.target.interactiveChildren = true;
        this.background.cursor = 'grab';
        window.removeEventListener('pointermove', this.onNativePointerMove);
        window.removeEventListener('pointerup', this.onNativePointerUp);
        window.removeEventListener('pointercancel', this.onNativePointerUp);
    }

    /** Mouse-wheel convenience alongside touch/click-drag — hit-tested normally (via `background`), so unlike drag continuation it needs no native window fallback. */
    private readonly onWheel = (event: PIXI.FederatedWheelEvent): void => {
        if (this.maxScroll <= 0) {
            return;
        }
        this.target.y = clamp(this.target.y - Math.sign(event.deltaY) * WHEEL_STEP, -this.maxScroll, 0);
        this.positionScrollbarThumb();
    };

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        this.stopDragging();
        window.removeEventListener('pointerdown', this.onNativePointerDown);
        this.background.off('wheel', this.onWheel);
        super.destroy(options);
    }
}
