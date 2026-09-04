// CameraTemplateTypes.ts
//
// Named camera setting presets ("templates") — free-id partialRecord, same shape as
// CraftTypes.ts's CRAFT_CONFIG_BY_ID, editable from the pizza web editor's "Camera Templates"
// tab. A zone (see ZoneTypes.ts's own `cameraTemplateId`) can point at one of these by id;
// PizzaScene lerps its live CAMERA_SETTINGS toward whichever template is active whenever the
// player crosses into a zone whose resolved template differs from the current one (see
// PizzaScene.ts's own applyCameraTemplateForZone()).
//
// DEFAULT_CAMERA_TEMPLATE_ID names the one used for every zone that doesn't set its own — always
// expected to exist (getCameraTemplate() falls back to it even if a zone's own cameraTemplateId
// is stale/typo'd), seeded below with the exact values PizzaScene's CAMERA_SETTINGS used to be
// hardcoded as, so nothing changes for a zone that doesn't opt into a template of its own.

export interface CameraTemplateConfig {
    /** Degrees the camera is rotated off the player's own forward axis, around Y. */
    yawDeg: number;
    /** Degrees the camera looks down from directly behind the player (90 = straight top-down). */
    pitchDeg: number;
    /** How far back the camera sits from its follow target. */
    distance: number;
    /** Exponential follow-ease rate (see PizzaScene.ts's own fixedUpdate()) — higher = snappier. */
    followSpeed: number;
}

/** ZoneConfigEntry.cameraTemplateId's fallback when a zone doesn't set its own — see this file's own doc. Always expected to exist in CAMERA_TEMPLATE_CONFIG. */
export const DEFAULT_CAMERA_TEMPLATE_ID = 'default';

export const CAMERA_TEMPLATE_CONFIG: Partial<Record<string, CameraTemplateConfig>> = {
    default: {
        yawDeg: 0,
        pitchDeg: 45,
        distance: 12,
        followSpeed: 10,
    },
    "far1": {
        "yawDeg": 0,
        "pitchDeg": 45,
        "distance": 16,
        "followSpeed": 10
    },
    "close1": {
        "yawDeg": 0,
        "pitchDeg": 45,
        "distance": 10,
        "followSpeed": 10
    },
    "far2": {
        "yawDeg": 0,
        "pitchDeg": 50,
        "distance": 20,
        "followSpeed": 10
    }
};

/** Resolves `id` to its own template, falling back to DEFAULT_CAMERA_TEMPLATE_ID if `id` is unset OR doesn't match any real entry (a zone's cameraTemplateId pointing at a since-deleted/typo'd template shouldn't crash the camera, just degrade to the default look). */
export function getCameraTemplate(id: string | undefined): CameraTemplateConfig {
    const resolved = (id && CAMERA_TEMPLATE_CONFIG[id]) || CAMERA_TEMPLATE_CONFIG[DEFAULT_CAMERA_TEMPLATE_ID];
    if (!resolved) {
        throw new Error(`[CameraTemplateTypes] CAMERA_TEMPLATE_CONFIG is missing its own "${DEFAULT_CAMERA_TEMPLATE_ID}" entry — every zone's camera depends on this one always existing`);
    }
    return resolved;
}
