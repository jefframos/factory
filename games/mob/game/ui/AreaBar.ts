// AreaBar.ts
//
// How far the player is through the area (the zone: ui/zones.json), on the end card over CONTINUE: "AREA 1 · BEACH"
// with the map pin, a segment for each of its levels (green, done; the next one gold and pulsing; dark, to come), and at
// its end the next area: its castle, locked, and its name. A win that finishes the area says AREA COMPLETE! and the
// next area's lock pops off.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { ZoneConfig } from '../data/LevelList';
import { SegmentBar } from './SegmentBar';
import { framePlane, iconSprite, label } from './UiParts';

/** The strip's size and tint; the bar's segments (done, next, to come, their outline); the next area's badge. */
export const AREA_BAR = { width: 620, height: 108, back: 0x34365a, frameScale: 0.7 };
const BAR = { y: 22, height: 22, gap: 4, pad: 4, boss: 36, left: -AREA_BAR.width / 2 + 34, right: AREA_BAR.width / 2 - 128 };
const NEXT = { x: AREA_BAR.width / 2 - 64, castle: 72, lock: 34, nameY: 46, nameSize: 18 };
const TITLE = { x: -AREA_BAR.width / 2 + 34, y: -22, size: 26, pin: 40 };

export interface AreaView { zone: ZoneConfig; number: number; done: number; total: number; next: ZoneConfig }

export class AreaBar extends PIXI.Container {
    private readonly title = label(TITLE.size);
    private readonly bar = new SegmentBar({ width: BAR.right - BAR.left, height: BAR.height, gap: BAR.gap, pad: BAR.pad, boss: BAR.boss });
    private readonly castle = iconSprite('Icon_Castle', NEXT.castle);
    private readonly lock = iconSprite('Icon_Lock03', NEXT.lock);
    private readonly nextName = label(NEXT.nameSize, 0xc9d3ff);
    private view: AreaView | null = null;
    private complete = false;
    private time = 0;

    public constructor() {
        super();
        const back = framePlane('PanelFrame03_Bg', AREA_BAR.width, AREA_BAR.height, AREA_BAR.frameScale);
        back.tint = AREA_BAR.back;
        back.position.set(-AREA_BAR.width / 2, -AREA_BAR.height / 2);
        const pin = iconSprite('Icon_MapPoint', TITLE.pin);
        pin.position.set(TITLE.x + TITLE.pin / 2 - 6, TITLE.y);
        this.title.anchor.set(0, 0.5);
        this.title.position.set(TITLE.x + TITLE.pin + 2, TITLE.y);
        this.castle.position.set(NEXT.x, -10);
        this.lock.position.set(NEXT.x + 22, 8);
        this.nextName.y = NEXT.nameY - 8;
        this.nextName.x = NEXT.x;
        this.bar.position.set((BAR.left + BAR.right) / 2, BAR.y);
        this.addChild(back, pin, this.title, this.bar, this.castle, this.lock, this.nextName);
    }

    /**
     * Where the player is now. `finished`: this win was the area's last level (`view` is already the next area's): the
     * bar shows the area it finished, full, and the next one opens.
     */
    public set(view: AreaView, finished: { zone: ZoneConfig; number: number; total: number } | null): void {
        this.complete = !!finished;
        this.view = finished ? { zone: finished.zone, number: finished.number, done: finished.total, total: finished.total, next: view.zone } : view;
        const shown = this.view;
        this.title.text = this.complete ? 'AREA COMPLETE!' : `AREA ${shown.number} · ${shown.zone.name.toUpperCase()}`;
        this.title.style.fill = this.complete ? 0xffd23f : 0xffffff;
        this.nextName.text = shown.next.name.toUpperCase();
        this.lock.visible = true;
        this.lock.alpha = 1;
        this.lock.scale.set(NEXT.lock / Math.max(this.lock.texture.width, this.lock.texture.height));
        this.castle.tint = this.complete ? 0xffffff : 0x9aa3c8;
        this.bar.set(shown.total, shown.done, this.complete ? -1 : undefined);
    }

    /** The card's shown: a finished area's lock pops off its next one. */
    public play(delay: number): void {
        if (!this.complete) return;
        const size = this.lock.scale.x;
        gsap.timeline({ delay })
            .to(this.lock.scale, { x: size * 1.5, y: size * 1.5, duration: 0.18, ease: 'power2.out' })
            .to(this.lock, { alpha: 0, y: this.lock.y - 30, duration: 0.25, onComplete: () => { this.lock.visible = false; this.lock.y += 30; } })
            .fromTo(this.castle.scale, { x: this.castle.scale.x * 0.8, y: this.castle.scale.y * 0.8 }, { x: this.castle.scale.x, y: this.castle.scale.y, duration: 0.4, ease: 'back.out(3)' }, '<');
    }

    public update(dt: number): void {
        this.time += dt;
        if (!this.complete) this.bar.pulse(0.5 + 0.5 * Math.sin(this.time * 6));
    }
}
