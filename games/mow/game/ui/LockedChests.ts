// LockedChests.ts
//
// Locked chests (a treasure with `locked`, found in the grass): they don't pay at once. Each waits on the HUD — the
// chest button (left side, with how many are waiting) — and tapping it opens the chest panel: the chest, what's inside
// (money, for now) and OPEN with the video badge (a rewarded video; the scene plays it and pays), or the close button. The scene
// owns both (MowScene: lockedChestButton / lockedChestPanel) and says what's waiting (setWaiting, show).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { MowAudio } from '../audio/MowAudio';
import { shortMoney } from '../data/MowConfig';

const BUTTON = 96;
const CARD = { width: 520, height: 560 };

const text = (value: string, size: number, fill: number, stroke = 0x1d140e) => {
    const label = new PIXI.Text(value, new PIXI.TextStyle({ fontFamily: UiKit.fontFamily('primary'), fontSize: size, fill, stroke, strokeThickness: Math.max(4, size / 5), lineJoin: 'round' }));
    label.anchor.set(0.5);
    return label;
};

/** Taps on HUD buttons must not also start the movement joystick underneath. */
function tappable(target: PIXI.Container, onTap: () => void): void {
    target.eventMode = 'static';
    target.cursor = 'pointer';
    target.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
    target.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
        event.stopPropagation();
        MowAudio.play('click');
        UiAnim.punch(target, 0.12);
        onTap();
    });
}

/** The chest (the kit's chained chest icon) fitted to `size`. */
function chestPicture(size: number): PIXI.Container {
    const holder = new PIXI.Container();
    const sprite = PIXI.Sprite.from('ItemIcon_Chest_Wood');
    sprite.anchor.set(0.5);
    sprite.scale.set(size / Math.max(sprite.texture.width, sprite.texture.height, 1));
    holder.addChild(sprite);
    return holder;
}

/** The HUD's chest button: the chest, a shine behind it, a count badge; shown while chests wait. */
export class LockedChestButton extends PIXI.Container {
    private readonly count = text('1', 24, 0xffffff);
    private waiting = 0;

    public constructor(onTap: () => void) {
        super();
        const shine = PIXI.Sprite.from('Image_Effect_Rotate');
        shine.anchor.set(0.5);
        shine.scale.set((BUTTON * 1.5) / Math.max(shine.texture.width, shine.texture.height, 1));
        shine.tint = 0xffe27a;
        shine.alpha = 0.7;
        shine.eventMode = 'none';
        gsap.to(shine, { rotation: Math.PI * 2, duration: 6, ease: 'none', repeat: -1 });
        const chest = chestPicture(BUTTON);
        UiAnim.pulse(chest, 0.06, 0.6);
        const badge = new PIXI.Container();
        badge.position.set(BUTTON / 2 - 10, -BUTTON / 2 + 12);
        badge.addChild(new PIXI.Graphics().beginFill(0x1d140e).drawCircle(0, 0, 19).endFill().beginFill(0xe8323f).drawCircle(0, 0, 16).endFill(), this.count);
        this.addChild(shine, chest, badge);
        this.hitArea = new PIXI.Rectangle(-BUTTON / 2, -BUTTON / 2, BUTTON, BUTTON);
        tappable(this, onTap);
        this.visible = false;
    }

    /** How many chests wait (0: hidden; a new one pops it in). */
    public setWaiting(count: number): void {
        if (count === this.waiting) return;
        const more = count > this.waiting;
        this.waiting = count;
        this.count.text = `${count}`;
        this.visible = count > 0;
        if (this.visible && more) UiAnim.popIn(this);
    }

    public override destroy(): void {
        this.children.forEach((child) => gsap.killTweensOf(child));
        super.destroy({ children: true });
    }
}

/** The shine: where the chest is in the card, and the twinkles round it (x, y, size). */
const CHEST_Y = -80;
const TWINKLES = [[-160, -150, 84], [168, -124, 100], [150, 0, 66], [-172, -20, 70]];

/**
 * The chest panel: a dim over the screen, and the card — a golden ribbon with its title, the red close button, the chest
 * with golden rays turning and a glow behind it, its money, and OPEN with a video badge.
 */
export class LockedChestPanel extends PIXI.Container {
    private readonly dim = new PIXI.Graphics();
    private readonly card = new PIXI.Container();
    private readonly reward = text('', 48, 0xffe27a);
    private readonly openLabel = text('OPEN', 42, 0xffffff, 0x1d5a1d);
    private readonly open = new PIXI.Container();
    private readonly ribbon = new PIXI.Container();
    private readonly chest = chestPicture(270);
    private readonly glow = new PIXI.Container();
    private readonly twinkles: PIXI.Container[] = [];
    private rocking?: gsap.core.Timeline;
    private busy = false;
    /** The cash bursting out of an opened chest (over the card). */
    private readonly burst = new PIXI.Container();

    public constructor(private readonly onOpen: () => void, private readonly onClose: () => void) {
        super();
        this.dim.eventMode = 'static';
        this.dim.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        const back = UiKit.image('chest', 'panel', CARD.width, CARD.height);
        back.eventMode = 'static';
        back.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());

        // The shine, kept inside the card.
        const shine = new PIXI.Container();
        shine.eventMode = 'none';
        const inside = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(-CARD.width / 2 + 8, -CARD.height / 2 + 8, CARD.width - 16, CARD.height - 28, 24).endFill();
        shine.mask = inside;
        shine.addChild(inside, this.shineSprite('Image_Effect_Rotate', 720, 0xffc428, 0.75, 16), this.glow);
        this.glow.y = CHEST_Y;
        for (const color of [0xffcd3c, 0xffec96]) {
            const sprite = this.shineSprite('Glow_Circle01', 460, color, 1);
            sprite.y = 0;
            this.glow.addChild(sprite);
        }

        this.chest.y = CHEST_Y;
        for (const [x, y, size] of TWINKLES) {
            const twinkle = new PIXI.Container();
            const star = this.shineSprite('Image_Effect_Star01_Yellow', size, 0xffffff, 1);
            star.y = 0;
            twinkle.addChild(star);
            twinkle.position.set(x, y);
            twinkle.eventMode = 'none';
            this.twinkles.push(twinkle);
        }

        const rewardBack = UiKit.image('chest', 'rewardBack', 280, 64);
        rewardBack.position.set(14, 84);
        const bill = PIXI.Sprite.from('ItemIcon_Money_Bill');
        bill.anchor.set(0.5);
        bill.scale.set(92 / Math.max(bill.texture.width, bill.texture.height, 1));
        bill.position.set(-122, 82);
        this.reward.position.set(36, 82);

        this.open.y = CARD.height / 2 - 84;
        const video = PIXI.Sprite.from('ItemIcon_Video');
        video.anchor.set(0.5);
        video.scale.set(64 / Math.max(video.texture.width, video.texture.height, 1));
        video.position.set(-78, -4);
        this.openLabel.position.set(30, -4);
        this.open.addChild(UiKit.image('chest', 'openButton', 300, 92), video, this.openLabel);
        tappable(this.open, () => {
            if (!this.busy) this.onOpen();
        });

        const title = text('LOCKED CHEST', 36, 0xffffff, 0x8a4a00);
        title.y = -8;
        this.ribbon.addChild(UiKit.sprite('chest', 'ribbon', 0.6), UiKit.fit(title, 250));
        this.ribbon.y = -CARD.height / 2 + 2;

        const close = new PIXI.Container();
        for (const [id, size] of [['closeButton', 60], ['closeIcon', 30]] as const) {
            const part = UiKit.sprite('hud', id);
            part.scale.set(size / Math.max(part.width, part.height, 1));
            close.addChild(part);
        }
        close.position.set(CARD.width / 2 - 12, -CARD.height / 2 + 16);
        tappable(close, () => {
            // (Not while its video plays: the chest's about to open.)
            if (!this.busy) this.onClose();
        });

        this.card.addChild(back, shine, this.chest, ...this.twinkles, rewardBack, bill, this.reward, this.open, this.ribbon, close, this.burst);
        this.addChild(this.dim, this.card);
        this.visible = false;
    }

    /** A glow sprite `size` across behind the chest (turning once every `turnSec`, if given). */
    private shineSprite(name: string, size: number, tint: number, alpha: number, turnSec = 0): PIXI.Sprite {
        const sprite = PIXI.Sprite.from(name);
        sprite.anchor.set(0.5);
        sprite.scale.set(size / Math.max(sprite.texture.width, sprite.texture.height, 1));
        sprite.tint = tint;
        sprite.alpha = alpha;
        sprite.y = CHEST_Y;
        if (turnSec) gsap.to(sprite, { rotation: Math.PI * 2, duration: turnSec, ease: 'none', repeat: -1 });
        return sprite;
    }

    /** Over the screen (`width` x `height`, its middle at the container's origin). */
    public layout(width: number, height: number): void {
        this.dim.clear().beginFill(0x000000, 0.6).drawRect(-width / 2, -height / 2, width, height).endFill();
        // (The ribbon and the close button stick out.)
        this.card.scale.set(Math.min(1, (width - 60) / CARD.width, (height - 110) / CARD.height));
    }

    public show(reward: number): void {
        this.reward.text = `+${shortMoney(reward)}`;
        UiKit.fit(this.reward, 190);
        this.setBusy(false);
        this.idle();
        if (this.visible) return;
        this.visible = true;
        UiAnim.popIn(this.card);
        this.ribbon.y = -CARD.height / 2 + 2;
        UiAnim.dropIn(this.ribbon, 60, 0.15);
        MowAudio.play('open');
    }

    /** What moves while it waits: the chest rocks now and then as if something's in it, the glow and OPEN breathe, the stars twinkle. */
    private idle(): void {
        for (const part of [this.chest, this.glow, this.open, ...this.twinkles]) {
            UiAnim.kill(part);
            part.scale.set(1);
            part.rotation = 0;
        }
        UiAnim.pulse(this.glow, 0.12, 0.9);
        UiAnim.pulse(this.open, 0.05, 0.6);
        UiAnim.pulse(this.chest, 0.04, 0.8);
        this.rocking?.kill();
        this.rocking = gsap.timeline({ repeat: -1, repeatDelay: 1.6, delay: 0.8 })
            .to(this.chest, { rotation: 0.07, duration: 0.08 })
            .to(this.chest, { rotation: -0.07, duration: 0.1 })
            .to(this.chest, { rotation: 0.05, duration: 0.1 })
            .to(this.chest, { rotation: 0, duration: 0.12 });
        this.twinkles.forEach((twinkle, i) => {
            twinkle.scale.set(0.35);
            gsap.to(twinkle.scale, { x: 1, y: 1, duration: 0.7 + i * 0.12, delay: i * 0.3, ease: 'sine.inOut', yoyo: true, repeat: -1 });
            gsap.to(twinkle, { rotation: Math.PI / 2, duration: 2.4 + i * 0.4, ease: 'none', repeat: -1 });
        });
    }

    public hide(): void {
        this.visible = false;
    }

    /**
     * The chest opens: it jolts, a pile of bills bursts up out of it and hangs a moment, then `done` (the scene closes
     * the panel and the cash flies to the player in the world).
     */
    public playOpen(done: () => void): void {
        this.setBusy(true);
        this.rocking?.kill();
        UiAnim.kill(this.chest);
        this.chest.rotation = 0;
        this.chest.scale.set(1);
        gsap.timeline()
            .to(this.chest.scale, { x: 1.25, y: 0.8, duration: 0.1 })
            .to(this.chest.scale, { x: 1, y: 1, duration: 0.35, ease: 'back.out(3)' });
        UiAnim.punch(this.reward as unknown as PIXI.Container, 0.3);
        MowAudio.play('buyCash');
        for (let i = 0; i < 14; i++) {
            const bill = PIXI.Sprite.from('ItemIcon_Money_Bill');
            bill.anchor.set(0.5);
            bill.scale.set(54 / Math.max(bill.texture.width, bill.texture.height, 1));
            bill.position.set(this.chest.x, this.chest.y - 20);
            bill.rotation = (Math.random() - 0.5) * 1.2;
            this.burst.addChild(bill);
            const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
            const r = 130 + Math.random() * 110;
            gsap.to(bill, { x: this.chest.x + Math.cos(a) * r, y: this.chest.y - 20 + Math.sin(a) * r * 0.8, rotation: bill.rotation * 2, duration: 0.45, delay: i * 0.025, ease: 'back.out(1.8)' });
        }
        gsap.delayedCall(0.85, () => {
            if (this.destroyed) return;
            this.burst.children.forEach((child) => gsap.killTweensOf(child));
            this.burst.removeChildren().forEach((child) => child.destroy());
            done();
        });
    }

    /** While its video plays: OPEN says so and can't be tapped again. */
    public setBusy(busy: boolean): void {
        this.busy = busy;
        this.openLabel.text = busy ? '...' : 'OPEN';
    }

    public override destroy(): void {
        this.rocking?.kill();
        UiAnim.kill(this);
        super.destroy({ children: true });
    }
}
