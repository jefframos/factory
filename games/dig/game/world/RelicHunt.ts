// RelicHunt.ts
//
// After the tutorial the player gets one clear thing to do next: find the next relic. The first relic is handed out
// (MiningController.forcedFirstFind) and the tutorial ends on the first hub piece; from there, for relicHunt.guided
// relics, each claim in the Trophy Room names the next one (onNamed: the HUD says it) and the guide's floor arrows and
// a beam lead to it (Guide, TreasureBeacons.focus). The next relic is the lowest zone's first one still buried. Once the
// miner is out of the hub it's placed: where it lies, when that's within relicHunt.maxDistance blocks in rock their
// tool can dig, otherwise moved into a diggable block relicHunt.place blocks from them (VoxelTerrain.moveFind) — so
// the next reward is always a short dig away. Nothing extra is saved: a reload names the same relic again (the mine's
// layout is seeded, so a moved one is back in its own spot and gets placed afresh).

import * as THREE from 'three';
import { DIG, FindDef } from '../data/DigConfig';
import { DigProgress } from '../data/DigProgress';
import { HUB, hubRects } from '../data/HubData';
import { AIR, BEDROCK, VoxelTerrain } from './VoxelTerrain';
import { GameAnalytics } from '../analytics/GameAnalytics';

const RESCAN_SEC = 0.3;

export class RelicHunt {
    /** The relic being hunted (named), and which guided one it is (1 = the first after the tutorial's). */
    private hunted?: FindDef;
    private number = 0;
    /** Its cell once placed (-1 until the miner is out of the hub), and whether that block has been dug. */
    private cell = -1;
    private dug = false;
    private rescan = 0;

    /** `onNamed`: the next relic to hunt was just picked (the HUD names it). */
    public constructor(private readonly terrain: VoxelTerrain, private readonly onNamed: (find: FindDef) => void) {}

    /**
     * The hunt's part of the game: after the tutorial (the first hub piece built), while the mine's collection is
     * within the guided relics — including claiming the last one's reward.
     */
    public get guiding(): boolean {
        const hunt = DIG.relicHunt;
        const count = DigProgress.collectedCount;
        return hunt.enabled && count >= 1 && count <= hunt.guided + 1 && (HUB.buildables ?? []).some((b) => DigProgress.isBuilt(b.id));
    }

    /** The relic named (and not yet dug up), if any. */
    public get relic(): FindDef | undefined {
        return this.dug ? undefined : this.hunted;
    }

    /** The cell the arrows and the beam point at, or -1 (nothing named, not placed yet, or already dug). */
    public get targetCell(): number {
        return this.guiding && this.relic ? this.cell : -1;
    }

    /** Where the arrows lead (the relic's block), or undefined. */
    public target(out = new THREE.Vector3()): THREE.Vector3 | undefined {
        const cell = this.targetCell;
        return cell < 0 ? undefined : this.terrain.cellCenter(cell % this.terrain.size, Math.floor(cell / this.terrain.size), out);
    }

    public update(delta: number, player: THREE.Vector3): void {
        this.rescan -= delta;
        if (this.rescan > 0) return;
        this.rescan = RESCAN_SEC;
        // Dug up: its pop-out lands (onFind) a moment after the block breaks.
        if (this.hunted && DigProgress.found[this.hunted.id]) {
            GameAnalytics.relicHunt(this.number, 'complete');
            this.hunted = undefined;
        }
        if (this.hunted && this.cell >= 0 && this.terrain.cells[this.cell] === AIR) this.dug = true;
        if (!this.guiding) return;
        // Named once the Trophy Room has nothing waiting: claiming a relic reveals the next one.
        if (!this.hunted && !DigProgress.hasUnclaimed && DigProgress.collectedCount <= DIG.relicHunt.guided) this.name();
        if (this.hunted && !this.dug && this.terrain.findCell(this.hunted) !== this.cell && !this.inHub(player)) this.place(player);
    }

    /** Picks the next relic: the lowest zone's first one still buried. */
    private name(): void {
        const next = DIG.finds
            .filter((find) => !DigProgress.found[find.id] && this.terrain.findCell(find) >= 0)
            .sort((a, b) => a.zone - b.zone)[0];
        if (!next) return;
        this.hunted = next;
        this.number = DigProgress.collectedCount;
        this.cell = -1;
        this.dug = false;
        GameAnalytics.relicHunt(this.number, 'visible');
        this.onNamed(next);
    }

    /** Leaves the relic where it is when it's close and diggable, or moves it a short dig away from the miner. */
    private place(player: THREE.Vector3): void {
        const relic = this.hunted!;
        const size = this.terrain.size;
        const [px, pz] = this.terrain.cellOf(player.x, player.z);
        const buried = this.terrain.findCell(relic);
        if (buried < 0) {
            this.hunted = undefined;
            return;
        }
        const bx = buried % size;
        const bz = Math.floor(buried / size);
        if (Math.hypot(bx - px, bz - pz) <= DIG.relicHunt.maxDistance && this.diggable(bx, bz)) {
            this.cell = buried;
            return;
        }
        // A ring of blocks around the miner, preferring the relic's own zone (its payout grows with depth).
        const [nearest, farthest] = DIG.relicHunt.place;
        const own: number[] = [];
        const other: number[] = [];
        const at = new THREE.Vector3();
        for (let iz = pz - farthest; iz <= pz + farthest; iz++) {
            for (let ix = px - farthest; ix <= px + farthest; ix++) {
                const distance = Math.hypot(ix - px, iz - pz);
                if (distance < nearest || distance > farthest || !this.hidden(ix, iz)) continue;
                this.terrain.cellCenter(ix, iz, at);
                (this.terrain.zoneIndexAt(at.x, at.z) === relic.zone ? own : other).push(this.terrain.index(ix, iz));
            }
        }
        const spots = own.length ? own : other;
        if (!spots.length) {
            this.cell = buried;
            return;
        }
        const spot = spots[Math.floor(Math.random() * spots.length)];
        this.terrain.moveFind(relic, spot % size, Math.floor(spot / size));
        this.cell = spot;
    }

    /** Rock the owned tool can dig. */
    private diggable(ix: number, iz: number): boolean {
        const value = this.terrain.cellValue(ix, iz);
        const material = this.terrain.material(ix, iz);
        return value !== AIR && value !== BEDROCK && !!material && material.minPower <= DigProgress.tool.power;
    }

    /** A diggable block holding nothing yet, with rock all round (so the relic starts hidden, like a buried one). */
    private hidden(ix: number, iz: number): boolean {
        if (!this.diggable(ix, iz) || this.terrain.findAt(ix, iz) || this.terrain.chestAt(ix, iz)) return false;
        return [[1, 0], [-1, 0], [0, 1], [0, -1]].every(([dx, dz]) => this.terrain.cellValue(ix + dx, iz + dz) !== AIR);
    }

    private inHub(player: THREE.Vector3): boolean {
        return hubRects().some((r) => Math.abs(player.x - r.x) <= r.width / 2 && Math.abs(player.z - r.z) <= r.depth / 2);
    }
}
