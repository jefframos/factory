// AvatarPanel.ts
//
// Choosing the player's picture, from a grid over the home screen. Their username's shown but can't be changed.

import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import { AVATARS } from '../data/Profile';
import { UfoProgress } from '../data/UfoProgress';
import { UfoAudio } from '../audio/UfoAudio';
import { buttonParts, iconSprite, label, makeAvatar, tappable } from './UiParts';

const BACK = 0x12305e;
const STRIP = { height: 96, color: 0x3f6bf5, title: 34 };
const GRID = { cols: 4, cell: 134, avatar: 112, top: 150, nameY: 124, check: 46, checkAt: 40, nameSize: 30 };
const BUTTON = { width: 260, height: 84, fromBottom: 64 };

export class AvatarPanel extends PIXI.Container {
    private readonly back = new PIXI.Sprite(PIXI.Texture.WHITE);
    private readonly strip = new PIXI.Sprite(PIXI.Texture.WHITE);
    private readonly title = label(STRIP.title);
    private readonly userName = label(GRID.nameSize);
    private readonly grid = new PIXI.Container();
    private readonly check = iconSprite('Icon_Check03_l', GRID.check);
    private readonly close = new PIXI.Container();

    /** `onChange`: another one's been chosen. `onClose`: back to the home screen. */
    public constructor(private readonly onChange: () => void, onClose: () => void) {
        super();
        this.back.tint = BACK;
        this.back.anchor.set(0.5);
        this.back.eventMode = 'static';
        this.strip.tint = STRIP.color;
        this.title.text = 'CHOOSE AVATAR';
        this.userName.text = UfoProgress.username;
        AVATARS.forEach((look, i) => {
            const holder = makeAvatar({ name: '', face: look.face, color: look.color }, GRID.avatar);
            holder.position.set(((i % GRID.cols) - (GRID.cols - 1) / 2) * GRID.cell, (Math.floor(i / GRID.cols) + 0.5) * GRID.cell);
            holder.hitArea = new PIXI.Circle(0, 0, GRID.cell / 2);
            tappable(holder, () => this.choose(i));
            this.grid.addChild(holder);
        });
        this.grid.addChild(this.check);
        this.close.addChild(...buttonParts(BUTTON.width, BUTTON.height, 'DONE', 'Button01_l_Green'));
        tappable(this.close, onClose);
        this.addChild(this.back, this.strip, this.title, this.userName, this.grid, this.close);
        this.placeCheck();
    }

    private choose(index: number): void {
        UfoProgress.setAvatar(index);
        UfoAudio.eat(0.2);
        this.placeCheck();
        this.onChange();
    }

    private placeCheck(): void {
        const i = UfoProgress.avatar;
        const holder = this.grid.getChildAt(i);
        this.check.position.set(holder.x + GRID.checkAt, holder.y + GRID.checkAt);
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const top = screen.topLeft.y;
        this.back.position.copyFrom(screen.center);
        this.back.width = screen.width + 4;
        this.back.height = screen.height + 4;
        this.strip.position.set(screen.topLeft.x, top);
        this.strip.width = screen.width;
        this.strip.height = STRIP.height;
        this.title.position.set(screen.center.x, top + STRIP.height / 2);
        this.userName.position.set(screen.center.x, top + GRID.nameY);
        this.grid.position.set(screen.center.x, top + GRID.top);
        this.close.position.set(screen.center.x, top + screen.height - BUTTON.fromBottom);
    }

    public override destroy(): void {
        super.destroy({ children: true });
    }
}
