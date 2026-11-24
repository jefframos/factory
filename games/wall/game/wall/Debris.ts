// Debris.ts
//
// The pieces that fly off: one InstancedMesh of blocks, a fixed pool (none made while playing; full, the oldest goes). They
// arc, bounce once or twice on the floor, lie there a moment and shrink away. And dust: soft puffs facing the camera.

import * as THREE from 'three';
import { fx } from '../config/Effects';
import { blockGeometry } from './VoxelWall';

const POOL = 320;
const GRAVITY = -20;
const FLOOR_BOUNCE = 0.32;
const FLOOR_DRAG = 0.6;
const SHRINK_SEC = 0.35;
const DUST_POOL = 12;

interface Piece {
    life: number;
    position: THREE.Vector3;
    velocity: THREE.Vector3;
    turn: THREE.Euler;
    spin: THREE.Vector3;
    size: number;
}

interface Puff {
    sprite: THREE.Sprite;
    life: number;
    maxLife: number;
    size: number;
    velocity: THREE.Vector3;
}

function dustTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d')!;
    const fade = context.createRadialGradient(32, 32, 2, 32, 32, 32);
    fade.addColorStop(0, 'rgba(255,255,255,0.9)');
    fade.addColorStop(0.5, 'rgba(255,255,255,0.4)');
    fade.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = fade;
    context.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(canvas);
}

export class Debris {
    public readonly group = new THREE.Group();
    private readonly mesh: THREE.InstancedMesh;
    private readonly pieces: Piece[] = [];
    private next = 0;
    private readonly puffs: Puff[] = [];
    private nextPuff = 0;
    private readonly matrix = new THREE.Matrix4();
    private readonly quaternion = new THREE.Quaternion();
    private readonly scale = new THREE.Vector3();

    public constructor() {
        this.mesh = new THREE.InstancedMesh(blockGeometry(0.12), new THREE.MeshLambertMaterial(), POOL);
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.mesh.frustumCulled = false;
        const white = new THREE.Color(1, 1, 1);
        this.matrix.makeScale(0, 0, 0);
        for (let i = 0; i < POOL; i++) {
            this.mesh.setMatrixAt(i, this.matrix);
            this.mesh.setColorAt(i, white);
            this.pieces.push({ life: 0, position: new THREE.Vector3(), velocity: new THREE.Vector3(), turn: new THREE.Euler(), spin: new THREE.Vector3(), size: 0 });
        }
        this.group.add(this.mesh);
        const texture = dustTexture();
        for (let i = 0; i < DUST_POOL; i++) {
            const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0 }));
            sprite.visible = false;
            this.group.add(sprite);
            this.puffs.push({ sprite, life: 0, maxLife: 1, size: 1, velocity: new THREE.Vector3() });
        }
    }

    /** A piece from `at`, `size` across, thrown: `force` outwards (toward the viewer), from `from` if it was hit there. */
    public throw(at: THREE.Vector3, color: THREE.Color, size: number, force: number, from?: THREE.Vector3): void {
        // (Fewer of them: some left out.)
        const many = fx('pieces');
        if (many < 1 && Math.random() >= many) return;
        const index = this.next;
        this.next = (this.next + 1) % POOL;
        const piece = this.pieces[index];
        piece.position.copy(at);
        piece.velocity.set((Math.random() - 0.5) * 3.2, 1 + Math.random() * 3.2, 0.5 + (1.1 + Math.random() * 3.4) * fx('piecesAtYou')).multiplyScalar(force);
        if (from) {
            piece.velocity.x += (at.x - from.x) * 3.2 * force;
            piece.velocity.y += (at.y - from.y) * 2.2 * force;
        }
        piece.turn.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        piece.spin.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
        piece.size = size * (0.75 + Math.random() * 0.4);
        piece.life = 1.5 + Math.random() * 1;
        this.mesh.setColorAt(index, color);
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }

    /** A piece that just drops (nothing held it any more). */
    public drop(at: THREE.Vector3, color: THREE.Color, size: number): void {
        const index = this.next;
        this.throw(at, color, size, 0.35);
        if (this.next === index) return;
        const piece = this.pieces[index];
        piece.velocity.y *= 0.2;
    }

    /** A puff of dust `size` across. */
    public puff(at: THREE.Vector3, color: THREE.ColorRepresentation, size: number, seconds = 0.45): void {
        if (fx('dust') <= 0) return;
        const puff = this.puffs[this.nextPuff];
        this.nextPuff = (this.nextPuff + 1) % DUST_POOL;
        puff.sprite.position.copy(at);
        puff.sprite.material.color.set(color);
        puff.sprite.visible = true;
        puff.size = size;
        puff.life = puff.maxLife = seconds;
        puff.velocity.set((Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.5, 0.8);
    }

    /** Everything moved along (the world's been moved back by a gap). */
    public shift(z: number): void {
        for (const piece of this.pieces) piece.position.z += z;
        for (const { sprite } of this.puffs) sprite.position.z += z;
    }

    public update(delta: number): void {
        let moved = false;
        for (let i = 0; i < POOL; i++) {
            const piece = this.pieces[i];
            if (piece.life <= 0) continue;
            moved = true;
            piece.life -= delta;
            piece.velocity.y += GRAVITY * delta;
            piece.position.addScaledVector(piece.velocity, delta);
            const rest = piece.size / 2;
            if (piece.position.y < rest && piece.velocity.y < 0) {
                piece.position.y = rest;
                piece.velocity.set(piece.velocity.x * FLOOR_DRAG, -piece.velocity.y * FLOOR_BOUNCE, piece.velocity.z * FLOOR_DRAG);
                piece.spin.multiplyScalar(0.45);
                if (piece.velocity.y < 0.6) piece.velocity.set(0, 0, 0);
            }
            piece.turn.x += piece.spin.x * delta;
            piece.turn.y += piece.spin.y * delta;
            piece.turn.z += piece.spin.z * delta;
            const size = piece.life <= 0 ? 0 : piece.size * Math.min(1, piece.life / SHRINK_SEC);
            this.matrix.compose(piece.position, this.quaternion.setFromEuler(piece.turn), this.scale.setScalar(size));
            this.mesh.setMatrixAt(i, this.matrix);
        }
        if (moved) this.mesh.instanceMatrix.needsUpdate = true;
        for (const puff of this.puffs) {
            if (puff.life <= 0) continue;
            puff.life -= delta;
            const t = 1 - Math.max(0, puff.life) / puff.maxLife;
            puff.sprite.position.addScaledVector(puff.velocity, delta);
            puff.sprite.scale.setScalar(puff.size * (0.35 + 0.85 * Math.sqrt(t)));
            puff.sprite.material.opacity = Math.min(1, 0.6 * fx('dust')) * (1 - t) * (1 - t);
            puff.sprite.visible = puff.life > 0;
        }
    }
}
