// RadialBarComponent.ts
//
// Turns a RadialBarRegistry.ts style into a progress-settable circular readout —
// the radial counterpart to BarComponent.ts. Built from three PIXI.Graphics
// (bg circle, fillBg circle, fill pie wedge — see RadialBarRegistry's own doc for
// how radius/padding/fillPadding relate them), so it needs no texture assets.
//
//   const radial = new RadialBarComponent('Green');
//   radial.setProgress(0.5); // half the circle filled, clockwise from 12 o'clock
//
//   new RadialBarComponent('Green', { radius: 24, fillColor: 0xff00ff }); // per-call override
//
// Local origin is the circle's CENTER (unlike BarComponent, whose origin is its
// top-left) — position it wherever the middle of the circle should land.

import * as PIXI from 'pixi.js';
import { RadialBarRegistry, RadialBarStyleDef, RadialBarStyleName } from './RadialBarRegistry';

/** 12 o'clock — PIXI angles are measured clockwise from 3 o'clock (screen-space +y is down). */
const START_ANGLE = -Math.PI / 2;
/** Skips redrawing the wedge for a change smaller than this — setProgress() is typically called every frame with a value that barely moves. */
const REDRAW_EPSILON = 0.002;

export default class RadialBarComponent extends PIXI.Container {
    private readonly style: RadialBarStyleDef;
    private readonly bg = new PIXI.Graphics();
    private readonly fillBg = new PIXI.Graphics();
    private readonly fill = new PIXI.Graphics();
    private progress = -1;

    public constructor(style: RadialBarStyleName, overrides: Partial<RadialBarStyleDef> = {}) {
        super();
        this.style = { ...RadialBarRegistry[style], ...overrides };
        this.addChild(this.bg, this.fillBg, this.fill);
        this.redrawStatic();
        this.setProgress(1);
    }

    /** Outer radius (the bg circle's) — handy for laying out neighbors around this. */
    public get radius(): number {
        return this.style.radius;
    }

    /** 0-1 — sweeps the fill wedge clockwise from 12 o'clock. */
    public setProgress(fraction: number): void {
        const clamped = Math.min(1, Math.max(0, fraction));
        if (Math.abs(clamped - this.progress) < REDRAW_EPSILON && clamped !== 0 && clamped !== 1) {
            return;
        }
        this.progress = clamped;

        const { radius, padding, fillPadding, fillColor } = this.style;
        const fillRadius = Math.max(0, radius - padding - fillPadding);

        this.fill.clear();
        if (clamped <= 0 || fillRadius <= 0) {
            return;
        }
        this.fill.beginFill(fillColor);
        if (clamped >= 1) {
            this.fill.drawCircle(0, 0, fillRadius);
        } else {
            this.fill.moveTo(0, 0);
            this.fill.arc(0, 0, fillRadius, START_ANGLE, START_ANGLE + clamped * Math.PI * 2);
            this.fill.lineTo(0, 0);
        }
        this.fill.endFill();
    }

    private redrawStatic(): void {
        const { radius, padding, bgColor, fillBgColor } = this.style;

        this.bg.clear();
        this.bg.beginFill(bgColor);
        this.bg.drawCircle(0, 0, radius);
        this.bg.endFill();

        this.fillBg.clear();
        this.fillBg.beginFill(fillBgColor);
        this.fillBg.drawCircle(0, 0, Math.max(0, radius - padding));
        this.fillBg.endFill();
    }
}
