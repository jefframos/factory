import Pool from '@core/Pool';
import { BasePopup } from '@core/popup/BasePopup';
import BaseButton, { ButtonState } from '@core/ui/BaseButton';
import { ConfettiEffect } from '@core/ui/ConfettiEffect';
import { NumberConverter } from '@core/utils/NumberConverter';
import gsap from 'gsap';
import * as PIXI from 'pixi.js';
import { CurrencyType } from '../../data/InGameEconomy';
import MergeAssets from '../../MergeAssets';
import { PrizePopupData } from '../../prize/PrizeTypes';
import PrizeViewContainer from './PrizeViewContainer';
export class PrizePopup extends BasePopup {

    transitionInComplete(): void {
        //throw new Error('Method not implemented.');
    }
    hide(): void {
        //throw new Error('Method not implemented.');
    }
    private blackout: PIXI.Graphics;
    private shine: PIXI.Sprite;
    private flag: PIXI.NineSlicePlane;
    private titleLabel: PIXI.Text;
    private continueButton: BaseButton;
    private confetti: ConfettiEffect;
    private prizeContainer: PIXI.Container;
    private lastData!: PrizePopupData;

    private videoButton: BaseButton; // New Button
    private currentDoubleCallback: (() => void) | null = null;

    private autoHideTimeout: any;
    private currentCallback: (() => void) | null = null;
    constructor() {
        super();

        this.blackout = new PIXI.Graphics().beginFill(0x000000, 0.7).drawRect(-2000, -2000, 4000, 4000).endFill();
        this.addChild(this.blackout);

        this.shine = PIXI.Sprite.from(MergeAssets.Textures.UI.Shine);
        this.shine.anchor.set(0.5);
        this.shine.alpha = 0.3;
        this.shine.tint = 0xf0f04a;
        this.addChild(this.shine);

        this.flag = new PIXI.NineSlicePlane(PIXI.Texture.from(MergeAssets.Textures.UI.EndRibbon), 150, 20, 150, 20);
        this.flag.width = 700;
        this.flag.pivot.set(350, 0);
        this.flag.y = -300;
        this.addChild(this.flag);

        this.titleLabel = new PIXI.Text('REWARD!', new PIXI.TextStyle({ ...MergeAssets.MainFontTitle, fontSize: 50 }));
        this.titleLabel.anchor.set(0.5);
        this.flag.addChild(this.titleLabel);
        this.titleLabel.x = this.flag.width / 2;
        this.titleLabel.y = 60;

        this.prizeContainer = new PIXI.Container();
        this.addChild(this.prizeContainer);

        // 1. Double/Video Button (Starts as Gold)
        this.videoButton = new BaseButton({
            standard: {
                width: 320, height: 90,
                texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Gold),
                fontStyle: new PIXI.TextStyle({ ...MergeAssets.MainFont }),
                iconTexture: PIXI.Texture.from(MergeAssets.Textures.Icons.Video),
                centerIconVertically: true,
                iconSize: { width: 120, height: 120 },
                textOffset: { x: 50, y: 0 }
            },
            click: { callback: () => this.onDouble() }
        });
        this.videoButton.setLabel('DOUBLE');
        this.videoButton.pivot.x = 320 / 2;
        this.videoButton.visible = false;
        this.addChild(this.videoButton);

        // 2. Main Claim Button
        this.continueButton = new BaseButton({
            standard: {
                width: 280, height: 80,
                texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Gold),
                fontStyle: new PIXI.TextStyle({ ...MergeAssets.MainFont }),
            },
            click: { callback: () => this.onClaim() }
        });
        this.continueButton.setLabel('CLAIM');
        this.continueButton.pivot.x = 280 / 2;
        this.continueButton.visible = false;
        this.addChild(this.continueButton);

        this.confetti = new ConfettiEffect(150);
        this.addChild(this.confetti);
    }
    async transitionIn(data: PrizePopupData): Promise<void> {
        this.visible = true;
        this.alpha = 1;
        this.lastData = data;

        // Setup Ribbon
        if (data.customRibbon) {
            this.flag.texture = PIXI.Texture.from(data.customRibbon);
        } else {
            this.flag.texture = PIXI.Texture.from(MergeAssets.Textures.UI.EndRibbon);
        }

        this.currentCallback = data.claimCallback || null;
        this.currentDoubleCallback = data.doubleCallback || null;

        this.clearPrizeContainer();
        this.clearTimer();
        this.setupButtons();

        const tl = gsap.timeline();
        tl.from(this.flag, { y: -500, duration: 0.5, ease: "back.out" });
        tl.from(this.shine.scale, { x: 0, y: 0, duration: 0.8, ease: "elastic.out(1, 0.5)" }, 0);

        data.prizes.forEach((p, index) => {
            const copy = { ...p }
            const view = Pool.instance.getElement(PrizeViewContainer);
            copy.value = NumberConverter.format(copy.value)
            view.setup(copy);
            view.x = (index - (data.prizes.length - 1) / 2) * 260;
            view.scale.set(0);
            this.prizeContainer.addChild(view);
            tl.to(view.scale, { x: 1, y: 1, duration: 0.5, ease: "back.out" }, "-=0.3");
        });

        tl.add(() => {
            this.confetti.start();
            if (data.waitForClaim) {
                this.showButtons();
            } else if (data.autoHideTimer) {
                this.autoHideTimeout = setTimeout(() => this.onClaim(), data.autoHideTimer * 1000);
            }
        });
    }

    private setupButtons(): void {
        this.videoButton.visible = false;
        this.continueButton.visible = false;

        if (this.currentDoubleCallback) {
            // Case: Double + Claim
            // Video Button takes prime spot (Center Top)
            this.videoButton.y = 150;
            this.videoButton.overrider(ButtonState.STANDARD, {
                texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Gold)
            });

            // Claim Button goes below and turns Grey
            this.continueButton.y = 310;
            this.continueButton.overrider(ButtonState.STANDARD, {
                texture: PIXI.Texture.EMPTY
            });
            this.continueButton.setLabel('NO THANKS');
        } else {
            // Case: Only Claim
            this.continueButton.y = 250;
            this.continueButton.overrider(ButtonState.STANDARD, {
                texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Gold)
            });
            this.continueButton.setLabel('CLAIM');
        }
    }

    private showButtons(): void {
        const buttons = this.currentDoubleCallback ? [this.videoButton, this.continueButton] : [this.continueButton];
        buttons.forEach(btn => {
            btn.visible = true;
            btn.alpha = 0;
            gsap.to(btn, { alpha: 1, duration: 0.3 });
        });
    }

    private onDouble(): void {
        this.clearTimer();
        this.currentDoubleCallback?.();
        this.currentDoubleCallback = null;
        this.popupManager.hideCurrent();
    }

    private onClaim(): void {
        this.clearTimer();

        // Trigger flying effects BEFORE hiding/destroying containers
        this.triggerPhysicalEffects();

        if (this.currentCallback) {
            this.currentCallback();
            this.currentCallback = null;
        }
        this.popupManager.hideCurrent();
    }

    private triggerPhysicalEffects(): void {
        const data = this.lastData; // Store 'data' in transitionIn to access here
        if (!data?.effects || !data.prizes) return;

        this.prizeContainer.children.forEach((child, index) => {
            const view = child as PrizeViewContainer;
            const prize = data.prizes[index];

            // Only fly currencies (Coins/Gems)
            if (prize.type === CurrencyType.MONEY || prize.type === CurrencyType.GEMS) {

                // 1. Get Start Position (Global to Local of Effect Layer)
                const globalPos = view.toGlobal(new PIXI.Point(0, 0));
                const startPos = data.effects!.layer.toLocal(globalPos);

                // 2. Get Target Position (HUD target Global to Local)
                const hudGlobal = data.effects!.getHudTarget(prize.type);
                const targetPos = data.effects!.layer.toLocal(hudGlobal);

                // 3. Fire!
                data.effects!.layer.popAndFlyToTarget(
                    startPos.x,
                    startPos.y,
                    targetPos.x,
                    targetPos.y,
                    view.getIconSprite(), // Add this helper to PrizeViewContainer
                    undefined,
                    () => {
                        // This internal callback triggers when the coin hits the HUD
                        //console.log(`${prize.type} hit the HUD!`);
                    }
                );

                // Hide the icon in the popup so it looks like it "flew away"
                view.hideIcon();
            }
        });
    }
    private clearTimer(): void {
        if (this.autoHideTimeout) {
            clearTimeout(this.autoHideTimeout);
            this.autoHideTimeout = null;
        }
    }

    private clearPrizeContainer(): void {
        while (this.prizeContainer.children.length > 0) {
            const child = this.prizeContainer.getChildAt(0) as PrizeViewContainer;
            this.prizeContainer.removeChild(child);
            Pool.instance.returnElement(child);
        }
    }

    async transitionOut(): Promise<void> {
        this.clearTimer();
        await gsap.to(this, { alpha: 0, duration: 0.15 });
        this.clearPrizeContainer();
        this.visible = false;
        this.currentCallback = null; // Safety cleanup
    }
    override update(delta: number): void {
        if (this.visible) {
            this.shine.rotation += delta;
            this.confetti?.update(delta);
        }
    }
}