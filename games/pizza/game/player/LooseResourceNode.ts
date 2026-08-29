// LooseResourceNode.ts
//
// Instant-pickup ground loot — dynamically-spawned resources (see
// DynamicResourceSpawner.ts, the one thing that constructs these) collected
// the instant the player's RigidBody touches this one's trigger. Deliberately
// NOT a ResourceNode and does NOT go through PlayerActionController/
// AutoGatherController at all: a tree or rock is a multi-swing HARVEST (see
// ResourceNode.ts's own doc — an action plays out over hitIntervalSec before
// anything's actually banked), which is the right model for something the
// player has to work at. Loose loot lying in the open needs none of that —
// touching it is the whole interaction, same as walking over a coin in
// countless other games. Reusing ResourceNode's ActionTarget/hit-animation
// plumbing here would mean making the player wait out a swing animation to
// pick up something already just lying there; this class exists specifically
// so that never happens.
//
// No solid collider at all (see DynamicResourceTypes.ts's own doc — every
// dynamic resource so far is walk-over-able ground clutter); the trigger
// IS the pickup detector, sized to roughly the player's own reach rather
// than a tree's much larger "gather radius," since this is "bumped into,"
// not "walked near."

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
import { BackpackStorage } from '../data/BackpackStorage';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { ASSET_LIBRARY, AssetLibraryEntry, getAssetIcon, pickRandom, resolveRange } from '../world/AssetLibraryRegistry';
import { PERFORMANCE_CONFIG } from '../config/PerformanceConfig';
import ViewUtils from 'core/utils/ViewUtils';
import MainPlayer from './MainPlayer';
import ResourceNodeRegistry from './ResourceNodeRegistry';

/** Pickup-trigger half-extents — smaller than ResourceNode's own gather-radius trigger (1,1,1): this is "bumped into," not "stood near" — see this file's own doc. */
const TRIGGER_HALF_EXTENTS = new THREE.Vector3(0.6, 0.6, 0.6);
/** Placeholder box size, only used while this resource's AssetLibraryRegistry entry has no glb models yet. */
const PLACEHOLDER_HALF_EXTENTS = new THREE.Vector3(0.3, 0.3, 0.3);

/** Same rising "+N" popup ResourceNode.showGainPopup() uses, trimmed down (no hit-shake, no resourcePerHit multiplier — there's no action config here to read one from, just amountPerGather flat). */
const GAIN_POPUP_BASE_OFFSET = new THREE.Vector3(0, 1, 0);
const GAIN_POPUP_RISE = 1.2;
const GAIN_POPUP_TTL_SEC = 0.9;
const GAIN_POPUP_ICON_SIZE = 28;
const GAIN_POPUP_ICON_GAP = 4;

export default class LooseResourceNode extends Entity {
    public readonly resourceType: ResourceType;
    private readonly screenHost?: ScreenAnchorHost;
    /** Notifies DynamicResourceSpawner that this instance's slot just freed up — called once, right before this leaves the world. */
    private readonly onConsumed?: () => void;

    private visual!: BoxVisualComponent | GlbVisualComponent;
    /** True the instant tryPickup() fires — guards a second overlapping onTriggerEnter (or a stray one arriving after this already started leaving the world) from double-banking/double-notifying. */
    private consumed = false;

    public constructor(
        resourceType: ResourceType,
        position: THREE.Vector3,
        screenHost?: ScreenAnchorHost,
        onConsumed?: () => void,
    ) {
        super();
        this.resourceType = resourceType;
        this.screenHost = screenHost;
        this.onConsumed = onConsumed;
        this.transform.position.copy(position);
    }

    /** Where this loot sits — read by DynamicResourceSpawner for its own distance checks (minDistance, load/unload radius). */
    public get position(): THREE.Vector3 {
        return this.transform.position;
    }

    public override awake(): void {
        const rigidBody = this.addComponent(new RigidBody({
            halfExtents: TRIGGER_HALF_EXTENTS,
            isStatic: true,
            isTrigger: true,
            // Deliberately NOT Layers.Resource — that's the layer AutoGatherController's own
            // player-side trigger listens on to find HARVESTABLE nodes (see that file's own
            // doc); this resource is never meant to reach that pipeline at all, so it has no
            // reason to share the layer that feeds it.
            layer: Layers.Default,
            centerOffset: new THREE.Vector3(0, TRIGGER_HALF_EXTENTS.y, 0),
        }));

        // Can be undefined for a resource type added but never saved through the Resources
        // tab — see ResourceRegistry.ts's own doc — fall back to the placeholder box instead
        // of crashing, same as the "no models yet" case just below.
        const visualConfig: AssetLibraryEntry | undefined = ASSET_LIBRARY[resolveResourceAssetKey(this.resourceType)];
        if (!visualConfig) {
            console.warn(`[LooseResourceNode] no AssetLibraryRegistry entry for resource "${this.resourceType}" yet — falling back to a placeholder box. Open the Resources tab and save this resource once (its icon/models fields) to create one.`);
        }
        this.visual = visualConfig && visualConfig.models.length > 0
            ? this.addComponent(new GlbVisualComponent(
                pickRandom(visualConfig.models),
                new THREE.Vector3(),
                resolveRange(visualConfig.scale),
                resolveRange(visualConfig.rotationDeg) * (Math.PI / 180),
            ))
            : this.addComponent(new BoxVisualComponent(
                PLACEHOLDER_HALF_EXTENTS.clone().multiplyScalar(2), RESOURCE_CONFIG[this.resourceType].color,
                new THREE.Vector3(0, PLACEHOLDER_HALF_EXTENTS.y, 0),
            ));

        rigidBody.onTriggerEnter.add(other => this.tryPickup(other));

        // See ResourceNodeRegistry's own doc for why loose ground loot needs to register here
        // too, not just harvestable ResourceNodes — some ResourceType values (e.g. bark) are
        // ONLY ever this.
        ResourceNodeRegistry.register(this);
    }

    public override destroy(): void {
        ResourceNodeRegistry.unregister(this);
        super.destroy();
    }

    /**
     * Scales the visual up from nothing instead of snapping straight to full size — same
     * "pop in softly" idiom ResourceNode.playSpawnIn() uses for map-painted resources
     * streaming into range. No-ops if a GlbVisualComponent's model hasn't finished loading
     * yet (nothing to animate) — it'll just snap in at full scale whenever the load resolves.
     */
    public playSpawnIn(durationSec: number = PERFORMANCE_CONFIG.resourcePopInSec): void {
        if (this.visual instanceof GlbVisualComponent && !this.visual.isReady) {
            return;
        }
        if (durationSec <= 0) {
            return;
        }
        const mesh = this.visual.mesh;
        const target = mesh.scale.clone();
        mesh.scale.set(0, 0, 0);
        gsap.to(mesh.scale, { x: target.x, y: target.y, z: target.z, duration: durationSec, ease: 'back.out(1.7)' });
    }

    /** Mirror of playSpawnIn() — for DynamicResourceSpawner dematerializing this out of range (NOT for a pickup — see tryPickup(), which leaves instantly, no animation). */
    public playDespawnOut(onComplete: () => void, durationSec: number = PERFORMANCE_CONFIG.resourcePopOutSec): void {
        if (durationSec <= 0 || (this.visual instanceof GlbVisualComponent && !this.visual.isReady)) {
            onComplete();
            return;
        }
        gsap.to(this.visual.mesh.scale, { x: 0, y: 0, z: 0, duration: durationSec, ease: 'power2.in', onComplete });
    }

    /**
     * The entire interaction: the instant the player's RigidBody touches this one's trigger,
     * bank the resource and leave — no animation, no channel, no PlayerActionController
     * involvement at all (see this file's own doc). `consumed` guards against a second
     * onTriggerEnter (or one arriving after world.remove() has already been called) trying to
     * bank/notify twice.
     */
    private tryPickup(other: RigidBody): void {
        if (this.consumed || !(other.entity instanceof MainPlayer)) {
            return;
        }
        this.consumed = true;

        const config = RESOURCE_CONFIG[this.resourceType];
        BackpackStorage.add(this.resourceType, config.amountPerGather);
        this.showGainPopup(config.amountPerGather);

        this.onConsumed?.();
        this.world?.remove(this);
    }

    /** Trimmed-down version of ResourceNode.showResourceGainPopup() — no hit-shake (there's no hit), no resourcePerHit multiplier (no action config to read one from here), just the flat amountPerGather this pickup actually banked. */
    private showGainPopup(amount: number): void {
        if (!this.world || !this.screenHost) {
            return;
        }

        const icon = new PIXI.Sprite(getAssetIcon(resolveResourceAssetKey(this.resourceType)));
        icon.anchor.set(0, 0.5);
        icon.scale.set(ViewUtils.elementScaler(icon, GAIN_POPUP_ICON_SIZE));

        const text = new PIXI.Text(`+${amount}`, TextStyleRegistry.ResourceDamage);
        text.style.fill = '#33cc66';
        text.anchor.set(0, 0.5);
        text.position.set(icon.width + GAIN_POPUP_ICON_GAP, 0);

        const content = new PIXI.Container();
        content.addChild(icon, text);
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
}
