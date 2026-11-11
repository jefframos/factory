// AreaBar.ts
//
// How far the player is through the area (ui/areas.json), as Mob's: "AREA 1 · SMALL TOWN" with the map pin, a segment
// for each of its levels (green, done; the next one gold and pulsing; dark, to come; a crown over the last, its boss),
// and at its end the next area: its castle, locked, and its name. A win that finishes the area says AREA COMPLETE! and
// the next area's lock pops off. On the main screen, and on a level's end screen.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { SegmentBar } from './SegmentBar';
import { framePlane, iconSprite, label } from './UiParts';

/** The strip's size and tint; the bar's segments; the next area's badge; the title. */
export const AREA_BAR = { width: 620, height: 108, back: 0x34365a, frameScale: 0.7 };
const BAR = { y: 22, height: 22, gap: 4, pad: 4, boss: 36, left: -AREA_BAR.width / 2 + 34, right: AREA_BAR.width / 2 - 128 };
const NEXT = { x: AREA_BAR.width / 2 - 64, castle: 72, lock: 34, nameY: 46, nameSize: 18 };
const TITLE = { x: -AREA_BAR.width / 2 + 34, y: -22, size: 26, pin: 40 };

/** Where the player is: the area (its name, which), how many of its levels are done, how many it has, the next area. */
export interface AreaView { name: string; number: number; done: number; total: number; next: string | null }

export class AreaBar extends PIXI.Container {
    private readonly title = label(TITLE.size);
    private readonly bar = new SegmentBar({ width: BAR.right - BAR.left, height: BAR.height, gap: BAR.gap, pad: BAR.pad, boss: BAR.boss });
    private readonly castle = iconSprite('Icon_Castle', NEXT.castle);
    private readonly lock = iconSprite('Icon_Lock03', NEXT.lock);
    private readonly nextName = label(NEXT.nameSize, 0xc9d3ff);
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
        this.nextName.position.set(NEXT.x, NEXT.nameY - 8);
        this.bar.position.set((BAR.left + BAR.right) / 2, BAR.y);
        this.addChild(back, pin, this.title, this.bar, this.castle, this.lock, this.nextName);
    }

    /** Where the player is. `complete`: the area's just been finished (`view` is that area, all done). */
    public set(view: AreaView, complete = false): void {
        this.complete = complete;
        this.title.text = complete ? 'AREA COMPLETE!' : `AREA ${view.number} · ${view.name.toUpperCase()}`;
        this.title.style.fill = complete ? 0xffd23f : 0xffffff;
        this.title.scale.set(Math.min(1, (BAR.right - BAR.left - TITLE.pin) / Math.max(1, this.title.width / this.title.scale.x)));
        this.nextName.text = (view.next ?? 'MORE SOON').toUpperCase();
        this.nextName.scale.set(Math.min(1, 120 / Math.max(1, this.nextName.width / this.nextName.scale.x)));
        this.lock.visible = true;
        this.lock.alpha = 1;
        this.castle.tint = complete ? 0xffffff : 0x9aa3c8;
        this.bar.set(view.total, view.done, complete ? -1 : undefined);
    }

    /** Shown: a finished area's lock pops off its next one. */
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

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        gsap.killTweensOf([this.lock, this.lock.scale, this.castle.scale]);
        super.destroy(options);
    }
}
