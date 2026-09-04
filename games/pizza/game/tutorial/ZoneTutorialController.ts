// ZoneTutorialController.ts
//
// Drives ONE zone's ZoneTutorialConfig (see ZoneTutorialTypes.ts) at a time — whichever zone
// the player is currently standing in — repointing a screen-space arrow (ZoneTutorialArrow.ts)
// at whatever the CURRENT step still needs: first the nearest live ResourceNode that can gather
// the step's required resource ("gather phase"), then — once the backpack already holds
// enough — the craft table/gate that's actually waiting on it ("deliver phase"). Run once per
// frame from PizzaScene.fixedUpdate(), the same call-site pattern worldManager.update() uses,
// since the gather/deliver phase has to react instantly to the backpack changing and to the
// player crossing between zones.
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

import * as THREE from 'three';
import World from '../ecs/World';
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import WorldObjectRegistry from '../world/WorldObjectRegistry';
import ZoneVisibilityManager from '../world/ZoneVisibilityManager';
import { DEFAULT_ARROW_TEXTURE_ID, ZONE_TUTORIAL_CONFIG, ZoneTutorialConfig, ZoneTutorialCraftStep, ZoneTutorialGateStep, ZoneTutorialStep } from './ZoneTutorialTypes';
import { TutorialProgressStorage } from './TutorialProgressStorage';
import { BackpackStorage } from '../data/BackpackStorage';
import { ResourceType } from '../actions/ResourceTypes';
import { getCraftConfig } from '../crafting/CraftTypes';
import { CraftStorage } from '../crafting/CraftStorage';
import { GateId, GATE_CONFIG } from '../data/GateTypes';
import { GateStorage } from '../data/GateStorage';
import { TriggerStorage } from '../data/TriggerStorage';
import ResourceNodeRegistry from '../player/ResourceNodeRegistry';
import ZoneTutorialArrow, { DELIVER_TARGET_HEIGHT_OFFSET } from './ZoneTutorialArrow';

interface ResolvedStepRequirement {
    resourceType: ResourceType;
    amount: number;
}

export default class ZoneTutorialController {
    private readonly world: World;
    private readonly host: ScreenAnchorHost;
    private readonly worldObjects: WorldObjectRegistry;
    private readonly zoneVisibility: ZoneVisibilityManager;
    private readonly getPlayerPosition: () => THREE.Vector3;

    private arrow?: ZoneTutorialArrow;
    /** The zone number `arrow` is currently configured for — undefined means no tutorial active right now (no config for the player's zone, or that zone's already fully done). */
    private activeZoneNumber?: number;

    /** Identifies the (zoneNumber, completedCount) pair `unsubscribeCompletion` is currently listening for — resubscribed whenever this doesn't match the CURRENT step, so a stale listener from a step already advanced past never fires late. */
    private activeStepKey?: string;
    private unsubscribeCompletion?: () => void;

    /** The textureId last applied to `arrow` via applyStepIcon() — tracked so switching steps only calls ZoneTutorialArrow.setTexture() (a real texture reassignment) when the resolved icon actually changes, not every single frame. */
    private activeIconTextureId?: string;

    public constructor(
        world: World,
        host: ScreenAnchorHost,
        worldObjects: WorldObjectRegistry,
        zoneVisibility: ZoneVisibilityManager,
        getPlayerPosition: () => THREE.Vector3,
    ) {
        this.world = world;
        this.host = host;
        this.worldObjects = worldObjects;
        this.zoneVisibility = zoneVisibility;
        this.getPlayerPosition = getPlayerPosition;
    }

    /** Call once per frame — see this file's own doc for why (backpack/zone changes need to reflect instantly, not on some slower poll). */
    public update(): void {
        const playerPosition = this.getPlayerPosition();
        const zoneNumber = this.currentZoneNumber(playerPosition);
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
        this.subscribeToCompletion(zoneNumber, step, completedCount);

        if (step.kind === 'trigger') {
            // No resource to gather at all — always the "deliver" arrow, straight at the
            // trigger's own placed location, until its onActivate fires (see
            // subscribeToCompletion()'s own doc) and advances past it.
            this.pointAtDeliverTarget(step);
            return;
        }

        const requirement = this.resolveStepRequirement(step);
        if (!requirement) {
            // Already console.warn()'d inside resolveStepRequirement() — nothing sane to point
            // at, so just hide rather than show a stale/wrong arrow.
            this.arrow?.hide();
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
    }

    private currentZoneNumber(playerPosition: THREE.Vector3): number | undefined {
        return this.zoneVisibility.getZoneForPosition(playerPosition.x, playerPosition.z);
    }

    private activateZone(zoneNumber: number, config: ZoneTutorialConfig): void {
        this.activeZoneNumber = zoneNumber;
        this.unsubscribeCompletionListener();

        const arrowTextureId = config.arrowTextureId ?? DEFAULT_ARROW_TEXTURE_ID;
        if (!this.arrow) {
            this.arrow = new ZoneTutorialArrow(this.world, this.host, arrowTextureId);
            this.activeIconTextureId = arrowTextureId;
        }
        // Deliberately doesn't set the texture on an already-existing arrow here anymore —
        // applyStepIcon() (called right after, from update()) resolves and applies the CURRENT
        // step's own icon immediately, which would just be overwritten a line later otherwise.
        // TODO: 3D arrow not implemented yet — screen-space only for now (see
        // ZoneTutorialConfig.use3dArrow's own doc). config.use3dArrow is intentionally unread.
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
            this.arrow?.hide();
            return;
        }
        this.arrow?.update(node.position.clone().add(this.stepOffset(step)));
    }

    private pointAtDeliverTarget(step: ZoneTutorialStep): void {
        const type = step.kind === 'craft' ? 'craft' : step.kind === 'gate' ? 'gate' : 'trigger';
        const id = step.kind === 'craft' ? step.craftId : step.kind === 'gate' ? step.gateId : step.triggerId;
        const placement = this.worldObjects.get(type, id);
        if (!placement) {
            console.warn(`[ZoneTutorialController] no "${type}" object "${id}" found on the Tiled map — can't point the deliver arrow anywhere`);
            this.arrow?.hide();
            return;
        }
        const target = new THREE.Vector3(placement.x, 0, placement.z).add(this.stepOffset(step));
        this.arrow?.update(target, DELIVER_TARGET_HEIGHT_OFFSET);
    }

    private subscribeToCompletion(zoneNumber: number, step: ZoneTutorialStep, completedCount: number): void {
        const key = `${zoneNumber}:${completedCount}`;
        if (this.activeStepKey === key) {
            return;
        }
        this.unsubscribeCompletionListener();
        this.activeStepKey = key;

        if (step.kind === 'craft') {
            const recipeId = this.primaryRecipeId(step.craftId);
            if (!recipeId) {
                return;
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
    }

    private unsubscribeCompletionListener(): void {
        this.unsubscribeCompletion?.();
        this.unsubscribeCompletion = undefined;
        this.activeStepKey = undefined;
    }

    /** The instant the current step's own real completion signal fires — persist the advance and re-run update() immediately (update() runs every frame anyway, so this just saves the one-frame lag of waiting for the next call) rather than leaving the just-completed step's arrow/listener stale until then. */
    private advanceStep(zoneNumber: number, completedCount: number): void {
        TutorialProgressStorage.setCompletedStepCount(zoneNumber, completedCount + 1);
        this.unsubscribeCompletionListener();
        this.update();
    }
}
