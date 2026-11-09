// MapMarkers.ts
//
// The main screen's markers over the world map's areas, in 2D (the pack's icons), each kept over its area as the
// camera sways (place(): its point over the map, on the screen):
//   current — the map pin, bobbing, with a card over it: AREA N · NAME, a segmented bar of its levels (green, beaten;
//             gold and pulsing, the next) and how many of them are beaten;
//   next    — the gold padlock, the area's name under it on a dark pill;
//   done    — a green check, the area's name under it;
//   open    — (every level unlocked) its name on a dark pill.

import * as PIXI from 'pixi.js';
import { MapArea } from '../world/WorldMapView';
import { framePlane, iconSprite, label } from './UiParts';

/** The current area's card: its size, its tint, its bar (segments, colours), and how far over the pin it sits. */
const CARD = { width: 250, height: 92, tint: 0x1c1d33, alpha: 0.92, titleY: -20, barY: 18, barLeft: -98, barRight: 62, countX: 100, up: 118 };
const BAR = { height: 16, gap: 3, done: 0x4cdc6a, next: 0xffd23f, off: 0x3a3d63, edge: 0x10123a };
/** The pin's size and bob; the padlock's and the check's sizes; a name's pill. */
const PIN = { size: 96, bob: 8, speed: 3.2 };
const LOCK = { size: 74 };
const CHECK = { size: 58 };
const PILL = { height: 40, pad: 22, tint: 0x1c1d33, alpha: 0.85, text: 22, below: 52 };

interface Marker { area: MapArea; holder: PIXI.Container; bob?: PIXI.Container; bar?: PIXI.Graphics }

export class MapMarkers extends PIXI.Container {
    private readonly markers: Marker[] = [];
    private time = 0;

    public constructor(areas: readonly MapArea[]) {
        super();
        this.eventMode = 'none';
        // The current area last: on top.
        const order = [...areas].sort((a, b) => Number(a.state === 'current') - Number(b.state === 'current'));
        for (const area of order) {
            const marker = area.state === 'current' ? this.current(area) : area.state === 'next' ? this.badge(area, 'Icon_Lock03', LOCK.size, 0xffe7a0)
                : area.state === 'done' ? this.badge(area, 'Icon_Check03_l', CHECK.size, 0xb9ffc6) : this.badge(area, null, 0, 0xc9d3ff);
            this.markers.push(marker);
            this.addChild(marker.holder);
        }
    }

    /** The area being played: the pin, and the card with its name and progress over it. */
    private current(area: MapArea): Marker {
        const holder = new PIXI.Container();
        const bob = new PIXI.Container();
        const pin = iconSprite('Icon_MapPoint', PIN.size);
        pin.anchor.set(0.5, 1);
        bob.addChild(pin);
        const card = new PIXI.Container();
        const back = framePlane('ResourceBar_Single_Bg', CARD.width, CARD.height);
        back.tint = CARD.tint;
        back.alpha = CARD.alpha;
        back.position.set(-CARD.width / 2, -CARD.height / 2);
        const title = label(24);
        title.text = `AREA ${area.number} · ${area.zone.name.toUpperCase()}`;
        title.y = CARD.titleY;
        const count = label(22, 0xffd23f);
        count.text = `${area.done}/${area.total}`;
        count.position.set(CARD.countX, CARD.barY);
        const bar = new PIXI.Graphics();
        bar.y = CARD.barY;
        card.addChild(back, title, bar, count);
        card.y = -PIN.size - CARD.up + CARD.height / 2;
        bob.addChild(card);
        holder.addChild(bob);
        const marker: Marker = { area, holder, bob, bar };
        this.drawBar(marker, 1);
        return marker;
    }

    /** A badge (a padlock, a check, or nothing) with the area's name on a pill under it. */
    private badge(area: MapArea, frame: string | null, size: number, colour: number): Marker {
        const holder = new PIXI.Container();
        if (frame) {
            const icon = iconSprite(frame, size);
            icon.anchor.set(0.5, 1);
            holder.addChild(icon);
        }
        const name = label(PILL.text, colour);
        name.text = area.zone.name.toUpperCase();
        const width = name.width + PILL.pad * 2;
        const pill = framePlane('ResourceBar_Single_Bg', width, PILL.height);
        pill.tint = PILL.tint;
        pill.alpha = PILL.alpha;
        const y = frame ? PILL.below - size / 2 : 0;
        pill.position.set(-width / 2, y - PILL.height / 2 - 10);
        name.y = y - 11;
        holder.addChild(pill, name);
        return { area, holder };
    }

    /** The current area's levels as segments: green up to those beaten, the next gold (pulsing), dark after. */
    private drawBar(marker: Marker, pulse: number): void {
        const { area, bar } = marker;
        if (!bar) return;
        const inner = CARD.barRight - CARD.barLeft;
        const width = (inner - BAR.gap * (area.total - 1)) / Math.max(1, area.total);
        const h = BAR.height;
        bar.clear().beginFill(BAR.edge).drawRoundedRect(CARD.barLeft - 3, -h / 2 - 3, inner + 6, h + 6, 7).endFill();
        for (let k = 0; k < area.total; k++) {
            const x = CARD.barLeft + k * (width + BAR.gap);
            const done = k < area.done;
            const next = k === area.done;
            bar.beginFill(done ? BAR.done : next ? BAR.next : BAR.off, next ? 0.4 + 0.6 * pulse : 1).drawRoundedRect(x, -h / 2, width, h, 3).endFill();
        }
    }

    /**
     * Each marker over its area: `project` gives a point over the map on the screen in this container's own units (null:
     * behind the camera).
     */
    public place(project: (area: MapArea) => PIXI.IPointData | null): void {
        for (const marker of this.markers) {
            const at = project(marker.area);
            marker.holder.visible = !!at;
            if (at) marker.holder.position.copyFrom(at);
        }
    }

    public update(dt: number): void {
        this.time += dt;
        for (const marker of this.markers) {
            if (marker.bob) marker.bob.y = -Math.abs(Math.sin(this.time * PIN.speed)) * PIN.bob;
            if (marker.bar) this.drawBar(marker, 0.5 + 0.5 * Math.sin(this.time * 6));
        }
    }
}
