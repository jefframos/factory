// PizzaLook.ts
//
// What a pizza looks like, layer by layer — the same for the one made at the oven (world/Pizza.ts) and the picture of the
// one a customer orders (ui/Icons.ts pizzaIcon). The kit's pizza layers (the sauce, the grated cheese, pepperoni slices,
// mushroom pieces) stack on the dough base as they are; the other toppings (onion rings, tomato slices, pickle slices)
// are a few small pieces scattered over the cheese, always in the same spots (so the picture matches the pizza).
// Sizes are the kit's: the dough base is 1.75 across.

import * as THREE from 'three';
import { kitchenModel } from './Models';
import { PIZZA_LAYER_MODELS, PIZZA_SOURCE_MODELS, PizzaLayer } from '../data/Recipes';

/** Scattered toppings: how many pieces, each one's size (x its model), how high (over the cheese), how far out. */
const SCATTER: Partial<Record<PizzaLayer, { count: number; scale: number; turn: number }>> = {
    onion: { count: 6, scale: 0.42, turn: 0 },
    tomato: { count: 5, scale: 0.42, turn: 0.6 },
    pickles: { count: 6, scale: 0.5, turn: 1.1 },
    ham: { count: 7, scale: 1.0, turn: 0.3 },
    broccoli: { count: 6, scale: 0.75, turn: 0.9 },
    pineapple: { count: 7, scale: 0.9, turn: 1.6 },
    fish: { count: 4, scale: 0.5, turn: 0.2 },
};
const SCATTER_Y = 0.235;
const SCATTER_RADII = [0.5, 0.22, 0.56];

/** Whether `layer` goes on a pizza as scattered pieces (its model's one piece: a slice, a chunk, a floret). */
export const scatteredLayer = (layer: PizzaLayer): boolean => Boolean(SCATTER[layer]);

/** One layer of a pizza, at its place on the dough base (the pizza's own units). */
export function pizzaLayerModel(layer: PizzaLayer): THREE.Object3D {
    const scatter = SCATTER[layer];
    if (!scatter) {
        const model = kitchenModel(PIZZA_LAYER_MODELS[layer]);
        // The kit's layers sit at their own heights over the dough base: kept (not put down at 0).
        model.children[0].position.y = 0;
        return model;
    }
    const group = new THREE.Group();
    group.name = layer;
    for (let i = 0; i < scatter.count; i++) {
        const piece = kitchenModel(PIZZA_LAYER_MODELS[layer]);
        const angle = scatter.turn + (i / scatter.count) * Math.PI * 2;
        const radius = SCATTER_RADII[i % SCATTER_RADII.length];
        piece.scale.setScalar(scatter.scale);
        piece.position.set(Math.cos(angle) * radius, SCATTER_Y, Math.sin(angle) * radius);
        piece.rotation.y = angle * 2.3;
        group.add(piece);
    }
    return group;
}

/** A whole pizza (its layers, bottom up), in its own units. */
export function pizzaModel(layers: readonly PizzaLayer[]): THREE.Group {
    const group = new THREE.Group();
    for (const layer of layers) group.add(pizzaLayerModel(layer));
    return group;
}

/**
 * A pile (as the burger station's): its plate this big across; a piece's size and how many (slices, chunks...), or a
 * small whole one's and how many; how far round the middle they lie, how high the top one sits.
 */
const PILE = { plate: 0.6, piece: 0.2, pieces: 5, wholeSize: 0.24, whole: 3, spread: 0.13, stack: 0.07 };

/**
 * A plate with a few of `layer` on it, a little heap (as the burger station's piles): its pieces where it goes on a pizza
 * as pieces (slices, cubes, chunks, florets, little fish), else a few small whole ones. The station's source for it, and
 * the picture of it on a ticket or an order (the same thing, so they look alike).
 */
export function pizzaPile(layer: PizzaLayer): THREE.Object3D {
    const holder = new THREE.Group();
    const plate = kitchenModel('plate');
    const plateSize = new THREE.Box3().setFromObject(plate).getSize(new THREE.Vector3());
    plate.scale.setScalar(PILE.plate / Math.max(plateSize.x, plateSize.z, 1e-3));
    holder.add(plate);
    const top = plateSize.y * plate.scale.x * 0.6;
    const pieces = scatteredLayer(layer);
    const name = pieces ? PIZZA_LAYER_MODELS[layer] : PIZZA_SOURCE_MODELS[layer];
    const count = pieces ? PILE.pieces : PILE.whole;
    for (let i = 0; i < count; i++) {
        const piece = kitchenModel(name);
        const size = new THREE.Box3().setFromObject(piece).getSize(new THREE.Vector3());
        piece.scale.setScalar((pieces ? PILE.piece : PILE.wholeSize) / Math.max(size.x, size.z, 1e-3));
        // Round the plate's middle, the last one on top of the others.
        const last = i === count - 1 && count > 2;
        const angle = (i / Math.max(1, count - (last ? 1 : 0))) * Math.PI * 2 + 0.5;
        const r = last ? 0 : PILE.spread;
        piece.position.set(Math.cos(angle) * r, top + (last ? PILE.stack : 0), Math.sin(angle) * r);
        piece.rotation.y = angle * 1.7;
        holder.add(piece);
    }
    return holder;
}
