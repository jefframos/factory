// BonusMeter.ts
//
// Gas-gauge style end-of-level bonus: a needle sweeps left/right across a half-ring split into
// multiplier zones while the centre shows the cash that zone would pay; the player taps STOP to
// lock it in. The locked bonus is then offered behind a rewarded video (highlighted CLAIM button)
// with a plain "NO THANKS" to skip it — or, in the tutorial, handed out free with a plain CLAIM. The
// scene decides what claiming actually does.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { UiAnim, UiTween } from './UiAnim';
import { GameAudio } from '../audio/GameAudio';

interface MeterZone {
    from: number;
    to: number;
    multiplier: number;
    color: number;
}

export interface BonusOffer {
    multiplier: number;
    /** Extra money on top of the loot already paid out. */
    bonus: number;
}

const ZONES: MeterZone[] = [
    { from: 0, to: 0.22, multiplier: 2, color: 0x3fd16b },
    { from: 0.22, to: 0.4, multiplier: 3, color: 0xff9a2e },
    { from: 0.4, to: 0.6, multiplier: 5, color: 0xffd02a },
    { from: 0.6, to: 0.78, multiplier: 3, color: 0xff9a2e },
    { from: 0.78, to: 1, multiplier: 2, color: 0x3fd16b },
];

const RADIUS = 105;
const RING_WIDTH = 34;
const SWEEP_SEC = 0.8;
const PANEL_WIDTH = 430;
const PANEL_HEIGHT = 390;
const GAUGE_Y = 40;
/** Leaves the claim button (77px tall once scaled) well inside the panel's bottom edge. */
const ACTION_Y = PANEL_HEIGHT / 2 - 64;
/** Below the panel, so the CLAIM button stays the obvious choice. */
const SKIP_Y = PANEL_HEIGHT / 2 + 34;
const SKIP_DELAY_SEC = 0.9;

const zoneAt = (t: number): MeterZone => ZONES.find((zone) => t >= zone.from && t <= zone.to) ?? ZONES[0];

export default class BonusMeter extends PIXI.Container {
    private readonly needle = new PIXI.Graphics();
    private readonly sweep = { t: 0.5 };
    private sweepTween?: gsap.core.Tween;
    private stopped = false;
    private shownZone?: MeterZone;
    private tweens: UiTween[] = [];
    private readonly gauge = new PIXI.Container();
    private readonly amountLabel: PIXI.Text;
    private readonly stopButton: PIXI.Container;
    private claimButton?: PIXI.Container;
    private skipButton?: PIXI.Container;
    private offer?: BonusOffer;
    private readonly onKeyDown = (event: KeyboardEvent): void => {
        if (event.code === 'Space') {
            event.preventDefault();
            this.stop();
        }
    };

    public constructor(
        private readonly baseMoney: number,
        private readonly onClaim: (offer: BonusOffer) => void,
        private readonly onSkip: () => void,
        /** Tutorial: the bonus is a gift, claimed without watching a video. */
        private readonly free = false,
    ) {
        super();

        this.addChild(UiKit.image('bonusMeter', 'panel', PANEL_WIDTH, PANEL_HEIGHT));

        const ribbon = UiKit.sprite('bonusMeter', 'ribbon', 0.6);
        ribbon.position.set(0, -PANEL_HEIGHT / 2);
        const title = UiKit.text('bonusMeter', 'title');
        title.position.set(0, -PANEL_HEIGHT / 2 - 7);
        const subtitle = UiKit.text('bonusMeter', 'subtitle', { money: baseMoney });
        subtitle.position.set(0, -PANEL_HEIGHT / 2 + 66);
        this.addChild(ribbon, title, subtitle);

        this.gauge.position.set(0, GAUGE_Y);
        this.addChild(this.gauge);
        this.drawRing();
        this.gauge.addChild(this.needle);
        const hub = new PIXI.Graphics();
        hub.beginFill(0xffffff).lineStyle(4, 0x1b1b1b).drawCircle(0, 0, 12).endFill();
        this.gauge.addChild(hub);

        this.amountLabel = UiKit.text('bonusMeter', 'amount', { money: 0 });
        this.amountLabel.position.set(0, -38);
        this.gauge.addChild(this.amountLabel);

        this.stopButton = this.buildButton('button', 'buttonLabel', 230, 90, () => this.stop());
        this.stopButton.scale.set(0.75);
        this.stopButton.position.set(0, ACTION_Y);
        this.addChild(this.stopButton);
        this.tweens.push(...UiAnim.pulse(this.stopButton, 0.05, 0.5));

        window.addEventListener('keydown', this.onKeyDown);
        this.drawNeedle();
        this.sweep.t = 0;
        this.sweepTween = gsap.to(this.sweep, {
            t: 1,
            duration: SWEEP_SEC,
            ease: 'sine.inOut',
            yoyo: true,
            repeat: -1,
            onUpdate: () => this.drawNeedle(),
        });
    }

    /** Lower edge of the content (the skip link hangs below the panel) — used to keep it on screen. */
    public static get bottomExtent(): number {
        return SKIP_Y + 20;
    }

    /** Locks the buttons while the rewarded video plays. */
    public setBusy(busy: boolean): void {
        for (const button of [this.claimButton, this.skipButton]) {
            if (button && !button.destroyed) {
                button.eventMode = busy ? 'none' : 'static';
                button.alpha = busy ? 0.6 : 1;
            }
        }
    }

    private drawRing(): void {
        const ring = new PIXI.Graphics();
        this.gauge.addChild(ring);
        // Dark backing arc, then the coloured zones on top with thin gaps between them.
        ring.lineStyle({ width: RING_WIDTH + 10, color: 0x0e0e0e, cap: PIXI.LINE_CAP.ROUND });
        ring.arc(0, 0, RADIUS, Math.PI, Math.PI * 2);
        for (const zone of ZONES) {
            const start = Math.PI + zone.from * Math.PI + 0.012;
            const end = Math.PI + zone.to * Math.PI - 0.012;
            ring.lineStyle({ width: RING_WIDTH, color: zone.color, cap: PIXI.LINE_CAP.BUTT });
            ring.moveTo(Math.cos(start) * RADIUS, Math.sin(start) * RADIUS);
            ring.arc(0, 0, RADIUS, start, end);
            // Lighter inner band gives the ring a bit of bevel.
            ring.lineStyle({ width: 6, color: 0xffffff, alpha: 0.35, cap: PIXI.LINE_CAP.BUTT });
            ring.moveTo(Math.cos(start) * (RADIUS + 11), Math.sin(start) * (RADIUS + 11));
            ring.arc(0, 0, RADIUS + 11, start, end);

            const mid = Math.PI + ((zone.from + zone.to) / 2) * Math.PI;
            const label = UiKit.text('bonusMeter', 'zoneLabel', { multiplier: zone.multiplier }, { fontSize: zone.multiplier === 5 ? 24 : 19 });
            label.position.set(Math.cos(mid) * RADIUS, Math.sin(mid) * RADIUS);
            this.gauge.addChild(label);
        }
    }

    private drawNeedle(): void {
        const angle = Math.PI + this.sweep.t * Math.PI;
        const length = RADIUS - 4;
        const side = angle + Math.PI / 2;
        this.needle.clear();
        this.needle.beginFill(0xff4a4a).lineStyle(3, 0x1b1b1b);
        this.needle.moveTo(Math.cos(side) * 8, Math.sin(side) * 8);
        this.needle.lineTo(Math.cos(angle) * length, Math.sin(angle) * length);
        this.needle.lineTo(-Math.cos(side) * 8, -Math.sin(side) * 8);
        this.needle.closePath().endFill();
        this.showZone(zoneAt(this.sweep.t));
    }

    /** Live preview of what stopping now would pay. */
    private showZone(zone: MeterZone): void {
        if (zone === this.shownZone || this.amountLabel.destroyed) {
            return;
        }
        this.shownZone = zone;
        this.amountLabel.text = `+$${this.baseMoney * zone.multiplier}`;
        this.amountLabel.style.fill = zone.multiplier >= 5 ? 0xffe14d : zone.multiplier >= 3 ? 0xffb347 : 0x8dff9e;
        gsap.fromTo(this.amountLabel.scale, { x: 1.18, y: 1.18 }, { x: 1, y: 1, duration: 0.18, ease: 'power2.out' });
    }

    private buildButton(imageId: string, labelId: string, width: number, height: number, onTap: () => void, values: Record<string, string | number> = {}): PIXI.Container {
        const button = new PIXI.Container();
        const bg = UiKit.image('bonusMeter', imageId, width, height);
        const label = UiKit.text('bonusMeter', labelId, values);
        label.y = -4;
        button.addChild(bg, label);
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointertap', onTap);
        return button;
    }

    private stop(): void {
        if (this.stopped) {
            return;
        }
        this.stopped = true;
        GameAudio.play('needle');
        this.sweepTween?.kill();
        window.removeEventListener('keydown', this.onKeyDown);
        gsap.killTweensOf(this.stopButton.scale);
        this.stopButton.visible = false;

        const zone = zoneAt(this.sweep.t);
        this.showZone(zone);
        this.offer = { multiplier: zone.multiplier, bonus: this.baseMoney * zone.multiplier };

        // Winning zone blinks; flash + spark sell the hit.
        const start = Math.PI + zone.from * Math.PI;
        const end = Math.PI + zone.to * Math.PI;
        const highlight = new PIXI.Graphics();
        highlight.lineStyle({ width: RING_WIDTH + 12, color: 0xffffff, cap: PIXI.LINE_CAP.BUTT });
        highlight.moveTo(Math.cos(start) * RADIUS, Math.sin(start) * RADIUS);
        highlight.arc(0, 0, RADIUS, start, end);
        highlight.blendMode = PIXI.BLEND_MODES.ADD;
        this.gauge.addChildAt(highlight, 1);

        const flash = new PIXI.Graphics();
        flash.beginFill(0xffffff).drawRoundedRect(-PANEL_WIDTH / 2, -PANEL_HEIGHT / 2, PANEL_WIDTH, PANEL_HEIGHT, 30).endFill();
        flash.blendMode = PIXI.BLEND_MODES.ADD;
        flash.eventMode = 'none';
        this.addChild(flash);
        this.tweens.push(
            gsap.fromTo(highlight, { alpha: 0.7 }, { alpha: 0.1, duration: 0.3, yoyo: true, repeat: -1, ease: 'sine.inOut' }),
            gsap.fromTo(flash, { alpha: 0.6 }, { alpha: 0, duration: 0.35 }),
            gsap.fromTo(this.amountLabel.scale, { x: 0.4, y: 0.4 }, { x: 1.25, y: 1.25, duration: 0.45, ease: 'back.out(3)' }),
            ...UiAnim.punch(this, 0.08),
            ...UiAnim.sparkBurst(this.gauge, 0, this.amountLabel.y, zone.multiplier >= 5 ? 0xffd84a : 0x7dff8a, 120),
            gsap.delayedCall(0.45, () => this.showOffer()),
        );
    }

    private showOffer(): void {
        if (this.destroyed || !this.offer) {
            return;
        }
        const offer = this.offer;

        const claim = new PIXI.Container();
        claim.position.set(0, ACTION_Y);
        const button = this.buildButton('claimButton', 'claimLabel', 300, 96, () => this.onClaim(offer), { multiplier: offer.multiplier });
        // Free claims (tutorial) have no video, so no clapper icon and nothing to skip.
        const icon = this.free ? undefined : UiKit.sprite('bonusMeter', 'videoIcon');
        if (icon) {
            const label = button.getChildAt(1) as PIXI.Text;
            label.x = 30;
            const iconSize = 74;
            icon.scale.set(iconSize / Math.max(icon.width, icon.height));
            icon.position.set(-150 + 44, -6);
            button.addChild(icon);
        }
        button.scale.set(0.8);
        claim.addChild(button);
        const glow = UiAnim.rays(claim, 170, 0xfff27a, 0.7, 6);
        this.addChild(claim);
        this.claimButton = button;

        const skip = new PIXI.Container();
        if (!this.free) {
            const skipLabel = UiKit.text('bonusMeter', 'skipLabel');
            const hitArea = new PIXI.Graphics();
            hitArea.beginFill(0x000000, 0.001).drawRect(-skipLabel.width / 2 - 20, -22, skipLabel.width + 40, 44).endFill();
            skip.addChild(hitArea, skipLabel);
            skip.position.set(0, SKIP_Y);
            skip.cursor = 'pointer';
            skip.on('pointertap', () => this.onSkip());
            this.addChild(skip);
            this.skipButton = skip;
        }

        const buttonScale = button.scale.x;
        button.scale.set(0);
        button.eventMode = 'none';
        skip.alpha = 0;
        skip.eventMode = 'none';
        this.tweens.push(
            ...glow.tweens,
            gsap.fromTo(glow.rays.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2)' }),
            gsap.to(button.scale, {
                x: buttonScale,
                y: buttonScale,
                duration: 0.45,
                ease: 'back.out(2.4)',
                onComplete: () => {
                    if (button.destroyed) {
                        return;
                    }
                    button.eventMode = 'static';
                    this.tweens.push(...UiAnim.pulse(button, 0.07, 0.45));
                    if (!icon) {
                        return;
                    }
                    // Clapper wiggles every couple of seconds to draw the eye.
                    this.tweens.push(gsap.timeline({ repeat: -1, repeatDelay: 1.6, delay: 0.3 })
                        .to(icon, { rotation: 0.18, duration: 0.08, ease: 'sine.inOut' })
                        .to(icon, { rotation: -0.18, duration: 0.16, ease: 'sine.inOut' })
                        .to(icon, { rotation: 0.1, duration: 0.12, ease: 'sine.inOut' })
                        .to(icon, { rotation: 0, duration: 0.1, ease: 'sine.inOut' }));
                },
            }),
            gsap.to(skip, {
                alpha: 1,
                duration: 0.3,
                delay: SKIP_DELAY_SEC,
                onComplete: () => {
                    if (!skip.destroyed) {
                        skip.eventMode = 'static';
                    }
                },
            }),
        );
    }

    public override destroy(options?: PIXI.IDestroyOptions | boolean): void {
        window.removeEventListener('keydown', this.onKeyDown);
        this.sweepTween?.kill();
        this.tweens.forEach((tween) => tween.kill());
        this.tweens = [];
        UiAnim.kill(this);
        super.destroy(options);
    }
}
