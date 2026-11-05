// PausePopup.ts
//
// The pause popup (the pause button, top left of the game): the UI pack's blue popup with its top bar — PAUSED — the
// sound and music toggles, RETRY (the level again) and HOME (the main screen), and a close cross (play on). The game is
// paused (Game.timeScale 0) while it's up: AntScene does that.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import SoundManager from 'core/audio/SoundManager';
import { Game } from 'core/Game';
import { AntAudio } from '../audio/AntAudio';
import { buttonParts, dimmer, framePlane, iconSprite, label, roundButton, tappable } from './UiParts';

/** Design units. The panel, where its top bar's title sits, the toggles and the buttons. */
const PANEL = { width: 440, height: 430, scale: 0.9, titleY: -176, titleSize: 40 };
const CLOSE = { size: 52, x: 196, y: -186 };
const TOGGLE = { size: 92, gap: 150, y: -60, labelY: 66, labelSize: 22 };
const BUTTONS = { width: 300, height: 72, retryY: 76, homeY: 160 };

export class PausePopup extends PIXI.Container {
    private readonly dim = dimmer();
    private readonly panel = new PIXI.Container();
    private readonly sound: { on: PIXI.Sprite; off: PIXI.Sprite };
    private readonly music: { on: PIXI.Sprite; off: PIXI.Sprite };

    public constructor(private readonly actions: { resume: () => void; retry: () => void; home: () => void }) {
        super();
        const back = framePlane('Popup04_Topber_Single', PANEL.width, PANEL.height, PANEL.scale);
        back.position.set(-PANEL.width / 2, -PANEL.height / 2);
        const title = label(PANEL.titleSize);
        title.text = 'PAUSED';
        title.y = PANEL.titleY;
        const close = new PIXI.Container();
        close.addChild(iconSprite('Icon_Close02', CLOSE.size));
        close.position.set(CLOSE.x, CLOSE.y);
        tappable(close, () => this.actions.resume(), 'close');

        this.sound = this.toggle('PictoIcon_Sound', 'PictoIcon_Sound_Off', 'SOUND', -TOGGLE.gap / 2, () => {
            SoundManager.instance.toggleMute();
            this.refresh();
        });
        this.music = this.toggle('PictoIcon_Music_1', 'PictoIcon_Music_1_Off', 'MUSIC', TOGGLE.gap / 2, () => {
            AntAudio.musicOn = !AntAudio.musicOn;
            this.refresh();
        });

        const retry = new PIXI.Container();
        retry.addChild(...buttonParts(BUTTONS.width, BUTTONS.height, 'RETRY', 'Button01_l_Yellow'));
        retry.y = BUTTONS.retryY;
        tappable(retry, () => this.actions.retry());
        const home = new PIXI.Container();
        home.addChild(...buttonParts(BUTTONS.width, BUTTONS.height, 'HOME', 'Button01_l_Sky'));
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
        this.music.on.visible = AntAudio.musicOn;
        this.music.off.visible = !AntAudio.musicOn;
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        this.dim.clear().beginFill(0x10123a, 0.55).drawRect(screen.topLeft.x, screen.topLeft.y, screen.width, screen.height).endFill();
        this.panel.position.set(screen.center.x, screen.center.y);
    }

    public override destroy(): void {
        gsap.killTweensOf([this.panel.scale, this.dim]);
        super.destroy({ children: true });
    }
}
