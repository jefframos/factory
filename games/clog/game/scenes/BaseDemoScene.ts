import { GameScene } from '@core/scene/GameScene';
import AnalogInput from '@core/io/AnalogInput';
import PointerFollowInput from '@core/io/PointerFollowInput';
import * as PIXI from 'pixi.js';
import KeyboardInputMovement from 'core/io/KeyboardInputMovement';
import { DevGuiManager } from '@core/utils/DevGuiManager';
import { Game } from '@core/Game';
import LinearWorld3dScene from './LinearWorld3dScene';
import BoundlessWorld3dScene from './BoundlessWorld3dScene';
import type { IWorld3dScene } from './IWorld3dScene';
import { BoostIndicator } from '../ui/BoostIndicator';
import { LeaderboardPanel } from '../ui-dom/LeaderboardPanel';
import { PlayerFlowController, type DeathSnapshot } from '../ui-dom/PlayerFlowController';
import { MovementHint } from '../ui-dom/MovementHint';
import { SoundToggleButton } from '@core/dom-ui/SoundToggleButton';
import PlatformHandler from '@core/platforms/PlatformHandler';
import Stats from 'stats.js';
import { TextureBuilder } from '../builders/TextureBuilder';

const PLAYER_NAME_KEY = 'playerName';

// ?gated re-enables the linear room / gate progression mode.
const GATED_MODE = new URLSearchParams(window.location.search).has('gated');

// Movement control scheme: true = virtual joystick (AnalogInput), false =
// pointer-follow (chase the live mouse/finger position, click/tap to boost —
// see PointerFollowInput).
const USE_ANALOG_INPUT = false;

// Below this distance (raw CSS pixels) from the pointer, the pointer-follow
// scheme treats the player as "arrived" and stops moving, instead of jittering
// in place trying to close the last sub-pixel gap.
const POINTER_FOLLOW_DEADZONE = 4;

// How often the leaderboard rebuilds its rows — every frame would be wasted
// DOM churn for something that only needs to look "live," not exact.
const LEADERBOARD_UPDATE_INTERVAL = 0.5;

/**
 * 'menu': boot/death/end-game screens — world3d is a fresh, dormant preview,
 * input disabled. 'playing': joined, world active, input forwarded.
 * 'dead': death/end-game countdown running, awaiting Revive/Continue.
 */
type FlowState = 'menu' | 'playing' | 'dead';

export default class BaseDemoScene extends GameScene {

    private speedMultiplier = 1;
    private world3d!: IWorld3dScene;
    private analogInput: AnalogInput | null = null;
    private pointerFollowInput: PointerFollowInput | null = null;
    private keyboardInput!: KeyboardInputMovement;
    private boostIndicator!: BoostIndicator;
    private lastW = 0;
    private lastH = 0;
    private statsWidgets: Stats[] = [];
    private devPosLabel: PIXI.Text | null = null;
    private leaderboard!: LeaderboardPanel;
    private leaderboardTimer = 0;
    private flowController!: PlayerFlowController;
    private soundToggle!: SoundToggleButton;
    private movementHint!: MovementHint;
    private flowState: FlowState = 'menu';
    /** True while spawnFreshWorld() is rebuilding world3d — update() bails out for that tick so it never touches a not-yet-built instance. */
    private worldRebuilding = false;

    public async build(): Promise<void> {
        await this.spawnFreshWorld();

        if (Game.debugParams.stats) {
            const panels = [0, 2] as const; // 0 = FPS, 2 = MB
            panels.forEach((panel, i) => {
                const s = new Stats();
                s.showPanel(panel);
                s.dom.style.cssText = `position:fixed;top:0;left:${i * 80}px;z-index:10002;`;
                document.body.appendChild(s.dom);
                this.statsWidgets.push(s);
            });
        }

        this.eventMode = 'static';
        this.hitArea = new PIXI.Rectangle(-2000, -2000, 6000, 6000);

        this.movementHint = new MovementHint();

        if (USE_ANALOG_INPUT) {
            this.analogInput = new AnalogInput(this);
            this.analogInput.onMove.add(({ direction, magnitude }) => {
                if (this.flowState !== 'playing') return;
                if (magnitude > 0) this.movementHint.registerMove();
                this.world3d.moveInput.x = direction.x * magnitude;
                this.world3d.moveInput.z = direction.y * magnitude;
            });
        } else {
            this.pointerFollowInput = new PointerFollowInput(this);
            this.pointerFollowInput.onBoostChange.add(({ active }) => {
                if (this.flowState !== 'playing') return;
                this.world3d.setPlayerBoosting(active);
            });
        }

        this.keyboardInput = new KeyboardInputMovement();
        this.keyboardInput.onMove.add(({ direction, magnitude }) => {
            if (this.flowState !== 'playing') return;
            if (magnitude > 0) this.movementHint.registerMove();
            this.world3d.moveInput.x = direction.x * magnitude;
            this.world3d.moveInput.z = direction.y * magnitude;
        });

        DevGuiManager.instance.addButton('Double Value', () => {
            this.world3d.debugDoublePlayerValue();
        }, 'Player');

        DevGuiManager.instance.addButton('Kill Player', () => {
            this.world3d.debugKillPlayer();
        }, 'Player');

        DevGuiManager.instance.addButton('Spawn Entity', () => {
            this.world3d.spawnBot(16);
        }, 'Player');

        DevGuiManager.instance.addButton('Spawn 10 Food', () => {
            this.world3d.spawnFood(10);
        }, 'Player');

        DevGuiManager.instance.addObjectTrigger(
            { zoom: 1.0 },
            (v) => { this.world3d.cameraZoom = v.zoom; },
            ['zoom'],
            [0.2, 6.0],
            'Camera Zoom',
            'Camera',
        );

        // AI debug view — snap the camera way out so entity behavior is visible
        // at a glance instead of manually dragging the zoom slider each time.
        DevGuiManager.instance.addToggle('Debug Zoom Out', false, (isZoomedOut) => {
            this.world3d.cameraZoom = isZoomedOut ? 6.0 : 1.0;
        }, 'Camera');

        // Fast-forwards the whole sim (bots, food spawns, merges — everything
        // downstream of the delta this scene hands to world3d.update()) so
        // long-term AI behavior can be watched/logged without waiting for it
        // in real time. 1 = normal speed, 0 = paused.
        DevGuiManager.instance.addProperties(this, ['speedMultiplier'], [0, 10], 'Sim Speed', 'Simulation');

        // Pulls the current procedurally-generated placeholder textures out as
        // PNGs so they can be hand-edited and swapped in later via TextureBuilder.load().
        DevGuiManager.instance.addButton('Download Face Texture', () => {
            TextureBuilder.export(TextureBuilder.face(), 'face.png');
        }, 'Textures');

        DevGuiManager.instance.addButton('Download Island Texture', () => {
            TextureBuilder.export(TextureBuilder.island(), 'island.png');
        }, 'Textures');

        // Floating boost bar that tracks the player in screen space — parented
        // to game.overlayContainer (top Pixi layer, same as devPosLabel) since
        // it needs to be positioned via a raw screen-pixel -> container-local
        // conversion each frame (see update()), not `this`'s own layout flow.
        this.boostIndicator = new BoostIndicator();
        this.game.overlayContainer.addChild(this.boostIndicator);

        // Production DOM leaderboard — bottom-right, always on (not dev-gated).
        this.leaderboard = new LeaderboardPanel();

        // Dev-only readout — top-right player world position.
        // Parented to game.overlayContainer (not `this`) and positioned via
        // Game.overlayScreenData so it stays pinned to the true screen edge
        // instead of the letterboxed/scaled scene space.
        if (Game.debugParams.dev) {
            this.devPosLabel = new PIXI.Text('', {
                fontFamily: 'monospace', fontSize: 14, fill: 0xffffff,
                stroke: 0x000000, strokeThickness: 3,
            });
            this.devPosLabel.anchor.set(1, 0);
            this.game.overlayContainer.addChild(this.devPosLabel);
        }

        // Not controllable yet — hide the touch joystick and the player's
        // direction triangle until "Tap to Start" (see handleJoinServer).
        this.setFlowState('menu');

        // Menu/Shop/Rename/Death — one DOM overlay, no scene change (see
        // PlayerFlowController). The 3D world above is already fully live at
        // this point (player spawned, NPCs simulating); the menu just gates
        // movement input until "Join Server" so the still-centered player
        // reads as a preview instead of drifting off unattended.
        this.flowController = new PlayerFlowController();
        const savedName = await PlatformHandler.instance.platform.getItem(PLAYER_NAME_KEY);
        if (savedName) this.flowController.setPlayerName(savedName);
        this.flowController.showMenu(() => this.handleJoinServer());

        this.soundToggle = new SoundToggleButton();

        // Initial position
        this.repositionUi();
    }

    /** "Tap to Start" from the boot menu — the player entity already exists (either from build(), or re-spawned by the death flow's Revive/Continue before showing this menu again), so this just unblocks input/joins the live population. */
    private handleJoinServer(): void {
        this.world3d.startNpcPopulation();
        // Eases camDist back out from the close-in menu zoom to the standard
        // value-driven distance (see BoundlessWorld3dScene/LinearWorld3dScene.build()).
        this.world3d.cameraZoom = 1.0;
        this.world3d.moveInput.x = 0;
        this.world3d.moveInput.z = 0;
        this.setFlowState('playing');
        this.leaderboard.show(); // only on an actual server join, not on every keep-size respawn — see onRespawnChoice
        this.movementHint.show();
    }

    /** Owns every side effect tied to "not playing" vs "playing" — movement input and the player's direction triangle both follow the same on/off switch, so a transition can't forget one of them (see the death → Continue bug this fixed). */
    private setFlowState(state: FlowState): void {
        this.flowState = state;
        const playing = state === 'playing';
        this.analogInput?.setEnabled(playing);
        this.pointerFollowInput?.setEnabled(playing);
        this.world3d.setPlayerIndicatorVisible(playing);
    }

    /** Tears down and rebuilds world3d from scratch — used for the initial boot and for "Continue" after death, since a freshly-built world always starts NPCs-dormant and zoomed in on its own (see BoundlessWorld3dScene/LinearWorld3dScene.build()), which is exactly the state a menu preview needs and a respawn-in-place can't guarantee. */
    private async spawnFreshWorld(): Promise<void> {
        this.worldRebuilding = true;
        this.world3d?.destroy();
        this.world3d = GATED_MODE
            ? new LinearWorld3dScene(this.game)
            : new BoundlessWorld3dScene(this.game);
        await this.world3d.build();
        this.worldRebuilding = false;
    }

    public update(delta: number): void {
        if (this.worldRebuilding) return; // world3d mid-rebuild (see spawnFreshWorld) — nothing below is safe to touch yet

        for (const s of this.statsWidgets) s.update();

        // Pointer-follow control scheme: recomputed every frame (rather than
        // event-driven like AnalogInput/KeyboardInputMovement) since the
        // player's on-screen anchor drifts under camera follow independent of
        // any pointer event — see PointerFollowInput.
        if (this.pointerFollowInput && this.world3d && this.flowState === 'playing') {
            const pointer = this.pointerFollowInput.getPointerPosition();
            const anchor = pointer && this.world3d.getPlayerScreenAnchor();
            if (pointer && anchor) {
                const dx = pointer.x - anchor.x;
                const dy = pointer.y - anchor.y;
                const dist = Math.hypot(dx, dy);
                if (dist > POINTER_FOLLOW_DEADZONE) {
                    this.movementHint.registerMove();
                    this.world3d.moveInput.x = dx / dist;
                    this.world3d.moveInput.z = dy / dist;
                } else {
                    this.world3d.moveInput.x = 0;
                    this.world3d.moveInput.z = 0;
                }
            } else {
                this.world3d.moveInput.x = 0;
                this.world3d.moveInput.z = 0;
            }
        }

        const scaledDelta = delta * this.speedMultiplier;
        this.world3d?.update(scaledDelta);

        if (this.world3d) {
            // Boost bar: project the player's 3D world position to a raw
            // screen-pixel point (world -> NDC -> CSS pixels, see
            // ThreeScene.worldToScreen), then convert that into
            // overlayContainer's own local space the same way Game.onResize
            // derives overlayScreenData — dividing by renderer.resolution
            // before toLocal, since Pixi's internal stage space is scaled
            // down from raw CSS pixels by that factor (see Game.onResize).
            const boostT = this.world3d.playerBoostT;
            let boostAnchor: { x: number; y: number } | null = null;
            if (boostT > 0) {
                const screen = this.world3d.getPlayerScreenAnchor();
                if (screen) {
                    const stagePoint = new PIXI.Point(screen.x / Game.renderer.resolution, screen.y / Game.renderer.resolution);
                    boostAnchor = this.game.overlayContainer.toLocal(stagePoint, this.game.app.stage);
                }
            }
            this.boostIndicator.update(boostT, boostAnchor);

            if (this.devPosLabel) {
                const pos = this.world3d.playerPosition;
                this.devPosLabel.text = `x: ${pos.x.toFixed(1)}  z: ${pos.z.toFixed(1)}`;
            }

            this.leaderboardTimer += delta;
            if (this.leaderboardTimer >= LEADERBOARD_UPDATE_INTERVAL) {
                this.leaderboardTimer = 0;
                this.leaderboard.update(this.world3d.listEntities());
            }

            const deathInfo = this.world3d.deathInfo;
            if (deathInfo && this.flowState !== 'dead') {
                this.setFlowState('dead');
                this.flowController.showDeath(
                    deathInfo,
                    (keepSize: DeathSnapshot) => {
                        // Revive (watched an ad) — resume the same run at the same size.
                        this.world3d.respawnPlayer(keepSize.value, keepSize.tailValues);
                        // moveInput lives on the scene, not the player, so it survives
                        // respawnPlayer() — without this reset, whatever direction was
                        // still held down the instant the player died (or the "Revive"
                        // button's own click/tap) gets applied to the fresh player the
                        // very next frame, reading as an unwanted instant lurch.
                        this.world3d.moveInput.x = 0;
                        this.world3d.moveInput.z = 0;
                        this.setFlowState('playing');
                    },
                    async () => {
                        // "Continue" from the End Game screen (via Next or the countdown
                        // running out) — back to the boot menu for a fresh join. Rebuilds
                        // world3d from scratch rather than respawning into the current
                        // (still fully active) world: NPCs never go dormant again once
                        // startNpcPopulation() has run once, so a fresh size-2 player
                        // dropped into that live, hostile world would just get eaten
                        // again before "Tap to Start" is even pressed. A rebuilt world
                        // starts NPCs-dormant and zoomed-in on its own — see
                        // spawnFreshWorld / BoundlessWorld3dScene.build().
                        await this.spawnFreshWorld();
                        this.setFlowState('menu');
                        // Back to a "haven't joined yet" state (fresh world, just like
                        // the very first boot) — hide the leaderboard again rather than
                        // showing a reset one with just "You" in it; handleJoinServer()
                        // re-shows it on the next real join.
                        this.leaderboard.hide();
                        this.flowController.showMenu(() => this.handleJoinServer());
                    },
                );
            }
        }

        // Reposition UI on screen resize (cheap check)
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (w !== this.lastW || h !== this.lastH) {
            this.lastW = w;
            this.lastH = h;
            this.repositionUi();
        }
    }

    public destroy(): void {
        for (const s of this.statsWidgets) s.dom.parentElement?.removeChild(s.dom);
        this.statsWidgets = [];
        this.world3d?.destroy();
        if (this.boostIndicator) {
            this.game.overlayContainer.removeChild(this.boostIndicator);
            this.boostIndicator.destroy();
        }
        this.leaderboard?.destroy();
        this.flowController?.destroy();
        this.soundToggle?.destroy();
        this.movementHint?.destroy();
        if (this.devPosLabel) {
            this.game.overlayContainer.removeChild(this.devPosLabel);
            this.devPosLabel.destroy();
        }
    }

    private repositionUi(): void {
        if (this.devPosLabel) {
            const { topRight } = Game.overlayScreenData;
            this.devPosLabel.position.set(topRight.x - 8, topRight.y + 8);
        }
    }
}
