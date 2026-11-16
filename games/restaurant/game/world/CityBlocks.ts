// CityBlocks.ts
//
// The city's blocks, filled SimCity-style: a lawn in the layout with `buildings` on it (drawn in the editor: the block's
// outline, the kind of buildings, a seed) gets buildings along its sides, facing out to the streets round it — from
// settings.json town.city.buildings, each at its height (its width and depth from its model). The filling itself is
// web/public/cityfill.js, shared with the editor (its preview is what the game builds). They're plain props to the
// room (Room: the delivery's houses, the fading, the car's walk grid see them as any other).

import * as THREE from 'three';
import type { LayoutProp } from 'core/rooms/Room';
import { shownAt } from 'core/rooms/Room';
import { fillBlock, PoolBuilding } from '../../web/public/cityfill.js';
import { kitchenModel } from './Models';
import { SETTINGS } from '../data/Settings';
import { LAYOUT_DATA } from './RestaurantLayout';

/** The blocks (lawns with buildings) at `stage`. */
function blocksAt(stage: number) {
    return (LAYOUT_DATA.lawns ?? []).filter((lawn) => lawn.buildings && shownAt(lawn, stage, LAYOUT_DATA.areas ?? [], lawn.points[0]));
}

/** The models the blocks at `stage` can use (to load before building them). */
export function blockModels(stage: number): string[] {
    return blocksAt(stage).length ? SETTINGS.town.city?.buildings.map((b) => b.model) ?? [] : [];
}

/** The pool, each building measured at its height (its models loaded). */
function measuredPool(): PoolBuilding[] {
    return (SETTINGS.town.city?.buildings ?? []).flatMap((b) => {
        try {
            const model = kitchenModel(b.model);
            const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
            const scale = b.height / Math.max(1e-4, size.y);
            return [{ model: b.model, kind: b.kind, height: b.height, width: size.x * scale, depth: size.z * scale }];
        } catch {
            return [];
        }
    });
}

/** The buildings on the blocks at `stage`, as props (their models loaded: blockModels). */
export function blockProps(stage: number): LayoutProp[] {
    const blocks = blocksAt(stage);
    if (!blocks.length) return [];
    const pool = measuredPool();
    return blocks.flatMap((lawn) => fillBlock(lawn, pool).map((b) => ({ model: b.model, height: b.height, x: b.x, z: b.z, rotationY: b.rotationY })));
}
