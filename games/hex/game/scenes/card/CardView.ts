import ViewUtils from '@core/utils/ViewUtils';
import * as PIXI from 'pixi.js';

export default class CardView extends PIXI.Container {
    private background: PIXI.NineSlicePlane;
    private image: PIXI.Sprite;

    constructor() {
        super();

        this.background = new PIXI.NineSlicePlane(
            PIXI.Texture.from('ItemFrame01_Single_Purple.png'),
            35, 35, 35, 35
        );
        this.background.width = 150;
        this.background.height = 220;
        this.addChild(this.background);

        this.image = new PIXI.Sprite(PIXI.Texture.from('ItemIcon_Heart_Red.Png'));
        this.image.anchor.set(0.5);
        this.image.x = this.background.width / 2;
        this.image.y = this.background.height / 2;
        this.addChild(this.image);
    }

    public setCardIcon(texture: PIXI.Texture) {
        this.image.texture = texture;

        this.image.scale.set(ViewUtils.elementScaler(this.image, this.background.width * 0.5))
    }
    public setCardTexture(texture: PIXI.Texture) {
        this.background.texture = texture;
    }
}
