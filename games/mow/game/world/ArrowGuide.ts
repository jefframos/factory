// ArrowGuide.ts
//
// The floor arrows (dig's guide trail): small rounded arrowheads with a dark outline along the walking route (GuidePath: around the town's
// obstacles) from the player to a target, flowing towards it with a wave of size and brightness, lying on the ground
// (the player, props and tall grass pass in front of them). The scene decides the target (bag full -> the SELL bin, something to buy -> the
// SHOP, a new area -> its grass); null hides the trail.

import * as THREE from 'three';
import { BendService } from '../services/BendService';
import { findPath, Box } from './GuidePath';

/** Purple: reads against the green grass and the grey pavements, apart from the yellow-green clippings. */
const COLOR = 0xa25cff;
/** Above the ground under each arrow (Town.surfaceAt()). */
const LIFT = 0.04;
const TRAIL_START = 0.9;
const SPACING = 0.75;
const TRAIL_MAX = 28;
/** No trail this close to the target. */
const NEAR = 1.6;
const REPATH_SEC = 0.3;
const WAVE_SPEED = 3.2;

/**
 * A flat arrowhead with rounded corners (dig's Guide), tip along +Z, lying on the ground. `grow` pads it evenly on
 * every side (the outline), so the border keeps one width all round instead of the thin tip a scaled copy would give.
 */
function roundedTriangle(halfWidth: number, tipRadius: number, baseRadius: number, grow = 0): THREE.ShapeGeometry {
    const corners = [new THREE.Vector2(0, 0.24), new THREE.Vector2(halfWidth, -0.16), new THREE.Vector2(-halfWidth, -0.16)];
    const shape = new THREE.Shape();
    for (let i = 0; i < 3; i++) {
        const radius = i === 0 ? tipRadius : baseRadius;
        const r = radius + grow;
        const corner = corners[i];
        const prev = corners[(i + 2) % 3];
        const next = corners[(i + 1) % 3];
        const toPrev = prev.clone().sub(corner).normalize();
        const toNext = next.clone().sub(corner).normalize();
        // Inset the corner to the rounded arc's centre; the arc touches both edges, and `grow` pads it outwards.
        const half = Math.acos(Math.max(-1, Math.min(1, toPrev.dot(toNext)))) / 2;
        const bisector = toPrev.clone().add(toNext).normalize();
        const centre = corner.clone().addScaledVector(bisector, radius / Math.sin(half));
        const along = radius / Math.tan(half);
        const fromPrev = corner.clone().addScaledVector(toPrev, along).sub(centre);
        const toward = corner.clone().addScaledVector(toNext, along).sub(centre);
        const start = Math.atan2(fromPrev.y, fromPrev.x);
        let sweep = Math.atan2(toward.y, toward.x) - start;
        while (sweep > Math.PI) sweep -= Math.PI * 2;
        while (sweep <= -Math.PI) sweep += Math.PI * 2;
        const startPoint = new THREE.Vector2(centre.x + Math.cos(start) * r, centre.y + Math.sin(start) * r);
        if (i === 0) shape.moveTo(startPoint.x, startPoint.y);
        else shape.lineTo(startPoint.x, startPoint.y);
        shape.absarc(centre.x, centre.y, r, start, start + sweep, sweep < 0);
    }
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape, 6);
    // Flat on the ground facing up: the tip (+Y in the shape) then points to -Z, so turn it to +Z.
    geometry.rotateX(-Math.PI / 2);
    geometry.rotateY(Math.PI);
    return geometry;
}

export class ArrowGuide {
    private readonly trail: THREE.Mesh[] = [];
    private readonly geometries: THREE.BufferGeometry[] = [];
    private readonly outlineMaterial = new THREE.MeshBasicMaterial({ color: 0x241d18, transparent: true, opacity: 0.95, depthWrite: false });
    private route: THREE.Vector3[] = [];
    private readonly routeTarget = new THREE.Vector3(Infinity, 0, 0);
    private repath = 0;
    private time = 0;

    /** `solid(x, z)`: where the player can't stand (made for each repath: what's open changes); `groundAt(x, z)`: the ground's height. */
    public constructor(threeScene: THREE.Scene, private readonly blockers: () => readonly Box[],
        private readonly solid: () => (x: number, z: number) => boolean = () => () => false,
        private readonly groundAt: (x: number, z: number) => number = () => 0) {
        const geometry = roundedTriangle(0.2, 0.02, 0.035);
        const outlineGeometry = roundedTriangle(0.2, 0.02, 0.035, 0.06);
        this.geometries.push(geometry, outlineGeometry);
        BendService.applyBend(this.outlineMaterial);
        for (let i = 0; i < TRAIL_MAX; i++) {
            const material = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, depthWrite: false });
            BendService.applyBend(material);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.visible = false;
            mesh.renderOrder = 8;
            const outline = new THREE.Mesh(outlineGeometry, this.outlineMaterial);
            outline.renderOrder = 7;
            mesh.add(outline);
            this.trail.push(mesh);
            threeScene.add(mesh);
        }
    }

    /**
     * Leads from `from` to `target` (null: no trail), or with `area` into that rect the nearest way in (`target` its
     * centre). Call every frame.
     */
    public update(delta: number, from: THREE.Vector3, target: THREE.Vector3 | null, area?: Box): void {
        this.time += delta;
        const arrived = area
            ? Math.abs(from.x - area.x) <= area.halfX + NEAR && Math.abs(from.z - area.z) <= area.halfZ + NEAR
            : !!target && from.distanceTo(target) <= NEAR;
        if (!target || arrived) {
            this.show([]);
            return;
        }
        this.repath -= delta;
        if (this.repath <= 0 || target.distanceToSquared(this.routeTarget) > 0.01) {
            this.repath = REPATH_SEC;
            this.routeTarget.copy(target);
            this.route = findPath(from, target, this.solid(), this.blockers(), area);
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
                const x = a.x + (b.x - a.x) * k;
                const z = a.z + (b.z - a.z) * k;
                mesh.position.set(x, this.groundAt(x, z) + LIFT, z);
                mesh.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
                const wave = 0.5 + 0.5 * Math.sin(next * 1.6 - this.time * WAVE_SPEED);
                mesh.scale.setScalar(0.8 + wave * 0.35);
                (mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 + wave * 0.2;
                next += SPACING;
            }
            along += leg;
        }
        for (let i = shown; i < this.trail.length; i++) this.trail[i].visible = false;
    }

    public destroy(): void {
        this.geometries.forEach((geometry) => geometry.dispose());
        this.trail.forEach((mesh) => {
            mesh.removeFromParent();
            (mesh.material as THREE.Material).dispose();
        });
        this.outlineMaterial.dispose();
    }
}
