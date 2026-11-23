// LockedChests.ts
//
// Locked chests (a treasure with `locked`, found in the grass): they don't pay at once. Each waits on the HUD — the
// chest button (left side, with how many are waiting) — and tapping it opens the chest panel: the chest, what's inside
// (money, for now) and OPEN with the video badge (a rewarded video; the scene plays it and pays) or LATER. The scene
// owns both (MowScene: lockedChestButton / lockedChestPanel) and says what's waiting (setWaiting, show).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { MowAudio } from '../audio/MowAudio';
import { shortMoney } from '../data/MowConfig';

const BUTTON = 96;
const CARD = { width: 520, height: 470 };

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

/** The chest (the kit's wooden chest icon) fitted to `size`. */
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

/** The chest panel: a dim over the screen, the card (the chest, its money, OPEN with a video badge, LATER). */
export class LockedChestPanel extends PIXI.Container {
    private readonly dim = new PIXI.Graphics();
    private readonly card = new PIXI.Container();
    private readonly reward = text('', 52, 0xffe27a);
    private readonly openLabel = text('OPEN', 34, 0xffffff, 0x1d5a1d);
    private busy = false;
    private chest!: PIXI.Container;
    /** The cash bursting out of an opened chest (over the card). */
    private readonly burst = new PIXI.Container();

    public constructor(private readonly onOpen: () => void, private readonly onLater: () => void) {
        super();
        this.dim.eventMode = 'static';
        this.dim.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        const back = UiKit.image('upgrades', 'panel', CARD.width, CARD.height);
        back.eventMode = 'static';
        back.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        const title = text('LOCKED CHEST', 40, 0xffffff);
        title.y = -CARD.height / 2 + 52;
        const chest = chestPicture(190);
        chest.y = -40;
        UiAnim.pulse(chest, 0.04, 0.8);
        this.chest = chest;
        this.reward.y = 92;
        const open = new PIXI.Container();
        open.position.set(0, CARD.height / 2 - 78);
        const video = PIXI.Sprite.from('ItemIcon_Video');
        video.anchor.set(0.5);
        video.scale.set(44 / Math.max(video.texture.width, video.texture.height, 1));
        video.x = -72;
        this.openLabel.x = 22;
        open.addChild(UiKit.image('upgrades', 'buyButton', 260, 76), video, this.openLabel);
        UiAnim.pulse(open, 0.05, 0.6);
        tappable(open, () => {
            if (this.busy) return;
            this.onOpen();
        });
        const later = text('LATER', 24, 0xdddddd);
        later.position.set(CARD.width / 2 - 70, -CARD.height / 2 + 52);
        tappable(later, () => this.onLater());
        this.card.addChild(back, title, chest, this.reward, open, later, this.burst);
        this.addChild(this.dim, this.card);
        this.visible = false;
    }

    /** Over the screen (`width` x `height`, its middle at the container's origin). */
    public layout(width: number, height: number): void {
        this.dim.clear().beginFill(0x000000, 0.55).drawRect(-width / 2, -height / 2, width, height).endFill();
        this.card.scale.set(Math.min(1, (width - 32) / CARD.width, (height - 32) / CARD.height));
    }

    public show(reward: number): void {
        this.reward.text = `+${shortMoney(reward)}`;
        this.setBusy(false);
        if (this.visible) return;
        this.visible = true;
        UiAnim.popIn(this.card);
        MowAudio.play('open');
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
        gsap.killTweensOf(this.chest.scale);
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
            const r = 110 + Math.random() * 90;
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
        this.card.children.forEach((child) => gsap.killTweensOf(child));
        super.destroy({ children: true });
    }
}
