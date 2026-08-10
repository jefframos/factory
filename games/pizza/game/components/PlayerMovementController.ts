// PlayerMovementController.ts
//
// Self-contained player-input-to-movement controller. Add it to an entity
// and it hooks its own input the instant it's attached (awake()) — the
// host scene doesn't read keyboard/pointer/joystick state, doesn't own an
// eventMode/hitArea, and doesn't write into any `moveInput` field itself.
// It reads both sibling components via entity.getComponent() (RigidBody for
// velocity, CharacterVisualComponent for animation sync) — that's the
// "components work together through their shared entity" contract the ECS
// is built around.
//
// To stop the player without tearing anything down (e.g. a cutscene, a
// menu, a death state), disable the component instead of removing it:
// `entity.getComponent(PlayerMovementController).enabled = false` — input
// keeps being recorded in the background, but fixedUpdate() (and therefore
// RigidBody.velocity) simply stops running while disabled (see
// Entity.update()/fixedUpdate()'s `enabled` check), and onDisable() zeroes
// the velocity immediately so the player doesn't keep coasting on
// whatever it was doing the instant it got disabled.
//
// Runs its movement logic in fixedUpdate(), not update() — it feeds
// RigidBody.velocity, and World.fixedUpdate() runs every entity's
// fixedUpdate() before stepping physics, so whatever velocity this sets is
// exactly what gets integrated that same tick. The one thing that DOES
// belong in update() is pointer-follow tracking (see update()'s own doc).

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import Component from '../ecs/Component';
import RigidBody from '../physics/RigidBody';
import CharacterVisualComponent from './CharacterVisualComponent';
import AnalogInput from 'core/io/AnalogInput';
import KeyboardInputMovement from 'core/io/KeyboardInputMovement';
import PointerFollowInput from 'core/io/PointerFollowInput';
import { isWalkable } from '../world/TileWalkability';

/** Below this, an on-screen drag from the joystick's own center — or the gap between the pointer and the player's on-screen anchor in desktop pointer-follow mode — is ignored. */
const POINTER_FOLLOW_DEADZONE = 8;

/**
 * Whatever the controller needs from its host scene to hook input: a Pixi
 * container to attach eventMode/hitArea/pointer listeners to, and a way to
 * project the player's 3D position to screen space for desktop pointer-
 * follow. Deliberately NOT `import type { ThreeScene }` — any scene with
 * this shape (every ThreeScene has one) satisfies it structurally, so this
 * component doesn't have to depend on the scenes folder.
 */
export interface MovementInputHost extends PIXI.Container {
    worldToScreen(position: THREE.Vector3): { x: number; y: number } | null;
}

export default class PlayerMovementController extends Component {
    private readonly moveInput = new THREE.Vector2(0, 0);
    private readonly getMoveSpeed: () => number;
    private readonly inputHost: MovementInputHost;

    private keyboardInput?: KeyboardInputMovement;
    private analogInput?: AnalogInput;
    private pointerFollowInput?: PointerFollowInput;
    /** True only while the pointer/finger is actually held down — PointerFollowInput.getPointerPosition() keeps returning the LAST known point even after release (nothing clears it on pointerup), so without this the player would keep chasing that stale point forever instead of stopping the instant it's released. */
    private pointerHeld = false;

    public constructor(getMoveSpeed: () => number, inputHost: MovementInputHost) {
        super();
        this.getMoveSpeed = getMoveSpeed;
        this.inputHost = inputHost;
    }

    /**
     * Keyboard always on; mobile gets an on-screen joystick, desktop
     * (non-mobile, no joystick) falls back to click-drag-to-chase-cursor —
     * same split BaseDemoScene uses for the full game, just owned here now
     * instead of by the scene.
     */
    public awake(): void {
        /*
         * Both AnalogInput and PointerFollowInput set eventMode = 'static'
         * on the container they're given, but a plain PIXI.Container (the
         * host scene has no other PIXI children — it's THREE-rendered) has
         * no hitArea of its own, so it never actually receives pointer
         * events without one — same full-screen rectangle BaseDemoScene
         * sets on itself before constructing either.
         */
        this.inputHost.eventMode = 'static';
        this.inputHost.hitArea = new PIXI.Rectangle(-2000, -2000, 6000, 6000);

        this.keyboardInput = new KeyboardInputMovement();
        this.keyboardInput.onMove.add(({ direction, magnitude }: { direction: PIXI.Point; magnitude: number }) => {
            this.moveInput.set(direction.x * magnitude, direction.y * magnitude);
        });

        //if (PIXI.isMobile.any) {
        this.analogInput = new AnalogInput(this.inputHost);
        this.analogInput.onMove.add(({ direction, magnitude }: { direction: PIXI.Point; magnitude: number }) => {
            this.moveInput.set(magnitude > 0 ? direction.x * magnitude : 0, magnitude > 0 ? direction.y * magnitude : 0);
        });
        // } else {
        //     this.pointerFollowInput = new PointerFollowInput(this.inputHost);
        //     this.pointerFollowInput.onBoostChange.add(({ active }: { active: boolean }) => {
        //         this.pointerHeld = active;
        //         if (!active) {
        //             this.moveInput.set(0, 0);
        //         }
        //     });
        // }
    }

    /**
     * Desktop pointer-follow needs the player's current ON-SCREEN position
     * to compare against the pointer — and that drifts under camera follow
     * independent of any pointer event, so it has to be recomputed every
     * render frame rather than only on pointer move. Everything else
     * (keyboard, mobile joystick) already writes straight into moveInput
     * from its own onMove signal and needs no per-frame work here.
     */
    public update(): void {
        if (!this.pointerFollowInput || !this.pointerHeld) {
            return;
        }

        const pointer = this.pointerFollowInput.getPointerPosition();
        const anchor = pointer && this.inputHost.worldToScreen(this.entity.transform.position);

        if (!pointer || !anchor) {
            return;
        }

        const dx = pointer.x - anchor.x;
        const dy = pointer.y - anchor.y;
        const dist = Math.hypot(dx, dy);

        if (dist > POINTER_FOLLOW_DEADZONE) {
            this.moveInput.set(dx / dist, dy / dist);
        } else {
            this.moveInput.set(0, 0);
        }
    }

    public fixedUpdate(delta: number): void {
        const rigidBody = this.entity.getComponent(RigidBody);
        const visual = this.entity.getComponent(CharacterVisualComponent);

        if (rigidBody) {
            const speed = this.getMoveSpeed();
            let velocityX = this.moveInput.x * speed;
            let velocityZ = this.moveInput.y * speed;

            // Tile-map walkability (e.g. water/lava) is entirely optional — see
            // TileWalkability.ts's own doc — isWalkable() is a no-op (always true) unless
            // some TileMap has published a query, so this never affects a game with no tile
            // map. Checked per axis, each against the CURRENT position on the other axis,
            // so walking diagonally into a wall of non-walkable tiles slides along it
            // instead of stopping dead — same axis-independent resolution RigidBody's own
            // push-out uses.
            const position = this.entity.transform.position;
            if (velocityX !== 0 && !isWalkable(position.x + velocityX * delta, position.z)) {
                velocityX = 0;
            }
            if (velocityZ !== 0 && !isWalkable(position.x, position.z + velocityZ * delta)) {
                velocityZ = 0;
            }

            rigidBody.velocity.x = velocityX;
            rigidBody.velocity.z = velocityZ;
        }

        visual?.moveInput.copy(this.moveInput);
    }

    /** Player shouldn't keep coasting on whatever velocity it had the instant this got disabled (see class doc) — zero it immediately rather than waiting for the next enabled fixedUpdate(). */
    public onDisable(): void {
        const rigidBody = this.entity.getComponent(RigidBody);
        if (rigidBody) {
            rigidBody.velocity.x = 0;
            rigidBody.velocity.z = 0;
        }
        this.entity.getComponent(CharacterVisualComponent)?.moveInput.set(0, 0);
    }

    public destroy(): void {
        this.keyboardInput?.destroy();
        this.analogInput?.destroy();
        this.pointerFollowInput?.destroy();
    }
}
