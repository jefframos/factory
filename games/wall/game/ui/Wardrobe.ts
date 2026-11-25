// Wardrobe.ts
//
// What the hands wear and hold, picked: a panel over the wall (the hands, held up below it, change at once). A tab for each
// slot (data/Looks) and one for the tool; what's not been reached yet shows the wall it comes with. The cards' pictures are
// the player's own hand in each, taken a few a frame.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { WallAudio } from '../audio/WallAudio';
import { Gameplay } from '../ads/Gameplay';
import { WallAnalytics } from '../analytics/WallAnalytics';
import { LOOK_TABS, Look, LookItem, SlotId, gainLook, lookPrice, lookState, lookWall, newLooks, wornIn, wornLook } from '../data/Looks';
import { short, toolAt, toolsAfter, toolLevel, toolsUpTo } from '../data/WallConfig';
import { WallProgress } from '../data/WallProgress';
import { frame, sprite, text } from './parts';

const PANEL = { width: 696, tall: 0.56, most: 800, top: 16, pad: 22, header: 74, tabs: 62 };
const CARD = { width: 150, height: 164, gap: 12, columns: 4, art: 116 };
const COLORS = { panel: 0x2b2d4d, tab: 0x3c3f66, active: 0x4a6ef5, worn: 0x2fa36b, owned: 0x3f6fd0, locked: 0x23253a, sale: 0x35509a, video: 0x8a3fd0 };
const PICTURE = 160;
const PICTURES_A_FRAME = 2;
const DRAG = 10;
/** Tools still to come that are shown. */
const COMING = 3;

type TabId = SlotId | 'tool';
const TABS: { id: TabId; name: string }[] = [...LOOK_TABS, { id: 'tool', name: 'TOOL' }];

export interface WardrobeActions {
    /** Something else is worn or held. */
    changed(): void;
    /** The hands held up, or back. */
    show(on: boolean): void;
    /** The hand in a look. */
    picture(look: Look, size: number): ImageData | null;
}

/** What one's to be had for: money, or a video. */
export interface Cost {
    price?: number;
    video?: boolean;
    /** The money's there. */
    can: boolean;
}

interface PendingPicture {
    look: Look;
    art: PIXI.Sprite;
}

export class Wardrobe extends PIXI.Container {
    public isOpen = false;
    private readonly backdrop = new PIXI.Graphics();
    private readonly panel = new PIXI.Container();
    private back?: PIXI.NineSlicePlane;
    private readonly title = text('WARDROBE', 38, 0xffffff);
    private readonly close = sprite('Icon_Close02', 48);
    private readonly tabs = new PIXI.Container();
    private readonly grid = new PIXI.Container();
    private readonly gridMask = new PIXI.Graphics();
    private readonly bar = new PIXI.Graphics();
    private tab: TabId = 'skin';
    private height_ = 600;
    private scroll = 0;
    private scrollMax = 0;
    private drag?: { y: number; scroll: number; moved: boolean };
    private pending: PendingPicture[] = [];
    private watching = false;
    private readonly pictures = new Map<string, PIXI.Texture>();

    public constructor(private readonly actions: WardrobeActions, private readonly onToggle: (open: boolean) => void) {
        super();
        this.visible = false;
        this.backdrop.eventMode = 'static';
        this.backdrop.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            this.setOpen(false);
        });
        this.panel.eventMode = 'static';
        this.panel.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            this.drag = { y: this.toLocal(event.global).y, scroll: this.scroll, moved: false };
        });
        this.panel.on('globalpointermove', (event: PIXI.FederatedPointerEvent) => {
            if (!this.drag) return;
            const moved = this.toLocal(event.global).y - this.drag.y;
            if (Math.abs(moved) > DRAG) this.drag.moved = true;
            if (this.drag.moved) this.setScroll(this.drag.scroll - moved);
        });
        // (Cleared after the card under it has had its say.)
        const end = () => window.setTimeout(() => (this.drag = undefined), 0);
        this.panel.on('pointerup', end);
        this.panel.on('pointerupoutside', end);
        this.panel.on('wheel', (event: PIXI.FederatedWheelEvent) => this.setScroll(this.scroll + event.deltaY * 0.6));
        this.close.eventMode = 'static';
        this.close.cursor = 'pointer';
        this.close.on('pointertap', () => this.setOpen(false));
        this.grid.mask = this.gridMask;
        this.panel.addChild(this.title, this.close, this.tabs, this.gridMask, this.grid, this.bar);
        this.addChild(this.backdrop, this.panel);
    }

    /** The tab it's at. */
    public get shows(): string {
        return this.tab;
    }

    public setOpen(open: boolean): void {
        if (open === this.isOpen) return;
        this.isOpen = open;
        this.visible = open;
        // (A break as it closes too: before it's let go, so play isn't started only to be stopped.)
        if (!open) void Gameplay.commercialBreak();
        Gameplay.setBlocked('wardrobe', open);
        this.actions.show(open);
        this.onToggle(open);
        WallAudio.play('claim', 0.5, open ? 1.1 : 0.9);
        if (!open) {
            this.clearGrid();
            this.pictures.forEach((texture) => texture.destroy(true));
            this.pictures.clear();
            return;
        }
        void Gameplay.commercialBreak();
        // The first tab with something new.
        this.tab = LOOK_TABS.find(({ id }) => newLooks(id) > 0)?.id ?? this.tab;
        this.reposition();
        gsap.killTweensOf(this.panel);
        const { y } = this.panel;
        gsap.fromTo(this.panel, { y: y - 80, alpha: 0 }, { y, alpha: 1, duration: 0.25, ease: 'back.out(1.4)' });
    }

    // ---------------------------------------------------------------- what's in it

    private build(): void {
        this.buildTabs();
        this.clearGrid();
        this.scroll = 0;
        const cards = this.tab === 'tool' ? this.toolCards() : this.lookCards(this.tab);
        const step = CARD.width + CARD.gap;
        const left = -(CARD.columns * step - CARD.gap) / 2 + CARD.width / 2;
        cards.forEach((card, i) => {
            card.position.set(left + (i % CARD.columns) * step, CARD.height / 2 + Math.floor(i / CARD.columns) * (CARD.height + CARD.gap));
            this.grid.addChild(card);
        });
        const rows = Math.ceil(cards.length / CARD.columns);
        this.scrollMax = Math.max(0, rows * (CARD.height + CARD.gap) - CARD.gap - this.viewHeight);
        this.setScroll(0);
        WallAnalytics.panel(`wardrobe-${this.tab}`);
        if (this.tab !== 'tool') WallProgress.markLooksSeen(this.tab);
    }

    /** Built again once the tap that asked for it is over (what was tapped goes). */
    private rebuild(scroll: number): void {
        window.setTimeout(() => {
            if (!this.isOpen) return;
            this.build();
            this.setScroll(scroll);
        }, 0);
    }

    private buildTabs(): void {
        this.tabs.removeChildren().forEach((child) => child.destroy({ children: true }));
        const inner = PANEL.width - PANEL.pad * 2;
        const gap = 8;
        const width = (inner - gap * (TABS.length - 1)) / TABS.length;
        TABS.forEach(({ id, name }, i) => {
            const tab = new PIXI.Container();
            const back = frame('CardFrame03_n_Bg', [30, 29, 30, 33], width, 52, 0.45);
            back.tint = id === this.tab ? COLORS.active : COLORS.tab;
            const label = text(name, 21, id === this.tab ? 0xffffff : 0xb9bde0);
            label.scale.set(Math.min(1, (width - 16) / label.width));
            tab.addChild(back, label);
            if (id !== 'tool' && id !== this.tab && newLooks(id) > 0) tab.addChild(dot(width / 2 - 8, -22, newLooks(id)));
            tab.x = -inner / 2 + width / 2 + i * (width + gap);
            tab.eventMode = 'static';
            tab.cursor = 'pointer';
            tab.on('pointertap', () => {
                if (this.tab === id) return;
                this.tab = id;
                WallAudio.play('claim', 0.35, 1.3);
                this.rebuild(0);
            });
            this.tabs.addChild(tab);
        });
    }

    private lookCards(slot: SlotId): PIXI.Container[] {
        const worn = wornIn(slot);
        const look = wornLook();
        const { items } = LOOK_TABS.find(({ id }) => id === slot)!;
        return items.map((item) => {
            const state = lookState(slot, item);
            const owned = state === 'had';
            const art = new PIXI.Sprite(PIXI.Texture.EMPTY);
            art.anchor.set(0.5);
            this.ask({ ...look, [slot]: item }, art);
            const price = lookPrice(item);
            const card = this.card(art, item.id === worn.id, state !== 'wall', state === 'wall' ? `WALL ${lookWall(item)}` : '', state === 'buy' ? { price, can: WallProgress.cash >= price } : state === 'video' ? { video: true, can: true } : undefined);
            this.tappable(card, () => this.pickLook(slot, item, owned));
            return card;
        });
    }

    /** A look tapped: worn; bought first, or after its video. */
    private pickLook(slot: SlotId, item: LookItem, owned: boolean): boolean {
        if (owned) {
            // (On already: nothing new.)
            if (wornIn(slot).id === item.id) return true;
            WallProgress.wear(slot, item.id);
            WallAnalytics.look(slot, item.id, 'equip');
            return true;
        }
        const state = lookState(slot, item);
        if (state === 'buy') {
            if (!WallProgress.spend(lookPrice(item))) return false;
            gainLook(slot, item);
            WallAnalytics.look(slot, item.id, 'bought');
            return true;
        }
        if (state !== 'video' || this.watching) return false;
        this.watching = true;
        void Gameplay.watchVideo().then((watched) => {
            this.watching = false;
            WallAnalytics.look(slot, item.id, watched ? 'unlocked' : 'no-video');
            if (!watched) {
                WallAudio.play('error');
                return;
            }
            gainLook(slot, item);
            WallAudio.play('tool');
            this.actions.changed();
            this.rebuild(this.scroll);
        });
        return true;
    }

    private toolCards(): PIXI.Container[] {
        const level = WallProgress.punchLevel;
        const pick = WallProgress.heldPick;
        const newest = toolAt(level);
        const had = toolsUpTo(level);
        const add = (tool: ReturnType<typeof toolAt>, id: string, worn: boolean, owned: boolean, label: string) => {
            const art = toolArt(tool, CARD.art * 0.85, !owned);
            const card = this.card(art, worn, owned, label);
            this.tappable(card, () => {
                if (!owned) return false;
                if (WallProgress.heldPick === id) return true;
                WallProgress.hold(id);
                WallAnalytics.holdTool(toolLevel(tool.id), tool.id);
                return true;
            });
            return card;
        };
        const coming = toolsAfter(level, COMING).filter(({ id }) => !had.some((tool) => tool.id === id) && id !== 'fists');
        return [
            add(newest, '', pick === '', true, 'NEWEST'),
            ...had.map((tool) => add(tool, tool.id, pick === tool.id, true, tool.name.toUpperCase())),
            ...coming.map((tool) => add(tool, tool.id, false, false, tool.name.toUpperCase())),
        ];
    }

    private card(art: PIXI.Container, worn: boolean, owned: boolean, label: string, cost?: Cost): PIXI.Container {
        const card = new PIXI.Container();
        const back = frame('CardFrame03_n_Bg', [30, 29, 30, 33], CARD.width, CARD.height, 0.7);
        back.tint = worn ? COLORS.worn : cost?.video ? COLORS.video : cost ? COLORS.sale : owned ? COLORS.owned : COLORS.locked;
        art.y = label || cost ? -16 : 0;
        if (!owned) art.alpha = 0.45;
        card.addChild(back, art);
        if (label) {
            const words = text(label, 20, owned ? 0xffffff : 0xffc98a);
            words.scale.set(Math.min(1, (CARD.width - 26) / words.width));
            words.y = CARD.height / 2 - 28;
            card.addChild(words);
        }
        if (cost) card.addChild(costStrip(cost));
        if (!owned) {
            const lock = sprite('Icon_Lock01_s', 40);
            lock.y = -14;
            card.addChild(lock);
        }
        if (worn) {
            const check = sprite('Icon_Check02', 40);
            check.position.set(CARD.width / 2 - 24, -CARD.height / 2 + 24);
            card.addChild(check);
        }
        return card;
    }

    private tappable(card: PIXI.Container, pick: () => boolean): void {
        card.eventMode = 'static';
        card.cursor = 'pointer';
        card.on('pointertap', () => {
            if (this.drag?.moved) return;
            if (!pick()) {
                WallAudio.play('error');
                gsap.fromTo(card.pivot, { x: 8 }, { x: 0, duration: 0.35, ease: 'elastic.out(1, 0.2)' });
                return;
            }
            WallAudio.play('claim');
            this.actions.changed();
            this.rebuild(this.scroll);
        });
    }

    // ---------------------------------------------------------------- pictures

    private ask(look: Look, art: PIXI.Sprite): void {
        const made = this.pictures.get(JSON.stringify(look));
        if (made) setArt(art, made);
        else this.pending.push({ look, art });
    }

    private clearGrid(): void {
        this.pending = [];
        this.grid.removeChildren().forEach((child) => child.destroy({ children: true }));
    }

    public update(): void {
        if (!this.isOpen) return;
        for (let i = 0; i < PICTURES_A_FRAME && this.pending.length; i++) {
            const { look, art } = this.pending.shift()!;
            const image = this.actions.picture(look, PICTURE);
            if (!image) continue;
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = PICTURE;
            canvas.getContext('2d')!.putImageData(image, 0, 0);
            const texture = PIXI.Texture.from(canvas);
            this.pictures.set(JSON.stringify(look), texture);
            setArt(art, texture);
        }
    }

    // ---------------------------------------------------------------- placing

    private get viewHeight(): number {
        return this.height_ - PANEL.header - PANEL.tabs - PANEL.pad * 1.5;
    }

    private setScroll(to: number): void {
        this.scroll = Math.max(0, Math.min(this.scrollMax, to));
        const top = PANEL.header + PANEL.tabs + PANEL.pad * 0.5;
        this.grid.y = top - this.scroll;
        this.bar.clear();
        if (this.scrollMax <= 0) return;
        const view = this.viewHeight;
        const size = (view * view) / (view + this.scrollMax);
        this.bar.beginFill(0x15162a, 0.7).drawRoundedRect(PANEL.width / 2 - 16, top, 8, view, 4).endFill();
        this.bar.beginFill(0xb9c4ff).drawRoundedRect(PANEL.width / 2 - 16, top + (view - size) * (this.scroll / this.scrollMax), 8, size, 4).endFill();
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen || !this.isOpen) return;
        const { topLeft, width, height, center } = screen;
        this.backdrop.clear().beginFill(0x000000, 0.001).drawRect(topLeft.x - 400, topLeft.y - 400, width + 800, height + 800).endFill();
        this.height_ = Math.min(PANEL.most, height * PANEL.tall);
        this.panel.position.set(center.x, topLeft.y + PANEL.top);
        this.back?.destroy();
        this.back = frame('CardFrame03_n_Bg', [30, 29, 30, 33], PANEL.width, this.height_);
        this.back.tint = COLORS.panel;
        this.back.y = 0;
        this.panel.addChildAt(this.back, 0);
        this.title.position.set(0, 42);
        this.close.position.set(PANEL.width / 2 - 46, 44);
        this.tabs.position.set(0, PANEL.header + 26);
        const top = PANEL.header + PANEL.tabs + PANEL.pad * 0.5;
        this.gridMask.clear().beginFill(0xffffff).drawRect(-PANEL.width / 2, top, PANEL.width, this.viewHeight).endFill();
        this.build();
    }
}

function setArt(art: PIXI.Sprite, texture: PIXI.Texture): void {
    if (art.destroyed) return;
    art.texture = texture;
    art.scale.set(CARD.art / PICTURE);
}

/** A card's price: money on gold (grey: not enough), or a video's. */
export function costStrip({ price, video, can }: Cost, width = CARD.width - 24, y = CARD.height / 2 - 32): PIXI.Container {
    const made = new PIXI.Container();
    const back = frame('BasicFrame_Round12', [12, 12, 12, 12], width, 40);
    back.tint = video ? 0xff4fa3 : can ? 0xffc21f : 0x50546a;
    const label = text(video ? 'FREE' : price ? `$${short(price)}` : 'FREE!', 27, 0xffffff, 0x100e18, 6);
    made.addChild(back, label);
    if (video) {
        const icon = sprite('ItemIcon_Video', 46);
        icon.position.set(-width / 2 + 28, -2);
        made.addChild(icon);
        label.x = 18;
    }
    label.scale.set(Math.min(1, (width - (video ? 60 : 18)) / label.width));
    label.y = -2;
    made.y = y;
    return made;
}

/** A red dot with a number. */
export function dot(x: number, y: number, count: number): PIXI.Container {
    const made = new PIXI.Container();
    const back = new PIXI.Graphics().lineStyle(3, 0x17120e).beginFill(0xff3d3d).drawCircle(0, 0, 15).endFill();
    const label = text(String(count), 19, 0xffffff, 0x7a1010, 3);
    made.addChild(back, label);
    made.position.set(x, y);
    return made;
}

/** A tool's icon with its metal in its colour (`dark`: only its shape). */
export function toolArt(tool: { base: string; tint?: string }, size: number, dark = false): PIXI.Container {
    const art = new PIXI.Container();
    const base = sprite(`Wall_${tool.base}`, size);
    art.addChild(base);
    if (dark) base.tint = 0x11121a;
    else if (tool.tint) {
        const metal = sprite(`Wall_${tool.base}_metal`, size);
        metal.scale.copyFrom(base.scale);
        metal.tint = PIXI.utils.string2hex(tool.tint);
        art.addChild(metal);
    }
    return art;
}
