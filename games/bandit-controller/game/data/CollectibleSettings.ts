// CollectibleSettings.ts
//
// Data for world-placed resource pickups (see Collectible.ts): the model +
// resource payout each kind grants, the shared attract/collect tuning, and
// where instances get spread across the world. Read live by Collectible/
// CollectibleSpawner, same "data/ is the single source of truth" convention
// as PlayerSettings.ts/WorldSettings.ts — see this file's own doc there.

import * as THREE from 'three';
import MODELS, { ModelDefinition } from '../../registry/assetsRegistry/modelsRegistry';

export interface CollectibleDefinition {
    /** Registry entry for the pickup's mesh — see modelsRegistry.ts. */
    readonly model: ModelDefinition;
    /** How much of the resource this pickup grants once collected. */
    readonly resourceAmount: number;
    /** Uniform scale applied to the loaded mesh — unlike the player's FBX rig (CHARACTER_SCALE = 0.0075 in MainPlayer.ts), this resource pack's GLTF props are already authored in world units, so 1 is the natural size (see pizza's own AssetLibraryRegistry.ts, which uses scale: 1-2 for these same Resources.* models). */
    readonly modelScale: number;
    /** Path under images/non-preload — e.g. "icons/money.webp". Resolve with resolveCollectibleIconPath(). Same 2D icon used by both the flying-collect effect and the HUD counter (see GameUI.ts, ControllerScene.onCollectResource()) — one source of truth per resource, matching bandit/legacy's AssetLibraryRegistry convention (one icon shared by the world drop and the currency HUD). */
    readonly icon: string;
}

export const MONEY_PILE_SMALL: CollectibleDefinition = {
    model: MODELS.Resources.MoneyPileSmall,
    resourceAmount: 10,
    modelScale: 1,
    icon: 'icons/money.webp',
};

/** Non-preload art (icons/skins) is served straight from the image pipeline's output — see public/bandit-controller/images/non-preload, same convention as CharacterViews.ts's resolveSkinImagePath(). */
const NON_PRELOAD_IMAGE_BASE = 'bandit-controller/images/non-preload/';

export function resolveCollectibleIconPath(relativePath: string): string {
    return `./${NON_PRELOAD_IMAGE_BASE}${relativePath}`;
}

export interface CollectibleTuning {
    /** Radius (world units) at which an idle pickup notices the player and starts flying to them — see Collectible's trigger RigidBody. */
    attractRadius: number;
    /** Fixed real-time seconds an attracted pickup takes to reach the player, regardless of distance or how much the player moves in the meantime — see Collectible's ArcSpline-driven homing (its own doc explains why this is a constant DURATION rather than a closing speed). */
    snapDurationSec: number;
    /** How far above the straight-line midpoint (see ArcSpline.ts) the homing arc's apex rises — world units, +Y is up here since this runs in 3D world space (contrast FlyingResourceIcon.ts's screen-space negative value). */
    arcHeight: number;
};

export const COLLECTIBLE_TUNING: CollectibleTuning = {
    attractRadius: 3,
    snapDurationSec: 0.35,
    arcHeight: 1.2,
};

/**
 * Hand-placed spawn spots for the demo's starter pickups — an evenly spaced
 * ring around PLAYER_SPAWN_POSITION (see ControllerScene), the "central
 * area" the player starts in. Kept inside the ring the runner-lane gates sit
 * outside of (RUNNER_ENTER_GATE_Z = -10, ControllerScene.ts) so nothing
 * overlaps a gate trigger.
 */
const SPAWN_RING_RADIUS = 6;
const SPAWN_RING_COUNT = 8;

export function generateCollectibleSpawnPositions(
    center: THREE.Vector3 = new THREE.Vector3(0, 0, 0),
    count: number = SPAWN_RING_COUNT,
    radius: number = SPAWN_RING_RADIUS,
): THREE.Vector3[] {
    const positions: THREE.Vector3[] = [];
    for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2;
        positions.push(new THREE.Vector3(
            center.x + Math.cos(angle) * radius,
            center.y,
            center.z + Math.sin(angle) * radius,
        ));
    }
    return positions;
}
