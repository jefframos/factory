import { BasePopup, PopupData } from '@core/popup/BasePopup';
import BaseButton from '@core/ui/BaseButton';
import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import HexAssets from '../../hexgame/HexAssets';

export interface ConfirmationPopupData extends PopupData {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
}

export class ConfirmationPopup extends BasePopup {
    transitionInComplete(): void {

    }
    private container: PIXI.Container = new PIXI.Container();
    private background: PIXI.Graphics = new PIXI.Graphics();

    private titleText!: PIXI.Text;
    private descriptionText!: PIXI.Text;

    private confirmButton!: BaseButton;
    private cancelButton!: BaseButton;

    private onConfirm?: () => void;
    private onCancel?: () => void;

    constructor() {
        super();

        this.addChild(this.container);

        // 1. Background
        const width = 500;
        const height = 400;
        this.background.beginFill(HexAssets.Textures.UI.BlockerColor, 0.9);
        this.background.lineStyle(4, 0xffffff, 1);
        this.background.drawRoundedRect(0, 0, width, height, 20);
        this.background.endFill();
        this.background.pivot.set(width / 2, height / 2);
        this.container.addChild(this.background);

        // 2. Title
        this.titleText = new PIXI.Text('', new PIXI.TextStyle({
            ...HexAssets.MainFont,
            fontSize: 42,
            fill: 0xffffff
        }));
        this.titleText.anchor.set(0.5);
        this.titleText.position.set(0, -120);
        this.container.addChild(this.titleText);

        // 3. Description
        this.descriptionText = new PIXI.Text('', new PIXI.TextStyle({
            ...HexAssets.MainFont,
            fontSize: 24,
            fill: 0xcccccc,
            align: 'center',
            wordWrap: true,
            wordWrapWidth: 400
        }));
        this.descriptionText.anchor.set(0.5);
        this.descriptionText.position.set(0, -20);
        this.container.addChild(this.descriptionText);

        // 4. Buttons
        const buttonY = 100;
        const buttonSpacing = 120;

        this.cancelButton = new BaseButton({
            standard: {
                width: 180,
                height: 70,
                texture: PIXI.Texture.from(HexAssets.Textures.Buttons.Red),
                fontStyle: new PIXI.TextStyle({ ...HexAssets.MainFont, fontSize: 24 }),
            },
            click: {
                callback: () => {
                    this.onCancel?.();
                    this.popupManager.hideCurrent();
                }
            }
        });
        this.cancelButton.position.set(-buttonSpacing, buttonY);
        this.cancelButton.pivot.set(90, 35);
        this.container.addChild(this.cancelButton);

        this.confirmButton = new BaseButton({
            standard: {
                width: 180,
                height: 70,
                texture: PIXI.Texture.from(HexAssets.Textures.Buttons.Green),
                fontStyle: new PIXI.TextStyle({ ...HexAssets.MainFont, fontSize: 24 }),
            },
            click: {
                callback: () => {
                    this.onConfirm?.();
                    this.popupManager.hideCurrent();
                }
            }
        });
        this.confirmButton.position.set(buttonSpacing, buttonY);
        this.confirmButton.pivot.set(90, 35);
        this.container.addChild(this.confirmButton);

        // Center the whole popup on screen
        //this.container.position.set(Game.DESIGN_WIDTH / 2, Game.DESIGN_HEIGHT / 2);
    }

    async transitionIn(data?: ConfirmationPopupData): Promise<void> {
        if (!data) return;

        HexAssets.tryToPlaySound(HexAssets.Sounds.UI.OpenPopup)

        this.titleText.text = data.title.toUpperCase() || 'CONFIRMATION';
        this.descriptionText.text = data.description || '';
        this.confirmButton.setLabel(data.confirmLabel || 'CONFIRM');
        this.cancelButton.setLabel(data.cancelLabel || 'CANCEL');

        this.onConfirm = data.onConfirm;
        this.onCancel = data.onCancel;

        this.visible = true;
        this.container.scale.set(0.5);
        this.alpha = 0;

        gsap.to(this, { alpha: 1, duration: 0.2 });
        await gsap.to(this.container.scale, { x: 1, y: 1, duration: 0.4, ease: 'back.out(1.7)' });
    }

    async transitionOut(): Promise<void> {
        HexAssets.tryToPlaySound(HexAssets.Sounds.UI.ClosePopup)
        gsap.to(this, { alpha: 0, duration: 0.2 });
        await gsap.to(this.container.scale, { x: 0.8, y: 0.8, duration: 0.2, ease: 'power2.in' });
    }

    hide(): void {
        this.visible = false;
        this.alpha = 0;
    }

    update(delta: number): void { }
}