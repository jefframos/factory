// Saucer.ts
//
// The player: a plate with a cylinder on its middle (a stand-in until there's a model), a beam under it and a ring on
// the ground showing what's under it. Its radius is how much fits under it, and sets how high it flies. It slides round
// whatever is too tall to fly over, and stays over the island.

import * as THREE from 'three';
import { UFO, altitudeFor } from '../data/UfoConfig';
import { bendObject } from '../services/Bend';
import type { Blocker, UfoTown } from '../world/UfoTown';

const PLATE_THICKNESS = 0.16;
const CYLINDER = { radius: 0.36, height: 0.42 };
/** The ring on the ground: over the road tiles, under anything standing. */
const RING_Y = 0.3;
const TILT = 0.28;
const TILT_SPEED = 6;
const BOB = { height: 0.05, speed: 2.6 };
const BEAM_OPACITY = { idle: 0.1, eating: 0.28 };
/** How quickly the beam dims back after a bite. */
const BEAM_FADE = 4;

export class Saucer {
    private readonly body = new THREE.Group();
    private readonly beam: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
    private readonly ring: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    private readonly disc: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial>;
    private readonly velocity = new THREE.Vector2();
    private readonly materials: THREE.Material[];
    private readonly geometries: THREE.BufferGeometry[];
    private time = 0;
    private beamGlow = 0;
    private punch = 0;
    /** Where it is on the ground. */
    public readonly position = new THREE.Vector2();
    /** What it has grown to, and what it's easing there on. */
    public targetRadius = UFO.startRadius;
    public radius = UFO.startRadius;
    public altitude = altitudeFor(UFO.startRadius);
    /** The tall thing it pushed into this frame, if any. */
    public bumped: Blocker | null = null;

    public constructor(threeScene: THREE.Scene, x: number, z: number) {
        this.position.set(x, z);
        const hull = new THREE.MeshStandardMaterial({ color: 0xc9d3dc, metalness: 0.55, roughness: 0.35 });
        const glass = new THREE.MeshStandardMaterial({ color: 0x59e6c8, emissive: 0x1a8f7a, roughness: 0.3 });
        const plateGeometry = new THREE.CylinderGeometry(1, 0.82, PLATE_THICKNESS, 48);
        const cylinderGeometry = new THREE.CylinderGeometry(CYLINDER.radius, CYLINDER.radius, CYLINDER.height, 32);
        const plate = new THREE.Mesh(plateGeometry, hull);
        plate.position.y = PLATE_THICKNESS / 2;
        const cylinder = new THREE.Mesh(cylinderGeometry, glass);
        cylinder.position.y = PLATE_THICKNESS + CYLINDER.height / 2;
        this.body.add(plate, cylinder);

        const beamMaterial = new THREE.MeshBasicMaterial({ color: 0x9dfff0, transparent: true, opacity: BEAM_OPACITY.idle, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending });
        this.beam = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 1, 1, 48, 1, true), beamMaterial);
        const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x9dfff0, transparent: true, opacity: 0.9, depthWrite: false });
        this.ring = new THREE.Mesh(new THREE.RingGeometry(0.95, 1, 64).rotateX(-Math.PI / 2), ringMaterial);
        const discMaterial = new THREE.MeshBasicMaterial({ color: 0x0b2b33, transparent: true, opacity: 0.28, depthWrite: false });
        this.disc = new THREE.Mesh(new THREE.RingGeometry(0, 1, 64, 12).rotateX(-Math.PI / 2), discMaterial);
        this.ring.position.y = RING_Y;
        this.disc.position.y = RING_Y - 0.01;
        for (const part of [this.body, this.beam, this.disc, this.ring]) bendObject(part);
        threeScene.add(this.body, this.beam, this.disc, this.ring);
        this.materials = [hull, glass, beamMaterial, ringMaterial, discMaterial];
        this.geometries = [plateGeometry, cylinderGeometry, this.beam.geometry, this.ring.geometry, this.disc.geometry];
    }

    /** Where it hangs (the plate's underside). */
    public worldPosition(out: THREE.Vector3): THREE.Vector3 {
        return out.set(this.position.x, this.altitude, this.position.y);
    }

    public grow(amount: number): void {
        this.targetRadius = Math.sqrt(this.targetRadius * this.targetRadius + UFO.growth * amount);
        this.punch = 1;
    }

    public beamFlash(): void {
        this.beamGlow = 1;
    }

    /** One step along `input` (x, z; length 0..1), kept out of what it can't fly over and over the island. */
    public move(input: THREE.Vector2, delta: number, town: UfoTown): void {
        this.radius += (this.targetRadius - this.radius) * Math.min(1, delta * UFO.growSpeed);
        this.altitude = altitudeFor(this.radius);
        const speed = UFO.speed + UFO.speedPerRadius * this.radius;
        const ease = Math.min(1, delta * UFO.accel);
        this.velocity.x += (input.x * speed - this.velocity.x) * ease;
        this.velocity.y += (input.y * speed - this.velocity.y) * ease;
        const { position, velocity } = this;
        // Per axis, so it slides along the shore.
        const nextX = position.x + velocity.x * delta;
        if (town.isOverIsland(nextX, position.y)) position.x = nextX;
        else velocity.x = 0;
        const nextZ = position.y + velocity.y * delta;
        if (town.isOverIsland(position.x, nextZ)) position.y = nextZ;
        else velocity.y = 0;
        // Never pushed off the island: it stays, overlapping, until it moves away or grows over the thing.
        const { x, y } = position;
        this.resolveBlockers(town.blockers);
        if (!town.isOverIsland(position.x, position.y)) position.set(x, y);
    }

    /** Out of every box too tall to fly over (it can also grow into one: the same push). */
    private resolveBlockers(blockers: readonly Blocker[]): void {
        const reach = this.radius * UFO.collideShare;
        const { position } = this;
        this.bumped = null;
        for (const box of blockers) {
            if (box.height <= this.altitude) continue;
            const dx = position.x - box.x;
            const dz = position.y - box.z;
            const nearX = Math.max(-box.halfX, Math.min(box.halfX, dx));
            const nearZ = Math.max(-box.halfZ, Math.min(box.halfZ, dz));
            const awayX = dx - nearX;
            const awayZ = dz - nearZ;
            const away = Math.hypot(awayX, awayZ);
            if (away >= reach) continue;
            if (away > 1e-5) {
                position.x += (awayX / away) * (reach - away);
                position.y += (awayZ / away) * (reach - away);
            } else if (box.halfX - Math.abs(dx) < box.halfZ - Math.abs(dz)) {
                // Its middle is inside the box: out by the nearest side.
                position.x = box.x + Math.sign(dx || 1) * (box.halfX + reach);
            } else {
                position.y = box.z + Math.sign(dz || 1) * (box.halfZ + reach);
            }
            this.bumped = box;
        }
    }

    public update(delta: number): void {
        this.time += delta;
        this.punch = Math.max(0, this.punch - delta * 5);
        this.beamGlow = Math.max(0, this.beamGlow - delta * BEAM_FADE);
        const { radius, altitude, position } = this;
        const y = altitude + Math.sin(this.time * BOB.speed) * BOB.height * radius;
        this.body.position.set(position.x, y, position.y);
        this.body.scale.setScalar(radius * (1 + this.punch * 0.08));
        // Leaning into where it's going.
        const speed = UFO.speed + UFO.speedPerRadius * radius;
        const ease = Math.min(1, delta * TILT_SPEED);
        this.body.rotation.x += ((this.velocity.y / speed) * TILT - this.body.rotation.x) * ease;
        this.body.rotation.z += ((-this.velocity.x / speed) * TILT - this.body.rotation.z) * ease;

        this.beam.position.set(position.x, altitude / 2, position.y);
        this.beam.scale.set(radius, altitude, radius);
        this.beam.material.opacity = BEAM_OPACITY.idle + (BEAM_OPACITY.eating - BEAM_OPACITY.idle) * this.beamGlow;
        this.ring.position.x = this.disc.position.x = position.x;
        this.ring.position.z = this.disc.position.z = position.y;
        this.ring.scale.setScalar(radius);
        this.disc.scale.setScalar(radius);
    }

    public destroy(): void {
        this.body.removeFromParent();
        this.beam.removeFromParent();
        this.ring.removeFromParent();
        this.disc.removeFromParent();
        this.materials.forEach((material) => material.dispose());
        this.geometries.forEach((geometry) => geometry.dispose());
    }
}
