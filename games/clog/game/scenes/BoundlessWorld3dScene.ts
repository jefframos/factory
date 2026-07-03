import { ThreeScene } from '@core/scene/ThreeScene';
import * as THREE from 'three';
import { PlayerEntity } from '../entities/PlayerEntity';
import { BendService } from '../services/BendService';
import { CollectibleManager } from '../systems/CollectibleManager';
import { LevelManager } from '../systems/LevelManager';
import { BoundlessChunkManager } from '../world/BoundlessChunkManager';
import { CAMERA_CONFIG, FOOD_CONFIG } from '../world/LinearConfig';
import { ROOM_GEOMETRY } from '../world/MeshConfig';
import { createWaterMaterial } from '../builders/WaterMaterial';
import { FloorBuilder } from '../builders/FloorBuilder';
import FourCornersGradientBuilder from '../vfx/FourCornersGradientBuilder';
import { CloudSystem } from '../vfx/CloudSystem';
import type { IWorld3dScene } from './IWorld3dScene';
import { PerfOverlay } from '../utils/PerfOverlay';
import SetupThree from '@core/scene/SetupThree';
import { SimWorld } from '../sim/SimWorld';
import { resolveEntityEating } from '../sim/EntityEating';
import { BotController } from '../ai/BotController';
import type { BotParams } from '../ai/Blackboard';
import { DevGuiManager } from '@core/utils/DevGuiManager';

const PERF_MODE = new URLSearchParams(window.location.search).has('perf');

const CAM_SMOOTH = 2.2;
const SPAWN_RADIUS = 60;     // world-unit radius around player where food can spawn
const BOT_MIN_DIST = 10;     // minimum world-unit distance from the player when spawning a bot
const RESPAWN_DELAY = 2.5;   // seconds the camera lingers on the death spot before the player respawns

// Derive food value pool from player value — mirrors room progression tiers.
function foodValuesForValue(v: number): number[] {
    if (v < 8) return [2];
    if (v < 32) return [2, 4];
    if (v < 128) return [4];
    if (v < 512) return [4, 8];
    if (v < 2048) return [8];
    if (v < 8192) return [8, 16];
    return [16, 32];
}

export default class BoundlessWorld3dScene extends ThreeScene implements IWorld3dScene {

    private player!: PlayerEntity;
    private collectibles!: CollectibleManager;
    private levelManager!: LevelManager;
    private chunkManager!: BoundlessChunkManager;
    private gradient = new FourCornersGradientBuilder();
    private cloudSystem?: CloudSystem;
    private floorMesh!: THREE.Mesh;
    private floorMat!: THREE.Material;
    private camDist = CAMERA_CONFIG.minDistance;
    private perfOverlay: PerfOverlay | null = null;
    private botControllers: BotController[] = [];
    /** Seconds left before the player respawns; null while alive. */
    private respawnTimer: number | null = null;
    /** The 4 bots spawned by the "AI Debug" panel — tracked separately so the panel can target just them. */
    private debugBotControllers: BotController[] = [];

    public cameraZoom = 1.0;
    public moveInput: { x: number; z: number } = { x: 0, z: 0 };

    // ── Accessors for HUD / minimap ───────────────────────────────────────────

    get playerValue(): number { return this.player?.value ?? 0; }
    get playerScore(): number { return this.player?.score ?? 0; }
    get playerPosition(): { x: number; z: number } {
        return { x: this.player?.position.x ?? 0, z: this.player?.position.z ?? 0 };
    }
    get currentRoomIndex(): number { return 0; }
    get nextGateValue(): number { return 0; }

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
        const key = new THREE.DirectionalLight(0xfff4dd, 1.6);
        key.position.set(5, 10, 7.5);
        this.threeScene.add(key);
        const fill = new THREE.DirectionalLight(0x99ccff, 0.5);
        fill.position.set(-8, 3, -5);
        this.threeScene.add(fill);

        this.floorMesh = this.buildFloor();

        this.collectibles = new CollectibleManager();
        this.levelManager = new LevelManager();
        this.chunkManager = new BoundlessChunkManager(this.threeScene, this.collectibles);

        this.player = new PlayerEntity(2, this.threeScene);

        SimWorld.init(this.collectibles, this.chunkManager);
        SimWorld.register(this.player);
        SimWorld.setPlayer(this.player);

        // Seed the starting chunks and initial food.
        this.chunkManager.update(this.player);
        this.seedInitialFood();

        // Force shader/pipeline compilation for the tile materials now, while the
        // scene isn't visible yet, instead of paying for it as a dropped frame the
        // first time the player sees this geometry mid-gameplay.
        SetupThree.renderer?.compile(this.threeScene, this.threeCamera);

        //this.cloudSystem = new CloudSystem()
        //this.cloudSystem.build(this.threeScene);
        if (PERF_MODE) this.perfOverlay = new PerfOverlay();

        this.buildAiDebugPanel();

        const initPitch = CAMERA_CONFIG.pitch * Math.PI / 180;
        this.threeCamera.position.copy(this.player.position).add(
            new THREE.Vector3(0, Math.sin(initPitch) * this.camDist, Math.cos(initPitch) * this.camDist),
        );
        this.threeCamera.lookAt(this.player.position);
    }

    public update(delta: number): void {
        this.gradient.update(delta);

        if (this.respawnTimer !== null) {
            this.updateDead(delta);
            return;
        }

        // ── Value-driven camera distance ──────────────────────────────────────
        const log2Val = Math.log2(Math.max(2, this.player.value));
        const log2Max = Math.log2(Math.max(2, CAMERA_CONFIG.maxAtValue));
        const distT = Math.min(log2Val / log2Max, 1);
        const target = (CAMERA_CONFIG.minDistance + distT * (CAMERA_CONFIG.maxDistance - CAMERA_CONFIG.minDistance)) * this.cameraZoom;
        this.camDist += (target - this.camDist) * (1 - Math.exp(-CAM_SMOOTH * delta));

        this.cloudSystem?.update(delta, this.player.position.x, this.player.position.z);

        this.player.setMoveInput(this.moveInput.x, this.moveInput.z);
        this.player.update(delta);
        this.updateBots(delta);
        BendService.updateOrigin(this.player.position);

        // Chunk streaming + collision
        this.chunkManager.update(this.player);

        // Floor follows player
        this.floorMesh.position.x = this.player.position.x;
        this.floorMesh.position.z = this.player.position.z;

        this.collectibles.update(delta);

        const hit = this.collectibles.checkCollision(this.player.eatPosition, this.player.eatRadius);
        if (hit) this.player.collect(hit);

        const eaten = resolveEntityEating(
            [this.player, ...this.botControllers.map(c => c.entity)],
            this.collectibles,
        );
        if (eaten.length > 0) {
            this.botControllers = this.botControllers.filter(c => !eaten.includes(c.entity));
            if (eaten.includes(this.player)) {
                // Don't respawn immediately — let the camera linger on the death
                // spot so the player can see the killer absorb the scattered drop.
                this.respawnTimer = RESPAWN_DELAY;
            }
        }

        // Food top-up
        const pz = this.player.position.z;
        const freeCells = this.chunkManager.getFreeCellsNear(this.player.position.x, pz, SPAWN_RADIUS);
        const maxFood = Math.min(FOOD_CONFIG.maxAbsolute, Math.max(FOOD_CONFIG.minAbsolute, Math.floor(freeCells.length / 8)));
        this.levelManager.update(
            delta,
            this.collectibles,
            this.threeScene,
            this.player.position,
            foodValuesForValue(this.player.value),
            freeCells,
            pz - SPAWN_RADIUS,
            pz + SPAWN_RADIUS,
            maxFood,
        );

        // Camera follow
        const pitch = CAMERA_CONFIG.pitch * Math.PI / 180;
        const camOffset = new THREE.Vector3(0, Math.sin(pitch) * this.camDist, Math.cos(pitch) * this.camDist);
        const posT = 1 - Math.exp(-CAMERA_CONFIG.followSpeed * delta);
        this.threeCamera.position.lerp(this.player.position.clone().add(camOffset), posT);
        this.threeCamera.lookAt(this.player.position);

        super.update(delta);

        if (this.perfOverlay) {
            this.perfOverlay.update({
                ...this.chunkManager.getStats(),
                triangles: SetupThree.renderer?.info.render.triangles ?? 0,
            });
        }
    }

    /** Ticks every bot's AI + movement + wall collision + its own food pickup. Shared by the alive and dead update paths. */
    private updateBots(delta: number): void {
        for (const controller of this.botControllers) {
            controller.update(delta);
            controller.entity.update(delta);
            // Bots only avoid walls via a heuristic steering probe (SimWorld.resolveDirection),
            // which can miss thin/angled obstacles — this physical push-out (same as the
            // player) is the safety net that stops a bad probe from clipping into a wall
            // and getting stuck there permanently.
            this.chunkManager.resolveEntityCollisions(controller.entity.position, controller.entity.collisionRadius);
            const hit = this.collectibles.checkCollision(controller.entity.eatPosition, controller.entity.eatRadius);
            if (hit) controller.entity.collect(hit);
        }
    }

    /**
     * Runs while the player is dead: bots and food keep simulating (so the
     * killer can be seen absorbing the scattered drop) but the camera stays
     * frozen on the death spot and no player logic runs. Respawns once
     * `respawnTimer` elapses.
     */
    private updateDead(delta: number): void {
        const timer = (this.respawnTimer ?? 0) - delta;
        this.respawnTimer = timer;

        this.updateBots(delta);
        this.collectibles.update(delta);

        const eaten = resolveEntityEating(this.botControllers.map(c => c.entity), this.collectibles);
        if (eaten.length > 0) {
            this.botControllers = this.botControllers.filter(c => !eaten.includes(c.entity));
        }

        super.update(delta);

        if (timer <= 0) {
            this.respawnTimer = null;
            this.respawnPlayer();
        }
    }

    /**
     * Spawns a behaviour-tree-driven bot entity near the player.
     * @param value The game value for the entity (must be a power of 2, e.g. 16 = 2×2×2×2).
     * @param params Optional personality overrides (aggressiveness, awarenessRadius, etc).
     */
    public spawnBot(value: number, params?: Partial<BotParams>): void {
        this.spawnBotNear(this.player.position.x, this.player.position.z, value, params);
    }

    private spawnBotNear(px: number, pz: number, value: number, params?: Partial<BotParams>): BotController | null {
        const cells = this.chunkManager.getFreeCellsNear(px, pz, SPAWN_RADIUS);
        if (cells.length === 0) return null;

        const minDist2 = BOT_MIN_DIST * BOT_MIN_DIST;
        const candidates = cells.filter(c => {
            const dx = c.x - px;
            const dz = c.z - pz;
            return dx * dx + dz * dz >= minDist2;
        });

        const pool = candidates.length > 0 ? candidates : cells;
        const cell  = pool[Math.floor(Math.random() * pool.length)];

        const bot = new PlayerEntity(value, this.threeScene);
        bot.position.set(cell.x, 0, cell.z);

        SimWorld.register(bot);
        const controller = new BotController(bot, params);
        this.botControllers.push(controller);
        return controller;
    }

    public debugDoublePlayerValue(): void {
        this.player?.debugDoubleValue();
    }

    /** Debug-only: drops `count` food items near the player using the same spawn logic as seedInitialFood/LevelManager. */
    public spawnFood(count: number): void {
        const cells = this.chunkManager.getFreeCellsNear(this.player.position.x, this.player.position.z, SPAWN_RADIUS);
        if (cells.length === 0) return;
        const values = foodValuesForValue(this.player.value);
        for (let i = 0; i < count; i++) {
            const cell = cells[Math.floor(Math.random() * cells.length)];
            const value = values[Math.floor(Math.random() * values.length)];
            this.collectibles.spawnOne(this.threeScene, new THREE.Vector3(cell.x, 0, cell.z), value);
        }
    }

    /** Tears down and re-creates the player entity after being eaten — mirrors the initial spawn in build(). */
    private respawnPlayer(): void {
        const cells = this.chunkManager.getFreeCellsNear(0, 0, SPAWN_RADIUS);
        const cell = cells.length > 0 ? cells[Math.floor(Math.random() * cells.length)] : { x: 0, z: 0 };

        this.player = new PlayerEntity(2, this.threeScene);
        this.player.position.set(cell.x, 0, cell.z);
        SimWorld.register(this.player);
        SimWorld.setPlayer(this.player);
    }

    // ── AI debug panel (dat.GUI, only rendered when DevGuiManager is dev-initialized, i.e. ?dev=1) ──

    private buildAiDebugPanel(): void {
        DevGuiManager.instance.addButton('Spawn 4 Debug Bots', () => this.spawnDebugBots(), 'AI Debug');
        DevGuiManager.instance.addToggle('Pause All', false, (paused) => {
            for (const c of this.debugBotControllers) c.paused = paused;
        }, 'AI Debug');
    }

    /** Spawns 4 bots that ignore the player (so they only react to each other/food) and exposes each one's tunables + live state. No-ops if already spawned — re-running would bind new controllers under folders dat.GUI can't clean up. */
    private spawnDebugBots(): void {
        if (this.debugBotControllers.length > 0) return;

        for (let i = 0; i < 4; i++) {
            const controller = this.spawnBotNear(this.player.position.x, this.player.position.z, 16);
            if (!controller) continue;
            controller.blackboard.ignorePlayer = true;
            this.debugBotControllers.push(controller);

            const folder = `AI Bot ${i + 1}`;
            const label = `Bot${i + 1}`;
            DevGuiManager.instance.addProperties(controller.blackboard.params, ['aggressiveness', 'fleeThreshold', 'wanderSpeed'], [0, 1], label, folder);
            DevGuiManager.instance.addProperties(controller.blackboard.params, ['awarenessRadius', 'leashRadius'], [0, 100], label, folder);
            DevGuiManager.instance.addToggle('Ignore Player', true, (v) => { controller.blackboard.ignorePlayer = v; }, folder);
            DevGuiManager.instance.addToggle('Paused', false, (v) => { controller.paused = v; }, folder);
            // Per-bot so you can isolate whichever one you catch stuck instead
            // of drowning it in every other bot's lines too.
            DevGuiManager.instance.addToggle('Log AI (console)', false, (v) => { controller.logging = v; }, folder);
            DevGuiManager.instance.addReadout(controller.debug, ['x', 'z', 'value', 'state'], label, folder);
            // Live bar — drifts on its own (see BotController.updateBraveness),
            // not something you set; watch it to see when a bot is about to
            // risk sneaking up on a tail cube (BRAVE_THRESHOLD).
            DevGuiManager.instance.addReadout(controller.blackboard, ['braveness'], label, folder, [0, 1]);
        }
    }

    public destroy(): void {
        for (const { entity: bot } of this.botControllers) {
            SimWorld.unregister(bot);
            bot.destroy();
        }
        this.botControllers = [];
        this.debugBotControllers = [];
        SimWorld.reset();
        this.perfOverlay?.destroy();
        this.cloudSystem?.destroy(this.threeScene);
        this.gradient.destroy();
        this.player?.destroy();
        this.collectibles?.destroy();
        this.chunkManager?.destroy();
        this.threeScene.remove(this.floorMesh);
        this.floorMesh?.geometry.dispose();
        this.floorMat?.dispose();
        super.destroy();
    }

    // ── Private ───────────────────────────────────────────────────────────────

    private seedInitialFood(): void {
        this.spawnFood(FOOD_CONFIG.initialCount);
    }

    private buildFloor(): THREE.Mesh {
        const SIZE = 160;
        const SEGMENTS = 64;
        const { shader: floorShader, opacity, elevation, waterColors, roughness } = ROOM_GEOMETRY.floor;

        let mat: THREE.Material;
        if (floorShader === 'water') {
            mat = createWaterMaterial(opacity, elevation, waterColors);
        } else {
            const stdMat = new THREE.MeshStandardMaterial({
                map: FloorBuilder.makeGridTexture(SIZE),
                roughness,
                transparent: opacity < 1,
                opacity,
            });
            BendService.applyBend(stdMat);
            mat = stdMat;
        }
        this.floorMat = mat;

        const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEGMENTS, SEGMENTS);
        geo.rotateX(-Math.PI / 2);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.frustumCulled = false;

        if (floorShader === 'water') {
            const t0 = performance.now();
            mesh.onBeforeRender = () => {
                (mat as THREE.ShaderMaterial).uniforms.time.value = (performance.now() - t0) / 1000;
            };
        }

        this.threeScene.add(mesh);
        return mesh;
    }
}
