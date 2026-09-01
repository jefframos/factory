// FarmPlotTile.ts
//
// One croppable CELL of an owned farm plot — see FarmGrid.ts's own doc for
// why a plot is a grid of these instead of one giant patch. Spawned once
// per FarmGrid.computeFarmGrid() cell, only AFTER the plot's own FarmZone
// has been bought (see FarmZone.ts's own doc: buying destroys the whole-
// area FarmZone entity and its single big trigger, replacing it with one
// FarmPlotTile per cell, each with its own small collider) — a plot already
// owned from a previous session spawns straight into this state at boot
// (see PizzaScene.spawnFarmGrid()), no FarmZone/purchase step at all.
//
// Renders FARM_TILE_CONFIG.prepared, sized to exactly one map tile
// (FarmGrid.FARM_GRID_CELL_SIZE), plus the actual planting/growing/
// harvesting interaction (CropTypes.ts) — this cell's own farmId/col/row is
// the stable identity FarmCropStorage.tileKey() keys its per-cell planted
// state off, which is the entire reason the grid exists instead of a single
// plot-wide "prepared" flag.
//
// Player walks onto an EMPTY cell -> a small seed-picker popup (one button
// per SeedId the player actually holds — SeedStorage.getAll(), filtered to
// FarmPlotConfig.allowedCrops when this plot restricts which crops it'll
// grow — same persistent ScreenAnchorComponent shape as FarmZone's own price
// popup, just gated to a short maxDistance so it only shows while actually
// standing on THIS cell) lets them spend one seed (SeedStorage.removeOne())
// to FarmCropStorage.plant() the CROP_CONFIG entry that seed's own
// SeedConfig.cropId points at. CropVisualComponent then grows a real mesh on
// top of the prepared ground purely off that stored state — this entity
// never manually swaps/removes it. Player collides with a cell whose crop
// CropTypes.isCropReady() -> harvest() banks CropConfig.yield into
// BackpackStorage and clears FarmCropStorage back to empty, letting
// CropVisualComponent's own next update() notice and hide the grown mesh
// again.
//
// Pops in with a small scale-up tween (see appearDelaySec) instead of a hard
// cut — PizzaScene.spawnFarmGrid() staggers each cell's own delay by its
// index in the grid, so a freshly-bought plot's tiles visibly ripple in one
// after another rather than all snapping into existence on the same frame.
// The collider itself is live from the very first frame regardless (only
// the VISUAL scale animates) — same "cosmetic only" scope as every other
// appear/reveal animation in this game (see ZoneVisibilityManager's own
// rise animation).

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import BoxVisualComponent from '../components/BoxVisualComponent';
import GlbVisualComponent from '../components/GlbVisualComponent';
import CropVisualComponent from '../components/CropVisualComponent';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import { FARM_TILE_CONFIG, FarmPlotConfig } from '../data/FarmTypes';
import { CROP_CONFIG, CropId, isCropReady } from '../data/CropTypes';
import { FarmCropStorage, PlantedCrop } from '../data/FarmCropStorage';
import { SEED_CONFIG, SeedId } from '../data/SeedTypes';
import { SeedStorage } from '../data/SeedStorage';
import { BackpackStorage } from '../data/BackpackStorage';
import { resolveEntityView } from './EntityViewRegistry';
import { FARM_GRID_CELL_SIZE } from './FarmGrid';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';
import MainPlayer from '../player/MainPlayer';

const FARM_TILE_CORNER_RADIUS = 0.2;
const PLACEHOLDER_HEIGHT = 0.1;
const PLACEHOLDER_COLOR = 0x7a5a3a;
const APPEAR_DURATION_SEC = 0.35;
/** How far above the cell's own ground-level origin the seed-picker popup floats — same fixed-constant convention FarmZone's own price popup uses (see its POPUP_HEIGHT_OFFSET). */
const PICKER_HEIGHT_OFFSET = 0.8;
/** Well under FarmGrid.FARM_GRID_CELL_SIZE-scale distances on purpose — the picker should only ever show while the player is standing right on THIS cell, not visible from a neighboring one. */
const PICKER_MAX_DISTANCE = 1.4;
const PICKER_FRAME_PADDING = uniformFitPadding(12);
const PICKER_BUTTON_GAP = 16;

export default class FarmPlotTile extends Entity {
    /** This cell's plot id + grid position — keys FarmCropStorage's own per-cell planted state (see tileKey below) and this file's own top doc. */
    public readonly farmId: string;
    public readonly col: number;
    public readonly row: number;
    /** Seconds to wait before this cell's own pop-in tween starts — see this file's own top doc. 0 = no stagger (pops in immediately on its own first frame). */
    private readonly appearDelaySec: number;
    private readonly screenHost: ScreenAnchorHost;
    private readonly plotConfig: FarmPlotConfig;
    /** FarmCropStorage's own per-cell identity — computed once, this cell's farmId/col/row never change over its lifetime. */
    private readonly tileKey: string;
    /** True between this cell's own onTriggerEnter/onTriggerExit for MainPlayer — gates whether a SeedStorage change is worth reacting to (see handleSeedStorageChange()) and whether the picker should show at all. */
    private isPlayerNearby = false;

    private pickerContent!: AutoFitFrame;
    /** The actual row of seed buttons INSIDE pickerContent's AutoFitFrame — kept separately so refreshSeedPicker() can clear/rebuild just the buttons without tearing down the frame/ScreenAnchorComponent around them. */
    private pickerRow!: PIXI.Container;

    /** Rebuilds the seed picker the instant the player's own seed bank changes while standing on an empty cell — e.g. harvesting a neighboring cell mid-visit should immediately offer that seed here too, not just on the next fresh trigger-enter. */
    private readonly handleSeedStorageChange = (): void => {
        if (this.isPlayerNearby && !FarmCropStorage.getPlanted(this.tileKey)) {
            this.refreshSeedPicker();
        }
    };

    public constructor(
        position: THREE.Vector3,
        farmId: string,
        col: number,
        row: number,
        screenHost: ScreenAnchorHost,
        plotConfig: FarmPlotConfig,
        appearDelaySec = 0,
    ) {
        super();
        this.farmId = farmId;
        this.col = col;
        this.row = row;
        this.screenHost = screenHost;
        this.plotConfig = plotConfig;
        this.appearDelaySec = appearDelaySec;
        this.tileKey = FarmCropStorage.tileKey(farmId, col, row);
        this.transform.position.copy(position);
    }

    public override update(delta: number): void {
        super.update(delta);

        // Gate the picker's own visibility to "cell is actually empty" ON TOP OF whatever
        // ScreenAnchorComponent (one of the components super.update() just ran) decided from
        // distance alone — running AFTER it in the same frame means this always has the final
        // say, so a picker that would otherwise be in range still never shows once something's
        // growing there.
        if (FarmCropStorage.getPlanted(this.tileKey) || this.pickerRow.children.length === 0) {
            this.pickerContent.visible = false;
        }
    }

    public override destroy(): void {
        SeedStorage.onChange.remove(this.handleSeedStorageChange);
        super.destroy();
    }

    public override awake(): void {
        const halfExtents = new THREE.Vector3(FARM_GRID_CELL_SIZE / 2, PLACEHOLDER_HEIGHT, FARM_GRID_CELL_SIZE / 2);
        const centerOffset = new THREE.Vector3(0, halfExtents.y, 0);

        // A trigger, not solid — a planted/growing cell shouldn't block the player from walking
        // over it any more than an empty one does (see FarmZone's own footprint, also
        // trigger-only); this is purely the future interaction area (walk up to plant/harvest).
        const rigidBody = this.addComponent(new RigidBody({
            halfExtents,
            isStatic: true,
            isTrigger: true,
            layer: Layers.Trigger,
            centerOffset,
        }));
        rigidBody.onTriggerEnter.add(other => this.handleTriggerEnter(other));
        rigidBody.onTriggerExit.add(other => this.handleTriggerExit(other));
        SeedStorage.onChange.add(this.handleSeedStorageChange);

        const outline = this.addComponent(new DottedZoneVisualComponent(
            FARM_GRID_CELL_SIZE,
            FARM_GRID_CELL_SIZE,
            FARM_TILE_CORNER_RADIUS,
            { color: getZoneColor(ZoneColorKind.FarmPlot) },
        ));
        // Hidden for now — an owned, ready-to-use cell, distinct from FarmZone's own "not
        // bought yet" outline (see that file's own doc). Kept, not removed, so it's ready to
        // flip back on later with no rebuild — see this file's own doc on `setVisible`.
        outline.setVisible(false);

        this.transform.scale.setScalar(0);
        gsap.to(this.transform.scale, {
            x: 1, y: 1, z: 1,
            duration: APPEAR_DURATION_SEC,
            delay: this.appearDelaySec,
            ease: 'back.out(2)',
        });

        const resolved = resolveEntityView(FARM_TILE_CONFIG.prepared);
        if (resolved) {
            const [offsetX, offsetY, offsetZ] = resolved.offset;
            this.addComponent(new GlbVisualComponent(
                resolved.model,
                new THREE.Vector3(offsetX, offsetY, offsetZ),
                resolved.scale,
                THREE.MathUtils.degToRad(resolved.rotationDeg),
            ));
        } else {
            this.addComponent(new BoxVisualComponent(
                new THREE.Vector3(FARM_GRID_CELL_SIZE, PLACEHOLDER_HEIGHT, FARM_GRID_CELL_SIZE),
                PLACEHOLDER_COLOR,
                new THREE.Vector3(0, PLACEHOLDER_HEIGHT / 2, 0),
            ));
        }

        // Grows purely off FarmCropStorage's own stored state (see this file's own top doc) —
        // added once, for good, regardless of whether this cell happens to be empty right now.
        this.addComponent(new CropVisualComponent(() => FarmCropStorage.getPlanted(this.tileKey)));

        this.buildSeedPicker();
    }

    /** Builds the (initially empty) picker frame/anchor/ScreenAnchorComponent once — same persistent ScreenAnchorComponent + AutoFitFrame shape as FarmZone's own price popup, gated to PICKER_MAX_DISTANCE so it only shows while standing on THIS cell. Its actual button contents are populated on demand by refreshSeedPicker(), not here — what the player currently holds can change at any time, unlike FarmZone's own fixed price row. */
    private buildSeedPicker(): void {
        this.pickerRow = new PIXI.Container();
        this.pickerContent = new AutoFitFrame(PICKER_FRAME_PADDING, 'FarmFrame', this.pickerRow);

        const pickerAnchor = new THREE.Object3D();
        pickerAnchor.position.set(0, PICKER_HEIGHT_OFFSET, 0);
        this.transform.add(pickerAnchor);
        const worldPosition = new THREE.Vector3();

        this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            this.pickerContent,
            () => pickerAnchor.getWorldPosition(worldPosition),
            { maxDistance: PICKER_MAX_DISTANCE },
        ));
    }

    /** Rebuilds pickerRow's own buttons from SeedStorage's CURRENT holdings — one per owned SeedId whose SeedConfig.cropId is allowed here (every crop, if FarmPlotConfig.allowedCrops is unset — see that field's own doc). Called on trigger-enter and any time SeedStorage changes while the player's already standing here (see handleSeedStorageChange()); update()'s own visibility gate hides the popup entirely when this ends up empty (player holds no plantable seed at all). */
    private refreshSeedPicker(): void {
        this.pickerRow.removeChildren();

        const allowedCropIds = this.plotConfig.allowedCrops as CropId[] | undefined;
        let x = 0;
        for (const [seedId, count] of SeedStorage.getAll()) {
            if (count <= 0) {
                continue;
            }

            const seedConfig = SEED_CONFIG[seedId];
            if (!seedConfig || (allowedCropIds && !allowedCropIds.includes(seedConfig.cropId))) {
                continue;
            }

            const button = new PIXI.Text(`${seedConfig.label}\n×${count}`, TextStyleRegistry.Body);
            button.anchor.set(0, 0);
            button.position.set(x, 0);
            button.eventMode = 'static';
            button.cursor = 'pointer';
            button.on('pointertap', () => this.tryPlant(seedId));
            this.pickerRow.addChild(button);
            x += button.width + PICKER_BUTTON_GAP;
        }

        this.pickerContent.fit();
    }

    /** Consumes one `seedId` and starts its own SeedConfig.cropId growing — no-ops (silently, same "just don't complete the action" convention as SeedStorage.removeOne()'s own callers) if this cell already has something planted or the player is out of that seed. */
    private tryPlant(seedId: SeedId): void {
        if (FarmCropStorage.getPlanted(this.tileKey)) {
            return;
        }

        if (!SeedStorage.removeOne(seedId)) {
            return;
        }

        FarmCropStorage.plant(this.tileKey, SEED_CONFIG[seedId].cropId, Date.now() / 1000);
        this.refreshSeedPicker();
    }

    /** MainPlayer walking into this cell's own trigger — harvests a ready crop, or (an empty cell) refreshes the seed picker with whatever's currently in the player's own bank. Planting itself is still a deliberate tap on a picker button, not a side effect of just walking over an empty cell. */
    private handleTriggerEnter(other: RigidBody): void {
        if (!(other.entity instanceof MainPlayer)) {
            return;
        }

        this.isPlayerNearby = true;

        const planted = FarmCropStorage.getPlanted(this.tileKey);
        if (planted && isCropReady(CROP_CONFIG[planted.cropId], planted.plantedAtSec)) {
            this.harvest(planted);
            return;
        }

        if (!planted) {
            this.refreshSeedPicker();
        }
    }

    private handleTriggerExit(other: RigidBody): void {
        if (other.entity instanceof MainPlayer) {
            this.isPlayerNearby = false;
        }
    }

    /** Banks CropConfig.yield into BackpackStorage and clears this cell back to empty — CropVisualComponent notices FarmCropStorage.getPlanted() going undefined on its own next update() and removes the grown mesh itself, so this never has to touch that component directly. Refreshes the seed picker right after (rather than waiting for the next trigger-enter) so the player can immediately replant the cell they just cleared without having to step off and back on. */
    private harvest(planted: PlantedCrop): void {
        if (!FarmCropStorage.harvest(this.tileKey)) {
            return;
        }

        const { yield: cropYield } = CROP_CONFIG[planted.cropId];
        BackpackStorage.add(cropYield.resourceType, cropYield.amount);
        this.refreshSeedPicker();
    }
}
