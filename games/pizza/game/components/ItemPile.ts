// ItemPile.ts
//
// A diegetic pile of resource models — the ONE system behind both the carry
// stack on the player's back (BackpackStackVisual) and a map storage's
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
//
// Because items keep their real sizes, placement depends on every item below,
// so positions are recomputed from the live list (relayout()) whenever the
// contents change or a model finishes loading. getSlotWorldPosition() tells an
// incoming flight exactly where the NEXT item will sit; peekTop() tells an
// outgoing one which item is on top and where.
//
// The owner feeds it: the counts to mirror (sync()), and `localPerWorld` — how
// many root-local units one world unit is (1 for an unscaled root; the backpack
// passes its own counter-scale so items stay true world size inside a scaled
// crate). Nothing here reads any storage directly.

import * as THREE from 'three';
import { ResourceType } from '../actions/ResourceTypes';
import { disposeResourceDisplayModel, loadResourceDisplayModel } from '../world/ResourceDisplayModel';

export type ItemPileMode = 'grid' | 'tower';

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
    /** Multiplier on every item's real world size. */
    itemScale: number;
    /** Root-local units per world unit — see this file's own doc. */
    localPerWorld: number;
}

/** Vertical step between grid layers, as a fraction of the tallest item — <1 so layers nestle into each other like a real pile. */
const LAYER_STEP_FRACTION = 0.8;
/** Odd grid layers shift by this fraction of a cell so items rest in the gaps below. */
const ODD_LAYER_SHIFT = 0.25;
/** Fraction of each item's height the next tower item rests on — slightly under 1 so they read as sitting ON each other. */
const TOWER_REST_FRACTION = 0.95;
/** Max sideways wobble per tower level, as a fraction of that item's own width — deterministic per level. */
const TOWER_JITTER_FRACTION = 0.08;
/** Stand-in size (world units) for an item whose model hasn't loaded yet and whose type was never seen before. */
const FALLBACK_ITEM_SIZE = new THREE.Vector3(0.25, 0.25, 0.25);

/** Last measured (world-unit, oriented, unscaled) size per resource — lets a layout reserve the right space for an item before its own model has loaded. Shared by every pile, and filled by flights too (see FlyToStack). */
const knownSizes = new Map<ResourceType, THREE.Vector3>();

/** Record `type`'s display size (world units, oriented) — see knownSizes. */
export function rememberItemSize(type: ResourceType, size: THREE.Vector3): void {
    knownSizes.set(type, size.clone());
}

function sizeOf(type: ResourceType): THREE.Vector3 {
    return knownSizes.get(type) ?? FALLBACK_ITEM_SIZE;
}

interface Slot {
    type: ResourceType;
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
                this.slots.push({ type, yaw: ((this.createdCount++ * 137) % 360) * (Math.PI / 180) });
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
        const types = this.slots.map(slot => slot.type);
        while (types.length <= index) {
            types.push(incomingType);
        }
        const positions = this.computePositions(types);
        out.copy(positions.length > 0 ? positions[Math.min(Math.max(index, 0), positions.length - 1)] : this.layout.base);
        return this.toWorld(out);
    }

    /** The TOPMOST unit whose type passes `accepts`, with its world position written into `out` — undefined if none. See this file's own doc. */
    public peekTop(accepts: (type: ResourceType) => boolean, out: THREE.Vector3): ResourceType | undefined {
        for (let i = this.slots.length - 1; i >= 0; i--) {
            if (!accepts(this.slots[i].type)) {
                continue;
            }
            const positions = this.computePositions(this.slots.map(slot => slot.type));
            out.copy(positions.length > 0 ? positions[Math.min(i, positions.length - 1)] : this.layout.base);
            this.toWorld(out);
            return this.slots[i].type;
        }
        return undefined;
    }

    /** Re-places every loaded model from the live list and re-applies its scale. */
    public relayout(): void {
        const { itemScale, localPerWorld } = this.layout;
        const types = this.slots.map(slot => slot.type);
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
            slot.model.scale.setScalar(itemScale * localPerWorld * (fits[i] ?? 1));
        });
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
        const sizes = types.slice(0, this.capacity).map(type => sizeOf(type).clone().multiplyScalar(toLocal));
        const positions: THREE.Vector3[] = [];

        if (mode === 'tower') {
            let y = base.y;
            sizes.forEach((size, i) => {
                const jitter = Math.max(size.x, size.z) * TOWER_JITTER_FRACTION;
                // Two incommensurate sines — cheap deterministic wobble.
                positions.push(new THREE.Vector3(base.x + Math.sin(i * 2.1) * jitter, y, base.z + Math.sin(i * 3.7 + 1) * jitter));
                y += size.y * TOWER_REST_FRACTION;
            });
            return positions;
        }

        const { columns, rows } = this.gridShape(sizes);
        const cellX = columns > 1 ? footprint.x / columns : 0;
        const cellZ = rows > 1 ? footprint.z / rows : 0;
        const perLayer = columns * rows;
        // Layer height from the FITTED sizes, so shrunk items don't leave gaps between layers.
        const fits = this.fitsFor(sizes, columns, rows);
        let maxY = 0;
        sizes.forEach((size, i) => {
            maxY = Math.max(maxY, size.y * fits[i]);
        });
        sizes.forEach((_, i) => {
            const layer = Math.floor(i / perLayer);
            const inLayer = i % perLayer;
            const column = inLayer % columns;
            const row = Math.floor(inLayer / columns);
            const shift = layer % 2 === 1 ? ODD_LAYER_SHIFT : 0;
            positions.push(new THREE.Vector3(
                base.x + (column - (columns - 1) / 2 + shift) * cellX,
                base.y + layer * maxY * LAYER_STEP_FRACTION,
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
        if (mode === 'tower' || !fitToCells) {
            return sizes.map(() => 1);
        }
        const cellX = footprint.x / columns;
        const cellZ = footprint.z / rows;
        return sizes.map(size => Math.min(1, cellX / Math.max(size.x, 1e-6), cellZ / Math.max(size.z, 1e-6)));
    }

    /** fitsFor() for the live types — what relayout() scales each model by. */
    private computeFits(types: ResourceType[]): number[] {
        const { itemScale, localPerWorld } = this.layout;
        const sizes = types.slice(0, this.capacity).map(type => sizeOf(type).clone().multiplyScalar(itemScale * localPerWorld));
        const { columns, rows } = this.gridShape(sizes);
        return this.fitsFor(sizes, columns, rows);
    }

    /** Loads a model for every slot the layout draws that has none yet (and isn't already loading). */
    private ensureModels(): void {
        this.slots.slice(0, this.capacity).forEach(slot => {
            if (slot.model || this.loading.has(slot)) {
                return;
            }
            this.loading.add(slot);
            void loadResourceDisplayModel(slot.type, { layDownIfTall: true }).then(({ object, size }) => {
                this.loading.delete(slot);
                rememberItemSize(slot.type, size);
                if (this.disposed || !this.slots.includes(slot)) {
                    disposeResourceDisplayModel(object);
                    return;
                }
                object.rotation.y = slot.yaw;
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
