// VersusHome.ts
//
// What the main screen's VERSUS tab adds, as Mob's arena screen: under the arena's ribbon, the player's strip (avatar,
// name, tier, its badge, trophies) and the bar to the next arena (a segment a road step on the way, the arena's crown at
// its end: a tap opens the road); and the trophy road's floating button (its badge bouncing, a red mark while a step
// waits to be claimed).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UfoProgress } from '../data/UfoProgress';
import { ARENAS, ROAD, roadWaiting, tierOf } from '../data/Versus';
import { SegmentBar } from './SegmentBar';
import { framePlane, iconSprite, killTweensDeep, label, makeAvatar, tappable } from './UiParts';

export const STRIP = { width: 600, height: 74, back: 0x1b1e3a, box: 150 };
export const ROAD_BAR = { width: 600, height: 76, bar: 16, crownRoom: 26, gap: 14 };
/** The road's floating button: its size, its bounce, the rays round it. */
const ROAD_BUTTON = { size: 104, bounce: 10, bounceSeconds: 0.6, rays: 200, label: 22, labelY: 66, alert: 40, alertX: 40, alertY: -40 };

export class VersusHome extends PIXI.Container {
    /** The strip and the bar under it (placed under the ribbon). */
    public readonly top = new PIXI.Container();
    /** The road's button (placed on its own). */
    public readonly roadButton = new PIXI.Container();
    private readonly strip = new PIXI.Container();
    private readonly road = new PIXI.Container();
    private progress: SegmentBar | null = null;
    private time = 0;

    public constructor(private readonly openRoad: () => void) {
        super();
        this.top.addChild(this.strip, this.road);
        this.road.y = STRIP.height / 2 + ROAD_BAR.gap + ROAD_BAR.height / 2;
        tappable(this.road, () => this.openRoad());
        this.addChild(this.top, this.roadButton);
        this.refresh();
    }

    /** How far down the strip and the bar reach, from the strip's middle. */
    public get topHeight(): number {
        return STRIP.height / 2 + ROAD_BAR.gap + ROAD_BAR.height;
    }

    public refresh(): void {
        this.buildStrip();
        this.buildRoad();
        this.buildRoadButton();
    }

    private buildStrip(): void {
        killTweensDeep(this.strip);
        this.strip.removeChildren().forEach((child) => child.destroy({ children: true }));
        const { width, height } = STRIP;
        const back = framePlane('BasicFrame_Round20', width, height, 0.7);
        back.tint = STRIP.back;
        back.alpha = 0.85;
        back.position.set(-width / 2, -height / 2);
        const avatar = makeAvatar({ name: UfoProgress.username, ...UfoProgress.avatarLook }, 60);
        avatar.x = -width / 2 + 44;
        const name = label(28);
        name.anchor.set(0, 0.5);
        name.text = UfoProgress.username;
        name.position.set(-width / 2 + 86, -12);
        name.scale.set(Math.min(1, 230 / Math.max(1, name.width)));
        const tier = tierOf(UfoProgress.trophies);
        const tierName = label(18, 0x9fd8ff);
        tierName.anchor.set(0, 0.5);
        tierName.text = tier.name.toUpperCase();
        tierName.position.set(-width / 2 + 86, 18);
        const badge = iconSprite(tier.badge, 64);
        badge.x = width / 2 - 12 - STRIP.box - 48;
        const cupBack = framePlane('ResourceBar_Single_Bg', STRIP.box, 50, 0.8);
        cupBack.tint = 0x0a0c22;
        cupBack.position.set(width / 2 - 12 - STRIP.box, -25);
        const cup = iconSprite('ItemIcon_Trophy_Gold', 44);
        cup.x = cupBack.x + 30;
        const trophies = label(30, 0xffe066);
        trophies.anchor.set(0, 0.5);
        trophies.text = `${UfoProgress.trophies}`;
        trophies.position.set(cupBack.x + 58, -1);
        this.strip.addChild(back, avatar, name, tierName, badge, cupBack, cup, trophies);
    }

    /** The bar to the next arena: a segment a road step on the way, the crown over the arena itself (green up to the
     *  player's trophies, the next gold); its name and the trophies over it. A tap opens the road. */
    private buildRoad(): void {
        killTweensDeep(this.road);
        this.road.removeChildren().forEach((child) => child.destroy({ children: true }));
        this.progress = null;
        const { width, height } = ROAD_BAR;
        const trophies = UfoProgress.trophies;
        const best = UfoProgress.bestTrophies;
        const next = ARENAS.find((arena) => arena.trophies > best) ?? null;
        const from = Math.max(0, ...ARENAS.map((arena) => arena.trophies).filter((t) => t <= best));
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
        name.position.set(left, -height / 2 + 20);
        const count = label(20, 0xffe066);
        count.anchor.set(1, 0.5);
        count.position.set(left + room, -height / 2 + 20);
        const bar = new SegmentBar({ width: room - 8, height: ROAD_BAR.bar, gap: 4, pad: 4, boss: next ? 26 : 0 });
        bar.position.set(left + room / 2, height / 2 - 22);
        if (next) {
            const steps = ROAD.filter((step) => step.trophies > from && step.trophies < next.trophies);
            const done = steps.filter((step) => step.trophies <= trophies).length;
            const total = steps.length + 1;
            bar.set(total, done);
            const each = (room - 8 - 4 * (total - 1)) / total;
            count.x = left + room - 4 - each / 2 - ROAD_BAR.crownRoom;
            name.text = `NEXT: ${next.name.toUpperCase()}`;
            count.text = `${trophies} / ${next.trophies}`;
            this.progress = bar;
        } else {
            bar.set(1, 1);
            name.text = 'EVERY ARENA OPEN';
            count.text = `${trophies}`;
        }
        this.road.addChild(back, cup, name, count, bar);
        this.road.hitArea = new PIXI.Rectangle(-width / 2, -height / 2, width, height);
    }

    /** The road's button: its gold badge on rays, ROAD under it, a red mark while a step waits. */
    private buildRoadButton(): void {
        killTweensDeep(this.roadButton);
        this.roadButton.removeChildren().forEach((child) => child.destroy({ children: true }));
        const rays = iconSprite('Image_Effect_Rotate', ROAD_BUTTON.rays);
        rays.tint = 0xffd23f;
        rays.alpha = 0.6;
        rays.blendMode = PIXI.BLEND_MODES.ADD;
        const badge = iconSprite('ItemIcon_Badge_Gold', ROAD_BUTTON.size);
        const words = label(ROAD_BUTTON.label);
        words.text = 'ROAD';
        words.y = ROAD_BUTTON.labelY;
        this.roadButton.addChild(rays, badge, words);
        if (roadWaiting().length) {
            const alert = new PIXI.Container();
            const circle = iconSprite('Alert_Circle_l_Bg', ROAD_BUTTON.alert);
            circle.tint = 0xff3b4e;
            alert.addChild(circle, iconSprite('Alert_Circle_Icon_Exclamation', ROAD_BUTTON.alert * 0.55));
            alert.position.set(ROAD_BUTTON.alertX, ROAD_BUTTON.alertY);
            this.roadButton.addChild(alert);
            gsap.to(alert.scale, { x: 1.15, y: 1.15, duration: 0.45, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        }
        this.roadButton.hitArea = new PIXI.Circle(0, 0, ROAD_BUTTON.size * 0.75);
        tappable(this.roadButton, () => this.openRoad());
        gsap.to(rays, { rotation: Math.PI * 2, duration: 9, ease: 'none', repeat: -1 });
        gsap.to(badge, { y: -ROAD_BUTTON.bounce, duration: ROAD_BUTTON.bounceSeconds, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }

    public update(dt: number): void {
        this.time += dt;
        this.progress?.pulse(0.5 + 0.5 * Math.sin(this.time * 5));
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        killTweensDeep(this);
        super.destroy(options);
    }
}
