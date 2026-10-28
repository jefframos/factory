import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import SoundManager from 'core/audio/SoundManager';
import { cornerButton, setIcon } from './UiParts';

const ICON_SIZE = 40;

export default class SoundToggleButton extends PIXI.Container {
    private readonly icon: PIXI.Sprite;

    public constructor() {
        super();
        this.name = 'sound-toggle';
        const { button, icon } = cornerButton('PictoIcon_Sound', ICON_SIZE, () => SoundManager.instance.toggleMute());
        this.icon = icon;
        this.addChild(button);
        this.accessible = true;
        SoundManager.instance.onMuteChange.add(this.updateIcon, this);
        this.updateIcon(SoundManager.instance.isMuted);
        this.reposition();
    }

    private updateIcon(muted: boolean): void {
        this.accessibleTitle = muted ? 'Unmute sound' : 'Mute sound';
        setIcon(this.icon, muted ? 'PictoIcon_Sound_Off' : 'PictoIcon_Sound', ICON_SIZE);
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        this.position.set(screen.topRight.x - 44, screen.topLeft.y + 44);
    }

    public override destroy(options?: PIXI.IDestroyOptions | boolean): void {
        SoundManager.instance.onMuteChange.remove(this.updateIcon, this);
        super.destroy(options);
    }
}
