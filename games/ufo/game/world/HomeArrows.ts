// HomeArrows.ts
//
// Out over the water, near the edge of how far the saucer can go: a trail of arrows on the sea, flowing back to the
// nearest shore. In the look of the mow game's floor arrows: rounded yellow arrowheads with a soft amber outline.

import * as THREE from 'three';
import { UFO } from '../data/UfoConfig';
import { applyBend } from '../services/Bend';
import type { UfoTown } from './UfoTown';

const COLOR = 0xffd23f;
const OUTLINE = 0x8a5a12;
const ARROWS = 6;
/** They show from this share of the way to the limit, fully by the limit. */
const SHOW_FROM = 0.65;
const FADE_SPEED = 6;
/** World units: over the sea's waves, their size and gap (and how they grow with the saucer). */
const Y = 0.1;
const SIZE = 2;
const GAP = 1.2;
const GROW_WITH_RADIUS = 0.12;
const WAVE_SPEED = 3.2;

/** A flat arrowhead with rounded corners, tip along +Z. `grow` pads it evenly on every side (the outline). */
function arrowhead(halfWidth: number, tipRadius: number, baseRadius: number, grow = 0): THREE.ShapeGeometry {
    const corners = [new THREE.Vector2(0, 0.24), new THREE.Vector2(halfWidth, -0.16), new THREE.Vector2(-halfWidth, -0.16)];
    const shape = new THREE.Shape();
    for (let i = 0; i < 3; i++) {
        const radius = i === 0 ? tipRadius : baseRadius;
        const r = radius + grow;
        const corner = corners[i];
        const toPrev = corners[(i + 2) % 3].clone().sub(corner).normalize();
        const toNext = corners[(i + 1) % 3].clone().sub(corner).normalize();
        const half = Math.acos(Math.max(-1, Math.min(1, toPrev.dot(toNext)))) / 2;
        const centre = corner.clone().addScaledVector(toPrev.clone().add(toNext).normalize(), radius / Math.sin(half));
        const along = radius / Math.tan(half);
        const fromPrev = corner.clone().addScaledVector(toPrev, along).sub(centre);
        const toward = corner.clone().addScaledVector(toNext, along).sub(centre);
        const start = Math.atan2(fromPrev.y, fromPrev.x);
        let sweep = Math.atan2(toward.y, toward.x) - start;
        while (sweep > Math.PI) sweep -= Math.PI * 2;
        while (sweep <= -Math.PI) sweep += Math.PI * 2;
        const startX = centre.x + Math.cos(start) * r;
        const startY = centre.y + Math.sin(start) * r;
        if (i === 0) shape.moveTo(startX, startY);
        else shape.lineTo(startX, startY);
        shape.absarc(centre.x, centre.y, r, start, start + sweep, sweep < 0);
    }
    shape.closePath();
    const geometry = new THREE.ShapeGeometry(shape, 6);
    // Flat, facing up: the tip (+Y in the shape) then points to -Z, so turned to +Z.
    geometry.rotateX(-Math.PI / 2);
    geometry.rotateY(Math.PI);
    return geometry;
}

export class HomeArrows {
    private readonly group = new THREE.Group();
    private readonly geometry = arrowhead(0.2, 0.02, 0.035);
    private readonly outlineGeometry = arrowhead(0.2, 0.02, 0.035, 0.06);
    private readonly fill = new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, depthWrite: false });
    private readonly outline = new THREE.MeshBasicMaterial({ color: OUTLINE, transparent: true, depthWrite: false });
    private readonly arrows: THREE.Mesh[] = [];
    private readonly toShore = new THREE.Vector2();
    private time = 0;
    private shown = 0;

    public constructor(threeScene: THREE.Scene) {
        applyBend(this.fill);
        applyBend(this.outline);
        for (let i = 0; i < ARROWS; i++) {
            const arrow = new THREE.Mesh(this.geometry, this.fill);
            arrow.renderOrder = 8;
            arrow.frustumCulled = false;
            const edge = new THREE.Mesh(this.outlineGeometry, this.outline);
            edge.renderOrder = 7;
            edge.frustumCulled = false;
            arrow.add(edge);
            this.group.add(arrow);
            this.arrows.push(arrow);
        }
        this.group.visible = false;
        threeScene.add(this.group);
    }

    public update(delta: number, position: THREE.Vector2, radius: number, town: UfoTown): void {
        this.time += delta;
        const out = town.overWater(position.x, position.y, this.toShore);
        const limit = Math.max(UFO.waterMargin, 1e-3);
        const goal = Math.max(0, Math.min(1, (out / limit - SHOW_FROM) / (1 - SHOW_FROM)));
        this.shown += (goal - this.shown) * Math.min(1, delta * FADE_SPEED);
        this.group.visible = this.shown > 0.01;
        if (!this.group.visible) return;
        this.fill.opacity = this.shown;
        this.outline.opacity = this.shown * 0.8;
        const grow = 1 + radius * GROW_WITH_RADIUS;
        const turn = Math.atan2(this.toShore.x, this.toShore.y);
        // From just past the saucer, towards the land.
        this.arrows.forEach((arrow, i) => {
            const along = radius + GAP * grow * (i + 1);
            arrow.position.set(position.x + this.toShore.x * along, Y, position.y + this.toShore.y * along);
            arrow.rotation.y = turn;
            const wave = 0.5 + 0.5 * Math.sin(i * 1.3 - this.time * WAVE_SPEED);
            arrow.scale.setScalar(SIZE * grow * (0.8 + wave * 0.35));
        });
    }

    public destroy(): void {
        this.group.removeFromParent();
        this.geometry.dispose();
        this.outlineGeometry.dispose();
        this.fill.dispose();
        this.outline.dispose();
    }
}
