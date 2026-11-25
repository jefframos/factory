// NextHelper.ts
//
// Under the rewind button: the next of the crew to come, in shadow, a question mark in its corner, and the wall it's there from.
// No words but that; gone once they've all come.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { CREW, CrewDef } from '../data/WallConfig';
import { WallProgress } from '../data/WallProgress';
import { frame, sprite, text, write } from './parts';

export const NEXT_HELPER = { width: 92, height: 100 };
const LOOK = { icon: 58, y: -12, dark: 0x4a4f80, badge: 34, yellow: 0xffc21f };

export class NextHelper extends PIXI.Container {
    private readonly icon = new PIXI.Sprite();
    private readonly wall = text('', 20, 0xffffff, 0x100e18, 5);
    private shown?: CrewDef;

    public constructor() {
        super();
        this.eventMode = 'none';
        this.icon.anchor.set(0.5);
        this.icon.y = LOOK.y;
        this.icon.tint = LOOK.dark;
        const badge = sprite('BorderFrame_Circle78', LOOK.badge);
        badge.tint = LOOK.yellow;
        const mark = text('?', 24, 0xffffff, 0x100e18, 5);
        badge.position.set(NEXT_HELPER.width / 2 - 12, -NEXT_HELPER.height / 2 + 12);
        mark.position.set(badge.x, badge.y - 1);
        this.wall.y = NEXT_HELPER.height / 2 - 22;
        this.addChild(frame('ItemFrame02_Single_Navy', [25, 28, 25, 27], NEXT_HELPER.width, NEXT_HELPER.height), this.icon, badge, mark, this.wall);
        this.visible = false;
    }

    /** `on`: it's to be seen now (nothing's open over the wall). */
    public update(on: boolean): void {
        const { best } = WallProgress;
        const next = best > 1 ? CREW.find((def) => def.wall > best) : undefined;
        this.visible = on && !!next;
        if (!next || next === this.shown) return;
        this.shown = next;
        const art = sprite(`Wall_${next.id}`, LOOK.icon);
        this.icon.texture = art.texture;
        this.icon.scale.copyFrom(art.scale);
        art.destroy();
        write(this.wall, `WALL ${next.wall}`, NEXT_HELPER.width - 18);
        gsap.killTweensOf(this.scale);
        this.scale.set(0.3);
        gsap.to(this.scale, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2.2)' });
    }
}
