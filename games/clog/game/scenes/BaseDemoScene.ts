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
import { ScoreLeaderboard } from '../ui/ScoreLeaderboard';
import Stats from 'stats.js';

// ?gated re-enables the linear room / gate progression mode.
const GATED_MODE = new URLSearchParams(window.location.search).has('gated');

export default class BaseDemoScene extends GameScene {

    private speedMultiplier = 1;
    private world3d!: IWorld3dScene;
    private analogInput!: AnalogInput;
    private keyboardInput!: KeyboardInputMovement;
    private hud!: PlayerHud;
    private leaderboard!: ScoreLeaderboard;
    private lastW = 0;
    private lastH = 0;
    private statsWidgets: Stats[] = [];
    private devPosLabel: PIXI.Text | null = null;

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
            this.world3d.moveInput.x = direction.x * magnitude;
            this.world3d.moveInput.z = direction.y * magnitude;
        });

        this.keyboardInput = new KeyboardInputMovement();
        this.keyboardInput.onMove.add(({ direction, magnitude }) => {
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
            [0.2, 4.0],
            'Camera Zoom',
            'Camera',
        );

        // AI debug view — snap the camera way out so entity behavior is visible
        // at a glance instead of manually dragging the zoom slider each time.
        DevGuiManager.instance.addToggle('Debug Zoom Out', false, (isZoomedOut) => {
            this.world3d.cameraZoom = isZoomedOut ? 4.0 : 1.0;
        }, 'Camera');

        // Fast-forwards the whole sim (bots, food spawns, merges — everything
        // downstream of the delta this scene hands to world3d.update()) so
        // long-term AI behavior can be watched/logged without waiting for it
        // in real time. 1 = normal speed, 0 = paused.
        DevGuiManager.instance.addProperties(this, ['speedMultiplier'], [0, 10], 'Sim Speed', 'Simulation');

        // Pixi HUD — bottom-left player status
        this.hud = new PlayerHud();
        this.addChild(this.hud);

        // Pixi leaderboard — bottom-right player scores
        this.leaderboard = new ScoreLeaderboard();
        this.addChild(this.leaderboard);

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

        // Initial position
        this.repositionUi();
    }

    public update(delta: number): void {
        for (const s of this.statsWidgets) s.update();
        const scaledDelta = delta * this.speedMultiplier;
        this.world3d?.update(scaledDelta);

        // Sync HUD and leaderboard with current game state
        if (this.hud && this.world3d) {
            this.hud.update(this.world3d.playerValue);
            this.leaderboard.update([
                { name: 'You', score: this.world3d.playerScore, isYou: true },
            ]);
            this.leaderboard.reposition();
            if (this.devPosLabel) {
                const pos = this.world3d.playerPosition;
                this.devPosLabel.text = `x: ${pos.x.toFixed(1)}  z: ${pos.z.toFixed(1)}`;
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
        this.leaderboard?.destroy();
        if (this.devPosLabel) {
            this.game.overlayContainer.removeChild(this.devPosLabel);
            this.devPosLabel.destroy();
        }
    }

    private repositionUi(): void {
        this.hud?.reposition();
        this.leaderboard?.reposition();
        if (this.devPosLabel) {
            const { topRight } = Game.overlayScreenData;
            this.devPosLabel.position.set(topRight.x - 8, topRight.y + 8);
        }
    }
}
