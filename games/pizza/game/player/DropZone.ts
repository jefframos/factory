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
import { spawnFlyingResourceIcon } from '../components/FlyingResourceIcon';
import { TextStyleRegistry } from '../ui/TextStyleRegistry';
import AutoFitFrame, { uniformFitPadding } from '../ui/AutoFitFrame';
import { BackpackStorage } from '../data/BackpackStorage';
import { GlobalResourceStorage } from '../data/GlobalResourceStorage';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import { RESOURCE_ASSET_KEYS } from '../actions/ResourceRegistry';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
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
/** Seconds between each unit's flying icon departing the backpack — see flyOutResource(). */
const FLY_OUT_STAGGER_SEC = 0.12;

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
    /** Resource types currently draining out via flyOutResource() — guards a second overlapping drain loop starting for the same type (see tryDeposit()). */
    private readonly draining = new Set<ResourceType>();
    /** True for as long as the player's RigidBody is inside this zone's trigger — flyOutResource()'s per-unit loop checks this before every unit and stops the instant it goes false, rather than a fixed onTriggerEnter burst draining everything regardless of whether the player stuck around. */
    private isPlayerInside = false;
    /** The player entity currently inside this zone — undefined whenever isPlayerInside is false. Kept so flyOutResource() can read the player's CURRENT backpack world position on every unit, not a stale snapshot from whenever the trigger first fired. */
    private player?: MainPlayer;
    /** Where deposited icons fly TO — the same anchor this zone's own nameplate tracks (see awake()), i.e. wherever this zone's UI is actually rendered on screen, not a point on the zone's 3D mesh. */
    private labelAnchor!: THREE.Object3D;

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

        // A dedicated empty node the nameplate tracks, rather than a raw captured position —
        // parented under this.transform so it moves with the zone for free, and gives the
        // label a stable, independently-positionable "where does the UI render from" point.
        // Stored as a field (not just a local) since flyOutResource() targets the same spot —
        // deposited icons fly to wherever this zone's own UI actually renders, not a point on
        // its 3D mesh.
        this.labelAnchor = new THREE.Object3D();
        this.labelAnchor.position.copy(LABEL_HEIGHT_OFFSET);
        this.transform.add(this.labelAnchor);
        const labelAnchorWorldPosition = new THREE.Vector3();

        // No ttlSec — persistent for as long as this entity is. See ScreenAnchorComponent.ts.
        // ZONE_LABEL_ANCHOR_OPTIONS hides/shrinks the nameplate by distance from the player —
        // see that file's own doc.
        this.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            this.createLabelContent(),
            () => this.labelAnchor.getWorldPosition(labelAnchorWorldPosition),
            ZONE_LABEL_ANCHOR_OPTIONS,
        ));

        // onTriggerStay (not just onTriggerEnter) is what makes this a CONTINUOUS deposit —
        // every physics step the player is still standing here, tryDeposit() gets another
        // chance to start draining any type that isn't already mid-drain (e.g. one gathered
        // AFTER the player arrived). onTriggerExit is the other half: it flips isPlayerInside
        // off, which flyOutResource()'s loop checks before every single unit — see this file's
        // own doc for why the old "fire the whole burst on enter" behavior kept draining the
        // backpack even after the player walked away.
        rigidBody.onTriggerEnter.add(other => this.tryDeposit(other));
        rigidBody.onTriggerStay.add(other => this.tryDeposit(other));
        rigidBody.onTriggerExit.add(other => this.handleTriggerExit(other));
    }

    private tryDeposit(other: RigidBody): void {
        const player = other.entity;
        if (!(player instanceof MainPlayer)) {
            return;
        }

        this.isPlayerInside = true;
        this.player = player;

        for (const [type, amount] of BackpackStorage.getAll()) {
            if (amount <= 0) {
                continue;
            }

            this.flyOutResource(type);
        }
    }

    /** Player's RigidBody left this zone's trigger — flyOutResource()'s loop reads isPlayerInside before every unit, so clearing it here is the ENTIRE "stop depositing" instruction; nothing further needs to be cancelled explicitly. */
    private handleTriggerExit(other: RigidBody): void {
        if (other.entity !== this.player) {
            return;
        }

        this.isPlayerInside = false;
        this.player = undefined;
    }

    /**
     * Drains `type` out of BackpackStorage one unit at a time, re-checking isPlayerInside and
     * BackpackStorage's CURRENT count before every single unit — not a fixed burst computed
     * once at trigger time. Each unit's icon departs from wherever the player's backpack cube
     * currently sits (read fresh every unit, since a continuously-draining player is still
     * walking around) and arrives at this zone's own labelAnchor — see this file's own doc.
     * No-ops (and clears `draining`) the instant the player leaves, the backpack empties, or
     * the FBX character (and so the backpack cube) hasn't loaded yet.
     */
    private flyOutResource(type: ResourceType): void {
        if (this.draining.has(type)) {
            return;
        }
        this.draining.add(type);

        const icon = getAssetIcon(RESOURCE_ASSET_KEYS[type]);
        const label = RESOURCE_CONFIG[type].label;
        const toWorld = new THREE.Vector3();

        const step = (): void => {
            const fromWorld = this.isPlayerInside
                ? this.player?.getComponent(CharacterVisualComponent)?.character.getBackpackWorldPosition()
                : undefined;

            if (!fromWorld || BackpackStorage.getCount(type) <= 0) {
                this.draining.delete(type);
                return;
            }

            this.labelAnchor.getWorldPosition(toWorld);

            spawnFlyingResourceIcon(this.screenHost, fromWorld.clone(), toWorld.clone(), icon, () => {
                BackpackStorage.removeOne(type);
                GlobalResourceStorage.add(type, 1);
                this.spawnUnitPopup(label);
            });

            gsap.delayedCall(FLY_OUT_STAGGER_SEC, step);
        };

        step();
    }

    /**
     * One rising, fading "+1 {label}" popup for a single deposited unit — a throwaway
     * ScreenAnchorComponent-backed entity (see that file's own doc), same rise-via-world-
     * position + gsap-alpha-fade shape as ResourceNode.showDamagePopup(). Several of these
     * spawned FLY_OUT_STAGGER_SEC apart (see flyOutResource()) overlap in
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
