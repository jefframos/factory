import { BasePopup, PopupData } from '@core/popup/BasePopup';
import BaseButton from '@core/ui/BaseButton';
import { TimerConversionUtils } from '@core/utils/TimeConversionUtils';
import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import MatchManager from '../2048/scene/MatchManager';
import { ConfettiEffect } from '../jigsaw/ui/ConfettiEffect';

interface GameOverPopupData extends PopupData {
    matchManager: MatchManager;
    rewardAmount: number;
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
    private displayReward: number = 0;

    constructor() {
        super();

        // 1. Blackout Background
        this.blackout = new PIXI.Graphics();
        this.blackout.beginFill(0x000000, 0.15);
        this.blackout.drawRect(-2000, -2000, 4000, 4000); // Large enough to cover screen
        this.blackout.endFill();
        this.addChild(this.blackout);

        // 2. Shine Texture (Background Rotation)
        this.shine = PIXI.Sprite.from('Image_Effect_Rotate'); // Ensure this asset exists
        this.shine.anchor.set(0.5);
        this.shine.alpha = 0.1;
        this.shine.scale.set(1.5);
        this.shine.tint = 0xf0f04a
        this.addChild(this.shine);

        this.flag = new PIXI.NineSlicePlane(PIXI.Texture.from('Title_Ribbon01_Green'), 150, 20, 150, 20); // Ensure this asset exists
        this.flag.width = 700
        this.flag.pivot.set(this.flag.width / 2, this.flag.height / 2)
        this.flag.scale.set(1);
        this.addChild(this.flag);

        // 3. Title Label
        this.titleLabel = new PIXI.Text('PUZZLE SOLVED!', {
            fontFamily: 'LEMONMILK-Bold',
            fontSize: 42,
            fill: 0xffffff,
            stroke: "#0c0808",
            strokeThickness: 6,
        });
        this.titleLabel.anchor.set(0.5);
        this.titleLabel.y = -250;
        this.addChild(this.titleLabel);

        this.flag.x = this.titleLabel.x
        this.flag.y = this.titleLabel.y + 10

        // 4. Prize Icon (Pop center)
        this.prizeIcon = PIXI.Sprite.from('ResourceBar_Single_Icon_Coin'); // Icon representing reward
        this.prizeIcon.anchor.set(0.5);
        this.prizeIcon.scale.set(0);
        this.addChild(this.prizeIcon);

        // 5. Reward Text (Inside Icon)
        this.rewardText = new PIXI.Text('0', {
            fontFamily: 'LEMONMILK-Bold',
            fontSize: 56,
            fill: 0xffffff,
            stroke: 0x000000,
            strokeThickness: 10
        });
        this.rewardText.anchor.set(0.5);
        this.rewardText.alpha = 0;
        this.addChild(this.rewardText);

        // 6. Timer Text
        this.timerText = new PIXI.Text('Time: 00:00', {
            fontFamily: 'LEMONMILK-Regular',
            fontSize: 32,
            fill: 0xcccccc,
            stroke: "#0c0808",
            strokeThickness: 3,
        });
        this.timerText.anchor.set(0.5);
        this.timerText.y = 150;
        this.timerText.alpha = 0;
        this.addChild(this.timerText);

        // 7. Continue Button
        this.continueButton = new BaseButton({
            standard: {
                width: 280,
                height: 80,
                texture: PIXI.Texture.from('ResourceBar_Single_Btn_Blue1'),
                allPadding: 20,

                fontStyle: new PIXI.TextStyle({
                    fontFamily: "LEMONMILK-Bold",
                    fontSize: 32,
                    fill: 0xffffff,
                    stroke: "#0c0808",
                    strokeThickness: 3,
                })
            },
            over: { texture: PIXI.Texture.from('ResourceBar_Single_Btn_Green1') },
            click: { callback: () => this.popupManager.hideCurrent() }
        });
        this.continueButton.setLabel('CONTINUE');
        this.continueButton.x = -280 / 2;
        this.continueButton.y = 280;
        this.continueButton.alpha = 0;
        this.continueButton.visible = false;
        this.addChild(this.continueButton);

        this.visible = false;

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
        console.log(data)
        this.visible = true;
        this.alpha = 1;

        this.confetti.start();
        // Reset states
        this.displayReward = 0;
        this.rewardText.text = "";
        this.timerText.text = `Time: ${TimerConversionUtils.toUncappedMinutesSeconds(data.matchManager.matchTimer * 1000)}`;

        const tl = gsap.timeline();

        // 1. Fade in Background & Shine
        tl.fromTo([this.blackout, this.shine, this.titleLabel], { alpha: 0 }, { alpha: 1, duration: 0.5 });

        this.prizeIcon.texture = data.isSpecial ? PIXI.Texture.from('ResourceBar_Single_Icon_Gem') : PIXI.Texture.from('ResourceBar_Single_Icon_Coin');
        // 2. Pop the Prize Icon
        tl.to(this.prizeIcon.scale, { x: 2, y: 2, duration: 0.4, ease: "back.out(1.7)" });

        // 3. Show and Tween Reward Value
        tl.to(this.rewardText, { alpha: 1, duration: 0.2 }, "-=0.2");
        tl.to(this, {
            displayReward: data.rewardAmount || 100,
            duration: 1,
            ease: "power1.out",
            onUpdate: () => {
                this.rewardText.text = `+${Math.ceil(this.displayReward)}`;
            }
        });

        // 4. Fade in Timer
        tl.to(this.timerText, { alpha: 1, y: 180, duration: 0.5, ease: "power2.out" });

        // 5. Show Continue Button
        tl.set(this.continueButton, { visible: true });
        tl.to(this.continueButton, { alpha: 1, y: 250, duration: 0.5, ease: "back.out(1.2)" });

        await tl;
    }

    async transitionOut(): Promise<void> {
        await gsap.to(this, { alpha: 0, duration: 0.3 });
        this.visible = false;
    }
}