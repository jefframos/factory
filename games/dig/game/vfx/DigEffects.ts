// DigEffects.ts
//
// Digging feedback (GDD §13: chunky destruction, strong particles, clear collection):
//  - a crack overlay on the block being mined, darker with damage, that jolts on every hit;
//  - debris chips in the block's colour that burst out and bounce on the floor;
//  - resource pickups: a cube pops out of the broken block and flies into the miner;
//  - selling: items tossed out of the miner onto the sell pad, with rising "+$" labels.

import * as THREE from 'three';
import { CanvasArt } from '../ui/CanvasArt';
import { BendService } from '../services/BendService';

const DEBRIS_POOL = 260;
const GRAVITY = -22;
const PICKUP_FLIGHT_SEC = 0.45;

interface Chip {
    velocity: THREE.Vector3;
    spin: THREE.Vector3;
    life: number;
}

interface Pickup {
    mesh: THREE.Object3D;
    /** Owned material to dispose (the fallback cube only). */
    material?: THREE.Material;
    from: THREE.Vector3;
    to: () => THREE.Vector3;
    age: number;
    flight: number;
    hop: number;
    /** Size while flying: shrinks into the miner, stays whole when tossed out. */
    shrink: number;
    onArrive: () => void;
}

interface FloatingText {
    sprite: THREE.Sprite;
    age: number;
}

const FLOAT_TEXT_SEC = 0.9;
/** Sold items land up to this far from where they're thrown to. */
const TOSS_SPREAD = 0.3;

function textTexture(text: string, color: string): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 96;
    const g = canvas.getContext('2d')!;
    CanvasArt.text(g, text, 128, 50, 60, color, 240, '#1d3a12');
    return CanvasArt.texture(canvas);
}

function crackTexture(): THREE.CanvasTexture {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d')!;
    g.strokeStyle = '#1a120d';
    g.lineWidth = 3;
    g.lineCap = 'round';
    const branch = (x: number, y: number, angle: number, length: number, depth: number) => {
        const nx = x + Math.cos(angle) * length;
        const ny = y + Math.sin(angle) * length;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(nx, ny);
        g.stroke();
        if (depth > 0) {
            branch(nx, ny, angle + 0.6, length * 0.6, depth - 1);
            branch(nx, ny, angle - 0.7, length * 0.55, depth - 1);
        }
    };
    for (let i = 0; i < 5; i++) {
        branch(32, 32, (i / 5) * Math.PI * 2 + 0.3, 14, 2);
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

/** A soft white blob (alpha falls off from the middle), tinted per puff. */
function puffTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const g = canvas.getContext('2d')!;
    const gradient = g.createRadialGradient(32, 32, 2, 32, 32, 31);
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 64, 64);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}

export class DigEffects {
    private readonly chips: THREE.InstancedMesh;
    private readonly chipState: Chip[] = [];
    private chipCursor = 0;
    private readonly pickups: Pickup[] = [];
    private readonly floating: FloatingText[] = [];
    private readonly textMaterials = new Map<string, THREE.SpriteMaterial>();
    private readonly pickupGeometry = new THREE.BoxGeometry(0.32, 0.32, 0.32);
    private readonly crack: THREE.Mesh;
    private readonly crackMaterial: THREE.MeshBasicMaterial;
    private readonly crackHome = new THREE.Vector3();
    private crackJolt = 0;
    private readonly matrix = new THREE.Matrix4();
    private readonly position = new THREE.Vector3();
    private readonly rotation = new THREE.Quaternion();
    private readonly euler = new THREE.Euler();
    private readonly scale = new THREE.Vector3();

    private readonly puffs: { sprite: THREE.Sprite; velocity: THREE.Vector3; life: number; maxLife: number; size: number }[] = [];
    private readonly puffTexture = puffTexture();

    /** `pickupTarget` is where resource pickups fly to (the miner). */
    public constructor(private readonly threeScene: THREE.Scene, blockHeight: number, private readonly pickupTarget: () => THREE.Vector3) {
        const chipMaterial = new THREE.MeshStandardMaterial({ roughness: 0.9 });
        BendService.applyBend(chipMaterial);
        this.chips = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), chipMaterial, DEBRIS_POOL);
        this.chips.frustumCulled = false;
        for (let i = 0; i < DEBRIS_POOL; i++) {
            this.chipState.push({ velocity: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
            this.matrix.makeScale(0, 0, 0);
            this.chips.setMatrixAt(i, this.matrix);
            this.chips.setColorAt(i, new THREE.Color(0xffffff));
        }
        threeScene.add(this.chips);

        this.crackMaterial = new THREE.MeshBasicMaterial({ map: crackTexture(), transparent: true, opacity: 0, depthWrite: false });
        BendService.applyBend(this.crackMaterial);
        this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.03, blockHeight + 0.03, 1.03), this.crackMaterial);
        this.crack.geometry.translate(0, (blockHeight + 0.03) / 2, 0);
        this.crack.visible = false;
        threeScene.add(this.crack);
    }

    /** Shows cracks on the block at `center` (floor level), `damage` 0..1; null hides them. */
    public setCrack(center: THREE.Vector3 | null, damage: number): void {
        if (!center) {
            this.crack.visible = false;
            return;
        }
        this.crack.visible = true;
        this.crackHome.copy(center);
        this.crackMaterial.opacity = 0.25 + damage * 0.7;
    }

    /**
     * A puff of smoke: `count` soft billows of `size` drifting up and out from `at`, growing and fading
     * (the tractor appearing/vanishing; one small puff = exhaust). `spread` scales how far they scatter.
     */
    public smoke(at: THREE.Vector3, count: number, size: number, color: THREE.Color, spread = 1): void {
        for (let n = 0; n < count; n++) {
            const material = new THREE.SpriteMaterial({ map: this.puffTexture, color, transparent: true, depthWrite: false, opacity: 0 });
            const sprite = new THREE.Sprite(material);
            const angle = Math.random() * Math.PI * 2;
            const out = (0.4 + Math.random() * 0.8) * spread;
            sprite.position.set(at.x + Math.cos(angle) * 0.3 * spread, at.y + Math.random() * 0.4 * spread, at.z + Math.sin(angle) * 0.3 * spread);
            sprite.renderOrder = 6;
            this.threeScene.add(sprite);
            const maxLife = 0.7 + Math.random() * 0.6;
            this.puffs.push({
                sprite, maxLife, life: maxLife, size: size * (0.7 + Math.random() * 0.6),
                velocity: new THREE.Vector3(Math.cos(angle) * out, 0.8 + Math.random() * 0.9, Math.sin(angle) * out),
            });
        }
    }

    /** A hit landed: jolts the crack overlay and throws a few chips. */
    public hit(center: THREE.Vector3, color: THREE.Color): void {
        this.crackJolt = 1;
        this.burst(center, color, 6, 3);
    }

    /** A block broke: a big burst of chips. */
    public shatter(center: THREE.Vector3, color: THREE.Color): void {
        this.burst(center, color, 22, 5.5);
    }

    private burst(center: THREE.Vector3, color: THREE.Color, count: number, power: number): void {
        for (let n = 0; n < count; n++) {
            const i = this.chipCursor;
            this.chipCursor = (this.chipCursor + 1) % DEBRIS_POOL;
            const chip = this.chipState[i];
            const angle = Math.random() * Math.PI * 2;
            chip.velocity.set(Math.cos(angle) * power * (0.3 + Math.random()), 3 + Math.random() * power, Math.sin(angle) * power * (0.3 + Math.random()));
            chip.spin.set(Math.random() * 12, Math.random() * 12, Math.random() * 12);
            chip.life = 0.7 + Math.random() * 0.5;
            this.position.set(center.x + (Math.random() - 0.5) * 0.6, 0.5 + Math.random() * 0.8, center.z + (Math.random() - 0.5) * 0.6);
            this.matrix.makeTranslation(this.position.x, this.position.y, this.position.z);
            this.chips.setMatrixAt(i, this.matrix);
            this.chips.setColorAt(i, color.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.15));
        }
        this.chips.instanceMatrix.needsUpdate = true;
        if (this.chips.instanceColor) this.chips.instanceColor.needsUpdate = true;
    }

    /**
     * A resource (its `model` — a nugget, a gem — or a cube in `color` while models load) pops out of
     * `from` and flies into the miner; `onArrive` when it lands.
     */
    public pickup(from: THREE.Vector3, color: THREE.Color, onArrive: () => void, model?: THREE.Object3D): void {
        this.fly(from, this.pickupTarget, color, onArrive, model, { delay: Math.random() * 0.12, flight: PICKUP_FLIGHT_SEC, hop: 1.2, shrink: 0.5 });
    }

    /**
     * Tosses an item (sold from the backpack) from `from` in a high arc onto `to` after `delay`;
     * `onArrive` when it lands.
     */
    public toss(from: THREE.Vector3, to: THREE.Vector3, color: THREE.Color, delay: number, onArrive: () => void, model?: THREE.Object3D): void {
        // Land scattered over the pad, and arc higher the further the throw.
        const angle = Math.random() * Math.PI * 2;
        const spread = Math.random() * TOSS_SPREAD;
        const target = to.clone().add(new THREE.Vector3(Math.cos(angle) * spread, 0, Math.sin(angle) * spread));
        const hop = 0.9 + from.distanceTo(target) * 0.35;
        this.fly(from, () => target, color, onArrive, model, { delay, flight: 0.45, hop, shrink: 0.3 });
    }

    /** A find bursts out of its block in a big, slow arc before landing in the miner. */
    public reveal(from: THREE.Vector3, onArrive: () => void, model?: THREE.Object3D): void {
        this.burst(from, new THREE.Color(0xffe27a), 26, 6);
        this.fly(from, this.pickupTarget, new THREE.Color(0xffe27a), onArrive, model, { delay: 0, flight: 1.1, hop: 3.2, shrink: 0.4 });
    }

    /** A "+$12"-style label that rises from `at` and fades. */
    public floatText(at: THREE.Vector3, text: string, color = '#9cff6a'): void {
        let material = this.textMaterials.get(text);
        if (!material) {
            material = new THREE.SpriteMaterial({ map: textTexture(text, color), depthTest: false, depthWrite: false, transparent: true });
            this.textMaterials.set(text, material);
        }
        const sprite = new THREE.Sprite(material.clone());
        sprite.scale.set(2.4, 0.9, 1);
        sprite.position.copy(at);
        sprite.renderOrder = 10;
        this.threeScene.add(sprite);
        this.floating.push({ sprite, age: 0 });
    }

    private fly(from: THREE.Vector3, to: () => THREE.Vector3, color: THREE.Color, onArrive: () => void, model: THREE.Object3D | undefined, motion: { delay: number; flight: number; hop: number; shrink: number }): void {
        let mesh: THREE.Object3D;
        let material: THREE.Material | undefined;
        if (model) {
            mesh = model;
        } else {
            const cubeMaterial = new THREE.MeshStandardMaterial({ color, emissive: color.clone().multiplyScalar(0.35), roughness: 0.4 });
            BendService.applyBend(cubeMaterial);
            mesh = new THREE.Mesh(this.pickupGeometry, cubeMaterial);
            material = cubeMaterial;
        }
        mesh.position.copy(from);
        this.threeScene.add(mesh);
        mesh.visible = motion.delay <= 0;
        this.pickups.push({ mesh, material, from: from.clone(), to, age: -motion.delay, flight: motion.flight, hop: motion.hop, shrink: motion.shrink, onArrive });
    }

    public update(delta: number): void {
        for (let i = this.puffs.length - 1; i >= 0; i--) {
            const puff = this.puffs[i];
            puff.life -= delta;
            if (puff.life <= 0) {
                puff.sprite.removeFromParent();
                puff.sprite.material.dispose();
                this.puffs.splice(i, 1);
                continue;
            }
            const t = 1 - puff.life / puff.maxLife;
            puff.velocity.multiplyScalar(Math.max(0, 1 - delta * 2.5));
            puff.sprite.position.addScaledVector(puff.velocity, delta);
            puff.sprite.scale.setScalar(puff.size * (0.5 + t * 1.3));
            // Quick fade in, long fade out.
            puff.sprite.material.opacity = 0.85 * Math.min(1, t * 6) * (1 - t);
        }
        // Debris
        let any = false;
        for (let i = 0; i < DEBRIS_POOL; i++) {
            const chip = this.chipState[i];
            if (chip.life <= 0) continue;
            any = true;
            chip.life -= delta;
            this.chips.getMatrixAt(i, this.matrix);
            this.matrix.decompose(this.position, this.rotation, this.scale);
            chip.velocity.y += GRAVITY * delta;
            this.position.addScaledVector(chip.velocity, delta);
            if (this.position.y < 0.08) {
                this.position.y = 0.08;
                chip.velocity.y *= -0.35;
                chip.velocity.x *= 0.6;
                chip.velocity.z *= 0.6;
            }
            this.euler.set(chip.spin.x * chip.life, chip.spin.y * chip.life, chip.spin.z * chip.life);
            this.rotation.setFromEuler(this.euler);
            const size = chip.life <= 0 ? 0 : Math.min(1, chip.life * 3);
            this.scale.setScalar(size);
            this.matrix.compose(this.position, this.rotation, this.scale);
            this.chips.setMatrixAt(i, this.matrix);
        }
        if (any) this.chips.instanceMatrix.needsUpdate = true;

        // Crack jolt
        if (this.crack.visible) {
            this.crackJolt = Math.max(0, this.crackJolt - delta * 6);
            const shake = this.crackJolt * 0.08;
            this.crack.position.set(this.crackHome.x + (Math.random() - 0.5) * shake, 0, this.crackHome.z + (Math.random() - 0.5) * shake);
            this.crack.scale.setScalar(1 + this.crackJolt * 0.05);
        }

        // Pickups and tossed items: an arc from where they started to their (possibly moving) target.
        for (let i = this.pickups.length - 1; i >= 0; i--) {
            const pickup = this.pickups[i];
            pickup.age += delta;
            if (pickup.age < 0) continue;
            pickup.mesh.visible = true;
            const t = Math.min(1, pickup.age / pickup.flight);
            const eased = t * t;
            pickup.mesh.position.lerpVectors(pickup.from, pickup.to(), eased);
            pickup.mesh.position.y += Math.sin(t * Math.PI) * pickup.hop;
            pickup.mesh.rotation.y += delta * 8;
            pickup.mesh.scale.setScalar(1 - t * pickup.shrink);
            if (t >= 1) {
                pickup.onArrive();
                pickup.mesh.removeFromParent();
                pickup.material?.dispose();
                this.pickups.splice(i, 1);
            }
        }

        // Floating labels: rise, swell in, fade out.
        for (let i = this.floating.length - 1; i >= 0; i--) {
            const label = this.floating[i];
            label.age += delta;
            const t = label.age / FLOAT_TEXT_SEC;
            label.sprite.position.y += delta * 1.6;
            const pop = Math.min(1, t * 6);
            label.sprite.scale.set(2.4 * pop, 0.9 * pop, 1);
            label.sprite.material.opacity = t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4;
            if (t >= 1) {
                label.sprite.removeFromParent();
                label.sprite.material.dispose();
                this.floating.splice(i, 1);
            }
        }
    }

    public destroy(): void {
        this.puffs.forEach((puff) => puff.sprite.removeFromParent());
        this.chips.removeFromParent();
        this.chips.dispose();
        this.crack.removeFromParent();
        for (const pickup of this.pickups) {
            pickup.mesh.removeFromParent();
        }
        this.pickups.length = 0;
        for (const label of this.floating) {
            label.sprite.removeFromParent();
            label.sprite.material.dispose();
        }
        this.floating.length = 0;
        for (const material of this.textMaterials.values()) {
            material.map?.dispose();
            material.dispose();
        }
        this.textMaterials.clear();
    }
}
