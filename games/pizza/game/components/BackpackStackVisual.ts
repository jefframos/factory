// BackpackStackVisual.ts
//
// The carry stack on the player's back: every 'farm'-category unit in
// BackpackStorage, drawn as a diegetic ItemPile (see ItemPile.ts — the same
// system a map storage uses for its contents) inside the backpack
// (PlayerConfig.backpack — a Restaurant.Crate by default).
//
// This component only decides WHERE and HOW the pile sits, every frame:
//   - root: CharacterBody.getBackpackContents().root — the backpack's own
//     visual group, so the pile follows its offset/rotation automatically;
//   - layout: derived from the backpack model's own bounds (base half-way up
//     the crate, grid across FOOTPRINT_FILL of its floor), in
//     PlayerConfig.backpack.stackMode ('grid' | 'tower', live from the dev GUI);
//   - scale: items stay TRUE world size (x PlayerConfig.backpack.itemScale)
//     whatever the backpack's own scale, measured relative to the character
//     container so they grow with the character's landing pop (see
//     localPerWorld()).
// BackpackStorage stays the single source of truth; this mirrors it into the pile.

import * as THREE from 'three';
import Component from '../ecs/Component';
import CharacterVisualComponent from './CharacterVisualComponent';
import ItemPile, { ItemPileLayout, rememberItemSize } from './ItemPile';
import { BackpackStorage } from '../data/BackpackStorage';
import { getPlayerConfig } from '../data/PlayerConfig';
import { RESOURCE_CONFIG, ResourceType } from '../actions/ResourceTypes';
import { CHARACTER_SCALE } from '../player/MainPlayer';

// --- 'grid' mode ---
const MAX_COLUMNS = 3;
const MAX_ROWS = 3;
const MAX_LAYERS = 3;
/** Fraction of the backpack's X/Z footprint the grid spans — leaves the crate's walls visible around the pile. */
const FOOTPRINT_FILL = 0.8;
// --- 'tower' mode ---
/** Most items the tower shows before it stops growing (the rest are still counted, just not drawn). */
const TOWER_MAX_ITEMS = 15;
/** Both modes: where the first item's BOTTOM sits, as a fraction of the backpack's own height — low enough to sit inside the crate, high enough to peek over the rim. */
const BASE_HEIGHT_FRACTION = 0.5;

/** Kept for FlyToStack — see ItemPile.rememberItemSize(). */
export const rememberStackItemSize = rememberItemSize;

/** PlayerConfig.backpack.itemScale, read live (the dev GUI slider writes straight into the config) — see that field's own doc. Also used by FlyToStack/StorageZone so a flight matches the landing size. */
export function stackItemScale(): number {
    const scale = getPlayerConfig().backpack.itemScale;
    return scale !== undefined && scale > 0 ? scale : 1;
}

export default class BackpackStackVisual extends Component {
    private pile?: ItemPile;
    /** The backpack root the pile is parented under — a remount (new root) rebuilds the pile. */
    private attachedRoot?: THREE.Object3D;
    private dirty = true;

    private readonly scratchScale = new THREE.Vector3();
    private readonly scratchContainerScale = new THREE.Vector3();

    private readonly handleBackpackChanged = (type: ResourceType): void => {
        if (RESOURCE_CONFIG[type]?.category === 'farm') {
            this.dirty = true;
        }
    };

    public awake(): void {
        BackpackStorage.onChange.add(this.handleBackpackChanged);
    }

    public update(): void {
        const contents = this.entity.getComponent(CharacterVisualComponent)?.character.getBackpackContents();
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

        // Mode / itemScale / backpack scale can all change live (dev GUI) — cheap to compare.
        const layout = this.buildLayout(contents.bounds);
        const current = pile.getLayout();
        if (layout.mode !== current.mode || layout.itemScale !== current.itemScale || Math.abs(layout.localPerWorld - current.localPerWorld) > 1e-6) {
            pile.setLayout(layout);
        }

        if (this.dirty) {
            this.dirty = false;
            pile.sync(farmCounts());
        }
    }

    public destroy(): void {
        BackpackStorage.onChange.remove(this.handleBackpackChanged);
        this.pile?.dispose();
        this.pile = undefined;
    }

    /** Where stack slot `index` will sit in world space — see ItemPile.getSlotWorldPosition(). undefined until the backpack model exists. */
    public getSlotWorldTarget(index: number, incomingType: ResourceType, out: THREE.Vector3): THREE.Vector3 | undefined {
        return this.pile?.getSlotWorldPosition(index, incomingType, out);
    }

    /** The topmost stacked item `accepts` takes, and where it is — see ItemPile.peekTop(). Removing that unit from BackpackStorage then removes exactly this item. */
    public peekTop(accepts: (type: ResourceType) => boolean, out: THREE.Vector3): ResourceType | undefined {
        return this.pile?.peekTop(accepts, out);
    }

    private buildLayout(bounds: THREE.Box3): ItemPileLayout {
        const backpack = getPlayerConfig().backpack;
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
            localPerWorld: this.localPerWorld(),
        };
    }

    /**
     * Backpack-root-local units per world unit, AS IF the character were at its normal
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
        const container = this.entity.getComponent(CharacterVisualComponent)?.character.container;
        let rootScale = this.scratchScale.x || 1;
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
