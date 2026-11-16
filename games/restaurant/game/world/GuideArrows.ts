// GuideArrows.ts
//
// The floor arrows that lead the way — Mow's ArrowGuide (Dig's guide trail): small rounded arrowheads in the guide
// yellow with a soft amber outline, along a route (the caller's: here, the car's walk-grid route round the buildings),
// flowing toward the target with a wave of size and brightness, lying on the ground. Sized up by `scale` (Mow's are a
// walker's; the delivery car's are a road's). The world bend comes with Bend.ts (bendAll).

import * as THREE from 'three';

/** Dig's guide yellow, with a soft dark-amber border (not black). */
const COLOR = 0xffd23f;
const OUTLINE = 0x8a5a12;
const OUTLINE_OPACITY = 0.8;
/** Over the ground; drawn toward the camera so a road tile just under them can't cover them. */
const LIFT = 0.12;
const DEPTH_BIAS = -8;
const WAVE_SPEED = 3.2;

/**
 * A flat arrowhead with rounded corners (dig's Guide), tip along +Z, lying on the ground. `grow` pads it evenly on
 * every side (the outline), so the border keeps one width all round.
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

export interface GuideArrowsOptions {
    /** Arrow size (x Mow's walker-sized ones). */
    scale: number;
    /** From how far along the route the first one is, how far apart, how many at most; none this near the end. */
    start: number;
    spacing: number;
    max: number;
    near: number;
}

export class GuideArrows {
    private readonly trail: THREE.Mesh[] = [];
    private readonly geometries: THREE.BufferGeometry[] = [];
    private readonly outlineMaterial = new THREE.MeshBasicMaterial({ color: OUTLINE, transparent: true, opacity: OUTLINE_OPACITY, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: DEPTH_BIAS, polygonOffsetUnits: DEPTH_BIAS });
    private time = 0;

    public constructor(scene: THREE.Object3D, private readonly options: GuideArrowsOptions) {
        const geometry = roundedTriangle(0.2, 0.02, 0.035);
        const outlineGeometry = roundedTriangle(0.2, 0.02, 0.035, 0.06);
        this.geometries.push(geometry, outlineGeometry);
        for (let i = 0; i < options.max; i++) {
            const material = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, depthWrite: false,
                polygonOffset: true, polygonOffsetFactor: DEPTH_BIAS, polygonOffsetUnits: DEPTH_BIAS });
            const mesh = new THREE.Mesh(geometry, material);
            mesh.visible = false;
            mesh.renderOrder = 8;
            const outline = new THREE.Mesh(outlineGeometry, this.outlineMaterial);
            outline.renderOrder = 7;
            mesh.add(outline);
            this.trail.push(mesh);
            scene.add(mesh);
        }
    }

    /** Lays the arrows along `route` (world points, from where it starts to the target; empty: none). Every frame. */
    public update(delta: number, route: readonly THREE.Vector3[]): void {
        this.time += delta;
        const { scale, spacing, max, near } = this.options;
        let shown = 0;
        let along = 0;
        let next = this.options.start;
        const total = route.reduce((sum, p, i) => (i ? sum + p.distanceTo(route[i - 1]) : 0), 0);
        for (let i = 1; i < route.length && shown < max; i++) {
            const a = route[i - 1];
            const b = route[i];
            const leg = a.distanceTo(b);
            while (next <= along + leg && next <= total - near && shown < max) {
                const k = (next - along) / Math.max(leg, 1e-4);
                const mesh = this.trail[shown++];
                mesh.visible = true;
                mesh.position.set(a.x + (b.x - a.x) * k, LIFT, a.z + (b.z - a.z) * k);
                mesh.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
                // A wave of size and brightness flowing toward the target.
                const wave = 0.5 + 0.5 * Math.sin((next / spacing) * 1.2 - this.time * WAVE_SPEED);
                mesh.scale.setScalar(scale * (0.8 + wave * 0.35));
                (mesh.material as THREE.MeshBasicMaterial).opacity = 0.8 + wave * 0.2;
                next += spacing;
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
