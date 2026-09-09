// QuestGiverGroup.ts
//
// Coordinates 1+ QuestGiverEntity instances walking the SAME queue's
// waypoint path when QuestGiverConfig.maxEntities > 1 (see that field's own
// doc) — spawns the first giver immediately, then spawns each ADDITIONAL one
// after `spawnIntervalSec`, up to `maxEntities` total. Also owns REPLACING
// one: a queue with negative-order exit waypoints drawn (see QuestGiverEntity.
// ts's own doc on `exitPath`) despawns each giver after it delivers and walks
// out, rather than looping it forever — update() notices via isFinished(),
// removes it from the world, and the very same "fewer than maxEntities alive
// -> spawn one after spawnIntervalSec" logic that fills the line initially
// naturally spawns its replacement too. A queue with no exit waypoints never
// sees isFinished() go true at all — every giver just loops forever, same as
// before this despawn/replace behavior existed.
//
// Also the single source of truth for "how far may I advance yet" (see getMinAllowedArc()):
// every frame, ranks its own tracked givers by their live ARC-LENGTH
// position along the path (see QuestGiverEntity.getCurrentArc()'s own doc —
// 0 sits right at the queue, increasing toward the far waypoint) and tells
// each one the smallest arc it's allowed to occupy — 0 for whichever giver
// is currently closest (nothing ahead of it to keep spacing from, so it's
// free to walk all the way to the queue and run the full arrival/task/wait
// cycle), or `queueSpacing` past whichever OTHER giver is currently closer.
// QuestGiverEntity itself has no notion of "am I the front one" — that's
// purely an emergent property of "nobody's currently closer than me," so
// once the current front giver walks back OUT, whichever giver was waiting
// right behind it automatically becomes free to keep advancing, with zero
// explicit hand-off logic needed.
//
// Unlike an earlier version of this file, a queued giver's own stopping
// point is NOT snapped to one of the path's drawn waypoints — it's an
// arbitrary point `queueSpacing` world units (measured along the path
// itself, not straight-line) behind whoever's ahead of it, computed by
// QuestGiverEntity.pointAtArcLength(). That's what actually keeps 3+ givers
// visibly spaced apart in line rather than bunching up at whichever
// waypoints happen to exist.
//
// maxEntities undefined/<=1 (see getQuestGiverConfig()'s own default)
// spawns exactly ONE giver, whose getMinAllowedArc() call always returns 0
// (nothing else in `givers` to rank against) — IDENTICAL to this entity's
// behavior before this file existed. That's the one behavior this file is
// NOT allowed to change.
//
// A one-frame-stale ranking is an accepted simplification: this class and
// every QuestGiverEntity it spawns are all plain Entities ticked through
// the same World.update() pass in unspecified order, so a giver's own
// getMinAllowedArc() call this frame may read last frame's arcs rather than
// this frame's — imperceptible given how smooth/continuous this movement
// already is, and far simpler than enforcing a strict update-order
// dependency between this class and its own spawned children.
//
// Collision avoidance only applies to a giver walking IN (toward the
// queue) — a giver walking OUT (having just finished its task) is never
// gated, so it can briefly overlap whichever giver is queued up right
// behind it on its way past. Accepted simplification, same reasoning as
// the stale-ranking note above: modeling bidirectional passing on a single-
// file path is real traffic simulation, well past what this feature needs.
//
// A departing (walking-OUT) giver is also excluded ENTIRELY from ranking
// (see rankGivers()) — not just ungated itself, but incapable of blocking
// anyone else either. Without that exclusion, a follower's own allowed arc
// stayed pegged to the departing giver's own (still climbing, unconstrained)
// arc for as long as it remained the numerically smaller one, dragging the
// follower back out toward the exit right alongside it instead of letting
// it advance into the now-empty queue — the exact bug this exclusion fixes.
//
// awake()'s own `stoppedCount` resume is what makes QueueStorage's now-
// persisted giver presence/stopped-count (see that file's own doc) actually
// MEAN something across a reload: however many givers were genuinely STOPPED
// in line (see QuestGiverEntity.isStoppedInLine()'s own doc — the front one
// waiting for delivery, or a follower already parked behind whoever's ahead
// of it) spawn directly at their resting arc-length positions (0, queueSpacing,
// 2*queueSpacing, ...) instead of forcing a brand-new walk-in from the far
// waypoint for every single one — otherwise the panel would sit hidden for
// however long that walk takes, even though the player's own progress
// secretly survived. A giver that was still mid-walk (not yet stopped
// anywhere) when the game last saved is simply NOT restored — see
// isStoppedInLine()'s own doc for why that's fine to just drop.

import * as THREE from 'three';
import Entity from '../ecs/Entity';
import QuestGiverEntity from './QuestGiverEntity';
import { QuestGiverConfig } from '../data/QuestGiverTypes';
import { QueueStorage } from '../data/QueueStorage';
import { WaypointPlacement } from '../world/WorldObjectRegistry';

const DEFAULT_MAX_ENTITIES = 1;
const DEFAULT_QUEUE_SPACING = 3;
const DEFAULT_SPAWN_INTERVAL_SEC = 10;

export default class QuestGiverGroup extends Entity {
    private readonly queueId: string;
    private readonly waypoints: readonly WaypointPlacement[];
    private readonly config: QuestGiverConfig;
    /** The queue's own world position (its collider/panel anchor, NOT a waypoint) — passed straight through to every giver so it can face the queue itself precisely while parked there (see QuestGiverEntity's own `queuePosition` field doc), rather than relying purely on the entry path's own final-segment direction, which a designer-placed waypoint doesn't always aim exactly at the collider's center. */
    private readonly queuePosition: THREE.Vector3;
    private readonly getPlayerPosition: () => THREE.Vector3;
    /** Caller-supplied per-giver setup (parenting the transform into the THREE scene, zone-visibility registration, ...) — called once for every giver this group ever spawns, including the very first. */
    private readonly onSpawned: (giver: QuestGiverEntity) => void;

    private readonly maxEntities: number;
    private readonly queueSpacing: number;
    private readonly spawnIntervalSec: number;

    private readonly givers: QuestGiverEntity[] = [];
    /** Every tracked giver's live arc-length position, recomputed ONCE per update() (not once per getMinAllowedArc() call — several givers can each ask in the same frame) — see rankGivers(). */
    private readonly arcById = new Map<QuestGiverEntity, number>();
    private spawnTimerSec = 0;
    /** The stopped-giver count this group last reported to QueueStorage — see update()'s own doc. Starts at -1 (not 0) so the very first tick, even if nothing is stopped yet, still reports 0 explicitly rather than silently matching an already-0 default and skipping the call. */
    private lastReportedStoppedCount = -1;
    /** See consumeForceLowestWeightVariant()'s own doc — tracked here, at the GROUP (per-queue) level, not per-giver-instance. */
    private hasPickedVariantBefore = false;

    public constructor(
        queueId: string,
        waypoints: readonly WaypointPlacement[],
        config: QuestGiverConfig,
        queuePosition: THREE.Vector3,
        getPlayerPosition: () => THREE.Vector3,
        onSpawned: (giver: QuestGiverEntity) => void,
    ) {
        super();
        this.queueId = queueId;
        this.waypoints = waypoints;
        this.config = config;
        this.queuePosition = queuePosition;
        this.getPlayerPosition = getPlayerPosition;
        this.onSpawned = onSpawned;
        this.maxEntities = Math.max(1, config.maxEntities ?? DEFAULT_MAX_ENTITIES);
        this.queueSpacing = config.queueSpacing ?? DEFAULT_QUEUE_SPACING;
        this.spawnIntervalSec = config.spawnIntervalSec ?? DEFAULT_SPAWN_INTERVAL_SEC;
    }

    public override awake(): void {
        // See QueueStorage's own doc on `stoppedGiverCountById` — resumes that many givers
        // DIRECTLY at their resting spots (0, queueSpacing, 2*queueSpacing, ...) instead of
        // spawning just one and making everyone else walk the whole entry path over again. A
        // giver still mid-walk when the game last saved was never counted in the first place
        // (see QuestGiverEntity.isStoppedInLine()'s own doc) — nothing about restoring one is
        // worth the trouble, a fresh walk-in reads identically to a first-ever visit anyway.
        // Clamped to maxEntities in case a stale save remembers more than this queue's CURRENT
        // config actually allows (e.g. maxEntities was lowered since that save was written).
        const stoppedCount = Math.min(this.maxEntities, QueueStorage.getStoppedGiverCount(this.queueId));
        if (stoppedCount > 0) {
            for (let i = 0; i < stoppedCount; i++) {
                this.spawnOne(i * this.queueSpacing);
            }
        } else {
            this.spawnOne();
        }
    }

    public override update(delta: number): void {
        super.update(delta);

        // Despawn any giver that just finished walking its own exit path (see
        // QuestGiverEntity.isFinished()'s own doc — only ever true for a queue with negative-
        // order exit waypoints drawn; a queue without them reuses each giver forever and this is
        // always empty), and replace it IMMEDIATELY — not through the spawnIntervalSec timer
        // below, which is for the INITIAL ramp-up (ones spawn one after this queue first appears,
        // deliberately paced so a fresh queue doesn't pop its whole line in at once), not for
        // "someone just left, refill this slot." Stacking that same delay on TOP of the exit
        // walk's own travel time used to leave a maxEntities<=1 queue with ZERO present givers
        // (task fully undeliverable, panel hidden) for the exit walk PLUS up to spawnIntervalSec
        // more seconds PLUS the replacement's own walk back in — easily long enough to read as
        // "broken forever" rather than "briefly between givers," and a real regression against
        // this file's own promise that maxEntities<=1 stays identical to before exit waypoints
        // existed at all. Done BEFORE the spawn-timer check below so a freshly-vacated slot gets
        // counted the same frame it opens up, not one frame late (immediately topping it back up
        // here means that check below is a no-op the same frame, not a double-spawn).
        for (let i = this.givers.length - 1; i >= 0; i--) {
            const giver = this.givers[i];
            if (giver.isFinished()) {
                this.world!.remove(giver);
                this.givers.splice(i, 1);
                this.spawnOne();
            }
        }

        if (this.givers.length < this.maxEntities) {
            this.spawnTimerSec += delta;
            if (this.spawnTimerSec >= this.spawnIntervalSec) {
                this.spawnTimerSec = 0;
                this.spawnOne();
            }
        }

        this.rankGivers();

        // Persist how many of this group's own givers are currently stopped in line (see
        // QuestGiverEntity.isStoppedInLine()'s own doc / QueueStorage's own doc on
        // `stoppedGiverCountById`) — only when it actually changes, so this doesn't call
        // QueueStorage.setStoppedGiverCount() (and its own persist()) every single frame for no
        // reason.
        const stoppedCount = this.givers.filter(giver => giver.isStoppedInLine()).length;
        if (stoppedCount !== this.lastReportedStoppedCount) {
            this.lastReportedStoppedCount = stoppedCount;
            QueueStorage.setStoppedGiverCount(this.queueId, stoppedCount);
        }
    }

    /**
     * Whether the NEXT variant roll (see QuestGiverEntity.spawnVisual()'s own doc) should be
     * forced to the lowest-weight (rarest) one — true only for the very FIRST variant EVER
     * picked across this group's whole lifetime, consumed (flips permanently false) the instant
     * it's read. Tracked HERE, at the per-queue GROUP level, rather than per-giver-instance
     * (an earlier version did exactly that) — with givers now spawned/despawned/replaced rather
     * than one single instance reused forever, "this instance's own first pick" no longer means
     * anything: a fresh replacement instance would force-lowest all over again on ITS first
     * pick, and since a despawning giver (see QuestGiverEntity.exitPath's own doc) never lives
     * long enough for a SECOND pick of its own, every giver that ever appeared showed the exact
     * same variant, forever — the bug this fixes.
     */
    public consumeForceLowestWeightVariant(): boolean {
        if (this.hasPickedVariantBefore) {
            return false;
        }
        this.hasPickedVariantBefore = true;
        return true;
    }

    /** World-space Head position of whichever tracked giver currently has the queue's active task (see QuestGiverEntity.isPresentAtQueue()) — undefined while none does (no giver has arrived yet, or all of them are mid-walk). QueueZone reads this (via PizzaScene's own wiring) the same way it reads a single giver's own getNpcHeadWorldPosition() — see that method's own doc. */
    public getActiveHeadWorldPosition(target?: THREE.Vector3): THREE.Vector3 | undefined {
        for (const giver of this.givers) {
            if (giver.isPresentAtQueue()) {
                return giver.getNpcHeadWorldPosition(target);
            }
        }
        return undefined;
    }

    /** Plays the "happy" pose (see QuestGiverEntity.playHappyAnimation()'s own doc) on whichever tracked giver currently has the queue's active task — the exact same giver getActiveHeadWorldPosition() finds. A no-op if none does (shouldn't happen — QueueZone only calls this right as it detects a task was just delivered, which requires a present giver in the first place) or if that giver's current variant is a static `view` (nothing to animate). */
    public playHappyAnimationForActiveGiver(): void {
        for (const giver of this.givers) {
            if (giver.isPresentAtQueue()) {
                giver.playHappyAnimation();
                return;
            }
        }
    }

    /**
     * The smallest arc-length `giver` may currently occupy — 0 if `giver` isn't tracked
     * (shouldn't happen) or is currently the CLOSEST tracked giver to the queue (nothing ahead
     * of it to keep spacing from); otherwise `queueSpacing` past whichever OTHER tracked giver
     * is currently closer (smaller arc). See this file's own top doc for the full reasoning
     * (including why a single-giver group always returns 0, i.e. "walk all the way to the
     * queue," unconstrained).
     */
    public getMinAllowedArc(giver: QuestGiverEntity): number {
        const myArc = this.arcById.get(giver);
        if (myArc === undefined) {
            return 0;
        }

        let closestAheadArc: number | undefined;
        for (const [other, arc] of this.arcById) {
            if (other === giver || arc >= myArc) {
                continue;
            }
            if (closestAheadArc === undefined || arc > closestAheadArc) {
                closestAheadArc = arc;
            }
        }

        return closestAheadArc === undefined ? 0 : closestAheadArc + this.queueSpacing;
    }

    /** `resumeArc` undefined spawns normally at the far waypoint (the ramp-up/replacement case); a real number resumes directly at that arc-length position on the entry path — see awake()'s own doc and QuestGiverEntity's own `resumeArc` field doc (which also decides for itself whether an arc-0 resume should come back already `waitingForDelivery`, by checking QueueStorage directly). */
    private spawnOne(resumeArc?: number): void {
        // this.world is guaranteed set by the time awake()/update() ever run — see Entity.ts's
        // own doc ("World calls it [awake()] once, right after wiring entity.world").
        const giver = this.world!.add(new QuestGiverEntity(
            this.queueId, this.waypoints, this.config, this.queuePosition, this.getPlayerPosition, this, resumeArc,
        ));
        this.givers.push(giver);
        this.onSpawned(giver);
    }

    /**
     * Only ranks givers still heading IN (walking toward the queue or already parked waiting
     * there — see QuestGiverEntity.isHeadingIn()'s own doc) — a giver that's turned around to
     * walk back OUT is excluded entirely, so it can never be picked as `closestAheadArc` for
     * anyone in getMinAllowedArc(). Without this exclusion, a follower's own allowed arc stayed
     * pegged to the departing giver's own (still climbing, unconstrained) arc for as long as it
     * remained the numerically smaller one, dragging the follower back out toward the exit right
     * alongside it instead of letting it advance into the now-empty queue.
     */
    private rankGivers(): void {
        this.arcById.clear();
        for (const giver of this.givers) {
            if (giver.isHeadingIn()) {
                this.arcById.set(giver, giver.getCurrentArc());
            }
        }
    }
}
