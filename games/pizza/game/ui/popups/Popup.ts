// Popup.ts
//
// Base class for anything shown through PopupManager — owns the shared
// chrome (AutoFitFrame panel, a header row with the title and close button
// side by side) so a concrete popup (SettingsPopup, future ones) only has to
// describe its OWN content via buildContent(), not rebuild alignment/frame/
// close-button plumbing every time.
//
// Content lays out inside a FIXED-WIDTH column (`contentWidth`) rather than
// auto-sizing from whatever children happen to be added — anchoring the
// title against AutoFitFrame's own auto-measured bounds (which include
// wherever the close button happens to sit) drifts the title off-true
// depending on what else is in the popup. Anchoring the title AND every
// piece of `buildContent`'s own content to the same known `contentWidth`
// instead keeps everything aligned to one authoritative column regardless
// of what's added.

import * as PIXI from 'pixi.js';
import Assets from '../../../Assets';
import { TextStyleRegistry } from '../TextStyleRegistry';
import AutoFitFrame, { uniformFitPadding } from '../AutoFitFrame';
import { FrameName } from '../FrameRegistry';
import { createLibraryButton } from '../ButtonLibrary';

const CLOSE_BUTTON_SIZE = 48;
const CLOSE_BUTTON_ICON_SIZE = 30;
/** Gap between the title's own reserved width and the close button — see this constructor's own titleAreaWidth math. */
const TITLE_CLOSE_GAP = 10;
const TITLE_CONTENT_GAP = 20;
const PANEL_PADDING = 28;
/** Smaller than TextStyleRegistry.Title's own 32px — a popup header shares its row with the close button now (see this constructor's own doc), and the full-size Title style ran wide enough to overlap it on a narrow popup (e.g. SettingsPopup's 220px content column). */
const TITLE_FONT_SIZE = 22;

export interface PopupOptions {
    /** Column width every child (title, buildContent's own content) lays out against — see this file's own doc. */
    contentWidth?: number;
    /** Whether PopupManager should show a full-screen dark backdrop behind this popup. Defaults to true. */
    darkenBackground?: boolean;
    /** 9-slice panel chrome — defaults to the same 'Popup' bubble frame every other pizza panel uses (see FrameRegistry.ts). */
    frame?: FrameName;
}

export default abstract class Popup {
    public readonly root = new PIXI.Container();
    public readonly darkenBackground: boolean;
    protected readonly contentWidth: number;

    private readonly frame: AutoFitFrame;
    private onCloseRequested?: () => void;

    protected constructor(title: string, options: PopupOptions = {}) {
        this.contentWidth = options.contentWidth ?? 300;
        this.darkenBackground = options.darkenBackground ?? true;

        const column = new PIXI.Container();

        // Header row — title and close button share one row rather than the close button
        // floating above the title as a corner badge. The title is centered within its OWN
        // reserved width (contentWidth minus the close button's own column + gap), NOT the full
        // contentWidth — centering across the full width would let a long title run underneath
        // the button instead of stopping short of it. Both are vertically centered against
        // whichever of them is taller (see headerHeight below).
        const titleAreaWidth = this.contentWidth - CLOSE_BUTTON_SIZE - TITLE_CLOSE_GAP;
        const titleText = new PIXI.Text(title, { ...TextStyleRegistry.Title, fontSize: TITLE_FONT_SIZE });
        const headerHeight = Math.max(titleText.height, CLOSE_BUTTON_SIZE);
        titleText.anchor.set(0.5, 0.5);
        titleText.position.set(titleAreaWidth / 2, headerHeight / 2);
        column.addChild(titleText);

        const content = new PIXI.Container();
        content.position.set(0, headerHeight + TITLE_CONTENT_GAP);
        column.addChild(content);

        // Populated AFTER content is already positioned/parented — buildContent() only ever
        // needs to add children into it, never worry about its own placement within column.
        this.buildContent(content, this.contentWidth);

        // Every close button in the game goes through this one spot — see ButtonLibrary.ts's
        // own doc for why 'red' is the fixed, non-configurable color here (a close action should
        // always read the same way, regardless of which popup it's closing).
        const closeButton = createLibraryButton({
            color: 'red',
            width: CLOSE_BUTTON_SIZE, height: CLOSE_BUTTON_SIZE,
            iconTexture: PIXI.Texture.from(Assets.Textures.Icons.Close),
            iconSize: { width: CLOSE_BUTTON_ICON_SIZE, height: CLOSE_BUTTON_ICON_SIZE },
            onClick: () => this.requestClose(),
        });
        closeButton.position.set(
            this.contentWidth - CLOSE_BUTTON_SIZE,
            headerHeight / 2 - CLOSE_BUTTON_SIZE / 2,
        );
        column.addChild(closeButton);

        this.frame = new AutoFitFrame(uniformFitPadding(PANEL_PADDING), options.frame ?? 'Popup', column);
        this.root.addChild(this.frame);

        // root's own local (0,0) is wherever `column`'s (0,0) happens to land — that's the
        // title's own anchor point, NOT the panel's visual center (the close button hangs past
        // contentWidth on one side, the frame's own padding extends past content on every side,
        // ...). Pivoting to the panel's ACTUAL rendered bounds is what makes `root.position`
        // (set by PopupManager) land the panel's real visual center on screen, and makes
        // rotation/scale (see PopupTransitions.ts) pivot around that same true center instead
        // of some arbitrary corner.
        const bounds = this.root.getLocalBounds();
        this.root.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    }

    /** Concrete popups implement this — add whatever this popup needs into `content`, laid out against `contentWidth` (e.g. `x: contentWidth / 2 - button.width / 2` to center a button). Called once, during construction, before the panel frame is fit around the final size. */
    protected abstract buildContent(content: PIXI.Container, contentWidth: number): void;

    /** PopupManager wires this via bindClose() right before showing the popup — lets content added in buildContent() (e.g. a "Done" button) close the popup without needing to know PopupManager exists. */
    protected requestClose(): void {
        this.onCloseRequested?.();
    }

    /** Called by PopupManager right before showing this popup — see requestClose()'s own doc. */
    public bindClose(onCloseRequested: () => void): void {
        this.onCloseRequested = onCloseRequested;
    }

    /**
     * Optional lifecycle hook — override to run cleanup the moment PopupManager actually starts
     * closing THIS popup, regardless of which of the three paths triggered it: the header's own
     * close button (via requestClose()), tapping the darkened backdrop (PopupManager.show()'s
     * own backdrop handler calls close() directly, bypassing requestClose() entirely), or this
     * popup getting silently replaced by a new show() call (closeImmediate()). A popup that
     * needs to undo something for as long as it was open (e.g. MartZone freezing player
     * movement while its MartPopup is up) needs exactly this — requestClose() alone misses the
     * backdrop-tap and get-replaced cases. Fires once, synchronously, right as the close
     * begins (before any exit animation finishes) — see notifyClosed(), PopupManager's own
     * caller.
     */
    protected onClosed(): void {
        // No-op by default — most popups have nothing to undo on close.
    }

    /** PopupManager's own call into onClosed() — public because PopupManager is a different class and onClosed() itself stays protected (an implementation detail concrete popups override, not something external code should invoke directly). */
    public notifyClosed(): void {
        this.onClosed();
    }
}
