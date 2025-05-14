import { GameScene } from "@core/scene/GameScene";
import BaseButton from "@core/ui/BaseButton";
import * as PIXI from 'pixi.js';
import { Signal } from "signals";
export default class BaseDemoScene extends GameScene {
    public onButtonPressed: Signal = new Signal();

    private closeButton!: BaseButton;
    constructor() {
        super();
        this.closeButton = new BaseButton({
            standard: {
                allPadding: 35,
                texture: PIXI.Texture.from('Button01_s_Red.png'),
                width: 80,
                height: 80,
                fontStyle: new PIXI.TextStyle({
                    fontFamily: 'LEMONMILK-Bold',
                    fill: 0xffffff,
                    stroke: "#0c0808",
                    strokeThickness: 4,
                }),
            },
            over: {
                texture: PIXI.Texture.from('Button01_s_Red.png'),
            },
            click: {
                callback: () => {
                    this.onButtonPressed.dispatch();
                }
            }
        });

        this.closeButton.setLabel('X')
        this.addChild(this.closeButton)
        this.closeButton.zIndex = 1000
    }
    public destroy() {
    }
    public resize(): void {
        const global = this.toLocal(new PIXI.Point())
        this.closeButton.x = global.x + 20
        this.closeButton.y = global.y + 20
    }
    public update(delta: number) {
        this.sortChildren();
    }
}