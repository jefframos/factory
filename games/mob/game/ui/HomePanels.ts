// HomePanels.ts
//
// The main screen's two side tabs, filling the screen above the bottom tabs as Ant's and UFO's shops do (a dark blue
// back, a blue strip with the title):
//   'upgrades' — the cannon's three upgrades (UpgradeCard, the same cards as the end card's): tap one to buy its next
//                level; and the unit cards' (CardUpgrades).
// Both scroll (drag, or the wheel) when they're taller than the room under the strip, as Ant's and UFO's shops do, a
// scroll bar down the right side showing where in it you are.
//   'areas'    — every area (zone) as a row: done (green, a check), the one being played (blue, how far through it,
//                YOU ARE HERE), open (blue: every level unlocked) or locked (dark, a padlock), its levels as a segmented
//                bar. Tap one that isn't locked: its levels open under it, a round button each (green beaten, gold the
//                one being played, blue reachable, grey not yet); tap one of those to play it (a win then goes on to
//                the level after it).

import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import { UpgradeKind } from '../data/MobConfig';
import { MobSave } from '../data/MobSave';
import { AreaState, areaStates } from '../data/MobLevels';
import { UpgradeCard, UPGRADE_CARD } from './UpgradeCard';
import { CardUpgrades } from './CardUpgrades';
import { CardKind } from '../data/Settings';
import { framePlane, iconSprite, label, plainLabel, tappable } from './UiParts';

export type PanelKind = 'upgrades' | 'areas';

const BACK = 0x12305e;
const HEADER = { strip: 96, stripColor: 0x3f6bf5, title: 34, titleY: 48 };
const TABS_HEIGHT = 118;
const TITLES: Record<PanelKind, string> = { upgrades: 'UPGRADES', areas: 'AREAS' };
const UPGRADE_KINDS: UpgradeKind[] = ['fire', 'capacity', 'recharge'];
const UPGRADES_LAYOUT = { gap: 14, hint: 24, hintGap: 46, cardsTitle: 30, cardsTitleGap: 100, cardsGap: 130 };
/** An area's row: its size, gap, and tints by state (as Ant's shop cards: green in use, blue yours, dark locked). */
const ROW = { width: 640, height: 150, gap: 18, top: 40, frameScale: 0.7 };
const ROW_LOOK = {
    done: { outer: 0x25c465, inner: 0x7ff0a8, name: 0x10123a },
    current: { outer: 0x3f8cff, inner: 0x93c2ff, name: 0x10123a },
    open: { outer: 0x3f8cff, inner: 0x93c2ff, name: 0x10123a },
    locked: { outer: 0x1c2c5c, inner: 0x2c4380, name: 0xc3cdea },
};
const SEGMENT = { done: 0x25c465, off: 0x1c1d33, edge: 0x10123a, height: 18, gap: 4 };
/** Scrolling: under this much of a drag a tap's a tap; the wheel's pace; the room left under the last row. */
const DRAG = { tap: 10, wheel: 0.8, bottom: 30 };
/** The scroll bar: its width, how far in from the right edge, its ends' room, its thumb's least height, colours. */
const SCROLL_BAR = { width: 10, inset: 10, pad: 12, minThumb: 48, track: 0x0a1a3a, trackAlpha: 0.7, thumb: 0x6f9bff };
/** An open area's levels under its row: the strip's height, each button's size and gap, their tints. */
const LEVELS = { height: 96, size: 56, gap: 7, done: 0x3fcf5e, here: 0xffc83d, open: 0x3f8cff, text: 24 };

export class HomePanel extends PIXI.Container {
    private readonly back = new PIXI.Sprite(PIXI.Texture.WHITE);
    private readonly strip = new PIXI.Sprite(PIXI.Texture.WHITE);
    private readonly title = label(HEADER.title);
    private readonly content = new PIXI.Container();
    private readonly cards: UpgradeCard[] = [];
    private readonly hint = label(UPGRADES_LAYOUT.hint, 0xc9d3ff);
    /** The unit cards' levels (upgrades), under the cannon's. */
    private cardUpgrades: CardUpgrades | null = null;

    /** The area whose levels are open under its row (none: -1): the one being played, to start with. */
    private openArea = Math.max(-1, areaStates(MobSave.battle, MobSave.furthest).findIndex((area) => area.state === 'current'));

    /** `onBuy`: an upgrade card tapped (upgrades); `onPick`: a level tapped in an area (areas: its index, to play it);
     *  `onBuyCard`: a unit card's next level tapped (upgrades). */
    public constructor(private readonly kind: PanelKind, onBuy: (kind: UpgradeKind) => void = () => undefined, private readonly onPick: (index: number) => void = () => undefined,
        onBuyCard: (kind: CardKind) => void = () => undefined) {
        super();
        this.back.tint = BACK;
        // It takes the taps that miss its cards: nothing reaches the home screen under it.
        this.back.eventMode = 'static';
        this.strip.tint = HEADER.stripColor;
        this.title.text = TITLES[kind];
        // The content scrolls under the strip, cut to the room there (view).
        this.content.mask = this.view;
        this.addChild(this.back, this.view, this.content, this.scrollBar, this.strip, this.title);
        // A drag anywhere on it scrolls (caught on the way down: the cards stop their own presses going further).
        this.addEventListener('pointerdown', (event) => this.startDrag(event as PIXI.FederatedPointerEvent), { capture: true });
        this.eventMode = 'static';
        this.on('globalpointermove', (event: PIXI.FederatedPointerEvent) => this.moveDrag(event));
        this.on('pointerup', () => this.endDrag());
        this.on('pointerupoutside', () => this.endDrag());
        window.addEventListener('wheel', this.onWheel, { passive: true });
        if (kind === 'upgrades') {
            UPGRADE_KINDS.forEach((upgrade, i) => {
                const card = new UpgradeCard(upgrade, onBuy);
                card.x = (i - 1) * (UPGRADE_CARD.width + UPGRADES_LAYOUT.gap);
                this.cards.push(card);
                this.content.addChild(card);
            });
            this.hint.text = 'Upgrades are kept for every battle';
            this.hint.y = UPGRADE_CARD.height / 2 + UPGRADES_LAYOUT.hintGap;
            this.content.addChild(this.hint);
            // The unit cards, under a heading.
            const cardsTitle = label(UPGRADES_LAYOUT.cardsTitle);
            cardsTitle.text = 'CARDS';
            cardsTitle.y = this.hint.y + UPGRADES_LAYOUT.cardsTitleGap;
            this.cardUpgrades = new CardUpgrades(onBuyCard);
            this.cardUpgrades.y = this.hint.y + UPGRADES_LAYOUT.cardsGap;
            this.content.addChild(cardsTitle, this.cardUpgrades);
        }
        this.refresh();
    }

    /** What it shows, as the save has it now. */
    public refresh(): void {
        if (this.kind === 'upgrades') {
            this.cards.forEach((card) => card.set({ level: MobSave.level(card.kind), cost: MobSave.cost(card.kind) }, MobSave.coins));
            this.cardUpgrades?.refresh();
            return;
        }
        this.content.removeChildren().forEach((child) => child.destroy({ children: true }));
        let y = ROW.top;
        areaStates(MobSave.battle, MobSave.furthest).forEach((area, i) => {
            const row = this.areaRow(i + 1, area, i);
            row.y = y + ROW.height / 2;
            this.content.addChild(row);
            y += ROW.height + ROW.gap;
            // Its levels, under it, when it's open.
            if (i === this.openArea && area.state !== 'locked') {
                const levels = this.levelStrip(area);
                levels.y = y - ROW.gap / 2;
                this.content.addChild(levels);
                y += LEVELS.height;
            }
        });
        this.contentHeight = y;
    }

    /** An area's row: its number and name, its levels as a bar, and what state it's in. */
    private areaRow(number: number, area: AreaState, at: number): PIXI.Container {
        const look = ROW_LOOK[area.state];
        const row = new PIXI.Container();
        const outer = framePlane('CardFrame03_n_Bg', ROW.width, ROW.height, ROW.frameScale);
        outer.tint = look.outer;
        outer.position.set(-ROW.width / 2, -ROW.height / 2);
        const inner = framePlane('CardFrame03_n_InnerBg', ROW.width - 24, ROW.height - 30, ROW.frameScale);
        inner.tint = look.inner;
        inner.position.set(-ROW.width / 2 + 12, -ROW.height / 2 + 10);
        const name = plainLabel(34, look.name);
        name.anchor.set(0, 0.5);
        name.text = `${number}. ${area.zone.name.toUpperCase()}`;
        name.position.set(-ROW.width / 2 + 36, -28);
        const status = plainLabel(22, look.name);
        status.anchor.set(1, 0.5);
        status.position.set(ROW.width / 2 - 120, -28);
        status.text = area.state === 'done' ? 'COMPLETE' : area.state === 'current' ? `${area.done} / ${area.total}  ·  YOU ARE HERE` : area.state === 'open' ? 'UNLOCKED' : 'LOCKED';
        row.addChild(outer, inner, name, status);
        // The levels.
        const left = -ROW.width / 2 + 36;
        const span = ROW.width - 36 - 130;
        const width = (span - SEGMENT.gap * (area.total - 1)) / Math.max(1, area.total);
        const bar = new PIXI.Graphics();
        bar.beginFill(SEGMENT.edge).drawRoundedRect(left - 4, 22 - SEGMENT.height / 2 - 4, span + 8, SEGMENT.height + 8, 9).endFill();
        for (let k = 0; k < area.total; k++) {
            const x = left + k * (width + SEGMENT.gap);
            const done = k < area.done;
            const here = area.state === 'current' && k === area.done;
            bar.beginFill(done ? SEGMENT.done : here ? 0xffd23f : SEGMENT.off).drawRoundedRect(x, 22 - SEGMENT.height / 2, width, SEGMENT.height, 4).endFill();
        }
        row.addChild(bar);
        // Its badge on the right: a check, the map pin, or a padlock.
        const icon = iconSprite(area.state === 'done' ? 'Icon_Check03_l' : area.state === 'locked' ? 'Icon_Lock03' : 'Icon_MapPoint', 84);
        icon.position.set(ROW.width / 2 - 64, 0);
        row.addChild(icon);
        if (area.state === 'locked') {
            row.alpha = 0.9;
        } else {
            // Tap: its levels open under it (or close).
            row.hitArea = new PIXI.Rectangle(-ROW.width / 2, -ROW.height / 2, ROW.width, ROW.height);
            tappable(row, () => {
                this.openArea = this.openArea === at ? -1 : at;
                this.refresh();
                this.reposition();
            });
        }
        return row;
    }

    /** How tall the areas' rows (and the open one's levels) are. */
    private contentHeight = 0;
    /** Scrolling: how far down it is, the most it can go, where the content's top sits unscrolled; a drag going on. */
    private scroll = 0;
    private maxScroll = 0;
    private contentTop = 0;
    private readonly view = new PIXI.Graphics();
    /** The scroll bar, and the room it runs down (the view's right side). */
    private readonly scrollBar = new PIXI.Graphics();
    private barRoom = { x: 0, top: 0, height: 0 };
    private drag: { y: number; scroll: number; moved: boolean } | null = null;

    private startDrag(event: PIXI.FederatedPointerEvent): void {
        this.drag = { y: event.global.y, scroll: this.scroll, moved: false };
    }

    private moveDrag(event: PIXI.FederatedPointerEvent): void {
        if (!this.drag) return;
        const dy = event.global.y - this.drag.y;
        // Past a few pixels it's a drag, not a tap: the cards under it don't take it.
        if (!this.drag.moved && Math.abs(dy) > DRAG.tap) {
            this.drag.moved = true;
            this.content.eventMode = 'none';
        }
        if (this.drag.moved) this.scrollTo(this.drag.scroll - dy);
    }

    private endDrag(): void {
        this.drag = null;
        this.content.eventMode = 'passive';
    }

    private readonly onWheel = (event: WheelEvent): void => {
        if (!this.visible || this.maxScroll <= 0) return;
        this.scrollTo(this.scroll + event.deltaY * DRAG.wheel);
    };

    private scrollTo(scroll: number): void {
        this.scroll = Math.max(0, Math.min(this.maxScroll, scroll));
        this.content.y = this.contentTop - this.scroll;
        this.drawScrollBar();
    }

    /** The track down the right side and its thumb: as tall as the share of it showing, where that share is. None if it all fits. */
    private drawScrollBar(): void {
        const bar = this.scrollBar.clear();
        if (this.maxScroll <= 0) return;
        const { x, top, height } = this.barRoom;
        const w = SCROLL_BAR.width;
        const shown = height / (height + this.maxScroll);
        const thumb = Math.max(SCROLL_BAR.minThumb, height * shown);
        const y = top + (height - thumb) * (this.scroll / this.maxScroll);
        bar.beginFill(SCROLL_BAR.track, SCROLL_BAR.trackAlpha).drawRoundedRect(x - w / 2, top, w, height, w / 2).endFill();
        bar.beginFill(SCROLL_BAR.thumb).drawRoundedRect(x - w / 2, y, w, thumb, w / 2).endFill();
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        window.removeEventListener('wheel', this.onWheel);
        super.destroy(options);
    }

    /**
     * An area's levels across, a round button each: beaten (green, its number), the one being played (gold), one that
     * can be played (blue), one not reached (grey, no number). A tap on one that can be played plays it.
     */
    private levelStrip(area: AreaState): PIXI.Container {
        const strip = new PIXI.Container();
        const width = area.total * LEVELS.size + (area.total - 1) * LEVELS.gap;
        const back = framePlane('PanelFrame03_Bg', Math.min(ROW.width, width + 32), LEVELS.height - 10, 0.7);
        back.tint = 0x1c2c5c;
        back.position.set(-Math.min(ROW.width, width + 32) / 2, 0);
        strip.addChild(back);
        // Squeezed to the row's width if there are a lot of them.
        const fit = Math.min(1, (ROW.width - 32) / width);
        for (let k = 0; k < area.total; k++) {
            const index = area.first + k;
            const beaten = index < MobSave.battle;
            const here = index === MobSave.battle;
            const reachable = index <= MobSave.furthest;
            // The pack's white round button, in its state's colour (its shine over the top); one not reached, the dark one.
            const button = new PIXI.Container();
            const s = LEVELS.size;
            const body = framePlane(reachable ? 'Button_Round02_White_Bg' : 'Button_Round03_Dark', s, s, s / 62);
            body.position.set(-s / 2, -s / 2);
            if (reachable) body.tint = beaten ? LEVELS.done : here ? LEVELS.here : LEVELS.open;
            button.addChild(body);
            if (reachable) {
                const light = framePlane('Button_Round02_White_Light', s - 12, s * 0.3, s / 62);
                light.position.set(-s / 2 + 6, -s / 2 + 4);
                light.alpha = 0.85;
                button.addChild(light);
            }
            const number = label(LEVELS.text, here ? 0x10123a : 0xffffff, here ? 0xffffff : 0x10123a);
            number.text = reachable ? `${index + 1}` : '';
            number.y = -3;
            button.addChild(number);
            button.position.set((-width / 2 + LEVELS.size / 2 + k * (LEVELS.size + LEVELS.gap)) * fit, (LEVELS.height - 10) / 2);
            button.scale.set(fit);
            if (reachable) tappable(button, () => this.onPick(index));
            strip.addChild(button);
        }
        return strip;
    }

    /** Fills the screen above the tabs; its content under the strip. */
    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const { topLeft, width, height } = screen;
        const bottom = topLeft.y + height - TABS_HEIGHT;
        this.back.position.set(topLeft.x, topLeft.y);
        this.back.width = width;
        this.back.height = bottom - topLeft.y;
        // The strip under the coins and the sound button (their row stays on top of it).
        const stripTop = topLeft.y + 84;
        this.strip.position.set(topLeft.x, stripTop);
        this.strip.width = width;
        this.strip.height = HEADER.strip;
        this.title.position.set(screen.center.x, stripTop + HEADER.titleY);
        const viewTop = stripTop + HEADER.strip;
        const room = bottom - viewTop;
        this.view.clear().beginFill(0xffffff).drawRect(topLeft.x, viewTop, width, room).endFill();
        this.barRoom = { x: topLeft.x + width - SCROLL_BAR.inset - SCROLL_BAR.width / 2, top: viewTop + SCROLL_BAR.pad, height: room - SCROLL_BAR.pad * 2 };
        // Fitted to the width (not the height: what doesn't fit scrolls).
        let scale: number;
        let top: number;
        let tall: number;
        if (this.kind === 'upgrades') {
            // The cannon's three, then the cards.
            top = UPGRADE_CARD.height / 2 + 24;
            tall = top + UPGRADE_CARD.height / 2 + UPGRADES_LAYOUT.hintGap + UPGRADES_LAYOUT.cardsGap + (this.cardUpgrades?.tilesHeight ?? 0);
            scale = Math.min(1, (width - 60) / (UPGRADE_CARD.width * 3 + UPGRADES_LAYOUT.gap * 2));
        } else {
            top = 0;
            tall = Math.max(this.contentHeight, ROW.top + ROW.height);
            scale = Math.min(1, (width - 60) / ROW.width);
        }
        this.content.scale.set(scale);
        this.contentTop = viewTop + top * scale;
        this.maxScroll = Math.max(0, (tall + DRAG.bottom) * scale - room);
        this.content.x = screen.center.x;
        this.scrollTo(this.scroll);
    }

    public update(dt: number): void {
        this.cards.forEach((card) => card.update(dt));
    }
}
