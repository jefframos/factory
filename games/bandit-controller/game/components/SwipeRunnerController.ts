// SwipeRunnerController.ts
//
// A DIFFERENT runner controller from PlayerMovementController's own
// continuous pointer-follow runner mode — this one snaps the player to one
// of N discrete lanes: swipe left/right moves one lane over, swipe up
// jumps, swipe down plays the slide animation. Used by
// SwipeMinigameScene — a separate dedicated scene from
// RunnerMinigameScene, which uses PlayerMovementController's own
// pointer-follow runner mode instead (see index.ts/HubScene.ts for how the
// player gets routed to one or the other).
//
// Mutually exclusive with PlayerMovementController — SwipeMinigameScene
// disables that component and activate()s this one instead, in its own
// build(). Both would otherwise fight over the same RigidBody.velocity in
// the same fixedUpdate() tick.
//
// Starts disabled (see awake()) — activate() is what turns it on.

import * as THREE from 'three';
import Component from 'core/ecs/Component';
import RigidBody from 'core/physics/RigidBody';
import CharacterVisualComponent from './CharacterVisualComponent';
import { PLAYER_SETTINGS } from '../data/PlayerSettings';
import { laneOffset } from '../data/LaneMath';

const WORLD_UP = new THREE.Vector3(0, 1, 0);
/** Exponential ease rate a lane change eases the player's lateral offset at — snappier than PlayerMovementController's own pointer-follow LATERAL_FOLLOW_SPEED, since a lane change should read as a decisive hop rather than a slow drift. */
const LANE_FOLLOW_SPEED = 14;

type SwipeDirection = 'up' | 'down' | 'left' | 'right';
/** Minimum drag distance (CSS pixels) before a pointer up/down counts as a swipe rather than a tap. */
const SWIPE_THRESHOLD = 30;
/** WASD/arrow fallback for desktop testing without a mouse drag — matches the direction a real swipe in that direction would produce. */
const SWIPE_KEY_DIRECTIONS: Record<string, SwipeDirection> = {
    ArrowUp: 'up', KeyW: 'up',
    ArrowDown: 'down', KeyS: 'down',
    ArrowLeft: 'left', KeyA: 'left',
    ArrowRight: 'right', KeyD: 'right',
};

export default class SwipeRunnerController extends Component {
    private readonly getMoveSpeed: (sprinting: boolean) => number;

    private swipeStartX = 0;
    private swipeStartY = 0;
    /** True only once THIS instance has actually seen a pointerdown — guards against a stray pointerup left over from a drag/touch that started in a PREVIOUS scene (e.g. holding the analog stick while walking into this minigame's entry gate): without it, swipeStartX/Y would still be their (0,0) default, so that release would read as a huge, spurious swipe the instant this scene starts (see this file's own doc history — this was reported as "the minigame starts wrong"). */
    private pointerDownSeen = false;

    private readonly runnerForward = new THREE.Vector3(0, 0, -1);
    private readonly runnerRight = new THREE.Vector3(1, 0, 0);
    private laneCount = 1;
    private laneWidth = 0;
    private currentLaneIndex = 0;
    /** Current lateral offset (world units, along runnerRight) from wherever the player was standing when activate() was called — eased toward the current lane's own offset every fixedUpdate() tick. */
    private lateralOffset = 0;

    public constructor(getMoveSpeed: (sprinting: boolean) => number) {
        super();
        this.getMoveSpeed = getMoveSpeed;
    }

    public awake(): void {
        // Plain Pointer Events (not core/io/SwipeInputManager's own touchstart/touchend
        // handling, which reads .clientX directly off a native TouchEvent — TouchEvent has
        // no such property, only .touches[n].clientX, so real touch swipes never registered
        // there) — pointerdown/pointerup correctly unify mouse, touch and pen, each already
        // carrying .clientX/.clientY.
        window.addEventListener('pointerdown', this.onPointerDown);
        window.addEventListener('pointerup', this.onPointerUp);
        window.addEventListener('keydown', this.onKeyDown);
        // Off until a runner-lane trigger calls activate() — see this file's own doc.
        this.enabled = false;
    }

    private onPointerDown = (e: PointerEvent): void => {
        this.pointerDownSeen = true;
        this.swipeStartX = e.clientX;
        this.swipeStartY = e.clientY;
    };

    private onPointerUp = (e: PointerEvent): void => {
        if (!this.pointerDownSeen) {
            return;
        }
        this.pointerDownSeen = false;
        this.detectSwipe(e.clientX, e.clientY);
    };

    private onKeyDown = (e: KeyboardEvent): void => {
        // Walking toward this controller's own trigger gate means holding W/ArrowUp — the
        // SAME key this maps to a swipe-up jump. Without this guard, the OS's key-repeat
        // (an held key keeps firing 'keydown' with e.repeat=true) for that still-held key
        // lands right after activate() flips this component on, reading as a brand-new
        // swipe-up the instant runner mode starts — "jumping for no reason" on entry. Only a
        // genuine fresh press should count as a swipe.
        if (e.repeat) {
            return;
        }
        const direction = SWIPE_KEY_DIRECTIONS[e.code];
        if (direction) {
            this.onSwipe(direction);
        }
    };

    private detectSwipe(endX: number, endY: number): void {
        const dx = endX - this.swipeStartX;
        const dy = endY - this.swipeStartY;

        if (Math.abs(dx) > Math.abs(dy)) {
            if (Math.abs(dx) > SWIPE_THRESHOLD) {
                this.onSwipe(dx > 0 ? 'right' : 'left');
            }
        } else if (Math.abs(dy) > SWIPE_THRESHOLD) {
            this.onSwipe(dy > 0 ? 'down' : 'up');
        }
    }

    /**
     * Starts lane-runner movement along `worldDirection` (flattened/
     * normalized, same convention as PlayerMovementController.
     * enterRunnerMode()), with `laneCount` discrete lanes `laneWidth` world
     * units apart, centered on `laneOrigin` (the corridor's own fixed
     * middle-lane position in world space — e.g. SwipeMinigameScene's own
     * START_POSITION — the SAME point the visible lane rectangles are
     * drawn from). Snaps to whichever lane the player's CURRENT position is
     * actually closest to, not always the middle one — the trigger gate is
     * several units wide, so a player crossing it off-center would
     * otherwise start running along the edge of a lane instead of down its
     * middle (this component assumed dead-center entry before).
     */
    public activate(worldDirection: THREE.Vector3, laneCount: number, laneWidth: number, laneOrigin: THREE.Vector3): void {
        this.runnerForward.set(worldDirection.x, 0, worldDirection.z).normalize();
        this.runnerRight.crossVectors(this.runnerForward, WORLD_UP).normalize();
        this.laneCount = Math.max(1, laneCount);
        this.laneWidth = laneWidth;

        const position = this.entity.transform.position;
        const currentLateral = (position.x - laneOrigin.x) * this.runnerRight.x + (position.z - laneOrigin.z) * this.runnerRight.z;
        this.currentLaneIndex = this.nearestLaneIndex(currentLateral);
        this.lateralOffset = currentLateral;

        this.enabled = true;
    }

    /** Index of whichever lane's own offset (see LaneMath.laneOffset()) is closest to `lateral`. */
    private nearestLaneIndex(lateral: number): number {
        let bestIndex = 0;
        let bestDistance = Infinity;
        for (let i = 0; i < this.laneCount; i++) {
            const distance = Math.abs(laneOffset(i, this.laneCount, this.laneWidth) - lateral);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = i;
            }
        }
        return bestIndex;
    }

    /** Reverts control to whoever re-enables PlayerMovementController next — not actually called today (SwipeMinigameScene's own lifecycle just ends the whole scene instead), kept for symmetry with activate() and any future in-scene exit trigger. */
    public deactivate(): void {
        this.enabled = false;
    }

    private readonly onSwipe = (direction: SwipeDirection): void => {
        if (!this.enabled) {
            return;
        }

        switch (direction) {
            case 'left':
                this.currentLaneIndex = Math.max(0, this.currentLaneIndex - 1);
                break;
            case 'right':
                this.currentLaneIndex = Math.min(this.laneCount - 1, this.currentLaneIndex + 1);
                break;
            case 'up':
                this.tryJump();
                break;
            case 'down':
                this.entity.getComponent(CharacterVisualComponent)?.slide();
                break;
        }
    };

    private tryJump(): void {
        const rigidBody = this.entity.getComponent(RigidBody);
        if (!rigidBody?.grounded) {
            return;
        }
        rigidBody.velocity.y = PLAYER_SETTINGS.jumpSpeed;
        this.entity.getComponent(CharacterVisualComponent)?.character.jump();
    }

    public fixedUpdate(delta: number): void {
        const rigidBody = this.entity.getComponent(RigidBody);
        const visual = this.entity.getComponent(CharacterVisualComponent);
        const forwardSpeed = this.getMoveSpeed(true);

        const targetLateralOffset = laneOffset(this.currentLaneIndex, this.laneCount, this.laneWidth);
        const followT = 1 - Math.exp(-LANE_FOLLOW_SPEED * delta);
        const nextLateralOffset = this.lateralOffset + (targetLateralOffset - this.lateralOffset) * followT;
        const lateralSpeed = delta > 0 ? (nextLateralOffset - this.lateralOffset) / delta : 0;
        this.lateralOffset = nextLateralOffset;

        if (rigidBody) {
            rigidBody.velocity.x = this.runnerForward.x * forwardSpeed + this.runnerRight.x * lateralSpeed;
            rigidBody.velocity.z = this.runnerForward.z * forwardSpeed + this.runnerRight.z * lateralSpeed;
        }

        if (visual) {
            // World-space (not lane-local), same reasoning as PlayerMovementController's own
            // runner mode — CharacterBody's facing/animation read moveInput as world X/Z.
            const turnAmount = THREE.MathUtils.clamp(lateralSpeed / forwardSpeed, -1, 1);
            visual.moveInput.set(
                this.runnerForward.x + this.runnerRight.x * turnAmount,
                this.runnerForward.z + this.runnerRight.z * turnAmount,
            );
        }
    }

    /** Player shouldn't keep coasting on whatever velocity it had the instant this got deactivated. */
    public onDisable(): void {
        const rigidBody = this.entity.getComponent(RigidBody);
        if (rigidBody) {
            rigidBody.velocity.x = 0;
            rigidBody.velocity.z = 0;
        }
        this.entity.getComponent(CharacterVisualComponent)?.moveInput.set(0, 0);
    }

    public destroy(): void {
        window.removeEventListener('pointerdown', this.onPointerDown);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('keydown', this.onKeyDown);
    }
}
