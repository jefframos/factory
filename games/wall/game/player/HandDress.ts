// HandDress.ts
//
// What one hand wears (data/Looks): its skin and gloves (painted on the hand's own mesh, by the bone each vertex follows),
// boxing gloves over it, rings on its fingers' bones, the shirt's sleeve (a pattern drawn on it) and cuff, and what's on the
// wrist. And a tool's metal in a colour.

import * as THREE from 'three';
import { Look, LookItem, Pattern } from '../data/Looks';
import { HandModel } from './HandModel';
import { withRim } from './Rim';

/** The sleeve's pattern, drawn this many times round it and along it. */
const TILES = { size: 64, around: 2, along: 6 };
/** A boxing glove: where it grips (its own frame: palm, fist, thumb), how far it may be off the wrist, the wrist and the cuff. */
const GLOVE = { grip: new THREE.Vector3(0.012, 0.07, 0.003), reach: 0.016, wrist: 0.041, cuff: 0.048, long: 0.062 };
const FINGERS = ['index', 'middle', 'ring', 'pinky'];

/** A patterned square that repeats (the arm's skin under it, where it's bare). */
export function drawPattern(pattern: Pattern, colors: string[], skin: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    const s = (canvas.width = canvas.height = TILES.size);
    const c = canvas.getContext('2d')!;
    const fill = (color: string) => {
        c.fillStyle = color;
    };
    fill(pattern === 'bare' || pattern === 'ink' ? skin : colors[0]);
    c.fillRect(0, 0, s, s);
    const star = (x: number, y: number, r: number) => {
        c.beginPath();
        for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
            const far = i % 2 ? r * 0.45 : r;
            c.lineTo(x + Math.cos(a) * far, y + Math.sin(a) * far);
        }
        c.fill();
    };
    switch (pattern) {
        case 'stripes':
            fill(colors[1]);
            c.fillRect(0, 0, s / 4, s);
            c.fillRect(s / 2, 0, s / 4, s);
            break;
        case 'hoops':
            fill(colors[1]);
            c.fillRect(0, 0, s, s / 2);
            break;
        case 'checks':
            fill(colors[1]);
            c.globalAlpha = 0.6;
            c.fillRect(0, 0, s / 2, s);
            c.fillRect(0, 0, s, s / 2);
            break;
        case 'dots':
            fill(colors[1]);
            for (const [x, y] of [[0.25, 0.25], [0.75, 0.75]]) {
                c.beginPath();
                c.arc(x * s, y * s, s * 0.14, 0, Math.PI * 2);
                c.fill();
            }
            break;
        case 'stars':
            fill(colors[1]);
            star(s * 0.25, s * 0.28, s * 0.2);
            star(s * 0.75, s * 0.78, s * 0.2);
            break;
        case 'camo':
            for (const [x, y, r, k] of [[0.2, 0.2, 0.2, 1], [0.7, 0.35, 0.24, 2], [0.35, 0.75, 0.22, 1], [0.85, 0.85, 0.16, 2], [0.5, 0.5, 0.12, 1]]) {
                fill(colors[k]);
                c.beginPath();
                c.ellipse(x * s, y * s, r * s, r * s * 0.6, x * 7, 0, Math.PI * 2);
                c.fill();
            }
            break;
        case 'flames':
            for (const [k, tall] of [[1, 0.85], [2, 0.5]]) {
                fill(colors[k]);
                c.beginPath();
                c.moveTo(0, s);
                for (let i = 0; i < 4; i++) {
                    c.quadraticCurveTo((i + 0.1) * (s / 4), s * (1 - tall * 0.4), (i + 0.5) * (s / 4), s * (1 - tall));
                    c.quadraticCurveTo((i + 0.6) * (s / 4), s * (1 - tall * 0.3), (i + 1) * (s / 4), s);
                }
                c.fill();
            }
            break;
        case 'hearts':
            fill(colors[1]);
            for (const [x, y] of [[0.25, 0.3], [0.75, 0.8]]) {
                const r = s * 0.11;
                c.beginPath();
                c.arc(x * s - r * 0.8, y * s - r * 0.5, r, 0, Math.PI * 2);
                c.arc(x * s + r * 0.8, y * s - r * 0.5, r, 0, Math.PI * 2);
                c.fill();
                c.beginPath();
                c.moveTo(x * s - r * 1.75, y * s - r * 0.15);
                c.lineTo(x * s, y * s + r * 1.8);
                c.lineTo(x * s + r * 1.75, y * s - r * 0.15);
                c.fill();
            }
            break;
        case 'zigzag':
            c.strokeStyle = colors[1];
            c.lineWidth = s * 0.16;
            for (const y of [0.25, 0.75]) {
                c.beginPath();
                for (let i = -1; i <= 5; i++) c.lineTo((i * s) / 4, y * s + (i % 2 ? s * 0.12 : -s * 0.12));
                c.stroke();
            }
            break;
        case 'leopard':
            c.strokeStyle = colors[1];
            c.lineWidth = s * 0.07;
            for (const [x, y, r, a] of [[0.2, 0.2, 0.1, 0.4], [0.68, 0.16, 0.08, 2], [0.45, 0.5, 0.11, 4], [0.86, 0.55, 0.09, 1], [0.16, 0.75, 0.09, 3], [0.64, 0.84, 0.1, 5]]) {
                c.beginPath();
                c.arc(x * s, y * s, r * s, a, a + 4.6);
                c.stroke();
            }
            break;
        case 'tiger':
            fill(colors[1]);
            for (const [y, way] of [[0.1, 1], [0.35, -1], [0.6, 1], [0.85, -1]]) {
                const from = way > 0 ? 0 : s;
                c.beginPath();
                c.moveTo(from, y * s - s * 0.08);
                c.quadraticCurveTo(from + way * s * 0.45, y * s - s * 0.04, from + way * s * 0.72, y * s + s * 0.06);
                c.quadraticCurveTo(from + way * s * 0.4, y * s + s * 0.09, from, y * s + s * 0.06);
                c.fill();
            }
            break;
        case 'bolts':
            fill(colors[1]);
            for (const [x, y] of [[0.28, 0.28], [0.76, 0.76]]) {
                c.beginPath();
                [[0.06, -0.2], [-0.12, 0.04], [-0.01, 0.04], [-0.07, 0.22], [0.13, -0.04], [0.02, -0.04]].forEach(([dx, dy]) => c.lineTo((x + dx) * s, (y + dy) * s));
                c.fill();
            }
            break;
        case 'plaid':
            fill(colors[2]);
            c.globalAlpha = 0.7;
            c.fillRect(0, 0, s * 0.4, s);
            c.fillRect(0, 0, s, s * 0.4);
            fill(colors[1]);
            c.globalAlpha = 1;
            c.fillRect(s * 0.68, 0, s * 0.06, s);
            c.fillRect(0, s * 0.68, s, s * 0.06);
            break;
        case 'scales':
            c.strokeStyle = colors[1];
            c.lineWidth = s * 0.06;
            for (let y = 0; y < 5; y++) for (let x = -1; x < 5; x++) {
                c.beginPath();
                c.arc((x + (y % 2) * 0.5) * (s / 4) + s / 8, y * (s / 4), s / 7, 0, Math.PI);
                c.stroke();
            }
            break;
        case 'rainbow':
            colors.forEach((color, i) => {
                fill(color);
                c.fillRect(0, (i * s) / colors.length, s, s / colors.length + 1);
            });
            break;
        case 'space':
            for (const [x, y, r, k] of [[0.2, 0.2, 0.03, 1], [0.6, 0.12, 0.02, 1], [0.85, 0.4, 0.035, 1], [0.35, 0.55, 0.02, 1], [0.1, 0.8, 0.03, 1], [0.55, 0.9, 0.025, 1], [0.7, 0.66, 0.12, 2]]) {
                fill(colors[k]);
                c.beginPath();
                c.arc(x * s, y * s, r * s, 0, Math.PI * 2);
                c.fill();
            }
            break;
        case 'ink':
            c.strokeStyle = colors[0];
            c.globalAlpha = 0.75;
            c.lineWidth = s * 0.07;
            for (const x of [0.25, 0.75]) {
                c.beginPath();
                c.moveTo(x * s, 0);
                c.bezierCurveTo((x + 0.3) * s, s * 0.25, (x - 0.3) * s, s * 0.75, x * s, s);
                c.stroke();
            }
            fill(colors[0]);
            star(s * 0.5, s * 0.5, s * 0.14);
            break;
    }
    return canvas;
}

/** A tool's model with its metal in a colour (its vertices' alpha marks it). */
export function paintMetal(model: THREE.Object3D, color: string, glow: number): void {
    const tint = new THREE.Color(color);
    model.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;
        const plain = (mesh.userData.plain ??= mesh.geometry.attributes.color) as THREE.BufferAttribute;
        const painted = new Float32Array(plain.count * 3);
        for (let i = 0; i < plain.count; i++) {
            const metal = plain.itemSize > 3 && plain.getW(i) > 0.5;
            painted[i * 3] = plain.getX(i) * (metal ? tint.r : 1);
            painted[i * 3 + 1] = plain.getY(i) * (metal ? tint.g : 1);
            painted[i * 3 + 2] = plain.getZ(i) * (metal ? tint.b : 1);
        }
        if (!mesh.userData.own) {
            mesh.userData.own = true;
            mesh.geometry = mesh.geometry.clone();
            mesh.material = withRim(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }));
        }
        mesh.geometry.setAttribute('color', new THREE.BufferAttribute(painted, 3));
        const material = mesh.material as THREE.MeshStandardMaterial;
        material.roughness = glow > 0 ? 0.35 : 0.6;
        material.emissive.copy(tint).multiplyScalar(glow * 0.25);
    });
}

const standard = (color: string, roughness: number) => new THREE.MeshStandardMaterial({ color, roughness });

export class HandDress {
    /** What's on the wrist and the cuff, the sleeve's end at the origin, along +y to the elbow (the caller places it). */
    public readonly wrist = new THREE.Group();
    private readonly skin = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
    private readonly sleeveMaterial = new THREE.MeshStandardMaterial({ roughness: 0.9 });
    private readonly boxing = new THREE.Group();
    private readonly basis = new THREE.Matrix4();
    private extras: THREE.Object3D[] = [];
    private shown = '';

    public constructor(private readonly hand: HandModel, private readonly sleeve: THREE.Mesh, private readonly cuff: THREE.Mesh, private glove?: THREE.Object3D) {
        hand.mesh.material = this.skin;
        sleeve.material = this.sleeveMaterial;
        cuff.material = new THREE.MeshStandardMaterial({ roughness: 0.9 });
        this.placeGlove();
    }

    /** A boxing glove's model, loaded (seen from the next look worn). */
    public setGlove(glove: THREE.Object3D): void {
        this.glove = glove;
        this.shown = '';
    }

    public wear(look: Look): void {
        const key = JSON.stringify(look);
        if (key === this.shown) return;
        this.shown = key;
        this.extras.forEach((extra) => extra.removeFromParent());
        this.extras = [];
        this.paintHand(look.skin.color!, look.gloves);
        this.dressSleeve(look.sleeve, look.skin.color!);
        this.putBoxing(look.gloves);
        // (Under boxing gloves there's no seeing them.)
        if (!look.gloves.boxing) this.putRings(look.rings);
        this.putWrist(look.wrist);
    }

    private paintHand(skin: string, gloves: LookItem): void {
        const geometry = this.hand.mesh.geometry;
        const { skinIndex, skinWeight } = geometry.attributes;
        const paint = (color?: string) => new THREE.Color(color ?? skin);
        const colors = { palm: paint(gloves.palm), fingers: paint(gloves.fingers), tips: paint(gloves.tips), nails: paint(gloves.nails) };
        const names = this.hand.mesh.skeleton.bones.map(({ name }) => partOf(name));
        const painted = new Float32Array(skinIndex.count * 3);
        const at = [0, 0, 0, 0];
        for (let i = 0; i < skinIndex.count; i++) {
            at[0] = skinIndex.getX(i);
            at[1] = skinIndex.getY(i);
            at[2] = skinIndex.getZ(i);
            at[3] = skinIndex.getW(i);
            const weights = [skinWeight.getX(i), skinWeight.getY(i), skinWeight.getZ(i), skinWeight.getW(i)];
            const color = colors[names[at[weights.indexOf(Math.max(...weights))]]];
            painted.set([color.r, color.g, color.b], i * 3);
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(painted, 3));
        this.skin.roughness = gloves.rough ?? 0.75;
        this.skin.needsUpdate = true;
    }

    private dressSleeve({ pattern = 'plain', colors = [], cuff }: LookItem, skin: string): void {
        this.sleeveMaterial.map?.dispose();
        const map = new THREE.CanvasTexture(drawPattern(pattern, colors, skin));
        map.colorSpace = THREE.SRGBColorSpace;
        map.wrapS = map.wrapT = THREE.RepeatWrapping;
        map.repeat.set(TILES.around, TILES.along);
        this.sleeveMaterial.map = map;
        this.sleeveMaterial.needsUpdate = true;
        this.cuff.visible = !!cuff;
        if (cuff) (this.cuff.material as THREE.MeshStandardMaterial).color.set(cuff);
    }

    /** Boxing gloves over the hands (the hand's own mesh away). */
    private putBoxing({ boxing, band }: LookItem): void {
        const on = !!boxing && !!this.glove;
        this.hand.mesh.visible = !on;
        this.boxing.visible = on;
        this.boxing.clear();
        if (!on) return;
        const glove = this.glove!.clone();
        const leather = withRim(standard(boxing!, 0.45));
        glove.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (!mesh.isMesh) return;
            // (Its own stiff cuff away: the arm bends there.)
            mesh.visible = (mesh.material as THREE.Material).name !== 'band';
            mesh.material = leather;
        });
        this.boxing.add(glove);
        // The wrist under it, and a cuff on the arm, in line with the sleeve.
        const add = (geometry: THREE.BufferGeometry, material: THREE.Material, y: number) => {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.y = y;
            this.wrist.add(mesh);
            this.extras.push(mesh);
        };
        const white = standard(band ?? '#ffffff', 0.7);
        this.cuff.visible = false;
        add(new THREE.SphereGeometry(GLOVE.wrist, 18, 14), leather, 0);
        add(new THREE.CylinderGeometry(GLOVE.cuff * 1.06, GLOVE.cuff, GLOVE.long, 22).translate(0, GLOVE.long / 2, 0), white, 0.012);
        add(new THREE.TorusGeometry(GLOVE.cuff, 0.006, 8, 22).rotateX(Math.PI / 2), white, 0.014);
    }

    /** The glove's frame on the wrist: its palm, its fist and its thumb the hand's own (a left one, so the right's is mirrored). */
    private placeGlove(): void {
        const wrist = this.hand.bone('wrist');
        const knuckles = ['index', 'middle', 'pinky'].map((finger) => this.hand.bone(`${finger}_1`));
        if (!wrist || knuckles.some((bone) => !bone)) return;
        this.hand.fist.updateWorldMatrix(true, true);
        const inverse = wrist.matrixWorld.clone().invert();
        const [index, middle, pinky] = knuckles.map((bone) => bone!.getWorldPosition(new THREE.Vector3()).applyMatrix4(inverse));
        const fist = middle.clone().normalize();
        const thumb = index.clone().sub(pinky);
        thumb.addScaledVector(fist, -thumb.dot(fist)).normalize();
        const palm = fist.clone().cross(thumb).multiplyScalar(-this.hand.side);
        this.boxing.matrixAutoUpdate = false;
        this.boxing.matrix.makeBasis(palm, fist, thumb);
        this.basis.copy(this.boxing.matrix);
        wrist.add(this.boxing);
    }

    /** The glove round what the hand grips (its middle, wherever the pose has the wrist). */
    public update(): void {
        if (!this.boxing.visible) return;
        const wrist = this.boxing.parent!;
        const { grip, reach } = GLOVE;
        const at = wrist.position.clone().negate().applyQuaternion(wrist.quaternion.clone().invert());
        at.sub(grip.clone().applyMatrix4(this.basis));
        // (Across only: along the hand it stays on the wrist.)
        const along = new THREE.Vector3().setFromMatrixColumn(this.basis, 1);
        at.addScaledVector(along, -at.dot(along)).clampLength(0, reach);
        this.boxing.matrix.copy(this.basis).setPosition(at);
    }

    private putRings({ kind, color = '#ffffff' }: LookItem): void {
        if (!kind) return;
        const metal = kind === 'gems' ? standard('#e6c25a', 0.35) : standard(color, 0.3);
        const stone = standard(color, 0.15);
        stone.emissive.set(color).multiplyScalar(0.25);
        for (const finger of FINGERS) {
            if (kind === 'gems' && (finger === 'ring' || finger === 'middle')) continue;
            const bone = this.hand.bone(`${finger}_1`);
            if (!bone) continue;
            const next = this.hand.bone(`${finger}_2`);
            // Along the bone, to the next one; `up`: out of the back of the hand.
            const along = next ? next.position.clone() : new THREE.Vector3(0, 0, -0.03);
            const length = along.length();
            along.normalize();
            const up = new THREE.Vector3(0, 1, 0).addScaledVector(along, -along.y).normalize();
            const put = (geometry: THREE.BufferGeometry, material: THREE.Material, t: number, high: number, facing: THREE.Vector3) => {
                const mesh = new THREE.Mesh(geometry, material);
                mesh.position.copy(along).multiplyScalar(length * t).addScaledVector(up, high);
                mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), facing);
                bone.add(mesh);
                this.extras.push(mesh);
            };
            if (kind === 'spikes') {
                put(new THREE.ConeGeometry(0.007, 0.026, 8).rotateX(Math.PI / 2).translate(0, 0, 0.013), metal, 0.92, 0.008, up);
                put(new THREE.TorusGeometry(0.0095, 0.0035, 8, 16), metal, 0.5, 0, along);
                continue;
            }
            put(new THREE.TorusGeometry(0.0098, kind === 'knuckles' ? 0.0052 : 0.003, 8, 18), metal, 0.5, 0, along);
            if (kind === 'knuckles') put(new THREE.BoxGeometry(0.018, 0.02, 0.008), metal, 0.6, 0.011, up);
            if (kind === 'gems') put(new THREE.OctahedronGeometry(0.0085), stone, 0.5, 0.013, up);
        }
    }

    private putWrist({ kind, color = '#ffffff', second = '#ffffff' }: LookItem): void {
        if (!kind) return;
        const add = (geometry: THREE.BufferGeometry, material: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh => {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(x, y, z);
            this.wrist.add(mesh);
            this.extras.push(mesh);
            return mesh;
        };
        const at = 0.058;
        const band = (radius: number, height: number, paint: string, rough = 0.85, y = at) => add(new THREE.CylinderGeometry(radius, radius, height, 24), standard(paint, rough), 0, y);
        switch (kind) {
            case 'sweatband':
                band(0.0455, 0.044, color);
                band(0.0462, 0.012, second);
                break;
            case 'bracelet':
                for (const y of [at - 0.012, at, at + 0.012]) add(new THREE.TorusGeometry(0.0435, 0.0042, 8, 26).rotateX(Math.PI / 2), standard(color, 0.25), 0, y);
                break;
            case 'watch': {
                band(0.0445, 0.022, color, 0.4);
                for (const z of [-1, 1]) {
                    add(new THREE.CylinderGeometry(0.019, 0.019, 0.012, 20).rotateX(Math.PI / 2), standard(color, 0.3), 0, at, z * 0.046);
                    const face = standard(second, 0.2);
                    face.emissive.set(second).multiplyScalar(0.4);
                    add(new THREE.CylinderGeometry(0.0145, 0.0145, 0.014, 20).rotateX(Math.PI / 2), face, 0, at, z * 0.047);
                }
                break;
            }
            case 'spikes':
                band(0.0455, 0.034, color, 0.5);
                for (let i = 0; i < 9; i++) {
                    const a = (i / 9) * Math.PI * 2;
                    const cone = add(new THREE.ConeGeometry(0.0075, 0.022, 8).translate(0, 0.011, 0), standard(second, 0.3), Math.sin(a) * 0.045, at, Math.cos(a) * 0.045);
                    cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.sin(a), 0, Math.cos(a)));
                }
                break;
        }
    }
}

type Part = 'palm' | 'fingers' | 'tips' | 'nails';

function partOf(bone: string): Part {
    if (/palm|wrist/.test(bone)) return 'palm';
    if (/tip/.test(bone)) return 'nails';
    const joint = Number(/_(\d)/.exec(bone)?.[1] ?? 1);
    // (The thumb's first joint is in the palm.)
    if (/thumb/.test(bone)) return joint === 1 ? 'palm' : joint === 2 ? 'fingers' : 'nails';
    return joint === 1 ? 'fingers' : joint === 2 ? 'tips' : 'nails';
}
