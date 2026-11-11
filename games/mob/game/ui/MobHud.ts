// MobHud.ts
//
// The 2D layer over the battle, on the Layer Lab pack's sprites (UiParts.ts; laid out on Game.gameScreenData, in the
// stage's 720 x 1080 design units), copying the pack's own screens (library3d/2d/ResourcesData/Preview):
// - top (4_Play_UI_Action): the battle's name, then the enemy base's HP on a dark play bar (a red fill over a dark track), a skull at its start
//   and the battle's number on the gold level badge at its end; the coins top left;
// - before the first touch: the white glove sweeping left and right just under the cannon (HINT), then "GO!" as the
//   battle starts;
// - the cannon's energy: a small upright bar beside the cannon (placeEnergy: it follows it), the energy bolt on top,
//   draining as it fires: cyan, amber when low, flashing red while it's locked recharging;
// - the unit cards across the bottom (CardTray): each charging, then sending its unit out of the cannon;
// - the end card (9_Play_Result_Victory / _Defeat): the winged gold badge or the skull shield over turning rays, the
//   blue or red ribbon with VICTORY / DEFEAT (its bottom about a third of the way down), the REWARDS divider and a
//   coin card, the cannon's three upgrades (UpgradeCard: icon, segmented level bar, price), how far through the area
//   the player is (AreaBar), and HOME (to the main screen) beside CONTINUE / RETRY; all of it scaled down to fit a short
//   screen;
// - the juice: words popping up over the field ("+12" at a gate, "GIANT!"), red edges pulsing as reds near the line (a
//   red flash when they break through), the HP bar easing down with a white trail, coins flying to the counter.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import SoundToggleButton from 'core/ui/SoundToggleButton';
import { Game } from 'core/Game';
import { UpgradeKind } from '../data/MobConfig';
import { COIN_BAR, GlossyButton, fillCoinBar, framePlane, glossyButton, iconButton, iconSprite, label, tappable } from './UiParts';
import { UpgradeCard, UPGRADE_CARD } from './UpgradeCard';
import { AreaBar, AreaView } from './AreaBar';
import { CardTray, CARD, TRAY_WIDTH } from './CardTray';
import { CardReveal } from './CardReveal';
import { CardKind } from '../data/Settings';
import { cardTile } from './CardTile';
import { MobAudio } from '../audio/MobAudio';
import { ZoneConfig } from '../data/LevelList';

/** The HP bar: its size, the frame's tint, the empty track inside it, the fill and the white trail behind it. */
const BAR = { width: 430, height: 46, back: 0x1b1e3a, track: 0x4a1a26, fill: 0xff3d4f, trail: 0xffffff };
/** The end card's rays' turn (radians a second), and its ribbon: size, and tints for a win and a loss. */
const RAYS_SPEED = 0.35;
const RIBBON = { width: 440, height: 92, won: 0x3d6dff, lost: 0xff3d4f };
/** How far down the DEFEAT skull badge sits (px), so its flat bottom tucks behind the ribbon. */
const EMBLEM_LOST_DROP = 34;
/** Where the level text sits on the VICTORY badge (px below its middle: the shield's centre). */
const EMBLEM_LEVEL_Y = 48;
/** The mute button (top right): its size, the gap to the corner, and its icon's scale (128 px icons). */
const MUTE = { size: 60, margin: 14, icon: 0.55 / 128 };
/** HOME's call-out on the end card: its glow's size, the hand's. */
const HOME_CALL = { glow: 230, hand: 96 };
/** The dark band at the top, behind the HUD: how tall, its colour, how dark at its top (it fades to nothing). */
const TOP_SHADE = { height: 240, colour: 0x050a26, alpha: 0.7 };

/** A vertical fade, white at the top to clear (tinted: the top band's). */
let shadeTexture: PIXI.Texture | null = null;
function topShadeTexture(): PIXI.Texture {
    if (shadeTexture) return shadeTexture;
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 128;
    const context = canvas.getContext('2d')!;
    const fade = context.createLinearGradient(0, 0, 0, 128);
    fade.addColorStop(0, 'rgba(255,255,255,1)');
    fade.addColorStop(0.45, 'rgba(255,255,255,0.55)');
    fade.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = fade;
    context.fillRect(0, 0, 4, 128);
    shadeTexture = PIXI.Texture.from(canvas);
    return shadeTexture;
}
/** GIVE UP: the gap under the mute button; its are-you-sure box's size. */
const GIVE_UP = { gap: 12, width: 480, height: 300 };
/** The first-touch hint: the glove's middle this far under the cannon's, sweeping this far either way of it. */
const HINT = { down: 70, sweep: 110 };

/** The energy bar (upright, beside the cannon): its size, its colours (full, low, locked), and where it sits from the
 *  cannon's middle on the screen (px: to its right, its bottom this far up). */
const ENERGY = {
    width: 24, height: 116, fill: 0x45d4ff, low: 0xffc23d, locked: 0xff3d4f, lockedBack: 0x6a0f1c, capped: 0x8a90a8, back: 0x1b1e3a, track: 0x0f2a3d,
    right: 62, up: -6, icon: 42, pulse: 9, pulseScale: 0.08,
};
/** The card tray: how far up from the screen's bottom. */
const TRAY = { bottom: 16 };
/** The first-card tutorial: the screen darkened (the cards over it), and a hand tapping at the card from its right,
 *  its fingertip on the card's edge (`at`: shares of the card from its middle), turned to point in at it. */
const CARD_TUTORIAL = { dim: 0x0b1030, alpha: 0.6, hand: 110, at: { x: 0.42, y: 0.05 }, rotation: -0.75, tap: 0.35 };
/** `a` towards `b` by `t` (0..1), channel by channel. */
function lerpColour(a: number, b: number, t: number): number {
    const mix = (shift: number) => Math.round(((a >> shift) & 255) + ((((b >> shift) & 255) - ((a >> shift) & 255)) * t));
    return (mix(16) << 16) | (mix(8) << 8) | mix(0);
}

/** The end card's upgrade cards: the gap between them. */
const UPGRADE_GAP = 14;
const UPGRADE_KINDS: UpgradeKind[] = ['fire', 'capacity', 'recharge'];
/**
 * The end card's panel, from the badge's middle down (design px): where each part sits, how far it reaches up and
 * down, and where the ribbon's bottom goes on the screen (a share of its height). A short screen scales it all down.
 */
/** A win's copies card beside the coins: how far either side of the middle the two go, the card's size. */
const COPIES_CARD = { x: 78, scale: 0.72 };
const PANEL = {
    emblem: 0, rays: 10, ribbon: 125, rewards: 225, reward: 322, rewardScale: 0.8, upgradeInfo: 414, upgrades: 562,
    area: 754, buttons: 878, top: -150, bottom: 927, ribbonBottomAt: 0.35, margin: 14,
};
/** The buttons under it: HOME (red, a house on it) and CONTINUE, side by side. */
const BUTTONS = { height: 92, home: 112, next: 300, gap: 18 };

/** An upgrade as the end card shows it. */
export interface UpgradeView { kind: UpgradeKind; level: number; cost: number | null }

export interface EndCard {
    won: boolean;
    reward: number;
    upgrades: UpgradeView[];
    coins: number;
    /** Where the next battle is in its area; `finished`: this win was the last of the area before it. */
    area: AreaView;
    finished: { zone: ZoneConfig; number: number; total: number } | null;
    /** Cards won for the first time: revealed over the card (CardReveal). */
    newCards?: CardKind[];
    /** Versus mode open and not tried yet: HOME called out (it leads to its tutorial). */
    homeCall?: boolean;
    /** A win's card copies (one card's: MobSave.storyCopies), shown beside the coins. */
    copies?: { kind: CardKind; count: number } | null;
}


export class MobHud extends PIXI.Container {
    private readonly top = new PIXI.Container();
    private readonly title = label(26);
    private readonly barBack = framePlane('Slider_Play01_Bg', BAR.width, BAR.height, 1.4);
    private readonly barTrack = framePlane('Slider_Play01_FillMask', BAR.width - 16, BAR.height - 16, 1.4);
    private readonly barTrail = framePlane('Slider_Play01_FillMask', BAR.width - 16, BAR.height - 16, 1.4);
    private readonly barFill = framePlane('Slider_Play01_FillMask', BAR.width - 16, BAR.height - 16, 1.4);
    private readonly hpText = label(28);
    private readonly skull = iconSprite('ItemIcon_Skull', 70);
    private readonly badge = new PIXI.Container();
    private readonly badgeText = label(30);
    /** The battle number (setTitle), shown on the VICTORY badge too. */
    private battleNumber = 1;
    private readonly coinPill = new PIXI.Container();
    private readonly mute = new PIXI.Container();
    /** GIVE UP (under the mute button, while a battle's on), and its are-you-sure box. */
    private readonly giveUp = new PIXI.Container();
    private readonly giveUpAsk = new PIXI.Container();
    private onGiveUp: () => void = () => undefined;
    private readonly coinText = label(COIN_BAR.textSize, 0xffffff);
    private readonly hint = new PIXI.Container();
    /** The hint has been put by the cannon (placeEnergy). */
    private hintPlaced = false;
    private readonly hand = iconSprite('Tutorial_Hand', 120);
    private readonly go = iconSprite('ActionText_Go', 300);
    private readonly vignette = new PIXI.Graphics();
    /** The dark band from the top of the screen, behind the HUD (it reads over a bright field). */
    private readonly topShade = new PIXI.Sprite(topShadeTexture());
    private readonly pops = new PIXI.Container();
    /** Giants' hit counts (a few labels reused). */
    private readonly giantLabels = new PIXI.Container();
    // The end card.
    private readonly card = new PIXI.Container();
    /** All of the card but the dim, laid out from the badge's middle (PANEL), scaled to fit. */
    private readonly panel = new PIXI.Container();
    private readonly dim = new PIXI.Graphics();
    private readonly rays = iconSprite('Image_Effect_Rotate', 640);
    private readonly emblem = new PIXI.Container();
    private readonly ribbon = new PIXI.Container();
    private readonly ribbonBack = framePlane('Title_Ribbon02_White1', RIBBON.width, RIBBON.height, RIBBON.height / 116);
    private readonly ribbonText = label(48);
    private readonly rewardsTitle = label(28);
    private readonly dividerLeft = framePlane('Title_Line01_Divider_Left', 170, 30, 0.7);
    private readonly dividerRight = framePlane('Title_Line01_Divider_Right', 170, 30, 0.7);
    private readonly rewardCard = new PIXI.Container();
    /** A win's card copies, beside the coins (its card, ×N). */
    private readonly copiesCard = new PIXI.Container();
    private readonly rewardText = label(30);
    private readonly upgradeInfo = label(24);
    private readonly upgrades = new PIXI.Container();
    private readonly upgradeCards = new Map<UpgradeKind, UpgradeCard>();
    private readonly area = new AreaBar();
    private readonly next: GlossyButton;
    private readonly home: GlossyButton;
    /** HOME's call-out (a glow, a hand, VERSUS!): the end card's while versus mode waits to be tried. */
    private readonly homeCall = new PIXI.Container();
    // The energy bar.
    private readonly energy = new PIXI.Container();
    private readonly energyBack = framePlane('Slider_Play01_Bg', ENERGY.width, ENERGY.height, 1);
    private readonly energyTrack = framePlane('Slider_Play01_FillMask', ENERGY.width - 10, ENERGY.height - 10, 1);
    private readonly energyFill = framePlane('Slider_Play01_FillMask', ENERGY.width - 10, ENERGY.height - 10, 1);
    private readonly energyIcon = iconSprite('ResourceBar_Single_Icon_Energy', ENERGY.icon);
    /** The unit cards, and a new one's reveal. */
    private readonly cardTray = new CardTray();
    /** The first-card tutorial: the darkening under the cards, and the hand and words over them. */
    private readonly tutorialDim = new PIXI.Graphics();
    private readonly tutorialHint = new PIXI.Container();
    private readonly tutorialHand = iconSprite('Tutorial_Hand', CARD_TUTORIAL.hand);
    private tutorialCard: CardKind | null = null;
    private readonly reveal = new CardReveal();
    /** The reveal waiting to start over the end card (stopped if the card goes first). */
    private revealCall: gsap.core.Tween | null = null;
    private energyShown = 1;
    private energyLocked = false;
    /** The field's full: the cannon's waiting (MAX over the bar). */
    private energyCapped = false;
    private readonly energyMaxText = label(16, 0xdfe3f0);
    private hpShown = 1;
    /** The bar's share as drawn (eases after hpShown), and the white trail behind it (eases slower). */
    private hpBar = 1;
    private hpTrail = 1;
    private danger = 0;
    private redFlash = 0;
    private time = 0;
    private goScale = 1;
    /** An arena match is on (setDuel): the top bar stays hidden. */
    private duel = false;

    /** `onHome`: the end card's HOME (to the main screen); `onCard`: a charged unit card tapped. */
    public constructor(onNext: () => void, onUpgrade: (kind: UpgradeKind) => void, onHome: () => void, onCard: (kind: CardKind) => void = () => undefined) {
        super();
        this.cardTray.onTap = onCard;
        // Top: the bar with its skull and badge, the title, the coins.
        this.barBack.tint = BAR.back;
        this.barTrack.tint = BAR.track;
        this.barTrack.position.set(8, 8);
        this.barTrail.tint = BAR.trail;
        this.barFill.tint = BAR.fill;
        this.barTrail.position.set(8, 8);
        this.barFill.position.set(8, 8);
        this.hpText.position.set(BAR.width / 2, BAR.height / 2 - 1);
        this.skull.position.set(-6, BAR.height / 2);
        const badgeBack = iconSprite('Slider_Level02_Icon_Badge_Yellow', 84);
        this.badgeText.y = -2;
        this.badge.addChild(badgeBack, this.badgeText);
        this.badge.position.set(BAR.width + 4, BAR.height / 2);
        this.title.position.set(BAR.width / 2, -24);
        // The level's name isn't shown in a battle (not needed: the badge has its number).
        this.title.visible = false;
        this.top.addChild(this.barBack, this.barTrack, this.barTrail, this.barFill, this.hpText, this.skull, this.badge, this.title);
        fillCoinBar(this.coinPill, this.coinText);
        // The energy bar: frame, dark track, the fill rising from the bottom, the bolt on top.
        this.energyBack.tint = ENERGY.back;
        this.energyTrack.tint = ENERGY.track;
        this.energyTrack.position.set(5, 5);
        this.energyFill.position.set(5, 5);
        // The bolt at its left end, like the skull on the HP bar.
        // The bolt on top of it.
        this.energyIcon.position.set(ENERGY.width / 2, -6);
        this.energyMaxText.text = 'MAX';
        this.energyMaxText.position.set(ENERGY.width / 2, -ENERGY.icon - 4);
        this.energyMaxText.visible = false;
        this.energy.addChild(this.energyBack, this.energyTrack, this.energyFill, this.energyIcon, this.energyMaxText);
        // Its position is its bottom middle (placeEnergy).
        this.energy.pivot.set(ENERGY.width / 2, ENERGY.height);
        this.buildMute();
        this.buildGiveUp();
        this.tutorialDim.visible = false;
        this.tutorialHint.visible = false;
        this.tutorialHint.eventMode = 'none';
        // Its fingertip is its anchor.
        this.tutorialHand.anchor.set(0.3, 0.05);
        this.tutorialHand.rotation = CARD_TUTORIAL.rotation;
        this.tutorialHint.addChild(this.tutorialHand);
        this.topShade.tint = TOP_SHADE.colour;
        this.topShade.alpha = TOP_SHADE.alpha;
        this.addChild(this.topShade, this.vignette, this.giantLabels, this.pops, this.top, this.coinPill, this.energy, this.tutorialDim, this.cardTray, this.tutorialHint, this.mute, this.giveUp, this.giveUpAsk);

        // The hint: the glove sweeping under the cannon (placeEnergy puts it there).
        this.hand.rotation = -0.3;
        this.hint.addChild(this.hand);
        this.addChild(this.hint);
        gsap.fromTo(this.hand, { x: -HINT.sweep }, { x: HINT.sweep, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        this.goScale = this.go.scale.x;
        this.go.visible = false;
        this.addChild(this.go);

        // The end card.
        this.dim.eventMode = 'static';
        this.ribbonBack.position.set(-RIBBON.width / 2, -RIBBON.height / 2);
        this.ribbon.addChild(this.ribbonBack, this.ribbonText);
        this.ribbonText.y = -10;
        this.rewardsTitle.text = 'REWARDS';
        const cardBack = framePlane('BorderFrame_Round24', 150, 150, 0.8);
        cardBack.tint = 0xf4f7ff;
        cardBack.position.set(-75, -75);
        const coin = iconSprite('Image_Demo_Coin', 104);
        coin.y = -8;
        this.rewardText.anchor.set(1, 1);
        this.rewardText.position.set(66, 70);
        this.rewardCard.addChild(cardBack, coin, this.rewardText);
        // The upgrades: a card each (UpgradeCard), side by side.
        this.upgradeInfo.text = 'UPGRADE YOUR CANNON';
        UPGRADE_KINDS.forEach((kind, i) => {
            const card = new UpgradeCard(kind, onUpgrade);
            card.x = (i - 1) * (UPGRADE_CARD.width + UPGRADE_GAP);
            this.upgradeCards.set(kind, card);
            this.upgrades.addChild(card);
        });
        this.next = glossyButton(BUTTONS.next, BUTTONS.height, 'CONTINUE', 'Button01_l_Sky');
        tappable(this.next, onNext, null);
        // (Blue: going home isn't a bad thing, red would say it is.)
        this.home = iconButton(BUTTONS.home, BUTTONS.height, 'Button01_l_Blue', 'PictoIcon_Home_1', 46);
        tappable(this.home, onHome);
        // Side by side, centred together: HOME on the left.
        const row = BUTTONS.home + BUTTONS.gap + BUTTONS.next;
        this.home.x = -row / 2 + BUTTONS.home / 2;
        this.next.x = row / 2 - BUTTONS.next / 2;
        this.rewardCard.scale.set(PANEL.rewardScale);
        this.emblem.y = PANEL.emblem;
        this.rays.y = PANEL.rays;
        this.ribbon.y = PANEL.ribbon;
        this.rewardsTitle.y = PANEL.rewards;
        this.dividerLeft.position.set(-100 - 170, PANEL.rewards - 15);
        this.dividerRight.position.set(100, PANEL.rewards - 15);
        this.rewardCard.y = PANEL.reward;
        this.copiesCard.y = PANEL.reward;
        this.upgradeInfo.y = PANEL.upgradeInfo;
        this.upgrades.y = PANEL.upgrades;
        this.area.y = PANEL.area;
        this.next.y = PANEL.buttons;
        this.home.y = PANEL.buttons;
        // The call-out round HOME: a glow behind it, VERSUS! over it, a hand tapping at it.
        const callGlow = iconSprite('Glow_Circle01', HOME_CALL.glow);
        callGlow.tint = 0xffd23f;
        callGlow.blendMode = PIXI.BLEND_MODES.ADD;
        // VERSUS! on a green plate over HOME.
        const callWords = label(24);
        callWords.text = 'VERSUS!';
        const callPlate = framePlane('BasicFrame_Round20', Math.max(120, callWords.width + 32), 42, 0.5);
        callPlate.tint = 0x2fd35c;
        callPlate.position.set(-callPlate.width / 2, -BUTTONS.height / 2 - 30 - 21);
        callWords.y = -BUTTONS.height / 2 - 30 - 1;
        const callHand = iconSprite('Tutorial_Hand', HOME_CALL.hand);
        callHand.position.set(BUTTONS.home * 0.45, BUTTONS.height * 0.45);
        callHand.name = 'hand';
        this.homeCall.addChild(callGlow, callPlate, callWords);
        this.homeCall.position.set(this.home.x, this.home.y);
        this.homeCall.visible = false;
        this.homeCall.addChild(callHand);
        this.panel.addChild(this.rays, this.emblem, this.ribbon, this.dividerLeft, this.dividerRight, this.rewardsTitle, this.rewardCard, this.copiesCard, this.upgradeInfo, this.upgrades, this.area, this.homeCall, this.home, this.next);
        // (The hand over HOME, not under it.)
        const hand = this.homeCall.getChildByName('hand');
        if (hand) this.panel.addChild(hand);
        this.card.addChild(this.dim, this.panel);
        this.card.visible = false;
        this.addChild(this.card, this.reveal);
        this.layout();
    }

    public layout(): void {
        const screen = Game.gameScreenData;
        if (!screen) return;
        const { topLeft, center, width, height, bottomLeft } = screen;
        const scale = Math.min(1, (width - 60) / (BAR.width + 120));
        this.top.scale.set(scale);
        this.top.position.set(center.x - (BAR.width * scale) / 2, topLeft.y + 72);
        this.coinPill.position.set(topLeft.x + 46, topLeft.y + 44);
        this.topShade.position.set(topLeft.x, topLeft.y);
        this.topShade.width = width;
        this.topShade.height = TOP_SHADE.height;
        // The mute button in the top right corner.
        this.mute.position.set(topLeft.x + width - MUTE.margin - MUTE.size / 2, topLeft.y + 44);
        // Under the mute button; in an arena match (its life bars across the top there) left of it.
        if (this.duel) this.giveUp.position.set(this.mute.x - MUTE.size - GIVE_UP.gap, this.mute.y);
        else this.giveUp.position.set(this.mute.x, this.mute.y + MUTE.size + GIVE_UP.gap);
        this.giveUpAsk.position.copyFrom(center);
        (this.giveUpAsk.getChildByName('dim') as PIXI.Graphics | null)?.clear().beginFill(0x0b1030, 0.72).drawRect(topLeft.x - center.x, topLeft.y - center.y, width, height).endFill();
        // Till the cannon's been seen (placeEnergy then keeps it just under it).
        if (!this.hintPlaced) this.hint.position.set(center.x, topLeft.y + height * 0.62);
        this.go.position.set(center.x, center.y - 80);
        this.dim.clear().beginFill(0x0b1030, 0.72).drawRect(topLeft.x, topLeft.y, width, height).endFill();
        // The panel: as big as fits (the screen's height and width), the ribbon's bottom about a third of the way down,
        // all of it kept on the screen.
        const fit = Math.min(1, (height - PANEL.margin * 2) / (PANEL.bottom - PANEL.top), (width - PANEL.margin * 2) / (UPGRADE_CARD.width * 3 + UPGRADE_GAP * 2 + 20));
        const ribbonBottom = PANEL.ribbon + RIBBON.height / 2;
        let y = topLeft.y + height * PANEL.ribbonBottomAt - ribbonBottom * fit;
        y = Math.min(y, topLeft.y + height - PANEL.margin - PANEL.bottom * fit);
        y = Math.max(y, topLeft.y + PANEL.margin - PANEL.top * fit);
        this.panel.scale.set(fit);
        this.panel.position.set(center.x, y);
        // Across the bottom, centred (narrower on a narrow screen).
        // The cards across the bottom (narrower on a narrow screen).
        const trayScale = Math.min(1, (width - 30) / TRAY_WIDTH);
        this.cardTray.scale.set(trayScale);
        this.cardTray.position.set(center.x, bottomLeft.y - TRAY.bottom - (CARD.height / 2) * trayScale);
        this.tutorialDim.clear().beginFill(CARD_TUTORIAL.dim, CARD_TUTORIAL.alpha).drawRect(topLeft.x, topLeft.y, width, height).endFill();
        this.placeTutorial();
        this.drawVignette();
        this.drawBar();
        this.reveal.layout();
    }

    /** The mute button: the shared sound toggle (it mutes everything and remembers it) on a dark round button. */
    private buildMute(): void {
        const back = PIXI.Sprite.from('Button_Round03_Dark');
        back.anchor.set(0.5);
        back.width = back.height = MUTE.size;
        const icons = new SoundToggleButton('PictoIcon_Sound', 'PictoIcon_Sound_Off');
        icons.scale.set(MUTE.size * MUTE.icon);
        this.mute.addChild(back, icons);
        this.mute.eventMode = 'static';
        this.mute.cursor = 'pointer';
        this.mute.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            // The icons do the toggling; a tap on the round button round them is passed on to them.
            if (event.target !== icons) icons.emit('pointertap', event);
            gsap.killTweensOf(this.mute.scale);
            gsap.fromTo(this.mute.scale, { x: 0.86, y: 0.86 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)' });
        });
    }

    /** GIVE UP: the white flag on a round button like the mute's; a tap asks first (GIVE UP? YES / NO). */
    private buildGiveUp(): void {
        const back = PIXI.Sprite.from('Button_Round03_Dark');
        back.anchor.set(0.5);
        back.width = back.height = MUTE.size;
        const flag = iconSprite('PictoIcon_Flag', MUTE.size * 0.55);
        this.giveUp.addChild(back, flag);
        this.giveUp.visible = false;
        tappable(this.giveUp, () => this.askGiveUp(true));
        // The box: over a dim (a tap there: NO), its question, YES (red) and NO.
        const dim = new PIXI.Graphics();
        dim.name = 'dim';
        dim.eventMode = 'static';
        dim.on('pointertap', () => this.askGiveUp(false));
        const box = framePlane('BorderFrame_Round24', GIVE_UP.width, GIVE_UP.height, 1);
        box.tint = 0x1b2a5a;
        box.position.set(-GIVE_UP.width / 2, -GIVE_UP.height / 2);
        box.eventMode = 'static';
        const question = label(44);
        question.text = 'GIVE UP?';
        question.y = -GIVE_UP.height / 2 + 64;
        const note = label(22, 0xc9d3ff);
        note.text = 'You will lose this battle';
        note.y = question.y + 52;
        const yes = glossyButton(190, 84, 'YES', 'Button01_l_Red');
        yes.position.set(-105, GIVE_UP.height / 2 - 70);
        tappable(yes, () => {
            this.askGiveUp(false);
            this.onGiveUp();
        });
        const no = glossyButton(190, 84, 'NO', 'Button01_l_Sky');
        no.position.set(105, GIVE_UP.height / 2 - 70);
        tappable(no, () => this.askGiveUp(false));
        this.giveUpAsk.addChild(dim, box, question, note, yes, no);
        this.giveUpAsk.visible = false;
    }

    /** The are-you-sure box up (or down). */
    private askGiveUp(open: boolean): void {
        this.giveUpAsk.visible = open;
        if (open) gsap.fromTo(this.giveUpAsk.scale, { x: 0.7, y: 0.7 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(2.2)' });
    }

    /** GIVE UP shown (a battle on) or not; `onGiveUp`: YES (the battle's lost). */
    public setGiveUp(shown: boolean, onGiveUp?: () => void): void {
        if (onGiveUp) this.onGiveUp = onGiveUp;
        this.giveUp.visible = shown;
        if (!shown) this.giveUpAsk.visible = false;
    }

    /** Whether a screen point (CSS px) is on a HUD button the field shouldn't also take (the mute button, GIVE UP, its box). */
    public onButton(screenX: number, screenY: number): boolean {
        if (this.giveUpAsk.visible) return true;
        return (this.mute.visible && this.mute.getBounds().contains(screenX, screenY)) || (this.giveUp.visible && this.giveUp.getBounds().contains(screenX, screenY)) || this.cardTray.hits(screenX, screenY);
    }

    /** Where the top block (HP bar, badge, level name) ends, in screen pixels (layout() first). */
    public topBottom(): number {
        return this.top.getBounds().bottom;
    }

    /** The energy fill: its width the share left, from the left; cyan, amber when low, flashing red while locked. */
    /**
     * The energy: upright, filling from the bottom (empty is empty). Cyan, amber when low; run dry it's locked till
     * full: red, the whole bar beating in a sine (its back glowing red, a little bigger and back), as it refills; the
     * field full (the cannon waiting): grey, MAX over it.
     */
    private drawEnergy(): void {
        const inner = ENERGY.height - 10;
        const height = inner * this.energyShown;
        this.energyFill.height = Math.max(1, height) / this.energyFill.scale.y;
        this.energyFill.y = 5 + inner - height;
        this.energyFill.visible = height > 1;
        const wave = 0.5 + 0.5 * Math.sin(this.time * ENERGY.pulse);
        const locked = this.energyLocked;
        this.energyFill.tint = locked ? ENERGY.locked : this.energyCapped ? ENERGY.capped : this.energyShown < 0.25 ? ENERGY.low : ENERGY.fill;
        this.energyFill.alpha = locked ? 0.6 + 0.4 * wave : 1;
        this.energyBack.tint = locked ? lerpColour(ENERGY.back, ENERGY.lockedBack, wave) : ENERGY.back;
        this.energyIcon.tint = locked ? lerpColour(0xffffff, ENERGY.locked, wave) : this.energyCapped ? ENERGY.capped : 0xffffff;
        if (locked) this.energy.scale.set(1 + ENERGY.pulseScale * wave);
        else if (!gsap.isTweening(this.energy.scale)) this.energy.scale.set(1);
        this.energyMaxText.visible = this.energyCapped && !locked;
    }

    private drawBar(): void {
        const inner = BAR.width - 16;
        this.barTrail.width = Math.max(30, inner * this.hpTrail) / this.barTrail.scale.x;
        this.barTrail.visible = this.hpTrail > 0.001;
        this.barFill.width = Math.max(30, inner * this.hpBar) / this.barFill.scale.x;
        this.barFill.visible = this.hpBar > 0.001;
    }

    /** Red edges round the screen: as strong as the danger (and the breakthrough flash), pulsing. */
    private drawVignette(): void {
        const screen = Game.gameScreenData;
        if (!screen) return;
        const strength = Math.min(1, this.danger * this.danger * (0.75 + 0.25 * Math.sin(this.time * 9)) + this.redFlash);
        this.vignette.clear();
        if (strength < 0.02) return;
        const { topLeft, width, height } = screen;
        const band = Math.min(width, height) * 0.16;
        for (let k = 0; k < 6; k++) {
            const inset = (band / 6) * k;
            const alpha = strength * 0.16 * (1 - k / 6);
            this.vignette.beginFill(0xff1f3d, alpha);
            this.vignette.drawRect(topLeft.x, topLeft.y + inset, width, band / 6);
            this.vignette.drawRect(topLeft.x, topLeft.y + height - inset - band / 6, width, band / 6);
            this.vignette.drawRect(topLeft.x + inset, topLeft.y, band / 6, height);
            this.vignette.drawRect(topLeft.x + width - inset - band / 6, topLeft.y, band / 6, height);
            this.vignette.endFill();
        }
    }

    /** Each frame: the bar eases, the danger edges pulse, the end card's rays turn. `danger`: 0..1 (Battle.danger). */
    public update(dt: number, danger: number): void {
        this.time += dt;
        this.danger = danger;
        this.drawEnergy();
        this.cardTray.update(dt);
        // The hand follows its card (rising as it's ready, bouncing).
        this.placeTutorial();
        this.reveal.update(dt);
        this.redFlash = Math.max(0, this.redFlash - dt * 1.5);
        const before = this.hpBar + this.hpTrail;
        this.hpBar += (this.hpShown - this.hpBar) * Math.min(1, dt * 12);
        this.hpTrail += (this.hpBar - this.hpTrail) * Math.min(1, dt * 2.5);
        if (this.hpTrail < this.hpBar) this.hpTrail = this.hpBar;
        if (Math.abs(this.hpBar + this.hpTrail - before) > 0.0001) this.drawBar();
        this.drawVignette();
        if (this.card.visible) {
            this.rays.rotation += dt * RAYS_SPEED;
            this.upgradeCards.forEach((card) => card.update(dt));
            this.area.update(dt);
        }
    }

    /** An arena match: its own HUD (DuelHud) has the life and the clock, so the battle's top bar goes. */
    public setDuel(on: boolean): void {
        this.duel = on;
        this.top.visible = !on;
        this.layout();
    }

    public setTitle(battle: number, name: string): void {
        this.battleNumber = battle;
        this.badgeText.text = `${battle}`;
        this.title.text = name.toUpperCase();
    }

    public setBaseHp(hp: number, max: number): void {
        const share = max > 0 ? hp / max : 0;
        this.hpShown = share;
        this.hpText.text = `${hp}`;
        // A fresh battle: the bar starts full, no trail.
        if (share >= 1) {
            this.hpBar = 1;
            this.hpTrail = 1;
            this.drawBar();
        }
    }

    public setCoins(coins: number): void {
        this.coinText.text = `${coins}`;
    }

    /** The battle starts: the hint goes, "GO!" pops. */
    public start(): void {
        if (this.hint.visible) gsap.to(this.hint, { alpha: 0, duration: 0.25, onComplete: () => { this.hint.visible = false; } });
        this.go.visible = true;
        this.go.alpha = 1;
        gsap.fromTo(this.go.scale, { x: this.goScale * 0.2, y: this.goScale * 0.2 }, { x: this.goScale, y: this.goScale, duration: 0.4, ease: 'back.out(3)' });
        gsap.to(this.go, { alpha: 0, duration: 0.35, delay: 0.6, onComplete: () => { this.go.visible = false; } });
    }

    /** A fresh battle: the hint back. */
    public reset(): void {
        gsap.killTweensOf(this.hint);
        this.hint.visible = true;
        this.hint.alpha = 1;
        this.go.visible = false;
    }

    /** A word popping up at a screen point (CSS pixels), rising and fading. */
    public pop(value: string, screenX: number, screenY: number, color = 0xffffff, size = 40): void {
        const at = this.toLocal(new PIXI.Point(screenX, screenY));
        const word = label(size, color);
        word.text = value;
        word.position.copyFrom(at);
        word.scale.set(0.3);
        this.pops.addChild(word);
        gsap.to(word.scale, { x: 1, y: 1, duration: 0.35, ease: 'back.out(3)' });
        gsap.to(word, { y: at.y - 70, duration: 0.9, ease: 'power1.out' });
        gsap.to(word, { alpha: 0, duration: 0.3, delay: 0.6, onComplete: () => word.destroy() });
    }

    /** The giants' hits left, at screen points (CSS pixels): blue or red pills over their heads. */
    public setGiantLabels(entries: readonly { x: number; y: number; hp: number; blue: boolean }[]): void {
        while (this.giantLabels.children.length < entries.length) {
            const holder = new PIXI.Container();
            const back = new PIXI.Graphics();
            const text = label(24);
            holder.addChild(back, text);
            this.giantLabels.addChild(holder);
        }
        this.giantLabels.children.forEach((child, i) => {
            const holder = child as PIXI.Container;
            const entry = entries[i];
            holder.visible = !!entry;
            if (!entry) return;
            holder.position.copyFrom(this.toLocal(new PIXI.Point(entry.x, entry.y)));
            const [back, text] = holder.children as [PIXI.Graphics, PIXI.Text];
            const tagged = back as PIXI.Graphics & { blue?: boolean };
            if (text.text !== String(entry.hp) || tagged.blue !== entry.blue) {
                text.text = String(entry.hp);
                const width = Math.max(46, text.width + 20);
                back.clear().lineStyle(3, 0x10123a).beginFill(entry.blue ? 0x3d6dff : 0xff3d4f).drawRoundedRect(-width / 2, -17, width, 34, 17).endFill();
                tagged.blue = entry.blue;
            }
        });
    }

    /** A red flash over the edges (a breakthrough). */
    public flashRed(): void {
        this.redFlash = 1;
    }

    /** Coins flying from the reward card to the counter, adding to it as they land (`from` -> `to`). */
    public flyCoins(from: number, to: number, onLand?: () => void): void {
        const count = 12;
        const start = this.toLocal(this.rewardCard.getGlobalPosition());
        const target = this.coinPill.position;
        for (let n = 0; n < count; n++) {
            const coin = iconSprite('Image_Demo_Coin', 46);
            const size = coin.scale.x;
            coin.position.set(start.x + (Math.random() - 0.5) * 80, start.y + (Math.random() - 0.5) * 60);
            coin.scale.set(0);
            this.addChild(coin);
            const delay = 0.35 + n * 0.05;
            gsap.to(coin.scale, { x: size, y: size, duration: 0.2, delay, ease: 'back.out(3)' });
            gsap.to(coin, {
                x: target.x, y: target.y, duration: 0.55, delay: delay + 0.15, ease: 'power2.in',
                onComplete: () => {
                    coin.destroy();
                    this.coinText.text = `${Math.round(from + ((to - from) * (n + 1)) / count)}`;
                    gsap.fromTo(this.coinPill.scale, { x: 1.15, y: 1.15 }, { x: 1, y: 1, duration: 0.2 });
                    onLand?.();
                },
            });
        }
    }

    public showEnd(card: EndCard): void {
        this.emblem.removeChildren();
        const emblem = iconSprite(card.won ? 'Image_Bagde_Wing1' : 'Image_Badge_Skull', card.won ? 270 : 290);
        // The skull badge's art stops flat well above its frame's bottom: lower it so the ribbon covers that edge.
        if (!card.won) emblem.y = EMBLEM_LOST_DROP;
        this.emblem.addChild(emblem);
        if (card.won) {
            // "LV 10" in the middle of the wing badge's shield.
            const level = label(46);
            level.text = `LV ${this.battleNumber}`;
            level.y = EMBLEM_LEVEL_Y;
            this.emblem.addChild(level);
        }
        this.rays.tint = card.won ? 0xfff0a0 : 0x8ea0d8;
        this.rays.alpha = card.won ? 0.6 : 0.3;
        this.ribbonBack.tint = card.won ? RIBBON.won : RIBBON.lost;
        this.ribbonText.text = card.won ? 'VICTORY' : 'DEFEAT';
        this.rewardText.text = `${card.reward}`;
        this.rewardCard.alpha = card.won || card.reward > 0 ? 1 : 0.55;
        // Copies won: their card beside the coins (the two side by side).
        this.copiesCard.removeChildren().forEach((child) => child.destroy({ children: true }));
        this.rewardCard.x = card.copies ? -COPIES_CARD.x : 0;
        this.copiesCard.x = COPIES_CARD.x;
        this.copiesCard.visible = !!card.copies;
        if (card.copies) {
            const tile = cardTile(card.copies.kind, COPIES_CARD.scale);
            const count = label(30);
            count.anchor.set(1, 1);
            count.text = `×${card.copies.count}`;
            count.position.set(52, 64);
            this.copiesCard.addChild(tile, count);
            gsap.fromTo(this.copiesCard.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.4, delay: 0.45, ease: 'back.out(3)' });
        }
        this.next.words.text = card.won ? 'CONTINUE' : 'RETRY';
        this.callHome(!!card.homeCall);
        this.refreshUpgrade(card);
        this.area.set(card.area, card.won ? card.finished : null);
        this.area.play(0.7);
        // The battle's own bar would sit behind the badge: it goes while the card's up.
        this.top.visible = false;
        this.card.visible = true;
        this.card.alpha = 0;
        gsap.to(this.card, { alpha: 1, duration: 0.3 });
        gsap.fromTo(this.emblem.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.55, ease: 'back.out(2.2)' });
        gsap.fromTo(this.ribbon.scale, { x: 0.2, y: 1 }, { x: 1, y: 1, duration: 0.45, delay: 0.15, ease: 'back.out(2)' });
        gsap.fromTo(this.rewardCard.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.4, delay: 0.3, ease: 'back.out(3)' });
        // A card won for the first time: a big deal, revealed over it once it's in.
        this.revealCall?.kill();
        this.revealCall = card.newCards?.length ? gsap.delayedCall(1.1, () => this.reveal.play(card.newCards!)) : null;
    }

    /** HOME called out (or not): its glow and VERSUS!, a hand tapping at it, the button bouncing. */
    private callHome(on: boolean): void {
        const hand = this.panel.getChildByName('hand') as PIXI.Sprite | null;
        gsap.killTweensOf([this.home.scale, this.homeCall, hand].filter(Boolean));
        this.homeCall.visible = on;
        if (hand) hand.visible = on;
        this.home.scale.set(1);
        if (!on) return;
        gsap.to(this.home.scale, { x: 1.14, y: 1.14, duration: 0.45, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        gsap.fromTo(this.homeCall, { alpha: 0.55 }, { alpha: 1, duration: 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        if (hand) {
            // On HOME's left (nothing's there: CONTINUE's on its right; under it, it'd be off the screen's bottom),
            // mirrored and turned to point down-right at it.
            hand.scale.x = -Math.abs(hand.scale.x);
            hand.rotation = Math.PI / 2;
            hand.position.set(this.home.x - BUTTONS.home * 0.62, this.home.y - BUTTONS.height * 0.05);
            gsap.to(hand, { x: hand.x + 10, y: hand.y + 10, duration: 0.4, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        }
    }

    public refreshUpgrade(card: Pick<EndCard, 'upgrades' | 'coins'>): void {
        for (const view of card.upgrades) this.upgradeCards.get(view.kind)?.set(view, card.coins);
    }

    /** The energy bar beside the cannon: the cannon's middle at this screen point (CSS px). */
    public placeEnergy(screenX: number, screenY: number): void {
        const at = this.toLocal(new PIXI.Point(screenX, screenY));
        this.energy.position.set(at.x + ENERGY.right, at.y + ENERGY.up);
        this.hint.position.set(at.x, at.y + HINT.down);
        this.hintPlaced = true;
    }

    /** The unit cards the player has (`fresh`: just unlocked). */
    public setCards(kinds: readonly CardKind[], fresh: readonly CardKind[] = []): void {
        this.cardTray.setCards(kinds, fresh);
    }

    /** A used card's place taken by the next waiting one; the waiting pile (the next, how many). */
    public replaceCard(old: CardKind, next: CardKind): void {
        this.cardTray.replace(old, next);
    }

    public setCardPile(next: CardKind | null, waiting: number): void {
        this.cardTray.setPile(next, waiting);
    }

    public setCardCharge(kind: CardKind, charge: number): void {
        this.cardTray.setCharge(kind, charge);
    }

    /** Debug: the new-card reveal for `kinds`. */
    public revealCards(kinds: CardKind[]): void {
        this.reveal.play(kinds);
    }

    /** A card's full: it pops (its unit's coming out of the cannon). */
    /** The first-card tutorial: the screen darkens round the cards, and a hand taps at `kind`'s. */
    public showCardTutorial(kind: CardKind): void {
        this.tutorialCard = kind;
        this.tutorialDim.visible = true;
        this.tutorialHint.visible = true;
        gsap.fromTo([this.tutorialDim, this.tutorialHint], { alpha: 0 }, { alpha: 1, duration: 0.3 });
        gsap.killTweensOf(this.tutorialHand.scale);
        const size = this.tutorialHand.scale.x;
        gsap.fromTo(this.tutorialHand.scale, { x: size, y: size }, { x: size * 0.85, y: size * 0.85, duration: CARD_TUTORIAL.tap, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        this.placeTutorial();
    }

    /** The tutorial's over (the card was tapped). */
    public hideCardTutorial(): void {
        if (!this.tutorialCard) return;
        this.tutorialCard = null;
        gsap.to([this.tutorialDim, this.tutorialHint], { alpha: 0, duration: 0.25, onComplete: () => { this.tutorialDim.visible = false; this.tutorialHint.visible = false; } });
    }

    /** The hand's fingertip on the tutorial's card's right edge. */
    private placeTutorial(): void {
        if (!this.tutorialCard) return;
        const at = this.cardTray.cardPoint(this.tutorialCard, CARD_TUTORIAL.at.x, CARD_TUTORIAL.at.y, this);
        if (at) this.tutorialHand.position.copyFrom(at);
    }

    public cardFired(kind: CardKind): void {
        this.cardTray.fired(kind);
    }

    /** The cannon's energy (0..1 of full), and whether it's locked recharging (ran dry). */
    public setEnergy(share: number, locked: boolean, capped = false): void {
        this.energyCapped = capped;
        this.energyShown = Math.max(0, Math.min(1, share));
        if (locked && !this.energyLocked) {
            // Run dry: a power-down, the bar jolts, EMPTY! pops over it.
            gsap.fromTo(this.energy.scale, { x: 1.35, y: 1.35 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(3)' });
            gsap.fromTo(this.energy, { rotation: 0.25 }, { rotation: 0, duration: 0.5, ease: 'elastic.out(1.2, 0.25)' });
            MobAudio.play('energyEmpty');
            this.energyWord('EMPTY!', ENERGY.locked);
        } else if (!locked && this.energyLocked) {
            // Full again: a rising zap, the bar pops, READY! over it.
            gsap.fromTo(this.energy.scale, { x: 1.3, y: 1.3 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(3)' });
            MobAudio.play('energyFull');
            this.energyWord('READY!', ENERGY.fill);
        }
        this.energyLocked = locked;
    }

    /** A word popping up over the energy bar and floating off. */
    private energyWord(text: string, colour: number): void {
        const word = label(26, colour);
        word.text = text;
        word.position.set(ENERGY.width / 2, -ENERGY.icon - 18);
        this.energy.addChild(word);
        gsap.fromTo(word.scale, { x: 0.4, y: 0.4 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(3)' });
        gsap.to(word, { y: word.y - 34, alpha: 0, delay: 0.5, duration: 0.6, ease: 'power1.in', onComplete: () => word.destroy() });
    }

    public hideEnd(): void {
        this.revealCall?.kill();
        this.revealCall = null;
        this.card.visible = false;
        this.top.visible = !this.duel;
    }
}
