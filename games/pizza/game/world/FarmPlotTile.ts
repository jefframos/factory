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
// Player walks onto an EMPTY cell -> what happens next depends on
// FarmPlotConfig.assignedCropId (FarmTypes.ts):
//   - undefined (a "free" plot, every plot before this field existed): this
//     cell registers itself as a candidate with FarmSeedPicker.ts (ONE shared
//     instance across every farm plot on the map — see that file's own doc
//     for why this used to be a per-tile popup and no longer is, and why
//     registering doesn't unconditionally make this cell the active one).
//     Once resolved active, the picker shows whatever seeds the player
//     holds, filtered to FarmPlotConfig.allowedCrops when this plot
//     restricts which crops it'll grow. Tapping a seed there spends one
//     (SeedStorage.removeOne()) to FarmCropStorage.plant() the CROP_CONFIG
//     entry that seed's own SeedConfig.cropId points at.
//   - set (a single-crop plot): FarmSeedPicker/SeedStorage are never touched
//     at all. Standing on the cell starts a countdown as long as the
//     plot's requiredTool's own actionTime (AUTO_PLANT_DELAY_SEC if unset) (startAutoPlantTimer()); stepping off before it elapses
//     cancels it with no partial progress kept, same "leaving resets to
//     zero" rule AnimalCatchController.ts's own capture timer uses. Letting
//     it run out (autoPlant()) plants `assignedCropId` directly, no seed
//     spent. allowedCrops is meaningless for this plot kind — there's no
//     picker to filter.
// Either way, CropVisualComponent then grows a real mesh on top of the
// prepared ground purely off FarmCropStorage's stored state — this entity
// never manually swaps/removes it.
//
// Player walks onto a PLANTED cell (growing or ready) -> depends on the same
// assignedCropId split as above:
//   - A "free" plot's cell registers with FarmCropHud.ts (same single-
//     shared-instance shape as FarmSeedPicker) — a small progress bar while
//     still growing, a checkmark + "Collect" button once
//     CropTypes.isCropReady(). Harvesting stays that deliberate tap
//     (FarmCropHud calls back into this cell's own harvest()) — never
//     automatic on collision for this plot kind.
//   - An assignedCropId plot's cell ALSO registers with FarmCropHud while
//     still growing (same progress bar, so there's still visible feedback),
//     but the moment it's ready it stops showing anything at all — there's
//     nothing to tap. Instead, update()'s own per-frame check
//     (`playerInside && assignedCropId && isCropReady`) harvests it
//     automatically the instant the player is standing on it, whether they
//     walked onto an already-ready crop or were already there when it
//     finished growing — same "proximity alone is enough" philosophy
//     AutoGatherController already uses for chopping/mining. The tile is
//     left showing nothing but the grown crop's own mesh sitting there
//     (its ordinary "planted" look, see CropVisualComponent below) — no
//     floating ready-state panel ever appears for this plot kind.
// harvest() banks CropConfig.yield into BackpackStorage and clears
// FarmCropStorage back to empty, letting CropVisualComponent's own next
// update() notice and hide the grown mesh again, then immediately re-arms
// this cell for the next planting (see harvest()'s own doc).
//
// Pops in with a small scale-up tween (see appearDelaySec) instead of a hard
// cut — PizzaScene.spawnFarmGrid() staggers each cell's own delay by its
// index in the grid, so a freshly-bought plot's tiles visibly ripple in one
// after another rather than all snapping into existence on the same frame.
// The collider itself is live from the very first frame regardless (only
// the VISUAL scale animates) — same "cosmetic only" scope as every other
// appear/reveal animation in this game (see ZoneVisibilityManager's own
// rise animation).
//
// The PREPARED ground mesh itself is tinted per FARM_TILE_CONFIG.
// availableTint/occupiedTint (see applyGroundTint()) — white/no-tint while
// empty OR while a planted crop is already CropTypes.isCropReady(), a
// darker shade only while ACTIVELY GROWING, so a cell worth walking past
// (nothing to plant, or nothing left to wait on) always reads as
// "available" at a glance, even with something already sitting on it. Only
// applies to the GlbVisualComponent path (a real resolved view) — the
// BoxVisualComponent placeholder fallback below keeps its own fixed
// PLACEHOLDER_COLOR regardless, since that path only exists for
// dev/no-art-yet plots anyway.
//
// Harvesting plays the same rising "+N icon" gain popup LooseResourceNode.
// showGainPopup() plays for a ground pickup (Bark/Pebble/...) — see
// showHarvestGainPopup() below, a near-verbatim copy since there's no
// shared helper for it yet (see that method's own doc).

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
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import { FARM_TILE_CONFIG, FarmPlotConfig } from '../data/FarmTypes';
import { CROP_CONFIG, CropId, isCropReady } from '../data/CropTypes';
import { FarmCropStorage, PlantedCrop } from '../data/FarmCropStorage';
import { SEED_CONFIG, SeedId } from '../data/SeedTypes';
import { SeedStorage } from '../data/SeedStorage';
import { BackpackStorage } from '../data/BackpackStorage';
import { ItemStorage } from '../crafting/ItemStorage';
import { getToolActionTimeSec } from '../actions/ToolRegistry';
import { ResourceType } from '../actions/ResourceTypes';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { resolveEntityView } from './EntityViewRegistry';
import { getAssetIcon } from './AssetLibraryRegistry';
import { FARM_GRID_CELL_SIZE } from './FarmGrid';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';
import MainPlayer from '../player/MainPlayer';
import ViewUtils from 'core/utils/ViewUtils';
import FarmSeedPicker from './FarmSeedPicker';
import FarmCropHud from './FarmCropHud';
import FarmAutoPlantHud from './FarmAutoPlantHud';
import { getPlayerConfig } from '../data/PlayerConfig';
import { CarryStack } from '../player/CarryStack';
import { flyResourceToStack } from '../components/FlyToStack';

const FARM_TILE_CORNER_RADIUS = 0.2;
const PLACEHOLDER_HEIGHT = 0.1;
const PLACEHOLDER_COLOR = 0x7a5a3a;
const APPEAR_DURATION_SEC = 0.35;
/** FALLBACK for how long the player has to stand on an empty cell of a FarmPlotConfig.assignedCropId plot before it auto-plants — only used when the plot has no requiredTool, or that tool has no actionTime set (see startAutoPlantTimer()'s own doc). */
const AUTO_PLANT_DELAY_SEC = 2;

/** FARM_TILE_CONFIG.availableTint/occupiedTint fall back to these when unset — see applyGroundTint(). White = no visible tint at all (the mesh's own real colors show through untouched); the occupied default is a plain medium gray, dark enough to read as "taken" against white without this file needing to know anything about a specific crop's own art. */
const DEFAULT_AVAILABLE_TINT = '#ffffff';
const DEFAULT_OCCUPIED_TINT = '#6b6b6b';

/** Same rising "+N" popup LooseResourceNode.showGainPopup() plays for a ground pickup (Bark/Pebble/...) — see showHarvestGainPopup()'s own doc for why this is a near-verbatim copy rather than a shared import. */
const HARVEST_POPUP_BASE_OFFSET = new THREE.Vector3(0, 1, 0);
/** Where a harvested crop launches from toward the player's stack, relative to the cell's ground-level center — roughly where the grown crop's own mesh sits. See flyHarvestToStack(). */
const HARVEST_LAUNCH_OFFSET = new THREE.Vector3(0, 0.4, 0);
const HARVEST_POPUP_RISE = 1.2;
const HARVEST_POPUP_TTL_SEC = 0.9;
const HARVEST_POPUP_ICON_SIZE = 28;
const HARVEST_POPUP_ICON_GAP = 4;

export default class FarmPlotTile extends Entity {
    /** This cell's plot id + grid position — keys FarmCropStorage's own per-cell planted state (see tileKey below) and this file's own top doc. */
    public readonly farmId: string;
    public readonly col: number;
    public readonly row: number;
    /** Seconds to wait before this cell's own pop-in tween starts — see this file's own top doc. 0 = no stagger (pops in immediately on its own first frame). */
    private readonly appearDelaySec: number;
    private readonly screenHost: ScreenAnchorHost;
    private readonly plotConfig: FarmPlotConfig;
    /** The ONE shared FarmSeedPicker instance every farm plot on the map hands its own register()/unregister() calls to — see that file's own doc for why this is no longer built per-tile. */
    private readonly seedPicker: FarmSeedPicker;
    /** The ONE shared FarmCropHud instance every farm plot on the map hands its own register()/unregister() calls to for a PLANTED cell — see that file's own doc. */
    private readonly cropHud: FarmCropHud;
    /** The ONE shared FarmAutoPlantHud instance every farm plot on the map hands its own register()/unregister() calls to while an `assignedCropId` cell's no-seed countdown runs — see that file's own doc. A "free" plot (no `assignedCropId`) never registers with this. */
    private readonly autoPlantHud: FarmAutoPlantHud;
    /** FarmCropStorage's own per-cell identity — computed once, this cell's farmId/col/row never change over its lifetime. */
    private readonly tileKey: string;

    /** Seconds remaining before this cell auto-plants `plotConfig.assignedCropId` — see startAutoPlantTimer()'s own doc. undefined means no countdown in progress. Only ever touched when `plotConfig.assignedCropId` is set; a "free" plot (no assigned crop) never sets this at all and keeps going through FarmSeedPicker exactly as it always has. */
    private autoPlantRemainingSec?: number;
    /** Full length of the countdown currently in autoPlantRemainingSec — what the HUD's 0-1 progress divides by. See startAutoPlantTimer(). */
    private autoPlantDurationSec = AUTO_PLANT_DELAY_SEC;

    /** True while MainPlayer's own trigger overlaps this cell — see handleTriggerEnter()/handleTriggerExit(). The one thing update()'s own auto-harvest check (see its own doc) needs that FarmCropStorage.getPlanted() alone can't tell it: not just "is something ready here" but "is the player actually standing on it right now." */
    private playerInside = false;
    /** The player currently standing on this cell (set/cleared with playerInside) — whose stack a harvest flies to, and who gets the "stack is full" balloon. */
    private player?: MainPlayer;

    /** Traces this cell's own footprint — visibility is driven every frame in update() purely off whether FarmSeedPicker.getActiveTileKey() equals this cell's own tileKey, NOT this cell's own trigger-enter/exit state directly (that let more than one tile highlight at once — two overlapping/adjacent triggers can each independently believe "the player is on me" for a frame or two, but only ONE tileKey can ever own the shared picker at a time). Makes it obvious at a glance which exact cell the seed picker is about to plant into. */
    private outline!: DottedZoneVisualComponent;

    /** The PREPARED ground mesh — undefined when resolveEntityView(FARM_TILE_CONFIG.prepared) had no glb yet and the BoxVisualComponent placeholder fallback was used instead (see applyGroundTint()'s own doc for why that path is never tinted). */
    private groundVisual?: GlbVisualComponent;
    /** The tint hex string last actually applied to groundVisual's materials — skips re-walking/re-setting every material on a frame where nothing changed (every frame this cell stays in the same planted/empty state, which is almost always). */
    private appliedGroundTint?: string;

    public constructor(
        position: THREE.Vector3,
        farmId: string,
        col: number,
        row: number,
        screenHost: ScreenAnchorHost,
        plotConfig: FarmPlotConfig,
        seedPicker: FarmSeedPicker,
        cropHud: FarmCropHud,
        autoPlantHud: FarmAutoPlantHud,
        appearDelaySec = 0,
    ) {
        super();
        this.farmId = farmId;
        this.col = col;
        this.row = row;
        this.screenHost = screenHost;
        this.plotConfig = plotConfig;
        this.seedPicker = seedPicker;
        this.cropHud = cropHud;
        this.autoPlantHud = autoPlantHud;
        this.appearDelaySec = appearDelaySec;
        this.tileKey = FarmCropStorage.tileKey(farmId, col, row);
        this.transform.position.copy(position);
    }

    public override update(delta: number): void {
        super.update(delta);
        this.applyGroundTint();
        // The picker's own activeTileKey is the ONE source of truth for "which cell is about
        // to be planted into" for a seed-picker plot — see outline's/
        // FarmSeedPicker.getActiveTileKey()'s own doc for why this can't be driven by this
        // tile's own trigger-enter/exit instead (that let more than one tile highlight at
        // once). An assignedCropId plot never registers with the picker at all (see
        // handleTriggerEnter()), so it gets the same "you're about to plant here" cue from its
        // own auto-plant countdown instead.
        this.outline.setVisible(this.seedPicker.getActiveTileKey() === this.tileKey || this.autoPlantRemainingSec !== undefined);

        if (this.autoPlantRemainingSec !== undefined) {
            this.autoPlantRemainingSec -= delta;
            if (this.autoPlantRemainingSec <= 0) {
                this.autoPlantRemainingSec = undefined;
                this.autoPlantHud.unregister(this.tileKey);
                this.autoPlant();
            }
        }

        // Auto-harvest — an assignedCropId plot's other half of "no manual step needed": just
        // like planting never needed a seed tap, collecting never needs a "Collect" tap either.
        // Checked every frame (not just on trigger-enter) so BOTH "walks onto an already-ready
        // crop" and "was already standing here, growing, when it finished" auto-collect the
        // instant they're true — the AutoGatherController-style "proximity alone is enough"
        // philosophy the rest of this game already uses (see this file's own top doc, and the
        // README's own "only one input: movement" framing). FarmCropStorage.harvest() clears the
        // planted state the moment it succeeds, so getPlanted() naturally returns undefined next
        // frame — no separate "already harvested this one" flag needed to avoid double-firing.
        // A "free" plot (no assignedCropId) never reaches this at all — collecting stays that
        // deliberate FarmCropHud "Collect" tap for it, unchanged.
        if (this.playerInside && this.plotConfig.assignedCropId !== undefined) {
            const planted = FarmCropStorage.getPlanted(this.tileKey);
            if (planted && isCropReady(CROP_CONFIG[planted.cropId], planted.plantedAtSec)) {
                this.harvest(planted);
            }
        }
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

        this.outline = this.addComponent(new DottedZoneVisualComponent(
            FARM_GRID_CELL_SIZE,
            FARM_GRID_CELL_SIZE,
            FARM_TILE_CORNER_RADIUS,
            { color: getZoneColor(ZoneColorKind.FarmPlot) },
        ));
        // Hidden until the player actually walks onto this specific EMPTY cell — see
        // handleTriggerEnter()/handleTriggerExit(), the "highlight which tile I'm about to
        // plant into" cue.
        this.outline.setVisible(false);

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
            this.groundVisual = this.addComponent(new GlbVisualComponent(
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
    }

    /** Registers this cell as a live seed-picker candidate — see FarmSeedPicker.ts's own doc for why this cell never builds its own popup, and why registering doesn't unconditionally make it THE active one. */
    private registerAsSeedPickerCandidate(): void {
        if (!this.hasRequiredTool()) {
            return;
        }
        const allowedCropIds = this.plotConfig.allowedCrops as CropId[] | undefined;
        this.seedPicker.register(this.tileKey, this.transform.position, allowedCropIds, seedId => this.tryPlant(seedId));
    }

    /** Registers this cell as a live crop-hud candidate — see FarmCropHud.ts's own doc. `planted` must already be set (a cell only ever calls this while occupied). */
    private registerAsCropHudCandidate(planted: PlantedCrop): void {
        this.cropHud.register(this.tileKey, this.transform.position, planted.cropId, planted.plantedAtSec, () => this.harvest(planted));
    }

    /** Consumes one `seedId` and starts its own SeedConfig.cropId growing — no-ops (silently, same "just don't complete the action" convention as SeedStorage.removeOne()'s own callers) if this cell already has something planted or the player is out of that seed. Unregisters from the seed picker and registers with the crop hud instead — nothing left to plant here until this cell empties out again, but there's now something to show growth progress for. Only ever called for a "free" plot (no `plotConfig.assignedCropId`) — see startAutoPlantTimer()/autoPlant() for that plot kind's own no-seed twin of this method. */
    private tryPlant(seedId: SeedId): void {
        if (FarmCropStorage.getPlanted(this.tileKey)) {
            return;
        }

        if (!SeedStorage.removeOne(seedId)) {
            return;
        }

        const plantedAtSec = Date.now() / 1000;
        FarmCropStorage.plant(this.tileKey, SEED_CONFIG[seedId].cropId, plantedAtSec);
        this.seedPicker.unregister(this.tileKey);
        this.registerAsCropHudCandidate({ cropId: SEED_CONFIG[seedId].cropId, plantedAtSec });
    }

    /** Starts (or restarts, on re-entry) the AUTO_PLANT_DELAY_SEC countdown for an EMPTY cell of a plot with `plotConfig.assignedCropId` set — the no-seed twin of registerAsSeedPickerCandidate(): this cell never touches FarmSeedPicker/SeedStorage at all for this plot kind. Also registers with FarmAutoPlantHud so the icon+bar readout shows (see that file's own doc) — its progress getter reads `autoPlantRemainingSec` fresh every frame rather than tracking its own copy. update() ticks the countdown down and calls autoPlant() once it elapses; handleTriggerExit() cancels it outright (no partial-progress carry-over) if the player steps off before it finishes, same "leaving resets to zero" convention AnimalCatchController.ts's own capture timer uses. */
    private startAutoPlantTimer(): void {
        if (!this.hasRequiredTool()) {
            return;
        }
        // Planting takes the required tool's own actionTime (e.g. shovel: 1s — see
        // ToolVisualEntry.actionTime), falling back to AUTO_PLANT_DELAY_SEC when the plot needs
        // no tool or the tool has no actionTime. Clamped above 0 so the progress getter below
        // never divides by zero.
        const toolId = this.plotConfig.requiredTool;
        const toolTimeSec = toolId !== undefined ? getToolActionTimeSec(toolId) : undefined;
        this.autoPlantDurationSec = Math.max(0.01, toolTimeSec ?? AUTO_PLANT_DELAY_SEC);
        this.autoPlantRemainingSec = this.autoPlantDurationSec;
        this.autoPlantHud.register(
            this.tileKey, this.transform.position, this.plotConfig.assignedCropId!,
            () => 1 - (this.autoPlantRemainingSec ?? 0) / this.autoPlantDurationSec,
        );
    }

    /** FarmPlotConfig.requiredTool gate — true if the plot needs no tool, or the player owns it (ItemStorage.hasTool()). Checked every time an empty cell would offer planting (seed picker or auto-plant countdown), so picking the tool up later just works on the next step onto a cell. */
    private hasRequiredTool(): boolean {
        const toolId = this.plotConfig.requiredTool;
        return toolId === undefined || ItemStorage.hasTool(toolId);
    }

    /** The no-seed twin of tryPlant() — plants `plotConfig.assignedCropId` directly once startAutoPlantTimer()'s countdown elapses, no SeedStorage/seed picker involved at all. Still guards against something already planted here (e.g. by the time the countdown finished), same defensive no-op tryPlant() itself has. */
    private autoPlant(): void {
        const cropId = this.plotConfig.assignedCropId;
        if (cropId === undefined || FarmCropStorage.getPlanted(this.tileKey)) {
            return;
        }

        const plantedAtSec = Date.now() / 1000;
        FarmCropStorage.plant(this.tileKey, cropId, plantedAtSec);
        this.registerAsCropHudCandidate({ cropId, plantedAtSec });
    }

    /** MainPlayer walking into this cell's own trigger — makes this cell the shared seed-picker's or crop-hud's new candidate, or starts the no-seed auto-plant countdown, depending on whether anything's planted here and whether this plot has an assigned crop (see this file's own top doc). Harvesting is now always a deliberate "Collect" tap in FarmCropHud, never automatic on collision. */
    private handleTriggerEnter(other: RigidBody): void {
        if (!(other.entity instanceof MainPlayer)) {
            return;
        }
        this.playerInside = true;
        this.player = other.entity;

        const planted = FarmCropStorage.getPlanted(this.tileKey);
        if (planted) {
            // An assignedCropId plot's crop that's ALREADY ready on entry never gets registered
            // with FarmCropHud at all — there's nothing to tap (update()'s own auto-harvest
            // check, see its own doc, collects it automatically this same frame, before anything
            // ever renders), so showing a "Collect" button for it even for one frame would be
            // both pointless and wrong. A free plot's ready crop, or a still-growing crop of
            // either plot kind, registers exactly as before.
            const autoHarvests = this.plotConfig.assignedCropId !== undefined && isCropReady(CROP_CONFIG[planted.cropId], planted.plantedAtSec);
            if (!autoHarvests) {
                this.registerAsCropHudCandidate(planted);
            }
        } else if (this.plotConfig.assignedCropId !== undefined) {
            this.startAutoPlantTimer();
        } else {
            this.registerAsSeedPickerCandidate();
        }
    }

    private handleTriggerExit(other: RigidBody): void {
        if (other.entity instanceof MainPlayer) {
            this.playerInside = false;
            this.player = undefined;
            this.seedPicker.unregister(this.tileKey);
            this.cropHud.unregister(this.tileKey);
            this.autoPlantHud.unregister(this.tileKey);
            this.autoPlantRemainingSec = undefined;
        }
    }

    /** Banks CropConfig.yield into BackpackStorage and clears this cell back to empty — CropVisualComponent notices FarmCropStorage.getPlanted() going undefined on its own next update() and removes the grown mesh itself, so this never has to touch that component directly. Two callers, one per plot kind: a free plot's FarmCropHud "Collect" tap, or an assignedCropId plot's own update() auto-harvest check (see that method's own doc) — either way `this.cropHud.unregister()` right after is a safe no-op if this tile was never registered with it in the first place (an already-ready assignedCropId crop never is — see handleTriggerEnter()). Re-registers for the NEXT planting right after, so the player never has to step off and back on: a free plot re-shows the seed picker, an assignedCropId plot restarts its own auto-plant countdown instead (same branch handleTriggerEnter() itself uses for an empty cell). */
    private harvest(planted: PlantedCrop): void {
        const { yield: cropYield } = CROP_CONFIG[planted.cropId];
        const intoStack = getPlayerConfig().harvestIntoStack && this.player !== undefined;

        // Stack-full gate — checked BEFORE harvesting, so a crop that doesn't fit simply stays
        // ready on the cell (auto-harvesting the moment there's room again) instead of being lost.
        // update()'s auto-harvest re-checks this every frame; CarryStack.notifyFull() rate-limits
        // the balloon so standing here doesn't re-pop it constantly.
        if (intoStack && !CarryStack.hasRoomFor(cropYield.amount)) {
            CarryStack.notifyFull(this.player!);
            return;
        }

        if (!FarmCropStorage.harvest(this.tileKey)) {
            return;
        }

        if (intoStack) {
            // Banked one unit at a time as each lands on the stack — see FlyToStack.ts. The stack
            // growing is the feedback, so no "+N" popup here.
            this.flyHarvestToStack(this.player!, cropYield.resourceType, cropYield.amount);
        } else {
            BackpackStorage.add(cropYield.resourceType, cropYield.amount);
            this.showHarvestGainPopup(cropYield.resourceType, cropYield.amount);
        }
        this.cropHud.unregister(this.tileKey);
        if (this.plotConfig.assignedCropId !== undefined) {
            this.startAutoPlantTimer();
        } else {
            this.registerAsSeedPickerCandidate();
        }
    }

    /** One flight per yielded unit, straight from the cell onto the top of the player's stack (see FlyToStack.ts) — no drop on the floor first. Hung off this tile's own parent (the THREE.Scene — PizzaScene adds every tile's transform straight to it). */
    private flyHarvestToStack(player: MainPlayer, resourceType: ResourceType, amount: number): void {
        const scene = this.transform.parent;
        if (!scene) {
            BackpackStorage.add(resourceType, amount);
            return;
        }
        const from = this.transform.position.clone().add(HARVEST_LAUNCH_OFFSET);
        for (let i = 0; i < amount; i++) {
            flyResourceToStack(scene, player, resourceType, from);
        }
    }

    /** Re-tints groundVisual's materials to match this cell's current empty/growing/ready state — see this file's own top doc. No-ops until the model has actually loaded (GlbVisualComponent.mesh throws before then — see that file's own isReady doc) and again once the SAME tint is already applied (appliedGroundTint), so a cell sitting in one state for a while isn't re-walking/re-setting its materials every single frame for nothing. */
    private applyGroundTint(): void {
        if (!this.groundVisual?.isReady) {
            return;
        }

        // occupiedTint reads as "actively growing," not just "something's planted here" — a
        // READY crop (whether waiting on a manual Collect tap or about to auto-harvest, see this
        // file's own top doc) reverts to the plain availableTint, same as a genuinely empty cell,
        // since there's nothing left to wait on: the tinted/untinted distinction is meant to flag
        // "don't bother planting here," not "something already happened here."
        const planted = FarmCropStorage.getPlanted(this.tileKey);
        const isGrowing = planted !== undefined && !isCropReady(CROP_CONFIG[planted.cropId], planted.plantedAtSec);
        const tint = (isGrowing ? FARM_TILE_CONFIG.occupiedTint : FARM_TILE_CONFIG.availableTint)
            ?? (isGrowing ? DEFAULT_OCCUPIED_TINT : DEFAULT_AVAILABLE_TINT);
        if (tint === this.appliedGroundTint) {
            return;
        }
        this.appliedGroundTint = tint;

        // Safe to mutate directly — GlbVisualComponent.load() already clones one private
        // material set per instance (see that file's own doc), so this can never bleed into
        // some OTHER tile sharing the same underlying model.
        this.groundVisual.mesh.traverse(child => {
            if (child instanceof THREE.Mesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(material => {
                    if ('color' in material) {
                        (material as THREE.MeshStandardMaterial).color.set(tint);
                    }
                });
            }
        });
    }

    /** Trimmed-down copy of LooseResourceNode.showGainPopup() — a rising "+N" icon+text popup, same visual language as collecting Bark/Pebble off the ground. Genuinely duplicated (not imported/shared) because LooseResourceNode's own version reads `this.position`/`this.consumed` off ITS OWN entity — extracting a shared helper would mean threading a position + world + screenHost through a free function for a ~25-line effect used by exactly two call sites right now; not worth it unless a third shows up. */
    private showHarvestGainPopup(resourceType: ResourceType, amount: number): void {
        if (!this.world) {
            return;
        }

        const icon = new PIXI.Sprite(getAssetIcon(resolveResourceAssetKey(resourceType)));
        icon.anchor.set(0, 0.5);
        icon.scale.set(ViewUtils.elementScaler(icon, HARVEST_POPUP_ICON_SIZE));

        const text = new PIXI.Text(`+${amount}`, TextStyleRegistry.ResourceDamage);
        text.style.fill = '#33cc66';
        text.anchor.set(0, 0.5);
        text.position.set(icon.width + HARVEST_POPUP_ICON_GAP, 0);

        const content = new PIXI.Container();
        content.addChild(icon, text);
        content.pivot.set(content.width / 2, content.height / 2);

        const basePosition = this.transform.position.clone().add(HARVEST_POPUP_BASE_OFFSET);
        const progress = { t: 0 };
        const risenPosition = new THREE.Vector3();

        const popupEntity = this.world.spawn();
        popupEntity.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            content,
            () => risenPosition.copy(basePosition).setY(basePosition.y + progress.t * HARVEST_POPUP_RISE),
            { ttlSec: HARVEST_POPUP_TTL_SEC },
        ));

        gsap.to(progress, {
            t: 1,
            duration: HARVEST_POPUP_TTL_SEC,
            ease: 'power2.out',
            onUpdate: () => {
                content.alpha = 1 - progress.t;
            },
        });
    }
}
