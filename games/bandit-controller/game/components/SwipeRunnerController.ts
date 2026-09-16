// SwipeRunnerController.ts
//
// A DIFFERENT runner controller from PlayerMovementController's own
// continuous pointer-follow runner mode — this one snaps the player to one
// of N discrete lanes: swipe left/right moves one lane over, swipe up
// jumps, swipe down plays the slide animation. Used by the second
// (swipe-lane) pair of runner triggers in ControllerScene, parallel to the
// original (pointer-follow) pair.
//
// Mutually exclusive with PlayerMovementController — ControllerScene
// disables that component and activate()s this one when the player enters
// the swipe-lane trigger, and reverses it on the exit trigger. Both would
// otherwise fight over the same RigidBody.velocity in the same
// fixedUpdate() tick.
//
// Starts disabled (see awake()) — activate() is what turns it on.

import * as THREE from 'three';
import Component from '../ecs/Component';
import RigidBody from '../physics/RigidBody';
import CharacterVisualComponent from './CharacterVisualComponent';
import { JUMP_SPEED } from '../data/PlayerConstants';
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
        this.swipeStartX = e.clientX;
        this.swipeStartY = e.clientY;
    };

    private onPointerUp = (e: PointerEvent): void => {
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
     * units apart. Starts centered on the middle lane, with wherever the
     * player is standing right now as that lane's own position — an odd
     * `laneCount` means the middle lane's offset is exactly 0, so there's no
     * snap on activation.
     */
    public activate(worldDirection: THREE.Vector3, laneCount: number, laneWidth: number): void {
        this.runnerForward.set(worldDirection.x, 0, worldDirection.z).normalize();
        this.runnerRight.crossVectors(this.runnerForward, WORLD_UP).normalize();
        this.laneCount = Math.max(1, laneCount);
        this.laneWidth = laneWidth;
        this.currentLaneIndex = Math.floor(this.laneCount / 2);
        this.lateralOffset = 0;
        this.enabled = true;
    }

    /** Reverts control to whoever re-enables PlayerMovementController next — see ControllerScene's exit trigger. */
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
        rigidBody.velocity.y = JUMP_SPEED;
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
