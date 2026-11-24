// WallHud.ts
//
// What's over the wall: its bar with its name at the top (and how far off rewinding is), the tray (Tray), the numbers that
// float off a hit, the combo, the flash, the big words when a wall comes down, and the ring that says TAP until the first
// punch. Everything but the tray and the sound button lets taps through to the wall.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { WallAnalytics } from '../analytics/WallAnalytics';
import { fx } from '../config/Effects';
import { HudBar } from './HudBar';
import { LookOffer } from './LookOffer';
import { SHOWS } from '../data/WallConfig';
import { MedalFly, RewindButton, RewindPopup, RewindShow, rewindKnown } from './Rewind';
import { Tray, TrayActions } from './Tray';
import { WallAudio } from '../audio/WallAudio';
import { WallProgress } from '../data/WallProgress';
import { newLooks } from '../data/Looks';
import { Wardrobe, WardrobeActions, dot } from './Wardrobe';
import { fit, sprite, text, write } from './parts';

const BAR = { width: 430, height: 42, y: 100, wideY: 44, color: 0xffb52e, low: 0xff5a3d };
/** Upright, how far down the screen its bar comes (the HUD's units). */
export const BAR_FOOT = BAR.y + BAR.height / 2;
const FLOATS = 14;
const BUTTON_SIZE = 58;
const WARDROBE_SIZE = 82;

export class WallHud extends PIXI.Container {
    private readonly title = text('', 27, 0xffffff);
    private readonly bar = new HudBar(BAR.width, BAR.height, BAR.color);
    private readonly barBack: PIXI.Container;
    private readonly combo = new PIXI.Container();
    private readonly comboText = text('', 44, 0xffe27a, 0x6a2a0a, 9);
    private comboShown = 1;
    public readonly tray: Tray;
    public readonly wardrobe: Wardrobe;
    public readonly rewindPopup: RewindPopup;
    public readonly rewindShow = new RewindShow();
    private readonly rewindButton: RewindButton;
    private readonly offer: LookOffer;
    private readonly wardrobeButton = new PIXI.Container();
    private wardrobeDot?: PIXI.Container;
    private news = 0;
    /** Medals on their way to the button. */
    private flying = 0;
    private readonly flash = new PIXI.Sprite(PIXI.Texture.WHITE);
    private readonly floats: PIXI.Text[] = [];
    private nextFloat = 0;
    private readonly banner = new PIXI.Container();
    private readonly bannerText = text('', 62, 0xffe27a, 0x6a2a0a, 12);
    private readonly bannerSub = text('', 34, 0xbaff8c);
    private readonly tap = new PIXI.Container();
    private readonly ring: PIXI.Sprite;
    private readonly sound: PIXI.Container;
    private barShare = 1;

    public constructor(actions: TrayActions & { rewind(): void; flaunt(): void }, looks: WardrobeActions) {
        super();
        this.flash.tint = 0xfff0dc;
        this.flash.alpha = 0;
        this.flash.eventMode = 'none';
        this.barBack = new PIXI.Container();
        this.bar.x = -BAR.width / 2;
        this.barBack.addChild(this.bar, this.title);
        this.title.y = -2;
        this.combo.addChild(this.comboText);
        this.combo.visible = false;
        this.tray = new Tray(actions);
        this.wardrobe = new Wardrobe(looks, (open) => {
            this.tray.visible = this.barBack.visible = this.sound.visible = !open;
            this.news = -1;
        });
        this.offer = new LookOffer(looks, (name) => {
            this.announce(`${name}!`, 'NEW LOOK', 1.1);
            actions.flaunt();
        });
        this.rewindPopup = new RewindPopup(() => actions.rewind(), (open) => (this.tray.visible = !open));
        this.rewindButton = new RewindButton(() => {
            WallAnalytics.buttonTapped('rewind');
            this.rewindPopup.setOpen(true);
        });
        const back = sprite('Button_Round03_Dark', WARDROBE_SIZE);
        const clothes = sprite('PictoIcon_Clothes', WARDROBE_SIZE * 0.66);
        clothes.y = -3;
        this.wardrobeButton.addChild(back, clothes);
        this.tappable(this.wardrobeButton, () => {
            WallAnalytics.buttonTapped('wardrobe');
            this.wardrobe.setOpen(true);
        });

        for (let i = 0; i < FLOATS; i++) {
            const label = text('', 40, 0xffffff);
            label.visible = false;
            label.eventMode = 'none';
            this.floats.push(label);
        }
        this.bannerSub.y = 58;
        this.banner.addChild(this.bannerText, this.bannerSub);
        this.banner.visible = false;
        this.ring = sprite('Glow_Circle01', 190);
        this.ring.tint = 0xffe27a;
        const tapHand = PIXI.Sprite.from('handHud');
        tapHand.width = tapHand.height = 120;
        tapHand.position.set(-16, -10);
        const tapText = text('TAP!', 54, 0xffffff);
        tapText.y = -92;
        this.tap.addChild(this.ring, tapHand, tapText);
        gsap.to(this.ring.scale, { x: this.ring.scale.x * 1.35, y: this.ring.scale.y * 1.35, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        gsap.to(tapHand, { y: 14, duration: 0.4, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        this.tap.visible = false;

        this.sound = this.soundButton();
        this.addChild(this.flash, this.barBack, ...this.floats, this.combo, this.banner, this.tap, this.tray, this.sound, this.wardrobeButton, this.rewindButton, this.offer, this.wardrobe, this.rewindPopup, this.rewindShow);
        [this.barBack, this.combo, this.banner, this.tap].forEach((child) => (child.eventMode = 'none'));
        this.reposition();
    }

    private soundButton(): PIXI.Container {
        const button = new PIXI.Container();
        const back = sprite('Button_Round03_Dark', BUTTON_SIZE);
        const on = sprite('PictoIcon_Sound', BUTTON_SIZE * 0.55);
        const off = sprite('PictoIcon_Sound_Off', BUTTON_SIZE * 0.55);
        const show = () => {
            on.visible = !WallAudio.muted;
            off.visible = WallAudio.muted;
        };
        show();
        button.addChild(back, on, off);
        this.tappable(button, () => {
            WallAudio.toggleMuted();
            show();
        });
        return button;
    }

    private tappable(target: PIXI.Container, action: () => void): void {
        target.eventMode = 'static';
        target.cursor = 'pointer';
        // (Not a punch too.)
        target.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            action();
        });
    }

    // ---------------------------------------------------------------- the wall

    public setWall(number: number, material: string): void {
        write(this.title, `WALL ${number}  ${material.toUpperCase()}`, BAR.width - 40);
    }

    public setShare(share: number, jolt = false): void {
        this.barShare = share;
        const strong = fx('barJolt');
        if (!jolt || strong <= 0) return;
        gsap.killTweensOf(this.barBack.scale);
        this.barBack.scale.set(1 + 0.04 * strong, 1 + 0.1 * strong);
        gsap.to(this.barBack.scale, { x: 1, y: 1, duration: 0.2 });
    }

    /** A number off a hit, at (x, y) in the HUD's units. */
    public float(value: string, x: number, y: number, color = 0xffffff, size = 1): void {
        if (fx('numbers') <= 0) return;
        size *= fx('numbers');
        const label = this.floats[this.nextFloat];
        this.nextFloat = (this.nextFloat + 1) % FLOATS;
        gsap.killTweensOf([label, label.scale]);
        label.text = value;
        label.style.fill = color;
        label.visible = true;
        label.alpha = 1;
        label.position.set(x + (Math.random() - 0.5) * 50, y - 30);
        label.scale.set(0.5 * size);
        gsap.to(label.scale, { x: size, y: size, duration: 0.12, ease: 'back.out(3)' });
        gsap.to(label, { y: label.y - 90, duration: 0.7, ease: 'power1.out' });
        gsap.to(label, { alpha: 0, duration: 0.25, delay: 0.45, onComplete: () => {
            label.visible = false;
        } });
    }

    public flashScreen(alpha: number, seconds: number): void {
        gsap.killTweensOf(this.flash);
        this.flash.alpha = Math.min(1, alpha * fx('flash'));
        gsap.to(this.flash, { alpha: 0, duration: seconds, ease: 'power1.out' });
    }

    /** Big words, then gone. */
    public announce(words: string, sub: string, seconds = 1.1): void {
        if (fx('words') <= 0) return;
        gsap.killTweensOf([this.banner, this.banner.scale]);
        this.bannerText.text = words;
        fit(this.bannerText, 660);
        this.bannerSub.text = sub;
        this.banner.visible = true;
        this.banner.alpha = 1;
        this.banner.scale.set(0.3);
        gsap.to(this.banner.scale, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2.4)' });
        gsap.to(this.banner, { alpha: 0, duration: 0.25, delay: seconds, onComplete: () => {
            this.banner.visible = false;
        } });
    }

    /** The ring that says TAP, at (x, y) in the HUD's units; or gone. */
    public setTapHint(on: boolean, x = 0, y = 0): void {
        this.tap.visible = on;
        this.tap.position.set(x, y);
    }

    /** The combo's factor at (x, y), the HUD's units (1: none). */
    public setCombo(mult: number, x = 0, y = 0): void {
        this.combo.visible = mult > 1;
        if (mult <= 1) {
            this.comboShown = 1;
            return;
        }
        this.combo.position.set(x, y);
        if (mult === this.comboShown) return;
        this.comboShown = mult;
        write(this.comboText, `x${mult} COMBO`);
        gsap.killTweensOf(this.combo.scale);
        this.combo.scale.set(1.5);
        gsap.to(this.combo.scale, { x: 1, y: 1, duration: 0.25, ease: 'back.out(2)' });
    }

    // ---------------------------------------------------------------- frame

    /** Medals won, from (x, y) to the button that counts them. */
    public flyMedals(from: PIXI.Point, count: number): void {
        this.flying++;
        WallAudio.play('tool', 0.9, 1.15);
        const fly = new MedalFly(from, this.rewindButton.target, count, (some, last) => {
            this.rewindButton.got(some);
            if (last) this.flying--;
        });
        this.addChildAt(fly, this.getChildIndex(this.wardrobe));
    }

    /** A wall's there to be hit, and the player's begun (the scene says). */
    public playing = false;

    /** Something's open over the wall. */
    public get busy(): boolean {
        return this.wardrobe.isOpen || this.rewindPopup.isOpen || this.rewindShow.visible;
    }

    /** How many new things there are to wear, on the wardrobe's button. */
    private showNews(): void {
        const news = newLooks();
        if (news === this.news) return;
        const more = news > this.news && this.news >= 0;
        this.news = news;
        this.wardrobeDot?.destroy({ children: true });
        this.wardrobeDot = news > 0 ? this.wardrobeButton.addChild(dot(WARDROBE_SIZE / 2 - 8, -WARDROBE_SIZE / 2 + 10, news)) : undefined;
        if (!more) return;
        gsap.killTweensOf(this.wardrobeButton.scale);
        this.wardrobeButton.scale.set(1.35);
        gsap.to(this.wardrobeButton.scale, { x: 1, y: 1, duration: 0.6, ease: 'elastic.out(1, 0.35)' });
    }

    public update(delta: number): void {
        this.tray.update(delta);
        this.wardrobe.update();
        this.showNews();
        this.bar.setShare(this.barShare);
        this.bar.setColor(this.barShare < 0.3 ? BAR.low : BAR.color);
        this.wardrobeButton.visible = WallProgress.best >= SHOWS.wardrobe && !this.wardrobe.isOpen;
        this.rewindButton.visible = rewindKnown() && !this.wardrobe.isOpen && !this.rewindPopup.isOpen;
        if (this.wardrobeButton.visible) WallAnalytics.buttonShown('wardrobe');
        if (this.rewindButton.visible) WallAnalytics.buttonShown('rewind');
        if (this.rewindButton.visible) this.rewindButton.update(delta, this.barShare, this.flying > 0);
        this.rewindPopup.update(delta);
        this.offer.update(delta, this.playing && !this.busy);
        this.rewindShow.update(delta);
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const { topLeft } = screen;
        this.flash.position.copyFrom(topLeft);
        this.flash.width = screen.width;
        this.flash.height = screen.height;
        const wide = screen.width > screen.height * 1.15;
        const barY = topLeft.y + (wide ? BAR.wideY : BAR.y);
        this.barBack.position.set(screen.center.x, barY);
        this.rewindPopup.reposition();
        // (Across from the rewind button; on a wide screen, by the cards.)
        this.offer.position.set(wide ? topLeft.x + screen.width - 290 - 24 - 110 : topLeft.x + screen.width - 102, topLeft.y + (wide ? 250 : 262));
        this.rewindShow.reposition();
        this.rewindButton.position.set(topLeft.x + (wide ? 24 : 16) + 60, topLeft.y + (wide ? 640 : 206));
        this.tray.reposition();
        this.banner.position.set(screen.center.x, topLeft.y + screen.height * 0.32);
        this.wardrobe.reposition();
        // (The wardrobe top right; the sound on the other side, or beside it where the cash is there.)
        const right = topLeft.x + screen.width;
        this.wardrobeButton.position.set(right - 18 - WARDROBE_SIZE / 2, topLeft.y + 54);
        this.sound.position.set(wide ? right - 22 - WARDROBE_SIZE - 16 - BUTTON_SIZE / 2 : topLeft.x + 18 + BUTTON_SIZE / 2, topLeft.y + 44);
    }

    public override destroy(): void {
        this.tray.stop();
        gsap.killTweensOf(this);
        const kill = (container: PIXI.Container) => {
            gsap.killTweensOf([container, container.scale]);
            container.children.forEach((child) => kill(child as PIXI.Container));
        };
        kill(this);
        super.destroy({ children: true });
    }
}
