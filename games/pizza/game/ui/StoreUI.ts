// StoreUI.ts
//
// Top-center HUD panel for the store the player is standing in: "STORE LV N"
// over a progress bar toward the next level, with the value drawn on the bar
// (money icon + "12/50", or "3/10 sales", or "MAX" with a full bar once the
// ladder is done). Replaces the old panel floating over each cashier.
//
// Holds no store logic of its own — PizzaScene decides which store (if any)
// the player is inside every frame and calls setState() with that store's
// numbers, or undefined when the player is in none. The panel fades in/out on
// that change and just swaps content when moving straight from one store to
// another, so any number of stores can share this one panel.
//
// Origin is the panel's TOP-CENTER — UIService.positionStoreUi() pins that to
// the top-center of the screen.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import AutoFitFrame, { uniformFitPadding } from './AutoFitFrame';
import BarComponent from './BarComponent';
import { TextStyleRegistry } from './TextStyleRegistry';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import { CURRENCY_CONFIG, CurrencyType } from '../data/EconomyTypes';
import type { StoreLevelRequirementType } from '../store/StoreTypes';

const FRAME_PADDING = uniformFitPadding(12);
const BAR_WIDTH = 240;
const BAR_HEIGHT = 26;
/** Gap between the title and the bar. */
const TITLE_BAR_GAP = 6;
const VALUE_ICON_SIZE = 22;
const VALUE_ICON_GAP = 4;
const FADE_SEC = 0.25;

export interface StoreUIState {
    level: number;
    /** Undefined at max level. */
    next?: { type: StoreLevelRequirementType; progress: number; amount: number };
}

export default class StoreUI extends PIXI.Container {
    private readonly body = new PIXI.Container();
    private readonly frame: AutoFitFrame;
    private readonly title: PIXI.Text;
    private readonly bar: BarComponent;
    private readonly valueRow = new PIXI.Container();
    private readonly valueIcon: PIXI.Sprite;
    private readonly valueText: PIXI.Text;
    /** JSON of the last state drawn — redraws only when it changes. */
    private currentKey = '';
    /** Whether the panel is showing (or fading in) — set by setState(), not by the tween. */
    private shown = false;

    public constructor() {
        super();

        this.title = new PIXI.Text('', TextStyleRegistry.Info);
        this.title.anchor.set(0.5, 0);

        this.bar = new BarComponent('Yellow', BAR_WIDTH, BAR_HEIGHT);
        this.bar.position.set(-BAR_WIDTH / 2, this.title.height + TITLE_BAR_GAP);

        this.valueIcon = new PIXI.Sprite(getAssetIcon(CURRENCY_CONFIG[CurrencyType.Money].assetKey));
        this.valueIcon.anchor.set(0, 0.5);
        this.valueIcon.width = VALUE_ICON_SIZE;
        this.valueIcon.height = VALUE_ICON_SIZE;
        this.valueText = new PIXI.Text('', TextStyleRegistry.Body);
        this.valueText.anchor.set(0, 0.5);
        this.valueRow.addChild(this.valueIcon, this.valueText);

        this.body.addChild(this.title, this.bar, this.valueRow);
        this.frame = new AutoFitFrame(FRAME_PADDING, 'Main', this.body);
        this.addChild(this.frame);

        this.alpha = 0;
        this.visible = false;
    }

    /** The store the player is in right now, or undefined for none — fades the panel in/out on that change. */
    public setState(state: StoreUIState | undefined): void {
        if (state) {
            this.draw(state);
        }
        const show = state !== undefined;
        if (show === this.shown) {
            return;
        }
        this.shown = show;
        gsap.killTweensOf(this);
        if (show) {
            this.visible = true;
            gsap.to(this, { alpha: 1, duration: FADE_SEC });
        } else {
            gsap.to(this, { alpha: 0, duration: FADE_SEC, onComplete: () => { this.visible = false; } });
        }
    }

    private draw(state: StoreUIState): void {
        const key = JSON.stringify(state);
        if (key === this.currentKey) {
            return;
        }
        this.currentKey = key;

        this.title.text = `STORE LV ${state.level}`;

        const next = state.next;
        this.bar.setProgress(next ? (next.amount > 0 ? next.progress / next.amount : 1) : 1);
        this.valueIcon.visible = next?.type === 'money';
        this.valueText.text = !next ? 'MAX' : next.type === 'money' ? `${next.progress}/${next.amount}` : `${next.progress}/${next.amount} sales`;
        this.valueText.position.set(this.valueIcon.visible ? VALUE_ICON_SIZE + VALUE_ICON_GAP : 0, 0);

        // Value row centered on the bar.
        this.valueRow.pivot.set(this.valueRow.width / 2, 0);
        this.valueRow.position.set(0, this.bar.y + BAR_HEIGHT / 2);

        this.frame.fit();
    }
}
