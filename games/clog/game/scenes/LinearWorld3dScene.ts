import { ThreeScene } from 'core/scene/ThreeScene';
import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { PlayerEntity } from '../entities/PlayerEntity';
import { BendService } from '../services/BendService';
import { CollectibleManager } from '../systems/CollectibleManager';
import { LevelManager } from '../systems/LevelManager';
import { LinearAreaManager } from '../world/LinearAreaManager';
import { CAMERA_CONFIG, FOOD_CONFIG } from '../world/LinearConfig';
import FourCornersGradientBuilder from '../vfx/FourCornersGradientBuilder';
import type { EntityUiTarget } from './IWorld3dScene';
import type { LeaderboardEntry } from '../ui-dom/LeaderboardPanel';
import { Localization } from '../i18n/Localization';

const CAM_SMOOTH = 2.2; // exponential approach speed toward depth-driven target

export default class LinearWorld3dScene extends ThreeScene {

    private player!: PlayerEntity;
    private collectibles!: CollectibleManager;
    private levelManager!: LevelManager;
    private linearManager!: LinearAreaManager;
    private gradient = new FourCornersGradientBuilder();

    // Smoothed camera distance — approaches target derived from player value each frame
    private camDist = CAMERA_CONFIG.minDistance;

    /** True while actually playing — see setGameplayCameraActive. */
    private gameplayCameraActive = false;
    /** Smoothed world-unit lift applied to the camera's look target — eases toward CAMERA_CONFIG.mobileFocusOffset while gameplayCameraActive on mobile, back to 0 otherwise (menu/death, or desktop). */
    private cameraFocusOffset = 0;

    /** Zoom multiplier applied on top of the depth-driven target. 1 = default, >1 = further out. */
    public cameraZoom = 1.0;

    public moveInput: { x: number; z: number } = { x: 0, z: 0 };

    /** Dormant until startNpcPopulation() — gates the food spawn timer/top-up so it doesn't keep accumulating behind the menu screen. This mode has no NPCs, but still uses startNpcPopulation() as its "player has joined" signal (see IWorld3dScene). */
    private worldActive = false;

    // ── Exposed for Pixi HUD / minimap ────────────────────────────────────────

    get playerValue(): number { return this.player?.value ?? 0; }
    get playerScore(): number { return this.player?.score ?? 0; }
    get playerBoostT(): number { return this.player?.boostT ?? 0; }
    get currentRoomIndex(): number { return this.linearManager?.currentRoomIndex ?? 0; }
    get nextGateValue(): number { return this.linearManager?.nextGateValue ?? 0; }

    getPlayerScreenAnchor(): { x: number; y: number } | null {
        return this.player ? this.worldToScreen(this.player.uiAnchor) : null;
    }

    /** This mode has no bots — just the player (see IWorld3dScene.listEntityUiTargets). */
    public listEntityUiTargets(): EntityUiTarget[] {
        if (!this.player) return [];
        return [{
            id: 'player',
            name: Localization.getString('youTag'),
            boostT: this.player.boostT,
            screenAnchor: this.worldToScreen(this.player.uiAnchor),
        }];
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    public async build(): Promise<void> {
        this.threeScene.background = new THREE.Color(0x4ab8f0);
        this.threeScene.add(this.threeCamera);

        this.gradient.build({
            camera: this.threeCamera,
            mode: 'four-way',
            distance: 30,
            fourWay: {
                topColor: 0x4AB8F0,
                leftColor: 0x42aaee,
                bottomColor: 0x90d8f8,
                rightColor: 0x42aaee,
                radius: 1.5,
                speed: 0.03,
            },
        });



        this.threeScene.add(new THREE.AmbientLight(0xffffff, 0.9));
        const key = new THREE.DirectionalLight(0xfff4dd, 1.6);  // warm key from above-right
        key.position.set(5, 10, 7.5);
        this.threeScene.add(key);
        const fill = new THREE.DirectionalLight(0x99ccff, 0.5); // cool fill from left
        fill.position.set(-8, 3, -5);
        this.threeScene.add(fill);

        this.linearManager = new LinearAreaManager(this.threeScene);
        this.collectibles = new CollectibleManager();
        this.levelManager = new LevelManager();

        this.linearManager.onTransition = ({ prevMinZ, prevMaxZ }) => {
            this.collectibles.clearInZRange(prevMinZ, prevMaxZ);
            this.spawnFoodInGrid(this.linearManager.nextConfig.foodValues, FOOD_CONFIG.initialCount, this.linearManager.nextGrid);
        };

        // Seed food in rooms 0 and 1 at startup.
        this.spawnFoodInGrid(this.linearManager.currentConfig.foodValues, FOOD_CONFIG.initialCount, this.linearManager.currentGrid);
        this.spawnFoodInGrid(this.linearManager.nextConfig.foodValues, FOOD_CONFIG.initialCount, this.linearManager.nextGrid);

        this.player = new PlayerEntity(2, this.threeScene);
        this.linearManager.registerPlayer(this.player);

        // Start zoomed in close on the menu screen — camDist eases out to the
        // standard distance once startNpcPopulation() flips cameraZoom back
        // to 1.0 (see BaseDemoScene.handleJoinServer).
        this.cameraZoom = CAMERA_CONFIG.menuZoom;
        this.camDist = CAMERA_CONFIG.minDistance * this.cameraZoom;

        const initPitch = CAMERA_CONFIG.pitch * Math.PI / 180;
        this.threeCamera.position.copy(this.player.position).add(
            new THREE.Vector3(0, Math.sin(initPitch) * this.camDist, Math.cos(initPitch) * this.camDist),
        );
        this.threeCamera.lookAt(this.player.position);
    }

    public update(delta: number): void {
        const cfg = this.linearManager.currentConfig;

        // ── Value-driven camera distance ──────────────────────────────────────
        // Interpolates in log2 space so doubling value = equal steps in distance.
        const log2Val = Math.log2(Math.max(2, this.player.value));
        const log2Max = Math.log2(Math.max(2, CAMERA_CONFIG.maxAtValue));
        const distT = Math.min(log2Val / log2Max, 1);
        const targetDist = (CAMERA_CONFIG.minDistance + distT * (CAMERA_CONFIG.maxDistance - CAMERA_CONFIG.minDistance)) * this.cameraZoom;
        const t = 1 - Math.exp(-CAM_SMOOTH * delta);
        this.camDist += (targetDist - this.camDist) * t;

        // ── Speed scale — bigger rooms run slightly slower ─────────────────
        const scaledDelta = delta;

        this.gradient.update(scaledDelta);

        this.player.setMoveInput(this.moveInput.x, this.moveInput.z);
        this.player.update(scaledDelta);
        BendService.updateOrigin(this.player.position);

        this.linearManager.update(this.player);
        this.collectibles.update(scaledDelta);

        const hit = this.collectibles.checkCollision(this.player.position, this.player.foodRadius);
        if (hit) this.player.collect(hit);

        // Food top-up — dormant until the player joins (see worldActive), so
        // food doesn't keep accumulating behind the menu screen.
        if (this.worldActive) {
            const grid = this.linearManager.currentGrid;
            const cz = this.linearManager.spawnCenter.y;
            const hs = this.linearManager.spawnHalfSize;
            this.levelManager.update(
                scaledDelta,
                this.collectibles,
                this.threeScene,
                this.player.position,
                () => {
                    const values = this.linearManager.effectiveFoodValues;
                    return values[Math.floor(Math.random() * values.length)];
                },
                grid.getFreeCells(),
                cz - hs,
                cz + hs,
                this.linearManager.computedFoodCount,
            );
        }

        const pitch = CAMERA_CONFIG.pitch * Math.PI / 180;
        const camOffset = new THREE.Vector3(0, Math.sin(pitch) * this.camDist, Math.cos(pitch) * this.camDist);
        const posT = 1 - Math.exp(-CAMERA_CONFIG.followSpeed * delta);
        this.threeCamera.position.lerp(this.player.position.clone().add(camOffset), posT);

        const targetFocusOffset = (this.gameplayCameraActive && PIXI.isMobile.any) ? CAMERA_CONFIG.mobileFocusOffset : 0;
        this.cameraFocusOffset += (targetFocusOffset - this.cameraFocusOffset) * posT;
        this.threeCamera.lookAt(this.player.position.x, this.player.position.y + this.cameraFocusOffset, this.player.position.z);

        super.update(delta);
    }

    public debugDoublePlayerValue(): void {
        this.player.debugDoubleValue();
    }

    public setPlayerBoosting(active: boolean): void {
        this.player?.setBoosting(active);
    }

    /** This mode has no death/respawn flow — see the deathInfo/respawnPlayer no-ops below. */
    public debugKillPlayer(): void { /* no-op */ }

    /** Debug-only: drops `count` food items into the current room using the same spawn logic as the initial room seeding. */
    public spawnFood(count: number): void {
        this.spawnFoodInGrid(this.linearManager.currentConfig.foodValues, count, this.linearManager.currentGrid);
    }

    /** Debug-only: this mode has no bots, so just the player. */
    public listEntities(): LeaderboardEntry[] {
        return [{ name: Localization.getString('you'), value: this.player.value, score: this.player.score, isYou: true }];
    }

    /** This mode has no death/respawn flow — the gated linear-room progression is out of scope for it. */
    get deathInfo(): null { return null; }
    public respawnPlayer(_value: number, _tailValues: number[]): void { /* no-op */ }
    /** This mode has no NPC population, but still uses this as the "player has joined" signal to start the food spawn timer/top-up (see worldActive). */
    public startNpcPopulation(): void { this.worldActive = true; }

    public setPlayerIndicatorVisible(visible: boolean): void {
        this.player?.setEatIndicatorVisible(visible);
    }

    public setGameplayCameraActive(active: boolean): void {
        this.gameplayCameraActive = active;
    }

    public destroy(): void {
        this.gradient.destroy();
        this.player?.destroy();
        this.collectibles?.destroy();
        this.linearManager?.destroy();
        super.destroy();
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private spawnFoodInGrid(
        values: number[],
        count: number,
        grid: { getFreeCells(): { x: number; z: number }[] },
    ): void {
        const cells = grid.getFreeCells();
        if (cells.length === 0) return;
        for (let i = 0; i < count; i++) {
            const cell = cells[Math.floor(Math.random() * cells.length)];
            const value = values[Math.floor(Math.random() * values.length)];
            this.collectibles.spawnOne(this.threeScene, new THREE.Vector3(cell.x, 0, cell.z), value);
        }
    }
}
