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
import BackpackListUI from './BackpackListUI';
import AnimalFollowUI from './AnimalFollowUI';
import AnimalDockUI from './AnimalDockUI';
import GlobalResourcesUI from './GlobalResourcesUI';
import EconomyUI from './EconomyUI';
import ToolLevelUI from './ToolLevelUI';
import ToolListUI from './ToolListUI';
import SettingsUIService, { SETTINGS_ROW_BUTTON_SIZE, SETTINGS_ROW_TOP_LEFT_MARGIN } from './SettingsUIService';
import { UpgradeNotificationManager } from './notifications/UpgradeNotificationManager';

/** Gap between the backpack HUD panel's bottom edge and the actual bottom of the screen — see positionBackpackUi(). Only relevant if backpackUi is switched back on — see that field's own comment. */
const BACKPACK_UI_BOTTOM_MARGIN = 16;

/** Gap between the backpack LIST's top/left edges and the currency topbar/screen edge — see positionBackpackListUi(). */
const BACKPACK_LIST_UI_MARGIN = 16;
/** Extra vertical gap below the currency topbar's own bottom edge before the backpack list starts — see positionBackpackListUi(). */
const BACKPACK_LIST_UI_TOP_GAP = 10;

/** Gap between the animal-followers HUD panel's bottom edge and the backpack panel's own top edge — see positionAnimalFollowUi(). Only relevant if animalFollowUi is switched back on — see that field's own comment. */
const ANIMAL_FOLLOW_UI_BOTTOM_MARGIN = 10;

/** Gap between the animal dock's bottom edge and the camera-toggle button's own top edge (it sits directly above that button, same bottom-left column) — see positionAnimalDockUi(). */
const ANIMAL_DOCK_UI_BOTTOM_MARGIN = 10;

/** Gap between the global-resources HUD panel's top/right edges and the actual top-right corner of the screen — see positionGlobalResourcesUi(). */
const GLOBAL_RESOURCES_UI_MARGIN = 16;

/** Gap between the economy (money) HUD panel's top/right edges and the actual top-right corner of the screen — see positionEconomyUi(). Same spot globalResourcesUi would occupy (that panel is currently not added to the display tree), so no visual collision. */
const ECONOMY_UI_MARGIN = 16;

/** Gap between the camera-toggle button's bottom/left edges and the actual bottom-left corner of the screen — see positionCameraToggleButton(). */
const CAMERA_TOGGLE_BUTTON_MARGIN = 16;

/** Gap between the tool/level HUD panel's bottom/right edges and the actual bottom-right corner of the screen — see positionToolLevelUi(). Only relevant if toolLevelUi is switched back on — see that field's own comment. */
const TOOL_LEVEL_UI_MARGIN = 16;

/** Gap between the tool LIST's left edge and the settings row's own left edge — see positionToolListUi(). Reuses SETTINGS_ROW_TOP_LEFT_MARGIN so both rows share the exact same left inset. */
const TOOL_LIST_UI_MARGIN = SETTINGS_ROW_TOP_LEFT_MARGIN;
/** Extra vertical gap below the settings/mute button row's own bottom edge before the tool list starts — see positionToolListUi(). */
const TOOL_LIST_UI_TOP_GAP = 10;

/** The camera-toggle button's own fixed size — shared between the constructor (building it) and positionCameraToggleButton() (which needs the height to land the button's bottom edge, not its top, at the screen's bottom edge). */
const CAMERA_TOGGLE_BUTTON_SIZE = { width: 160, height: 48 };

export default class UIService {
    private readonly game: Game;

    /** The backpack HUD panel — see BackpackUI.ts's own doc. Built but NOT added to the display tree right now (backpackListUi is the one actually shown — see that field's own comment); kept around/updated so switching back is a one-line change in the constructor. Exposed read-only since nothing outside this service should reposition or destroy it directly. */
    public readonly backpackUi: BackpackUI;

    /** The backpack, alternative style — a bare vertical icon+count list (no frame/title), pinned top-right under the currency topbar. This is the one actually wired into the display tree; see BackpackListUI.ts's own doc for why it exists alongside backpackUi instead of replacing it. */
    public readonly backpackListUi: BackpackListUI;

    /** The animal-followers HUD panel — see AnimalFollowUI.ts's own doc. Built but NOT added to the display tree right now (animalDockUi is the one actually shown — see that field's own comment); kept around/updated so switching back is a one-line change in the constructor. */
    public readonly animalFollowUi: AnimalFollowUI;

    /** The animal followers, alternative style — a single boxed "dock" pinned bottom-center, no title (just a capacity readout), with each icon idly floating. This is the one actually wired into the display tree; see AnimalDockUI.ts's own doc for why it exists alongside animalFollowUi instead of replacing it. */
    public readonly animalDockUi: AnimalDockUI;

    /** The base-stockpile HUD panel, pinned top-right — see GlobalResourcesUI.ts's own doc. */
    public readonly globalResourcesUi: GlobalResourcesUI;

    /** The currency topbar (money/gems/energy), pinned top-right — see EconomyUI.ts's own doc. */
    public readonly economyUi: EconomyUI;

    /** The tool/level HUD panel — see ToolLevelUI.ts's own doc. Built but NOT added to the display tree right now (toolListUi is the one actually shown — see that field's own comment); kept around/updated so switching back is a one-line change in the constructor. */
    public readonly toolLevelUi: ToolLevelUI;

    /** The tools, alternative style — a bare vertical icon+level list (no frame/title), pinned top-left under the settings/mute button row. This is the one actually wired into the display tree; see ToolListUI.ts's own doc for why it exists alongside toolLevelUi instead of replacing it. */
    public readonly toolListUi: ToolListUI;

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
        //this.game.uiLayer.addChild(this.backpackUi);

        this.backpackListUi = new BackpackListUI();
        this.game.uiLayer.addChild(this.backpackListUi);

        this.animalFollowUi = new AnimalFollowUI();
        //this.game.uiLayer.addChild(this.animalFollowUi);

        this.animalDockUi = new AnimalDockUI();
        this.game.uiLayer.addChild(this.animalDockUi);

        this.globalResourcesUi = new GlobalResourcesUI();
        //this.game.uiLayer.addChild(this.globalResourcesUi);

        this.economyUi = new EconomyUI();
        this.game.uiLayer.addChild(this.economyUi);

        this.toolLevelUi = new ToolLevelUI();
        //this.game.uiLayer.addChild(this.toolLevelUi);

        this.toolListUi = new ToolListUI();
        this.game.uiLayer.addChild(this.toolListUi);

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
        this.positionAnimalFollowUi();
        this.positionGlobalResourcesUi();
        this.positionEconomyUi();
        this.positionBackpackListUi();
        this.positionCameraToggleButton();
        // Reads cameraToggleButton's own just-set position — must run after it (see this
        // method's own doc on positionAnimalDockUi()).
        this.positionAnimalDockUi();
        this.positionToolLevelUi();
        this.positionToolListUi();
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

    /** Bottom-center, stacked directly above the backpack panel (re-reads backpackUi's own current position, already set for this frame by positionBackpackUi() right before this runs — see update()'s own call order) — regardless of viewport size/aspect, and re-run every frame since either panel's own size can change as rows/slots are added. */
    private positionAnimalFollowUi(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }

        this.animalFollowUi.position.set(
            screen.center.x - this.animalFollowUi.panelWidth / 2,
            this.backpackUi.position.y - this.animalFollowUi.panelHeight - ANIMAL_FOLLOW_UI_BOTTOM_MARGIN,
        );
    }

    /** Bottom-left, stacked directly above the camera-toggle button (re-reads its own current position, already set for this frame by positionCameraToggleButton() right before this runs — see update()'s own call order) — same column, same left inset. Re-run every frame since the list's own size changes as followers join/leave, and it's hidden entirely (panelWidth/panelHeight both 0) at zero followers. */
    private positionAnimalDockUi(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }

        this.animalDockUi.position.set(
            screen.bottomLeft.x + CAMERA_TOGGLE_BUTTON_MARGIN,
            this.cameraToggleButton.position.y - this.animalDockUi.panelHeight - ANIMAL_DOCK_UI_BOTTOM_MARGIN,
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

    /** Top-right, dropped below the currency topbar's own height so it reads as "under the currency" — re-run every frame since either panel's own size can change (the list as resources are gathered/deposited, the topbar's height is otherwise fixed but re-read anyway for consistency). */
    private positionBackpackListUi(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }

        this.backpackListUi.position.set(
            screen.topRight.x - this.backpackListUi.panelWidth - BACKPACK_LIST_UI_MARGIN,
            screen.topRight.y + this.economyUi.panelHeight + BACKPACK_LIST_UI_MARGIN + BACKPACK_LIST_UI_TOP_GAP,
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

    /** Top-left, dropped below the settings/mute button row's own fixed height so it reads as "under the settings" — re-run every frame since the list's own height changes as tools are crafted/upgraded. */
    private positionToolListUi(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }

        this.toolListUi.position.set(
            screen.topLeft.x + TOOL_LIST_UI_MARGIN,
            screen.topLeft.y + SETTINGS_ROW_TOP_LEFT_MARGIN + SETTINGS_ROW_BUTTON_SIZE + TOOL_LIST_UI_TOP_GAP,
        );
    }

    public destroy(): void {
        this.backpackUi.destroy();
        this.backpackListUi.destroy();
        this.animalFollowUi.destroy();
        this.animalDockUi.destroy();
        this.globalResourcesUi.destroy();
        this.economyUi.destroy();
        this.cameraToggleButton.destroy();
        this.toolLevelUi.destroy();
        this.toolListUi.destroy();
        this.settingsUi.destroy();
    }
}
