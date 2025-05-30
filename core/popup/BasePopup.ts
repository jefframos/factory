import * as PIXI from 'pixi.js';
import { PopupManager } from "./PopupManager";

export abstract class BasePopup extends PIXI.Container {
    id: string = '';
    popupManager!: PopupManager;

    abstract transitionIn(data?: PopupData): Promise<void>;
    abstract transitionOut(): Promise<void>;
    abstract transitionInComplete(): void;
    abstract update(delta: number): void;
    abstract hide(): void;
}
export interface PopupData {
    [key: string]: any;
}
