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
import { Floater, FloaterActions, FloaterKind } from './Floater';
import { Frenzy } from './Frenzy';
import { HitPill } from './HitPill';
import { HudBar } from './HudBar';
import { LookOffer } from './LookOffer';
import { HOLD, SHOWS, short } from '../data/WallConfig';
import { HoldButton, HOLD_BUTTON } from './HoldButton';
import { RelicButton, RelicPanel, relicsKnown } from './Relics';
import { MedalFly, RewindButton, RewindPopup, RewindShow, rewindKnown } from './Rewind';
import { POWER, PowerButton } from './PowerButton';
import { Powers } from '../data/Powers';
import { TRAY_TOP, Tray, TrayActions } from './Tray';
import { WallAudio } from '../audio/WallAudio';
import { WallProgress } from '../data/WallProgress';
import { newLooks } from '../data/Looks';
import { Wardrobe, WardrobeActions, dot } from './Wardrobe';
import { fit, frame, ringSprite, sprite, text, write } from './parts';

// (y: low enough that the wall's badge clears the cash pill's note over it.)
const BAR = { width: 430, height: 42, y: 112, wideY: 44, color: 0xffb52e, low: 0xff5a3d };
/** Upright, how far down the screen its bar comes (the HUD's units). */
export const BAR_FOOT = BAR.y + BAR.height / 2;
/** Something given: held up this long, and its flight (seconds); the picture and the light behind it, across. */
const GIFT = { held: 1.15, flies: 0.5, size: 140, rays: 330 };
/** A boss's time: under the bar. And the button that calls it back. */
const TIMER = { width: 300, height: 28, below: 40 };
/** A frenzy's time under the bar (and under a boss's). */
const UNDER = { frenzy: 46, timed: 88 };
const RETRY = { width: 330, height: 92, up: 62, wideUp: 90 };
/** The bar's name is this wide at most (its life's beside it). */
const TITLE_WIDTH = 225;
/** The wall's number, on a shield (Mow's): over the bar's left end. */
const WALL_BADGE = { size: 76, in: 6, covers: 38, stroke: 0x1f49a8 };
const FLOATS = 14;
/** The offer, upright, between the relics' button and the damage pills: room under and over it, its size (with its flag and timer), and how small or big it may be. */
const OFFER_GAP = { below: 64, above: 64, tall: 268, wide: 172, least: 0.55, most: 0.85 };
/** The circle that says where to tap, across half of it. */
const TAP_RING = 58;
const BUTTON_SIZE = 58;
const WARDROBE_SIZE = 82;

export class WallHud extends PIXI.Container {
    private readonly title = text('', 26, 0xffffff);
    /** The wall's number, always there. */
    private readonly badge = new PIXI.Container();
    private readonly number = text('', 34, 0xffffff, WALL_BADGE.stroke, 7);
    private readonly life = text('', 21, 0xffffff, 0x100e18, 6);
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
    /** The relic shop (medals), its button under the rewind's; and hold to punch's button, low on the right. */
    public readonly relicPanel: RelicPanel;
    private readonly relicButton: RelicButton;
    public readonly holdButton = new HoldButton();
    private readonly offer: LookOffer;
    private readonly floater: Floater;
    private readonly frenzy = new Frenzy();
    private readonly powers = Powers.all.map((power) => new PowerButton(power, (words, sub) => this.announce(words, sub, 1)));
    private readonly hitPill = new HitPill();
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
    private readonly timer = new PIXI.Container();
    private readonly timerBar = new HudBar(TIMER.width, TIMER.height, 0xff3a2e);
    private readonly timerText = text('', 30, 0xffffff, 0x100e18, 7);
    private readonly retry = new PIXI.Container();
    private readonly skull = sprite('ItemIcon_Skull', 58);
    private fightOn = false;
    private clock = 0;

    public constructor(actions: TrayActions & { rewind(): void; flaunt(): void; retryBoss(): void; floater: FloaterActions }, looks: WardrobeActions) {
        super();
        this.flash.tint = 0xfff0dc;
        this.flash.alpha = 0;
        this.flash.eventMode = 'none';
        this.barBack = new PIXI.Container();
        this.bar.x = -BAR.width / 2;
        this.bar.setFrom(WALL_BADGE.covers);
        const badge = sprite('Slider_Level02_Icon_Badge_Blue', WALL_BADGE.size);
        this.number.y = -2;
        this.badge.x = -BAR.width / 2 + WALL_BADGE.in;
        this.badge.addChild(badge, this.number);
        this.barBack.addChild(this.bar, this.title, this.life);
        // (In a fight, whose it is after the number, and their life on the right; a wall's life in the middle.)
        this.title.anchor.set(0, 0.5);
        this.title.position.set(-BAR.width / 2 + WALL_BADGE.in + WALL_BADGE.size / 2 + 8, -2);
        this.life.anchor.set(0.5);
        this.life.y = -2;
        this.skull.x = BAR.width / 2 - 14;
        this.skull.visible = false;
        this.barBack.addChild(this.skull, this.badge);
        this.timerBar.x = -TIMER.width / 2;
        this.timer.addChild(this.timerBar, this.timerText);
        this.timer.visible = false;
        this.timer.eventMode = 'none';
        const words = text('FIGHT BOSS!', 42, 0xffffff, 0x6a0f0f, 9);
        words.position.set(28, -4);
        const face = sprite('ItemIcon_Skull', 70);
        face.position.set(-RETRY.width / 2 + 50, -5);
        fit(words, RETRY.width - 130);
        this.retry.addChild(frame('Button01_s_Red', [28, 31, 28, 60], RETRY.width, RETRY.height, 0.85), face, words);
        this.retry.visible = false;
        this.tappable(this.retry, () => actions.retryBoss());
        this.combo.addChild(this.comboText);
        this.combo.visible = false;
        this.tray = new Tray(actions);
        this.wardrobe = new Wardrobe(looks, (open) => {
            this.tray.visible = this.barBack.visible = this.sound.visible = !open;
            this.news = -1;
        });
        this.offer = new LookOffer(looks, (name) => {
            this.announce(`${name}!`, '', 1.1);
            actions.flaunt();
        });
        this.floater = new Floater(actions.floater);
        this.rewindPopup = new RewindPopup(() => actions.rewind(), (open) => (this.tray.visible = !open));
        this.rewindButton = new RewindButton(() => {
            WallAnalytics.buttonTapped('rewind');
            this.rewindPopup.setOpen(true);
        });
        // (What a relic changes shows by itself: the tray reads the progress each frame.)
        this.relicPanel = new RelicPanel((open) => (this.tray.visible = !open), () => undefined);
        this.relicButton = new RelicButton(() => {
            WallAnalytics.buttonTapped('relics');
            this.relicPanel.setOpen(true);
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
        // The circle to tap (as the enemies' are): an orange ring, and one closing in on it again and again.
        // (Drawn smooth: ringSprite, not PIXI.Graphics, whose edges come out jagged.)
        const circle = ringSprite(TAP_RING, 8, 0xff8a1e, { width: 14, color: 0x50190a, alpha: 0.75 });
        const closing = ringSprite(TAP_RING, 5, 0xffb04a, { width: 9, color: 0x46190a, alpha: 0.6 });
        this.tap.addChild(this.ring, circle, closing, tapHand, tapText);
        gsap.fromTo(closing.scale, { x: 1.8, y: 1.8 }, { x: 1, y: 1, duration: 0.75, repeat: -1, ease: 'power1.in' });
        gsap.fromTo(closing, { alpha: 0 }, { alpha: 1, duration: 0.2, repeat: -1, repeatDelay: 0.55 });
        gsap.to(this.ring.scale, { x: this.ring.scale.x * 1.35, y: this.ring.scale.y * 1.35, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        gsap.to(tapHand, { y: 14, duration: 0.4, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        this.tap.visible = false;

        this.sound = this.soundButton();
        this.addChild(this.frenzy.glow, this.flash, this.floater, this.barBack, ...this.floats, this.timer, this.frenzy, this.combo, this.banner, this.tap, this.retry, this.tray, this.hitPill, this.sound, this.wardrobeButton, this.rewindButton, this.relicButton, this.holdButton, ...this.powers, this.offer, this.wardrobe, this.rewindPopup, this.relicPanel, this.rewindShow);
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

    public setWall(number: number): void {
        write(this.number, String(number), WALL_BADGE.size - 22);
        gsap.killTweensOf(this.badge.scale);
        this.badge.scale.set(1.35);
        gsap.to(this.badge.scale, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2.4)' });
    }

    /** The life left, and all of it (a wall's, an enemy's), on the bar. */
    public setLife(left: number, total: number): void {
        // (Never 0 while there's any.)
        const shown = left > 0 ? Math.max(1, Math.ceil(left)) : 0;
        write(this.life, `${short(shown)} / ${short(Math.ceil(total))}`, this.fightOn ? BAR.width - TITLE_WIDTH - 60 : BAR.width - 120);
    }

    /** A fight: what's on the bar, the boss's time (seconds, and its share), whether it can be called back; none. */
    public setFight(fight?: { title: string; boss: boolean; seconds?: number; timeShare?: number; retry: boolean }): void {
        this.fightOn = !!fight;
        this.skull.visible = !!fight?.boss;
        this.title.visible = !!fight;
        this.life.anchor.x = fight ? 1 : 0.5;
        this.life.x = fight ? BAR.width / 2 - (fight.boss ? 48 : 18) : 14;
        this.timer.visible = fight?.seconds !== undefined && !this.busy;
        this.retry.visible = !!fight?.retry && !this.busy;
        if (!fight) return;
        write(this.title, fight.title, TITLE_WIDTH - (fight.boss ? 45 : 20));
        if (fight.seconds === undefined) return;
        this.timerBar.setShare(fight.timeShare ?? 1);
        write(this.timerText, String(Math.max(0, Math.ceil(fight.seconds))));
        // (The last of it.)
        this.timerText.scale.set(fight.seconds < 6 ? 1.15 + 0.15 * Math.sin(this.clock * 12) : 1);
        this.timerText.tint = fight.seconds < 6 ? 0xffd23c : 0xffffff;
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

    /** Something given: big in the middle in a burst of light, then off to its card (`tint`: a tool's metal's colour). */
    public showGift(icon: string, words: string, sub: string, to: () => PIXI.Point, tint?: string): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const from = new PIXI.Point(screen.center.x, screen.topLeft.y + screen.height * 0.47);
        const rays = sprite('Image_Effect_Rotate', GIFT.rays);
        const big = sprite(icon, GIFT.size);
        if (tint) {
            const metal = PIXI.Sprite.from(`${icon}_metal`);
            metal.anchor.set(0.5);
            metal.tint = PIXI.utils.string2hex(tint);
            big.addChild(metal);
        }
        const size = big.scale.x;
        const show = new PIXI.Container();
        show.eventMode = 'none';
        rays.position.copyFrom(from);
        big.position.copyFrom(from);
        show.addChild(rays, big);
        this.addChildAt(show, this.getChildIndex(this.wardrobe));
        this.announce(words, sub, 1.3);
        WallAudio.play('tool');
        gsap.fromTo(rays, { alpha: 0 }, { alpha: 0.9, duration: 0.25 });
        gsap.to(rays, { rotation: 2, duration: 2, ease: 'none' });
        gsap.to(rays, { alpha: 0, duration: 0.3, delay: GIFT.held });
        gsap.fromTo(big.scale, { x: 0, y: 0 }, { x: size, y: size, duration: 0.5, ease: 'back.out(2.4)' });
        const state = { t: 0 };
        gsap.to(state, { t: 1, duration: GIFT.flies, delay: GIFT.held, ease: 'power2.in', onUpdate: () => {
            const { t } = state;
            const end = to();
            big.position.set(from.x + (end.x - from.x) * t, from.y + (end.y - from.y) * t - Math.sin(t * Math.PI) * 60);
            big.scale.set(size * (1 - 0.62 * t));
        }, onComplete: () => {
            WallAudio.play('claim');
            // (The rays turn on past this: on something gone, that throws every frame.)
            gsap.killTweensOf([rays, big, big.scale]);
            show.destroy({ children: true });
        } });
    }

    /** One floats across: now (debug), or in a moment. */
    public floatNow(kind: FloaterKind): void {
        this.floater.appear(kind);
    }
    public floatSoon(kind: FloaterKind): void {
        this.floater.bring(kind);
    }

    /** Free cash got, at (x, y). */
    public gotCash(amount: number, at: PIXI.Point): void {
        this.float(`+${short(amount)}`, at.x, at.y, 0xbaff8c, 1.5);
        this.tray.gotCash(at);
        WallAudio.play('coins', 1, 1.15);
    }

    public startFrenzy(): void {
        this.frenzy.start();
        this.announce('FRENZY!', '', 1);
        WallAudio.play('tool', 1, 1.2);
    }

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
        return this.wardrobe.isOpen || this.rewindPopup.isOpen || this.relicPanel.isOpen || this.rewindShow.visible;
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
        // (From the first upgrade on: there's something to see it grow by.)
        this.hitPill.visible = WallProgress.best > 1 && !this.wardrobe.isOpen && !this.rewindPopup.isOpen && !this.relicPanel.isOpen;
        this.hitPill.position.copyFrom(this.tray.hitSpot);
        this.placeOffer();
        this.powers.forEach((button) => button.update(delta, !this.busy));
        if (this.hitPill.visible) this.hitPill.update(delta, this.combo.visible ? this.comboShown : 1);
        this.wardrobe.update();
        this.showNews();
        this.bar.setShare(this.barShare);
        this.clock += delta;
        this.bar.setColor(this.fightOn ? 0xe0342e : this.barShare < 0.3 ? BAR.low : BAR.color);
        if (this.retry.visible) this.retry.scale.set(1 + 0.04 * Math.sin(this.clock * 6));
        this.wardrobeButton.visible = WallProgress.best >= SHOWS.wardrobe && !this.wardrobe.isOpen;
        this.rewindButton.visible = rewindKnown() && !this.wardrobe.isOpen && !this.rewindPopup.isOpen;
        if (this.wardrobeButton.visible) WallAnalytics.buttonShown('wardrobe');
        if (this.rewindButton.visible) WallAnalytics.buttonShown('rewind');
        if (this.rewindButton.visible) this.rewindButton.update(delta, this.barShare, this.flying > 0);
        this.relicButton.visible = relicsKnown() && !this.busy;
        if (this.relicButton.visible) {
            WallAnalytics.buttonShown('relics');
            this.relicButton.update(delta);
        }
        // (Hold to punch's button: from its wall on, while there's something to hit.)
        this.holdButton.visible = HOLD.on && WallProgress.best >= HOLD.wall && !this.busy;
        if (this.holdButton.visible) WallAnalytics.buttonShown('hold');
        this.holdButton.update(delta, WallProgress.holdRate);
        this.rewindPopup.update(delta);
        this.offer.update(delta, this.playing && !this.busy);
        this.floater.update(delta, this.playing, !this.busy);
        this.frenzy.update(delta, this.playing || this.fightOn, !this.busy);
        this.frenzy.y = this.barBack.y + (this.timer.visible ? UNDER.timed : UNDER.frenzy);
        this.rewindShow.update(delta);
    }

    /**
     * Upright, the offer goes down the left: in the gap between the relics' button and the weapon's damage over its card,
     * as big as fits there (it follows the cards as they come).
     */
    private placeOffer(): void {
        const screen = Game.safeScreenData ?? Game.overlayScreenData;
        if (!screen || screen.width > screen.height * 1.15) return;
        const top = this.relicButton.y + OFFER_GAP.below;
        const bottom = this.hitPill.y - OFFER_GAP.above;
        const scale = Math.max(OFFER_GAP.least, Math.min(OFFER_GAP.most, (bottom - top) / OFFER_GAP.tall));
        this.offer.scale.set(scale);
        this.offer.position.set(screen.topLeft.x + 14 + (OFFER_GAP.wide * scale) / 2, (top + bottom) / 2);
    }

    public reposition(): void {
        const full = Game.overlayScreenData;
        if (!full) return;
        // (The flash over all of it; the rest clear of the phone's corners, camera and gesture bar.)
        this.flash.position.copyFrom(full.topLeft);
        this.flash.width = full.width;
        this.flash.height = full.height;
        const screen = Game.safeScreenData ?? full;
        const { topLeft } = screen;
        const wide = screen.width > screen.height * 1.15;
        const barY = topLeft.y + (wide ? BAR.wideY : BAR.y);
        this.barBack.position.set(screen.center.x, barY);
        this.timer.position.set(screen.center.x, barY + TIMER.below);
        this.frenzy.reposition(screen.center.x, barY + UNDER.frenzy);
        this.retry.position.set(screen.center.x, topLeft.y + screen.height - (wide ? RETRY.wideUp : TRAY_TOP + RETRY.up));
        this.rewindPopup.reposition();
        // Down the right side (on a wide screen, by the cards): the power-ups, and under them what's offered.
        const side = topLeft.x + screen.width - (wide ? 290 + 24 + 80 : 14 + POWER.size / 2);
        this.powers.forEach((button, i) => button.position.set(side, topLeft.y + (wide ? 160 : 182) + i * POWER.every));
        if (wide) this.offer.position.set(side - 20, topLeft.y + 160 + this.powers.length * POWER.every + 72);
        this.rewindShow.reposition();
        this.rewindButton.position.set(topLeft.x + (wide ? 24 : 16) + 60, topLeft.y + (wide ? 640 : 206));
        // (Under the rewind's, past its strip; on a wide screen, beside it.)
        this.relicButton.position.set(this.rewindButton.x + (wide ? 150 : 0), this.rewindButton.y + (wide ? 0 : 248));
        this.relicPanel.reposition();
        // (Hold to punch: low on the right, where the thumb is, over the cards.)
        const holdBottom = topLeft.y + screen.height - (wide ? 24 : TRAY_TOP + 16) - HOLD_BUTTON.size / 2;
        this.holdButton.position.set(wide ? screen.center.x + 260 : topLeft.x + screen.width - 18 - HOLD_BUTTON.size / 2, holdBottom);
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
