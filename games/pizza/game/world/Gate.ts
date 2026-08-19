// Gate.ts
//
// A solid, non-trigger box obstacle (see RigidBody's `isStatic`/no
// `isTrigger`, same shape as PizzaScene's TEST_BOX) that physically blocks
// the player from progressing further into the world until some game
// milestone happens — a building reaching a required level, or the player
// crafting a particular item (see GateTypes.ts's GateRequirement union).
// Carries a PERSISTENT "Locked" nameplate — "{gate name}" / "Required:
// {building} Lv.N" or "Required: Craft {item}" — the same
// ScreenAnchorComponent + distance-cull/scale treatment BuildingZone's panel
// uses, visible for as long as the gate itself stands.
//
// Deliberately does NOT listen to BuildingStorage.onLevelUp/ItemStorage.
// onChange itself — GateManager is the one thing that decides WHEN to check
// a gate's requirement (right after the triggering milestone's own
// event/camera sequence has fully resolved — see WorldProgressionHost.ts's
// own doc for why), so a gate unlocking and the milestone that triggered it
// never fight over the camera at the same time. isRequirementMet() is
// exposed for GateManager (and PizzaScene's startup catch-up check) to call
// explicitly instead.
//
// playUnlockSequence() is the entire "camera visits the gate, it collapses,
// camera returns" beat. GateManager awaits it, then removes this entity
// from the world entirely via World.remove() — which is what "remove the
// collider" means in practice: RigidBody self-unregisters from physics in
// its own destroy() (see that file's own doc), so the whole gate, collider
// included, is simply gone.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { BendService } from '../services/BendService';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import { BuildingStorage } from '../data/BuildingStorage';
import { BUILDING_CONFIG, BuildingId } from '../data/BuildingTypes';
import { GateConfig, GateId } from '../data/GateTypes';
import { GateStorage } from '../data/GateStorage';
import { CameraFocusHost } from '../camera/CameraFocusHost';
import { ItemStorage } from '../crafting/ItemStorage';
import { ItemType, ITEM_CONFIG } from '../crafting/ItemTypes';

const LABEL_FRAME_PADDING = uniformFitPadding(10);
/** Gap between the requirement line and the title sitting above it — see buildLabel(). */
const TITLE_REQUIREMENT_GAP = 4;
/** Extra clearance above the mesh's own top before the nameplate sits — keeps it from touching the gate's roofline. */
const LABEL_CLEARANCE_ABOVE_MESH = 1.2;

const COLLAPSE_DURATION_SEC = 0.7;
/** Camera holds on the gate a beat longer than the collapse animation itself takes, so the player sees it finish landing before the camera starts easing away. */
const CAMERA_FOCUS_HOLD_SEC = COLLAPSE_DURATION_SEC + 0.6;

export default class Gate extends Entity {
    private readonly screenHost: ScreenAnchorHost;
    private readonly gateId: GateId;
    private readonly config: GateConfig;

    private mesh?: THREE.Mesh;

    public constructor(screenHost: ScreenAnchorHost, gateId: GateId, config: GateConfig) {
        super();
        this.screenHost = screenHost;
        this.gateId = gateId;
        this.config = config;
        this.transform.position.set(...config.position);
    }

    /** Whether this gate's requirement is tied to `buildingId` at all — GateManager uses this to skip gates unrelated to whichever building just leveled up, before bothering to call isRequirementMet(). False for an item-requirement gate. */
    public requiresBuilding(buildingId: BuildingId): boolean {
        return this.config.requirement.type === 'building' && this.config.requirement.buildingId === buildingId;
    }

    /** Whether this gate's requirement is tied to `item` at all — GateManager uses this to skip gates unrelated to whichever item just got crafted, before bothering to call isRequirementMet(). False for a building-requirement gate. */
    public requiresItem(item: ItemType): boolean {
        return this.config.requirement.type === 'item' && this.config.requirement.item === item;
    }

    /** True once whichever storage backs this gate's requirement kind (see GateTypes.ts's own doc) says it's already satisfied. */
    public isRequirementMet(): boolean {
        const requirement = this.config.requirement;
        return requirement.type === 'building'
            ? BuildingStorage.getLevel(requirement.buildingId) >= requirement.level
            : ItemStorage.hasCount(requirement.item, 1);
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

        const material = new THREE.MeshStandardMaterial({ color: this.config.mesh.color });
        BendService.applyBend(material);
        this.mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
        this.mesh.position.set(0, halfExtents.y, 0);
        this.transform.add(this.mesh);

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

    /** Static content — unlike BuildingZone's panel, a gate's requirement never changes while it's still standing, so this is built once in awake() and never refreshed. */
    private buildLabel(): PIXI.Container {
        const req = this.config.requirement;
        const requirementText = req.type === 'building'
            ? `Required: ${BUILDING_CONFIG[req.buildingId].name} Lv.${req.level}`
            : `Required: Craft ${ITEM_CONFIG[req.item].label}`;

        const requirement = new PIXI.Text(requirementText, TextStyleRegistry.Body);
        requirement.anchor.set(0.5, 1);

        const title = new PIXI.Text(this.config.name, TextStyleRegistry.ZoneTitle);
        title.anchor.set(0.5, 1);
        title.position.set(0, -(requirement.height + TITLE_REQUIREMENT_GAP));

        const column = new PIXI.Container();
        column.addChild(title, requirement);
        return new AutoFitFrame(LABEL_FRAME_PADDING, 'Popup', column);
    }

    /**
     * The whole unlock EVENT: persists the unlock, sends the camera to visit this gate and
     * hold, collapses the gate's mesh, and eases the camera back — all run concurrently (the
     * collapse plays WHILE the camera travels/holds, same "don't force a strictly sequential
     * travel-then-act-then-return" reasoning as BuildingZone's mesh swap starting immediately
     * on level-up) and this resolves once BOTH are done. GateManager awaits this before
     * removing the entity entirely — see this file's own doc.
     */
    public async playUnlockSequence(cameraFocusHost: CameraFocusHost): Promise<void> {
        GateStorage.unlock(this.gateId);

        const focusTarget = this.transform.position.clone().add(new THREE.Vector3(0, this.config.mesh.size[1] / 2, 0));
        await Promise.all([
            cameraFocusHost.focusCameraOn(focusTarget, { holdSec: CAMERA_FOCUS_HOLD_SEC }),
            this.collapseMesh(),
        ]);
    }

    private collapseMesh(): Promise<void> {
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
}
