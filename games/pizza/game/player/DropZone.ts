// DropZone.ts
//
// Where the player automatically deposits everything in its backpack —
// the design doc's "entering the build zone automatically deposits carried
// resources." A static trigger (Layers.Trigger); on the PLAYER entering,
// reads the GLOBAL BackpackStorage (see that file's own doc — no longer a
// per-entity component) and drains each resource type out ONE UNIT AT A
// TIME: a flying chip per unit, staggered over time, each decrementing
// BackpackStorage.removeOne() (and so the live BackpackUI) AND crediting
// GlobalResourceStorage.add() (and so the live GlobalResourcesUI's base
// stockpile) for that same unit, then popping its own rising, fading "+1
// Wood" — not one big "+13 Wood" up front — only once it actually lands.
// Depositing reads as a satisfying little cascade, not an instant zero-out.
//
// Also carries a PERMANENT "Drop Zone" nameplate via ScreenAnchorComponent
// — the centralized 3D-point-tracking system, not anything drop-zone-
// specific — added directly to its own awake() (no ttlSec — see
// ScreenAnchorComponent.ts's own doc on the two shapes) so it's always
// readable while onscreen.
//
// Listens on ITS OWN RigidBody rather than the player's, so it never needs
// to know MainPlayer exists beyond checking `other.entity instanceof
// MainPlayer` — MainPlayer doesn't need to know DropZone exists at all.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import BoxVisualComponent from '../components/BoxVisualComponent';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import CharacterVisualComponent from '../components/CharacterVisualComponent';
import { spawnFlyingResourceChip } from '../components/FlyingResourceEffect';
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import { BackpackStorage } from '../data/BackpackStorage';
import { GlobalResourceStorage } from '../data/GlobalResourceStorage';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import MainPlayer from './MainPlayer';

/** Breathing room between the nameplate's text and its AutoFitFrame border — separate from the frame asset's OWN 9-slice padding (see FrameRegistry.ts). */
const LABEL_FRAME_PADDING = uniformFitPadding(10);

const HALF_EXTENTS = new THREE.Vector3(1.25, 0.75, 1.25);
/** How far above the zone each unit's "+1" popup starts. */
const POPUP_HEIGHT_OFFSET = new THREE.Vector3(0, HALF_EXTENTS.y * 2 + 0.5, 0);
/** World units a popup rises over its own lifetime — see spawnUnitPopup(). */
const POPUP_RISE = 0.8;
/** How long a single unit's popup stays up (rising + fading) before it's torn down. Deliberately longer than FLY_OUT_STAGGER_SEC — consecutive popups overlap in TIME but not in SPACE, since an older popup has already risen further by the time the next one starts at ground level (see spawnUnitPopup()'s own doc). */
const POPUP_LIFETIME_SEC = 0.9;
/** The nameplate sits a bit above the deposit popups' own spot, so the two never overlap. */
const LABEL_HEIGHT_OFFSET = new THREE.Vector3(0, HALF_EXTENTS.y * 2 + 1.2, 0);
/** Seconds between each unit's flying chip departing the backpack (and, in the instant-drain fallback, each unit's popup) — see flyOutResource()/drainInstantly(). */
const FLY_OUT_STAGGER_SEC = 0.12;
/** Where a deposited chip actually lands, relative to this zone's own position. */
const DEPOSIT_LANDING_OFFSET = new THREE.Vector3(0, HALF_EXTENTS.y, 0);

/** Builds the actual Pixi content for a single unit's "+1 Wood" deposit popup — plain PIXI.Text by default. Injectable (see the constructor) so DropZone's trigger/backpack-draining logic stays testable headlessly, where PIXI.Text can't construct at all (needs a real canvas/`document` — see scripts/test-gather.ts). */
function defaultCreatePopupContent(label: string): PIXI.Container {
    const text = new PIXI.Text(`+1 ${label}`, TextStyleRegistry.Body);
    text.anchor.set(0.5, 1);
    return text;
}

/**
 * Builds the permanent nameplate — same injection reasoning as
 * defaultCreatePopupContent(). Wrapped in an AutoFitFrame (see that file's own
 * doc) so the label reads as a panel, not bare floating text — the frame
 * sizes itself to the text automatically, sitting behind it in draw order.
 */
function defaultCreateLabelContent(): PIXI.Container {
    const text = new PIXI.Text('Drop Zone', TextStyleRegistry.ZoneTitle);
    text.anchor.set(0.5, 1);
    return new AutoFitFrame(LABEL_FRAME_PADDING, 'Popup', text);
}

export default class DropZone extends Entity {
    private readonly screenHost: ScreenAnchorHost;
    private readonly createPopupContent: (label: string) => PIXI.Container;
    private readonly createLabelContent: () => PIXI.Container;
    /** Resource types currently draining out via flyOutResource()/drainInstantly() — guards a fast re-entry from starting a second overlapping drain for the same type (see tryDeposit()). */
    private readonly draining = new Set<ResourceType>();

    public constructor(
        position: THREE.Vector3,
        screenHost: ScreenAnchorHost,
        createPopupContent: (label: string) => PIXI.Container = defaultCreatePopupContent,
        createLabelContent: () => PIXI.Container = defaultCreateLabelContent,
    ) {
        super();
        this.screenHost = screenHost;
        this.createPopupContent = createPopupContent;
        this.createLabelContent = createLabelContent;
        this.transform.position.copy(position);
    }

    public override awake(): void {
        const rigidBody = this.addComponent(new RigidBody({
            halfExtents: HALF_EXTENTS,
            isStatic: true,
            isTrigger: true,
            layer: Layers.Trigger,
            centerOffset: new THREE.Vector3(0, HALF_EXTENTS.y, 0),
        }));
        this.addComponent(new BoxVisualComponent(
            HALF_EXTENTS.clone().multiplyScalar(2),
            0x33cc66,
            new THREE.Vector3(0, HALF_EXTENTS.y, 0),
        ));

        // No ttlSec — persistent for as long as this entity is. See ScreenAnchorComponent.ts.
        const labelPosition = this.transform.position.clone().add(LABEL_HEIGHT_OFFSET);
        this.addComponent(new ScreenAnchorComponent(this.screenHost, this.createLabelContent(), () => labelPosition));

        rigidBody.onTriggerEnter.add(other => this.tryDeposit(other));
    }

    private tryDeposit(other: RigidBody): void {
        const player = other.entity;
        if (!(player instanceof MainPlayer)) {
            return;
        }

        // The backpack cube's current world position is where every flying chip departs
        // from — undefined until the FBX character has loaded (see
        // CharacterVisualComponent/MainPlayer.loadCharacter()). Falling all the way back to
        // an instant per-unit drain rather than no-op'ing means a player who reaches the drop
        // zone before their character finishes loading still actually deposits — just
        // without the flying-chip animation preceding each popup for that one visit.
        const backpackWorldPosition = player.getComponent(CharacterVisualComponent)?.character.getBackpackWorldPosition();

        for (const [type, amount] of BackpackStorage.getAll()) {
            if (amount <= 0 || this.draining.has(type)) {
                continue;
            }

            console.log(`[deposit] +${amount} ${RESOURCE_CONFIG[type].label}`);

            if (backpackWorldPosition) {
                this.flyOutResource(type, amount, backpackWorldPosition.clone());
            } else {
                this.drainInstantly(type, amount);
            }
        }
    }

    /**
     * Drains `amount` units of `type` out of BackpackStorage over time — one flying chip per
     * unit, staggered by FLY_OUT_STAGGER_SEC, each decrementing BackpackStorage and popping its
     * own "+1 {label}" only once it actually lands (see FlyingResourceEffect's onArrive).
     * `fromWorld` is a snapshot taken at trigger time; the ~amount*stagger-second drain window
     * is short enough that a moving player mid-drain isn't worth re-tracking live.
     */
    private flyOutResource(type: ResourceType, amount: number, fromWorld: THREE.Vector3): void {
        const scene = this.transform.parent;
        if (!scene) {
            return;
        }

        const toWorld = this.transform.position.clone().add(DEPOSIT_LANDING_OFFSET);
        const color = RESOURCE_CONFIG[type].color;
        const label = RESOURCE_CONFIG[type].label;

        this.draining.add(type);
        for (let i = 0; i < amount; i++) {
            gsap.delayedCall(i * FLY_OUT_STAGGER_SEC, () => {
                spawnFlyingResourceChip(scene, fromWorld, toWorld, color, () => {
                    BackpackStorage.removeOne(type);
                    GlobalResourceStorage.add(type, 1);
                    this.spawnUnitPopup(label);
                    if (i === amount - 1) {
                        this.draining.delete(type);
                    }
                });
            });
        }
    }

    /** No loaded backpack cube to fly chips from (see tryDeposit()) — still drains + pops one unit at a time, staggered the same way, just without a chip preceding each pop. */
    private drainInstantly(type: ResourceType, amount: number): void {
        const label = RESOURCE_CONFIG[type].label;

        this.draining.add(type);
        for (let i = 0; i < amount; i++) {
            gsap.delayedCall(i * FLY_OUT_STAGGER_SEC, () => {
                BackpackStorage.removeOne(type);
                GlobalResourceStorage.add(type, 1);
                this.spawnUnitPopup(label);
                if (i === amount - 1) {
                    this.draining.delete(type);
                }
            });
        }
    }

    /**
     * One rising, fading "+1 {label}" popup for a single deposited unit — a throwaway
     * ScreenAnchorComponent-backed entity (see that file's own doc), same rise-via-world-
     * position + gsap-alpha-fade shape as ResourceNode.showDamagePopup(). Several of these
     * spawned FLY_OUT_STAGGER_SEC apart (see flyOutResource()/drainInstantly()) overlap in
     * TIME but not in SPACE: each starts at the same ground position but rises by
     * (elapsed / POPUP_LIFETIME_SEC) * POPUP_RISE, so an older popup is always further up
     * than a newer one started at the same spot a beat later — a little cascade instead of a
     * pile-up.
     */
    private spawnUnitPopup(label: string): void {
        if (!this.world) {
            return;
        }

        const content = this.createPopupContent(label);
        const basePosition = this.transform.position.clone().add(POPUP_HEIGHT_OFFSET);
        const progress = { t: 0 };
        const risenPosition = new THREE.Vector3();

        const popupEntity = this.world.spawn();
        popupEntity.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            content,
            () => risenPosition.copy(basePosition).setY(basePosition.y + progress.t * POPUP_RISE),
            { ttlSec: POPUP_LIFETIME_SEC },
        ));

        gsap.to(progress, {
            t: 1,
            duration: POPUP_LIFETIME_SEC,
            ease: 'power2.out',
            onUpdate: () => {
                content.alpha = 1 - progress.t;
            },
        });
    }
}
