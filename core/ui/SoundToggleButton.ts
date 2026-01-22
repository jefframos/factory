import SoundManager from "@core/audio/SoundManager";
import * as PIXI from "pixi.js";

export default class SoundToggleButton extends PIXI.Container {
    private iconOn: PIXI.Sprite;
    private iconOff: PIXI.Sprite;

    constructor(onTextureName: string, offTextureName: string) {
        super();

        // 1. Create the icons
        this.iconOn = PIXI.Sprite.from(onTextureName);
        this.iconOff = PIXI.Sprite.from(offTextureName);

        // Center anchors (optional, depends on your layout)
        this.iconOn.anchor.set(0.5);
        this.iconOff.anchor.set(0.5);

        this.addChild(this.iconOn);
        this.addChild(this.iconOff);

        // 2. Setup interaction
        this.interactive = true;
        this.cursor = 'pointer';
        this.on('pointertap', () => {
            SoundManager.instance.toggleMute();
        });

        // 3. Hook into the Signal
        SoundManager.instance.onMuteChange.add(this.updateVisuals, this);

        // 4. Initial state sync
        this.updateVisuals(SoundManager.instance.isMuted);
    }

    /**
     * Toggles visibility of icons based on mute status
     */
    private updateVisuals(isMuted: boolean): void {
        this.iconOn.visible = !isMuted;
        this.iconOff.visible = isMuted;
    }

    /**
     * Always good practice to remove listeners when the object is destroyed
     */
    public destroy(options?: any): void {
        SoundManager.instance.onMuteChange.remove(this.updateVisuals, this);
        super.destroy(options);
    }
}