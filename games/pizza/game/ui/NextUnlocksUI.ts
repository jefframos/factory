// NextUnlocksUI.ts
//
// HUD strip teasing what the NEXT store level brings — so the player always knows what they're
// working toward. Bottom-right (UIService.positionNextUnlocksUi()):
//
//     NEXT
//     [🐔]          ← one tile per unlock, stacked vertically
//     [🥦]
//     [🗺]
//
// Optional parts, off by default (flip them in NEXT_UNLOCKS_UI_CONFIG): the level number in the
// title (showLevel), a progress bar toward that level (showProgress — redundant with the store
// panel's own bar) and a name under each tile (showLabels). `direction` lays the tiles out
// vertically (default) or horizontally.
//
// Holds no game logic — PizzaScene picks the store and level and hands this the chips
// (store/StoreUnlockHints.ts) via setState() every frame; it only redraws when they change, pops
// when they do (a level-up), and fades out with undefined. Origin is the title's top-center.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { TextStyleRegistry } from './TextStyleRegistry';
import BarComponent from './BarComponent';
import type { BarStyleName } from './BarRegistry';
import type { UnlockHint } from '../store/StoreUnlockHints';

/** Everything about the look — tweak here. */
export const NEXT_UNLOCKS_UI_CONFIG = {
    title: 'NEXT',
    /** Append the level to the title ("NEXT · LEVEL 4"). */
    showLevel: false,
    levelLabel: ' · LEVEL ',
    /** Progress bar (+ "120/200" in the title) toward that level — the store panel already shows it. */
    showProgress: false,
    /** A name under each tile. */
    showLabels: false,
    direction: 'vertical' as 'vertical' | 'horizontal',
    /** Square tile behind each icon, UI pixels. */
    tileSize: 52,
    tileColor: 0x000000,
    tileAlpha: 0.45,
    tileRadius: 12,
    /** Icon fits inside the tile at this fraction, aspect kept. */
    iconFill: 0.78,
    /** Gap between tiles. */
    chipGap: 8,
    /** Label width cap (showLabels) — longer labels wrap. */
    labelWidth: 78,
    labelFontSize: 13,
    titleFontSize: 16,
    /** Gap title -> bar -> tiles. */
    rowGap: 6,
    bar: { style: 'Green' as BarStyleName, width: 160, height: 10 },
    fadeSec: 0.25,
    /** Scale pop when the chips change (a level-up). */
    popScale: 1.15,
    popSec: 0.35,
};

export interface NextUnlocksState {
    level: number;
    hints: UnlockHint[];
    /** Progress toward `level` — only when it's the store's very next level. */
    progress?: { value: number; amount: number };
}

export default class NextUnlocksUI extends PIXI.Container {
    private readonly content = new PIXI.Container();
    /** Tiles (+ labels), rebuilt when the hints change. */
    private readonly chips = new PIXI.Container();
    private readonly titleText: PIXI.Text;
    private readonly bar: BarComponent;
    private chipsKey = '';
    private shown = false;

    public constructor() {
        super();
        const config = NEXT_UNLOCKS_UI_CONFIG;
        this.titleText = new PIXI.Text('', { ...TextStyleRegistry.Info, fontSize: config.titleFontSize, align: 'center' } as PIXI.TextStyle);
        this.titleText.anchor.set(0.5, 0);
        this.bar = new BarComponent(config.bar.style, config.bar.width, config.bar.height);
        this.bar.position.set(-config.bar.width / 2, 0);
        this.content.addChild(this.titleText, this.bar, this.chips);
        this.addChild(this.content);
        this.alpha = 0;
        this.visible = false;
    }

    /** What to tease, or undefined to fade out. */
    public setState(state: NextUnlocksState | undefined): void {
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
            gsap.to(this, { alpha: 1, duration: NEXT_UNLOCKS_UI_CONFIG.fadeSec });
        } else {
            gsap.to(this, { alpha: 0, duration: NEXT_UNLOCKS_UI_CONFIG.fadeSec, onComplete: () => { this.visible = false; } });
        }
    }

    private draw(state: NextUnlocksState): void {
        const config = NEXT_UNLOCKS_UI_CONFIG;
        const progress = config.showProgress ? state.progress : undefined;
        let title = config.title;
        if (config.showLevel) {
            title += `${config.levelLabel}${state.level}`;
        }
        if (progress) {
            title += `  ${Math.min(progress.value, progress.amount)}/${progress.amount}`;
        }
        if (this.titleText.text !== title) {
            this.titleText.text = title;
        }

        let y = this.titleText.height + config.rowGap;
        this.bar.visible = progress !== undefined;
        if (progress) {
            this.bar.y = y;
            this.bar.setProgress(progress.amount > 0 ? progress.value / progress.amount : 1);
            y += config.bar.height + config.rowGap;
        }
        this.chips.y = y;

        const key = `${state.level}|${state.hints.map(hint => hint.key).join(',')}`;
        if (key === this.chipsKey) {
            return;
        }
        const firstDraw = this.chipsKey === '';
        this.chipsKey = key;
        this.buildChips(state.hints);
        if (!firstDraw) {
            // Pops around its bottom-right corner — the corner UIService pins to the screen.
            gsap.killTweensOf(this.content.scale);
            this.content.scale.set(1);
            const bounds = this.content.getLocalBounds();
            this.content.pivot.set(bounds.x + bounds.width, bounds.y + bounds.height);
            this.content.position.copyFrom(this.content.pivot);
            this.content.scale.set(config.popScale);
            gsap.to(this.content.scale, { x: 1, y: 1, duration: config.popSec, ease: 'back.out(2)' });
        }
    }

    /** The layout's bounds in this container's space, ignoring the level-up pop — what UIService anchors to the screen corner. */
    public getLayoutBounds(): PIXI.Rectangle {
        const bounds = this.content.getLocalBounds();
        bounds.x += this.content.position.x - this.content.pivot.x;
        bounds.y += this.content.position.y - this.content.pivot.y;
        return bounds;
    }

    private buildChips(hints: UnlockHint[]): void {
        const config = NEXT_UNLOCKS_UI_CONFIG;
        this.chips.removeChildren().forEach(child => child.destroy({ children: true }));
        const vertical = config.direction === 'vertical';
        // One chip = tile (+ label under it). Vertical: stacked down from the title; horizontal: centered under it.
        const labelSpace = config.showLabels ? config.labelFontSize * 2 + 6 : 0;
        const pitch = vertical
            ? config.tileSize + labelSpace + config.chipGap
            : Math.max(config.tileSize, config.showLabels ? config.labelWidth : 0) + config.chipGap;
        const startX = vertical ? 0 : -((hints.length - 1) * pitch) / 2;
        hints.forEach((hint, index) => {
            const chip = new PIXI.Container();
            chip.position.set(vertical ? 0 : startX + index * pitch, vertical ? index * pitch : 0);
            this.chips.addChild(chip);

            const tile = new PIXI.Graphics();
            tile.beginFill(config.tileColor, config.tileAlpha)
                .drawRoundedRect(-config.tileSize / 2, 0, config.tileSize, config.tileSize, config.tileRadius)
                .endFill();
            chip.addChild(tile);

            const icon = new PIXI.Sprite(hint.icon);
            icon.anchor.set(0.5);
            const fit = config.tileSize * config.iconFill;
            icon.scale.set(Math.min(fit / Math.max(1, icon.texture.width), fit / Math.max(1, icon.texture.height)));
            icon.position.set(0, config.tileSize / 2);
            chip.addChild(icon);

            if (config.showLabels) {
                const label = new PIXI.Text(hint.label, {
                    ...TextStyleRegistry.Body,
                    fontSize: config.labelFontSize,
                    align: 'center',
                    wordWrap: true,
                    wordWrapWidth: config.labelWidth,
                } as PIXI.TextStyle);
                label.anchor.set(0.5, 0);
                label.position.set(0, config.tileSize + 3);
                chip.addChild(label);
            }
        });
    }
}
