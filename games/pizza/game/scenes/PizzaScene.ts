// PizzaScene.ts
//
// Isolated player-movement test scene — just a player moving around on a
// plain flat plane, driven by the SAME keyboard/mobile input systems
// BoundlessWorld3dScene uses. Deliberately strips everything else out:
// - Ground is one static plane, no chunking (see WorldManager.buildGround()) —
//   but resource nodes DO stream in/out by proximity to the player, and keep
//   simulating (respawn timers) even while out of range. See ../world/WorldManager.ts.
// - The floor, the character's body materials, and all head/backpack cubes are all
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
import { BendService } from '../services/BendService';
import { Game } from 'core/Game';
import { LoadingSpinner } from '../dom-ui/LoadingSpinner';
import World from '../ecs/World';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import BoxVisualComponent from '../components/BoxVisualComponent';
import { ScreenAnchorHost } from '../components/ScreenAnchorComponent';
import MainPlayer from '../player/MainPlayer';
import DropZone from '../player/DropZone';
import WorldManager from '../world/WorldManager';
import BackpackUI from '../ui/BackpackUI';
import GlobalResourcesUI from '../ui/GlobalResourcesUI';
import { GlobalResourceStorage } from '../data/GlobalResourceStorage';
import { BackpackStorage } from '../data/BackpackStorage';
import { DevGuiManager } from 'core/utils/DevGuiManager';

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

/** Test obstacle: a static box offset from spawn along Z only — see setupTestBox(). Walking into it should stop the player instead of passing through. */
const TEST_BOX_HALF_EXTENTS = new THREE.Vector3(0.5, 0.5, 0.5);
const TEST_BOX_OFFSET_Z = 4;

/** Where the build/deposit zone sits — see setupDropZone(). Off to the side, clear of the resource nodes and the solid test box. */
const DROP_ZONE_OFFSET = new THREE.Vector3(6, 0, -2);

/** Gap between the backpack HUD panel's bottom edge and the actual bottom of the screen — see positionBackpackUi(). */
const BACKPACK_UI_BOTTOM_MARGIN = 16;

/** Gap between the global-resources HUD panel's top/right edges and the actual top-right corner of the screen — see positionGlobalResourcesUi(). */
const GLOBAL_RESOURCES_UI_MARGIN = 16;

export default class PizzaScene extends ThreeScene {
    /** Owns PhysicsWorld + every spawned Entity — the scene's job is just to spawn things into this and forward its own update()/fixedUpdate() calls here (see World.ts). */
    private readonly world = new World();

    /** Shared by anything that pairs a Pixi overlay element to a 3D point (ScreenAnchorComponent) — DropZone's nameplate/deposit popups, ResourceNode's damage numbers. One instance so they all read the exact same worldToScreen/overlayContainer. */
    private readonly screenHost: ScreenAnchorHost = {
        worldToScreen: position => this.worldToScreen(position),
        overlayContainer: this.game.overlayContainer,
    };

    /** Owns the ground + every resource node's position/gather/respawn state, streaming ResourceNode entities in/out by proximity to the player — see WorldManager.ts. */
    private readonly worldManager = new WorldManager(this.world, this.threeScene, this.screenHost);

    /** The player — self-contained (RigidBody, PlayerMovementController, collision events all wired up in its own awake()). See MainPlayer.ts. */
    private readonly mainPlayer: MainPlayer;

    /** Shown while the player character loads, destroyed the instant it resolves — see loadPlayerCharacter(). Tracked as a field too so destroy() can clean it up if the scene is torn down mid-load. */
    private loadingSpinner?: LoadingSpinner;

    /** The backpack HUD panel — see setupBackpackUi(). Tracked so destroy() can unsubscribe it from BackpackStorage.onChange. */
    private backpackUi?: BackpackUI;

    /** The base-stockpile HUD panel, pinned top-right — see setupGlobalResourcesUi(). Tracked so destroy() can unsubscribe it from GlobalResourceStorage.onChange. */
    private globalResourcesUi?: GlobalResourcesUI;

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

        this.worldManager.buildGround();
        this.setupTestBox();
        this.setupDropZone();
        this.setupBackpackUi();
        this.setupGlobalResourcesUi();
        this.setupDebugGui();
        this.threeScene.add(this.mainPlayer.transform);

        this.positionCamera();
        void this.loadPlayerCharacter();
    }

    /** Dev-only tools — no-ops entirely unless launched with ?dev (see Game.debugParams/DevGuiManager.initialize(), called once in index.ts's startGame()). */
    private setupDebugGui(): void {
        DevGuiManager.instance.addButton(
            'Clear Global Resources',
            () => void GlobalResourceStorage.clearAll(),
            'Resources',
        );
        DevGuiManager.instance.addButton(
            'Clear Backpack',
            () => void BackpackStorage.clearAll(),
            'Resources',
        );
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

    /** The "drop zone" — deposits whatever's in the player's backpack on entry, and carries a permanent "Drop Zone" nameplate (see DropZone.ts) — both via this.screenHost. */
    private setupDropZone(): void {
        const dropZone = this.world.add(new DropZone(DROP_ZONE_OFFSET, this.screenHost));
        this.threeScene.add(dropZone.transform);
    }

    /** The backpack HUD panel — reads the same global BackpackStorage AutoGatherController/DropZone read/write, so it needs no wiring beyond existing and sitting in the overlay (see BackpackUI.ts's own doc). Positioned every frame — see positionBackpackUi(). */
    private setupBackpackUi(): void {
        this.backpackUi = new BackpackUI();
        this.game.overlayContainer.addChild(this.backpackUi);
        this.positionBackpackUi();
    }

    /**
     * Bottom-center, regardless of viewport size/aspect — Game.overlayScreenData is kept up
     * to date by Game.onResize() and already expressed in overlayContainer's own LOCAL space
     * (see that field's own doc in core/Game.ts), so this panel (a direct child of
     * overlayContainer) can use those points directly with no extra conversion. Re-run every
     * frame rather than once per resize event since it's cheap and this scene has no resize
     * hook of its own to piggyback on.
     */
    private positionBackpackUi(): void {
        if (!this.backpackUi) {
            return;
        }

        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }

        this.backpackUi.position.set(
            screen.center.x - this.backpackUi.panelWidth / 2,
            screen.bottomLeft.y - this.backpackUi.panelHeight - BACKPACK_UI_BOTTOM_MARGIN,
        );
    }

    /** The base-stockpile HUD panel — reads the same global GlobalResourceStorage DropZone writes to, so it needs no wiring beyond existing and sitting in the overlay (see GlobalResourcesUI.ts's own doc). Positioned every frame — see positionGlobalResourcesUi(). */
    private setupGlobalResourcesUi(): void {
        this.globalResourcesUi = new GlobalResourcesUI();
        this.game.overlayContainer.addChild(this.globalResourcesUi);
        this.positionGlobalResourcesUi();
    }

    /** Top-right, regardless of viewport size/aspect — same screen.topRight-in-overlay-local-space reasoning as positionBackpackUi(). Re-run every frame since the panel's own size changes as rows are added. */
    private positionGlobalResourcesUi(): void {
        if (!this.globalResourcesUi) {
            return;
        }

        const screen = Game.overlayScreenData;
        if (!screen) {
            return;
        }

        this.globalResourcesUi.position.set(
            screen.topRight.x - this.globalResourcesUi.panelWidth - GLOBAL_RESOURCES_UI_MARGIN,
            screen.topRight.y + GLOBAL_RESOURCES_UI_MARGIN,
        );
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
     *
     * Camera follow, the bend origin, and WorldManager's proximity check all read
     * mainPlayer.transform.position — which itself only changes here, in fixedUpdate().
     * Doing all of that here too (rather than in update(), which runs at render rate) keeps
     * everything that depends on the player's position moving on the SAME clock as the
     * character mesh itself (see CharacterVisualComponent, which reads the RigidBody
     * directly) — no relative jitter between camera and character from render/physics
     * timing drift, since neither one moves except when this runs.
     */
    public override fixedUpdate(delta: number): void {
        this.world.fixedUpdate(delta);

        const playerPosition = this.mainPlayer.transform.position;

        /*
         * CubeBuilder.buildPlayer() (used for the head cube) unconditionally
         * bends its material via BendService — the shader drops a vertex's
         * rendered Y by (dx²+dz²) * uBendStrength, where dx/dz are distance
         * from the shared uBendOrigin uniform. Left at its default (0,0,0),
         * the head cube sinks further "down" the farther the character walks
         * from spawn. Re-centering the origin on the player every step keeps
         * that distance at ~0, so it never sinks.
         */
        BendService.updateOrigin(playerPosition);

        // Streams resource nodes in/out around the player and keeps off-screen respawn
        // timers ticking — see WorldManager.update()'s own doc.
        this.worldManager.update(playerPosition, delta);

        const targetPosition = playerPosition.clone().add(cameraOffset(this.threeCamera));
        this.threeCamera.position.lerp(targetPosition, 1 - Math.exp(-CAMERA_SETTINGS.followSpeed * delta));
        this.threeCamera.lookAt(playerPosition);
    }

    public override update(delta: number): void {
        // Runs every entity's update() — for the player, that's PlayerMovementController's own
        // pointer-follow tracking plus CharacterVisualComponent syncing position/animation from
        // whatever fixedUpdate's physics step last resolved (once the FBX character has loaded
        // and that component exists at all — harmless no-op until then).
        this.world.update(delta);
        this.positionBackpackUi();
        this.positionGlobalResourcesUi();

        super.update(delta);
    }

    public override destroy(): void {
        // Tears down every component on mainPlayer, including PlayerMovementController's own
        // input listeners and (if it ever loaded) the FBX character itself — see MainPlayer.destroy().
        this.world.remove(this.mainPlayer);
        this.worldManager.destroy();
        this.loadingSpinner?.destroy();
        this.backpackUi?.destroy();
        this.globalResourcesUi?.destroy();
        super.destroy();
    }
}
