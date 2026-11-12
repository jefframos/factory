// StickerBook.ts
//
// The main screen's STICKERS tab: every level's picture as a sticker, in play order, a page of PAGE.cols x PAGE.rows at
// a time — a finished level's sticker (its picture in solid pixels on a white card, a little askew as if stuck in, its
// name under it), one still to do an empty dashed slot with its number. Over the cozy moving pattern, as the shops: the
// title, how many are collected, the page's arrows and which page it is. It opens on the page with the latest sticker.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { AntSave } from '../data/AntSave';
import { LEVELS, LevelData, pixelsOf } from '../data/Levels';
import { PANEL_LOOK, Pattern } from './Pattern';
import { COZY, label, plainLabel, roundButton, tappable } from './UiParts';

const HEADER = { strip: 96, title: 34, titleY: 48, countY: 128, count: 24 };
/** A page: its grid, a cell's size, the sticker's picture, how far each may tilt. */
const PAGE = { cols: 3, rows: 4, cellWidth: 206, cellHeight: 214, picture: 120, tilt: 0.06, top: 166 };
const STICKER = { width: 176, height: 184, corner: 22, nameY: 70, nameSize: 18 };
/** The page's arrows and its number, under the grid. */
const NAV = { size: 66, gap: 230, numberSize: 26, room: 16 };
/** The bottom tabs' height (the page stays over them). */
const TABS_HEIGHT = 108;
const PER_PAGE = PAGE.cols * PAGE.rows;

/** A level's picture as solid squares (no gaps), `size` across its longer side, centred. */
function pictureOf(level: LevelData, size: number): PIXI.Graphics {
    const pixels = pixelsOf(level);
    const cell = size / Math.max(level.width, level.height);
    const width = cell * level.width;
    const height = cell * level.height;
    const g = new PIXI.Graphics();
    for (let i = 0; i < pixels.length; i++) {
        if (pixels[i] < 0) continue;
        const x = -width / 2 + (i % level.width) * cell;
        const y = -height / 2 + Math.floor(i / level.width) * cell;
        g.beginFill(new PIXI.Color(level.palette[pixels[i]]).toNumber()).drawRect(x - 0.2, y - 0.2, cell + 0.4, cell + 0.4).endFill();
    }
    return g;
}

/** A dashed rounded outline, `width` x `height` centred (an empty slot). */
function dashedSlot(g: PIXI.Graphics, width: number, height: number, colour: number): void {
    const dash = 12;
    const gap = 8;
    g.lineStyle(4, colour, 0.9);
    const edge = (x0: number, y0: number, x1: number, y1: number) => {
        const length = Math.hypot(x1 - x0, y1 - y0);
        for (let d = 0; d < length; d += dash + gap) {
            const a = d / length;
            const b = Math.min(1, (d + dash) / length);
            g.moveTo(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a).lineTo(x0 + (x1 - x0) * b, y0 + (y1 - y0) * b);
        }
    };
    const w = width / 2;
    const h = height / 2;
    const r = STICKER.corner;
    edge(-w + r, -h, w - r, -h);
    edge(w, -h + r, w, h - r);
    edge(w - r, h, -w + r, h);
    edge(-w, h - r, -w, -h + r);
}

export class StickerBook extends PIXI.Container {
    private readonly back = new PIXI.Sprite(PIXI.Texture.WHITE);
    private readonly pattern = new Pattern(PANEL_LOOK);
    private readonly strip = new PIXI.Sprite(PIXI.Texture.WHITE);
    private readonly title = label(HEADER.title);
    private readonly count = label(HEADER.count, 0xffe27a);
    private readonly grid = new PIXI.Container();
    private readonly prev = roundButton('Button_Round02_Blue', 'Icon_Arrow_Prev1', NAV.size, NAV.size * 0.5);
    private readonly next = roundButton('Button_Round02_Blue', 'Icon_Arrow_Next1', NAV.size, NAV.size * 0.5);
    private readonly pageText = label(NAV.numberSize);
    private page = 0;
    private readonly pages = Math.max(1, Math.ceil(LEVELS.length / PER_PAGE));

    public constructor() {
        super();
        this.back.tint = COZY.cream;
        this.back.anchor.set(0.5);
        this.back.eventMode = 'static';
        this.pattern.eventMode = 'none';
        this.strip.tint = COZY.coral;
        this.title.text = 'STICKER BOOK';
        tappable(this.prev, () => this.turn(-1), 'tab');
        tappable(this.next, () => this.turn(1), 'tab');
        this.addChild(this.back, this.pattern, this.strip, this.title, this.count, this.grid, this.prev, this.next, this.pageText);
        this.refresh();
    }

    /** Opened (again): the stickers as they are, on the page with the latest one. */
    public refresh(): void {
        const won = LEVELS.map((_, i) => AntSave.hasWon(i));
        const latest = won.lastIndexOf(true);
        this.page = latest < 0 ? 0 : Math.floor(latest / PER_PAGE);
        this.count.text = `${won.filter(Boolean).length}/${LEVELS.length} COLLECTED`;
        this.showPage();
    }

    private turn(step: number): void {
        const to = Math.max(0, Math.min(this.pages - 1, this.page + step));
        if (to === this.page) return;
        this.page = to;
        this.showPage();
        gsap.fromTo(this.grid, { alpha: 0, x: this.grid.x + step * 40 }, { alpha: 1, x: this.grid.x, duration: 0.25, ease: 'power2.out' });
    }

    /** The page's stickers (or empty slots). */
    private showPage(): void {
        gsap.killTweensOf(this.grid);
        this.grid.removeChildren().forEach((child) => child.destroy({ children: true }));
        const first = this.page * PER_PAGE;
        for (let k = 0; k < PER_PAGE; k++) {
            const index = first + k;
            const level = LEVELS[index];
            if (!level) break;
            const cell = new PIXI.Container();
            cell.position.set(((k % PAGE.cols) - (PAGE.cols - 1) / 2) * PAGE.cellWidth, (Math.floor(k / PAGE.cols) + 0.5) * PAGE.cellHeight);
            if (AntSave.hasWon(index)) {
                // A sticker: white, a soft shadow under it, askew (the same tilt each time for the same level).
                const tilt = (((index * 7919) % 100) / 100 - 0.5) * 2 * PAGE.tilt;
                const card = new PIXI.Graphics()
                    .beginFill(0x8a5530, 0.25).drawRoundedRect(-STICKER.width / 2 + 3, -STICKER.height / 2 + 6, STICKER.width, STICKER.height, STICKER.corner).endFill()
                    .beginFill(0xffffff).drawRoundedRect(-STICKER.width / 2, -STICKER.height / 2, STICKER.width, STICKER.height, STICKER.corner).endFill();
                const picture = pictureOf(level, PAGE.picture);
                picture.y = -14;
                const name = plainLabel(STICKER.nameSize, COZY.ink);
                name.text = level.name.toUpperCase();
                name.scale.set(Math.min(1, (STICKER.width - 16) / Math.max(1, name.width)));
                name.y = STICKER.nameY;
                cell.addChild(card, picture, name);
                cell.rotation = tilt;
            } else {
                // Still to do: an empty dashed slot with its number.
                const slot = new PIXI.Graphics();
                slot.beginFill(COZY.peach, 0.35).drawRoundedRect(-STICKER.width / 2, -STICKER.height / 2, STICKER.width, STICKER.height, STICKER.corner).endFill();
                dashedSlot(slot, STICKER.width, STICKER.height, COZY.tan);
                const number = plainLabel(40, COZY.tan);
                number.text = String(index + 1);
                cell.addChild(slot, number);
            }
            this.grid.addChild(cell);
        }
        this.pageText.text = `PAGE ${this.page + 1}/${this.pages}`;
        this.prev.alpha = this.page > 0 ? 1 : 0.4;
        this.next.alpha = this.page < this.pages - 1 ? 1 : 0.4;
        this.reposition();
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const { x: left, y: top } = screen.topLeft;
        this.back.position.copyFrom(screen.center);
        this.back.width = screen.width + 4;
        this.back.height = screen.height + 4;
        this.pattern.place(left - 2, top - 2, screen.width + 4, screen.height + 4);
        this.strip.position.set(left, top);
        this.strip.width = screen.width;
        this.strip.height = HEADER.strip;
        this.title.position.set(screen.center.x, top + HEADER.titleY);
        this.count.position.set(screen.center.x, top + HEADER.countY);
        // The grid between the header and the arrows, shrunk to fit a short screen.
        const navY = top + screen.height - TABS_HEIGHT - NAV.room - NAV.size / 2;
        const room = navY - NAV.size / 2 - NAV.room - (top + PAGE.top);
        const tall = PAGE.rows * PAGE.cellHeight;
        const scale = Math.min(1, room / tall, (screen.width - 20) / (PAGE.cols * PAGE.cellWidth));
        this.grid.scale.set(scale);
        this.grid.position.set(screen.center.x, top + PAGE.top + (room - tall * scale) / 2);
        this.prev.position.set(screen.center.x - NAV.gap, navY);
        this.next.position.set(screen.center.x + NAV.gap, navY);
        this.pageText.position.set(screen.center.x, navY);
    }

    public override destroy(): void {
        gsap.killTweensOf(this.grid);
        super.destroy({ children: true });
    }
}
