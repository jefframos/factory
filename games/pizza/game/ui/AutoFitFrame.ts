// AutoFitFrame.ts
//
// A FrameComponent sized to fit whatever content it's wrapping, automatically
// — the easy way to put a background panel behind a label without hand-
// measuring it: give it padding + a frame + the content, and it fits itself
// around the content's own bounds, right underneath it in draw order (frame
// added first, content added second — see the constructor).
//
//   const label = new PIXI.Text('Drop Zone', TextStyleRegistry.ZoneTitle);
//   label.anchor.set(0.5, 1);
//   const framed = new AutoFitFrame(uniformFitPadding(10), 'Popup', label);
//   // framed is a plain PIXI.Container — treat it exactly like `label` was
//   // before (add it to the overlay, pass it to ScreenAnchorComponent, ...).
//
// Call fit() again any time `content`'s own size changes (new text, a
// resized child) — nothing here watches for that automatically, since Pixi
// has no generic "content resized" event to hook.

import * as PIXI from 'pixi.js';
import FrameComponent from './FrameComponent';
import { FrameName } from './FrameRegistry';

export interface AutoFitPadding {
    left: number;
    top: number;
    right: number;
    bottom: number;
}

export function uniformFitPadding(px: number): AutoFitPadding {
    return { left: px, top: px, right: px, bottom: px };
}

export default class AutoFitFrame extends PIXI.Container {
    private readonly frame: FrameComponent;
    private readonly content: PIXI.Container;
    private readonly padding: AutoFitPadding;

    /** `padding` comes first (per this file's own doc) since it's the one thing every call site tends to want to tune — the frame/content picks themselves are usually fixed for a given piece of UI. */
    public constructor(padding: AutoFitPadding, frame: FrameName, content: PIXI.Container) {
        super();
        this.padding = padding;
        this.content = content;

        // Frame added FIRST so it draws behind — content (added second) always renders on top.
        this.frame = new FrameComponent(frame, 1, 1);
        this.addChild(this.frame);
        this.addChild(content);

        this.fit();
    }

    /** Passes through to the underlying FrameComponent's own setTint() — see that method's own doc. */
    public setTint(tint: number): void {
        this.frame.setTint(tint);
    }

    /** Sets alpha on the underlying FrameComponent ONLY, not `content` — this.alpha (inherited from PIXI.Container) would multiply into content's own alpha too since it's a sibling child of this same container, which is exactly the bug this method exists to avoid (see MovementTutorialOverlay's fade-out, which needs its background frame to fade independently of its text staying fully opaque). */
    public setAlpha(alpha: number): void {
        this.frame.alpha = alpha;
    }

    /** Re-measures `content` and resizes/repositions the frame to match — call after changing content's own size (new text, ...). */
    public fit(): void {
        const bounds = this.content.getLocalBounds();
        const width = bounds.width + this.padding.left + this.padding.right;
        const height = bounds.height + this.padding.top + this.padding.bottom;

        this.frame.setSize(Math.max(1, width), Math.max(1, height));
        this.frame.position.set(bounds.x - this.padding.left, bounds.y - this.padding.top);
    }
}
