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
import { TextStyleRegistry, fitTextWidth } from '../TextStyleRegistry';
import AutoFitFrame, { uniformFitPadding } from '../AutoFitFrame';
import { FrameName } from '../FrameRegistry';
import { createLibraryButton } from '../ButtonLibrary';
import { PANEL_CONTENT_MARGIN } from '../PanelBackground';
import { createTitleIcon } from '../TitleIcon';

const CLOSE_BUTTON_SIZE = 48;
const CLOSE_BUTTON_ICON_SIZE = 30;
/** Gap between the title's own reserved max width and the close button — see this constructor's own maxTitleWidth math. */
const TITLE_CLOSE_GAP = 10;
const TITLE_CONTENT_GAP = 20;
const PANEL_PADDING = 25;
/** Sized against the title's own line, not CLOSE_BUTTON_SIZE — see `titleIcon` option's own doc. */
const TITLE_ICON_SIZE = 48;
/** Gap between `titleIcon` and the title text that follows it. */
const TITLE_ICON_GAP = 10;

export interface PopupOptions {
    /** Column width every child (title, buildContent's own content) lays out against — see this file's own doc. */
    contentWidth?: number;
    /** Whether PopupManager should show a full-screen dark backdrop behind this popup. Defaults to true. */
    darkenBackground?: boolean;
    /**
     * Whether tapping that darkened backdrop closes this popup — defaults to true, the "tap
     * anywhere outside to dismiss" behavior every popup had before this option existed.
     * Meaningless when `darkenBackground` is false (no backdrop exists to tap at all). Set
     * false for a popup meant to be read/browsed deliberately (e.g. InventoryPopup, a
     * multi-tab menu someone can spend a while in) rather than glanced at and dismissed — see
     * PopupManager.show()'s own doc for how the backdrop still blocks clicks to whatever's
     * behind it either way, it just stops also acting as a close button.
     */
    closeOnBackdropTap?: boolean;
    /** 9-slice panel chrome — defaults to the same 'Popup' bubble frame every other pizza panel uses (see FrameRegistry.ts). */
    frame?: FrameName;
    /**
     * Texture key shown to the LEFT of the title text — the same icon that already identifies
     * this popup elsewhere in the UI (e.g. InventoryPopup passes BackpackButton's own
     * 'survival-backpack', MartPopup passes MartZone's own 'ItemIcon_Shop_old-2', CraftingTablePopup
     * passes CraftingTableZone's own 'craftingIcon'), so the popup that opens is instantly
     * recognizable as "the same thing" the player just tapped. Undefined (the default) omits it
     * entirely — SettingsPopup and any other icon-less popup are unaffected.
     */
    titleIcon?: string;
}

export default abstract class Popup {
    public readonly root = new PIXI.Container();
    public readonly darkenBackground: boolean;
    public readonly closeOnBackdropTap: boolean;
    protected readonly contentWidth: number;

    private readonly frame: AutoFitFrame;
    private onCloseRequested?: () => void;

    protected constructor(title: string, options: PopupOptions = {}) {
        this.contentWidth = options.contentWidth ?? 300;
        this.darkenBackground = options.darkenBackground ?? true;
        this.closeOnBackdropTap = options.closeOnBackdropTap ?? true;

        const column = new PIXI.Container();

        // Header row — title and close button share one row rather than the close button
        // floating above the title as a corner badge. Left-aligned at PANEL_CONTENT_MARGIN —
        // the SAME left inset every dark content panel's own row/grid content sits at (see
        // PanelBackground.ts's own doc) — so the title's own left edge always lines up with
        // whatever buildContent() adds below it, instead of floating centered above it. Both
        // title and close button are vertically centered against whichever of them is taller
        // (see headerHeight below). Uses TextStyleRegistry.Title directly, unscaled — no local
        // font-size override here, so retuning that one shared style is all it takes to resize
        // every popup's title at once.
        //
        // `titleIcon` (see that option's own doc) reserves its own square to the left of the
        // text, pushing the text's own start (and shrinking its own available width) over by
        // exactly that much — 0 for every popup that doesn't pass one, a no-op.
        const titleIconOffset = options.titleIcon ? TITLE_ICON_SIZE + TITLE_ICON_GAP : 0;

        // `title` is never a guaranteed-safe-width string — MartConfig.name/CraftingTableConfig.name
        // are level-designer-entered data, and even a hardcoded string like "Backpack" can run
        // long once localized into another language — so fitTextWidth() shrinks it down to
        // whatever room is actually left between PANEL_CONTENT_MARGIN (plus titleIconOffset) and
        // the close button (rather than letting it overflow and stretch the WHOLE panel wider,
        // since this frame sizes itself around `column`'s own rendered bounds).
        const titleText = new PIXI.Text(title, TextStyleRegistry.Title);
        const maxTitleWidth = this.contentWidth - PANEL_CONTENT_MARGIN - titleIconOffset - CLOSE_BUTTON_SIZE - TITLE_CLOSE_GAP;
        fitTextWidth(titleText, maxTitleWidth);
        const headerHeight = Math.max(titleText.height, TITLE_ICON_SIZE, CLOSE_BUTTON_SIZE);
        titleText.anchor.set(0, 0.5);
        titleText.position.set(PANEL_CONTENT_MARGIN + titleIconOffset, headerHeight / 2);
        column.addChild(titleText);

        if (options.titleIcon) {
            // createTitleIcon() (see TitleIcon.ts's own doc) is a top-left-anchored square —
            // background + centered icon, both sized to TITLE_ICON_SIZE — so it's positioned
            // (not anchored) like any other plain container, vertically centered against
            // headerHeight the same way titleText's own anchor(0, 0.5) achieves that.
            const titleIcon = createTitleIcon(options.titleIcon, TITLE_ICON_SIZE);
            titleIcon.position.set(PANEL_CONTENT_MARGIN / 2, headerHeight / 2 - TITLE_ICON_SIZE / 2);
            column.addChild(titleIcon);
        }

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

    /**
     * Re-measures the panel frame around `content`'s CURRENT bounds and re-centers `root`'s own
     * pivot to match — call this any time content added/removed AFTER buildContent() actually
     * changes size (e.g. a reactive re-render that adds/removes rows), same "nothing watches
     * this automatically" reasoning AutoFitFrame.fit()'s own doc gives. Without the pivot re-
     * centering here too, a popup that grows/shrinks after its first render would visually drift
     * off whatever screen position PopupManager set it to, since `root.pivot` (set once in the
     * constructor, from the FIRST fit) would otherwise still be centered on the OLD bounds.
     */
    protected refitFrame(): void {
        this.frame.fit();
        const bounds = this.root.getLocalBounds();
        this.root.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
    }

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
     * own backdrop handler calls close() directly, bypassing requestClose() entirely — skipped
     * for a popup with closeOnBackdropTap: false, which only ever closes via the first path), or
     * this popup getting silently replaced by a new show() call (closeImmediate()). A popup that
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
