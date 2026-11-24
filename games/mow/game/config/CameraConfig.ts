// CameraConfig.ts
//
// The follow camera's settings (the debug panel's Camera sliders), and what follows from the way it's turned: the
// controls (up is up the screen) and the mown stripes.

const RADIANS = Math.PI / 180;

/** A fixed orbit round the player. yaw 0 = camera south of the player looking north (-Z); 45 = south east of them. */
export const MOW_CAMERA = {
    yawDeg: 45,
    pitchDeg: 45,
    /** The field of view, vertical (degrees): narrow, so it's nearly isometric. */
    fovDeg: 15,
    /**
     * Another field of view moves the camera to match: what's round the player stays the same size (narrower = further
     * away and flatter). Off: it zooms.
     */
    keepFraming: true,
    /** As if the field of view were REFERENCE_FOV (keepFraming). */
    distance: 12,
    followSpeed: 8,
    /** How fast the distance eases to a new section's `zoom`. */
    zoomSpeed: 1.5,
};

/** The field of view `distance` was set for (keepFraming). */
const REFERENCE_FOV = 75;

/** How far the camera really is, before the zoom. */
export function cameraDistance(): number {
    const halfTan = (fov: number) => Math.tan((fov / 2) * RADIANS);
    return MOW_CAMERA.distance * (MOW_CAMERA.keepFraming ? halfTan(REFERENCE_FOV) / halfTan(MOW_CAMERA.fovDeg) : 1);
}

/** The camera's turn (radians). */
function cameraYaw(): number {
    return MOW_CAMERA.yawDeg * RADIANS;
}

/** A way on the screen (right, down) as the world's (x, z). */
export function screenToWorld(right: number, down: number): { x: number; z: number } {
    const sin = Math.sin(cameraYaw());
    const cos = Math.cos(cameraYaw());
    return { x: right * cos + down * sin, z: down * cos - right * sin };
}

/** A way in the world (x, z) as the screen's (right, down). */
export function worldToScreen(x: number, z: number): { right: number; down: number } {
    const sin = Math.sin(cameraYaw());
    const cos = Math.cos(cameraYaw());
    return { right: x * cos - z * sin, down: x * sin + z * cos };
}

