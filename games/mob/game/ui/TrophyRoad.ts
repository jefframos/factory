// TrophyRoad.ts
//
// The trophy road (Clash Royale's): a list going up, a row each — a reward step (ArenaRewards ROAD: what it gives, on
// a plate: yellow with CLAIM once reached and not claimed, green with a check once claimed, dark above) or an arena (its
// own purple banner, where it opens). Each arena's stretch is a section of its own colour (its map's: beach light blue,
// desert sand, castle green, ice pale blue: ARENA_COLOURS), the moving pattern in it. Down the left, the trophies on a
// scale, a tick and number at each row (a padlock on the number till it's reached), filled up to the player's trophies
// with their marker there. It opens scrolled to the player. Drag or the wheel scrolls it.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { REWARDS, ROAD, Reward, RoadStep } from '../data/ArenaRewards';
import { ARENA_ORDER } from '../data/Arenas';
import { ArenaConfig } from '../data/ArenaConfig';
import { MobSave } from '../data/MobSave';
import { framePlane, glossyButton, iconSprite, killTweensDeep, label, makeAvatar, tappable } from './UiParts';
import { AVATARS } from '../data/Profile';
import { CARD_NAMES, cardFace } from './CardFace';
import { Ladder, tierBadge, tierFor } from '../data/ArenaLadder';
import ladderFile from '../../ui/arena-ladder.json';

const LADDER = ladderFile as Ladder;
import { ARENA_COLOURS, Pattern } from './Pattern';

const SIZE = { width: 660, height: 1000 };
/** The list's room (under the title, over CLOSE). */
const VIEW = { top: 96, bottom: 214, inset: 12 };
/** The player's tag on the scale, and their panel at the bottom (over CLOSE). */
const MARKER = { width: 118, height: 52 };
const MINE = { width: 520, height: 96, y: 150 };
/** The rows: a step's and an arena's height, the plates' left and width; the scale's x, its bar's width, colours. */
const ROWS = { step: 150, arena: 120, gap: 16, plateX: -168, plateWidth: 460, plateHeight: 124, scaleX: -228, bar: 14, track: 0x0a1a3a, fill: 0x3d8cff, pad: 50 };
const PLATE = { claimed: 0x58d27a, ready: 0xffffff, locked: 0x6070a0 };
const DRAG = { tap: 10, wheel: 0.8 };

/** A row: a step, or an arena; its trophies, and where its middle is (content y). */
type Row = { trophies: number; y: number } & ({ kind: 'step'; step: RoadStep } | { kind: 'arena'; arena: ArenaConfig; number: number });

export class TrophyRoad extends PIXI.Container {
    private readonly dim = new PIXI.Graphics();
    private readonly frame = new PIXI.Container();
    private readonly content = new PIXI.Container();
    private readonly view = new PIXI.Graphics();
    private scroll = 0;
    private maxScroll = 0;
    private drag: { y: number; scroll: number; moved: boolean } | null = null;
    private rows: Row[] = [];
    /** Each arena's section's pattern (moved every frame). */
    private sections: Pattern[] = [];
    private tall = 0;
    private closed = false;

    /** `onClaim`: a step's CLAIM (it's claimed by then: its chest to open, or the currencies changed). */
    public constructor(private readonly onClaim: (step: RoadStep) => void, private readonly onClose: () => void) {
        super();
        this.dim.eventMode = 'static';
        this.frame.eventMode = 'static';
        const back = framePlane('BorderFrame_Round24', SIZE.width, SIZE.height, 1);
        back.tint = 0x12305e;
        back.position.set(-SIZE.width / 2, -SIZE.height / 2);
        const title = label(40);
        title.text = 'TROPHY ROAD';
        title.y = -SIZE.height / 2 + 50;
        // The road's badge beside its name.
        const emblem = iconSprite('ItemIcon_Badge_Gold', 76);
        emblem.position.set(-title.width / 2 - 50, title.y);
        const close = glossyButton(220, 76, 'CLOSE', 'Button01_l_Sky');
        close.y = SIZE.height / 2 - 52;
        tappable(close, () => this.close());
        // The corner close, as the other windows' (the Mow game's popups').
        const corner = new PIXI.Container();
        corner.addChild(iconSprite('Button_Round06_Red', 64), iconSprite('Icon_Close02', 32));
        corner.position.set(SIZE.width / 2 - 8, -SIZE.height / 2 + 8);
        tappable(corner, () => this.close());
        this.view.beginFill(0xffffff).drawRect(-SIZE.width / 2 + VIEW.inset, -SIZE.height / 2 + VIEW.top, SIZE.width - VIEW.inset * 2, this.room).endFill();
        this.content.mask = this.view;
        this.frame.addChild(back, this.view, this.content, title, emblem, this.mine(), close, corner);
        this.addChild(this.dim, this.frame);
        this.frame.on('pointerdown', (event: PIXI.FederatedPointerEvent) => {
            this.drag = { y: event.global.y, scroll: this.scroll, moved: false };
        });
        this.frame.on('globalpointermove', (event: PIXI.FederatedPointerEvent) => {
            if (!this.drag) return;
            const dy = (event.global.y - this.drag.y) / this.frame.scale.y;
            if (Math.abs(dy) > DRAG.tap) this.drag.moved = true;
            if (this.drag.moved) this.scrollTo(this.drag.scroll - dy);
        });
        this.frame.on('pointerup', () => { this.drag = null; });
        this.frame.on('pointerupoutside', () => { this.drag = null; });
        window.addEventListener('wheel', this.onWheel, { passive: true });
        this.refresh();
        // Scrolled to the player: their marker in the middle.
        this.scrollTo(this.yFor(MobSave.arena.rating) - this.room / 2);
    }

    /** The player's panel at the bottom: their avatar, YOUR TROPHIES and how many, their grade badge. */
    private mine(): PIXI.Container {
        const panel = new PIXI.Container();
        const record = MobSave.arena;
        const back = framePlane('ListFrame04_Single_f_Yellow', MINE.width, MINE.height, 0.8);
        back.position.set(-MINE.width / 2, -MINE.height / 2);
        const avatar = makeAvatar(AVATARS[MobSave.avatar % AVATARS.length], 70);
        avatar.x = -MINE.width / 2 + 56;
        const words = label(20, 0xffffff);
        words.anchor.set(0, 0.5);
        words.text = 'YOUR TROPHIES';
        words.position.set(-MINE.width / 2 + 104, -18);
        const cup = iconSprite('ItemIcon_Trophy_Gold', 44);
        cup.position.set(-MINE.width / 2 + 126, 16);
        const count = label(34, 0xffe066);
        count.anchor.set(0, 0.5);
        count.text = `${record.rating}`;
        count.position.set(-MINE.width / 2 + 154, 14);
        const tier = tierFor(LADDER, record);
        const badge = iconSprite(tierBadge(LADDER, tier), 78);
        badge.x = MINE.width / 2 - 56;
        const tierName = label(18, 0xffffff);
        tierName.anchor.set(1, 0.5);
        tierName.text = LADDER.tiers[tier].name.toUpperCase();
        tierName.position.set(MINE.width / 2 - 104, 16);
        panel.addChild(back, avatar, words, cup, count, tierName, badge);
        panel.y = SIZE.height / 2 - MINE.y;
        return panel;
    }

    private get room(): number {
        return SIZE.height - VIEW.top - VIEW.bottom;
    }

    private readonly onWheel = (event: WheelEvent): void => this.scrollTo(this.scroll + event.deltaY * DRAG.wheel);

    /** The rows, top (most trophies) down, each placed. */
    private layoutRows(): void {
        const rows: Row[] = [
            ...ROAD.map((step) => ({ kind: 'step' as const, step, trophies: step.trophies, y: 0 })),
            ...ARENA_ORDER.map(({ arena }, index) => ({ kind: 'arena' as const, arena, number: index + 1, trophies: arena.trophies ?? 0, y: 0 })),
        ];
        // Most trophies first; at the same count the arena over the step.
        rows.sort((a, b) => b.trophies - a.trophies || (a.kind === 'arena' ? -1 : 1));
        let y = ROWS.pad;
        for (const row of rows) {
            const height = row.kind === 'arena' ? ROWS.arena : ROWS.step;
            row.y = y + height / 2;
            y += height + ROWS.gap;
        }
        this.rows = rows;
        this.tall = y + ROWS.pad;
    }

    /** Where trophies `t` are on the scale: between the rows either side of it (0: the bottom). */
    private yFor(trophies: number): number {
        const below = this.rows.find((row) => row.trophies <= trophies);
        const above = [...this.rows].reverse().find((row) => row.trophies > trophies);
        const lowY = below ? below.y : this.tall - ROWS.pad / 2;
        const lowT = below ? below.trophies : 0;
        if (!above) return lowY;
        const t = (trophies - lowT) / Math.max(1, above.trophies - lowT);
        return lowY + (above.y - lowY) * Math.max(0, Math.min(1, t));
    }

    public refresh(): void {
        killTweensDeep(this.content);
        this.content.removeChildren().forEach((child) => child.destroy({ children: true }));
        this.layoutRows();
        const rating = MobSave.arena.rating;
        const best = MobSave.bestTrophies;
        // The scale: the dark track the whole way, blue up to the player.
        const meY = this.yFor(rating);
        this.buildSections();
        const track = new PIXI.Graphics().beginFill(ROWS.track).drawRoundedRect(ROWS.scaleX - ROWS.bar / 2, 0, ROWS.bar, this.tall, ROWS.bar / 2).endFill();
        const fill = new PIXI.Graphics().beginFill(ROWS.fill).drawRoundedRect(ROWS.scaleX - ROWS.bar / 2, meY, ROWS.bar, this.tall - meY, ROWS.bar / 2).endFill();
        this.content.addChild(track, fill);
        for (const row of this.rows) {
            const reached = row.trophies <= best;
            // Its mark on the scale: a trophy once reached, a padlock till then.
            if (reached) {
                const cup = iconSprite('ItemIcon_Trophy_Gold', 40);
                cup.position.set(ROWS.scaleX, row.y);
                this.content.addChild(cup);
            } else {
                const lock = iconSprite('Icon_Lock03', 34);
                lock.position.set(ROWS.scaleX, row.y);
                this.content.addChild(lock);
            }
            if (row.kind === 'arena') this.arenaRow(row, reached);
            else this.stepRow(row, reached);
        }
        // The player on the scale: their avatar on a gold tag (the pack's frame: crisp), their trophies on it.
        const marker = new PIXI.Container();
        const markBack = framePlane('BasicFrame_Round20', MARKER.width, MARKER.height, 0.5);
        markBack.tint = 0xffd23f;
        markBack.position.set(0, -MARKER.height / 2);
        const avatar = makeAvatar(AVATARS[MobSave.avatar % AVATARS.length], MARKER.height - 6);
        avatar.x = 0;
        const count = label(26, 0x10123a, 0xffffff);
        count.anchor.set(0, 0.5);
        count.text = `${rating}`;
        count.x = MARKER.height / 2 + 6;
        marker.addChild(markBack, avatar, count);
        marker.position.set(ROWS.scaleX, meY);
        this.content.addChild(marker);
        this.maxScroll = Math.max(0, this.tall - this.room);
        this.scrollTo(this.scroll);
    }

    /** A step's row: its trophies on the scale, its plate (by state), its reward and what's done about it. */
    private stepRow(row: Row & { kind: 'step' }, reached: boolean): void {
        const { step } = row;
        const claimed = MobSave.roadClaimed(step.trophies);
        const number = label(22, reached ? 0xffe066 : 0xffffff);
        number.anchor.set(1, 0.5);
        number.text = `${step.trophies}`;
        number.position.set(ROWS.scaleX - 22, row.y);
        const plate = framePlane(claimed || !reached ? 'ListFrame04_Single_f_Blue' : 'ListFrame04_Single_f_Yellow', ROWS.plateWidth, ROWS.plateHeight, 0.8);
        plate.position.set(ROWS.plateX, row.y - ROWS.plateHeight / 2);
        plate.tint = claimed ? PLATE.claimed : reached ? PLATE.ready : PLATE.locked;
        const picture = rewardPicture(step.reward, 92);
        picture.position.set(ROWS.plateX + 74, row.y);
        if (!reached) picture.alpha = 0.6;
        const what = label(26);
        what.anchor.set(0, 0.5);
        what.text = rewardName(step.reward);
        what.position.set(ROWS.plateX + 136, row.y);
        this.content.addChild(number, plate, picture, what);
        const right = ROWS.plateX + ROWS.plateWidth - 20;
        if (claimed) {
            const check = iconSprite('Icon_Check03_l', 54);
            check.position.set(right - 30, row.y);
            this.content.addChild(check);
        } else if (reached) {
            const claim = glossyButton(140, 60, 'CLAIM', 'Button01_l_Green');
            claim.position.set(right - 70, row.y);
            tappable(claim, () => {
                if (this.drag?.moved) return;
                this.onClaim(step);
                // (Not in the button's own tap: it's destroyed by the redraw.)
                gsap.delayedCall(0.01, () => {
                    if (!this.destroyed) this.refresh();
                });
            });
            gsap.to(claim.scale, { x: 1.06, y: 1.06, duration: 0.5, yoyo: true, repeat: -1, ease: 'sine.inOut' });
            this.content.addChild(claim);
        }
    }

    /** An arena's row: the purple banner across, its name and number (a padlock till it's reached). */
    private arenaRow(row: Row & { kind: 'arena' }, reached: boolean): void {
        const number = label(22, reached ? 0xffe066 : 0xffffff);
        number.anchor.set(1, 0.5);
        number.text = `${row.trophies}`;
        number.position.set(ROWS.scaleX - 22, row.y);
        const width = ROWS.plateWidth + 20;
        const banner = framePlane('Title_Ribbon04_Purple', width, 100, 0.6);
        banner.position.set(ROWS.plateX + ROWS.plateWidth / 2 - width / 2, row.y - 50);
        if (!reached) banner.tint = 0x9a90c0;
        const name = label(30);
        name.text = (row.arena.name ?? 'ARENA').toUpperCase();
        // (On the ribbon's band: a little over its middle, the tails hang below.)
        name.position.set(ROWS.plateX + ROWS.plateWidth / 2, row.y - 6);
        this.content.addChild(number, banner, name);
    }

    /** Each arena's stretch of the road (from its row up to the next arena's), in its map's colours. */
    private buildSections(): void {
        this.sections = [];
        const left = -SIZE.width / 2 + VIEW.inset;
        const width = SIZE.width - VIEW.inset * 2;
        const arenas = this.rows.filter((row): row is Row & { kind: 'arena' } => row.kind === 'arena').sort((a, b) => a.trophies - b.trophies);
        arenas.forEach((row, i) => {
            const above = arenas[i + 1];
            // From under its own row up to under the next arena's (the top one: to the road's top).
            const bottom = i === 0 ? this.tall : row.y + ROWS.arena / 2 + ROWS.gap / 2;
            const top = above ? above.y + ROWS.arena / 2 + ROWS.gap / 2 : 0;
            const colours = ARENA_COLOURS[row.arena.theme ?? 'beach'] ?? ARENA_COLOURS.beach;
            const pattern = new Pattern({ ...colours, strength: 0.12, glows: 1, tile: 90 });
            pattern.eventMode = 'none';
            pattern.place(left, top, width, bottom - top);
            const mask = new PIXI.Graphics().beginFill(0xffffff).drawRect(left, top, width, bottom - top).endFill();
            pattern.mask = mask;
            // A soft dark line where one arena's stretch meets the next.
            const seam = new PIXI.Graphics().beginFill(0x0a1a3a, 0.35).drawRect(left, top, width, 4).endFill();
            this.content.addChild(pattern, mask, seam);
            this.sections.push(pattern);
        });
    }

    private scrollTo(value: number): void {
        this.scroll = Math.max(0, Math.min(this.maxScroll, value));
        this.content.y = -SIZE.height / 2 + VIEW.top - this.scroll;
    }

    public layout(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const { topLeft, center, width, height } = screen;
        this.dim.clear().beginFill(0x0b1030, 0.8).drawRect(topLeft.x, topLeft.y, width, height).endFill();
        this.frame.position.copyFrom(center);
        this.frame.scale.set(Math.min(1, (width - 20) / SIZE.width, (height - 20) / SIZE.height));
    }

    public show(): void {
        this.layout();
    }

    public update(dt: number): void {
        this.sections.forEach((pattern) => pattern.update(dt));
    }

    public close(): void {
        if (this.closed) return;
        this.closed = true;
        this.onClose();
        this.destroy({ children: true });
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        window.removeEventListener('wheel', this.onWheel);
        killTweensDeep(this);
        super.destroy(options);
    }
}

/** A reward's words. */
export function rewardName(reward: Reward): string {
    if (reward.card) return `${CARD_NAMES[reward.card]} CARD`;
    if (reward.chest) return REWARDS.chests[reward.chest].name.toUpperCase();
    if (reward.gems) return `${reward.gems} GEMS`;
    if (reward.coins) return `${reward.coins} COINS`;
    if (reward.copies) return `${reward.copies} CARDS`;
    return '';
}

/** A reward's picture, `size` big: its chest, a gem, a coin, or the CARDS tab's cards. */
export function rewardPicture(reward: Reward, size: number): PIXI.Container {
    const holder = new PIXI.Container();
    if (reward.card) holder.addChild(cardFace(reward.card, size * 0.62, size * 0.82, 0, 0.35));
    else if (reward.chest) holder.addChild(iconSprite(REWARDS.chests[reward.chest].icon, size));
    else if (reward.gems) holder.addChild(iconSprite('ItemIcon_Gem_Diamond_Purple', size * 0.85));
    else if (reward.coins) holder.addChild(iconSprite('ItemIcon_Money_Coin', size * 0.8));
    else if (reward.copies) holder.addChild(iconSprite('PictoIcon_Cards', size * 0.85));
    return holder;
}
