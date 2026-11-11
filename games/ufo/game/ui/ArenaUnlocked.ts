// ArenaUnlocked.ts
//
// A new arena opened (the story's first one, or the player's trophies reached it), as Mob's: NEW ARENA! over golden
// rays turning, its name on the purple ribbon, ARENA n, and what it took. A tap (once it's in) closes it; the VERSUS tab
// then shows that arena.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UfoAudio } from '../audio/UfoAudio';
import { VersusArena } from '../data/Versus';
import { Overlay } from './Overlay';
import { MOMENT_LOOK } from './Pattern';
import { framePlane, iconSprite, label } from './UiParts';

const SIZE = { width: 640, height: 760 };

export class ArenaUnlocked extends Overlay {
    private ready = false;

    /** `arena`, the `number`th. */
    public constructor(arena: VersusArena, number: number, onClose: () => void) {
        super(SIZE, onClose, 0.9, false);
        this.backdrop(MOMENT_LOOK);
        this.dim.on('pointertap', () => {
            if (this.ready) this.close();
        });
        this.panel.eventMode = 'none';
        const rays = iconSprite('Image_Effect_Rotate', 640);
        rays.tint = 0xffd23f;
        rays.alpha = 0.5;
        rays.blendMode = PIXI.BLEND_MODES.ADD;
        gsap.to(rays, { rotation: Math.PI * 2, duration: 12, ease: 'none', repeat: -1 });
        const glow = iconSprite('Glow_Circle01', 520);
        glow.tint = 0xc9a2ff;
        glow.alpha = 0.6;
        const title = label(72, 0xffe066);
        title.text = 'NEW ARENA!';
        title.y = -250;
        const cup = iconSprite('ItemIcon_Trophy_Gold', 220);
        cup.y = -40;
        const ribbon = framePlane('Title_Ribbon04_Purple', 520, 100, 0.65);
        ribbon.position.set(-260, 90);
        const name = label(42);
        name.text = arena.name.toUpperCase();
        name.y = 134;
        name.scale.set(Math.min(1, 420 / Math.max(1, name.width)));
        const which = label(28, 0xc9d3ff);
        which.text = arena.trophies ? `ARENA ${number} · ${arena.trophies} TROPHIES` : `ARENA ${number}`;
        which.y = 220;
        const tap = label(24, 0xc9d3ff);
        tap.text = 'TAP TO CONTINUE';
        tap.y = SIZE.height / 2 - 30;
        tap.alpha = 0;
        this.panel.addChild(glow, rays, title, cup, ribbon, name, which, tap);
        gsap.fromTo(title.scale, { x: 0.2, y: 0.2 }, { x: 1, y: 1, duration: 0.5, ease: 'back.out(2.5)' });
        gsap.fromTo(cup.scale, { x: 0, y: 0 }, { x: cup.scale.x, y: cup.scale.y, duration: 0.6, delay: 0.2, ease: 'back.out(2.5)' });
        gsap.to(tap, { alpha: 1, duration: 0.3, delay: 1, onComplete: () => { this.ready = true; } });
        UfoAudio.win();
    }
}
