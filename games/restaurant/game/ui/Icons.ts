// Icons.ts
//
// Pictures of the food for the UI (the order bubble, the ticket, the shopping list): a model rendered once, from the front
// and above, into a small transparent texture through the game's renderer, then kept. Made on first use (the model must
// be loaded: Models.loadModels). As the UFO game's Snapshots.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import SetupThree from 'core/scene/SetupThree';
import { BendService } from 'core/services/BendService';
import { kitchenModel, personModel } from '../world/Models';
import { PART_MODELS, PIZZA_LAYER_MODELS, PIZZA_SOURCE_MODELS, Part, PizzaLayer, PizzaTopping, ScoopFlavor, Sundae, SundaeSauce, SundaeTopping, pizzaRecipe } from '../data/Recipes';
import { pizzaModel, pizzaPile } from '../world/PizzaLook';
import { sauceBowlModel, scoopModel, sundaeModel, toppingSourceModel } from '../world/SundaeLook';

/** The snapshots' size (px): drawn at up to twice their size on a big screen. */
const SIZE = 320;
const cache = new Map<string, PIXI.Texture>();

/** `frame`: the part of its bounds to fill the picture with (unset: all of it; a portrait: the head and shoulders). */
function snapshot(object: THREE.Object3D, elevation: number, frame?: (box: THREE.Box3) => THREE.Box3): PIXI.Texture {
    const renderer = SetupThree.renderer;
    object.updateMatrixWorld(true);
    const whole = new THREE.Box3().setFromObject(object);
    const box = frame ? frame(whole) : whole;
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    object.position.sub(center);
    const scene = new THREE.Scene();
    scene.add(object, new THREE.AmbientLight(0xffffff, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(2, 5, 4);
    scene.add(sun);
    const radius = Math.max(size.x, size.y, size.z) * 0.58;
    const camera = new THREE.OrthographicCamera(-radius, radius, radius, -radius, 0.01, radius * 20);
    camera.position.set(0, Math.sin(elevation) * radius * 4, Math.cos(elevation) * radius * 4);
    camera.lookAt(0, 0, 0);

    const target = new THREE.WebGLRenderTarget(SIZE, SIZE, { samples: 4 });
    target.texture.colorSpace = THREE.SRGBColorSpace;
    const previousTarget = renderer.getRenderTarget();
    const previousClear = renderer.getClearColor(new THREE.Color());
    const previousAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(target);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    // No world bend in a picture: a material that's been in the bent kitchen curves down away from the bend's centre,
    // here as anywhere — the pizza's sauce dipped under its dough halfway across (a straight line through it).
    const bend = BendService.uniforms.uBendStrength.value;
    BendService.uniforms.uBendStrength.value = 0;
    renderer.render(scene, camera);
    BendService.uniforms.uBendStrength.value = bend;
    const pixels = new Uint8Array(SIZE * SIZE * 4);
    renderer.readRenderTargetPixels(target, 0, 0, SIZE, SIZE, pixels);
    renderer.setRenderTarget(previousTarget);
    renderer.setClearColor(previousClear, previousAlpha);
    target.dispose();

    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = SIZE;
    const context = canvas.getContext('2d')!;
    const image = context.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
        const source = (SIZE - 1 - y) * SIZE * 4;
        image.data.set(pixels.subarray(source, source + SIZE * 4), y * SIZE * 4);
    }
    context.putImageData(image, 0, 0);
    return PIXI.Texture.from(canvas);
}

/** Flat things (slices, buns' halves) are drawn from higher up, so their faces show. */
const FLAT = /slice|bun_bottom|burger_(un)?cooked|dough_base|tomato_sauce|grated|pieces/;

/** A model's picture, centred, `size` across. */
export function modelIcon(model: string, size: number): PIXI.Sprite {
    let texture = cache.get(model);
    if (!texture) {
        try {
            texture = snapshot(kitchenModel(model), FLAT.test(model) ? 0.85 : 0.5);
        } catch {
            texture = PIXI.Texture.WHITE;
        }
        cache.set(model, texture);
    }
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = sprite.height = size;
    return sprite;
}

/**
 * The picture of a pizza with `toppings` (the customer's order): built as the station builds it (world/PizzaLook.ts),
 * on a plate, from high up so its toppings show.
 */
export function pizzaIcon(toppings: readonly PizzaTopping[], size: number): PIXI.Sprite {
    const key = `pizza:${[...toppings].sort().join(',')}`;
    let texture = cache.get(key);
    if (!texture) {
        try {
            const dish = new THREE.Group();
            const plate = kitchenModel('plate');
            plate.scale.setScalar(2);
            const pizza = pizzaModel(pizzaRecipe(toppings));
            pizza.position.y = 0.08;
            dish.add(plate, pizza);
            texture = snapshot(dish, 1.0);
        } catch {
            texture = PIXI.Texture.WHITE;
        }
        cache.set(key, texture);
    }
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = sprite.height = size;
    return sprite;
}

/** A picture of whatever `build` makes (built and drawn once per `key`), `size` across, from `elevation` (radians) up. */
export function objectIcon(key: string, build: () => THREE.Object3D, size: number, elevation = 0.6): PIXI.Sprite {
    let texture = cache.get(key);
    if (!texture) {
        try {
            texture = snapshot(build(), elevation);
        } catch {
            texture = PIXI.Texture.WHITE;
        }
        cache.set(key, texture);
    }
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = sprite.height = size;
    return sprite;
}

/**
 * A pizza ingredient's picture, as the station shows it: the cheese and toppings as their plate piles (the ham: its
 * cubes, not a whole leg), the dough a ball, the sauce its layer.
 */
export function pizzaLayerIcon(layer: PizzaLayer, size: number): PIXI.Sprite {
    if (layer === 'dough') return modelIcon(PIZZA_SOURCE_MODELS.dough, size);
    if (layer === 'sauce') return modelIcon(PIZZA_LAYER_MODELS.sauce, size);
    return objectIcon(`pizzaPile:${layer}`, () => pizzaPile(layer), size, 0.95);
}

/** The picture of a sundae (the customer's order): built as the sundae bar builds it (world/SundaeLook.ts). */
export const sundaeIcon = (sundae: Sundae, size: number): PIXI.Sprite =>
    objectIcon(`sundae:${sundae.base}:${[...sundae.scoops].sort().join(',')}:${sundae.sauce ?? ''}:${[...sundae.toppings].sort().join(',')}`, () => sundaeModel(sundae), size, 0.45);
/** A scoop of `flavor`, a sauce's bowl, a topping's bowl (the ticket's pictures). */
export const scoopIcon = (flavor: ScoopFlavor, size: number): PIXI.Sprite => objectIcon(`scoop:${flavor}`, () => scoopModel(flavor), size, 0.5);
export const sauceIcon = (sauce: SundaeSauce, size: number): PIXI.Sprite => objectIcon(`sauce:${sauce}`, () => sauceBowlModel(sauce), size, 0.9);
export const sundaeToppingIcon = (topping: SundaeTopping, size: number): PIXI.Sprite => objectIcon(`sundaeTopping:${topping}`, () => toppingSourceModel(topping), size, 0.8);

/** A burger part's picture, or the whole burger's. */
export const foodIcon = (id: Part | 'burger', size: number): PIXI.Sprite => modelIcon(id === 'burger' ? 'food_burger' : PART_MODELS[id], size);

/**
 * A customer's portrait (person `index`, as the restaurant's customers look): their head and shoulders, from the front.
 * Drawn once per person (the models must be loaded: Models.loadModels loads the people too).
 */
export function portraitIcon(index: number, size: number): PIXI.Sprite {
    const key = `portrait:${index}`;
    let texture = cache.get(key);
    if (!texture) {
        try {
            const person = personModel(index).model;
            texture = snapshot(person, 0.12, (box) => {
                const height = box.max.y - box.min.y;
                return new THREE.Box3(new THREE.Vector3(box.min.x, box.max.y - height * 0.36, box.min.z), box.max.clone());
            });
        } catch {
            texture = PIXI.Texture.WHITE;
        }
        cache.set(key, texture);
    }
    const sprite = new PIXI.Sprite(texture);
    sprite.anchor.set(0.5);
    sprite.width = sprite.height = size;
    return sprite;
}
