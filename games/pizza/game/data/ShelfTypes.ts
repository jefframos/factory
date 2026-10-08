// ShelfTypes.ts
//
// A SHELF — what a storage looks like when its StorageConfig.shelf names one of these: a model
// (e.g. Store.ShelfBoxes) with fixed SLOTS where items sit, instead of the crate + grid pile. The
// slot count is the storage's capacity: a 9-slot shelf holds 9 items, and the player can't drop
// off more (StorageZone). Slot positions are in the model's OWN units (before `scale`), measured
// from its pivot — e.g. shelf-boxes' lower shelf is at y 0.175, the upper one at y 0.55.
//
// `hideNodes` hides parts of the model (comma-separated node names, a trailing * = prefix) — e.g.
// the decorative cartons/boxes baked into shelf-boxes, so the real items take their place.
//
// Edited from the pizza web editor's Shelves tab (by id; a storage picks one by that id).

import MODELS, { ModelDefinition } from '../../registry/assetsRegistry/modelsRegistry';

export interface ShelfSlot {
    /** Where an item's bottom-center sits, model units (x, y, z) before `scale`. */
    position: [number, number, number];
}

export interface ShelfConfig {
    /** Display name — shown in the web editor. Optional. */
    name?: string;
    /** The shelf model — first entry used. "Group.Key" strings or MODELS.* definitions. */
    models: (string | ModelDefinition)[];
    /** x the model's own size (and its slot positions). */
    scale: number;
    /** Extra yaw (degrees), on top of the storage object's own rotation on the map. Unset = 0. */
    rotationDeg?: number;
    /** Model nodes to hide — comma-separated names, a trailing * matches a prefix (e.g. "carton*, box*"). Unset = show everything. */
    hideNodes?: string;
    /** Where items go — one per slot, filled in this order. The count is the shelf's capacity. */
    slots: ShelfSlot[];
    /** x each item's size on this shelf. Unset = the storage's own itemScale (else the carry-stack size). */
    itemScale?: number;
}

export const SHELF_CONFIG_BY_ID: Partial<Record<string, ShelfConfig>> = {
    "shelfBoxes": {
        "name": "Shelf (boxes)",
        "models": [MODELS.Store.ShelfBoxes],
        "scale": 3.5,
        "hideNodes": "carton*, box, box_*",
        "slots": [
            {
                "position": [
                    -0.204,
                    0.175,
                    -0.15
                ]
            },
            {
                "position": [
                    0,
                    0.175,
                    -0.15
                ]
            },
            {
                "position": [
                    0.204,
                    0.175,
                    -0.15
                ]
            },
            {
                "position": [
                    -0.204,
                    0.175,
                    0.15
                ]
            },
            {
                "position": [
                    0,
                    0.175,
                    0.15
                ]
            },
            {
                "position": [
                    0.204,
                    0.175,
                    0.15
                ]
            },
            {
                "position": [
                    -0.2,
                    0.55,
                    0
                ]
            },
            {
                "position": [
                    0,
                    0.55,
                    0
                ]
            },
            {
                "position": [
                    0.2,
                    0.55,
                    0
                ]
            }
        ]
    },
    "shelfEnd": {
        "name": "Shelf (end)",
        "models": [MODELS.Store.ShelfEnd],
        "scale": 3.5,
        "hideNodes": "carton*, bottle*",
        "slots": [
            {
                "position": [
                    -0.204,
                    0.175,
                    0
                ]
            },
            {
                "position": [
                    0,
                    0.175,
                    0
                ]
            },
            {
                "position": [
                    0.204,
                    0.175,
                    0
                ]
            },
            {
                "position": [
                    -0.204,
                    0.55,
                    0
                ]
            },
            {
                "position": [
                    0,
                    0.55,
                    0
                ]
            },
            {
                "position": [
                    0.204,
                    0.55,
                    0
                ]
            }
        ]
    }
};

/** The shelf with id `id` — undefined when unset or unknown (warns on unknown). */
export function getShelfConfig(id?: string): ShelfConfig | undefined {
    if (!id) {
        return undefined;
    }
    const shelf = SHELF_CONFIG_BY_ID[id];
    if (!shelf) {
        console.warn(`[ShelfTypes] shelf "${id}" doesn't exist — the storage keeps its normal look`);
    }
    return shelf;
}

/** True when node `name` matches `hideNodes` (see ShelfConfig.hideNodes). */
export function isShelfNodeHidden(shelf: ShelfConfig, name: string): boolean {
    return (shelf.hideNodes ?? '').split(',').map(entry => entry.trim()).filter(Boolean).some(pattern =>
        pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern);
}
