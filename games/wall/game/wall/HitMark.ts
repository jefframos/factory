// HitMark.ts
//
// Where a hit landed and how far it reached: a soft, blurred light over what it took, gone in a moment (the tiles round it
// flash too: VoxelWall). A few, in turn. Flat on the wall's face, over everything in the world (the hands are drawn after).

import * as THREE from 'three';
import { fx } from '../config/Effects';

const MARKS = 6;
const SECONDS = 0.3;
/** It opens in this share of the time, from this share of its size; it's this bright, and this much wider than the hit (its edge is all blur). */
const LOOK = { open: 0.35, from: 0.6, bright: 0.42, wider: 1.45 };
const ORDER = 8;

interface Mark {
    mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
    time: number;
    reach: number;
}

function blur(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    const s = (canvas.width = canvas.height = 128);
    const c = canvas.getContext('2d')!;
    const fade = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    fade.addColorStop(0, 'rgba(255,255,255,1)');
    fade.addColorStop(0.3, 'rgba(255,255,255,0.75)');
    fade.addColorStop(0.65, 'rgba(255,255,255,0.28)');
    fade.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = fade;
    c.fillRect(0, 0, s, s);
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return map;
}

export class HitMark {
    public readonly group = new THREE.Group();
    private readonly marks: Mark[] = [];
    private next = 0;

    public constructor() {
        const map = blur();
        const plane = new THREE.PlaneGeometry(2, 2);
        for (let i = 0; i < MARKS; i++) {
            const mesh = new THREE.Mesh(plane, new THREE.MeshBasicMaterial({ map, transparent: true, depthTest: false, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
            mesh.renderOrder = ORDER;
            mesh.visible = false;
            this.group.add(mesh);
            this.marks.push({ mesh, time: 0, reach: 1 });
        }
    }

    /** A hit at `at` that reached `reach` round it, in a colour. */
    public show(at: THREE.Vector3, reach: number, color: THREE.ColorRepresentation): void {
        if (fx('impact') <= 0) return;
        const mark = this.marks[this.next];
        this.next = (this.next + 1) % MARKS;
        mark.mesh.position.copy(at);
        mark.mesh.material.color.set(color);
        mark.mesh.visible = true;
        mark.time = 0;
        mark.reach = reach * LOOK.wider;
        this.place(mark);
    }

    private place({ mesh, time, reach }: Mark): void {
        const t = time / SECONDS;
        const opened = Math.min(1, t / LOOK.open);
        mesh.scale.setScalar(reach * (LOOK.from + (1 - LOOK.from) * opened * (2 - opened)));
        mesh.material.opacity = Math.min(1, LOOK.bright * fx('impact')) * (1 - t) * (1 - t);
    }

    public update(delta: number): void {
        for (const mark of this.marks) {
            if (!mark.mesh.visible) continue;
            mark.time += delta;
            if (mark.time >= SECONDS) mark.mesh.visible = false;
            else this.place(mark);
        }
    }

    /** All away. */
    public clear(): void {
        this.marks.forEach(({ mesh }) => (mesh.visible = false));
    }
}
