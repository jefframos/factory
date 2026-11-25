// Portal.ts
//
// The way to the next dungeon, at the back of the hub: it comes at a player level (its pad's: levels/hub.json), a stone ring on
// its steps, dark until it's been paid for (UpgradePads), then a swirl of light in it. Walking into it goes there. The dungeon's
// number is on a badge over it. Seen through while the miner's behind it.

import * as THREE from 'three';
import gsap from 'gsap';
import { BendService, STRUCTURE_OCCLUSION_FADE } from '../services/BendService';
import { DigProgress } from '../data/DigProgress';
import { HUB } from '../data/HubData';
import { CanvasArt } from '../ui/CanvasArt';
import { t } from '../i18n/Localization';
import type { Box } from './GuidePath';

const RING = { radius: 1.75, tube: 0.3, lift: 1.95 };
const STEP = { width: 4.2, depth: 1.8, height: 0.12 };
/** The badge fades while the miner's behind the ring: this far to its sides, this far back. */
const BEHIND = { aside: 2.4, back: 4.5, opacity: 0.25 };
/** Walking this near its middle goes through. */
const REACH = 1.25;
const SPIN = 1.1;
const SPARK_SEC = 0.12;
const LABEL = { width: 3, height: 0.94 };
const COLOR = { shut: 0x2a2436, stone: 0x6b6478 };

/** A swirl: arms of light winding in. */
function swirlTexture(): THREE.CanvasTexture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const g = canvas.getContext('2d')!;
    const glow = g.createRadialGradient(128, 128, 4, 128, 128, 126);
    glow.addColorStop(0, '#ffffff');
    glow.addColorStop(0.25, '#d9a8ff');
    glow.addColorStop(0.65, '#7a3df0');
    glow.addColorStop(1, '#2a0f6b');
    g.fillStyle = glow;
    g.beginPath();
    g.arc(128, 128, 126, 0, Math.PI * 2);
    g.fill();
    g.lineCap = 'round';
    for (let arm = 0; arm < 5; arm++) {
        for (let k = 0; k < 60; k++) {
            const f = k / 60;
            const angle = (arm / 5) * Math.PI * 2 + f * 3.4;
            const r = 8 + f * 112;
            g.fillStyle = `rgba(255, 240, 255, ${0.5 * (1 - f)})`;
            g.beginPath();
            g.arc(128 + Math.cos(angle) * r, 128 + Math.sin(angle) * r, 4 + f * 9, 0, Math.PI * 2);
            g.fill();
        }
    }
    return CanvasArt.texture(canvas);
}

export class Portal {
    private readonly group = new THREE.Group();
    private readonly disc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
    private readonly ring: THREE.MeshStandardMaterial;
    private readonly swirl = swirlTexture();
    private readonly label: THREE.Sprite;
    private readonly canvas = document.createElement('canvas');
    private readonly texture: THREE.CanvasTexture;
    private open = false;
    private there = false;
    private drawn = '';
    private time = 0;
    private sparkIn = 0;
    private entered = false;

    /** `onEnter`: the miner's walked in. `onAppear`: it's there now. `spark`: a sparkle there. */
    public constructor(threeScene: THREE.Scene, private readonly onEnter: () => void, private readonly onAppear: () => void, private readonly spark: (at: THREE.Vector3) => void) {
        const at = HUB.portal ?? { x: 0, z: 0 };
        const body = new THREE.Group();
        this.group.add(body);
        this.group.position.set(at.x, 0, at.z);
        const stone = this.material(new THREE.MeshStandardMaterial({ color: COLOR.stone, roughness: 0.95, flatShading: true }));
        this.ring = this.material(new THREE.MeshStandardMaterial({ color: COLOR.stone, roughness: 0.8, flatShading: true }));
        for (let i = 0; i < 2; i++) {
            const step = new THREE.Mesh(new THREE.BoxGeometry(STEP.width - i * 0.8, STEP.height, STEP.depth - i * 0.5), stone);
            step.position.y = STEP.height * (i + 0.5);
            body.add(step);
        }
        const ring = new THREE.Mesh(new THREE.TorusGeometry(RING.radius, RING.tube, 7, 18), this.ring);
        ring.position.y = RING.lift;
        this.disc = new THREE.Mesh(new THREE.CircleGeometry(RING.radius - RING.tube * 0.5, 40), this.material(new THREE.MeshBasicMaterial({ color: COLOR.shut })));
        this.disc.position.y = RING.lift;
        // (Leaning back: seen from above.)
        const arch = new THREE.Group();
        arch.add(ring, this.disc);
        arch.rotation.x = -0.35;
        arch.position.z = -0.1;
        body.add(arch);
        this.canvas.width = 384;
        this.canvas.height = 120;
        this.texture = CanvasArt.texture(this.canvas);
        this.label = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, depthWrite: false, transparent: true }));
        this.label.scale.set(LABEL.width, LABEL.height, 1);
        this.label.renderOrder = 4;
        this.group.add(this.label);
        threeScene.add(this.group);
        BendService.applyOcclusionFadeToObject(body, STRUCTURE_OCCLUSION_FADE);
        this.there = DigProgress.padThere('portal');
        this.group.visible = this.there;
        this.open = DigProgress.padCost('portal') === undefined;
        this.look();
        window.setTimeout(() => (this.drawn = ''), 1200);
    }

    private material<T extends THREE.Material>(material: T): T {
        BendService.applyBend(material);
        return material;
    }

    /** The ring's pillars: solid (its middle isn't). */
    public static boxes(): Box[] {
        const at = HUB.portal;
        return at ? [-1, 1].map((side) => ({ x: at.x + side * RING.radius, z: at.z, halfX: 0.35, halfZ: 0.5 })) : [];
    }

    private look(): void {
        this.disc.material.map = this.open ? this.swirl : null;
        this.disc.material.color.set(this.open ? 0xffffff : COLOR.shut);
        this.disc.material.needsUpdate = true;
        this.ring.emissive.set(this.open ? 0x5a1fc4 : 0x000000);
    }

    /** `alive`: it can be walked into now. */
    public update(delta: number, player: THREE.Vector3, alive: boolean): void {
        this.time += delta;
        if (!this.there) {
            if (!DigProgress.padThere('portal')) return;
            this.there = true;
            this.group.visible = true;
            gsap.from(this.group.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.9, ease: 'back.out(1.8)' });
            this.onAppear();
        }
        const open = DigProgress.padCost('portal') === undefined;
        if (open !== this.open) {
            this.open = open;
            this.look();
        }
        const text = t('portalTo', { n: DigProgress.currentMine + 2 });
        if (`${text}${open}` !== this.drawn) {
            this.drawn = `${text}${open}`;
            const g = this.canvas.getContext('2d')!;
            g.clearRect(0, 0, this.canvas.width, this.canvas.height);
            CanvasArt.plaque(g, 8, 8, this.canvas.width - 16, this.canvas.height - 16, 28, open ? 'rgba(190, 120, 255, 0.9)' : 'rgba(120, 120, 140, 0.7)');
            CanvasArt.text(g, text, this.canvas.width / 2, this.canvas.height / 2 + 2, 54, open ? '#ffffff' : '#b9b3c9', this.canvas.width - 50);
            this.texture.needsUpdate = true;
        }
        this.label.position.set(0, RING.lift + RING.radius + 0.75 + Math.sin(this.time * 2) * 0.06, -0.6);
        const behind = Math.abs(player.x - this.group.position.x) < BEHIND.aside && player.z < this.group.position.z - 0.3 && player.z > this.group.position.z - BEHIND.back;
        this.label.material.opacity += ((behind ? BEHIND.opacity : 1) - this.label.material.opacity) * Math.min(1, delta * 8);
        if (!open) return;
        this.disc.rotation.z -= delta * SPIN;
        this.ring.emissiveIntensity = 0.7 + Math.sin(this.time * 3) * 0.25;
        const at = this.group.position;
        const away = Math.hypot(player.x - at.x, player.z - at.z);
        this.sparkIn -= delta;
        if (this.sparkIn <= 0 && away < 16) {
            this.sparkIn = SPARK_SEC;
            const angle = Math.random() * Math.PI * 2;
            this.spark(new THREE.Vector3(at.x + Math.cos(angle) * RING.radius, RING.lift + Math.sin(angle) * RING.radius, at.z + 0.3));
        }
        if (away > REACH) this.entered = false;
        else if (alive && !this.entered) {
            this.entered = true;
            this.onEnter();
        }
    }

    public destroy(): void {
        gsap.killTweensOf(this.group.scale);
        this.swirl.dispose();
        this.texture.dispose();
        this.group.removeFromParent();
    }
}
