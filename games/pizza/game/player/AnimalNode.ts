// AnimalNode.ts
//
// A catchable/followable animal — spawns WILD (ambling around whatever
// "spawner" AREA it was placed in — see ShapeResourceSpawner.ts's own doc
// on `spawnType: 'animal'` and WorldObjectRegistry.SpawnerShape), gets
// caught by a presence TIMER (AnimalCatchController.ts — see that file's
// own doc for the full mechanic and why it's a separate pipeline from
// PlayerActionController/AutoGatherController's hit-cycle), then becomes a
// FOLLOWER — it keeps existing, just switches from wandering its spawn
// shape to tagging along behind the player (startFollowing()/updateFollow()).
// It is NEVER banked to BackpackStorage and never despawns on a successful
// catch — see AnimalCatchController.completeCapture()'s own doc.
//
//   1. It MOVES, in EITHER mode (`mode`, see the field's own doc) — the
//      WILD loop (updateWander()/pickNewWanderTarget()) walks to a random
//      point inside its own wander shape, pauses, repeats; the FOLLOWING
//      loop (updateFollow()) runs the SAME idle-pause/wander-leg shape
//      around a single point that eases smoothly toward the player every
//      frame (`followAnchor`) — see FOLLOW_ANCHOR_SMOOTHING_RATE's own doc
//      for why there's no separate "catching up" gait at all: one
//      continuous loop reads as "an animal that's around me," where an
//      earlier slow-roam/fast-chase state switch read as rigidly attached
//      and binary instead (teleporting close instead if it ever ends up WAY
//      too far — see FOLLOW_TELEPORT_DISTANCE, a rare "genuinely stuck"
//      fallback, not part of ordinary following). Neither mode does any
//      pathfinding (just a
//      straight line each leg) and neither can ever get physically stuck on
//      the environment: this entity's own RigidBody is a TRIGGER, never
//      solid, so nothing in the world blocks its movement at all — the
//      teleport fallback exists purely for "fell too far behind," not for
//      "walked into a wall." Because PhysicsWorld's own trigger overlap
//      check reads each RigidBody's CURRENT position fresh every step()
//      (see PhysicsWorld.ts — isStatic only skips gravity/velocity
//      integration, never position reads), a wild animal wandering out of
//      range naturally fires the SAME onTriggerExit a player walking away
//      from a stationary tree would — AnimalCatchController cancels an
//      in-progress capture off that exact event, no special-case
//      chase/track logic needed.
//   2. It's JUICY in EITHER mode — see playAmbientAnimationFor(): a gentle
//      breathing scale loop while idle, a bouncy little hop while moving,
//      plus smoothed (not instant) turning every frame
//      (turnTowardSmoothed()). Driven purely by `wanderState` (idle/moving
//      — reused for BOTH modes, see that field's own doc), so every
//      AnimalType gets this for free with zero mode-specific animation code.
//   3. It shows its own capture PROGRESS while wild — showCaptureProgress()/
//      hideCaptureProgress() own a small persistent world-anchored bar above
//      its head, driven entirely by AnimalCatchController (this class has no
//      idea what a "requirement" or a capture timer even is — it just draws
//      whatever fraction it's told).
//
// Deliberately its OWN class, not a ResourceNode subclass — ResourceNode is
// keyed on ProviderType/PROVIDER_CONFIG (fixed nodes, tile-painted or map-
// authored, gathered via PlayerActionController's hit-cycle); an animal is
// keyed on AnimalType/ANIMAL_CONFIG instead and caught by the separate
// AnimalCatchController.ts.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import Entity from '../ecs/Entity';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import BoxVisualComponent from '../components/BoxVisualComponent';
import GlbVisualComponent from '../components/GlbVisualComponent';
import ScreenAnchorComponent, { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import CaptureZoneVisualComponent, { CaptureZoneState } from '../components/CaptureZoneVisualComponent';
import { ANIMAL_CONFIG, AnimalType } from '../actions/AnimalTypes';
import { resolveResourceAssetKey } from '../actions/ResourceRegistry';
import { ASSET_LIBRARY, AssetLibraryEntry, pickRandom, resolveRange } from '../world/AssetLibraryRegistry';
import { SpawnerShape, isPointInShape, sampleRandomPointInShape } from '../world/WorldObjectRegistry';
import { AnimalFollowStorage } from '../data/AnimalFollowStorage';
import { getItemIcon } from '../crafting/ItemTypes';
import { PERFORMANCE_CONFIG } from '../config/PerformanceConfig';
import ViewUtils from 'core/utils/ViewUtils';

/** Same gather-radius sizing ResourceNode.ts uses — an animal is "walked near," not "bumped into" (that's LooseResourceNode's much smaller pickup trigger instead). Used when an AnimalConfig doesn't set its own `triggerRadius` (see AnimalTypes.ts's own doc). */
const DEFAULT_TRIGGER_RADIUS = 1;
const PLACEHOLDER_HALF_EXTENTS = new THREE.Vector3(0.4, 0.4, 0.4);

/** Below this distance to its current wander target, AnimalNode considers itself "arrived" and switches back to idling — small enough that it doesn't visibly overshoot/oscillate at wanderSpeed's own per-frame step size. */
const ARRIVE_EPSILON = 0.15;
/** How many rejection-sampling attempts pickNewWanderTarget() gets for a polygon shape — mirrors ShapeResourceSpawner's own MAX_ATTEMPTS_PER_CHECK budget; failing entirely (only possible for a pathological polygon) just falls back to the shape's own center. */
const WANDER_SAMPLE_ATTEMPTS = 20;

/** How much taller (relative to baseScale) an idling animal's own "breathing" stretch reaches — see playAmbientAnimationFor()'s idle branch. */
const IDLE_BREATH_SCALE = 1.06;
const IDLE_BREATH_DURATION_SEC = 0.9;
/** World units a moving animal's little hop rises — see playAmbientAnimationFor()'s moving branch. */
const MOVE_HOP_HEIGHT = 0.14;
const MOVE_HOP_UP_SEC = 0.16;
const MOVE_HOP_DOWN_SEC = 0.14;
/** How fast (in "how much of the remaining angle gap closes per second") updateWander()'s facing smoothing turns — see turnTowardSmoothed()'s own doc. Higher = snappier/less floaty. */
const TURN_SMOOTHING_RATE = 10;

/**
 * Exponential-smoothing angular lerp, framerate-independent (see the `1 - exp(-rate*delta)`
 * term — a fixed LERP FACTOR per frame would turn slower on a low-framerate machine and faster
 * on a high one; this converges at the same real-world rate regardless). Wraps the raw
 * target-minus-current difference into (-PI, PI] first so a target just past the wraparound
 * point (e.g. current ~179°, target ~-179°) turns the SHORT way (2°), not almost all the way
 * around (358°).
 */
function turnTowardSmoothed(current: number, target: number, rate: number, delta: number): number {
    const twoPi = Math.PI * 2;
    let diff = (target - current) % twoPi;
    if (diff > Math.PI) {
        diff -= twoPi;
    } else if (diff < -Math.PI) {
        diff += twoPi;
    }
    return current + diff * (1 - Math.exp(-rate * delta));
}

/** World-space offset the capture-progress bar sits above this animal's own position — see showCaptureProgress(). */
const CAPTURE_BAR_OFFSET = new THREE.Vector3(0, 1.8, 0);
const CAPTURE_BAR_WIDTH = 40;
const CAPTURE_BAR_HEIGHT = 7;
const CAPTURE_BAR_BG_COLOR = 0x000000;
const CAPTURE_BAR_BG_ALPHA = 0.5;
const CAPTURE_BAR_FILL_COLOR = 0x33cc66;

/** Requirement-item icon (e.g. the rope a Pig needs) shown sitting on top of the capture bar — see showCaptureProgress(). Purely to associate WHAT the player needs with the bar filling up; only built at all when the animal actually has a requirementItem (see AnimalTypes.ts's own doc — some catches are bare-handed). */
const CAPTURE_BAR_ICON_SIZE = 20;
/** Vertical gap between the icon's own bottom edge and the bar's top edge. */
const CAPTURE_BAR_ICON_GAP = 3;

/** Same rising-popup shape as the resource-gain one, just a bare heart icon (no "+N" text) — see showCaughtPopup(). */
const HEART_POPUP_ICON = 'ItemIcon_Heart_Red-2';
const HEART_POPUP_BASE_OFFSET = new THREE.Vector3(0, 1.4, 0);
const HEART_POPUP_RISE = 1.4;
const HEART_POPUP_TTL_SEC = 1.1;
const HEART_POPUP_ICON_SIZE = 34;

/**
 * FOLLOWING-mode tuning — deliberately flat constants (not per-AnimalType config, see
 * AnimalTypes.ts's own doc — every animal follows the exact same way for now).
 *
 * A follower is NOT tethered to a fixed formation slot, and does NOT snap between a slow
 * "roam" gait and a fast "chase" gait either — an earlier version did exactly that (a hard
 * distance-threshold state switch) and it read as binary/unnatural: standing still, walking
 * off, hitting the threshold, sprinting over, stopping dead, repeat. Instead there's ONE
 * continuous loop (updateFollow()) built around a single idea: `followAnchor` is a point that
 * eases smoothly toward the player's own position every frame (never snapping to it, see
 * FOLLOW_ANCHOR_SMOOTHING_RATE) — think of it as "roughly where the player has been for the
 * last second or so," not "the player right now." The animal just runs its ordinary
 * idle-pause/wander-leg loop (same shape as wild updateWander()) around THAT point, always at
 * the same walking pace. A leg, once picked, always runs to completion — it's only ever
 * re-aimed at a fresh point near the anchor at the START of a new leg (from an idle pause —
 * see FOLLOW_RETARGET_DISTANCE), never interrupted mid-flight. An earlier version re-checked
 * (and re-rolled a brand new RANDOM target) every single frame while moving too, which against
 * a continuously-drifting anchor meant retargeting almost every frame — the wander target
 * flickering to a new random spot constantly instead of the animal ever committing to a leg,
 * which read as jitter. Letting each short leg (well under a second) finish is what makes the
 * motion read as a series of deliberate little walks instead of a twitchy scramble.
 */
/** How fast (in "how much of the remaining gap to the player closes per second") `followAnchor` eases toward the player's live position — LOWER trails further behind (reads as more independent), HIGHER tracks tighter (reads as more leashed). Framerate-independent, same `1 - exp(-rate*delta)` shape as turnTowardSmoothed(). */
const FOLLOW_ANCHOR_SMOOTHING_RATE = 1.6;
/** How far from `followAnchor` a roaming animal wanders — see pickNewRoamTarget(). */
const FOLLOW_ROAM_RADIUS = 2;
/** While IDLING (only — see this block's own top doc), if the animal's own position ends up farther than this from `followAnchor`, updateFollow() cuts the pause short and re-aims at a fresh point near the anchor right away instead of waiting out the rest of idleRemainingSec — this is what keeps a follower from getting left behind indefinitely if the player walks off while it happens to be paused. */
const FOLLOW_RETARGET_DISTANCE = 3;
/** World units/sec while following — a single constant pace for every leg (no separate "catching up" speed at all, see this constant's own top-of-block doc), a bit brisker than a wild animal's own default wanderSpeed so it doesn't read as sluggish. */
const FOLLOW_SPEED = 3;
/** Distance from the player beyond which updateFollow() gives up walking back and snaps straight to a spot near them instead — the "never get stuck" fallback (see this file's own top-of-file doc: nothing here can physically collide with the environment at all, so this is purely a "fell way behind" catch-all, e.g. after a long load hitch or a scene reload dropping the player somewhere new — ordinary following never needs this, it's a last resort). */
const FOLLOW_TELEPORT_DISTANCE = 14;

type WanderState = 'idle' | 'moving';
/** 'wild': wanders its own spawner shape, catchable — see the constructor's `wild` param. 'following': tags along behind the player — see startFollowing(). Every AnimalNode starts 'wild' UNLESS constructed without a `wild` param at all (see the constructor's own doc — that's the boot-time "reconstruct an already-owned follower" path PizzaScene uses, which skips the wild phase entirely). */
type AnimalMode = 'wild' | 'following';

/** Only present while `mode === 'wild'` — see AnimalNode's own `wild` constructor param. */
interface WildState {
    readonly shape: SpawnerShape;
    /** Notifies ShapeResourceSpawner that this instance's slot just freed up — called once, right when this stops being wild (a successful catch, see startFollowing()). Mirrors LooseResourceNode.onConsumed. */
    readonly onCaught: () => void;
}

export default class AnimalNode extends Entity {
    public readonly animalType: AnimalType;

    private rigidBody?: RigidBody;
    private visual!: BoxVisualComponent | GlbVisualComponent;
    private readonly screenHost?: ScreenAnchorHost;

    private mode: AnimalMode;
    /** Set only in 'wild' mode — see WildState's own doc. Cleared the instant startFollowing() runs. */
    private wild?: WildState;
    /** Set only in 'following' mode — see startFollowing(). A live getter (not a snapshot) so this always reads the player's CURRENT position, whichever frame it's called from. */
    private getPlayerPosition?: () => THREE.Vector3;
    /** Only meaningful in 'following' mode — the point the wander loop actually roams around, eased smoothly toward the player's own position every frame — see FOLLOW_ANCHOR_SMOOTHING_RATE's own doc for why this is a trailing point, not the player's own live position. Initialized in startFollowing(). */
    private readonly followAnchor = new THREE.Vector3();

    /** The throwaway entity backing the capture-progress bar (see showCaptureProgress()) — undefined whenever no capture is in progress. A fresh one is spawned per capture ATTEMPT rather than built once in awake(), since Entity has no removeComponent() (see this file's own doc) — despawning the whole entity is the only way to make it disappear between attempts. */
    private captureBarEntity?: Entity;
    private captureBarFill?: PIXI.Sprite;
    /** The floor ring tracing this animal's own catch trigger — built only in 'wild' mode (see awake()), hidden (never rebuilt) the instant startFollowing() runs. See setCaptureState() for what actually drives its color. */
    private captureZoneVisual?: CaptureZoneVisualComponent;

    /** 'idle'/'moving' — shared by BOTH wild wandering and player-following (see this file's own top-of-file doc point 2); only what COUNTS as "arrived" and what the movement target actually is differs between updateWander()/updateFollow(). */
    private wanderState: WanderState = 'idle';
    private readonly wanderTarget = new THREE.Vector3();
    private idleRemainingSec = 0;
    /**
     * The model's own "forward" correction, resolved ONCE from its AssetLibraryRegistry entry's
     * rotationDeg (see awake()) — NOT baked onto the visual's own child rotation the way a
     * static prop's rotationDeg normally is (see GlbVisualComponent.ts's own doc). A wandering
     * animal's facing is ENTIRELY driven every frame by updateWander()'s atan2() against its
     * travel direction, which assumes a model whose un-rotated forward is +Z; rotationDeg is
     * the fixed offset that corrects for whatever the actual authored model really faces (e.g.
     * 180 for a model exported facing -Z). Applying it on the CHILD mesh as well as here would
     * double it up (and a 180+180 offset cancels back out to facing backwards again — exactly
     * the bug this field exists to avoid), so GlbVisualComponent is constructed with rotationY=0
     * for an AnimalNode and this is the only place rotationDeg ever actually applies.
     */
    private modelForwardOffsetRad = 0;

    /** The picked model's own uniform scale (see awake()'s resolveRange(visualConfig.scale)) — captured once the mesh is actually ready (see beginAmbientAnimations()) so the idle-breathe/move-hop tweens below have a real baseline to stretch/squash relative TO, instead of hardcoding 1. */
    private baseScale = 1;
    /** The currently-running idle-breathe or move-hop loop, if the mesh is ready yet — see playAmbientAnimationFor(). Killed and replaced on every idle/moving transition, and killed outright before playDespawnOut()'s own scale-to-zero tween so the two never fight over mesh.scale. */
    private ambientTween?: gsap.core.Tween | gsap.core.Timeline;
    /** True once beginAmbientAnimations() has actually captured baseScale and is safe to (re)start tweens against — see that method's own doc for why this can't just check `this.visual instanceof GlbVisualComponent && this.visual.isReady` inline (a BoxVisualComponent fallback is "ready" immediately but still needs baseScale captured the same way). */
    private ambientAnimationsReady = false;

    /**
     * `wild` present (the normal path — see ShapeResourceSpawner.materialize()) spawns this
     * animal WANDERING and CATCHABLE, exactly as before. Omitted entirely is the boot-time
     * "reconstruct an already-owned follower" path (see PizzaScene's own follower-restore
     * setup, reading AnimalFollowStorage.getFollowers()) — that animal was already caught in a
     * PREVIOUS session, so it skips the wild phase and the caller is expected to call
     * startFollowing() immediately after construction instead.
     */
    public constructor(
        animalType: AnimalType,
        position: THREE.Vector3,
        screenHost?: ScreenAnchorHost,
        wild?: WildState,
    ) {
        super();
        this.animalType = animalType;
        this.screenHost = screenHost;
        this.wild = wild;
        this.mode = wild ? 'wild' : 'following';
        this.transform.position.copy(position);
        // Starts idle with a near-immediate pause — see update()'s own doc: the first update()
        // call rolls a real wander target right away, same "don't wait a full cycle to do the
        // obvious first thing" idiom DynamicResourceSpawner's own checkTimerSec=0 start uses.
        this.idleRemainingSec = 0;
    }

    /** Where this animal currently is — AnimalCatchController.ts's own FacingComponent.faceToward() call reads this LIVE (the same Vector3 reference, not a snapshot), so the player keeps turning to face it as it wanders mid-capture. */
    public get position(): THREE.Vector3 {
        return this.transform.position;
    }

    public override awake(): void {
        const config = ANIMAL_CONFIG[this.animalType];

        // Only a WILD animal needs a trigger — a follower is never "walked up to and caught"
        // again, so it has nothing to register with PhysicsWorld at all (see startFollowing(),
        // which unregisters this for an animal that WAS wild, and the boot-reconstruction path,
        // which never builds one in the first place).
        if (this.wild) {
            // See AnimalTypes.ts's own doc on `triggerRadius` — per-animal, defaults to
            // DEFAULT_TRIGGER_RADIUS when unset.
            const triggerRadius = config.triggerRadius ?? DEFAULT_TRIGGER_RADIUS;
            const triggerHalfExtents = new THREE.Vector3(triggerRadius, triggerRadius, triggerRadius);

            this.rigidBody = this.addComponent(new RigidBody({
                halfExtents: triggerHalfExtents,
                isStatic: true,
                isTrigger: true,
                // Deliberately the SAME layer ResourceNode's own trigger uses — AutoGatherController
                // already filters everything it sees down to `instanceof ResourceNode` (see that
                // file's own doc), so it silently ignores an AnimalNode overlap; AnimalCatchController
                // does the mirror filter the other way. Sharing the layer costs nothing and keeps
                // this on the same "things the player can walk up to and act on" physics channel.
                layer: Layers.Resource,
                centerOffset: new THREE.Vector3(0, triggerHalfExtents.y, 0),
            }));

            // Same radius as the trigger above — "standing in the ring" and "close enough to
            // capture" are the exact same area, on purpose (see CaptureZoneVisualComponent.ts's
            // own doc).
            this.captureZoneVisual = this.addComponent(new CaptureZoneVisualComponent(triggerHalfExtents.x));
        }

        const visualConfig: AssetLibraryEntry | undefined = ASSET_LIBRARY[resolveResourceAssetKey(config.resourceType)];
        if (!visualConfig) {
            console.warn(`[AnimalNode] no AssetLibraryRegistry entry for animal "${this.animalType}" yet — falling back to a placeholder box.`);
        }

        if (visualConfig) {
            // Resolved ONCE here (not re-rolled every frame) so a [min, max] range still picks
            // one consistent correction for this instance's whole lifetime — see
            // modelForwardOffsetRad's own doc for why this is the ONLY place it applies.
            this.modelForwardOffsetRad = resolveRange(visualConfig.rotationDeg) * (Math.PI / 180);
        }

        if (visualConfig && visualConfig.models.length > 0) {
            this.visual = this.addComponent(new GlbVisualComponent(
                pickRandom(visualConfig.models),
                new THREE.Vector3(),
                resolveRange(visualConfig.scale),
                0,
                // The glb loads async (see GlbVisualComponent.ts's own doc) — this.visual.mesh
                // isn't safe to read until this fires, so that's exactly when idle-breathe
                // starts (beginAmbientAnimations() itself no-ops if update() somehow already
                // moved this animal past idle by the time a slow load resolves — see that
                // method's own doc).
                () => this.beginAmbientAnimations(),
            ));
        } else {
            this.visual = this.addComponent(new BoxVisualComponent(
                PLACEHOLDER_HALF_EXTENTS.clone().multiplyScalar(2), 0xe8a1c4,
                new THREE.Vector3(0, PLACEHOLDER_HALF_EXTENTS.y, 0),
            ));
            // A BoxVisualComponent's mesh exists synchronously (no async load to wait on),
            // unlike the glb branch above.
            this.beginAmbientAnimations();
        }
    }

    /**
     * Captures baseScale off whatever the mesh's real scale turned out to be (its resolved
     * AssetLibraryRegistry scale for a glb, or the placeholder box's own fixed size) and kicks
     * off whichever of idle-breathe/move-hop already matches `wanderState` at this moment —
     * called once, the first instant the mesh is actually safe to animate (see awake()'s own
     * two call sites). Idempotent (checked via ambientAnimationsReady) since a GlbVisualComponent
     * only ever fires its onReady callback once anyway, but cheap to guard regardless.
     */
    private beginAmbientAnimations(): void {
        if (this.ambientAnimationsReady) {
            return;
        }
        this.ambientAnimationsReady = true;
        this.baseScale = this.visual.mesh.scale.x || 1;
        this.playAmbientAnimationFor(this.wanderState);
    }

    /**
     * Mirrors ResourceNode.playSpawnIn() — see that file's own doc. Kills+restarts the ambient
     * idle/move loop around the pop-in tween (same "both animate mesh.scale, don't let them
     * fight" reasoning as playDespawnOut()'s own kill) — ONLY actually reachable if the model
     * loaded fast enough to already be ready by the time this gets called (materialize() calls
     * this synchronously right after construction, before an async glb load can possibly have
     * resolved — see beginAmbientAnimations()'s own doc for the far more common "loads slower,
     * snaps in at full scale, ambient starts from there" path instead).
     */
    public playSpawnIn(durationSec: number = PERFORMANCE_CONFIG.resourcePopInSec): void {
        if (this.visual instanceof GlbVisualComponent && !this.visual.isReady) {
            return;
        }
        if (durationSec <= 0) {
            return;
        }
        const mesh = this.visual.mesh;
        this.ambientTween?.kill();
        const target = mesh.scale.clone();
        mesh.scale.set(0, 0, 0);
        gsap.to(mesh.scale, {
            x: target.x, y: target.y, z: target.z,
            duration: durationSec,
            ease: 'back.out(1.7)',
            onComplete: () => this.playAmbientAnimationFor(this.wanderState),
        });
    }

    public override update(delta: number): void {
        super.update(delta);

        if (this.mode === 'wild') {
            this.updateWander(delta);
        } else {
            this.updateFollow(delta);
        }
    }

    /**
     * Steps this animal toward `target` at `speed`, facing the direction of travel PLUS
     * modelForwardOffsetRad (see that field's own doc), smoothed rather than snapped
     * (turnTowardSmoothed()) — shared by wild wandering, follow-roaming, AND follow-catch-up,
     * the one piece of movement math all three actually need. Returns true once within
     * `arriveEpsilon` of `target` (arrived — caller decides what that means for it), false
     * while still en route.
     */
    private moveToward(target: THREE.Vector3, speed: number, delta: number, arriveEpsilon: number): boolean {
        const toTarget = target.clone().sub(this.transform.position);
        toTarget.y = 0;
        const distance = toTarget.length();
        if (distance <= arriveEpsilon) {
            return true;
        }

        const step = Math.min(distance, speed * delta);
        const direction = toTarget.normalize();
        this.transform.position.addScaledVector(direction, step);
        const targetRotation = Math.atan2(direction.x, direction.z) + this.modelForwardOffsetRad;
        this.transform.rotation.y = turnTowardSmoothed(this.transform.rotation.y, targetRotation, TURN_SMOOTHING_RATE, delta);
        return false;
    }

    /**
     * The whole WILD wander loop — see this file's own doc. 'idle': counts down a random pause,
     * then rolls a fresh target and switches to 'moving'. 'moving': steps toward the current
     * target (moveToward()) and switches back to 'idle' once arrived.
     */
    private updateWander(delta: number): void {
        const wild = this.wild;
        if (!wild) {
            return;
        }
        const config = ANIMAL_CONFIG[this.animalType];

        if (this.wanderState === 'idle') {
            this.idleRemainingSec -= delta;
            if (this.idleRemainingSec > 0) {
                return;
            }
            this.pickNewWanderTarget(wild.shape);
            this.wanderState = 'moving';
            this.playAmbientAnimationFor('moving');
            return;
        }

        if (this.moveToward(this.wanderTarget, config.wanderSpeed, delta, ARRIVE_EPSILON)) {
            this.wanderState = 'idle';
            const [minSec, maxSec] = config.wanderPauseRangeSec;
            this.idleRemainingSec = minSec + Math.random() * (maxSec - minSec);
            this.playAmbientAnimationFor('idle');
        }
    }

    /**
     * The whole FOLLOWING loop — ONE continuous idle-pause/wander-leg cycle (same shape as
     * wild updateWander()) around `followAnchor`, which itself eases smoothly toward the
     * player every frame — see this block's own top-of-file doc for why there's no separate
     * "catching up" gait at all anymore. Teleports straight to a spot near the player instead
     * of walking there once farther than FOLLOW_TELEPORT_DISTANCE (the rare "genuinely stuck"
     * fallback, not part of ordinary following).
     */
    private updateFollow(delta: number): void {
        const getPlayerPosition = this.getPlayerPosition;
        if (!getPlayerPosition) {
            return;
        }
        const playerPosition = getPlayerPosition();

        if (this.transform.position.distanceTo(playerPosition) > FOLLOW_TELEPORT_DISTANCE) {
            this.teleportNearPlayer(playerPosition);
            return;
        }

        const anchorT = 1 - Math.exp(-FOLLOW_ANCHOR_SMOOTHING_RATE * delta);
        this.followAnchor.lerp(playerPosition, anchorT);

        // Only ever re-evaluated against the anchor while IDLE, never mid-leg — a moving leg
        // is short (FOLLOW_ROAM_RADIUS / FOLLOW_SPEED, under a second) and always FINISHES at
        // whatever point it was aimed at when picked, on purpose: checking (and re-rolling a
        // brand new RANDOM point) every single frame while the anchor is continuously drifting
        // during normal walking used to retarget almost every frame, which reads as jitter —
        // the wander target flickering to a new random spot constantly rather than the animal
        // ever actually committing to a leg. Letting a leg run to completion, THEN re-aiming at
        // wherever the anchor ended up, is what makes the motion read as a series of deliberate
        // little walks instead of a twitchy scramble.
        if (this.wanderState === 'idle') {
            this.idleRemainingSec -= delta;
            const strayedWhileIdle = this.transform.position.distanceTo(this.followAnchor) > FOLLOW_RETARGET_DISTANCE;
            if (this.idleRemainingSec > 0 && !strayedWhileIdle) {
                return;
            }
            this.pickNewRoamTarget(this.followAnchor);
            this.wanderState = 'moving';
            this.playAmbientAnimationFor('moving');
            return;
        }

        if (this.moveToward(this.wanderTarget, FOLLOW_SPEED, delta, ARRIVE_EPSILON)) {
            this.wanderState = 'idle';
            const [minSec, maxSec] = ANIMAL_CONFIG[this.animalType].wanderPauseRangeSec;
            this.idleRemainingSec = minSec + Math.random() * (maxSec - minSec);
            this.playAmbientAnimationFor('idle');
        }
    }

    /** Rolls a fresh roam target within FOLLOW_ROAM_RADIUS of `center` (normally `followAnchor`) — a plain uniform point in a circle (sqrt(rand) so it isn't biased toward the center), no shape/polygon involved (unlike pickNewWanderTarget()) since roaming while following is always just a circle around a single point. */
    private pickNewRoamTarget(center: THREE.Vector3): void {
        const angle = Math.random() * Math.PI * 2;
        const radius = FOLLOW_ROAM_RADIUS * Math.sqrt(Math.random());
        this.wanderTarget.set(center.x + Math.cos(angle) * radius, this.transform.position.y, center.z + Math.sin(angle) * radius);
    }

    /** The "never get stuck" fallback — see FOLLOW_TELEPORT_DISTANCE's own doc. Lands at a random point around the player at the roam radius rather than exactly on top of them, re-anchors right there, and resets straight into an idle pause (whatever it was mid-doing before is irrelevant after a teleport). */
    private teleportNearPlayer(playerPosition: THREE.Vector3): void {
        const angle = Math.random() * Math.PI * 2;
        this.transform.position.set(
            playerPosition.x + Math.cos(angle) * FOLLOW_ROAM_RADIUS,
            this.transform.position.y,
            playerPosition.z + Math.sin(angle) * FOLLOW_ROAM_RADIUS,
        );
        this.followAnchor.copy(playerPosition);
        this.wanderState = 'idle';
        this.idleRemainingSec = 0;
    }

    /**
     * Swaps whichever idle-breathe/move-hop loop is currently running for the one matching
     * `state` — see baseScale/ambientTween's own doc. No-ops entirely (both when NOT yet ready,
     * see beginAmbientAnimations(), and while mid-catch, see the `caught` guard) rather than
     * queuing up for later; the next real transition (or beginAmbientAnimations() itself) calls
     * this again with whatever's current by then, so nothing gets permanently skipped.
     *
     * 'idle': a gentle vertical stretch-and-settle (breathing), yoyo-looped forever.
     * 'moving': a small hop (mesh.position.y up and back down) with a synced squash-on-liftoff/
     * stretch-on-landing scale timeline — the "little jumps with bounciness" this was asked
     * for — ending on a springy back.out settle back to baseScale each cycle rather than a
     * flat snap, so it reads as bouncy rather than mechanical.
     */
    private playAmbientAnimationFor(state: WanderState): void {
        if (!this.ambientAnimationsReady) {
            return;
        }
        const mesh = this.visual.mesh;

        this.ambientTween?.kill();
        mesh.position.y = 0;
        mesh.scale.setScalar(this.baseScale);

        if (state === 'idle') {
            this.ambientTween = gsap.to(mesh.scale, {
                y: this.baseScale * IDLE_BREATH_SCALE,
                duration: IDLE_BREATH_DURATION_SEC,
                ease: 'sine.inOut',
                yoyo: true,
                repeat: -1,
            });
            return;
        }

        this.ambientTween = gsap.timeline({ repeat: -1 })
            .to(mesh.position, { y: MOVE_HOP_HEIGHT, duration: MOVE_HOP_UP_SEC, ease: 'sine.out' }, 0)
            .to(mesh.scale, { y: this.baseScale * 1.15, x: this.baseScale * 0.88, z: this.baseScale * 0.88, duration: MOVE_HOP_UP_SEC, ease: 'sine.out' }, 0)
            .to(mesh.position, { y: 0, duration: MOVE_HOP_DOWN_SEC, ease: 'sine.in' })
            .to(mesh.scale, { y: this.baseScale * 0.85, x: this.baseScale * 1.12, z: this.baseScale * 1.12, duration: MOVE_HOP_DOWN_SEC * 0.5, ease: 'sine.out' }, '<')
            .to(mesh.scale, { x: this.baseScale, y: this.baseScale, z: this.baseScale, duration: MOVE_HOP_DOWN_SEC * 0.5, ease: 'back.out(2)' });
    }

    /** Rolls a fresh wander target inside `shape` — falls back to the shape's center on the (only-possible-for-a-pathological-polygon) sampling failure, and re-clamps via isPointInShape() so a circle/rect (which sampleRandomPointInShape() always succeeds for) never needs it, kept only as a defensive floor. */
    private pickNewWanderTarget(shape: SpawnerShape): void {
        const point = sampleRandomPointInShape(shape, WANDER_SAMPLE_ATTEMPTS) ?? shape.center;
        this.wanderTarget.set(point.x, this.transform.position.y, point.z);
    }

    /** Debug-only sanity check available to a future caller — true if this animal's OWN current position is still inside its wild wander shape. Always false once following (there's no shape to be "within" anymore). */
    public isWithinWanderShape(): boolean {
        return this.wild ? isPointInShape(this.wild.shape, this.transform.position.x, this.transform.position.z) : false;
    }

    /**
     * Called once by AnimalCatchController the instant its capture timer actually completes —
     * switches this animal from wild wandering to FOLLOWING the player (see this file's own
     * doc): unregisters the now-pointless wild-catch trigger (a follower is never caught
     * again), hides the capture bar, notifies `wild.onCaught` (frees the spawner's own slot for
     * this shape — same "the data survives, THIS particular instance's role here is done"
     * signal LooseResourceNode.onConsumed sends), clears `wild` entirely, and registers itself
     * with AnimalFollowStorage's live-node tracking (see that file's own doc on why). Does
     * NOT despawn or tween anything out — this is the opposite of markCaught()'s old
     * "leaves the world for good" behavior; the animal keeps existing, just under new management.
     */
    public startFollowing(getPlayerPosition: () => THREE.Vector3): void {
        // Guards against calling this TWICE on an already-following animal (e.g. a caller
        // re-triggering the same catch-complete path) — NOT the same thing as `mode ===
        // 'following'`, which the boot-reconstruction constructor path (no `wild` param, see
        // its own doc) already sets up-front before this ever runs; checking `mode` here used
        // to make THIS call a no-op for every reconstructed follower, leaving
        // getPlayerPosition unset and the animal permanently frozen after a reload.
        if (this.getPlayerPosition) {
            return;
        }

        this.hideCaptureProgress();
        if (this.rigidBody) {
            this.world?.physics.unregister(this.rigidBody);
            this.rigidBody = undefined;
        }
        this.captureZoneVisual?.setVisible(false);
        this.wild?.onCaught();
        this.wild = undefined;

        this.mode = 'following';
        this.followAnchor.copy(getPlayerPosition());
        this.getPlayerPosition = getPlayerPosition;
        AnimalFollowStorage.registerLiveNode(this);
    }

    /**
     * AnimalFollowStorage's own clearAll() calls this on every currently-live follower — a
     * plain, immediate removal (no despawn tween) since this only ever runs as part of a full
     * data reset, not a normal in-world event worth animating. Deliberately does NOT call
     * AnimalFollowStorage.unregisterLiveNode() itself — clearAll() already owns clearing its
     * whole live-node set right after calling this on each one; doing it here too would mutate
     * that same Set mid-iteration.
     */
    public releaseFollowing(): void {
        this.world?.remove(this);
    }

    /**
     * AnimalFollowStorage.deliverOneFollowerOfType()'s own departure trigger — called right
     * after this animal has ALREADY been dropped from both live-node tracking and the
     * persisted follower list (data mutates immediately, see that method's own doc), so this
     * is purely the cosmetic side: tween the visual out (same despawn playDespawnOut() already
     * uses elsewhere in this file), then actually leave the world. No onCaught-style
     * notification to fire — this animal isn't going back to being wild, it's just gone.
     */
    public deliver(): void {
        this.hideCaptureProgress();
        this.playDespawnOut(() => this.world?.remove(this));
    }

    /** Un-registers from AnimalFollowStorage's live-node tracking (see that file's own doc on why it needs to) — entity teardown isn't only ever releaseFollowing(); a scene rebuild/reload tears every entity down through the ordinary World/Entity lifecycle too. No-ops harmlessly for a wild animal that was never registered in the first place (Set.delete() on a missing entry is a no-op). */
    public override destroy(): void {
        AnimalFollowStorage.unregisterLiveNode(this);
        super.destroy();
    }

    /**
     * Shows (creating on first call, updating on every one after) a small world-anchored bar
     * above this animal's head, filled to `fraction` (0–1) — AnimalCatchController calls this
     * every frame a capture is actively in progress. A fresh throwaway entity backs it (see
     * captureBarEntity's own doc for why) rather than something built once in awake(), since
     * MOST animals never get captured at all — no sense paying for a bar that never shows.
     */
    public showCaptureProgress(fraction: number): void {
        if (!this.world || !this.screenHost) {
            return;
        }

        if (!this.captureBarEntity) {
            const bg = PIXI.Sprite.from(PIXI.Texture.WHITE);
            bg.tint = CAPTURE_BAR_BG_COLOR;
            bg.alpha = CAPTURE_BAR_BG_ALPHA;
            bg.anchor.set(0.5, 0.5);
            bg.width = CAPTURE_BAR_WIDTH;
            bg.height = CAPTURE_BAR_HEIGHT;

            const fill = PIXI.Sprite.from(PIXI.Texture.WHITE);
            fill.tint = CAPTURE_BAR_FILL_COLOR;
            fill.anchor.set(0, 0.5);
            fill.position.set(-CAPTURE_BAR_WIDTH / 2, 0);
            fill.height = CAPTURE_BAR_HEIGHT;
            this.captureBarFill = fill;

            const content = new PIXI.Container();
            content.addChild(bg, fill);

            // Sits on top of the bar so it's obvious WHAT the player's holding is being
            // credited toward — see this constant's own doc. No icon at all for a bare-handed
            // catch (requirementItem undefined).
            const requirementItem = ANIMAL_CONFIG[this.animalType].requirementItem;
            if (requirementItem !== undefined) {
                const requirementIcon = new PIXI.Sprite(getItemIcon(requirementItem));
                requirementIcon.anchor.set(0.5, 1);
                requirementIcon.width = CAPTURE_BAR_ICON_SIZE;
                requirementIcon.height = CAPTURE_BAR_ICON_SIZE;
                requirementIcon.position.set(0, -CAPTURE_BAR_HEIGHT / 2 - CAPTURE_BAR_ICON_GAP);
                content.addChild(requirementIcon);
            }

            this.captureBarEntity = this.world.spawn();
            this.captureBarEntity.addComponent(new ScreenAnchorComponent(
                this.screenHost,
                content,
                () => this.position.clone().add(CAPTURE_BAR_OFFSET),
            ));
        }

        if (this.captureBarFill) {
            this.captureBarFill.width = Math.max(0.0001, CAPTURE_BAR_WIDTH * Math.min(1, Math.max(0, fraction)));
        }
    }

    /** Despawns the capture-progress bar (if one's showing) — called both on a cancelled attempt and a completed one (AnimalCatchController/startFollowing()). No-ops if nothing's currently showing. */
    public hideCaptureProgress(): void {
        if (this.captureBarEntity && this.world) {
            this.world.despawn(this.captureBarEntity);
        }
        this.captureBarEntity = undefined;
        this.captureBarFill = undefined;
    }

    /** Called by AnimalCatchController's own onTriggerEnter/Exit — see CaptureZoneVisualComponent.ts's own doc for what each state means. No-ops harmlessly once this stops being wild (captureZoneVisual is undefined by then). */
    public setCaptureState(state: CaptureZoneState): void {
        this.captureZoneVisual?.setState(state);
    }

    /** Mirror of ResourceNode.playDespawnOut() — scales the visual down to nothing, then calls `onComplete`. Called by ShapeResourceSpawner's own out-of-range dematerialize for a still-WILD animal (same shape LooseResourceNode.playDespawnOut() offers its spawner) — a FOLLOWING animal never dematerializes this way (nothing streams it by distance once it's a follower). Kills the idle/move ambient loop FIRST — both animate mesh.scale, and a still-running one would otherwise fight this tween for control the instant it isn't the one that just started. */
    public playDespawnOut(onComplete: () => void, durationSec: number = PERFORMANCE_CONFIG.resourcePopOutSec): void {
        this.ambientTween?.kill();
        if (durationSec <= 0 || (this.visual instanceof GlbVisualComponent && !this.visual.isReady)) {
            onComplete();
            return;
        }
        gsap.to(this.visual.mesh.scale, { x: 0, y: 0, z: 0, duration: durationSec, ease: 'power2.in', onComplete });
    }

    /**
     * The instant-of-catch celebration — a bare heart icon rising and fading out, same
     * ScreenAnchorComponent-backed throwaway-popup shape ResourceNode.showResourceGainPopup()
     * uses for a provider harvest, just no "+N" text (this never banks anything to
     * BackpackStorage — see this file's own top-of-file doc). Called once by
     * AnimalCatchController right as a capture completes, before startFollowing() switches
     * this animal's own mode.
     */
    public showCaughtPopup(): void {
        if (!this.world || !this.screenHost) {
            return;
        }

        const icon = new PIXI.Sprite(PIXI.Texture.from(HEART_POPUP_ICON));
        icon.anchor.set(0.5, 0.5);
        icon.scale.set(ViewUtils.elementScaler(icon, HEART_POPUP_ICON_SIZE));

        const basePosition = this.position.clone().add(HEART_POPUP_BASE_OFFSET);
        const progress = { t: 0 };
        const risenPosition = new THREE.Vector3();

        const popupEntity = this.world.spawn();
        popupEntity.addComponent(new ScreenAnchorComponent(
            this.screenHost,
            icon,
            () => risenPosition.copy(basePosition).setY(basePosition.y + progress.t * HEART_POPUP_RISE),
            { ttlSec: HEART_POPUP_TTL_SEC },
        ));

        gsap.to(progress, {
            t: 1,
            duration: HEART_POPUP_TTL_SEC,
            ease: 'power2.out',
            onUpdate: () => {
                icon.alpha = 1 - progress.t;
            },
        });
    }
}
