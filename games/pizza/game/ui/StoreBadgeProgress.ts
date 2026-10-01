// StoreBadgeProgress.ts
//
// The store HUD's content (see StoreUI.ts), no background panel:
//
//   ⬢        Farm Store Level 3
//  (icon)    [=====bar=====]  ← money icon + "12/50", "3/10 sales" or "MAX"
//
// The badge is the BADGE PROGRESSION — the same Label_Badge01_* tiers the tools
// use (LevelBadgeStyle.ts: grey -> green -> purple -> red -> yellow), each tier
// covering STORE_BADGE_PROGRESS_CONFIG.levelsPerTier store levels (see
// storeBadgeTextureFor() — the store level-up notification uses it too, so they
// match), with the store icon centered inside it.
// The level itself is written in the title, after the store name. Every size,
// gap, texture and tier lives in STORE_BADGE_PROGRESS_CONFIG below, so the
// look is tweaked in one place.
//
// Origin is the whole block's TOP-CENTER (same as StoreUI's), so UIService can
// pin it to the top-center of the screen.

import * as PIXI from 'pixi.js';
import BarComponent from './BarComponent';
import type { BarStyleName } from './BarRegistry';
import { TextStyleRegistry } from './TextStyleRegistry';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import { CURRENCY_CONFIG, CurrencyType } from '../data/EconomyTypes';
import type { StoreLevelRequirementType } from '../store/StoreTypes';
import { LevelBadgeStyle } from './LevelBadgeStyle';

/** Everything about the look — tweak here. */
export const STORE_BADGE_PROGRESS_CONFIG = {
    /** Store levels per badge tier (LevelBadgeStyle's 5 tiers) — 2 spreads them across the 10 store levels: 1-2 grey, 3-4 green, 5-6 purple, 7-8 red, 9-10 yellow. */
    levelsPerTier: 2,
    /** The badge fits inside this square, UI pixels — keeping its own aspect ratio. */
    badgeSize: 56,
    /** The store icon, centered inside the badge. */
    icon: 'ItemIcon_Shop_old-2',
    /** Icon size as a fraction of the badge's own (fitted) size — fits inside it, aspect kept. */
    iconFill: 0.62,
    /** Nudges the icon up (negative) / down inside the badge, UI pixels. */
    iconOffsetY: -1,
    /** Title = store name + this + the level, e.g. "Farm Store Level 3". */
    levelLabel: 'Level',
    /** Gap between the badge and the title/bar column, UI pixels. */
    badgeGap: 10,
    bar: {
        style: 'Yellow' as BarStyleName,
        width: 220,
        height: 24,
    },
    /** Gap between the title and the bar, UI pixels. */
    nameGap: 4,
    /** Money icon in front of the value on the bar. */
    valueIconSize: 20,
    valueIconGap: 4,
};

export interface StoreBadgeProgressState {
    /** Shown above the bar, followed by the level. */
    name: string;
    level: number;
    /** Undefined at max level. */
    next?: { type: StoreLevelRequirementType; progress: number; amount: number };
}

export default class StoreBadgeProgress extends PIXI.Container {
    private readonly badge = new PIXI.Sprite();
    private readonly icon: PIXI.Sprite;
    private readonly titleText: PIXI.Text;
    private readonly bar: BarComponent;
    private readonly valueRow = new PIXI.Container();
    private readonly valueIcon: PIXI.Sprite;
    private readonly valueText: PIXI.Text;
    /** Everything, laid out from (0,0) top-left — shifted so this container's origin is its top-center (see this file's own doc). */
    private readonly content = new PIXI.Container();

    public constructor() {
        super();
        const config = STORE_BADGE_PROGRESS_CONFIG;

        // Badge with the store icon centered inside it, in a badgeSize square.
        this.badge.anchor.set(0.5);
        this.badge.position.set(config.badgeSize / 2, config.badgeSize / 2);
        this.icon = new PIXI.Sprite(PIXI.Texture.from(config.icon));
        this.icon.anchor.set(0.5);
        this.icon.position.set(config.badgeSize / 2, config.badgeSize / 2 + config.iconOffsetY);

        // Title/bar column, right of the badge, vertically centered on it.
        const columnX = config.badgeSize + config.badgeGap;
        this.titleText = new PIXI.Text('', TextStyleRegistry.Info);
        this.titleText.anchor.set(0, 1);

        this.bar = new BarComponent(config.bar.style, config.bar.width, config.bar.height);
        const barY = config.badgeSize / 2 - config.bar.height / 2 + (this.titleText.height + config.nameGap) / 2;
        this.bar.position.set(columnX, barY);
        this.titleText.position.set(columnX, barY - config.nameGap);

        this.valueIcon = new PIXI.Sprite(getAssetIcon(CURRENCY_CONFIG[CurrencyType.Money].assetKey));
        this.valueIcon.anchor.set(0, 0.5);
        this.valueIcon.width = config.valueIconSize;
        this.valueIcon.height = config.valueIconSize;
        this.valueText = new PIXI.Text('', TextStyleRegistry.Body);
        this.valueText.anchor.set(0, 0.5);
        this.valueRow.addChild(this.valueIcon, this.valueText);

        this.content.addChild(this.badge, this.icon, this.titleText, this.bar, this.valueRow);
        this.addChild(this.content);
        // Top-center origin: the whole block is badge + gap + bar wide.
        this.content.position.set(-(columnX + config.bar.width) / 2, 0);
    }

    public setState(state: StoreBadgeProgressState): void {
        const config = STORE_BADGE_PROGRESS_CONFIG;
        this.badge.texture = PIXI.Texture.from(storeBadgeTextureFor(state.level));
        fitSprite(this.badge, config.badgeSize, config.badgeSize);
        fitSprite(this.icon, this.badge.width * config.iconFill, this.badge.height * config.iconFill);
        this.titleText.text = `${state.name} ${config.levelLabel} ${state.level}`;

        const next = state.next;
        this.bar.setProgress(next ? (next.amount > 0 ? next.progress / next.amount : 1) : 1);
        this.valueIcon.visible = next?.type === 'money';
        this.valueText.text = !next ? 'MAX' : next.type === 'money' ? `${next.progress}/${next.amount}` : `${next.progress}/${next.amount} sales`;
        this.valueText.position.set(this.valueIcon.visible ? config.valueIconSize + config.valueIconGap : 0, 0);

        // Value centered on the bar.
        this.valueRow.pivot.set(this.valueRow.width / 2, 0);
        this.valueRow.position.set(this.bar.x + config.bar.width / 2, this.bar.y + config.bar.height / 2);
    }
}

/** The badge texture for a store at `level` — LevelBadgeStyle's tier for it, levelsPerTier levels per tier. Used by the HUD and the level-up notification. */
export function storeBadgeTextureFor(level: number): string {
    const perTier = Math.max(1, STORE_BADGE_PROGRESS_CONFIG.levelsPerTier);
    return LevelBadgeStyle.badgeTextureForLevel(Math.ceil(Math.max(1, level) / perTier));
}

/** Scales `sprite` uniformly to fit inside width x height. */
function fitSprite(sprite: PIXI.Sprite, width: number, height: number): void {
    const texture = sprite.texture;
    const scale = Math.min(width / Math.max(1, texture.width), height / Math.max(1, texture.height));
    sprite.scale.set(scale);
}
