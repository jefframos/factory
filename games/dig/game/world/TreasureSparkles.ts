// TreasureSparkles.ts
//
// Treasure nearby: little stars drift up off the top of every block hiding a find (VoxelTerrain.finds) or a chest
// (VoxelTerrain.chests) within RANGE blocks of the miner, in the find's rarity colour (a chest's own: gold for cash,
// green for power) — a few far out, thicker the closer the miner gets — so buried treasure can be spotted and dug
// towards before its block is ever opened (TreasureBeacons mark it from further away). Ore twinkles now and then
// (rich veins more often), so valuable blocks catch the eye against plain rock. Checked a few times a second.

import * as THREE from 'three';
import { TRACTOR_SPOT_COLOR } from '../mining/PowerChestSpawner';
import { VoxelTerrain } from './VoxelTerrain';
import type { DigEffects } from '../vfx/DigEffects';
import type { ChestKind } from '../data/DigConfig';
import { RARITY_COLORS } from '../ui/CollectionPanel';

/** Blocks (cells) around the miner that are searched for treasure. */
const RANGE = 9;
/** A sparkle round this often (seconds). */
const TICK_SEC = 0.12;
/** Sparkles a find gives per tick: from FAR far out up to NEAR right next to it (a fraction = a chance). */
const FAR = 0.2;
const NEAR = 1.8;
/** Chests sparkle this much more than finds. */
const CHEST_BOOST = 1.5;
/** Chance per tick that an ore block in range twinkles: a rich vein, or plain ore. */
const RICH_CHANCE = 0.06;
const ORE_CHANCE = 0.03;
const CHEST_COLORS: Record<ChestKind, number> = { power: TRACTOR_SPOT_COLOR, cash: 0xffd23f };

export class TreasureSparkles {
    private timer = 0;
    private readonly at = new THREE.Vector3();
    private readonly colors = new Map<number | string, THREE.Color>();

    public constructor(private readonly terrain: VoxelTerrain, private readonly effects: DigEffects) {}

    public update(delta: number, player: THREE.Vector3): void {
        this.timer -= delta;
        if (this.timer > 0) return;
        this.timer = TICK_SEC;
        const terrain = this.terrain;
        const [px, pz] = terrain.cellOf(player.x, player.z);
        for (let iz = pz - RANGE; iz <= pz + RANGE; iz++) {
            for (let ix = px - RANGE; ix <= px + RANGE; ix++) {
                const distance = Math.hypot(ix - px, iz - pz);
                if (distance > RANGE) continue;
                const chest = terrain.chestAt(ix, iz);
                const find = chest ? undefined : terrain.findAt(ix, iz);
                if (!chest && !find) {
                    if (terrain.cellValue(ix, iz) === 0) continue;
                    const rich = terrain.isRich(ix, iz);
                    if (Math.random() >= (rich ? RICH_CHANCE : ORE_CHANCE)) continue;
                    const material = terrain.material(ix, iz);
                    if (material && (rich || material.ore)) this.burst(ix, iz, this.oreColor(material.color), rich ? 0.3 : 0.24, 0.6);
                    continue;
                }
                const closeness = 1 - distance / RANGE;
                let count = (FAR + (NEAR - FAR) * closeness * closeness) * (chest ? CHEST_BOOST : 1);
                const color = chest
                    ? this.color(CHEST_COLORS[chest])
                    : this.color(find!.rarity === 'common' ? 0xffd86b : RARITY_COLORS[find!.rarity]);
                for (; count > 0; count--) {
                    if (count < 1 && Math.random() > count) break;
                    this.burst(ix, iz, color, 0.3 + closeness * 0.2, 0.8);
                }
            }
        }
    }

    /** One star off the top of cell (ix, iz), up to `spread` off its centre. */
    private burst(ix: number, iz: number, color: THREE.Color, size: number, spread: number): void {
        this.terrain.cellCenter(ix, iz, this.at);
        this.at.x += (Math.random() - 0.5) * spread;
        this.at.z += (Math.random() - 0.5) * spread;
        this.at.y = this.terrain.blockHeight + 0.05 + Math.random() * 0.2;
        this.effects.sparkle(this.at, color, size);
    }

    private color(value: number | string): THREE.Color {
        let color = this.colors.get(value);
        if (!color) {
            color = new THREE.Color(value);
            this.colors.set(value, color);
        }
        return color;
    }

    /** An ore's colour pushed toward white, so its twinkle reads as a glint rather than another patch of colour. */
    private oreColor(value: string): THREE.Color {
        const key = `ore:${value}`;
        let color = this.colors.get(key);
        if (!color) {
            color = new THREE.Color(value).lerp(new THREE.Color(0xffffff), 0.45);
            this.colors.set(key, color);
        }
        return color;
    }
}
