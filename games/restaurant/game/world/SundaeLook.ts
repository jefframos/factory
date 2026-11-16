// SundaeLook.ts
//
// What a sundae looks like — the same for the one made at the sundae bar (world/Sundae.ts) and the picture of the one a
// customer orders (ui/Icons.ts sundaeIcon). KayKit's ice cream bits: a cone or a bowl, scoops (its vanilla, chocolate
// and strawberry balls; mint, blueberry and mango are its vanilla ball tinted), a sauce (a coat over the scoops: a
// scoop, squashed and tinted the sauce's colour), and toppings — a cherry on top, a cookie stick and a waffle stuck in,
// sprinkles scattered over the top scoop (little capsules, always in the same spots). In the kit's own units.

import * as THREE from 'three';
import { kitchenModel } from './Models';
import { SAUCE_COLORS, SCOOP_MODEL, SCOOP_TINTS, ScoopFlavor, Sundae, SundaeSauce, SundaeTopping, SUNDAE_TOPPING_SOURCES, TUB_FILL_MODEL } from '../data/Recipes';

/** The scoop model's size (the kit's: 0.45 across, 0.36 tall); on a cone, a little smaller (x). */
const SCOOP = { width: 0.45, height: 0.36, onCone: 0.92 };
/** On a cone: the first scoop's bottom, then each next one this much higher. In a bowl: where up to three sit. */
const CONE_STACK = { first: 0.4, step: 0.27 };
const BOWL_SPOTS: [number, number, number][][] = [
    [[0, 0.1, 0]],
    [[-0.15, 0.1, 0], [0.15, 0.1, 0]],
    [[-0.15, 0.1, 0.06], [0.15, 0.1, 0.06], [0, 0.3, -0.05]],
];
const SPRINKLE_COLORS = ['#ff5fa2', '#ffd23f', '#4fc3ff', '#ffffff', '#6be36b', '#b07cff'];
const SPRINKLES = 16;

/** A copy of `model` with its colours multiplied by `tint` (its own materials). */
function tinted(model: THREE.Object3D, tint: string): THREE.Object3D {
    const color = new THREE.Color(tint);
    const recolor = (m: THREE.Material) => {
        const copy = m.clone() as THREE.MeshStandardMaterial;
        copy.color?.multiply(color);
        return copy;
    };
    model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = Array.isArray(mesh.material) ? mesh.material.map(recolor) : recolor(mesh.material);
    });
    return model;
}

/** One scoop of `flavor` (its bottom at 0). */
export function scoopModel(flavor: ScoopFlavor): THREE.Object3D {
    const model = kitchenModel(SCOOP_MODEL(flavor));
    const tint = SCOOP_TINTS[flavor];
    return tint ? tinted(model, tint) : model;
}

/** A tub of `flavor` (the kit's container, its ice cream in it; its bottom at 0). */
export function tubModel(flavor: ScoopFlavor): THREE.Object3D {
    const group = new THREE.Group();
    const tub = kitchenModel('icecream_container');
    const fill = kitchenModel(TUB_FILL_MODEL(flavor));
    // The fill sits in the tub as the kit has them (same origin), both lifted so the tub's bottom is at 0.
    tub.children[0].position.y = 0.2;
    fill.children[0].position.y = 0.2;
    const tint = SCOOP_TINTS[flavor];
    group.add(tub, tint ? tinted(fill, tint) : fill);
    return group;
}

/** A sauce's bowl on the bar (a bowl, the sauce in it). */
export function sauceBowlModel(sauce: SundaeSauce): THREE.Object3D {
    const group = new THREE.Group();
    group.add(kitchenModel('bowl'));
    // The disc painted the sauce's own colour (not tinted: the kit's disc is tomato red, and any tint over it stays red).
    const sauceDisc = kitchenModel('food_ingredient_tomato_sauce');
    const paint = new THREE.MeshStandardMaterial({ color: SAUCE_COLORS[sauce], roughness: 0.35 });
    sauceDisc.traverse((child) => {
        if ((child as THREE.Mesh).isMesh) (child as THREE.Mesh).material = paint;
    });
    sauceDisc.scale.setScalar(0.5);
    sauceDisc.position.y = 0.17;
    group.add(sauceDisc);
    return group;
}

/** Sprinkles: little coloured capsules (shared geometry and materials). */
const sprinkleGeometry = new THREE.CapsuleGeometry(0.014, 0.05, 2, 6);
const sprinkleMaterials = SPRINKLE_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.5 }));

/** `count` sprinkles over a dome of `radius` round `center` (always in the same spots). */
function sprinkles(center: THREE.Vector3, radius: number, count = SPRINKLES): THREE.Group {
    const group = new THREE.Group();
    for (let i = 0; i < count; i++) {
        // A golden-angle spiral over the dome's top half.
        const up = 1 - (i + 0.5) / count * 0.75;
        const around = i * 2.399963;
        const side = Math.sqrt(1 - up * up);
        const sprinkle = new THREE.Mesh(sprinkleGeometry, sprinkleMaterials[i % sprinkleMaterials.length]);
        sprinkle.position.set(center.x + Math.cos(around) * side * radius, center.y + up * radius, center.z + Math.sin(around) * side * radius);
        sprinkle.rotation.set(around, i * 1.3, Math.PI / 2);
        group.add(sprinkle);
    }
    return group;
}

/** A topping's bowl on the bar (the kit's bowls of cherries, cookie sticks, waffles; sprinkles: an empty one, filled). */
export function toppingSourceModel(topping: SundaeTopping): THREE.Object3D {
    const model = kitchenModel(SUNDAE_TOPPING_SOURCES[topping]);
    if (topping !== 'sprinkles') return model;
    const group = new THREE.Group();
    group.add(model, sprinkles(new THREE.Vector3(0, 0.12, 0), 0.3, 40));
    return group;
}

/** A sundae as it's made so far (`sundae`, its base possibly null: nothing yet), in the kit's units, its bottom at 0. */
export function sundaeModel(sundae: { base: Sundae['base'] | null; scoops: readonly ScoopFlavor[]; sauce: SundaeSauce | null; toppings: readonly SundaeTopping[] }): THREE.Group {
    const group = new THREE.Group();
    if (!sundae.base) return group;
    group.add(kitchenModel(sundae.base === 'cone' ? 'icecream_cone' : 'icecream_bowl'));
    const cone = sundae.base === 'cone';
    const scale = cone ? SCOOP.onCone : 1;
    const spots: THREE.Vector3[] = sundae.scoops.map((_, k) => cone
        ? new THREE.Vector3(0, CONE_STACK.first + k * CONE_STACK.step, 0)
        : new THREE.Vector3(...(BOWL_SPOTS[Math.min(sundae.scoops.length, 3) - 1][Math.min(k, 2)])));
    sundae.scoops.forEach((flavor, k) => {
        const scoop = scoopModel(flavor);
        scoop.scale.setScalar(scale);
        scoop.position.copy(spots[k]);
        group.add(scoop);
    });
    if (!spots.length) return group;
    // The top scoop (the toppings go on it); a cone's sauce coats only it, a bowl's all of them.
    const top = spots.reduce((high, p) => (p.y > high.y ? p : high), spots[0]);
    const topCenter = top.clone().add(new THREE.Vector3(0, (SCOOP.height * scale) / 2, 0));
    const apex = top.clone().add(new THREE.Vector3(0, SCOOP.height * scale, 0));
    if (sundae.sauce) {
        for (const spot of cone ? [top] : spots) {
            const coat = tinted(kitchenModel(SCOOP_MODEL('vanilla')), SAUCE_COLORS[sundae.sauce]);
            coat.scale.set(scale * 1.07, scale * 0.6, scale * 1.07);
            coat.position.copy(spot).add(new THREE.Vector3(0, SCOOP.height * scale * 0.45, 0));
            group.add(coat);
        }
    }
    for (const topping of sundae.toppings) {
        if (topping === 'cherry') {
            const cherry = kitchenModel('icecream_cherry');
            cherry.position.copy(apex).add(new THREE.Vector3(0, -0.05, 0));
            group.add(cherry);
        } else if (topping === 'cookie') {
            const stick = kitchenModel('icecream_cookiestick');
            stick.position.copy(apex).add(new THREE.Vector3(0.1, -0.2, 0.03));
            stick.rotation.z = -0.4;
            group.add(stick);
        } else if (topping === 'waffle') {
            const waffle = kitchenModel('icecream_waffle');
            waffle.scale.setScalar(0.55);
            waffle.position.copy(apex).add(new THREE.Vector3(-0.11, -0.16, -0.06));
            waffle.rotation.set(Math.PI / 2 - 0.25, 0, 0.35);
            group.add(waffle);
        } else {
            group.add(sprinkles(topCenter, ((SCOOP.width * scale) / 2) * (sundae.sauce ? 1.07 : 1.0)));
        }
    }
    return group;
}
