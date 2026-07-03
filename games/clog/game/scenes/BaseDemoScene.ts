import { GameScene } from '@core/scene/GameScene';
import AnalogInput from '@core/io/AnalogInput';
import * as PIXI from 'pixi.js';
import KeyboardInputMovement from 'core/io/KeyboardInputMovement';
import { DevGuiManager } from '@core/utils/DevGuiManager';
import { Game } from '@core/Game';
import LinearWorld3dScene from './LinearWorld3dScene';
import BoundlessWorld3dScene from './BoundlessWorld3dScene';
import type { IWorld3dScene } from './IWorld3dScene';
import { PlayerHud } from '../ui/PlayerHud';
import { BoostIndicator } from '../ui/BoostIndicator';
import { LeaderboardPanel } from '../ui-dom/LeaderboardPanel';
import { PlayerFlowController, type DeathSnapshot } from '../ui-dom/PlayerFlowController';
import PlatformHandler from '@core/platforms/PlatformHandler';
import Stats from 'stats.js';

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
    private hud!: PlayerHud;
    private boostIndicator!: BoostIndicator;
    private lastW = 0;
    private lastH = 0;
    private statsWidgets: Stats[] = [];
    private devPosLabel: PIXI.Text | null = null;
    private leaderboard!: LeaderboardPanel;
    private leaderboardTimer = 0;
    private flowController!: PlayerFlowController;
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

        this.analogInput = new AnalogInput(this);
        this.analogInput.onMove.add(({ direction, magnitude }) => {
            if (!this.gameJoined) return;
            this.world3d.moveInput.x = direction.x * magnitude;
            this.world3d.moveInput.z = direction.y * magnitude;
        });

        this.keyboardInput = new KeyboardInputMovement();
        this.keyboardInput.onMove.add(({ direction, magnitude }) => {
            if (!this.gameJoined) return;
            this.world3d.moveInput.x = direction.x * magnitude;
            this.world3d.moveInput.z = direction.y * magnitude;
        });

        DevGuiManager.instance.addButton('Double Value', () => {
            this.world3d.debugDoublePlayerValue();
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

        // Pixi HUD — bottom-left player status
        this.hud = new PlayerHud();
        this.addChild(this.hud);

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

        // Menu/Shop/Rename/Death — one DOM overlay, no scene change (see
        // PlayerFlowController). The 3D world above is already fully live at
        // this point (player spawned, NPCs simulating); the menu just gates
        // movement input until "Join Server" so the still-centered player
        // reads as a preview instead of drifting off unattended.
        this.flowController = new PlayerFlowController();
        const savedName = await PlatformHandler.instance.platform.getItem(PLAYER_NAME_KEY);
        if (savedName) this.flowController.setPlayerName(savedName);
        this.flowController.showMenu(() => this.handleJoinServer());

        // Initial position
        this.repositionUi();
    }

    /** "Join Server" from the menu — either the very first one (player already exists from build(), just unblock input) or a re-join after death (via "Join Another Server"), which needs an actual fresh respawn first. */
    private handleJoinServer(): void {
        if (this.world3d.deathInfo) {
            this.world3d.respawnPlayer(2, []);
        }
        this.world3d.startNpcPopulation();
        this.world3d.moveInput.x = 0;
        this.world3d.moveInput.z = 0;
        this.gameJoined = true;
    }

    public update(delta: number): void {
        for (const s of this.statsWidgets) s.update();
        const scaledDelta = delta * this.speedMultiplier;
        this.world3d?.update(scaledDelta);

        // Sync HUD with current game state
        if (this.hud && this.world3d) {
            this.hud.update(this.world3d.playerValue);

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
                this.flowController.showDeath(
                    deathInfo,
                    (keepSize: DeathSnapshot | null) => {
                        this.deathOverlayOpen = false;
                        this.world3d.respawnPlayer(keepSize?.value ?? 2, keepSize?.tailValues ?? []);
                        this.gameJoined = true;
                    },
                    () => {
                        this.deathOverlayOpen = false;
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
        this.hud?.destroy();
        if (this.boostIndicator) {
            this.game.overlayContainer.removeChild(this.boostIndicator);
            this.boostIndicator.destroy();
        }
        this.leaderboard?.destroy();
        this.flowController?.destroy();
        if (this.devPosLabel) {
            this.game.overlayContainer.removeChild(this.devPosLabel);
            this.devPosLabel.destroy();
        }
    }

    private repositionUi(): void {
        this.hud?.reposition();
        if (this.devPosLabel) {
            const { topRight } = Game.overlayScreenData;
            this.devPosLabel.position.set(topRight.x - 8, topRight.y + 8);
        }
    }
}
