// CheckerFloorBuilder.ts
//
// One flat checker-textured plane for a "floor" rect drawn on a "--storeView--" layer (see
// WorldObjectRegistry.StoreFloorPlacement) — replaces what used to be one glb floor-tile model
// per 64px Tiled tile (dozens of meshes/draw calls for one store) with a single mesh per rect.
// Subdivided via BendService.segmentsForSpan() so it follows the world bend instead of only
// bending at its 4 corners.
//
// The look is a FloorCheckerConfig (StoreViewTypes.ts — the store's floor checker), applied
// separately from building the mesh so a floor can be re-skinned in place (applyChecker()),
// e.g. when a store's floor changes at runtime.
//
// UVs are WORLD-anchored (one checker square per `tileSize * scale` world units, counted from
// the world origin), not rect-relative — two rects drawn side by side line up seamlessly,
// exactly like the tiles they replace did.

import * as THREE from 'three';
import { BendService } from '../services/BendService';
import type { StoreFloorPlacement } from '../world/WorldObjectRegistry';
import type { FloorCheckerConfig } from '../store/StoreViewTypes';
import { FloorLayers } from '../world/FloorLayers';

/** 2x2 checker textures, shared across every floor with the same colors — never disposed (tiny, and reused by any floor rebuilt later). */
const textureCache = new Map<string, THREE.DataTexture>();

function checkerTexture(colorA: string, colorB: string): THREE.DataTexture {
    const key = `${colorA}|${colorB}`;
    let texture = textureCache.get(key);
    if (texture) {
        return texture;
    }

    // getHex() gives sRGB bytes — the texture is tagged sRGB below, same as a glb's own texture.
    const a = new THREE.Color(colorA).getHex();
    const b = new THREE.Color(colorB).getHex();
    // Texel (i, j) = cell parity: B on (0,0)/(1,1), A on (1,0)/(0,1) — so with the world-anchored
    // UVs below, colorA lands on cells whose (x + z) cell index is odd, matching the old
    // FloorKitchenSmall tiles' own phase on the stall1 floor.
    const texels = [b, a, a, b];
    const data = new Uint8Array(4 * 4);
    texels.forEach((hex, i) => {
        data[i * 4] = (hex >> 16) & 0xff;
        data[i * 4 + 1] = (hex >> 8) & 0xff;
        data[i * 4 + 2] = hex & 0xff;
        data[i * 4 + 3] = 0xff;
    });

    texture = new THREE.DataTexture(data, 2, 2, THREE.RGBAFormat);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    textureCache.set(key, texture);
    return texture;
}

export class CheckerFloorBuilder {
    /**
     * Builds `floor` as one mesh positioned relative to `origin` (the world point the mesh's
     * parent rests at — e.g. a BuildingZone's position), so it can be parented under that
     * transform, painted with `checker`. Its height is FloorLayers.storeFloorY (world), whatever
     * `origin.y` is. The caller owns the returned mesh's
     * geometry/material (dispose both).
     */
    public static build(floor: StoreFloorPlacement, origin: THREE.Vector3, checker: FloorCheckerConfig): THREE.Mesh {
        const geometry = new THREE.PlaneGeometry(
            floor.width,
            floor.depth,
            BendService.segmentsForSpan(floor.width),
            BendService.segmentsForSpan(floor.depth),
        );
        geometry.rotateX(-Math.PI / 2);
        geometry.rotateY(floor.rotationY);

        const material = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 });
        BendService.applyBend(material);

        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(floor.x - origin.x, FloorLayers.storeFloorY - origin.y, floor.z - origin.z);
        CheckerFloorBuilder.applyChecker(mesh, floor, checker);
        return mesh;
    }

    /** (Re)paints a mesh build() made for `floor` with `checker` — colors and square size (UVs). */
    public static applyChecker(mesh: THREE.Mesh, floor: StoreFloorPlacement, checker: FloorCheckerConfig): void {
        // World-anchored UVs (see this file's own doc): one texture repeat = 2 squares. The
        // geometry is centered on the rect, so world position = rect center + vertex position.
        const period = floor.tileSize * checker.scale * 2;
        const positions = mesh.geometry.attributes.position;
        const uvs = mesh.geometry.attributes.uv;
        for (let i = 0; i < positions.count; i++) {
            uvs.setXY(i, (floor.x + positions.getX(i)) / period, (floor.z + positions.getZ(i)) / period);
        }
        uvs.needsUpdate = true;

        const material = mesh.material as THREE.MeshStandardMaterial;
        material.map = checkerTexture(checker.colorA, checker.colorB);
        material.needsUpdate = true;
    }
}
