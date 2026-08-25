// Gate.ts
//
// A solid, non-trigger box obstacle (see RigidBody's `isStatic`/no
// `isTrigger`, same shape as PizzaScene's TEST_BOX) that physically blocks
// the player from progressing further into the world until some game
// milestone happens — a building reaching a required level, the player
// owning a particular item, or holding enough of a resource (see
// MilestoneRequirement.ts's own union, aliased as GateTypes.ts's
// GateRequirement). Carries a PERSISTENT icon-only panel — a locked padlock
// beside the requirement's own icon (item/resource/building), with an
// exclamation badge on the requirement icon while it's still missing (see
// buildLabel()) — the same ScreenAnchorComponent + distance-cull/scale
// treatment BuildingZone's panel uses, visible for as long as the gate
// itself stands.
//
// Deliberately does NOT listen to BuildingStorage.onLevelUp/ItemStorage.
// onChange itself — RequirementRegistry (registered as an unlock gate, see
// PizzaScene.setupGates()) is the one thing that decides WHEN to check a
// gate's requirement (right after the triggering milestone's own event/
// camera sequence has fully resolved — see WorldProgressionHost.ts's own
// doc for why), so a gate unlocking and the milestone that triggered it
// never fight over the camera at the same time. isRequirementMet() is
// exposed for RequirementRegistry (and PizzaScene's startup catch-up check)
// to call explicitly instead.
//
// playUnlockSequence() is the entire "camera visits the gate, it collapses,
// camera returns" beat. Whatever's awaiting it (PizzaScene.setupGates()'s
// own unlock-gate callback) removes this entity from the world entirely
// via World.remove() right after — which is what "remove the collider"
// means in practice: RigidBody self-unregisters from physics in its own
// destroy() (see that file's own doc), so the whole gate, collider
// included, is simply gone.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { BendService } from '../services/BendService';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import { getBuildingIcon } from '../data/BuildingTypes';
import { GateConfig, GateId, GateRequirement } from '../data/GateTypes';
import { GateStorage } from '../data/GateStorage';
import { isMilestoneRequirementMet } from '../data/MilestoneRequirement';
import GlbVisualComponent from '../components/GlbVisualComponent';
import { resolveEntityView } from './EntityViewRegistry';
import { CameraFocusHost } from '../camera/CameraFocusHost';
import { getItemIcon } from '../crafting/ItemTypes';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { getAssetIcon } from './AssetLibraryRegistry';
import { wait } from '../utils/GsapUtils';
import ViewUtils from 'core/utils/ViewUtils';

const LABEL_FRAME_PADDING = uniformFitPadding(18);
/** Extra clearance above the mesh's own top before the icon panel sits — keeps it from touching the gate's roofline. */
const LABEL_CLEARANCE_ABOVE_MESH = 1.2;

const LOCK_ICON_SIZE = 40;
const REQUIREMENT_ICON_SIZE = 40;
/** Gap between the lock icon and the requirement icon sitting beside it. */
const ICON_GAP = 10;
/** Size of the exclamation/check badge overlapping the requirement icon's bottom-right corner. */
const REQUIREMENT_BADGE_SIZE = 20;
const REQUIREMENT_BADGE_INSET = 2;

/** Locked padlock — see buildLabel(). */
const LOCK_ICON_LOCKED = 'Icon_Lock03';
/** Swapped in once the gate actually unlocks — see playUnlockIconSequence(). */
const LOCK_ICON_UNLOCKED = 'Icon_Lock02';
/** Badge shown on the requirement icon while the player doesn't have it yet. */
const REQUIREMENT_BADGE_MISSING = 'Icon_Exclamation';
/** Swapped in once the gate actually unlocks — see playUnlockIconSequence(). */
const REQUIREMENT_BADGE_MET = 'Icon_Check03_s';

const COLLAPSE_DURATION_SEC = 0.7;
/** Camera holds on the gate a beat longer than the collapse animation itself takes, so the player sees it finish landing before the camera starts easing away. */
const CAMERA_FOCUS_HOLD_SEC = COLLAPSE_DURATION_SEC + 0.6;
/** Beat between the milestone actually completing and the camera/collapse/icon sequence starting — the player is already frozen (see CameraFocusHost.focusCameraOn()'s own doc on `preDelaySec`) but nothing visibly happens yet, so the moment reads as "something just landed" before the camera cuts away to show what. */
const GATE_UNLOCK_PRE_DELAY_SEC = 1;
/** How long the camera takes traveling to the gate — passed explicitly to focusCameraOn() (rather than left at its own default) so playUnlockIconSequence() can wait out the SAME span before swapping textures; the panel is screen-anchored and shrinks/moves with the camera while it's still panning, which made the lock/badge swap easy to miss mid-travel. */
const GATE_CAMERA_TRAVEL_SEC = 0.8;
/** How much the lock icon pops up before settling back down when the gate unlocks — see playUnlockIconSequence(). */
const LOCK_POP_SCALE = 1.4;
const LOCK_POP_DURATION_SEC = 0.15;
const LOCK_SETTLE_DURATION_SEC = 0.3;
/** How long the "unlocked" icon panel stays up, fully swapped over, before fading — see this file's own doc/playUnlockSequence(). */
const REQUIREMENT_MET_HOLD_SEC = 2;
const LABEL_FADE_DURATION_SEC = 0.3;

/** The icon shown for whatever this gate is actually waiting on — an item to be crafted, a resource amount, or the target building's own icon (see BuildingConfig.icon's own doc — a level requirement also gets a small "LvN" text badge, since a bare building icon can't say WHICH level; see buildLabel()). */
function resolveRequirementIcon(requirement: GateRequirement): PIXI.Texture {
    switch (requirement.type) {
        case 'item':
            return getItemIcon(requirement.item);
        case 'resource':
            return getAssetIcon(resolveResourceAssetKey(requirement.resourceType));
        case 'building':
            return getBuildingIcon(requirement.buildingId);
    }
}

export default class Gate extends Entity {
    private readonly screenHost: ScreenAnchorHost;
    private readonly gateId: GateId;
    private readonly config: GateConfig;

    /** The gate's own visible structure — a plain box, OR (see awake()) whatever real glb this.config.view resolves to; either way gsap-scaled to zero by collapseMesh() on unlock, so this stays typed as the common THREE.Object3D rather than THREE.Mesh specifically. */
    private mesh?: THREE.Object3D;

    /** The icon panel's own root — faded out wholesale at the end of playUnlockIconSequence(). */
    private labelFrame!: AutoFitFrame;
    private lockIcon!: PIXI.Sprite;
    /** Overlaps the requirement icon's corner — Icon_Exclamation while missing, swapped to Icon_Check03_s on unlock (see playUnlockIconSequence()). */
    private requirementBadge!: PIXI.Sprite;

    public constructor(screenHost: ScreenAnchorHost, gateId: GateId, config: GateConfig) {
        super();
        this.screenHost = screenHost;
        this.gateId = gateId;
        this.config = config;
        this.transform.position.set(...config.position);
    }

    /** True once whichever storage backs this gate's requirement kind (see MilestoneRequirement.ts's own doc) says it's already satisfied. */
    public isRequirementMet(): boolean {
        return isMilestoneRequirementMet(this.config.requirement);
    }

    public override awake(): void {
        const [width, height, depth] = this.config.mesh.size;
        const halfExtents = new THREE.Vector3(width / 2, height / 2, depth / 2);

        this.addComponent(new RigidBody({
            halfExtents,
            isStatic: true,
            layer: Layers.Environment,
            centerOffset: new THREE.Vector3(0, halfExtents.y, 0),
        }));

        const resolved = resolveEntityView(this.config.view);
        if (resolved) {
            const [offsetX, offsetY, offsetZ] = resolved.offset;
            const visual = new GlbVisualComponent(
                resolved.model,
                new THREE.Vector3(offsetX, offsetY, offsetZ),
                resolved.scale,
                THREE.MathUtils.degToRad(resolved.rotationDeg),
                () => { this.mesh = visual.mesh; },
            );
            this.addComponent(visual);
        } else {
            const material = new THREE.MeshStandardMaterial({ color: this.config.mesh.color });
            BendService.applyBend(material);
            this.mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
            this.mesh.position.set(0, halfExtents.y, 0);
            this.transform.add(this.mesh);
        }

        const labelAnchor = new THREE.Object3D();
        labelAnchor.position.set(0, height + LABEL_CLEARANCE_ABOVE_MESH, 0);
        this.transform.add(labelAnchor);
        const labelAnchorWorldPosition = new THREE.Vector3();

        this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            this.buildLabel(),
            () => labelAnchor.getWorldPosition(labelAnchorWorldPosition),
            ZONE_LABEL_ANCHOR_OPTIONS,
        ));
    }

    /**
     * Icon-only panel — a locked padlock beside the requirement's own icon (item/resource/
     * building), with an exclamation badge overlapping the requirement icon's corner while
     * it's still missing. The ONE exception to "no text": a 'building' requirement also gets a
     * small "LvN" label on the icon's opposite corner, since the building's own icon alone
     * can't say WHICH level is required. Static content built once in awake();
     * playUnlockIconSequence() mutates lockIcon/requirementBadge's textures in place once the
     * gate actually unlocks.
     */
    private buildLabel(): AutoFitFrame {
        const row = new PIXI.Container();

        this.lockIcon = new PIXI.Sprite(PIXI.Texture.from(LOCK_ICON_LOCKED));
        this.lockIcon.anchor.set(0.5, 1);
        this.lockIcon.scale.set(ViewUtils.elementScaler(this.lockIcon, LOCK_ICON_SIZE));
        this.lockIcon.position.set(-(REQUIREMENT_ICON_SIZE / 2 + ICON_GAP / 2), 0);
        row.addChild(this.lockIcon);

        const requirementIconX = LOCK_ICON_SIZE / 2 + ICON_GAP / 2;
        const requirementIcon = new PIXI.Sprite(resolveRequirementIcon(this.config.requirement));
        requirementIcon.anchor.set(0.5, 1);
        requirementIcon.scale.set(ViewUtils.elementScaler(requirementIcon, REQUIREMENT_ICON_SIZE));
        requirementIcon.position.set(requirementIconX, 0);
        row.addChild(requirementIcon);

        this.requirementBadge = new PIXI.Sprite(PIXI.Texture.from(REQUIREMENT_BADGE_MISSING));
        this.requirementBadge.anchor.set(1, 1);
        this.requirementBadge.scale.set(ViewUtils.elementScaler(this.requirementBadge, REQUIREMENT_BADGE_SIZE));
        this.requirementBadge.position.set(requirementIconX + REQUIREMENT_ICON_SIZE / 2 - REQUIREMENT_BADGE_INSET, -REQUIREMENT_BADGE_INSET);
        row.addChild(this.requirementBadge);

        if (this.config.requirement.type === 'building') {
            const levelLabel = new PIXI.Text(`Lv${this.config.requirement.level}`, TextStyleRegistry.Body);
            levelLabel.anchor.set(0, 1);
            levelLabel.position.set(requirementIconX - REQUIREMENT_ICON_SIZE / 2 + REQUIREMENT_BADGE_INSET, -REQUIREMENT_BADGE_INSET);
            row.addChild(levelLabel);
        }

        this.labelFrame = new AutoFitFrame(LABEL_FRAME_PADDING, this.config.frame ?? 'GateLock', row);
        return this.labelFrame;
    }

    /**
     * The whole unlock EVENT: persists the unlock, sends the camera to visit this gate and
     * hold, collapses the gate's mesh, eases the camera back, AND pops/swaps the icon panel
     * over to its unlocked look before fading it out — all run concurrently and this resolves
     * once ALL of them are done. The icon sequence (pop, swap, hold REQUIREMENT_MET_HOLD_SEC,
     * fade) is typically the longest leg, so in practice this is what paces the gate's actual
     * removal — GateManager awaits this before removing the entity entirely (see this file's
     * own doc), which is exactly why the icon panel fading out reads as "the gate is now open."
     */
    public async playUnlockSequence(cameraFocusHost: CameraFocusHost): Promise<void> {
        GateStorage.unlock(this.gateId);

        const focusTarget = this.transform.position.clone().add(new THREE.Vector3(0, this.config.mesh.size[1] / 2, 0));
        await Promise.all([
            cameraFocusHost.focusCameraOn(focusTarget, { holdSec: CAMERA_FOCUS_HOLD_SEC, preDelaySec: GATE_UNLOCK_PRE_DELAY_SEC, travelSec: GATE_CAMERA_TRAVEL_SEC }),
            this.collapseMesh(),
            this.playUnlockIconSequence(),
        ]);
    }

    /** Waits out GATE_UNLOCK_PRE_DELAY_SEC (see that constant's own doc — kept in step with focusCameraOn()'s own `preDelaySec` so the gate doesn't visibly collapse before the camera's even looking at it) before actually playing the collapse. */
    private async collapseMesh(): Promise<void> {
        await wait(GATE_UNLOCK_PRE_DELAY_SEC);

        return new Promise(resolve => {
            if (!this.mesh) {
                resolve();
                return;
            }

            gsap.to(this.mesh.scale, {
                x: 0,
                y: 0,
                z: 0,
                duration: COLLAPSE_DURATION_SEC,
                ease: 'back.in(1.7)',
                onComplete: resolve,
            });
        });
    }

    /**
     * Waits out GATE_UNLOCK_PRE_DELAY_SEC PLUS GATE_CAMERA_TRAVEL_SEC — not just the pre-delay
     * like collapseMesh() — so the pop/swap only starts once the camera has actually ARRIVED
     * and is holding on the gate, rather than partway through its travel (see
     * GATE_CAMERA_TRAVEL_SEC's own doc: mid-pan is exactly when this screen-anchored panel is
     * hardest to read). Then pop-scales the lock icon, swaps it (and the requirement badge)
     * over to their unlocked textures — re-fitting each via ViewUtils.elementScaler() against
     * its OWN texture, so a differently-proportioned unlocked icon still lands at the right
     * size instead of inheriting the locked icon's fit — holds for REQUIREMENT_MET_HOLD_SEC so
     * the player actually sees the change, then fades the whole icon panel out.
     */
    private async playUnlockIconSequence(): Promise<void> {
        await wait(GATE_UNLOCK_PRE_DELAY_SEC + GATE_CAMERA_TRAVEL_SEC);

        const poppedScale = ViewUtils.elementScaler(this.lockIcon, LOCK_ICON_SIZE) * LOCK_POP_SCALE;
        await new Promise<void>(resolve => {
            gsap.to(this.lockIcon.scale, { x: poppedScale, y: poppedScale, duration: LOCK_POP_DURATION_SEC, ease: 'power2.out', onComplete: resolve });
        });

        this.lockIcon.texture = PIXI.Texture.from(LOCK_ICON_UNLOCKED);
        this.requirementBadge.texture = PIXI.Texture.from(REQUIREMENT_BADGE_MET);
        this.requirementBadge.scale.set(ViewUtils.elementScaler(this.requirementBadge, REQUIREMENT_BADGE_SIZE));
        const settledScale = ViewUtils.elementScaler(this.lockIcon, LOCK_ICON_SIZE);

        await new Promise<void>(resolve => {
            gsap.to(this.lockIcon.scale, { x: settledScale, y: settledScale, duration: LOCK_SETTLE_DURATION_SEC, ease: 'back.out(2)', onComplete: resolve });
        });

        await wait(REQUIREMENT_MET_HOLD_SEC);

        await new Promise<void>(resolve => {
            gsap.to(this.labelFrame, { alpha: 0, duration: LABEL_FADE_DURATION_SEC, onComplete: resolve });
        });
    }
}
