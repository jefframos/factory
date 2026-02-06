import { Game } from "@core/Game";
import { GameScene } from "@core/scene/GameScene";
import BaseButton from "@core/ui/BaseButton";
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';

export interface MenuButtonData {
    id: string;
    label: string;
}

export default class MainMenuScene extends GameScene {

    public onButtonPressed: Signal = new Signal();

    private title!: PIXI.Text;
    private buttonContainer = new PIXI.Container();
    private buttons: BaseButton[] = [];

    constructor(buttonData: MenuButtonData[]) {
        super();
        const buttonWidth = 250;
        const buttonHeight = 80;
        const spacing = 20;

        // Clear existing
        this.removeChildren();
        this.buttons = [];
        console.log(buttonData)
        // Add container to scene
        this.addChild(this.buttonContainer);

        // Create buttons
        buttonData.forEach((data, index) => {
            const button = new BaseButton({
                standard: {
                    allPadding: 35,
                    texture: PIXI.Texture.from('Button01_s_Blue.png'),
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
                    texture: PIXI.Texture.from('Button01_s_Purple.png'),
                },
                click: {
                    callback: () => {
                        this.onButtonPressed.dispatch(data.id);
                    }
                }
            });

            button.setLabel(data.label);

            button.pivot.set(buttonWidth / 2, buttonHeight / 2);
            button.y = index * (buttonHeight + spacing);
            button.x = buttonWidth / 2;

            this.buttonContainer.addChild(button);
            this.buttons.push(button);
        });

        const totalHeight = buttonData.length * buttonHeight + (buttonData.length - 1) * spacing;
        this.buttonContainer.pivot.set(buttonWidth / 2, totalHeight / 2);

        // Create and add title
        this.title = new PIXI.Text('Main Menu', {
            fontFamily: 'LEMONMILK-Bold',
            fontSize: 48,
            fill: 0xffffff,
        });
        this.title.anchor.set(0.5);
        this.addChild(this.title);
    }
    public build(...data: any[]): void {

    }
    public override destroy(): void {
    }

    public update(delta: number): void {
        const center = Game.gameScreenData.center;

        // center the button container
        this.buttonContainer.position.set(center.x, center.y);

        // position the title above
        this.title.position.set(center.x, center.y - this.buttonContainer.height / 2 - 120);
    }
}
