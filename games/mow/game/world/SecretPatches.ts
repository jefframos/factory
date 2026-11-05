// SecretPatches.ts
//
// Secrets for the curious: small clumps of lush, extra-bright grass the editor places anywhere in town (`secrets` in
// levels/town.json: behind a building, in a corner of the deck…), apart from the sections' grass (they never count
// towards a section). Any mower cuts them, whatever is in the bag (no clippings: the prize is the chest). Mowed
// through (CLEARED of its tufts), a patch gives up its chest (MowScene: it pops out and its claim card shows); found
// (MowProgress.secretFound) it stays mowed. While one is hidden near the player, a sparkle twinkles over it now and then
// (`twinkle`), so a player who looks around spots it.

import * as THREE from 'three';
import { TOWN, SecretDef, lawnLift } from '../data/MowConfig';
import { BendService } from '../services/BendService';

/** Tufts this far apart in a patch. */
const SPACING = 0.32;
/** The tufts' height (taller than the lawns') and colours (brighter, lusher). */
const HEIGHT = 0.62;
const COLORS = [0x8ff05a, 0x6fdc48, 0xa8f76a].map((c) => new THREE.Color(c));
/** This share of a patch cut: its chest is found. */
const CLEARED = 0.85;
/** A sparkle over a hidden patch within TWINKLE_RANGE of the player, every TWINKLE_SEC or so. */
const TWINKLE_RANGE = 9;
const TWINKLE_SEC = 1.4;

interface Patch {
    def: SecretDef;
    mesh: THREE.InstancedMesh;
    /** Each tuft's spot and whether it's cut. */
    spots: THREE.Vector2[];
    cut: Uint8Array;
    left: number;
    /** Its chest is out (found now, or in an earlier session). */
    done: boolean;
    twinkle: number;
}

/** Three crossed blades, 1 unit tall, darker at the root. */
function bladeGeometry(): THREE.BufferGeometry {
    const positions: number[] = [];
    const colors: number[] = [];
    for (let b = 0; b < 3; b++) {
        const angle = (b * Math.PI) / 3;
        const dx = Math.cos(angle) * 0.25;
        const dz = Math.sin(angle) * 0.25;
        const lean = (b - 1) * 0.12;
        positions.push(-dx, 0, -dz, dx, 0, dz, Math.cos(angle + Math.PI / 2) * lean, 1, Math.sin(angle + Math.PI / 2) * lean);
        colors.push(0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 1, 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
}

export class SecretPatches {
    private readonly patches: Patch[] = [];
    private readonly group = new THREE.Group();
    private readonly geometry = bladeGeometry();
    private readonly material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
    private readonly matrix = new THREE.Matrix4();
    private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

    /** `found(id)`: the patch's chest was found in an earlier session (it starts mowed). */
    public constructor(threeScene: THREE.Scene, found: (id: string) => boolean) {
        BendService.applyBend(this.material);
        for (const def of TOWN.secrets ?? []) this.build(def, found(def.id));
        threeScene.add(this.group);
    }

    private build(def: SecretDef, done: boolean): void {
        const spots: THREE.Vector2[] = [];
        const across = Math.max(1, Math.round(def.width / SPACING));
        const deep = Math.max(1, Math.round(def.depth / SPACING));
        for (let iz = 0; iz < deep; iz++) {
            for (let ix = 0; ix < across; ix++) {
                // A little jitter, seeded by the spot, so it reads as a clump and not a grid.
                const j = Math.abs(Math.sin((ix + 1) * 12.9898 + (iz + 1) * 78.233 + def.x) * 43758.5453) % 1;
                spots.push(new THREE.Vector2(
                    def.x - def.width / 2 + (ix + 0.5 + (j - 0.5) * 0.6) * (def.width / across),
                    def.z - def.depth / 2 + (iz + 0.5 + (0.5 - j) * 0.6) * (def.depth / deep),
                ));
            }
        }
        const mesh = new THREE.InstancedMesh(this.geometry, this.material, spots.length);
        const quaternion = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        const scale = new THREE.Vector3();
        const position = new THREE.Vector3();
        spots.forEach((spot, i) => {
            const j = Math.abs(Math.sin(spot.x * 41.3 + spot.y * 17.1) * 9871.13) % 1;
            quaternion.setFromAxisAngle(up, j * Math.PI * 2);
            const height = HEIGHT * (0.8 + j * 0.4);
            scale.set(SPACING * 1.8, height, SPACING * 1.8);
            this.matrix.compose(position.set(spot.x, 0.02 + lawnLift(), spot.y), quaternion, scale);
            mesh.setMatrixAt(i, done ? this.hidden : this.matrix);
            mesh.setColorAt(i, COLORS[i % COLORS.length].clone().multiplyScalar(0.9 + j * 0.2));
        });
        mesh.computeBoundingSphere();
        this.group.add(mesh);
        const cut = new Uint8Array(spots.length).fill(done ? 1 : 0);
        this.patches.push({ def, mesh, spots, cut, left: done ? 0 : spots.length, done, twinkle: Math.random() * TWINKLE_SEC });
    }

    /**
     * Cuts the tufts within `radius` of the segment a -> b (the mower's sweep). Returns the patches mowed through just
     * now (their chest is out: where to pop it from).
     */
    public cut(ax: number, az: number, bx: number, bz: number, radius: number): { secret: SecretDef; at: THREE.Vector3 }[] {
        const found: { secret: SecretDef; at: THREE.Vector3 }[] = [];
        const r2 = radius * radius;
        const abx = bx - ax;
        const abz = bz - az;
        const length2 = abx * abx + abz * abz || 1;
        for (const patch of this.patches) {
            if (patch.done) continue;
            const { def } = patch;
            // Skip patches the sweep can't reach.
            if (Math.min(ax, bx) - radius > def.x + def.width / 2 || Math.max(ax, bx) + radius < def.x - def.width / 2
                || Math.min(az, bz) - radius > def.z + def.depth / 2 || Math.max(az, bz) + radius < def.z - def.depth / 2) continue;
            let changed = false;
            patch.spots.forEach((spot, i) => {
                if (patch.cut[i]) return;
                const k = Math.max(0, Math.min(1, ((spot.x - ax) * abx + (spot.y - az) * abz) / length2));
                const dx = spot.x - (ax + abx * k);
                const dz = spot.y - (az + abz * k);
                if (dx * dx + dz * dz > r2) return;
                patch.cut[i] = 1;
                patch.left--;
                patch.mesh.setMatrixAt(i, this.hidden);
                changed = true;
            });
            if (!changed) continue;
            if (patch.left <= patch.spots.length * (1 - CLEARED)) {
                // Through: the rest goes too, and its chest is out.
                patch.spots.forEach((_, i) => patch.mesh.setMatrixAt(i, this.hidden));
                patch.cut.fill(1);
                patch.left = 0;
                patch.done = true;
                found.push({ secret: def, at: new THREE.Vector3(def.x, 0, def.z) });
            }
            patch.mesh.instanceMatrix.needsUpdate = true;
        }
        return found;
    }

    /** The twinkles over hidden patches near `player`: `twinkle(at)` draws one. */
    public update(delta: number, player: THREE.Vector3, twinkle: (at: THREE.Vector3) => void): void {
        for (const patch of this.patches) {
            if (patch.done) continue;
            patch.twinkle -= delta;
            if (patch.twinkle > 0) continue;
            patch.twinkle = TWINKLE_SEC * (0.7 + Math.random() * 0.6);
            if (Math.hypot(player.x - patch.def.x, player.z - patch.def.z) > TWINKLE_RANGE) continue;
            const spot = patch.spots[Math.floor(Math.random() * patch.spots.length)];
            twinkle(new THREE.Vector3(spot.x, HEIGHT + 0.2, spot.y));
        }
    }

    public destroy(): void {
        this.group.removeFromParent();
        this.geometry.dispose();
        this.material.dispose();
        this.patches.forEach((patch) => patch.mesh.dispose());
    }
}
