// StoreLevelPanel.ts
//
// The small panel floating over a store's cashier: "STORE LV N" plus
// progress toward the next level (money icon + "12/50", or "Sales 3/10"),
// or "MAX" once the ladder is done. Rebuilt only when the text changes.
// Store.ts owns it and hands `content` to a ScreenAnchorComponent.

import * as PIXI from 'pixi.js';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import { CURRENCY_CONFIG, CurrencyType } from '../data/EconomyTypes';
import { StoreLevelRequirementType } from './StoreTypes';

const FRAME_PADDING = uniformFitPadding(10);
const ICON_SIZE = 24;
const GAP = 4;
const LINE_GAP = 4;

export interface StoreLevelPanelState {
    level: number;
    /** Undefined at max level. */
    next?: { type: StoreLevelRequirementType; progress: number; amount: number };
}

export default class StoreLevelPanel {
    public readonly content = new PIXI.Container();
    private readonly body = new PIXI.Container();
    private readonly frame: AutoFitFrame;
    private currentKey = '';

    public constructor() {
        this.frame = new AutoFitFrame(FRAME_PADDING, 'QueueFrame', this.body);
        this.content.addChild(this.frame);
    }

    public show(state: StoreLevelPanelState): void {
        const key = JSON.stringify(state);
        if (key === this.currentKey) {
            return;
        }
        this.currentKey = key;
        this.body.removeChildren().forEach(child => child.destroy({ children: true }));

        // Laid out bottom-up from y=0, centered on x=0 — same "bottom edge at local y=0" convention as every zone panel.
        const progressRow = new PIXI.Container();
        if (!state.next) {
            const text = new PIXI.Text('MAX', TextStyleRegistry.Body);
            text.anchor.set(0, 0.5);
            progressRow.addChild(text);
        } else if (state.next.type === 'money') {
            const icon = new PIXI.Sprite(getAssetIcon(CURRENCY_CONFIG[CurrencyType.Money].assetKey));
            icon.anchor.set(0, 0.5);
            icon.width = ICON_SIZE;
            icon.height = ICON_SIZE;
            const text = new PIXI.Text(`${state.next.progress}/${state.next.amount}`, TextStyleRegistry.Body);
            text.anchor.set(0, 0.5);
            text.position.set(ICON_SIZE + GAP, 0);
            progressRow.addChild(icon, text);
        } else {
            const text = new PIXI.Text(`Sales ${state.next.progress}/${state.next.amount}`, TextStyleRegistry.Body);
            text.anchor.set(0, 0.5);
            progressRow.addChild(text);
        }
        progressRow.pivot.set(progressRow.width / 2, progressRow.height / 2);

        const title = new PIXI.Text(`STORE LV ${state.level}`, TextStyleRegistry.Body);
        title.anchor.set(0.5, 1);
        title.position.set(0, -(progressRow.height + LINE_GAP));

        this.body.addChild(title, progressRow);
        this.frame.fit();
    }
}
