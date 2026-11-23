// AreaUnlocks.ts
//
// The squares that open the next areas of the map (DistrictDef.unlock): once the part before an area is restored, its
// square shows up where the editor placed it — the area's name, the money still to pay (it pours in a bit at a time
// from what the player carries, then the den's cash piles, and stays paid between visits: never all-or-nothing) and,
// until the player gets there, the level it takes. Paid in full, the area opens (the scene's onBought). No menus.

import * as THREE from 'three';
import gsap from 'gsap';
import { BendService } from '../services/BendService';
import { MOW, sectionUnlockable, shortMoney } from '../data/MowConfig';
import { MowProgress } from '../data/MowProgress';
import { GameAnalytics } from '../analytics/GameAnalytics';
import { CanvasArt } from '../ui/CanvasArt';

/** The square (world units across), how high it floats over the ground. */
const SIZE = 3.2;
const FLOOR_Y = 0.1;
const CANVAS = 448;
/** The money pours in: the whole price in about `seconds`, at least `least` a second. */
const POUR = { seconds: 2.5, least: 25, tossSec: 0.08 };

interface Square {
    d: number;
    mesh: THREE.Mesh;
    canvas: HTMLCanvasElement;
    texture: THREE.CanvasTexture;
    drawn: string;
    shown: boolean;
}

export interface AreaUnlockHooks {
    restored: (id: string) => boolean;
    /** Paid in full: the area opens. */
    onBought: (d: number) => void;
    say: (text: string, color: number) => void;
    /** A note flies from the player to `to`. */
    pour: (to: THREE.Vector3) => void;
}

export class AreaUnlocks {
    private readonly group = new THREE.Group();
    private readonly squares: Square[] = [];
    private carry = 0;
    private told = -1;
    private tossTimer = 0;

    public constructor(threeScene: THREE.Scene, private readonly hooks: AreaUnlockHooks) {
        MOW.districts.forEach((district, d) => {
            if (!district.unlock) return;
            const canvas = document.createElement('canvas');
            canvas.width = canvas.height = CANVAS;
            const texture = CanvasArt.texture(canvas);
            const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
            material.polygonOffset = true;
            material.polygonOffsetFactor = -3;
            material.polygonOffsetUnits = -3;
            BendService.applyBend(material);
            const geometry = new THREE.PlaneGeometry(SIZE, SIZE, 6, 6);
            geometry.rotateX(-Math.PI / 2);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(district.unlock.x, FLOOR_Y, district.unlock.z);
            mesh.renderOrder = 2;
            mesh.visible = false;
            this.group.add(mesh);
            this.squares.push({ d, mesh, canvas, texture, drawn: '', shown: false });
        });
        threeScene.add(this.group);
    }

    private key(d: number): string {
        return `area:${MOW.districts[d].id}`;
    }

    private draw(square: Square): void {
        const district = MOW.districts[square.d];
        const unlock = district.unlock!;
        const left = Math.max(0, Math.ceil(unlock.price - MowProgress.paid(this.key(square.d))));
        const short = MowProgress.level < unlock.level;
        const drawn = `${left}|${short}`;
        if (drawn === square.drawn) return;
        square.drawn = drawn;
        const g = square.canvas.getContext('2d')!;
        const s = CANVAS;
        const inset = 18;
        g.clearRect(0, 0, s, s);
        const outline = () => {
            g.beginPath();
            g.roundRect(inset, inset, s - inset * 2, s - inset * 2, 70);
        };
        outline();
        g.fillStyle = 'rgba(25, 35, 30, 0.42)';
        g.fill();
        // The paid share filling it gold from the bottom.
        const share = 1 - left / Math.max(1, unlock.price);
        if (share > 0) {
            g.save();
            outline();
            g.clip();
            const height = (s - inset * 2) * share;
            g.fillStyle = 'rgba(255, 210, 80, 0.55)';
            g.fillRect(0, s - inset - height, s, height + inset);
            g.restore();
        }
        outline();
        g.lineWidth = 28;
        g.strokeStyle = 'rgba(20, 30, 20, 0.45)';
        g.stroke();
        outline();
        g.lineWidth = 16;
        g.strokeStyle = '#ffe27a';
        g.stroke();
        CanvasArt.text(g, 'UNLOCK', s / 2, 86, 50, '#ffffff', s - 100);
        CanvasArt.text(g, district.name.toUpperCase(), s / 2, 150, 44, '#ffe27a', s - 90);
        CanvasArt.drawIcon(g, 'ItemIcon_Money_Bill', s / 2 - 110, 262, 84);
        CanvasArt.text(g, shortMoney(left), s / 2 + 40, 266, 78, '#ffffff', s - 200);
        if (short) CanvasArt.text(g, `LEVEL ${unlock.level}`, s / 2, 360, 52, '#ff8a7a', s - 100);
        square.texture.needsUpdate = true;
    }

    /** Each frame: squares come out as their areas become buyable; the one stood on takes the money. */
    public update(delta: number, player: THREE.Vector3): void {
        const bought = (id: string) => MowProgress.areaBought(id);
        let on: Square | undefined;
        for (const square of this.squares) {
            const shown = sectionUnlockable(square.d, this.hooks.restored, bought);
            if (shown !== square.shown) {
                square.shown = shown;
                square.mesh.visible = shown;
                if (shown) {
                    square.mesh.scale.setScalar(0.01);
                    gsap.to(square.mesh.scale, { x: 1, y: 1, z: 1, duration: 0.6, ease: 'back.out(2)' });
                }
            }
            if (!shown) continue;
            this.draw(square);
            const at = square.mesh.position;
            if (Math.abs(player.x - at.x) <= SIZE / 2 && Math.abs(player.z - at.z) <= SIZE / 2) on = square;
        }
        if (!on) {
            this.carry = 0;
            this.told = -1;
            return;
        }
        const unlock = MOW.districts[on.d].unlock!;
        const key = this.key(on.d);
        if (MowProgress.level < unlock.level) {
            if (this.told !== on.d) {
                this.told = on.d;
                this.hooks.say(`REACH LEVEL ${unlock.level} TO UNLOCK ${MOW.districts[on.d].name.toUpperCase()}`, 0xffd9a8);
            }
            return;
        }
        const left = unlock.price - MowProgress.paid(key);
        if (left > 0 && MowProgress.payable <= 0) {
            if (this.told !== on.d) {
                this.told = on.d;
                this.hooks.say(`${shortMoney(Math.ceil(left))} TO GO: COME BACK WITH MORE`, 0xffd9a8);
            }
            return;
        }
        this.carry += Math.max(POUR.least, unlock.price / POUR.seconds) * delta;
        const want = Math.min(Math.max(0, left), Math.floor(this.carry));
        if (want > 0) {
            this.carry -= want;
            const taken = MowProgress.takePayment(want);
            if (taken > 0) {
                MowProgress.addPaid(key, taken);
                this.tossTimer -= delta;
                if (this.tossTimer <= 0) {
                    this.tossTimer = POUR.tossSec;
                    this.hooks.pour(on.mesh.position.clone().setY(0.4));
                }
            }
        }
        if (MowProgress.paid(key) < unlock.price) return;
        MowProgress.clearPaid(key);
        MowProgress.buyArea(MOW.districts[on.d].id);
        GameAnalytics.areaBought(MOW.districts[on.d].id);
        this.carry = 0;
        gsap.to(on.mesh.scale, { x: 0.01, y: 0.01, z: 0.01, duration: 0.35, ease: 'back.in(2)' });
        this.hooks.onBought(on.d);
    }

    public destroy(): void {
        for (const square of this.squares) gsap.killTweensOf(square.mesh.scale);
        this.group.removeFromParent();
    }
}
