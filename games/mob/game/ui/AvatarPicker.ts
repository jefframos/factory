// AvatarPicker.ts
//
// Choosing the player's picture (the profile's avatar tapped), as the UFO game's: a box with every avatar in a grid, a
// check on the one chosen; a tap picks one; DONE (or the corner close) shuts it.

import * as PIXI from 'pixi.js';
import { MobAudio } from '../audio/MobAudio';
import { MobSave } from '../data/MobSave';
import { AVATARS } from '../data/Profile';
import { Overlay } from './Overlay';
import { glossyButton, iconSprite, makeAvatar, tappable } from './UiParts';

const GRID = { cols: 6, cell: 96, avatar: 82, top: -250, check: 36, checkAt: 30 };
const SIZE = { width: 640, height: 300 + Math.ceil(AVATARS.length / GRID.cols) * GRID.cell };

export class AvatarPicker extends Overlay {
    private readonly grid = new PIXI.Container();
    private readonly check = iconSprite('Icon_Check03_l', GRID.check);

    /** `onChange`: another one's been chosen. */
    public constructor(private readonly onChange: () => void, onClose: () => void) {
        super(SIZE, onClose);
        this.panel.addChild(this.back(SIZE.width, SIZE.height, 0x1b2a5a, 'CHOOSE AVATAR'), this.closeButton(SIZE.width, SIZE.height));
        AVATARS.forEach((look, i) => {
            const holder = makeAvatar(look, GRID.avatar);
            holder.position.set(((i % GRID.cols) - (GRID.cols - 1) / 2) * GRID.cell, (Math.floor(i / GRID.cols) + 0.5) * GRID.cell);
            holder.hitArea = new PIXI.Circle(0, 0, GRID.cell / 2);
            tappable(holder, () => this.choose(i));
            this.grid.addChild(holder);
        });
        this.grid.addChild(this.check);
        this.grid.y = -SIZE.height / 2 + 100;
        const done = glossyButton(240, 80, 'DONE', 'Button01_l_Green');
        done.y = SIZE.height / 2 - 66;
        tappable(done, () => this.close());
        this.panel.addChild(this.grid, done);
        this.placeCheck();
    }

    private choose(index: number): void {
        MobSave.setAvatar(index);
        MobAudio.play('click', 1.2);
        this.placeCheck();
        this.onChange();
    }

    private placeCheck(): void {
        const holder = this.grid.getChildAt(MobSave.avatar % AVATARS.length);
        this.check.position.set(holder.x + GRID.checkAt, holder.y + GRID.checkAt);
    }
}
