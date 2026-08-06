// ResourceNode.ts
//
// A gatherable resource — a tree (real glb prop, see MODELS.Tree) or a
// stone (cube placeholder until real art exists), see ResourceTypes.ts for
// the actual per-type numbers/color. Same "dedicated Entity subclass
// self-configures in awake()" pattern as
// MainPlayer: `world.add(new ResourceNode(ResourceType.Tree, position))` is
// the entire setup — trigger RigidBody (Layers.Resource — see
// AutoGatherController, which listens for it) sized as the gather radius,
// plus the placeholder visual.
//
// Implements ActionTarget (see PlayerActionController): the node holds
// `life` and applyHit() chips it down one swing at a time. It does NOT run
// the action/timer itself — that's PlayerActionController's job. When life
// runs out, applyHit() deplete()s: hides the visual and pulls the RigidBody
// out of PhysicsWorld entirely (not just Component.enabled — PhysicsWorld's
// registered-bodies list doesn't check that flag, see RigidBody.ts) so the
// node genuinely stops being gatherable until respawn() puts it back.
//
// Damage persists across cancelled actions — see the `life` field's doc.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import BoxVisualComponent from '../components/BoxVisualComponent';
import GlbVisualComponent from '../components/GlbVisualComponent';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import { ActionTarget } from '../components/PlayerActionController';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import { RESOURCE_ASSET_KEYS } from '../actions/ResourceRegistry';
import { ASSET_LIBRARY, pickRandom, resolveRange } from '../world/AssetLibraryRegistry';

/** Gather-radius trigger half-extents — bigger than the visual mesh itself, so the player doesn't have to walk INTO the trunk/rock to trigger gathering. */
const TRIGGER_HALF_EXTENTS = new THREE.Vector3(1, 1, 1);

const STONE_HALF_EXTENTS = new THREE.Vector3(0.6, 0.5, 0.6);

/** Where the damage popup starts, relative to the node's own position — roughly trunk/rock height. */
const DAMAGE_POPUP_BASE_OFFSET = new THREE.Vector3(0, 2, 0);
/** World units the popup rises over its lifetime — see showDamagePopup(). */
const DAMAGE_POPUP_RISE = 1.2;
const DAMAGE_POPUP_TTL_SEC = 0.9;

export default class ResourceNode extends Entity implements ActionTarget {
    public readonly resourceType: ResourceType;

    private rigidBody!: RigidBody;
    private visual!: BoxVisualComponent | GlbVisualComponent;
    /** Set while depleted; ticked in update() — see deplete()/respawn(). undefined means "available." */
    private respawnRemainingSec?: number;
    /** Remaining hit-points (see ResourceConfig.maxLife). Deliberately NOT reset when an action is cancelled — walking away mid-chop leaves the tree exactly as damaged as it was, and coming back resumes from here. Only a full harvest + respawn restores it (see respawn()). */
    private life: number;
    /** Undefined only in contexts that never call onHit() (e.g. headless tests) — see showDamagePopup(), which no-ops without it. */
    private readonly screenHost?: ScreenAnchorHost;

    /**
     * initialLife/initialRespawnRemainingSec let WorldManager re-materialize a node in
     * whatever state it was last in when it went out of range (mid-damage, or still
     * respawning) instead of always popping back in full-life — see WorldManager.ts.
     */
    public constructor(
        resourceType: ResourceType,
        position: THREE.Vector3,
        initialLife: number = RESOURCE_CONFIG[resourceType].maxLife,
        initialRespawnRemainingSec?: number,
        screenHost?: ScreenAnchorHost,
    ) {
        super();
        this.resourceType = resourceType;
        this.life = initialLife;
        this.respawnRemainingSec = initialRespawnRemainingSec;
        this.screenHost = screenHost;
        this.transform.position.copy(position);
    }

    /** ActionTarget — the point PlayerActionController turns the player to face while acting on this node. */
    public get position(): THREE.Vector3 {
        return this.transform.position;
    }

    /** Remaining life, for UI/debug (e.g. a gather progress ring later). */
    public get remainingLife(): number {
        return this.life;
    }

    /** Entity's self-configure hook (see Entity.ts) — trigger collider + placeholder visual, both sized/positioned per resource type. */
    public override awake(): void {
        this.rigidBody = this.addComponent(new RigidBody({
            halfExtents: TRIGGER_HALF_EXTENTS,
            isStatic: true,
            isTrigger: true,
            layer: Layers.Resource,
            centerOffset: new THREE.Vector3(0, TRIGGER_HALF_EXTENTS.y, 0),
        }));

        const config = RESOURCE_CONFIG[this.resourceType];
        const visualConfig = ASSET_LIBRARY[RESOURCE_ASSET_KEYS[this.resourceType]];

        // See AssetLibraryRegistry.ts — an empty models list (no glb yet for this asset)
        // falls back to the old flat-colored box placeholder instead.
        this.visual = visualConfig.models.length > 0
            ? this.addComponent(new GlbVisualComponent(
                pickRandom(visualConfig.models),
                new THREE.Vector3(),
                resolveRange(visualConfig.scale),
                resolveRange(visualConfig.rotationDeg) * (Math.PI / 180),
            ))
            : this.addComponent(new BoxVisualComponent(
                STONE_HALF_EXTENTS.clone().multiplyScalar(2), config.color,
                new THREE.Vector3(0, STONE_HALF_EXTENTS.y, 0),
            ));

        this.applyInitialState();
    }

    public override update(delta: number): void {
        super.update(delta);

        if (this.respawnRemainingSec === undefined) {
            return;
        }

        this.respawnRemainingSec -= delta;
        if (this.respawnRemainingSec <= 0) {
            this.respawn();
        }
    }

    public get isAvailable(): boolean {
        return this.respawnRemainingSec === undefined;
    }

    /** Remaining respawn cooldown, for WorldManager to carry over on dematerialize — undefined means "available." */
    public get respawnRemaining(): number | undefined {
        return this.respawnRemainingSec;
    }

    /**
     * ActionTarget — absorbs one hit from whatever action is being performed on this node
     * (see PlayerActionController). Returns true once life runs out, which both depletes
     * the node here and tells the action it's done; AutoGatherController then banks the
     * yield. Partial damage just sits in `life` — see that field's own doc.
     */
    public applyHit(damage: number): boolean {
        if (!this.isAvailable) {
            return true;
        }

        this.life -= damage;

        if (this.life > 0) {
            return false;
        }

        this.deplete(RESOURCE_CONFIG[this.resourceType].respawnSec);
        return true;
    }

    /** Called when a hit lands on this resource — shake the visual and show damage text. Skips the visual feedback (but the hit itself still counts, see applyHit()) if a Tree's glb model hasn't finished loading yet — see GlbVisualComponent's own doc. */
    public onHit(hitData?: { damage: number }): void {
        if (this.visual instanceof GlbVisualComponent && !this.visual.isReady) {
            return;
        }
        const mesh = this.visual.mesh;

        // Quick shake
        const shake = { x: 0, y: 0, z: 0 };
        gsap.to(shake, {
            x: () => (Math.random() - 0.5) * 0.2,
            y: () => (Math.random() - 0.5) * 0.15,
            z: () => (Math.random() - 0.5) * 0.2,
            duration: 0.08,
            ease: 'power3.out',
            onUpdate: () => {
                mesh.position.x = shake.x;
                mesh.position.y = shake.y;
                mesh.position.z = shake.z;
            },
            onComplete: () => {
                mesh.position.set(0, 0, 0);
            },
        });

        // Show floating damage text
        if (hitData?.damage && this.world) {
            this.showDamagePopup(hitData.damage);
        }
    }

    /**
     * A ScreenAnchorComponent-backed popup (see that file's own doc for the "THROWAWAY"
     * shape) instead of a 3D CanvasTexture sprite — same "PIXI element paired to a 3D point"
     * approach DropZone's deposit popups use, so damage numbers get bend compensation and
     * crisp screen-space text for free instead of a billboarded 3D quad. The rise/fade is
     * still done in world space (a rising getTargetPosition(), see `progress` below) rather
     * than animating the PIXI content's own local position directly, since
     * ScreenAnchorComponent overwrites that every frame from the projected screen point.
     */
    private showDamagePopup(damage: number): void {
        if (!this.world || !this.screenHost) {
            return;
        }

        const text = new PIXI.Text(damage.toString(), TextStyleRegistry.ResourceDamage);
        text.anchor.set(0.5, 1);

        const basePosition = this.position.clone().add(DAMAGE_POPUP_BASE_OFFSET);
        const progress = { t: 0 };
        const risenPosition = new THREE.Vector3();

        const popupEntity = this.world.spawn();
        popupEntity.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            text,
            () => risenPosition.copy(basePosition).setY(basePosition.y + progress.t * DAMAGE_POPUP_RISE),
            { ttlSec: DAMAGE_POPUP_TTL_SEC },
        ));

        gsap.to(progress, {
            t: 1,
            duration: DAMAGE_POPUP_TTL_SEC,
            ease: 'power2.out',
            onUpdate: () => {
                text.alpha = 1 - progress.t;
            },
        });
    }

    /** awake() may materialize a node that started already depleted (see the constructor's doc) — the visual/physics need to reflect that from the very first frame, not just from the next applyHit()/deplete() call. */
    private applyInitialState(): void {
        if (this.respawnRemainingSec === undefined) {
            return;
        }
        this.visual.setVisible(false);
        this.world?.physics.unregister(this.rigidBody);
    }

    private deplete(respawnSec: number): void {
        this.respawnRemainingSec = respawnSec;
        this.visual.setVisible(false);
        // See this file's own doc — PhysicsWorld doesn't consult RigidBody.enabled, so
        // actually unregistering is what makes the node stop being triggerable.
        this.world?.physics.unregister(this.rigidBody);
    }

    private respawn(): void {
        this.respawnRemainingSec = undefined;
        // The one place life is restored — a full harvest earns the reset; walking away
        // mid-chop does not (see the `life` field's own doc).
        this.life = RESOURCE_CONFIG[this.resourceType].maxLife;
        this.visual.setVisible(true);
        this.world?.physics.register(this.rigidBody);
    }
}
