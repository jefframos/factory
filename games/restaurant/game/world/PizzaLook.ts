// PizzaLook.ts
//
// What a pizza looks like, layer by layer — the same for the one made at the oven (world/Pizza.ts) and the picture of the
// one a customer orders (ui/Icons.ts pizzaIcon). The kit's pizza layers (the sauce, the grated cheese, pepperoni slices,
// mushroom pieces) stack on the dough base as they are; the other toppings (onion rings, tomato slices, pickle slices)
// are a few small pieces scattered over the cheese, always in the same spots (so the picture matches the pizza).
// Sizes are the kit's: the dough base is 1.75 across.

import * as THREE from 'three';
import { kitchenModel } from './Models';
import { PIZZA_LAYER_MODELS, PizzaLayer } from '../data/Recipes';

/** Scattered toppings: how many pieces, each one's size (x its model), how high (over the cheese), how far out. */
const SCATTER: Partial<Record<PizzaLayer, { count: number; scale: number; turn: number }>> = {
    onion: { count: 6, scale: 0.42, turn: 0 },
    tomato: { count: 5, scale: 0.42, turn: 0.6 },
    pickles: { count: 6, scale: 0.5, turn: 1.1 },
};
const SCATTER_Y = 0.235;
const SCATTER_RADII = [0.5, 0.22, 0.56];

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
