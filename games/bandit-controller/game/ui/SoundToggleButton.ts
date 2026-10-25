import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import SoundManager from 'core/audio/SoundManager';

export default class SoundToggleButton extends PIXI.Container {
    private readonly icon = new PIXI.Graphics();

    public constructor() {
        super();
        this.name = 'sound-toggle';
        const background = new PIXI.Graphics();
        background.beginFill(0x000000, 0.2).drawCircle(0, 4, 30).endFill();
        background.beginFill(0xffffff).lineStyle(4, 0x2a6fb0).drawCircle(0, 0, 30).endFill();
        this.addChild(background, this.icon);
        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.hitArea = new PIXI.Circle(0, 0, 34);
        this.on('pointertap', () => SoundManager.instance.toggleMute());
        SoundManager.instance.onMuteChange.add(this.updateIcon, this);
        this.updateIcon(SoundManager.instance.isMuted);
        this.reposition();
    }

    private updateIcon(muted: boolean): void {
        this.accessible = true;
        this.accessibleTitle = muted ? 'Unmute sound' : 'Mute sound';
        this.icon.clear().beginFill(0x244e6d);
        this.icon.drawPolygon([-17, -7, -9, -7, 1, -15, 1, 15, -9, 7, -17, 7]).endFill();
        this.icon.lineStyle(3, muted ? 0xdf4c54 : 0x244e6d);
        if (muted) {
            this.icon.moveTo(8, -8).lineTo(21, 8).moveTo(21, -8).lineTo(8, 8);
        } else {
            this.icon.arc(1, 0, 12, -0.8, 0.8);
            this.icon.moveTo(15, -14).arc(1, 0, 20, -0.8, 0.8);
        }
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
