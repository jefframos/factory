// Rewind.ts
//
// Rewinding, as the player sees it: its button (the medals, filling up till they can be cashed in), the popup that says what
// it does (all damage up for good, what's kept, what's reset; and, before it's ready, how far off it is), and the show when
// it's done (the clock spinning back, the walls counting down to 1, what it brought).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { Gameplay } from '../ads/Gameplay';
import { WallAnalytics } from '../analytics/WallAnalytics';
import { WallAudio } from '../audio/WallAudio';
import { REWIND, MEDAL, short } from '../data/WallConfig';
import { WallProgress } from '../data/WallProgress';
import { Clock } from './Clock';
import { HudBar } from './HudBar';
import { fit, flag, frame, sprite, text, write } from './parts';
import { toolArt } from './Wardrobe';

const BUTTON = { size: 118, icon: 92, pill: 32, below: 20 };
const PANEL = { width: 640, height: 910 };
const COLORS = { panel: 0x5b2bd0, inner: 0x7a48f0, keep: 0x2fbf5b, lose: 0xe0405a };
const ITEM = { size: 92, gap: 16 };
/** Medals won: the big one and the small (sizes), how long it's held up, how many fly at most, how far they scatter. */
const FLY = { big: 220, small: 72, hold: 0.62, most: 10, scatter: 170, every: 0.055 };
const SHOW = { in: 0.3, spin: 2, hold: 1.7, out: 0.45 };

/** How far along to rewinding, as a share (`left`: what's left of the wall). */
export function rewindShare(left: number): number {
    return WallProgress.canRewind ? 1 : Math.max(0, Math.min(1, (WallProgress.wall - left) / (REWIND.wall - 1)));
}

export const rewindKnown = (): boolean => WallProgress.best >= MEDAL.wall || WallProgress.rewinds > 0;

// ---------------------------------------------------------------- the button

export class RewindButton extends PIXI.Container {
    private readonly focus = frame('ItemFrame_FocusLine', [36, 35, 36, 35], BUTTON.size + 14, BUTTON.size + 14);
    private readonly medal = sprite('ItemIcon_Badge_Gold', BUTTON.icon);
    private readonly medalScale = this.medal.scale.x;
    private readonly count = text('', 34, 0xffffff, 0x100e18, 8);
    private readonly pill = new PIXI.Container();
    private readonly fill = frame('BasicFrame_Round12', [12, 12, 12, 12], BUTTON.size - 8, 24, 0.8);
    private readonly pillText = text('', 20, 0xffffff, 0x100e18, 5);
    private readonly ready = flag(text('READY!', 23, 0xffffff), 104);
    /** What rewinding's brought so far: a trophy, and all damage. */
    private readonly won = new PIXI.Container();
    private readonly mult = text('', 27, 0xffe14a, 0x2a0f5c, 7);
    private clock = 0;
    private shown = -1;

    public constructor(open: () => void) {
        super();
        const back = frame('ItemFrame03_Single_Yellow', [53, 53, 54, 56], BUTTON.size, BUTTON.size, 0.92);
        const glow = sprite('ItemFrame_BgGlow', BUTTON.size - 10);
        glow.tint = 0xfff578;
        glow.alpha = 0.8;
        this.medal.y = -4;
        this.count.anchor.set(1, 0.5);
        this.count.position.set(BUTTON.size / 2 - 10, BUTTON.size / 2 - 22);
        // What it's for, in its corner.
        const corner = sprite('BorderFrame_Circle78', 46);
        corner.tint = 0x9650ff;
        const turn = sprite('PictoIcon_Refresh_1', 26);
        turn.scale.x *= -1;
        corner.position.set(-BUTTON.size / 2 + 13, -BUTTON.size / 2 + 12);
        turn.position.set(corner.x, corner.y - 1);
        const edge = frame('BasicFrame_Round12', [12, 12, 12, 12], BUTTON.size, BUTTON.pill);
        edge.tint = 0x100e18;
        const inside = frame('BasicFrame_Round12', [12, 12, 12, 12], BUTTON.size - 8, 24, 0.8);
        inside.tint = 0x46326e;
        this.fill.tint = 0xb06bff;
        this.pill.y = BUTTON.size / 2 + BUTTON.below;
        this.pill.addChild(edge, inside, this.fill, this.pillText);
        this.ready.y = BUTTON.size / 2 + 12;
        const strip = frame('BasicFrame_Round12', [12, 12, 12, 12], BUTTON.size, 40);
        strip.tint = 0x3a1a8c;
        const trophy = sprite('ItemIcon_Trophy_Gold', 50);
        trophy.position.set(-BUTTON.size / 2 + 20, -3);
        this.mult.x = 18;
        this.mult.y = -2;
        this.won.addChild(strip, trophy, this.mult);
        this.won.y = BUTTON.size / 2 + 64;
        this.addChild(this.focus, back, glow, this.medal, this.count, corner, turn, this.pill, this.ready, this.won);
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            open();
        });
    }

    /** Where the medals fly to, in its parent's units. */
    public get target(): PIXI.Point {
        return new PIXI.Point(this.x, this.y - 4);
    }

    /** Some medals have got here: a jump, and they're counted. */
    public got(count: number): void {
        this.shown += count;
        gsap.killTweensOf(this.scale);
        this.scale.set(1.22);
        gsap.to(this.scale, { x: 1, y: 1, duration: 0.45, ease: 'elastic.out(1, 0.4)' });
    }

    /** `flying`: some are on their way (not counted till they're here). */
    public update(delta: number, left: number, flying: boolean): void {
        if (!flying || this.shown < 0) this.shown = WallProgress.runMedals;
        write(this.count, short(this.shown), 90);
        this.clock += delta;
        const can = WallProgress.canRewind;
        this.focus.visible = this.ready.visible = can;
        this.focus.alpha = 0.6 + 0.4 * Math.sin(this.clock * 5);
        this.ready.rotation = Math.sin(this.clock * 6) * 0.04;
        this.pill.visible = !can;
        this.fill.width = Math.max(22, (BUTTON.size - 8) * rewindShare(left)) / 0.8;
        write(this.pillText, `WALL ${WallProgress.wall}/${REWIND.wall}`, BUTTON.size - 18);
        this.medal.rotation = can ? Math.sin(this.clock * 9) * 0.08 : 0;
        this.medal.scale.set(this.medalScale * (can ? 1.05 + 0.06 * Math.sin(this.clock * 6) : 1));
        // What it's brought so far.
        this.won.visible = WallProgress.medalMult > 1;
        if (this.won.visible) write(this.mult, `x${short(WallProgress.medalMult)}`, BUTTON.size - 52);
    }
}

// ---------------------------------------------------------------- the prize

/**
 * Medals won: a big one springs up in a burst of light, then bursts into small ones that scatter and stream to the button,
 * each with its ring. Owns itself: gone when it's over.
 */
export class MedalFly extends PIXI.Container {
    public constructor(from: PIXI.Point, to: PIXI.Point, count: number, private readonly arrived: (count: number, last: boolean) => void) {
        super();
        this.eventMode = 'none';
        const rays = sprite('Image_Effect_Rotate', 560);
        const glow = sprite('ItemFrame_BgGlow', 420);
        glow.tint = 0xffd23c;
        const big = sprite('ItemIcon_Badge_Gold', FLY.big);
        const size = big.scale.x;
        const label = text(`+${count}`, 84, 0xffe14a, 0x7a3a00, 13);
        for (const child of [rays, glow, big]) child.position.copyFrom(from);
        label.position.set(from.x, from.y + FLY.big * 0.62);
        this.addChild(rays, glow, big, label);
        // Up it springs.
        gsap.fromTo(rays, { alpha: 0 }, { alpha: 0.9, duration: 0.2 });
        gsap.to(rays, { rotation: 1.6, duration: 1.3, ease: 'none' });
        gsap.fromTo(glow.scale, { x: glow.scale.x * 0.2, y: glow.scale.y * 0.2 }, { x: glow.scale.x, y: glow.scale.y, duration: 0.3, ease: 'back.out(2)' });
        gsap.fromTo(big.scale, { x: size * 0.45, y: size * 0.45 }, { x: size, y: size, duration: 0.4, ease: 'back.out(2.6)' });
        gsap.fromTo(label.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.35, delay: 0.18, ease: 'back.out(3)' });
        this.sparkle(from, 10, 250, 46);
        // A breath, and it bursts.
        gsap.to(big.scale, { x: size * 0.8, y: size * 1.12, duration: 0.12, delay: FLY.hold - 0.12, ease: 'power2.in' });
        gsap.delayedCall(FLY.hold, () => this.burst(from, to, count, [rays, glow, big, label]));
    }

    private burst(from: PIXI.Point, to: PIXI.Point, count: number, gone: PIXI.Container[]): void {
        const [rays, glow, big, label] = gone;
        big.visible = false;
        gsap.to([rays, glow], { alpha: 0, duration: 0.3 });
        gsap.to(label, { alpha: 0, y: label.y - 50, duration: 0.45, delay: 0.25 });
        const ring = new PIXI.Graphics().lineStyle(16, 0xfff3b0).drawCircle(0, 0, 100);
        ring.position.copyFrom(from);
        this.addChild(ring);
        gsap.fromTo(ring.scale, { x: 0.4, y: 0.4 }, { x: 2.2, y: 2.2, duration: 0.4, ease: 'power2.out' });
        gsap.to(ring, { alpha: 0, duration: 0.4 });
        this.sparkle(from, 8, 330, 38);
        WallAudio.play('claim', 0.8, 1.4);
        const many = Math.min(FLY.most, count);
        let left = many;
        for (let i = 0; i < many; i++) {
            const medal = sprite('ItemIcon_Badge_Gold', FLY.small);
            const size = medal.scale.x;
            const a = (i / many) * Math.PI * 2 + Math.random() * 0.5;
            const far = FLY.scatter * (0.65 + Math.random() * 0.5);
            const spot = { x: from.x + Math.cos(a) * far, y: from.y + Math.sin(a) * far * 0.8 };
            medal.position.copyFrom(from);
            this.addChild(medal);
            gsap.fromTo(medal.scale, { x: 0, y: 0 }, { x: size, y: size, duration: 0.25, ease: 'back.out(2)' });
            gsap.to(medal, { x: spot.x, y: spot.y, rotation: (Math.random() - 0.5) * 1.4, duration: 0.38, ease: 'power3.out' });
            // One after another, round in a bow.
            const state = { t: 0 };
            const bow = { x: (spot.x + to.x) / 2 + (Math.random() - 0.2) * 220, y: Math.min(spot.y, to.y) - 60 - Math.random() * 120 };
            gsap.to(state, { t: 1, duration: 0.55, delay: 0.42 + i * FLY.every, ease: 'power2.in', onUpdate: () => {
                const { t } = state;
                const u = 1 - t;
                medal.position.set(u * u * spot.x + 2 * u * t * bow.x + t * t * to.x, u * u * spot.y + 2 * u * t * bow.y + t * t * to.y);
                medal.rotation *= 0.94;
                medal.scale.set(size * (1 - 0.3 * t));
            }, onComplete: () => {
                medal.visible = false;
                left--;
                // (What doesn't share out evenly goes with the last.)
                const each = Math.floor(count / many);
                this.arrived(left === 0 ? count - each * (many - 1) : each, left === 0);
                this.sparkle(to, 3, 90, 26);
                WallAudio.play('coins', 0.45, 1.1 + i * 0.05);
                if (left === 0) gsap.delayedCall(0.8, () => !this.destroyed && this.destroy({ children: true }));
            } });
        }
    }

    private sparkle(at: PIXI.Point, count: number, far: number, size: number): void {
        for (let i = 0; i < count; i++) {
            const star = sprite('Image_Effect_Star01_Yellow', size * (0.7 + Math.random() * 0.6));
            const full = star.scale.x;
            const a = (i / count) * Math.PI * 2 + Math.random() * 0.6;
            const reach = far * (0.6 + Math.random() * 0.5);
            star.position.copyFrom(at);
            this.addChild(star);
            gsap.to(star, { x: at.x + Math.cos(a) * reach, y: at.y + Math.sin(a) * reach, rotation: Math.random() * 3, duration: 0.6, ease: 'power3.out' });
            gsap.fromTo(star.scale, { x: full, y: full }, { x: 0, y: 0, duration: 0.6, ease: 'power2.in', onComplete: () => {
                star.visible = false;
            } });
        }
    }
}

// ---------------------------------------------------------------- the popup

export class RewindPopup extends PIXI.Container {
    public isOpen = false;
    private readonly dim = new PIXI.Graphics();
    private readonly panel = new PIXI.Container();
    private readonly cup = sprite('ItemIcon_Badge_Gold', 180);
    private readonly rays = sprite('Image_Effect_Rotate', 420);
    private readonly stars = [[-170, -40, 46], [168, -70, 54], [190, 40, 34], [-186, 60, 32]].map(([x, y, size]) => {
        const star = sprite('Image_Effect_Star01_Yellow', size);
        star.position.set(x, y);
        return star;
    });
    private body = new PIXI.Container();
    private bar?: HudBar;
    private time = 0;

    public constructor(private readonly onRewind: () => void, private readonly onToggle: (open: boolean) => void) {
        super();
        this.visible = false;
        this.dim.eventMode = 'static';
        this.dim.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.dim.on('pointertap', () => this.setOpen(false));
        const back = frame('CardFrame03_n_Bg', [30, 29, 30, 33], PANEL.width, PANEL.height);
        back.tint = COLORS.panel;
        const inner = frame('CardFrame03_n_InnerBg', [18, 18, 18, 18], PANEL.width - 30, PANEL.height - 30);
        inner.tint = COLORS.inner;
        back.eventMode = 'static';
        back.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        const top = new PIXI.Container();
        top.y = -PANEL.height / 2 + 186;
        top.addChild(this.rays, this.cup, ...this.stars);
        const ribbon = sprite('Title_Ribbon04_Red', 480);
        ribbon.y = -PANEL.height / 2 + 4;
        const title = text('REWIND', 50, 0xffffff, 0x5c0f16, 9);
        title.y = -PANEL.height / 2 - 8;
        const close = sprite('Icon_Close02', 52);
        close.position.set(PANEL.width / 2 - 50, -PANEL.height / 2 + 52);
        close.eventMode = 'static';
        close.cursor = 'pointer';
        close.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        close.on('pointertap', () => this.setOpen(false));
        this.panel.addChild(back, inner, top, this.body, ribbon, title, close);
        this.addChild(this.dim, this.panel);
    }

    public setOpen(open: boolean): void {
        if (open === this.isOpen) return;
        this.isOpen = open;
        this.visible = open;
        Gameplay.setBlocked('rewind', open);
        this.onToggle(open);
        WallAudio.play('claim', 0.5, open ? 0.8 : 0.9);
        if (!open) return;
        WallAnalytics.panel(WallProgress.canRewind ? 'rewind-ready' : 'rewind-early');
        void Gameplay.commercialBreak();
        this.build();
        this.reposition();
        gsap.killTweensOf(this.panel.scale);
        const { x } = this.panel.scale;
        gsap.fromTo(this.panel.scale, { x: x * 0.6, y: x * 0.6 }, { x, y: x, duration: 0.35, ease: 'back.out(1.8)' });
    }

    private build(): void {
        this.body.destroy({ children: true });
        this.body = new PIXI.Container();
        this.panel.addChildAt(this.body, 3);
        const add = (child: PIXI.Container, x: number, y: number) => {
            child.position.set(x, y);
            this.body.addChild(child);
            return child;
        };
        const top = -PANEL.height / 2;
        const can = WallProgress.canRewind;
        // What it does, in one line; and the numbers.
        const trade = WallProgress.runMedals > 0 ? `CASH IN ${short(WallProgress.runMedals)} MEDALS!` : 'WIN MEDALS!';
        add(text(trade, 38, 0xffffff, 0x2a0f5c, 8), 0, top + 304);
        add(text(`+${Math.round(REWIND.perMedal * 100)}% DAMAGE EACH, FOREVER`, 28, 0xffe14a, 0x2a0f5c, 7), 0, top + 347);
        add(text('YOU START AGAIN AT WALL 1', 22, 0xe6d6ff, 0x2a0f5c, 5), 0, top + 380);
        const now = text(`x${short(WallProgress.medalMult)}`, 46, 0xd9c8ff, 0x2a0f5c, 8);
        const then = text(`x${short(Math.max(WallProgress.multAfterRewind, WallProgress.medalMult))}`, 78, 0xffe14a, 0x7a3a00, 12);
        const arrow = sprite('Icon_Arrow_Next1', 46);
        arrow.tint = 0xffffff;
        const gap = 34;
        const span = now.width + arrow.width + then.width + gap * 2;
        add(now, -span / 2 + now.width / 2, top + 440);
        add(arrow, -span / 2 + now.width + gap + arrow.width / 2, top + 442);
        add(then, span / 2 - then.width / 2, top + 436);
        gsap.fromTo(then.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.6, delay: 0.15, ease: 'elastic.out(1, 0.45)' });
        // What's kept, and what's given up.
        const row = (title: string, color: number, y: number, items: [PIXI.Container, string][]) => {
            const strip = frame('BasicFrame_Round12', [12, 12, 12, 12], PANEL.width - 70, 150);
            strip.tint = 0x2a0f5c;
            strip.alpha = 0.45;
            strip.y += y;
            this.body.addChild(strip);
            const label = text(title, 27, color, 0x1a0838, 6);
            label.anchor.set(0, 0.5);
            // (Four of them, closer; the words in what's left.)
            const step = ITEM.size + (items.length > 3 ? 6 : ITEM.gap);
            const left = -PANEL.width / 2 + 52;
            fit(label, Math.min(150, PANEL.width / 2 - 92 - (items.length - 1) * step - ITEM.size / 2 - 12 - left));
            add(label, left, y);
            items.forEach(([art, name], i) => {
                const x = PANEL.width / 2 - 92 - (items.length - 1 - i) * step;
                add(frameAt('ItemFrame02_Single_' + (color === COLORS.keep ? 'Green' : 'Gray'), ITEM.size), x, y - 14);
                add(art, x, y - 16);
                const words = text(name, 20, 0xffffff, 0x1a0838, 5);
                fit(words, ITEM.size + (items.length > 3 ? 2 : 12));
                add(words, x, y + 48);
            });
        };
        const picto = sprite('PictoIcon_Clothes', 62);
        row('YOU KEEP', COLORS.keep, top + 568, [[sprite('ItemIcon_Badge_Gold', 66), 'MEDALS'], [sprite('ItemIcon_Star_Gold', 66), 'BOOSTS'], [picto, 'LOOKS']]);
        row('YOU RESET', 0xff8a9a, top + 734, [[toolArt(WallProgress.tool.base === 'fists' ? { base: 'fists' } : WallProgress.tool, 68), 'PUNCH'], [sprite('ItemIcon_Money_Bill', 66), 'CASH'], [sprite('Wall_brick', 66), 'BRICKS'], [sprite('Wall_chick', 66), 'CREW']]);
        // The button, or how far off it is.
        this.bar = undefined;
        if (can) {
            const button = new PIXI.Container();
            const words = text('REWIND NOW!', 40, 0xffffff, 0x1d5a1d, 8);
            words.y = -4;
            button.addChild(frame('Button01_s_Green', [28, 31, 28, 60], 400, 96, 0.85), words);
            button.eventMode = 'static';
            button.cursor = 'pointer';
            button.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
            button.on('pointertap', () => {
                this.setOpen(false);
                this.onRewind();
            });
            add(button, 0, PANEL.height / 2 - 6);
            gsap.to(button.scale, { x: 1.06, y: 1.06, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' });
            return;
        }
        this.bar = new HudBar(420, 52, 0xb06bff);
        add(this.bar, -210, PANEL.height / 2 - 8);
        this.bar.setShare(rewindShare(1));
        add(text(`READY AT WALL ${REWIND.wall}`, 27, 0xffffff, 0x2a0f5c, 6), 0, PANEL.height / 2 - 10);
    }

    public update(delta: number): void {
        if (!this.isOpen) return;
        this.time += delta;
        this.cup.y = Math.sin(this.time * 2.4) * 7;
        this.cup.rotation = Math.sin(this.time * 1.7) * 0.07;
        this.rays.rotation += delta * 0.4;
        this.stars.forEach((star, i) => {
            star.alpha = 0.5 + 0.5 * Math.sin(this.time * 3 + i * 1.7);
            star.rotation = Math.sin(this.time * 1.5 + i) * 0.25;
        });
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen || !this.isOpen) return;
        const { topLeft, width, height, center } = screen;
        this.dim.clear().beginFill(0x0c0618, 0.78).drawRect(topLeft.x - 400, topLeft.y - 400, width + 800, height + 800).endFill();
        this.panel.position.set(center.x, center.y + 6);
        // (Its ribbon over its top, its button over its foot.)
        this.panel.scale.set(Math.min(1, (height - 60) / (PANEL.height + 150), (width - 30) / PANEL.width));
    }
}

const frameAt = (name: string, size: number): PIXI.Container => {
    const made = new PIXI.Container();
    made.addChild(frame(name, [25, 28, 25, 27], size, size));
    return made;
};

// ---------------------------------------------------------------- the show

export class RewindShow extends PIXI.Container {
    private readonly cover = new PIXI.Graphics();
    private readonly rays = sprite('Image_Effect_Rotate', 1500);
    private readonly clock = new Clock(150);
    private readonly count = text('', 84, 0xffffff, 0x2a0f5c, 14);
    private readonly gain = text('', 46, 0xe6c8ff, 0x2a0f5c, 9);
    private readonly trophy = sprite('ItemIcon_Trophy_Gold', 150);
    private readonly mult = text('', 128, 0xffe14a, 0x7a3a00, 18);
    private readonly middle = new PIXI.Container();
    private ticked = 0;

    public constructor() {
        super();
        this.visible = false;
        this.eventMode = 'static';
        this.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.rays.alpha = 0.35;
        this.clock.y = -70;
        this.rays.y = -70;
        this.count.y = 170;
        this.gain.y = 160;
        this.mult.position.set(70, 250);
        this.trophy.y = 250;
        this.middle.addChild(this.rays, this.clock, this.count, this.gain, this.mult, this.trophy);
        this.addChild(this.cover, this.middle);
    }

    /** `covered`: called once nothing else is to be seen; `done`: when it's over. */
    public play(wall: number, medals: number, before: number, after: number, covered: () => void, done: () => void): void {
        this.visible = true;
        this.reposition();
        this.alpha = 0;
        this.gain.visible = this.mult.visible = this.trophy.visible = false;
        this.count.visible = true;
        this.clock.speed = 0.4;
        this.ticked = wall;
        write(this.count, `WALL ${wall}`);
        const state = { wall, mult: before };
        const timeline = gsap.timeline();
        timeline.to(this, { alpha: 1, duration: SHOW.in, onComplete: covered });
        timeline.fromTo(this.clock.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.5, ease: 'back.out(2)' }, 0);
        // Back through the walls, faster and faster.
        timeline.to(this.clock, { speed: 5, duration: SHOW.spin, ease: 'power2.in' });
        timeline.to(state, { wall: 1, duration: SHOW.spin, ease: 'power2.in', onUpdate: () => {
            const number = Math.round(state.wall);
            if (number === this.ticked) return;
            this.ticked = number;
            write(this.count, `WALL ${number}`);
            WallAudio.play('swing', 1, 1.2 + (1 - number / wall) * 0.8);
        } }, '<');
        // What it brought.
        timeline.call(() => {
            this.count.visible = false;
            this.gain.visible = this.mult.visible = this.trophy.visible = true;
            write(this.mult, `x${short(after)}`);
            this.trophy.x = -this.mult.width / 2 - 20;
            write(this.gain, `${short(medals)} MEDALS   ALL DAMAGE`, 640);
            this.clock.speed = 0.3;
            WallAudio.play('boom');
            WallAudio.play('tool', 1, 0.8);
            gsap.fromTo(this.mult.scale, { x: 0.2, y: 0.2 }, { x: 1, y: 1, duration: 0.6, ease: 'elastic.out(1, 0.4)' });
            gsap.fromTo(this.clock.scale, { x: 1.35, y: 1.35 }, { x: 1, y: 1, duration: 0.5, ease: 'back.out(2)' });
        });
        timeline.to(state, { mult: after, duration: 0.7, ease: 'power2.out', onUpdate: () => write(this.mult, `x${short(state.mult)}`) });
        timeline.to(this, { alpha: 0, duration: SHOW.out, delay: SHOW.hold - 0.7, onComplete: () => {
            this.visible = false;
            done();
        } });
    }

    public update(delta: number): void {
        if (!this.visible) return;
        this.clock.update(delta);
        this.rays.rotation -= delta * (0.2 + this.clock.speed * 0.25);
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const { topLeft, width, height, center } = screen;
        this.cover.clear().beginFill(0x3a1a8c).drawRect(topLeft.x - 400, topLeft.y - 400, width + 800, height + 800).endFill();
        this.middle.position.copyFrom(center);
        this.middle.scale.set(Math.min(1, height / 1000));
    }
}
