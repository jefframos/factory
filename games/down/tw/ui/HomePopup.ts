// HomePopup.ts

import BaseButton from 'core/ui/BaseButton';
import InteractiveEventUtils from 'core/utils/InteractiveEventUtils';
import * as PIXI from 'pixi.js';
import { Signal } from 'signals';
import { GAME_THEMES, type GameThemeConfig, type GameThemeId } from '../GameThemeStorage';

const ATLAS = {
    PANEL: 'ItemFrame01_Single_Hologram1',
    RESTART_STANDARD: 'Label_Parallelogram_Yellow',
    RESTART_DOWN: 'Label_Parallelogram_Yellow',
    ROW_BG: 'ResourceBar_Single_Btn_Green1',
    /** Same X icon PieceTargetingOverlay's own top-right cancel button uses. */
    CLOSE_ICON: 'Icon_Close02',
} as const;

const PANEL_WIDTH = 520;
const PANEL_NINE_SLICE_PADDING = 30;
const FADE_DURATION_MS = 220;

const BUTTON_WIDTH = 420;
const BUTTON_HEIGHT = 66;

const ROW_WIDTH = 440;
const ROW_HEIGHT = 92;
const ROW_GAP = 16;
const ROW_ICON_SIZE = 64;
const ROW_PADDING_X = 20;
const ROW_NINE_SLICE_PADDING = 30;

/** Same circular-button dimensions PieceTargetingOverlay's own top-right cancel button uses — see closeButton. */
const CLOSE_BUTTON_SIZE = 56;
const CLOSE_ICON_SIZE = 24;

const TITLE_STYLE: Partial<PIXI.ITextStyle> = {
    fontFamily: 'Baloo2-ExtraBold',
    fontSize: 34,
    fontWeight: 'bold',
    fill: 0xffffff,
    stroke: 0,
    strokeThickness: 4,
    dropShadow: true,
    dropShadowDistance: 2,
    dropShadowColor: 0x000000,
    dropShadowAlpha: 1,
    dropShadowAngle: 3.14 / 2,
};

const SECTION_TITLE_STYLE: Partial<PIXI.ITextStyle> = {
    ...TITLE_STYLE,
    fontSize: 24,
    fill: 0xffe066,
};

const BUTTON_FONT_STYLE: Partial<PIXI.ITextStyle> = {
    ...TITLE_STYLE,
    fontSize: 28,
};

const ROW_NAME_STYLE: Partial<PIXI.ITextStyle> = {
    ...TITLE_STYLE,
    fontSize: 30,
};

/**
 * "Home" menu — opened via HomeButton (top-left, mid-run) or GameOverPopup's
 * CONTINUE button (after a run ends). Same dimmer+card+fade shape as
 * GameOverPopup/PowerupConfirmPopup. Two things to do from here:
 *  - RESTART: reset the CURRENT run in place (same theme) — see onRestart.
 *  - Pick a level (see GAME_THEMES — 'cats'/'dogs' today): closes and
 *    starts a fresh run with that theme — see onSelectLevel.
 * Purely a dumb view: IslandViewScene owns what RESTART/a level pick
 * actually does (board reset, theme swap, commercial break) — this only
 * ever dispatches signals and renders whatever showPopup()/hidePopup() are
 * told, same "dumb popup, smart scene" convention every other GameHud
 * sub-widget follows. Tapping the dimmer (or the top-right close button)
 * dismisses without picking anything, same convention PowerupConfirmPopup's
 * dimmer tap-to-cancel already uses — opening this mid-run must not force the
 * player into restarting/switching levels just to look at it.
 */
export class HomePopup extends PIXI.Container {
    public readonly onRestart: Signal = new Signal();
    /** Dispatches the tapped level's GameThemeId. */
    public readonly onSelectLevel: Signal = new Signal();
    public readonly onClose: Signal = new Signal();

    private readonly dimmer: PIXI.Graphics;
    private readonly card: PIXI.Container;
    private readonly panel: PIXI.NineSlicePlane;
    private readonly titleText: PIXI.Text;
    private readonly restartBtn: BaseButton;
    private readonly sectionTitle: PIXI.Text;
    private readonly levelsList = new PIXI.Container();
    /** Top-right circular X — same look/size PieceTargetingOverlay's own top-right cancel button uses (a drawn semi-transparent black circle + centered Icon_Close02 sprite), so it reads as the same "close this" affordance across the game. */
    private readonly closeButton: PIXI.Container;

    /** True while a run is actually still going — hides restartBtn otherwise (see showPopup()). Restarting a run that's already over reads as redundant next to picking a level, which already starts a fresh one. */
    private canRestart = true;
    private panelHeight = 0;

    private prevTime = 0;
    private fadeProgress = 0;
    private fadingIn = false;
    private fadingOut = false;

    public constructor(private readonly viewWidth: number, private readonly viewHeight: number) {
        super();

        this.visible = false;
        this.alpha = 0;

        this.dimmer = new PIXI.Graphics();
        this.dimmer.beginFill(0x000000, 0.65);
        this.dimmer.drawRect(-viewWidth * 2, -viewWidth * 2, viewWidth * 4, viewHeight * 4);
        this.dimmer.endFill();
        this.addChild(this.dimmer);

        InteractiveEventUtils.addClickTap(this.dimmer, () => this.onClose.dispatch());

        this.card = new PIXI.Container();
        this.addChild(this.card);

        this.panel = new PIXI.NineSlicePlane(
            PIXI.Texture.from(ATLAS.PANEL),
            PANEL_NINE_SLICE_PADDING, PANEL_NINE_SLICE_PADDING, PANEL_NINE_SLICE_PADDING, PANEL_NINE_SLICE_PADDING,
        );
        this.panel.width = PANEL_WIDTH;
        this.panel.interactive = true;
        this.card.addChild(this.panel);

        this.titleText = new PIXI.Text('MENU', new PIXI.TextStyle(TITLE_STYLE));
        this.titleText.anchor.set(0.5, 0);
        this.card.addChild(this.titleText);

        this.restartBtn = new BaseButton({
            standard: {
                width: BUTTON_WIDTH,
                height: BUTTON_HEIGHT,
                texturePadding: { bottom: 0, top: 0, right: 35, left: 35 },
                texture: PIXI.Texture.from(ATLAS.RESTART_STANDARD),
                fontStyle: new PIXI.TextStyle(BUTTON_FONT_STYLE),
            },
            over: { tint: 0xddffd0 },
            down: { texture: PIXI.Texture.from(ATLAS.RESTART_DOWN), tint: 0xaaaaaa },
            click: { callback: () => this.onRestart.dispatch() },
        } as any);
        this.restartBtn.setLabel('RESTART');
        this.card.addChild(this.restartBtn);

        this.sectionTitle = new PIXI.Text('CHOOSE YOUR LEVEL', new PIXI.TextStyle(SECTION_TITLE_STYLE));
        this.sectionTitle.anchor.set(0.5, 0);
        this.card.addChild(this.sectionTitle);

        this.card.addChild(this.levelsList);
        this.buildLevelsList();

        this.closeButton = HomePopup.buildCloseButton(() => this.onClose.dispatch());
        this.card.addChild(this.closeButton);

        this.layout();
    }

    /** Exact same construction PieceTargetingOverlay.buildCloseButton() uses — a drawn semi-transparent black circle behind a centered Icon_Close02 sprite — so this reads as the same "close this" button players already know from the powerup targeting overlay. */
    private static buildCloseButton(onTap: () => void): PIXI.Container {
        const button = new PIXI.Container();

        const bg = new PIXI.Graphics();
        bg.beginFill(0x000000, 0.55);
        bg.drawCircle(0, 0, CLOSE_BUTTON_SIZE / 2);
        bg.endFill();
        button.addChild(bg);

        const icon = PIXI.Sprite.from(ATLAS.CLOSE_ICON);
        icon.anchor.set(0.5);
        icon.width = CLOSE_ICON_SIZE;
        icon.height = CLOSE_ICON_SIZE;
        button.addChild(icon);

        button.interactive = true;
        button.cursor = 'pointer';
        button.on('pointertap', onTap);

        return button;
    }

    /** Show the popup, fading in. `canRestart` hides RESTART entirely when the current run has already ended (see IslandViewScene's `isGameOver`) — restarting a run that's already over reads as redundant next to picking a level below. */
    public showPopup(canRestart: boolean): void {
        this.canRestart = canRestart;
        this.layout();

        this.visible = true;
        this.interactiveChildren = false;

        this.fadingOut = false;
        this.fadingIn = true;
        this.prevTime = performance.now();
    }

    /** Hide the popup with a fade-out. */
    public hidePopup(): void {
        if (!this.visible) {
            return;
        }

        this.interactiveChildren = false;
        this.fadingIn = false;
        this.fadingOut = true;
        this.prevTime = performance.now();
    }

    /**
     * Recomputes every position (and the panel/card height/position that
     * depend on them) from `canRestart` — RESTART occupies its own slot
     * when shown; when hidden, the section title/rows shift up into that
     * slot instead of leaving a gap. `panelHeight` is derived from the
     * actual bottom-most content (the level rows) rather than a separately
     * maintained formula, so the two can never drift out of sync.
     */
    public layout(): void {
        const cx = PANEL_WIDTH * 0.5;

        this.titleText.position.set(cx, 30);
        // Top-right corner of the card, inset by half its own size so it
        // doesn't hang off the edge — same padding convention
        // PieceTargetingOverlay's own screen-corner placement uses.
        this.closeButton.position.set(PANEL_WIDTH - CLOSE_BUTTON_SIZE / 2 - 10, CLOSE_BUTTON_SIZE / 2 + 10);

        const restartY = 100;
        this.restartBtn.visible = this.canRestart;
        this.restartBtn.position.set(Math.round((PANEL_WIDTH - BUTTON_WIDTH) / 2), restartY);

        const sectionY = this.canRestart ? restartY + BUTTON_HEIGHT + 30 : restartY;
        this.sectionTitle.position.set(cx, sectionY);

        const rowsTop = sectionY + 50;
        this.levelsList.position.set(Math.round((PANEL_WIDTH - ROW_WIDTH) / 2), rowsTop);

        const rowsBottom = rowsTop + GAME_THEMES.length * ROW_HEIGHT + Math.max(0, GAME_THEMES.length - 1) * ROW_GAP;

        this.panelHeight = rowsBottom + 30;
        this.panel.height = this.panelHeight;

        this.card.x = Math.round((this.viewWidth - PANEL_WIDTH) / 2);
        this.card.y = Math.round((this.viewHeight - this.panelHeight) / 2);
    }

    public override updateTransform(): void {
        if (this.visible) {
            const now = performance.now();
            const elapsed = this.prevTime > 0 ? (now - this.prevTime) / 1000 : 0;
            this.prevTime = now;

            if (this.fadingIn) {
                this.fadeProgress += elapsed / (FADE_DURATION_MS / 1000);
                if (this.fadeProgress >= 1) {
                    this.fadeProgress = 1;
                    this.fadingIn = false;
                    this.interactiveChildren = true;
                }
                this.alpha = HomePopup.easeOut(this.fadeProgress);
            } else if (this.fadingOut) {
                this.fadeProgress -= elapsed / (FADE_DURATION_MS / 1000);
                if (this.fadeProgress <= 0) {
                    this.fadeProgress = 0;
                    this.fadingOut = false;
                    this.visible = false;
                    this.alpha = 0;
                } else {
                    this.alpha = HomePopup.easeOut(this.fadeProgress);
                }
            }
        }

        super.updateTransform();
    }

    private static easeOut(t: number): number {
        return 1 - (1 - t) * (1 - t);
    }

    /** Built once — GAME_THEMES is a fixed catalog, not something that changes at runtime. */
    private buildLevelsList(): void {
        let y = 0;

        for (const theme of GAME_THEMES) {
            const row = HomePopup.buildLevelRow(theme, (id) => this.onSelectLevel.dispatch(id));
            row.position.set(0, y);
            this.levelsList.addChild(row);
            y += ROW_HEIGHT + ROW_GAP;
        }
    }

    private static buildLevelRow(theme: GameThemeConfig, onTap: (id: GameThemeId) => void): PIXI.Container {
        const row = new PIXI.Container();

        const bg = new PIXI.NineSlicePlane(
            PIXI.Texture.from(ATLAS.ROW_BG),
            ROW_NINE_SLICE_PADDING, ROW_NINE_SLICE_PADDING, ROW_NINE_SLICE_PADDING, ROW_NINE_SLICE_PADDING,
        );
        bg.width = ROW_WIDTH;
        bg.height = ROW_HEIGHT;
        row.addChild(bg);

        const icon = PIXI.Sprite.from(theme.icon);
        icon.anchor.set(0.5);
        icon.scale.set(ROW_ICON_SIZE / Math.max(icon.texture.width, icon.texture.height));
        icon.position.set(ROW_PADDING_X + ROW_ICON_SIZE * 0.5, ROW_HEIGHT * 0.5);
        row.addChild(icon);

        const name = new PIXI.Text(HomePopup.displayName(theme.id), new PIXI.TextStyle(ROW_NAME_STYLE));
        name.anchor.set(0, 0.5);
        name.position.set(ROW_PADDING_X * 2 + ROW_ICON_SIZE, ROW_HEIGHT * 0.5);
        row.addChild(name);

        row.eventMode = 'static';
        row.cursor = 'pointer';
        row.on('pointertap', () => onTap(theme.id));

        return row;
    }

    /** 'cats' -> 'Cats' — no dedicated display-name field on GameThemeConfig, so this just humanizes the id (its `label` includes an emoji meant for ShapeModeToggleButton's own compact look, not this list). */
    private static displayName(id: string): string {
        return id.charAt(0).toUpperCase() + id.slice(1);
    }

    public override destroy(options?: boolean | PIXI.IDestroyOptions): void {
        this.onRestart.removeAll();
        this.onSelectLevel.removeAll();
        this.onClose.removeAll();
        super.destroy(options ?? { children: true });
    }
}
