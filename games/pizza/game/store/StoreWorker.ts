// StoreWorker.ts
//
// Base class for every store WORKER — an NPC a store employs (see
// StoreTypes.ts's StoreWorkerEntry). Owns what every worker kind shares:
//   - its body: always the WORKER_NPC_ID look (one shared face for every
//     worker), loaded like a client's (NpcBodyLoader.ts), optionally with a
//     carrier on its back (see bodyOptions());
//   - walking (walkTo()): NavAgent on the store's nav grid to the goal's
//     nearest walkable cell, then — for an `exact` goal — straight onto the
//     exact point. The store's cashier/money-drop npcPoints sit inside rects
//     the nav grid blocks (so clients never walk through them), which is what
//     the second leg is for;
//   - wandering near a point (pickWanderSpot()), facing, and the walk/idle
//     animation.
// Each subclass is its own state machine, driven from think() every frame:
//   - StoreCashierWorker.ts   — serves at the cashier, collects the money drop.
//   - StoreRestockerWorker.ts — refills the emptiest shelf from the farms.
//
// Its id/role/level mirror its StoreWorkerStorage.ts entry — Store.ts owns
// that save and calls applyLevel() when a level changes.

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import CharacterBody from '../entities/CharacterBody';
import { getNpcConfig } from '../data/NpcTypes';
import { loadNpcBody, NpcBodyOptions } from '../world/NpcBodyLoader';
import NavAgent, { NavNeighbor } from './nav/NavAgent';
import StoreNavGrid from './nav/StoreNavGrid';
import { StoreWorkerRole, WORKER_NPC_ID } from './StoreTypes';

const NPC_MOVE_INPUT_MAGNITUDE = 0.5;
/** Within this distance of an exact goal (world units), the worker counts as standing on it. */
const POINT_ARRIVAL_EPSILON = 0.05;

/** What every worker needs from its Store. */
export interface StoreWorkerNavHost {
    getNavGrid(): StoreNavGrid | undefined;
    getNavNeighbors(): readonly NavNeighbor[];
}

export interface StoreWorkerBaseOptions {
    /** StoreWorkerStorage id — unique within the store. */
    id: string;
    level: number;
    moveSpeed: number;
    /** Personal-space radius — same as the store's clients. */
    radius: number;
    spawnAt: THREE.Vector3;
}

export default abstract class StoreWorker extends Entity implements NavNeighbor {
    public readonly workerId: string;
    public abstract readonly role: StoreWorkerRole;

    protected readonly navHost: StoreWorkerNavHost;
    protected readonly body = new CharacterBody();
    protected readonly agent: NavAgent;
    protected moveSpeed: number;
    protected level: number;
    /** What to face while standing still this frame — set by think(). */
    protected faceTarget?: THREE.Vector3;

    /** The goal being walked to, whether the walk ends exactly on it (second leg), its nav-walkable approach (first leg), and the grid that approach was snapped on. */
    private walkTarget?: THREE.Vector3;
    private walkExact = true;
    private readonly approach = new THREE.Vector3();
    private approachGrid?: StoreNavGrid;
    private straightMoving = false;
    private straightDirX = 0;
    private straightDirZ = 0;

    protected constructor(host: StoreWorkerNavHost, options: StoreWorkerBaseOptions) {
        super();
        this.navHost = host;
        this.workerId = options.id;
        this.level = options.level;
        this.moveSpeed = options.moveSpeed;
        this.transform.position.copy(options.spawnAt);
        this.agent = new NavAgent(this.transform.position, () => host.getNavGrid(), {
            radius: options.radius,
            speed: options.moveSpeed,
        });
    }

    // ---- NavNeighbor

    public get position(): THREE.Vector3 {
        return this.transform.position;
    }

    public isNavMoving(): boolean {
        return this.agent.isMoving || this.straightMoving;
    }

    // ---- Entity

    public override awake(): void {
        this.transform.add(this.body.container);
        const npcConfig = getNpcConfig(WORKER_NPC_ID) ?? getNpcConfig('default');
        if (!npcConfig) {
            console.warn(`[StoreWorker] npc "${WORKER_NPC_ID}" has no NpcConfig registered — worker will be invisible`);
            return;
        }
        void loadNpcBody(this.body, npcConfig, this.bodyOptions())
            .catch(error => console.error(`[StoreWorker] failed to load npc "${WORKER_NPC_ID}"`, error));
    }

    public override update(delta: number): void {
        super.update(delta);

        this.faceTarget = undefined;
        this.think(delta);
        this.agent.update(delta, this.navHost.getNavNeighbors());
        this.updateWalk(delta);

        const moving = this.agent.isMoving || this.straightMoving;
        const faceTarget = this.faceTarget as THREE.Vector3 | undefined;
        if (!moving && faceTarget) {
            this.body.faceDirection(faceTarget.x - this.transform.position.x, faceTarget.z - this.transform.position.z);
        }
        const dirX = this.agent.isMoving ? this.agent.moveDirX : this.straightDirX;
        const dirZ = this.agent.isMoving ? this.agent.moveDirZ : this.straightDirZ;
        // `grounded: true` — see StoreClient.update()'s own note.
        this.body.update(delta, moving ? dirX * NPC_MOVE_INPUT_MAGNITUDE : 0, moving ? dirZ * NPC_MOVE_INPUT_MAGNITUDE : 0, { grounded: true });
    }

    public override destroy(): void {
        this.body.destroy();
        super.destroy();
    }

    // ---- Store-facing API

    public getLevel(): number {
        return this.level;
    }

    /** New level from StoreWorkerStorage — the subclass picks its stats for it (see Store.applyWorkerLevels()). */
    public abstract applyLevel(level: number): void;

    // ---- For subclasses

    /** One frame of this worker's own state machine — runs before movement. */
    protected abstract think(delta: number): void;

    /** Extra body setup (e.g. a carrier) — see NpcBodyOptions. */
    protected bodyOptions(): NpcBodyOptions {
        return {};
    }

    protected setMoveSpeed(speed: number): void {
        this.moveSpeed = speed;
        this.agent.setSpeed(speed);
    }

    /**
     * Walk to `point` — see this file's own doc. `exact` (the default) finishes straight onto the
     * point even when it's inside a blocked rect; otherwise the walk ends on its nearest walkable cell.
     */
    protected walkTo(point: THREE.Vector3, exact = true): void {
        this.walkTarget = point.clone();
        this.walkExact = exact;
        this.approachGrid = undefined;
        this.refreshApproach();
    }

    protected stopWalking(): void {
        this.walkTarget = undefined;
        this.straightMoving = false;
        this.agent.stop();
    }

    /** True when there's no walk, or it has ended (exactly on its point, for an exact walk). */
    protected isWalkDone(): boolean {
        const target = this.walkTarget;
        if (!target || !this.agent.hasArrived()) {
            return !target;
        }
        return !this.walkExact || Math.hypot(target.x - this.transform.position.x, target.z - this.transform.position.z) <= POINT_ARRIVAL_EPSILON;
    }

    /** A random walkable spot within `radius` of `center`, or undefined (no grid yet / nothing walkable nearby). */
    protected pickWanderSpot(center: THREE.Vector3, radius: number): THREE.Vector3 | undefined {
        const cells = this.navHost.getNavGrid()?.walkableCellsNear(center.x, center.z, radius) ?? [];
        return cells.length > 0 ? cells[Math.floor(Math.random() * cells.length)] : undefined;
    }

    // ---- Walking internals

    /** (Re)snaps the first leg's goal — at the start of a walk, and whenever the store rebuilt its nav grid. */
    private refreshApproach(): void {
        if (!this.walkTarget) {
            return;
        }
        const grid = this.navHost.getNavGrid();
        this.approachGrid = grid;
        this.approach.copy(this.walkTarget);
        grid?.snapToWalkable(this.approach);
        this.agent.setGoal(this.approach);
    }

    /** Second leg of an exact walk: once NavAgent has reached the approach cell, step straight onto the point. */
    private updateWalk(delta: number): void {
        this.straightMoving = false;
        const target = this.walkTarget;
        if (!target) {
            return;
        }
        if (this.navHost.getNavGrid() !== this.approachGrid) {
            this.refreshApproach();
        }
        if (!this.walkExact || !this.agent.hasArrived()) {
            return;
        }
        const dx = target.x - this.transform.position.x;
        const dz = target.z - this.transform.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance <= POINT_ARRIVAL_EPSILON) {
            return;
        }
        const step = Math.min(distance, this.moveSpeed * delta);
        this.straightDirX = dx / distance;
        this.straightDirZ = dz / distance;
        this.transform.position.x += this.straightDirX * step;
        this.transform.position.z += this.straightDirZ * step;
        this.straightMoving = true;
    }
}

export function randomRange([min, max]: [number, number]): number {
    return min + Math.random() * (max - min);
}
