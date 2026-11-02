// TownMap.ts
//
// The "fill the whole town" meter: a miniature of the island, drawn from the level (sea, island outline, roads,
// sections — so it follows the editor with nothing extra to author), with each section filling up in bright green
// from the bottom as it's restored (a rippling top edge), the one being worked on outlined in pulsing gold, locked
// ones grey with a lock, restored ones with a check, a dot for the player, and the whole town's % underneath.
// The HUD keeps it top-right and flies it to the centre when a section is done (MowHud.flyMap()); celebrate() is the
// fill / flash / unlock played there. Origin: the panel's centre (so it scales round it in flight).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { TOWN, DistrictDef } from '../data/MowConfig';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { t } from '../i18n/Localization';

/** The miniature's width (its height follows the island's shape), the frame's padding, the label's room under it. */
const MAP_WIDTH = 200;
const PAD = 8;
const LABEL_ROOM = 30;
/** World units of sea round the island's outline. */
const SEA = 3;
const FILL = 0x8fe36a;
const FILL_EDGE = 0xd8ffb0;
/** Locked lawns: their own green, this dark (still lawn, not road, but clearly not open yet). */
const LOCKED_SHADE = 0.45;
const GOLD = 0xffd86b;
const OUTLINE = 0x1d140e;
/** How fast the shown fill eases to the real share (per second), and the race to full when a section is done. */
const EASE_RATE = 5;
const RACE_SEC = 0.45;

const hex = (color: string | undefined, fallback: number): number => (color ? parseInt(color.replace('#', ''), 16) : fallback);
const shade = (color: number, amount: number): number =>
    (Math.round(((color >> 16) & 255) * amount) << 16) | (Math.round(((color >> 8) & 255) * amount) << 8) | Math.round((color & 255) * amount);

/** One section on the map: its rectangle (map pixels), base, fill, outline and badge. */
interface SectionView {
    def: DistrictDef;
    rect: PIXI.Rectangle;
    base: PIXI.Graphics;
    fill: PIXI.Graphics;
    outline: PIXI.Graphics;
    badge: PIXI.Container;
    /** The fill as drawn (eases to `target`). */
    shown: number;
    target: number;
    open: boolean;
    restored: boolean;
    /** Racing to full in celebrate(): the eased fill leaves it alone. */
    racing: boolean;
}

export class TownMap extends PIXI.Container {
    /** The whole panel's size (map, frame and label), for the HUD's layout. */
    public readonly panelWidth: number;
    public readonly panelHeight: number;
    private readonly sections: SectionView[] = [];
    private readonly player = new PIXI.Graphics();
    private readonly label = UiKit.text('hud', 'toast', { text: '' }, { fontSize: 22, strokeThickness: 5 });
    private readonly scaleOf: number;
    private readonly minX: number;
    private readonly minZ: number;
    /** The map's top-left, from the panel's centre. */
    private readonly originX: number;
    private readonly originY: number;
    private current = -1;
    private time = 0;
    /** While celebrate() plays, opening / restoring waits (so the lock pops after the fill, not before). */
    private frozen = false;
    private percentShown = -1;
    private readonly tick = () => this.update(gsap.ticker.deltaRatio() / 60);

    public constructor() {
        super();
        const outline = TOWN.island?.outline;
        const xs = outline?.length ? outline.map((p) => p.x) : [TOWN.ground.x - TOWN.ground.width / 2, TOWN.ground.x + TOWN.ground.width / 2];
        const zs = outline?.length ? outline.map((p) => p.z) : [TOWN.ground.z - TOWN.ground.depth / 2, TOWN.ground.z + TOWN.ground.depth / 2];
        this.minX = Math.min(...xs) - SEA;
        this.minZ = Math.min(...zs) - SEA;
        const spanX = Math.max(...xs) + SEA - this.minX;
        const spanZ = Math.max(...zs) + SEA - this.minZ;
        this.scaleOf = MAP_WIDTH / spanX;
        const mapHeight = spanZ * this.scaleOf;
        this.panelWidth = MAP_WIDTH + PAD * 2;
        this.panelHeight = mapHeight + PAD * 2 + LABEL_ROOM;
        this.originX = -MAP_WIDTH / 2;
        this.originY = -this.panelHeight / 2 + PAD;

        const frame = new PIXI.Graphics()
            .lineStyle(3, 0xffffff, 0.9)
            .beginFill(0x1d2633, 0.85)
            .drawRoundedRect(-this.panelWidth / 2, -this.panelHeight / 2, this.panelWidth, this.panelHeight, 14)
            .endFill();
        const map = new PIXI.Container();
        map.position.set(this.originX, this.originY);
        const sea = new PIXI.Graphics().beginFill(hex(TOWN.island?.water, 0x3aa6e8)).drawRoundedRect(0, 0, MAP_WIDTH, mapHeight, 9).endFill();
        const land = new PIXI.Graphics();
        if (outline?.length) {
            land.lineStyle(2, hex(TOWN.island?.deck?.color, 0xb98352)).beginFill(hex(TOWN.ground.color, 0x8c9a7c));
            land.drawPolygon(outline.flatMap((p) => [this.mapX(p.x), this.mapY(p.z)])).endFill();
        } else {
            land.beginFill(hex(TOWN.ground.color, 0x8c9a7c)).drawRect(...this.rectOf(TOWN.ground)).endFill();
        }
        const roads = new PIXI.Graphics();
        TOWN.pavements.forEach((p) => roads.beginFill(hex(p.color, 0x4a4f57)).drawRect(...this.rectOf(p)).endFill());
        map.addChild(sea, land, roads);

        TOWN.sections.forEach((def) => {
            const [x, y, w, h] = this.rectOf(def);
            const view: SectionView = {
                def,
                rect: new PIXI.Rectangle(x, y, w, h),
                base: new PIXI.Graphics(),
                fill: new PIXI.Graphics(),
                outline: new PIXI.Graphics(),
                badge: new PIXI.Container(),
                shown: 0,
                target: 0,
                open: false,
                restored: false,
                racing: false,
            };
            view.badge.position.set(x + w / 2, y + h / 2);
            map.addChild(view.base, view.fill, view.outline, view.badge);
            this.sections.push(view);
            this.drawBase(view);
            this.setBadge(view);
        });

        this.player.lineStyle(2, OUTLINE).beginFill(0xffffff).drawCircle(0, 0, 4.5).endFill();
        this.player.visible = false;
        map.addChild(this.player);
        this.label.anchor.set(0.5);
        this.label.position.set(0, this.panelHeight / 2 - LABEL_ROOM / 2 - 2);
        this.addChild(frame, map, this.label);
        gsap.ticker.add(this.tick);
    }

    private mapX(x: number): number {
        return (x - this.minX) * this.scaleOf;
    }

    private mapY(z: number): number {
        return (z - this.minZ) * this.scaleOf;
    }

    /** A centred box (x, z, width, depth) as a map rectangle. */
    private rectOf(box: { x: number; z: number; width: number; depth: number }): [number, number, number, number] {
        return [this.mapX(box.x - box.width / 2), this.mapY(box.z - box.depth / 2), box.width * this.scaleOf, box.depth * this.scaleOf];
    }

    /**
     * Every section's restored share (0..1; 1 once restored), whether it's open, whether it's restored, and the one
     * being worked on (-1: none). Called every frame; the fill eases to it.
     */
    public setState(shares: readonly number[], open: readonly boolean[], restored: readonly boolean[], current: number): void {
        this.current = current;
        this.sections.forEach((view, i) => {
            view.target = Math.max(0, Math.min(1, shares[i] ?? 0));
            if (this.frozen) return;
            const nowOpen = !!open[i];
            const nowRestored = !!restored[i];
            if (nowOpen === view.open && nowRestored === view.restored) return;
            const unlocked = nowOpen && !view.open;
            view.open = nowOpen;
            view.restored = nowRestored;
            // A fresh game / reload shows things as they are; only a change seen live is animated.
            if (unlocked && this.percentShown >= 0) this.popLock(view);
            this.drawBase(view);
            this.setBadge(view);
        });
    }

    /** The player's dot (world x / z). */
    public setPlayer(x: number, z: number): void {
        this.player.visible = true;
        this.player.position.set(this.mapX(x), this.mapY(z));
    }

    /**
     * A section restored, played while the HUD holds the map up in the centre: after `delay`, its fill races to the
     * top, it flashes and gets its check, then the next section's lock pops (states held back meanwhile).
     */
    public celebrate(index: number, delay: number): void {
        const view = this.sections[index];
        if (!view) return;
        this.frozen = true;
        view.racing = true;
        gsap.to(view, {
            shown: 1,
            duration: RACE_SEC,
            delay,
            ease: 'power2.in',
            onComplete: () => {
                view.racing = false;
                if (this.destroyed) return;
                const flash = new PIXI.Graphics().beginFill(0xffffff).drawRect(view.rect.x, view.rect.y, view.rect.width, view.rect.height).endFill();
                view.fill.parent.addChild(flash);
                gsap.to(flash, { alpha: 0, duration: 0.35, onComplete: () => flash.destroy() });
                UiAnim.sparkBurst(view.fill.parent as PIXI.Container, view.rect.x + view.rect.width / 2, view.rect.y + view.rect.height / 2, 0xfff0a0, 40);
                view.restored = true;
                this.drawBase(view);
                this.setBadge(view);
                UiAnim.punch(view.badge, 0.6);
                // The next section opens a beat later (setState picks it up, popping its lock).
                gsap.delayedCall(0.15, () => {
                    this.frozen = false;
                });
            },
        });
    }

    private drawBase(view: SectionView): void {
        const { x, y, width, height } = view.rect;
        const lawn = hex(view.def.ground, 0x557f38);
        view.base.clear().beginFill(view.open ? lawn : shade(lawn, LOCKED_SHADE)).drawRect(x, y, width, height).endFill();
    }

    /** The lock (locked), the check (restored), or nothing. */
    private setBadge(view: SectionView): void {
        UiAnim.kill(view.badge);
        view.badge.removeChildren().forEach((child) => child.destroy({ children: true }));
        view.badge.scale.set(1);
        view.badge.alpha = 1;
        const size = Math.max(12, Math.min(24, Math.min(view.rect.width, view.rect.height) * 0.85));
        if (!view.open) {
            const lock = PIXI.Sprite.from('Icon_Lock02');
            lock.anchor.set(0.5);
            lock.scale.set(size / Math.max(lock.texture.width, lock.texture.height, 1));
            view.badge.addChild(lock);
        } else if (view.restored) {
            const check = UiKit.sprite('hud', 'check');
            check.scale.set(size / Math.max(check.width, check.height, 1));
            view.badge.addChild(check);
        }
    }

    /** A lock lifting off a section that just opened. */
    private popLock(view: SectionView): void {
        const lock = PIXI.Sprite.from('Icon_Lock02');
        lock.anchor.set(0.5);
        const size = Math.max(12, Math.min(24, Math.min(view.rect.width, view.rect.height) * 0.85));
        lock.scale.set(size / Math.max(lock.texture.width, lock.texture.height, 1));
        lock.position.copyFrom(view.badge.position);
        view.badge.parent.addChild(lock);
        gsap.to(lock.scale, { x: lock.scale.x * 1.8, y: lock.scale.y * 1.8, duration: 0.35, ease: 'back.out(2)' });
        gsap.to(lock, { y: lock.y - 10, alpha: 0, duration: 0.35, delay: 0.1, onComplete: () => lock.destroy() });
        UiAnim.sparkBurst(view.badge.parent as PIXI.Container, lock.x, lock.y, 0x8fe3ff, 30);
    }

    private update(delta: number): void {
        if (this.destroyed) return;
        this.time += delta;
        let total = 0;
        this.sections.forEach((view, i) => {
            if (!view.racing) {
                const target = view.restored ? 1 : view.open ? view.target : 0;
                view.shown += (target - view.shown) * Math.min(1, delta * EASE_RATE);
                if (Math.abs(target - view.shown) < 0.002) view.shown = target;
            }
            total += view.restored ? 1 : view.shown;
            this.drawFill(view);
            const working = i === this.current && view.open && !view.restored;
            view.outline.clear().lineStyle(working ? 3 : 1.5, working ? GOLD : OUTLINE, working ? 0.6 + 0.4 * Math.sin(this.time * 6) : 0.8)
                .drawRect(view.rect.x, view.rect.y, view.rect.width, view.rect.height);
        });
        const percent = Math.floor((total / Math.max(1, this.sections.length)) * 100);
        if (percent !== this.percentShown) {
            this.percentShown = percent;
            this.label.text = t('townProgress', { percent });
            UiKit.fit(this.label, this.panelWidth - 12);
        }
        // The dot breathes a little so it reads as "you".
        this.player.scale.set(1 + 0.15 * Math.sin(this.time * 5));
    }

    /** The green from the bottom up to `shown`, with a rippling top edge (flat when full). */
    private drawFill(view: SectionView): void {
        const g = view.fill.clear();
        if (view.shown <= 0.001) return;
        const { x, y, width, height } = view.rect;
        const bottom = y + height;
        const level = bottom - height * view.shown;
        if (view.shown >= 0.999) {
            g.beginFill(FILL).drawRect(x, y, width, height).endFill();
            return;
        }
        const steps = Math.max(4, Math.ceil(width / 4));
        const amp = Math.min(1.6, height * 0.12);
        const top: number[] = [];
        for (let s = 0; s <= steps; s++) {
            const px = x + (width * s) / steps;
            const py = Math.max(y, Math.min(bottom, level + Math.sin(px * 0.35 + this.time * 5) * amp));
            top.push(px, py);
        }
        g.beginFill(FILL).drawPolygon([...top, x + width, bottom, x, bottom]).endFill();
        g.lineStyle(1.5, FILL_EDGE, 0.9).moveTo(top[0], top[1]);
        for (let s = 2; s < top.length; s += 2) g.lineTo(top[s], top[s + 1]);
    }

    public override destroy(): void {
        gsap.ticker.remove(this.tick);
        UiAnim.kill(this);
        this.sections.forEach((view) => gsap.killTweensOf(view));
        super.destroy({ children: true });
    }
}
