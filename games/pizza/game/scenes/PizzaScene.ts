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
// The player itself is MainPlayer (see game/player/MainPlayer.ts) — a
// dedicated Entity subclass that self-configures (RigidBody,
// PlayerMovementController, collision events) in its own awake(). This
// scene's job is just to build the World, add MainPlayer to it, add a
// couple of test obstacles, and forward its own update()/fixedUpdate()
// calls — see World.ts.
//
// Movement/physics/input never wait on the FBX character load: MainPlayer
// is already fully functional (collides, falls under gravity, responds to
// input) the instant it's added — loadPlayerCharacter() is a separate,
// async, purely cosmetic step (see MainPlayer.loadCharacter()'s own doc).

import { ThreeScene } from 'core/scene/ThreeScene';
import * as THREE from 'three';
// import { DEFAULT_START_VALUE } from '../ClogConstants';
// import { PlayerEntity } from '../entities/PlayerEntity';
import { FloorBuilder } from '../builders/FloorBuilder';
import { BendService } from '../services/BendService';
import CharacterBody from '../entities/CharacterBody';
import MODELS from '../../registry/assetsRegistry/modelsRegistry';
import { Game } from 'core/Game';
import { LoadingSpinner } from '../dom-ui/LoadingSpinner';
import World from '../ecs/World';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import BoxVisualComponent from '../components/BoxVisualComponent';
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import MainPlayer from '../player/MainPlayer';
import ResourceNode from '../player/ResourceNode';
import DropZone from '../player/DropZone';
import { ResourceType } from '../actions/ResourceTypes';

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
    distance: 20,
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

/** Thin static slab just under the visible floor plane, top face resting at world Y=0 — gives the player something to land on instead of falling forever. */
const GROUND_HALF_THICKNESS = 0.5;
/** Test obstacle: a static box offset from spawn along Z only — see setupTestBox(). Walking into it should stop the player instead of passing through. */
const TEST_BOX_HALF_EXTENTS = new THREE.Vector3(0.5, 0.5, 0.5);
const TEST_BOX_OFFSET_Z = 4;

/** World-space spawn spots for the gatherable resource nodes — see setupResourceNodes(). Kept clear of the solid TEST_BOX_* obstacle and the drop zone. */
const RESOURCE_NODE_SPAWNS: Array<[ResourceType, number, number]> = [
    [ResourceType.Tree, 3, 3],
    [ResourceType.Tree, -3, 5],
    [ResourceType.Stone, -3, 2],
];

/** Where the build/deposit zone sits — see setupDropZone(). Off to the side, clear of the resource nodes and the solid test box. */
const DROP_ZONE_OFFSET = new THREE.Vector3(6, 0, -2);

export default class PizzaScene extends ThreeScene {
    /** Owns PhysicsWorld + every spawned Entity — the scene's job is just to spawn things into this and forward its own update()/fixedUpdate() calls here (see World.ts). */
    private readonly world = new World();

    /** The player — self-contained (RigidBody, PlayerMovementController, collision events all wired up in its own awake()). See MainPlayer.ts. */
    private readonly mainPlayer: MainPlayer;

    /** Shown while the player character loads, destroyed the instant it resolves — see loadPlayerCharacter(). Tracked as a field too so destroy() can clean it up if the scene is torn down mid-load. */
    private loadingSpinner?: LoadingSpinner;

    /** Enemy test NPCs — same rig/animation as the player (see CharacterBody), driven directly with no move input each frame, so they just stand there idling in a red tone. Not wrapped in ThirdPersonCharacter since they have no move speed, no jump, no player input at all. */
    private readonly npcs: CharacterBody[] = [];

    public constructor(game: Game) {
        super(game);

        // World.add() adopts a purpose-built Entity subclass instance and calls its
        // awake() immediately — by the time this returns, MainPlayer already has its
        // RigidBody/PlayerMovementController and can move/collide, well before its FBX
        // character has (or even starts to) load. `this` is passed as its movement
        // input host (a Pixi container with worldToScreen()) and `this.threeScene` as
        // where its eventual character mesh gets parented.
        this.mainPlayer = this.world.add(new MainPlayer(this, this.threeScene));
    }

    public build(): void {
        // Sky blue background + stronger ambient/directional intensities — brighter overall
        // look with zero added draw cost (same two lights, no new objects/shaders).
        this.threeScene.background = new THREE.Color(0x87ceeb);

        this.threeScene.add(new THREE.AmbientLight(0xffffff, 1.4));
        const sun = new THREE.DirectionalLight(0xffffff, 1.0);
        sun.position.set(5, 10, 5);
        this.threeScene.add(sun);

        this.buildFloor();
        this.setupGround();
        this.setupTestBox();
        this.setupResourceNodes();
        this.setupDropZone();
        this.threeScene.add(this.mainPlayer.transform);

        this.positionCamera();
        void this.loadPlayerCharacter();
        void this.setupNpcs();
    }

    /** Static RigidBody matching the visible floor plane — top face at world Y=0, so the player (gravity pulls it down from spawn) lands and rests on it instead of falling forever. Purely a collider; buildFloor() already draws the ground. */
    private setupGround(): void {
        const ground = this.world.spawn();
        ground.addComponent(new RigidBody({
            halfExtents: new THREE.Vector3(FLOOR_SIZE / 2, GROUND_HALF_THICKNESS, FLOOR_SIZE / 2),
            isStatic: true,
            layer: Layers.Environment,
            centerOffset: new THREE.Vector3(0, -GROUND_HALF_THICKNESS, 0),
        }));
        this.threeScene.add(ground.transform);
    }

    /** The task's own collision test: a static box offset from spawn along Z only — walking the player into it should stop them instead of clipping through. */
    private setupTestBox(): void {
        const box = this.world.spawn();
        box.transform.position.set(0, 0, TEST_BOX_OFFSET_Z);

        box.addComponent(new RigidBody({
            halfExtents: TEST_BOX_HALF_EXTENTS,
            isStatic: true,
            layer: Layers.Environment,
            centerOffset: new THREE.Vector3(0, TEST_BOX_HALF_EXTENTS.y, 0),
        }));
        box.addComponent(new BoxVisualComponent(
            TEST_BOX_HALF_EXTENTS.clone().multiplyScalar(2),
            0xff8800,
            new THREE.Vector3(0, TEST_BOX_HALF_EXTENTS.y, 0),
        ));

        this.threeScene.add(box.transform);
    }

    /** The "zone for getting the items" — one ResourceNode per RESOURCE_NODE_SPAWNS entry (see that constant), each a self-contained Entity subclass (trigger + placeholder visual — cylinder for a tree, cube for stone) that AutoGatherController (on MainPlayer) reacts to on its own. */
    private setupResourceNodes(): void {
        for (const [resourceType, x, z] of RESOURCE_NODE_SPAWNS) {
            const node = this.world.add(new ResourceNode(resourceType, new THREE.Vector3(x, 0, z)));
            this.threeScene.add(node.transform);
        }
    }

    /** The "drop zone" — deposits whatever's in the player's backpack on entry (see DropZone.ts). Needs a ScreenAnchorHost (worldToScreen + the Pixi overlay) to float its "+N Wood"-style deposit popups — `this` covers worldToScreen (ThreeScene), `this.game.overlayContainer` is the same root EntityIndicatorManager-style overlays already use elsewhere in this repo. */
    private setupDropZone(): void {
        const screenHost: ScreenAnchorHost = {
            worldToScreen: position => this.worldToScreen(position),
            overlayContainer: this.game.overlayContainer,
        };

        const dropZone = this.world.add(new DropZone(DROP_ZONE_OFFSET, screenHost));
        this.threeScene.add(dropZone.transform);
    }

    /**
     * Shows a spinner while MainPlayer.loadCharacter() does its thing (FBX mesh +
     * animation clips) — purely cosmetic UI orchestration; the player itself never
     * waits on this (see this file's own doc, and MainPlayer.loadCharacter()'s).
     */
    private async loadPlayerCharacter(): Promise<void> {
        const spinner = this.loadingSpinner = new LoadingSpinner();
        await this.mainPlayer.loadCharacter();
        spinner.destroy();
        this.loadingSpinner = undefined;
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
        const playerPosition = this.mainPlayer.transform.position;
        this.threeCamera.position.copy(playerPosition).add(cameraOffset(this.threeCamera));
        this.threeCamera.lookAt(playerPosition);
    }

    /**
     * Physics runs here, not in update(). Game.loop() (core/Game.ts) drives this at a
     * fixed, constant step (Game._fixedDeltaTime/1000, ~1/60s) via an accumulator — if a
     * frame stalls (e.g. the FBX character/animation loads in
     * MainPlayer.loadCharacter() blocking the main thread for a moment), the accumulator
     * just runs several small fixed steps back-to-back to catch up, instead of handing
     * PhysicsWorld one enormous variable delta. That's what was launching the player
     * across the map a few seconds in: update()'s delta comes straight from a raw
     * performance.now() diff with no clamping, so the first frame after any real stall
     * reported multiple real seconds of elapsed time, and gravity/position integration
     * (delta multiplied twice) turned that into an instant multi-unit teleport — easily
     * enough to tunnel clean through the thin ground slab and get flung out from a bad
     * collision resolution on the way through. MAX_PHYSICS_DELTA (PhysicsConstants.ts)
     * stays on as a second line of defense, but the fixed step is the real fix.
     *
     * Runs unconditionally from the very first frame — MainPlayer's RigidBody and
     * PlayerMovementController exist from its own awake(), independent of whether its
     * FBX character has loaded (see this file's own doc).
     */
    public override fixedUpdate(delta: number): void {
        this.world.fixedUpdate(delta);
    }

    public override update(delta: number): void {
        // NPCs don't gate scene start — they idle independently of the player character's load.
        for (const npc of this.npcs) {
            npc.update(delta);
        }

        const playerPosition = this.mainPlayer.transform.position;

        // Runs every entity's update() — for the player, that's PlayerMovementController's own
        // pointer-follow tracking plus CharacterVisualComponent syncing position/animation from
        // whatever fixedUpdate's physics step last resolved (once the FBX character has loaded
        // and that component exists at all — harmless no-op until then).
        this.world.update(delta);

        /*
         * CubeBuilder.buildPlayer() (used for the head cube) unconditionally
         * bends its material via BendService — the shader drops a vertex's
         * rendered Y by (dx²+dz²) * uBendStrength, where dx/dz are distance
         * from the shared uBendOrigin uniform. Left at its default (0,0,0),
         * the head cube sinks further "down" the farther the character walks
         * from spawn. Re-centering the origin on the player every frame keeps
         * that distance at ~0, so it never sinks.
         */
        BendService.updateOrigin(playerPosition);

        const targetPosition = playerPosition.clone().add(cameraOffset(this.threeCamera));
        this.threeCamera.position.lerp(targetPosition, 1 - Math.exp(-CAMERA_SETTINGS.followSpeed * delta));
        this.threeCamera.lookAt(playerPosition);

        super.update(delta);
    }

    public override destroy(): void {
        // Tears down every component on mainPlayer, including PlayerMovementController's own
        // input listeners and (if it ever loaded) the FBX character itself — see MainPlayer.destroy().
        this.world.remove(this.mainPlayer);
        this.npcs.forEach(npc => npc.destroy());
        this.loadingSpinner?.destroy();
        super.destroy();
    }
}
