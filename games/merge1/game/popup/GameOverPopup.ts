import { BasePopup, PopupData } from '@core/popup/BasePopup';
import BaseButton from '@core/ui/BaseButton';
import { ConfettiEffect } from '@core/ui/ConfettiEffect';
import { LevelDefinition } from 'games/game4/types';
import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import MergeAssets from '../MergeAssets';


interface GameOverPopupData extends PopupData {
    rewardAmount: number;
    nextPuzzle?: LevelDefinition;
    isSpecial?: boolean;
}

export class GameOverPopup extends BasePopup {
    transitionInComplete(): void {
        //throw new Error('Method not implemented.');
    }
    hide(): void {
        //throw new Error('Method not implemented.');
    }
    private blackout: PIXI.Graphics;
    private shine: PIXI.Sprite;
    private flag: PIXI.NineSlicePlane;
    private prizeIcon: PIXI.Sprite;
    private rewardText: PIXI.Text;
    private timerText: PIXI.Text;
    private titleLabel: PIXI.Text;
    private continueButton: BaseButton;
    private confetti: ConfettiEffect;


    constructor() {
        super();

        // 1. Blackout Background
        this.blackout = new PIXI.Graphics();
        this.blackout.beginFill(0x000000, 0.15);
        this.blackout.drawRect(-2000, -2000, 4000, 4000); // Large enough to cover screen
        this.blackout.endFill();
        this.addChild(this.blackout);

        // 2. Shine Texture (Background Rotation)
        this.shine = PIXI.Sprite.from(MergeAssets.Textures.UI.Shine); // Ensure this asset exists
        this.shine.anchor.set(0.5);
        this.shine.alpha = 0.1;
        this.shine.scale.set(1.5);
        this.shine.tint = 0xf0f04a
        this.addChild(this.shine);

        this.flag = new PIXI.NineSlicePlane(PIXI.Texture.from(MergeAssets.Textures.UI.EndRibbon), 100, 20, 100, 20); // Ensure this asset exists
        this.flag.width = 900
        this.flag.pivot.set(this.flag.width / 2, this.flag.height / 2)
        this.flag.scale.set(0.5);
        this.addChild(this.flag);

        // 3. Title Label
        this.titleLabel = new PIXI.Text('PUZZLE SOLVED!', new PIXI.TextStyle({ ...MergeAssets.MainFontTitle, fontSize: 42, strokeThickness: 10 }));
        this.titleLabel.anchor.set(0.5);
        this.titleLabel.y = -260;
        this.addChild(this.titleLabel);

        this.flag.x = this.titleLabel.x
        this.flag.y = this.titleLabel.y

        // 4. Prize Icon (Pop center)
        this.prizeIcon = PIXI.Sprite.from(MergeAssets.Textures.Icons.Coin); // Icon representing reward
        this.prizeIcon.anchor.set(0.5);
        this.prizeIcon.scale.set(0);
        this.addChild(this.prizeIcon);

        // 5. Reward Text (Inside Icon)
        this.rewardText = new PIXI.Text('0', new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 50, strokeThickness: 10 }));
        this.rewardText.anchor.set(0.5);
        this.rewardText.alpha = 0;
        this.addChild(this.rewardText);

        // 6. Timer Text
        this.timerText = new PIXI.Text('Time: 00:00', new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 32 }),);
        this.timerText.anchor.set(0.5);
        this.timerText.y = 150;
        this.timerText.alpha = 0;
        this.addChild(this.timerText);

        // 7. Continue Button
        this.continueButton = new BaseButton({
            standard: {
                width: 280,
                height: 80,
                texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Blue),
                allPadding: 20,

                fontStyle: new PIXI.TextStyle({ ...MergeAssets.MainFont }),
            },
            over: { tint: 0xcccccc, texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Blue) },
            click: { callback: () => this.popupManager.hideCurrent() }
        });
        this.continueButton.setLabel('CONTINUE');
        this.continueButton.x = -280 / 2;
        this.continueButton.y = 280;
        this.continueButton.alpha = 0;
        this.continueButton.visible = false;
        this.addChild(this.continueButton);

        this.confetti = new ConfettiEffect(150);
        this.addChild(this.confetti);

    }

    override update(delta: number): void {
        // Rotate shine background
        if (this.visible) {
            this.shine.rotation += 1.5 * delta;

            this.confetti?.update(delta);
        }
    }

    async transitionIn(data: GameOverPopupData): Promise<void> {
        console.log(data.nextPuzzle)
        this.visible = true;
        this.alpha = 1;
        const tl = gsap.timeline();
        await tl;
    }

    async transitionOut(): Promise<void> {
        await gsap.to(this, { alpha: 0, duration: 0.3 });
        this.visible = false;
    }
}