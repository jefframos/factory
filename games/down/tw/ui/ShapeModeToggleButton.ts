// ShapeModeToggleButton.ts

import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import Assets from '../../Assets';
import { getGameTheme, getNextThemeId, type GameThemeId } from '../GameThemeStorage';

const BG_TEXTURE = 'Button01_s_White_Light1';
const BG_SLICE = 30;
const PADDING_X = 24;
const PADDING_Y = 10;

/**
 * Top-left theme toggle — a dev-only quick switch to cycle GAME_THEMES (see
 * GameThemeStorage): 'cats' ↔ 'dogs'. The real, player-facing way to pick a
 * level is HomePopup's "Choose your level" list; this is purely a fast
 * testing shortcut (see GameHud's shapeModeToggle.visible, gated on
 * Game.debugParams.dev). Same NineSlicePlane-bubble-with-centered-text look
 * TowerHeader already uses, so it reads as part of the same HUD family
 * rather than a one-off control.
 *
 * Purely a dumb button — dispatches onToggle with whichever theme id it now
 * shows; IslandViewScene is what actually applies it (piece catalog,
 * backdrop, colors) and resets the run, same as HomePopup's level rows do
 * for a fresh start.
 */
export class ShapeModeToggleButton extends PIXI.Container {
    public readonly onToggle: Signal = new Signal();

    private readonly bg: PIXI.NineSlicePlane;
    private readonly label: PIXI.Text;
    private themeId: GameThemeId = 'cats';

    public constructor() {
        super();

        this.bg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(BG_TEXTURE),
            BG_SLICE, BG_SLICE, BG_SLICE, BG_SLICE,
        );
        this.addChild(this.bg);

        this.label = new PIXI.Text('', Assets.TextStyles.NextLabel);
        this.label.anchor.set(0.5, 0.5);
        this.addChild(this.label);

        this.eventMode = 'static';
        this.cursor = 'pointer';
        this.on('pointertap', this.handleTap, this);

        this.refresh();
    }

    private handleTap(): void {
        this.themeId = getNextThemeId(this.themeId);
        this.refresh();
        this.onToggle.dispatch(this.themeId);
    }

    /** Syncs the displayed label to `themeId` WITHOUT dispatching onToggle — see IslandViewScene restoring a saved TowerDevMeta.themeId at boot, which already applies the theme itself and just needs this button to agree with it. */
    public setThemeId(themeId: GameThemeId): void {
        this.themeId = themeId;
        this.refresh();
    }

    private refresh(): void {
        this.label.text = getGameTheme(this.themeId).label;

        this.bg.width = this.label.width + PADDING_X * 2;
        this.bg.height = this.label.height + PADDING_Y * 2;
        this.bg.position.set(0, 0);
        this.label.position.set(this.bg.width * 0.5, this.bg.height * 0.5);
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        this.onToggle.removeAll();
        super.destroy(options ?? { children: true });
    }
}
