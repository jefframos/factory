import { Game } from '@core/Game';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import { BasePopup, PopupData } from './BasePopup';
import { PopupBlocker } from './PopupBlocker';

interface PopupEntry {
    popup: BasePopup;
    closeOnBackground?: boolean;
}

export class PopupManager extends PIXI.Container {
    private static _instance: PopupManager;
    private popups: Map<string, PopupEntry> = new Map();
    private history: string[] = [];
    private currentPopup: BasePopup | null = null;
    private blocker: PopupBlocker;

    public onPopupStart: Signal = new Signal(); // (id: string, data?: PopupData)
    public onPopupEnd: Signal = new Signal();   // (id: string)

    public static get instance() {
        return PopupManager._instance;
    }

    constructor() {
        super();
        PopupManager._instance = this;

        this.blocker = new PopupBlocker();
        this.blocker.setOnTap(() => {
            const currentEntry = this.currentPopup && this.popups.get(this.currentPopup.id);
            if (currentEntry?.closeOnBackground) {
                this.hideCurrent();
            }
        });
        this.addChild(this.blocker);
    }

    setBlocker(customBlocker: PopupBlocker): void {
        if (this.blocker) {
            this.removeChild(this.blocker);
        }
        this.blocker = customBlocker;
        this.blocker.setOnTap(() => {
            const currentEntry = this.currentPopup && this.popups.get(this.currentPopup.id);
            if (currentEntry?.closeOnBackground) {
                this.hideCurrent();
            }
        });
        this.addChildAt(this.blocker, 0);
    }

    registerPopup(id: string, popup: BasePopup, closeOnBackground: boolean = false): void {
        popup.id = id;
        popup.popupManager = this;
        this.popups.set(id, { popup, closeOnBackground });
    }

    async show(id: string, data?: PopupData): Promise<void> {
        const entry = this.popups.get(id);
        if (!entry) {
            console.warn(`Popup with ID '${id}' not found.`);
            return;
        }

        const nextPopup = entry.popup;

        if (this.currentPopup && this.currentPopup !== nextPopup) {
            const previousPopup = this.currentPopup;
            await previousPopup.transitionOut();
            previousPopup.hide();
            this.removeChild(previousPopup);
            this.onPopupEnd.dispatch(previousPopup.id);
            this.history.push(previousPopup.id);
        }

        this.currentPopup = nextPopup;
        await this.blocker.fadeIn();
        this.addChild(nextPopup);
        this.onPopupStart.dispatch(id, data);
        await nextPopup.transitionIn(data);
        nextPopup.transitionInComplete();
    }

    async hideCurrent(): Promise<void> {
        if (this.currentPopup) {
            const closedId = this.currentPopup.id;
            await this.currentPopup.transitionOut();
            this.currentPopup.hide();
            this.removeChild(this.currentPopup);
            this.currentPopup = null;
            this.onPopupEnd.dispatch(closedId);
            await this.blocker.fadeOut();
        }
    }

    async back(): Promise<void> {
        if (this.history.length === 0) return;
        await this.hideCurrent();
        const previousId = this.history.pop()!;
        await this.show(previousId);
    }

    async hideAll(): Promise<void> {
        if (this.currentPopup) {
            const closedId = this.currentPopup.id;
            await this.currentPopup.transitionOut();
            this.currentPopup.hide();
            this.removeChild(this.currentPopup);
            this.currentPopup = null;
            this.onPopupEnd.dispatch(closedId);
            await this.blocker.fadeOut();
        }
        this.history = [];
    }

    update(delta: number): void {
        if (this.currentPopup) {
            this.currentPopup.update(delta);
        }

        this.x = Game.DESIGN_WIDTH / 2;
        this.y = Game.DESIGN_HEIGHT / 2;

        this.blocker.resize();
    }
}
