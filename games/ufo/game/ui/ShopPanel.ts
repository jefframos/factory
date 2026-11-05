// ShopPanel.ts
//
// A shop filling the screen above the bottom tabs: the title, the Classics and Specials tabs (how many of each you have over
// them), and cards in rows under them. Blue: yours. Green: wearing it. Dark: not yet. Classics come from the gold button
// floating over the cards (a video, then a random locked one); specials each have a price in coins, tap to buy. Drag to scroll.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { LOOKS } from '../data/UfoConfig';
import { ShopKind, ShopSection, UfoProgress } from '../data/UfoProgress';
import { UfoAudio } from '../audio/UfoAudio';
import { Snapshots } from './Snapshots';
import { buttonParts, fitSprite, framePlane, iconSprite, label, plainLabel, tappable } from './UiParts';

const BACK = 0x12305e;
const HEADER = { strip: 96, stripColor: 0x3f6bf5, title: 34, titleY: 48 };
/** The section tabs: a dark track, the chosen one a raised sky button on it, how many you have in a badge over each. */
const SECTIONS = {
    zone: 112, zoneColor: 0x34365a, zoneScale: 0.7, width: 580, height: 62, trackColor: 0x1c1d33, trackY: 66, button: 72, words: 30,
    badge: { width: 84, height: 34, scale: 0.6, y: -34, words: 20 }, slide: 0.18,
};
const GRID = { cols: 3, cellWidth: 226, cellHeight: 286, gap: 12, inset: 12, strip: 56, picture: 158, pictureY: -16, nameSize: 19, top: 12 };
/** The card, and the lighter panel in it, by state. */
const CARD = {
    worn: { outer: 0x25c465, inner: 0x7ff0a8 },
    owned: { outer: 0x3f8cff, inner: 0x93c2ff },
    locked: { outer: 0x1c2c5c, inner: 0x2c4380 },
};
const LOCKED_PICTURE = 0xaab0c8;
const NAME_COLOR = { mine: 0x10123a, locked: 0xc3cdea };
const PRICE = { coin: 34, coinX: -36, textX: -12, size: 26 };
/** The gold button: cream round a yellow one, a video icon beside two lines of words, floating over the cards. */
const UNLOCK = {
    width: 470, height: 134, inner: 94, frame: 0xfff1dc, above: 18, video: 92, videoX: -145, wordsX: 42, topY: -18, bottomY: 24, top: 44, bottom: 28,
    stroke: 0xa84a00, under: 0xb3560a, pulse: 1.03,
};
/** Clear below the last row, for the floating button. */
const ROOM_FOR_UNLOCK = 170;
const ROOM_BELOW = 20;
const TABS_HEIGHT = 118;
/** Under this much of a drag, a tap's a tap. */
const TAP_MOVE = 12;

const nameOf = (kind: ShopKind) => (kind === 'ufo' ? 'SPACESHIPS' : 'ALIENS');
const SECTION_ORDER: ShopSection[] = ['classics', 'specials'];

interface Cell {
    id: string;
    section: ShopSection;
    holder: PIXI.Container;
    outer: PIXI.NineSlicePlane;
    inner: PIXI.NineSlicePlane;
    picture: PIXI.Sprite;
    name: PIXI.Text;
    lock: PIXI.Sprite;
    check: PIXI.Sprite;
    wear: PIXI.Text;
    price: PIXI.Container;
    drawn: boolean;
}

export class ShopPanel extends PIXI.Container {
    private readonly back = new PIXI.Sprite(PIXI.Texture.WHITE);
    private readonly strip = new PIXI.Sprite(PIXI.Texture.WHITE);
    private readonly title = label(HEADER.title);
    private readonly zone = framePlane('PanelFrame03_Bg', 720, SECTIONS.zone, SECTIONS.zoneScale);
    private readonly tabs = new PIXI.Container();
    private readonly chosen = new PIXI.Container();
    private readonly sectionCounts = new Map<ShopSection, PIXI.Text>();
    private readonly grid = new PIXI.Container();
    private readonly gridMask = new PIXI.Graphics();
    private readonly cells: Cell[] = [];
    private readonly unlock = new PIXI.Container();
    private section: ShopSection = 'classics';
    private watching = false;
    private scroll = 0;
    private dragFrom: number | null = null;
    private dragScroll = 0;
    private dragged = 0;
    private viewHeight = 0;

    /** `onChange`: what's worn, or the coins, changed. */
    public constructor(private readonly kind: ShopKind, private readonly onChange: () => void) {
        super();
        this.back.tint = BACK;
        this.back.anchor.set(0.5);
        this.back.eventMode = 'static';
        this.strip.tint = HEADER.stripColor;
        this.zone.tint = SECTIONS.zoneColor;
        this.title.text = nameOf(kind);
        this.grid.mask = this.gridMask;
        this.buildTabs();
        this.buildUnlock();
        this.addChild(this.back, this.gridMask, this.grid, this.strip, this.title, this.zone, this.tabs, this.unlock);
        for (const section of SECTION_ORDER) {
            UfoProgress.inSection(kind, section).forEach((style) => this.addCell(style.id, style.name, section));
        }
        this.back.on('pointerdown', (event: PIXI.FederatedPointerEvent) => this.startDrag(event));
        this.back.on('globalpointermove', (event: PIXI.FederatedPointerEvent) => this.moveDrag(event));
        this.back.on('pointerup', () => this.endDrag());
        this.back.on('pointerupoutside', () => this.endDrag());
        this.showSection('classics');
    }

    private buildTabs(): void {
        const half = SECTIONS.width / 2;
        const track = framePlane('BasicFrame_Round20', SECTIONS.width, SECTIONS.height);
        track.tint = SECTIONS.trackColor;
        track.position.set(-half, -SECTIONS.height / 2);
        this.chosen.addChild(...buttonParts(half + 10, SECTIONS.button, '', 'Button01_l_Sky'));
        this.tabs.addChild(track, this.chosen);
        SECTION_ORDER.forEach((section, i) => {
            const x = (i - 0.5) * half;
            const holder = new PIXI.Container();
            holder.x = x;
            const hit = new PIXI.Sprite(PIXI.Texture.WHITE);
            hit.anchor.set(0.5);
            hit.width = half;
            hit.height = SECTIONS.button;
            hit.alpha = 0;
            const words = label(SECTIONS.words);
            words.text = section === 'classics' ? 'CLASSICS' : 'SPECIALS';
            words.y = -2;
            holder.addChild(hit, words);
            tappable(holder, () => this.showSection(section));
            const badge = new PIXI.Container();
            const { width, height, scale, y } = SECTIONS.badge;
            const badgeBack = framePlane('Button_Round02_Blue', width, height, scale);
            badgeBack.position.set(-width / 2, -height / 2);
            const count = label(SECTIONS.badge.words);
            count.y = -1;
            badge.addChild(badgeBack, count);
            badge.position.set(x, y);
            this.tabs.addChild(holder, badge);
            this.sectionCounts.set(section, count);
        });
    }

    private buildUnlock(): void {
        const frame = framePlane('BorderFrame_Round24', UNLOCK.width, UNLOCK.height);
        frame.tint = UNLOCK.frame;
        frame.position.set(-UNLOCK.width / 2, -UNLOCK.height / 2);
        const [gold] = buttonParts(UNLOCK.width - 36, UNLOCK.inner, '', 'Button01_l_Yellow');
        const video = iconSprite('ItemIcon_Video', UNLOCK.video);
        video.x = UNLOCK.videoX;
        const top = label(UNLOCK.top);
        top.text = 'UNLOCK';
        top.style.stroke = UNLOCK.stroke;
        top.position.set(UNLOCK.wordsX, UNLOCK.topY);
        const bottom = plainLabel(UNLOCK.bottom, UNLOCK.under);
        bottom.text = 'RANDOM';
        bottom.position.set(UNLOCK.wordsX, UNLOCK.bottomY);
        this.unlock.addChild(frame, gold, video, top, bottom);
        tappable(this.unlock, () => void this.tryUnlock());
        gsap.to(this.unlock.scale, { x: UNLOCK.pulse, y: UNLOCK.pulse, duration: 0.7, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }

    private addCell(id: string, name: string, section: ShopSection): void {
        const holder = new PIXI.Container();
        const width = GRID.cellWidth - GRID.gap;
        const height = GRID.cellHeight - GRID.gap;
        const outer = framePlane('CardFrame03_n_Bg', width, height);
        outer.position.set(-width / 2, -height / 2);
        const innerWidth = width - GRID.inset * 2;
        const innerHeight = height - GRID.inset - GRID.strip;
        const inner = framePlane('CardFrame03_n_InnerBg', innerWidth, innerHeight);
        inner.position.set(-innerWidth / 2, -height / 2 + GRID.inset);
        const picture = new PIXI.Sprite(PIXI.Texture.EMPTY);
        picture.anchor.set(0.5);
        picture.y = GRID.pictureY;
        const words = plainLabel(GRID.nameSize, NAME_COLOR.mine);
        words.text = name;
        words.scale.set(Math.min(1, (innerWidth - 12) / Math.max(words.width, 1)));
        words.y = -height / 2 + GRID.inset + innerHeight - 20;
        const statusY = height / 2 - GRID.strip / 2 - 2;
        const lock = iconSprite('Icon_Lock01_l', 42);
        const check = iconSprite('Icon_Check03_l', 44);
        const wear = label(22);
        wear.text = 'WEAR';
        const price = new PIXI.Container();
        const coin = iconSprite('Icon_Coin', PRICE.coin);
        coin.x = PRICE.coinX;
        const amount = label(PRICE.size);
        amount.anchor.set(0, 0.5);
        amount.position.set(PRICE.textX, -1);
        amount.text = String(UfoProgress.priceOf(this.kind, id));
        price.addChild(coin, amount);
        for (const mark of [lock, check, wear, price]) mark.y = statusY;
        holder.addChild(outer, inner, picture, words, lock, check, wear, price);
        holder.eventMode = 'static';
        holder.cursor = 'pointer';
        holder.on('pointerdown', (event: PIXI.FederatedPointerEvent) => this.startDrag(event));
        holder.on('pointerup', () => this.endDrag());
        holder.on('pointerupoutside', () => this.endDrag());
        holder.on('pointertap', () => this.tapCell(id));
        this.grid.addChild(holder);
        this.cells.push({ id, section, holder, outer, inner, picture, name: words, lock, check, wear, price, drawn: false });
    }

    /** Only the section's cards are placed, and only they get their pictures drawn. */
    private showSection(section: ShopSection): void {
        this.section = section;
        this.scroll = 0;
        let index = 0;
        for (const cell of this.cells) {
            cell.holder.visible = cell.section === section;
            if (!cell.holder.visible) continue;
            cell.holder.position.set(((index % GRID.cols) - (GRID.cols - 1) / 2) * GRID.cellWidth, (Math.floor(index / GRID.cols) + 0.5) * GRID.cellHeight);
            index++;
            this.drawPicture(cell);
        }
        gsap.to(this.chosen, { x: (SECTION_ORDER.indexOf(section) - 0.5) * (SECTIONS.width / 2), duration: SECTIONS.slide, ease: 'power2.out' });
        this.refresh();
        this.reposition();
    }

    private drawPicture(cell: Cell): void {
        if (cell.drawn) return;
        cell.drawn = true;
        const ufo = LOOKS.ufos.find((style) => style.id === cell.id);
        const alien = LOOKS.aliens.find((style) => style.id === cell.id);
        const render = this.kind === 'ufo' && ufo ? Snapshots.ufo(ufo) : alien ? Snapshots.alien(alien) : null;
        void render?.then((texture) => {
            if (!texture || cell.picture.destroyed) return;
            cell.picture.texture = texture;
            fitSprite(cell.picture, GRID.picture);
        });
    }

    private tapCell(id: string): void {
        if (this.dragged > TAP_MOVE) return;
        if (UfoProgress.isOwned(this.kind, id)) {
            UfoProgress.wear(this.kind, id);
            UfoAudio.eat(0.2);
        } else if (UfoProgress.priceOf(this.kind, id) > 0) {
            if (UfoProgress.buy(this.kind, id)) {
                UfoAudio.win();
                this.pop(id);
            } else {
                const cell = this.cells.find((candidate) => candidate.id === id);
                if (cell) gsap.fromTo(cell.holder, { rotation: -0.05 }, { rotation: 0, duration: 0.3, ease: 'elastic.out(1.2, 0.3)' });
                UfoAudio.bump();
                return;
            }
        } else {
            return;
        }
        this.refresh();
        this.onChange();
    }

    /** Watches a video, then unlocks a random classic. */
    private async tryUnlock(): Promise<void> {
        if (this.watching || !UfoProgress.anyClassicLocked(this.kind)) return;
        this.watching = true;
        const rewarded = await PlatformHandler.instance.platform.showRewardedVideo('ufo-unlock-random').catch(() => false);
        this.watching = false;
        if (this.destroyed || !rewarded) return;
        const id = UfoProgress.unlockRandom(this.kind);
        if (!id) return;
        UfoAudio.win();
        this.refresh();
        this.onChange();
        this.pop(id);
    }

    /** Brought into view, and popped. */
    private pop(id: string): void {
        const cell = this.cells.find((candidate) => candidate.id === id);
        if (!cell) return;
        this.scroll = Math.max(this.minScroll(), Math.min(0, this.viewHeight / 2 - cell.holder.y));
        this.grid.y = this.gridTop() + this.scroll;
        gsap.fromTo(cell.holder.scale, { x: 0.5, y: 0.5 }, { x: 1, y: 1, duration: 0.5, ease: 'back.out(3)' });
    }

    /** The coins changed elsewhere, or something's been bought: everything shows as it now is. */
    public refresh(): void {
        for (const section of SECTION_ORDER) {
            const total = UfoProgress.inSection(this.kind, section).length;
            const count = this.sectionCounts.get(section);
            if (count) count.text = `${UfoProgress.ownedCount(this.kind, section)}/${total}`;
        }
        const worn = UfoProgress.worn(this.kind);
        for (const cell of this.cells) {
            const mine = UfoProgress.isOwned(this.kind, cell.id);
            const wearing = cell.id === worn;
            const look = wearing ? CARD.worn : mine ? CARD.owned : CARD.locked;
            cell.outer.tint = look.outer;
            cell.inner.tint = look.inner;
            cell.picture.tint = mine ? 0xffffff : LOCKED_PICTURE;
            cell.name.style.fill = mine ? NAME_COLOR.mine : NAME_COLOR.locked;
            const special = cell.section === 'specials';
            cell.lock.visible = !mine && !special;
            cell.price.visible = !mine && special;
            cell.check.visible = wearing;
            cell.wear.visible = mine && !wearing;
        }
        this.unlock.visible = this.section === 'classics' && UfoProgress.anyClassicLocked(this.kind);
    }

    private startDrag(event: PIXI.FederatedPointerEvent): void {
        this.dragFrom = event.global.y;
        this.dragScroll = this.scroll;
        this.dragged = 0;
    }

    private moveDrag(event: PIXI.FederatedPointerEvent): void {
        if (this.dragFrom === null) return;
        const moved = (event.global.y - this.dragFrom) / Game.scale;
        this.dragged = Math.max(this.dragged, Math.abs(moved));
        this.scroll = Math.max(this.minScroll(), Math.min(0, this.dragScroll + moved));
        this.grid.y = this.gridTop() + this.scroll;
    }

    private endDrag(): void {
        this.dragFrom = null;
    }

    private gridTop(): number {
        return Game.overlayScreenData.topLeft.y + HEADER.strip + SECTIONS.zone + GRID.top;
    }

    private minScroll(): number {
        const shown = this.cells.filter((cell) => cell.section === this.section).length;
        const rows = Math.ceil(shown / GRID.cols);
        const room = this.section === 'classics' ? ROOM_FOR_UNLOCK : ROOM_BELOW;
        return Math.min(0, this.viewHeight - rows * GRID.cellHeight - room);
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const { x: left, y: top } = screen.topLeft;
        this.back.position.copyFrom(screen.center);
        this.back.width = screen.width + 4;
        this.back.height = screen.height + 4;
        this.strip.position.set(left, top);
        this.strip.width = screen.width;
        this.strip.height = HEADER.strip;
        this.title.position.set(screen.center.x, top + HEADER.titleY);
        const zoneY = top + HEADER.strip;
        this.zone.position.set(left, zoneY);
        this.zone.width = screen.width / SECTIONS.zoneScale;
        this.tabs.position.set(screen.center.x, zoneY + SECTIONS.trackY);
        const bottom = top + screen.height - TABS_HEIGHT;
        this.unlock.position.set(screen.center.x, bottom - UNLOCK.above - UNLOCK.height / 2);
        const gridTop = this.gridTop();
        this.viewHeight = bottom - gridTop;
        this.gridMask.clear().beginFill(0xffffff).drawRect(left, gridTop, screen.width, this.viewHeight).endFill();
        this.scroll = Math.max(this.minScroll(), Math.min(0, this.scroll));
        this.grid.position.set(screen.center.x, gridTop + this.scroll);
    }

    public override destroy(): void {
        gsap.killTweensOf(this.unlock.scale);
        gsap.killTweensOf(this.chosen);
        this.cells.forEach((cell) => {
            gsap.killTweensOf(cell.holder);
            gsap.killTweensOf(cell.holder.scale);
        });
        super.destroy({ children: true });
    }
}
