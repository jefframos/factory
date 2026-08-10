// CameraFocusHost.ts
//
// Whatever an entity needs from its scene to pull the camera onto itself for
// a moment and hand control back to the player — same structural-interface
// pattern ScreenAnchorHost/MovementInputHost already use elsewhere in this
// game, so e.g. BuildingZone doesn't need to import a concrete PizzaScene
// class just to trigger a camera event. See PizzaScene.focusCameraOn() for
// the one current implementation.

import * as THREE from 'three';

export interface CameraFocusOptions {
    /** Seconds the camera takes easing from the player onto `target`. */
    travelSec?: number;
    /** Seconds the camera holds on `target` before easing back. */
    holdSec?: number;
    /** Seconds the camera takes easing back onto the (possibly since-moved) player. */
    returnSec?: number;
}

export interface CameraFocusHost {
    /**
     * Redirects the camera's existing follow behavior onto `target` instead of the player,
     * holds there, then hands follow back to the player — see PizzaScene.focusCameraOn()'s own
     * doc for how that's actually implemented. The returned promise resolves once the camera
     * is back on the player, so a caller can `await` an entire "camera visits an event, then
     * comes home" beat as one sequential step in its own async flow.
     */
    focusCameraOn(target: THREE.Vector3, options?: CameraFocusOptions): Promise<void>;
}
