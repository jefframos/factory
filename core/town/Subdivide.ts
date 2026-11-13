// Subdivide.ts
//
// Cuts a flat model's triangles small enough to curve with a world bend (road tiles, lawns). Each copy of a model at one
// scale shares the result, since a town lays dozens of each tile. (From the UFO game's copy, shared.)

import * as THREE from 'three';

/** The longest edge left (world units). */
const MAX_EDGE = 1;
const cache = new Map<string, THREE.BufferGeometry>();

/** Splits each triangle on its longest edge until none is over MAX_EDGE at `scale`, every attribute interpolated. */
function subdivide(source: THREE.BufferGeometry, scale: THREE.Vector3): THREE.BufferGeometry {
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    const names = Object.keys(geometry.attributes);
    const attributes = names.map((name) => geometry.getAttribute(name));
    // Read through the attribute, not its array: a compressed model's are quantized, and often interleaved.
    type Vertex = number[][];
    const read = (i: number): Vertex => attributes.map((a) => Array.from({ length: a.itemSize }, (_, k) => a.getComponent(i, k)));
    const mid = (a: Vertex, b: Vertex): Vertex => a.map((values, n) => values.map((v, k) => (v + b[n][k]) / 2));
    const position = names.indexOf('position');
    const length = (a: Vertex, b: Vertex) => Math.hypot(
        (a[position][0] - b[position][0]) * scale.x, (a[position][1] - b[position][1]) * scale.y, (a[position][2] - b[position][2]) * scale.z);
    const out: Vertex[] = [];
    const stack: Vertex[][] = [];
    for (let i = 0; i < geometry.getAttribute('position').count; i += 3) stack.push([read(i), read(i + 1), read(i + 2)]);
    while (stack.length) {
        const [a, b, c] = stack.pop()!;
        const edges = [length(a, b), length(b, c), length(c, a)];
        const longest = edges.indexOf(Math.max(...edges));
        if (edges[longest] <= MAX_EDGE) {
            out.push(a, b, c);
            continue;
        }
        const [p, q, r] = longest === 0 ? [a, b, c] : longest === 1 ? [b, c, a] : [c, a, b];
        const m = mid(p, q);
        stack.push([p, m, r], [m, q, r]);
    }
    const result = new THREE.BufferGeometry();
    names.forEach((name, n) => {
        const size = attributes[n].itemSize;
        const array = new Float32Array(out.length * size);
        out.forEach((vertex, i) => array.set(vertex[n], i * size));
        result.setAttribute(name, new THREE.BufferAttribute(array, size));
    });
    result.computeBoundingBox();
    result.computeBoundingSphere();
    return result;
}

/** A mesh of its own (its geometry not shared): cut up in place, its old geometry freed. */
export function subdivideOwn(mesh: THREE.Mesh): void {
    const old = mesh.geometry;
    mesh.geometry = subdivide(old, new THREE.Vector3(1, 1, 1));
    old.dispose();
}

/** Every mesh under `object` cut up, its world scale already final. */
export function subdivideObject(object: THREE.Object3D): void {
    object.updateMatrixWorld(true);
    object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        const scale = child.getWorldScale(new THREE.Vector3());
        const key = `${child.geometry.uuid}:${scale.x},${scale.y},${scale.z}`;
        let geometry = cache.get(key);
        if (!geometry) cache.set(key, geometry = subdivide(child.geometry, scale));
        child.geometry = geometry;
    });
}
