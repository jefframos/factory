// HardBlockMarkers.ts
//
// A padlock floating over every block on a tunnel edge near the miner that the current tool can't dig (its
// material's minPower is above the tool's power), so "this rock needs a better tool" reads before the miner even
// tries it. Rescanned a few times a second around the miner (and at once after a tool upgrade, when the locks go).
// `bump()` makes the lock over a block the miner just pushed into jump, along with the MiningController's message.

import * as THREE from 'three';
import { VoxelTerrain, AIR } from './VoxelTerrain';
import { DigProgress } from '../data/DigProgress';
import { CanvasArt } from '../ui/CanvasArt';

/** Blocks this far (in cells) around the miner get their lock. */
const RANGE = 9;
const POOL = 48;
const RESCAN_SEC = 0.3;
const SIZE = 0.7;
/** How high over the block top the lock floats. */
const LIFT = 0.45;
const BUMP_SEC = 0.5;

function lockTexture(): THREE.CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const g = canvas.getContext('2d')!;
    g.fillStyle = 'rgba(20, 16, 14, 0.75)';
    g.beginPath();
    g.arc(64, 64, 58, 0, Math.PI * 2);
    g.fill();
    g.lineWidth = 6;
    g.strokeStyle = '#ff7a6a';
    g.stroke();
    CanvasArt.drawIcon(g, 'Icon_Lock02', 64, 62, 78);
    return CanvasArt.texture(canvas);
}

export class HardBlockMarkers {
    private readonly sprites: THREE.Sprite[] = [];
    /** Cell index each sprite marks (-1 = unused). */
    private readonly cells: number[] = [];
    private readonly material: THREE.SpriteMaterial;
    private rescan = 0;
    private toolLevel = -1;
    private time = 0;
    private bumped = -1;
    private bumpAge = BUMP_SEC;

    public constructor(threeScene: THREE.Scene, private readonly terrain: VoxelTerrain) {
        this.material = new THREE.SpriteMaterial({ map: lockTexture(), transparent: true, depthWrite: false });
        for (let i = 0; i < POOL; i++) {
            const sprite = new THREE.Sprite(this.material);
            sprite.scale.setScalar(SIZE);
            sprite.visible = false;
            sprite.renderOrder = 5;
            threeScene.add(sprite);
            this.sprites.push(sprite);
            this.cells.push(-1);
        }
    }

    /** The miner pushed into a block too hard for the tool: its lock jumps. */
    public bump(ix: number, iz: number): void {
        this.bumped = this.terrain.index(ix, iz);
        this.bumpAge = 0;
    }

    public update(delta: number, player: THREE.Vector3): void {
        this.time += delta;
        this.bumpAge += delta;
        this.rescan -= delta;
        if (this.rescan <= 0 || this.toolLevel !== DigProgress.toolLevel) {
            this.rescan = RESCAN_SEC;
            this.toolLevel = DigProgress.toolLevel;
            this.scan(player);
        }
        const top = this.terrain.blockHeight + LIFT;
        for (let i = 0; i < this.sprites.length; i++) {
            const cell = this.cells[i];
            if (cell < 0) continue;
            const sprite = this.sprites[i];
            // A gentle bob, out of step from block to block; the bumped one hops and swells.
            let y = top + Math.sin(this.time * 2.4 + cell * 0.7) * 0.06;
            let scale = SIZE;
            if (cell === this.bumped && this.bumpAge < BUMP_SEC) {
                const k = Math.sin((this.bumpAge / BUMP_SEC) * Math.PI);
                y += k * 0.5;
                scale *= 1 + k * 0.5;
            }
            sprite.position.y = y;
            sprite.scale.setScalar(scale);
        }
    }

    private scan(player: THREE.Vector3): void {
        const power = DigProgress.tool.power;
        const terrain = this.terrain;
        const [px, pz] = terrain.cellOf(player.x, player.z);
        const found: number[] = [];
        for (let iz = pz - RANGE; iz <= pz + RANGE; iz++) {
            for (let ix = px - RANGE; ix <= px + RANGE; ix++) {
                const material = terrain.material(ix, iz);
                if (!material || material.minPower <= power) continue;
                // Only blocks the miner can walk up to: on a tunnel edge.
                const exposed = terrain.cellValue(ix + 1, iz) === AIR || terrain.cellValue(ix - 1, iz) === AIR
                    || terrain.cellValue(ix, iz + 1) === AIR || terrain.cellValue(ix, iz - 1) === AIR;
                if (exposed) found.push(terrain.index(ix, iz));
            }
        }
        // More than the pool holds: the nearest ones.
        const distance = (cell: number) => Math.hypot((cell % terrain.size) - px, Math.floor(cell / terrain.size) - pz);
        if (found.length > POOL) found.sort((a, b) => distance(a) - distance(b));
        const center = new THREE.Vector3();
        for (let i = 0; i < this.sprites.length; i++) {
            const cell = found[i] ?? -1;
            this.cells[i] = cell;
            this.sprites[i].visible = cell >= 0;
            if (cell < 0) continue;
            terrain.cellCenter(cell % terrain.size, Math.floor(cell / terrain.size), center);
            this.sprites[i].position.set(center.x, terrain.blockHeight + LIFT, center.z);
        }
    }

    public destroy(): void {
        this.sprites.forEach((sprite) => sprite.removeFromParent());
        this.material.map?.dispose();
        this.material.dispose();
    }
}
