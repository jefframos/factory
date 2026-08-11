// UIService.ts
//
// Owns every screen-anchored HUD element PizzaScene shows — the backpack
// panel, the base-stockpile panel, the camera-toggle button, and wherever
// future UI (e.g. a building panel) gets added — so the scene itself just
// builds/updates/destroys ONE thing instead of a field + setup method +
// per-frame position method + teardown line for every panel. Everything here
// is a direct child of `game.overlayContainer`; `Game.overlayScreenData` is
// already expressed in that container's own local space (see that field's
// own doc in core/Game.ts), so every positionX() below can use its corners
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

/** Gap between the backpack HUD panel's bottom edge and the actual bottom of the screen — see positionBackpackUi(). */
const BACKPACK_UI_BOTTOM_MARGIN = 16;

/** Gap between the global-resources HUD panel's top/right edges and the actual top-right corner of the screen — see positionGlobalResourcesUi(). */
const GLOBAL_RESOURCES_UI_MARGIN = 16;

/** Gap between the camera-toggle button's bottom/left edges and the actual bottom-left corner of the screen — see positionCameraToggleButton(). */
const CAMERA_TOGGLE_BUTTON_MARGIN = 16;

/** The camera-toggle button's own fixed size — shared between the constructor (building it) and positionCameraToggleButton() (which needs the height to land the button's bottom edge, not its top, at the screen's bottom edge). */
const CAMERA_TOGGLE_BUTTON_SIZE = { width: 160, height: 48 };

export default class UIService {
    private readonly game: Game;

    /** The backpack HUD panel — see BackpackUI.ts's own doc. Exposed read-only since nothing outside this service should reposition or destroy it directly. */
    public readonly backpackUi: BackpackUI;

    /** The base-stockpile HUD panel, pinned top-right — see GlobalResourcesUI.ts's own doc. */
    public readonly globalResourcesUi: GlobalResourcesUI;

    /** Bottom-left toggle between the normal follow camera and a top-down view. No button texture art exists yet for pizza — PIXI.Texture.WHITE + tint is the same "flat colored placeholder until real art exists" convention BuildingMeshConfig/GateMeshConfig already use for meshes, just applied to a UI button instead. */
    private readonly cameraToggleButton: BaseButton;

    /**
     * `onCameraToggle` is a callback into the scene rather than this service importing
     * PizzaScene directly — same structural-interface style ScreenAnchorHost already uses
     * elsewhere in this game, so UIService doesn't need to know anything about camera state.
     */
    public constructor(game: Game, onCameraToggle: () => void) {
        this.game = game;

        this.backpackUi = new BackpackUI();
        this.game.overlayContainer.addChild(this.backpackUi);

        this.globalResourcesUi = new GlobalResourcesUI();
        this.game.overlayContainer.addChild(this.globalResourcesUi);

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
        this.game.overlayContainer.addChild(this.cameraToggleButton);

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
        this.positionCameraToggleButton();
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

    public destroy(): void {
        this.backpackUi.destroy();
        this.globalResourcesUi.destroy();
        this.cameraToggleButton.destroy();
    }
}
