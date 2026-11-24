// WeakSpot.ts
//
// The wall's weak spot: a glowing target that drifts over its face. Hit, it does far more, and it jumps somewhere else; hit
// again in time, the combo goes up a step, and every hit does more while it lasts. The ring round it closes as the time runs
// out. (Over everything in the world: it's never behind a piece.)

import * as THREE from 'three';
import { WALL, WEAK } from '../data/WallConfig';
import { WallProgress } from '../data/WallProgress';
import { WALL_HEIGHT, WALL_WIDTH } from './Tunnel';

const SIZE = 1.05;
const FRONT = 0.35;
/** Kept this far from the wall's edges. */
const EDGE = 0.55;

function texture(draw: (context: CanvasRenderingContext2D, middle: number) => void): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    draw(canvas.getContext('2d')!, 64);
    const made = new THREE.CanvasTexture(canvas);
    made.colorSpace = THREE.SRGBColorSpace;
    return made;
}

function ring(context: CanvasRenderingContext2D, middle: number, radius: number, width: number, color: string): void {
    context.strokeStyle = color;
    context.lineWidth = width;
    context.beginPath();
    context.arc(middle, middle, radius, 0, Math.PI * 2);
    context.stroke();
}

function sprite(map: THREE.Texture): THREE.Sprite {
    const made = new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthTest: false, depthWrite: false }));
    made.renderOrder = 10;
    made.visible = false;
    return made;
}

export class WeakSpot {
    public readonly group = new THREE.Group();
    /** The combo's step (0: none) and the seconds left to hit it again. */
    public combo = 0;
    public left = 0;
    private readonly target: THREE.Sprite;
    private readonly closing: THREE.Sprite;
    private readonly drift = new THREE.Vector2();
    /** Seconds until it shows, and it's been there. */
    private wait = WEAK.after;
    private shownFor = 0;
    private clock = 0;

    public constructor() {
        this.target = sprite(texture((context, m) => {
            const glow = context.createRadialGradient(m, m, 4, m, m, 62);
            glow.addColorStop(0, 'rgba(255,250,210,1)');
            glow.addColorStop(0.25, 'rgba(255,214,90,0.85)');
            glow.addColorStop(0.6, 'rgba(255,150,30,0.35)');
            glow.addColorStop(1, 'rgba(255,120,20,0)');
            context.fillStyle = glow;
            context.fillRect(0, 0, 128, 128);
            ring(context, m, 34, 9, 'rgba(90,30,0,0.8)');
            ring(context, m, 34, 5, '#ffffff');
            context.fillStyle = '#ff5a2a';
            context.beginPath();
            context.arc(m, m, 14, 0, Math.PI * 2);
            context.fill();
            ring(context, m, 14, 4, '#ffffff');
        }));
        this.closing = sprite(texture((context, m) => {
            ring(context, m, 56, 11, 'rgba(70,25,0,0.7)');
            ring(context, m, 56, 6, '#fff27a');
        }));
        this.group.add(this.target, this.closing);
    }

    public get visible(): boolean {
        return this.target.visible;
    }

    public get position(): THREE.Vector3 {
        return this.target.position;
    }

    /** Hit: the combo's step now. */
    public hit(): number {
        this.combo = this.left > 0 ? Math.min(this.combo + 1, WallProgress.comboSteps) : 1;
        this.left = WEAK.window;
        this.hide(WEAK.again);
        return this.combo;
    }

    /** Away, and back in a while. */
    public hide(wait = WEAK.after): void {
        this.target.visible = this.closing.visible = false;
        this.wait = wait;
    }

    public reset(): void {
        this.hide();
        this.combo = 0;
        this.left = 0;
    }

    /** `active`: the wall's there to hit; `place`: a spot of it still standing. */
    public update(delta: number, active: boolean, place: () => THREE.Vector3 | null): void {
        this.clock += delta;
        if (this.left > 0) {
            // (Not while there's none to hit.)
            if (this.target.visible) this.left -= delta;
            if (this.left <= 0) this.combo = 0;
        }
        if (!active) {
            if (this.target.visible) this.hide();
            return;
        }
        if (!this.target.visible) {
            this.wait -= delta;
            if (this.wait > 0) return;
            const at = place();
            if (!at) return;
            this.target.position.set(
                THREE.MathUtils.clamp(at.x, -WALL_WIDTH / 2 + EDGE, WALL_WIDTH / 2 - EDGE),
                THREE.MathUtils.clamp(at.y, WALL.cell * 4, WALL_HEIGHT - EDGE),
                FRONT,
            );
            const turn = Math.random() * Math.PI * 2;
            this.drift.set(Math.cos(turn), Math.sin(turn)).multiplyScalar(WEAK.drift);
            this.shownFor = 0;
            this.target.visible = true;
        }
        this.shownFor += delta;
        if (this.shownFor > WEAK.stays && this.left <= 0) {
            this.hide(0.2);
            return;
        }
        const position = this.target.position;
        position.x += this.drift.x * delta;
        position.y += this.drift.y * delta;
        if (Math.abs(position.x) > WALL_WIDTH / 2 - EDGE) this.drift.x = -Math.sign(position.x) * Math.abs(this.drift.x);
        if (position.y > WALL_HEIGHT - EDGE) this.drift.y = -Math.abs(this.drift.y);
        if (position.y < WALL.cell * 4) this.drift.y = Math.abs(this.drift.y);
        const pop = Math.min(1, this.shownFor / 0.14);
        this.target.scale.setScalar(SIZE * pop * (1 + Math.sin(this.clock * 7) * 0.06));
        this.closing.visible = this.left > 0;
        this.closing.position.copy(position);
        this.closing.scale.setScalar(SIZE * (0.75 + 1.15 * Math.max(0, this.left / WEAK.window)));
    }
}
