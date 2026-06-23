import { GameScene } from "@core/scene/GameScene";
import BaseButton from "@core/ui/BaseButton";
import { Signal } from "signals";
import * as PIXI from 'pixi.js';

export default class BaseDemoScene extends GameScene {
    public destroy(): void {
        throw new Error("Method not implemented.");
    }
    public onButtonPressed: Signal = new Signal();

    private closeButton!: BaseButton;
    public async build(): Promise<void> {

        const buttonWidth = 250;
        const buttonHeight = 80;
        this.closeButton = new BaseButton({
            standard: {
                allPadding: 35,
                texture: PIXI.Texture.from('Button01_s_Purple.webp'),
                width: buttonWidth,
                height: buttonHeight,
                fontStyle: new PIXI.TextStyle({
                    fontFamily: 'LEMONMILK-Bold',
                    fill: 0xffffff,
                    stroke: "#0c0808",
                    strokeThickness: 4,
                }),
            },
            over: {
                texture: PIXI.Texture.from('Button01_s_Purple.webp'),
            },
            click: {
                callback: () => {
                    this.onButtonPressed.dispatch(data.id);
                }
            }
        });

    }
    public update(delta: number) {
        this.sortChildren();
    }
}