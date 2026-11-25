// LevelTotem.ts
//
// The totem in the middle of the hub: how far the player has come. A carved stone base with a ring filling up with the XP
// to the next level, and on it a pole of wooden blocks with faces, one more every few levels (ui/dig.json levels.totem), each
// in its colour and turned a little; every one of them makes everything sold worth more, for good. The level's on a badge
// over it, what the next piece takes under that. A level up makes the whole of it jump and glow; a new piece drops on.

import * as THREE from 'three';
import gsap from 'gsap';
import { BendService } from '../services/BendService';
import { DIG } from '../data/DigConfig';
import { DigProgress } from '../data/DigProgress';
import { HUB } from '../data/HubData';
import { CanvasArt } from '../ui/CanvasArt';

const BASE = { radius: 0.78, top: 0.66, height: 0.42 };
const RING = { radius: 1.05, width: 0.16, y: 0.05, color: 0x6fe3ff, track: 0x2a2f3a, segments: 60 };
const BLOCK = { width: 0.82, gap: 0.015, taper: 0.018 };
/** The blocks' colours, from the ground up. */
const COLORS = ['#b5713c', '#8fa3b8', '#5b78c9', '#d97b4a', '#8a5cc9', '#e0555f', '#3fb0a0', '#f2b230', '#e26fc2', '#ffd65a'];
const LABEL = { width: 2, height: 0.84, over: 0.75 };
const HOP_SEC = 0.6;

/** A block's face, carved: eyes, a nose and a mouth of its own. */
function faceTexture(color: string, kind: number): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d')!;
    g.fillStyle = color;
    g.fillRect(0, 0, 128, 128);
    // Grain, and a darker rim.
    g.strokeStyle = 'rgba(0, 0, 0, 0.1)';
    g.lineWidth = 3;
    for (let y = 14; y < 128; y += 17) {
        g.beginPath();
        g.moveTo(0, y);
        g.quadraticCurveTo(64, y + ((kind * 7 + y) % 9) - 4, 128, y + 2);
        g.stroke();
    }
    g.lineWidth = 12;
    g.strokeStyle = 'rgba(0, 0, 0, 0.22)';
    g.strokeRect(0, 0, 128, 128);
    const dark = 'rgba(28, 16, 12, 0.85)';
    const eye = (x: number) => {
        g.fillStyle = '#fff6df';
        g.beginPath();
        if (kind % 3 === 0) g.ellipse(x, 48, 17, 17, 0, 0, Math.PI * 2);
        else if (kind % 3 === 1) g.roundRect(x - 18, 36, 36, 22, 8);
        else g.ellipse(x, 48, 19, 12, x < 64 ? 0.35 : -0.35, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = dark;
        g.beginPath();
        g.arc(x, 49, 8, 0, Math.PI * 2);
        g.fill();
    };
    eye(38);
    eye(90);
    g.fillStyle = 'rgba(28, 16, 12, 0.45)';
    g.beginPath();
    g.moveTo(64, 50);
    g.lineTo(76, 78);
    g.lineTo(52, 78);
    g.closePath();
    g.fill();
    g.fillStyle = dark;
    g.beginPath();
    g.roundRect(30, 90, 68, 22, kind % 2 ? 11 : 4);
    g.fill();
    g.fillStyle = '#fff6df';
    for (let i = 0; i < 4; i++) g.fillRect(36 + i * 15, kind % 2 ? 90 : 101, 9, 11);
    return CanvasArt.texture(canvas);
}

export class LevelTotem {
    private readonly group = new THREE.Group();
    private readonly pole = new THREE.Group();
    private readonly blocks: THREE.Mesh[] = [];
    private readonly fill: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    private readonly label: THREE.Sprite;
    private readonly canvas = document.createElement('canvas');
    private readonly texture: THREE.CanvasTexture;
    private drawn = '';
    private shownShare = -1;
    private glow = 0;
    private time = 0;

    public constructor(private readonly threeScene: THREE.Scene) {
        const at = HUB.totem ?? { x: 0, z: 0, height: 0.42 };
        this.group.position.set(at.x, 0, at.z);
        const stone = this.material(new THREE.MeshStandardMaterial({ color: 0x8d8478, roughness: 0.95, flatShading: true }));
        const base = new THREE.Mesh(new THREE.CylinderGeometry(BASE.top, BASE.radius, BASE.height, 8), stone);
        base.position.y = BASE.height / 2;
        const track = new THREE.Mesh(new THREE.RingGeometry(RING.radius - RING.width / 2, RING.radius + RING.width / 2, RING.segments),
            this.material(new THREE.MeshBasicMaterial({ color: RING.track })));
        track.rotation.x = -Math.PI / 2;
        track.position.y = RING.y;
        this.fill = new THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>(new THREE.BufferGeometry(), this.material(new THREE.MeshBasicMaterial({ color: RING.color })));
        this.fill.position.y = RING.y + 0.012;
        this.pole.position.y = BASE.height;
        this.group.add(base, track, this.fill, this.pole);
        this.canvas.width = 384;
        this.canvas.height = 160;
        this.texture = CanvasArt.texture(this.canvas);
        this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthWrite: false }));
        this.label.scale.set(LABEL.width, LABEL.height, 1);
        this.label.renderOrder = 4;
        this.group.add(this.label);
        threeScene.add(this.group);
        for (let i = 0; i < DigProgress.totemPieces; i++) this.addBlock(false);
        // (The kit's font may not be in yet.)
        window.setTimeout(() => (this.drawn = ''), 1200);
        this.refresh();
    }

    private material<T extends THREE.Material>(material: T): T {
        BendService.applyBend(material);
        return material;
    }

    private get blockHeight(): number {
        return (HUB.totem?.height ?? 0.42) + BLOCK.gap;
    }

    /** The next block on the pole; `drop`: falling onto it. */
    private addBlock(drop: boolean): void {
        const i = this.blocks.length;
        const color = COLORS[i % COLORS.length];
        const width = BLOCK.width * (1 - BLOCK.taper * i);
        const side = this.material(new THREE.MeshStandardMaterial({ color, roughness: 0.85 }));
        const face = this.material(new THREE.MeshStandardMaterial({ map: faceTexture(color, i), roughness: 0.85 }));
        // (Faces on its front and back: BoxGeometry's are +x, -x, +y, -y, +z, -z.)
        const block = new THREE.Mesh(new THREE.BoxGeometry(width, HUB.totem?.height ?? 0.42, width), [side, side, side, side, face, face]);
        block.position.y = (i + 0.5) * this.blockHeight;
        block.rotation.y = Math.sin(i * 2.4) * 0.3;
        this.blocks.push(block);
        this.pole.add(block);
        if (!drop) return;
        gsap.from(block.position, { y: block.position.y + 4, duration: 0.7, ease: 'bounce.out' });
        gsap.from(block.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.25 });
    }

    /** A level's reached: a jump and a glow, and a new piece if there's one. */
    public celebrate(): void {
        this.glow = 1;
        gsap.killTweensOf(this.pole.scale);
        gsap.fromTo(this.pole.scale, { x: 1.25, y: 0.75, z: 1.25 }, { x: 1, y: 1, z: 1, duration: HOP_SEC, ease: 'elastic.out(1, 0.4)' });
        while (this.blocks.length < DigProgress.totemPieces) this.addBlock(true);
        this.refresh();
    }

    private refresh(): void {
        const { level, into, need } = DigProgress.levelNow;
        const share = Math.max(0, Math.min(1, into / need));
        if (Math.abs(share - this.shownShare) > 0.004) {
            this.shownShare = share;
            this.fill.geometry.dispose();
            const geometry = new THREE.RingGeometry(RING.radius - RING.width / 2, RING.radius + RING.width / 2, Math.max(2, Math.ceil(RING.segments * share)), 1, Math.PI / 2, -Math.PI * 2 * share);
            geometry.rotateX(-Math.PI / 2);
            // (Wound the other way round: turned to face up.)
            const index = geometry.index!;
            for (let i = 0; i < index.count; i += 3) {
                const a = index.getX(i);
                index.setX(i, index.getX(i + 1));
                index.setX(i + 1, a);
            }
            this.fill.geometry = geometry;
            this.fill.visible = share > 0.01;
        }
        const { every, pieces, sell } = DIG.levels.totem;
        const more = this.blocks.length < pieces ? (this.blocks.length + 1) * every : undefined;
        const drawn = `${level}|${more}|${this.blocks.length}`;
        if (drawn === this.drawn) return;
        this.drawn = drawn;
        const g = this.canvas.getContext('2d')!;
        g.clearRect(0, 0, this.canvas.width, this.canvas.height);
        CanvasArt.plaque(g, 8, 8, this.canvas.width - 16, this.canvas.height - 16, 30, 'rgba(111, 227, 255, 0.7)');
        CanvasArt.text(g, `LEVEL ${level}`, this.canvas.width / 2, 56, 62, '#ffffff', this.canvas.width - 50);
        const bonus = `+${Math.round(this.blocks.length * sell * 100)}% CASH`;
        CanvasArt.text(g, more ? `${bonus} · NEXT: LVL ${more}` : bonus, this.canvas.width / 2, 116, 32, '#ffe27a', this.canvas.width - 40);
        this.texture.needsUpdate = true;
    }

    public update(delta: number): void {
        this.time += delta;
        this.refresh();
        this.glow = Math.max(0, this.glow - delta * 0.6);
        for (const block of this.blocks) {
            for (const material of block.material as THREE.MeshStandardMaterial[]) material.emissive.setScalar(this.glow * 0.5);
        }
        this.fill.material.color.set(RING.color).lerp(new THREE.Color(0xffffff), this.glow);
        this.label.position.y = BASE.height + Math.max(1, this.blocks.length) * this.blockHeight + LABEL.over + Math.sin(this.time * 2) * 0.05;
    }

    public destroy(): void {
        gsap.killTweensOf(this.pole.scale);
        for (const block of this.blocks) {
            gsap.killTweensOf(block.position);
            gsap.killTweensOf(block.scale);
        }
        this.group.removeFromParent();
    }
}
