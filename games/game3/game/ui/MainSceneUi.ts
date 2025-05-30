import AutoPositionTiledContainer from '@core/tiled/AutoPositionTiledContainer';
import { ExtratedTiledTileData } from '@core/tiled/ExtractTiledFile';
import { ScaleMode } from '@core/tiled/TiledAutoPositionObject';
import { FoundTiledObject } from '@core/tiled/TiledLayerObject';
import BaseButton from '@core/ui/BaseButton';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';

export default class MainSceneUi extends AutoPositionTiledContainer {
    private buttons: BaseButton[] = [];
    private buttonWidth = 150;
    private buttonHeight = 90;
    private spacing = 20;

    private tiledButtonsContainer: FoundTiledObject;

    public onPlay: Signal = new Signal()

    constructor(mainMenuData: ExtratedTiledTileData, layers?: string[]) {
        super(mainMenuData, layers, { scaleMode: ScaleMode.FIT, matchRatio: 0 }, { pinAnchor: new PIXI.Point(0.5, 1) });

        const play = this.findFromProperties('id', 'play-button');

        const button = new BaseButton({
            standard: {
                texturePadding: { left: 90, right: 90, top: 0, bottom: 0 },
                width: play?.object.width,
                height: play?.object.height,
                texture: PIXI.Texture.from('Button_Tapered_Yellow'),
                fontStyle: new PIXI.TextStyle({
                    fontFamily: 'LEMONMILK-Bold',
                    fill: 0xffffff,
                    stroke: "#0c0808",
                    strokeThickness: 8,
                    letterSpacing: 4,
                    fontSize: 72
                }),
                fitText: 0.8
            },
            over: {
                texture: PIXI.Texture.from('Button_Tapered_Yellow'),
                tint: 0xeeeeee
            },
            click: {
                callback: () => {
                    this.onPlay.dispatch();
                }
            }
        });
        button.setLabel('PLAY')
        this.addAtId(button, 'play-button')
    }


}
