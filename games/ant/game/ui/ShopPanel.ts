// ShopPanel.ts
//
// A shop filling the screen above the bottom tabs, as the UFO game's (games/ufo/game/ui/ShopPanel.ts): the title, the
// section tabs, and cards in rows under them. Drag to scroll.
//   'boosts' — the power-ups (one section): each card one more of a power-up for its price (how many you have on it);
//              one not unlocked yet is dark, with a padlock and its level.
//   'deco'   — BACKGROUNDS (the floor's checker) and FRAMES (the picture's tray): green, in use; blue, yours (tap to
//              use it); dark, its price (tap to buy).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { AntSave, DecoKind } from '../data/AntSave';
import { BOOSTER_PRICES, Background, Frame, decoOf } from '../data/Shop';
import { AntAudio } from '../audio/AntAudio';
import { BOOSTERS, BoosterId } from './BoosterBelt';
import { buttonParts, framePlane, iconSprite, label, plainLabel, roundButton } from './UiParts';

export type ShopKind = 'boosts' | 'deco';
type Section = 'boosts' | DecoKind;

const BACK = 0x12305e;
const HEADER = { strip: 96, stripColor: 0x3f6bf5, title: 34, titleY: 48 };
/** The section tabs: a dark track, the chosen one a raised sky button on it. */
const SECTIONS = { zone: 112, zoneColor: 0x34365a, zoneScale: 0.7, width: 580, height: 62, trackColor: 0x1c1d33, trackY: 56, button: 72, words: 28, slide: 0.18 };
const GRID = { cols: 3, cellWidth: 226, cellHeight: 286, gap: 12, inset: 12, strip: 56, picture: 140, pictureY: -22, nameSize: 19, top: 12 };
/** The card, and the lighter panel in it, by state. */
const CARD = {
    using: { outer: 0x25c465, inner: 0x7ff0a8 },
    owned: { outer: 0x3f8cff, inner: 0x93c2ff },
    locked: { outer: 0x1c2c5c, inner: 0x2c4380 },
};
const NAME_COLOR = { mine: 0x10123a, locked: 0xc3cdea };
const PRICE = { coin: 34, coinX: -36, textX: -12, size: 26 };
const COUNT = { x: 72, y: -104, size: 26 };
const ROOM_BELOW = 20;
const TABS_HEIGHT = 108;
/** Under this much of a drag, a tap's a tap. */
const TAP_MOVE = 12;

const SECTIONS_OF: Record<ShopKind, Section[]> = { boosts: ['boosts'], deco: ['background', 'frame'] };
const TITLE: Record<ShopKind, string> = { boosts: 'POWER-UPS', deco: 'DECO' };
const SECTION_NAME: Record<Section, string> = { boosts: 'POWER-UPS', background: 'BACKGROUNDS', frame: 'FRAMES' };
const BOOSTER_NAMES: Record<BoosterId, string> = { slot: 'Extra slot', shuffle: 'Shuffle', hammer: 'Hammer', bomb: 'Bomb' };

interface Cell {
    id: string;
    section: Section;
    holder: PIXI.Container;
    outer: PIXI.NineSlicePlane;
    inner: PIXI.NineSlicePlane;
    picture: PIXI.Container;
    name: PIXI.Text;
    lock: PIXI.Container;
    check: PIXI.Sprite;
    use: PIXI.Text;
    price: PIXI.Container;
    count: PIXI.Text;
}

/** A tilted checker in a background's two colours, `size` across, in a rounded square. */
function backgroundPreview(background: Background, size: number): PIXI.Container {
    const holder = new PIXI.Container();
    const squares = new PIXI.Graphics().beginFill(background.dark).drawRect(-size, -size, size * 2, size * 2).endFill();
    const step = size / 4;
    for (let y = -8; y < 8; y++) {
        for (let x = -8; x < 8; x++) {
            if ((x + y) % 2 === 0) squares.beginFill(background.light).drawRect(x * step, y * step, step, step).endFill();
        }
    }
    squares.rotation = Math.PI / 4;
    const mask = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(-size / 2, -size / 2, size, size, 18).endFill();
    squares.mask = mask;
    const edge = new PIXI.Graphics().lineStyle(4, 0x10123a, 0.35).drawRoundedRect(-size / 2, -size / 2, size, size, 18);
    holder.addChild(squares, mask, edge);
    return holder;
}

/** A little tray in a frame's colours, with a heart of blocks on it. */
function framePreview(frame: Frame, size: number): PIXI.Container {
    const g = new PIXI.Graphics();
    g.beginFill(frame.border).drawRoundedRect(-size / 2, -size / 2, size, size, 22).endFill();
    const inset = size * 0.13;
    g.beginFill(frame.board).drawRoundedRect(-size / 2 + inset, -size / 2 + inset, size - inset * 2, size - inset * 2, 12).endFill();
    const heart = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
    const cell = (size - inset * 2) / 9;
    heart.forEach((row, y) => [...row].forEach((c, x) => {
        if (c === '#') g.beginFill(0xf28b8b).drawRect((x - 3.5) * cell, (y - 3) * cell, cell - 1, cell - 1).endFill();
    }));
    return g;
}

export class ShopPanel extends PIXI.Container {
    private readonly back = new PIXI.Sprite(PIXI.Texture.WHITE);
    private readonly strip = new PIXI.Sprite(PIXI.Texture.WHITE);
    private readonly title = label(HEADER.title);
    private readonly zone = framePlane('PanelFrame03_Bg', 720, SECTIONS.zone, SECTIONS.zoneScale);
    private readonly tabs = new PIXI.Container();
    private readonly chosen = new PIXI.Container();
    private readonly grid = new PIXI.Container();
    private readonly gridMask = new PIXI.Graphics();
    private readonly cells: Cell[] = [];
    private readonly sections: Section[];
    private section: Section;
    private scroll = 0;
    private dragFrom: number | null = null;
    private dragScroll = 0;
    private dragged = 0;
    private viewHeight = 0;

    /** `onChange`: coins spent, or a different background / frame in use. */
    public constructor(private readonly kind: ShopKind, private readonly onChange: () => void) {
        super();
        this.sections = SECTIONS_OF[kind];
        this.section = this.sections[0];
        this.back.tint = BACK;
        this.back.anchor.set(0.5);
        this.back.eventMode = 'static';
        this.strip.tint = HEADER.stripColor;
        this.zone.tint = SECTIONS.zoneColor;
        this.title.text = TITLE[kind];
        this.grid.mask = this.gridMask;
        this.buildTabs();
        this.addChild(this.back, this.gridMask, this.grid, this.strip, this.title, this.zone, this.tabs);
        if (kind === 'boosts') {
            for (const { id, icon } of BOOSTERS) this.addCell(id, BOOSTER_NAMES[id], 'boosts', roundButton('Button_Round02_Blue', icon, GRID.picture * 0.8));
        } else {
            for (const kindOf of ['background', 'frame'] as DecoKind[]) {
                for (const item of decoOf(kindOf)) {
                    const picture = kindOf === 'background' ? backgroundPreview(item as Background, GRID.picture) : framePreview(item as Frame, GRID.picture);
                    this.addCell(item.id, item.name, kindOf, picture);
                }
            }
        }
        this.back.on('pointerdown', (event: PIXI.FederatedPointerEvent) => this.startDrag(event));
        this.back.on('globalpointermove', (event: PIXI.FederatedPointerEvent) => this.moveDrag(event));
        this.back.on('pointerup', () => this.endDrag());
        this.back.on('pointerupoutside', () => this.endDrag());
        this.showSection(this.section);
    }

    private buildTabs(): void {
        const count = this.sections.length;
        const each = SECTIONS.width / count;
        const track = framePlane('BasicFrame_Round20', SECTIONS.width, SECTIONS.height);
        track.tint = SECTIONS.trackColor;
        track.position.set(-SECTIONS.width / 2, -SECTIONS.height / 2);
        this.chosen.addChild(...buttonParts(each + 10, SECTIONS.button, '', 'Button01_l_Sky'));
        this.tabs.addChild(track, this.chosen);
        this.sections.forEach((section, i) => {
            const holder = new PIXI.Container();
            holder.x = (i - (count - 1) / 2) * each;
            const hit = new PIXI.Sprite(PIXI.Texture.WHITE);
            hit.anchor.set(0.5);
            hit.width = each;
            hit.height = SECTIONS.button;
            hit.alpha = 0;
            const words = label(SECTIONS.words);
            words.text = SECTION_NAME[section];
            words.y = -2;
            holder.addChild(hit, words);
            holder.eventMode = 'static';
            holder.cursor = 'pointer';
            holder.on('pointertap', () => {
                AntAudio.play('tab');
                this.showSection(section);
            });
            this.tabs.addChild(holder);
        });
    }

    private addCell(id: string, name: string, section: Section, picture: PIXI.Container): void {
        const holder = new PIXI.Container();
        const width = GRID.cellWidth - GRID.gap;
        const height = GRID.cellHeight - GRID.gap;
        const outer = framePlane('CardFrame03_n_Bg', width, height);
        outer.position.set(-width / 2, -height / 2);
        const innerWidth = width - GRID.inset * 2;
        const innerHeight = height - GRID.inset - GRID.strip;
        const inner = framePlane('CardFrame03_n_InnerBg', innerWidth, innerHeight);
        inner.position.set(-innerWidth / 2, -height / 2 + GRID.inset);
        picture.y = GRID.pictureY;
        const words = plainLabel(GRID.nameSize, NAME_COLOR.mine);
        words.text = name.toUpperCase();
        words.scale.set(Math.min(1, (innerWidth - 12) / Math.max(words.width, 1)));
        words.y = -height / 2 + GRID.inset + innerHeight - 20;
        const statusY = height / 2 - GRID.strip / 2 - 2;
        // Locked (a power-up not unlocked yet): a padlock and its level.
        const lock = new PIXI.Container();
        const padlock = iconSprite('Icon_Lock01_l', 34);
        padlock.x = -48;
        const unlockAt = label(20);
        unlockAt.anchor.set(0, 0.5);
        unlockAt.x = -24;
        unlockAt.text = `LEVEL ${BOOSTERS.find((b) => b.id === id)?.unlock ?? 1}`;
        lock.addChild(padlock, unlockAt);
        const check = iconSprite('Icon_Check03_l', 44);
        const use = label(22);
        use.text = 'USE';
        const price = new PIXI.Container();
        const coin = iconSprite('Icon_Coin', PRICE.coin);
        coin.x = PRICE.coinX;
        const amount = label(PRICE.size);
        amount.anchor.set(0, 0.5);
        amount.position.set(PRICE.textX, -1);
        amount.text = String(this.priceOf(section, id));
        price.addChild(coin, amount);
        for (const mark of [lock, check, use, price]) mark.y = statusY;
        // How many of a power-up you have.
        const count = label(COUNT.size);
        count.position.set(COUNT.x, COUNT.y);
        holder.addChild(outer, inner, picture, words, lock, check, use, price, count);
        holder.eventMode = 'static';
        holder.cursor = 'pointer';
        holder.on('pointerdown', (event: PIXI.FederatedPointerEvent) => this.startDrag(event));
        holder.on('pointerup', () => this.endDrag());
        holder.on('pointerupoutside', () => this.endDrag());
        holder.on('pointertap', () => this.tapCell(id, section));
        this.grid.addChild(holder);
        this.cells.push({ id, section, holder, outer, inner, picture, name: words, lock, check, use, price, count });
    }

    private priceOf(section: Section, id: string): number {
        if (section === 'boosts') return BOOSTER_PRICES[id as BoosterId];
        return decoOf(section).find((item) => item.id === id)?.price ?? 0;
    }

    /** Not unlocked yet: a power-up past the furthest level reached. */
    private locked(section: Section, id: string): boolean {
        return section === 'boosts' && AntSave.level + 1 < (BOOSTERS.find((b) => b.id === id)?.unlock ?? 1);
    }

    private showSection(section: Section): void {
        this.section = section;
        this.scroll = 0;
        let index = 0;
        for (const cell of this.cells) {
            cell.holder.visible = cell.section === section;
            if (!cell.holder.visible) continue;
            cell.holder.position.set(((index % GRID.cols) - (GRID.cols - 1) / 2) * GRID.cellWidth, (Math.floor(index / GRID.cols) + 0.5) * GRID.cellHeight);
            index++;
        }
        const each = SECTIONS.width / this.sections.length;
        gsap.to(this.chosen, { x: (this.sections.indexOf(section) - (this.sections.length - 1) / 2) * each, duration: SECTIONS.slide, ease: 'power2.out' });
        this.refresh();
        this.reposition();
    }

    private tapCell(id: string, section: Section): void {
        if (this.dragged > TAP_MOVE) return;
        const cell = this.cells.find((c) => c.id === id && c.section === section);
        if (!cell) return;
        if (this.locked(section, id)) {
            this.refuse(cell);
            return;
        }
        if (section === 'boosts') {
            if (!AntSave.spend(BOOSTER_PRICES[id as BoosterId])) return this.refuse(cell);
            AntSave.addBooster(id as BoosterId, 1);
            AntAudio.play('slot');
        } else if (AntSave.owns(section, id)) {
            if (AntSave.using(section) === id) return;
            AntSave.use(section, id);
            AntAudio.play('click');
        } else {
            if (!AntSave.spend(this.priceOf(section, id))) return this.refuse(cell);
            AntSave.own(section, id);
            AntSave.use(section, id);
            AntAudio.play('win');
        }
        gsap.fromTo(cell.holder.scale, { x: 0.85, y: 0.85 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(3)' });
        this.refresh();
        this.onChange();
    }

    /** Not enough coins, or locked: a wiggle and a buzz. */
    private refuse(cell: Cell): void {
        gsap.fromTo(cell.holder, { rotation: -0.05 }, { rotation: 0, duration: 0.3, ease: 'elastic.out(1.2, 0.3)' });
        AntAudio.play('full');
    }

    /** Everything shows as it now is (coins, what's owned and in use). */
    public refresh(): void {
        for (const cell of this.cells) {
            const { id, section } = cell;
            const locked = this.locked(section, id);
            if (section === 'boosts') {
                const look = locked ? CARD.locked : CARD.owned;
                cell.outer.tint = look.outer;
                cell.inner.tint = look.inner;
                cell.picture.alpha = locked ? 0.35 : 1;
                cell.name.style.fill = locked ? NAME_COLOR.locked : NAME_COLOR.mine;
                cell.lock.visible = locked;
                cell.price.visible = !locked;
                cell.check.visible = cell.use.visible = false;
                const have = AntSave.boosters(id as BoosterId);
                cell.count.visible = !locked && have > 0;
                cell.count.text = `x${have}`;
                continue;
            }
            const mine = AntSave.owns(section, id);
            const using = AntSave.using(section) === id;
            const look = using ? CARD.using : mine ? CARD.owned : CARD.locked;
            cell.outer.tint = look.outer;
            cell.inner.tint = look.inner;
            cell.picture.alpha = mine ? 1 : 0.75;
            cell.name.style.fill = mine ? NAME_COLOR.mine : NAME_COLOR.locked;
            cell.lock.visible = false;
            cell.count.visible = false;
            cell.price.visible = !mine;
            cell.check.visible = using;
            cell.use.visible = mine && !using;
        }
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
        return Math.min(0, this.viewHeight - rows * GRID.cellHeight - ROOM_BELOW);
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
        const gridTop = this.gridTop();
        this.viewHeight = bottom - gridTop;
        this.gridMask.clear().beginFill(0xffffff).drawRect(left, gridTop, screen.width, this.viewHeight).endFill();
        this.scroll = Math.max(this.minScroll(), Math.min(0, this.scroll));
        this.grid.position.set(screen.center.x, gridTop + this.scroll);
    }

    public override destroy(): void {
        gsap.killTweensOf(this.chosen);
        this.cells.forEach((cell) => gsap.killTweensOf([cell.holder, cell.holder.scale]));
        super.destroy({ children: true });
    }
}
