// UIService.ts
//
// Owns every screen-anchored HUD element PizzaScene shows — the backpack
// panel, the base-stockpile panel, the camera-toggle button, and wherever
// future UI (e.g. a building panel) gets added — so the scene itself just
// builds/updates/destroys ONE thing instead of a field + setup method +
// per-frame position method + teardown line for every panel. Everything here
// is a direct child of `game.uiLayer` now — the bottom of the three
// z-ordered overlay tiers (see core/Game.ts's own doc: uiLayer <
// notificationLayer < popupLayer), so a toast notification or modal popup
// always draws over this HUD. `Game.overlayScreenData` is expressed in the
// shared `overlayContainer`'s local space, which uiLayer shares (no extra
// scale/offset of its own), so every positionX() below can use its corners
// directly with no extra conversion — same reasoning PizzaScene's original
// positionBackpackUi()/positionGlobalResourcesUi()/positionCameraToggleButton()
// used before this existed.
//
// A plain class, not an ECS Entity/Component — same "scene owns one plain
// manager object" shape as WorldManager/GateManager, just for 2D HUD instead
// of 3D world state.

import * as PIXI from 'pixi.js';
import BaseButton from 'core/ui/BaseButton';
import { Game } from 'core/Game';
import { TextStyleRegistry } from './TextStyleRegistry';
import BackpackUI from './BackpackUI';
import GlobalResourcesUI from './GlobalResourcesUI';
import EconomyUI from './EconomyUI';
import ToolLevelUI from './ToolLevelUI';
import SettingsUIService from './SettingsUIService';
import { UpgradeNotificationManager } from './notifications/UpgradeNotificationManager';

/** Gap between the backpack HUD panel's bottom edge and the actual bottom of the screen — see positionBackpackUi(). */
const BACKPACK_UI_BOTTOM_MARGIN = 16;

/** Gap between the global-resources HUD panel's top/right edges and the actual top-right corner of the screen — see positionGlobalResourcesUi(). */
const GLOBAL_RESOURCES_UI_MARGIN = 16;

/** Gap between the economy (money) HUD panel's top/right edges and the actual top-right corner of the screen — see positionEconomyUi(). Same spot globalResourcesUi would occupy (that panel is currently not added to the display tree), so no visual collision. */
const ECONOMY_UI_MARGIN = 16;

/** Gap between the camera-toggle button's bottom/left edges and the actual bottom-left corner of the screen — see positionCameraToggleButton(). */
const CAMERA_TOGGLE_BUTTON_MARGIN = 16;

/** Gap between the tool/level HUD panel's bottom/right edges and the actual bottom-right corner of the screen — see positionToolLevelUi(). */
const TOOL_LEVEL_UI_MARGIN = 16;

/** The camera-toggle button's own fixed size — shared between the constructor (building it) and positionCameraToggleButton() (which needs the height to land the button's bottom edge, not its top, at the screen's bottom edge). */
const CAMERA_TOGGLE_BUTTON_SIZE = { width: 160, height: 48 };

export default class UIService {
    private readonly game: Game;

    /** The backpack HUD panel — see BackpackUI.ts's own doc. Exposed read-only since nothing outside this service should reposition or destroy it directly. */
    public readonly backpackUi: BackpackUI;

    /** The base-stockpile HUD panel, pinned top-right — see GlobalResourcesUI.ts's own doc. */
    public readonly globalResourcesUi: GlobalResourcesUI;

    /** The money HUD panel, pinned top-right — see EconomyUI.ts's own doc. */
    public readonly economyUi: EconomyUI;

    /** The tool/level HUD panel, pinned bottom-right — see ToolLevelUI.ts's own doc. */
    public readonly toolLevelUi: ToolLevelUI;

    /** Bottom-left toggle between the normal follow camera and a top-down view. No button texture art exists yet for pizza — PIXI.Texture.WHITE + tint is the same "flat colored placeholder until real art exists" convention BuildingMeshConfig/GateMeshConfig already use for meshes, just applied to a UI button instead. */
    private readonly cameraToggleButton: BaseButton;

    /** Top-left mute + settings buttons, and the settings panel the gear button opens — see SettingsUIService.ts's own doc. */
    private readonly settingsUi: SettingsUIService;

    /**
     * `onCameraToggle` is a callback into the scene rather than this service importing
     * PizzaScene directly — same structural-interface style ScreenAnchorHost already uses
     * elsewhere in this game, so UIService doesn't need to know anything about camera state.
     */
    public constructor(game: Game, onCameraToggle: () => void) {
        this.game = game;

        this.backpackUi = new BackpackUI();
        this.game.uiLayer.addChild(this.backpackUi);

        this.globalResourcesUi = new GlobalResourcesUI();
        //this.game.uiLayer.addChild(this.globalResourcesUi);

        this.economyUi = new EconomyUI();
        this.game.uiLayer.addChild(this.economyUi);

        this.toolLevelUi = new ToolLevelUI();
        this.game.uiLayer.addChild(this.toolLevelUi);

        this.cameraToggleButton = new BaseButton({
            standard: {
                width: CAMERA_TOGGLE_BUTTON_SIZE.width, height: CAMERA_TOGGLE_BUTTON_SIZE.height,
                texture: PIXI.Texture.WHITE, tint: 0x2255aa,
                fontStyle: new PIXI.TextStyle(TextStyleRegistry.Body),
                fontColor: 0xffffff,
            },
            over: { tint: 0x336ecb },
            down: { tint: 0x163d7a },
            // The callback belongs on CLICK, not STANDARD — BaseButton.setState() fires
            // attr.callback() unconditionally whenever it transitions INTO that state (see
            // core/ui/BaseButton.ts's setState()), and setState(STANDARD) runs on
            // construction AND every mouse-out, not just clicks. Putting the callback there
            // would fire it on load and on every hover-away.
            click: { callback: onCameraToggle },
        });
        this.cameraToggleButton.setLabel('Top-Down View');
        this.game.uiLayer.addChild(this.cameraToggleButton);

        this.settingsUi = new SettingsUIService(this.game);
        UpgradeNotificationManager.instance.init(this.game);

        this.update();
    }

    /** Flips the camera-toggle button's own label — called by the scene right after it flips its own isTopDownCamera state, so the button always reads what it's about to switch TO next. */
    public setCameraToggleLabel(text: string): void {
        this.cameraToggleButton.setLabel(text);
    }

    /** Re-anchors every panel to the current viewport every frame — cheap, and this scene has no resize hook of its own to piggyback on instead. */
    public update(): void {
        this.positionBackpackUi();
        this.positionGlobalResourcesUi();
        this.positionEconomyUi();
        this.positionCameraToggleButton();
        this.positionToolLevelUi();
        this.settingsUi.update();
    }

    /** Bottom-center, regardless of viewport size/aspect. */
    private positionBackpackUi(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }

        this.backpackUi.position.set(
            screen.center.x - this.backpackUi.panelWidth / 2,
            screen.bottomLeft.y - this.backpackUi.panelHeight - BACKPACK_UI_BOTTOM_MARGIN,
        );
    }

    /** Top-right, regardless of viewport size/aspect. Re-run every frame since the panel's own size changes as rows are added. */
    private positionGlobalResourcesUi(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }

        this.globalResourcesUi.position.set(
            screen.topRight.x - this.globalResourcesUi.panelWidth - GLOBAL_RESOURCES_UI_MARGIN,
            screen.topRight.y + GLOBAL_RESOURCES_UI_MARGIN,
        );
    }

    /** Top-right, regardless of viewport size/aspect — same spot globalResourcesUi would occupy (see ECONOMY_UI_MARGIN's own doc). */
    private positionEconomyUi(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }

        this.economyUi.position.set(
            screen.topRight.x - this.economyUi.panelWidth - ECONOMY_UI_MARGIN,
            screen.topRight.y + ECONOMY_UI_MARGIN,
        );
    }

    /**
     * Bottom-left, regardless of viewport size/aspect. BaseButton's anchor param only affects
     * its INTERNAL pivot (see updateTexturePosition() — it sets both `pivot` and `x`/`y` to
     * the same offset, which cancel out to the same rendered rect regardless of anchor), so
     * this container's origin is always the button's own TOP-LEFT corner — same as BackpackUI,
     * which is why this subtracts the full height, not just a margin, to land the button's
     * BOTTOM edge (not its top) at the screen's bottom edge.
     */
    private positionCameraToggleButton(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }

        this.cameraToggleButton.position.set(
            screen.bottomLeft.x + CAMERA_TOGGLE_BUTTON_MARGIN,
            screen.bottomLeft.y - CAMERA_TOGGLE_BUTTON_SIZE.height - CAMERA_TOGGLE_BUTTON_MARGIN,
        );
    }

    /**
     * Bottom-right, regardless of viewport size/aspect. ToolLevelUI's own local (0,0) sits at
     * the BOTTOM of its row list (see that file's own doc — rows stack UPWARD from y=0), not
     * the panel's top-left corner like every other panel here — so unlike
     * positionGlobalResourcesUi()/positionEconomyUi()'s `panelWidth`/`panelHeight` fields, this
     * anchors off getLocalBounds() directly: `bounds.x`/`bounds.y` already account for
     * wherever the frame actually extends relative to that origin (including AutoFitFrame's
     * own padding), so subtracting them out is what correctly lands the frame's real
     * bottom-right corner at the screen's, whichever direction the content happens to extend.
     */
    private positionToolLevelUi(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }

        const bounds = this.toolLevelUi.getLocalBounds();
        this.toolLevelUi.position.set(
            screen.bottomRight.x - bounds.x - bounds.width - TOOL_LEVEL_UI_MARGIN,
            screen.bottomRight.y - bounds.y - bounds.height - TOOL_LEVEL_UI_MARGIN,
        );
    }

    public destroy(): void {
        this.backpackUi.destroy();
        this.globalResourcesUi.destroy();
        this.economyUi.destroy();
        this.cameraToggleButton.destroy();
        this.toolLevelUi.destroy();
        this.settingsUi.destroy();
    }
}
