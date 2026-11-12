// AntHud.ts
//
// The 2D layer over the board, laid out like the reference: pause (blue, top-left: the pause popup, PausePopup.ts, with
// sound, retry and home), "Level N" (top), x2 (green,
// top-right), the item belt along the bottom (BoosterBelt: the extra slot, once a level, and the power-ups to come), the
// celebration when a picture is done (celebrate(): turning rays, confetti, the finished picture, three stars, NEXT) and
// the card when it's lost ("No moves left" with TRY AGAIN, and +1 SLOT to play on while the power-up is unused). Drawn with plain shapes and text for now (no atlas).
// Laid out on the visible screen (Game.overlayScreenData), so it hugs the edges on any aspect.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { LevelData, pixelsOf } from '../data/Levels';
import { BOOSTERS, BoosterBelt, BoosterId } from './BoosterBelt';
import type { LevelTier } from '../data/Shop';
import { PausePopup } from './PausePopup';
import { TutorialOverlay } from './TutorialOverlay';
import { IntroCard } from './IntroCard';
import { COIN_BAR, COZY, FONT, buttonParts, circleButton, fillCoinBar, framePlane, iconSprite, label as kitLabel, popupBox, roundButton, tappable } from './UiParts';
import { CELEBRATE_LOOK, Pattern } from './Pattern';
import { AntSave } from '../data/AntSave';
import { AntAudio } from '../audio/AntAudio';

/** The pause button's size (design units, 720 wide) and its distance from the corner. */
const PAUSE = { size: 64, margin: 46 };
/** The x2 button: the pack's glossy button, green, yellow while it's on. */
const SPEED = { width: 116, height: 58, x: 74 };
/** The celebration card: its size, and where its pieces sit (y, from its middle). */
const WIN = { width: 500, height: 660, headingY: -275, starsY: -200, star: 64, middleStar: 84, picture: 210, pictureY: -40, nameY: 108, coinsY: 166, nextY: 252 };
/** The coins won: the coin bar shown over the dim, the coins flying up to it (how many, how far apart, how long). */
/** The tag under the title on a hard / super hard level (design.txt). */
const TIER_TAG: Record<LevelTier, { text: string; color: number } | null> = {
    normal: null, hard: { text: 'HARD', color: 0xff9f3a }, super: { text: 'SUPER HARD', color: 0xff4d6d },
};
const COIN_FLIGHT = { barY: 112, count: 10, gap: 0.06, seconds: 0.55, size: 40, startAt: 1.2 };
const BROWN = 0x6b3f22;

function label(text: string, size: number, fill = 0xffffff): PIXI.Text {
    // Round joins: a mitred outline spikes out of sharp corners (the tops of M, N, W).
    const t = new PIXI.Text(text, {
        fontFamily: FONT, fontSize: size, fill, fontWeight: '900', stroke: BROWN, strokeThickness: Math.round(size * 0.18),
        lineJoin: 'round', align: 'center',
    });
    t.anchor.set(0.5);
    return t;
}

/** One of the pack's glossy buttons (`frame`: Button01_l_<Colour>) with its words. */
function button(text: string, frame: string, width: number, onTap: () => void): PIXI.Container {
    const holder = new PIXI.Container();
    holder.addChild(...buttonParts(width, 66, text, frame));
    tappable(holder, onTap);
    return holder;
}

export class AntHud extends PIXI.Container {
    /** "Level N": the reference's plain brown title. */
    /** HARD / SUPER HARD, on the title's line just right of it (under it, it would cover the picture's tray). */
    private readonly tierTag = kitLabel(20);
    /** A power-up waiting for its target: what to tap, in a dark pill over the belt. */
    private readonly hint = new PIXI.Container();
    private readonly hintBack = framePlane('BasicFrame_Round20', 520, 64);
    private readonly hintText = kitLabel(26);
    private readonly title = new PIXI.Text('', { fontFamily: FONT, fontSize: 46, fill: 0x7b4a28, fontWeight: '900', lineJoin: 'round' });
    private readonly pause: PIXI.Container;
    private pausePopup: PausePopup | null = null;
    /** The 2x speed toggle (Game.timeScale): green, yellow while on. */
    private readonly speed = new PIXI.Container();
    private readonly speedOff = new PIXI.Container();
    private readonly speedOn = new PIXI.Container();
    /** The item belt; its first power-up is the extra slot (one more slot, once a level). */
    private readonly belt: BoosterBelt;
    private extraUsed = false;
    /** The coin bar (shown over a finished level), and the coins flying up to it. */
    private readonly coinBar = new PIXI.Container();
    private readonly coinText = kitLabel(COIN_BAR.textSize);
    private readonly flying = new PIXI.Container();
    private coinTweens: gsap.core.Animation[] = [];
    /** The first-time tutorial's dark, hand and words (over everything). */
    private readonly tutorial = new TutorialOverlay();
    private intro: IntroCard | null = null;
    /** Pointing out a power-up's button: when it lets go by itself, and who to tell when it's gone. */
    private pointTimer?: gsap.core.Tween;
    private pointDone: (() => void) | null = null;
    /** Icons over what a waiting power-up can be used on (the hammer over the slots' tiles). */
    private readonly markers = new PIXI.Container();
    private readonly card = new PIXI.Container();
    private readonly dim = new PIXI.Graphics();
    /** The celebration's turning rays and falling confetti (behind / over the card). */
    private readonly rays = new PIXI.Container();
    /** The celebration's screen: the bright moving pattern behind the rays (made when it starts, gone with it). */
    private celebration: Pattern | null = null;
    private readonly confetti = new PIXI.Container();
    /** The confetti pieces' falls under way. */
    private falling: gsap.core.Timeline[] = [];

    /** `onPause` from the pause button, `onExtraSlot` from the extra slot (on the belt or the lost card), `onBooster`
     *  from the belt's other power-ups. */
    public constructor(private readonly onPause: () => void, private readonly onExtraSlot: () => void,
        private readonly onBooster: (id: BoosterId) => void, private readonly onVideo: (id: BoosterId) => void) {
        super();
        this.title.anchor.set(0.5);
        // The pack's blue round button with the pause sign, the reference's top-left button.
        this.pause = roundButton('Button_Round02_Blue', 'PictoIcon_Pause_1', PAUSE.size);
        tappable(this.pause, () => this.onPause(), null);
        this.buildSpeed();
        this.belt = new BoosterBelt((id) => {
            // Used from the hand's pointing (its first time): the dark goes, so the power-up can be seen working.
            this.hideTutorial();
            if (id === 'slot') {
                if (!this.extraUsed) this.onExtraSlot();
            } else {
                this.onBooster(id);
            }
        }, (id) => this.onVideo(id));
        this.hintBack.tint = 0x1c1d33;
        this.hintBack.alpha = 0.9;
        this.hint.addChild(this.hintBack, this.hintText);
        this.hint.visible = false;
        this.dim.eventMode = 'static';
        this.dim.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.dim.visible = false;
        this.card.visible = false;
        this.rays.visible = false;
        fillCoinBar(this.coinBar, this.coinText);
        this.coinBar.visible = false;
        this.addChild(this.title, this.tierTag, this.speed, this.belt, this.hint, this.pause, this.dim, this.rays, this.card, this.coinBar, this.flying, this.confetti, this.tutorial, this.markers);
        this.markers.eventMode = 'none';
        this.reposition();
    }

    /** "▶▶ x2" on the pack's glossy button (as the game's other buttons): doubles the game's speed (every update's
     *  delta: Game.timeScale) until tapped again. */
    private buildSpeed(): void {
        const sign = (holder: PIXI.Container) => {
            // The fast-forward sign (raw-assets/images/ui{tps}/Icon_FastForward: drawn big and shrunk, smooth), then x2.
            const icon = iconSprite('Icon_FastForward', 40);
            icon.position.set(-24, -3);
            const words = holder.getChildAt(1) as PIXI.Text;
            words.x = 22;
            holder.addChild(icon);
        };
        this.speedOff.addChild(...buttonParts(SPEED.width, SPEED.height, 'x2', 'Button01_l_Green'));
        this.speedOn.addChild(...buttonParts(SPEED.width, SPEED.height, 'x2', 'Button01_l_Yellow'));
        sign(this.speedOff);
        sign(this.speedOn);
        this.speed.addChild(this.speedOff, this.speedOn);
        this.drawSpeed();
        tappable(this.speed, () => {
            Game.timeScale = Game.timeScale > 1 ? 1 : 2;
            this.drawSpeed();
        }, 'toggle');
    }

    /** The pause and x2 buttons: hidden during the tutorial level (which also runs at normal speed). */
    public setControlsVisible(visible: boolean): void {
        this.pause.visible = visible;
        this.speed.visible = visible;
        if (!visible && Game.timeScale > 1) {
            Game.timeScale = 1;
            this.drawSpeed();
        }
    }

    /** A new level: back to normal speed (x2 off). */
    public resetSpeed(): void {
        if (Game.timeScale > 1) Game.timeScale = 1;
        this.drawSpeed();
    }

    private drawSpeed(): void {
        const on = Game.timeScale > 1;
        this.speedOn.visible = on;
        this.speedOff.visible = !on;
    }

    /** The power-up ready (a new level) or spent. */
    /**
     * The tutorial's hole over a tile and its hand: (`x`, `y`) and `radius` in window pixels (the 3D view's,
     * worldToScreen()), turned into this layer's units; `text` over it.
     */
    public showTutorial(x: number, y: number, radius: number, text: string): void {
        const at = this.toLocal(new PIXI.Point(x, y));
        const edge = this.toLocal(new PIXI.Point(x + radius, y));
        this.tutorial.show(at.x, at.y, Math.abs(edge.x - at.x), text);
    }

    public hideTutorial(): void {
        this.tutorial.hide();
        this.tutorial.onTap = null;
        this.pointTimer?.kill();
        const done = this.pointDone;
        this.pointDone = null;
        done?.();
    }

    /** A power-up in play (its button glowing), or none. */
    public setActiveBooster(id: BoosterId | null): void {
        this.belt.setActive(id);
    }

    /** `frame` icons over these spots (window pixels), bobbing; [] for none. */
    public showMarkers(spots: { x: number; y: number }[], frame: string): void {
        this.hideMarkers();
        for (const spot of spots) {
            const at = this.toLocal(new PIXI.Point(spot.x, spot.y));
            const icon = roundButton('Button_Round02_Blue', frame, 56);
            icon.position.set(at.x, at.y);
            this.markers.addChild(icon);
            gsap.fromTo(icon, { y: at.y }, { y: at.y - 10, duration: 0.45, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        }
    }

    public hideMarkers(): void {
        this.markers.children.forEach((child) => gsap.killTweensOf(child));
        this.markers.removeChildren().forEach((child) => child.destroy({ children: true }));
    }

    /**
     * A power-up waiting for its target: the dark over all but `area` (window pixels: the 3D view's, worldToScreen()),
     * the hand at `hand`, `text` over it. A tap outside it calls `onCancel` (the power-up's put away).
     */
    public showFocus(area: { left: number; top: number; right: number; bottom: number }, hand: { x: number; y: number }, text: string,
        onCancel: () => void, button?: BoosterId): void {
        const a = this.toLocal(new PIXI.Point(area.left, area.top));
        const b = this.toLocal(new PIXI.Point(area.right, area.bottom));
        const h = this.toLocal(new PIXI.Point(hand.x, hand.y));
        this.pointTimer?.kill();
        // The power-up's own button stays in sight (glowing) and in reach (tap it again to put it away).
        const at = button ? this.belt.buttonAt(button) : null;
        this.tutorial.showArea(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y), text, h.x, h.y,
            at ? { x: at.x, y: at.y, radius: 50 } : undefined);
        this.tutorial.onTap = () => {
            this.hideTutorial();
            onCancel();
        };
    }

    /** A new mechanic's card (IntroCard); `onDone` from its GOT IT. */
    public showIntro(heading: string, picture: PIXI.Container, name: string, text: string, onDone: () => void): void {
        this.intro?.destroy();
        this.intro = new IntroCard(heading, picture, name, text, () => {
            this.intro?.destroy();
            this.intro = null;
            onDone();
        });
        this.addChild(this.intro);
    }

    /** The dark with a hole over a power-up's belt button and the hand on it, `text` over it; any tap (or a few
     *  seconds) lets it go. */
    public pointAtBooster(id: BoosterId, text: string, onDone: () => void, waitForTap = false): void {
        const at = this.belt.buttonAt(id);
        this.tutorial.show(at.x, at.y, 56, text);
        this.tutorial.onTap = () => this.hideTutorial();
        this.pointDone = onDone;
        this.pointTimer?.kill();
        // A power-up that needs its target (pick up, vacuum) waits for the tap; the others let go after a while.
        if (!waitForTap) this.pointTimer = gsap.delayedCall(4, () => this.hideTutorial());
    }

    /** What to tap for a power-up waiting for its target (null: gone). */
    public showHint(text: string | null): void {
        this.hint.visible = !!text;
        if (!text) return;
        this.hintText.text = text;
        this.hintBack.width = Math.max(320, this.hintText.width + 60);
        this.hintBack.position.set(-this.hintBack.width / 2, -32);
        gsap.fromTo(this.hint.scale, { x: 0.8, y: 0.8 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)' });
    }

    /** The belt's badges as the saved counts now are (after a power-up's used). */
    public refreshBelt(): void {
        this.belt.refresh();
    }

    /** A new level (`ready`: the extra slot can be used again) or the extra slot just used (one fewer owned). */
    public setExtraSlot(ready: boolean): void {
        this.extraUsed = !ready;
        this.belt.setUsed('slot', !ready);
    }

    /** One owned, and not used this level yet (a sixth slot is all there's room for). */
    public get extraSlotAvailable(): boolean {
        return this.belt.unlocked('slot') && !this.extraUsed && AntSave.boosters('slot') > 0;
    }

    /** The pause popup up (`actions` from its buttons and its close cross), or down. */
    public showPause(actions: { resume: () => void; retry: () => void; home: () => void }): void {
        if (this.pausePopup) return;
        this.pausePopup = new PausePopup(actions);
        this.addChild(this.pausePopup);
    }

    public hidePause(): void {
        this.pausePopup?.destroy();
        this.pausePopup = null;
    }

    /** The level being played: its title (and tier's tag); the belt only once the first power-up's unlocked. */
    public setLevel(number: number, tier: LevelTier = 'normal'): void {
        this.title.text = `Level ${number}`;
        const tag = TIER_TAG[tier];
        this.tierTag.visible = !!tag;
        if (tag) {
            this.tierTag.text = tag.text;
            this.tierTag.style.fill = tag.color;
        }
        this.belt.setLevel(number);
        this.belt.visible = number >= BOOSTERS[0].unlock;
        this.placeTierTag();
    }

    private placeTierTag(): void {
        this.tierTag.anchor.set(0, 0.5);
        this.tierTag.position.set(this.title.x + this.title.width / 2 + 12, this.title.y + 2);
    }

    /** The end-of-level card: `won` shows NEXT, otherwise TRY AGAIN; `onButton` from its button. Lost with the
     *  power-up unused, +1 SLOT is offered too (it plays on). */
    public showResult(won: boolean, onButton: () => void): void {
        this.card.removeChildren().forEach((child) => child.destroy({ children: true }));
        const offer = !won && this.extraSlotAvailable;
        const extraHeight = offer ? 84 : 0;
        const back = new PIXI.Graphics()
            .beginFill(0x8a5530).drawRoundedRect(-230, -150, 460, 310 + extraHeight, 36).endFill()
            .beginFill(0xfff4e6).drawRoundedRect(-230, -158, 460, 306 + extraHeight, 36).endFill();
        const heading = label(won ? 'PICTURE DONE!' : 'NO MOVES LEFT', 46, won ? 0x7ed957 : 0xff8a7a);
        heading.y = -80;
        const line = label(won ? 'The ants carried it all home.' : 'Every slot is waiting on a colour\nthe ants can\'t reach.', 24, BROWN);
        line.style.stroke = 0xffffff;
        line.style.strokeThickness = 0;
        line.y = -10;
        if (!won) AntAudio.play('lose');
        const action = button(won ? 'NEXT' : 'TRY AGAIN', won ? 'Button01_l_Green' : 'Button01_l_Yellow', 260, () => {
            this.hideResult();
            onButton();
        });
        action.y = 80;
        this.card.addChild(back, heading, line, action);
        if (offer) {
            // The power-up first: one more slot, and the ants carry on.
            const more = button('+1 SLOT', 'Button01_l_Green', 260, () => {
                this.hideResult();
                this.onExtraSlot();
            });
            more.y = 80;
            action.y = 164;
            this.card.addChild(more);
        }
        this.dim.visible = true;
        this.card.visible = true;
        gsap.fromTo(this.card.scale, { x: 0.6, y: 0.6 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2)' });
        gsap.fromTo(this.dim, { alpha: 0 }, { alpha: 1, duration: 0.3 });
    }

    /**
     * A picture is done: the screen dims behind slowly turning golden rays, confetti in the picture's colours bursts
     * over it, and the card pops in — LEVEL COMPLETE!, three gold stars landing one after another, the finished picture,
     * the coins won (`reward`) and a free power-up (`drop`, if one dropped) — and then the coins fly up to the coin bar, which counts up to the player's coins; NEXT.
     */
    public celebrate(level: LevelData, reward: number, drop: BoosterId | null, onNext: () => void): void {
        this.card.removeChildren().forEach((child) => child.destroy({ children: true }));
        // The popups' box (a warm frame, the moving pattern in it), over the bright celebration screen.
        const back = popupBox(WIN.width, WIN.height);
        this.celebration?.destroy();
        this.celebration = new Pattern(CELEBRATE_LOOK);
        this.addChildAt(this.celebration, this.getChildIndex(this.rays));
        this.placeCelebration();
        const heading = label('LEVEL COMPLETE!', 50, 0xffd23f);
        heading.y = WIN.headingY;
        // The pack's gold stars, between the heading and the picture: the middle one bigger and higher.
        const stars = new PIXI.Container();
        stars.y = WIN.starsY;
        [-1, 0, 1].forEach((n, i) => {
            const star = iconSprite('ItemIcon_Star_Gold', n === 0 ? WIN.middleStar : WIN.star);
            const size = star.scale.x;
            star.position.set(n * 92, n === 0 ? -8 : 6);
            star.rotation = n * 0.18;
            star.scale.set(0);
            stars.addChild(star);
            gsap.to(star.scale, { x: size, y: size, duration: 0.45, delay: 0.35 + i * 0.22, ease: 'back.out(3)' });
        });
        const picture = this.miniPicture(level, WIN.picture);
        picture.y = WIN.pictureY;
        const name = label(level.name.toUpperCase(), 28, BROWN);
        name.style.stroke = 0xffffff;
        name.style.strokeThickness = 6;
        name.y = WIN.nameY;
        // The coins won.
        const coins = new PIXI.Container();
        const coin = iconSprite('Icon_Coin', 46);
        const amount = kitLabel(40, 0xffd23f);
        amount.text = `+${reward}`;
        amount.anchor.set(0, 0.5);
        coin.x = -(amount.width + 54) / 2 + 23;
        amount.x = coin.x + 32;
        coins.addChild(coin, amount);
        coins.y = WIN.coinsY;
        // A free power-up beside the coins: its button, +1.
        const free = new PIXI.Container();
        if (drop) {
            const icon = BOOSTERS.find((b) => b.id === drop)?.icon ?? 'PictoIcon_Plus_1';
            const button = circleButton(icon, 58, COZY.powerFace, 58 * 0.72);
            const plus = kitLabel(36, 0x7ff0a8);
            plus.text = '+1';
            plus.anchor.set(0, 0.5);
            plus.x = 38;
            free.addChild(button, plus);
            free.position.set(90, WIN.coinsY);
            coins.x = -90;
            free.scale.set(0);
            gsap.to(free.scale, { x: 1, y: 1, duration: 0.4, delay: 1.1, ease: 'back.out(3)' });
        }
        AntAudio.play('win');
        AntAudio.play('applause');
        const next = button('NEXT', 'Button01_l_Green', 280, () => {
            this.hideResult();
            onNext();
        });
        next.y = WIN.nextY;
        this.card.addChild(back, heading, picture, stars, name, coins, free, next);
        this.dim.visible = true;
        this.card.visible = true;
        gsap.fromTo(this.card.scale, { x: 0.5, y: 0.5 }, { x: 1, y: 1, duration: 0.5, ease: 'back.out(1.8)' });
        gsap.fromTo(this.dim, { alpha: 0 }, { alpha: 1, duration: 0.3 });
        this.showRays();
        this.burstConfetti(level.palette);
        this.flyCoins(reward, coins);
    }

    /** The coin bar shows the coins before the reward; the coins fly from `from` up to it, each counting in. */
    private flyCoins(reward: number, from: PIXI.Container): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const total = AntSave.coins;
        let shown = total - reward;
        this.coinText.text = String(shown);
        this.coinBar.position.set(screen.center.x - COIN_BAR.width / 2 + COIN_BAR.icon / 2, screen.topLeft.y + COIN_FLIGHT.barY);
        this.coinBar.visible = true;
        this.coinTweens.push(gsap.fromTo(this.coinBar, { alpha: 0 }, { alpha: 1, duration: 0.3, delay: 0.3 }));
        const count = Math.min(COIN_FLIGHT.count, Math.max(1, reward));
        for (let n = 0; n < count; n++) {
            const piece = iconSprite('Icon_Coin', COIN_FLIGHT.size);
            piece.position.set(this.card.x + from.x - 30 + Math.random() * 40, this.card.y + from.y + (Math.random() - 0.5) * 20);
            piece.visible = false;
            this.flying.addChild(piece);
            const step = n === count - 1 ? total - (total - reward + Math.floor((reward * (count - 1)) / count)) : Math.floor(reward / count);
            this.coinTweens.push(gsap.to(piece, {
                x: this.coinBar.x, y: this.coinBar.y, duration: COIN_FLIGHT.seconds, delay: COIN_FLIGHT.startAt + n * COIN_FLIGHT.gap, ease: 'power2.in',
                onStart: () => {
                    piece.visible = true;
                },
                onComplete: () => {
                    piece.visible = false;
                    shown = n === count - 1 ? total : shown + step;
                    this.coinText.text = String(shown);
                    AntAudio.play('pick', 1.2 + n * 0.04);
                    gsap.fromTo(this.coinBar.scale, { x: 1.12, y: 1.12 }, { x: 1, y: 1, duration: 0.2, ease: 'back.out(3)' });
                },
            }));
        }
    }

    /** The finished picture, `size` px across its longer side: one square per pixel. */
    private miniPicture(level: LevelData, size: number): PIXI.Container {
        const holder = new PIXI.Container();
        const pixels = pixelsOf(level);
        const cell = size / Math.max(level.width, level.height);
        const width = cell * level.width;
        const height = cell * level.height;
        const g = new PIXI.Graphics();
        // On a clean white panel (a soft warm edge round it), the pixels solid: no gaps between them.
        g.beginFill(0xe8d2b8).drawRoundedRect(-width / 2 - 16, -height / 2 - 14, width + 32, height + 32, 20).endFill();
        g.beginFill(0xffffff).drawRoundedRect(-width / 2 - 16, -height / 2 - 16, width + 32, height + 32, 20).endFill();
        for (let i = 0; i < pixels.length; i++) {
            if (pixels[i] < 0) continue;
            const x = -width / 2 + (i % level.width) * cell;
            const y = -height / 2 + Math.floor(i / level.width) * cell;
            // (A hair over its cell: no seam shows between neighbours.)
            g.beginFill(new PIXI.Color(level.palette[pixels[i]]).toNumber()).drawRect(x - 0.25, y - 0.25, cell + 0.5, cell + 0.5).endFill();
        }
        holder.addChild(g);
        return holder;
    }

    /** Golden rays behind the card, turning slowly. */
    private showRays(): void {
        this.rays.removeChildren().forEach((child) => child.destroy());
        const g = new PIXI.Graphics();
        const count = 16;
        for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            const b = a + Math.PI / count;
            g.beginFill(0xffffff, 0.2).moveTo(0, 0).lineTo(Math.cos(a) * 900, Math.sin(a) * 900).lineTo(Math.cos(b) * 900, Math.sin(b) * 900).closePath().endFill();
        }
        this.rays.addChild(g);
        this.rays.visible = true;
        gsap.fromTo(this.rays, { alpha: 0 }, { alpha: 1, duration: 0.5 });
        gsap.to(this.rays, { rotation: Math.PI * 2, duration: 24, ease: 'none', repeat: -1 });
    }

    /** Confetti in the picture's colours (and gold), bursting up from the card and fluttering down. */
    private burstConfetti(palette: string[]): void {
        const colors = [...palette.map((hex) => new PIXI.Color(hex).toNumber()), 0xffd23f, 0xffffff];
        const screen = Game.overlayScreenData;
        const floor = screen ? screen.topLeft.y + screen.height + 40 : 1200;
        for (let n = 0; n < 90; n++) {
            const piece = new PIXI.Graphics().beginFill(colors[n % colors.length]).drawRect(-6, -4, 12, 8).endFill();
            piece.position.set(this.card.x, this.card.y - 120);
            piece.rotation = Math.random() * Math.PI;
            this.confetti.addChild(piece);
            const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
            const speed = 380 + Math.random() * 420;
            const upX = piece.x + Math.cos(angle) * speed;
            const upY = piece.y + Math.sin(angle) * speed;
            // Kept, so hideResult() can stop it: a piece cleared away early mustn't be destroyed again when its fall ends.
            const fall = gsap.timeline({
                onComplete: () => {
                    this.falling = this.falling.filter((t) => t !== fall);
                    if (!piece.destroyed) piece.destroy();
                },
            });
            this.falling.push(fall);
            fall.to(piece, { x: upX, y: upY, duration: 0.55, ease: 'power2.out' })
                .to(piece, { x: upX + (Math.random() - 0.5) * 160, y: floor, duration: 1.8 + Math.random() * 1.2, ease: 'power1.in' })
                .to(piece, { rotation: piece.rotation + (Math.random() - 0.5) * 18, duration: 2.6, ease: 'none' }, 0);
        }
    }

    public hideResult(): void {
        this.coinTweens.forEach((tween) => tween.kill());
        this.coinTweens = [];
        gsap.killTweensOf(this.coinBar.scale);
        this.coinBar.visible = false;
        this.flying.removeChildren().forEach((child) => child.destroy());
        this.dim.visible = false;
        this.card.visible = false;
        this.rays.visible = false;
        gsap.killTweensOf(this.rays);
        this.celebration?.destroy();
        this.celebration = null;
        this.falling.forEach((fall) => fall.kill());
        this.falling = [];
        this.confetti.removeChildren().forEach((child) => child.destroy());
    }

    /** The celebration's screen over the whole screen. */
    private placeCelebration(): void {
        const screen = Game.overlayScreenData;
        if (!this.celebration || !screen) return;
        this.celebration.place(screen.topLeft.x - 2, screen.topLeft.y - 2, screen.width + 4, screen.height + 4);
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        this.title.position.set(screen.center.x, screen.topLeft.y + PAUSE.margin);
        this.placeTierTag();
        // Pause top-left, the title in the middle, x2 top-right (the reference's corners).
        this.pause.position.set(screen.topLeft.x + PAUSE.margin, screen.topLeft.y + PAUSE.margin);
        this.pausePopup?.reposition();
        this.intro?.reposition();
        this.speed.position.set(screen.topLeft.x + screen.width - SPEED.x, screen.topLeft.y + PAUSE.margin);
        this.belt.layout(screen.topLeft.x, screen.topLeft.y + screen.height, screen.width);
        this.hint.position.set(screen.center.x, screen.topLeft.y + screen.height - 160);
        this.card.position.set(screen.center.x, screen.center.y);
        this.rays.position.set(screen.center.x, screen.center.y);
        this.placeCelebration();
        this.dim.clear().beginFill(0x2a1a10, 0.45).drawRect(screen.topLeft.x, screen.topLeft.y, screen.width, screen.height).endFill();
    }

    public override destroy(): void {
        gsap.killTweensOf(this.card.scale);
        this.hideResult();
        gsap.killTweensOf(this.speed.scale);
        gsap.killTweensOf(this.pause.scale);
        gsap.killTweensOf(this.hint.scale);
        this.pointTimer?.kill();
        this.pointDone = null;
        this.hideMarkers();
        this.intro?.destroy();
        this.hidePause();
        gsap.killTweensOf(this.dim);
        super.destroy({ children: true });
    }
}
