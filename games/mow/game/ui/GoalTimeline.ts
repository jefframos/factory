// GoalTimeline.ts
//
// The city's goal on the HUD (a section with `opensAfter`: Big City's stadium): a bar ending in the goal's picture (its
// snapshot from the editor's Map shots, else its model rendered), with a closed lock per area it takes: on a disc along
// the bar, and the last one in front of the picture. An area restored: the bar fills up to its lock, which shakes and,
// as the bar reaches it, pops open and flies off, a check taking its place on a disc; the last one fills the bar and
// lights the picture up. The discs share the bar's dark outline and sit over it, so it runs into them like sockets.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { ModelIcons } from './ModelIcons';
import { BakedShape } from './BakedShape';
import { loadMiniature } from './TownMiniature';
import { CITY, goalZone } from '../data/MowConfig';

const WIDTH = 340;
const BAR_HEIGHT = 14;
const STEP_RADIUS = 19;
const PICTURE_RADIUS = 40;
/** The locks' size (their longest side), closed and open: on a disc, and in front of the picture. */
const LOCK = { size: 25, open: 32 };
/** `y`: low on the picture, not to hide it. */
const PICTURE_LOCK = { size: 36, open: 44, y: 26 };
/** Its widest reach from its origin (the bar's middle): the HUD fits it between its corners. */
export const GOAL_TIMELINE_HALF_WIDTH = WIDTH / 2 + PICTURE_RADIUS;
/** `outline`: the bar's own dark edge, on every disc. */
const COLORS = { locked: 0x2c3a5c, done: 0x4fc35a, picture: 0x3f8fe0, outline: 0x10151f, openRim: 0xffd23f };
const OUTLINE_WIDTH = 4;
/** The bar's fill, the lock's shake at the end of it, how long the open lock shows, then its flight off (seconds). */
const UNLOCK = { fill: 0.6, shake: 0.35, open: 0.35, flight: 0.4 };

const stepLook = (fill: number) => ({ fill, rim: COLORS.outline, rimWidth: OUTLINE_WIDTH });
const pictureLook = (open: boolean) => ({ fill: COLORS.picture, rim: open ? COLORS.openRim : COLORS.outline, rimWidth: OUTLINE_WIDTH });

function closedLock(size: number): PIXI.Sprite {
    const lock = PIXI.Sprite.from('Icon_Lock03');
    lock.anchor.set(0.5);
    lock.scale.set(size / Math.max(lock.texture.width, lock.texture.height, 1));
    return lock;
}

interface Step {
    /** Its disc along the bar (none for the last: its lock's in front of the picture). */
    disc?: BakedShape;
    lock: PIXI.Sprite;
    /** Where it sits, for the sparks. */
    x: number;
}

export class GoalTimeline extends PIXI.Container {
    private readonly steps: Step[] = [];
    private readonly reveal = new PIXI.Graphics();
    private readonly fill = { share: 0 };
    private readonly picture = new PIXI.Container();
    private readonly pictureDisc = BakedShape.disc(PICTURE_RADIUS, pictureLook(false));
    /** Under the last lock (the picture loads after it's built). */
    private readonly art = new PIXI.Container();
    private count = 0;

    /** `icon`: the goal's model (./mow/models/… url); `done`: the areas already restored. */
    public constructor(private readonly needs: number, icon: string | undefined, done: number) {
        super();
        this.eventMode = 'none';
        const bar = UiKit.image('hud', 'barBack', WIDTH, BAR_HEIGHT);
        const fill = UiKit.image('hud', 'barFill', WIDTH - 4, BAR_HEIGHT - 4);
        fill.mask = this.reveal;
        this.addChild(bar, fill, this.reveal);
        for (let i = 0; i < needs - 1; i++) this.addStep(i);
        this.buildPicture(icon);
        this.count = Math.min(needs, done);
        for (let i = 0; i < this.count; i++) this.showDone(i);
        this.fill.share = this.shareAt(this.count);
        this.drawFill();
        if (this.count >= needs) this.lightPicture(false);
    }

    /** Where a disc sits along the bar (0..1): the same clear gap before each and between the last and the picture. */
    private stepShare(i: number): number {
        const discs = this.needs - 1;
        const gap = (WIDTH - PICTURE_RADIUS - discs * STEP_RADIUS * 2) / (discs + 1);
        return ((i + 1) * gap + (i * 2 + 1) * STEP_RADIUS) / WIDTH;
    }

    /** How far the bar's filled at `count` locks gone: up to the last one gone, all the way when they all are. */
    private shareAt(count: number): number {
        return count >= this.needs ? 1 : count > 0 ? this.stepShare(count - 1) : 0;
    }

    private addStep(i: number): void {
        const x = -WIDTH / 2 + WIDTH * this.stepShare(i);
        const disc = BakedShape.disc(STEP_RADIUS, stepLook(COLORS.locked));
        disc.x = x;
        const lock = closedLock(LOCK.size);
        lock.x = x;
        this.addChild(disc, lock);
        this.steps.push({ disc, lock, x });
    }

    private buildPicture(icon: string | undefined): void {
        this.picture.x = WIDTH / 2;
        const lock = closedLock(PICTURE_LOCK.size);
        lock.y = PICTURE_LOCK.y;
        this.picture.addChild(this.pictureDisc, this.art, lock);
        this.addChild(this.picture);
        this.steps.push({ lock, x: this.picture.x });
        const place = (texture: PIXI.Texture) => {
            if (this.destroyed) return;
            const sprite = new PIXI.Sprite(texture);
            sprite.anchor.set(0.5);
            sprite.scale.set((PICTURE_RADIUS * 2.1) / Math.max(texture.width, texture.height, 1));
            this.art.addChild(sprite);
        };
        void (async () => {
            const texture = await loadMiniature(`${goalZone(CITY)}-small`) ?? (icon ? await ModelIcons.get(icon) : undefined);
            place(texture ?? PIXI.Texture.from('ItemIcon_Star_Gold'));
        })();
    }

    private drawFill(): void {
        const inner = WIDTH - 4;
        this.reveal.clear().beginFill(0xffffff).drawRect(-inner / 2, -BAR_HEIGHT / 2, inner * this.fill.share, BAR_HEIGHT).endFill();
    }

    /** A step done, its lock already off: a disc goes green with a check on it. */
    private showDone(i: number): void {
        const step = this.steps[i];
        step.lock.visible = false;
        if (!step.disc) return;
        step.disc.setLook(stepLook(COLORS.done));
        const check = UiKit.sprite('hud', 'check');
        check.scale.set((STEP_RADIUS * 1.2) / Math.max(check.width, check.height, 1));
        check.x = step.x;
        this.addChild(check);
    }

    /** `count` areas restored now: each new one's lock comes off, and the bar fills. */
    public setCount(count: number): void {
        const next = Math.min(this.needs, count);
        if (next === this.count) return;
        const from = this.count;
        const opened = next >= this.needs;
        this.count = next;
        // The locks shake as the bar comes up to them.
        gsap.delayedCall(UNLOCK.fill - UNLOCK.shake, () => {
            if (this.destroyed) return;
            for (let i = from; i < next; i++) UiAnim.shake(this.steps[i].lock, 4, UNLOCK.shake);
        });
        gsap.to(this.fill, {
            share: this.shareAt(next),
            duration: UNLOCK.fill,
            ease: 'power2.inOut',
            onUpdate: () => {
                if (!this.destroyed) this.drawFill();
            },
            onComplete: () => {
                if (this.destroyed) return;
                for (let i = from; i < next; i++) this.unlock(i);
                if (opened) this.lightPicture(true);
            },
        });
    }

    private unlock(i: number): void {
        const { lock, disc, x } = this.steps[i];
        // The bar's reached it: open, then off, a check in its place.
        lock.texture = PIXI.Texture.from('Icon_Lock02');
        lock.scale.set((disc ? LOCK.open : PICTURE_LOCK.open) / Math.max(lock.texture.width, lock.texture.height, 1));
        disc?.setLook(stepLook(COLORS.done));
        UiAnim.punch(lock, 0.35);
        UiAnim.sparkBurst(this, x, lock.y, 0xffe066, disc ? 46 : 70);
        gsap.to(lock, {
            rotation: 0.7,
            alpha: 0,
            duration: UNLOCK.flight,
            delay: UNLOCK.open,
            ease: 'power1.in',
            onComplete: () => {
                if (this.destroyed) return;
                this.showDone(i);
                if (disc) UiAnim.punch(disc, 0.3);
            },
        });
        gsap.to(lock.position, { y: lock.y - 40, duration: UNLOCK.flight, delay: UNLOCK.open, ease: 'back.in(1.4)' });
    }

    /** The goal's open: a gold rim, turning rays behind it, pulsing. */
    private lightPicture(animate: boolean): void {
        this.pictureDisc.setLook(pictureLook(true));
        UiAnim.rays(this.picture, PICTURE_RADIUS * 1.9, 0xfff0a0, 0.75, 6);
        if (animate) UiAnim.punch(this.picture, 0.4);
        UiAnim.pulse(this.picture, 0.06, 0.6);
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        gsap.killTweensOf(this.fill);
        UiAnim.kill(this);
        super.destroy(options);
    }
}
