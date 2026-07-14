import { ThreeScene } from 'core/scene/ThreeScene';
import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import { PlayerEntity } from '../entities/PlayerEntity';
import { TailCube } from '../entities/TailCube';
import { BendService } from '../services/BendService';
import { CollectibleManager } from '../systems/CollectibleManager';
import { LevelManager } from '../systems/LevelManager';
import { BoundlessChunkManager } from '../world/BoundlessChunkManager';
import { CAMERA_CONFIG, FOOD_CONFIG, rollFoodValue } from '../world/LinearConfig';
import { DEFAULT_START_VALUE } from '../ClogConstants';
import { ROOM_GEOMETRY } from '../world/MeshConfig';
import { createWaterMaterial } from '../builders/WaterMaterial';
import { FloorBuilder } from '../builders/FloorBuilder';
import FourCornersGradientBuilder from '../vfx/FourCornersGradientBuilder';
import { CloudSystem } from '../vfx/CloudSystem';
import { WaterSplashSystem } from '../vfx/WaterSplashSystem';
import { BoostSpeedLineSystem } from '../vfx/BoostSpeedLineSystem';
import type { EntityUiTarget, IWorld3dScene } from './IWorld3dScene';
import type { DeathSnapshot } from '../ui-dom/PlayerFlowController';
import type { LeaderboardEntry } from '../ui-dom/LeaderboardPanel';
import { PerfOverlay } from '../utils/PerfOverlay';
import SetupThree from 'core/scene/SetupThree';
import { SimWorld } from '../sim/SimWorld';
import { resolveEntityEating } from '../sim/EntityEating';
import { BotController } from '../ai/BotController';
import type { BotParams } from '../ai/Blackboard';
import { DevGuiManager } from 'core/utils/DevGuiManager';
import type { NpcHostScene } from '../npc/NpcHostScene';
import { NpcDirector } from '../npc/NpcDirector';
import { Localization } from '../i18n/Localization';
import { TextureBuilder } from '../builders/TextureBuilder';
import { deriveWaterTones, getDefaultIsland, parseHexColor, resolveIslandImagePath } from '../world/IslandStorage';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { CartoonSky } from '../vfx/CartoonSky';

const PERF_MODE = new URLSearchParams(window.location.search).has('perf');

const CAM_SMOOTH = 2.2;
const SPAWN_RADIUS = 60;     // world-unit radius around player where food can spawn
const BOT_MIN_DIST = 10;     // minimum world-unit distance from the player when spawning a bot

// ── Auto Play (debug) ──────────────────────────────────────────────────────
// Dev-only stress-test mode (AI Debug panel, ?dev=1): drives the player via
// the same BotController wander/seek AI bots use, ramps the effective game
// speed up over time, and force-feeds a tail cube directly through
// PlayerEntity.collect() on a timer — bypassing CollectibleManager.checkCollision
// entirely, so it keeps exercising the merge path (MergeQueue/scheduleMerges)
// even if food spawning/collection itself is misbehaving. Auto-respawns on
// death instead of waiting on the UI's respawn choice.
const AUTO_PLAY_SPEED_RAMP_SECONDS = 45; // wall-clock seconds to reach max speed multiplier
const AUTO_PLAY_MAX_SPEED_MULT = 3;      // effective-delta multiplier once fully ramped
const AUTO_PLAY_FEED_INTERVAL = 4;       // real seconds between forced tail-cube feeds
const AUTO_PLAY_FEED_VALUE = 2;
const AUTO_PLAY_RESPAWN_DELAY = 1.5;     // real seconds after death before auto-respawning

export default class BoundlessWorld3dScene extends ThreeScene implements IWorld3dScene, NpcHostScene {

    private player!: PlayerEntity;
    private collectibles!: CollectibleManager;
    private levelManager!: LevelManager;
    private chunkManager!: BoundlessChunkManager;
    private gradient = new FourCornersGradientBuilder();
    private cloudSystem?: CloudSystem;
    private floorMesh!: THREE.Mesh;
    private floorMat!: THREE.Material;
    private camDist = CAMERA_CONFIG.minDistance;
    /** True while actually playing — see setGameplayCameraActive. */
    private gameplayCameraActive = false;
    /** True while the shop screen is open — see setShopCameraActive. */
    private shopCameraActive = false;
    /** Smoothed world-unit lift applied to the camera's look target — eases toward CAMERA_CONFIG.mobileFocusOffset while gameplayCameraActive on mobile, CAMERA_CONFIG.shopFocusOffset while shopCameraActive, back to 0 otherwise (menu/death, or desktop). */
    private cameraFocusOffset = 0;
    private perfOverlay: PerfOverlay | null = null;
    private botControllers: BotController[] = [];
    /** Non-null exactly while the player is dead, awaiting a respawn choice from the UI (see IWorld3dScene.deathInfo) — holds the value/tail captured the instant before death so a "watch a video" respawn can restore it, plus a leaderboard snapshot for the End Game screen. */
    private _deathInfo: DeathSnapshot | null = null;
    /** The 4 bots spawned by the "AI Debug" panel — tracked separately so the panel can target just them. */
    private debugBotControllers: BotController[] = [];
    /** Owns the persistent 24-NPC population and keeps ~activeMin-activeMax of them materialized near the player — see NpcDirector.ts. Its materialized bots live in `botControllers` alongside anything spawned via the debug panel, so the rest of this scene's bot handling (updateBots, resolveEntityEating, listEntities) needs no changes to pick them up. */
    private npcDirector = new NpcDirector();
    /** Dormant until startNpcPopulation() — the menu screen shows just the player alone in the world; NPCs and the food spawn timer/top-up only start once they actually join. */
    private npcPopulationActive = false;
    /** Last frame's wall-deflected move direction — see BotController.lastResolvedDir for why sticking with it avoids hunting between two equally-valid deflections at a fixed heading. */
    private lastPlayerResolvedDir: THREE.Vector3 | null = null;
    /** Debug-only Auto Play mode — see AUTO_PLAY_* constants above and buildAiDebugPanel. */
    private autoPlayEnabled = false;
    /** Drives the player entity via the same BotController AI bots use, while autoPlayEnabled. Rebuilt on every (auto-)respawn since respawnPlayer() replaces `this.player` with a brand new entity. */
    private autoPlayController: BotController | null = null;
    /** Wall-clock seconds since Auto Play was enabled — feeds autoPlaySpeedMult's ramp. Reset on toggle, not on respawn. */
    private autoPlayElapsed = 0;
    private autoPlayFeedTimer = 0;
    /** Non-null while the player is dead and Auto Play is counting down to an automatic respawn. */
    private autoPlayRespawnTimer: number | null = null;

    public cameraZoom = 1.0;
    public moveInput: { x: number; z: number } = { x: 0, z: 0 };

    private cartoonSky: CartoonSky = new CartoonSky(this.threeScene);

    // ── Accessors for HUD / minimap ───────────────────────────────────────────

    get playerValue(): number { return this.player?.value ?? 0; }
    get playerScore(): number { return this.player?.score ?? 0; }
    get playerPosition(): { x: number; z: number } {
        return { x: this.player?.position.x ?? 0, z: this.player?.position.z ?? 0 };
    }
    get playerBoostT(): number { return this.player?.boostT ?? 0; }
    get currentRoomIndex(): number { return 0; }
    get nextGateValue(): number { return 0; }

    getPlayerScreenAnchor(): { x: number; y: number } | null {
        return this.player ? this.worldToScreen(this.player.uiAnchor) : null;
    }
    get deathInfo(): DeathSnapshot | null { return this._deathInfo; }

    /**
     * Player + every live bot's name/boost state, for EntityIndicatorManager
     * (see IWorld3dScene.listEntityUiTargets). The player is deliberately
     * folded into the same `id`/`name`/`entity` list as every bot instead of
     * being special-cased inline — it's just another entity here, so its HUD
     * is produced by the exact same mapping step below.
     *
     * Excluded entirely while `_deathInfo` is set: onEaten() has already torn
     * down the player's visuals at that point (see resolveEntityEating), so
     * leaving it in would keep showing a name/boost HUD floating over an
     * entity that no longer visually exists until respawnPlayer() runs. Since
     * `id` stays 'player' across that gap, EntityIndicatorManager just
     * recycles its container on the way out and reuses it the instant the
     * target reappears — the HUD disappears on death and comes back on
     * respawn with no extra bookkeeping here.
     *
     * The player's own name is deliberately blank — it used to be a
     * localized "YOU" tag, but that text has no fixed length across locales
     * and could overflow/clip in the tight floating HUD for some languages.
     * No tag at all sidesteps that without needing per-locale sizing. NPC
     * names, by contrast, are plain (non-localized) generated strings — see
     * NpcNames.generateNpcName — so they don't have this problem.
     */
    public listEntityUiTargets(): EntityUiTarget[] {
        const live: { id: string; name: string; entity: PlayerEntity }[] = [];
        if (this.player && this._deathInfo === null) live.push({ id: 'player', name: '', entity: this.player });
        for (const controller of this.botControllers) {
            live.push({ id: `bot-${controller.id}`, name: controller.name, entity: controller.entity });
        }

        return live.map(({ id, name, entity }) => ({
            id,
            name,
            boostT: entity.boostT,
            screenAnchor: this.worldToScreen(entity.uiAnchor),
        }));
    }

    // ── Lifecycle ─────────────────────────────────────────────────────────────

    public async build(): Promise<void> {
        const island = getDefaultIsland();
        await TextureBuilder.loadRealIsland(resolveIslandImagePath(island.texture));

        const skyColor = parseHexColor(island.skyColor);
        this.threeScene.background = new THREE.Color(skyColor);
        this.threeScene.add(this.threeCamera);

        // this.gradient.build({
        //     camera: this.threeCamera,
        //     mode: 'four-way',
        //     distance: 30,
        //     fourWay: {
        //         topColor: skyColor,
        //         leftColor: shadeColor(skyColor, -0.03),
        //         bottomColor: shadeColor(skyColor, 0.35),
        //         rightColor: shadeColor(skyColor, -0.03),
        //         radius: 1.5,
        //         speed: 0.03,
        //     },
        // });

        this.threeScene.add(new THREE.AmbientLight(parseHexColor(island.ambientColor), 0.9));
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

        this.player = new PlayerEntity(DEFAULT_START_VALUE, this.threeScene);
        this.player.isMainPlayer = true;
        WaterSplashSystem.build(this.threeScene);
        BoostSpeedLineSystem.build(this.threeScene);

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



        // Directly around the horizon
        this.cartoonSky.setCloudBaseline(-3);

        // Clouds must be closer than camera.far
        this.cartoonSky.setCloudDistance(150);
    }

    public update(delta: number): void {
        //this.gradient.update(delta);
        WaterSplashSystem.update(delta);
        BoostSpeedLineSystem.update(delta);
        this.cartoonSky?.update(delta, this.threeCamera);
        // Auto Play (debug) ramps the effective game speed up over time — see
        // AUTO_PLAY_* constants. Applied to gameplay simulation (player/bots/
        // food/NPC population) but not to camera easing or ambient VFX above,
        // so speeding up doesn't make the camera/visuals feel jerky.
        if (this.autoPlayEnabled) this.autoPlayElapsed += delta;
        const simDelta = this.autoPlayEnabled ? delta * this.autoPlaySpeedMult() : delta;

        // Idle-population growth + active-window spawn/despawn — independent
        // of alive/dead state below, same as bots/food per updateDead's own
        // doc, but dormant until the player actually joins (see startNpcPopulation).
        if (this.npcPopulationActive) this.npcDirector.update(simDelta, this);

        if (this._deathInfo !== null) {
            this.updateDead(simDelta);
            return;
        }

        // ── Value-driven camera distance ──────────────────────────────────────
        const log2Val = Math.log2(Math.max(2, this.player.value));
        const log2Max = Math.log2(Math.max(2, CAMERA_CONFIG.maxAtValue));
        const distT = Math.min(log2Val / log2Max, 1);
        const target = (CAMERA_CONFIG.minDistance + distT * (CAMERA_CONFIG.maxDistance - CAMERA_CONFIG.minDistance)) * this.cameraZoom;
        this.camDist += (target - this.camDist) * (1 - Math.exp(-CAM_SMOOTH * delta));

        this.cloudSystem?.update(delta, this.player.position.x, this.player.position.z);

        if (this.autoPlayEnabled && this.autoPlayController) {
            this.autoPlayController.update(simDelta);
        } else {
            this.applyPlayerMoveInput();
        }
        this.player.update(simDelta);
        this.updateBots(simDelta);
        BendService.updateOrigin(this.player.position);

        // Chunk streaming + collision
        this.chunkManager.update(this.player);

        // Floor follows player
        this.floorMesh.position.x = this.player.position.x;
        this.floorMesh.position.z = this.player.position.z;

        this.collectibles.update(simDelta);

        // Force-feeds a "2" tail cube straight through PlayerEntity.collect(),
        // bypassing CollectibleManager.checkCollision entirely — keeps
        // exercising the merge path even if food spawn/collection has issues.
        // Timed off real `delta`, not simDelta, so the feed cadence stays
        // predictable in wall-clock seconds regardless of the speed ramp.
        if (this.autoPlayEnabled) {
            this.autoPlayFeedTimer += delta;
            if (this.autoPlayFeedTimer >= AUTO_PLAY_FEED_INTERVAL) {
                this.autoPlayFeedTimer = 0;
                this.player.collect(new TailCube(AUTO_PLAY_FEED_VALUE, this.threeScene, this.player.position.clone()));
            }
        }

        const hit = this.collectibles.checkCollision(this.player.position, this.player.foodRadius);
        if (hit) {
            this.player.collect(hit);
            this.player.pulseEatBoost();
        }

        // Captured before resolveEntityEating can run — a kill calls
        // PlayerEntity.onEaten() synchronously inside it, which empties the
        // tail immediately, so this is the only point where "the size the
        // player had right before dying" is still readable.
        const preDeathValue = this.player.value;
        const preDeathTail = this.player.tailSnapshot().map(t => t.value);

        const eaten = resolveEntityEating(
            [this.player, ...this.botControllers.map(c => c.entity)],
            this.collectibles,
        );
        if (eaten.length > 0) {
            this.botControllers = this.botControllers.filter(c => !eaten.includes(c.entity));
            this.npcDirector.onEntitiesRemoved(eaten);
            if (eaten.includes(this.player)) {
                // Don't respawn immediately — let the camera linger on the death
                // spot (see updateDead) while the UI shows a respawn choice.
                this.playerDeath()
                this._deathInfo = this.buildDeathSnapshot(preDeathValue, preDeathTail);
            }
        }

        // Food top-up — dormant until the player joins (see npcPopulationActive),
        // so food doesn't keep accumulating behind the menu screen.
        if (this.npcPopulationActive) {
            const pz = this.player.position.z;
            const freeCells = this.chunkManager.getFreeCellsNear(this.player.position.x, pz, SPAWN_RADIUS);
            const maxFood = Math.min(FOOD_CONFIG.maxAbsolute, Math.max(FOOD_CONFIG.minAbsolute, Math.floor(freeCells.length / 8)));
            this.levelManager.update(
                simDelta,
                this.collectibles,
                this.threeScene,
                this.player.position,
                rollFoodValue,
                freeCells,
                pz - SPAWN_RADIUS,
                pz + SPAWN_RADIUS,
                maxFood,
                this.lastPlayerResolvedDir,
            );
        }

        // Camera follow
        const pitch = CAMERA_CONFIG.pitch * Math.PI / 180;
        const camOffset = new THREE.Vector3(0, Math.sin(pitch) * this.camDist, Math.cos(pitch) * this.camDist);
        const posT = 1 - Math.exp(-CAMERA_CONFIG.followSpeed * delta);
        this.threeCamera.position.lerp(this.player.position.clone().add(camOffset), posT);

        const targetFocusOffset = this.shopCameraActive
            ? CAMERA_CONFIG.shopFocusOffset
            : (this.gameplayCameraActive && PIXI.isMobile.any) ? CAMERA_CONFIG.mobileFocusOffset : 0;
        this.cameraFocusOffset += (targetFocusOffset - this.cameraFocusOffset) * posT;
        this.threeCamera.lookAt(this.player.position.x, this.player.position.y + this.cameraFocusOffset, this.player.position.z);

        super.update(delta);

        if (this.perfOverlay) {
            this.perfOverlay.update({
                ...this.chunkManager.getStats(),
                triangles: SetupThree.renderer?.info.render.triangles ?? 0,
            });
        }
    }

    /**
     * Feeds raw joystick/keyboard input through the same wall-deflection probe
     * bots use (SimWorld.resolveDirection) before handing it to the player
     * entity, instead of applying it as-is. Without this, a raw diagonal
     * input straight into a wall corner — or a gap between two obstacles
     * narrower than the player's body — only gets corrected reactively by
     * chunkManager.resolveEntityCollisions' physical push-out below, which
     * shoves the player back out along the wall normal every frame; against
     * a gap that alternates which side is hit, that push-out alternates too,
     * so the player visibly zigzags between the two walls instead of sliding
     * past. Deflecting the desired direction sideways and probing ahead —
     * same as isFacingTarget's cone is to raw distance checks — finds a clear
     * heading before the walk ever drives into the corner. The physical
     * push-out stays in place as a safety net for whatever the probe misses
     * (thin/angled geometry — see updateBots' own note on this).
     */
    private applyPlayerMoveInput(): void {
        const rawX = this.moveInput.x;
        const rawZ = this.moveInput.z;
        const magnitude = Math.hypot(rawX, rawZ);
        if (magnitude < 0.0001) {
            this.player.setMoveInput(0, 0);
            this.lastPlayerResolvedDir = null;
            return;
        }

        const dir = new THREE.Vector3(rawX, 0, rawZ).divideScalar(magnitude);
        const resolved = SimWorld.resolveDirection(
            this.player.position,
            dir,
            this.player.collisionRadius * 2,
            this.lastPlayerResolvedDir,
            this.player.collisionRadius,
        );
        this.lastPlayerResolvedDir = resolved.lengthSq() > 0 ? resolved : null;
        // Re-apply the original input magnitude so a partial joystick push still
        // moves at partial speed — resolveDirection only ever returns unit vectors.
        this.player.setMoveInput(resolved.x * magnitude, resolved.z * magnitude);
    }

    /** Ticks every bot's AI + movement + wall collision + its own food pickup. Shared by the alive and dead update paths. */
    private updateBots(delta: number): void {
        for (const controller of this.botControllers) {
            controller.update(delta);
            controller.entity.update(delta);
            // Bots (and now the player — see applyPlayerMoveInput) only avoid
            // walls via a heuristic steering probe (SimWorld.resolveDirection),
            // which can miss thin/angled obstacles — this physical push-out is
            // the safety net that stops a bad probe from clipping into a wall
            // and getting stuck there permanently.
            this.chunkManager.resolveEntityCollisions(controller.entity.position, controller.entity.collisionRadius);
            const hit = this.collectibles.checkCollision(controller.entity.position, controller.entity.foodRadius);
            if (hit) controller.entity.collect(hit);
        }
    }

    /**
     * Runs while the player is dead: bots and food keep simulating (so the
     * killer can be seen absorbing the scattered drop) but the camera stays
     * frozen on the death spot and no player logic runs. Waits indefinitely
     * for the UI to call respawnPlayer() with the player's choice (watch a
     * video and keep their size, or respawn fresh) — see BaseDemoScene,
     * which shows that choice as soon as deathInfo goes non-null.
     */
    private updateDead(delta: number): void {
        this.updateBots(delta);
        this.collectibles.update(delta);

        const eaten = resolveEntityEating(this.botControllers.map(c => c.entity), this.collectibles);
        if (eaten.length > 0) {
            this.botControllers = this.botControllers.filter(c => !eaten.includes(c.entity));
            this.npcDirector.onEntitiesRemoved(eaten);
        }

        // Auto Play never waits on the UI's respawn choice — counts down a
        // short beat (so the death is still readable) then respawns fresh
        // and rebuilds the AI controller against the new player entity,
        // since respawnPlayer() replaces `this.player` outright.
        if (this.autoPlayEnabled) {
            this.autoPlayRespawnTimer = (this.autoPlayRespawnTimer ?? 0) + delta;
            if (this.autoPlayRespawnTimer >= AUTO_PLAY_RESPAWN_DELAY) {
                this.autoPlayRespawnTimer = null;
                this.respawnPlayer(DEFAULT_START_VALUE, []);
                this.startAutoPlayController();
            }
        }

        super.update(delta);
    }

    /** Enables/disables the debug Auto Play mode — see AUTO_PLAY_* constants. */
    private setAutoPlay(enabled: boolean): void {
        this.autoPlayEnabled = enabled;
        this.autoPlayElapsed = 0;
        this.autoPlayFeedTimer = 0;
        this.autoPlayRespawnTimer = null;

        if (enabled) {
            this.startAutoPlayController();
        } else {
            this.autoPlayController?.destroy();
            this.autoPlayController = null;
            this.player?.setMoveInput(0, 0);
        }
    }

    /** (Re)builds the BotController driving `this.player` — called on enable and after every auto-respawn, since respawnPlayer() swaps in a brand new player entity. */
    private startAutoPlayController(): void {
        if (!this.player) return;
        this.autoPlayController?.destroy();
        this.autoPlayController = new BotController(this.player, {}, 'AutoPlay');
        this.autoPlayController.blackboard.ignorePlayer = true;
    }

    /** 1x at t=0, ramping to AUTO_PLAY_MAX_SPEED_MULT over AUTO_PLAY_SPEED_RAMP_SECONDS. */
    private autoPlaySpeedMult(): number {
        const t = Math.min(this.autoPlayElapsed / AUTO_PLAY_SPEED_RAMP_SECONDS, 1);
        return 1 + t * (AUTO_PLAY_MAX_SPEED_MULT - 1);
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
        const cell = pool[Math.floor(Math.random() * pool.length)];

        const bot = new PlayerEntity(value, this.threeScene, false);
        bot.position.set(cell.x, 0, cell.z);
        bot.isMainPlayer = false;

        SimWorld.register(bot);
        const controller = new BotController(bot, params);
        this.botControllers.push(controller);
        return controller;
    }

    public debugDoublePlayerValue(): void {
        this.player?.debugDoubleValue();
    }

    public setPlayerBoosting(active: boolean): void {
        this.player?.setBoosting(active);
    }

    /** Mirrors EntityEating.ts's kill() for the player specifically — drops their tail as scattered food and hands off to the same deathInfo/respawn flow a real kill would. */
    public debugKillPlayer(): void {
        if (this._deathInfo !== null || !this.player) return;

        const preDeathValue = this.player.value;
        const preDeathTail = this.player.tailSnapshot().map(t => t.value);

        const dropped = this.player.onEaten();
        for (const cube of dropped) cube.startSpawnPop();
        this.collectibles.absorbDrop(dropped);
        SimWorld.unregister(this.player);

        this.playerDeath()
        this._deathInfo = this.buildDeathSnapshot(preDeathValue, preDeathTail);
    }

    public playerDeath() {
        console.log(
            '[PLAYER DEAD]',
            {
                unpackCollected: this.player.unpackCollected(),
            }
        );
    }
    public startNpcPopulation(): void {
        this.npcPopulationActive = true;
    }

    public setPlayerIndicatorVisible(visible: boolean): void {
        this.player?.setEatIndicatorVisible(visible);
    }

    public setGameplayCameraActive(active: boolean): void {
        this.gameplayCameraActive = active;
    }

    public setShopCameraActive(active: boolean): void {
        this.shopCameraActive = active;
    }

    /**
     * Snapshots the leaderboard at the moment of death for the End Game
     * screen's rank/rows. listEntities() alone isn't enough here — by this
     * point onEaten() has already cleared the player's tail, so their live
     * `score` getter (value + tail sum) has collapsed to just their head
     * value; this overrides "You"'s score back to the pre-death total.
     */
    private buildDeathSnapshot(value: number, tailValues: number[]): DeathSnapshot {
        const score = value + tailValues.reduce((sum, v) => sum + v, 0);
        const entries = this.listEntities().map(e => e.isYou ? { ...e, value, score } : e);
        return { value, tailValues, entries };
    }

    // ── NpcHostScene — see NpcHostScene.ts for why this isn't on IWorld3dScene ──

    /** Finds a walkable point in the ring [minDist, maxDist] around (cx, cz). Falls back to the closest cell available if none clear minDist yet (e.g. chunks not streamed that far out), same fallback shape as spawnBotNear's own candidate filter. */
    public findSpawnRing(cx: number, cz: number, minDist: number, maxDist: number): { x: number; z: number } | null {
        const cells = this.chunkManager.getFreeCellsNear(cx, cz, maxDist);
        if (cells.length === 0) return null;

        const minDist2 = minDist * minDist;
        const candidates = cells.filter(c => {
            const dx = c.x - cx, dz = c.z - cz;
            return dx * dx + dz * dz >= minDist2;
        });

        const pool = candidates.length > 0 ? candidates : cells;
        return pool[Math.floor(Math.random() * pool.length)];
    }

    /** Spawns a real bot at `pos` with a preset tail — each cube fed through PlayerEntity.collect() in descending order so it slots straight into place instead of triggering out-of-order merge churn. */
    public materializeNpc(pos: { x: number; z: number }, value: number, tailValues: number[], name: string, params?: Partial<BotParams>): BotController {
        const bot = new PlayerEntity(value, this.threeScene, false);
        bot.position.set(pos.x, 0, pos.z);
        bot.isMainPlayer = false;

        SimWorld.register(bot);
        const controller = new BotController(bot, params, name);
        this.botControllers.push(controller);

        for (const v of tailValues) {
            bot.collect(new TailCube(v, this.threeScene, bot.position.clone()));
        }

        return controller;
    }

    /** Tears down a materialized bot and hands back its final value/tail so the caller can save it into persistent NPC data before the entity is gone. */
    public dematerializeNpc(controller: BotController): { value: number; tailValues: number[] } {
        const snapshot = {
            value: controller.entity.value,
            tailValues: controller.entity.tailSnapshot().map(t => t.value),
        };
        this.botControllers = this.botControllers.filter(c => c !== controller);
        SimWorld.unregister(controller.entity);
        controller.entity.destroy();
        return snapshot;
    }

    /**
     * Flat dump of the player + the whole 24-NPC population, for the
     * in-game LeaderboardPanel (and the dev debug panel). Deliberately
     * excludes ad-hoc debug-spawned bots (Spawn Entity / Spawn 4 Debug Bots)
     * — those aren't part of the real population and shouldn't show up in
     * player-facing UI. See NpcDirector.listAll() for why this reads through
     * the roster's stable ids instead of the botControllers list directly.
     */
    public listEntities(): LeaderboardEntry[] {
        const list: LeaderboardEntry[] = [{ name: Localization.getString('you'), value: this.player.value, score: this.player.score, isYou: true }];
        for (const npc of this.npcDirector.listAll()) {
            list.push({ name: npc.name, value: npc.value, score: npc.score });
        }
        return list;
    }

    /** Debug-only: drops `count` food items near the player using the same spawn logic as seedInitialFood/LevelManager. */
    public spawnFood(count: number): void {
        const cells = this.chunkManager.getFreeCellsNear(this.player.position.x, this.player.position.z, SPAWN_RADIUS);
        if (cells.length === 0) return;
        for (let i = 0; i < count; i++) {
            const cell = cells[Math.floor(Math.random() * cells.length)];
            this.collectibles.spawnOne(this.threeScene, new THREE.Vector3(cell.x, 0, cell.z), rollFoodValue());
        }
    }

    /**
     * Re-creates the player entity after being eaten (or on the very first
     * "Join Server" after a death) — mirrors the initial spawn in build(),
     * plus seeds a tail (same `collect()`-per-cube trick as materializeNpc)
     * so a "watch a video, keep your size" respawn can hand back the
     * pre-death value/tail instead of always resetting to a bare level 2.
     * Called externally by BaseDemoScene once the player picks a respawn
     * option from the death UI — see IWorld3dScene.deathInfo.
     */
    public respawnPlayer(value: number, tailValues: number[]): void {
        const cells = this.chunkManager.getFreeCellsNear(0, 0, SPAWN_RADIUS);
        const cell = cells.length > 0 ? cells[Math.floor(Math.random() * cells.length)] : { x: 0, z: 0 };

        PlatformHandler.instance.platform.gameplayStart();
        this.npcDirector.respawnPlayer(this);
        this.player = new PlayerEntity(value, this.threeScene);
        this.player.isMainPlayer = true;
        this.player.position.set(cell.x, 0, cell.z);
        SimWorld.register(this.player);
        SimWorld.setPlayer(this.player);
        this.lastPlayerResolvedDir = null;

        for (const v of tailValues) {
            this.player.collect(new TailCube(v, this.threeScene, this.player.position.clone()));
        }

        // A respawn always drops the player straight back into a live,
        // NPC-populated world — unlike the initial build() spawn, which sits
        // parked/unvulnerable on the boot-menu preview until Join.
        this.player.grantSpawnInvincibility();

        this._deathInfo = null;
    }

    public grantPlayerSpawnInvincibility(): void {
        this.player.grantSpawnInvincibility();
    }

    // ── AI debug panel (dat.GUI, only rendered when DevGuiManager is dev-initialized, i.e. ?dev=1) ──

    private buildAiDebugPanel(): void {
        DevGuiManager.instance.addButton('Spawn 4 Debug Bots', () => this.spawnDebugBots(), 'AI Debug');
        DevGuiManager.instance.addToggle('Pause All', false, (paused) => {
            for (const c of this.debugBotControllers) c.paused = paused;
        }, 'AI Debug');
        // Stress-test mode: AI-drives the player, ramps game speed up over
        // time, force-feeds tail cubes, and auto-respawns on death — see
        // AUTO_PLAY_* constants and setAutoPlay.
        DevGuiManager.instance.addToggle('Auto Play', false, (enabled) => this.setAutoPlay(enabled), 'AI Debug');
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
        this.autoPlayController?.destroy();
        this.autoPlayController = null;
        SimWorld.reset();
        this.perfOverlay?.destroy();
        this.cloudSystem?.destroy(this.threeScene);
        WaterSplashSystem.destroy();
        BoostSpeedLineSystem.destroy();
        this.gradient?.destroy();
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
        const { shader: floorShader, opacity, elevation, roughness } = ROOM_GEOMETRY.floor;

        let mat: THREE.Material;
        if (floorShader === 'water') {
            const waterColors = deriveWaterTones(parseHexColor(getDefaultIsland().waterColor));
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
