import SoundManager from "@core/audio/SoundManager";
import BaseButton from "@core/ui/BaseButton";
import * as PIXI from "pixi.js";

export default class SoundToggleLargeButton extends BaseButton {
    private onTexture: PIXI.Texture;
    private offTexture: PIXI.Texture;

    constructor(width: number, height: number, onTex: PIXI.Texture, offTex: PIXI.Texture) {


        // 2. Initialize the BaseButton with default "On" state
        super({
            standard: {
                width: width,
                height: height,
                texture: PIXI.Texture.from("Button_SkillBtn_Blue"),
                fontStyle: new PIXI.TextStyle({ fill: "#ffffff", fontSize: 24, fontWeight: "bold" }),
                iconTexture: onTex,
                iconSize: { height: 45, width: 45 },
                centerIconVertically: true,
                textOffset: new PIXI.Point(40, 0),
                iconOffset: new PIXI.Point(20, 0),
            },
            click: {
                callback: () => SoundManager.instance.toggleMute()
            }
        });

        this.setLabel("Sound: ON")
        this.onTexture = onTex;
        this.offTexture = offTex;

        // 3. Hook into SoundManager signals
        SoundManager.instance.onMuteChange.add(this.updateSoundState, this);

        // 4. Initial sync
        this.updateSoundState(SoundManager.instance.isMuted);
    }

    private updateSoundState(isMuted: boolean): void {
        // Swap the icon texture and the text label based on state
        const targetIcon = isMuted ? this.offTexture : this.onTexture;
        const targetText = isMuted ? "Sound: OFF" : "Sound: ON";

        // Accessing the internal icon sprite from BaseButton (assuming standard property names)
        // If your BaseButton doesn't expose the icon/label directly, you may need a public update method in BaseButton
        if (this.icon) {
            this.icon.texture = targetIcon;
        }

        this.setLabel(targetText)

    }

    public destroy(options?: any): void {
        SoundManager.instance.onMuteChange.remove(this.updateSoundState, this);
        super.destroy(options);
    }
}