// DayEnd.ts
//
// The day's end (Mob's chest, for the till): DAY n DONE!, a star per happy customer, and the day's tips in a chest
// (gold when everyone was happy). TAP: each tap bursts it and one customer's coins fly out into the restaurant's bar
// under it. When the bar fills, UPGRADE!: the restaurant's next stage, and the bar starts on that one. With every tip
// out, the SUPERMARKET button. A day with no tips: the chest stays shut, and the button's there at once.
//
// The save's already been given the day's coins (RestaurantSave.endDay): this plays it out from where the bar was.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { WARM, framePlane, glossyButton, iconSprite, label, tappable } from './UiParts';
import { StageBar } from './StageBar';
import { isLastStage, stageSettings } from '../data/Settings';
import { RestaurantAudio } from '../audio/RestaurantAudio';

const CARD = { width: 560, height: 820 };
const CHEST = { size: 230, y: 20 };
const BAR = { width: 420, height: 40, y: 230 };

export class DayEnd extends PIXI.Container {
    private readonly card = new PIXI.Container();
    private readonly chest: PIXI.Sprite;
    private readonly glow = iconSprite('Image_Effect_Rotate', 420);
    private readonly tapText = label(40);
    private readonly bar = new StageBar(BAR.width, BAR.height);
    private readonly button = glossyButton(380, 100, 'SUPERMARKET', 'Button01_l_Green');
    private next = 0;
    private busy = false;
    private stage: number;
    private progress: number;

    /**
     * `pays`: each happy customer's coins (a tap each); `from`: the bar before them; `onNext`: SUPERMARKET.
     */
    public constructor(day: number, happy: number, total: number, private readonly pays: number[], from: { stage: number; progress: number }, onNext: () => void) {
        super();
        this.stage = from.stage;
        this.progress = from.progress;
        const shade = new PIXI.Graphics().beginFill(0x000000, 0.5).drawRect(-3000, -3000, 6000, 6000).endFill();
        shade.eventMode = 'static';
        shade.on('pointertap', () => this.tap());
        this.addChild(shade, this.card);

        const back = framePlane('BasicFrame_Round20', CARD.width, CARD.height);
        back.position.set(-CARD.width / 2, -CARD.height / 2);
        const title = label(56);
        title.text = `DAY ${day + 1} DONE!`;
        title.y = -CARD.height / 2 + 60;
        this.card.addChild(back, title);
        for (let i = 0; i < total; i++) {
            const star = iconSprite('Icon_Star_On', 70);
            star.position.set((i - (total - 1) / 2) * 80, -CARD.height / 2 + 140);
            if (i >= happy) {
                star.tint = 0x6b5a4c;
                star.alpha = 0.55;
            } else {
                gsap.from(star.scale, { x: 0.01, y: 0.01, duration: 0.35, delay: 0.25 + i * 0.18, ease: 'back.out(3)', onStart: () => RestaurantAudio.play('coins', 1 + i * 0.12) });
            }
            this.card.addChild(star);
        }

        this.glow.y = CHEST.y;
        this.glow.alpha = 0.6;
        this.glow.tint = 0xffe08a;
        gsap.to(this.glow, { rotation: Math.PI * 2, duration: 8, repeat: -1, ease: 'none' });
        this.chest = iconSprite(happy === total && total > 0 ? 'ItemIcon_Chest_Gold' : 'ItemIcon_Chest_Wood', CHEST.size);
        this.chest.y = CHEST.y;
        this.tapText.y = CHEST.y + CHEST.size / 2 + 10;
        this.bar.y = BAR.y;
        this.bar.set(this.stage, this.progress);
        this.button.y = CARD.height / 2 - 80;
        this.button.visible = false;
        tappable(this.button, () => {
            RestaurantAudio.play('click');
            onNext();
        });
        this.card.addChild(this.glow, this.chest, this.tapText, this.bar, this.button);

        if (pays.length) {
            this.tapText.text = `TAP!  x${pays.length}`;
            gsap.to(this.tapText.scale, { x: 1.12, y: 1.12, duration: 0.45, yoyo: true, repeat: -1, ease: 'sine.inOut' });
            gsap.to(this.chest, { rotation: 0.06, duration: 0.12, yoyo: true, repeat: -1, repeatDelay: 0.9, ease: 'sine.inOut' });
        } else {
            this.tapText.text = 'No tips today...';
            this.glow.visible = false;
            this.button.visible = true;
        }
        this.reposition();
        gsap.from(this.card.scale, { x: 0.5, y: 0.5, duration: 0.35, ease: 'back.out(2)' });
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        this.card.position.set(screen.center.x, screen.center.y);
        // Fits a short screen.
        this.card.scale.set(Math.min(1, (screen.height - 40) / CARD.height));
    }

    /** A tap anywhere: the chest's next tip out, into the bar. */
    private tap(): void {
        if (this.busy || this.next >= this.pays.length) return;
        this.busy = true;
        const pay = this.pays[this.next++];
        RestaurantAudio.play('pick', 0.9 + this.next * 0.08);
        gsap.fromTo(this.chest.scale, { x: this.chest.scale.x * 1.2, y: this.chest.scale.y * 0.8 }, { x: this.chest.scale.x, y: this.chest.scale.y, duration: 0.35, ease: 'back.out(3)' });
        const left = this.pays.length - this.next;
        this.tapText.text = left ? `TAP!  x${left}` : '';
        this.burst(pay);
        gsap.delayedCall(0.45, () => void this.fillBar(pay).then(() => {
            this.busy = false;
            if (this.next >= this.pays.length) this.finish();
        }));
    }

    /** Coins flying from the chest to the bar. */
    private burst(pay: number): void {
        const count = Math.min(10, 3 + Math.round(pay / 5));
        for (let i = 0; i < count; i++) {
            const coin = iconSprite('ItemIcon_Money_Coin', 54);
            coin.position.set(0, CHEST.y - 30);
            this.card.addChild(coin);
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
            const out = 90 + Math.random() * 70;
            gsap.timeline({ delay: i * 0.03, onComplete: () => coin.destroy() })
                .to(coin, { x: Math.cos(angle) * out, y: CHEST.y - 30 + Math.sin(angle) * out, duration: 0.25, ease: 'power2.out' })
                .to(coin, { x: -BAR.width / 2, y: BAR.y, duration: 0.35, ease: 'power2.in', onComplete: () => RestaurantAudio.play('coins', 1.1) })
                .to(coin.scale, { x: coin.scale.x * 0.5, y: coin.scale.y * 0.5, duration: 0.35 }, '<');
        }
    }

    /** `coins` into the bar: filled up to its goal, UPGRADE! (the next stage's bar), the rest into that one. */
    private async fillBar(coins: number): Promise<void> {
        while (coins > 0) {
            const goal = stageSettings(this.stage).goal;
            const room = goal - this.progress;
            const add = Math.min(coins, room);
            this.progress += add;
            coins -= add;
            await this.bar.fillTo(this.progress, 0.45);
            if (this.progress < goal) return;
            if (isLastStage(this.stage)) return;
            this.stage++;
            this.progress = 0;
            await this.upgrade();
            this.bar.set(this.stage, 0);
        }
    }

    /** UPGRADE!: the restaurant's new stage, until tapped. */
    private upgrade(): Promise<void> {
        return new Promise((resolve) => {
            RestaurantAudio.play('day');
            const holder = new PIXI.Container();
            const shade = new PIXI.Graphics().beginFill(0x000000, 0.6).drawRect(-3000, -3000, 6000, 6000).endFill();
            shade.eventMode = 'static';
            const glow = iconSprite('Image_Effect_Rotate', 640);
            glow.tint = 0xffd36b;
            gsap.to(glow, { rotation: Math.PI * 2, duration: 6, repeat: -1, ease: 'none' });
            const star = iconSprite('ItemIcon_Star_Gold', 260);
            star.y = -40;
            const title = label(84, 0xffe27a);
            title.text = 'UPGRADE!';
            title.y = -260;
            const name = label(56);
            name.text = stageSettings(this.stage).name.toUpperCase();
            name.y = 150;
            const sub = label(30, WARM.cream);
            sub.text = 'Your restaurant is growing!';
            sub.y = 210;
            const tap = label(28, 0xc9e3ff);
            tap.text = 'TAP TO CONTINUE';
            tap.y = 300;
            holder.addChild(shade, glow, star, title, name, sub, tap);
            this.card.addChild(holder);
            gsap.from(star.scale, { x: 0.1, y: 0.1, duration: 0.5, ease: 'back.out(2.5)' });
            gsap.from([title.scale, name.scale], { x: 0.3, y: 0.3, duration: 0.4, delay: 0.15, ease: 'back.out(2.5)' });
            gsap.to(tap, { alpha: 0.3, duration: 0.6, yoyo: true, repeat: -1 });
            // A moment before it can be closed (no tap through by accident).
            gsap.delayedCall(0.8, () => {
                shade.once('pointertap', () => {
                    RestaurantAudio.play('click');
                    gsap.killTweensOf([glow, tap]);
                    holder.destroy({ children: true });
                    resolve();
                });
            });
        });
    }

    private finish(): void {
        gsap.killTweensOf(this.tapText.scale);
        gsap.killTweensOf(this.chest);
        this.chest.rotation = 0;
        this.chest.alpha = 0.6;
        this.button.visible = true;
        gsap.from(this.button.scale, { x: 0.3, y: 0.3, duration: 0.35, ease: 'back.out(2.5)' });
    }

    public override destroy(): void {
        gsap.killTweensOf([this.glow, this.tapText.scale, this.chest]);
        super.destroy({ children: true });
    }
}
