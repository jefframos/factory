// InGameButtonList.ts
//
// A vertical stack of small utility/testing buttons pinned bottom-left — the exact screen slot
// the camera-toggle button used to occupy alone (see UIService.ts). registerButton() is a
// STATIC entry point:
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
// The whole stack is COLLAPSIBLE — these are testing/debug tools (see PizzaScene.ts's own
// registrations), not something a player needs in their face by default — behind one small
// always-visible toggle button pinned at the very bottom of the column (below every registered
// button, in the slot the stack itself used to occupy). Collapsed/expanded persists across
// reloads via DebugMenuVisibilityCookie.ts, so a designer who expands it once doesn't have to
// re-expand it every session.
//
// A separate "Hide" row (see hideButton) sits permanently at the TOP of the collapsible stack
// (above every registered button, repositioned whenever one more gets added) and hides the
// ENTIRE list — including the toggle button itself — for the rest of THIS session only. Nothing
// about that is persisted anywhere (no cookie write, unlike the expand/collapse toggle) — it's
// plain in-memory `visible = false`, so a page refresh always brings the whole thing back
// regardless of how it was left before reloading.
//
// Exactly one instance is expected to exist at a time (constructed once by UIService, same as
// every other HUD panel) — a second constructor call simply replaces the registration target,
// same "only the current one matters" convention TileWalkability.ts's own query slot uses.

import * as PIXI from 'pixi.js';
import BaseButton from 'core/ui/BaseButton';
import { Game } from 'core/Game';
import { createLibraryButton } from './ButtonLibrary';
import { DebugMenuVisibilityCookie } from '../utils/DebugMenuVisibilityCookie';

/** Shared by every registered button in the list — same fixed size the old standalone camera-toggle button used. */
const BUTTON_SIZE = { width: 160, height: 48 };
/** Vertical gap between two stacked buttons. */
const BUTTON_GAP = 8;
/** Gap between the stack's bottom/left edges and the actual bottom-left corner of the screen — same margin the old standalone camera-toggle button used. */
const SCREEN_MARGIN = 16;
/** The always-visible toggle button occupies the same footprint/gap as every other row — same width/height/BUTTON_GAP, just pinned unconditionally at local y=0 (see the constructor's own doc) instead of stacking with the collapsible rows above it. */
const TOGGLE_RESERVED_HEIGHT = BUTTON_SIZE.height + BUTTON_GAP;
/** Gap between the topmost button row (hideButton) and the info text sitting above it — see registerText(). */
const INFO_TEXT_GAP = 8;

export default class InGameButtonList extends PIXI.Container {
    /** Whichever instance was constructed most recently — see this file's own doc for why a bare static method needs this. */
    private static current?: InGameButtonList;

    private readonly buttons: BaseButton[] = [];
    /** Parent of every REGISTERED button — a separate child container (not `this` directly) so its whole visibility can be toggled in one line without touching the always-visible toggle button, which is a direct child of `this` instead. */
    private readonly buttonsColumn = new PIXI.Container();
    private readonly toggleButton: BaseButton;
    /** Always the topmost row (see repositionHideButton()) — see this file's own doc for what it does. Lives in buttonsColumn (not a direct child of `this`, unlike toggleButton) since it's part of the collapsible menu, only visible/reachable while expanded. */
    private readonly hideButton: BaseButton;
    /** Live-updated read-only text sitting above every registered button (see registerText()) — one shared PIXI.Text, its content rebuilt every frame by joining every registered getter with a newline, rather than one Text object per registration; debug info like this rarely needs independently-clickable/positioned rows the way buttons do. Lives in buttonsColumn, same visibility rules as every button row. */
    private readonly infoText: PIXI.Text;
    private readonly infoTextGetters: Array<() => string> = [];
    private expanded: boolean;

    public constructor() {
        super();
        InGameButtonList.current = this;

        // Debug/testing tools (see this file's own top doc) — never shown at all unless the page
        // was loaded with ?debug=1, same Game.debugParams convention every game's own index.ts
        // already uses to gate DevGuiManager. registerButton()/registerText() still work
        // normally either way (PizzaScene's own debug registrations, UIService's camera-toggle
        // registration, ...) — this only hides the RESULT, so a caller never needs to check
        // Game.debugParams itself before registering something here.
        this.visible = Boolean(Game.debugParams.debug);

        this.addChild(this.buttonsColumn);

        this.expanded = DebugMenuVisibilityCookie.isExpanded();
        this.buttonsColumn.visible = this.expanded;

        this.toggleButton = createLibraryButton({
            color: 'orange',
            width: BUTTON_SIZE.width, height: BUTTON_SIZE.height,
            label: this.toggleLabel(),
            // On CLICK, not STANDARD — same reasoning as SettingsUIService.settingsButton's own
            // doc (setState(STANDARD) also fires on construction and every mouse-out).
            onClick: () => this.setExpanded(!this.expanded),
        });
        // Pinned at local (0,0) — same "bottom edge sits at this list's own bottom-anchor point"
        // idiom addButton() uses for slot 0, just permanently instead of shifting with the
        // registered count.
        this.toggleButton.position.set(0, -BUTTON_SIZE.height);
        this.addChild(this.toggleButton);

        this.hideButton = createLibraryButton({
            color: 'red',
            width: BUTTON_SIZE.width, height: BUTTON_SIZE.height,
            label: 'Hide (This Session)',
            onClick: () => this.hideForSession(),
        });
        this.buttonsColumn.addChild(this.hideButton);

        this.infoText = new PIXI.Text('', new PIXI.TextStyle({
            fontFamily: 'Arial', fontSize: 14, fill: 0xffffff,
            dropShadow: true, dropShadowDistance: 1, dropShadowAlpha: 0.8,
        }));
        this.buttonsColumn.addChild(this.infoText);

        this.repositionHideButton();
    }

    private toggleLabel(): string {
        return this.expanded ? 'Hide Debug Menu' : 'Show Debug Menu';
    }

    private setExpanded(expanded: boolean): void {
        this.expanded = expanded;
        this.buttonsColumn.visible = expanded;
        this.toggleButton.setLabel(this.toggleLabel());
        DebugMenuVisibilityCookie.setExpanded(expanded);
    }

    /** Hides the WHOLE list (toggle button included) for the rest of this session — see this file's own doc for why nothing here touches DebugMenuVisibilityCookie. */
    private hideForSession(): void {
        this.visible = false;
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

    /**
     * Registers one more line of live, read-only debug text shown ABOVE every button row (see
     * `infoText`'s own doc) — `getText` is called fresh every frame (see update()), so it's
     * always safe to read live/mutable state (ACTION_CONFIG, ShopUpgradeStorage, ...) directly
     * inside it rather than snapshotting anything at registration time. Every registered line
     * (across every caller) joins into the SAME PIXI.Text, in registration order, one per line.
     */
    public static registerText(getText: () => string): void {
        if (!InGameButtonList.current) {
            throw new Error('[InGameButtonList] registerText() called before any instance exists — UIService constructs one at scene build, before anything else registers a button.');
        }
        InGameButtonList.current.infoTextGetters.push(getText);
    }

    /** This list's own top edge, in absolute screen space — AnimalDockUi (see UIService.positionAnimalDockUi()) stacks directly above the WHOLE list instead of the single camera-toggle button it used to anchor off, so it always clears however many buttons have been registered, PLUS the permanent hideButton row above them AND the always-visible toggle row below them (see TOGGLE_RESERVED_HEIGHT) — all reserved unconditionally, whether the stack is currently expanded/collapsed/hidden-for-session, so AnimalDockUi never jumps when any of that changes. */
    public getTopScreenY(): number {
        return this.position.y + this.topLocalY();
    }

    /** Bottom-left, regardless of viewport size/aspect — same corner/margin the old standalone camera-toggle button anchored to directly. Call every frame, same as every other HUD panel here. */
    public update(): void {
        const screen = Game.overlayScreenData;
        if (screen) {
            this.position.set(
                screen.bottomLeft.x + SCREEN_MARGIN,
                screen.bottomLeft.y - SCREEN_MARGIN,
            );
        }

        // Rebuilt fresh every frame (see registerText()'s own doc) — height can change from one
        // frame to the next (a line growing/shrinking, or the very first getter registering
        // after construction), so reposition alongside it rather than only on button changes.
        if (this.infoTextGetters.length > 0) {
            this.infoText.text = this.infoTextGetters.map(getText => getText()).join('\n');
            this.repositionInfoText();
        }
    }

    private addButton(label: string, onClick: () => void): BaseButton {
        // Goes through the shared library (see ButtonLibrary.ts) instead of its own one-off
        // WHITE+tint texture — 'blue' keeps the same color this list always used, just sourced
        // from the same asset family every other button in the game now uses.
        const button = createLibraryButton({
            color: 'blue',
            width: BUTTON_SIZE.width, height: BUTTON_SIZE.height,
            label,
            onClick,
        });

        const index = this.buttons.length;
        // BaseButton's own anchor param only affects its INTERNAL pivot (see
        // UIService.positionCameraToggleButton()'s old own doc — it sets both `pivot` and
        // `x`/`y` to the same offset, which cancel out), so this container's origin is always
        // the button's own TOP-LEFT corner. Slot 0 (the first-ever registered button) sits
        // TOGGLE_RESERVED_HEIGHT above this list's own bottom-anchor point (local y=0 — see
        // update()) — that reserved gap is where the always-visible toggle button itself sits
        // (see the constructor) — and each later slot stacks one button-height+gap higher above it.
        button.position.set(0, -(index + 1) * BUTTON_SIZE.height - index * BUTTON_GAP - TOGGLE_RESERVED_HEIGHT);
        this.buttonsColumn.addChild(button);
        this.buttons.push(button);
        // hideButton always sits one slot above the LAST registered button — a fresh
        // registration shifts it up one more row.
        this.repositionHideButton();
        return button;
    }

    /** Keeps hideButton pinned to the topmost slot — directly above every currently-registered button — same position math addButton() uses for its own rows, just always at `index = this.buttons.length` (one past the last registered button) rather than a fixed slot. */
    private repositionHideButton(): void {
        const index = this.buttons.length;
        this.hideButton.position.set(0, -(index + 1) * BUTTON_SIZE.height - index * BUTTON_GAP - TOGGLE_RESERVED_HEIGHT);
        this.repositionInfoText();
    }

    /** Sits directly above hideButton (the topmost button row), its own bottom edge INFO_TEXT_GAP above hideButton's top edge — same "current top edge + gap" idiom every other row here uses. No-op (never actually seen, since update() only calls this while infoTextGetters is non-empty) while nothing's registered — infoText.height would just be 0 either way, an empty PIXI.Text taking up no space. */
    private repositionInfoText(): void {
        this.infoText.position.set(0, this.rowsTopLocalY() - INFO_TEXT_GAP - this.infoText.height);
    }

    /** Local Y (relative to this container's own bottom-anchor origin — see update()) of the topmost BUTTON row's TOP edge — hideButton (see this file's own doc), ALWAYS one row above however many buttons are registered, plus the reserved toggle row below everything. Doesn't include infoText's own space — see topLocalY() for the version that does. */
    private rowsTopLocalY(): number {
        const rows = this.buttons.length + 1; // +1 for the permanent hideButton row
        return -(rows * BUTTON_SIZE.height + (rows - 1) * BUTTON_GAP) - TOGGLE_RESERVED_HEIGHT;
    }

    /** rowsTopLocalY(), minus infoText's own reserved space when anything's actually registered (see getTopScreenY()'s own doc for why that reservation must be unconditional once present, so AnimalDockUi never jumps as the text's content/height changes frame to frame). */
    private topLocalY(): number {
        const infoSpace = this.infoTextGetters.length > 0 ? INFO_TEXT_GAP + this.infoText.height : 0;
        return this.rowsTopLocalY() - infoSpace;
    }

    public destroy(): void {
        super.destroy({ children: true });
        if (InGameButtonList.current === this) {
            InGameButtonList.current = undefined;
        }
    }
}
