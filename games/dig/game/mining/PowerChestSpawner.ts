// PowerChestSpawner.ts
//
// The Mega Drill moment, brought to the player instead of buried somewhere they might never dig: once they've dug
// chests.power.spawn.afterBlocks blocks, a power chest fades into the rock a few blocks (`ahead`) in front of the
// face they're digging — in rock their own tool can dig, so carrying on straight reaches it. It waits there however
// long it takes; only when the miner goes more than `maxDistance` blocks away does it fade, and after `respawnDelay`
// the next dig brings another (only ever one at a time). Breaking its block marks it taken for good, there and then
// (DigProgress.once('power-chest'), before the chest's pop-out even lands and starts the PowerSurge:
// DigScene.openChest), so no second one can show meanwhile: each player gets it once, never once they own the tool.
//
// The chest is a cell flag in the terrain (VoxelTerrain.placeChest), so mining, sparkles and beacons treat it like
// any chest; its model is drawn here (not in the merged chunk mesh) so it can pop and fade.

import * as THREE from 'three';
import { DIG } from '../data/DigConfig';
import { DigProgress } from '../data/DigProgress';
import { VoxelTerrain, AIR, BEDROCK } from '../world/VoxelTerrain';
import { BendService } from '../services/BendService';
import { PowerSurge } from './PowerSurge';
import { GameAnalytics } from '../analytics/GameAnalytics';
import type { DigEffects } from '../vfx/DigEffects';

/** The chest pokes this share of its height out of the block top (like a find). */
const SHOWING = 0.65;
/** DigProgress.once key: the power chest was dug out. */
export const POWER_CHEST_TAKEN = 'power-chest';

type Phase = 'idle' | 'in' | 'shown' | 'out';

export class PowerChestSpawner {
    private phase: Phase = 'idle';
    /** The cell it's in (while not idle), seconds in the current phase, and until the next may show. */
    private ix = 0;
    private iz = 0;
    private age = 0;
    private cooldown = 0;
    /** Shown this session (analytics: how many it takes). */
    private shownCount = 0;
    private model?: THREE.Object3D;
    private materials: THREE.Material[] = [];
    private readonly at = new THREE.Vector3();

    public constructor(private readonly threeScene: THREE.Scene, private readonly terrain: VoxelTerrain, private readonly effects: DigEffects) {}

    /** Whether one may show now: not taken yet, the tool not owned, enough dug, no surge running. */
    private get eligible(): boolean {
        const toolIndex = DIG.tools.findIndex((t) => t.id === DIG.chests.power.tool);
        return !DigProgress.hasOnce(POWER_CHEST_TAKEN) && DigProgress.toolLevel < toolIndex && !PowerSurge.active
            && DigProgress.achievementStat('blocks') >= DIG.chests.power.spawn.afterBlocks;
    }

    /** A block broke at `dug` while the miner stood at `player`: maybe a chest shows ahead of them. */
    public onDig(dug: THREE.Vector3, player: THREE.Vector3): void {
        if (this.phase !== 'idle' || this.cooldown > 0 || !this.eligible) return;
        const [dx, dz] = this.terrain.cellOf(dug.x, dug.z);
        const [px, pz] = this.terrain.cellOf(player.x, player.z);
        // The push direction, snapped to the grid.
        const alongX = Math.abs(dx - px) >= Math.abs(dz - pz);
        const fx = alongX ? Math.sign(dx - px) || 1 : 0;
        const fz = alongX ? 0 : Math.sign(dz - pz) || 1;
        const [nearest, farthest] = DIG.chests.power.spawn.ahead;
        // Straight ahead first (digging on reaches it); a block to the side only when the line has no room.
        let spots: [number, number][] = [];
        for (const sides of [[0], [-1, 1]]) {
            if (spots.length) break;
            spots = this.spotsAhead(dx, dz, fx, fz, alongX, sides, nearest, farthest);
        }
        const [ix, iz] = spots[Math.floor(Math.random() * spots.length)];
        if (!this.terrain.placeChest(ix, iz, 'power')) return;
        this.ix = ix;
        this.iz = iz;
        this.show();
        this.shownCount++;
        GameAnalytics.powerChestShown(this.shownCount);
    }

    /**
     * Rock `nearest`..`farthest` blocks on from (dx, dz) in direction (fx, fz), shifted by each of `sides` across it,
     * that the owned tool can dig and that holds no find or chest yet.
     */
    private spotsAhead(dx: number, dz: number, fx: number, fz: number, alongX: boolean, sides: number[], nearest: number, farthest: number): [number, number][] {
        const power = DigProgress.tool.power;
        const spots: [number, number][] = [];
        for (let ahead = nearest; ahead <= farthest; ahead++) {
            for (const side of sides) {
                const ix = dx + fx * ahead + (alongX ? 0 : side);
                const iz = dz + fz * ahead + (alongX ? side : 0);
                const value = this.terrain.cellValue(ix, iz);
                const material = this.terrain.material(ix, iz);
                if (value === AIR || value === BEDROCK || !material || material.minPower > power) continue;
                if (this.terrain.findAt(ix, iz) || this.terrain.chestAt(ix, iz)) continue;
                spots.push([ix, iz]);
            }
        }
        return spots;
    }

    private show(): void {
        const model = this.terrain.chestModel('power');
        if (!model) return;
        this.materials = [];
        model.traverse((child) => {
            if (!(child instanceof THREE.Mesh)) return;
            const material = (child.material as THREE.Material).clone();
            material.transparent = true;
            material.opacity = 0;
            BendService.applyBend(material);
            child.material = material;
            this.materials.push(material);
        });
        const size = DIG.chests.power.size;
        this.terrain.cellCenter(this.ix, this.iz, this.at);
        model.position.set(this.at.x, this.terrain.blockHeight - size * (1 - SHOWING), this.at.z);
        model.rotation.set(0.2, Math.random() * Math.PI * 2, -0.15);
        model.scale.setScalar(0.01);
        this.threeScene.add(model);
        this.model = model;
        this.phase = 'in';
        this.age = 0;
        this.effects.smoke(this.at.clone().setY(this.terrain.blockHeight + 0.2), 5, 0.8, new THREE.Color(0x8fe9ff), 0.6);
    }

    public update(delta: number, player: THREE.Vector3): void {
        this.cooldown = Math.max(0, this.cooldown - delta);
        if (this.phase === 'idle') return;
        this.age += delta;
        const spawn = DIG.chests.power.spawn;
        // Dug out: taken from this moment (MiningController pops it out of the rock); this model just goes.
        if (this.phase !== 'out' && this.terrain.chestAt(this.ix, this.iz) !== 'power') {
            if (this.terrain.cellValue(this.ix, this.iz) === AIR) DigProgress.once(POWER_CHEST_TAKEN);
            this.remove();
            return;
        }
        const time = performance.now() / 1000;
        if (this.phase === 'in') {
            const k = Math.min(1, this.age / spawn.fadeIn);
            this.setLook(k, backOut(k));
            if (k >= 1) this.enter('shown');
        } else if (this.phase === 'shown') {
            // A gentle bob and wiggle, so it reads as alive.
            this.setLook(1, 1 + Math.sin(time * 5) * 0.06);
            if (this.model) this.model.rotation.z = -0.15 + Math.sin(time * 3.4) * 0.08;
            this.terrain.cellCenter(this.ix, this.iz, this.at);
            const away = Math.hypot(player.x - this.at.x, player.z - this.at.z);
            if (away > spawn.maxDistance) {
                // Walked off far: out of the rock again, and another comes on a dig later.
                this.terrain.clearChest(this.ix, this.iz);
                this.enter('out');
            }
        } else {
            const k = Math.min(1, this.age / (spawn.fadeIn / 2));
            this.setLook(1 - k, 1 - k * 0.7);
            if (k >= 1) {
                this.remove();
                this.cooldown = spawn.respawnDelay;
            }
        }
    }

    private enter(phase: Phase): void {
        this.phase = phase;
        this.age = 0;
    }

    private setLook(opacity: number, scale: number): void {
        for (const material of this.materials) material.opacity = opacity;
        this.model?.scale.setScalar(Math.max(0.01, scale));
    }

    private remove(): void {
        this.model?.removeFromParent();
        this.materials.forEach((material) => material.dispose());
        this.materials = [];
        this.model = undefined;
        this.phase = 'idle';
    }

    public destroy(): void {
        if (this.phase !== 'idle') this.terrain.clearChest(this.ix, this.iz);
        this.remove();
    }
}

/** Overshoots a little, then settles: a pop. */
function backOut(t: number): number {
    const s = 1.9;
    const u = t - 1;
    return 1 + u * u * ((s + 1) * u + s);
}
