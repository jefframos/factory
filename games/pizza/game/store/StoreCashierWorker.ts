// StoreCashierWorker.ts
//
// A store's CASHIER worker (StoreWorker.ts's base; settings in StoreTypes.ts's
// StoreCashierWorkerConfig) — does the player's two cashier chores:
//
//   wandering ──client in the cashier line──► toCashier ──arrived──► serving
//      ▲  │                                                              │
//      │  └──money on the pile, nobody waiting──► toCollect ◄────────────┤ every collectEverySales
//      │                                             │ arrived           │ sales (money on the pile)
//      └──────────── collecting (pile -> wallet) ◄───┘                   │
//      └───────────────────── line empty ────────────────────────────────┘
//
// Serving counts exactly like the player standing at the cashier: while
// isServing(), Store.updateCashier() lets the front client pay — after this
// worker's own level payDelaySec (see getCashierLevelStats()). Collecting
// sends the whole money pile to the player's wallet (StoreMoneyPile.
// collectToWallet()), same as the player walking onto it.
//
// Where it stands: the map's "npcPoint" objects targeting the cashier / the
// money drop (StoreLayout.ts).

import * as THREE from 'three';
import StoreWorker, { StoreWorkerBaseOptions, StoreWorkerNavHost, randomRange } from './StoreWorker';
import StoreLine from './StoreLine';
import type StoreClient from './StoreClient';
import { StoreWorkerRole } from './StoreTypes';

/** Seconds standing still between two wander walks. */
const WANDER_IDLE_SEC: [number, number] = [1.5, 3.5];
/** Seconds it lingers at the money drop after collecting before moving on. */
const COLLECT_PAUSE_SEC = 0.6;

/** What a cashier needs from its Store. */
export interface StoreCashierHost extends StoreWorkerNavHost {
    readonly cashierLine: StoreLine<StoreClient>;
    /** True while the money drop has anything on it. */
    hasMoneyToCollect(): boolean;
    /** Sends the money drop's whole pile to the player's wallet. */
    collectMoney(): void;
    /** This store's cashier stats at `level`. */
    getCashierStats(level: number): { moveSpeed: number; payDelaySec: number };
}

export interface StoreCashierOptions extends StoreWorkerBaseOptions {
    payDelaySec: number;
    collectEverySales: number;
    wanderRadius: number;
    cashierPoint: THREE.Vector3;
    collectPoint: THREE.Vector3;
}

export type StoreCashierState = 'wandering' | 'toCashier' | 'serving' | 'toCollect' | 'collecting';

export default class StoreCashierWorker extends StoreWorker {
    public readonly role: StoreWorkerRole = 'cashier';

    private readonly host: StoreCashierHost;
    private readonly options: StoreCashierOptions;
    private payDelaySec: number;
    private state: StoreCashierState = 'wandering';
    /** Sales served since the last collect — see StoreCashierOptions.collectEverySales. */
    private salesSinceCollect = 0;
    private timerSec = 0;

    public constructor(host: StoreCashierHost, options: StoreCashierOptions) {
        super(host, options);
        this.host = host;
        this.options = options;
        this.payDelaySec = options.payDelaySec;
    }

    // ---- Store-facing API

    public getState(): StoreCashierState {
        return this.state;
    }

    /** True while standing on the cashier point — Store.updateCashier() treats this like the player being at the cashier. */
    public isServing(): boolean {
        return this.state === 'serving';
    }

    /** This worker's Pay Time at its level. */
    public getPayDelaySec(): number {
        return this.payDelaySec;
    }

    /** A client just paid while this worker was serving. */
    public onServed(): void {
        this.salesSinceCollect++;
    }

    public applyLevel(level: number): void {
        this.level = level;
        const stats = this.host.getCashierStats(level);
        this.setMoveSpeed(stats.moveSpeed);
        this.payDelaySec = stats.payDelaySec;
    }

    // ---- States

    private setState(next: StoreCashierState): void {
        if (next === this.state) {
            return;
        }
        this.state = next;
        switch (next) {
            case 'wandering':
                this.timerSec = 0;
                this.stopWalking();
                break;
            case 'toCashier':
                this.walkTo(this.options.cashierPoint);
                break;
            case 'toCollect':
                this.walkTo(this.options.collectPoint);
                break;
            case 'collecting':
                this.host.collectMoney();
                this.salesSinceCollect = 0;
                this.timerSec = COLLECT_PAUSE_SEC;
                break;
        }
    }

    protected think(delta: number): void {
        switch (this.state) {
            case 'wandering':
                this.updateWandering(delta);
                break;
            case 'toCashier':
                if (this.host.cashierLine.length === 0) {
                    this.setState('wandering');
                } else if (this.isWalkDone()) {
                    this.setState('serving');
                }
                break;
            case 'serving':
                this.updateServing();
                break;
            case 'toCollect':
                if (this.isWalkDone()) {
                    this.setState('collecting');
                }
                break;
            case 'collecting':
                this.timerSec -= delta;
                if (this.timerSec <= 0) {
                    this.setState('wandering');
                }
                break;
        }
    }

    /** Idle near the cashier — anyone heading to pay sends it to the cashier; otherwise money on the pile sends it to collect. */
    private updateWandering(delta: number): void {
        if (this.host.cashierLine.length > 0) {
            this.setState('toCashier');
            return;
        }
        if (this.host.hasMoneyToCollect()) {
            this.setState('toCollect');
            return;
        }
        if (!this.isWalkDone()) {
            return;
        }
        this.faceTarget = this.host.cashierLine.firstSpot;
        this.timerSec -= delta;
        if (this.timerSec <= 0) {
            this.timerSec = randomRange(WANDER_IDLE_SEC);
            const spot = this.pickWanderSpot(this.options.cashierPoint, this.options.wanderRadius);
            if (spot) {
                this.walkTo(spot);
            }
        }
    }

    /** On the cashier point — Store lets the front client pay. Leaves to collect every collectEverySales sales, or once nobody's left to serve. */
    private updateServing(): void {
        this.faceTarget = this.host.cashierLine.firstSpot;
        if (this.salesSinceCollect >= this.options.collectEverySales && this.host.hasMoneyToCollect()) {
            this.setState('toCollect');
            return;
        }
        if (this.host.cashierLine.length === 0) {
            this.setState('wandering');
        }
    }
}
