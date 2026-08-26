// ResourceNode.ts
//
// A gatherable resource PROVIDER — a tree (real glb prop, see
// MODELS.Props.Tree) or a stone deposit (cube placeholder until real art
// exists), see ProviderTypes.ts for the actual per-provider numbers/color/
// drop table (what a provider actually YIELDS is a separate concern from
// what kind of node it is — see that file's own doc). Same "dedicated
// Entity subclass self-configures in awake()" pattern as MainPlayer:
// `world.add(new ResourceNode(ProviderType.Tree, position))` is the entire
// setup — trigger RigidBody (Layers.Resource — see AutoGatherController,
// which listens for it) sized as the gather radius, an optional SOLID
// RigidBody (Layers.Environment) sized by ProviderConfig.solidRadius that
// actually blocks the player from walking through (0 = none — a berry bush
// stays walk-over-able while a tree/stone deposit doesn't), plus the
// placeholder visual.
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
//
// NOT used for dynamically-spawned ground loot (see LooseResourceNode.ts's
// own doc for why that's a deliberately separate, much simpler entity —
// instant pickup on contact, no ActionTarget/PlayerActionController channel
// at all — rather than a subclass of this).

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { buildSolidArea } from '../physics/SolidArea';
import BoxVisualComponent from '../components/BoxVisualComponent';
import GlbVisualComponent from '../components/GlbVisualComponent';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import { ActionTarget } from '../components/PlayerActionController';
import { PROVIDER_CONFIG, ProviderType } from '../actions/ProviderTypes';
import { ResourceType } from '../actions/ResourceTypes';
import { resolveProviderAssetKey } from '../actions/ProviderRegistry';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { ASSET_LIBRARY, AssetLibraryEntry, getAssetIcon, pickRandom, resolveRange } from '../world/AssetLibraryRegistry';
import { PERFORMANCE_CONFIG } from '../config/PerformanceConfig';
import ViewUtils from 'core/utils/ViewUtils';

/** Gather-radius trigger half-extents — bigger than the visual mesh itself, so the player doesn't have to walk INTO the trunk/rock to trigger gathering. */
const TRIGGER_HALF_EXTENTS = new THREE.Vector3(1, 1, 1);

const STONE_HALF_EXTENTS = new THREE.Vector3(0.6, 0.5, 0.6);

/** Where the gain popup starts, relative to the node's own position — roughly trunk/rock height. */
const GAIN_POPUP_BASE_OFFSET = new THREE.Vector3(0, 2, 0);
/** World units the popup rises over its lifetime — see showGainPopup(). */
const GAIN_POPUP_RISE = 1.2;
const GAIN_POPUP_TTL_SEC = 0.9;
/** The gain popup's icon, sized the same as BackpackUI's own slot icons feel scaled down — see showGainPopup(). */
const GAIN_POPUP_ICON_SIZE = 28;
/** Gap between the gain popup's icon and its "+N" text. */
const GAIN_POPUP_ICON_GAP = 4;

export default class ResourceNode extends Entity implements ActionTarget {
    public readonly providerType: ProviderType;

    private rigidBody!: RigidBody;
    /** Solid, non-trigger collider blocking the player from walking through — only created when ResourceConfig.solidRadius > 0 (see awake()). undefined for walk-over resources like Berries. */
    private solidBody?: RigidBody;
    private visual!: BoxVisualComponent | GlbVisualComponent;
    /** Set while depleted; ticked in update() — see deplete()/respawn(). undefined means "available." */
    private respawnRemainingSec?: number;
    /** Remaining hit-points (see ResourceConfig.maxLife). Deliberately NOT reset when an action is cancelled — walking away mid-chop leaves the tree exactly as damaged as it was, and coming back resumes from here. Only a full harvest + respawn restores it (see respawn()). */
    private life: number;
    /** Undefined only in contexts that never call onHit() (e.g. headless tests) — see showGainPopup(), which no-ops without it. */
    private readonly screenHost?: ScreenAnchorHost;

    /**
     * initialLife/initialRespawnRemainingSec let WorldManager re-materialize a node in
     * whatever state it was last in when it went out of range (mid-damage, or still
     * respawning) instead of always popping back in full-life — see WorldManager.ts.
     */
    public constructor(
        providerType: ProviderType,
        position: THREE.Vector3,
        initialLife: number = PROVIDER_CONFIG[providerType].maxLife,
        initialRespawnRemainingSec?: number,
        screenHost?: ScreenAnchorHost,
    ) {
        super();
        this.providerType = providerType;
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

        const config = PROVIDER_CONFIG[this.providerType];
        // Explicitly widened to AssetLibraryEntry — indexing ASSET_LIBRARY with a plain
        // AssetLibraryKey union otherwise infers the narrow PER-ENTRY literal union (each
        // entry's own `models` tuple keeps its own literal element type, from `satisfies
        // Record<...>` — see AssetLibraryRegistry.ts's own doc), which pickRandom() below
        // can't take a `readonly T[]` of once more than one shape of models array exists.
        //
        // Can still be undefined for a provider that was added but never saved through the
        // Providers tab (its matching AssetLibraryRegistry entry is only created on that
        // save — see ProviderRegistry.ts's own doc) — fall back to the placeholder box
        // instead of crashing, same as the "no models yet" case just below.
        const visualConfig: AssetLibraryEntry | undefined = ASSET_LIBRARY[resolveProviderAssetKey(this.providerType)];
        if (!visualConfig) {
            console.warn(`[ResourceNode] no AssetLibraryRegistry entry for provider "${this.providerType}" yet — falling back to a placeholder box. Open the Providers tab and save this provider once (its icon/models fields) to create one.`);
        }

        const solidArea = buildSolidArea(TRIGGER_HALF_EXTENTS, new THREE.Vector3(0, TRIGGER_HALF_EXTENTS.y, 0), config.solid ?? 0);
        if (solidArea) {
            this.solidBody = this.addComponent(solidArea);
        }

        // See AssetLibraryRegistry.ts — an empty models list (no glb yet for this asset)
        // falls back to the old flat-colored box placeholder instead.
        this.visual = visualConfig && visualConfig.models.length > 0
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

    /**
     * Scales the visual up from nothing instead of snapping straight to full size — called
     * by WorldManager.materialize() so a resource streaming into range doesn't visibly pop
     * in. A GlbVisualComponent whose glb hasn't finished loading yet has no real mesh to
     * read/animate yet (see GlbVisualComponent's own doc — its `mesh` getter throws until
     * the load resolves, same guard onHit() uses), so this simply no-ops rather than
     * animating a mesh that doesn't exist; the model will just snap in at full scale
     * whenever its load happens to resolve, same as before this existed.
     */
    public playSpawnIn(durationSec: number = PERFORMANCE_CONFIG.resourcePopInSec): void {
        if (this.visual instanceof GlbVisualComponent && !this.visual.isReady) {
            return;
        }
        const mesh = this.visual.mesh;
        if (durationSec <= 0) {
            return;
        }
        // Capture the mesh's own already-set scale (GlbVisualComponent bakes a per-resource
        // scale into it on load — see its awake()/load()) as the tween target BEFORE
        // zeroing it out, rather than assuming (1,1,1).
        const target = mesh.scale.clone();
        mesh.scale.set(0, 0, 0);
        gsap.to(mesh.scale, {
            x: target.x, y: target.y, z: target.z,
            duration: durationSec,
            ease: 'back.out(1.7)',
        });
    }

    /**
     * Mirror of playSpawnIn() — scales the visual down to nothing, then calls `onComplete`
     * (WorldManager.dematerialize() passes the actual world.remove(node) call) once the tween
     * finishes, instead of removing the entity the instant it drifts out of UNLOAD_RADIUS.
     */
    public playDespawnOut(onComplete: () => void, durationSec: number = PERFORMANCE_CONFIG.resourcePopOutSec): void {
        if (durationSec <= 0 || (this.visual instanceof GlbVisualComponent && !this.visual.isReady)) {
            onComplete();
            return;
        }
        gsap.to(this.visual.mesh.scale, {
            x: 0, y: 0, z: 0,
            duration: durationSec,
            ease: 'power2.in',
            onComplete,
        });
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
     * ActionTarget — absorbs `hits` worth of life from whatever action is being performed on
     * this node (see PlayerActionController). Returns true once life runs out, which both
     * depletes the node here and tells the action it's done; AutoGatherController then banks
     * the yield. Partial damage just sits in `life` — see that field's own doc.
     */
    public applyHit(hits: number): boolean {
        if (!this.isAvailable) {
            return true;
        }

        this.life -= hits;

        if (this.life > 0) {
            return false;
        }

        this.deplete(PROVIDER_CONFIG[this.providerType].respawnSec);
        return true;
    }

    /** Called when a hit lands on this resource — just the shake; the gain popup is triggered separately (see showResourceGainPopup()) once AutoGatherController.onHitLanded() actually knows what got credited. Skips the visual feedback (but the hit itself still counts, see applyHit()) if a Tree's glb model hasn't finished loading yet — see GlbVisualComponent's own doc. */
    public onHit(): void {
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
    }

    /**
     * A ScreenAnchorComponent-backed popup (see that file's own doc for the "THROWAWAY"
     * shape) instead of a 3D CanvasTexture sprite — same "PIXI element paired to a 3D point"
     * approach DropZone's deposit popups use, so it gets bend compensation and crisp
     * screen-space rendering for free instead of a billboarded 3D quad. Shows `resourceType`'s
     * OWN icon (not the provider's — see ResourceRegistry.ts's own doc; a provider's icon is
     * only ever meant to help identify it in the editor, never shown in-game) + "+amount",
     * where both are exactly what AutoGatherController.onHitLanded() just credited to the
     * backpack (see its own doc for how it resolves which resource(s) a hit actually rolled),
     * so a landed hit always shows the real item you got, not a stand-in. The rise/fade is
     * still done in world space (a rising getTargetPosition(), see `progress` below) rather
     * than animating the PIXI content's own local position directly, since
     * ScreenAnchorComponent overwrites that every frame from the projected screen point.
     */
    public showResourceGainPopup(resourceType: ResourceType, amount: number): void {
        if (!this.world || !this.screenHost || amount <= 0) {
            return;
        }

        const icon = new PIXI.Sprite(getAssetIcon(resolveResourceAssetKey(resourceType)));
        icon.anchor.set(0, 0.5);
        icon.scale.set(ViewUtils.elementScaler(icon, GAIN_POPUP_ICON_SIZE));

        const text = new PIXI.Text(`+${amount}`, TextStyleRegistry.ResourceDamage);
        text.style.fill = '#33cc66';
        text.anchor.set(0, 0.5);
        text.position.set(icon.width + GAIN_POPUP_ICON_GAP, 0);

        const content = new PIXI.Container();
        content.addChild(icon, text);
        // icon/text both anchor at their own vertical center (y=0.5) — pivoting the
        // container to its own combined center reproduces the same "rises from a
        // bottom-center anchor" placement the old single Text(anchor 0.5, 1) had.
        content.pivot.set(content.width / 2, content.height / 2);

        const basePosition = this.position.clone().add(GAIN_POPUP_BASE_OFFSET);
        const progress = { t: 0 };
        const risenPosition = new THREE.Vector3();

        const popupEntity = this.world.spawn();
        popupEntity.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            content,
            () => risenPosition.copy(basePosition).setY(basePosition.y + progress.t * GAIN_POPUP_RISE),
            { ttlSec: GAIN_POPUP_TTL_SEC },
        ));

        gsap.to(progress, {
            t: 1,
            duration: GAIN_POPUP_TTL_SEC,
            ease: 'power2.out',
            onUpdate: () => {
                content.alpha = 1 - progress.t;
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
        if (this.solidBody) {
            this.world?.physics.unregister(this.solidBody);
        }
    }

    private deplete(respawnSec: number): void {
        this.respawnRemainingSec = respawnSec;
        this.visual.setVisible(false);
        // See this file's own doc — PhysicsWorld doesn't consult RigidBody.enabled, so
        // actually unregistering is what makes the node stop being triggerable. The solid
        // collider (if any) comes out too — a depleted stump/rock shouldn't still block
        // the player from walking through the now-empty spot.
        this.world?.physics.unregister(this.rigidBody);
        if (this.solidBody) {
            this.world?.physics.unregister(this.solidBody);
        }
    }

    private respawn(): void {
        this.respawnRemainingSec = undefined;
        // The one place life is restored — a full harvest earns the reset; walking away
        // mid-chop does not (see the `life` field's own doc).
        this.life = PROVIDER_CONFIG[this.providerType].maxLife;
        this.visual.setVisible(true);
        this.world?.physics.register(this.rigidBody);
        if (this.solidBody) {
            this.world?.physics.register(this.solidBody);
        }
    }
}
