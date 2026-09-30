// CarrierStackVisual.ts
//
// The carry stack on the player's back: every 'farm'-category unit in
// BackpackStorage, drawn as a diegetic ItemPile (see ItemPile.ts — the same
// system a map storage uses for its contents) inside the carrier
// (PlayerConfig.carrier — a Restaurant.Crate by default).
//
// This component only decides WHERE and HOW the pile sits, every frame:
//   - root: CharacterBody.getCarrierContents().root — the carrier's own
//     visual group, so the pile follows its offset/rotation automatically;
//   - layout: derived from the carrier model's own bounds (base half-way up
//     the crate, grid across FOOTPRINT_FILL of its floor), in
//     PlayerConfig.carrier.stackMode ('grid' | 'tower', live from the dev GUI);
//   - scale: items stay TRUE world size (x PlayerConfig.carrier.itemScale)
//     whatever the carrier's own scale, measured relative to the character
//     container so they grow with the character's landing pop (see
//     localPerWorld()).
// BackpackStorage stays the single source of truth; this mirrors it into the pile.
//
// Pass a CarrierStackSource to drive the same stack for someone else — a store
// restocker worker (store/StoreRestockerWorker.ts) with its own body and its
// own carried counts; it calls markDirty() whenever those change.

import * as THREE from 'three';
import Component from '../ecs/Component';
import CharacterVisualComponent from './CharacterVisualComponent';
import ItemPile, { ItemPileLayout, rememberItemSize } from './ItemPile';
import { BackpackStorage } from '../data/BackpackStorage';
import { getPlayerConfig } from '../data/PlayerConfig';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import { CHARACTER_SCALE } from '../player/MainPlayer';
import type CharacterBody from '../entities/CharacterBody';

/** The two things this component needs from whoever wears the carrier — a CharacterBody, or the player's own ThirdPersonCharacter. */
type CarrierWearer = Pick<CharacterBody, 'getCarrierContents' | 'container'>;

/** What a non-player carrier stack reads — see this file's own doc. */
export interface CarrierStackSource {
    /** The character wearing the carrier — undefined while still loading. */
    getBody(): CarrierWearer | undefined;
    /** What's on the stack, in draw order. */
    getCounts(): Iterable<[ResourceType, number]>;
}

// --- 'grid' mode ---
const MAX_COLUMNS = 3;
const MAX_ROWS = 3;
const MAX_LAYERS = 3;
/** Fraction of the carrier's X/Z footprint the grid spans — leaves the crate's walls visible around the pile. */
const FOOTPRINT_FILL = 0.8;
// --- 'tower' mode ---
/** Most items the tower shows before it stops growing (the rest are still counted, just not drawn). */
const TOWER_MAX_ITEMS = 15;
/** Both modes: where the first item's BOTTOM sits, as a fraction of the carrier's own height — low enough to sit inside the crate, high enough to peek over the rim. */
const BASE_HEIGHT_FRACTION = 0.5;

/** Kept for FlyToStack — see ItemPile.rememberItemSize(). */
export const rememberStackItemSize = rememberItemSize;

/** PlayerConfig.carrier.itemScale, read live (the dev GUI slider writes straight into the config) — see that field's own doc. Also used by FlyToStack/StorageZone so a flight matches the landing size. */
export function stackItemScale(): number {
    const scale = getPlayerConfig().carrier.itemScale;
    return scale !== undefined && scale > 0 ? scale : 1;
}

export default class CarrierStackVisual extends Component {
    private pile?: ItemPile;
    /** The carrier root the pile is parented under — a remount (new root) rebuilds the pile. */
    private attachedRoot?: THREE.Object3D;
    private dirty = true;
    private readonly source?: CarrierStackSource;

    /** Omit `source` for the player's own stack (BackpackStorage + CharacterVisualComponent). */
    public constructor(source?: CarrierStackSource) {
        super();
        this.source = source;
    }

    /** A CarrierStackSource's counts changed — re-sync the pile next update. */
    public markDirty(): void {
        this.dirty = true;
    }

    private readonly scratchScale = new THREE.Vector3();
    private readonly scratchContainerScale = new THREE.Vector3();

    private readonly handleBackpackChanged = (type: ResourceType): void => {
        if (RESOURCE_CONFIG[type]?.category === 'farm') {
            this.dirty = true;
        }
    };

    public awake(): void {
        if (!this.source) {
            BackpackStorage.onChange.add(this.handleBackpackChanged);
        }
    }

    private getBody(): CarrierWearer | undefined {
        return this.source ? this.source.getBody() : this.entity.getComponent(CharacterVisualComponent)?.character;
    }

    public update(): void {
        const contents = this.getBody()?.getCarrierContents();
        if (!contents) {
            return; // backpack model still loading — try again next frame
        }
        if (contents.root !== this.attachedRoot) {
            this.pile?.dispose();
            this.attachedRoot = contents.root;
            this.pile = new ItemPile(contents.root, this.buildLayout(contents.bounds));
            this.dirty = true;
        }
        const pile = this.pile!;

        // Mode / itemScale / carrier scale can all change live (dev GUI) — cheap to compare.
        const layout = this.buildLayout(contents.bounds);
        const current = pile.getLayout();
        if (layout.mode !== current.mode || layout.itemScale !== current.itemScale || layout.itemYawDeg !== current.itemYawDeg || Math.abs(layout.localPerWorld - current.localPerWorld) > 1e-6) {
            pile.setLayout(layout);
        }

        if (this.dirty) {
            this.dirty = false;
            pile.sync(this.source ? this.source.getCounts() : farmCounts());
        }
    }

    public destroy(): void {
        BackpackStorage.onChange.remove(this.handleBackpackChanged);
        this.pile?.dispose();
        this.pile = undefined;
    }

    /** Where stack slot `index` will sit in world space — see ItemPile.getSlotWorldPosition(). undefined until the carrier model exists. */
    public getSlotWorldTarget(index: number, incomingType: ResourceType, out: THREE.Vector3): THREE.Vector3 | undefined {
        return this.pile?.getSlotWorldPosition(index, incomingType, out);
    }

    /** The topmost stacked item `accepts` takes, and where it is — see ItemPile.peekTop(). Removing that unit from BackpackStorage then removes exactly this item. */
    public peekTop(accepts: (type: ResourceType) => boolean, out: THREE.Vector3): ResourceType | undefined {
        return this.pile?.peekTop(accepts, out);
    }

    private buildLayout(bounds: THREE.Box3): ItemPileLayout {
        const backpack = getPlayerConfig().carrier;
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        return {
            mode: backpack.stackMode,
            base: new THREE.Vector3(center.x, bounds.min.y + size.y * BASE_HEIGHT_FRACTION, center.z),
            footprint: { x: size.x * FOOTPRINT_FILL, z: size.z * FOOTPRINT_FILL },
            maxColumns: MAX_COLUMNS,
            maxRows: MAX_ROWS,
            maxLayers: MAX_LAYERS,
            // Keep every item true size — a big item just means fewer per layer (the look you liked).
            fitToCells: false,
            towerMaxItems: TOWER_MAX_ITEMS,
            itemScale: stackItemScale(),
            itemYawDeg: backpack.itemYawDeg,
            localPerWorld: this.localPerWorld(),
            // Per-resource packing on the back (e.g. carrots closer) — ResourceConfig.carrierSpacing.
            spacingFor: type => RESOURCE_CONFIG[type]?.carrierSpacing ?? 1,
            // Per-resource turn on the back (e.g. corn laid on its side) — ResourceConfig.carrierOrientation.
            orientationFor: type => RESOURCE_CONFIG[type]?.carrierOrientation,
        };
    }

    /**
     * Carrier-root-local units per world unit, AS IF the character were at its normal
     * CHARACTER_SCALE — measured relative to the character's own container, not straight off the
     * live world scale. The character "pops" in from scale 0 (see MainPlayer.playLandingPop());
     * against the live value items would hold full world size while the character around them is
     * still tiny. Relative to the container, they grow with the character and settle at true size.
     */
    private localPerWorld(): number {
        const root = this.attachedRoot;
        if (!root) {
            return 1;
        }
        // Parents included — see the background-tab stale-matrixWorld note in ResourceDisplayModel.ts.
        root.updateWorldMatrix(true, false);
        root.getWorldScale(this.scratchScale);
        let rootScale = this.scratchScale.x || 1;
        // A source's character (an NPC) has no landing pop and its own scale — its live world scale is right as-is.
        const container = this.source ? undefined : this.getBody()?.container;
        if (container) {
            container.getWorldScale(this.scratchContainerScale);
            if (this.scratchContainerScale.x < 1e-9) {
                // Character fully collapsed (start of the pop) — keep whatever was applied last.
                return this.pile?.getLayout().localPerWorld ?? 1;
            }
            rootScale = (this.scratchScale.x / this.scratchContainerScale.x) * CHARACTER_SCALE;
        }
        return 1 / rootScale;
    }
}

/** Every 'farm'-category count in BackpackStorage, in ResourceType declaration order. */
function farmCounts(): [ResourceType, number][] {
    return Object.values(ResourceType)
        .filter(type => RESOURCE_CONFIG[type]?.category === 'farm')
        .map(type => [type, BackpackStorage.getCount(type)]);
}
