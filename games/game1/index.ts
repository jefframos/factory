import { SimpleGame } from '@core/SimpleGame';
import manifestData from '../../public/game1/images/manifest.json'; // adjust path accordingly

import * as PIXI from 'pixi.js';
class MyGame extends SimpleGame {
    private mySprite: PIXI.Sprite;

    constructor() {
        super();



        this.startGame();
    }


    async startGame() {

        await PIXI.Assets.init({ manifest: manifestData, basePath: 'game1/images/' });
        await PIXI.Assets.loadBundle(['default']);

        const bunnyTexture = PIXI.Texture.from('hat-0001.png')

        this.mySprite = PIXI.Sprite.from(bunnyTexture);
        this.mySprite.anchor.set(0.5);
        this.stageContainer.addChild(this.mySprite);
        this.centerSprite();
    }


    protected override update(delta: number) {
    }

    protected override onResize() {
        super.onResize();
        this.centerSprite();
    }

    private centerSprite() {
        if (!this.mySprite) return
        this.mySprite.x = 720 / 2; // logical center
        this.mySprite.y = 1280 / 2;
    }
}

new MyGame();
