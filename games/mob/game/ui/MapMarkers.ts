// MapMarkers.ts
//
// The main screen's markers over the world map's areas, in 2D (the pack's icons), each kept over its area as the
// camera sways (place(): its point over the map, on the screen):
//   current — the map pin, bobbing, with a card under it (over it, it hid the next area): a segmented
//             bar of its levels (green, beaten; gold and pulsing, the next) and how many of them are beaten;
//   next    — the gold padlock, the area's name under it on a dark pill;
//   done    — a small green check, no name (beaten: it needn't say more);
//   open    — (every level unlocked) its name on a dark pill.

import * as PIXI from 'pixi.js';
import { MapArea } from '../world/WorldMapView';
import { SegmentBar } from './SegmentBar';
import { framePlane, iconSprite, label } from './UiParts';

/** The current area's card (no name: just its progress): its size, its tint, its bar (segments, colours), and the gap
 *  under the pin. */
const CARD = { width: 178, height: 34, tint: 0x1c1d33, alpha: 0.92, barY: 0, barLeft: -76, barRight: 46, count: 17, countX: 66, gap: 8 };
const BAR = { height: 12, gap: 2, pad: 3, boss: 20 };
/** The pin's size and bob; the padlock's and the check's sizes; a name's pill. */
const PIN = { size: 64, bob: 6, speed: 3.2 };
const LOCK = { size: 60 };
const CHECK = { size: 34 };
const PILL = { height: 40, pad: 22, tint: 0x1c1d33, alpha: 0.85, text: 22, below: 52 };

interface Marker { area: MapArea; holder: PIXI.Container; bob?: PIXI.Container; bar?: SegmentBar }

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
                : area.state === 'done' ? this.check(area) : this.badge(area, null, 0, 0xc9d3ff);
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
        const count = label(CARD.count, 0xffd23f);
        count.text = `${area.done}/${area.total}`;
        count.position.set(CARD.countX, CARD.barY);
        const bar = new SegmentBar({ width: CARD.barRight - CARD.barLeft, height: BAR.height, gap: BAR.gap, pad: BAR.pad, boss: BAR.boss });
        bar.position.set((CARD.barLeft + CARD.barRight) / 2, CARD.barY);
        bar.set(area.total, area.done);
        card.addChild(back, bar, count);
        // Under the pin (its point is the area's), not bobbing with it: steady, and clear of the area beyond.
        card.y = CARD.gap + CARD.height / 2;
        holder.addChild(bob, card);
        return { area, holder, bob, bar };
    }

    /** A beaten area: just a small check. */
    private check(area: MapArea): Marker {
        const holder = new PIXI.Container();
        const icon = iconSprite('Icon_Check03_l', CHECK.size);
        icon.anchor.set(0.5, 0.5);
        holder.addChild(icon);
        return { area, holder };
    }

    /** A badge (a padlock, or nothing) with the area's name on a pill under it. */
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
            marker.bar?.pulse(0.5 + 0.5 * Math.sin(this.time * 6));
        }
    }
}
