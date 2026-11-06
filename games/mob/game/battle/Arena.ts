// Arena.ts
//
// The battlefield's look, from plain shapes in the references' style (refs/mob): a sandy field between green hedges, an
// island in the sea (UFO's water), the whole world bent away from the cannon (Bend.ts); the blue cannon on its rail at
// the near end, the glowing blue multiplier gates with their "x2" / "x3", the red enemy base far up the field with its
// HP on its front, and a red danger line before the cannon. Plus the effects:
// a puff where two mobs clash, the base shaking and flashing when hit, and a gate pulsing as it multiplies.
//
// The rules are Battle's; this only follows it (update()).

import * as THREE from 'three';
import { ARENA, COLORS, GateConfig } from '../data/MobConfig';
import { bendObject, bendSegments } from '../services/Bend';
import { createWater } from '../services/Water';
import { BASE_HALF_WIDTH, BASE_X, Battle } from './Battle';

const FIELD_NEAR = 3;
const FIELD_FAR = ARENA.baseZ - 5;
const HEDGE = { width: 1.1, height: 0.8 };
/** Hedge blocks' length, the grass edge round the field (to the shore), and the sea's colour. */
const HEDGE_BLOCK = 2;
const GRASS_EDGE = 1.4;
const WATER_COLOR = '#3fb6ff';
const GATE = { depth: 0.35, height: 0.12, post: 0.22, postHeight: 1 };
const BASE = { depth: 2.6, height: 2.4 };
const CANNON_Z = 0.35;
/** Clash puffs: how many at most at once, how long each lasts (seconds), how big it grows. */
const PUFFS = 48;
const PUFF_SECONDS = 0.35;
const PUFF_SIZE = 0.55;
const FONT = 'Baloo2-ExtraBold';

const lambert = (color: number, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, ...extra });

/** A rounded box (a box with its edges bevelled), for the chunky toy look. */
function roundedBox(width: number, height: number, depth: number, radius: number, material: THREE.Material): THREE.Mesh {
    const shape = new THREE.Shape();
    const w = width / 2 - radius;
    const d = depth / 2 - radius;
    shape.moveTo(-w, -d - radius);
    shape.lineTo(w, -d - radius);
    shape.quadraticCurveTo(w + radius, -d - radius, w + radius, -d);
    shape.lineTo(w + radius, d);
    shape.quadraticCurveTo(w + radius, d + radius, w, d + radius);
    shape.lineTo(-w, d + radius);
    shape.quadraticCurveTo(-w - radius, d + radius, -w - radius, d);
    shape.lineTo(-w - radius, -d);
    shape.quadraticCurveTo(-w - radius, -d - radius, -w, -d - radius);
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 4 });
    geometry.rotateX(-Math.PI / 2);
    return new THREE.Mesh(geometry, material);
}

/** A canvas-drawn label on a plane (text centred, white with a dark outline), redrawable. */
class Label {
    public readonly mesh: THREE.Mesh;
    private readonly canvas = document.createElement('canvas');
    private readonly texture: THREE.CanvasTexture;
    private text = '';

    public constructor(width: number, height: number, private readonly pixels = 256, private readonly color = '#ffffff') {
        this.canvas.width = pixels;
        this.canvas.height = Math.round(pixels * (height / width));
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.anisotropy = 4;
        this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthWrite: false }));
    }

    public set(text: string): void {
        if (text === this.text) return;
        this.text = text;
        const g = this.canvas.getContext('2d')!;
        const { width, height } = this.canvas;
        g.clearRect(0, 0, width, height);
        g.font = `${Math.round(height * 0.78)}px ${FONT}, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.lineJoin = 'round';
        g.lineWidth = height * 0.14;
        g.strokeStyle = 'rgba(20, 24, 60, 0.85)';
        g.strokeText(text, width / 2, height * 0.55);
        g.fillStyle = this.color;
        g.fillText(text, width / 2, height * 0.55);
        this.texture.needsUpdate = true;
    }
}

interface GateView {
    group: THREE.Group;
    panel: THREE.Mesh;
    pulse: number;
}

export class Arena {
    public readonly group = new THREE.Group();
    private readonly cannon = new THREE.Group();
    private readonly barrel: THREE.Object3D;
    private readonly gates: GateView[] = [];
    private readonly base = new THREE.Group();
    private readonly baseBody: THREE.Mesh;
    private readonly baseLabel = new Label(3.2, 1.1);
    private baseShake = 0;
    private baseFlash = 0;
    private readonly puffs: { mesh: THREE.Mesh; life: number }[] = [];
    private nextPuff = 0;
    private recoil = 0;
    private water!: THREE.Mesh;

    public constructor(gates: GateConfig[]) {
        this.buildGround();
        this.buildCannon();
        this.barrel = this.cannon.getObjectByName('barrel')!;
        gates.forEach((gate) => this.gates.push(this.buildGate(gate)));
        this.baseBody = this.buildBase();
        this.buildPuffs();
        bendObject(this.group);
    }

    /** Frees what isn't freed with the scene (the water's shore texture). */
    public dispose(): void {
        (this.water.userData.free as (() => void) | undefined)?.();
    }

    // ------------------------------------------------------------------ building

    private buildGround(): void {
        const length = FIELD_NEAR - FIELD_FAR;
        const middle = (FIELD_NEAR + FIELD_FAR) / 2;
        // The island: the field, its hedges, and a grass edge round them; the sea all round (UFO's water).
        const islandHalf = ARENA.halfWidth + HEDGE.width + GRASS_EDGE;
        const shore = [
            { x: -islandHalf, z: FIELD_NEAR + GRASS_EDGE }, { x: islandHalf, z: FIELD_NEAR + GRASS_EDGE },
            { x: islandHalf, z: FIELD_FAR - GRASS_EDGE }, { x: -islandHalf, z: FIELD_FAR - GRASS_EDGE },
        ];
        this.water = createWater(WATER_COLOR, 130, 170, shore, 0, middle);
        this.group.add(this.water);
        const grass = new THREE.Mesh(new THREE.PlaneGeometry(islandHalf * 2, length + GRASS_EDGE * 2, 2, bendSegments(length)), lambert(COLORS.grass));
        grass.rotation.x = -Math.PI / 2;
        grass.position.set(0, -0.01, middle);
        this.group.add(grass);
        const field = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.halfWidth * 2, length, 4, bendSegments(length)), lambert(COLORS.track));
        field.rotation.x = -Math.PI / 2;
        field.position.set(0, 0, middle);
        this.group.add(field);
        // Soft stripes across the field (darker sand), for a sense of distance.
        const stripe = lambert(0xd9914c);
        for (let z = FIELD_NEAR - 2; z > FIELD_FAR; z -= 4) {
            const band = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.halfWidth * 2, 2, 4, 2), stripe);
            band.rotation.x = -Math.PI / 2;
            band.position.set(0, 0.005, z);
            this.group.add(band);
        }
        // The hedges either side: a row of bush blocks (short pieces follow the bend).
        const hedge = lambert(0x4ea83a);
        const hedgeDark = lambert(0x3f9130);
        const blocks = Math.ceil(length / HEDGE_BLOCK);
        for (const side of [-1, 1]) {
            for (let b = 0; b < blocks; b++) {
                const block = roundedBox(HEDGE.width, HEDGE.height, HEDGE_BLOCK - 0.08, 0.28, b % 2 ? hedgeDark : hedge);
                block.position.set(side * (ARENA.halfWidth + HEDGE.width / 2), 0, FIELD_NEAR - (b + 0.5) * HEDGE_BLOCK);
                this.group.add(block);
            }
        }
        // The danger line: a red strip just before the cannon.
        const danger = new THREE.Mesh(new THREE.PlaneGeometry(ARENA.halfWidth * 2, 0.16, 6, 1), new THREE.MeshBasicMaterial({ color: COLORS.red, transparent: true, opacity: 0.75 }));
        danger.rotation.x = -Math.PI / 2;
        danger.position.set(0, 0.01, ARENA.dangerZ);
        this.group.add(danger);
        // The cannon's rail.
        const rail = roundedBox(ARENA.cannonRange * 2 + 1.2, 0.08, 0.22, 0.1, lambert(0xffffff));
        rail.position.set(0, 0.01, CANNON_Z);
        this.group.add(rail);
    }

    private buildCannon(): void {
        const blue = lambert(COLORS.blue);
        const dark = lambert(0x24304f);
        const body = roundedBox(1.1, 0.5, 1, 0.3, blue);
        body.position.y = 0.25;
        this.cannon.add(body);
        for (const side of [-1, 1]) {
            for (const end of [-1, 1]) {
                const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.2, 14), dark);
                wheel.rotation.z = Math.PI / 2;
                wheel.position.set(side * 0.6, 0.22, end * 0.32);
                this.cannon.add(wheel);
            }
        }
        const barrel = new THREE.Group();
        barrel.name = 'barrel';
        const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 1.1, 18), blue);
        tube.rotation.x = Math.PI / 2;
        tube.position.z = -0.35;
        barrel.add(tube);
        const muzzle = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.07, 8, 18), lambert(0xffffff));
        muzzle.position.z = -0.9;
        barrel.add(muzzle);
        barrel.position.y = 0.75;
        barrel.rotation.x = 0.18;
        this.cannon.add(barrel);
        this.cannon.position.set(0, 0, CANNON_Z);
        this.group.add(this.cannon);
    }

    private buildGate(gate: GateConfig): GateView {
        const group = new THREE.Group();
        const panel = new THREE.Mesh(
            new THREE.BoxGeometry(gate.width, GATE.height, GATE.depth),
            new THREE.MeshLambertMaterial({ color: COLORS.gate, emissive: COLORS.gate, emissiveIntensity: 0.35, transparent: true, opacity: 0.85 }),
        );
        panel.position.y = GATE.height / 2;
        group.add(panel);
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(gate.width, 1.2), new THREE.MeshBasicMaterial({ color: COLORS.gate, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false }));
        glow.position.y = 0.6;
        group.add(glow);
        const post = lambert(0x2f6fd1);
        for (const side of [-1, 1]) {
            const pole = roundedBox(GATE.post, GATE.postHeight, GATE.post * 1.6, 0.08, post);
            pole.position.set(side * (gate.width / 2 + GATE.post / 2), 0, 0);
            group.add(pole);
        }
        const label = new Label(1.6, 0.8);
        label.set(`x${gate.value}`);
        label.mesh.position.set(0, 1.25, 0);
        label.mesh.rotation.x = -0.6;
        group.add(label.mesh);
        group.position.set(gate.x, 0, gate.z);
        this.group.add(group);
        return { group, panel, pulse: 0 };
    }

    private buildBase(): THREE.Mesh {
        const red = lambert(COLORS.red);
        const width = BASE_HALF_WIDTH * 2;
        const body = roundedBox(width, BASE.height, BASE.depth, 0.35, red);
        this.base.add(body);
        const roof = roundedBox(width + 0.4, 0.35, BASE.depth + 0.4, 0.3, lambert(0xc42335));
        roof.position.y = BASE.height;
        this.base.add(roof);
        const door = roundedBox(1.3, 1.2, 0.2, 0.2, lambert(0x3a1520));
        door.position.set(0, 0, BASE.depth / 2);
        this.base.add(door);
        for (const side of [-1, 1]) {
            const tower = roundedBox(0.9, BASE.height + 0.9, 0.9, 0.25, red);
            tower.position.set(side * (width / 2), 0, 0);
            this.base.add(tower);
        }
        const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.4, 6), lambert(0xffffff));
        flagPole.position.set(0, BASE.height + 1, 0);
        this.base.add(flagPole);
        const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.5), new THREE.MeshLambertMaterial({ color: COLORS.red, side: THREE.DoubleSide }));
        flag.position.set(0.42, BASE.height + 1.45, 0);
        this.base.add(flag);
        this.baseLabel.mesh.position.set(0, BASE.height * 0.62, BASE.depth / 2 + 0.05);
        this.base.add(this.baseLabel.mesh);
        this.base.position.set(BASE_X, 0, ARENA.baseZ - BASE.depth / 2);
        this.group.add(this.base);
        return body;
    }

    private buildPuffs(): void {
        const geometry = new THREE.IcosahedronGeometry(0.5, 0);
        for (let i = 0; i < PUFFS; i++) {
            const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0 }));
            mesh.visible = false;
            this.group.add(mesh);
            this.puffs.push({ mesh, life: 0 });
        }
    }

    // ------------------------------------------------------------------ effects

    /** A puff where two mobs clashed: a pink-white burst. */
    public puff(x: number, z: number, color = 0xffd0e0): void {
        const puff = this.puffs[this.nextPuff];
        this.nextPuff = (this.nextPuff + 1) % PUFFS;
        puff.life = PUFF_SECONDS;
        puff.mesh.visible = true;
        puff.mesh.position.set(x, 0.35, z);
        (puff.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    }

    public hitBase(): void {
        this.baseShake = 0.18;
        this.baseFlash = 0.12;
    }

    public pulseGate(index: number): void {
        const gate = this.gates[index];
        if (gate) gate.pulse = 1;
    }

    public fired(): void {
        this.recoil = 1;
    }

    /** The base falls: it sinks and tips over. */
    public collapseBase(progress: number): void {
        this.base.position.y = -progress * (BASE.height + 1);
        this.base.rotation.z = progress * 0.35;
    }

    /** Follows the battle: the cannon, the gates' swing, the base's HP; ages the effects. */
    public update(battle: Battle, dt: number): void {
        this.cannon.position.x = battle.cannonX;
        this.recoil = Math.max(0, this.recoil - dt * 8);
        this.barrel.position.z = this.recoil * 0.12;
        battle.gates.forEach((gate, i) => {
            const view = this.gates[i];
            view.group.position.x = gate.nowX;
            view.pulse = Math.max(0, view.pulse - dt * 4);
            view.panel.scale.set(1 + view.pulse * 0.08, 1 + view.pulse * 2, 1 + view.pulse * 0.4);
        });
        this.baseLabel.set(String(battle.baseHp));
        this.baseShake = Math.max(0, this.baseShake - dt);
        const shake = this.baseShake > 0 ? (Math.random() - 0.5) * this.baseShake * 0.6 : 0;
        if (battle.baseHp > 0) this.base.position.x = BASE_X + shake;
        this.baseFlash = Math.max(0, this.baseFlash - dt);
        (this.baseBody.material as THREE.MeshLambertMaterial).emissive.setHex(this.baseFlash > 0 ? 0xffffff : 0x000000);
        (this.baseBody.material as THREE.MeshLambertMaterial).emissiveIntensity = this.baseFlash > 0 ? 0.5 : 0;
        for (const puff of this.puffs) {
            if (puff.life <= 0) continue;
            puff.life -= dt;
            const t = 1 - Math.max(0, puff.life) / PUFF_SECONDS;
            puff.mesh.scale.setScalar(PUFF_SIZE * (0.4 + t));
            (puff.mesh.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - t);
            if (puff.life <= 0) puff.mesh.visible = false;
        }
    }
}
