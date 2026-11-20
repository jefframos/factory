// ConveyorBelt.ts
//
// A conveyor belt in a den (den-local): a dark band whose stripes scroll, on rails and legs, along a path of points;
// things ride it (each \`spacing\` behind the one ahead) to its end, where the den takes them when it can (onEnd). Used
// for the gold belt (packs from the packing machine into the gold machine); the egg belt is ChickenDen's own.

import * as THREE from 'three';
import { BendService } from '../services/BendService';
import { CanvasArt } from '../ui/CanvasArt';

/** Its width, its surface's height, its band's thickness. */
export const BELT_SHAPE = { width: 0.6, top: 0.36, height: 0.1 };

export class ConveyorBelt {
    public readonly group = new THREE.Group();
    private readonly points: THREE.Vector2[];
    private readonly lengths: number[];
    public readonly total: number;
    private readonly surfaces: THREE.Texture[] = [];
    /** What's riding it: how far along, its object. */
    private readonly items: { s: number; object: THREE.Object3D }[] = [];

    public constructor(parent: THREE.Object3D, points: THREE.Vector2[], rail: THREE.Material, leg: THREE.Material) {
        this.points = points;
        this.lengths = points.slice(1).map((p, i) => p.distanceTo(points[i]));
        this.total = this.lengths.reduce((a, b) => a + b, 0);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const g = canvas.getContext('2d')!;
        g.fillStyle = '#2c2f36';
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = '#5a4a2a';
        for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 6);
        const base = CanvasArt.texture(canvas);
        base.wrapS = base.wrapT = THREE.RepeatWrapping;
        const { width, top, height } = BELT_SHAPE;
        points.slice(1).forEach((to, i) => {
            const from = points[i];
            const length = this.lengths[i];
            const stretch = new THREE.Group();
            const middle = from.clone().add(to).multiplyScalar(0.5);
            stretch.position.set(middle.x, 0, middle.y);
            stretch.rotation.y = Math.atan2(to.x - from.x, to.y - from.y);
            const map = base.clone();
            map.repeat.set(1, length / width);
            this.surfaces.push(map);
            const surface = new THREE.MeshStandardMaterial({ map, roughness: 0.7 });
            BendService.applyBend(surface);
            const band = new THREE.Mesh(new THREE.BoxGeometry(width, height, length + width * 0.5), [rail, rail, surface, rail, rail, rail]);
            band.position.y = top - height / 2;
            stretch.add(band);
            for (const side of [-1, 1]) {
                const guard = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, length + width * 0.5), rail);
                guard.position.set(side * (width / 2 + 0.02), top + 0.03, 0);
                stretch.add(guard);
            }
            for (let along = -length / 2; along <= length / 2 + 0.01; along += 1.2) {
                const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, top - height, 0.08), leg);
                post.position.set(0, (top - height) / 2, along);
                stretch.add(post);
            }
            this.group.add(stretch);
        });
        parent.add(this.group);
    }

    /** The point \`s\` along it (den-local, on its surface). */
    public at(s: number, out: THREE.Vector3): THREE.Vector3 {
        let left = Math.max(0, Math.min(this.total, s));
        for (let i = 0; i < this.lengths.length; i++) {
            if (left <= this.lengths[i] || i === this.lengths.length - 1) {
                const p = this.points[i].clone().lerp(this.points[i + 1], this.lengths[i] > 0 ? Math.min(1, left / this.lengths[i]) : 0);
                return out.set(p.x, BELT_SHAPE.top + 0.01, p.y);
            }
            left -= this.lengths[i];
        }
        return out.set(this.points[0].x, BELT_SHAPE.top, this.points[0].y);
    }

    /** Whether there's room at its start for one more. */
    public roomAtStart(spacing: number): boolean {
        return this.items.every((item) => item.s >= spacing);
    }

    /** \`object\` onto its start. */
    public add(object: THREE.Object3D): void {
        this.at(0, object.position);
        this.group.parent?.add(object);
        this.items.push({ s: 0, object });
    }

    /**
     * Scrolls and moves what's on it along at \`speed\`, \`spacing\` apart; the one at the end is offered to \`take\`
     * (true: taken, it's off the belt — removed from the scene by the caller or here).
     */
    public update(delta: number, speed: number, spacing: number, take: (object: THREE.Object3D) => boolean): void {
        for (const map of this.surfaces) map.offset.y -= (delta * speed) / BELT_SHAPE.width;
        this.items.sort((a, b) => b.s - a.s);
        let ahead = Infinity;
        for (const item of this.items) {
            item.s = Math.min(this.total, ahead - spacing, item.s + speed * delta);
            item.s = Math.max(0, item.s);
            ahead = item.s;
            this.at(item.s, item.object.position);
        }
        const first = this.items[0];
        if (first && first.s >= this.total - 1e-3 && take(first.object)) {
            this.items.shift();
            first.object.removeFromParent();
        }
    }

    /** How many are on it (counted as still in the line). */
    public get count(): number {
        return this.items.length;
    }

    public destroy(): void {
        this.items.forEach((item) => item.object.removeFromParent());
        this.group.removeFromParent();
    }
}
