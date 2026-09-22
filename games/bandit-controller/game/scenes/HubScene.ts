// HubScene.ts
//
// The hub the player wanders between minigames: a bent wireframe-grid floor,
// the player character, a ring of Money_Pile_Small collectibles, and two
// minigame entry gates. Walking through a gate — or clicking GameUI's own
// quick-launch buttons, stacked under Reset, a dev/testing shortcut for the
// exact same transition — dispatches onEnterMinigame with that minigame's
// own SceneManager key — this scene never touches SceneManager directly
// (see index.ts's own doc on why: every multi-scene game in this repo has
// scenes expose a Signal and let index.ts's startGame() be the only thing
// that calls sceneManager.changeScene()).
//
// The money counter itself lives outside this scene entirely — GameState.getMoney()/
// addMoney() for the running total, MoneyHud (constructed once in index.ts, shared with
// RunnerMinigameScene/SwipeMinigameScene) for the actual top-left UI — so neither the total
// nor the counter widget resets or flickers every time this scene is destroyed and rebuilt
// from scratch crossing into/out of a minigame. See MoneyHud.ts's own doc.

import * as THREE from 'three';
import { Signal } from 'signals';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import { DevGuiManager } from 'core/utils/DevGuiManager';
import { BendService } from 'core/services/BendService';
import { WorldEnvironment, CameraFollowOptions } from './shared/WorldEnvironment';
import Collectible from '../entities/Collectible';
import { buildGateMarker, buildTriggerGate } from '../builders/GateBuilder';
import { spawnCollectible, pruneCollected } from '../builders/CollectibleBuilder';
import { CAMERA_SETTINGS_BY_MODE, DEFAULT_CAMERA_MODE } from '../data/GameSettings';
import { PLAYER_SETTINGS } from '../data/PlayerSettings';
import { WORLD_SETTINGS } from '../data/WorldSettings';
import { MONEY_PILE_SMALL, generateCollectibleSpawnPositions } from '../data/CollectibleSettings';
import GameUI from '../ui/GameUI';
import MoneyHud from '../ui/MoneyHud';

/** Where the player starts, and where the "Reset" button puts them back. */
const PLAYER_SPAWN_POSITION = new THREE.Vector3(0, 0, 0);
/** How long a demo camera-switch (see the 1/2/3/4 keybinds in awakeCameraHotkeys()) takes to blend. */
const CAMERA_BLEND_SEC = 1.0;
/** Demo keybinds mapping to whichever modes GameSettings.CAMERA_SETTINGS_BY_MODE happens to define. Extra keys beyond however many modes exist are simply never reachable. */
const CAMERA_HOTKEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];

/** Minigame entry-gate placements — far enough from the collectible ring (radius 6 around spawn, see CollectibleSettings.ts) that nothing overlaps. */
const RUNNER_GATE_POSITION = { x: -6, z: -14 };
const SWIPE_GATE_POSITION = { x: 6, z: -14 };

/** No lockX here (unlike the minigame scenes) — the hub is free-roam, the camera should still follow the player's own X. Only the jump-height freeze applies, so a hop doesn't bob the camera here either. */
const CAMERA_FOLLOW_OPTIONS: CameraFollowOptions = {
    freezeHeightWhileAirborne: true,
};

/**
 * Dev-GUI sliders bind directly to whichever objects THIS hub instance
 * happens to own (its own WorldEnvironment.cameraSystem.current, etc.) —
 * DevGuiManager's folders are keyed by name and never cleared
 * (getOrCreateFolder() just keeps appending), so re-wiring on every hub
 * rebuild would stack duplicate rows forever. Guarding to "once per page
 * load" means Player/World sliders (module-level singletons, read live by
 * every scene regardless of which one is current) stay correct forever, but
 * the Camera sliders go inert after the FIRST scene switch away from this
 * hub instance — acceptable for a ?dev-only debug tool; fixing it properly
 * would need DevGuiManager to support removing/replacing controls.
 */
let devGuiWired = false;

export default class HubScene extends ThreeScene {
    /** Fired with the target minigame's SceneManager key ('runner-minigame' | 'swipe-minigame') — see index.ts. */
    public readonly onEnterMinigame: Signal = new Signal();

    private env!: WorldEnvironment;
    private readonly collectibles: Collectible[] = [];
    private readonly moneyHud: MoneyHud;
    private gameUI!: GameUI;
    private cameraHotkeyIds: string[] = [];

    public constructor(game: Game, moneyHud: MoneyHud) {
        super(game);
        this.moneyHud = moneyHud;
    }

    /** Resolves once this build's player character has finished loading — see index.ts's radial-transition orchestration (RadialTransition.reveal() waits on this before playing). */
    public get ready(): Promise<void> {
        return this.env.playerReady;
    }

    public build(): void {
        this.env = new WorldEnvironment(this.threeScene);
        this.env.spawnPlayer(this, PLAYER_SPAWN_POSITION);
        this.env.cameraSystem.cutTo(DEFAULT_CAMERA_MODE);
        this.env.updateCamera(this.threeCamera, 0, CAMERA_FOLLOW_OPTIONS);

        this.gameUI = new GameUI(
            () => this.resetPlayer(),
            () => this.onEnterMinigame.dispatch('runner-minigame'),
            () => this.onEnterMinigame.dispatch('swipe-minigame'),
        );
        this.game.uiLayer.addChild(this.gameUI);

        this.buildCollectibles();
        this.buildMinigameGates();
        this.awakeCameraHotkeys();

        if (!devGuiWired) {
            devGuiWired = true;
            this.wireDevGui();
        }
    }

    public update(delta: number): void {
        this.env.update(delta);
        pruneCollected(this.env.world, this.collectibles);
        super.update(delta);
    }

    public fixedUpdate(delta: number): void {
        this.env.fixedUpdate(delta);
        this.env.updateCamera(this.threeCamera, delta, CAMERA_FOLLOW_OPTIONS);
    }

    /** Two static trigger gates — crossing either dispatches onEnterMinigame with that minigame's own scene key; index.ts is what actually switches scenes. */
    private buildMinigameGates(): void {
        buildGateMarker(this.threeScene, RUNNER_GATE_POSITION.x, RUNNER_GATE_POSITION.z, 0x44ccff);
        buildTriggerGate(this.env.world, this.threeScene, RUNNER_GATE_POSITION.x, RUNNER_GATE_POSITION.z, () => {
            this.onEnterMinigame.dispatch('runner-minigame');
        });

        buildGateMarker(this.threeScene, SWIPE_GATE_POSITION.x, SWIPE_GATE_POSITION.z, 0xffb347);
        buildTriggerGate(this.env.world, this.threeScene, SWIPE_GATE_POSITION.x, SWIPE_GATE_POSITION.z, () => {
            this.onEnterMinigame.dispatch('swipe-minigame');
        });
    }

    /** Spreads a ring of Money_Pile_Small pickups around the player's own spawn point — walking near one snaps it to the player and pays out via the shared moneyHud (see CollectibleBuilder.spawnCollectible()). */
    private buildCollectibles(): void {
        for (const position of generateCollectibleSpawnPositions(PLAYER_SPAWN_POSITION)) {
            const collectible = spawnCollectible(
                this.env.world,
                this.threeScene,
                this,
                this.game,
                this.moneyHud,
                MONEY_PILE_SMALL,
                position,
                () => this.env.mainPlayer.getCollectTargetPosition(),
                BendService,
            );
            this.collectibles.push(collectible);
        }
    }

    /** Demo hookup for VirtualCameraSystem.blendTo() — press a number key to smoothly blend to that virtual camera (registered in WorldEnvironment's constructor, in GameSettings.CAMERA_SETTINGS_BY_MODE's own insertion order). */
    private awakeCameraHotkeys(): void {
        this.cameraHotkeyIds = Object.keys(CAMERA_SETTINGS_BY_MODE);
        window.addEventListener('keydown', this.onCameraHotkey);
    }

    private readonly onCameraHotkey = (e: KeyboardEvent): void => {
        const index = CAMERA_HOTKEYS.indexOf(e.code);
        const id = index >= 0 ? this.cameraHotkeyIds[index] : undefined;
        if (id) {
            this.env.cameraSystem.blendTo(id, CAMERA_BLEND_SEC);
        }
    };

    /** GameUI's "Reset" button — puts the player back at spawn with zero velocity and cuts (not blends — this is a hard correction, not a cinematic beat) the camera back to standard. */
    private resetPlayer(): void {
        this.env.mainPlayer.transform.position.copy(PLAYER_SPAWN_POSITION);
        this.env.mainPlayer.rigidBody.velocity.set(0, 0, 0);
        this.env.cameraSystem.cutTo(DEFAULT_CAMERA_MODE);
        this.env.updateCamera(this.threeCamera, 0, CAMERA_FOLLOW_OPTIONS);
    }

    private wireDevGui(): void {
        const current = this.env.cameraSystem.current;
        DevGuiManager.instance.addProperties(current, ['yawDeg'], [-180, 180], 'Camera', 'Camera');
        DevGuiManager.instance.addProperties(current, ['pitchDeg'], [0, 89], 'Camera', 'Camera');
        DevGuiManager.instance.addProperties(current, ['distance'], [2, 20], 'Camera', 'Camera');
        DevGuiManager.instance.addProperties(current, ['followSpeed'], [0.5, 20], 'Camera', 'Camera');
        DevGuiManager.instance.addProperties(current.offset, ['x', 'y', 'z'], [-3, 3], 'Camera Offset', 'Camera');

        // Player + World tuning — edits PlayerSettings.ts/WorldSettings.ts directly, which
        // every reader (in whichever scene is currently active) reads LIVE, so these take
        // effect immediately regardless of which scene is current when you drag a slider.
        DevGuiManager.instance.addProperties(PLAYER_SETTINGS, ['walkSpeed'], [1, 15], 'Player', 'Player');
        DevGuiManager.instance.addProperties(PLAYER_SETTINGS, ['runSpeedMultiplier'], [1, 4], 'Player', 'Player');
        DevGuiManager.instance.addProperties(PLAYER_SETTINGS, ['jumpSpeed'], [2, 25], 'Player', 'Player');
        DevGuiManager.instance.addProperties(PLAYER_SETTINGS, ['rollDuration'], [0.1, 2], 'Player', 'Player');
        DevGuiManager.instance.addProperties(PLAYER_SETTINGS, ['slideDuration'], [0.1, 2], 'Player', 'Player');
        // Collider height profiles (see PlayerSettings.getPlayerColliderHalfExtents()) — only
        // takes effect for the player's CURRENT stand/slide state going forward (MainPlayer.
        // awake() reads standHalfHeight once at spawn, CharacterVisualComponent re-reads both
        // on the next slide transition), same "live but not retroactive" caveat every other
        // *Settings.ts slider already has.
        DevGuiManager.instance.addProperties(PLAYER_SETTINGS, ['standHalfHeight'], [0.3, 1.5], 'Player', 'Player');
        DevGuiManager.instance.addProperties(PLAYER_SETTINGS, ['slideHalfHeight'], [0.1, 1], 'Player', 'Player');
        DevGuiManager.instance.addProperties(PLAYER_SETTINGS, ['hitKickbackSpeed'], [0, 20], 'Player', 'Player');
        DevGuiManager.instance.addProperties(PLAYER_SETTINGS, ['hitKickbackDuration'], [0.05, 1.5], 'Player', 'Player');
        DevGuiManager.instance.addProperties(WORLD_SETTINGS, ['gravity'], [-60, -2], 'World', 'World');
        DevGuiManager.instance.addProperties(WORLD_SETTINGS, ['maxPhysicsDelta'], [0.01, 0.1], 'World', 'World');
    }

    public resize(): void {
        this.gameUI?.reposition();
    }

    public destroy(): void {
        window.removeEventListener('keydown', this.onCameraHotkey);
        this.gameUI?.destroy();
        for (const collectible of this.collectibles) {
            this.env.world.remove(collectible);
        }
        this.collectibles.length = 0;
        this.env.destroy();
        super.destroy();
    }
}
