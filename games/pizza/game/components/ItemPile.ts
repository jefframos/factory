// ItemPile.ts
//
// A diegetic pile of resource models — the ONE system behind both the carry
// stack on the player's back (CarrierStackVisual) and a map storage's
// contents (StorageZone). One display model (see ResourceDisplayModel.ts —
// real world size, tall items laid on their side) per unit, kept in ARRIVAL
// order: a new unit goes on top, removing one of a type takes the TOPMOST of
// that type, and everything above slides down into place.
//
// Layouts (all in the pile root's LOCAL frame, from `base` — the bottom-center
// of the first item):
//   - 'grid':  maxColumns x maxRows per layer across `footprint`; layers as
//              tall as the tallest item, odd layers nudged into the gaps below.
//              Two ways to handle an item bigger than its cell (`fitToCells`):
//                false — use FEWER columns/rows, so every item keeps its size
//                        (the backpack: a big item turns the pile into a column);
//                true  — ALWAYS use exactly maxColumns x maxRows, shrinking any
//                        item that doesn't fit its cell just enough to fit (a
//                        storage: a 2x2 stays a 2x2 whatever you put in it).
//   - 'tower': one item per level, each resting on the actual top of the one below.
//   - 'slots': fixed spots (`slotPositions`), one item each, in order — a shelf (see
//              ShelfTypes.ts). The slot count is the capacity; items keep their size.
//
// Because items keep their real sizes, placement depends on every item below,
// so positions are recomputed from the live list (relayout()) whenever the
// contents change or a model finishes loading. getSlotWorldPosition() tells an
// incoming flight exactly where the NEXT item will sit; peekTop() tells an
// outgoing one which item is on top and where.
//
// A slot can be DRAWN as a different item than it counts as (layout.displayFor)
// — carried garbage counts as ResourceType.Garbage but is drawn, sized and
// stacked as the darkened item it was (see GarbageCarryStorage.ts). Layout and
// models always use the display type; sync()/peekTop() the real one.
//
// The owner feeds it: the counts to mirror (sync()), and `localPerWorld` — how
// many root-local units one world unit is (1 for an unscaled root; the backpack
// passes its own counter-scale so items stay true world size inside a scaled
// crate). Nothing here reads any storage directly.

import * as THREE from 'three';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import { disposeResourceDisplayModel, ItemOrientation, loadResourceDisplayModel, darkenResourceDisplayModel } from '../world/ResourceDisplayModel';

export type ItemPileMode = 'grid' | 'tower' | 'slots';

export interface ItemPileLayout {
    mode: ItemPileMode;
    /** Bottom-center of the first item, root-local. */
    base: THREE.Vector3;
    /** X/Z extent the grid spreads across, root-local. Ignored by 'tower'. */
    footprint: { x: number; z: number };
    maxColumns: number;
    maxRows: number;
    maxLayers: number;
    /** Grid only — see this file's own doc. */
    fitToCells: boolean;
    /** Tower mode's own cap. */
    towerMaxItems: number;
    /** 'slots' mode: each item's bottom-center, root-local, in fill order — its length is the capacity. */
    slotPositions?: THREE.Vector3[];
    /** Multiplier on every item's real world size. */
    itemScale: number;
    /**
     * Optional fixed yaw (degrees) for EVERY item — e.g. carrots all lying parallel. Unset = each
     * item gets its own scattered yaw (the natural-pile look, fine for round items like tomatoes).
     */
    itemYawDeg?: number;
    /** How each item is turned (see ResourceDisplayModel's ItemOrientation). Unset = 'lying'. */
    itemOrientation?: ItemOrientation;
    /** Per-type override of itemOrientation — undefined for a type = use itemOrientation. The carrier feeds ResourceConfig.carrierOrientation through this. */
    orientationFor?: (type: ResourceType) => ItemOrientation | undefined;
    /** Root-local units per world unit — see this file's own doc. */
    localPerWorld: number;
    /**
     * Per-type multiplier on the room an item takes in the layout (tower step, grid spacing/
     * layers) — <1 packs that type closer, without changing how big it's drawn. Unset / a type it
     * returns 1 for = unchanged. The carrier feeds ResourceConfig.carrierSpacing through this.
     */
    spacingFor?: (type: ResourceType) => number;
    /** Per-type height offset, WORLD units (negative = lower), added to where that type sits. Storages feed ResourceConfig.storageOffsetY through this. */
    offsetYFor?: (type: ResourceType) => number;
    /**
     * Draw the `ordinal`-th unit (0 = bottom-most) of `type` as another item, optionally darkened —
     * see this file's own doc. Asked once, when that unit's slot is created. undefined = drawn as itself.
     */
    displayFor?: (type: ResourceType, ordinal: number) => SlotDisplay | undefined;
}

/** See ItemPileLayout.displayFor. */
export interface SlotDisplay {
    type: ResourceType;
    /** Multiplier on the model's colors (see darkenResourceDisplayModel()). */
    darken?: number;
}

/** Vertical step between grid layers, as a fraction of the tallest item — <1 so layers nestle into each other like a real pile. */
const LAYER_STEP_FRACTION = 0.8;
/** Odd grid layers shift by this fraction of a cell so items rest in the gaps below. */
const ODD_LAYER_SHIFT = 0.25;
/** Fraction of each item's height the next tower item rests on — slightly under 1 so they read as sitting ON each other. */
const TOWER_REST_FRACTION = 0.95;
/** Max sideways wobble per tower level, as a fraction of that item's own width — deterministic per level. */
const TOWER_JITTER_FRACTION = 0.08;
/**
 * ResourceConfig.pileScale — extra DRAW scale for `type` in a pile (and on the flight into one).
 * Applied to the model only, never to layout: positions/spacing are computed from the unscaled
 * size, and the model grows from its own bottom-center, so it stays in exactly the same spot.
 */
export function getPileScale(type: ResourceType): number {
    return RESOURCE_CONFIG[type]?.pileScale ?? 1;
}

/** Stand-in size (world units) for an item whose model hasn't loaded yet and whose type was never seen before. */
const FALLBACK_ITEM_SIZE = new THREE.Vector3(0.25, 0.25, 0.25);

/**
 * Last measured (world-unit, oriented, unscaled) size per resource AND orientation — lets a layout
 * reserve the right space for an item before its own model has loaded. Shared by every pile, and
 * filled by flights too (see FlyToStack). Keyed by orientation as well since a carrot lying in the
 * backpack and one standing in a storage have very different sizes.
 */
const knownSizes = new Map<string, THREE.Vector3>();
/** Same keys — ResourceDisplayModel.restHeight: how high an item resting on this one's middle sits (world units, unscaled). */
const knownRestHeights = new Map<string, number>();

/** Record `type`'s display size (world units, oriented) and, when known, its rest height — see knownSizes. */
export function rememberItemSize(type: ResourceType, size: THREE.Vector3, orientation: ItemOrientation = 'lying', restHeight?: number): void {
    knownSizes.set(`${type}|${orientation}`, size.clone());
    if (restHeight !== undefined) {
        knownRestHeights.set(`${type}|${orientation}`, restHeight);
    }
}

function sizeOf(type: ResourceType, orientation: ItemOrientation): THREE.Vector3 {
    return knownSizes.get(`${type}|${orientation}`) ?? FALLBACK_ITEM_SIZE;
}

/** Where the top of `type`'s middle is (unscaled world units) — its bounding-box height until measured. */
function restHeightOf(type: ResourceType, orientation: ItemOrientation): number {
    return knownRestHeights.get(`${type}|${orientation}`) ?? sizeOf(type, orientation).y;
}

interface Slot {
    type: ResourceType;
    /** What it's drawn/laid out as — `type` unless layout.displayFor said otherwise. */
    displayType: ResourceType;
    darken?: number;
    /** undefined while its model is still loading (or never, past the layout's capacity). */
    model?: THREE.Group;
    /** Per-item yaw, fixed at creation so it never changes when the item slides down. */
    yaw: number;
}

export default class ItemPile {
    private readonly root: THREE.Object3D;
    private layout: ItemPileLayout;
    private readonly slots: Slot[] = [];
    private readonly loading = new Set<Slot>();
    private createdCount = 0;
    private disposed = false;

    public constructor(root: THREE.Object3D, layout: ItemPileLayout) {
        this.root = root;
        this.layout = layout;
    }

    /** How many units the pile currently holds (drawn or not). */
    public get count(): number {
        return this.slots.length;
    }

    /** Most units the current layout draws — anything past this is still counted, just not shown. */
    public get capacity(): number {
        const { mode, maxColumns, maxRows, maxLayers, towerMaxItems } = this.layout;
        if (mode === 'slots') {
            return this.layout.slotPositions?.length ?? 0;
        }
        return mode === 'tower' ? towerMaxItems : maxColumns * maxRows * maxLayers;
    }

    /** Replaces the layout and re-places everything (models are kept — only positions/scale change). */
    public setLayout(layout: ItemPileLayout): void {
        this.layout = layout;
        this.ensureModels();
        this.relayout();
    }

    public getLayout(): ItemPileLayout {
        return this.layout;
    }

    /**
     * Brings the pile in line with `counts` while keeping ARRIVAL order — see this file's own doc.
     * (A fresh pile has no arrival history, so it starts in `counts`' own iteration order.)
     */
    public sync(counts: Iterable<[ResourceType, number]>): void {
        const desired = new Map<ResourceType, number>();
        for (const [type, count] of counts) {
            if (count > 0) {
                desired.set(type, count);
            }
        }

        const current = new Map<ResourceType, number>();
        for (const slot of this.slots) {
            current.set(slot.type, (current.get(slot.type) ?? 0) + 1);
        }
        // Remove surplus per type, topmost first.
        for (const [type, have] of current) {
            let surplus = have - (desired.get(type) ?? 0);
            for (let i = this.slots.length - 1; i >= 0 && surplus > 0; i--) {
                if (this.slots[i].type === type) {
                    this.releaseSlot(this.slots[i]);
                    this.slots.splice(i, 1);
                    surplus--;
                }
            }
        }
        // Append missing units on top.
        for (const [type, want] of desired) {
            const have = this.slots.filter(slot => slot.type === type).length;
            for (let i = have; i < want; i++) {
                const display = this.layout.displayFor?.(type, i);
                this.slots.push({
                    type,
                    displayType: display?.type ?? type,
                    darken: display?.darken,
                    yaw: ((this.createdCount++ * 137) % 360) * (Math.PI / 180),
                });
            }
        }

        this.ensureModels();
        this.relayout();
    }

    /**
     * Where slot `index` will sit in WORLD space (its bottom-center), written into `out`, assuming
     * every slot from the current top up to `index` holds an `incomingType` — what an incoming
     * flight aims at. Past the layout's capacity it clamps to the last drawn slot.
     */
    public getSlotWorldPosition(index: number, incomingType: ResourceType, out: THREE.Vector3): THREE.Vector3 {
        const types = this.slots.map(slot => slot.displayType);
        while (types.length <= index) {
            types.push(incomingType);
        }
        const positions = this.computePositions(types);
        out.copy(positions.length > 0 ? positions[Math.min(Math.max(index, 0), positions.length - 1)] : this.layout.base);
        return this.toWorld(out);
    }

    /**
     * The world-size multiplier an item landing in slot `index` will be drawn at — itemScale times
     * its fit-to-cell shrink (see `fitToCells`), same assumption as getSlotWorldPosition() — so a
     * flight can end at exactly the size it lands at.
     */
    public getSlotScale(index: number, incomingType: ResourceType): number {
        const types = this.slots.map(slot => slot.displayType);
        while (types.length <= index) {
            types.push(incomingType);
        }
        const fits = this.computeFits(types);
        const slot = Math.min(Math.max(index, 0), fits.length - 1);
        return this.layout.itemScale * (fits[slot] ?? 1) * getPileScale(types[Math.max(index, 0)] ?? incomingType);
    }

    /** The TOPMOST unit whose type passes `accepts`, with its world position written into `out` — undefined if none. See this file's own doc. */
    public peekTop(accepts: (type: ResourceType) => boolean, out: THREE.Vector3): ResourceType | undefined {
        for (let i = this.slots.length - 1; i >= 0; i--) {
            if (!accepts(this.slots[i].type)) {
                continue;
            }
            const positions = this.computePositions(this.slots.map(slot => slot.displayType));
            out.copy(positions.length > 0 ? positions[Math.min(i, positions.length - 1)] : this.layout.base);
            this.toWorld(out);
            return this.slots[i].type;
        }
        return undefined;
    }

    /** Re-places every loaded model from the live list and re-applies its scale. */
    public relayout(): void {
        const { itemScale, localPerWorld } = this.layout;
        const types = this.slots.map(slot => slot.displayType);
        const positions = this.computePositions(types);
        const fits = this.computeFits(types);
        this.slots.forEach((slot, i) => {
            if (!slot.model) {
                return;
            }
            const position = positions[i];
            slot.model.visible = position !== undefined;
            if (position) {
                slot.model.position.copy(position);
            }
            // pileScale on the model only — position above came from the unscaled layout.
            slot.model.scale.setScalar(itemScale * localPerWorld * (fits[i] ?? 1) * getPileScale(slot.displayType));
            slot.model.rotation.y = this.yawFor(slot);
        });
    }

    /** How `type` is turned in this pile: the layout's per-type orientationFor() when it has one, else its itemOrientation ('lying' by default). */
    private orientationOf(type: ResourceType): ItemOrientation {
        return this.layout.orientationFor?.(type) ?? this.layout.itemOrientation ?? 'lying';
    }

    /** The layout's fixed itemYawDeg when set, else the slot's own scattered yaw. */
    private yawFor(slot: Slot): number {
        const fixed = this.layout.itemYawDeg;
        return fixed !== undefined ? THREE.MathUtils.degToRad(fixed) : slot.yaw;
    }

    public dispose(): void {
        this.disposed = true;
        for (const slot of this.slots) {
            this.releaseSlot(slot);
        }
        this.slots.length = 0;
    }

    private toWorld(localPoint: THREE.Vector3): THREE.Vector3 {
        // Parents included — see the background-tab stale-matrixWorld note in ResourceDisplayModel.ts.
        this.root.updateWorldMatrix(true, false);
        return this.root.localToWorld(localPoint);
    }

    /** Bottom-center of every entry of `types` (up to capacity), root-local — see this file's own doc. */
    private computePositions(types: ResourceType[]): THREE.Vector3[] {
        const { mode, base, footprint, maxColumns, maxRows, itemScale, localPerWorld } = this.layout;
        const toLocal = itemScale * localPerWorld;
        const sizes = this.layoutSizes(types, toLocal);
        const positions: THREE.Vector3[] = [];
        // Per-type height offset (world -> root-local).
        const offsetY = (index: number): number => (this.layout.offsetYFor?.(types[index]) ?? 0) * localPerWorld;
        // Where the top of item `index`'s MIDDLE actually is, as drawn (rest height x pileScale x
        // its fit), root-local. Not its bounding-box height: a lying carrot's box is its fat
        // shoulder, but whatever sits on it rests on its much thinner middle.
        const drawnRestHeight = (index: number, fit: number): number =>
            restHeightOf(types[index], this.orientationOf(types[index])) * toLocal * getPileScale(types[index]) * fit;
        /**
         * Height from `below`'s resting point to `above`'s (both before their own offsetY).
         *   - Same type: the layout's own spacing (layout size x rest fraction) — how a
         *     single-type pile has always stacked, spacingFor/pileScale overlap included.
         *   - Different type: rest on `below`'s real drawn top at its middle (see
         *     drawnRestHeight) — a tomato on a 2x carrot sits on the carrot, not inside it and not
         *     floating over its bounding box. Offsets are folded in so `above` rests on where
         *     `below` actually is, not where it would be without its offset.
         */
        const step = (below: number, above: number, fitBelow: number, rest: number): number => {
            if (types[below] === types[above]) {
                return sizes[below].y * fitBelow * rest;
            }
            return drawnRestHeight(below, fitBelow) * rest + offsetY(below) - offsetY(above);
        };

        if (mode === 'slots') {
            const slotPositions = this.layout.slotPositions ?? [];
            return sizes.map((_, i) => slotPositions[i].clone().setY(slotPositions[i].y + offsetY(i)));
        }

        if (mode === 'tower') {
            let y = base.y;
            sizes.forEach((size, i) => {
                if (i > 0) {
                    y += step(i - 1, i, 1, TOWER_REST_FRACTION);
                }
                // A fixed itemYawDeg means "aligned" — no wobble either, so the tower stacks perfectly straight.
                const jitter = this.layout.itemYawDeg !== undefined ? 0 : Math.max(size.x, size.z) * TOWER_JITTER_FRACTION;
                // Two incommensurate sines — cheap deterministic wobble.
                positions.push(new THREE.Vector3(base.x + Math.sin(i * 2.1) * jitter, y + offsetY(i), base.z + Math.sin(i * 3.7 + 1) * jitter));
            });
            return positions;
        }

        const { columns, rows } = this.gridShape(sizes);
        const cellX = columns > 1 ? footprint.x / columns : 0;
        const cellZ = rows > 1 ? footprint.z / rows : 0;
        const perLayer = columns * rows;
        // Heights from the FITTED sizes, so shrunk items don't leave gaps between layers.
        const fits = this.fitsFor(sizes, columns, rows);
        // Each cell stacks on its own: an item rests on the one below it in the SAME cell (see
        // step()), so a mixed pile doesn't push every layer to the tallest item's height. A
        // single-type pile comes out exactly as uniform layers, as before.
        const cellY: number[] = [];
        const cellBelow: number[] = [];
        sizes.forEach((_, i) => {
            const layer = Math.floor(i / perLayer);
            const inLayer = i % perLayer;
            const column = inLayer % columns;
            const row = Math.floor(inLayer / columns);
            const shift = layer % 2 === 1 ? ODD_LAYER_SHIFT : 0;
            const below = cellBelow[inLayer];
            const y = below === undefined ? base.y : cellY[inLayer] + step(below, i, fits[below], LAYER_STEP_FRACTION);
            cellY[inLayer] = y;
            cellBelow[inLayer] = i;
            positions.push(new THREE.Vector3(
                base.x + (column - (columns - 1) / 2 + shift) * cellX,
                y + offsetY(i),
                base.z + (row - (rows - 1) / 2 + shift) * cellZ,
            ));
        });
        return positions;
    }

    /** Columns x rows per grid layer for these (root-local) sizes — see `fitToCells` in this file's own doc. */
    private gridShape(sizes: THREE.Vector3[]): { columns: number; rows: number } {
        const { footprint, maxColumns, maxRows, fitToCells } = this.layout;
        if (fitToCells) {
            return { columns: Math.max(1, maxColumns), rows: Math.max(1, maxRows) };
        }
        let maxX = 0;
        let maxZ = 0;
        for (const size of sizes) {
            maxX = Math.max(maxX, size.x);
            maxZ = Math.max(maxZ, size.z);
        }
        return {
            columns: Math.max(1, Math.min(maxColumns, Math.floor(footprint.x / Math.max(maxX, 1e-6)))),
            rows: Math.max(1, Math.min(maxRows, Math.floor(footprint.z / Math.max(maxZ, 1e-6)))),
        };
    }

    /** Per-item shrink factor (<= 1) so each fits its grid cell — all 1 unless `fitToCells` (and always 1 for 'tower'). */
    private fitsFor(sizes: THREE.Vector3[], columns: number, rows: number): number[] {
        const { mode, footprint, fitToCells } = this.layout;
        if (mode === 'tower' || mode === 'slots' || !fitToCells) {
            return sizes.map(() => 1);
        }
        const cellX = footprint.x / columns;
        const cellZ = footprint.z / rows;
        return sizes.map(size => Math.min(1, cellX / Math.max(size.x, 1e-6), cellZ / Math.max(size.z, 1e-6)));
    }

    /** fitsFor() for the live types — what relayout() scales each model by. */
    private computeFits(types: ResourceType[]): number[] {
        const { itemScale, localPerWorld } = this.layout;
        const sizes = this.layoutSizes(types, itemScale * localPerWorld);
        const { columns, rows } = this.gridShape(sizes);
        return this.fitsFor(sizes, columns, rows);
    }

    /** Root-local size each of `types` takes in the layout: real size x `toLocal` x its spacingFor() (see ItemPileLayout.spacingFor). */
    private layoutSizes(types: ResourceType[], toLocal: number): THREE.Vector3[] {
        return types.slice(0, this.capacity).map(type =>
            sizeOf(type, this.orientationOf(type)).clone().multiplyScalar(toLocal * (this.layout.spacingFor?.(type) ?? 1)));
    }

    /** Loads a model for every slot the layout draws that has none yet (and isn't already loading). */
    private ensureModels(): void {
        this.slots.slice(0, this.capacity).forEach(slot => {
            if (slot.model || this.loading.has(slot)) {
                return;
            }
            this.loading.add(slot);
            // Captured now — a setLayout() mid-load could change it, and the size must match THIS model.
            const orientation = this.orientationOf(slot.displayType);
            void loadResourceDisplayModel(slot.displayType, { orientation }).then(({ object, size, restHeight }) => {
                this.loading.delete(slot);
                rememberItemSize(slot.displayType, size, orientation, restHeight);
                if (this.disposed || !this.slots.includes(slot)) {
                    disposeResourceDisplayModel(object);
                    return;
                }
                object.rotation.y = this.yawFor(slot);
                if (slot.darken !== undefined) {
                    darkenResourceDisplayModel(object, slot.darken);
                }
                slot.model = object;
                this.root.add(object);
                // Its real size may differ from what the layout assumed while it loaded.
                this.relayout();
            });
        });
    }

    private releaseSlot(slot: Slot): void {
        this.loading.delete(slot);
        if (slot.model) {
            disposeResourceDisplayModel(slot.model);
            slot.model = undefined;
        }
    }
}
