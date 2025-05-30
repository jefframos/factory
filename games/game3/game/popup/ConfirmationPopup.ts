
import { BasePopup, PopupData } from '@core/popup/BasePopup';
import { ExtractTiledFile } from '@core/tiled/ExtractTiledFile';
import TiledLayerObject from '@core/tiled/TiledLayerObject';
import BaseButton from '@core/ui/BaseButton';
import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import { Fonts } from '../character/Types';

export interface ConfirmationPopupData extends PopupData {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
}

export class ConfirmationPopup extends BasePopup {
    private titleText!: PIXI.BitmapText;
    private descriptionText!: PIXI.BitmapText;

    private confirmButton: BaseButton;
    private cancelButton: BaseButton;

    private onConfirm?: () => void;
    private onCancel?: () => void;

    private layout: TiledLayerObject = new TiledLayerObject();

    constructor() {
        super();

        this.layout.build(ExtractTiledFile.TiledData, ['ConfirmationPopup'])
        this.addChild(this.layout);


        const title = this.layout.findFromProperties('id', 'title-label');
        if (title) {
            this.titleText = new PIXI.BitmapText('Out of moves', {
                fontName: Fonts.MainFamily,
                fontSize: Fonts.Main.fontSize as number,
                letterSpacing: 3,
                align: 'center'
            });
            this.titleText.anchor.set(0.5); // PIXI v7+ only
            title.view?.addChild(this.titleText);
            this.titleText.position.set(title.object.width / 2, title.object.height / 2);
        }

        const description = this.layout.findFromProperties('id', 'description-label');
        if (description) {
            this.descriptionText = new PIXI.BitmapText('', {
                fontName: Fonts.MainFamily,
                fontSize: Fonts.Main.fontSize as number,
                letterSpacing: 3,
                align: 'center'
            });
            this.descriptionText.anchor.set(0.5); // PIXI v7+ only
            description.view?.addChild(this.descriptionText);
            this.descriptionText.position.set(description.object.width / 2, description.object.height / 2);
        }



        const right = this.layout.findFromProperties('id', 'button-right');
        this.confirmButton = new BaseButton({
            standard: {
                width: right?.object.width,
                height: right?.object.height,
                allPadding: 35,
                texture: PIXI.Texture.from('Button01_s_Green'),
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
                callback: () => {
                    this.onConfirm?.();
                    this.popupManager.hideCurrent();
                }
            }
        });

        this.confirmButton.setLabel('Confirm')
        this.layout.addAtId(this.confirmButton, 'button-right')



        const left = this.layout.findFromProperties('id', 'button-left');
        this.cancelButton = new BaseButton({
            standard: {
                width: left?.object.width,
                height: left?.object.height,
                allPadding: 35,
                texture: PIXI.Texture.from('Button01_s_Red'),
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
                callback: () => {
                    this.onCancel?.();
                    this.popupManager.hideCurrent();
                }
            }
        });

        this.cancelButton.setLabel('Cancel')
        this.layout.addAtId(this.cancelButton, 'button-left')

    }

    async transitionIn(data?: ConfirmationPopupData): Promise<void> {
        if (!data) return;


        this.titleText.text = data.title || '';
        this.descriptionText.text = data.description || '';
        this.confirmButton.setLabel(data.confirmLabel || 'Confirm');
        this.cancelButton.setLabel(data.cancelLabel || 'Cancel');
        this.onConfirm = data.onConfirm;
        this.onCancel = data.onCancel;

        const title = this.layout.findFromProperties('id', 'title-label');
        if (title) {
            this.titleText.position.set(title.object.width / 2, title.object.height / 2);
        }

        const description = this.layout.findFromProperties('id', 'description-label');
        if (description) {
            this.descriptionText.position.set(description.object.width / 2, description.object.height / 2);
        }


        this.visible = true;
        this.alpha = 0;
        await gsap.to(this, { alpha: 1, duration: 0.3 });
    }

    transitionInComplete(): void {
        // Could play sound or dispatch an event here if needed
    }

    async transitionOut(): Promise<void> {
        await gsap.to(this, { alpha: 0, duration: 0.3 });
    }

    hide(): void {
        this.visible = false;
        this.alpha = 0;
    }

    update(delta: number): void {
        // Not needed for this popup, but required by interface
    }
}
