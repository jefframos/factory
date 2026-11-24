// EdgeArrow.ts
//
// An arrow at the screen's edge toward something out of view (the first station, once the Push Mower can be paid): a
// gold arrowhead, beating, turned toward it. Hidden while the thing is on screen (it has its own arrow over it).

import * as PIXI from 'pixi.js';
import { UiAnim } from './UiAnim';

/** Half its size, and how far in from the screen's edges it stays (clear of the HUD's corners). */
const SIZE = 34;
const INSET = { x: 64, top: 230, bottom: 150 };

export interface ScreenRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

export class EdgeArrow extends PIXI.Container {
    public constructor() {
        super();
        const body = new PIXI.Container();
        const head = (grow: number, color: number) => new PIXI.Graphics().beginFill(color)
            .drawPolygon([SIZE + grow, 0, -SIZE * 0.7 - grow * 0.7, -SIZE * 0.85 - grow, -SIZE * 0.3 - grow * 0.2, 0, -SIZE * 0.7 - grow * 0.7, SIZE * 0.85 + grow]).endFill();
        body.addChild(head(9, 0x1d140e), head(5, 0xffffff), head(0, 0xffc62e));
        UiAnim.pulse(body, 0.18, 0.4);
        this.addChild(body);
        this.eventMode = 'none';
        this.visible = false;
    }

    /** Points from the edge of `screen` at `at` (both in this arrow's parent's space); null, or on screen: hidden. */
    public point(at: PIXI.IPointData | null, screen: ScreenRect): void {
        const left = screen.x + INSET.x;
        const right = screen.x + screen.width - INSET.x;
        const top = screen.y + Math.min(INSET.top, screen.height * 0.25);
        const bottom = screen.y + screen.height - Math.min(INSET.bottom, screen.height * 0.2);
        this.visible = !!at && (at.x < left || at.x > right || at.y < top || at.y > bottom);
        if (!at || !this.visible) return;
        const cx = (left + right) / 2;
        const cy = (top + bottom) / 2;
        const dx = at.x - cx;
        const dy = at.y - cy;
        // Along the line to it, as far as the inset rectangle goes.
        const reach = Math.min((right - left) / 2 / Math.max(1e-3, Math.abs(dx)), (bottom - top) / 2 / Math.max(1e-3, Math.abs(dy)));
        this.position.set(cx + dx * reach, cy + dy * reach);
        this.rotation = Math.atan2(dy, dx);
    }

    public override destroy(): void {
        UiAnim.kill(this);
        super.destroy({ children: true });
    }
}
