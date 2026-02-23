import * as THREE from 'three';

export class MaterialUtils {
    /**
     * Traverses a model and replaces all materials based on a conversion function.
     */
    public static applyToModel(model: THREE.Object3D, conversionFn: (mat: THREE.Material) => THREE.Material): void {
        model.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
                const mesh = child as THREE.Mesh;
                if (Array.isArray(mesh.material)) {
                    mesh.material = mesh.material.map(mat => conversionFn(mat));
                } else {
                    mesh.material = conversionFn(mesh.material);
                }
            }
        });
    }

    /**
     * Converts a material to Unlit (MeshBasicMaterial)
     */
    public static convertToUnlit(oldMat: THREE.Material): THREE.MeshBasicMaterial {
        const old = oldMat as any;
        return new THREE.MeshBasicMaterial({
            color: old.color || new THREE.Color(0xffffff),
            map: old.map || null,
            transparent: old.transparent,
            opacity: old.opacity,
            alphaTest: old.alphaTest,
            side: old.side,
            vertexColors: old.vertexColors
        });
    }

    /**
     * Converts a material to Toon (MeshToonMaterial)
     * Note: Requires a Light source in the scene to see shading.
     */
    public static convertToToon(oldMat: THREE.Material, steps: number = 3): THREE.MeshToonMaterial {
        const old = oldMat as any;

        // Create a stepped gradient for the "Cel" look
        const data = new Uint8Array(steps);
        for (let i = 0; i < steps; i++) {
            data[i] = (i / (steps - 1)) * 255;
        }
        const gradient = new THREE.DataTexture(data, steps, 1, THREE.RedFormat);
        gradient.magFilter = THREE.NearestFilter;
        gradient.needsUpdate = true;

        return new THREE.MeshToonMaterial({
            color: old.color || new THREE.Color(0xffffff),
            map: old.map || null,
            gradientMap: gradient,
            transparent: old.transparent,
            opacity: old.opacity,
            alphaTest: old.alphaTest,
            side: old.side
        });
    }

    public static convertToToonNew(oldMat: THREE.Material, steps: number = 3): THREE.MeshToonMaterial {
        const old = oldMat as any;

        const size = 256;
        const data = new Uint8Array(size);
        for (let i = 0; i < size; i++) {
            const step = Math.floor((i / size) * steps);
            data[i] = (step / (steps - 1)) * 255;
        }

        const gradient = new THREE.DataTexture(data, size, 1, THREE.RedFormat);
        gradient.minFilter = THREE.NearestFilter;
        gradient.magFilter = THREE.NearestFilter;
        gradient.generateMipmaps = false;
        gradient.needsUpdate = true;

        const toonMat = new THREE.MeshToonMaterial({
            color: old.color || new THREE.Color(0xffffff),
            map: old.map || null,
            gradientMap: gradient,
            transparent: old.transparent,
            opacity: old.opacity,
            alphaTest: old.alphaTest,
            side: old.side,
        });

        // If TypeScript complains about flatShading, cast to any to force the bool.
        // We want this FALSE for capsules so shadows wrap smoothly.
        (toonMat as any).flatShading = false;

        return toonMat;
    }
}