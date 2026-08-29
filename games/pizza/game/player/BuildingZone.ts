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
import { BUILDING_CONFIG, BuildingId, getMeshConfigForLevel, getViewIdForLevel } from '../data/BuildingTypes';
import { resolveEntityView } from '../world/EntityViewRegistry';
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
import { ParticleSystem } from '../vfx/ParticleSystem';
import { getZoneColor, ZoneColorKind } from '../data/ZoneColorTypes';

const LABEL_FRAME_PADDING = uniformFitPadding(15);

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
/** One requirement slot per required resource, laid out in a single horizontal row — same slot visual as BackpackUI (see ResourceSlotVisual.ts). */
const REQ_SLOT_SIZE = 56;
const REQ_SLOT_GAP = 10;
const FLY_IN_STAGGER_SEC = 0.12;
/** How far above its resting height the upgraded mesh starts before dropping in — see replaceBuildingMesh(). */
const MESH_DROP_START_HEIGHT = 3;
const MESH_DROP_DURATION_SEC = 0.7;
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
     * clears once the player actually LEAVES this zone's trigger (see handleTriggerExit()) —
     * even after the transition finishes, standing in place doesn't auto-resume; the building
     * is "dirty" until they leave and walk back in, same as a fresh visit.
     */
    private awaitingReentry = false;
    /** Where deposited icons fly TO — the same anchor this zone's own requirements panel tracks (see awake()), i.e. wherever this building's UI is actually rendered on screen, not a point on the building's 3D mesh. */
    private labelAnchor!: THREE.Object3D;

    private titleText!: PIXI.Text;
    /** Holds either a single horizontal row of requirement slots (see ResourceSlotVisual.ts) or a lone "MAX LEVEL" text — rebuilt wholesale by refreshLabel() rather than diffed, since it only ever has a handful of children. */
    private requirementsContainer!: PIXI.Container;
    private labelFrame!: AutoFitFrame;

    /** The building's own visible structure — one per level (see BuildingTypes.ts's BuildingMeshConfig), swapped out on level-up via replaceBuildingMesh(). Undefined only ever momentarily, between disposing the old mesh and creating the new one. Mutually exclusive with `buildingVisual` below — exactly one of the two is set at a time, depending on whether this level has an EntityViewRegistry `view` id (see createBuildingMesh()). */
    private buildingMesh?: THREE.Mesh;
    /** The real-glb counterpart to `buildingMesh` above, used instead of it when this level's `view` id resolves to an actual model (see EntityViewRegistry.ts's resolveEntityView()). */
    private buildingVisual?: GlbVisualComponent;

    private readonly handleProgressChanged = (id: BuildingId): void => {
        if (id === this.buildingId) {
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

        // Fire-and-forget from the Signal's perspective — BuildingStorage.onLevelUp is a
        // synchronous callback, but the sequence it kicks off (popup, camera travel/hold/
        // return, THEN refresh) is deliberately async — see this file's own doc.
        void this.playLevelUpSequence(level);
    };

    /** Overrides BuildingMeshConfig's own width/depth (X/Z) at every level — see the constructor's `footprint` param doc. Undefined means "use whatever BuildingTypes.ts says," same as before this existed. */
    private readonly footprint?: { width: number; depth: number };
    /** Optional separate deposit-trigger rect — see the constructor's `triggerArea` param doc. Undefined means "trigger the building's own footprint," same as before this existed. */
    private readonly triggerArea?: BuildingTriggerArea;

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
         * drop-off spot placed elsewhere on the map. The building's own visual mesh,
         * nameplate, and camera-focus point are all UNAFFECTED — they stay exactly where
         * `position`/`footprint` say regardless. Undefined means "trigger the building's
         * own footprint," same as before this param existed.
         */
        triggerArea?: BuildingTriggerArea,
    ) {
        super();
        this.screenHost = screenHost;
        this.buildingId = buildingId;
        this.cameraFocusHost = cameraFocusHost;
        this.worldProgressionHost = worldProgressionHost;
        this.footprint = footprint;
        this.triggerArea = triggerArea;
        this.transform.position.copy(position);
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

        const solidArea = buildSolidArea(halfExtents, centerOffset, BUILDING_CONFIG[this.buildingId].solid ?? 0);
        if (solidArea) {
            this.addComponent(solidArea);
        }

        // Traces the ACTUAL deposit trigger's own footprint/position on the floor — same
        // dotted-outline technique as QueueZone/DropZone. Needed independently of the building's
        // own visual mesh below since a triggerArea (a Tiled "dropper") can sit anywhere on the
        // map, entirely apart from where the building itself is drawn — see triggerArea's own doc.
        this.addComponent(new DottedZoneVisualComponent(
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
        this.refreshLabel();

        // A dedicated empty node the panel tracks, rather than a raw captured position —
        // parented under this.transform so it moves with the zone for free. Stored as a field
        // (not just a local) since flyInResource() targets the same spot — deposited icons fly
        // to wherever this building's own UI actually renders, not a point on its 3D mesh.
        this.labelAnchor = new THREE.Object3D();
        this.labelAnchor.position.copy(resolvePopupAnchorOffset(BUILDING_CONFIG[this.buildingId].popupBobOffset));
        this.transform.add(this.labelAnchor);
        const labelAnchorWorldPosition = new THREE.Vector3();

        // ZONE_LABEL_ANCHOR_OPTIONS hides/shrinks the panel by distance from the player — see
        // that file's own doc. avoidViewer (only for 'simple' — see PopupConfig.ts's own doc)
        // slides the panel aside instead of letting it land on the player, who's typically
        // standing right on this zone's own base once they're close enough to interact.
        this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            this.labelFrame,
            () => this.labelAnchor.getWorldPosition(labelAnchorWorldPosition),
            { ...ZONE_LABEL_ANCHOR_OPTIONS, ...resolvePopupAvoidViewer(BUILDING_CONFIG[this.buildingId].popupMode) },
        ));

        BuildingStorage.onProgressChanged.add(this.handleProgressChanged);
        BuildingStorage.onLevelUp.add(this.handleLevelUp);

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

    public override destroy(): void {
        BuildingStorage.onProgressChanged.remove(this.handleProgressChanged);
        BuildingStorage.onLevelUp.remove(this.handleLevelUp);
        this.disposeBuildingMesh();
        super.destroy();
    }

    /**
     * Builds this level's visible structure and parents it under this.transform, replacing
     * whatever createBuildingMesh() built last (see disposeBuildingMesh()). `dropIn` plays the
     * "drops from above, bounces to rest" beat used on a level-up (see replaceBuildingMesh());
     * pass false for the zone's very first mesh, where there's no prior state to animate FROM.
     * Prefers this level's EntityViewRegistry `view` id (a real glb — see BuildingLevelConfig.
     * view's own doc) when one resolves to an actual model; falls back to the level's own box
     * placeholder (`mesh`) otherwise, unchanged from before `view` existed.
     */
    private createBuildingMesh(level: number, dropIn: boolean): void {
        const resolved = resolveEntityView(getViewIdForLevel(this.buildingId, level));
        if (resolved) {
            this.createBuildingView(resolved, dropIn);
        } else {
            this.createBuildingBox(getMeshConfigForLevel(this.buildingId, level), dropIn);
        }
    }

    private createBuildingBox(config: ReturnType<typeof getMeshConfigForLevel>, dropIn: boolean): void {
        const material = new THREE.MeshStandardMaterial({ color: config.color });
        BendService.applyBend(material);

        const [configWidth, height, configDepth] = config.size;
        const width = this.footprint?.width ?? configWidth;
        const depth = this.footprint?.depth ?? configDepth;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
        const restY = height / 2;
        mesh.position.set(0, dropIn ? restY + MESH_DROP_START_HEIGHT : restY, 0);
        this.transform.add(mesh);
        this.buildingMesh = mesh;

        if (dropIn) {
            gsap.to(mesh.position, { y: restY, duration: MESH_DROP_DURATION_SEC, ease: 'bounce.out' });
        }
    }

    private createBuildingView(resolved: NonNullable<ReturnType<typeof resolveEntityView>>, dropIn: boolean): void {
        const [offsetX, offsetY, offsetZ] = resolved.offset;
        const startY = dropIn ? offsetY + MESH_DROP_START_HEIGHT : offsetY;

        const visual = new GlbVisualComponent(
            resolved.model,
            new THREE.Vector3(offsetX, startY, offsetZ),
            resolved.scale,
            THREE.MathUtils.degToRad(resolved.rotationDeg),
            () => {
                if (dropIn) {
                    gsap.to(visual.mesh.position, { y: offsetY, duration: MESH_DROP_DURATION_SEC, ease: 'bounce.out' });
                }
            },
        );
        this.buildingVisual = this.addComponent(visual);
    }

    private disposeBuildingMesh(): void {
        if (this.buildingMesh) {
            gsap.killTweensOf(this.buildingMesh.position);
            this.buildingMesh.geometry.dispose();
            (this.buildingMesh.material as THREE.Material).dispose();
            this.buildingMesh.removeFromParent();
            this.buildingMesh = undefined;
        }

        if (this.buildingVisual) {
            if (this.buildingVisual.isReady) {
                gsap.killTweensOf(this.buildingVisual.mesh.position);
            }
            this.buildingVisual.destroy();
            this.buildingVisual = undefined;
        }
    }

    /** The "remove one, drop-bounce the upgraded version" visual beat — tears down the just-superseded level's mesh and drops the new one in from above. Called as soon as a level clears (see playLevelUpSequence()), so by the time the camera actually arrives (if focusing at all), the building's typically already mid-bounce or freshly landed. */
    private replaceBuildingMesh(level: number): void {
        this.disposeBuildingMesh();
        this.createBuildingMesh(level, true);
    }

    /** Rewrites the panel's title/requirement slots from BuildingStorage's current state and re-fits the frame around the new bounds. `popupMode: 'none'` (see PopupConfig.ts's own doc) skips all of this and keeps the panel permanently hidden; `'simple'` keeps the requirement slots but drops the title line. */
    private refreshLabel(): void {
        const config = BUILDING_CONFIG[this.buildingId];

        if (config.popupMode === 'none') {
            this.titleText.visible = false;
            this.labelFrame.visible = false;
            this.labelFrame.fit();
            return;
        }

        const level = BuildingStorage.getLevel(this.buildingId);
        const showTitle = config.popupMode !== 'simple';
        this.titleText.visible = showTitle;
        this.titleText.text = showTitle ? `${config.name} Lv.${level}` : '';

        this.requirementsContainer.removeChildren().forEach(child => child.destroy({ children: true }));

        let requirementsHeight: number;
        if (BuildingStorage.isMaxLevel(this.buildingId)) {
            const maxLevelText = new PIXI.Text('MAX LEVEL', TextStyleRegistry.Body);
            maxLevelText.anchor.set(0.5, 1);
            this.requirementsContainer.addChild(maxLevelText);
            requirementsHeight = maxLevelText.height;
        } else {
            const next = BuildingStorage.getNextLevelConfig(this.buildingId)!;
            const entries = Object.entries(next.requirements) as [ResourceType, number][];

            const slots = entries.map(([type, need]) => {
                const have = BuildingStorage.getProgress(this.buildingId, type);
                return createResourceSlot(type, REQ_SLOT_SIZE, `${have}/${need}`);
            });
            // All slots share the same size/font, so their visualHeight (slot + label below
            // it) is identical in practice — max() just guards against a future label style
            // that could vary per-entry.
            requirementsHeight = Math.max(REQ_SLOT_SIZE, ...slots.map(slot => slot.visualHeight));

            // One horizontal row, centered — same slot visual as BackpackUI (see
            // ResourceSlotVisual.ts) — with its bottom edge (below each slot's label) landing
            // exactly at y=0 (see this file's own doc).
            const rowWidth = entries.length * REQ_SLOT_SIZE + Math.max(0, entries.length - 1) * REQ_SLOT_GAP;
            slots.forEach((slot, index) => {
                slot.container.position.set(-rowWidth / 2 + index * (REQ_SLOT_SIZE + REQ_SLOT_GAP), -requirementsHeight);
                this.requirementsContainer.addChild(slot.container);
            });
        }

        this.titleText.position.set(0, -(requirementsHeight + TITLE_SLOTS_GAP));
        this.labelFrame.fit();
    }

    private tryDeposit(other: RigidBody): void {
        const player = other.entity;
        if (!(player instanceof MainPlayer) || BuildingStorage.isMaxLevel(this.buildingId) || this.awaitingReentry) {
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
            const burstOrigin = this.transform.position.clone().add(CAMERA_FOCUS_HEIGHT_OFFSET);
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

        const basePosition = this.transform.position.clone().add(POPUP_HEIGHT_OFFSET);
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
