// TreasureSparkles.ts
//
// Treasure nearby: little stars drift up off the top of every block hiding a find (VoxelTerrain.finds) within
// RANGE blocks of the miner, in the find's rarity colour — a few far out, thicker the closer the miner gets — so a
// buried artifact can be spotted and dug towards before its block is ever opened. Checked a few times a second.

import * as THREE from 'three';
import { VoxelTerrain } from './VoxelTerrain';
import type { DigEffects } from '../vfx/DigEffects';
import { DIG } from '../data/DigConfig';
import { RARITY_COLORS } from '../ui/CollectionPanel';

/** Blocks (cells) around the miner that are searched for treasure. */
const RANGE = 7;
/** A sparkle round this often (seconds). */
const TICK_SEC = 0.12;
/** Sparkles a find gives per tick: from FAR far out up to NEAR right next to it (a fraction = a chance). */
const FAR = 0.15;
const NEAR = 1.6;

export class TreasureSparkles {
    private timer = 0;
    private readonly at = new THREE.Vector3();
    private readonly colors = new Map<number, THREE.Color>();

    public constructor(private readonly terrain: VoxelTerrain, private readonly effects: DigEffects) {}

    public update(delta: number, player: THREE.Vector3): void {
        this.timer -= delta;
        if (this.timer > 0) return;
        this.timer = TICK_SEC;
        const terrain = this.terrain;
        const [px, pz] = terrain.cellOf(player.x, player.z);
        for (let iz = pz - RANGE; iz <= pz + RANGE; iz++) {
            for (let ix = px - RANGE; ix <= px + RANGE; ix++) {
                const find = terrain.findAt(ix, iz);
                if (!find) continue;
                const distance = Math.hypot(ix - px, iz - pz);
                if (distance > RANGE) continue;
                const closeness = 1 - distance / RANGE;
                let count = FAR + (NEAR - FAR) * closeness * closeness;
                for (; count > 0; count--) {
                    if (count < 1 && Math.random() > count) break;
                    terrain.cellCenter(ix, iz, this.at);
                    this.at.x += (Math.random() - 0.5) * 0.8;
                    this.at.z += (Math.random() - 0.5) * 0.8;
                    this.at.y = terrain.blockHeight + 0.05 + Math.random() * 0.2;
                    this.effects.sparkle(this.at, this.color(find.rarity === 'common' ? -1 : DIG.finds.indexOf(find)), 0.3 + closeness * 0.2);
                }
            }
        }
    }

    /** The sparkle colour: gold for a common find, its rarity's colour for the rest. */
    private color(index: number): THREE.Color {
        let color = this.colors.get(index);
        if (!color) {
            color = new THREE.Color(index < 0 ? 0xffd86b : RARITY_COLORS[DIG.finds[index].rarity]);
            this.colors.set(index, color);
        }
        return color;
    }
}
