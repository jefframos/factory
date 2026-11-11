// ArenaHome.ts
//
// What the main screen adds in ARENA mode (Clash Royale's main menu): under the ribbon, the player's strip (avatar,
// name, tier, trophies: a tap opens their profile) and the bar to the next arena (a segment a road step on the way, the
// arena's crown at its end; a red badge while a road step waits to be claimed: a tap opens the road); over PLAY, the free chest —
// its time left till it's ready, then FREE CHEST! and WATCH (a video opens it), bouncing.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Ladder, tierBadge, tierFor } from '../data/ArenaLadder';
import { REWARDS, ROAD, clockText } from '../data/ArenaRewards';
import { ARENA_ORDER } from '../data/Arenas';
import { SegmentBar } from './SegmentBar';
import { MobSave } from '../data/MobSave';
import { AVATARS } from '../data/Profile';
import ladderFile from '../../ui/arena-ladder.json';
import { framePlane, glossyButton, iconSprite, killTweensDeep, label, makeAvatar, tappable } from './UiParts';

const LADDER = ladderFile as Ladder;
/** The player's strip: its size and colour, the trophies' box's width. */
export const STRIP = { width: 600, height: 74, back: 0x1b1e3a, box: 150 };
export const ROAD_BAR = { width: 600, height: 76, bar: 16, crownRoom: 26 };
/** The free chest's plate over PLAY. */
export const SLOTS = { width: 360, height: 120, back: 0x1b1e3a, ready: 0x2fd35c, waiting: 0x3a2a6a };
/** The trophy road's button, right of the free chest: its size, the gap between them. */
export const ROAD_BUTTON = { size: 120, gap: 16 };
/** The free chest and the road's button together: how wide. */
export const SLOTS_WIDTH = SLOTS.width + ROAD_BUTTON.gap + ROAD_BUTTON.size;

export interface ArenaHomeActions {
    profile(): void;
    road(): void;
    /** The free chest tapped while it's ready (its video, then it opens). */
    adChest(): void;
}

export class ArenaHome extends PIXI.Container {
    public readonly top = new PIXI.Container();
    public readonly slots = new PIXI.Container();
    private readonly strip = new PIXI.Container();
    private readonly road = new PIXI.Container();
    private lastSecond = -1;
    private time = 0;
    /** The bar to the next arena (its next segment pulses). */
    private progress: SegmentBar | null = null;

    public constructor(private readonly actions: ArenaHomeActions) {
        super();
        this.top.addChild(this.strip, this.road);
        this.road.y = STRIP.height / 2 + 14 + ROAD_BAR.height / 2;
        tappable(this.strip, () => this.actions.profile());
        tappable(this.road, () => this.actions.road());
        this.addChild(this.top, this.slots);
        this.refresh();
    }

    /** Everything, as the save has it now. */
    public refresh(): void {
        this.buildStrip();
        this.buildRoad();
        this.buildSlots();
    }

    private buildStrip(): void {
        killTweensDeep(this.strip);
        this.strip.removeChildren().forEach((child) => child.destroy({ children: true }));
        const { width, height } = STRIP;
        const back = framePlane('BasicFrame_Round20', width, height, 0.7);
        back.tint = STRIP.back;
        back.alpha = 0.85;
        back.position.set(-width / 2, -height / 2);
        const look = AVATARS[MobSave.avatar % AVATARS.length];
        const avatar = makeAvatar(look, 60);
        avatar.x = -width / 2 + 44;
        const name = label(28);
        name.anchor.set(0, 0.5);
        name.text = MobSave.username;
        name.position.set(-width / 2 + 86, -12);
        const tier = label(18, 0xc9a2ff);
        tier.anchor.set(0, 0.5);
        tier.text = LADDER.tiers[tierFor(LADDER, MobSave.arena)].name.toUpperCase();
        tier.position.set(-width / 2 + 86, 18);
        // The player's grade badge, before their trophies.
        const badge = iconSprite(tierBadge(LADDER, tierFor(LADDER, MobSave.arena)), 64);
        badge.x = width / 2 - 12 - STRIP.box - 48;
        const cupBack = framePlane('ResourceBar_Single_Bg', STRIP.box, 50, 0.8);
        cupBack.tint = 0x0a0c22;
        cupBack.position.set(width / 2 - 12 - STRIP.box, -25);
        const cup = iconSprite('ItemIcon_Trophy_Gold', 44);
        cup.x = cupBack.x + 30;
        const trophies = label(30, 0xffe066);
        trophies.anchor.set(0, 0.5);
        trophies.text = `${MobSave.arena.rating}`;
        trophies.position.set(cupBack.x + 58, -1);
        this.strip.addChild(back, avatar, name, tier, badge, cupBack, cup, trophies);
        this.strip.hitArea = new PIXI.Rectangle(-width / 2, -height / 2, width, height);
    }

    /** The bar to the next arena (as the areas' bar: a segment a road step on the way, the crown over the arena itself:
     *  green up to the player's trophies, the next gold), its name and the trophies over it; a tap opens the road. */
    private buildRoad(): void {
        killTweensDeep(this.road);
        this.road.removeChildren().forEach((child) => child.destroy({ children: true }));
        this.progress = null;
        const { width, height } = ROAD_BAR;
        const rating = MobSave.arena.rating;
        const best = MobSave.bestTrophies;
        const next = ARENA_ORDER.find(({ arena }) => (arena.trophies ?? 0) > best) ?? null;
        const from = Math.max(0, ...ARENA_ORDER.map(({ arena }) => arena.trophies ?? 0).filter((t) => t <= best));
        const back = framePlane('BasicFrame_Round20', width, height, 0.6);
        back.tint = STRIP.back;
        back.alpha = 0.85;
        back.position.set(-width / 2, -height / 2);
        const cup = iconSprite('ItemIcon_Trophy_Gold', 52);
        cup.x = -width / 2 + 36;
        const left = -width / 2 + 72;
        const room = width - 72 - 24;
        const name = label(20);
        name.anchor.set(0, 0.5);
        const count = label(20, 0xffe066);
        count.anchor.set(1, 0.5);
        name.position.set(left, -height / 2 + 20);
        count.position.set(left + room, -height / 2 + 20);
        const bar = new SegmentBar({ width: room - 8, height: ROAD_BAR.bar, gap: 4, pad: 4, boss: next ? 26 : 0 });
        bar.position.set(left + room / 2, height / 2 - 22);
        if (next) {
            const target = next.arena.trophies ?? 0;
            const steps = ROAD.filter((step) => step.trophies > from && step.trophies < target);
            const done = steps.filter((step) => step.trophies <= rating).length;
            bar.set(steps.length + 1, done);
            // The count's right end clear of the arena's crown (over the last segment's middle).
            const total = steps.length + 1;
            const each = (room - 8 - 4 * (total - 1)) / total;
            count.x = left + room - 4 - each / 2 - ROAD_BAR.crownRoom;
            name.text = `NEXT: ${(next.arena.name ?? 'ARENA').toUpperCase()}`;
            count.text = `${rating} / ${target}`;
            this.progress = bar;
        } else {
            bar.set(1, 1);
            name.text = 'EVERY ARENA OPEN';
            count.text = `${rating}`;
        }
        this.road.addChild(back, cup, name, count, bar);
        this.road.hitArea = new PIXI.Rectangle(-width / 2, -height / 2, width, height);
    }

    private buildSlots(): void {
        killTweensDeep(this.slots);
        this.slots.removeChildren().forEach((child) => child.destroy({ children: true }));
        const now = Date.now();
        const ready = MobSave.adChestAt <= now;
        const { width, height } = SLOTS;
        const plate = new PIXI.Container();
        const back = framePlane('BorderFrame_Round24', width, height, 0.6);
        back.tint = ready ? SLOTS.ready : SLOTS.waiting;
        back.position.set(-width / 2, -height / 2);
        const chest = iconSprite(REWARDS.chests[REWARDS.adChest.kind].icon, height * 0.95);
        chest.x = -width / 2 + 70;
        const title = label(26, ready ? 0xffffff : 0xffe066);
        title.anchor.set(0, 0.5);
        title.text = ready ? 'FREE CHEST!' : 'FREE CHEST IN';
        title.position.set(-width / 2 + 136, -22);
        plate.addChild(back, chest, title);
        if (ready) {
            const video = iconSprite('ItemIcon_Video', 46);
            video.position.set(-width / 2 + 160, 22);
            const watch = label(26);
            watch.anchor.set(0, 0.5);
            watch.text = 'WATCH';
            watch.position.set(-width / 2 + 190, 22);
            plate.addChild(video, watch);
            gsap.to(chest.scale, { x: chest.scale.x * 1.1, y: chest.scale.y * 0.92, duration: 0.35, yoyo: true, repeat: -1, ease: 'sine.inOut' });
            gsap.to(plate.scale, { x: 1.04, y: 1.04, duration: 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
            plate.hitArea = new PIXI.Rectangle(-width / 2, -height / 2, width, height);
            tappable(plate, () => this.actions.adChest());
        } else {
            const time = label(34);
            time.anchor.set(0, 0.5);
            time.text = clockText(MobSave.adChestAt - now);
            time.position.set(-width / 2 + 136, 22);
            plate.addChild(time);
            plate.alpha = 0.85;
        }
        plate.x = -ROAD_BUTTON.size / 2 - ROAD_BUTTON.gap / 2;
        this.slots.addChild(plate, this.roadButton());
    }

    /** The trophy road's button (the gold badge, ROAD under it), a red badge on it while a step waits to be claimed. */
    private roadButton(): PIXI.Container {
        const { size } = ROAD_BUTTON;
        const button = glossyButton(size, size, '', 'Button01_l_Sky');
        const emblem = iconSprite('ItemIcon_Badge_Gold', size * 0.72);
        emblem.y = -12;
        const words = label(20);
        words.text = 'ROAD';
        words.y = size / 2 - 24;
        button.addChild(emblem, words);
        if (MobSave.roadWaiting.length) {
            const circle = iconSprite('Alert_Circle_l_Bg', 40);
            circle.tint = 0xff3b4e;
            const mark = iconSprite('Alert_Circle_Icon_Exclamation', 22);
            const badge = new PIXI.Container();
            badge.addChild(circle, mark);
            badge.position.set(size / 2 - 8, -size / 2 + 8);
            button.addChild(badge);
            gsap.to(badge.scale, { x: 1.15, y: 1.15, duration: 0.45, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        }
        button.x = SLOTS.width / 2 + ROAD_BUTTON.gap / 2;
        tappable(button, () => this.actions.road());
        return button;
    }

    /** The free chest's clock, once a second (till it's ready: its bounce isn't restarted every second). */
    public update(dt: number): void {
        this.time += dt;
        this.progress?.pulse(0.5 + 0.5 * Math.sin(this.time * 5));
        const second = Math.floor(Date.now() / 1000);
        if (second === this.lastSecond) return;
        this.lastSecond = second;
        if (MobSave.adChestAt > Date.now() - 1500) this.buildSlots();
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        killTweensDeep(this);
        super.destroy(options);
    }
}
