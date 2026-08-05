// ResourceNode.ts
//
// A gatherable resource — a tree (cylinder placeholder) or a stone (cube
// placeholder), see ResourceTypes.ts for the actual per-type numbers/color.
// Same "dedicated Entity subclass self-configures in awake()" pattern as
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
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import BoxVisualComponent from '../components/BoxVisualComponent';
import CylinderVisualComponent from '../components/CylinderVisualComponent';
import { ActionTarget } from '../components/PlayerActionController';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';

/** Gather-radius trigger half-extents — bigger than the visual mesh itself, so the player doesn't have to walk INTO the trunk/rock to trigger gathering. */
const TRIGGER_HALF_EXTENTS = new THREE.Vector3(1, 1, 1);

const TREE_TRUNK_RADIUS = 0.3;
const TREE_HEIGHT = 2.5;
const STONE_HALF_EXTENTS = new THREE.Vector3(0.6, 0.5, 0.6);

export default class ResourceNode extends Entity implements ActionTarget {
    public readonly resourceType: ResourceType;

    private rigidBody!: RigidBody;
    private visual!: BoxVisualComponent | CylinderVisualComponent;
    /** Set while depleted; ticked in update() — see deplete()/respawn(). undefined means "available." */
    private respawnRemainingSec?: number;
    /** Remaining hit-points (see ResourceConfig.maxLife). Deliberately NOT reset when an action is cancelled — walking away mid-chop leaves the tree exactly as damaged as it was, and coming back resumes from here. Only a full harvest + respawn restores it (see respawn()). */
    private life: number;

    public constructor(resourceType: ResourceType, position: THREE.Vector3) {
        super();
        this.resourceType = resourceType;
        this.life = RESOURCE_CONFIG[resourceType].maxLife;
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
        this.visual = this.resourceType === ResourceType.Tree
            ? this.addComponent(new CylinderVisualComponent(
                TREE_TRUNK_RADIUS, TREE_TRUNK_RADIUS, TREE_HEIGHT, config.color,
                new THREE.Vector3(0, TREE_HEIGHT / 2, 0),
            ))
            : this.addComponent(new BoxVisualComponent(
                STONE_HALF_EXTENTS.clone().multiplyScalar(2), config.color,
                new THREE.Vector3(0, STONE_HALF_EXTENTS.y, 0),
            ));
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

    /** Called when a hit lands on this resource — shake the visual and show damage text. */
    public onHit(hitData?: { damage: number }): void {
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

    private showDamagePopup(damage: number): void {
        const damageText = damage.toString();
        const canvas = document.createElement('canvas');
        const fontSize = 96;
        const width = 256;
        const height = 128;
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d')!;
        ctx.font = `bold ${fontSize}px Arial`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = '#FF4444';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 12;
        ctx.shadowOffsetX = 3;
        ctx.shadowOffsetY = 3;
        ctx.fillText(damageText, width / 2, height / 2);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
        const sprite = new THREE.Sprite(material);

        const startPos = new THREE.Vector3(0, 2.5, 0);
        sprite.position.copy(startPos);
        sprite.scale.set(3, 1.5, 1);

        this.transform.add(sprite);

        const anim = { opacity: 1, y: 0, scale: 1 };
        gsap.to(anim, {
            opacity: 0,
            y: 2,
            scale: 0.8,
            duration: 1.2,
            ease: 'power2.out',
            onUpdate: () => {
                sprite.position.y = startPos.y + anim.y;
                sprite.scale.set(3 * anim.scale, 1.5 * anim.scale, 1);
                (sprite.material as THREE.SpriteMaterial).opacity = anim.opacity;
            },
            onComplete: () => {
                texture.dispose();
                material.dispose();
                sprite.removeFromParent();
            },
        });
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
