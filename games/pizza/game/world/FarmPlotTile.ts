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
// Player walks onto an EMPTY cell -> this cell registers itself as a
// candidate with FarmSeedPicker.ts (ONE shared instance across every farm
// plot on the map — see that file's own doc for why this used to be a
// per-tile popup and no longer is, and why registering doesn't unconditionally
// make this cell the active one). Once resolved active, the picker shows
// whatever seeds the player holds, filtered to FarmPlotConfig.allowedCrops
// when this plot restricts which crops it'll grow. Tapping a seed there
// spends one (SeedStorage.removeOne()) to FarmCropStorage.plant() the
// CROP_CONFIG entry that seed's own SeedConfig.cropId points at.
// CropVisualComponent then grows a real mesh on top of the prepared ground
// purely off that stored state — this entity never manually swaps/removes it.
//
// Player walks onto a PLANTED cell (growing or ready) -> this cell instead
// registers with FarmCropHud.ts (same single-shared-instance shape as
// FarmSeedPicker, see that file's own doc) — a small progress bar while
// still growing, a checkmark + "Collect" button once CropTypes.isCropReady().
// Harvesting is now ALWAYS that deliberate tap (FarmCropHud calls back into
// this cell's own harvest()) — never automatic on collision anymore; an
// auto-collect OPTION is planned as a future unlockable, not implemented
// here. harvest() banks CropConfig.yield into BackpackStorage and clears
// FarmCropStorage back to empty, letting CropVisualComponent's own next
// update() notice and hide the grown mesh again.
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
// empty, a darker shade once something's planted, so an occupied cell reads
// at a glance without needing a separate overlay mesh. Only applies to the
// GlbVisualComponent path (a real resolved view) — the BoxVisualComponent
// placeholder fallback below keeps its own fixed PLACEHOLDER_COLOR
// regardless, since that path only exists for dev/no-art-yet plots anyway.
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
import { CROP_CONFIG, CropId } from '../data/CropTypes';
import { FarmCropStorage, PlantedCrop } from '../data/FarmCropStorage';
import { SEED_CONFIG, SeedId } from '../data/SeedTypes';
import { SeedStorage } from '../data/SeedStorage';
import { BackpackStorage } from '../data/BackpackStorage';
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

const FARM_TILE_CORNER_RADIUS = 0.2;
const PLACEHOLDER_HEIGHT = 0.1;
const PLACEHOLDER_COLOR = 0x7a5a3a;
const APPEAR_DURATION_SEC = 0.35;

/** FARM_TILE_CONFIG.availableTint/occupiedTint fall back to these when unset — see applyGroundTint(). White = no visible tint at all (the mesh's own real colors show through untouched); the occupied default is a plain medium gray, dark enough to read as "taken" against white without this file needing to know anything about a specific crop's own art. */
const DEFAULT_AVAILABLE_TINT = '#ffffff';
const DEFAULT_OCCUPIED_TINT = '#6b6b6b';

/** Same rising "+N" popup LooseResourceNode.showGainPopup() plays for a ground pickup (Bark/Pebble/...) — see showHarvestGainPopup()'s own doc for why this is a near-verbatim copy rather than a shared import. */
const HARVEST_POPUP_BASE_OFFSET = new THREE.Vector3(0, 1, 0);
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
    /** FarmCropStorage's own per-cell identity — computed once, this cell's farmId/col/row never change over its lifetime. */
    private readonly tileKey: string;

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
        this.appearDelaySec = appearDelaySec;
        this.tileKey = FarmCropStorage.tileKey(farmId, col, row);
        this.transform.position.copy(position);
    }

    public override update(delta: number): void {
        super.update(delta);
        this.applyGroundTint();
        // The picker's own activeTileKey is the ONE source of truth for "which cell is about
        // to be planted into" — see outline's/FarmSeedPicker.getActiveTileKey()'s own doc for
        // why this can't be driven by this tile's own trigger-enter/exit instead (that let more
        // than one tile highlight at once).
        this.outline.setVisible(this.seedPicker.getActiveTileKey() === this.tileKey);
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
        const allowedCropIds = this.plotConfig.allowedCrops as CropId[] | undefined;
        this.seedPicker.register(this.tileKey, this.transform.position, allowedCropIds, seedId => this.tryPlant(seedId));
    }

    /** Registers this cell as a live crop-hud candidate — see FarmCropHud.ts's own doc. `planted` must already be set (a cell only ever calls this while occupied). */
    private registerAsCropHudCandidate(planted: PlantedCrop): void {
        this.cropHud.register(this.tileKey, this.transform.position, planted.cropId, planted.plantedAtSec, () => this.harvest(planted));
    }

    /** Consumes one `seedId` and starts its own SeedConfig.cropId growing — no-ops (silently, same "just don't complete the action" convention as SeedStorage.removeOne()'s own callers) if this cell already has something planted or the player is out of that seed. Unregisters from the seed picker and registers with the crop hud instead — nothing left to plant here until this cell empties out again, but there's now something to show growth progress for. */
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

    /** MainPlayer walking into this cell's own trigger — makes this cell the shared seed-picker's or crop-hud's new candidate (whichever applies — see this file's own top doc), depending on whether anything's planted here. Harvesting is now always a deliberate "Collect" tap in FarmCropHud, never automatic on collision. */
    private handleTriggerEnter(other: RigidBody): void {
        if (!(other.entity instanceof MainPlayer)) {
            return;
        }

        const planted = FarmCropStorage.getPlanted(this.tileKey);
        if (planted) {
            this.registerAsCropHudCandidate(planted);
        } else {
            this.registerAsSeedPickerCandidate();
        }
    }

    private handleTriggerExit(other: RigidBody): void {
        if (other.entity instanceof MainPlayer) {
            this.seedPicker.unregister(this.tileKey);
            this.cropHud.unregister(this.tileKey);
        }
    }

    /** Banks CropConfig.yield into BackpackStorage and clears this cell back to empty — CropVisualComponent notices FarmCropStorage.getPlanted() going undefined on its own next update() and removes the grown mesh itself, so this never has to touch that component directly. Called ONLY from FarmCropHud's own "Collect" button tap now (see this file's own top doc) — unregisters from the crop hud and re-registers as a seed-picker candidate right after, so the player can immediately replant the cell they just cleared without having to step off and back on. */
    private harvest(planted: PlantedCrop): void {
        if (!FarmCropStorage.harvest(this.tileKey)) {
            return;
        }

        const { yield: cropYield } = CROP_CONFIG[planted.cropId];
        BackpackStorage.add(cropYield.resourceType, cropYield.amount);
        this.showHarvestGainPopup(cropYield.resourceType, cropYield.amount);
        this.cropHud.unregister(this.tileKey);
        this.registerAsSeedPickerCandidate();
    }

    /** Re-tints groundVisual's materials to match this cell's current empty/occupied state — see this file's own top doc. No-ops until the model has actually loaded (GlbVisualComponent.mesh throws before then — see that file's own isReady doc) and again once the SAME tint is already applied (appliedGroundTint), so a cell sitting in one state for a while isn't re-walking/re-setting its materials every single frame for nothing. */
    private applyGroundTint(): void {
        if (!this.groundVisual?.isReady) {
            return;
        }

        const isPlanted = FarmCropStorage.getPlanted(this.tileKey) !== undefined;
        const tint = (isPlanted ? FARM_TILE_CONFIG.occupiedTint : FARM_TILE_CONFIG.availableTint)
            ?? (isPlanted ? DEFAULT_OCCUPIED_TINT : DEFAULT_AVAILABLE_TINT);
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
