// GrassLocks.ts
//
// Dig's padlocks (HardBlockMarkers) for the lawn: a badge floating over grass near the player that the mower can't
// cut at all (GrassField.blockedSpots: on the wall's edge, one per few cells), showing the mower it takes (its icon,
// rendered from its model: ModelIcons.toolCanvas) with a padlock in the corner, so "this needs a better mower" reads
// before the player even pushes into it. Rescanned a few times a second around the player (and at once after an
// upgrade, when the locks go). `bump()` makes the lock nearest a point hop, when the player pushes into the wall.

import * as THREE from 'three';
import { GrassField } from './GrassField';
import { ToolDef, firstToolFor } from '../data/MowConfig';
import { ModelIcons } from '../ui/ModelIcons';
import { CanvasArt } from '../ui/CanvasArt';
import { BendService } from '../services/BendService';

/** Spots this far (world units) around the player get their lock. */
const RANGE = 7;
const POOL = 24;
const RESCAN_SEC = 0.3;
const SIZE = 0.95;
/** How high over the grass's top the badge floats. */
const LIFT = 0.55;
const BUMP_SEC = 0.5;
/** A bump only reaches a lock this close to the point. */
const BUMP_REACH = 2.5;
const BADGE = 160;

/** The badge: a dark disc with a red rim, the mower (once rendered) and a padlock in the corner (alone, big, until then). */
function drawBadge(canvas: HTMLCanvasElement, tool?: HTMLCanvasElement): void {
    const g = canvas.getContext('2d')!;
    const c = BADGE / 2;
    g.clearRect(0, 0, BADGE, BADGE);
    g.fillStyle = 'rgba(20, 16, 14, 0.78)';
    g.beginPath();
    g.arc(c, c, c - 6, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 7;
    g.strokeStyle = '#ff7a6a';
    g.stroke();
    if (!tool) {
        CanvasArt.drawIcon(g, 'Icon_Lock03', c, c - 2, BADGE * 0.6);
        return;
    }
    const size = BADGE * 0.86;
    g.drawImage(tool, c - size / 2, c - size / 2, size, size);
    // The padlock in its own little disc, bottom-right.
    const lx = BADGE * 0.78;
    const ly = BADGE * 0.78;
    const r = BADGE * 0.2;
    g.fillStyle = '#2a1f1b';
    g.beginPath();
    g.arc(lx, ly, r, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 5;
    g.strokeStyle = '#ff7a6a';
    g.stroke();
    CanvasArt.drawIcon(g, 'Icon_Lock03', lx, ly - 1, r * 1.45);
}

export class GrassLocks {
    private readonly sprites: THREE.Sprite[] = [];
    /** Each sprite's spot (unused: null), unbent. */
    private readonly spots: ({ x: number; z: number; y: number } | null)[] = [];
    /** One material per mower it takes (by tool id). */
    private readonly materials = new Map<string, THREE.SpriteMaterial>();
    private rescan = 0;
    private power = -1;
    private time = 0;
    private bumped = -1;
    private bumpAge = BUMP_SEC;
    private readonly point = new THREE.Vector3();

    public constructor(threeScene: THREE.Scene, private readonly grass: GrassField, private readonly canCut: (district: number) => boolean) {
        for (let i = 0; i < POOL; i++) {
            const sprite = new THREE.Sprite();
            sprite.scale.setScalar(SIZE);
            sprite.visible = false;
            sprite.renderOrder = 5;
            threeScene.add(sprite);
            this.sprites.push(sprite);
            this.spots.push(null);
        }
    }

    /** The player pushed into a wall of grass around `at`: the lock nearest it hops (if one's close). */
    public bump(at: THREE.Vector3): void {
        if (this.bumpAge < BUMP_SEC) return;
        let best = -1;
        let bestDistance = BUMP_REACH;
        this.spots.forEach((spot, i) => {
            if (!spot) return;
            const distance = Math.hypot(spot.x - at.x, spot.z - at.z);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = i;
            }
        });
        if (best < 0) return;
        this.bumped = best;
        this.bumpAge = 0;
    }

    /** `power`: the mower's cutting power now. */
    public update(delta: number, player: THREE.Vector3, power: number): void {
        this.time += delta;
        this.bumpAge += delta;
        this.rescan -= delta;
        if (this.rescan <= 0 || this.power !== power) {
            this.rescan = RESCAN_SEC;
            this.power = power;
            this.scan(player);
        }
        for (let i = 0; i < this.sprites.length; i++) {
            const spot = this.spots[i];
            if (!spot) continue;
            const sprite = this.sprites[i];
            // A gentle bob, out of step from lock to lock; the bumped one hops and swells.
            let y = spot.y + Math.sin(this.time * 2.4 + i * 1.7) * 0.06;
            let scale = SIZE;
            if (i === this.bumped && this.bumpAge < BUMP_SEC) {
                const k = Math.sin((this.bumpAge / BUMP_SEC) * Math.PI);
                y += k * 0.5;
                scale *= 1 + k * 0.5;
            }
            sprite.position.copy(BendService.applyToPosition(this.point.set(spot.x, y, spot.z)));
            sprite.scale.setScalar(scale);
        }
    }

    private scan(player: THREE.Vector3): void {
        const found = this.grass.blockedSpots(player.x, player.z, RANGE, this.power, this.canCut);
        // More than the pool holds: the nearest ones.
        if (found.length > POOL) found.sort((a, b) => Math.hypot(a.x - player.x, a.z - player.z) - Math.hypot(b.x - player.x, b.z - player.z));
        for (let i = 0; i < this.sprites.length; i++) {
            const spot = found[i];
            const sprite = this.sprites[i];
            const tool = spot ? firstToolFor(spot.grass) : undefined;
            if (!spot || !tool) {
                this.spots[i] = null;
                sprite.visible = false;
                continue;
            }
            this.spots[i] = { x: spot.x, z: spot.z, y: spot.top + LIFT };
            sprite.material = this.materialFor(tool);
            sprite.visible = true;
        }
    }

    /** The badge for a mower: the plain padlock at first, the mower drawn in once its icon is rendered. */
    private materialFor(tool: ToolDef): THREE.SpriteMaterial {
        let material = this.materials.get(tool.id);
        if (material) return material;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = BADGE;
        drawBadge(canvas);
        const texture = CanvasArt.texture(canvas);
        material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
        this.materials.set(tool.id, material);
        void ModelIcons.toolCanvas(tool).then((icon) => {
            if (!icon) return;
            drawBadge(canvas, icon);
            texture.needsUpdate = true;
        });
        return material;
    }

    public destroy(): void {
        this.sprites.forEach((sprite) => sprite.removeFromParent());
        this.materials.forEach((material) => {
            material.map?.dispose();
            material.dispose();
        });
        this.materials.clear();
    }
}
