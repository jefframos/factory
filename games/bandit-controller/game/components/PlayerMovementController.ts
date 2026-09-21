// PlayerMovementController.ts
//
// Self-contained player-input-to-movement controller. Add it to an entity
// and it hooks its own input the instant it's attached (awake()) — the
// host scene doesn't read keyboard/pointer/joystick state itself. It reads
// both sibling components via entity.getComponent() (RigidBody for
// velocity, CharacterVisualComponent for animation sync).
//
// Controls: WASD/arrows to move, hold Shift to run, Space to jump (only
// while grounded), Ctrl to dodge/roll.
//
// Also has a "runner mode" (see enterRunnerMode()/exitRunnerMode()) — a
// subway-surfers-style state where forward movement is automatic along a
// fixed world direction and sideways control switches from the free mode's
// digital/analog steering to POSITION-matching: the player's lateral offset
// across the lane eases toward wherever the pointer/finger currently is on
// screen (tracked continuously via a plain window pointermove listener, no
// click/tap needed first), left edge to right edge mapping onto the full
// lane width. A scene triggers runner mode externally (see
// RunnerMinigameScene.build(), the only caller); this component doesn't
// know anything about scenes/triggers itself.
//
// Runs its movement logic in fixedUpdate() — it feeds RigidBody.velocity,
// and World.fixedUpdate() runs every entity's fixedUpdate() before stepping
// physics, so whatever velocity this sets is exactly what gets integrated
// that same tick.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import Component from 'core/ecs/Component';
import RigidBody from 'core/physics/RigidBody';
import CharacterVisualComponent from './CharacterVisualComponent';
import AnalogInput from 'core/io/AnalogInput';
import KeyboardInputMovement from 'core/io/KeyboardInputMovement';
import { PLAYER_SETTINGS } from '../data/PlayerSettings';

/**
 * Keyboard input is always magnitude 0 or 1 (see KeyboardInputMovement), so
 * without a sprint key every keyboard move would immediately cross
 * CharacterBody's walkToRunSpeed threshold and always read as "run." This is
 * the animation-only magnitude used while NOT sprinting, kept between
 * idleToWalkSpeed and walkToRunSpeed so it reads as "walk."
 */
const WALK_ANIM_MAGNITUDE = 0.4;
/** Mobile analog stick: pushed past this fraction of its own radius counts as "running," same as holding Shift on keyboard — see analogMagnitude's own doc for why this only reads the joystick, never keyboard's own (always-0-or-1) magnitude. */
const ANALOG_RUN_THRESHOLD = 0.5;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
/** Runner-mode lane half-width, world units — pointer at the left/right edge of the screen maps to -/+ this far from wherever the player was standing when enterRunnerMode() was called. */
const LANE_HALF_WIDTH = 3.5;
/** Exponential ease rate the player's lateral offset chases the pointer's mapped target at — higher = snaps to the finger faster, lower = smoother/laggier tracking. */
const LATERAL_FOLLOW_SPEED = 10;

/** Whatever the controller needs from its host scene to hook input. */
export interface MovementInputHost extends PIXI.Container {
    worldToScreen(position: THREE.Vector3): { x: number; y: number } | null;
}

export default class PlayerMovementController extends Component {
    private readonly moveInput = new THREE.Vector2(0, 0);
    private readonly getMoveSpeed: (sprinting: boolean) => number;
    private readonly inputHost: MovementInputHost;

    private keyboardInput?: KeyboardInputMovement;
    private analogInput?: AnalogInput;
    private sprintHeld = false;
    /** The analog stick's own normalized magnitude (0-1, see AnalogInput's onMove) — tracked separately from moveInput.length() because keyboard input is always exactly 0 or 1 (see WALK_ANIM_MAGNITUDE's own doc) and would otherwise always read as "past the run threshold." Reset to 0 when the stick is released or this controller is disabled. */
    private analogMagnitude = 0;

    /** Latest raw pointer/touch screen X (CSS pixels) — updated continuously by a plain window listener (see awake()), read only while in runner mode (see updateRunnerMovement()). Null until the pointer/finger has moved at least once. */
    private pointerScreenX: number | null = null;

    /** True while in "runner mode" — see enterRunnerMode(). */
    private runnerMode = false;
    /** World-space, Y-flattened, unit forward/right for the current runner lane — set once on enterRunnerMode(), read every runner fixedUpdate() tick. */
    private readonly runnerForward = new THREE.Vector3(0, 0, -1);
    private readonly runnerRight = new THREE.Vector3(1, 0, 0);
    /** Current lateral offset (world units, along runnerRight) from wherever the player was standing when enterRunnerMode() was called — eased toward the pointer-mapped target every runner fixedUpdate() tick, see updateRunnerMovement(). */
    private lateralOffset = 0;

    public constructor(getMoveSpeed: (sprinting: boolean) => number, inputHost: MovementInputHost) {
        super();
        this.getMoveSpeed = getMoveSpeed;
        this.inputHost = inputHost;
    }

    public awake(): void {
        this.inputHost.eventMode = 'static';
        this.inputHost.hitArea = new PIXI.Rectangle(-2000, -2000, 6000, 6000);

        this.keyboardInput = new KeyboardInputMovement();
        this.keyboardInput.onMove.add(({ direction, magnitude }: { direction: PIXI.Point; magnitude: number }) => {
            this.moveInput.set(direction.x * magnitude, direction.y * magnitude);
        });

        this.analogInput = new AnalogInput(this.inputHost);
        this.analogInput.onMove.add(({ direction, magnitude }: { direction: PIXI.Point; magnitude: number }) => {
            this.analogMagnitude = magnitude;
            this.moveInput.set(magnitude > 0 ? direction.x * magnitude : 0, magnitude > 0 ? direction.y * magnitude : 0);
        });

        // Only consulted while in runner mode (see updateRunnerMovement()) — free mode keeps
        // using the digital/analog steering above. A plain window listener (not gated behind
        // a click/tap the way core/io/PointerFollowInput deliberately is, to dodge a stale-
        // hover replay bug that doesn't apply here) so steering responds to the very first
        // mouse/finger movement, before the player has clicked anything.
        window.addEventListener('pointermove', this.onPointerMove);

        window.addEventListener('keydown', this.onKeyDown);
        window.addEventListener('keyup', this.onKeyUp);
    }

    private onKeyDown = (e: KeyboardEvent): void => {
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
            this.sprintHeld = true;
            return;
        }
        // Jump/dodge are one-shot actions — without this, the OS's key-repeat for a held
        // Space/Ctrl would keep re-firing tryJump()/dodge() every repeat interval.
        if (e.repeat) {
            return;
        }
        if (e.code === 'Space') {
            this.tryJump();
        } else if (e.code === 'ControlLeft' || e.code === 'ControlRight') {
            this.entity.getComponent(CharacterVisualComponent)?.dodge();
        }
    };

    private onKeyUp = (e: KeyboardEvent): void => {
        if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
            this.sprintHeld = false;
        }
    };

    private onPointerMove = (e: PointerEvent): void => {
        this.pointerScreenX = e.clientX;
    };

    /**
     * Switches to "runner mode": forward movement becomes automatic along
     * `worldDirection` (constant, always at running pace) and sideways
     * control switches to pointer/finger position-matching (see class doc
     * and updateRunnerMovement()) — the free mode's own WASD/analog joystick
     * is disabled for the duration so it can't fight that. `worldDirection`
     * need only be roughly horizontal; it's flattened (Y zeroed) and
     * normalized here. Starts the lateral offset at 0 (i.e. wherever the
     * player happens to be standing right now becomes the lane's center).
     */
    public enterRunnerMode(worldDirection: THREE.Vector3): void {
        this.runnerMode = true;
        this.runnerForward.set(worldDirection.x, 0, worldDirection.z).normalize();
        this.runnerRight.crossVectors(this.runnerForward, WORLD_UP).normalize();
        this.lateralOffset = 0;
        this.analogInput?.setEnabled(false);
    }

    /** Reverts to normal free WASD/analog movement. */
    public exitRunnerMode(): void {
        this.runnerMode = false;
        this.analogInput?.setEnabled(true);
    }

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

        if (this.runnerMode) {
            this.updateRunnerMovement(rigidBody, visual, delta);
            return;
        }

        const sprinting = this.sprintHeld || this.analogMagnitude > ANALOG_RUN_THRESHOLD;

        if (rigidBody) {
            const speed = this.getMoveSpeed(sprinting);
            rigidBody.velocity.x = this.moveInput.x * speed;
            rigidBody.velocity.z = this.moveInput.y * speed;
        }

        if (visual) {
            const magnitude = this.moveInput.length();
            if (magnitude < 1e-4) {
                visual.moveInput.set(0, 0);
            } else {
                const animMagnitude = sprinting ? 1 : Math.min(magnitude, WALK_ANIM_MAGNITUDE);
                visual.moveInput.set(
                    (this.moveInput.x / magnitude) * animMagnitude,
                    (this.moveInput.y / magnitude) * animMagnitude,
                );
            }
        }
    }

    /**
     * Runner-mode movement: constant forward speed along runnerForward, plus
     * sideways movement that EASES the player's lateralOffset toward
     * wherever the pointer/finger currently is on screen — left edge of the
     * window maps to -LANE_HALF_WIDTH, right edge to +LANE_HALF_WIDTH,
     * center to 0 (see class doc) — rather than reading a held direction
     * like free mode's WASD/analog input does. Before the pointer/finger has
     * moved at all, the target is just wherever the player already is, so
     * nothing drifts on its own.
     */
    private updateRunnerMovement(rigidBody: RigidBody | undefined, visual: CharacterVisualComponent | undefined, delta: number): void {
        const forwardSpeed = this.getMoveSpeed(true);

        const targetLateralOffset = this.pointerScreenX !== null
            ? ((this.pointerScreenX / window.innerWidth) * 2 - 1) * LANE_HALF_WIDTH
            : this.lateralOffset;

        const followT = 1 - Math.exp(-LATERAL_FOLLOW_SPEED * delta);
        const nextLateralOffset = this.lateralOffset + (targetLateralOffset - this.lateralOffset) * followT;
        const lateralSpeed = delta > 0 ? (nextLateralOffset - this.lateralOffset) / delta : 0;
        this.lateralOffset = nextLateralOffset;

        if (rigidBody) {
            rigidBody.velocity.x = this.runnerForward.x * forwardSpeed + this.runnerRight.x * lateralSpeed;
            rigidBody.velocity.z = this.runnerForward.z * forwardSpeed + this.runnerRight.z * lateralSpeed;
        }

        if (visual) {
            // World-space (not lane-local) so CharacterBody's facing/animation — which reads
            // moveInput as world X/Z directly — turns to face the lane's own forward, not
            // whatever the player's raw WASD axes happen to mean. Always well above the
            // walkToRunSpeed threshold, so the run animation plays continuously. The turn
            // amount is clamped so a big, sudden pointer jump doesn't spin the character
            // sideways harder than it would ever actually need to lean.
            const turnAmount = THREE.MathUtils.clamp(lateralSpeed / forwardSpeed, -1, 1);
            visual.moveInput.set(
                this.runnerForward.x + this.runnerRight.x * turnAmount,
                this.runnerForward.z + this.runnerRight.z * turnAmount,
            );
        }
    }

    /**
     * Player shouldn't keep coasting on whatever velocity it had the instant
     * this got disabled — also hides the on-screen joystick. SwipeMinigameScene
     * disables this whole component (rather than just switching its internal
     * runnerMode) so SwipeRunnerController can own movement instead, without
     * both fighting over the same RigidBody.velocity in the same tick.
     */
    public onDisable(): void {
        const rigidBody = this.entity.getComponent(RigidBody);
        if (rigidBody) {
            rigidBody.velocity.x = 0;
            rigidBody.velocity.z = 0;
        }
        this.entity.getComponent(CharacterVisualComponent)?.moveInput.set(0, 0);
        this.sprintHeld = false;
        this.analogMagnitude = 0;
        this.analogInput?.setEnabled(false);
    }

    /** Counterpart to onDisable() — brings the joystick back once this component is handed movement again. */
    public onEnable(): void {
        this.analogInput?.setEnabled(true);
    }

    public destroy(): void {
        this.keyboardInput?.destroy();
        this.analogInput?.destroy();
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('keydown', this.onKeyDown);
        window.removeEventListener('keyup', this.onKeyUp);
    }
}
