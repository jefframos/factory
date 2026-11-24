// Clock.ts
//
// The clock that rewinding is known by, drawn: gold rim, pale face, hands that turn back.

import * as PIXI from 'pixi.js';

export class Clock extends PIXI.Container {
    private readonly long = new PIXI.Graphics();
    private readonly short = new PIXI.Graphics();
    /** Turns a second the long hand goes back. */
    public speed = 0.25;

    public constructor(radius: number) {
        super();
        const r = radius;
        const face = new PIXI.Graphics();
        // Its bell and feet, the rim, the face.
        face.beginFill(0x100e18).drawRoundedRect(-r * 0.24, -r * 1.34, r * 0.48, r * 0.4, r * 0.12).endFill();
        face.beginFill(0xffb52e).drawRoundedRect(-r * 0.17, -r * 1.27, r * 0.34, r * 0.3, r * 0.08).endFill();
        face.beginFill(0x100e18).drawCircle(0, 0, r * 1.06).endFill();
        face.beginFill(0xe8901a).drawCircle(0, 0, r * 0.99).endFill();
        face.beginFill(0xffc93c).drawCircle(0, -r * 0.03, r * 0.95).endFill();
        face.beginFill(0x7a4410).drawCircle(0, 0, r * 0.79).endFill();
        face.beginFill(0xf4ecff).drawCircle(0, 0, r * 0.74).endFill();
        face.beginFill(0xd9c6ff).drawCircle(0, r * 0.04, r * 0.7).endFill();
        face.beginFill(0xfaf6ff).drawCircle(0, -r * 0.02, r * 0.68).endFill();
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2;
            const big = i % 3 === 0;
            face.lineStyle({ width: r * (big ? 0.09 : 0.05), color: big ? 0x6b35d8 : 0xa78be0, cap: PIXI.LINE_CAP.ROUND });
            face.moveTo(Math.sin(a) * r * 0.48, -Math.cos(a) * r * 0.48).lineTo(Math.sin(a) * r * 0.58, -Math.cos(a) * r * 0.58);
        }
        face.lineStyle(0).beginFill(0xffffff, 0.5).drawEllipse(-r * 0.5, -r * 0.62, r * 0.16, r * 0.09).endFill();
        const hand = (graphics: PIXI.Graphics, length: number, width: number, color: number) => {
            graphics.lineStyle({ width: width + r * 0.06, color: 0x100e18, cap: PIXI.LINE_CAP.ROUND }).moveTo(0, r * 0.12).lineTo(0, -length);
            graphics.lineStyle({ width, color, cap: PIXI.LINE_CAP.ROUND }).moveTo(0, r * 0.12).lineTo(0, -length);
        };
        hand(this.short, r * 0.3, r * 0.1, 0x6b35d8);
        hand(this.long, r * 0.5, r * 0.08, 0xff3d8a);
        const hub = new PIXI.Graphics().beginFill(0x100e18).drawCircle(0, 0, r * 0.11).endFill().beginFill(0xffc93c).drawCircle(0, 0, r * 0.07).endFill();
        this.short.rotation = 2.1;
        this.addChild(face, this.short, this.long, hub);
    }

    public update(delta: number): void {
        this.long.rotation -= this.speed * Math.PI * 2 * delta;
        this.short.rotation -= (this.speed * Math.PI * 2 * delta) / 6;
    }
}
