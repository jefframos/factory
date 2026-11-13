// Ground.ts
//
// A town's ground pieces, for any game: road tiles laid from a grid of road cells (core/roads/RoadGrid: the kit's pieces,
// each fitted and turned), and lawns — any polygon, filled with the UFO / Mow pixel grass (worked out from the world
// position, so it never stretches and carries on from one lawn to the next). Both are cut small (Subdivide) so they curve
// with a world bend; the game bends their materials its own way.

import * as THREE from 'three';
import { RoadCells, RoadKit, solveRoads } from 'core/roads/RoadGrid';
import { subdivideObject, subdivideOwn } from './Subdivide';

/** A road kit with where its tiles sit: their base, and the asphalt's height (where cars drive). */
export interface TownRoadKit extends RoadKit {
    elevation?: number;
    roadY?: number;
}

/** A lawn: its outline ([x, z] corners in order, world), its colour. */
export interface LawnShape {
    points: { x: number; z: number }[];
    color?: string;
}

/** The lawns' grass: "pixels" per world unit (the mow game's). */
const GRASS_PIXELS = 12;
export const LAWN_COLOR = '#7cc65a';

/**
 * A lawn's look (the mow game's, without its mowing): pixel-noise grass over the material's colour, from the world
 * position.
 */
export function grassMaterial(color: string = LAWN_COLOR): THREE.MeshStandardMaterial {
    const material = new THREE.MeshStandardMaterial({ color, roughness: 1 });
    material.customProgramCacheKey = () => 'town-grass';
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uGrassPixels = { value: GRASS_PIXELS };
        shader.vertexShader = shader.vertexShader
            .replace('#include <common>', '#include <common>\nvarying vec2 vGrassXZ;')
            .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrassXZ = (modelMatrix * vec4(transformed, 1.0)).xz;');
        shader.fragmentShader = shader.fragmentShader
            .replace('#include <common>', `#include <common>
                varying vec2 vGrassXZ;
                uniform float uGrassPixels;
                float grassHash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
            .replace('#include <color_fragment>', `#include <color_fragment>
                vec2 grassPixel = floor(vGrassXZ * uGrassPixels);
                float grain = grassHash(grassPixel);
                float blade = step(0.965, grassHash(grassPixel + 31.7));
                vec2 g = vGrassXZ * 0.16;
                float patches = 0.5 + 0.25 * (sin(g.x * 1.7 + sin(g.y * 1.3) * 1.6) + sin(g.y * 2.1 + sin(g.x * 1.1) * 1.8));
                diffuseColor.rgb *= (0.93 + patches * 0.13) * (0.985 + grain * 0.03 + blade * 0.09);`);
    };
    return material;
}

/** A lawn's mesh: its outline filled, at height `y`, cut small enough to bend. Null for fewer than 3 corners. */
export function buildLawn(lawn: LawnShape, y: number): THREE.Mesh | null {
    if (lawn.points.length < 3) return null;
    // Drawn in x / y, then laid flat (its y becomes -z).
    const shape = new THREE.Shape(lawn.points.map((p) => new THREE.Vector2(p.x, -p.z)));
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, grassMaterial(lawn.color));
    mesh.position.y = y;
    mesh.receiveShadow = true;
    subdivideOwn(mesh);
    return mesh;
}

/**
 * The road tiles for `roads`: each cell's piece (`model(name)`: a copy of the kit's model, loaded by the game), fitted to
 * the tile, turned, its base at the kit's elevation, cut small enough to bend.
 */
export function buildRoads(roads: RoadCells | undefined, kit: TownRoadKit, model: (name: string) => THREE.Object3D | null): THREE.Group {
    const group = new THREE.Group();
    group.name = 'roads';
    for (const placed of solveRoads(roads, kit)) {
        const source = model(placed.model);
        if (!source) continue;
        source.updateWorldMatrix(true, true);
        const box = new THREE.Box3().setFromObject(source);
        const size = box.getSize(new THREE.Vector3());
        // Fitted to the tile (its larger side), centred, its base on the ground.
        const scale = kit.tile / Math.max(1e-4, size.x, size.z);
        const holder = new THREE.Group();
        source.scale.multiplyScalar(scale);
        source.position.set(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale);
        holder.add(source);
        holder.position.set(placed.x, kit.elevation ?? 0.02, placed.z);
        holder.rotation.y = placed.rotationY;
        holder.traverse((child) => {
            if (child instanceof THREE.Mesh) child.receiveShadow = true;
        });
        group.add(holder);
        subdivideObject(holder);
    }
    return group;
}
