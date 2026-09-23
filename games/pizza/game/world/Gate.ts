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
import AutoFitFrame from '../ui/AutoFitFrame';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import {
    buildLockRequirementPanel, LockRequirementPanel,
    LOCK_ICON_SIZE, LOCK_ICON_UNLOCKED, REQUIREMENT_BADGE_MET, REQUIREMENT_BADGE_SIZE,
} from '../ui/LockRequirementPanel';
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
import { ParticleSystem } from '../vfx/ParticleSystem';
import ParticleEmitterComponent from '../components/ParticleEmitterComponent';

/** Extra clearance above the mesh's own top before the icon panel sits — keeps it from touching the gate's roofline. */
const LABEL_CLEARANCE_ABOVE_MESH = 1.2;

const COLLAPSE_DURATION_SEC = 0.7;
/** Fallback for GateConfig.destroyParticleCount when a gate sets destroyParticleEffectId but not its own count. */
const DEFAULT_DESTROY_PARTICLE_COUNT = 24;
/** Spawn rate for GateConfig.particleEffectId's ambient emitter, when set — same rate CraftZone's own ambient emitter uses. */
const GATE_PARTICLE_SPAWN_RATE_PER_SEC = 4;
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

    /** The shared lock/requirement panel (see LockRequirementPanel.ts) — its frame is faded out wholesale at the end of playUnlockIconSequence(), and its lockIcon/badge swapped to their unlocked textures just before. */
    private panel!: LockRequirementPanel;
    private get labelFrame(): AutoFitFrame { return this.panel.frame; }
    private get lockIcon(): PIXI.Sprite { return this.panel.lockIcon; }
    private get requirementBadge(): PIXI.Sprite { return this.panel.badge; }

    private readonly handleDepositChanged = (id: GateId): void => {
        if (id === this.gateId) {
            this.refreshDepositProgressLabel();
        }
    };

    public constructor(screenHost: ScreenAnchorHost, gateId: GateId, config: GateConfig) {
        super();
        this.screenHost = screenHost;
        this.gateId = gateId;
        this.config = config;
        this.transform.position.set(...config.position);
    }

    /**
     * True once whichever storage backs this gate's requirement kind says it's already
     * satisfied. A 'resource' requirement is the ONE exception to isMilestoneRequirementMet()
     * (see that function's own doc) — it checks GateStorage's own DEPOSIT progress instead of
     * BackpackStorage's live count, since a resource-gated gate has to be actually fed via a
     * GateDropZone (see PizzaScene.setupGates()'s own doc), not opened just because the player
     * happens to be carrying enough right now.
     */
    public isRequirementMet(): boolean {
        if (this.config.requirement.type === 'resource') {
            return GateStorage.getDepositProgress(this.gateId) >= this.config.requirement.amount;
        }
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
            // Horizontal-only obstacle, same reasoning as SolidArea.ts's own blocksVertical —
            // a gate taller than the player must never be treated as something to stand on top
            // of or fall through.
            blocksVertical: false,
        }));

        const resolved = resolveEntityView(this.config.view);
        if (resolved) {
            const [offsetX, offsetY, offsetZ] = resolved.offset;
            // viewRotationOffsetDeg/viewScaleMultiplier — see GateConfig's own doc on each:
            // lets more than one gate share the exact same EntityViewRegistry entry (the same
            // model) while each still faces/sizes correctly for its own spot on the map.
            const rotationDeg = resolved.rotationDeg + (this.config.viewRotationOffsetDeg ?? 0);
            const scale = resolved.scale * (this.config.viewScaleMultiplier ?? 1);
            const visual = new GlbVisualComponent(
                resolved.model,
                new THREE.Vector3(offsetX, offsetY, offsetZ),
                scale,
                THREE.MathUtils.degToRad(rotationDeg),
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

        if (this.config.particleEffectId) {
            this.addComponent(new ParticleEmitterComponent(
                this.config.particleEffectId,
                GATE_PARTICLE_SPAWN_RATE_PER_SEC,
                new THREE.Vector3(0, halfExtents.y, 0),
            ));
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

        if (this.config.requirement.type === 'resource') {
            GateStorage.onDepositChanged.add(this.handleDepositChanged);
        }
    }

    public override destroy(): void {
        GateStorage.onDepositChanged.remove(this.handleDepositChanged);
        super.destroy();
    }

    /** Keeps depositProgressLabel current as GateDropZone drains the backpack — see that field's own doc. No-ops for anything but a 'resource' requirement (the label doesn't exist at all otherwise). */
    private refreshDepositProgressLabel(): void {
        if (this.config.requirement.type !== 'resource') {
            return;
        }

        const have = Math.min(GateStorage.getDepositProgress(this.gateId), this.config.requirement.amount);
        this.panel.setCornerText(`${have}/${this.config.requirement.amount}`);
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
        // The one exception to "no text" — a bare building icon can't say WHICH level is
        // required, and a bare resource icon can't say HOW MUCH is still needed (that one
        // changes live as a GateDropZone drains the backpack — kept current via
        // GateStorage.onDepositChanged, see awake()/refreshDepositProgressLabel()).
        const requirement = this.config.requirement;
        let cornerText: string | undefined;
        if (requirement.type === 'building') {
            cornerText = `Lv${requirement.level}`;
        } else if (requirement.type === 'resource') {
            const have = Math.min(GateStorage.getDepositProgress(this.gateId), requirement.amount);
            cornerText = `${have}/${requirement.amount}`;
        }

        this.panel = buildLockRequirementPanel(resolveRequirementIcon(requirement), {
            cornerText,
            frame: this.config.frame ?? 'GateLock',
        });
        return this.panel.frame;
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

        // Look-at point sits at the gate's own mid-height PLUS the configurable
        // cameraFocusHeightOffset (see GateConfig's own doc) — raising the look-at point in
        // world space is what pushes the gate itself lower on screen, since the camera keeps
        // whatever it's looking at centered.
        const focusTarget = this.transform.position.clone().add(new THREE.Vector3(0, this.config.mesh.size[1] / 2 + (this.config.cameraFocusHeightOffset ?? 0), 0));
        await Promise.all([
            cameraFocusHost.focusCameraOn(focusTarget, { holdSec: CAMERA_FOCUS_HOLD_SEC, preDelaySec: GATE_UNLOCK_PRE_DELAY_SEC, travelSec: GATE_CAMERA_TRAVEL_SEC }),
            this.collapseMesh(),
            this.playUnlockIconSequence(),
        ]);
    }

    /** Waits out GATE_UNLOCK_PRE_DELAY_SEC (see that constant's own doc — kept in step with focusCameraOn()'s own `preDelaySec` so the gate doesn't visibly collapse before the camera's even looking at it) before actually playing the collapse. Fires destroyParticleEffectId (if set) the instant the collapse finishes — deliberately here, not in Entity.destroy(), since GateManager doesn't actually remove this entity from the world until the WHOLE unlock sequence (camera return, icon fade) is done, several seconds after the mesh itself visibly vanishes; a burst tied to that later moment would land on an already-empty spot. */
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
                onComplete: () => {
                    if (this.config.destroyParticleEffectId) {
                        const burstOrigin = this.transform.position.clone().add(new THREE.Vector3(0, this.config.mesh.size[1] / 2, 0));
                        ParticleSystem.burst(this.config.destroyParticleEffectId, burstOrigin, this.config.destroyParticleCount ?? DEFAULT_DESTROY_PARTICLE_COUNT);
                    }
                    resolve();
                },
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
