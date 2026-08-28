// InGameButtonList.ts
//
// A vertical stack of small utility buttons pinned bottom-left — the exact screen slot the
// camera-toggle button used to occupy alone (see UIService.ts). registerButton() is a STATIC
// entry point:
//
//   InGameButtonList.registerButton('Open Next Zone', () => worldManager.revealNextZone());
//
// so any file can add a button without importing/threading a UIService reference through —
// mirrors DevGuiManager's own singleton convention, just exposed as a bare static method since
// every caller only ever wants to do the one thing: add a button. Buttons stack UPWARD from the
// bottom-most slot in REGISTRATION order — the first-ever registered button (UIService's own
// "Top-Down View" toggle) lands exactly where the old standalone button used to sit, and each
// later registration (Clear Data, Open Next Zone, ...) appears progressively higher above it.
//
// Exactly one instance is expected to exist at a time (constructed once by UIService, same as
// every other HUD panel) — a second constructor call simply replaces the registration target,
// same "only the current one matters" convention TileWalkability.ts's own query slot uses.

import * as PIXI from 'pixi.js';
import BaseButton from 'core/ui/BaseButton';
import { Game } from 'core/Game';
import { TextStyleRegistry } from './TextStyleRegistry';

/** Shared by every button in the list — same fixed size the old standalone camera-toggle button used. */
const BUTTON_SIZE = { width: 160, height: 48 };
/** Vertical gap between two stacked buttons. */
const BUTTON_GAP = 8;
/** Gap between the stack's bottom/left edges and the actual bottom-left corner of the screen — same margin the old standalone camera-toggle button used. */
const SCREEN_MARGIN = 16;

export default class InGameButtonList extends PIXI.Container {
    /** Whichever instance was constructed most recently — see this file's own doc for why a bare static method needs this. */
    private static current?: InGameButtonList;

    private readonly buttons: BaseButton[] = [];

    public constructor() {
        super();
        InGameButtonList.current = this;
    }

    /**
     * Adds one button to whichever InGameButtonList instance is currently live (see this
     * file's own doc) and returns it — hold onto the reference only if the caller needs to
     * change its label/state later (e.g. UIService.setCameraToggleLabel()); nothing else about
     * positioning it is the caller's concern.
     */
    public static registerButton(label: string, onClick: () => void): BaseButton {
        if (!InGameButtonList.current) {
            throw new Error('[InGameButtonList] registerButton() called before any instance exists — UIService constructs one at scene build, before anything else registers a button.');
        }
        return InGameButtonList.current.addButton(label, onClick);
    }

    /** This list's own top edge, in absolute screen space — AnimalDockUi (see UIService.positionAnimalDockUi()) stacks directly above the WHOLE list instead of the single camera-toggle button it used to anchor off, so it always clears however many buttons have been registered. 0 registered buttons degenerates to this container's own (bottom) anchor point. */
    public getTopScreenY(): number {
        return this.position.y + this.topLocalY();
    }

    /** Bottom-left, regardless of viewport size/aspect — same corner/margin the old standalone camera-toggle button anchored to directly. Call every frame, same as every other HUD panel here. */
    public update(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }
        this.position.set(
            screen.bottomLeft.x + SCREEN_MARGIN,
            screen.bottomLeft.y - SCREEN_MARGIN,
        );
    }

    private addButton(label: string, onClick: () => void): BaseButton {
        const button = new BaseButton({
            standard: {
                width: BUTTON_SIZE.width, height: BUTTON_SIZE.height,
                texture: PIXI.Texture.WHITE, tint: 0x2255aa,
                fontStyle: new PIXI.TextStyle(TextStyleRegistry.Body),
                fontColor: 0xffffff,
            },
            over: { tint: 0x336ecb },
            down: { tint: 0x163d7a },
            // The callback belongs on CLICK, not STANDARD — see UIService.ts's own doc on the
            // camera-toggle button (the convention this mirrors) for why STANDARD would fire
            // it on load and on every hover-away instead of just on click.
            click: { callback: onClick },
        });
        button.setLabel(label);

        const index = this.buttons.length;
        // BaseButton's own anchor param only affects its INTERNAL pivot (see
        // UIService.positionCameraToggleButton()'s old own doc — it sets both `pivot` and
        // `x`/`y` to the same offset, which cancel out), so this container's origin is always
        // the button's own TOP-LEFT corner. Slot 0 (the first-ever registered button) sits with
        // its BOTTOM edge exactly at this list's own bottom-anchor point (local y=0 — see
        // update()); each later slot stacks one button-height+gap higher above it.
        button.position.set(0, -(index + 1) * BUTTON_SIZE.height - index * BUTTON_GAP);
        this.addChild(button);
        this.buttons.push(button);
        return button;
    }

    /** Local Y (relative to this container's own bottom-anchor origin — see update()) of the topmost registered button's TOP edge — see getTopScreenY()'s own doc. */
    private topLocalY(): number {
        const count = this.buttons.length;
        if (count === 0) {
            return 0;
        }
        return -(count * BUTTON_SIZE.height + (count - 1) * BUTTON_GAP);
    }

    public destroy(): void {
        super.destroy({ children: true });
        if (InGameButtonList.current === this) {
            InGameButtonList.current = undefined;
        }
    }
}
