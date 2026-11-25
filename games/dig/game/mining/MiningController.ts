// MiningController.ts
//
// Automatic mining: on foot, while the miner pushes into a block, they swing the pickaxe at it and every hit takes `power`
// off the block's durability. On the tractor, everything its body and its blades touch is chewed at once (carve(): TractorRide
// says where), each block on its own, the faster the sharper the blades are for it (ui/dig.json digging); what's a power too
// hard is chewed slowly, what's harder than that is locked. Nothing it can dig ever holds it.
// Blocks too hard for the current tool say so instead of breaking (and the scene points at them: onTooHard);
// bedrock never breaks. Broken blocks
// drop resources that fly into the backpack; a block hiding a find pops it out too (it pays cash
// straight away and doesn't take backpack space), and so does a chest (onChest). Rich-vein ore drops
// richOre.dropMultiplier x as much. During a power surge (PowerSurge) the miner digs with the surge's
// tool and every drop is cashed as it lands instead of filling the backpack.

import * as THREE from 'three';
import { ChestKind, DIG, FindDef, MaterialDef } from '../data/DigConfig';
import { PowerSurge } from './PowerSurge';
import { DigProgress } from '../data/DigProgress';
import { VoxelTerrain, BEDROCK, AIR } from '../world/VoxelTerrain';
import { DigEffects } from '../vfx/DigEffects';
import type DigPlayer from '../player/DigPlayer';
import type { TractorRide } from '../player/TractorRide';
import { t, names } from '../i18n/Localization';
import { DigAudio, type Cue } from '../audio/DigAudio';

/**
 * How far past the miner's footprint (VoxelTerrain.footprint: 0.32 walking, wider in the tractor) the block being dug
 * is looked for: 0.75 from the centre on foot. Scaled with the footprint, a wide vehicle stopped against the rock still
 * reaches into it, whatever the angle it's pushed at.
 */
const REACH_PAST_BODY = 0.43;
/** Half the miner's width: every block across it in front gets dug, so standing on a seam between two columns never leaves one blocking. */
const BODY_HALF_WIDTH = 0.3;
/** Below this the stick / keys count as not pushing. */
const PUSH_THRESHOLD = 0.3;
/** How long the tool stays out after the last hit. */
const TOOL_LINGER_SEC = 0.6;
const MESSAGE_COOLDOWN_SEC = 2.5;
/** A block counts as touched when its middle's this near what the tractor digs. */
const CELL_REACH = 0.36;
/** A block the tractor breaks throws this many chips; grinding on one sounds this often; chewed blocks remembered. */
const CARVE_CHIPS = 7;
const GRIND_SEC = 0.22;
const CHEWED_MOST = 400;
/** Rocks (ores) already flying to the miner: more than this and the next ones go straight in. */
const FLYING = { rock: 16, ore: 40 };
/** Gem ores: they ring when hit and chime when collected. */
const GEMS = new Set(['crystal', 'amethyst', 'ruby', 'diamond']);
/** Materials that crunch (hitDirt) rather than tick like rock. */
const SOFT_GROUND = new Set(['dirt', 'gravel']);

export class MiningController {
    /** The forced first find was handed out this session (see forcedFirstFind()). */
    private firstFindGiven = false;
    /** Pushing into rock with a full backpack this tick (a new push is counted once: onFullPush). */
    private pushingFull = false;
    private readonly damage = new Map<number, number>();
    /** How far the tractor's through each block it's on (0 to 1). */
    private readonly chewed = new Map<number, number>();
    private grindIn = 0;
    /** XP of blocks dug, not given yet. */
    private dug = 0;
    private readonly ahead = new THREE.Vector3();
    private hitTimer = 0;
    private idleTimer = TOOL_LINGER_SEC;
    private swinging = false;
    private messageCooldown = 0;
    private readonly probe = new THREE.Vector3();
    private readonly center = new THREE.Vector3();
    private readonly color = new THREE.Color();

    public constructor(
        private readonly terrain: VoxelTerrain,
        private readonly effects: DigEffects,
        private readonly player: DigPlayer,
        private readonly tractor: TractorRide,
        /** Short player-facing hints ("Backpack full!"). */
        private readonly say: (text: string) => void,
        /** A find reached the miner; `zone` is where it was dug up (its payout grows with depth). */
        private readonly onFind: (find: FindDef, zone: number) => void,
        /** The miner pushed into a block too hard for the tool (at most once per message): `tool` is the one it needs. */
        private readonly onTooHard: (ix: number, iz: number, tool: string) => void,
        /** The miner tried to dig with a full backpack (at most once per message). */
        private readonly onBagFull: () => void,
        /** The miner started pushing into rock with a full backpack (once per push, however long it lasts). */
        private readonly onFullPush: () => void,
        /** A chest dug out reached the miner; `zone` is where it was. */
        private readonly onChest: (kind: ChestKind, zone: number) => void,
        /** One swing broke `count` blocks (at least one), at `at`. */
        private readonly onBroke: (count: number, at: THREE.Vector3) => void,
        /** A drop cashed during a power surge: `amount` paid, landing at the miner. */
        private readonly onSurgeCash: (amount: number) => void,
    ) {}

    public fixedUpdate(delta: number): void {
        this.messageCooldown = Math.max(0, this.messageCooldown - delta);
        const wasPushingFull = this.pushingFull;
        this.pushingFull = false;
        if (this.tractor.isRiding) {
            this.effects.setCrack(null, 0);
            this.carve(delta, wasPushingFull);
            return;
        }
        const target = this.findTarget();
        if (!target) {
            this.effects.setCrack(null, 0);
            this.idle(delta);
            return;
        }
        const [ix, iz] = target;
        const value = this.terrain.cellValue(ix, iz);
        const tool = PowerSurge.digTool;
        const material = this.terrain.material(ix, iz);
        if (value === BEDROCK || !material) {
            this.effects.setCrack(null, 0);
            this.hint(t('bedrock'));
            this.idle(delta);
            return;
        }
        // A full backpack stops the dig: everything drops something, and breaking blocks for nothing
        // would just waste the vein.
        // (A power surge cashes every drop, so the bag never stops it.)
        if (!PowerSurge.active && DigProgress.backpackCount >= DigProgress.capacity) {
            this.effects.setCrack(null, 0);
            this.pushingFull = true;
            if (!wasPushingFull) this.onFullPush();
            if (this.hint(t('backpackFull'))) this.onBagFull();
            this.idle(delta);
            return;
        }
        if (material.minPower > tool.power) {
            this.effects.setCrack(null, 0);
            this.tooHard(ix, iz, material);
            this.idle(delta);
            return;
        }

        this.idleTimer = 0;
        this.startSwing();
        this.terrain.cellCenter(ix, iz, this.center);
        this.effects.setCrack(this.center, (this.damage.get(this.terrain.index(ix, iz)) ?? 0) / material.durability);
        this.hitTimer += delta;
        const interval = PowerSurge.hitInterval;
        if (this.hitTimer >= interval) {
            this.hitTimer -= interval;
            let broke = 0;
            for (const [cx, cz] of this.footprint(target, tool.area, tool.depth)) {
                if (this.hitCell(cx, cz, tool.power)) broke++;
            }
            if (broke > 0) this.onBroke(broke, this.center);
        }
    }

    /** A block too hard for what's digging: said, and its lock jumps. */
    private tooHard(ix: number, iz: number, material: MaterialDef): void {
        const needs = DigProgress.hasTractor ? t('needsBlades', { level: material.minPower - DigProgress.tool.power }) : names.tool(DIG.tools[1]);
        if (this.hint(t('needsTool', { material: names.material(material), tool: needs }))) this.onTooHard(ix, iz, needs);
    }

    /** Seconds the tractor takes on a block (Infinity: it can't). */
    private chewSeconds(material: MaterialDef): number {
        const { chewSec, falloff, shortSec } = DIG.digging;
        const over = PowerSurge.power - material.minPower;
        const seconds = over >= 0 ? chewSec * Math.pow(falloff, over) : shortSec[-over - 1] ?? Infinity;
        return seconds / PowerSurge.digRate;
    }

    /** Everything under the tractor and its blades, a little further each step, while it's being driven. */
    private carve(delta: number, wasFull: boolean): void {
        const controller = this.player.movementController;
        if (!controller?.enabled || controller.input.length() < PUSH_THRESHOLD) return;
        const { side, back, front } = this.tractor.digs;
        const ahead = this.tractor.forward(this.ahead);
        const at = this.player.transform.position;
        const reach = Math.hypot(side, Math.max(back, front)) + 1;
        const [fromX, fromZ] = this.terrain.cellOf(at.x - reach, at.z - reach);
        const [toX, toZ] = this.terrain.cellOf(at.x + reach, at.z + reach);
        const full = !PowerSurge.active && DigProgress.backpackCount >= DigProgress.capacity;
        let broke = 0;
        let hard: [number, number, MaterialDef] | undefined;
        for (let iz = fromZ; iz <= toZ; iz++) {
            for (let ix = fromX; ix <= toX; ix++) {
                const value = this.terrain.cellValue(ix, iz);
                if (value === AIR) continue;
                const cell = this.terrain.cellCenter(ix, iz, this.center);
                const dx = cell.x - at.x;
                const dz = cell.z - at.z;
                // The cell's middle in the tractor's frame: in what it digs if its nearest part is.
                const along = dx * ahead.x + dz * ahead.z;
                const across = Math.abs(dx * ahead.z - dz * ahead.x);
                if (across > side + CELL_REACH || along > front + CELL_REACH || along < -back - CELL_REACH) continue;
                const material = this.terrain.material(ix, iz);
                if (value === BEDROCK || !material) {
                    if (along > 0 && across < side) this.hint(t('bedrock'));
                    continue;
                }
                if (full) {
                    this.pushingFull = true;
                    continue;
                }
                const seconds = this.chewSeconds(material);
                if (!Number.isFinite(seconds)) {
                    if (along > 0 && across < side && !hard) hard = [ix, iz, material];
                    continue;
                }
                const index = this.terrain.index(ix, iz);
                const done = (this.chewed.get(index) ?? 0) + delta / seconds;
                if (done < 1) {
                    this.chewed.set(index, done);
                    continue;
                }
                this.chewed.delete(index);
                this.breakCell(ix, iz, material, CARVE_CHIPS);
                broke++;
            }
        }
        if (broke > 0) {
            this.onBroke(broke, at.clone().addScaledVector(ahead, front * 0.8));
        } else {
            this.grindIn -= delta;
        }
        if (full && this.pushingFull) {
            if (!wasFull) this.onFullPush();
            if (this.hint(t('backpackFull'))) this.onBagFull();
            return;
        }
        if (hard) this.tooHard(...hard);
        // Grinding on something that doesn't give way yet.
        if (this.chewed.size > 0 && broke === 0 && this.grindIn <= 0) {
            this.grindIn = GRIND_SEC;
            this.effects.hit(at.clone().addScaledVector(ahead, front * 0.8), this.color.set('#b9ada0'));
            DigAudio.play('hitStone');
        }
        if (this.chewed.size > CHEWED_MOST) this.chewed.clear();
    }

    /**
     * The block in front of the miner while they push into rock, or null: looked for along the push, then straight
     * along its main axis (the way footprint() digs) — a push at an angle into a wall still finds the wall.
     */
    private findTarget(): [number, number] | null {
        const controller = this.player.movementController;
        // Movement switched off (the debug free camera) means the keys aren't steering the miner.
        if (!controller?.enabled) return null;
        const input = controller.input;
        if (input.length() < PUSH_THRESHOLD) return null;
        const length = input.length();
        const position = this.player.transform.position;
        const reach = this.terrain.footprint + REACH_PAST_BODY;
        const alongX = Math.abs(input.x) >= Math.abs(input.y);
        const directions: [number, number][] = [[input.x / length, input.y / length], alongX ? [Math.sign(input.x), 0] : [0, Math.sign(input.y)]];
        for (const [dx, dz] of directions) {
            this.probe.set(position.x + dx * reach, 0, position.z + dz * reach);
            const [ix, iz] = this.terrain.cellOf(this.probe.x, this.probe.z);
            if (this.terrain.cellValue(ix, iz) !== AIR) return [ix, iz];
        }
        return null;
    }

    /**
     * Cells hit by one swing: every block across the miner's body in front (one, or two when standing on
     * a seam); wide tools add a block either side and a second row, a front 3 across and 2 deep. A tool's
     * `depth` sets the rows on its own (the Steel Pickaxe: 1 across, 2 deep).
     */
    private footprint([ix, iz]: [number, number], area: number, depth?: number): [number, number][] {
        const input = this.player.movementController.input;
        const position = this.player.transform.position;
        const alongX = Math.abs(input.x) >= Math.abs(input.y);
        const forward = alongX ? Math.sign(input.x) : Math.sign(input.y);
        // Cells across the body, perpendicular to the push.
        const across = alongX ? position.z : position.x;
        const [from] = alongX ? [this.terrain.cellOf(0, across - BODY_HALF_WIDTH)[1]] : [this.terrain.cellOf(across - BODY_HALF_WIDTH, 0)[0]];
        const [to] = alongX ? [this.terrain.cellOf(0, across + BODY_HALF_WIDTH)[1]] : [this.terrain.cellOf(across + BODY_HALF_WIDTH, 0)[0]];
        const wide = area > 1 ? Math.floor(area / 2) : 0;
        const rows = depth ?? (area > 1 ? 2 : 1);
        const cells: [number, number][] = [];
        for (let depth = 0; depth < rows; depth++) {
            for (let side = from - wide; side <= to + wide; side++) {
                cells.push(alongX ? [ix + forward * depth, side] : [side, iz + forward * depth]);
            }
        }
        return cells;
    }

    /** One hit on a cell; true when it broke. */
    private hitCell(ix: number, iz: number, power: number): boolean {
        const material = this.terrain.material(ix, iz);
        if (!material || material.minPower > power) return false;
        const index = this.terrain.index(ix, iz);
        const total = (this.damage.get(index) ?? 0) + power;
        this.terrain.cellCenter(ix, iz, this.center);
        this.color.set(material.color);
        if (total < material.durability) {
            this.damage.set(index, total);
            this.effects.hit(this.center, this.color);
            DigAudio.play(MiningController.hitCue(material));
            return false;
        }
        this.damage.delete(index);
        this.breakCell(ix, iz, material);
        return true;
    }

    /** A block breaks: what was in it comes out. */
    private breakCell(ix: number, iz: number, material: MaterialDef, chips?: number): void {
        this.terrain.cellCenter(ix, iz, this.center);
        this.color.set(material.color);
        const find = this.terrain.findAt(ix, iz) ?? this.forcedFirstFind();
        const chest = this.terrain.chestAt(ix, iz);
        const rich = this.terrain.isRich(ix, iz);
        this.terrain.remove(ix, iz);
        DigProgress.recordBlock(material.ore);
        this.dug += material.minPower * DIG.levels.xp.block;
        if (this.dug >= 1) {
            DigProgress.addXp(Math.floor(this.dug));
            this.dug -= Math.floor(this.dug);
        }
        DigProgress.terrainChanged();
        this.effects.shatter(this.center, this.color, chips);
        DigAudio.play(MiningController.hitCue(material));
        DigAudio.play(material.id === 'obsidian' ? 'breakObsidian' : 'break');
        this.drop(material, this.center, rich);
        if (find) {
            const zone = this.terrain.zoneIndexAt(this.center.x, this.center.z);
            this.effects.reveal(this.center.clone().setY(1), () => this.onFind(find, zone), this.terrain.findModel(find));
        }
        if (chest) {
            const zone = this.terrain.zoneIndexAt(this.center.x, this.center.z);
            this.effects.reveal(this.center.clone().setY(1), () => this.onChest(chest, zone), this.terrain.chestModel(chest));
        }
    }

    /**
     * Every new player finds their first artifact early: once they've bought their first hat (the tutorial's first
     * cosmetic, DigScene) and dug DIG.firstFindAfterBlocks
     * blocks, the block being dug
     * gives up the first find (the topsoil's first), and its buried copy leaves the rock.
     */
    private forcedFirstFind(): FindDef | undefined {
        // Only once: the find counts when its pop-out lands, and more blocks can break before that.
        if (this.firstFindGiven || DigProgress.totalFinds > 0 || !DigProgress.boughtFirstHat
            || DigProgress.achievementStat('blocks') < DIG.firstFindAfterBlocks) return undefined;
        this.firstFindGiven = true;
        const first = DIG.finds[0];
        this.terrain.unbury(first);
        return first;
    }

    /** The sound of a hit: crystal rings, ores clank, soft ground crunches, rock thuds (a shovel) or cracks (a pickaxe and up). */
    private static hitCue(material: MaterialDef): Cue {
        if (GEMS.has(material.id)) return 'hitGem';
        if (material.id === 'obsidian') return 'hitObsidian';
        if (material.ore) return 'hitMetal';
        if (SOFT_GROUND.has(material.id)) return 'hitDirt';
        return 'hitPick';
    }

    /** What a block drops flies to the miner: into the backpack, or (a power surge) straight to cash. */
    private drop(material: MaterialDef, at: THREE.Vector3, rich: boolean): void {
        // Ore Luck: a chance of one more from an ore block. A rich vein multiplies it all.
        const drops = (material.drops + (material.ore && Math.random() < DigProgress.oreLuck ? 1 : 0)) * (rich ? DIG.richOre.dropMultiplier : 1);
        for (let i = 0; i < drops; i++) {
            const from = at.clone().setY(0.8);
            const arrive = () => {
                if (PowerSurge.active) {
                    const amount = Math.max(1, Math.round(material.value * DigProgress.sellMultiplier));
                    DigProgress.addEarned(amount);
                    this.onSurgeCash(amount);
                    DigAudio.play(GEMS.has(material.id) ? 'collectGem' : material.ore ? 'collectMetal' : 'collectStone');
                } else if (DigProgress.addItems(material.id, 1) === 0) {
                    this.hint(t('backpackFull'));
                    DigAudio.play('error');
                } else {
                    DigAudio.play(GEMS.has(material.id) ? 'collectGem' : material.ore ? 'collectMetal' : 'collectStone');
                }
            };
            // (Plenty in the air already: straight in. The good ones are always seen.)
            if (this.effects.flying >= (material.ore ? FLYING.ore : FLYING.rock)) arrive();
            else this.effects.pickup(from, this.color.clone(), arrive, this.terrain.pickupModel(material));
        }
    }

    private startSwing(): void {
        const character = this.player.character;
        if (!character || this.swinging) return;
        const tool = PowerSurge.digTool;
        this.swinging = true;
        this.hitTimer = PowerSurge.hitInterval * 0.6;
        // In the tractor the miner just sits: blocks still break, without the tool or the swing.
        if (this.player.seated) return;
        character.showTool(tool.model);
        character.playAction(tool.clip === 'Digging' ? 'dig' : 'mine');
    }

    private idle(delta: number): void {
        this.idleTimer += delta;
        if (this.swinging && this.idleTimer >= TOOL_LINGER_SEC) {
            this.player.character?.stopAction();
            this.player.character?.showTool(undefined);
            this.swinging = false;
        }
    }

    /** Tool changed (upgrade bought): restart the swing with the new tool and clip. */
    public toolChanged(): void {
        if (this.swinging) {
            this.swinging = false;
            this.startSwing();
        }
    }

    /** Shows a message unless one was shown moments ago; true when it was shown. */
    private hint(text: string): boolean {
        if (this.messageCooldown > 0) return false;
        this.messageCooldown = MESSAGE_COOLDOWN_SEC;
        this.say(text);
        return true;
    }
}
