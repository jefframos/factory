import AutoPositionTiledContainer from '@core/tiled/AutoPositionTiledContainer';
import { ExtratedTiledTileData } from '@core/tiled/ExtractTiledFile';
import { PinMode, ScaleMode } from '@core/tiled/TiledAutoPositionObject';
import { FoundTiledObject } from '@core/tiled/TiledLayerObject';
import BaseButton, { ButtonState } from '@core/ui/BaseButton';
import * as PIXI from 'pixi.js';

export default class MainMenuUi extends AutoPositionTiledContainer {
    private buttons: BaseButton[] = [];
    private buttonWidth = 150;
    private buttonHeight = 90;
    private spacing = 20;

    private tiledButtonsContainer: FoundTiledObject;

    constructor(mainMenuData: ExtratedTiledTileData, layers?: string[]) {
        super(mainMenuData, layers, { scaleMode: ScaleMode.FIT, matchRatio: 0 }, { pinMode: PinMode.BOTTOM });

        this.tiledButtonsContainer = this.findFromProperties('id', 'buttons-list');

    }

    registerButton(label: string, callback: () => void): void {
        const button = new BaseButton({
            standard: {
                allPadding: 35,
                texture: PIXI.Texture.from('Button01_s_Blue'),
                fontStyle: new PIXI.TextStyle({
                    fontFamily: 'LEMONMILK-Bold',
                    fill: 0xffffff,
                    stroke: "#0c0808",
                    strokeThickness: 4,
                }),
                fitText: 0.8
            },
            over: {
                texture: PIXI.Texture.from('Button01_s_Purple'),
            },
            click: {
                callback: callback
            }
        });

        this.buttons.push(button);
        button.setLabel(label);
        this.tiledButtonsContainer?.view?.addChild(button);

        this.updateButtonLayout();
    }

    private updateButtonLayout(): void {
        if (!this.tiledButtonsContainer?.object) {
            return;
        }
        const containerWidth = this.tiledButtonsContainer?.object.width;
        const containerHeight = this.tiledButtonsContainer?.object.height;

        const totalSpacing = this.spacing * (this.buttons.length - 1);
        const maxButtonWidth = (containerWidth - totalSpacing) / this.buttons.length;
        const buttonHeight = Math.min(this.buttonHeight, containerHeight); // limit height

        this.buttons.forEach((btn, index) => {
            btn.overrider(ButtonState.STANDARD, { width: maxButtonWidth, height: buttonHeight });
            btn.position.set(index * (maxButtonWidth + this.spacing), 0);
        });
    }

}
