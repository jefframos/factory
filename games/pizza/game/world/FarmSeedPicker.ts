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
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import { CropId } from '../data/CropTypes';
import { SEED_CONFIG, SeedId } from '../data/SeedTypes';
import { SeedStorage } from '../data/SeedStorage';
import { AssetLibraryKey, getAssetIcon } from './AssetLibraryRegistry';

/** World-space offset ABOVE THE PLAYER's own transform.position (feet) the picker anchors to — same order of magnitude as PlayerUIAvoidanceComponent's own DEFAULT_HEAD_OFFSET (1.6), raised a bit further than a first pass so the grid's own frame (and its baked-in arrow, see PICKER_FRAME_PADDING's own doc) clears the head/shoulders with real room to spare before avoidViewer's sideways push even has to kick in. */
const PICKER_HEAD_OFFSET = new THREE.Vector3(0, 2.5, 0);
/** 'FarmFrame's own baked-in speech-bubble tail needs real clearance below the content to render cleanly (its 9-slice border widths are a fixed 30px, see FrameRegistry.ts's own DEFAULT_PADDING_BUBBLE) — same order of magnitude as CraftZone's/FarmZone's own LABEL_FRAME_PADDING (15), which never shows this overlap since their content (a real icon + requirement rows) is naturally tall enough on its own. See MartZone.ts's own buildOpenShopButton() doc for the fuller writeup (that button's short text-only content needed an explicit spacer on top of this same padding bump to get equivalent clearance — this picker's real icon grid doesn't need one). */
const PICKER_FRAME_PADDING = uniformFitPadding(20);
/** Same icon-bg-square + icon + count-label grid cell shape as InventoryPopup's/BackpackListUI's own resource cells. Smaller than InventoryPopup's own RESOURCE_CELL_SIZE (80px) since this floats over the player's head in the 3D world rather than filling a dedicated popup panel. */
const SEED_GRID_COLUMNS = 4;
const SEED_CELL_SIZE = 56;
const SEED_CELL_GAP = 8;
const SEED_ICON_SIZE = 38;
const SEED_ICON_BG_TEXTURE_KEY = 'BorderFrame_Squrare_Bg';
const SEED_ICON_BG_TINT = 0x000000;
const SEED_ICON_BG_ALPHA = 0.5;

interface Candidate {
    position: THREE.Vector3;
    allowedCropIds: CropId[] | undefined;
    onPlant: (seedId: SeedId) => void;
}

export default class FarmSeedPicker extends Entity {
    private readonly screenHost: ScreenAnchorHost;

    private pickerContent!: AutoFitFrame;
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
        this.pickerRow = new PIXI.Container();
        this.pickerContent = new AutoFitFrame(PICKER_FRAME_PADDING, 'FarmFrame', this.pickerRow);
        this.pickerContent.visible = false;

        const anchorPosition = new THREE.Vector3();
        this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            this.pickerContent,
            () => {
                const viewerPosition = this.screenHost.getViewerPosition?.();
                return viewerPosition
                    ? anchorPosition.copy(viewerPosition).add(PICKER_HEAD_OFFSET)
                    : anchorPosition.copy(PICKER_HEAD_OFFSET);
            },
            { avoidViewer: true, anchor: { x: 0.5, y: 1 } },
        ));

        SeedStorage.onChange.add(this.handleSeedStorageChange);
    }

    public override destroy(): void {
        SeedStorage.onChange.remove(this.handleSeedStorageChange);
        super.destroy();
    }

    public override update(delta: number): void {
        super.update(delta);
        this.resolveActive();
        // Gate ON TOP of whatever ScreenAnchorComponent (one of the components super.update()
        // just ran) decided — running AFTER it in the same frame means this always has the
        // final say, same "runs after, has final say" idiom every other gated popup in this
        // game uses.
        if (!this.activeTileKey || this.pickerRow.children.length === 0) {
            this.pickerContent.visible = false;
        }
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

            const iconBg = new PIXI.Sprite(PIXI.Texture.from(SEED_ICON_BG_TEXTURE_KEY));
            iconBg.tint = SEED_ICON_BG_TINT;
            iconBg.alpha = SEED_ICON_BG_ALPHA;
            iconBg.width = SEED_CELL_SIZE;
            iconBg.height = SEED_CELL_SIZE;
            cell.addChild(iconBg);

            const icon = new PIXI.Sprite(getAssetIcon(seedId as unknown as AssetLibraryKey));
            icon.anchor.set(0.5, 0.5);
            icon.width = SEED_ICON_SIZE;
            icon.height = SEED_ICON_SIZE;
            icon.position.set(SEED_CELL_SIZE / 2, SEED_CELL_SIZE / 2 - 4);
            cell.addChild(icon);

            const label = new PIXI.Text(count.toString(), { ...TextStyleRegistry.Body, fontSize: 14 });
            label.anchor.set(0.5, 1);
            label.position.set(SEED_CELL_SIZE / 2, SEED_CELL_SIZE - 2);
            cell.addChild(label);
        });

        this.pickerContent.fit();
    }
}
