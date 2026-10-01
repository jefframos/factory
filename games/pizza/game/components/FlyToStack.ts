// FlyToStack.ts
//
// Resource flights to and from the player's carry stack, both built on
// flyResourceModel() — one resource's display model (see ResourceDisplayModel.ts
// — real world size, laid on its side if tall, exactly as it sits on the stack)
// arcing between two points, with the destination re-read EVERY FRAME (the
// player keeps walking; the stack can change under it mid-flight).
//
//   flyResourceToStack() — onto the NEXT free slot on top of the player's stack
//     (CarrierStackVisual.getSlotWorldTarget()), then banks it. Used by
//     FarmPlotTile (a harvest goes straight onto the stack) and HarvestPickup.
//     The slot is reserved for the whole flight (CarryStack.beginFlight()), so a
//     burst of collections can never overshoot the capacity, and each in-flight
//     item aims one slot above the one launched before it — see CarryStack's doc.
//     Callers must check CarryStack.hasRoomFor() BEFORE calling it.
//
//   StorageZone flies the other way (stack -> storage) through flyResourceModel()
//   directly, since it owns its own bookkeeping.

import * as THREE from 'three';
import gsap from 'gsap';
import { BackpackStorage } from '../data/BackpackStorage';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import { CarryStack } from '../player/CarryStack';
import type MainPlayer from '../player/MainPlayer';
import CarrierStackVisual, { rememberStackItemSize, stackItemScale } from './CarrierStackVisual';
import { getPileScale } from './ItemPile';
import CharacterVisualComponent from './CharacterVisualComponent';
import { disposeResourceDisplayModel, ItemOrientation, loadResourceDisplayModel, darkenResourceDisplayModel } from '../world/ResourceDisplayModel';

const FLY_DURATION_SEC = 0.45;
/** How far above the higher of the two endpoints the arc peaks. */
const ARC_HEIGHT = 0.8;
/** Where to aim if the stack (character/carrier) hasn't loaded yet — roughly chest height above the player's feet. */
const FALLBACK_TARGET_HEIGHT = 1.2;

export interface ResourceFlight {
    /** Anything on-screen to hang the model off during the flight — typically the THREE.Scene (every position here is world-space). */
    parent: THREE.Object3D;
    type: ResourceType;
    /** World-space start — the model's bottom-center. */
    from: THREE.Vector3;
    /** Writes the CURRENT destination (world space, bottom-center) into `out` — called every frame. */
    resolveTarget: (out: THREE.Vector3) => void;
    /** Model scale (on top of its real world size) at the start/end of the flight — interpolated in between. */
    startScale: number;
    endScale: number;
    /** Fires once, right as it arrives (the model is already gone). */
    onArrive: () => void;
    /** How the flying model is turned — match the pile it lands in (see ItemPileLayout.itemOrientation). Unset = 'lying'. */
    orientation?: ItemOrientation;
    /** Fixed yaw (degrees) for the flying model — match the pile's itemYawDeg. Unset = 0. */
    yawDeg?: number;
    /** Draw the flying model as this item instead of `type` (e.g. garbage that was a tomato) — see ItemPileLayout.displayFor. */
    displayType?: ResourceType;
    /** Multiplier on the flying model's colors — see darkenResourceDisplayModel(). */
    darken?: number;
}

/** The shared arc flight — see this file's own doc. */
export function flyResourceModel(flight: ResourceFlight): void {
    const start = flight.from.clone();
    const orientation = flight.orientation ?? 'lying';
    const displayType = flight.displayType ?? flight.type;
    void loadResourceDisplayModel(displayType, { orientation }).then(({ object: model, size, restHeight }) => {
        // Lets the destination pile reserve this item's real size for a slot it's heading to, even
        // before the pile's own copy of the model has loaded.
        rememberStackItemSize(displayType, size, orientation, restHeight);
        if (flight.darken !== undefined) {
            darkenResourceDisplayModel(model, flight.darken);
        }
        model.rotation.y = THREE.MathUtils.degToRad(flight.yawDeg ?? 0);
        model.scale.setScalar(flight.startScale);
        model.position.copy(start);
        flight.parent.add(model);

        const target = new THREE.Vector3();
        const apex = new THREE.Vector3();
        const progress = { t: 0 };
        gsap.to(progress, {
            t: 1,
            duration: FLY_DURATION_SEC,
            ease: 'power1.in',
            onUpdate: () => {
                flight.resolveTarget(target);
                apex.copy(start).lerp(target, 0.5);
                apex.y = Math.max(start.y, target.y) + ARC_HEIGHT;
                const t = progress.t;
                const u = 1 - t;
                model.position.set(
                    u * u * start.x + 2 * u * t * apex.x + t * t * target.x,
                    u * u * start.y + 2 * u * t * apex.y + t * t * target.y,
                    u * u * start.z + 2 * u * t * apex.z + t * t * target.z,
                );
                model.scale.setScalar(flight.startScale + (flight.endScale - flight.startScale) * t);
            },
            onComplete: () => {
                disposeResourceDisplayModel(model);
                flight.onArrive();
            },
        });
    });
}

/**
 * Flies one unit of `type` from `fromWorld` onto the top of `player`'s stack, banking it into
 * BackpackStorage on arrival — see this file's own doc. `onArrive` fires right after it's banked.
 */
export function flyResourceToStack(
    parent: THREE.Object3D,
    player: MainPlayer,
    type: ResourceType,
    fromWorld: THREE.Vector3,
    onArrive?: () => void,
    /** Fly (and aim) as another, optionally darkened item — e.g. garbage that was a tomato; `beforeBank` runs right before `type` is added (see GarbageCarryStorage.push()). */
    display?: { type: ResourceType; darken?: number; beforeBank?: () => void },
): void {
    const flightId = CarryStack.beginFlight();
    const shownType = display?.type ?? type;
    // Same size the stack draws it at (itemScale x its pileScale), the whole way — so it doesn't pop size on landing.
    const scale = stackItemScale() * getPileScale(shownType);
    flyResourceModel({
        parent,
        type,
        displayType: display?.type,
        darken: display?.darken,
        from: fromWorld,
        startScale: scale,
        endScale: scale,
        // Already turned the way it sits on the back (e.g. corn on its side), so it doesn't flip on landing.
        orientation: RESOURCE_CONFIG[shownType]?.carrierOrientation,
        resolveTarget: target => {
            // The Nth in-flight item aims N slots above the current top — see CarryStack's doc.
            const index = CarryStack.carriedCount() + Math.max(CarryStack.flightIndex(flightId), 0);
            if (player.getComponent(CarrierStackVisual)?.getSlotWorldTarget(index, shownType, target)) {
                return;
            }
            if (!player.getComponent(CharacterVisualComponent)?.character.getCarrierWorldPosition(target)) {
                target.copy(player.transform.position).setY(player.transform.position.y + FALLBACK_TARGET_HEIGHT);
            }
        },
        onArrive: () => {
            CarryStack.endFlight(flightId);
            display?.beforeBank?.();
            BackpackStorage.add(type, 1);
            onArrive?.();
        },
    });
}
