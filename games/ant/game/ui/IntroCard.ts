// IntroCard.ts
//
// A new mechanic's first appearance (AntScene): the screen dims and a popup pops in (as Mob's, in the game's cozy colours:
// a warm framed box with the moving pattern in it) — NEW POWER-UP! or NEW OBSTACLE!, its picture, its name, a line or
// two of how it works, and GOT IT.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { AntAudio } from '../audio/AntAudio';
import { COZY, DARK, buttonParts, dimmer, label, plainLabel, popupBox, tappable } from './UiParts';

/** Design units: the card, where its pieces sit (y from its middle). */
const CARD = { width: 480, height: 460, scale: 0.9, headingY: -192, pictureY: -74, nameY: 26, textY: 96, textWidth: 400, buttonY: 178 };

export class IntroCard extends PIXI.Container {
    private readonly dim = dimmer();
    private readonly panel = new PIXI.Container();

    /** `heading` (NEW POWER-UP!), its `picture` (about 110 across, centred), `name`, `text`; `onDone` from GOT IT. */
    public constructor(heading: string, picture: PIXI.Container, name: string, text: string, private readonly onDone: () => void) {
        super();
        const back = popupBox(CARD.width, CARD.height);
        const title = label(30);
        title.text = heading;
        title.y = CARD.headingY;
        picture.y = CARD.pictureY;
        const words = label(36, 0xffd23f);
        words.text = name;
        words.y = CARD.nameY;
        const line = plainLabel(24, 0xffffff);
        line.style.wordWrap = true;
        line.style.wordWrapWidth = CARD.textWidth;
        line.style.align = 'center';
        line.style.stroke = DARK;
        line.style.strokeThickness = 4;
        line.text = text;
        line.y = CARD.textY;
        const ok = new PIXI.Container();
        ok.addChild(...buttonParts(240, 70, 'GOT IT', 'Button01_l_Green'));
        ok.y = CARD.buttonY;
        tappable(ok, () => this.onDone());
        this.panel.addChild(back, title, picture, words, line, ok);
        this.addChild(this.dim, this.panel);
        this.reposition();
        AntAudio.play('open');
        gsap.fromTo(this.panel.scale, { x: 0.6, y: 0.6 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(2)' });
        gsap.fromTo(this.dim, { alpha: 0 }, { alpha: 1, duration: 0.25 });
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        this.dim.clear().beginFill(COZY.dim, 0.6).drawRect(screen.topLeft.x, screen.topLeft.y, screen.width, screen.height).endFill();
        this.panel.position.set(screen.center.x, screen.center.y);
    }

    public override destroy(): void {
        gsap.killTweensOf([this.panel.scale, this.dim]);
        super.destroy({ children: true });
    }
}
