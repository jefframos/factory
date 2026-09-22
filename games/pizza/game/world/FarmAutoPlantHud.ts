// FarmAutoPlantHud.ts
//
// The ONE no-seed "about to plant" HUD for the whole farm system — same
// single-shared-instance, resolve-by-proximity shape as FarmSeedPicker.ts/
// FarmCropHud.ts (see either file's own doc for the full reasoning: a
// per-tile popup risks more than one showing/overlapping at once, since two
// adjacent/overlapping cell triggers can each independently believe "the
// player is on me" for a frame or two).
//
// Shown ONLY for a FarmPlotConfig.assignedCropId plot's empty cell, while
// FarmPlotTile.ts's own AUTO_PLANT_DELAY_SEC countdown is running (see that
// file's startAutoPlantTimer()/handleTriggerEnter()) — a "free" plot never
// touches this at all and keeps showing FarmSeedPicker exactly as before.
//
// A crop icon (CropConfig.yield.resourceType's own icon — the SAME icon
// this game already uses to represent a crop everywhere else, e.g.
// FarmCropHud's own growth readout) sits above a BarComponent.ts progress
// bar that fills as the countdown elapses. This HUD never advances the
// countdown itself — FarmPlotTile.ts owns that timer and just hands this
// HUD a live 0-1 progress getter to read every frame, the same "read
// somebody else's stored state, don't own it" split CropVisualComponent
// uses against FarmCropStorage. FarmPlotTile.ts is also the one place that
// actually calls FarmCropStorage.plant() once the countdown elapses and
// unregisters from here right after — this HUD purely reflects progress.
//
// Anchored above the TILE itself, not the player's head — same convention
// FarmCropHud.ts uses (a status readout tied to a specific cell, not a menu
// that should follow the player around). Uses the SAME HUD_OFFSET as
// FarmCropHud so the two line up at the same height — a cell only ever
// shows one or the other at once (a cell is either empty-and-counting-down
// or planted-and-growing, never both), so there's no risk of them
// overlapping on screen.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import Entity from '../ecs/Entity';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import BarComponent from '../ui/BarComponent';
import { MIN_BAR_HEIGHT } from '../ui/BarRegistry';
import { CROP_CONFIG, CropId } from '../data/CropTypes';
import { ResourceType } from '../actions/ResourceTypes';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { getAssetIcon } from './AssetLibraryRegistry';
import { createIconSlotBackground } from '../ui/IconSlotRegistry';

/** World-space offset above the tile's own ground-level position — matches FarmCropHud.HUD_OFFSET exactly, see this file's own top doc for why. */
const HUD_OFFSET = new THREE.Vector3(0, 2.3, 0);

const BAR_WIDTH = 70;
/** The crop icon shown ABOVE the bar — same "square tinted backdrop behind a smaller icon" composition FarmCropHud's own resource icon uses. */
const ICON_SIZE = 40;
const ICON_BG_SIZE = 48;
const ICON_GAP = 8;

interface Candidate {
    position: THREE.Vector3;
    cropId: CropId;
    /** 0 (just started standing on this cell) to 1 (about to plant) — FarmPlotTile.ts's own live countdown, read fresh every frame; see this file's own top doc for why this HUD never advances it itself. */
    getProgress: () => number;
}

export default class FarmAutoPlantHud extends Entity {
    private readonly screenHost: ScreenAnchorHost;

    private content!: PIXI.Container;
    private cropIcon!: PIXI.Sprite;
    private bar!: BarComponent;
    /** Owns `content.visible` exclusively via setForceHidden() below — see update()'s own doc for why this HUD must never toggle `content.visible` directly itself. */
    private screenAnchor!: ScreenAnchorComponent;

    /** Every counting-down cell the player's own trigger currently overlaps — resolveActive() picks the winner every frame, same proximity-to-player-position tie-break FarmSeedPicker.ts/FarmCropHud.ts use. */
    private readonly candidates = new Map<string, Candidate>();
    private activeTileKey?: string;
    /** Whichever ResourceType cropIcon's texture was last set to — skips re-resolving/re-assigning the texture every frame the active candidate's own crop hasn't changed (almost always). */
    private lastIconResourceType?: ResourceType;

    public constructor(screenHost: ScreenAnchorHost) {
        super();
        this.screenHost = screenHost;
    }

    public override awake(): void {
        // Same row layout FarmCropHud.ts uses (icon above, bar/button row below, local y=0 at
        // the row's own bottom edge) — kept in sync deliberately so the two readouts occupy the
        // exact same screen position when swapped for each other (see this file's own top doc).
        const rowTopY = -MIN_BAR_HEIGHT;
        const iconCenterY = rowTopY - ICON_GAP - ICON_BG_SIZE / 2;

        const iconBg = createIconSlotBackground(ICON_BG_SIZE, 'Crop');
        iconBg.anchor.set(0.5, 0.5);
        iconBg.position.set(0, iconCenterY);

        this.cropIcon = new PIXI.Sprite();
        this.cropIcon.anchor.set(0.5, 0.5);
        this.cropIcon.width = ICON_SIZE;
        this.cropIcon.height = ICON_SIZE;
        this.cropIcon.position.set(0, iconCenterY);

        // Yellow, not FarmCropHud's own Green — a plain, deliberately different color so
        // "counting down to plant" never reads as "already growing" at a glance.
        this.bar = new BarComponent('Yellow', BAR_WIDTH, MIN_BAR_HEIGHT);
        this.bar.position.set(-BAR_WIDTH / 2, rowTopY);

        this.content = new PIXI.Container();
        this.content.addChild(iconBg, this.cropIcon, this.bar);
        this.content.visible = false;

        const anchorPosition = new THREE.Vector3();
        this.screenAnchor = this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            this.content,
            () => {
                const candidate = this.activeTileKey ? this.candidates.get(this.activeTileKey) : undefined;
                return candidate ? anchorPosition.copy(candidate.position).add(HUD_OFFSET) : anchorPosition.copy(HUD_OFFSET);
            },
        ));
    }

    /**
     * setForceHidden(), never `this.content.visible =` directly — ScreenAnchorComponent's own
     * update() (run just above via super.update(), BEFORE resolveActive() below has picked
     * THIS frame's candidate) also writes `content.visible` and, crucially, only resets its
     * internal position-smoothing state (smoothedX/Y) through ITS OWN hideContent() path.
     * Fighting it by setting `content.visible` here directly used to leave that smoothing state
     * un-reset while genuinely hidden (its own getTargetPosition() fallback still projects to
     * SOME on-screen point every frame, so ScreenAnchorComponent's own logic never considered
     * itself "hidden" and never called hideContent()) — so the very first time a real candidate
     * appeared, it eased in from that stale fallback screen position instead of snapping
     * straight to the tile, reading as "the bar flies in from the corner of the screen."
     * setForceHidden(true) routes through hideContent() every frame there's no candidate,
     * keeping the smoothing state properly reset so the next real appearance always snaps.
     */
    public override update(delta: number): void {
        super.update(delta);
        this.resolveActive();

        const candidate = this.activeTileKey ? this.candidates.get(this.activeTileKey) : undefined;
        this.screenAnchor.setForceHidden(!candidate);
        if (!candidate) {
            return;
        }

        const resourceType = CROP_CONFIG[candidate.cropId].yield.resourceType;
        if (resourceType !== this.lastIconResourceType) {
            this.lastIconResourceType = resourceType;
            this.cropIcon.texture = getAssetIcon(resolveResourceAssetKey(resourceType));
        }

        this.bar.setProgress(candidate.getProgress());
    }

    /** Adds/updates `tileKey` as a live candidate — see this file's own top doc and FarmSeedPicker.register()'s own doc (same shape/reasoning) for why registering doesn't unconditionally make it THE active one. `position` is the tile's own world position (its center). */
    public register(tileKey: string, position: THREE.Vector3, cropId: CropId, getProgress: () => number): void {
        this.candidates.set(tileKey, { position: position.clone(), cropId, getProgress });
        this.resolveActive();
    }

    /** Drops `tileKey` from the candidate set — no-ops if it wasn't registered. */
    public unregister(tileKey: string): void {
        if (this.candidates.delete(tileKey)) {
            this.resolveActive();
        }
    }

    /** Picks whichever registered candidate's own position is closest to the player's actual body position right now — see FarmSeedPicker.resolveActive()'s own doc for the identical reasoning. */
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
            closestTileKey = this.candidates.has(this.activeTileKey ?? '') ? this.activeTileKey : this.candidates.keys().next().value;
        }

        this.activeTileKey = closestTileKey;
    }
}
