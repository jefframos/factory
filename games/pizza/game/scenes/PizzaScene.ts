// PizzaScene.ts
//
// Isolated player-movement test scene — just a player moving around on a
// plain flat plane, driven by the SAME keyboard/mobile input systems
// BoundlessWorld3dScene uses. Deliberately strips everything else out:
// - No world streaming/chunking (BoundlessChunkManager) — one static plane.
// - The floor, the character/NPC body materials, and all head cubes are all
//   hooked to BendService.applyBend() — same shared uBendOrigin/uBendStrength
//   uniforms as the full game, kept centered on the player every frame via
//   updateOrigin() below. Everything stays wired up; BendService.setEnabled()
//   is the one place to turn the bend off/on for the whole scene at once.
// - No UI/HUD, no food/collectibles, no shop skins.
// See BoundlessWorld3dScene.ts (the full game) for where all of that lives.
//
// The cube-based PlayerEntity is commented out for now (not deleted) — the
// scene only actually "starts" (movement/camera/input take effect) once
// ThirdPersonCharacter finishes its async load, so PlayerEntity's own cube
// visual would otherwise show/move for a moment first with nothing to
// replace it. Position is tracked directly here (playerPosition) instead,
// using the same plain speed*delta math PlayerEntity itself uses.

import AnalogInput from 'core/io/AnalogInput';
import KeyboardInputMovement from 'core/io/KeyboardInputMovement';
import PointerFollowInput from 'core/io/PointerFollowInput';
import { ThreeScene } from 'core/scene/ThreeScene';
import * as PIXI from 'pixi.js';
import * as THREE from 'three';
// import { DEFAULT_START_VALUE } from '../ClogConstants';
// import { PlayerEntity } from '../entities/PlayerEntity';
import { FloorBuilder } from '../builders/FloorBuilder';
import { BendService } from '../services/BendService';
import ThirdPersonCharacter from '../entities/ThirdPersonCharacter';
import CharacterBody from '../entities/CharacterBody';
import MODELS from '../../registry/assetsRegistry/modelsRegistry';
import { Game } from 'core/Game';
import { LoadingSpinner } from '../dom-ui/LoadingSpinner';

/** Cube color/value the head-cube test used — kept only as a comment reference now that PlayerEntity (and its DEFAULT_START_VALUE-driven color) is commented out. Pass whatever value you want ThirdPersonCharacter.applyColor() to use directly. */
const HEAD_CUBE_VALUE = 2;

/** Flat tone applied to the enemy test NPCs (see setupNpcs()) — a plain, saturated red to visually mark them as hostile, distinct from the player's value-palette color. */
const ENEMY_COLOR = 0xaa1111;

/** World-space spawn spots for the idle enemy test NPCs — just far enough from player spawn (0,0,0) to be visible without overlapping it. */
const NPC_SPAWN_POSITIONS: Array<[number, number, number]> = [
    [6, 0, 4],
    [-6, 0, 7],
];

/** Model-registry entries only carry a repo-relative fullPath (e.g. "pizza/models/..."); served at runtime from /pizza/... (see public/pizza/models). */
const modelUrl = (fullPath: string): string => `/${fullPath}`;

/** FBX export scale for this character rig — same value the source project used. */
const CHARACTER_SCALE = 0.0075;

/** World-units square — plenty of room to walk around in, no streaming needed. */
const FLOOR_SIZE = 200;
/** BendService's shader only displaces vertices, not fragments — a default 1x1-segment PlaneGeometry has just 4 corner vertices, so bending it warps it into a twisted quad instead of curving smoothly. This gives it enough subdivision to actually curve. */
const FLOOR_SEGMENTS = 100;

/**
 * Camera settings data — a spherical orbit around the player instead of a
 * fixed offset vector, so each axis is independently tunable:
 *  - yawDeg: rotation around the player (0 = camera behind, looking
 *    toward -Z; positive turns it clockwise viewed from above).
 *  - pitchDeg: tilt up/down (0 = level with the player, 90 = straight
 *    overhead).
 * distance is no longer fixed — see cameraOffset(), which derives it every
 * frame from PLAY_HALF_W/H so the same play area stays framed regardless of
 * viewport aspect ratio (narrow phones vs. wide desktops).
 */
const CAMERA_SETTINGS = {
    yawDeg: 0,
    pitchDeg: 35,
    distance: 10,
    followSpeed: 4,
};

/** The game's own design resolution (see Game.DESIGN_WIDTH/HEIGHT) is the aspect ratio CAMERA_SETTINGS.distance was tuned against. Anything taller/narrower than that zooms out to show more; landscape/wider viewports keep the original distance untouched. */
const REFERENCE_ASPECT = Game.DESIGN_WIDTH / Game.DESIGN_HEIGHT;

/**
 * Converts CAMERA_SETTINGS' yaw/pitch/distance into a world-space offset
 * from the player. Distance stays fixed at CAMERA_SETTINGS.distance for
 * aspect ratios at or wider than the design resolution's, and only scales
 * up (zooms out) as the viewport gets taller/narrower than that — so a
 * normal resize doesn't constantly re-zoom, only a genuinely taller aspect
 * than what the game was designed for does.
 */
function cameraOffset(camera: THREE.PerspectiveCamera): THREE.Vector3 {
    const yaw = CAMERA_SETTINGS.yawDeg * (Math.PI / 180);
    const pitch = CAMERA_SETTINGS.pitchDeg * (Math.PI / 180);

    const tallerFactor = Math.max(1, REFERENCE_ASPECT / camera.aspect);
    const distance = CAMERA_SETTINGS.distance * tallerFactor;

    const horizontal = distance * Math.cos(pitch);

    return new THREE.Vector3(
        horizontal * Math.sin(yaw),
        distance * Math.sin(pitch),
        horizontal * Math.cos(yaw),
    );
}

/** Below this, an on-screen drag from the joystick's own center is ignored — same idea as BoundlessWorld3dScene's pointer-follow deadzone. */
const POINTER_FOLLOW_DEADZONE = 8;

export default class PizzaScene extends ThreeScene {
    /** Stands in for PlayerEntity.position while it's commented out — plain speed*delta integration, same math PlayerEntity itself does, driven every frame in update() once thirdPersonCharacter is ready. */
    private readonly playerPosition = new THREE.Vector3(0, 0, 0);

    /** Shown while the player character loads, destroyed the instant it resolves — see setupThirdPersonCharacter(). Tracked as a field too so destroy() can clean it up if the scene is torn down mid-load. */
    private loadingSpinner?: LoadingSpinner;

    /**
     * The whole point of this scene right now — undefined (and therefore
     * everything in update() skipped, see the early-return there) until its
     * async load (FBX mesh + animation clips) finishes. See
     * setupThirdPersonCharacter().
     */
    private thirdPersonCharacter?: ThirdPersonCharacter;

    /** Enemy test NPCs — same rig/animation as the player (see CharacterBody), driven directly with no move input each frame, so they just stand there idling in a red tone. Not wrapped in ThirdPersonCharacter since they have no move speed, no jump, no player input at all. */
    private readonly npcs: CharacterBody[] = [];

    private keyboardInput!: KeyboardInputMovement;
    private analogInput?: AnalogInput;
    private pointerFollowInput?: PointerFollowInput;
    /** True only while the pointer/finger is actually held down — PointerFollowInput.getPointerPosition() keeps returning the LAST known point even after release (nothing clears it on pointerup), so without this the player would keep chasing that stale point forever instead of stopping the instant it's released. */
    private pointerHeld = false;

    /** Written by whichever input controller is active; read once per frame in update(). */
    private readonly moveInput = { x: 0, z: 0 };

    public build(): void {
        // Sky blue background + stronger ambient/directional intensities — brighter overall
        // look with zero added draw cost (same two lights, no new objects/shaders).
        this.threeScene.background = new THREE.Color(0x87ceeb);

        this.threeScene.add(new THREE.AmbientLight(0xffffff, 1.4));
        const sun = new THREE.DirectionalLight(0xffffff, 1.0);
        sun.position.set(5, 10, 5);
        this.threeScene.add(sun);

        this.buildFloor();

        this.positionCamera();
        this.setupInput();
        void this.setupThirdPersonCharacter();
        void this.setupNpcs();
    }

    /**
     * Loads the FBX character + its animation clips and wires up the same
     * idle/run/jump state graph the source project used (see
     * ThirdPersonCharacter.setUp()). Hides the placeholder cube once ready
     * so only one visible character shows at a time — PlayerEntity itself
     * is untouched otherwise and keeps driving all real movement.
     */
    private async setupThirdPersonCharacter(): Promise<void> {
        const spinner = this.loadingSpinner = new LoadingSpinner();
        const character = new ThirdPersonCharacter();

        await character.loadMesh(modelUrl(MODELS.CharacterMedium.fullPath));
        await character.registerAnimation('idle', modelUrl(MODELS.Idle.fullPath));
        await character.registerAnimation('run', modelUrl(MODELS.Running.fullPath));
        await character.registerAnimation('jumpUp', modelUrl(MODELS.JumpingUp.fullPath));
        await character.registerAnimation('falling', modelUrl(MODELS.FallingIdle.fullPath));
        await character.registerAnimation('landing', modelUrl(MODELS.Landing.fullPath));
        await character.registerAnimation('roll', modelUrl(MODELS.Roll.fullPath));
        character.setUp();
        // Test hook — colors the body + attaches a matching cube head, both
        // using the same value-based palette the real cube player uses.
        character.applyColor(HEAD_CUBE_VALUE);

        character.container.scale.setScalar(CHARACTER_SCALE);
        this.threeScene.add(character.container);

        spinner.destroy();
        this.loadingSpinner = undefined;
        this.thirdPersonCharacter = character;
    }

    /**
     * Spawns the enemy test NPCs — same FBX rig/animations as the player,
     * loaded independently (CharacterBody has no shared-instance state), but
     * only 'idle' actually needs registering since they never move (see
     * CharacterBody.update()'s doc — an idling body just stays in its
     * initial state forever with no grounded/speed vars ever set to
     * anything else). setUp() is still called so the state graph exists,
     * kept consistent with the player's own setup.
     */
    private async setupNpcs(): Promise<void> {
        for (const [x, y, z] of NPC_SPAWN_POSITIONS) {
            const body = new CharacterBody();

            await body.loadMesh(modelUrl(MODELS.CharacterMedium.fullPath));
            await body.registerAnimation('idle', modelUrl(MODELS.Idle.fullPath));
            body.setUp();
            body.applyFlatColor(ENEMY_COLOR);

            body.container.scale.setScalar(CHARACTER_SCALE);
            body.container.position.set(x, y, z);
            this.threeScene.add(body.container);

            this.npcs.push(body);
        }
    }

    /** Grid-textured plane (reusing FloorBuilder's own grid generator) so movement is actually visible against something, instead of a flat, featureless color. */
    private buildFloor(): void {
        const material = new THREE.MeshStandardMaterial({
            map: FloorBuilder.makeGridTexture(FLOOR_SIZE),
            roughness: 1,
        });
        // Hooked to the same shared BendService uniform as the character/head-cube
        // materials — see BendService.setEnabled() to toggle the bend everywhere at once.
        BendService.applyBend(material);
        const geometry = new THREE.PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE, FLOOR_SEGMENTS, FLOOR_SEGMENTS);
        geometry.rotateX(-Math.PI / 2);

        const floor = new THREE.Mesh(geometry, material);
        this.threeScene.add(floor);
    }

    private positionCamera(): void {
        this.threeCamera.position.copy(this.playerPosition).add(cameraOffset(this.threeCamera));
        this.threeCamera.lookAt(this.playerPosition);
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
        // NPCs don't gate scene start — they idle independently of the player character's load.
        for (const npc of this.npcs) {
            npc.update(delta);
        }

        // Game doesn't actually "start" until the character has finished loading.
        if (!this.thirdPersonCharacter) {
            super.update(delta);
            return;
        }

        if (this.pointerFollowInput && this.pointerHeld) {
            const pointer = this.pointerFollowInput.getPointerPosition();
            const anchor = pointer && this.worldToScreen(this.playerPosition);

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

        const moveSpeed = this.thirdPersonCharacter.getMoveSpeed();
        this.playerPosition.x += this.moveInput.x * moveSpeed * delta;
        this.playerPosition.z += this.moveInput.z * moveSpeed * delta;
        this.thirdPersonCharacter.update(delta, this.playerPosition, this.moveInput.x, this.moveInput.z);

        /*
         * CubeBuilder.buildPlayer() (used for the head cube) unconditionally
         * bends its material via BendService — the shader drops a vertex's
         * rendered Y by (dx²+dz²) * uBendStrength, where dx/dz are distance
         * from the shared uBendOrigin uniform. Left at its default (0,0,0),
         * the head cube sinks further "down" the farther the character walks
         * from spawn. Re-centering the origin on the player every frame keeps
         * that distance at ~0, so it never sinks.
         */
        BendService.updateOrigin(this.playerPosition);

        const targetPosition = this.playerPosition.clone().add(cameraOffset(this.threeCamera));
        this.threeCamera.position.lerp(targetPosition, 1 - Math.exp(-CAMERA_SETTINGS.followSpeed * delta));
        this.threeCamera.lookAt(this.playerPosition);

        super.update(delta);
    }

    public override destroy(): void {
        this.keyboardInput?.destroy();
        this.analogInput?.destroy();
        this.pointerFollowInput?.destroy();
        this.thirdPersonCharacter?.destroy();
        this.npcs.forEach(npc => npc.destroy());
        this.loadingSpinner?.destroy();
        super.destroy();
    }
}
