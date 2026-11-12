// PausePopup.ts
//
// The pause popup (the pause button, top left of the game), as Mob's popups in the game's cozy colours: a warm framed
// box with the moving pattern in it — PAUSED — the sound toggle (all of it, on or off), RETRY (the level again) and HOME (the main
// screen), and the red round close on its corner (play on). The game is paused (Game.timeScale 0) while it's up:
// AntScene does that.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import SoundManager from 'core/audio/SoundManager';
import { Game } from 'core/Game';
import { AntAudio } from '../audio/AntAudio';
import { COZY, buttonParts, closeButton, dimmer, iconSprite, label, popupBox, roundButton, tappable } from './UiParts';

/** Design units. The panel, where its top bar's title sits, the toggles and the buttons. */
const PANEL = { width: 440, height: 430, titleY: -168, titleSize: 40 };
const CLOSE = { size: 64, inset: 8 };
const TOGGLE = { size: 92, y: -60, labelY: 66, labelSize: 22 };
const BUTTONS = { width: 300, height: 72, retryY: 76, homeY: 160 };

export class PausePopup extends PIXI.Container {
    private readonly dim = dimmer();
    private readonly panel = new PIXI.Container();
    private readonly sound: { on: PIXI.Sprite; off: PIXI.Sprite };

    public constructor(private readonly actions: { resume: () => void; retry: () => void; home: () => void }) {
        super();
        const back = popupBox(PANEL.width, PANEL.height);
        const title = label(PANEL.titleSize);
        title.text = 'PAUSED';
        title.y = PANEL.titleY;
        const close = closeButton(CLOSE.size);
        close.position.set(PANEL.width / 2 - CLOSE.inset, -PANEL.height / 2 + CLOSE.inset);
        tappable(close, () => this.actions.resume(), 'close');

        // One sound button (everything on or off), in the middle.
        this.sound = this.toggle('PictoIcon_Sound_Stroke', 'PictoIcon_Sound_Off_Stroke', 'SOUND', 0, () => {
            SoundManager.instance.toggleMute();
            this.refresh();
        });

        const retry = new PIXI.Container();
        retry.addChild(...buttonParts(BUTTONS.width, BUTTONS.height, 'RETRY', 'Button01_l_Yellow'));
        retry.y = BUTTONS.retryY;
        tappable(retry, () => this.actions.retry());
        const home = new PIXI.Container();
        home.addChild(...buttonParts(BUTTONS.width, BUTTONS.height, 'HOME', 'Button01_l_Green'));
        home.y = BUTTONS.homeY;
        tappable(home, () => this.actions.home());

        this.panel.addChildAt(back, 0);
        this.panel.addChild(title, close, retry, home);
        this.addChild(this.dim, this.panel);
        this.refresh();
        this.reposition();
        AntAudio.play('open');
        gsap.fromTo(this.panel.scale, { x: 0.6, y: 0.6 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2)' });
        gsap.fromTo(this.dim, { alpha: 0 }, { alpha: 1, duration: 0.2 });
    }

    /** A round toggle with its name under it; shows `on` or `off`. */
    private toggle(on: string, off: string, name: string, x: number, onTap: () => void): { on: PIXI.Sprite; off: PIXI.Sprite } {
        const holder = roundButton('Button_Round02_Blue', on, TOGGLE.size);
        const onIcon = holder.getChildAt(1) as PIXI.Sprite;
        const offIcon = iconSprite(off, TOGGLE.size * 0.62);
        offIcon.y = onIcon.y;
        holder.addChild(offIcon);
        const words = label(TOGGLE.labelSize);
        words.text = name;
        words.y = TOGGLE.labelY;
        holder.addChild(words);
        holder.position.set(x, TOGGLE.y);
        tappable(holder, onTap, 'toggle');
        this.panel.addChild(holder);
        return { on: onIcon, off: offIcon };
    }

    private refresh(): void {
        const soundOn = !SoundManager.instance.isMuted;
        this.sound.on.visible = soundOn;
        this.sound.off.visible = !soundOn;
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        this.dim.clear().beginFill(COZY.dim, 0.55).drawRect(screen.topLeft.x, screen.topLeft.y, screen.width, screen.height).endFill();
        this.panel.position.set(screen.center.x, screen.center.y);
    }

    public override destroy(): void {
        gsap.killTweensOf([this.panel.scale, this.dim]);
        super.destroy({ children: true });
    }
}
