
import SoundManager from '@core/audio/SoundManager';
import { BasePopup, PopupData } from '@core/popup/BasePopup';
import { ExtractTiledFile } from '@core/tiled/ExtractTiledFile';
import TiledLayerObject from '@core/tiled/TiledLayerObject';
import BaseButton from '@core/ui/BaseButton';
import { gsap } from 'gsap';
import * as PIXI from 'pixi.js';
import MergeAssets from '../MergeAssets';

export interface ConfirmationPopupData extends PopupData {
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    onConfirm?: () => void;
    onCancel?: () => void;
}

export class ConfirmationPopup extends BasePopup {
    private titleText!: PIXI.Text;
    private descriptionText!: PIXI.Text;

    private confirmButton: BaseButton;
    private cancelButton: BaseButton;

    private onConfirm?: () => void;
    private onCancel?: () => void;

    private layout: TiledLayerObject = new TiledLayerObject();

    constructor() {
        super();

        this.layout.build(ExtractTiledFile.getTiledFrom('2048'), ['ConfirmationPopup'])
        this.addChild(this.layout);


        const title = this.layout.findAndGetFromProperties('id', 'title-label');
        if (title) {
            this.titleText = new PIXI.Text('', new PIXI.TextStyle({ ...MergeAssets.MainFont, fontSize: 32 }))
            this.titleText.anchor.set(0.5); // PIXI v7+ only
            title.view?.addChild(this.titleText);
            this.titleText.position.set(title.object.width / 2, title.object.height / 2);
        }

        const description = this.layout.findAndGetFromProperties('id', 'description-label');
        if (description) {
            this.descriptionText = new PIXI.Text('', new PIXI.TextStyle({ ...MergeAssets.MainFont }))
            this.descriptionText.anchor.set(0.5); // PIXI v7+ only
            description.view?.addChild(this.descriptionText);
            this.descriptionText.position.set(description.object.width / 2, description.object.height / 2);
        }



        const right = this.layout.findAndGetFromProperties('id', 'button-right');
        this.confirmButton = new BaseButton({
            standard: {
                width: right?.object.width,
                height: right?.object.height,
                allPadding: 35,
                texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Green),
                fontStyle: new PIXI.TextStyle({ ...MergeAssets.MainFont }),
                fitText: 0.8
            },
            over: {
                tint: 0xcccccc,
                texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Green),
                callback: () => {
                    SoundManager.instance.playSoundById('Hover', { volume: 0.1, pitch: 0.7 + Math.random() * 0.3 })
                },
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



        const left = this.layout.findAndGetFromProperties('id', 'button-left');
        this.cancelButton = new BaseButton({
            standard: {
                width: left?.object.width,
                height: left?.object.height,
                allPadding: 35,
                texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Red),
                fontStyle: new PIXI.TextStyle({ ...MergeAssets.MainFont }),
                fitText: 0.8
            },
            over: {
                tint: 0xcccccc,
                texture: PIXI.Texture.from(MergeAssets.Textures.Buttons.Red),
                callback: () => {
                    SoundManager.instance.playSoundById('Hover', { volume: 0.1, pitch: 0.7 + Math.random() * 0.3 })
                },
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

        SoundManager.instance.playSoundById('Synth-Appear-01', { volume: 0.05 })
        this.titleText.text = data.title || '';
        this.descriptionText.text = data.description || '';
        this.confirmButton.setLabel(data.confirmLabel || 'Confirm');
        this.cancelButton.setLabel(data.cancelLabel || 'Cancel');
        this.onConfirm = data.onConfirm;
        this.onCancel = data.onCancel;

        const title = this.layout.findAndGetFromProperties('id', 'title-label');
        if (title) {
            this.titleText.position.set(title.object.width / 2, title.object.height / 2);
        }

        const description = this.layout.findAndGetFromProperties('id', 'description-label');
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
