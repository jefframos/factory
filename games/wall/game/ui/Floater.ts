// Floater.ts
//
// What drifts across the wall now and then while playing (`floating` in ui/wall.json): a bundle of bills (free cash), a golden
// chest (a lot of it, for a video), a bolt (a frenzy); and, back after a while away, what the crew earned again for a video.
// Tapped, it's had; left, it floats off. Nothing stops for it.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { Game } from 'core/Game';
import { Gameplay } from '../ads/Gameplay';
import { WallAnalytics } from '../analytics/WallAnalytics';
import { WallAudio } from '../audio/WallAudio';
import { fx } from '../config/Effects';
import { FLOATING } from '../data/WallConfig';
import { WallProgress } from '../data/WallProgress';
import { sprite, text, write } from './parts';

export type FloaterKind = 'cash' | 'chest' | 'frenzy' | 'double';

/** `circle`: its orb's colour. `video`: it's for one. */
interface Look {
    icon: string;
    size: number;
    circle: number;
    color: number;
    words: number;
    video?: boolean;
}

const LOOKS: Record<FloaterKind, Look> = {
    cash: { icon: 'ItemIcon_Money_Bill', size: 70, circle: 0x3ccd5a, color: 0x8dff6a, words: 0xbaff8c },
    chest: { icon: 'ItemIcon_Chest_Gold', size: 76, circle: 0xffaa1e, color: 0xffd23c, words: 0xffe14a, video: true },
    frenzy: { icon: 'ItemIcon_Energy_Blue', size: 68, circle: 0x3c8cff, color: 0x59c8ff, words: 0x9fe6ff },
    double: { icon: 'ItemIcon_Money_Bill', size: 70, circle: 0xf050aa, color: 0xff8ad0, words: 0xffb8e2, video: true },
};
/** Where it drifts: how far each side of the middle (clear of what's down the sides), how far down the screen. */
const PATH = { half: 110, wideHalf: 260, down: 0.4, bob: 30, waves: 2.5 };
/** A thumb's worth, bigger than it looks. */
const TOUCH = 85;
/** The glass orb it's in (across), the light behind, and the words under it. */
const BUBBLE = { size: 108, glow: 190, rays: 200, words: 30, down: 64, video: 40 };
/** Coming and going (seconds). */
const FADE = 0.45;

export interface FloaterActions {
    /** What's under it now. */
    words(kind: FloaterKind): string;
    taken(kind: FloaterKind, at: PIXI.Point): void;
}

export class Floater extends PIXI.Container {
    private readonly body = new PIXI.Container();
    private readonly glow = sprite('Glow_Circle01', BUBBLE.glow);
    private readonly rays = sprite('Image_Effect_Rotate', BUBBLE.rays);
    private readonly circle = sprite('Wall_orb', BUBBLE.size);
    private readonly shine = sprite('Wall_orb_shine', BUBBLE.size);
    private readonly art = new PIXI.Sprite();
    private readonly label = text('', BUBBLE.words, 0xffffff, 0x14261a, 7);
    private readonly video = sprite('ItemIcon_Video', BUBBLE.video);
    private kind?: FloaterKind;
    private next?: FloaterKind;
    private timer = FLOATING.first;
    private clock = 0;
    private stays = 0;
    private side = 1;
    private count = 0;
    private busy = false;

    public constructor(private readonly actions: FloaterActions) {
        super();
        this.visible = false;
        this.rays.alpha = 0.55;
        this.label.y = this.video.y = BUBBLE.down;
        this.art.anchor.set(0.5);
        this.body.addChild(this.rays, this.glow, this.circle, this.art, this.shine, this.label, this.video);
        this.addChild(this.body);
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.hitArea = new PIXI.Circle(0, 8, TOUCH);
        this.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            // (Not a punch too.)
            event.stopPropagation();
            void this.take();
        });
    }

    /** `playing`: there's a wall to hit; `open`: nothing's over it (it goes on floating between two walls). */
    public update(delta: number, playing: boolean, open: boolean): void {
        if (this.busy) return;
        if (!this.kind) {
            if (!playing || !open || fx('floaters') <= 0) return;
            if (!this.next && WallProgress.wall < FLOATING.fromWall) return;
            this.timer -= delta;
            if (this.timer <= 0) this.appear(this.next ?? this.pick());
            return;
        }
        this.visible = open;
        if (!open) return;
        this.clock += delta;
        if (this.clock >= this.stays || fx('floaters') <= 0) {
            this.leave();
            return;
        }
        this.place();
        this.rays.rotation = this.clock * 0.6;
        this.glow.alpha = 0.5 + 0.2 * Math.sin(this.clock * 5);
        this.body.rotation = Math.sin(this.clock * 2.4) * 0.1;
        this.alpha = Math.max(0, Math.min(1, this.clock / FADE, (this.stays - this.clock) / FADE));
        // (Springs up, then breathes.)
        const t = Math.min(1, this.clock / FADE) - 1;
        this.body.scale.set((1 + t * t * (2.7 * t + 1.7)) * (1 + 0.05 * Math.sin(this.clock * 6)));
        write(this.label, this.actions.words(this.kind));
        this.video.x = -this.label.width / 2 - 7;
    }

    /** This one's the next to come, in a moment. */
    public bring(kind: FloaterKind): void {
        this.next = kind;
        this.timer = Math.min(this.timer, FLOATING.soon);
    }

    /** This one, now. */
    public appear(kind: FloaterKind): void {
        if (this.kind) return;
        this.kind = kind;
        this.next = undefined;
        this.clock = 0;
        this.stays = FLOATING.stays[kind];
        this.side = -this.side;
        this.dress(LOOKS[kind]);
        WallAnalytics.floater(kind, 'visible');
    }

    /** The next in turn, or cash where that isn't there yet. */
    private pick(): FloaterKind {
        const { turn } = FLOATING;
        const kind = turn[this.count++ % turn.length] as FloaterKind;
        if (kind === 'chest' && WallProgress.best < FLOATING.chest.fromWall) return 'cash';
        if (kind === 'frenzy' && (WallProgress.best < FLOATING.frenzy.fromWall || WallProgress.frenzy > 1)) return 'cash';
        return kind;
    }

    private dress({ icon, size, circle, color, words, video }: Look): void {
        const drawn = sprite(icon, size);
        this.art.texture = drawn.texture;
        this.art.scale.copyFrom(drawn.scale);
        drawn.destroy();
        this.circle.tint = circle;
        this.glow.tint = color;
        this.label.style.fill = words;
        // (Where there are no videos it's for nothing.)
        this.video.visible = !!video && PlatformHandler.ENABLE_VIDEO_ADS;
        this.label.x = this.video.visible ? 14 : 0;
    }

    private place(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const half = screen.width > screen.height * 1.15 ? PATH.wideHalf : PATH.half;
        const through = this.clock / this.stays;
        const bob = Math.sin(through * Math.PI * 2 * PATH.waves) * PATH.bob;
        this.position.set(screen.center.x + this.side * half * (through * 2 - 1), screen.topLeft.y + screen.height * PATH.down + bob);
    }

    private leave(): void {
        this.kind = undefined;
        this.visible = false;
        const [least, most] = FLOATING.every;
        this.timer = least + Math.random() * (most - least);
    }

    private async take(): Promise<void> {
        const { kind } = this;
        if (!kind || !this.visible || this.busy) return;
        WallAnalytics.floater(kind, 'interact');
        if (LOOKS[kind].video) {
            this.busy = true;
            const watched = await Gameplay.watchVideo();
            this.busy = false;
            if (this.destroyed) return;
            if (!watched) {
                WallAnalytics.floater(kind, 'no-video');
                WallAudio.play('error');
                return;
            }
        }
        const at = new PIXI.Point(this.x, this.y);
        this.leave();
        WallAudio.play('claim', 0.5, 1.35);
        this.pop(at, LOOKS[kind].color);
        this.actions.taken(kind, at);
    }

    /** A ring and a flash of light where it was. */
    private pop(at: PIXI.Point, color: number): void {
        if (!this.parent) return;
        const ring = new PIXI.Graphics().lineStyle(14, 0xffffff).drawCircle(0, 0, 56);
        ring.tint = color;
        const light = sprite('Glow_Circle01', 220);
        light.tint = color;
        const size = light.scale.x;
        for (const child of [light, ring]) {
            child.eventMode = 'none';
            child.position.copyFrom(at);
            this.parent.addChildAt(child, this.parent.getChildIndex(this));
        }
        gsap.fromTo(ring.scale, { x: 0.4, y: 0.4 }, { x: 1.9, y: 1.9, duration: 0.35, ease: 'power2.out' });
        gsap.to(ring, { alpha: 0, duration: 0.4, onComplete: () => ring.destroy() });
        gsap.to(light.scale, { x: size * 1.4, y: size * 1.4, duration: 0.3 });
        gsap.to(light, { alpha: 0, duration: 0.35, onComplete: () => light.destroy() });
    }
}
