// ScrollView.ts
//
// Generic vertical drag-to-scroll clip region — wraps an existing content
// container (`target`) inside a fixed `width` x `height` viewport, masks
// away anything outside it, and lets a drag anywhere within that viewport
// scroll `target` between its natural top (y=0) and the point its own
// bottom edge reaches the viewport's bottom edge. A transparent gripArea
// sprite spans the FULL viewport specifically so the drag "grip" works
// everywhere inside it — a sparse grid with gaps between cells, empty space
// below a short list, an otherwise-empty tab — not just wherever `target`'s
// own content happens to have visible pixels; without it a drag started
// over a gap would simply do nothing.
//
// Drag tracking is NATIVE window pointer events (pointermove/pointerup),
// not PIXI's own hit-tested pointermove — same "don't lose the gesture the
// instant the pointer leaves the small interactive shape that started it"
// reasoning core/io/SwipeInputManager.ts and core/io/PointerFollowInput.ts
// already use elsewhere in this engine. gripArea's own viewport is typically
// much smaller than the whole screen (a popup's own content area, not a
// fullscreen input host like those two), so a real drag routinely moves the
// pointer outside it well before the gesture ends — PIXI's own pointermove
// only fires while the pointer stays over the object that received
// pointerdown, which would silently drop the drag the moment that happens.
// window pointer events (the modern Pointer Events API) unify mouse, touch,
// and pen under one model, so this one code path covers both without a
// separate touch/mouse split. Native client coordinates are converted back
// into PIXI's own coordinate space via the renderer's own
// events.mapPositionToPoint() — the exact conversion PIXI uses internally
// to populate a federated event's own `.global` — so this stays correct
// under any canvas CSS scaling/resolution, not just a naive 1:1 pixel
// assumption.
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
const SCROLLBAR_WIDTH = 5;
/** Gap between the scrollbar and the viewport's own right edge. */
const SCROLLBAR_MARGIN = 3;
const SCROLLBAR_TRACK_COLOR = 0xffffff;
const SCROLLBAR_TRACK_ALPHA = 0.12;
const SCROLLBAR_THUMB_COLOR = 0xffffff;
const SCROLLBAR_THUMB_ALPHA = 0.5;
/** A thumb never renders shorter than this, however small the viewport-to-content ratio gets — a sliver a few px tall stops reading as a thumb at all. */
const SCROLLBAR_MIN_THUMB_HEIGHT = 28;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

export default class ScrollView extends PIXI.Container {
    private readonly target: PIXI.Container;
    private readonly viewportWidth: number;
    private readonly viewportHeight: number;
    private readonly gripArea: PIXI.Graphics;
    private readonly maskGraphics: PIXI.Graphics;
    private readonly scrollbarTrack: PIXI.Graphics;
    private readonly scrollbarThumb: PIXI.Graphics;

    /** How far `target` is currently allowed to travel — 0 means "content fits, scrolling is disabled entirely" (see refresh()). */
    private maxScroll = 0;
    private dragging = false;
    private dragStartLocalY = 0;
    private dragStartTargetY = 0;
    /** Reused across every native pointermove to avoid allocating a new Point every frame of a drag. */
    private readonly tempGlobalPoint = new PIXI.Point();

    public constructor(options: ScrollViewOptions) {
        super();
        this.target = options.target;
        this.viewportWidth = options.width;
        this.viewportHeight = options.height;

        // Fully transparent but still hit-testable — this is what guarantees the drag "grip"
        // across the WHOLE viewport rather than only wherever target's own content happens to
        // have visible pixels. Added as the FIRST child (drawn/hit-tested UNDER target) so a
        // target that itself contains interactive content (a button, a tappable row) still gets
        // first claim on a tap — this only ever answers a gesture nothing inside target handled.
        this.gripArea = new PIXI.Graphics();
        this.gripArea.beginFill(0x000000, 0).drawRect(0, 0, this.viewportWidth, this.viewportHeight).endFill();
        this.gripArea.interactive = true;
        this.gripArea.cursor = 'grab';
        this.addChild(this.gripArea);

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

        // Scrollbar — added LAST so it draws on top of target's own content. Visibility/geometry
        // both fully owned by refresh()/updateScrollbarThumb(); starts hidden, same "nothing to
        // scroll yet" resting state maxScroll itself starts at.
        this.scrollbarTrack = new PIXI.Graphics();
        this.scrollbarThumb = new PIXI.Graphics();
        this.scrollbarTrack.visible = false;
        this.scrollbarThumb.visible = false;
        this.addChild(this.scrollbarTrack, this.scrollbarThumb);

        // pointerdown stays a normal, hit-tested Pixi event — reliable exactly because it only
        // ever needs to fire once, at the moment the pointer is genuinely over gripArea. Actual
        // drag CONTINUATION switches to native window listeners — see this file's own top doc.
        this.gripArea.on('pointerdown', this.onDragStart);
        this.gripArea.on('pointerup', this.onDragEnd);
        this.gripArea.on('pointerupoutside', this.onDragEnd);
        this.gripArea.on('wheel', this.onWheel);

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

    private readonly onDragStart = (event: PIXI.FederatedPointerEvent): void => {
        // maxScroll <= 0 means the content already fits entirely — see this file's own top doc
        // on why a drag here is simply ignored rather than clamped to a 0-length range.
        if (this.maxScroll <= 0) {
            return;
        }
        this.dragging = true;
        this.dragStartLocalY = this.toLocal(event.global).y;
        this.dragStartTargetY = this.target.y;
        this.gripArea.cursor = 'grabbing';
        window.addEventListener('pointermove', this.onWindowPointerMove);
        window.addEventListener('pointerup', this.onWindowPointerUp);
        window.addEventListener('pointercancel', this.onWindowPointerUp);
    };

    /** The actual scroll-continuation path — see this file's own top doc on why this is a native window listener rather than Pixi's own pointermove. */
    private readonly onWindowPointerMove = (e: PointerEvent): void => {
        if (!this.dragging) {
            return;
        }
        const events = Game.renderer?.events;
        if (!events) {
            return;
        }
        // Same clientX/clientY -> Pixi-space conversion Pixi's own EventSystem uses internally to
        // populate a federated event's `.global` — keeps this consistent with dragStartLocalY,
        // which came from a REAL federated event's `.global` at drag-start.
        events.mapPositionToPoint(this.tempGlobalPoint, e.clientX, e.clientY);
        const localY = this.toLocal(this.tempGlobalPoint).y;
        this.target.y = clamp(this.dragStartTargetY + (localY - this.dragStartLocalY), -this.maxScroll, 0);
        this.positionScrollbarThumb();
    };

    private readonly onWindowPointerUp = (): void => {
        this.stopDragging();
    };

    private readonly onDragEnd = (): void => {
        this.stopDragging();
    };

    private stopDragging(): void {
        this.dragging = false;
        this.gripArea.cursor = 'grab';
        window.removeEventListener('pointermove', this.onWindowPointerMove);
        window.removeEventListener('pointerup', this.onWindowPointerUp);
        window.removeEventListener('pointercancel', this.onWindowPointerUp);
    }

    /** Mouse-wheel convenience alongside touch/click-drag — a wheel event is always hit-tested at wherever the cursor currently is, so unlike drag continuation it needs no window-level fallback. */
    private readonly onWheel = (event: PIXI.FederatedWheelEvent): void => {
        if (this.maxScroll <= 0) {
            return;
        }
        this.target.y = clamp(this.target.y - Math.sign(event.deltaY) * WHEEL_STEP, -this.maxScroll, 0);
        this.positionScrollbarThumb();
    };

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        this.stopDragging();
        this.gripArea.off('pointerdown', this.onDragStart);
        this.gripArea.off('pointerup', this.onDragEnd);
        this.gripArea.off('pointerupoutside', this.onDragEnd);
        this.gripArea.off('wheel', this.onWheel);
        super.destroy(options);
    }
}
