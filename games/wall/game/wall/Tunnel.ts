// Tunnel.ts
//
// What the walls stand in: a row of gates. Each is a steel frame round the wall (its edge: nothing past it breaks) in a wall
// of big blocks that runs off both sides of any screen, lights up its posts; the next one stands WALL.gap behind it, where the
// next wall waits in the dark (the scene's fog). It's grey, so the walls stand out, the lights and the dark in the
// wall's room's colour (its material's), blended to the next's as the player walks on. There are two, the same: the player walks through the first to the second, and then
// everything's moved back by a gap, which nobody sees. The floor's lines are evenly spaced within a gap for the same reason.
//
// And the medal: from some wall on (ui/wall.json `medal`), a golden one turns in the light between the wall and the next
// gate; the wall down, it's the player's (the HUD's: it flies to where they're counted).

import * as THREE from 'three';
import { vivid } from '../config/Effects';
import { WALL, hash } from '../data/WallConfig';

export const WALL_WIDTH = WALL.cols * WALL.cell;
export const WALL_HEIGHT = WALL.rows * WALL.cell;

const FRAME = { thick: 0.34, front: 0.14, back: -1.9, light: 0.09 };
const BLOCK = { size: 0.95, reach: 16.5, top: 14.5, z: -0.42, jitter: 0.07, vary: 0.3 };
const LINES = { every: 2, width: 0.09, from: 18, reach: 34 };
/**
 * What doesn't break: grey, so the walls stand out, with only a touch of the room's colour (how saturated, how light, in
 * linear colour). The dark behind has more of it.
 */
const ROOM = { block: [0.07, 0.115], frame: [0.06, 0.26], beam: [0.06, 0.17], floor: [0.1, 0.07], line: [0.1, 0.045], dark: [0.4, 0.02] } as const;
const MEDAL = { z: -3.4, y: WALL_HEIGHT * 0.5, size: 1.25, spin: 1.9, layers: 9, thick: 0.2, edge: 0xc9761a, bob: 0.12, rays: 6.4, glow: 5.2 };

/** What's over a boss's gate: spikes, the skull's size and how far up it is, its light. */
const BOSS_MARK = { spikes: 9, skull: 0.72, up: 0.62, glow: 3.6 };

/** A picture cut out and thick: layers of it, the ones inside dark gold. */
function thickPicture(canvas: HTMLCanvasElement, edge: THREE.ColorRepresentation = MEDAL.edge): THREE.Group {
    const group = new THREE.Group();
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    const plane = new THREE.PlaneGeometry((2 * canvas.width) / Math.max(canvas.width, canvas.height), (2 * canvas.height) / Math.max(canvas.width, canvas.height));
    const face = new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, fog: false });
    const inside = new THREE.MeshBasicMaterial({ map, color: edge, alphaTest: 0.5, side: THREE.DoubleSide, fog: false });
    for (let i = 0; i < MEDAL.layers; i++) {
        const t = i / (MEDAL.layers - 1);
        const mesh = new THREE.Mesh(plane, i === 0 || i === MEDAL.layers - 1 ? face : inside);
        mesh.position.z = (t - 0.5) * MEDAL.thick;
        // (The back's the right way round too.)
        if (i === 0) mesh.rotation.y = Math.PI;
        group.add(mesh);
    }
    return group;
}

/** Soft light, or rays of it, drawn. */
function light(rays: boolean): THREE.Sprite {
    const canvas = document.createElement('canvas');
    const s = (canvas.width = canvas.height = 256);
    const c = canvas.getContext('2d')!;
    const fade = c.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
    fade.addColorStop(0, rays ? 'rgba(255,226,130,0.75)' : 'rgba(255,232,150,1)');
    fade.addColorStop(0.45, rays ? 'rgba(255,200,70,0.35)' : 'rgba(255,190,50,0.45)');
    fade.addColorStop(1, 'rgba(255,170,30,0)');
    c.fillStyle = fade;
    if (!rays) c.fillRect(0, 0, s, s);
    else for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        c.beginPath();
        c.moveTo(s / 2, s / 2);
        c.arc(s / 2, s / 2, s / 2, a, a + Math.PI / 12);
        c.fill();
    }
    const map = new THREE.CanvasTexture(canvas);
    map.colorSpace = THREE.SRGBColorSpace;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
}

/** How fast the next room's colour comes in. */
const ROOM_BLEND = 3;
const tone = { h: 0, s: 0, l: 0 };

export class Tunnel {
    public readonly group = new THREE.Group();
    private readonly medal = new THREE.Group();
    private readonly coin = new THREE.Group();
    private readonly rays = light(true);
    private readonly glow = light(false);
    private time = 0;
    private markTime = 0;
    private readonly paints = Object.fromEntries(Object.keys(ROOM).map((part) => [part, new THREE.MeshLambertMaterial()])) as Record<keyof typeof ROOM, THREE.MeshLambertMaterial>;
    private readonly lights = new THREE.MeshBasicMaterial({ fog: false });
    private readonly room = new THREE.Color();
    private readonly accent = new THREE.Color();
    private readonly roomTo = new THREE.Color();
    private readonly accentTo = new THREE.Color();

    /** The dark between the gates (the fog, the sky). */
    public readonly dark = new THREE.Color();

    /** The boss's marks over each gate (this one's, the next's). */
    private readonly marks: THREE.Group[] = [];
    private readonly markGlows: THREE.Sprite[] = [];

    public constructor() {
        const gate = new THREE.Group();
        this.buildFrame(gate);
        this.buildBlocks(gate);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(120, 90).rotateX(-Math.PI / 2), this.paints.floor);
        floor.position.z = -15;
        this.group.add(floor);
        const next = gate.clone();
        next.position.z = -WALL.gap;
        this.group.add(gate, next);
        for (const z of [0, -WALL.gap]) this.buildMark(z);
        this.buildLines();
        this.rays.scale.setScalar(MEDAL.rays);
        this.glow.scale.setScalar(MEDAL.glow);
        this.rays.position.z = this.glow.position.z = -0.8;
        this.coin.scale.setScalar(MEDAL.size);
        this.medal.add(this.rays, this.glow, this.coin);
        this.medal.position.set(0, MEDAL.y, MEDAL.z);
        this.medal.visible = false;
        this.group.add(this.medal);
    }

    private buildFrame(gate: THREE.Group): void {
        const { thick, front, back, light: strip } = FRAME;
        const { frame: color, beam: dark } = this.paints;
        const bar = (width: number, height: number, x: number, y: number, paint: THREE.Material, forward = 0) => {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, front - back), paint);
            mesh.position.set(x, y, (front + back) / 2 + forward);
            gate.add(mesh);
        };
        for (const side of [-1, 1]) {
            bar(thick, WALL_HEIGHT + thick, side * (WALL_WIDTH / 2 + thick / 2), (WALL_HEIGHT + thick) / 2, color);
            // Its feet.
            bar(thick * 1.5, 0.5, side * (WALL_WIDTH / 2 + thick * 0.75), 0.25, dark, 0.08);
        }
        bar(WALL_WIDTH + thick * 2, thick, 0, WALL_HEIGHT + thick / 2, dark, 0.06);
        // Lights up the posts and along the beam.
        const glow = (width: number, height: number, x: number, y: number) => {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, 0.06), this.lights);
            mesh.position.set(x, y, front + 0.07);
            gate.add(mesh);
        };
        for (const side of [-1, 1]) glow(strip, WALL_HEIGHT - 0.9, side * (WALL_WIDTH / 2 + thick / 2), WALL_HEIGHT / 2 + 0.25);
        glow(WALL_WIDTH - 0.5, strip, 0, WALL_HEIGHT + thick / 2);
    }

    private buildBlocks(gate: THREE.Group): void {
        const { size, reach, top, z, jitter, vary } = BLOCK;
        const places: [number, number][] = [];
        const edge = WALL_WIDTH / 2 + FRAME.thick;
        for (const side of [-1, 1]) {
            for (let x = edge + size / 2; x < reach; x += size) for (let y = size / 2; y < top; y += size) places.push([side * x, y]);
        }
        const across = Math.ceil((edge * 2) / size);
        for (let y = WALL_HEIGHT + FRAME.thick + size / 2; y < top; y += size) {
            for (let i = 0; i < across; i++) places.push([-edge + (i + 0.5) * ((edge * 2) / across), y]);
        }
        const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this.paints.block, places.length);
        const matrix = new THREE.Matrix4();
        const tint = new THREE.Color();
        places.forEach(([x, y], i) => {
            const own = hash(Math.round(x * 10), Math.round(y * 10), 3, 5);
            const scale = size * 0.975;
            matrix.makeScale(scale, scale, scale).setPosition(x, y, z + (own - 0.5) * 2 * jitter);
            mesh.setMatrixAt(i, matrix);
            mesh.setColorAt(i, tint.setScalar(1 - vary / 2 + own * vary));
        });
        mesh.frustumCulled = false;
        gate.add(mesh);
    }

    private buildLines(): void {
        const { every, width, from, reach } = LINES;
        const count = Math.floor((from + WALL.gap * 2) / every);
        const lines = new THREE.InstancedMesh(new THREE.PlaneGeometry(reach, width).rotateX(-Math.PI / 2), this.paints.line, count);
        const matrix = new THREE.Matrix4();
        for (let i = 0; i < count; i++) lines.setMatrixAt(i, matrix.makeTranslation(0, 0.006, from - 1 - i * every));
        lines.frustumCulled = false;
        this.group.add(lines);
    }

    /** The room's colour and its lights': at once, or over some time (blended as it's updated). */
    public setRoom(room: string, accent: string, hue = 0, atOnce = false): void {
        vivid(this.roomTo.set(room).offsetHSL(hue, 0, 0));
        this.accentTo.set(accent).offsetHSL(hue, 0, 0);
        if (!atOnce) return;
        this.room.copy(this.roomTo);
        this.accent.copy(this.accentTo);
        this.paint();
    }

    private paint(): void {
        this.room.getHSL(tone);
        for (const part of Object.keys(ROOM) as (keyof typeof ROOM)[]) {
            const [saturation, lightness] = ROOM[part];
            this.paints[part].color.setHSL(tone.h, saturation, lightness);
        }
        this.dark.copy(this.paints.dark.color);
        this.lights.color.copy(this.accent);
    }

    /** Over a boss's gate: spikes along the beam, a red light, and the skull (setSkull). */
    private buildMark(z: number): void {
        const mark = new THREE.Group();
        const spike = new THREE.ConeGeometry(0.17, 0.62, 6).translate(0, 0.31, 0);
        const bone = new THREE.MeshLambertMaterial({ color: 0xf3e3c0 });
        for (let i = 0; i < BOSS_MARK.spikes; i++) {
            const along = (i / (BOSS_MARK.spikes - 1)) * 2 - 1;
            if (Math.abs(along) < 0.22) continue;
            const mesh = new THREE.Mesh(spike, bone);
            mesh.position.set(along * (WALL_WIDTH / 2 + 0.1), WALL_HEIGHT + FRAME.thick, 0.05);
            mesh.rotation.z = -along * 0.3;
            mark.add(mesh);
        }
        const glow = light(false);
        glow.material.color.set(0xff2a1a);
        glow.scale.setScalar(BOSS_MARK.glow);
        glow.position.set(0, WALL_HEIGHT + BOSS_MARK.up, 0.2);
        mark.add(glow);
        mark.position.z = z;
        mark.visible = false;
        this.marks.push(mark);
        this.markGlows.push(glow);
        this.group.add(mark);
    }

    /** The skull over a boss's gate, its picture. */
    public setSkull(canvas: HTMLCanvasElement): void {
        for (const mark of this.marks) {
            const skull = thickPicture(canvas, 0x6a5a48);
            skull.scale.setScalar(BOSS_MARK.skull);
            skull.position.set(0, WALL_HEIGHT + BOSS_MARK.up, 0.45);
            mark.add(skull);
        }
    }

    /** A boss's gate here, and at the next one. */
    public setBoss(here: boolean, next: boolean): void {
        this.marks[0].visible = here;
        this.marks[1].visible = next;
    }

    /** Its picture, once it's there. */
    public setMedal(canvas: HTMLCanvasElement): void {
        this.coin.add(thickPicture(canvas));
    }

    public showMedal(shown: boolean): void {
        this.medal.visible = shown;
    }

    /** It's taken: where it was (undefined: there was none). */
    public takeMedal(): THREE.Vector3 | undefined {
        if (!this.medal.visible) return undefined;
        this.medal.visible = false;
        return this.medal.position.clone();
    }

    public update(delta: number): void {
        if (!this.room.equals(this.roomTo) || !this.accent.equals(this.accentTo)) {
            const t = 1 - Math.exp(-delta * ROOM_BLEND);
            this.room.lerp(this.roomTo, t);
            this.accent.lerp(this.accentTo, t);
            if (Math.abs(this.room.r - this.roomTo.r) + Math.abs(this.room.g - this.roomTo.g) + Math.abs(this.room.b - this.roomTo.b) < 0.004) {
                this.room.copy(this.roomTo);
                this.accent.copy(this.accentTo);
            }
            this.paint();
        }
        this.markTime += delta;
        this.markGlows.forEach((glow) => glow.scale.setScalar(BOSS_MARK.glow * (1 + 0.14 * Math.sin(this.markTime * 4))));
        if (!this.medal.visible) return;
        this.time += delta;
        this.coin.rotation.y = this.time * MEDAL.spin;
        this.coin.position.y = Math.sin(this.time * 2.2) * MEDAL.bob;
        this.rays.material.rotation = this.time * 0.35;
        this.glow.scale.setScalar(MEDAL.glow * (1 + 0.08 * Math.sin(this.time * 4)));
    }
}
