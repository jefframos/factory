// NewCardShow.ts
//
// A card won (the trophy road's card steps: the skeletons...): NEW CARD! over golden rays turning, the card big in the
// middle popping in, its name, and where it's used. A tap (once it's in) closes it.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { MobAudio } from '../audio/MobAudio';
import { CardKind } from '../data/Settings';
import { CARD_NAMES } from './CardFace';
import { cardTile } from './CardTile';
import { Overlay } from './Overlay';
import { MOMENT_LOOK } from './Pattern';
import { iconSprite, label } from './UiParts';

const SIZE = { width: 620, height: 820 };

export class NewCardShow extends Overlay {
    private ready = false;

    public constructor(kind: CardKind, onClose: () => void) {
        super(SIZE, onClose, 0.9, false);
        this.backdrop(MOMENT_LOOK);
        this.dim.on('pointertap', () => {
            if (this.ready) this.close();
        });
        this.panel.eventMode = 'none';
        const rays = iconSprite('Image_Effect_Rotate', 620);
        rays.tint = 0xffd23f;
        rays.alpha = 0.45;
        rays.blendMode = PIXI.BLEND_MODES.ADD;
        rays.y = -40;
        gsap.to(rays, { rotation: Math.PI * 2, duration: 12, ease: 'none', repeat: -1 });
        const title = label(68, 0xffe066);
        title.text = 'NEW CARD!';
        title.y = -SIZE.height / 2 + 70;
        const card = cardTile(kind, 2, false);
        card.y = -40;
        const name = label(48);
        name.text = CARD_NAMES[kind];
        name.y = 200;
        const where = label(24, 0xc9d3ff);
        where.text = 'In your deck · for every battle';
        where.y = 252;
        const tap = label(24, 0xc9d3ff);
        tap.text = 'TAP TO CONTINUE';
        tap.y = SIZE.height / 2 - 30;
        tap.alpha = 0;
        this.panel.addChild(rays, title, card, name, where, tap);
        gsap.fromTo(card.scale, { x: 0, y: 0 }, { x: 2, y: 2, duration: 0.55, ease: 'back.out(2.2)' });
        gsap.fromTo(title.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2.5)' });
        gsap.to(tap, { alpha: 1, duration: 0.3, delay: 1, onComplete: () => { this.ready = true; } });
        MobAudio.play('win');
    }
}
