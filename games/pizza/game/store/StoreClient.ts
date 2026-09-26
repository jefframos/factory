// StoreClient.ts
//
// One shopper walking through a Store (see Store.ts). Spawns at the
// entrance with a short shopping list, then, for each item in turn:
//   1. joins the waiting line of a storage that sells it (StoreLine),
//   2. once at the front, takes one unit at a time out of StorageInventory
//      (which is what shrinks that storage's pile) — or, if the storage is
//      empty, WAITS there (bubble pulses that item) until it's refilled.
// With the list done it lines up at the cashier and waits for the player;
// Store.ts decides when it pays (pay()). After paying
// it walks straight to the exit and reports isFinished() so Store removes it.
//
// Walks in straight lines with the same CharacterBody rig and
// NPC_MOVE_INPUT_MAGNITUDE trick QuestGiverEntity uses — see that file's own
// doc on why the move input isn't a full 1.0.

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import CharacterBody from '../entities/CharacterBody';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import { spawnFlyingResourceIcon } from '../components/FlyingResourceIcon';
import { ZONE_LABEL_ANCHOR_OPTIONS } from '../ui/ZoneLabelConfig';
import { getNpcConfig } from '../data/NpcTypes';
import { loadNpcBody } from '../world/NpcBodyLoader';
import { getAssetIcon } from '../world/AssetLibraryRegistry';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { ResourceType } from '../actions/ResourceTypes';
import { StorageInventory } from '../data/StorageInventory';
import StoreBubble, { StoreBubbleContent } from './StoreBubble';
import StoreLine from './StoreLine';
import { StoreConfig, getStoreItemPrice } from './StoreTypes';

const NPC_MOVE_INPUT_MAGNITUDE = 0.5;
const ARRIVAL_EPSILON = 0.05;
/** How often a client waiting on an empty storage looks for another storage that has its item in stock. */
const REROUTE_CHECK_SEC = 1;
/** Bubble height above the client's feet until its rig (and so its Head bone) has loaded. */
const FALLBACK_HEAD_HEIGHT = 2;
/** Picked items fly from this high above the storage's own position. */
const STORAGE_ICON_HEIGHT = 1;

/** A storage a client can queue at — built by Store.ts, one per active storage inside the store. */
export interface StoreStorageRef {
    readonly id: string;
    readonly position: THREE.Vector3;
    readonly line: StoreLine<StoreClient>;
}

/** What a client needs from its Store — an interface so this file doesn't import Store.ts. */
export interface StoreClientHost {
    readonly config: StoreConfig;
    readonly screenHost: ScreenAnchorHost;
    readonly cashierLine: StoreLine<StoreClient>;
    /** The best storage to get `type` from right now, or undefined if no active storage sells it any more. */
    chooseStorageFor(type: ResourceType): StoreStorageRef | undefined;
    /** Whether the store is currently revealed (fog of war) — the bubble hides while it isn't. */
    isVisible(): boolean;
}

export interface StoreClientWant {
    type: ResourceType;
    amount: number;
}

interface WantProgress {
    type: ResourceType;
    remaining: number;
    bought: number;
}

type ClientState = 'shopping' | 'toCashier' | 'readyToPay' | 'leaving' | 'done';

export default class StoreClient extends Entity {
    private readonly host: StoreClientHost;
    private readonly wants: WantProgress[];
    private readonly exitPoint: THREE.Vector3;
    private readonly npcId: string;
    private readonly body = new CharacterBody();
    private readonly bubble = new StoreBubble();
    private anchor?: ScreenAnchorComponent;

    private state: ClientState = 'shopping';
    private wantIndex = 0;
    private storage?: StoreStorageRef;
    private pickTimerSec = 0;
    private rerouteTimerSec = REROUTE_CHECK_SEC;
    private waitingForStock = false;

    private readonly goal = new THREE.Vector3();
    private readonly scratchHead = new THREE.Vector3();
    private readonly scratchFrom = new THREE.Vector3();
    private moveDirX = 0;
    private moveDirZ = 0;
    private isMoving = false;

    public constructor(host: StoreClientHost, spawnAt: THREE.Vector3, exitPoint: THREE.Vector3, wants: StoreClientWant[], npcId: string) {
        super();
        this.host = host;
        this.exitPoint = exitPoint.clone();
        this.wants = wants.map(want => ({ type: want.type, remaining: want.amount, bought: 0 }));
        this.npcId = npcId;
        this.transform.position.copy(spawnAt);
    }

    public override awake(): void {
        this.transform.add(this.body.container);
        const npcConfig = getNpcConfig(this.npcId) ?? getNpcConfig('default');
        if (npcConfig) {
            void loadNpcBody(this.body, npcConfig)
                .catch(error => console.error(`[StoreClient] failed to load npc "${this.npcId}"`, error));
        } else {
            console.warn(`[StoreClient] npc "${this.npcId}" has no NpcConfig registered — client will be invisible`);
        }

        const headTarget = new THREE.Vector3();
        const bubbleOffset = new THREE.Vector3(0, this.host.config.bubbleOffset, 0);
        this.anchor = this.addComponent(new ScreenAnchorComponent(
            this.host.screenHost,
            this.bubble.content,
            () => this.getHeadWorldPosition(headTarget).add(bubbleOffset),
            ZONE_LABEL_ANCHOR_OPTIONS,
        ));
    }

    public override update(delta: number): void {
        super.update(delta);

        let faceTarget: THREE.Vector3 | undefined;
        switch (this.state) {
            case 'shopping':
                faceTarget = this.updateShopping(delta);
                break;
            case 'toCashier':
            case 'readyToPay': {
                const line = this.host.cashierLine;
                const arrived = line.getSpotFor(this, this.goal) ? this.moveToward(this.goal, delta) : false;
                if (this.state === 'toCashier' && arrived && line.isFront(this)) {
                    this.state = 'readyToPay';
                }
                faceTarget = arrived ? line.target : undefined;
                break;
            }
            case 'leaving':
                if (this.moveToward(this.exitPoint, delta)) {
                    this.state = 'done';
                }
                break;
            case 'done':
                this.isMoving = false;
                break;
        }

        if (!this.isMoving && faceTarget) {
            this.body.faceDirection(faceTarget.x - this.transform.position.x, faceTarget.z - this.transform.position.z);
        }
        const dirX = this.isMoving ? this.moveDirX * NPC_MOVE_INPUT_MAGNITUDE : 0;
        const dirZ = this.isMoving ? this.moveDirZ * NPC_MOVE_INPUT_MAGNITUDE : 0;
        // `grounded: true` — see QuestGiverEntity.update()'s own doc: every idle/walk transition is gated on it.
        this.body.update(delta, dirX, dirZ, { grounded: true });

        this.bubble.show(this.bubbleContent());
        this.anchor?.setForceHidden(!this.host.isVisible());
    }

    /** True once standing at the front of the cashier line with everything picked, waiting for the player. */
    public isReadyToPay(): boolean {
        return this.state === 'readyToPay';
    }

    /** Store.ts calls this when the player is at the cashier — frees the cashier spot, starts walking to the exit and returns what this client pays. */
    public pay(): number {
        this.host.cashierLine.leave(this);
        this.state = 'leaving';
        return this.getTotalPrice();
    }

    public isFinished(): boolean {
        return this.state === 'done';
    }

    public getHeadWorldPosition(target: THREE.Vector3 = new THREE.Vector3()): THREE.Vector3 {
        const head = this.body.getBone('Head');
        if (head && this.body.container.visible) {
            return head.getWorldPosition(target);
        }
        return target.copy(this.transform.position).setY(this.transform.position.y + FALLBACK_HEAD_HEIGHT);
    }

    public override destroy(): void {
        this.storage?.line.leave(this);
        this.host.cashierLine.leave(this);
        this.bubble.destroy();
        this.body.destroy();
        super.destroy();
    }

    /** Returns what to face while parked (the storage), or undefined while walking. */
    private updateShopping(delta: number): THREE.Vector3 | undefined {
        this.waitingForStock = false;
        const want = this.wants[this.wantIndex];
        if (!want) {
            this.startCheckout();
            return undefined;
        }

        if (!this.storage) {
            this.storage = this.host.chooseStorageFor(want.type);
            if (!this.storage) {
                // Nothing in the store sells this any more (storage disabled/removed) — skip it.
                this.wantIndex++;
                return undefined;
            }
            this.storage.line.join(this);
            this.pickTimerSec = 0;
        }

        // Stuck on an empty storage while another one has this item in stock — switch lines.
        this.rerouteTimerSec -= delta;
        if (this.rerouteTimerSec <= 0) {
            this.rerouteTimerSec = REROUTE_CHECK_SEC;
            if (StorageInventory.getCount(this.storage.id, want.type) <= 0) {
                const better = this.host.chooseStorageFor(want.type);
                if (better && better !== this.storage && StorageInventory.getCount(better.id, want.type) > 0) {
                    this.storage.line.leave(this);
                    this.storage = better;
                    this.storage.line.join(this);
                    this.pickTimerSec = 0;
                }
            }
        }

        const storage = this.storage;
        const arrived = storage.line.getSpotFor(this, this.goal) ? this.moveToward(this.goal, delta) : false;
        if (!arrived || !storage.line.isFront(this)) {
            return arrived ? storage.position : undefined;
        }

        if (StorageInventory.getCount(storage.id, want.type) <= 0) {
            this.pickTimerSec = 0;
            this.waitingForStock = true;
            return storage.position;
        }

        this.pickTimerSec += delta;
        if (this.pickTimerSec >= this.host.config.pickDelaySec) {
            this.pickTimerSec = 0;
            if (StorageInventory.remove(storage.id, want.type, 1) > 0) {
                want.remaining--;
                want.bought++;
                this.flyPickedItem(want.type, storage.position);
                if (want.remaining <= 0) {
                    storage.line.leave(this);
                    this.storage = undefined;
                    this.wantIndex++;
                }
            }
        }
        return storage.position;
    }

    private startCheckout(): void {
        if (this.getTotalPrice() <= 0) {
            // Couldn't buy anything at all — just leave.
            this.state = 'leaving';
            return;
        }
        this.host.cashierLine.join(this);
        this.state = 'toCashier';
    }

    private getTotalPrice(): number {
        const base = this.wants.reduce((sum, want) => sum + want.bought * getStoreItemPrice(want.type), 0);
        return base > 0 ? Math.max(1, Math.round(base * this.host.config.priceMultiplier)) : 0;
    }

    private bubbleContent(): StoreBubbleContent {
        switch (this.state) {
            case 'shopping': {
                const wants = this.wants.filter(want => want.remaining > 0).map(want => ({ type: want.type, remaining: want.remaining }));
                const waitingFor = this.waitingForStock ? this.wants[this.wantIndex]?.type : undefined;
                return wants.length > 0 ? { kind: 'wants', wants, waitingFor } : { kind: 'hidden' };
            }
            case 'toCashier':
            case 'readyToPay':
                return { kind: 'pay', amount: this.getTotalPrice() };
            default:
                return { kind: 'hidden' };
        }
    }

    private flyPickedItem(type: ResourceType, storagePosition: THREE.Vector3): void {
        const from = this.scratchFrom.copy(storagePosition).setY(storagePosition.y + STORAGE_ICON_HEIGHT).clone();
        const to = this.getHeadWorldPosition(this.scratchHead).clone();
        spawnFlyingResourceIcon(this.host.screenHost, from, to, getAssetIcon(resolveResourceAssetKey(type)));
    }

    /** Straight-line step toward `goal` (XZ only) — returns true once standing on it. */
    private moveToward(goal: THREE.Vector3, delta: number): boolean {
        const position = this.transform.position;
        const dx = goal.x - position.x;
        const dz = goal.z - position.z;
        const distance = Math.hypot(dx, dz);
        if (distance <= ARRIVAL_EPSILON) {
            this.isMoving = false;
            return true;
        }

        const step = Math.min(distance, this.host.config.moveSpeed * delta);
        position.x += (dx / distance) * step;
        position.z += (dz / distance) * step;
        this.moveDirX = dx / distance;
        this.moveDirZ = dz / distance;
        this.isMoving = true;
        return distance - step <= ARRIVAL_EPSILON;
    }
}
