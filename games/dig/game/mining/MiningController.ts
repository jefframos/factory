// MiningController.ts
//
// Automatic directional mining (GDD §5): while the miner pushes into a block, they swing their tool at it
// and every hit takes `power` off the block's durability. The shovel and pickaxe dig the block in front;
// the drill digs a front 3 wide and 2 deep, so the upgrade visibly changes how fast tunnels open.
// Blocks too hard for the current tool say so instead of breaking; bedrock never breaks. Broken blocks
// drop resources that fly into the backpack; a block hiding a find pops it out too (it pays cash
// straight away and doesn't take backpack space).

import * as THREE from 'three';
import { DIG, FindDef, MaterialDef } from '../data/DigConfig';
import { DigProgress, FindResult } from '../data/DigProgress';
import { VoxelTerrain, BEDROCK, AIR } from '../world/VoxelTerrain';
import { DigEffects } from '../vfx/DigEffects';
import type DigPlayer from '../player/DigPlayer';
import { t, names } from '../i18n/Localization';
import { DigAudio, type Cue } from '../audio/DigAudio';

/** How far ahead of the miner's centre the block being dug is looked for. */
const REACH = 0.75;
/** Half the miner's width: every block across it in front gets dug, so standing on a seam between two columns never leaves one blocking. */
const BODY_HALF_WIDTH = 0.3;
/** Below this the stick / keys count as not pushing. */
const PUSH_THRESHOLD = 0.3;
/** How long the tool stays out after the last hit. */
const TOOL_LINGER_SEC = 0.6;
const MESSAGE_COOLDOWN_SEC = 2.5;

export class MiningController {
    /** The forced first find was handed out this session (see forcedFirstFind()). */
    private firstFindGiven = false;
    private readonly damage = new Map<number, number>();
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
        /** Short player-facing hints ("Backpack full!"). */
        private readonly say: (text: string) => void,
        /** A find reached the miner and was paid out. */
        private readonly onFind: (find: FindDef, result: FindResult) => void,
    ) {}

    public fixedUpdate(delta: number): void {
        this.messageCooldown = Math.max(0, this.messageCooldown - delta);
        const target = this.findTarget();
        if (!target) {
            this.effects.setCrack(null, 0);
            this.idle(delta);
            return;
        }
        const [ix, iz] = target;
        const value = this.terrain.cellValue(ix, iz);
        const tool = DigProgress.tool;
        const material = this.terrain.material(ix, iz);
        if (value === BEDROCK || !material) {
            this.effects.setCrack(null, 0);
            this.hint(t('bedrock'));
            this.idle(delta);
            return;
        }
        // A full backpack stops the dig: everything drops something, and breaking blocks for nothing
        // would just waste the vein.
        if (DigProgress.backpackCount >= DigProgress.capacity) {
            this.effects.setCrack(null, 0);
            this.hint(t('backpackFull'));
            this.idle(delta);
            return;
        }
        if (material.minPower > tool.power) {
            this.effects.setCrack(null, 0);
            const needed = DIG.tools.find((t) => t.power >= material.minPower);
            this.hint(t('needsTool', { material: names.material(material), tool: needed ? names.tool(needed) : t('strongerTool') }));
            this.idle(delta);
            return;
        }

        this.idleTimer = 0;
        this.startSwing();
        this.terrain.cellCenter(ix, iz, this.center);
        this.effects.setCrack(this.center, (this.damage.get(this.terrain.index(ix, iz)) ?? 0) / material.durability);
        this.hitTimer += delta;
        if (this.hitTimer >= tool.hitInterval) {
            this.hitTimer -= tool.hitInterval;
            for (const [cx, cz] of this.footprint(target, tool.area)) {
                this.hitCell(cx, cz, tool.power);
            }
        }
    }

    /** The block in front of the miner while they push into rock, or null. */
    private findTarget(): [number, number] | null {
        const controller = this.player.movementController;
        // Movement switched off (the debug free camera) means the keys aren't steering the miner.
        if (!controller?.enabled) return null;
        const input = controller.input;
        if (input.length() < PUSH_THRESHOLD) return null;
        const length = input.length();
        const position = this.player.transform.position;
        this.probe.set(position.x + (input.x / length) * REACH, 0, position.z + (input.y / length) * REACH);
        const [ix, iz] = this.terrain.cellOf(this.probe.x, this.probe.z);
        return this.terrain.cellValue(ix, iz) === AIR ? null : [ix, iz];
    }

    /**
     * Cells hit by one swing: every block across the miner's body in front (one, or two when standing on
     * a seam); wide tools add a block either side and a second row, a front 3 across and 2 deep.
     */
    private footprint([ix, iz]: [number, number], area: number): [number, number][] {
        const input = this.player.movementController.input;
        const position = this.player.transform.position;
        const alongX = Math.abs(input.x) >= Math.abs(input.y);
        const forward = alongX ? Math.sign(input.x) : Math.sign(input.y);
        // Cells across the body, perpendicular to the push.
        const across = alongX ? position.z : position.x;
        const [from] = alongX ? [this.terrain.cellOf(0, across - BODY_HALF_WIDTH)[1]] : [this.terrain.cellOf(across - BODY_HALF_WIDTH, 0)[0]];
        const [to] = alongX ? [this.terrain.cellOf(0, across + BODY_HALF_WIDTH)[1]] : [this.terrain.cellOf(across + BODY_HALF_WIDTH, 0)[0]];
        const wide = area > 1 ? Math.floor(area / 2) : 0;
        const rows = area > 1 ? 2 : 1;
        const cells: [number, number][] = [];
        for (let depth = 0; depth < rows; depth++) {
            for (let side = from - wide; side <= to + wide; side++) {
                cells.push(alongX ? [ix + forward * depth, side] : [side, iz + forward * depth]);
            }
        }
        return cells;
    }

    private hitCell(ix: number, iz: number, power: number): void {
        const material = this.terrain.material(ix, iz);
        if (!material || material.minPower > power) return;
        const index = this.terrain.index(ix, iz);
        const total = (this.damage.get(index) ?? 0) + power;
        this.terrain.cellCenter(ix, iz, this.center);
        this.color.set(material.color);
        if (total < material.durability) {
            this.damage.set(index, total);
            this.effects.hit(this.center, this.color);
            DigAudio.play(MiningController.hitCue(material));
            return;
        }
        this.damage.delete(index);
        const find = this.terrain.findAt(ix, iz) ?? this.forcedFirstFind();
        this.terrain.remove(ix, iz);
        DigProgress.recordBlock(material.ore);
        DigProgress.terrainChanged();
        this.effects.shatter(this.center, this.color);
        DigAudio.play(MiningController.hitCue(material));
        DigAudio.play('break');
        this.drop(material, this.center);
        if (find) {
            this.effects.reveal(this.center.clone().setY(1), () => this.onFind(find, DigProgress.addFind(find)), this.terrain.findModel(find));
        }
    }

    /**
     * Every new player finds their first artifact early: once they've bought an upgrade and dug DIG.firstFindAfterBlocks
     * blocks, the block being dug
     * gives up the first find (the topsoil's first), and its buried copy leaves the rock.
     */
    private forcedFirstFind(): FindDef | undefined {
        // Only once: the find counts when its pop-out lands, and more blocks can break before that.
        if (this.firstFindGiven || DigProgress.collectedCount > 0 || DigProgress.upgradesBought < 1
            || DigProgress.achievementStat('blocks') < DIG.firstFindAfterBlocks) return undefined;
        this.firstFindGiven = true;
        const first = DIG.finds[0];
        this.terrain.unbury(first);
        return first;
    }

    /** The sound of a hit: crystal rings, ores clank, plain rock thuds (a shovel) or cracks (a pickaxe and up). */
    private static hitCue(material: MaterialDef): Cue {
        if (material.id === 'crystal') return 'hitGem';
        if (material.ore) return 'hitMetal';
        return DigProgress.tool.model === 'shovel' ? 'hitStone' : 'hitPick';
    }

    private drop(material: MaterialDef, at: THREE.Vector3): void {
        for (let i = 0; i < material.drops; i++) {
            const from = at.clone().setY(0.8);
            this.effects.pickup(from, this.color.clone(), () => {
                if (DigProgress.addItems(material.id, 1) === 0) {
                    this.hint(t('backpackFull'));
                    DigAudio.play('error');
                } else {
                    DigAudio.play(material.id === 'crystal' ? 'collectGem' : material.ore ? 'collectMetal' : 'collectStone');
                }
            }, this.terrain.pickupModel(material));
        }
    }

    private startSwing(): void {
        const character = this.player.character;
        if (!character || this.swinging) return;
        const tool = DigProgress.tool;
        this.swinging = true;
        this.hitTimer = tool.hitInterval * 0.6;
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

    private hint(text: string): void {
        if (this.messageCooldown > 0) return;
        this.messageCooldown = MESSAGE_COOLDOWN_SEC;
        this.say(text);
    }
}
