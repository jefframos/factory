// LavaPools.ts
//
// The far zones' lava (VoxelTerrain.lava), drawn: a glowing sheet over each pool's cells, a mesh a chunk, its crust drifting
// and its bright veins breathing (a shader over the world's x and z, so the pools run on from chunk to chunk).

import * as THREE from 'three';
import { BendService } from '../services/BendService';

const LIFT = 0.05;

/** The crust's, the lava's and the veins' colours. */
const COLORS = { crust: new THREE.Color('#7a1608'), lava: new THREE.Color('#ff5a12'), vein: new THREE.Color('#ffd65a') };

function lavaMaterial(time: { value: number }): THREE.MeshBasicMaterial {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    material.onBeforeCompile = (shader) => {
        shader.uniforms.uLavaTime = time;
        shader.uniforms.uCrust = { value: COLORS.crust };
        shader.uniforms.uLava = { value: COLORS.lava };
        shader.uniforms.uVein = { value: COLORS.vein };
        shader.vertexShader = `varying vec2 vLavaAt;\n${shader.vertexShader}`.replace(
            '#include <begin_vertex>',
            '#include <begin_vertex>\n    vLavaAt = ( modelMatrix * vec4( position, 1.0 ) ).xz;',
        );
        shader.fragmentShader = `
            varying vec2 vLavaAt;
            uniform float uLavaTime;
            uniform vec3 uCrust;
            uniform vec3 uLava;
            uniform vec3 uVein;
            float lavaHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
            float lavaNoise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                return mix(mix(lavaHash(i), lavaHash(i + vec2(1.0, 0.0)), f.x), mix(lavaHash(i + vec2(0.0, 1.0)), lavaHash(i + vec2(1.0, 1.0)), f.x), f.y);
            }
        ` + shader.fragmentShader.replace('#include <color_fragment>', `
            #include <color_fragment>
            vec2 lavaP = vLavaAt * 0.55;
            float lavaA = lavaNoise(lavaP + vec2(uLavaTime * 0.12, uLavaTime * 0.07));
            float lavaB = lavaNoise(lavaP * 2.1 - vec2(uLavaTime * 0.1, uLavaTime * 0.16));
            float lavaN = lavaA * 0.65 + lavaB * 0.35;
            float lavaVein = 1.0 - smoothstep(0.0, 0.1, abs(lavaN - 0.5));
            vec3 lavaColor = mix(uCrust, uLava, smoothstep(0.3, 0.62, lavaN));
            lavaColor = mix(lavaColor, uVein, lavaVein * (0.65 + 0.35 * sin(uLavaTime * 1.7 + lavaA * 9.0)));
            diffuseColor.rgb = lavaColor;
        `);
    };
    material.customProgramCacheKey = () => 'dig-lava';
    BendService.applyBend(material);
    return material;
}

export class LavaPools {
    private readonly time = { value: 0 };
    private readonly material = lavaMaterial(this.time);
    private readonly meshes = new Map<number, THREE.Mesh>();

    public constructor(private readonly group: THREE.Group) {}

    /** A chunk's pool: its cells' corners (world x and z). */
    public add(chunk: number, cells: [number, number][]): void {
        if (!cells.length || this.meshes.has(chunk)) return;
        const positions: number[] = [];
        const indices: number[] = [];
        for (const [x, z] of cells) {
            const base = positions.length / 3;
            positions.push(x, LIFT, z, x + 1, LIFT, z, x, LIFT, z + 1, x + 1, LIFT, z + 1);
            indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geometry.setIndex(indices);
        const mesh = new THREE.Mesh(geometry, this.material);
        // (Lifted with the ground: its own bounds aren't where it's drawn.)
        mesh.frustumCulled = false;
        this.meshes.set(chunk, mesh);
        this.group.add(mesh);
    }

    public drop(chunk: number): void {
        const mesh = this.meshes.get(chunk);
        mesh?.geometry.dispose();
        mesh?.removeFromParent();
        this.meshes.delete(chunk);
    }

    public update(delta: number): void {
        this.time.value += delta;
    }

    public destroy(): void {
        for (const chunk of [...this.meshes.keys()]) this.drop(chunk);
        this.material.dispose();
    }
}
