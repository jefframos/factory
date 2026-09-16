// BuildingZone.ts
//
// A DropZone-style trigger that funds a building's upgrade ladder (see
// BuildingTypes.ts/BuildingStorage.ts) instead of the base stockpile: on the
// PLAYER entering, only pulls resources the building's CURRENT next level
// still needs (never more than that level's requirement, never resources
// it doesn't ask for at all) out of BackpackStorage, one unit at a time via
// the same flying-chip cascade DropZone uses, crediting
// BuildingStorage.addProgress() as each unit lands. Once every requirement
// is met, the level clears immediately (see BuildingStorage.tryCompleteLevel())
// but the on-screen panel deliberately keeps showing the just-cleared level's
// numbers while the LEVEL-UP SEQUENCE plays out — see playLevelUpSequence():
// the "Level Up!" callout pops, the camera (if a CameraFocusHost was passed
// in — see the constructor) travels to the building and holds on it, then
// eases back to the player, and only THEN does the panel flip over to the
// next level's requirements. The whole thing is async specifically so this
// timeline (popup, camera travel, hold, camera return, panel refresh) reads
// as one sequential beat instead of everything firing at once the instant
// the level clears.
//
// Carries a PERSISTENT nameplate/requirements panel the same way DropZone's
// "Drop Zone" label does (ScreenAnchorComponent, no ttlSec) — except this one
// is mutated in place (title/lines text updated, AutoFitFrame re-fit) rather
// than rebuilt, since its content changes constantly as progress comes in.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { buildSolidArea } from '../physics/SolidArea';
import { BendService } from '../services/BendService';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import DottedZoneVisualComponent from '../components/DottedZoneVisualComponent';
import CharacterVisualComponent from '../components/CharacterVisualComponent';
import GlbVisualComponent from '../components/GlbVisualComponent';
import { spawnFlyingResourceIcon } from '../components/FlyingResourceIcon';
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import { BackpackStorage } from '../data/BackpackStorage';
import { BuildingStorage } from '../data/BuildingStorage';
import { BUILDING_CONFIG, BuildingId, getFillFractionForLevel, getMeshConfigForLevel, getViewIdForLevel } from '../data/BuildingTypes';
import { resolveEntityView } from '../world/EntityViewRegistry';
import { OwnMeshPlacement } from '../world/WorldObjectRegistry';
import { ModelSnapshotTool } from '../debug/ModelSnapshotTool';
import { ResourceType } from '../actions/ResourceTypes';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import { resolvePopupFrameName, resolvePopupAnchorOffset, resolvePopupAvoidViewer } from '../ui/PopupConfig';
import { createResourceSlot } from '../ui/ResourceSlotVisual';
import { CameraFocusHost } from '../camera/CameraFocusHost';
import { WorldProgressionHost } from '../camera/WorldProgressionHost';
import { wait } from '../utils/GsapUtils';
import MainPlayer from './MainPlayer';
import { getToolIcon } from '../actions/ToolRegistry';
import { ItemStorage } from '../crafting/ItemStorage';
import { ItemType } from '../crafting/ItemTypes';
import { createIconSlotBackground } from '../ui/IconSlotRegistry';
import { getIconLayout } from '../ui/LayoutRegistry';
import ViewUtils from 'core/utils/ViewUtils';
import { ParticleSystem } from '../vfx/ParticleSystem';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';
import NpcEntity from '../world/NpcEntity';

const LABEL_FRAME_PADDING = uniformFitPadding(15);

/** THREE's Y-axis — see resolveOwnMeshFallbacks()'s own doc on rotating an own-mesh piece's manual offsetX/Z nudge around it. */
const UP_AXIS = new THREE.Vector3(0, 1, 0);

const HALF_EXTENTS = new THREE.Vector3(1.25, 0.75, 1.25);
/** Corner rounding for the dropper's floor outline — purely cosmetic, the collider itself stays a sharp-cornered box (see RigidBody below). */
const DROPPER_ZONE_CORNER_RADIUS = 0.3;
const POPUP_HEIGHT_OFFSET = new THREE.Vector3(0, HALF_EXTENTS.y * 2 + 2.2, 0);
const POPUP_RISE = 0.8;
const POPUP_LIFETIME_SEC = 1.6;
/** How long the panel keeps showing the just-cleared level's numbers when there's no CameraFocusHost to time the reveal off of instead — see playLevelUpSequence(). */
const LEVEL_UP_REVEAL_DELAY_SEC = 1;
/** How long the camera holds on the building once it arrives — see playLevelUpSequence(). Roughly matches LEVEL_UP_REVEAL_DELAY_SEC so the popup has time to read either way. */
const CAMERA_FOCUS_HOLD_SEC = 1;
/** Point the camera actually looks at during the focus — roughly head-height above the zone, same idea as POPUP_HEIGHT_OFFSET but a bit lower since this is a look-target, not a popup spawn point. */
const CAMERA_FOCUS_HEIGHT_OFFSET = new THREE.Vector3(0, HALF_EXTENTS.y * 2, 0);
/** Vertical gap between the requirement slots and the title sitting above them — see refreshLabel(). */
const TITLE_SLOTS_GAP = 4;
/** One requirement slot per required resource, laid out in a single horizontal row — same slot visual as BackpackUI (see ResourceSlotVisual.ts). Sourced from LayoutRegistry's 'Requirement' preset — see that file's own doc — rather than a local constant. */
const REQUIREMENT_LAYOUT = getIconLayout('Requirement');
const REQ_SLOT_SIZE = REQUIREMENT_LAYOUT.slotSize;
const REQ_SLOT_GAP = REQUIREMENT_LAYOUT.gapToNeighbor;
/** BuildingConfig.requiredTool's own "missing tool" slot (see refreshLabel()) — same REQ_SLOT_SIZE as a normal requirement slot so the panel doesn't visibly resize switching between the two states, same ICON_PADDING convention ResourceSlotVisual.ts uses. */
const MISSING_TOOL_ICON_PADDING = REQUIREMENT_LAYOUT.iconPadding;
/** Exclamation badge overlapping the tool icon's bottom-right corner — same size/inset LayoutRegistry's own badge default already carries (a checkmark by default — see that file's own doc on why — with the texture overridden to exclamation here for the "missing," not "met," case). */
const MISSING_TOOL_BADGE_SIZE = REQUIREMENT_LAYOUT.badge.size;
const MISSING_TOOL_BADGE_INSET = REQUIREMENT_LAYOUT.badge.inset;
const MISSING_TOOL_BADGE_TEXTURE = 'Icon_Exclamation';
const FLY_IN_STAGGER_SEC = 0.12;
/** How long the reveal sweep takes on a level-up mesh swap — see playRevealEffect(). */
const MESH_DROP_DURATION_SEC = 0.7;
/** How long awaitingReentry stays true after a level clears before auto-clearing on its own — see that field's own doc. A player who stays standing in the zone through the whole level-up beat can resume depositing toward the NEXT level after this, without having to walk out and back in. */
const REENTRY_TIMEOUT_SEC = 3;
/** Fallback for BuildingConfig.updateParticleCount when a building sets updateParticleEffectId but not its own count. */
const DEFAULT_UPDATE_PARTICLE_COUNT = 24;

/** A separate deposit-trigger rect, in WORLD space — see the constructor's `triggerArea` param doc. */
export interface BuildingTriggerArea {
    position: THREE.Vector3;
    footprint: { width: number; depth: number };
}

export default class BuildingZone extends Entity {
    private readonly screenHost: ScreenAnchorHost;
    private readonly buildingId: BuildingId;
    /** This zone's own intended resting world-Y, captured once from the constructor's `position` — deliberately NOT read back off `this.transform.position.y` later, since ZoneVisibilityManager parks a newly-registered zone below this Y and animates it rising back up (see playRevealEffect()'s own doc on why that transient sunken position, if read mid-rise, corrupts the reveal shader's bounds). */
    private readonly restY: number;
    /** Optional — when omitted, playLevelUpSequence() just times the reveal off LEVEL_UP_REVEAL_DELAY_SEC instead of an actual camera trip. See CameraFocusHost.ts's own doc. */
    private readonly cameraFocusHost?: CameraFocusHost;
    /** Optional — when given, notified at the very end of playLevelUpSequence() so chained world-progression checks (e.g. a gate unlocking) run AFTER this building's own camera trip is fully done, never concurrently with it. See WorldProgressionHost.ts's own doc. */
    private readonly worldProgressionHost?: WorldProgressionHost;
    /** Resource types currently mid-drain via flyInResource() — guards a second overlapping drain loop starting for the same type. */
    private readonly draining = new Set<ResourceType>();
    /**
     * How many units of each type have DEPARTED but not yet LANDED — see flyInResource()'s own
     * doc for why this exists: BackpackStorage/BuildingStorage's progress only advance on
     * LANDING (a ~0.45s flight), but a new unit departs every FLY_IN_STAGGER_SEC (0.12s) —
     * reading the live backpack count/remaining-requirement alone at departure time would keep
     * seeing room for more and send out units the backpack doesn't actually have (or the
     * requirement doesn't actually still need), over-crediting on landing. Incremented right
     * before a departure, decremented the instant that same unit lands.
     */
    private readonly inFlightByType = new Map<ResourceType, number>();
    /** True for as long as the player's RigidBody is inside this zone's trigger — flyInResource()'s per-unit loop checks this before every unit and stops the instant it goes false, rather than a fixed onTriggerEnter burst draining everything regardless of whether the player stuck around. */
    private isPlayerInside = false;
    /** The player entity currently inside this zone — undefined whenever isPlayerInside is false. Kept so flyInResource() can read the player's CURRENT backpack world position on every unit, not a stale snapshot from whenever the trigger first fired. */
    private player?: MainPlayer;
    /**
     * Set the instant a level clears (see handleLevelUp()) — while true, tryDeposit() refuses
     * to start any new drain and flyInResource()'s step() loop halts on its next tick, so
     * depositing stops for the whole level-up transition instead of continuing to feed the
     * NEXT level's requirements while the mesh-swap/camera sequence is still playing. Only
     * clears the instant the player LEAVES this zone's trigger (see handleTriggerExit()), OR —
     * if they just stand there instead — after REENTRY_TIMEOUT_SEC on its own (see
     * reentryTimer), so someone who stays put through the whole level-up sequence doesn't have
     * to walk out and back in just to nudge this back to false; it only ever needs a deliberate
     * leave-and-return when they wander off mid-transition and reentryTimer never gets to fire.
     */
    private awaitingReentry = false;
    /** Clears awaitingReentry on its own after REENTRY_TIMEOUT_SEC — see that field's own doc. Killed/replaced on every handleLevelUp() (a level-up starts its own fresh window rather than extending one already ticking down from a PRIOR level's clear) and on handleTriggerExit()/destroy() (nothing left to time out once the player's gone or this zone is torn down). */
    private reentryTimer?: gsap.core.Tween;
    /** Where deposited icons fly TO — the same anchor this zone's own requirements panel tracks (see awake()), i.e. wherever this building's UI is actually rendered on screen, not a point on the building's 3D mesh. */
    private labelAnchor!: THREE.Object3D;
    /** The dropper's dotted floor outline — hidden once BuildingStorage.isMaxLevel() (see refreshLabel()), since there's nothing left to deposit into and the final mesh should just stand there uninterrupted. */
    private dropperVisual!: DottedZoneVisualComponent;
    /** Owns the requirements panel's on-screen positioning/pointer — force-hidden at max level (see refreshLabel()) so its own `content.visible = true` (whenever the target is on-screen) can't override labelFrame.visible back to true, and so its avoidViewer pointer sprite stops showing too. Undefined only for the very first refreshLabel() call in awake(), which runs before this component is constructed. */
    private labelScreenAnchor?: ScreenAnchorComponent;

    private titleText!: PIXI.Text;
    /** Holds either a single horizontal row of requirement slots (see ResourceSlotVisual.ts) or a lone "MAX LEVEL" text — rebuilt wholesale by refreshLabel() rather than diffed, since it only ever has a handful of children. */
    private requirementsContainer!: PIXI.Container;
    private labelFrame!: AutoFitFrame;

    /** The building's own visible structure — one per level (see BuildingTypes.ts's BuildingMeshConfig), swapped out on level-up via replaceBuildingMesh(). Undefined only ever momentarily, between disposing the old mesh and creating the new one. Mutually exclusive with `buildingVisuals` below — exactly one of the two is ever populated at a time, depending on whether this level has an EntityViewRegistry `view` id (see createBuildingMesh()). */
    private buildingMesh?: THREE.Mesh;
    /**
     * The real-glb counterpart(s) to `buildingMesh` above, used instead of it when this level's
     * `view` id resolves to an actual model (see EntityViewRegistry.ts's resolveEntityView()) —
     * always exactly one entry in that case — OR when this building falls back to its own
     * "useOwnMesh" objects (see resolveOwnMeshFallbacks()), which can carry SEVERAL entries: a
     * level designer can share one id across multiple drawn objects (e.g. two floor pieces
     * that together make up "floor1"), and every one of them gets its own GlbVisualComponent
     * here so they all show/fill together off the SAME shared `revealProgress`. Empty (not
     * populated at all) whenever `buildingMesh` above is the one in use instead.
     */
    private buildingVisuals: GlbVisualComponent[] = [];
    /** The view id `buildingMesh`/`buildingVisual` was last built from — lets replaceBuildingMesh() tell "the new level shares this SAME mesh with the one just cleared" (grow the existing reveal fill in place, no dispose/recreate) apart from "the new level actually swaps in a different mesh" (see getFillFractionForLevel()'s own doc on why a run of levels can share one view id). Undefined only before the very first createBuildingMesh() call. */
    private currentViewId?: string;
    /** BuildingConfig.solidFromMap's per-piece colliders — see addSolidAreasFromMap()'s own doc. Built/torn down in lockstep with `buildingVisuals` (createBuildingMesh()/disposeBuildingMesh()), NOT once in awake(), so a piece never collides while its own mesh isn't actually visible. Always empty for a building that doesn't set `solidFromMap`. */
    private solidColliders: RigidBody[] = [];

    private readonly handleProgressChanged = (id: BuildingId): void => {
        if (id === this.buildingId) {
            this.refreshLabel();
        }
    };

    /** Keeps the persistent panel's missing-tool state (see refreshLabel()) live — crafting BuildingConfig.requiredTool while standing right next to this building (or having it drained some other way) should flip the panel immediately, not just the next time some unrelated deposit/level-up event happens to call refreshLabel() anyway. */
    private readonly handleItemChanged = (type: ItemType): void => {
        if (type === BUILDING_CONFIG[this.buildingId].requiredTool) {
            this.refreshLabel();
        }
    };

    private readonly handleLevelUp = (id: BuildingId, level: number): void => {
        if (id !== this.buildingId) {
            return;
        }

        // Set synchronously, in the SAME tick the level actually cleared (this handler runs
        // straight off BuildingStorage.tryCompleteLevel()'s own dispatch, which itself runs
        // straight off the landing icon that completed it) — see awaitingReentry's own doc.
        // Anything already in flight still lands normally; this only stops NEW departures.
        this.awaitingReentry = true;
        this.reentryTimer?.kill();
        this.reentryTimer = gsap.delayedCall(REENTRY_TIMEOUT_SEC, () => {
            this.awaitingReentry = false;
        });

        // Fire-and-forget from the Signal's perspective — BuildingStorage.onLevelUp is a
        // synchronous callback, but the sequence it kicks off (popup, camera travel/hold/
        // return, THEN refresh) is deliberately async — see this file's own doc.
        void this.playLevelUpSequence(level);
    };

    /** Overrides BuildingMeshConfig's own width/depth (X/Z) at every level — see the constructor's `footprint` param doc. Undefined means "use whatever BuildingTypes.ts says," same as before this existed. */
    private readonly footprint?: { width: number; depth: number };
    /** Optional separate deposit-trigger rect — see the constructor's `triggerArea` param doc. Undefined means "trigger the building's own footprint," same as before this existed. */
    private readonly triggerArea?: BuildingTriggerArea;
    /** See the constructor's `ownMeshes` param doc — consulted by resolveOwnMeshFallbacks(). */
    private readonly ownMeshes: readonly OwnMeshPlacement[];
    /** See the constructor's `npc` param doc. Undefined means "no NPC assigned," same as before this existed. */
    private readonly npc?: NpcEntity;

    public constructor(
        position: THREE.Vector3,
        screenHost: ScreenAnchorHost,
        buildingId: BuildingId = BuildingId.Camp,
        cameraFocusHost?: CameraFocusHost,
        worldProgressionHost?: WorldProgressionHost,
        /**
         * Optional X/Z footprint override — from a Tiled object's rect (see
         * WorldObjectRegistry.ts/PizzaScene.setupBuildingZone()), so the visible mesh
         * actually matches whatever size the level designer drew in Tiled instead of always
         * using BuildingTypes.ts's own hardcoded per-level size. Only overrides X/Z: a Tiled
         * rect has no vertical dimension, so each level's own height (Y) still comes from
         * BuildingMeshConfig — see createBuildingMesh().
         */
        footprint?: { width: number; depth: number },
        /**
         * Optional separate deposit-trigger area, in WORLD space — from a Tiled "dropper"
         * object targeting this building (see WorldObjectRegistry.ts's own doc /
         * PizzaScene.setupBuildingZone()). When given, the PLAYER-FACING trigger (what
         * actually starts a deposit) sits here instead of on the building's own footprint —
         * e.g. a building drawn somewhere the player can't walk up to, with its real
         * drop-off spot placed elsewhere on the map. The building's own visual mesh and
         * camera-focus point are always UNAFFECTED — they stay exactly where
         * `position`/`footprint` say regardless. The requirements panel/level-up callout and
         * level-up particle burst are ALSO unaffected by default, UNLESS this building's own
         * BuildingConfig.anchorAtDropper opts them into following this triggerArea instead —
         * see that field's own doc and getFxAnchorPosition(). Undefined `triggerArea` means
         * "trigger the building's own footprint" (and anchorAtDropper, if set, has nothing to
         * switch to — falls back to the mesh), same as before this param existed.
         */
        triggerArea?: BuildingTriggerArea,
        /**
         * This building's own decoded "useOwnMesh" fallback(s) (see
         * WorldObjectRegistry.getOwnMeshes()'s own doc) — every real model decoded off a
         * mapSettings object sharing this building's own id with its "useOwnMesh" checkbox
         * set, used by createBuildingMesh() when this building has no `view`/`baseView`
         * configured in BuildingTypes.ts at all (see resolveOwnMeshFallbacks()). Several
         * objects can share one id (e.g. two pieces that together make up one composite
         * building) — every one of them gets its own mesh, each at its own drawn position, all
         * filling together (see this.buildingVisuals's own doc). Empty array (the default) —
         * the checkbox was never set on any matching object, or was set but nothing usable
         * decoded from it — skips that fallback entirely, same as before this param existed.
         */
        ownMeshes: readonly OwnMeshPlacement[] = [],
        /**
         * This building's own assigned NPC (see BuildingConfig.npcId/npcOffset's own doc) —
         * already spawned and added to the world by PizzaScene.setupBuildingZone() BEFORE this
         * constructor runs, so it's available immediately rather than arriving after awake().
         * Read by getFxAnchorPosition() (see that method's own doc, and getLabelBasePosition()),
         * which takes priority over the dropper/mesh there — so the persistent requirements
         * panel, the rising "Level Up!" callout, AND the level-up particle burst all anchor to
         * the NPC instead, reading as the NPC presenting/celebrating rather than a disembodied
         * panel floating over the dropper/ground. The requirements panel specifically prefers
         * the NPC's own animated Head bone (NpcEntity.getHeadWorldPosition()) once its rig has
         * loaded, falling back to this NPC's ground-level `transform.position` until then — see
         * getLabelBasePosition(). Undefined (the default) means "no NPC assigned," unchanged
         * from before this param existed.
         */
        npc?: NpcEntity,
    ) {
        super();
        this.screenHost = screenHost;
        this.buildingId = buildingId;
        this.cameraFocusHost = cameraFocusHost;
        this.worldProgressionHost = worldProgressionHost;
        this.footprint = footprint;
        this.triggerArea = triggerArea;
        this.ownMeshes = ownMeshes;
        this.npc = npc;
        this.transform.position.copy(position);
        this.restY = position.y;
    }

    /**
     * This zone's own FX anchor, in WORLD space — the shared backing point for the persistent
     * requirements panel (`labelAnchor`, set up in awake()), the rising "Level Up!" callout
     * (see spawnLevelUpPopup()), and the level-up particle burst (see playLevelUpSequence()).
     * Every one of those three still adds its own EXISTING height offset on top of whatever this
     * returns (popupBobOffset, POPUP_HEIGHT_OFFSET, CAMERA_FOCUS_HEIGHT_OFFSET respectively) —
     * still valid, unchanged — this method just picks WHERE they measure up FROM.
     *
     * Resolves to `npc`'s own GROUND-level position (see the constructor's own doc) FIRST, when
     * this building has an NPC assigned — with an NPC standing in for the building, every one of
     * those three should read as coming from the NPC, not a disembodied point over the
     * dropper/ground. This is deliberately the ground point, not the live Head bone
     * (getLabelBasePosition() uses that instead, specifically for the requirements panel) — the
     * level-up popup/particle burst add their OWN much bigger height offsets
     * (POPUP_HEIGHT_OFFSET/CAMERA_FOCUS_HEIGHT_OFFSET, sized for a building, not a human), so
     * stacking those on top of a head position (already ~1.7m up) would float them way too high.
     * Otherwise resolves to this building's own dropper/triggerArea position when
     * BuildingConfig.anchorAtDropper is set AND a dropper actually exists (see that field's own
     * doc), falling back to this zone's own visual-mesh position (`this.transform.position`)
     * otherwise — unchanged from before either of those two params existed.
     */
    private getFxAnchorPosition(): THREE.Vector3 {
        if (this.npc) {
            return this.npc.transform.position.clone();
        }
        if (BUILDING_CONFIG[this.buildingId].anchorAtDropper && this.triggerArea) {
            return this.triggerArea.position.clone();
        }
        return this.transform.position.clone();
    }

    /**
     * WORLD-space base point for the persistent requirements panel specifically (see
     * `labelAnchor`, awake()) — prefers `npc`'s own live, animated Head bone
     * (NpcEntity.getHeadWorldPosition()) once its rig has loaded, over getFxAnchorPosition()'s
     * ground-level NPC point, so the panel actually reads as floating above the NPC's HEAD
     * rather than sitting at its feet plus a flat guessed offset (the bug this method exists to
     * fix — see BuildingConfig.popupBobOffset's own doc for why that value alone isn't a
     * reliable "head height," it's tuned per-building against each building's own — much
     * taller — mesh). Falls back to getFxAnchorPosition() (ground-level NPC point, or the usual
     * dropper/mesh when no NPC is assigned) before the rig loads, or when there's no NPC at all.
     * `target` is a caller-owned scratch Vector3 (see ScreenAnchorComponent's own per-frame
     * callback convention) — reused every frame rather than allocating a new one.
     */
    private getLabelBasePosition(target: THREE.Vector3): THREE.Vector3 {
        const headPosition = this.npc?.getHeadWorldPosition(target);
        return headPosition ?? this.getFxAnchorPosition();
    }

    public override awake(): void {
        // Trigger footprint (X/Z) matches this.triggerArea's footprint when a separate
        // trigger area was given (see the constructor's `triggerArea` param doc), else the
        // visible mesh's own footprint when one was given (see the `footprint` param doc) —
        // HALF_EXTENTS was a fixed "roughly building-sized" guess for every building
        // regardless of its actual size; without this a Tiled-authored building/dropper much
        // bigger than that guess (e.g. a 14x9 footprint) would still only be enterable within
        // the old tiny 2.5x2.5 trigger. Height (Y) is unaffected — a Tiled rect has no
        // vertical dimension to derive it from.
        const triggerFootprint = this.triggerArea?.footprint ?? this.footprint;
        const halfExtents = triggerFootprint
            ? new THREE.Vector3(triggerFootprint.width / 2, HALF_EXTENTS.y, triggerFootprint.depth / 2)
            : HALF_EXTENTS;

        // RigidBody.centerOffset is relative to THIS entity's own transform.position (the
        // building's visual position) — when triggerArea gives an ABSOLUTE world position
        // instead, converting it to an X/Z offset from here is what lets the trigger sit
        // somewhere else on the map entirely while the visual mesh/nameplate/camera-focus
        // point all stay exactly where `position` says (see triggerArea's own doc: only the
        // player-facing trigger moves, nothing else about this building does).
        const centerOffset = new THREE.Vector3(0, halfExtents.y, 0);
        if (this.triggerArea) {
            centerOffset.x = this.triggerArea.position.x - this.transform.position.x;
            centerOffset.z = this.triggerArea.position.z - this.transform.position.z;
        }

        const rigidBody = this.addComponent(new RigidBody({
            halfExtents,
            isStatic: true,
            isTrigger: true,
            layer: Layers.Trigger,
            centerOffset,
        }));

        // solidFromMap's per-piece colliders are built/torn down alongside the visual mesh
        // itself instead of once here — see createBuildingMesh()/disposeBuildingMesh() — so a
        // piece that isn't visible yet (e.g. this building's own targetFraction <= 0, before
        // its first level clears) never blocks the player with an invisible wall.
        if (!BUILDING_CONFIG[this.buildingId].solidFromMap) {
            const solidArea = buildSolidArea(halfExtents, centerOffset, BUILDING_CONFIG[this.buildingId].solid ?? 0);
            if (solidArea) {
                this.addComponent(solidArea);
            }
        }

        // Traces the ACTUAL deposit trigger's own footprint/position on the floor — same
        // dotted-outline technique as QueueZone/DropZone. Needed independently of the building's
        // own visual mesh below since a triggerArea (a Tiled "dropper") can sit anywhere on the
        // map, entirely apart from where the building itself is drawn — see triggerArea's own doc.
        this.dropperVisual = this.addComponent(new DottedZoneVisualComponent(
            halfExtents.x * 2,
            halfExtents.z * 2,
            DROPPER_ZONE_CORNER_RADIUS,
            { color: getZoneColor(ZoneColorKind.BuildingDropper) },
            centerOffset,
        ));
        // The zone's actual visible structure — starts at whatever level it's already at (e.g.
        // reloading a save mid-upgrade-ladder), no drop-in for this first placement (see
        // createBuildingMesh()'s `dropIn` param) since there's no "before" state to animate
        // FROM yet.
        this.createBuildingMesh(BuildingStorage.getLevel(this.buildingId), false);

        // Title anchored (0.5, 1) — bottom-edge-at-position-y — and refreshLabel() always
        // stacks the requirement rows so THEIR block's bottom also lands at local (0,0),
        // whatever the row count. That makes (0,0) a true bottom-center pivot for the panel
        // as a whole, matching where ScreenAnchorComponent places `content` and what
        // distance-scale scales around.
        this.titleText = new PIXI.Text('', TextStyleRegistry.ZoneTitle);
        this.titleText.anchor.set(0.5, 1);

        this.requirementsContainer = new PIXI.Container();

        const column = new PIXI.Container();
        column.addChild(this.titleText, this.requirementsContainer);
        this.labelFrame = new AutoFitFrame(LABEL_FRAME_PADDING, resolvePopupFrameName(BUILDING_CONFIG[this.buildingId].popupMode, 'BuildingFrame', BUILDING_CONFIG[this.buildingId].frame), column);

        // A dedicated empty node the panel tracks, rather than a raw captured position —
        // parented under this.transform so it moves with the zone for free. Stored as a field
        // (not just a local) since flyInResource() targets the same spot — deposited icons fly
        // to wherever this building's own UI actually renders, not a point on its 3D mesh.
        // getFxAnchorPosition() is a WORLD point (the NPC's position when one's assigned, else
        // the mesh position, or the dropper's when anchorAtDropper opts in — see that method's
        // own doc); converted to a LOCAL offset here since labelAnchor is parented under
        // this.transform, then the panel's own bob height (still popupBobOffset, unchanged —
        // see getFxAnchorPosition()'s own doc for why that stays valid even when the base point
        // is now the NPC) stacks on top the same way it always has.
        const labelBobOffset = resolvePopupAnchorOffset(BUILDING_CONFIG[this.buildingId].popupBobOffset);
        this.labelAnchor = new THREE.Object3D();
        this.labelAnchor.position.copy(this.getFxAnchorPosition().sub(this.transform.position).add(labelBobOffset));
        this.transform.add(this.labelAnchor);
        const labelAnchorWorldPosition = new THREE.Vector3();

        // ZONE_LABEL_ANCHOR_OPTIONS hides/shrinks the panel by distance from the player — see
        // that file's own doc. avoidViewer (only for 'simple' — see PopupConfig.ts's own doc)
        // slides the panel aside instead of letting it land on the player, who's typically
        // standing right on this zone's own base once they're close enough to interact.
        //
        // getLabelBasePosition() (NOT labelAnchor.getWorldPosition() directly, unlike before it
        // existed) — re-evaluated every frame rather than baked once at awake() time, since an
        // assigned NPC's Head bone (what it prefers once the rig loads — see that method's own
        // doc) doesn't exist synchronously here (NpcEntity.load() is async) and can't be baked
        // into labelAnchor's own fixed local offset the way the ground-level/dropper/mesh cases
        // always could.
        this.labelScreenAnchor = this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            this.labelFrame,
            () => this.getLabelBasePosition(labelAnchorWorldPosition).add(labelBobOffset),
            { ...ZONE_LABEL_ANCHOR_OPTIONS, ...resolvePopupAvoidViewer(BUILDING_CONFIG[this.buildingId].popupMode) },
        ));

        // Deliberately called only now, AFTER labelScreenAnchor exists — refreshLabel() calls
        // this.labelScreenAnchor?.setForceHidden() at max level, and a building that's ALREADY
        // maxed when it first spawns (e.g. loaded from a save) would otherwise have that one
        // call silently no-op on an as-yet-undefined labelScreenAnchor, with no later
        // progress/level-up event ever coming along to call refreshLabel() again — leaving its
        // ScreenAnchorComponent (and avoidViewer pointer) stuck showing forever.
        this.refreshLabel();

        BuildingStorage.onProgressChanged.add(this.handleProgressChanged);
        BuildingStorage.onLevelUp.add(this.handleLevelUp);
        ItemStorage.onChange.add(this.handleItemChanged);

        // onTriggerStay (not just onTriggerEnter) makes this a CONTINUOUS deposit — every
        // physics step the player is still standing here, tryDeposit() gets another chance to
        // start draining any type that isn't already mid-drain. onTriggerExit flips
        // isPlayerInside off, which flyInResource()'s loop checks before every single unit —
        // see this file's own doc for why the old "fire the whole burst on enter" behavior kept
        // draining the backpack even after the player walked away.
        rigidBody.onTriggerEnter.add(other => this.tryDeposit(other));
        rigidBody.onTriggerStay.add(other => this.tryDeposit(other));
        rigidBody.onTriggerExit.add(other => this.handleTriggerExit(other));
    }

    /**
     * BuildingConfig.solidFromMap's own behavior (see that field's own doc) — one solid
     * RigidBody PER `this.ownMeshes` entry whose own map-drawn `solid` fraction is > 0, sized
     * to THAT piece's own drawn width/depth (not the shared trigger `halfExtents`/
     * `centerOffset` the default single-collider branch in awake() uses) and positioned at its
     * own local offset from this zone's transform — same X/Z-relative-to-transform.position
     * math resolveOwnMeshFallbacks() uses to place each piece's own visual. Height (Y) reuses
     * HALF_EXTENTS.y, same fixed "roughly building-sized" guess every other collider here
     * falls back to — a Tiled rect has no vertical dimension to derive a real one from. A
     * building with no own-mesh pieces at all (or none with a positive `solid`) simply gets no
     * collider — nothing here to source per-piece solidity from. Called from createBuildingMesh()
     * — right alongside the visual pieces it's colliding for, so a piece never has a collider
     * without also having a visible mesh (see that method's own doc) — NOT from awake()
     * unconditionally; every RigidBody built here is tracked in `this.solidColliders` so
     * disposeBuildingMesh() can tear them down in lockstep with the mesh they belong to.
     */
    private addSolidAreasFromMap(): void {
        for (const entry of this.ownMeshes) {
            if (entry.solid <= 0) {
                continue;
            }

            const pieceHalfExtents = new THREE.Vector3(entry.width / 2, HALF_EXTENTS.y, entry.depth / 2);
            const pieceCenterOffset = new THREE.Vector3(
                entry.x - this.transform.position.x,
                pieceHalfExtents.y,
                entry.z - this.transform.position.z,
            );

            const solidArea = buildSolidArea(pieceHalfExtents, pieceCenterOffset, entry.solid);
            if (solidArea) {
                this.solidColliders.push(this.addComponent(solidArea));
            }
        }
    }

    public override destroy(): void {
        BuildingStorage.onProgressChanged.remove(this.handleProgressChanged);
        BuildingStorage.onLevelUp.remove(this.handleLevelUp);
        ItemStorage.onChange.remove(this.handleItemChanged);
        this.reentryTimer?.kill();
        this.disposeBuildingMesh();
        super.destroy();
    }

    /**
     * Builds this level's visible structure and parents it under this.transform, replacing
     * whatever createBuildingMesh() built last (see disposeBuildingMesh()). Always a FRESH
     * mesh — callers that instead want to grow the fill on the mesh already standing (a level
     * whose `view` is unchanged from the one just cleared — see getFillFractionForLevel()'s own
     * doc) go through replaceBuildingMesh()'s own same-view branch and never reach here at all.
     * `dropIn` plays the reveal-sweep beat (see playRevealEffect()); pass false for the zone's
     * very first mesh, where there's no prior state to animate FROM — it's set directly to this
     * level's target fill fraction instead. Prefers this level's EntityViewRegistry `view` id (a
     * real glb — see BuildingLevelConfig.view's own doc) when one resolves to an actual model;
     * falls back to the level's own box placeholder (`mesh`) otherwise, unchanged from before
     * `view` existed.
     *
     * A `targetFraction` of 0 or below (see getFillFractionForLevel()'s own doc on a negative
     * `baseFillFraction`) builds NOTHING at all — leaves buildingMesh/buildingVisuals empty
     * rather than a mesh sitting there with its reveal sweep parked at the very bottom (which
     * would still show a thin sliver at the base, not truly nothing). replaceBuildingMesh()'s
     * own `sameView` check already treats "nothing currently built" the same as a genuine view
     * change — the next level-up that actually reaches a positive fraction disposes (a no-op,
     * since there's nothing to dispose) and calls back in here with `dropIn: true`, sweeping the
     * mesh in from scratch exactly like a fresh view swap would. BuildingConfig.solidFromMap's
     * own per-piece colliders (see addSolidAreasFromMap()) are built right here too, for the
     * exact same reason — a piece with a positive `targetFraction` gets both its visual AND its
     * collider together; a piece that isn't visible yet gets neither.
     */
    private createBuildingMesh(level: number, dropIn: boolean): void {
        const viewId = getViewIdForLevel(this.buildingId, level);
        this.currentViewId = viewId;
        const targetFraction = getFillFractionForLevel(this.buildingId, level);
        if (targetFraction <= 0) {
            return;
        }

        if (BUILDING_CONFIG[this.buildingId].solidFromMap) {
            this.addSolidAreasFromMap();
        }

        const entityView = resolveEntityView(viewId);
        if (entityView) {
            this.createBuildingView(entityView, dropIn, targetFraction);
            return;
        }

        const ownMeshViews = this.resolveOwnMeshFallbacks();
        if (ownMeshViews.length > 0) {
            for (const { resolved, footprint, rotationY } of ownMeshViews) {
                this.createBuildingView(resolved, dropIn, targetFraction, footprint, rotationY);
            }
            return;
        }

        this.createBuildingBox(getMeshConfigForLevel(this.buildingId, level), dropIn, targetFraction);
    }

    /**
     * Falls back to `this.ownMeshes` — every one of this building's own mapSettings objects'
     * decoded "useOwnMesh" models (see WorldObjectRegistry.getOwnMeshes()'s own doc), passed in
     * through the constructor — for a building with no `view`/`baseView` configured in
     * BuildingTypes.ts at all. Only ever consulted when resolveEntityView() already came back
     * empty (see createBuildingMesh()), so a building WITH a real configured view never touches
     * this. Each entry's own `x`/`z` is converted here to a LOCAL offset relative to this
     * zone's own transform.position — the zone sits at whichever ONE placement PizzaScene
     * resolved as this building's canonical position (see setupBuildingZone()), but each
     * own-mesh object can be drawn anywhere on the map, so this is what lets several of them
     * (sharing one id) each render at their OWN drawn spot instead of collapsing onto that one
     * shared position. `rotationDeg` is deliberately 0 here (unlike a normal EntityViewRegistry
     * view) — the real rotation is applied manually AFTER createBuildingView()'s fit-to-footprint
     * scaling measures the model's UNROTATED native bounding box (see that method's own doc for
     * why measuring pre-rotation matters); `scale` is likewise a placeholder 1 (fit-to-footprint
     * computes and applies the real per-axis scale itself once the model's actually loaded). An
     * entry whose modelRef no longer resolves to a real model (e.g. renamed/removed) is silently
     * skipped rather than aborting the whole building — the rest still show. Empty array if this
     * building's "useOwnMesh" checkbox was never set on any matching object (or none of them
     * decoded to a usable model) — createBuildingMesh() falls through to the plain box
     * placeholder in that case.
     */
    private resolveOwnMeshFallbacks(): { resolved: NonNullable<ReturnType<typeof resolveEntityView>>; footprint: { width: number; depth: number }; rotationY: number }[] {
        const results: { resolved: NonNullable<ReturnType<typeof resolveEntityView>>; footprint: { width: number; depth: number }; rotationY: number }[] = [];

        for (const entry of this.ownMeshes) {
            const model = ModelSnapshotTool.resolveModelDef(entry.modelRef);
            if (!model) {
                continue;
            }

            // entry.offsetX/Z (this piece's own "offsetX"/"offsetZ" Tiled custom properties —
            // see MeshLayerSpawner.OFFSET_X_PROPERTY's own doc) are a level designer's manual
            // nudge for wherever this model's own pivot sits relative to its placeholder's rect
            // center — e.g. a corner-pivoted model needing offsetX/Z to visually center itself.
            // That nudge is meaningless in a fixed WORLD direction once this piece is rotated
            // (it has to turn WITH the model, same as everything else about this placement) —
            // rotating it by this SAME entry.rotationY that createBuildingView() applies to
            // mesh.rotation.y is what keeps it pointing the same way RELATIVE to the model as
            // the model itself turns.
            const rotatedOffset = new THREE.Vector3(entry.offsetX, 0, entry.offsetZ).applyAxisAngle(UP_AXIS, entry.rotationY);

            results.push({
                resolved: {
                    model,
                    scale: 1,
                    rotationDeg: 0,
                    offset: [
                        entry.x - this.transform.position.x + rotatedOffset.x,
                        entry.offsetY,
                        entry.z - this.transform.position.z + rotatedOffset.z,
                    ],
                },
                footprint: { width: entry.width, depth: entry.depth },
                rotationY: entry.rotationY,
            });
        }

        return results;
    }

    private createBuildingBox(config: ReturnType<typeof getMeshConfigForLevel>, dropIn: boolean, targetFraction: number): void {
        const material = new THREE.MeshStandardMaterial({ color: config.color });
        BendService.applyBend(material);

        const [configWidth, height, configDepth] = config.size;
        const width = this.footprint?.width ?? configWidth;
        const depth = this.footprint?.depth ?? configDepth;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
        mesh.position.set(0, height / 2, 0);
        this.transform.add(mesh);
        this.buildingMesh = mesh;

        this.playRevealEffect(mesh, dropIn, targetFraction);
    }

    /**
     * `fitFootprint` (only ever given for a resolveOwnMeshFallbacks() result — see that
     * method's own doc) rescales the loaded model, per-axis, to match that ONE own-mesh
     * object's own drawn width/depth — same "the drawn rect's CURRENT size has to reach the
     * real model too" reasoning as PizzaScene.setupMeshLayer()'s own identical fit, just
     * against this one object's own footprint instead of a meshes-layer placement's
     * worldWidth/worldDepth (and, since createBuildingMesh() can call this once per own-mesh
     * entry, each gets fit to ITS OWN footprint rather than one shared size) — instead of
     * trusting `resolved.scale` (which resolveOwnMeshFallbacks() always sets to a placeholder
     * 1). Measures the model's bounding box BEFORE applying `resolved.rotationDeg` (always 0
     * for that caller) so size.x/size.z read the model's own un-rotated width/depth on the same
     * axes the footprint's width/depth are drawn in, then applies `rotationY` manually
     * afterward — measuring AFTER rotation would give a skewed footprint for anything not
     * rotated by a multiple of 90°, same pitfall that method's own doc calls out. Undefined
     * `fitFootprint` (the EntityViewRegistry `view`/`baseView` path) skips all of this and
     * just trusts `resolved.scale`/`resolved.rotationDeg` as-is, unchanged from before this
     * fallback path existed.
     */
    private createBuildingView(
        resolved: NonNullable<ReturnType<typeof resolveEntityView>>,
        dropIn: boolean,
        targetFraction: number,
        fitFootprint?: { width: number; depth: number },
        rotationY?: number,
    ): void {
        const [offsetX, offsetY, offsetZ] = resolved.offset;

        const visual = new GlbVisualComponent(
            resolved.model,
            new THREE.Vector3(offsetX, offsetY, offsetZ),
            resolved.scale,
            THREE.MathUtils.degToRad(resolved.rotationDeg),
            // The glb loads asynchronously — the reveal sweep needs the finished mesh's
            // world bounds, so it's set up here rather than right after construction.
            () => {
                if (fitFootprint) {
                    const mesh = visual.mesh;
                    const box = new THREE.Box3().setFromObject(mesh);
                    const nativeSize = box.getSize(new THREE.Vector3());
                    const scaleX = nativeSize.x > 1e-4 ? fitFootprint.width / nativeSize.x : 1;
                    const scaleZ = nativeSize.z > 1e-4 ? fitFootprint.depth / nativeSize.z : 1;
                    // No vertical-scale signal from a top-down footprint rect — splitting the
                    // difference between the two horizontal axes is the least-arbitrary
                    // stand-in, same as setupMeshLayer()'s own identical averaging.
                    const scaleY = (scaleX + scaleZ) / 2;

                    // Same box-center-vs-pivot correction as PizzaScene.setupMeshLayer() — see
                    // that method's own doc. X/Z only, deliberately — Y stays the vertical
                    // pivot-at-base convention every prop already relies on, untouched by this
                    // or by the Y-axis rotation below. box.getCenter() is WORLD space,
                    // mesh.position is LOCAL to `this.transform` (this zone's own world
                    // position) — worldToLocal() re-expresses the box center in that SAME local
                    // frame so this isolates the model's own intrinsic pivot-to-center offset.
                    const localBoxCenter = mesh.parent!.worldToLocal(box.getCenter(new THREE.Vector3()));
                    const pivotToCenterXZ = new THREE.Vector3(
                        (localBoxCenter.x - mesh.position.x) * scaleX,
                        0,
                        (localBoxCenter.z - mesh.position.z) * scaleZ,
                    ).applyAxisAngle(UP_AXIS, rotationY ?? 0);
                    mesh.position.x -= pivotToCenterXZ.x;
                    mesh.position.z -= pivotToCenterXZ.z;

                    mesh.scale.set(scaleX, scaleY, scaleZ);
                    mesh.rotation.y = rotationY ?? 0;
                }
                this.playRevealEffect(visual.mesh, dropIn, targetFraction);
            },
        );
        this.buildingVisuals.push(this.addComponent(visual));
    }

    /** Shared by every material a reveal sweep is applied to (see playRevealEffect()) — kept as an instance field so disposeBuildingMesh() can kill an in-flight sweep, and so replaceBuildingMesh()'s same-view branch can grow an ALREADY-applied sweep further without re-touching any material. */
    private readonly revealProgress = { value: 0 };

    /**
     * Sweeps a bottom-to-top reveal cutout (see BendService.applyReveal's own doc) across every
     * material of `root`, over its own world-space Y bounds, up to `targetFraction` (1 = fully
     * built — see getFillFractionForLevel()'s own doc for why a level mid-run stops short of
     * that). `dropIn` false (the zone's very first mesh, or a save reloaded already past level
     * 0) snaps straight to `targetFraction` with no animation, since there's no prior state to
     * grow FROM; `dropIn` true (an actual level-up) animates 0 -> targetFraction instead, the
     * "grows in from the ground" beat that replaces the old drop-from-above/bounce one.
     */
    private playRevealEffect(root: THREE.Object3D, dropIn: boolean, targetFraction: number): void {
        // `root` was just parented under this.transform this SAME tick (either the box mesh
        // built a few lines up, or a GlbVisualComponent's onReady) — its (and its ancestors')
        // matrixWorld hasn't necessarily been recomputed by the renderer yet, and Box3 reads
        // world positions straight off matrixWorld. Skipping this risked bounds computed from a
        // stale/identity matrix — collapsing min/max toward the wrong Y range and discarding
        // almost the entire mesh under the reveal shader below, i.e. the building silently
        // rendering as "not there" instead of at its correct fill level.
        root.updateMatrixWorld(true);
        const bounds = new THREE.Box3().setFromObject(root);
        // ZoneVisibilityManager parks a newly-registered zone `riseDistance` units BELOW restY
        // and animates it rising back up over time (see that file's own reveal-on-approach
        // logic) — this can still be mid-rise the instant a GLB's onReady fires, so the world
        // bounds Box3 just measured may be sitting `riseDistance` units too low. Correcting by
        // the gap between this.transform.position.y (live, possibly still sunken) and restY
        // (this zone's own known FINAL resting Y, captured once in the constructor) re-bases
        // the bounds to where they'll actually end up once the rise finishes, so the reveal
        // shader's min/max — fixed at creation time, never re-measured per frame — stays
        // correct regardless of how far into that rise animation this happened to run.
        const riseCorrection = this.restY - this.transform.position.y;
        const correctedMinY = bounds.min.y + riseCorrection;
        const correctedMaxY = bounds.max.y + riseCorrection;
        // A few glbs also carry geometry that dips below this zone's own ground level (a buried
        // foundation) — Box3 has no idea that part is invisible, so clamping the bottom to restY
        // keeps the fill fraction tracking what's actually visible above ground.
        const revealMinY = Math.max(correctedMinY, this.restY);
        this.revealProgress.value = dropIn ? 0 : targetFraction;
        root.traverse(child => {
            if (child instanceof THREE.Mesh) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(material => BendService.applyReveal(material, revealMinY, correctedMaxY, this.revealProgress));
            }
        });
        if (dropIn) {
            gsap.to(this.revealProgress, { value: targetFraction, duration: MESH_DROP_DURATION_SEC, ease: 'power2.out' });
        }
    }

    private disposeBuildingMesh(): void {
        gsap.killTweensOf(this.revealProgress);

        if (this.buildingMesh) {
            this.buildingMesh.geometry.dispose();
            (this.buildingMesh.material as THREE.Material).dispose();
            this.buildingMesh.removeFromParent();
            this.buildingMesh = undefined;
        }

        for (const visual of this.buildingVisuals) {
            visual.destroy();
        }
        this.buildingVisuals = [];

        for (const collider of this.solidColliders) {
            collider.destroy();
        }
        this.solidColliders = [];
    }

    /**
     * The "remove one, reveal the upgraded version" visual beat — called as soon as a level
     * clears (see playLevelUpSequence()), so by the time the camera actually arrives (if
     * focusing at all), the building's typically already mid-sweep or freshly revealed.
     *
     * Two cases, per getFillFractionForLevel()'s own doc on runs of levels sharing one `view`:
     *   - This level's view id is the SAME as the one just cleared (still mid-run, e.g. camp's
     *     level 1 -> level 2 both "tower2view") — the mesh already standing is still the
     *     correct one, so it's left completely alone; only the shared revealProgress uniform
     *     grows from its current value up to this level's (higher) target fraction.
     *   - The view id actually changed (a genuinely new mesh, or the run just ended) — tears
     *     down the just-superseded mesh and builds/sweeps in the new one from scratch, exactly
     *     as before.
     */
    private replaceBuildingMesh(level: number): void {
        const viewId = getViewIdForLevel(this.buildingId, level);
        const sameView = viewId === this.currentViewId && (this.buildingMesh || this.buildingVisuals.length > 0);
        if (sameView) {
            const targetFraction = getFillFractionForLevel(this.buildingId, level);
            gsap.to(this.revealProgress, { value: targetFraction, duration: MESH_DROP_DURATION_SEC, ease: 'power2.out' });
            return;
        }

        this.disposeBuildingMesh();
        this.createBuildingMesh(level, true);
    }

    /** Rewrites the panel's title/requirement slots from BuildingStorage's current state and re-fits the frame around the new bounds. `popupMode: 'none'` (see PopupConfig.ts's own doc) skips all of this and keeps the panel permanently hidden; `'simple'` keeps the requirement slots but drops the title line. At max level there's nothing left to deposit or read, so the whole panel and the dropper's dotted outline are hidden instead — just the finished mesh stays. */
    private refreshLabel(): void {
        const config = BUILDING_CONFIG[this.buildingId];

        const maxLevel = BuildingStorage.isMaxLevel(this.buildingId);
        this.dropperVisual.setVisible(!maxLevel);
        this.labelScreenAnchor?.setForceHidden(maxLevel);

        if (config.popupMode === 'none' || maxLevel) {
            this.titleText.visible = false;
            this.labelFrame.visible = false;
            this.labelFrame.fit();
            return;
        }

        this.requirementsContainer.removeChildren().forEach(child => child.destroy({ children: true }));

        // BuildingConfig.requiredTool gates the WHOLE panel content, not just the deposit
        // itself (see tryDeposit()) — showing "3/8 wood" alongside "missing hammer" would read
        // as "I can deposit, I just need more wood," which isn't true here: nothing can be
        // deposited at all until the tool's owned. So this replaces the normal title +
        // resource-row entirely with just the tool's own icon (badged, same composition
        // PlayerNotificationComponent.showBlocked() uses for its own transient version of this)
        // rather than showing both at once. Reacts live to ItemStorage.onChange (see
        // handleItemChanged()) — no proximity/trigger tracking needed, since this panel's own
        // ScreenAnchorComponent already only shows it once the player's close enough anyway.
        const requiredTool = config.requiredTool;
        if (requiredTool !== undefined && !ItemStorage.hasCount(requiredTool as ItemType, 1)) {
            this.titleText.visible = false;

            const slot = new PIXI.Container();
            slot.position.set(-REQ_SLOT_SIZE / 2, -REQ_SLOT_SIZE);
            this.requirementsContainer.addChild(slot);

            slot.addChild(createIconSlotBackground(REQ_SLOT_SIZE, 'Tool'));

            const icon = new PIXI.Sprite(getToolIcon(requiredTool));
            icon.anchor.set(0.5);
            icon.position.set(REQ_SLOT_SIZE / 2, REQ_SLOT_SIZE / 2);
            icon.scale.set(ViewUtils.elementScaler(icon, REQ_SLOT_SIZE - MISSING_TOOL_ICON_PADDING * 2));
            slot.addChild(icon);

            const badge = new PIXI.Sprite(PIXI.Texture.from(MISSING_TOOL_BADGE_TEXTURE));
            badge.anchor.set(1, 1);
            badge.scale.set(ViewUtils.elementScaler(badge, MISSING_TOOL_BADGE_SIZE));
            badge.position.set(REQ_SLOT_SIZE - MISSING_TOOL_BADGE_INSET, REQ_SLOT_SIZE - MISSING_TOOL_BADGE_INSET);
            slot.addChild(badge);

            this.labelFrame.fit();
            return;
        }

        // Always shown now, even in 'simple' mode — a level number above the requirement slots
        // is the one piece of context a bare icon-first popup still needs (was previously
        // dropped entirely for 'simple', leaving no way to tell the building's current level
        // without opening a menu). 'simple' gets the short "Lv1" form; every other mode keeps
        // the fuller "{name} Lv.1".
        const level = BuildingStorage.getLevel(this.buildingId);
        this.titleText.visible = true;
        this.titleText.text = config.popupMode === 'simple' ? `Lv${level}` : `${config.name} Lv.${level}`;

        const next = BuildingStorage.getNextLevelConfig(this.buildingId)!;
        const entries = Object.entries(next.requirements) as [ResourceType, number][];

        const slots = entries.map(([type, need]) => {
            const have = BuildingStorage.getProgress(this.buildingId, type);
            return createResourceSlot(type, REQ_SLOT_SIZE, `${have}/${need}`);
        });
        // All slots share the same size/font, so their visualHeight (slot + label below
        // it) is identical in practice — max() just guards against a future label style
        // that could vary per-entry.
        const requirementsHeight = Math.max(REQ_SLOT_SIZE, ...slots.map(slot => slot.visualHeight));

        // One horizontal row, centered — same slot visual as BackpackUI (see
        // ResourceSlotVisual.ts) — with its bottom edge (below each slot's label) landing
        // exactly at y=0 (see this file's own doc).
        const rowWidth = entries.length * REQ_SLOT_SIZE + Math.max(0, entries.length - 1) * REQ_SLOT_GAP;
        slots.forEach((slot, index) => {
            slot.container.position.set(-rowWidth / 2 + index * (REQ_SLOT_SIZE + REQ_SLOT_GAP), -requirementsHeight);
            this.requirementsContainer.addChild(slot.container);
        });

        this.titleText.position.set(0, -(requirementsHeight + TITLE_SLOTS_GAP));
        this.labelFrame.fit();
    }

    private tryDeposit(other: RigidBody): void {
        const player = other.entity;
        if (!(player instanceof MainPlayer) || BuildingStorage.isMaxLevel(this.buildingId) || this.awaitingReentry) {
            return;
        }

        // BuildingConfig.requiredTool (e.g. the hammer) gates depositing into ANY level of this
        // building at all — checked before touching isPlayerInside/BackpackStorage so a player
        // without it never starts draining resources they can't actually spend here yet. The
        // PERSISTENT panel (see refreshLabel()) is what actually shows this — it already reacts
        // to ItemStorage.onChange, so there's nothing left to do here beyond refusing the
        // deposit itself.
        const requiredTool = BUILDING_CONFIG[this.buildingId].requiredTool;
        if (requiredTool !== undefined && !ItemStorage.hasCount(requiredTool as ItemType, 1)) {
            return;
        }

        const next = BuildingStorage.getNextLevelConfig(this.buildingId);
        if (!next) {
            return;
        }

        this.isPlayerInside = true;
        this.player = player;

        for (const type of Object.keys(next.requirements) as ResourceType[]) {
            this.flyInResource(type);
        }
    }

    /**
     * Player's RigidBody left this zone's trigger — flyInResource()'s loop reads isPlayerInside
     * before every unit, so clearing it here is the ENTIRE "stop depositing" instruction;
     * nothing further needs to be cancelled explicitly. Also clears awaitingReentry (see that
     * field's own doc) — leaving is what makes the building "clean" again after a level-up,
     * regardless of whether the transition itself has actually finished playing yet.
     */
    private handleTriggerExit(other: RigidBody): void {
        if (other.entity !== this.player) {
            return;
        }

        this.isPlayerInside = false;
        this.player = undefined;
        this.awaitingReentry = false;
        this.reentryTimer?.kill();
        this.reentryTimer = undefined;
    }

    /**
     * Drains `type` out of BackpackStorage one unit at a time, re-checking isPlayerInside and
     * this building's CURRENT next-level requirement/progress before every single unit — not a
     * fixed burst computed once at trigger time. Each unit's icon departs from wherever the
     * player's backpack cube currently sits (read fresh every unit, since a continuously-
     * draining player is still walking around) and arrives at this building's own labelAnchor
     * — see this file's own doc. No-ops (and clears `draining`) the instant the player leaves,
     * a level clear sets awaitingReentry (see that field's own doc — depositing stays paused
     * for the rest of the transition even though the player never left), the backpack runs
     * out, or the FBX character (and so the backpack cube) hasn't loaded yet.
     */
    private flyInResource(type: ResourceType): void {
        if (this.draining.has(type)) {
            return;
        }
        this.draining.add(type);

        const icon = getAssetIcon(resolveResourceAssetKey(type));
        const toWorld = new THREE.Vector3();

        const step = (): void => {
            const inFlight = this.inFlightByType.get(type) ?? 0;
            const next = this.isPlayerInside && !this.awaitingReentry && !BuildingStorage.isMaxLevel(this.buildingId)
                ? BuildingStorage.getNextLevelConfig(this.buildingId)
                : undefined;
            const need = next?.requirements[type] ?? 0;
            const remaining = need - BuildingStorage.getProgress(this.buildingId, type) - inFlight;

            const fromWorld = remaining > 0 && BackpackStorage.getCount(type) - inFlight > 0
                ? this.player?.getComponent(CharacterVisualComponent)?.character.getBackpackWorldPosition()
                : undefined;

            if (!fromWorld) {
                this.draining.delete(type);
                return;
            }

            this.labelAnchor.getWorldPosition(toWorld);
            this.inFlightByType.set(type, inFlight + 1);

            spawnFlyingResourceIcon(this.screenHost, fromWorld.clone(), toWorld.clone(), icon, () => {
                this.inFlightByType.set(type, (this.inFlightByType.get(type) ?? 1) - 1);
                if (BackpackStorage.removeOne(type)) {
                    BuildingStorage.addProgress(this.buildingId, type, 1);
                    BuildingStorage.tryCompleteLevel(this.buildingId);
                }
            });

            gsap.delayedCall(FLY_IN_STAGGER_SEC, step);
        };

        step();
    }

    /**
     * The level-up EVENT, played out as one sequential timeline: pop the "Level Up!" callout,
     * send the camera to visit the building (if a CameraFocusHost was given — see the
     * constructor) and hold there for a beat, ease the camera back to the player, THEN flip
     * the panel over to the next level's requirements, THEN (if a WorldProgressionHost was
     * given) checks whether this level-up unlocked anything else, e.g. a gate — see
     * WorldProgressionHost.ts's own doc for why that check has to come strictly after this
     * building's own camera trip, not alongside it. Without a CameraFocusHost (e.g. a future
     * non-scene test harness), the reveal just times off a plain wait() instead — same shape,
     * minus the camera trip.
     */
    private async playLevelUpSequence(level: number): Promise<void> {
        this.spawnLevelUpPopup(level);
        this.replaceBuildingMesh(level);

        // The "update" particle slot (see BuildingConfig.updateParticleEffectId's own doc) —
        // fired right here, the instant the new level's mesh actually drops in, same "at the
        // real visual moment, not some later lifecycle callback" reasoning as Gate's own
        // destroyParticleEffectId (see Gate.collapseMesh()'s own doc).
        const config = BUILDING_CONFIG[this.buildingId];
        if (config.updateParticleEffectId) {
            const burstOrigin = this.getFxAnchorPosition().add(CAMERA_FOCUS_HEIGHT_OFFSET);
            ParticleSystem.burst(config.updateParticleEffectId, burstOrigin, config.updateParticleCount ?? DEFAULT_UPDATE_PARTICLE_COUNT);
        }

        if (this.cameraFocusHost) {
            const focusTarget = this.transform.position.clone().add(CAMERA_FOCUS_HEIGHT_OFFSET);
            await this.cameraFocusHost.focusCameraOn(focusTarget, { holdSec: CAMERA_FOCUS_HOLD_SEC });
        } else {
            await wait(LEVEL_UP_REVEAL_DELAY_SEC);
        }

        this.refreshLabel();

        await this.worldProgressionHost?.notifyBuildingLevelUp(this.buildingId, level);
    }

    /** Big rising "Level Up! Lv.N" callout — same rise-via-world-position + gsap-alpha-fade shape as DropZone.spawnUnitPopup(). */
    private spawnLevelUpPopup(level: number): void {
        if (!this.world) {
            return;
        }

        const text = new PIXI.Text(`Level Up! Lv.${level}`, TextStyleRegistry.Notification);
        text.anchor.set(0.5, 1);

        const basePosition = this.getFxAnchorPosition().add(POPUP_HEIGHT_OFFSET);
        const progress = { t: 0 };
        const risenPosition = new THREE.Vector3();

        const popupEntity = this.world.spawn();
        popupEntity.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            text,
            () => risenPosition.copy(basePosition).setY(basePosition.y + progress.t * POPUP_RISE),
            { ttlSec: POPUP_LIFETIME_SEC },
        ));

        gsap.to(progress, {
            t: 1,
            duration: POPUP_LIFETIME_SEC,
            ease: 'power2.out',
            onUpdate: () => {
                text.alpha = 1 - progress.t;
            },
        });
    }
}
