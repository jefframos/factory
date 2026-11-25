// TapMarks.ts
//
// Circles on the minions, in the first few fights: one on each, a ring closing in on it. Tapped, the hit does more, the circle
// pops and comes up somewhere else on it. (A boss has the weak spot.) Over everything in the world, as the weak spot is.

import * as THREE from 'three';
import { ENEMIES } from '../data/WallConfig';
import { markSprite, markTexture, openRing, ring } from '../wall/WeakSpot';
import type { Enemy } from './Enemies';

/** A circle's size (a share of its enemy's height, within these), and how far off its middle it comes (shares of the height). */
const SIZE = { share: 0.62, least: 0.85, most: 1.25 };
const SPREAD = { x: 0.22, y: 0.24, front: 0.45 };
/** Coming up, the ring closing again and again, popping, and back after (seconds). */
const TIME = { in: 0.16, close: 0.75, pop: 0.2, again: 0.12 };
const MOST = 6;

interface Mark {
    target: THREE.Sprite;
    closing: THREE.Sprite;
    pop: THREE.Sprite;
    enemy?: Enemy;
    off: THREE.Vector3;
    /** Seconds till it's there (below 0: it's been there). */
    wait: number;
    popped: number;
}

export class TapMarks {
    public readonly group = new THREE.Group();
    private readonly marks: Mark[] = [];
    private readonly point = new THREE.Vector3();

    public constructor() {
        const target = openRing();
        const closing = markTexture((context, m) => {
            ring(context, m, 56, 9, 'rgba(70,25,0,0.5)');
            ring(context, m, 56, 4, '#ffb04a');
        });
        const pop = markTexture((context, m) => ring(context, m, 52, 9, '#ffb04a'));
        for (let i = 0; i < MOST; i++) {
            const mark: Mark = { target: markSprite(target), closing: markSprite(closing), pop: markSprite(pop), off: new THREE.Vector3(), wait: 0, popped: 0 };
            this.group.add(mark.target, mark.closing, mark.pop);
            this.marks.push(mark);
        }
    }

    /** `enemies`: those to have one now. */
    public update(delta: number, enemies: readonly Enemy[]): void {
        for (const mark of this.marks) {
            if (mark.enemy && !enemies.includes(mark.enemy)) mark.enemy = undefined;
        }
        for (const enemy of enemies) {
            // (Once it's there.)
            if (enemy.phase !== 'idle' || this.marks.some((mark) => mark.enemy === enemy)) continue;
            const free = this.marks.find((mark) => !mark.enemy);
            if (!free) break;
            free.enemy = enemy;
            this.move(free, Math.random() * 0.25);
        }
        for (const mark of this.marks) this.step(mark, delta);
    }

    private move(mark: Mark, wait: number): void {
        const height = mark.enemy?.spec.height ?? 1;
        mark.off.set((Math.random() * 2 - 1) * SPREAD.x * height, (Math.random() * 2 - 1) * SPREAD.y * height, SPREAD.front * height);
        mark.wait = wait;
    }

    private step(mark: Mark, delta: number): void {
        const { target, closing, pop, enemy } = mark;
        mark.popped = Math.max(0, mark.popped - delta);
        pop.visible = mark.popped > 0;
        if (pop.visible) {
            const t = 1 - mark.popped / TIME.pop;
            pop.scale.setScalar(1 + t * 1.5);
            pop.material.opacity = 1 - t;
        }
        if (enemy) mark.wait -= delta;
        target.visible = closing.visible = !!enemy && mark.wait <= 0;
        if (!enemy || mark.wait > 0) return;
        const shown = -mark.wait;
        const size = THREE.MathUtils.clamp(enemy.spec.height * SIZE.share, SIZE.least, SIZE.most) * Math.min(1, shown / TIME.in);
        enemy.middle(target.position).add(mark.off);
        closing.position.copy(target.position);
        target.scale.setScalar(size);
        const t = (shown % TIME.close) / TIME.close;
        closing.scale.setScalar(size * (1.75 - 1.05 * t));
        closing.material.opacity = Math.min(1, t * 4);
    }

    /** The circle at a spot on the screen (-1..1), and where it is on it. */
    public at(x: number, y: number, camera: THREE.PerspectiveCamera): { enemy: Enemy; x: number; y: number } | null {
        let best: { enemy: Enemy; x: number; y: number } | null = null;
        let nearest = ENEMIES.circles.radius * 2;
        for (const { target, enemy } of this.marks) {
            if (!enemy || !target.visible) continue;
            this.point.copy(target.position).project(camera);
            const off = Math.hypot((this.point.x - x) * camera.aspect, this.point.y - y);
            if (off >= nearest) continue;
            nearest = off;
            best = { enemy, x: this.point.x, y: this.point.y };
        }
        return best;
    }

    /** An enemy's circle was hit. */
    public hit(enemy: Enemy): void {
        const mark = this.marks.find((one) => one.enemy === enemy);
        if (!mark) return;
        mark.pop.position.copy(mark.target.position);
        mark.popped = TIME.pop;
        this.move(mark, TIME.again);
    }
}
