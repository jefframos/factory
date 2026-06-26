import { GameScene } from '@core/scene/GameScene';
import AnalogInput from '@core/io/AnalogInput';
import * as PIXI from 'pixi.js';
import KeyboardInputMovement from 'core/io/KeyboardInputMovement';
import { DevGuiManager } from '@core/utils/DevGuiManager';
import LinearWorld3dScene from './LinearWorld3dScene';
import { PlayerHud } from '../ui/PlayerHud';
import { LinearMinimap } from '../ui/LinearMinimap';
import { ScoreLeaderboard } from '../ui/ScoreLeaderboard';

// To switch back to the dungeon layout import ClogWorld3dScene and replace
// LinearWorld3dScene below. Both scenes co-exist; only one is active at a time.

export default class BaseDemoScene extends GameScene {

    private speedMultiplier = 1;
    private world3d!: LinearWorld3dScene;
    private analogInput!: AnalogInput;
    private keyboardInput!: KeyboardInputMovement;
    private hud!: PlayerHud;
    private minimap!: LinearMinimap;
    private leaderboard!: ScoreLeaderboard;
    private lastW = 0;
    private lastH = 0;

    public async build(): Promise<void> {
        this.world3d = new LinearWorld3dScene(this.game);
        await this.world3d.build();

        this.eventMode = 'static';
        this.hitArea   = new PIXI.Rectangle(-2000, -2000, 6000, 6000);

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

        DevGuiManager.instance.addObjectTrigger(
            { zoom: 1.0 },
            (v) => { this.world3d.cameraZoom = v.zoom; },
            ['zoom'],
            [0.2, 4.0],
            'Camera Zoom',
            'Camera',
        );

        // Pixi HUD — bottom-left player status
        this.hud = new PlayerHud();
        this.addChild(this.hud);

        // Pixi minimap — top-right room ladder
        this.minimap = new LinearMinimap();
        this.addChild(this.minimap);

        // Pixi leaderboard — top-left player scores
        this.leaderboard = new ScoreLeaderboard();
        this.addChild(this.leaderboard);

        // Initial position
        this.repositionUi(window.innerWidth, window.innerHeight);
        this.minimap.update(0);
    }

    public update(delta: number): void {
        const scaledDelta = delta * this.speedMultiplier;
        this.world3d?.update(scaledDelta);

        // Sync HUD, minimap, and leaderboard with current game state
        if (this.hud && this.world3d) {
            this.hud.update(
                this.world3d.playerValue,
                this.world3d.nextGateValue,
                this.world3d.currentRoomIndex,
            );
            this.minimap.update(this.world3d.currentRoomIndex);
            this.leaderboard.update([
                { name: 'You', score: this.world3d.playerScore, isYou: true },
            ]);
        }

        // Reposition UI on screen resize (cheap check)
        const w = window.innerWidth;
        const h = window.innerHeight;
        if (w !== this.lastW || h !== this.lastH) {
            this.lastW = w;
            this.lastH = h;
            this.repositionUi(w, h);
        }
    }

    public destroy(): void {
        this.world3d?.destroy();
        this.hud?.destroy();
        this.minimap?.destroy();
        this.leaderboard?.destroy();
    }

    private repositionUi(w: number, h: number): void {
        this.hud?.reposition(w, h);
        this.minimap?.reposition(w);
        this.leaderboard?.reposition(w, h);
    }
}
