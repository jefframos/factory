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
import { WARM, glossyButton, iconSprite, label, popupPanel, ribbonTitle, tappable, throwConfetti } from './UiParts';
import { StageBar } from './StageBar';
import { isLastStage, stageSettings } from '../data/Settings';
import { RestaurantAudio } from '../audio/RestaurantAudio';

/** The card (the pack's popup, its header band the title), and where things sit on it (from its middle). */
const CARD = { width: 600, height: 900, stars: -285, starSize: 74, starGap: 84, tap: 120, button: 350 };
const CHEST = { size: 220, y: -40 };
/** The UPGRADE! screen: its ribbon, the star, the stage's name, the line under it, TAP TO CONTINUE (from the middle). */
const UPGRADE = { title: -360, star: -70, name: 175, sub: 240, tap: 340 };
const BAR = { width: 440, height: 44, y: 235 };

export class DayEnd extends PIXI.Container {
    private readonly card = new PIXI.Container();
    private readonly chest: PIXI.Sprite;
    private readonly glow = iconSprite('Image_Effect_Rotate', 420);
    private readonly tapText = label(40);
    private readonly bar = new StageBar(BAR.width, BAR.height);
    private readonly button = glossyButton(380, 100, 'SUPERMARKET', 'Button01_l_Green');
    private next = 0;
    /** The bar's filling (pump()); tips tapped meanwhile wait in `queued`. */
    private busy = false;
    private readonly queued: number[] = [];
    private finished = false;
    private chestScale = 1;
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

        this.card.addChild(popupPanel(CARD.width, CARD.height, `DAY ${day + 1} DONE!`));
        for (let i = 0; i < total; i++) {
            const star = iconSprite('Icon_Star_On', CARD.starSize);
            star.position.set((i - (total - 1) / 2) * CARD.starGap, CARD.stars);
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
        this.chestScale = this.chest.scale.x;
        this.tapText.y = CARD.tap;
        this.bar.y = BAR.y;
        this.bar.set(this.stage, this.progress);
        this.button.y = CARD.button;
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

    /**
     * A tap anywhere: the chest's next tip out, into the bar. As fast as the player likes: each tap's coins burst out
     * at once and join the bar's queue (it fills them in order, quicker while there's a backlog).
     */
    private tap(): void {
        if (this.next >= this.pays.length) return;
        const pay = this.pays[this.next++];
        RestaurantAudio.play('pick', 0.9 + Math.min(this.next, 12) * 0.08);
        gsap.killTweensOf(this.chest.scale);
        this.chest.scale.set(this.chestScale);
        gsap.fromTo(this.chest.scale, { x: this.chestScale * 1.2, y: this.chestScale * 0.8 }, { x: this.chestScale, y: this.chestScale, duration: 0.3, ease: 'back.out(3)' });
        const left = this.pays.length - this.next;
        this.tapText.text = left ? `TAP!  x${left}` : '';
        this.burst(pay);
        gsap.delayedCall(0.45, () => {
            this.queued.push(pay);
            void this.pump();
        });
    }

    /** The bar fills the queued tips one after another (an UPGRADE! in between waits for its tap). */
    private async pump(): Promise<void> {
        if (this.busy) return;
        this.busy = true;
        while (this.queued.length) {
            const pay = this.queued.shift()!;
            await this.fillBar(pay, this.queued.length ? 0.15 : 0.45);
        }
        this.busy = false;
        if (this.next >= this.pays.length && !this.finished) {
            this.finished = true;
            this.finish();
        }
    }

    /** Coins flying from the chest to the bar. */
    private burst(pay: number): void {
        const count = Math.min(10, 3 + Math.round(pay / 5));
        for (let i = 0; i < count; i++) {
            const coin = iconSprite('ItemIcon_Money_Bill', 54);
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
    private async fillBar(coins: number, seconds = 0.45): Promise<void> {
        while (coins > 0) {
            const goal = stageSettings(this.stage).goal;
            const room = goal - this.progress;
            const add = Math.min(coins, room);
            this.progress += add;
            coins -= add;
            await this.bar.fillTo(this.progress, seconds);
            if (this.progress < goal) return;
            if (isLastStage(this.stage)) return;
            this.stage++;
            this.progress = 0;
            await this.upgrade();
            this.bar.set(this.stage, 0);
        }
    }

    /** UPGRADE!: the restaurant's new stage, until tapped. */
    /**
     * UPGRADE!, on its own over everything (the day's card hidden meanwhile: nothing under it to read through): a dark
     * screen, the ribbon, the star in its rays, the new stage's name, confetti; until tapped.
     */
    private upgrade(): Promise<void> {
        return new Promise((resolve) => {
            RestaurantAudio.play('day');
            const holder = new PIXI.Container();
            holder.position.copyFrom(this.card.position);
            holder.scale.copyFrom(this.card.scale);
            this.card.visible = false;
            const shade = new PIXI.Graphics().beginFill(0x0b0f1f, 0.88).drawRect(-3000, -3000, 6000, 6000).endFill();
            shade.eventMode = 'static';
            const glow = iconSprite('Image_Effect_Rotate', 720);
            glow.tint = 0xffd36b;
            glow.y = UPGRADE.star;
            gsap.to(glow, { rotation: Math.PI * 2, duration: 6, repeat: -1, ease: 'none' });
            const star = iconSprite('ItemIcon_Star_Gold', 280);
            star.y = UPGRADE.star;
            const title = ribbonTitle('UPGRADE!', 62);
            title.y = UPGRADE.title;
            const name = label(60);
            name.text = stageSettings(this.stage).name.toUpperCase();
            name.y = UPGRADE.name;
            const sub = label(32, WARM.cream);
            sub.text = 'Your restaurant is growing!';
            sub.y = UPGRADE.sub;
            const tap = label(28, 0xc9e3ff);
            tap.text = 'TAP TO CONTINUE';
            tap.y = UPGRADE.tap;
            const confetti = new PIXI.Container();
            holder.addChild(shade, glow, star, title, name, sub, tap, confetti);
            this.addChild(holder);
            throwConfetti(confetti, 0, 0, 700, 1100, 120);
            gsap.from(star.scale, { x: 0.1, y: 0.1, duration: 0.5, ease: 'back.out(2.5)' });
            gsap.from([title.scale, name.scale], { x: 0.3, y: 0.3, duration: 0.4, delay: 0.15, ease: 'back.out(2.5)' });
            gsap.to(tap, { alpha: 0.3, duration: 0.6, yoyo: true, repeat: -1 });
            // A moment before it can be closed (no tap through by accident).
            gsap.delayedCall(0.8, () => {
                shade.once('pointertap', () => {
                    RestaurantAudio.play('click');
                    gsap.killTweensOf([glow, tap]);
                    holder.destroy({ children: true });
                    this.card.visible = true;
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
