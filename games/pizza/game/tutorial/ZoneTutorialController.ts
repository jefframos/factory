// ZoneTutorialController.ts
//
// Drives ONE zone's ZoneTutorialConfig (see ZoneTutorialTypes.ts) at a time — whichever zone
// the player is currently standing in — repointing an arrow at whatever the CURRENT step still
// needs: first the nearest live ResourceNode that can gather the step's required resource
// ("gather phase"), then — once the backpack already holds enough — the craft table/gate that's
// actually waiting on it ("deliver phase"). Run once per frame from PizzaScene.fixedUpdate(),
// the same call-site pattern worldManager.update() uses, since the gather/deliver phase has to
// react instantly to the backpack changing and to the player crossing between zones.
//
// Two arrow implementations share that same (player, target) pointing job, and run TOGETHER,
// never as a replacement for each other — a flat screen-space sprite (ZoneTutorialArrow.ts,
// always on) plus a real 3D mesh orbiting the player (ZoneTutorial3dArrow.ts, ADDITIONALLY, only
// while the active zone's own config.use3dArrow is true) — see updateArrow()/hideArrow() for the
// one call site everything else goes through so neither pointAtGatherTarget() nor
// pointAtDeliverTarget() has to know whether the 3D one is even in play.
//
// TutorialProgressStorage.ts persists ONLY the completed-step index — gather-vs-deliver is
// deliberately never saved (see that file's own doc): resolveStepRequirement()'s (resourceType,
// amount) is compared against BackpackStorage's LIVE count every single call, so a reload with
// an already-full-enough backpack for the current step lands straight on the deliver arrow
// instead of replaying a gather arrow for something already sitting there.
//
// Step COMPLETION (advancing to the next step) is a DIFFERENT check from the phase's own "does
// the player have enough in backpack" comparison above — a gate's resource requirement is only
// satisfied by actually DEPOSITING at a GateDropZone, not by merely carrying enough (see
// Gate.isRequirementMet()'s own doc), so a 'gate' step's completion subscribes to
// GateStorage.onUnlock; a 'craft' step's completion subscribes to CraftStorage.onChange,
// filtered down to "is this step's own primary recipe id now in completedRecipeIds" — both
// completely independent of the live backpack count the phase check above reads.
//
// The store steps (the FTUE — see ZoneTutorialTypes.ts): a 'storage' step runs the same
// gather/deliver phases (gather from a farm, deliver to the storage's dropper) and completes
// once the storage holds enough; 'sale' points at the store's cashier until enough sales,
// 'collectMoney' at its money drop until the pile is collected, 'build' at a building's dropper
// until it's built. A step that's already done when it becomes current (a reload, or a trigger
// walked before this existed) advances right away — see isStepAlreadyDone().
//
// Which zone's tutorial runs: the one already running, in EVERY zone, until its last step is
// done — crossing into another zone never hides or swaps it. With none running, a tutorial
// whose startRequirement is met starts (anywhere), else the player's own zone's (one without a
// startRequirement). See findRunningTutorialZone() / findRequirementStartedZone().
//
// A 'buyStorage' step gathers whatever of a storage's resourceCost is still missing (e.g. chop
// trees for wood — only in step.gatherZone when set), then points at its purchase spot.

import * as THREE from 'three';
import World from '../ecs/World';
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import WorldObjectRegistry from '../world/WorldObjectRegistry';
import ZoneVisibilityManager from '../world/ZoneVisibilityManager';
import { DEFAULT_ARROW_TEXTURE_ID, ZONE_TUTORIAL_CONFIG, ZoneTutorialConfig, ZoneTutorialCraftStep, ZoneTutorialGateStep, ZoneTutorialStep, ZoneTutorialStorageStep, ZoneTutorialBuyStorageStep } from './ZoneTutorialTypes';
import { TutorialProgressStorage } from './TutorialProgressStorage';
import { BackpackStorage } from '../data/BackpackStorage';
import { ResourceType } from '../actions/ResourceTypes';
import { getCraftConfig } from '../crafting/CraftTypes';
import { CraftStorage } from '../crafting/CraftStorage';
import { GateId, GATE_CONFIG } from '../data/GateTypes';
import { GateStorage } from '../data/GateStorage';
import { TriggerStorage } from '../data/TriggerStorage';
import ResourceNodeRegistry from '../player/ResourceNodeRegistry';
import { getStorageConfig, getStorageResourceCost, isStorageForSale } from '../data/StorageTypes';
import { StorageOwnershipStorage } from '../store/StorageOwnershipStorage';
import { isMilestoneRequirementMet } from '../data/MilestoneRequirement';
import { StorageInventory } from '../data/StorageInventory';
import { getFarmPlotConfig } from '../data/FarmTypes';
import { CROP_CONFIG } from '../data/CropTypes';
import { BuildingStorage } from '../data/BuildingStorage';
import { BuildingId } from '../data/BuildingId';
import { StoreProgressStorage } from '../store/StoreProgressStorage';
import { StoreMoneyStorage } from '../store/StoreMoneyStorage';
import { readStoreLayouts } from '../store/StoreLayout';
import ZoneTutorialArrow, { DELIVER_TARGET_HEIGHT_OFFSET } from './ZoneTutorialArrow';
import ZoneTutorial3dArrow from './ZoneTutorial3dArrow';
import { GameAnalytics } from '../analytics/GameAnalytics';

interface ResolvedStepRequirement {
    resourceType: ResourceType;
    amount: number;
}

export default class ZoneTutorialController {
    private readonly world: World;
    private readonly host: ScreenAnchorHost;
    private readonly scene: THREE.Scene;
    private readonly worldObjects: WorldObjectRegistry;
    private readonly zoneVisibility: ZoneVisibilityManager;
    private readonly getPlayerPosition: () => THREE.Vector3;

    private arrow?: ZoneTutorialArrow;
    /** The real-3D arrow (see that file's own doc) — used INSTEAD OF `arrow` whenever the active zone's own config.use3dArrow is true (see activateZone()/updateArrow()), never both at once. */
    private arrow3d?: ZoneTutorial3dArrow;
    /** Which of the two arrows above updateArrow()/hideArrow() should actually drive — resolved once per activateZone() call from the zone's own config, not re-read every frame. */
    private use3dArrow = false;
    /** The zone number `arrow`/`arrow3d` are currently configured for — undefined means no tutorial active right now (no config for the player's zone, or that zone's already fully done). */
    private activeZoneNumber?: number;

    /** Identifies the (zoneNumber, completedCount) pair `unsubscribeCompletion` is currently listening for — resubscribed whenever this doesn't match the CURRENT step, so a stale listener from a step already advanced past never fires late. */
    private activeStepKey?: string;
    private unsubscribeCompletion?: () => void;

    /** The textureId last applied to `arrow` via applyStepIcon() — tracked so switching steps only calls ZoneTutorialArrow.setTexture() (a real texture reassignment) when the resolved icon actually changes, not every single frame. */
    private activeIconTextureId?: string;

    public constructor(
        world: World,
        host: ScreenAnchorHost,
        scene: THREE.Scene,
        worldObjects: WorldObjectRegistry,
        zoneVisibility: ZoneVisibilityManager,
        getPlayerPosition: () => THREE.Vector3,
    ) {
        this.world = world;
        this.host = host;
        this.scene = scene;
        this.worldObjects = worldObjects;
        this.zoneVisibility = zoneVisibility;
        this.getPlayerPosition = getPlayerPosition;
    }

    /** Call once per frame — see this file's own doc for why (backpack/zone changes need to reflect instantly, not on some slower poll). */
    public update(): void {
        const playerPosition = this.getPlayerPosition();
        const zoneNumber = this.findRunningTutorialZone() ?? this.findRequirementStartedZone() ?? this.zoneTutorialHere(playerPosition);
        const config = zoneNumber !== undefined ? ZONE_TUTORIAL_CONFIG[zoneNumber] : undefined;

        if (zoneNumber === undefined || !config) {
            this.deactivate();
            return;
        }

        const completedCount = TutorialProgressStorage.getCompletedStepCount(zoneNumber);
        if (completedCount >= config.steps.length) {
            // This zone's tutorial is fully done — nothing left to guide the player toward.
            this.deactivate();
            return;
        }

        if (this.activeZoneNumber !== zoneNumber) {
            this.activateZone(zoneNumber, config);
        }

        const step = config.steps[completedCount];
        this.applyStepIcon(config, step);
        if (this.subscribeToCompletion(zoneNumber, step, completedCount)) {
            // Already done — advanceStep() has re-run update() for the next step.
            return;
        }

        if (step.kind === 'trigger' || step.kind === 'sale' || step.kind === 'collectMoney' || step.kind === 'build') {
            // No resource to gather at all — always the "deliver" arrow, straight at the
            // step's own target, until its completion signal fires (see
            // subscribeToCompletion()'s own doc) and advances past it.
            this.pointAtDeliverTarget(step);
            return;
        }

        if (step.kind === 'storage') {
            this.updateStorageStep(step, playerPosition);
            return;
        }

        if (step.kind === 'buyStorage') {
            this.updateBuyStorageStep(step, playerPosition);
            return;
        }

        const requirement = this.resolveStepRequirement(step);
        if (!requirement) {
            // Already console.warn()'d inside resolveStepRequirement() — nothing sane to point
            // at, so just hide rather than show a stale/wrong arrow.
            this.hideArrow();
            return;
        }

        const have = BackpackStorage.getCount(requirement.resourceType);
        if (have < requirement.amount) {
            this.pointAtGatherTarget(requirement.resourceType, playerPosition, step);
        } else {
            this.pointAtDeliverTarget(step);
        }
    }

    /** Tears everything down — call from PizzaScene's own teardown so the arrow sprite/listeners don't outlive the scene. */
    public destroy(): void {
        this.deactivate();
        this.arrow?.destroy();
        this.arrow = undefined;
        this.arrow3d?.destroy();
        this.arrow3d = undefined;
    }

    private currentZoneNumber(playerPosition: THREE.Vector3): number | undefined {
        return this.zoneVisibility.getZoneForPosition(playerPosition.x, playerPosition.z);
    }

    /** The tutorial already running (it keeps guiding in every zone until it's done), else one left half-done by an earlier session — undefined = none, so the player's own zone decides. */
    private findRunningTutorialZone(): number | undefined {
        if (this.activeZoneNumber !== undefined && !this.isTutorialDone(this.activeZoneNumber)) {
            return this.activeZoneNumber;
        }
        for (const key of Object.keys(ZONE_TUTORIAL_CONFIG)) {
            const zoneNumber = Number(key);
            if (TutorialProgressStorage.getCompletedStepCount(zoneNumber) > 0 && !this.isTutorialDone(zoneNumber)) {
                return zoneNumber;
            }
        }
        return undefined;
    }

    /** A not-yet-done tutorial whose startRequirement is met — see ZoneTutorialConfig.startRequirement. */
    private findRequirementStartedZone(): number | undefined {
        for (const [key, config] of Object.entries(ZONE_TUTORIAL_CONFIG)) {
            const zoneNumber = Number(key);
            if (config?.startRequirement && !this.isTutorialDone(zoneNumber) && isMilestoneRequirementMet(config.startRequirement)) {
                return zoneNumber;
            }
        }
        return undefined;
    }

    /** The player's own zone, when its tutorial starts on entry (no startRequirement of its own). */
    private zoneTutorialHere(playerPosition: THREE.Vector3): number | undefined {
        const zoneNumber = this.currentZoneNumber(playerPosition);
        return zoneNumber !== undefined && !ZONE_TUTORIAL_CONFIG[zoneNumber]?.startRequirement ? zoneNumber : undefined;
    }

    private isTutorialDone(zoneNumber: number): boolean {
        const config = ZONE_TUTORIAL_CONFIG[zoneNumber];
        return !config || TutorialProgressStorage.getCompletedStepCount(zoneNumber) >= config.steps.length;
    }

    /** A 'storage' step's gather/deliver phase — what's already on the shelf counts too, so the arrow only asks for what's still missing. */
    private updateStorageStep(step: ZoneTutorialStorageStep, playerPosition: THREE.Vector3): void {
        const resourceType = getStorageConfig(step.storageId).resourceType;
        if (!resourceType) {
            console.warn(`[ZoneTutorialController] storage "${step.storageId}" has no resourceType — a 'storage' tutorial step needs one, hiding this step's arrow`);
            this.hideArrow();
            return;
        }
        const missing = (step.amount ?? 1) - StorageInventory.getCount(step.storageId, resourceType);
        if (BackpackStorage.getCount(resourceType) >= missing) {
            this.pointAtDeliverTarget(step);
            return;
        }
        const farm = this.findFarmFor(resourceType, playerPosition, step.farmId);
        if (farm) {
            this.updateArrow(farm.add(this.stepOffset(step)));
            return;
        }
        this.pointAtGatherTarget(resourceType, playerPosition, step);
    }

    /** A 'buyStorage' step — gather the first resourceCost entry still short (backpack + already paid), from step.gatherZone when set; once everything's in hand, the purchase spot. */
    private updateBuyStorageStep(step: ZoneTutorialBuyStorageStep, playerPosition: THREE.Vector3): void {
        const missing = getStorageResourceCost(getStorageConfig(step.storageId)).find(cost =>
            BackpackStorage.getCount(cost.resourceType) + StorageOwnershipStorage.getResourceProgress(step.storageId, cost.resourceType) < cost.amount);
        if (!missing) {
            this.pointAtDeliverTarget(step);
            return;
        }
        const gatherZone = step.gatherZone;
        const inZone = gatherZone === undefined ? undefined
            : ResourceNodeRegistry.findNearest(missing.resourceType, playerPosition, node => this.zoneVisibility.getZoneForPosition(node.position.x, node.position.z) === gatherZone);
        if (inZone) {
            this.updateArrow(inZone.position.clone().add(this.stepOffset(step)));
            return;
        }
        this.pointAtGatherTarget(missing.resourceType, playerPosition, step);
    }

    /** `farmId`'s position if set, else the nearest farm whose assignedCropId yields `resourceType` — undefined when there's none (the caller falls back to a ResourceNode). */
    private findFarmFor(resourceType: ResourceType, playerPosition: THREE.Vector3, farmId?: string): THREE.Vector3 | undefined {
        if (farmId) {
            const placement = this.worldObjects.get('farm', farmId);
            if (!placement) {
                console.warn(`[ZoneTutorialController] no "farm" object "${farmId}" found on the Tiled map`);
            }
            return placement ? new THREE.Vector3(placement.x, 0, placement.z) : undefined;
        }
        let best: THREE.Vector3 | undefined;
        let bestDistSq = Infinity;
        for (const [id, placement] of this.worldObjects.getAllOfType('farm')) {
            const config = getFarmPlotConfig(id);
            const cropId = config.assignedCropId;
            if (config.disabled || !cropId || CROP_CONFIG[cropId]?.yield.resourceType !== resourceType) {
                continue;
            }
            const distSq = (placement.x - playerPosition.x) ** 2 + (placement.z - playerPosition.z) ** 2;
            if (distSq < bestDistSq) {
                bestDistSq = distSq;
                best = new THREE.Vector3(placement.x, 0, placement.z);
            }
        }
        return best;
    }

    private activateZone(zoneNumber: number, config: ZoneTutorialConfig): void {
        this.activeZoneNumber = zoneNumber;
        this.unsubscribeCompletionListener();
        this.use3dArrow = config.use3dArrow ?? false;

        const arrowTextureId = config.arrowTextureId ?? DEFAULT_ARROW_TEXTURE_ID;
        if (!this.arrow) {
            this.arrow = new ZoneTutorialArrow(this.world, this.host, arrowTextureId);
            this.activeIconTextureId = arrowTextureId;
        }
        // Deliberately doesn't set the texture on an already-existing arrow here anymore —
        // applyStepIcon() (called right after, from update()) resolves and applies the CURRENT
        // step's own icon immediately, which would just be overwritten a line later otherwise.

        if (this.use3dArrow && !this.arrow3d) {
            this.arrow3d = new ZoneTutorial3dArrow(this.scene);
        } else if (!this.use3dArrow) {
            // This zone doesn't want the 3D arrow — make sure a lap from a PREVIOUS zone that
            // did isn't left showing.
            this.arrow3d?.hide();
        }
    }

    /** Drives BOTH arrows toward `target` — the flat 2D one always (unconditionally, exactly as before the 3D one existed), plus the 3D one too whenever the active zone's own config.use3dArrow is set (see this.use3dArrow) — they're additive, never a replacement for each other. The ONE call site pointAtGatherTarget()/pointAtDeliverTarget() both go through. `heightOffset` only means anything to the 2D arrow (see ZoneTutorialArrow.update()'s own doc); the 3D arrow ignores it — its own hover height is relative to the PLAYER, not the target (see ZoneTutorial3dArrow.ts's own doc). */
    private updateArrow(target: THREE.Vector3, heightOffset?: number): void {
        this.arrow?.update(target, heightOffset);
        if (this.use3dArrow) {
            this.arrow3d?.update(this.getPlayerPosition(), target);
        }
    }

    /** Hides both arrows — see updateArrow()'s own doc on why both are always driven together. */
    private hideArrow(): void {
        this.arrow?.hide();
        this.arrow3d?.hide();
    }

    /** Resolves the current step's own icon — `step.iconTextureId` if set, else the zone tutorial's own `arrowTextureId`, else DEFAULT_ARROW_TEXTURE_ID (see ZoneTutorialTypes.ts's own doc on why the override lives per-step) — and applies it to the arrow only when it actually changed. */
    private applyStepIcon(config: ZoneTutorialConfig, step: ZoneTutorialStep): void {
        const iconTextureId = step.iconTextureId ?? config.arrowTextureId ?? DEFAULT_ARROW_TEXTURE_ID;
        if (this.activeIconTextureId === iconTextureId) {
            return;
        }
        this.activeIconTextureId = iconTextureId;
        this.arrow?.setTexture(iconTextureId);
    }

    private deactivate(): void {
        this.activeZoneNumber = undefined;
        this.unsubscribeCompletionListener();
        this.arrow?.hide();
        this.arrow3d?.hide();
    }

    /**
     * Resolves a step's own (resourceType, amount) from whichever real system it's already
     * pointing at, rather than duplicating that data on the step itself:
     *   - 'craft': the table's FIRST recipe (config.recipes[0]) — every real CraftTableConfig
     *     today has exactly one recipe (see CraftTypes.ts's own doc), so "the primary recipe is
     *     recipes[0]" is a safe simplification, not a real design constraint; a future
     *     multi-recipe table would need this (and primaryRecipeId() below) to pick more
     *     deliberately. Within that recipe, its FIRST cost entry — a tutorial step only ever
     *     guides toward ONE resource at a time, even though CraftRecipeDef.cost can list more.
     *   - 'gate': the gate's own `requirement`, which must be a 'resource' kind — the only kind
     *     a live backpack count can meaningfully gate a gather/deliver phase against. Any other
     *     requirement kind (building/item/gate) is a misconfigured tutorial step — warned and
     *     skipped rather than crashed on, same "degrade gracefully" convention every other
     *     ASSET_LIBRARY/config lookup miss in this codebase follows.
     */
    private resolveStepRequirement(step: ZoneTutorialCraftStep | ZoneTutorialGateStep): ResolvedStepRequirement | undefined {
        if (step.kind === 'craft') {
            const config = getCraftConfig(step.craftId);
            if (!config) {
                console.warn(`[ZoneTutorialController] craft id "${step.craftId}" has no CraftTableConfig entry`);
                return undefined;
            }
            const recipe = config.recipes[0];
            const entry = recipe ? (Object.entries(recipe.cost) as [ResourceType, number][])[0] : undefined;
            if (!entry) {
                console.warn(`[ZoneTutorialController] craft id "${step.craftId}"'s primary recipe has no cost entries`);
                return undefined;
            }
            const [resourceType, amount] = entry;
            return { resourceType, amount };
        }

        const config = GATE_CONFIG[step.gateId];
        if (!config) {
            console.warn(`[ZoneTutorialController] gate id "${step.gateId}" has no GateConfig entry`);
            return undefined;
        }
        if (config.requirement.type !== 'resource') {
            console.warn(`[ZoneTutorialController] gate "${step.gateId}"'s requirement isn't a 'resource' kind — tutorial gate steps only support resource requirements, hiding this step's arrow`);
            return undefined;
        }
        return { resourceType: config.requirement.resourceType, amount: config.requirement.amount };
    }

    /** The primary recipe id resolveStepRequirement()'s 'craft' branch derives its cost from — its own tiny helper so completion-checking (which needs the recipe's ID, not just its cost) doesn't repeat the "recipes[0]" pick separately. */
    private primaryRecipeId(craftId: string): string | undefined {
        return getCraftConfig(craftId)?.recipes[0]?.id;
    }

    /** `step.offset` (see ZoneTutorialTypes.ts's own doc) as a real Vector3 — defaults to `(0, 0, 0)` when unset, same as every other optional per-step field here. */
    private stepOffset(step: ZoneTutorialStep): THREE.Vector3 {
        const [x, y, z] = step.offset ?? [0, 0, 0];
        return new THREE.Vector3(x, y, z);
    }

    private pointAtGatherTarget(resourceType: ResourceType, playerPosition: THREE.Vector3, step: ZoneTutorialStep): void {
        const node = ResourceNodeRegistry.findNearest(resourceType, playerPosition);
        if (!node) {
            console.warn(`[ZoneTutorialController] no live ResourceNode currently produces "${resourceType}" — can't point the gather arrow anywhere (data misconfiguration, or every source is out of range/depleted)`);
            this.hideArrow();
            return;
        }
        this.updateArrow(node.position.clone().add(this.stepOffset(step)));
    }

    private pointAtDeliverTarget(step: ZoneTutorialStep): void {
        const placement = this.resolveDeliverPosition(step);
        if (!placement) {
            this.hideArrow();
            return;
        }
        const target = new THREE.Vector3(placement.x, 0, placement.z).add(this.stepOffset(step));
        this.updateArrow(target, DELIVER_TARGET_HEIGHT_OFFSET);
    }

    /** Where a step's deliver arrow points — the placed craft table/gate/trigger, a storage's or building's dropper (else the object itself), a store's cashier/money drop. Warns and returns undefined when it isn't on the map. */
    private resolveDeliverPosition(step: ZoneTutorialStep): { x: number; z: number } | undefined {
        if (step.kind === 'sale' || step.kind === 'collectMoney') {
            const layout = readStoreLayouts().find(store => store.id === step.storeId);
            if (!layout) {
                console.warn(`[ZoneTutorialController] no store "${step.storeId}" found on the Tiled map — can't point the arrow anywhere`);
                return undefined;
            }
            return step.kind === 'sale' ? layout.cashier : layout.moneyDrop;
        }
        const [type, id] = step.kind === 'craft' ? ['craft', step.craftId]
            : step.kind === 'gate' ? ['gate', step.gateId]
            : step.kind === 'trigger' ? ['trigger', step.triggerId]
            : step.kind === 'storage' || step.kind === 'buyStorage' ? ['storage', step.storageId]
            : ['building', step.buildingId];
        // A storage/building is filled at its dropper when it has one.
        const dropper = type === 'storage' || type === 'building' ? this.worldObjects.getDropperFor(id) : undefined;
        const placement = dropper ?? this.worldObjects.get(type, id);
        if (!placement) {
            console.warn(`[ZoneTutorialController] no "${type}" object "${id}" found on the Tiled map — can't point the deliver arrow anywhere`);
        }
        return placement;
    }

    /** Returns true when the step was already done and advanceStep() ran instead (see isStepAlreadyDone()). */
    private subscribeToCompletion(zoneNumber: number, step: ZoneTutorialStep, completedCount: number): boolean {
        const key = `${zoneNumber}:${completedCount}`;
        if (this.activeStepKey === key) {
            return false;
        }
        this.unsubscribeCompletionListener();
        this.activeStepKey = key;

        // A step becoming current (an already-done one still gets its start/complete pair, below).
        if (completedCount === 0) {
            GameAnalytics.tutorialStart(zoneNumber);
        }
        GameAnalytics.tutorialStepStart(zoneNumber, completedCount, step.kind);

        if (this.isStepAlreadyDone(step)) {
            this.advanceStep(zoneNumber, completedCount);
            return true;
        }

        if (step.kind === 'storage') {
            const handler = (id: string): void => {
                if (id === step.storageId && this.isStepAlreadyDone(step)) {
                    this.advanceStep(zoneNumber, completedCount);
                }
            };
            StorageInventory.onChange.add(handler);
            this.unsubscribeCompletion = () => StorageInventory.onChange.remove(handler);
        } else if (step.kind === 'sale') {
            const handler = (id: string): void => {
                if (id === step.storeId && this.isStepAlreadyDone(step)) {
                    this.advanceStep(zoneNumber, completedCount);
                }
            };
            StoreProgressStorage.onProgressChanged.add(handler);
            this.unsubscribeCompletion = () => StoreProgressStorage.onProgressChanged.remove(handler);
        } else if (step.kind === 'collectMoney') {
            const handler = (id: string): void => {
                if (id === step.storeId) {
                    this.advanceStep(zoneNumber, completedCount);
                }
            };
            StoreMoneyStorage.onTaken.add(handler);
            this.unsubscribeCompletion = () => StoreMoneyStorage.onTaken.remove(handler);
        } else if (step.kind === 'buyStorage') {
            const handler = (id: string): void => {
                if (id === step.storageId) {
                    this.advanceStep(zoneNumber, completedCount);
                }
            };
            StorageOwnershipStorage.onPurchase.add(handler);
            this.unsubscribeCompletion = () => StorageOwnershipStorage.onPurchase.remove(handler);
        } else if (step.kind === 'build') {
            const handler = (id: BuildingId): void => {
                if (id === step.buildingId && this.isStepAlreadyDone(step)) {
                    this.advanceStep(zoneNumber, completedCount);
                }
            };
            BuildingStorage.onLevelUp.add(handler);
            this.unsubscribeCompletion = () => BuildingStorage.onLevelUp.remove(handler);
        } else if (step.kind === 'craft') {
            const recipeId = this.primaryRecipeId(step.craftId);
            if (!recipeId) {
                return false;
            }
            const handler = (id: string): void => {
                if (id === step.craftId && CraftStorage.getState(step.craftId).completedRecipeIds.includes(recipeId)) {
                    this.advanceStep(zoneNumber, completedCount);
                }
            };
            CraftStorage.onChange.add(handler);
            this.unsubscribeCompletion = () => CraftStorage.onChange.remove(handler);
        } else if (step.kind === 'gate') {
            const handler = (id: GateId): void => {
                if (id === step.gateId) {
                    this.advanceStep(zoneNumber, completedCount);
                }
            };
            GateStorage.onUnlock.add(handler);
            this.unsubscribeCompletion = () => GateStorage.onUnlock.remove(handler);
        } else {
            const handler = (id: string): void => {
                if (id === step.triggerId) {
                    this.advanceStep(zoneNumber, completedCount);
                }
            };
            TriggerStorage.onActivate.add(handler);
            this.unsubscribeCompletion = () => TriggerStorage.onActivate.remove(handler);
        }
        return false;
    }

    /**
     * True when `step`'s goal is already reached (a reload, or a trigger walked before its step
     * existed) — so it's skipped instead of pointing at something that can't fire again (a
     * destroyOnTrigger trigger is gone once activated). 'collectMoney' is event-only: an empty
     * pile right after a sale can just mean the money is still flying onto it. 'craft'/'gate'
     * keep their original event-only behavior.
     */
    private isStepAlreadyDone(step: ZoneTutorialStep): boolean {
        switch (step.kind) {
            case 'trigger':
                return TriggerStorage.isActivated(step.triggerId);
            case 'storage': {
                const resourceType = getStorageConfig(step.storageId).resourceType;
                return resourceType !== undefined && StorageInventory.getCount(step.storageId, resourceType) >= (step.amount ?? 1);
            }
            case 'buyStorage':
                return !isStorageForSale(getStorageConfig(step.storageId)) || StorageOwnershipStorage.isOwned(step.storageId);
            case 'sale':
                return StoreProgressStorage.getTotalSales(step.storeId) >= (step.amount ?? 1);
            case 'build':
                return BuildingStorage.getLevel(step.buildingId) >= 1;
            default:
                return false;
        }
    }

    private unsubscribeCompletionListener(): void {
        this.unsubscribeCompletion?.();
        this.unsubscribeCompletion = undefined;
        this.activeStepKey = undefined;
    }

    /** The instant the current step's own real completion signal fires — persist the advance and re-run update() immediately (update() runs every frame anyway, so this just saves the one-frame lag of waiting for the next call) rather than leaving the just-completed step's arrow/listener stale until then. */
    private advanceStep(zoneNumber: number, completedCount: number): void {
        const steps = ZONE_TUTORIAL_CONFIG[zoneNumber]?.steps ?? [];
        const step = steps[completedCount];
        if (step) {
            GameAnalytics.tutorialStepComplete(zoneNumber, completedCount, step.kind);
            if (completedCount + 1 >= steps.length) {
                GameAnalytics.tutorialComplete(zoneNumber);
            }
        }
        TutorialProgressStorage.setCompletedStepCount(zoneNumber, completedCount + 1);
        this.unsubscribeCompletionListener();
        this.update();
    }
}
