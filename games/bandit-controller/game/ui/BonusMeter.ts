// BonusMeter.ts
//
// Gas-gauge style end-of-level bonus: a needle sweeps left/right across a half-ring split into
// multiplier zones and the player taps STOP to lock it in. The chosen zone's multiplier is
// applied to the money collected on the level. Textures come from the 'ui' atlas (copied from pizza).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';

interface MeterZone {
    from: number;
    to: number;
    multiplier: number;
    color: number;
}

const ZONES: MeterZone[] = [
    { from: 0, to: 0.4, multiplier: 2, color: 0x3fd16b },
    { from: 0.4, to: 0.6, multiplier: 5, color: 0xffc928 },
    { from: 0.6, to: 1, multiplier: 2, color: 0x3fd16b },
];

const RADIUS = 120;
const RING_WIDTH = 34;
const SWEEP_SEC = 0.85;
const PANEL_WIDTH = 380;
const PANEL_HEIGHT = 260;

export default class BonusMeter extends PIXI.Container {
    private readonly needle = new PIXI.Graphics();
    private readonly sweep = { t: 0 };
    private sweepTween?: gsap.core.Tween;
    private stopped = false;
    private resultDelay?: gsap.core.Tween;
    private readonly resultLabel: PIXI.Text;
    private readonly stopButton: PIXI.Container;
    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.code === 'Space') {
            event.preventDefault();
            this.stop();
        }
    };

    public constructor(private readonly onResult: (multiplier: number) => void) {
        super();

        this.addChild(UiKit.image('bonusMeter', 'panel', PANEL_WIDTH, PANEL_HEIGHT));

        const title = UiKit.text('bonusMeter', 'title');
        title.position.set(0, -PANEL_HEIGHT / 2 + 26);
        this.addChild(title);

        // Gauge sits low in the panel so the half-ring reads as a dial above the button.
        const gauge = new PIXI.Container();
        gauge.position.set(0, 25);
        this.addChild(gauge);
        this.drawRing(gauge);
        gauge.addChild(this.needle);
        this.drawNeedle();

        const hub = new PIXI.Graphics();
        hub.beginFill(0xffffff).lineStyle(4, 0x1b1b1b).drawCircle(0, 0, 12).endFill();
        gauge.addChild(hub);

        this.resultLabel = new PIXI.Text('', {
            fontFamily: UiKit.fontFamily('primary'), fontSize: 40, fontWeight: 'normal', fill: 0xffd15c,
            stroke: 0x3a2400, strokeThickness: 6,
        });
        this.resultLabel.anchor.set(0.5);
        this.resultLabel.position.set(0, -20);
        this.resultLabel.visible = false;
        gauge.addChild(this.resultLabel);

        this.stopButton = this.buildStopButton();
        this.stopButton.position.set(0, PANEL_HEIGHT / 2 - 44);
        this.addChild(this.stopButton);

        window.addEventListener('keydown', this.onKeyDown);
        this.sweepTween = gsap.to(this.sweep, {
            t: 1,
            duration: SWEEP_SEC,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
            onUpdate: () => this.drawNeedle(),
        });
        this.sweep.t = 0;
    }

    private drawRing(parent: PIXI.Container): void {
        const ring = new PIXI.Graphics();
        parent.addChild(ring);
        // Dark backing arc, then the coloured zones on top with thin gaps between them.
        ring.lineStyle({ width: RING_WIDTH + 8, color: 0x0e0e0e, cap: PIXI.LINE_CAP.BUTT });
        ring.arc(0, 0, RADIUS, Math.PI, Math.PI * 2);
        for (const zone of ZONES) {
            const start = Math.PI + zone.from * Math.PI + 0.012;
            const end = Math.PI + zone.to * Math.PI - 0.012;
            ring.lineStyle({ width: RING_WIDTH, color: zone.color, cap: PIXI.LINE_CAP.BUTT });
            ring.moveTo(Math.cos(start) * RADIUS, Math.sin(start) * RADIUS);
            ring.arc(0, 0, RADIUS, start, end);

            const mid = Math.PI + ((zone.from + zone.to) / 2) * Math.PI;
            const label = new PIXI.Text(`x${zone.multiplier}`, {
                fontFamily: UiKit.fontFamily('primary'),
                fontSize: zone.multiplier === 5 ? 20 : 17,
                fontWeight: 'normal',
                fill: 0xffffff,
                stroke: 0x1b1b1b,
                strokeThickness: 4,
            });
            label.anchor.set(0.5);
            label.position.set(Math.cos(mid) * RADIUS, Math.sin(mid) * RADIUS);
            parent.addChild(label);
        }
    }

    private drawNeedle(): void {
        const angle = Math.PI + this.sweep.t * Math.PI;
        const length = RADIUS - 6;
        this.needle.clear();
        this.needle.beginFill(0xff4a4a).lineStyle(3, 0x1b1b1b);
        const side = angle + Math.PI / 2;
        this.needle.moveTo(Math.cos(side) * 8, Math.sin(side) * 8);
        this.needle.lineTo(Math.cos(angle) * length, Math.sin(angle) * length);
        this.needle.lineTo(-Math.cos(side) * 8, -Math.sin(side) * 8);
        this.needle.closePath().endFill();
    }

    private buildStopButton(): PIXI.Container {
        const button = new PIXI.Container();
        const bg = UiKit.image('bonusMeter', 'button', 220, 90);
        const label = UiKit.text('bonusMeter', 'buttonLabel');
        button.addChild(bg, label);
        button.scale.set(0.7);
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointertap', () => this.stop());
        return button;
    }

    private stop(): void {
        if (this.stopped) {
            return;
        }
        this.stopped = true;
        this.sweepTween?.kill();
        window.removeEventListener('keydown', this.onKeyDown);
        this.stopButton.visible = false;

        const t = this.sweep.t;
        const zone = ZONES.find((candidate) => t >= candidate.from && t <= candidate.to) ?? ZONES[0];
        this.resultLabel.text = `x${zone.multiplier}`;
        this.resultLabel.visible = true;
        this.resultLabel.scale.set(0.4);
        gsap.to(this.resultLabel.scale, { x: 1, y: 1, duration: 0.35, ease: 'back.out(3)' });
        this.resultDelay = gsap.delayedCall(0.9, () => this.onResult(zone.multiplier));
    }

    public override destroy(options?: PIXI.IDestroyOptions | boolean): void {
        window.removeEventListener('keydown', this.onKeyDown);
        this.sweepTween?.kill();
        this.resultDelay?.kill();
        gsap.killTweensOf(this.resultLabel.scale);
        super.destroy(options);
    }
}
