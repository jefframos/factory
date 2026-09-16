// FarmSeedPicker.ts
//
// The ONE seed-picker popup for the whole farm system — constructed ONCE by
// PizzaScene and shared by every FarmPlotTile, instead of each tile building
// its own AutoFitFrame + ScreenAnchorComponent (the original shape, and the
// actual bug this file replaces): since the picker always anchors to the
// PLAYER's own head regardless of which tile owns it, a player standing
// where two tiles' triggers overlap (or briefly straddling an edge) could
// have TWO tiles simultaneously believe they're "the one showing the
// picker," rendering two identical, perfectly-overlapping popups fighting
// for the same on-screen spot — reads as a rendering bug, and wastes a
// whole AutoFitFrame + ScreenAnchorComponent + grid of PIXI objects per
// tile for something only ever one of which can usefully be visible at
// once anyway.
//
// A FarmPlotTile calls register(tileKey, position, allowedCropIds, onPlant)
// on its own trigger-enter (empty cell) and unregister(tileKey) on trigger-
// exit/after a successful plant. Registering does NOT immediately make a
// tile "the" active one — every registered candidate is tracked, and
// resolveActive() (run every update(), plus right after any
// register()/unregister()) picks whichever CANDIDATE's own position is
// closest to the player's actual body position, every single frame.
//
// This used to be "whichever tile called show() most recently wins" — a
// plain event-order race. That broke exactly the case a level designer
// actually cares about: standing on tile A with your trigger also grazing
// neighboring tile B (a shared edge, or B's own trigger firing early as you
// approach), then turning to face/look toward B without ever actually
// moving there — B's own onTriggerEnter had already fired and "won,"
// so A (the tile you're really standing on) never got the picker back
// until you physically stepped off and back on. Resolving by proximity to
// the player's own position instead means whichever tile your BODY is
// actually closest to always wins, independent of event ordering — so the
// tile you're standing on is always correctly favored the instant nothing
// else is genuinely closer. (A true "prefer whichever tile is in front of
// you" resolution would need the player's own facing direction, which
// isn't exposed anywhere in this codebase today — see this file's own
// history for that tradeoff; proximity-to-position already fixes the
// reported bug without needing it.)

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import Entity from '../ecs/Entity';
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { Game } from 'core/Game';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import PanelBackground from '../ui/PanelBackground';
import { TextStyleRegistry, fitTextWidth } from '../ui/TextStyleRegistry';
import { CropId } from '../data/CropTypes';
import { SEED_CONFIG, SeedId } from '../data/SeedTypes';
import { SeedStorage } from '../data/SeedStorage';
import { AssetLibraryKey, getAssetIcon } from './AssetLibraryRegistry';
import { createIconSlotBackground } from '../ui/IconSlotRegistry';
import { getIconLayout } from '../ui/LayoutRegistry';

/** Gap between the picker's own bottom edge and the actual bottom of the screen — same fixed-screen-position convention UIService's positionBackpackUi() uses for the (currently disabled) bottom-center backpack panel, rather than floating over the player's head in the 3D world (see this file's own git history for that earlier approach, and why it's gone: a HUD element pinned to a screen edge reads as "part of the interface," not as a speech bubble that has to dodge the player). */
const PICKER_BOTTOM_MARGIN = 16;
/** 'FarmFrame's own baked-in speech-bubble tail needs real clearance below the content to render cleanly (its 9-slice border widths are a fixed 30px, see FrameRegistry.ts's own DEFAULT_PADDING_BUBBLE) — same order of magnitude as CraftZone's/FarmZone's own LABEL_FRAME_PADDING (15), which never shows this overlap since their content (a real icon + requirement rows) is naturally tall enough on its own. See MartZone.ts's own buildOpenShopButton() doc for the fuller writeup (that button's short text-only content needed an explicit spacer on top of this same padding bump to get equivalent clearance — this picker's real icon grid doesn't need one). */
const PICKER_FRAME_PADDING = uniformFitPadding(20);
/** Title shown above the grid — see refresh(). Uses TextStyleRegistry.Title directly, unscaled — same style (and same "no local font-size override") Popup.ts's own header title uses for MartPopup/CraftingTablePopup/InventoryPopup; this picker has no such base (it's a world-floating panel, not a Popup), so it's spelled out directly here to match, and stays in sync with that shared style automatically. */
const PICKER_TITLE_TEXT = 'Pick a seed to plant';
const PICKER_TITLE_GAP = 24;
/** Uses the SAME shared PanelBackground component (see that file's own doc) every other dark content panel in the game does — InventoryPopup/MartPopup/CraftingTablePopup's tab bodies, CraftZone's own requirement panel — added INSIDE 'FarmFrame's own bubble border rather than replacing it, so the bubble's border/tail art stays but its middle no longer shows the plain (near-transparent) green fill behind the grid. Wraps ONLY the seed grid (see `gridPanel` in awake()) — the title sits ABOVE this panel, outside the dark backdrop, same as MartPopup's/CraftingTablePopup's own title sitting above their dark body via Popup.ts's shared header row. */
/** Same icon-bg-square + icon + count-label grid cell shape as InventoryPopup's/BackpackListUI's own resource cells. Smaller than InventoryPopup's own RESOURCE_CELL_SIZE (80px) since this floats over the player's head in the 3D world rather than filling a dedicated popup panel. */
const SEED_GRID_COLUMNS = 4;
/** Sourced from LayoutRegistry's 'Grid' preset (see that file's own doc), overridden to this picker's own smaller 56px cell/9px padding and 8px gap — smaller than InventoryPopup's own 80px Grid default since this floats over the player's head in the 3D world rather than filling a dedicated popup panel. */
const SEED_LAYOUT = getIconLayout('Grid', { slotSize: 56, iconPadding: 9, gapToNeighbor: 8 });
const SEED_CELL_SIZE = SEED_LAYOUT.slotSize;
const SEED_CELL_GAP = SEED_LAYOUT.gapToNeighbor;
const SEED_ICON_SIZE = SEED_CELL_SIZE - SEED_LAYOUT.iconPadding * 2;

interface Candidate {
    position: THREE.Vector3;
    allowedCropIds: CropId[] | undefined;
    onPlant: (seedId: SeedId) => void;
}

export default class FarmSeedPicker extends Entity {
    private readonly screenHost: ScreenAnchorHost;

    private pickerContent!: AutoFitFrame;
    /** Everything inside 'FarmFrame's own border — title above, gridPanel below — passed as AutoFitFrame's own `content` so the outer bubble sizes itself around both. */
    private pickerColumn!: PIXI.Container;
    private pickerTitle!: PIXI.Text;
    /** Dark backdrop + pickerRow, and NOTHING else — the title stays OUTSIDE this container (a sibling within pickerColumn instead), same as MartPopup's/CraftingTablePopup's own title sitting above their dark `body` rather than inside it. */
    private gridPanel!: PIXI.Container;
    private pickerBackground!: PanelBackground;
    private pickerRow!: PIXI.Container;

    /** Every EMPTY, plantable tile the player's own trigger currently overlaps — almost always exactly one entry, occasionally two at a shared edge. resolveActive() picks the winner every frame; see this file's own top doc. */
    private readonly candidates = new Map<string, Candidate>();
    /** Whichever FarmCropStorage.tileKey() resolveActive() most recently picked — undefined means no candidates at all right now. */
    private activeTileKey?: string;

    private readonly handleSeedStorageChange = (): void => {
        if (this.activeTileKey) {
            this.refresh();
        }
    };

    public constructor(screenHost: ScreenAnchorHost) {
        super();
        this.screenHost = screenHost;
    }

    public override awake(): void {
        this.pickerColumn = new PIXI.Container();

        this.pickerTitle = new PIXI.Text(PICKER_TITLE_TEXT, { ...TextStyleRegistry.Title, fontSize: 22 });
        this.pickerTitle.anchor.set(0, 0);
        this.pickerColumn.addChild(this.pickerTitle);

        this.gridPanel = new PIXI.Container();
        this.pickerColumn.addChild(this.gridPanel);

        // Dark, content-agnostic backdrop — added FIRST so pickerRow (added after) draws on top
        // of it. Actual size/position set in refresh() once the grid's own footprint is known.
        // Only ever holds pickerRow — the title lives one level up, in pickerColumn, so the dark
        // panel wraps just the seeds themselves, same as MartPopup's/CraftingTablePopup's own
        // dark `body` never including their own header title either.
        this.pickerBackground = new PanelBackground();
        this.gridPanel.addChild(this.pickerBackground);

        this.pickerRow = new PIXI.Container();
        this.gridPanel.addChild(this.pickerRow);

        this.pickerContent = new AutoFitFrame(PICKER_FRAME_PADDING, 'FarmFrame', this.pickerColumn);
        this.pickerContent.visible = false;
        this.screenHost.overlayContainer.addChild(this.pickerContent);

        SeedStorage.onChange.add(this.handleSeedStorageChange);
    }

    public override destroy(): void {
        SeedStorage.onChange.remove(this.handleSeedStorageChange);
        this.pickerContent.destroy({ children: true });
        super.destroy();
    }

    public override update(delta: number): void {
        super.update(delta);
        this.resolveActive();
        this.pickerContent.visible = Boolean(this.activeTileKey) && this.pickerRow.children.length > 0;
        if (this.pickerContent.visible) {
            this.positionContent();
        }
    }

    /** Bottom-center, regardless of viewport size/aspect — same fixed-screen-position convention as UIService's positionBackpackUi(). Re-run every frame the picker is visible since the grid's own size changes as the player's seed holdings do (see refresh()'s pickerContent.fit() call). */
    private positionContent(): void {
        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }

        const bounds = this.pickerContent.getLocalBounds();
        this.pickerContent.position.set(
            screen.center.x - bounds.width / 2 - bounds.x,
            screen.bottomLeft.y - bounds.height - bounds.y - PICKER_BOTTOM_MARGIN,
        );
    }

    /** Whichever tileKey currently owns the picker, or undefined if none does — the ONE source of truth for "which cell is the player about to plant into." FarmPlotTile reads this every frame to decide whether ITS OWN highlight outline should show (see that file's own doc) instead of tracking trigger-enter/exit itself, which is exactly what let more than one tile's outline show at once before: two tiles' triggers can each independently believe "the player is on me" for a frame or two (overlapping AABBs, a shared edge, ...), but only ONE tileKey can ever equal this getter's return value at a time. */
    public getActiveTileKey(): string | undefined {
        return this.activeTileKey;
    }

    /** Adds/updates `tileKey` as a live candidate — see this file's own top doc for how resolveActive() picks a winner among however many are currently registered. `position` is this cell's own world position (its center), read fresh every resolveActive() call, so a caller only ever needs to register once per trigger-enter, not track its own position changes (a farm cell never moves anyway, but this keeps the API symmetric with a hypothetical future mobile candidate). `allowedCropIds`/`onPlant` — see the old show()'s own doc for their meaning, unchanged. */
    public register(tileKey: string, position: THREE.Vector3, allowedCropIds: CropId[] | undefined, onPlant: (seedId: SeedId) => void): void {
        this.candidates.set(tileKey, { position: position.clone(), allowedCropIds, onPlant });
        this.resolveActive();
    }

    /** Drops `tileKey` from the candidate set — no-ops if it wasn't registered (e.g. an exit arriving for a tile that was never actually a candidate, such as one already occupied). */
    public unregister(tileKey: string): void {
        if (this.candidates.delete(tileKey)) {
            this.resolveActive();
        }
    }

    /** Picks whichever registered candidate's own position is closest to the player's actual body position right now, and switches the picker over to it if that's not already the active one — see this file's own top doc for why proximity (not registration order) is the tie-breaker. No candidates at all resolves to no active tile (picker stays/becomes hidden). */
    private resolveActive(): void {
        const viewerPosition = this.screenHost.getViewerPosition?.();

        let closestTileKey: string | undefined;
        let closestDistanceSq = Infinity;
        if (viewerPosition) {
            for (const [tileKey, candidate] of this.candidates) {
                const distanceSq = candidate.position.distanceToSquared(viewerPosition);
                if (distanceSq < closestDistanceSq) {
                    closestDistanceSq = distanceSq;
                    closestTileKey = tileKey;
                }
            }
        } else if (this.candidates.size > 0) {
            // No viewer position available (headless/no-UI context) — arbitrarily keep whichever
            // candidate is already active if it's still registered, else just pick the first one;
            // there's no meaningful "closest" to resolve by here.
            closestTileKey = this.candidates.has(this.activeTileKey ?? '') ? this.activeTileKey : this.candidates.keys().next().value;
        }

        if (closestTileKey === this.activeTileKey) {
            return;
        }

        this.activeTileKey = closestTileKey;
        if (closestTileKey === undefined) {
            this.pickerContent.visible = false;
        } else {
            this.refresh();
        }
    }

    /** Rebuilds pickerRow's own grid cells from SeedStorage's CURRENT holdings — one cell (icon-bg square + icon + count label) per owned SeedId whose SeedConfig.cropId is allowed on the currently-active candidate (every crop, if that candidate left it unset). Called whenever resolveActive() switches the active tile, and any time SeedStorage changes while a tile owns the picker. No-ops if activeTileKey is somehow unset (resolveActive() never calls this in that case, but stay defensive). */
    private refresh(): void {
        const active = this.activeTileKey ? this.candidates.get(this.activeTileKey) : undefined;
        if (!active) {
            return;
        }

        this.pickerRow.removeChildren();

        const allowedCropIds = active.allowedCropIds;
        const seedsToShow: Array<{ seedId: SeedId; count: number }> = [];
        for (const [seedId, count] of SeedStorage.getAll()) {
            if (count <= 0) {
                continue;
            }
            const seedConfig = SEED_CONFIG[seedId];
            if (!seedConfig || (allowedCropIds && !allowedCropIds.includes(seedConfig.cropId))) {
                continue;
            }
            seedsToShow.push({ seedId, count });
        }

        seedsToShow.forEach(({ seedId, count }, index) => {
            const col = index % SEED_GRID_COLUMNS;
            const row = Math.floor(index / SEED_GRID_COLUMNS);
            const cell = new PIXI.Container();
            cell.position.set(
                col * (SEED_CELL_SIZE + SEED_CELL_GAP),
                row * (SEED_CELL_SIZE + SEED_CELL_GAP),
            );
            cell.eventMode = 'static';
            cell.cursor = 'pointer';
            cell.on('pointertap', () => active.onPlant(seedId));
            this.pickerRow.addChild(cell);

            const iconBg = createIconSlotBackground(SEED_CELL_SIZE, 'Crop');
            cell.addChild(iconBg);

            const icon = new PIXI.Sprite(getAssetIcon(seedId as unknown as AssetLibraryKey));
            icon.anchor.set(0.5, 0.5);
            icon.width = SEED_ICON_SIZE;
            icon.height = SEED_ICON_SIZE;
            icon.position.set(SEED_CELL_SIZE / 2, SEED_CELL_SIZE / 2 - 4);
            cell.addChild(icon);

            const label = new PIXI.Text(count.toString(), { ...TextStyleRegistry.Body, fontSize: SEED_LAYOUT.label.fontSize });
            label.anchor.set(SEED_LAYOUT.label.anchor[0], SEED_LAYOUT.label.anchor[1]);
            label.position.set(SEED_CELL_SIZE / 2 + SEED_LAYOUT.label.offset[0], SEED_CELL_SIZE - SEED_LAYOUT.label.offset[1]);
            cell.addChild(label);
        });

        // Dark backdrop wraps ONLY pickerRow (see gridPanel's own doc) — sized/positioned around
        // pickerRow's own bounds directly, entirely independent of the title.
        const gridBounds = this.pickerRow.getLocalBounds();
        this.pickerBackground.fitToContent(gridBounds);

        // "Pick a seed to plant" is a fixed string today, but a longer translation (or a future
        // per-plot custom prompt) shouldn't be able to stretch the WHOLE picker wider than its
        // own seed grid — pickerContent (the outer AutoFitFrame) sizes itself around
        // pickerColumn's rendered bounds, title included, so an oversized title would otherwise
        // widen the entire bubble past the grid it's meant to sit above. Bounded to the grid
        // panel's own rendered width (background included, i.e. gridBounds already widened by
        // PanelBackground's own margin) rather than the bare grid width, so the title can use
        // the full width the dark panel already occupies.
        fitTextWidth(this.pickerTitle, this.pickerBackground.width);

        // Left-aligned, NOT centered — the title's own left edge (x=0) lines up with pickerRow's
        // own left edge (also x=0, since gridPanel never shifts horizontally), same "title lines
        // up with content's own left edge" convention Popup.ts's shared header row uses for
        // MartPopup/CraftingTablePopup/InventoryPopup.
        this.pickerTitle.position.set(0, 0);
        this.gridPanel.position.set(0, this.pickerTitle.height + PICKER_TITLE_GAP);

        this.pickerContent.fit();
    }
}
