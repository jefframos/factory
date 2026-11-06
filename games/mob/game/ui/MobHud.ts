// MobHud.ts
//
// The 2D layer over the battle, on the Layer Lab pack's sprites (UiParts.ts; laid out on Game.gameScreenData, in the
// stage's 720 x 1080 design units), copying the pack's own screens (library3d/2d/ResourcesData/Preview):
// - top (4_Play_UI_Action): the battle's name, then the enemy base's HP on a dark play bar (a red fill over a dark track), a skull at its start
//   and the battle's number on the gold level badge at its end; the coins top left;
// - before the first touch: the white glove sweeping left and right over "HOLD TO SHOOT", then "GO!" as the battle starts;
// - the cannon's energy: a bar across the bottom of the screen with the energy bolt at its end, draining as it fires,
//   flashing red while it's locked recharging;
// - the end card (9_Play_Result_Victory / _Defeat): the winged gold badge or the skull shield over turning rays, the
//   blue or red ribbon with VICTORY / DEFEAT, the REWARDS divider and a coin card, the cannon's three upgrades (fire
//   rate, energy, recharge) and CONTINUE / RETRY;
// - the juice: words popping up over the field ("+12" at a gate, "GIANT!"), red edges pulsing as reds near the line (a
//   red flash when they break through), the HP bar easing down with a white trail, coins flying to the counter.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import SoundToggleButton from 'core/ui/SoundToggleButton';
import { Game } from 'core/Game';
import { UPGRADES, UpgradeKind } from '../data/MobConfig';
import { COIN_BAR, GlossyButton, fillCoinBar, framePlane, glossyButton, iconSprite, label, tappable } from './UiParts';

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
/** The energy bar (across the bottom of the screen): its size, how far up from the bottom edge, its colours (full, low, locked). */
const ENERGY = { width: 420, height: 40, bottom: 30, fill: 0x45d4ff, low: 0xffc23d, locked: 0xff4f63, back: 0x1b1e3a, track: 0x0f2a3d };
/** An upgrade button on the end card. */
const UPGRADE_TILE = { width: 200, height: 132, gap: 14 };
const UPGRADE_KINDS: UpgradeKind[] = ['fire', 'capacity', 'recharge'];

/** An upgrade as the end card shows it. */
export interface UpgradeView { kind: UpgradeKind; level: number; cost: number | null }

export interface EndCard {
    won: boolean;
    reward: number;
    upgrades: UpgradeView[];
    coins: number;
}

interface UpgradeTile { button: GlossyButton; name: PIXI.Text; level: PIXI.Text; cost: PIXI.Text; enabled: boolean }

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
    private readonly coinText = label(COIN_BAR.textSize, 0xffffff);
    private readonly hint = new PIXI.Container();
    private readonly hand = iconSprite('Tutorial_Hand', 120);
    private readonly go = iconSprite('ActionText_Go', 300);
    private readonly vignette = new PIXI.Graphics();
    private readonly pops = new PIXI.Container();
    /** Giants' hit counts (a few labels reused). */
    private readonly giantLabels = new PIXI.Container();
    // The end card.
    private readonly card = new PIXI.Container();
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
    private readonly rewardText = label(30);
    private readonly upgradeInfo = label(24);
    private readonly upgrades = new PIXI.Container();
    private readonly upgradeTiles = new Map<UpgradeKind, UpgradeTile>();
    private readonly next: GlossyButton;
    // The energy bar.
    private readonly energy = new PIXI.Container();
    private readonly energyBack = framePlane('Slider_Play01_Bg', ENERGY.width, ENERGY.height, 1.4);
    private readonly energyTrack = framePlane('Slider_Play01_FillMask', ENERGY.width - 16, ENERGY.height - 16, 1.4);
    private readonly energyFill = framePlane('Slider_Play01_FillMask', ENERGY.width - 16, ENERGY.height - 16, 1.4);
    private readonly energyIcon = iconSprite('ResourceBar_Single_Icon_Energy', 64);
    private energyShown = 1;
    private energyLocked = false;
    private hpShown = 1;
    /** The bar's share as drawn (eases after hpShown), and the white trail behind it (eases slower). */
    private hpBar = 1;
    private hpTrail = 1;
    private danger = 0;
    private redFlash = 0;
    private time = 0;
    private goScale = 1;

    public constructor(onNext: () => void, onUpgrade: (kind: UpgradeKind) => void) {
        super();
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
        this.top.addChild(this.barBack, this.barTrack, this.barTrail, this.barFill, this.hpText, this.skull, this.badge, this.title);
        fillCoinBar(this.coinPill, this.coinText);
        // The energy bar: frame, dark track, the fill rising from the bottom, the bolt on top.
        this.energyBack.tint = ENERGY.back;
        this.energyTrack.tint = ENERGY.track;
        this.energyTrack.position.set(8, 8);
        this.energyFill.position.set(8, 8);
        // The bolt at its left end, like the skull on the HP bar.
        this.energyIcon.position.set(-8, ENERGY.height / 2);
        this.energy.addChild(this.energyBack, this.energyTrack, this.energyFill, this.energyIcon);
        this.energy.pivot.set(ENERGY.width / 2, ENERGY.height / 2);
        this.buildMute();
        this.addChild(this.vignette, this.giantLabels, this.pops, this.top, this.coinPill, this.energy, this.mute);

        // The hint: the glove sweeping over the words.
        const hintText = label(40);
        hintText.text = 'HOLD TO SHOOT';
        hintText.y = 90;
        this.hand.rotation = -0.3;
        this.hint.addChild(hintText, this.hand);
        this.addChild(this.hint);
        gsap.fromTo(this.hand, { x: -120 }, { x: 120, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut' });
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
        // The upgrades: a tile each (its name, level, and the next level's cost), side by side.
        this.upgradeInfo.text = 'UPGRADE YOUR CANNON';
        UPGRADE_KINDS.forEach((kind, i) => {
            const button = glossyButton(UPGRADE_TILE.width, UPGRADE_TILE.height, '', 'Button01_l_Green');
            const name = label(24);
            name.text = UPGRADES[kind].name;
            name.y = -36;
            const level = label(20, 0xfff3b0);
            level.y = -8;
            const cost = label(30);
            cost.y = 28;
            const arrow = iconSprite('Slider_Level02_Icon_Up_Green', 40);
            arrow.position.set(UPGRADE_TILE.width / 2 - 22, -UPGRADE_TILE.height / 2 + 18);
            button.addChild(name, level, cost, arrow);
            button.x = (i - 1) * (UPGRADE_TILE.width + UPGRADE_TILE.gap);
            const tile: UpgradeTile = { button, name, level, cost, enabled: false };
            tappable(button, () => { if (tile.enabled) onUpgrade(kind); }, null);
            this.upgradeTiles.set(kind, tile);
            this.upgrades.addChild(button);
        });
        this.next = glossyButton(300, 92, 'CONTINUE', 'Button01_l_Sky');
        tappable(this.next, onNext, null);
        this.card.addChild(this.dim, this.rays, this.emblem, this.ribbon, this.dividerLeft, this.dividerRight, this.rewardsTitle, this.rewardCard, this.upgradeInfo, this.upgrades, this.next);
        this.card.visible = false;
        this.addChild(this.card);
        this.layout();
    }

    public layout(): void {
        const screen = Game.gameScreenData;
        if (!screen) return;
        const { topLeft, center, width, height, bottomLeft } = screen;
        const scale = Math.min(1, (width - 60) / (BAR.width + 120));
        this.top.scale.set(scale);
        this.top.position.set(center.x - (BAR.width * scale) / 2, topLeft.y + 96);
        this.coinPill.position.set(topLeft.x + 46, topLeft.y + 44);
        // The mute button in the top right corner.
        this.mute.position.set(topLeft.x + width - MUTE.margin - MUTE.size / 2, topLeft.y + 44);
        this.hint.position.set(center.x, bottomLeft.y - Math.min(300, height * 0.24));
        this.go.position.set(center.x, center.y - 80);
        this.dim.clear().beginFill(0x0b1030, 0.72).drawRect(topLeft.x, topLeft.y, width, height).endFill();
        const cardTop = center.y - 290;
        this.rays.position.set(center.x, cardTop + 40);
        this.emblem.position.set(center.x, cardTop + 30);
        this.ribbon.position.set(center.x, cardTop + 175);
        this.rewardsTitle.position.set(center.x, cardTop + 300);
        this.dividerLeft.position.set(center.x - 100 - 170, cardTop + 300 - 15);
        this.dividerRight.position.set(center.x + 100, cardTop + 300 - 15);
        this.rewardCard.position.set(center.x, cardTop + 410);
        this.upgradeInfo.position.set(center.x, cardTop + 510);
        this.upgrades.position.set(center.x, cardTop + 600);
        // Across the bottom, centred (narrower on a narrow screen).
        this.energy.scale.set(Math.min(1, (width - 90) / (ENERGY.width + 40)));
        this.energy.position.set(center.x + 8, bottomLeft.y - ENERGY.bottom - ENERGY.height / 2);
        this.next.position.set(center.x, cardTop + 750);
        this.drawVignette();
        this.drawBar();
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

    /** Whether a screen point (CSS px) is on a HUD button the field shouldn't also take (the mute button). */
    public onButton(screenX: number, screenY: number): boolean {
        return this.mute.visible && this.mute.getBounds().contains(screenX, screenY);
    }

    /** Where the top block (HP bar, badge, level name) ends, in screen pixels (layout() first). */
    public topBottom(): number {
        return this.top.getBounds().bottom;
    }

    /** The energy fill: its width the share left, from the left; cyan, amber when low, flashing red while locked. */
    private drawEnergy(): void {
        const inner = ENERGY.width - 16;
        const width = Math.max(26, inner * this.energyShown);
        this.energyFill.width = width / this.energyFill.scale.x;
        this.energyFill.visible = this.energyShown > 0.01;
        const pulse = 0.5 + 0.5 * Math.sin(this.time * 14);
        this.energyFill.tint = this.energyLocked ? ENERGY.locked : this.energyShown < 0.25 ? ENERGY.low : ENERGY.fill;
        this.energyFill.alpha = this.energyLocked ? 0.55 + 0.45 * pulse : 1;
        this.energyIcon.tint = this.energyLocked ? 0xff9aa5 : 0xffffff;
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
        this.redFlash = Math.max(0, this.redFlash - dt * 1.5);
        const before = this.hpBar + this.hpTrail;
        this.hpBar += (this.hpShown - this.hpBar) * Math.min(1, dt * 12);
        this.hpTrail += (this.hpBar - this.hpTrail) * Math.min(1, dt * 2.5);
        if (this.hpTrail < this.hpBar) this.hpTrail = this.hpBar;
        if (Math.abs(this.hpBar + this.hpTrail - before) > 0.0001) this.drawBar();
        this.drawVignette();
        if (this.card.visible) this.rays.rotation += dt * RAYS_SPEED;
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
        const start = this.rewardCard.position;
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
        this.rewardText.text = card.won ? `${card.reward}` : '0';
        this.rewardCard.alpha = card.won ? 1 : 0.55;
        this.next.words.text = card.won ? 'CONTINUE' : 'RETRY';
        this.refreshUpgrade(card);
        this.card.visible = true;
        this.card.alpha = 0;
        gsap.to(this.card, { alpha: 1, duration: 0.3 });
        gsap.fromTo(this.emblem.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.55, ease: 'back.out(2.2)' });
        gsap.fromTo(this.ribbon.scale, { x: 0.2, y: 1 }, { x: 1, y: 1, duration: 0.45, delay: 0.15, ease: 'back.out(2)' });
        gsap.fromTo(this.rewardCard.scale, { x: 0, y: 0 }, { x: 1, y: 1, duration: 0.4, delay: 0.3, ease: 'back.out(3)' });
    }

    public refreshUpgrade(card: Pick<EndCard, 'upgrades' | 'coins'>): void {
        for (const view of card.upgrades) {
            const tile = this.upgradeTiles.get(view.kind);
            if (!tile) continue;
            const max = view.cost === null;
            tile.enabled = !max && card.coins >= (view.cost ?? Infinity);
            tile.level.text = `LV ${view.level}/${UPGRADES[view.kind].max}`;
            tile.cost.text = max ? 'MAX' : `${view.cost}`;
            tile.button.setFrame(tile.enabled ? 'Button01_l_Green' : 'Button01_l_Gray');
            tile.button.cursor = tile.enabled ? 'pointer' : 'default';
        }
    }

    /** The cannon's energy (0..1 of full), and whether it's locked recharging (ran dry). */
    public setEnergy(share: number, locked: boolean): void {
        this.energyShown = Math.max(0, Math.min(1, share));
        if (locked && !this.energyLocked) gsap.fromTo(this.energy.scale, { x: 1.18, y: 1.18 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(3)' });
        this.energyLocked = locked;
    }

    public hideEnd(): void {
        this.card.visible = false;
    }
}
