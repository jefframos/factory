// SpotlightDirector.ts
//
// One-time camera trips that show the player something NEW the moment it becomes available —
// the camera glides there, holds a beat with the player stopped, and comes back (the same
// CameraFocusHost.focusCameraOn() trip a build uses). Each is shown once per save
// (SpotlightStorage), queued one after another, and never while another camera trip / freeze or
// a paused game (notification) is going on.
//
// Two sources:
//   - request(key, position): PizzaScene asks when something spawns for sale DURING PLAY — an
//     animal stall, a store expansion (section), a mix station. Requests made while the scene is
//     still setting up (markReady() not called yet) are ignored, so a reload never replays them.
//   - the resource watch (every SPOTLIGHT_CONFIG.checkSec): the first time a kind of gatherable
//     thing in SPOTLIGHT_CONFIG.resources becomes reachable — standing in a revealed zone, near
//     the player, and the player owns its tool — e.g. the woods (axe), stone deposits (pickaxe),
//     loose stones (by hand). "Kind" = how it's gathered + what it gives, so a tree and a palm
//     (both chopped for wood) count once. Held back by `resourcesAllowed` (PizzaScene: not
//     during the first tutorial, which has its own camera trips).

import * as THREE from 'three';
import type { CameraFocusHost } from './CameraFocusHost';
import { SpotlightStorage } from '../data/SpotlightStorage';
import ResourceNodeRegistry, { GatherTarget } from '../player/ResourceNodeRegistry';
import ResourceNode from '../player/ResourceNode';
import { PROVIDER_CONFIG } from '../actions/ProviderTypes';
import { ACTION_CONFIG } from '../actions/ActionTypes';
import { ItemStorage } from '../crafting/ItemStorage';
import { ItemType } from '../crafting/ItemTypes';
import { ResourceType } from '../actions/ResourceTypes';
import type ZoneVisibilityManager from '../world/ZoneVisibilityManager';

/** Everything tunable — see this file's own doc. */
export const SPOTLIGHT_CONFIG = {
    /**
     * Spotlight things as they appear for sale (request() — stalls, store expansions, mix stations).
     * Off: each of those now has its own tutorial lesson (Tutorials tab) that pans the camera AND
     * points the hand at it — this would pan a second time. Turn on for things with no lesson.
     */
    forSale: false,
    /**
     * Resources whose gatherable sources get a first-time spotlight on their own. Empty: wood and
     * stone are shown by the tutorials that need them (focusCamera steps — the Lv2 wood lesson, the
     * pickaxe and bread-station lessons), at the moment they're needed.
     */
    resources: [] as ResourceType[],
    /** Only a source this close to the player (world units) counts as "showing up". */
    maxDistance: 30,
    /** How often the resource watch looks, seconds. */
    checkSec: 1,
    /** The camera trip: a beat before it starts, the glide there, the hold. */
    preDelaySec: 0.3,
    travelSec: 0.75,
    holdSec: 1.3,
};

interface Spotlight {
    key: string;
    target: THREE.Vector3;
}

export default class SpotlightDirector {
    private readonly host: CameraFocusHost;
    private readonly zoneVisibility: ZoneVisibilityManager;
    /** False while something else owns the camera / the game is paused. */
    private readonly canStart: () => boolean;
    /** False while resource spotlights should wait (e.g. the first tutorial). */
    private readonly resourcesAllowed: () => boolean;

    private ready = false;
    private busy = false;
    private readonly queue: Spotlight[] = [];
    private watchTimerSec = 0;

    public constructor(host: CameraFocusHost, zoneVisibility: ZoneVisibilityManager, canStart: () => boolean, resourcesAllowed: () => boolean) {
        this.host = host;
        this.zoneVisibility = zoneVisibility;
        this.canStart = canStart;
        this.resourcesAllowed = resourcesAllowed;
    }

    /** Call once the scene has finished setting up — spawns before this are the save being restored, not news. */
    public markReady(): void {
        this.ready = true;
    }

    /** Show `position` once per save under `key` (e.g. "stall:chickenStall") — queued; ignored before markReady(). */
    public request(key: string, position: THREE.Vector3): void {
        if (!SPOTLIGHT_CONFIG.forSale || !this.ready || SpotlightStorage.has(key) || this.queue.some(entry => entry.key === key)) {
            return;
        }
        this.queue.push({ key, target: position.clone() });
    }

    public update(delta: number, playerPosition: THREE.Vector3): void {
        if (!this.ready) {
            return;
        }
        this.watchTimerSec -= delta;
        if (this.watchTimerSec <= 0) {
            this.watchTimerSec = SPOTLIGHT_CONFIG.checkSec;
            if (this.resourcesAllowed()) {
                this.watchResources(playerPosition);
            }
        }

        if (this.busy || this.queue.length === 0 || !this.canStart()) {
            return;
        }
        const next = this.queue.shift()!;
        SpotlightStorage.add(next.key);
        this.busy = true;
        void this.host.focusCameraOn(next.target, {
            preDelaySec: SPOTLIGHT_CONFIG.preDelaySec,
            travelSec: SPOTLIGHT_CONFIG.travelSec,
            holdSec: SPOTLIGHT_CONFIG.holdSec,
            easedPan: true,
            releaseOnReturn: true,
        }).finally(() => {
            this.busy = false;
        });
    }

    private watchResources(playerPosition: THREE.Vector3): void {
        const maxDistSq = SPOTLIGHT_CONFIG.maxDistance * SPOTLIGHT_CONFIG.maxDistance;
        for (const type of SPOTLIGHT_CONFIG.resources) {
            const node = ResourceNodeRegistry.findNearest(type, playerPosition, candidate => {
                const key = this.kindKey(candidate, type);
                return !SpotlightStorage.has(key)
                    && !this.queue.some(entry => entry.key === key)
                    && candidate.position.distanceToSquared(playerPosition) <= maxDistSq
                    && this.isReachable(candidate);
            });
            if (node) {
                this.request(this.kindKey(node, type), node.position);
            }
        }
    }

    /** How it's gathered + what it gives — a tree and a palm (both chopped for wood) share one. */
    private kindKey(node: GatherTarget, type: ResourceType): string {
        return node instanceof ResourceNode
            ? `gather:${PROVIDER_CONFIG[node.providerType].action}:${type}`
            : `gather:pickup:${type}`;
    }

    /** In a revealed zone, and the player owns the tool it needs (if any). */
    private isReachable(node: GatherTarget): boolean {
        const zone = this.zoneVisibility.getZoneForPosition(node.position.x, node.position.z);
        if (zone !== undefined && !this.zoneVisibility.isZoneRevealed(zone)) {
            return false;
        }
        if (!(node instanceof ResourceNode)) {
            return true;
        }
        const tool = ACTION_CONFIG[PROVIDER_CONFIG[node.providerType].action]?.tool;
        return tool === undefined || ItemStorage.hasCount(tool as ItemType, 1);
    }
}
