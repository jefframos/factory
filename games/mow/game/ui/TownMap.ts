// TownMap.ts
//
// The "fill the whole town" meter: a map of the island, drawn from the level (sea, island outline, roads, sections — so
// it follows the editor with nothing extra to author), with each section filling up in bright green from the bottom as
// it's restored (a rippling top edge), the one being worked on outlined in pulsing gold, locked ones dark with a lock,
// restored ones with a check, a marker for each ATM and wardrobe that's out (their colour and icon), a dot for the
// player, and the whole town's %.
// Two looks (TownMapOptions): the compact one (a dark frame, the % under it) the HUD keeps top-right when no miniature
// is baked and flies to the centre when a section is done (MowHud.flyMap(); celebrate() is the fill / flash / unlock
// played there), and the panel the MAP button opens (`panel`: the UI kit's panel with a TOWN MAP ribbon, each
// section's name and %, a bar for the town's %, and under it the secret chests: how many are found, a chest icon for
// each found and a dark one with a "?" for each still hidden — a hint there are more to look for), drawn at its own size
// so it stays crisp (never scaled up).
// Origin: the panel's centre (so it scales round it in flight).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { TOWN, AtmLook, AtmSpot, DistrictDef, SECRET_CHEST_MODEL } from '../data/MowConfig';
import { MowProgress } from '../data/MowProgress';
import { ModelIcons } from './ModelIcons';
import { UiKit } from './UiKit';
import { BakedShape } from './BakedShape';
import { UiAnim } from './UiAnim';
import { t, names, Localization } from '../i18n/Localization';

export interface TownMapOptions {
    /** The map's width in pixels (its height follows the island's shape); lines and icons scale with it. */
    width?: number;
    /** The MAP button's panel look (names, a bar) instead of the compact corner one. */
    panel?: boolean;
}

/** The compact map's width: the size everything else is drawn for (scaled by width / BASE_WIDTH). */
const BASE_WIDTH = 200;
/** The compact frame's padding and the % label's room under it. */
const PAD = 8;
const LABEL_ROOM = 30;
/** The panel's padding round the map, room for its ribbon on top, and for the town's % and bar under it. */
const PANEL_PAD = 24;
const PANEL_TOP = 40;
const PANEL_BOTTOM = 82;
const PANEL_BAR = { width: 300, height: 24 };
/** The panel's secret chests row (only with secrets in the level): its room, and each chest icon's size and gap. */
const SECRETS_ROOM = 86;
const CHEST = { size: 40, gap: 10 };
/** A section's name (panel) only when its rectangle has room for it (pixels). */
const NAME_MIN = { width: 64, height: 34 };
/** World units of sea round the island's outline. */
const SEA = 3;
const FILL = 0x8fe36a;
const FILL_EDGE = 0xd8ffb0;
/** Locked lawns: their own green, this dark (still lawn, not road, but clearly not open yet). */
const LOCKED_SHADE = 0.45;
const GOLD = 0xffd86b;
const OUTLINE = 0x1d140e;
/** A station's marker: its disc's radius, and its icon's size as a share of the disc (x the map's sqrt(k)). */
const STATION_MARKER = { radius: 9, icon: 1.25 };
/** How fast the shown fill eases to the real share (per second), and the race to full when a section is done. */
const EASE_RATE = 5;
const RACE_SEC = 0.45;

const hex = (color: string | undefined, fallback: number): number => (color ? parseInt(color.replace('#', ''), 16) : fallback);
const shade = (color: number, amount: number): number =>
    (Math.round(((color >> 16) & 255) * amount) << 16) | (Math.round(((color >> 8) & 255) * amount) << 8) | Math.round((color & 255) * amount);

/** One section on the map: its rectangle (map pixels), base, fill (masked to its rounded corners), outline and badge. */
interface SectionView {
    def: DistrictDef;
    rect: PIXI.Rectangle;
    base: PIXI.Graphics;
    fill: PIXI.Graphics;
    outline: PIXI.Graphics;
    badge: PIXI.Container;
    /** Its name and % (panel; none when it hasn't the room). */
    name?: PIXI.Text;
    percent?: PIXI.Text;
    percentShown: number;
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
    private readonly player = new PIXI.Container();
    /** The ATMs' and wardrobes' markers, in the level's order (shown as they come out: setStations()). */
    private readonly atmMarkers: PIXI.Container[] = [];
    private readonly wardrobeMarkers: PIXI.Container[] = [];
    private readonly playerRing = new PIXI.Graphics();
    private readonly label: PIXI.Text;
    private readonly barFill = new PIXI.Container();
    /** The panel's secret chests: its label and icons, and how many found they show (redrawn when that changes). */
    private secretsLabel?: PIXI.Text;
    private readonly secretsRow = new PIXI.Container();
    private secretsShown = -1;
    private readonly panel: boolean;
    private readonly mapWidth: number;
    /** Lines, icons and text: this times their compact size. */
    private readonly k: number;
    private readonly scaleOf: number;
    private readonly minX: number;
    private readonly minZ: number;
    private current = -1;
    private time = 0;
    /** While celebrate() plays, opening / restoring waits (so the lock pops after the fill, not before). */
    private frozen = false;
    private percentShown = -1;
    private readonly tick = () => this.update(gsap.ticker.deltaRatio() / 60);

    public constructor(options: TownMapOptions = {}) {
        super();
        this.panel = !!options.panel;
        this.mapWidth = options.width ?? BASE_WIDTH;
        this.k = this.mapWidth / BASE_WIDTH;
        const k = this.k;
        const outline = TOWN.island?.outline;
        const xs = outline?.length ? outline.map((p) => p.x) : [TOWN.ground.x - TOWN.ground.width / 2, TOWN.ground.x + TOWN.ground.width / 2];
        const zs = outline?.length ? outline.map((p) => p.z) : [TOWN.ground.z - TOWN.ground.depth / 2, TOWN.ground.z + TOWN.ground.depth / 2];
        this.minX = Math.min(...xs) - SEA;
        this.minZ = Math.min(...zs) - SEA;
        const spanX = Math.max(...xs) + SEA - this.minX;
        const spanZ = Math.max(...zs) + SEA - this.minZ;
        this.scaleOf = this.mapWidth / spanX;
        const mapHeight = spanZ * this.scaleOf;

        // The frame round it, and where the map's top-left sits (from the panel's centre).
        const map = new PIXI.Container();
        if (this.panel) {
            this.panelWidth = this.mapWidth + PANEL_PAD * 2;
            this.panelHeight = mapHeight + PANEL_TOP + PANEL_BOTTOM + (TOWN.secrets?.length ? SECRETS_ROOM : 0);
            const frame = UiKit.image('upgrades', 'panel', this.panelWidth, this.panelHeight);
            const ribbon = UiKit.sprite('upgrades', 'ribbon', 0.55);
            ribbon.y = -this.panelHeight / 2;
            const title = UiKit.text('upgrades', 'title');
            title.text = Localization.getString('titleTownMap', undefined, 'TOWN MAP');
            title.y = -this.panelHeight / 2 - 5;
            this.addChild(frame, ribbon, title);
            map.position.set(-this.mapWidth / 2, -this.panelHeight / 2 + PANEL_TOP);
        } else {
            this.panelWidth = this.mapWidth + PAD * 2;
            this.panelHeight = mapHeight + PAD * 2 + LABEL_ROOM;
            this.addChild(new PIXI.Graphics()
                .lineStyle(3, 0xffffff, 0.9)
                .beginFill(0x1d2633, 0.85)
                .drawRoundedRect(-this.panelWidth / 2, -this.panelHeight / 2, this.panelWidth, this.panelHeight, 14)
                .endFill());
            map.position.set(-this.mapWidth / 2, -this.panelHeight / 2 + PAD);
        }

        // Sea, the island (a soft shadow under it, its deck as a rim) and its roads.
        const water = hex(TOWN.island?.water, 0x3aa6e8);
        const sea = new PIXI.Graphics()
            .lineStyle(2 * k, shade(water, 0.7), 1)
            .beginFill(water).drawRoundedRect(0, 0, this.mapWidth, mapHeight, 9 * k).endFill();
        const land = new PIXI.Graphics();
        if (outline?.length) {
            const points = outline.flatMap((p) => [this.mapX(p.x), this.mapY(p.z)]);
            land.beginFill(0x000000, 0.22).drawPolygon(points.map((v, i) => v + (i % 2 ? 3 * k : 1.5 * k))).endFill();
            land.lineStyle(3 * k, hex(TOWN.island?.deck?.color, 0xb98352), 1, 1).beginFill(hex(TOWN.ground.color, 0x8c9a7c));
            land.drawPolygon(points).endFill();
        } else {
            land.beginFill(hex(TOWN.ground.color, 0x8c9a7c)).drawRect(...this.rectOf(TOWN.ground)).endFill();
        }
        const roads = new PIXI.Graphics();
        TOWN.pavements.forEach((p) => roads.beginFill(hex(p.color, 0x4a4f57)).drawRect(...this.rectOf(p)).endFill());
        map.addChild(sea, land, roads);

        const labels = new PIXI.Container();
        TOWN.sections.forEach((def) => {
            const [x, y, w, h] = this.rectOf(def);
            const fillMask = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(x, y, w, h, this.corner).endFill();
            const view: SectionView = {
                def,
                rect: new PIXI.Rectangle(x, y, w, h),
                base: new PIXI.Graphics(),
                fill: new PIXI.Graphics(),
                outline: new PIXI.Graphics(),
                badge: new PIXI.Container(),
                percentShown: -1,
                shown: 0,
                target: 0,
                open: false,
                restored: false,
                racing: false,
            };
            view.fill.mask = fillMask;
            view.badge.position.set(x + w / 2, y + h / 2);
            if (this.panel && w >= NAME_MIN.width && h >= NAME_MIN.height) {
                // The name (and under it the %, or the badge) in the middle.
                // A long name on a narrow section wraps (one word a line) rather than shrinking to nothing.
                view.name = UiKit.text('hud', 'toast', { text: names.district(def).toUpperCase() },
                    { fontSize: 15, strokeThickness: 4, align: 'center', leading: -3, breakWords: false });
                view.name.anchor.set(0.5);
                if (view.name.width > w - 8) {
                    view.name.style.wordWrap = true;
                    view.name.style.wordWrapWidth = w - 8;
                }
                UiKit.fit(view.name, w - 6);
                const below = 10 + 10;
                const top = y + h / 2 - (view.name.height + below) / 2;
                view.name.position.set(x + w / 2, top + view.name.height / 2);
                view.percent = UiKit.text('hud', 'toast', { text: '' }, { fontSize: 14, strokeThickness: 4, fill: 0xe8ffd8 });
                view.percent.anchor.set(0.5);
                view.percent.position.set(x + w / 2, top + view.name.height + below / 2 + 2);
                view.badge.y = view.percent.y + 2;
                labels.addChild(view.name, view.percent);
            }
            map.addChild(view.base, view.fill, fillMask, view.outline);
            labels.addChild(view.badge);
            this.sections.push(view);
            this.drawBase(view);
            this.setBadge(view);
        });

        // The player: a white dot with a ring pulsing out of it.
        this.player.addChild(this.playerRing, BakedShape.disc(4.5 * Math.sqrt(k), { fill: 0xffffff, rim: OUTLINE, rimWidth: 2 * Math.sqrt(k) }));
        this.player.visible = false;
        const stations = new PIXI.Container();
        this.addMarkers(stations, TOWN.atms, TOWN.atm, this.atmMarkers);
        this.addMarkers(stations, TOWN.wardrobes ?? [], TOWN.wardrobe, this.wardrobeMarkers);
        map.addChild(labels, stations, this.player);
        this.addChild(map);

        // The town's %: under the map (compact), or over a bar (panel).
        if (this.panel) {
            this.label = UiKit.text('hud', 'toast', { text: '' }, { fontSize: 24, strokeThickness: 6 });
            this.label.anchor.set(0.5);
            const barY = -this.panelHeight / 2 + PANEL_TOP + mapHeight + PANEL_BOTTOM / 2 + 14;
            this.label.position.set(0, barY - 30);
            const bar = new PIXI.Container();
            bar.y = barY;
            bar.addChild(UiKit.image('hud', 'barBack', PANEL_BAR.width, PANEL_BAR.height), this.barFill);
            this.addChild(bar, this.label);
            if (TOWN.secrets?.length) {
                this.secretsLabel = UiKit.text('hud', 'toast', { text: '' }, { fontSize: 18, strokeThickness: 5, fill: 0xffe27a });
                this.secretsLabel.anchor.set(0.5);
                this.secretsLabel.y = barY + PANEL_BAR.height / 2 + 22;
                this.secretsRow.y = this.secretsLabel.y + 12 + CHEST.size / 2;
                this.addChild(this.secretsLabel, this.secretsRow);
            }
        } else {
            this.label = UiKit.text('hud', 'toast', { text: '' }, { fontSize: 22, strokeThickness: 5 });
            this.label.anchor.set(0.5);
            this.label.position.set(0, this.panelHeight / 2 - LABEL_ROOM / 2 - 2);
            this.addChild(this.label);
        }
        gsap.ticker.add(this.tick);
    }

    /** A section's corner radius (map pixels). */
    private get corner(): number {
        return 3 * this.k;
    }

    /** The lock / check's size for a section (map pixels). */
    private badgeSize(view: SectionView): number {
        const room = Math.min(view.rect.width, view.rect.height) * (view.name ? 0.4 : 0.7);
        return Math.max(12, Math.min(24 * Math.min(this.k, 1.2), room));
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
    private addMarkers(parent: PIXI.Container, spots: readonly AtmSpot[], look: AtmLook, markers: PIXI.Container[]): void {
        const radius = STATION_MARKER.radius * Math.sqrt(this.k);
        for (const spot of spots) {
            const marker = new PIXI.Container();
            marker.position.set(this.mapX(spot.x), this.mapY(spot.z));
            marker.visible = false;
            marker.addChild(BakedShape.disc(radius, { fill: hex(look.color, 0x3fd16b), rim: 0xffffff, rimWidth: 2 * Math.sqrt(this.k) }));
            const icon = PIXI.Sprite.from(look.icon);
            icon.anchor.set(0.5);
            icon.scale.set((radius * STATION_MARKER.icon) / Math.max(icon.texture.width, icon.texture.height, 1));
            marker.addChild(icon);
            parent.addChild(marker);
            markers.push(marker);
        }
    }

    /** Which ATMs and wardrobes are out: their markers follow (one coming out pops). */
    public setStations(atms: readonly boolean[], wardrobes: readonly boolean[]): void {
        const apply = (markers: PIXI.Container[], shown: readonly boolean[]) => markers.forEach((marker, i) => {
            const on = !!shown[i];
            if (on === marker.visible) return;
            marker.visible = on;
            if (on) UiAnim.punch(marker, 0.5);
        });
        apply(this.atmMarkers, atms);
        apply(this.wardrobeMarkers, wardrobes);
    }

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
                const { x, y, width, height } = view.rect;
                const flash = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(x, y, width, height, this.corner).endFill();
                view.fill.parent.addChild(flash);
                gsap.to(flash, { alpha: 0, duration: 0.35, onComplete: () => flash.destroy() });
                UiAnim.sparkBurst(view.fill.parent as PIXI.Container, x + width / 2, y + height / 2, 0xfff0a0, 40 * this.k);
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
        view.base.clear().beginFill(view.open ? lawn : shade(lawn, LOCKED_SHADE)).drawRoundedRect(x, y, width, height, this.corner).endFill();
        if (view.name) view.name.alpha = view.open ? 1 : 0.6;
    }

    /** The lock (locked), the check (restored), or nothing (its % says how far it's got). */
    private setBadge(view: SectionView): void {
        UiAnim.kill(view.badge);
        view.badge.removeChildren().forEach((child) => child.destroy({ children: true }));
        view.badge.scale.set(1);
        view.badge.alpha = 1;
        const size = this.badgeSize(view);
        if (!view.open) {
            const lock = PIXI.Sprite.from('Icon_Lock03');
            lock.anchor.set(0.5);
            lock.scale.set(size / Math.max(lock.texture.width, lock.texture.height, 1));
            view.badge.addChild(lock);
        } else if (view.restored) {
            const check = UiKit.sprite('hud', 'check');
            check.scale.set(size / Math.max(check.width, check.height, 1));
            view.badge.addChild(check);
        }
        // The % only while it's open and not done (the badge says the rest).
        if (view.percent) view.percent.visible = view.open && !view.restored;
    }

    /** A lock lifting off a section that just opened. */
    private popLock(view: SectionView): void {
        const lock = PIXI.Sprite.from('Icon_Lock03');
        lock.anchor.set(0.5);
        const size = this.badgeSize(view);
        lock.scale.set(size / Math.max(lock.texture.width, lock.texture.height, 1));
        lock.position.copyFrom(view.badge.position);
        view.badge.parent.addChild(lock);
        gsap.to(lock.scale, { x: lock.scale.x * 1.8, y: lock.scale.y * 1.8, duration: 0.35, ease: 'back.out(2)' });
        gsap.to(lock, { y: lock.y - 10 * this.k, alpha: 0, duration: 0.35, delay: 0.1, onComplete: () => lock.destroy() });
        UiAnim.sparkBurst(view.badge.parent as PIXI.Container, lock.x, lock.y, 0x8fe3ff, 30 * this.k);
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
            const { x, y, width, height } = view.rect;
            view.outline.clear()
                .lineStyle((working ? 3 : 1.5) * Math.sqrt(this.k), working ? GOLD : OUTLINE, working ? 0.6 + 0.4 * Math.sin(this.time * 6) : 0.55)
                .drawRoundedRect(x, y, width, height, this.corner);
            const percent = Math.floor(view.shown * 100);
            if (view.percent && percent !== view.percentShown) {
                view.percentShown = percent;
                view.percent.text = `${percent}%`;
            }
        });
        const share = total / Math.max(1, this.sections.length);
        const percent = Math.floor(share * 100);
        if (percent !== this.percentShown) {
            this.percentShown = percent;
            this.label.text = t('townProgress', { percent });
            UiKit.fit(this.label, this.panelWidth - 24);
            if (this.panel) this.drawBar(share);
        }
        this.updateSecrets();
        // The dot breathes a little so it reads as "you", a ring rippling out of it.
        const k = Math.sqrt(this.k);
        this.player.scale.set(1 + 0.15 * Math.sin(this.time * 5));
        const ripple = (this.time % 1.2) / 1.2;
        this.playerRing.clear().lineStyle(2 * k, 0xffffff, 0.8 * (1 - ripple)).drawCircle(0, 0, (5 + ripple * 9) * k);
    }

    /** The panel's secret chests (redrawn when one more is found): found ones first, then the hidden ones, dark with a "?". */
    private updateSecrets(): void {
        if (!this.secretsLabel) return;
        const secrets = TOWN.secrets ?? [];
        const found = secrets.filter((secret) => MowProgress.secretFound(secret.id)).length;
        if (found === this.secretsShown) return;
        this.secretsShown = found;
        this.secretsLabel.text = t('secretChestsFound', { found, total: secrets.length });
        UiKit.fit(this.secretsLabel, this.panelWidth - 24);
        this.secretsRow.removeChildren().forEach((child) => child.destroy({ children: true }));
        // Smaller when there are many, so the row fits the panel.
        const size = Math.min(CHEST.size, (this.panelWidth - 40 - CHEST.gap * (secrets.length - 1)) / secrets.length);
        secrets.forEach((_, i) => {
            const hidden = i >= found;
            const chest = new PIXI.Container();
            const icon = ModelIcons.sprite(`./mow/models/${SECRET_CHEST_MODEL}`, size, hidden);
            icon.anchor.set(0.5);
            chest.addChild(icon);
            if (hidden) {
                const mark = UiKit.text('hud', 'toast', { text: '?' }, { fontSize: Math.round(size * 0.55), strokeThickness: 4 });
                mark.anchor.set(0.5);
                chest.addChild(mark);
            }
            chest.x = (i - (secrets.length - 1) / 2) * (size + CHEST.gap);
            this.secretsRow.addChild(chest);
        });
    }

    /** The panel's bar for the town's %. */
    private drawBar(share: number): void {
        this.barFill.removeChildren().forEach((child) => child.destroy({ children: true }));
        if (share <= 0) return;
        const inner = PANEL_BAR.width - 4;
        const width = Math.max(PANEL_BAR.height - 4, inner * Math.min(1, share));
        const fill = UiKit.image('hud', 'barFill', width, PANEL_BAR.height - 4);
        fill.x = -inner / 2 + width / 2;
        this.barFill.addChild(fill);
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
        const amp = Math.min(1.6 * this.k, height * 0.12);
        const top: number[] = [];
        for (let s = 0; s <= steps; s++) {
            const px = x + (width * s) / steps;
            const py = Math.max(y, Math.min(bottom, level + Math.sin((px / this.k) * 0.35 + this.time * 5) * amp));
            top.push(px, py);
        }
        g.beginFill(FILL).drawPolygon([...top, x + width, bottom, x, bottom]).endFill();
        g.lineStyle(1.5 * Math.sqrt(this.k), FILL_EDGE, 0.9).moveTo(top[0], top[1]);
        for (let s = 2; s < top.length; s += 2) g.lineTo(top[s], top[s + 1]);
    }

    public override destroy(): void {
        gsap.ticker.remove(this.tick);
        UiAnim.kill(this);
        this.sections.forEach((view) => gsap.killTweensOf(view));
        super.destroy({ children: true });
    }
}
