import { GameScene } from '@core/scene/GameScene';
import AnalogInput from '@core/io/AnalogInput';
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

// How often the leaderboard rebuilds its rows — every frame would be wasted
// DOM churn for something that only needs to look "live," not exact.
const LEADERBOARD_UPDATE_INTERVAL = 0.5;

export default class BaseDemoScene extends GameScene {

    private speedMultiplier = 1;
    private world3d!: IWorld3dScene;
    private analogInput!: AnalogInput;
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
    /** True once "Join Server" has been pressed — gates movement input so the world (bots/food/camera-follow) keeps running underneath the menu/death overlay while the player itself stays put. */
    private gameJoined = false;
    /** Guards against re-showing the death overlay every frame while world3d.deathInfo stays non-null. */
    private deathOverlayOpen = false;

    public async build(): Promise<void> {
        this.world3d = GATED_MODE
            ? new LinearWorld3dScene(this.game)
            : new BoundlessWorld3dScene(this.game);
        await this.world3d.build();

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

        this.analogInput = new AnalogInput(this);
        this.analogInput.onMove.add(({ direction, magnitude }) => {
            if (!this.gameJoined) return;
            if (magnitude > 0) this.movementHint.registerMove();
            this.world3d.moveInput.x = direction.x * magnitude;
            this.world3d.moveInput.z = direction.y * magnitude;
        });

        this.keyboardInput = new KeyboardInputMovement();
        this.keyboardInput.onMove.add(({ direction, magnitude }) => {
            if (!this.gameJoined) return;
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
        this.analogInput.setEnabled(false);
        this.world3d.setPlayerIndicatorVisible(false);

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
        this.gameJoined = true;
        this.analogInput.setEnabled(true);
        this.world3d.setPlayerIndicatorVisible(true);
        this.leaderboard.show(); // only on an actual server join, not on every keep-size respawn — see onRespawnChoice
        this.movementHint.show();
    }

    public update(delta: number): void {
        for (const s of this.statsWidgets) s.update();
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
            if (deathInfo && !this.deathOverlayOpen) {
                this.deathOverlayOpen = true;
                this.gameJoined = false; // stop forwarding input while there's no live player to receive it
                this.analogInput.setEnabled(false);
                this.world3d.setPlayerIndicatorVisible(false);
                this.flowController.showDeath(
                    deathInfo,
                    (keepSize: DeathSnapshot) => {
                        // Revive (watched an ad) — resume the same run at the same size.
                        this.deathOverlayOpen = false;
                        this.world3d.respawnPlayer(keepSize.value, keepSize.tailValues);
                        // moveInput lives on the scene, not the player, so it survives
                        // respawnPlayer() — without this reset, whatever direction was
                        // still held down the instant the player died (or the "Revive"
                        // button's own click/tap) gets applied to the fresh player the
                        // very next frame, reading as an unwanted instant lurch.
                        this.world3d.moveInput.x = 0;
                        this.world3d.moveInput.z = 0;
                        this.gameJoined = true;
                        this.analogInput.setEnabled(true);
                        this.world3d.setPlayerIndicatorVisible(true);
                    },
                    () => {
                        // "Continue" from the End Game screen (via Next or the countdown
                        // running out) — back to the boot menu for a fresh join. Respawns
                        // right away (rather than waiting for "Tap to Start") for two
                        // reasons: it clears world3d.deathInfo, so this file's own
                        // deathInfo-triggers-showDeath check above doesn't immediately
                        // re-fire and hijack the menu we're about to show; and it gives
                        // the boot menu a live player to preview behind it again, same
                        // as the very first boot (see build()'s comment on this scene).
                        this.deathOverlayOpen = false;
                        this.world3d.respawnPlayer(2, []);
                        this.world3d.setPlayerIndicatorVisible(false); // still not joined — stays hidden until handleJoinServer
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
