import { ExtractTiledFile } from '@core/tiled/ExtractTiledFile';
import TiledLayerObject from '@core/tiled/TiledLayerObject';
import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import { Fonts } from '../../character/Types';

export class SwipeHint extends PIXI.Container {
    private swipeSprite: PIXI.Sprite;
    private label: PIXI.BitmapText;
    private timeline: gsap.core.Timeline;

    constructor(texture: PIXI.Texture) {
        super();

        const tiled = new TiledLayerObject()
        tiled.build(ExtractTiledFile.getTiledFrom('2048'), ['TutorialMobile'])
        this.addChild(tiled);
        tiled.y = 250

        tiled.findFromProperties('id', 'back').then((obj) => {
            if (obj.view) {
                obj.view.alpha = 0.65
                obj.view.tint = 0
            }
        })

        this.swipeSprite = new PIXI.Sprite(texture);
        this.swipeSprite.anchor.set(0.5);
        this.swipeSprite.y = -20;
        this.addChild(this.swipeSprite);


        this.label = new PIXI.BitmapText('Swipe to Move', {
            fontName: Fonts.MainFamily,
            fontSize: Fonts.Main.fontSize as number,
            align: 'center',
            letterSpacing: 2
        });

        this.label.anchor.set(0.5);
        this.label.y = 60;
        this.addChild(this.label);

        this.alpha = 0;
        this.visible = false;

        this.timeline = gsap.timeline({ repeat: -1, paused: true });
        this.timeline.to(this.swipeSprite, { x: 150, duration: 0.5, ease: 'power1.inOut' })
            .to(this.swipeSprite, { x: 0, duration: 0.5, ease: 'power1.inOut' });


    }

    public show(): void {
        if (this.visible) return;

        this.visible = true;
        gsap.to(this, { alpha: 1, duration: 0.3 });
        this.timeline.play();
    }

    public hide(): void {
        gsap.to(this, {
            alpha: 0,
            duration: 0.3,
            onComplete: () => {
                this.visible = false;
                this.timeline.pause(0);
            }
        });
    }
}
