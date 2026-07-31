// PizzaScene.ts
//
// Isolated player-movement test scene — just a player entity moving around
// on a plain flat plane, driven by the SAME keyboard/mobile input systems
// BoundlessWorld3dScene uses. Deliberately strips everything else out:
// - No world streaming/chunking (BoundlessChunkManager) — one static plane.
// - The floor itself is plain, flat, unbent geometry — no BendService
//   applied to it. BendService.updateOrigin() is still called every frame
//   below, though: PlayerEntity's own mesh material gets bent regardless
//   of this scene (CubeBuilder.buildPlayer applies it unconditionally), so
//   the origin still needs to track the player or its mesh sinks the
//   farther it wanders from BendService's default (0,0,0) origin.
// - No UI/HUD, no food/collectibles, no bots/NPCs, no shop skins.
// See BoundlessWorld3dScene.ts (the full game) for where all of that lives.

import { Game } from 'core/Game';
import AnalogInput from 'core/io/AnalogInput';
import KeyboardInputMovement from 'core/io/KeyboardInputMovement';
import PointerFollowInput from 'core/io/PointerFollowInput';
import { ThreeScene } from 'core/scene/ThreeScene';
import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { DEFAULT_START_VALUE } from '../ClogConstants';
import { PlayerEntity } from '../entities/PlayerEntity';
import { FloorBuilder } from '../builders/FloorBuilder';
import { BendService } from '../services/BendService';

/** World-units square — plenty of room to walk around in, no streaming needed. */
const FLOOR_SIZE = 200;

/** Fixed camera offset behind/above the player (world units) — no value-based zoom, just a simple follow. */
const CAMERA_OFFSET = new THREE.Vector3(0, 6, 8);
const CAMERA_FOLLOW_SPEED = 4;

/** Below this, an on-screen drag from the joystick's own center is ignored — same idea as BoundlessWorld3dScene's pointer-follow deadzone. */
const POINTER_FOLLOW_DEADZONE = 8;

export default class PizzaScene extends ThreeScene {
    private player!: PlayerEntity;

    private keyboardInput!: KeyboardInputMovement;
    private analogInput?: AnalogInput;
    private pointerFollowInput?: PointerFollowInput;
    /** True only while the pointer/finger is actually held down — PointerFollowInput.getPointerPosition() keeps returning the LAST known point even after release (nothing clears it on pointerup), so without this the player would keep chasing that stale point forever instead of stopping the instant it's released. */
    private pointerHeld = false;

    /** Written by whichever input controller is active; read once per frame in update(). */
    private readonly moveInput = { x: 0, z: 0 };

    public build(): void {
        this.threeScene.background = new THREE.Color(0x1a1a2e);

        this.threeScene.add(new THREE.AmbientLight(0xffffff, 0.8));
        const sun = new THREE.DirectionalLight(0xffffff, 0.6);
        sun.position.set(5, 10, 5);
        this.threeScene.add(sun);

        this.buildFloor();

        this.player = new PlayerEntity(DEFAULT_START_VALUE, this.threeScene);
        // Not on water here — the idle bob only reads right when floating.
        this.player.floatBobEnabled = false;

        this.positionCamera();
        this.setupInput();
    }

    /** Grid-textured plane (reusing FloorBuilder's own grid generator) so movement is actually visible against something, instead of a flat, featureless color. */
    private buildFloor(): void {
        const material = new THREE.MeshStandardMaterial({
            map: FloorBuilder.makeGridTexture(FLOOR_SIZE),
            roughness: 1,
        });
        const geometry = new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE);
        geometry.rotateX(-Math.PI / 2);

        const floor = new THREE.Mesh(geometry, material);
        this.threeScene.add(floor);
    }

    private positionCamera(): void {
        this.threeCamera.position.copy(this.player.position).add(CAMERA_OFFSET);
        this.threeCamera.lookAt(this.player.position);
    }

    /**
     * Keyboard always on; mobile gets an on-screen joystick, desktop
     * (non-mobile, no joystick) falls back to click-drag-to-chase-cursor —
     * same split BaseDemoScene uses for the full game.
     */
    private setupInput(): void {
        /*
         * Both AnalogInput and PointerFollowInput set eventMode = 'static'
         * on the container they're given, but a plain PIXI.Container (this
         * scene has no other PIXI children — it's THREE-rendered) has no
         * hitArea of its own, so it never actually receives pointer events
         * without one — same full-screen rectangle BaseDemoScene sets on
         * itself before constructing either.
         */
        this.eventMode = 'static';
        this.hitArea = new PIXI.Rectangle(-2000, -2000, 6000, 6000);

        this.keyboardInput = new KeyboardInputMovement();
        this.keyboardInput.onMove.add(({ direction, magnitude }: { direction: PIXI.Point; magnitude: number }) => {
            this.moveInput.x = direction.x * magnitude;
            this.moveInput.z = direction.y * magnitude;
        });

        if (PIXI.isMobile.any) {
            this.analogInput = new AnalogInput(this);
            this.analogInput.onMove.add(({ direction, magnitude }: { direction: PIXI.Point; magnitude: number }) => {
                this.moveInput.x = magnitude > 0 ? direction.x * magnitude : 0;
                this.moveInput.z = magnitude > 0 ? direction.y * magnitude : 0;
            });
        } else {
            this.pointerFollowInput = new PointerFollowInput(this);
            this.pointerFollowInput.onBoostChange.add(({ active }: { active: boolean }) => {
                this.pointerHeld = active;

                if (!active) {
                    this.moveInput.x = 0;
                    this.moveInput.z = 0;
                }
            });
        }
    }

    public override update(delta: number): void {
        if (this.pointerFollowInput && this.pointerHeld) {
            const pointer = this.pointerFollowInput.getPointerPosition();
            const anchor = pointer && this.worldToScreen(this.player.position);

            if (pointer && anchor) {
                const dx = pointer.x - anchor.x;
                const dy = pointer.y - anchor.y;
                const dist = Math.hypot(dx, dy);

                if (dist > POINTER_FOLLOW_DEADZONE) {
                    this.moveInput.x = dx / dist;
                    this.moveInput.z = dy / dist;
                } else {
                    this.moveInput.x = 0;
                    this.moveInput.z = 0;
                }
            }
        }

        this.player.setMoveInput(this.moveInput.x, this.moveInput.z);
        this.player.update(delta);

        /*
         * PlayerEntity's own mesh material is bent via BendService
         * regardless of this scene (see CubeBuilder.buildPlayer, called
         * unconditionally in the PlayerEntity constructor) — its shader
         * drops a vertex's rendered Y by (dx²+dz²) * uBendStrength, where
         * dx/dz are distance from BendService's shared uBendOrigin uniform.
         * Left at its default (0,0,0), the player sinks further "under" the
         * (flat, unbent) floor the farther it walks from spawn. Re-centering
         * the origin on the player every frame — same as BoundlessWorld3dScene
         * — keeps its own distance-from-origin at ~0, so it never sinks.
         */
        BendService.updateOrigin(this.player.position);

        const targetPosition = this.player.position.clone().add(CAMERA_OFFSET);
        this.threeCamera.position.lerp(targetPosition, 1 - Math.exp(-CAMERA_FOLLOW_SPEED * delta));
        this.threeCamera.lookAt(this.player.position);

        super.update(delta);
    }

    public override destroy(): void {
        this.keyboardInput?.destroy();
        this.analogInput?.destroy();
        this.pointerFollowInput?.destroy();
        this.player?.destroy();
        super.destroy();
    }
}
