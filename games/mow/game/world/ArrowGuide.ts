// ArrowGuide.ts
//
// The floor arrows (dig's guide trail): small triangles along the walking route (GuidePath: around the town's
// obstacles) from the player to a target, flowing towards it with a wave of size and brightness, drawn over
// everything so nothing hides them. The scene decides the target (bag full -> the SELL bin, something to buy -> the
// SHOP, a new area -> its grass); null hides the trail.

import * as THREE from 'three';
import { BendService } from '../services/BendService';
import { findPath, Box } from './GuidePath';

const COLOR = 0xffd23f;
const LIFT = 0.12;
const TRAIL_START = 0.9;
const SPACING = 0.75;
const TRAIL_MAX = 28;
/** No trail this close to the target. */
const NEAR = 1.6;
const REPATH_SEC = 0.3;
const WAVE_SPEED = 3.2;

export class ArrowGuide {
    private readonly trail: THREE.Mesh[] = [];
    private route: THREE.Vector3[] = [];
    private readonly routeTarget = new THREE.Vector3(Infinity, 0, 0);
    private repath = 0;
    private time = 0;

    public constructor(threeScene: THREE.Scene, private readonly blockers: () => readonly Box[]) {
        const shape = new THREE.Shape();
        shape.moveTo(0, 0.24);
        shape.lineTo(0.2, -0.16);
        shape.lineTo(-0.2, -0.16);
        shape.closePath();
        const geometry = new THREE.ShapeGeometry(shape);
        geometry.rotateX(-Math.PI / 2);
        geometry.rotateY(Math.PI);
        for (let i = 0; i < TRAIL_MAX; i++) {
            const material = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, depthWrite: false, depthTest: false });
            BendService.applyBend(material);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.visible = false;
            mesh.renderOrder = 8;
            this.trail.push(mesh);
            threeScene.add(mesh);
        }
    }

    /** Leads from `from` to `target` (null: no trail). Call every frame. */
    public update(delta: number, from: THREE.Vector3, target: THREE.Vector3 | null): void {
        this.time += delta;
        if (!target || from.distanceTo(target) <= NEAR) {
            this.show([]);
            return;
        }
        this.repath -= delta;
        if (this.repath <= 0 || target.distanceToSquared(this.routeTarget) > 0.01) {
            this.repath = REPATH_SEC;
            this.routeTarget.copy(target);
            this.route = findPath(from, target, () => false, this.blockers());
        } else if (this.route.length) {
            this.route[0].set(from.x, 0, from.z);
        }
        this.show(this.route);
    }

    private show(route: THREE.Vector3[]): void {
        let shown = 0;
        let along = 0;
        let next = TRAIL_START;
        const total = route.reduce((sum, p, i) => (i ? sum + p.distanceTo(route[i - 1]) : 0), 0);
        for (let i = 1; i < route.length && shown < TRAIL_MAX; i++) {
            const a = route[i - 1];
            const b = route[i];
            const leg = a.distanceTo(b);
            while (next <= along + leg && next <= total - NEAR * 0.6 && shown < TRAIL_MAX) {
                const k = (next - along) / Math.max(leg, 1e-4);
                const mesh = this.trail[shown++];
                mesh.visible = true;
                mesh.position.set(a.x + (b.x - a.x) * k, LIFT, a.z + (b.z - a.z) * k);
                mesh.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
                const wave = 0.5 + 0.5 * Math.sin(next * 1.6 - this.time * WAVE_SPEED);
                mesh.scale.setScalar(0.8 + wave * 0.35);
                (mesh.material as THREE.MeshBasicMaterial).opacity = 0.45 + wave * 0.55;
                next += SPACING;
            }
            along += leg;
        }
        for (let i = shown; i < this.trail.length; i++) this.trail[i].visible = false;
    }

    public destroy(): void {
        this.trail.forEach((mesh) => mesh.removeFromParent());
    }
}
