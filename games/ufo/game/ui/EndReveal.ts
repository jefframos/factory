// EndReveal.ts
//
// The end of a level, told in order: the world dims; rays open up behind an emblem that pops in (a trophy, a medal, or a
// skull); a ribbon stamps on saying how it went; then the players come in one by one, from last place up to first, their
// sizes counting up, your own row with a bump; or alone, how much of the town you got. Confetti if you won.
// The button comes last, so there's time to take it in. Lost, alone: the pack's Defeat, a big emblem standing on a wide ribbon.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UfoAudio } from '../audio/UfoAudio';
import { AreaBar, AreaView } from './AreaBar';
import { COIN_BAR, PlayerLook, PlayerRow, ROW, buttonParts, fillCoinBar, fitSprite, framePlane, iconSprite, label, tappable } from './UiParts';

export interface EndResult extends PlayerLook {
    size: number;
    you: boolean;
}

export interface EndOptions {
    /** On the ribbon. */
    title: string;
    /** Under the ribbon, if anything. */
    detail?: string;
    /** 'win': gold, and confetti; 'place': a medal; 'lose': a skull. */
    outcome: 'win' | 'place' | 'lose';
    /** The emblem, if not the outcome's. */
    emblem?: string;
    /** Best first. */
    results?: readonly EndResult[];
    /** What the button says. */
    button: string;
    /** Coins won: the emblem's a pile of them, counting up, the title big over it; then they fly up to the coin bar. */
    coins?: number;
    /** All the player's coins, those won included: the bar counts up to this. */
    coinsTotal?: number;
    /** Stars earned for the ranking, shown under the results. */
    starsWon?: number;
    /** A versus match: the trophies won (or lost) and the coins, on a line under them. */
    trophies?: number;
    coinsWon?: number;
    /** A story level: how far through its area (complete: this win finished it), over the button. */
    area?: { view: AreaView; complete: boolean };
}

const LOOK = {
    win: { emblem: 'ItemIcon_Trophy_Gold', ribbon: 'Title_Ribbon01_Blue', rays: 0xffe07a },
    place: { emblem: 'ItemIcon_Medal_Silver_1', ribbon: 'Title_Ribbon01_Blue', rays: 0x8fd8ff },
    lose: { emblem: 'Image_Badge_Skull', ribbon: 'Title_Ribbon01_Red', rays: 0xff8a7a },
};
const LAYOUT = { emblemY: -170, ribbonY: -82, detailY: -30, rowsY: -8, rowStep: 44, emblem: 170, rays: 480, ribbon: 380, buttonGap: 58 };
/** With coins: the title over a pile, its amount under. */
const COIN_LAYOUT = { titleSize: 76, titleY: -250, pileY: -80, pile: 230, amountY: 60, amountSize: 58, buttonY: 210 };
/** Lost, with no results to show: from the top, emblem on ribbon, the level, then the buttons. */
const LOSE_LAYOUT = { emblemY: -140, emblem: 360, rays: 620, ribbonY: -14, ribbonWidth: 460, ribbonHeight: 86, ribbonScale: 0.6, titleSize: 42, titleY: -5, detailY: 62, buttonY: 142, homeY: 228, button: 290, home: 220, homeHeight: 68, homeIcon: 52, homeIconX: -62, homeWordsX: 22 };
/** The coins flying up to the bar: how many, how far apart they set off, how long each takes, and their size. */
const COIN_FLIGHT = { count: 12, gap: 0.07, seconds: 0.55, size: 44, spread: 90 };
/** Stars for the ranking, under the results. */
const STARS_WON = { y: 44, size: 58, gap: 66 };
/** A match's trophies and coins, a line under that: its height, the icons' size, the gap between the two. */
const REWARD_LINE = { y: 46, icon: 50, text: 40, gap: 46 };
/** The area bar: its scale (it's wider than the rest), how far under what's over it, and the room it adds. */
const AREA = { scale: 0.68, y: 66, room: 130 };
const ROWS_SHOWN = 5;
const ROW_WIDTH = ROW.width + 90;
/** The whole thing's height and width: scaled down to fit a small screen. */
const FIT = { height: 620, width: 430 };
const CONFETTI = [0xff5a6e, 0xffd23f, 0x4fc3ff, 0x9cff6a, 0xc36bff, 0xffffff];

export class EndReveal extends PIXI.Container {
    private readonly dim = new PIXI.Sprite(PIXI.Texture.WHITE);
    private readonly content = new PIXI.Container();
    private readonly confetti = new PIXI.Container();
    private readonly coinBar = new PIXI.Container();
    private readonly coinBarAmount = label(COIN_BAR.textSize);
    private readonly flyingCoins = new PIXI.Container();
    private areaBar: AreaBar | null = null;
    private emblemY = 0;
    /** Its height, for fitting it to the screen (more with the area bar). */
    private fitHeight = FIT.height;
    private readonly timeline = gsap.timeline();
    private readonly spin: gsap.core.Tween;

    /** `onHome`: with it, a button to go home too. */
    public constructor(private readonly options: EndOptions, onNext: () => void, onHome?: () => void) {
        super();
        const look = LOOK[options.outcome];
        this.dim.tint = 0x0a0a28;
        this.dim.anchor.set(0.5);
        this.dim.eventMode = 'static';
        this.dim.alpha = 0;
        const rays = iconSprite('Image_Effect_Rotate', LAYOUT.rays);
        rays.tint = look.rays;
        rays.blendMode = PIXI.BLEND_MODES.ADD;
        rays.y = LAYOUT.emblemY;
        const glow = iconSprite('Glow_Circle01', LAYOUT.rays * 0.8);
        glow.tint = look.rays;
        glow.blendMode = PIXI.BLEND_MODES.ADD;
        glow.y = LAYOUT.emblemY;
        const emblem = iconSprite(options.emblem ?? look.emblem, LAYOUT.emblem);
        emblem.y = LAYOUT.emblemY;
        const ribbon = new PIXI.Container();
        ribbon.y = LAYOUT.ribbonY;
        const lost = options.outcome === 'lose' && !options.results?.length;
        const ribbonBack = lost ? framePlane('Title_Ribbon04_Red', LOSE_LAYOUT.ribbonWidth, LOSE_LAYOUT.ribbonHeight, LOSE_LAYOUT.ribbonScale) : iconSprite(look.ribbon, LAYOUT.ribbon);
        const hasCoins = options.coins !== undefined;
        const title = label(hasCoins ? COIN_LAYOUT.titleSize : lost ? LOSE_LAYOUT.titleSize : 40, hasCoins ? 0xffd23f : 0xffffff);
        title.text = options.title;
        title.y = -8;
        title.scale.set(Math.min(1, (hasCoins ? FIT.width - 20 : LAYOUT.ribbon * 0.72) / Math.max(title.width, 1)));
        ribbon.addChild(ribbonBack, title);
        let emblemSize: number = LAYOUT.emblem;
        if (lost) {
            ribbonBack.position.set(-LOSE_LAYOUT.ribbonWidth / 2, -LOSE_LAYOUT.ribbonHeight / 2);
            title.y = LOSE_LAYOUT.titleY;
            ribbon.y = LOSE_LAYOUT.ribbonY;
            emblem.y = rays.y = glow.y = LOSE_LAYOUT.emblemY;
            emblemSize = LOSE_LAYOUT.emblem;
            fitSprite(rays, LOSE_LAYOUT.rays);
            fitSprite(glow, LOSE_LAYOUT.rays * 0.8);
        }
        if (hasCoins) {
            ribbonBack.visible = false;
            ribbon.y = COIN_LAYOUT.titleY;
            emblem.y = rays.y = glow.y = COIN_LAYOUT.pileY;
            emblem.texture = PIXI.Texture.from('ItemIcon_Coins_l');
            emblemSize = COIN_LAYOUT.pile;
        }
        this.content.addChild(glow, rays, emblem, ribbon);
        this.addChild(this.dim, this.content, this.confetti);
        this.emblemY = emblem.y;
        if (hasCoins) {
            fillCoinBar(this.coinBar, this.coinBarAmount);
            this.coinBarAmount.text = String((options.coinsTotal ?? 0) - (options.coins ?? 0));
            this.coinBar.alpha = 0;
            this.addChild(this.coinBar, this.flyingCoins);
        }

        const tl = this.timeline;
        for (const part of [rays, glow]) part.alpha = 0;
        emblem.scale.set(0);
        const emblemScale = emblemSize / Math.max(emblem.texture.width, emblem.texture.height, 1);
        ribbon.alpha = 0;
        ribbon.scale.set(2.2);
        this.spin = gsap.to(rays, { rotation: Math.PI * 2, duration: 16, ease: 'none', repeat: -1 });
        // With coins, the words come first, to applause, and the pile after them.
        const titleAt = hasCoins ? 0.2 : 0.75;
        const emblemAt = hasCoins ? 0.85 : 0.3;
        tl.to(this.dim, { alpha: 0.78, duration: 0.45 });
        if (hasCoins) tl.to(this.coinBar, { alpha: 1, duration: 0.3 }, 0.1);
        tl.to([rays, glow], { alpha: 0.75, duration: 0.5 }, emblemAt - 0.05);
        tl.to(emblem.scale, { x: emblemScale, y: emblemScale, duration: 0.6, ease: 'back.out(2.4)' }, emblemAt);
        tl.call(() => (options.outcome === 'lose' ? UfoAudio.bump() : UfoAudio.win()), undefined, 0.35);
        if (options.outcome === 'win') tl.call(() => UfoAudio.applause(), undefined, titleAt);
        tl.to(ribbon, { alpha: 1, duration: 0.12 }, titleAt);
        tl.to(ribbon.scale, { x: 1, y: 1, duration: 0.3, ease: 'back.out(1.6)' }, titleAt);

        let at = hasCoins ? 1.45 : 1.15;
        let bottom = LAYOUT.ribbonY + 40;
        if (options.coins !== undefined) {
            const amount = label(COIN_LAYOUT.amountSize);
            amount.y = COIN_LAYOUT.amountY;
            amount.text = '0';
            amount.alpha = 0;
            this.content.addChild(amount);
            const count = { value: 0 };
            tl.to(amount, { alpha: 1, duration: 0.15 }, at);
            tl.to(count, { value: options.coins, duration: 0.7, ease: 'power2.out', onUpdate: () => { amount.text = String(Math.round(count.value)); } }, at);
            tl.call(() => UfoAudio.milestone(), undefined, at + 0.65);
            at += 0.8;
            tl.call(() => this.flyCoins(options.coins ?? 0, options.coinsTotal ?? 0), undefined, at);
            at += COIN_FLIGHT.count * COIN_FLIGHT.gap + COIN_FLIGHT.seconds;
            bottom = COIN_LAYOUT.buttonY - LAYOUT.buttonGap;
        }
        if (options.detail) {
            const detail = label(26);
            detail.text = options.detail;
            detail.y = lost ? LOSE_LAYOUT.detailY : LAYOUT.detailY;
            detail.alpha = 0;
            this.content.addChild(detail);
            tl.to(detail, { alpha: 1, duration: 0.25 }, at);
            at += 0.2;
            bottom = LAYOUT.detailY + 20;
        }
        if (options.results?.length) bottom = this.addResults(options.results, at);
        if (options.starsWon) {
            at = Math.max(at, tl.duration());
            const y = bottom + STARS_WON.y;
            for (let i = 0; i < options.starsWon; i++) {
                const star = iconSprite('Icon_Star_On', STARS_WON.size);
                const scale = star.scale.x;
                star.position.set((i - (options.starsWon - 1) / 2) * STARS_WON.gap, y);
                star.scale.set(0);
                this.content.addChild(star);
                tl.to(star.scale, { x: scale, y: scale, duration: 0.35, ease: 'back.out(3)' }, at);
                tl.call(() => UfoAudio.eat(0.2 + i * 0.1), undefined, at);
                at += 0.2;
            }
            bottom = y + STARS_WON.size / 2 - 10;
        }
        if (options.trophies !== undefined || options.coinsWon) {
            at = Math.max(at, tl.duration());
            const line = new PIXI.Container();
            line.y = bottom + REWARD_LINE.y;
            const parts: PIXI.Container[] = [];
            if (options.trophies !== undefined) {
                const cup = iconSprite('ItemIcon_Trophy_Gold', REWARD_LINE.icon);
                const amount = label(REWARD_LINE.text, options.trophies >= 0 ? 0x6dff5a : 0xff6b6b);
                amount.anchor.set(0, 0.5);
                amount.text = options.trophies >= 0 ? `+${options.trophies}` : `${options.trophies}`;
                parts.push(this.pair(cup, amount));
            }
            if (options.coinsWon) {
                const coin = iconSprite('Icon_Coin', REWARD_LINE.icon * 0.85);
                const amount = label(REWARD_LINE.text, 0xffe066);
                amount.anchor.set(0, 0.5);
                amount.text = `+${options.coinsWon}`;
                parts.push(this.pair(coin, amount));
            }
            const width = parts.reduce((sum, part) => sum + part.width, 0) + REWARD_LINE.gap * (parts.length - 1);
            let x = -width / 2;
            for (const part of parts) {
                part.x = x;
                x += part.width + REWARD_LINE.gap;
                line.addChild(part);
            }
            line.scale.set(0);
            this.content.addChild(line);
            tl.to(line.scale, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2.6)' }, at);
            tl.call(() => UfoAudio.milestone(), undefined, at);
            at += 0.35;
            bottom = line.y + REWARD_LINE.icon / 2 - 10;
        }
        at = Math.max(at, tl.duration());
        // A story level's area: how far through it, over the button (complete: the next one's lock pops off).
        let areaShift = 0;
        if (options.area) {
            const bar = new AreaBar();
            bar.set(options.area.view, options.area.complete);
            bar.scale.set(AREA.scale);
            bar.alpha = 0;
            this.areaBar = bar;
            this.content.addChild(bar);
            areaShift = AREA.room;
            this.fitHeight = FIT.height + AREA.room;
            const barAt = at;
            tl.to(bar, { alpha: 1, duration: 0.3 }, barAt);
            tl.call(() => bar.play(0.1), undefined, barAt);
            at += 0.3;
        }

        const button = new PIXI.Container();
        button.addChild(...buttonParts(lost ? LOSE_LAYOUT.button : 270, 78, options.button, lost ? 'Button01_l_Sky' : 'Button01_l_Green'));
        tappable(button, onNext);
        button.y = (lost ? LOSE_LAYOUT.buttonY : bottom + LAYOUT.buttonGap) + areaShift;
        // (Between what's over it and the button.)
        if (this.areaBar) this.areaBar.y = button.y - areaShift - LAYOUT.buttonGap + AREA.y;
        button.scale.set(0);
        button.eventMode = 'none';
        this.content.addChild(button);
        tl.call(() => {
            if (options.outcome === 'win') this.throwConfetti();
        }, undefined, at);
        tl.to(button.scale, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2.4)' }, at + 0.15);
        tl.call(() => {
            button.eventMode = 'static';
        }, undefined, at + 0.2);
        if (onHome) {
            const home = new PIXI.Container();
            const [plane, words] = buttonParts(LOSE_LAYOUT.home, LOSE_LAYOUT.homeHeight, 'HOME', 'Button01_l_Gray');
            words.x = LOSE_LAYOUT.homeWordsX;
            const castle = iconSprite('Icon_MapPoint', LOSE_LAYOUT.homeIcon);
            castle.x = LOSE_LAYOUT.homeIconX;
            home.addChild(plane, words, castle);
            tappable(home, onHome);
            home.y = lost ? LOSE_LAYOUT.homeY + areaShift : button.y + LAYOUT.buttonGap + 30;
            home.scale.set(0);
            home.eventMode = 'none';
            this.content.addChild(home);
            tl.to(home.scale, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2.4)' }, at + 0.25);
            tl.call(() => {
                home.eventMode = 'static';
            }, undefined, at + 0.3);
        }
    }

    /** An icon and its words beside it, as one, left-aligned at 0. */
    private pair(icon: PIXI.Sprite, words: PIXI.Text): PIXI.Container {
        const holder = new PIXI.Container();
        icon.x = icon.width / 2;
        words.x = icon.width + 6;
        holder.addChild(icon, words);
        return holder;
    }

    /** The area bar's pulse. */
    public update(dt: number): void {
        this.areaBar?.update(dt);
    }

    /** The rows, from last place up to first; returns how far down they reach. */
    private addResults(results: readonly EndResult[], start: number): number {
        const shown = results.slice(0, ROWS_SHOWN);
        const youAt = results.findIndex((result) => result.you);
        const list = youAt >= ROWS_SHOWN ? [...shown.slice(0, ROWS_SHOWN - 1), results[youAt]] : shown;
        let at = start;
        for (let i = list.length - 1; i >= 0; i--) {
            const result = list[i];
            const place = results.indexOf(result) + 1;
            const row = new PlayerRow(ROW_WIDTH);
            row.set(place, result, 0, result.you);
            // First place's bigger row keeps its gap to the next.
            const y = LAYOUT.rowsY + 22 + i * LAYOUT.rowStep - (place === 1 ? 4 : 0);
            row.position.set(420, y);
            row.alpha = 0;
            this.content.addChild(row);
            const count = { size: 0 };
            const stagger = result.you ? 0.42 : 0.24;
            this.timeline.to(row, { x: 0, alpha: 1, duration: 0.3, ease: 'power3.out' }, at);
            this.timeline.to(count, { size: result.size, duration: 0.35, ease: 'power2.out', onUpdate: () => row.setSize(count.size) }, at);
            this.timeline.call(() => UfoAudio.eat(result.you ? 0.1 : 0.5), undefined, at + 0.05);
            if (result.you) {
                const base = row.baseScale;
                this.timeline.fromTo(row.scale, { x: base, y: base }, { x: base * 1.1, y: base * 1.1, duration: 0.14, yoyo: true, repeat: 1, ease: 'sine.inOut' }, at + 0.28);
            }
            at += stagger;
        }
        return LAYOUT.rowsY + list.length * LAYOUT.rowStep;
    }

    /** Coins off the pile and up to the bar, which counts up as each lands. */
    private flyCoins(won: number, total: number): void {
        const fromX = this.content.x;
        const fromY = this.content.y + this.emblemY * this.content.scale.y;
        const to = this.coinBar.position;
        const start = total - won;
        for (let i = 0; i < COIN_FLIGHT.count; i++) {
            const coin = iconSprite('Icon_Coin', COIN_FLIGHT.size);
            coin.position.set(fromX + (Math.random() - 0.5) * COIN_FLIGHT.spread, fromY + (Math.random() - 0.5) * COIN_FLIGHT.spread);
            this.flyingCoins.addChild(coin);
            const delay = i * COIN_FLIGHT.gap;
            gsap.to(coin, { x: to.x, duration: COIN_FLIGHT.seconds, delay, ease: 'power1.in' });
            gsap.to(coin, {
                y: to.y, duration: COIN_FLIGHT.seconds, delay, ease: 'power2.in',
                onComplete: () => {
                    coin.visible = false;
                    this.coinBarAmount.text = String(start + Math.round((won * (i + 1)) / COIN_FLIGHT.count));
                    UfoAudio.eat(0.05);
                    gsap.fromTo(this.coinBar.scale, { x: 1.14, y: 1.14 }, { x: 1, y: 1, duration: 0.18, ease: 'power2.out' });
                },
            });
        }
    }

    /** Paper falling from the top of the screen. */
    private throwConfetti(): void {
        const { width, height } = this.dim;
        for (let i = 0; i < 90; i++) {
            const piece = new PIXI.Sprite(PIXI.Texture.WHITE);
            piece.anchor.set(0.5);
            piece.width = 6 + Math.random() * 8;
            piece.height = 4 + Math.random() * 6;
            piece.tint = CONFETTI[i % CONFETTI.length];
            piece.position.set(this.dim.x + (Math.random() - 0.5) * width, this.dim.y - height / 2 - 20 - Math.random() * height * 0.4);
            piece.rotation = Math.random() * Math.PI;
            this.confetti.addChild(piece);
            gsap.to(piece, {
                y: this.dim.y + height / 2 + 30, x: piece.x + (Math.random() - 0.5) * 140, rotation: piece.rotation + 4 + Math.random() * 8,
                duration: 1.8 + Math.random() * 1.6, ease: 'power1.in', delay: Math.random() * 0.5,
            });
        }
    }

    /** `centre`, and how big the screen is. */
    public place(x: number, y: number, width: number, height: number): void {
        this.dim.position.set(x, y);
        this.dim.width = width + 4;
        this.dim.height = height + 4;
        this.coinBar.position.set(x - width / 2 + COIN_BAR.left + COIN_BAR.icon / 2, y - height / 2 + COIN_BAR.top);
        const scale = Math.min(1, height / this.fitHeight, (width - 16) / FIT.width);
        // (The area bar under it all: the rest moves up to make room.)
        this.content.position.set(x, y + (40 - (this.fitHeight - FIT.height) / 2) * scale);
        this.content.scale.set(scale);
    }

    public override destroy(): void {
        this.timeline.kill();
        this.spin.kill();
        this.confetti.children.forEach((piece) => gsap.killTweensOf(piece));
        this.flyingCoins.children.forEach((coin) => gsap.killTweensOf(coin));
        gsap.killTweensOf(this.coinBar.scale);
        super.destroy({ children: true });
    }
}
