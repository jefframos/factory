import PlatformHandler from '@core/platforms/PlatformHandler';
import { BasePopup, PopupData } from '@core/popup/BasePopup';
import BaseButton from '@core/ui/BaseButton';
import { TimerConversionUtils } from '@core/utils/TimeConversionUtils';
import { LevelDefinition } from 'games/game4/types';
import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import { ConfettiEffect } from '../../../../core/ui/ConfettiEffect';
import MatchManager from '../2048/scene/MatchManager';
import Assets from '../jigsaw/Assets';
import { InGameEconomy } from '../jigsaw/data/InGameEconomy';
import GameplayJigsawScene from '../jigsaw/GameplayJigsawScene';
import { CurrencyHud } from '../jigsaw/ui/CurrencyHud';
import { NextLevelCard } from '../jigsaw/ui/NextLevelCard';
import { CoinEffect } from '../jigsaw/vfx/CoinEffect';

interface GameOverPopupData extends PopupData {
    matchManager: MatchManager;
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
    private displayReward: number = 0;

    private currencyHud: CurrencyHud;

    private coinEffect: CoinEffect;
    private lastCeilReward: number = 0; // To track integer changes

    private nextLevelCard: NextLevelCard;
    private tempNextLevel: LevelDefinition | undefined;


    private doubleRewardButton: BaseButton;
    private currentReward: number = 0;
    private isSpecial: boolean = false;
    private puzzlePieces: PIXI.Sprite[] = [];

    constructor() {
        super();

        // 1. Blackout Background
        this.blackout = new PIXI.Graphics();
        this.blackout.beginFill(0x000000, 0.15);
        this.blackout.drawRect(-2000, -2000, 4000, 4000); // Large enough to cover screen
        this.blackout.endFill();
        this.addChild(this.blackout);

        // 2. Shine Texture (Background Rotation)
        this.shine = PIXI.Sprite.from(Assets.Textures.UI.Shine); // Ensure this asset exists
        this.shine.anchor.set(0.5);
        this.shine.alpha = 0.1;
        this.shine.scale.set(1.5);
        this.shine.tint = 0xf0f04a
        this.addChild(this.shine);

        this.flag = new PIXI.NineSlicePlane(PIXI.Texture.from(Assets.Textures.UI.EndRibbon), 100, 20, 100, 20); // Ensure this asset exists
        this.flag.width = 900
        this.flag.pivot.set(this.flag.width / 2, this.flag.height / 2)
        this.flag.scale.set(0.5);
        this.addChild(this.flag);

        // 3. Title Label
        this.titleLabel = new PIXI.Text('PUZZLE SOLVED!', new PIXI.TextStyle({ ...Assets.MainFontTitle, fontSize: 42, strokeThickness: 10 }));
        this.titleLabel.anchor.set(0.5);
        this.titleLabel.y = -260;
        this.addChild(this.titleLabel);

        this.flag.x = this.titleLabel.x
        this.flag.y = this.titleLabel.y

        // 4. Prize Icon (Pop center)
        this.prizeIcon = PIXI.Sprite.from(Assets.Textures.Icons.Coin); // Icon representing reward
        this.prizeIcon.anchor.set(0.5);
        this.prizeIcon.scale.set(0);
        this.addChild(this.prizeIcon);

        // 5. Reward Text (Inside Icon)
        this.rewardText = new PIXI.Text('0', new PIXI.TextStyle({ ...Assets.MainFont, fontSize: 50, strokeThickness: 10 }));
        this.rewardText.anchor.set(0.5);
        this.rewardText.alpha = 0;
        this.addChild(this.rewardText);

        // 6. Timer Text
        this.timerText = new PIXI.Text('Time: 00:00', new PIXI.TextStyle({ ...Assets.MainFont, fontSize: 32 }),);
        this.timerText.anchor.set(0.5);
        this.timerText.y = 150;
        this.timerText.alpha = 0;
        this.addChild(this.timerText);

        // 7. Continue Button
        this.continueButton = new BaseButton({
            standard: {
                width: 250,
                height: 70,
                texture: PIXI.Texture.from(Assets.Textures.Buttons.Blue),
                allPadding: 20,

                fontStyle: new PIXI.TextStyle({ ...Assets.MainFont }),
            },
            over: { tint: 0xcccccc, texture: PIXI.Texture.from(Assets.Textures.Buttons.Blue) },
            click: { callback: () => this.popupManager.hideCurrent() }
        });
        this.continueButton.setLabel('CONTINUE');
        this.continueButton.x = -250 / 2;
        this.continueButton.y = 280;
        this.continueButton.alpha = 0;
        this.continueButton.visible = false;
        this.addChild(this.continueButton);


        this.currencyHud = new CurrencyHud({
            textStyle: new PIXI.TextStyle({
                ...Assets.MainFont, fontSize: 42,
                //strokeThickness: 8,
            }),
            currencyIcon: Assets.Textures.Icons.Coin,// 'ResourceBar_Single_Icon_Coin',
            specialCurrencyIcon: 'ResourceBar_Single_Icon_Gem',
            bgTexture: PIXI.Texture.from(Assets.Textures.UI.FadeShape),// PIXI.Texture.from('fade-shape'),
            bgNineSlice: { left: 10, top: 10, right: 10, bottom: 10 },
            padding: 20
        });
        this.addChild(this.currencyHud);
        this.currencyHud.x = -this.currencyHud.width / 2
        this.currencyHud.y = - 400

        this.visible = false;

        this.confetti = new ConfettiEffect(150);
        this.addChild(this.confetti);

        this.coinEffect = new CoinEffect();
        this.addChild(this.coinEffect); // Add on top of other elements

        this.nextLevelCard = new NextLevelCard(280, 350);
        this.nextLevelCard.y = 0; // Position below the reward
        this.nextLevelCard.onClicked.add(() => {
            GameplayJigsawScene.FLOATING_LEVEL = this.tempNextLevel;

            this.popupManager.hideCurrent()

        })
        //this.nextLevelCard.visible = false;
        // this.nextLevelCard.onClicked.add(() => this.onNextLevelClicked());
        this.addChild(this.nextLevelCard);

        this.doubleRewardButton = new BaseButton({
            standard: {
                width: 350,
                height: 90,
                texture: PIXI.Texture.from(Assets.Textures.Buttons.Gold || Assets.Textures.Buttons.Blue),
                allPadding: 20,
                iconTexture: PIXI.Texture.from(Assets.Textures.Icons.Video),
                centerIconVertically: true,
                iconOffset: new PIXI.Point(-50, 0),
                textOffset: new PIXI.Point(30, 0),
                fontStyle: new PIXI.TextStyle({ ...Assets.MainFont, fontSize: 28, wordWrap: true, wordWrapWidth: 300, align: 'center' }),
            },
            over: { tint: 0xeeeeee },
            click: {
                callback: () => PlatformHandler.instance.platform.showRewardedVideo().then(() => {
                    this.onDoubleRewardClicked()
                })
            }
        });
        this.doubleRewardButton.setLabel('DOUBLE REWARDS!');
        this.doubleRewardButton.pivot.set(0.5 * 350, 0.5 * 90);
        this.doubleRewardButton.y = 380; // Positioned below the continue button
        this.doubleRewardButton.alpha = 0;
        this.addChild(this.doubleRewardButton);

        // Create a pool of small pieces for the animation
        for (let i = 0; i < 6; i++) {
            const piece = PIXI.Sprite.from(Assets.Textures.Icons.Coin);
            piece.anchor.set(0.5);
            piece.visible = false;
            this.addChild(piece);
            this.puzzlePieces.push(piece);
        }
    }

    private async onDoubleRewardClicked(): Promise<void> {
        // 1. Hide the button immediately to prevent double clicks and clear the UI
        gsap.to(this.doubleRewardButton, {
            alpha: 0,
            duration: 0.2,
            onComplete: () => {
                this.doubleRewardButton.visible = false;
            }
        });

        // 2. Animate Jigsaw Pieces (Burst effect)
        this.puzzlePieces.forEach((piece, i) => {
            // Use the Jigsaw Icon for the "puzzle" feel if available, else fallback to Coin
            piece.texture = PIXI.Texture.from(Assets.Textures.Icons.JigsawPiece || Assets.Textures.Icons.Coin);
            piece.visible = true;
            piece.alpha = 1;
            piece.scale.set(0);
            piece.position.set(0, 0);

            const angle = (i / this.puzzlePieces.length) * Math.PI * 2;
            const dist = 180 + Math.random() * 60; // Slightly further burst for impact

            gsap.to(piece.scale, { x: 0.7, y: 0.7, duration: 0.4, ease: "back.out(1.7)" });
            gsap.to(piece, {
                x: Math.cos(angle) * dist,
                y: Math.sin(angle) * dist,
                rotation: (Math.random() > 0.5 ? 1 : -1) * Math.PI * 2, // Random spin direction
                duration: 0.9,
                ease: "power2.out",
                onComplete: () => {
                    gsap.to(piece, { alpha: 0, duration: 0.3 });
                }
            });
        });

        // 3. Add to economy and trigger the visual count-up
        InGameEconomy.instance.addCurrency(this.currentReward, false);

        const newTotal = this.currentReward * 2;
        this.animateRewardIncrease(newTotal);
    }

    private animateRewardIncrease(targetValue: number): void {
        // We use back.out to give the number a little "bounce" as it grows
        gsap.to(this, {
            displayReward: targetValue,
            duration: 1.2,
            ease: "back.out(1.2)",
            onUpdate: () => {
                const currentCeil = Math.ceil(this.displayReward);
                if (currentCeil > this.lastCeilReward) {
                    this.rewardText.text = `${currentCeil}`;

                    // Visual feedback: fly a coin to the HUD for every increment
                    this.coinEffect.flyCoinFromTo(
                        { x: this.rewardText.x, y: this.rewardText.y },
                        { x: this.currencyHud.x, y: this.currencyHud.y },
                        0.5,
                        () => { }//this.currencyHud.popCoin()
                    );
                    this.lastCeilReward = currentCeil;
                }
            }
        });
    }

    override update(delta: number): void {
        // Rotate shine background
        if (this.visible) {
            this.shine.rotation += 1.5 * delta;

            this.confetti?.update(delta);
        }
    }

    async transitionIn(data: GameOverPopupData): Promise<void> {
        this.visible = true;
        this.alpha = 1;

        this.confetti.start();

        if (data.nextPuzzle) {

        }

        if (!data.rewardAmount) {
            data.rewardAmount = 30
        }
        // Reset states
        this.displayReward = 0;
        this.currentReward = data.rewardAmount;
        this.rewardText.text = "";
        this.timerText.text = `Time: ${TimerConversionUtils.toUncappedMinutesSeconds(data.matchManager.matchTimer * 1000)}`;


        this.isSpecial = !!data.isSpecial;
        // Ensure button is visible and reset for every new popup show
        this.doubleRewardButton.visible = true;
        this.doubleRewardButton.alpha = 0;
        this.doubleRewardButton.y = 450; // Start slightly lower


        const tl = gsap.timeline();

        this.lastCeilReward = 0;

        // 1. Fade in Background & Shine
        tl.fromTo([this.blackout, this.shine, this.titleLabel], { alpha: 0 }, { alpha: 1, duration: 0.5 });

        this.prizeIcon.texture = data.isSpecial ? PIXI.Texture.from(Assets.Textures.Icons.Gem) : PIXI.Texture.from(Assets.Textures.Icons.Coin);
        // 2. Pop the Prize Icon
        tl.to(this.prizeIcon.scale, { x: 1.25, y: 1.25, duration: 0.4, ease: "back.out(1.7)" });

        // 4. Fade in Timer
        this.timerText.y = -100
        this.timerText.alpha = 0
        tl.to(this.timerText, { alpha: 1, y: -150, duration: 0.5, ease: "power2.out" });
        // 3. Show and Tween Reward Value
        tl.to(this.rewardText, { alpha: 1, duration: 0.2 }, "-=0.2");
        tl.to(this, {
            displayReward: data.rewardAmount,
            duration: 1, // Slightly longer looks nicer with coins
            ease: "power1.inOut",
            onUpdate: () => {
                const currentCeil = Math.ceil(this.displayReward);

                // If the integer changed, fire a coin
                if (currentCeil > this.lastCeilReward) {
                    this.rewardText.text = `${currentCeil}`;


                    // Fire coin effect
                    this.coinEffect.flyCoinFromTo(
                        { x: this.rewardText.x, y: this.rewardText.y },
                        { x: this.currencyHud.x, y: this.currencyHud.y },
                        0.6,
                        () => { }//this.currencyHud.popCoin() // Your requested function
                    );

                    this.lastCeilReward = currentCeil;
                }
            }
        });



        this.tempNextLevel = undefined;
        if (data.nextPuzzle) {
            console.log(data)

            this.tempNextLevel = data.nextPuzzle;
            this.continueButton.setLabel('CONTINUE');
            //this.continueButton.overrider(ButtonState.STANDARD, { texture: PIXI.Texture.from(Assets.Textures.Buttons.Grey) })



            this.nextLevelCard.visible = true;
            this.nextLevelCard.setup(data.nextPuzzle);

            this.nextLevelCard.x = 0// - this.nextLevelCard.width / 2

            // Animate it in with the rest of the UI
            tl.fromTo(this.nextLevelCard, { alpha: 0, y: 500 }, { alpha: 1, y: 60, duration: 0.5 }, "-=0.3");
        } else {
            this.continueButton.setLabel('CONTINUE');
            //this.continueButton.overrider(ButtonState.STANDARD, { texture: PIXI.Texture.from(Assets.Textures.Buttons.Blue) })

            this.nextLevelCard.visible = false;

        }

        tl.to(this.doubleRewardButton, {
            alpha: 1,
            y: 300,
            duration: 0.5,
            ease: "back.out(1.2)"
        }, "-=0.2");

        this.continueButton.alpha = 0;
        this.continueButton.visible = false;
        tl.set(this.continueButton, { visible: true });
        tl.to(this.continueButton, { alpha: 1, y: 380, duration: 0.5, ease: "back.out(1.2)" });



        await tl;

    }

    async transitionOut(): Promise<void> {
        await gsap.to(this, { alpha: 0, duration: 0.3 });
        this.visible = false;
    }
}