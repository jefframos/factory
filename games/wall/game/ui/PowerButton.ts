// PowerButton.ts
//
// A power-up's card, down the right side (data/Powers), as the rewind one across from it: lit up when it's ready, gold with its
// time running out under it while it's on, grey and filling up while it charges (tapped then: a video has it on at once). The
// first time there's one, a hand points at it.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { Gameplay } from '../ads/Gameplay';
import { WallAnalytics } from '../analytics/WallAnalytics';
import { WallAudio } from '../audio/WallAudio';
import { Power, Powers } from '../data/Powers';
import { WallProgress } from '../data/WallProgress';
import { RoundFace, frame, ringSprite, sprite, text, write } from './parts';

export const POWER = { size: 80, icon: 66, every: 112 };
/** Its time: under it. */
const PILL = { height: 30, below: 18, back: 0x100e18, track: 0x2b2d4d, active: 0xffb52e, charging: 0x3fb8ff };
/** Its face's colour: ready (its own), on, charging. */
const COLORS = { hands: 0x2fa8ff, auto: 0xb04cff, crew: 0x45cf3a, active: 0xffc21f, charging: 0x8a90a8 } as const;

export class PowerButton extends PIXI.Container {
    private readonly body = new PIXI.Container();
    /** A gold ring round it while it's ready (and on). */
    private readonly focus = ringSprite(POWER.size / 2 + 5, 6, 0xffe14a, { width: 10, color: 0x7a4a00, alpha: 0.5 });
    private readonly back: RoundFace;
    /** (Kept inside the circle.) */
    private readonly glow = sprite('ItemFrame_BgGlow', POWER.size * 0.72);
    private readonly pill = new PIXI.Container();
    private readonly fill = frame('BasicFrame_Round12', [12, 12, 12, 12], POWER.size - 8, 22, 0.75);
    private readonly icon: PIXI.Sprite;
    private readonly label = text('', 23, 0xffffff, 0x100e18, 6);
    private readonly time = text('', 18, 0xffffff, 0x100e18, 5);
    private readonly video = sprite('ItemIcon_Video', 34);
    private readonly hand = PIXI.Sprite.from('handHud');
    private drawn = '';
    private clock = Math.random() * 3;
    private busy = false;
    private known = false;

    /** `said`: it's just come, or it's on (the words for the middle of the screen). */
    public constructor(private readonly power: Power, private readonly said: (words: string, sub: string) => void) {
        super();
        const { id, short } = power.def;
        this.back = new RoundFace(POWER.size, COLORS[id]);
        this.icon = sprite(power.def.icon ?? `Wall_power_${id}`, POWER.icon);
        this.icon.y = -7;
        this.label.text = short;
        this.label.y = POWER.size / 2 - 20;
        this.video.position.set(POWER.size / 2 - 10, -POWER.size / 2 + 10);
        const edge = frame('BasicFrame_Round12', [12, 12, 12, 12], POWER.size, PILL.height);
        edge.tint = PILL.back;
        const track = frame('BasicFrame_Round12', [12, 12, 12, 12], POWER.size - 8, 22, 0.75);
        track.tint = PILL.track;
        this.pill.y = POWER.size / 2 + PILL.below;
        this.time.y = -1;
        this.pill.addChild(edge, track, this.fill, this.time);
        this.hand.width = this.hand.height = 64;
        this.hand.eventMode = 'none';
        this.body.addChild(this.focus, this.back, this.glow, this.icon, this.label, this.pill, this.video, this.hand);
        this.addChild(this.body);
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.hitArea = new PIXI.Circle(0, 0, POWER.size / 2 + 8);
        this.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            // (Not a punch too.)
            event.stopPropagation();
            void this.tap();
        });
        this.visible = false;
    }

    /** `open`: nothing's over the wall. */
    public update(delta: number, open: boolean): void {
        const { power } = this;
        const { def, phase, left } = power;
        this.visible = open && Powers.there(power);
        if (!this.visible) return;
        this.clock += delta;
        if (!this.known) {
            this.known = true;
            WallAnalytics.powerShown(def.id);
            WallProgress.markStep(`power-${def.id}`);
            this.bump(0.3);
        }
        const ready = phase === 'ready';
        this.focus.visible = phase !== 'charging';
        this.focus.alpha = 0.6 + 0.4 * Math.sin(this.clock * 5);
        this.glow.alpha = phase === 'charging' ? 0.15 : 0.6;
        this.body.scale.set(ready ? 1 + 0.03 * Math.sin(this.clock * 5) : 1);
        this.icon.alpha = this.label.alpha = phase === 'charging' ? 0.6 : 1;
        this.icon.rotation = phase === 'active' ? Math.sin(this.clock * 14) * 0.1 : 0;
        this.pill.visible = !ready;
        this.video.visible = phase === 'charging' && PlatformHandler.ENABLE_VIDEO_ADS;
        this.hand.visible = ready && !WallProgress.stepDone(`power-used-${def.id}`);
        // (Its fingertip on the rim, low on the right: the icon and the label stay in sight.)
        const tap = Math.abs(Math.sin(this.clock * 5)) * 7;
        this.hand.position.set(POWER.size * 0.3 + tap, POWER.size * 0.24 + tap);
        if (!ready) write(this.time, `${Math.ceil(left)}s`);
        this.draw();
    }

    /** Its frame, and how far along its time is. */
    private draw(): void {
        const { phase, def } = this.power;
        if (phase !== this.drawn) {
            this.drawn = phase;
            this.back.setColor(phase === 'ready' ? COLORS[def.id] : COLORS[phase]);
            if (phase !== 'ready') this.fill.tint = PILL[phase];
        }
        if (phase !== 'ready') this.fill.width = Math.max(22, (POWER.size - 8) * Math.max(0, Powers.share(this.power))) / 0.75;
    }

    private async tap(): Promise<void> {
        const { power } = this;
        const { def } = power;
        if (this.busy || power.phase === 'active') return;
        const charged = power.phase === 'ready';
        if (!charged) {
            if (!PlatformHandler.ENABLE_VIDEO_ADS) {
                this.refuse();
                return;
            }
            this.busy = true;
            const watched = await Gameplay.watchVideo();
            this.busy = false;
            if (this.destroyed) return;
            if (!watched) {
                WallAnalytics.power(def.id, 'no-video');
                this.refuse();
                return;
            }
        }
        Powers.start(power);
        WallProgress.markStep(`power-used-${def.id}`);
        WallAnalytics.power(def.id, charged ? 'used' : 'video');
        WallAudio.play('tool', 1, 1.1);
        this.said(`${def.name}!`, '');
        this.bump(1.3);
    }

    private refuse(): void {
        WallAudio.play('error');
        gsap.killTweensOf(this.pivot);
        gsap.fromTo(this.pivot, { x: 9 }, { x: 0, duration: 0.35, ease: 'elastic.out(1, 0.2)' });
    }

    private bump(from: number): void {
        gsap.killTweensOf(this.scale);
        this.scale.set(from);
        gsap.to(this.scale, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2.4)' });
    }
}
