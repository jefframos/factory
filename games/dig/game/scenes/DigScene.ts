// DigScene.ts
//
// Dig & Discover's main scene: the miner's hub room (levels/hub.json) in the middle of a block-voxel
// mine (VoxelTerrain). Walking out of a doorway and pushing into the rock digs automatically
// (MiningController); resources fly into the backpack. The hub's stations: the ATM turns them into money
// and sells better tools and bigger backpacks, the totem shows the artifact collection, the closet is
// the wardrobe; each gets a bouncing "!" when there's something new to check there. Progress (money, upgrades, the dug tunnels) is
// saved (DigProgress). The mine gets harder in zones further out (VoxelTerrain); reaching a new one and
// digging up finds are announced here.
//
// Teaching the loop: blocks the tool can't dig wear a padlock (HardBlockMarkers) that jumps, with a "NEEDS ..." label,
// when the miner pushes into one; the backpack filling up is called out over the miner; and the tutorial's first
// purchases are forced (updateForced): the first bag, then the first tool, each as soon as it's affordable, then the
// first hat on reaching the wardrobe (topped up if short) — after which the first artifact turns up (MiningController).
//
// Debug: a free camera (Dig panel), and with ?dev=1 a MAP button opening the 2D mine map (DigMap).
//
// Camera: pizza's follow camera — a fixed yaw/pitch orbit around a smoothed follow point, camera and
// look-at target always exactly `offset` apart so the view never rotates on its own.

import * as THREE from 'three';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import World from '../ecs/World';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { BendService } from '../services/BendService';
import DigPlayer from '../player/DigPlayer';
import { VoxelTerrain } from '../world/VoxelTerrain';
import { HubRoom, STATION_RADIUS } from '../world/HubRoom';
import { TractorRide } from '../player/TractorRide';
import { Guide } from '../world/Guide';
import { HardBlockMarkers } from '../world/HardBlockMarkers';
import { TreasureSparkles } from '../world/TreasureSparkles';
import type { StationKind } from '../data/HubData';
import { hubRects, HUB } from '../data/HubData';
import { DIG, MaterialDef } from '../data/DigConfig';
import { DigProgress } from '../data/DigProgress';
import { DigEffects } from '../vfx/DigEffects';
import { MiningController } from '../mining/MiningController';
import { DigHud, type ForcedBuy } from '../ui/DigHud';
import { DigMap } from '../ui/DigMap';
import DebugFlyCameraController from '../debug/DebugFlyCameraController';
import SetupThree from 'core/scene/SetupThree';
import * as PIXI from 'pixi.js';
import { t, names, Localization } from '../i18n/Localization';
import { DigAudio } from '../audio/DigAudio';
import gsap from 'gsap';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { Gameplay } from '../data/Gameplay';
import { GameAnalytics, TUTORIAL, type TutorialStep } from '../analytics/GameAnalytics';

const FLOOR_HALF_THICKNESS = 0.5;
/** Past the world's end: the bedrock's colour (tinted), on the skirt round the grid and the background. */
const BEYOND_COLOR = 0x141414;
/** The skirt reaches this far past the grid, in cells this big (enough vertices for the world bend). */
const SKIRT_REACH = 240;
const SKIRT_CELL = 4;
/** Floor grid: about a vertex per unit, so the zone colours follow the zones' wobbly edges. */
const FLOOR_SEGMENTS = 164;
/** Floor colour for a zone without its own. */
const DEFAULT_FLOOR = 0x5a3f2c;
/** Selling: at most this many items are tossed onto the pad, one every SELL_TOSS_INTERVAL, within SELL_MAX_SEC. */
const SELL_MAX_TOSSES = 24;
const SELL_TOSS_INTERVAL = 0.08;
const SELL_MAX_SEC = 1.6;
/** Selling from the HUD button: items fly up to this height above the miner and vanish. */
const SELL_ANYWHERE_HEIGHT = 3.2;

/** Top-down, slightly angled (GDD §4). yaw 0 = camera south of the player looking north (-Z). */
export const DIG_CAMERA = {
    yawDeg: 0,
    pitchDeg: 58,
    distance: 13,
    followSpeed: 8,
};

/** Design aspect the camera distance was tuned for; taller screens pull back so the same area stays framed. */
const REFERENCE_ASPECT = Game.DESIGN_WIDTH / Game.DESIGN_HEIGHT;

function cameraOffset(camera: THREE.PerspectiveCamera): THREE.Vector3 {
    const yaw = THREE.MathUtils.degToRad(DIG_CAMERA.yawDeg);
    const pitch = THREE.MathUtils.degToRad(DIG_CAMERA.pitchDeg);
    const distance = DIG_CAMERA.distance * Math.max(1, REFERENCE_ASPECT / camera.aspect);
    const horizontal = distance * Math.cos(pitch);
    return new THREE.Vector3(horizontal * Math.sin(yaw), distance * Math.sin(pitch), horizontal * Math.cos(yaw));
}

/** Longest frame step (seconds): the first frame after a pause doesn't leap ahead. */
const MAX_FRAME_SEC = 0.1;
/** Footsteps sound this often (world units walked). */
const STEP_DISTANCE = 0.9;
/** Commercial breaks (after a BUY tap only): at most one this often, and none this soon after the session starts. */
const AD_BREAK_COOLDOWN_MS = 3 * 60 * 1000;
/** Wait after the BUY tap, so the purchase's fanfare plays before the break. */
const AD_BREAK_DELAY_MS = 900;
/** Tries at digging with a full backpack before the guide's arrows lead back to the ATM. */
const FULL_PUSHES_TO_GUIDE = 2;
/** The move hint goes once the miner has walked this far. */
const MOVE_HINT_DISTANCE = 2.5;

export default class DigScene extends ThreeScene {
    /** Resolves once the mine is drawn (its block models loaded): the screen fade waits for it. */
    public get ready(): Promise<void> {
        return this.terrain?.ready ?? Promise.resolve();
    }

    /**
     * Rebuilds the scene from scratch as a fresh instance behind the screen fade (set by the game: index.ts): fades
     * out showing `title` / `subtitle`, runs `apply` (the save switches mine), rebuilds, fades back in.
     */
    public static restart?: (title: string, subtitle: string, apply: () => void) => void;

    private readonly world = new World();
    private player!: DigPlayer;
    private terrain!: VoxelTerrain;
    private floor!: THREE.Mesh;
    private hub!: HubRoom;
    private tractor!: TractorRide;
    private guide!: Guide;
    private hardBlocks!: HardBlockMarkers;
    /** Sparkles over buried finds near the miner. */
    private treasureSparkles!: TreasureSparkles;
    /** Pushes into rock with a full backpack since it filled up (FULL_PUSHES_TO_GUIDE turns the arrows to the ATM on). */
    private fullPushes = 0;
    /** The backpack was full last frame (filling it up gets called out once). */
    private bagWasFull = false;
    /** The station pad the miner stands on (updateStations). */
    private onStation: StationKind | null = null;
    /** The forced first hat started (the miner reached the wardrobe); it holds until the hat is bought. */
    private hatForced = false;
    private effects!: DigEffects;
    private mining!: MiningController;
    private hud!: DigHud;
    private map?: DigMap;
    private mapButton?: PIXI.Container;
    private flyCamera!: DebugFlyCameraController;
    private currentZone = 0;
    private platformPaused = false;
    /** On the way to another mine (the screen is fading): the miner stays still. */
    private leaving = false;
    /** canOpenNewMine last step (undefined until the first check, so loading a maxed save says nothing). */
    private newMineReady?: boolean;
    /** A commercial break is on its way or playing (adBreakAfterBuy). */
    private adBreakRunning = false;
    /** When the last commercial break ended (or the session started): the cooldown counts from here. */
    private lastAdBreak = performance.now();
    /** A phone sale's rewarded video is playing. */
    private phoneBusy = false;
    private sceneDestroyed = false;
    /** Where the miner was last frame (gameplay restarts when they move). */
    private readonly gameplayLast = new THREE.Vector3();
    /** Move hint: shown on a brand-new game until the miner has walked MOVE_HINT_DISTANCE. */
    private moveHintActive = false;
    private walked = 0;
    private readonly hintLast = new THREE.Vector3();
    /** Where the last footstep sounded (see updateFootsteps()). */
    private readonly lastStep = new THREE.Vector3();
    /** The buildable spot the miner is standing on (so buying/telling the price happens once per visit). */
    private buildSpot: string | null = null;
    private readonly followTarget = new THREE.Vector3();
    private readonly pickupPoint = new THREE.Vector3();

    public constructor(game: Game) {
        super(game);
    }

    public build(): void {
        PlatformHandler.instance.onPause.add(this.onPlatformPause, this);
        PlatformHandler.instance.onResume.add(this.onPlatformResume, this);
        window.addEventListener('pointerdown', this.onFirstInput, true);
        window.addEventListener('keydown', this.onFirstInput, true);
        this.buildLightsAndGround();
        this.terrain = new VoxelTerrain(this.threeScene, DigProgress.savedDug, DigProgress.mineSeed, DigProgress.mineTheme);
        this.colorFloorByZone();
        DigProgress.setDugProvider(() => this.terrain.saveDug());
        this.hub = new HubRoom(this.threeScene, this.world);

        this.player = this.world.add(new DigPlayer(this, this.threeScene));
        this.player.transform.position.set(HUB.start.x, 0, HUB.start.z);
        void this.player.loadCharacter().catch((error) => console.error('[DigScene] character failed to load', error));

        this.effects = new DigEffects(this.threeScene, DIG.terrain.blockHeight, () => this.player.pickupPoint(this.pickupPoint));
        this.tractor = new TractorRide(this.threeScene, this.player, this.effects);
        // A newly revealed area of the hub: smoke where its pieces pop in, and its name on screen.
        this.hub.onReveal = (area, points) => {
            GameAnalytics.areaRevealed(area.id);
            DigAudio.play('reveal');
            for (const point of points) this.effects.smoke(point.clone().setY(0.5), 4, 0.9, new THREE.Color(0xf3e9d8), 0.6);
            // Just after whatever caused it ("UPGRADED!", "BUILT: ..."), so both get read.
            window.setTimeout(() => this.hud.say(t('newArea', { name: names.area(area).toUpperCase() }), 0x8fe3ff), 1200);
        };
        this.hud = this.createHud();
        Localization.onLocaleChange.add(this.onLocaleChange, this);
        // A brand-new game: show how to move first.
        this.moveHintActive = DigProgress.achievementStat('blocks') === 0 && DigProgress.upgradesBought === 0;
        if (this.moveHintActive) this.hud.moveHint.show();
        this.hintLast.copy(this.player.transform.position);
        this.guide = new Guide(this.threeScene, this.hub, (x, z) => this.terrain.isSolid(x, z), (text, buy) => this.hud.setGuide(text, buy));
        this.hardBlocks = new HardBlockMarkers(this.threeScene, this.terrain);
        this.treasureSparkles = new TreasureSparkles(this.terrain, this.effects);
        this.mining = new MiningController(this.terrain, this.effects, this.player, (text) => this.hud.say(text, 0xffd9a8), (find, zone) => {
            // Paid now (so the save is right), shown on the banner until CLAIM flies it in; the first find ever is
            // the tutorial's claim step (the game waits for it).
            const tutorial = DigProgress.totalFinds === 0;
            const amount = DigProgress.findPayout(find, zone);
            GameAnalytics.findDug(find.id);
            this.hud.findBanner.show(find, DigProgress.addFind(find, amount), amount, tutorial);
            DigAudio.play('sparkle');
        }, (ix, iz, tool) => {
            // The block's lock jumps and says what it takes.
            this.hardBlocks.bump(ix, iz);
            const material = this.terrain.material(ix, iz);
            if (material) GameAnalytics.blocked(material.id);
            const at = this.terrain.cellCenter(ix, iz).setY(DIG.terrain.blockHeight + 1.3);
            this.effects.floatText(at, t('needsToolShort', { tool }).toUpperCase(), '#ff8a7a');
            DigAudio.play('error');
        }, () => {
            this.hud.flashBackpack();
            this.effects.floatText(this.player.pickupPoint(new THREE.Vector3()).setY(2.4), t('bagFullFloat'), '#ff8a7a');
            DigAudio.play('error');
        }, () => {
            // A few tries at digging with a full backpack: the guide's arrows lead back to the ATM until it's sold.
            this.fullPushes++;
            if (this.fullPushes >= FULL_PUSHES_TO_GUIDE) this.guide.setReturnToSell(true);
        });
        this.flyCamera = new DebugFlyCameraController(this.threeCamera, SetupThree.renderer.domElement);
        if (Game.debugParams.dev) {
            this.buildDevMap();
        }

        this.followTarget.copy(this.player.transform.position);
        this.placeCamera();
        this.buildDebug();
        // A save from before analytics: its past tutorial steps count as sent (not reported all at once now).
        if (DigProgress.once('tutorial-primed')) GameAnalytics.primeTutorial((step) => this.tutorialDone(step));
    }

    /** Mine floor with a collider under the whole map, and warm, readable light (GDD §16: not too dark). */
    private buildLightsAndGround(): void {
        // Near black like the bedrock: past the world's end there's nothing but dark.
        this.threeScene.background = new THREE.Color(BEYOND_COLOR);
        this.threeScene.add(new THREE.HemisphereLight(0xfff1dc, 0x4a3426, 1.5));
        const sun = new THREE.DirectionalLight(0xffffff, 1.4);
        sun.position.set(6, 14, 8);
        this.threeScene.add(sun);

        const size = DIG.terrain.radius * 2 + 4;
        // Shaded per zone through vertex colours (colorFloorByZone(), once the terrain knows its zones).
        const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, vertexColors: true });
        BendService.applyBend(floorMaterial);
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size, FLOOR_SEGMENTS, FLOOR_SEGMENTS), floorMaterial);
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.position.y = -0.01;
        this.threeScene.add(this.floor);

        this.buildWorldSkirt();

        const ground = this.world.spawn();
        ground.addComponent(new RigidBody({
            halfExtents: new THREE.Vector3(size / 2, FLOOR_HALF_THICKNESS, size / 2),
            centerOffset: new THREE.Vector3(0, -FLOOR_HALF_THICKNESS, 0),
            isStatic: true,
            layer: Layers.Environment,
        }));
    }

    /**
     * The mine floor in each zone's colour (ui/dig.json zones `floor`), so a tunnel shows where it is: a vertex every
     * unit, coloured by the zone there (wobbly edges and all), blending softly across the borders.
     */
    private colorFloorByZone(): void {
        const geometry = this.floor.geometry;
        const positions = geometry.getAttribute('position');
        const colors = new Float32Array(positions.count * 3);
        const themeFloors = DigProgress.mineTheme.floors;
        const zoneColors = DIG.zones.map((zone, i) => new THREE.Color(themeFloors?.[i] ?? zone.floor ?? DEFAULT_FLOOR));
        for (let i = 0; i < positions.count; i++) {
            // The plane is laid flat (rotated -90° on X): its local Y is world -Z.
            const color = zoneColors[this.terrain.zoneIndexAt(positions.getX(i), -positions.getY(i))];
            colors.set([color.r, color.g, color.b], i * 3);
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    }

    /**
     * Past the block grid: a dark surface level with the bedrock tops (and their colour), reaching SKIRT_REACH out
     * on every side, so the end of the world is solid black rock to the horizon — not the floor plane's edge and the
     * background. Four strips round the grid, subdivided so the world bend curves them away like the rest.
     */
    private buildWorldSkirt(): void {
        const inner = DIG.terrain.radius;
        const outer = inner + SKIRT_REACH;
        const material = new THREE.MeshStandardMaterial({ color: BEYOND_COLOR, roughness: 1 });
        BendService.applyBend(material);
        const strip = (minX: number, maxX: number, minZ: number, maxZ: number) => {
            const width = maxX - minX;
            const depth = maxZ - minZ;
            const geometry = new THREE.PlaneGeometry(width, depth, Math.ceil(width / SKIRT_CELL), Math.ceil(depth / SKIRT_CELL));
            geometry.rotateX(-Math.PI / 2);
            const mesh = new THREE.Mesh(geometry, material);
            // Just under the bedrock tops, so they win where the two meet.
            mesh.position.set((minX + maxX) / 2, DIG.terrain.blockHeight - 0.02, (minZ + maxZ) / 2);
            this.threeScene.add(mesh);
        };
        strip(-outer, outer, inner, outer);
        strip(-outer, outer, -outer, -inner);
        strip(-outer, -inner, -inner, inner);
        strip(inner, outer, -inner, inner);
    }

    /** ?dev=1: a MAP button (top right) opening the whole-mine 2D map. */
    private buildDevMap(): void {
        this.map = new DigMap(this.terrain, () => this.player.transform.position, (x, z) => this.player.transform.position.set(x, 0, z));
        const button = new PIXI.Container();
        button.addChild(new PIXI.Graphics().lineStyle(3, 0xffffff).beginFill(0x2a3442).drawRoundedRect(-44, -22, 88, 44, 12).endFill());
        const label = new PIXI.Text('MAP', { fontFamily: 'Arial', fontWeight: 'bold', fontSize: 22, fill: 0xffffff });
        label.anchor.set(0.5);
        button.addChild(label);
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            this.map?.toggle();
        });
        this.mapButton = button;
        this.game.uiLayer.addChild(button, this.map);
        this.resize();
    }

    /** Debug free-fly camera on/off; the miner stands still (and stops digging) while it's on. */
    private setFreeCamera(enabled: boolean): void {
        this.flyCamera.setEnabled(enabled);
        this.player.movementController.enabled = !enabled;
        if (!enabled) {
            this.placeCamera();
        }
    }

    /** Announces the zone the miner walks into: loudly the first time, quietly after that. */
    private updateZone(): void {
        const position = this.player.transform.position;
        const zone = this.terrain.zoneIndexAt(position.x, position.z);
        if (zone === this.currentZone) return;
        this.currentZone = zone;
        const name = names.zone(DIG.zones[zone]).toUpperCase();
        if (DigProgress.reachZone(zone)) {
            GameAnalytics.zoneReached(DIG.zones[zone].id);
            this.hud.say(t('newZone', { name }), 0x8fe3ff);
            DigAudio.play('quest');
        } else {
            this.hud.say(name, 0xd8e6f0);
        }
    }

    private buildDebug(): void {
        const panel = DebugOverlay.instance.panel('Dig', { id: 'dig.progress' });
        panel.monitor('Money', () => DigProgress.money);
        panel.monitor('Backpack', () => `${DigProgress.backpackCount}/${DigProgress.capacity}`);
        panel.monitor('Tool', () => DigProgress.tool.name);
        panel.monitor('Zone', () => DIG.zones[this.currentZone].name);
        panel.button('FREE CAMERA (WASD, right-drag, wheel)', () => this.setFreeCamera(!this.flyCamera.isEnabled()));
        if (this.map) {
            panel.button('MINE MAP', () => this.map?.toggle());
        }
        panel.button('SELL BACKPACK HERE', () => this.sellAnywhere());
        panel.button('ADD $100', () => DigProgress.addMoney(100));
        panel.button('ADD $5000', () => DigProgress.addMoney(5000));
        panel.button('RESET SAVE', () => {
            if (window.confirm('Reset all Dig & Discover progress (money, upgrades, dug tunnels)?')) {
                DigProgress.reset();
            }
        });
        panel.button('PAUSE / RESUME (platform)', () => {
            if (this.platformPaused) PlatformHandler.instance.onResume.dispatch();
            else PlatformHandler.instance.onPause.dispatch();
        });
        panel.monitor('Gameplay', () => (Gameplay.active ? 'started' : Gameplay.started ? 'stopped' : 'not started'));
        panel.button('CLEAN ALL DATA', () => {
            if (window.confirm('Clean ALL saved data: game progress plus the debug panel saved tweaks and layout (localStorage, cookies)? The game reloads from scratch.')) {
                DigProgress.wipeAllData();
            }
        });
    }

    public update(delta: number): void {
        // The first frame after a pause (platform / hidden tab) carries the whole gap: never step more than this.
        delta = Math.min(delta, MAX_FRAME_SEC);
        this.updateGameplay();
        if (Gameplay.active) GameAnalytics.playTime(delta);
        this.world.update(delta);
        this.world.lateUpdate(delta);
        this.tractor.update(delta);
        this.updateFootsteps();
        this.updateMoveHint();
        this.guide.update(delta, this.player.transform.position);
        this.hardBlocks.update(delta, this.player.transform.position);
        this.treasureSparkles.update(delta, this.player.transform.position);
        this.terrain.update();
        this.effects.update(delta);
        this.hub.update(delta, this.player.transform.position);
        this.flyCamera.update(delta);
        this.map?.update(delta);
        BendService.updateTime(delta);
        super.update(delta);
    }

    /** The "drag to move" hand until the miner has walked MOVE_HINT_DISTANCE (a brand-new game only). */
    private updateMoveHint(): void {
        if (!this.moveHintActive) return;
        const position = this.player.transform.position;
        this.walked += Math.min(1, Math.hypot(position.x - this.hintLast.x, position.z - this.hintLast.z));
        this.hintLast.copy(position);
        if (this.walked >= MOVE_HINT_DISTANCE) {
            this.moveHintActive = false;
            this.hud.moveHint.hide();
        }
    }

    /** A step sound every STEP_DISTANCE walked: wood on the hub floor, stone out in the mine (none in the tractor). */
    private updateFootsteps(): void {
        const position = this.player.transform.position;
        const moved = Math.hypot(position.x - this.lastStep.x, position.z - this.lastStep.z);
        // A teleport (dev map) or the first frame: just start counting from here.
        if (moved > 3) this.lastStep.copy(position);
        if (moved < STEP_DISTANCE) return;
        this.lastStep.copy(position);
        if (this.tractor.isRiding) return;
        const inHub = hubRects().some((r) => Math.abs(position.x - r.x) <= r.width / 2 && Math.abs(position.z - r.z) <= r.depth / 2);
        DigAudio.play(inHub ? 'stepWood' : 'stepStone');
    }

    private createHud(): DigHud {
        const hud = new DigHud(() => {
            this.mining.toolChanged();
            void this.adBreakAfterBuy();
        }, () => void this.sellByPhone(), () => this.player.applyLook(DigProgress.look), () => this.openNewMine(), (index) => this.travelTo(index));
        this.game.uiLayer.addChild(hud);
        return hud;
    }

    /**
     * A new language: rebuild what shows text — a fresh HUD (its panels and labels are built once) with the language
     * list reopened, and the hub's 3D price tags / signs. The guide picks the new text up on its next frame, and an
     * open station panel reopens on the next frame from the miner's position (updateStations).
     */
    private onLocaleChange(): void {
        this.hud.destroy();
        this.hud = this.createHud();
        this.hud.openLanguage();
        if (this.moveHintActive) this.hud.moveHint.show();
        this.hub.relabel();
        this.resize();
    }

    /** Physics, mining and camera on the same clock, so the character and camera never jitter against each other. */
    public fixedUpdate(delta: number): void {
        // The footprint against the rock: wider on the tractor (before movement uses it).
        const at = this.player.transform.position;
        this.terrain.setBody(at.x, at.z, this.tractor.isRiding ? DIG.tractor.bodyRadius : undefined);
        this.world.fixedUpdate(delta);
        this.mining.fixedUpdate(delta);
        this.updateStations();
        this.updateBagFull();
        this.updateForced();
        this.updateTutorialFunnel();
        this.updateNewMineReady();
        this.updateZone();

        const position = this.player.transform.position;
        const followT = 1 - Math.exp(-DIG_CAMERA.followSpeed * delta);
        this.followTarget.lerp(position, followT);
        if (!this.flyCamera.isEnabled()) {
            this.placeCamera();
        }
        BendService.updateOrigin(this.followTarget);
        BendService.updateCameraPosition(this.threeCamera.position);
        BendService.updateOcclusionTarget(position);
    }

    /**
     * Standing on a station's pad uses it: the ATM sells the backpack (the items fly into its slot) and
     * opens the upgrades; the totem and the closet open their panels. Also keeps the "!" marks current.
     */
    private updateStations(): void {
        const position = this.player.transform.position;
        let open: StationKind | null = null;
        for (const station of HUB.stations) {
            // A station in a reveal area that hasn't appeared yet isn't there.
            if (!this.hub.isStationOpen(station.kind)) continue;
            if (Math.hypot(position.x - station.x, position.z - station.z) > STATION_RADIUS) continue;
            open = station.kind;
            if (station.kind === 'atm' && DigProgress.backpackCount > 0) {
                this.sell(this.hub.stationTarget('atm') ?? new THREE.Vector3(station.x, 1, station.z), true);
            }
        }
        this.onStation = open;
        this.hud.setStationPanel(open);
        this.updateBuilding(position);
        this.hub.setAttention('atm', open !== 'atm' && (DigProgress.canAffordUpgrade || DigProgress.canAffordBoost));
        this.hub.setAttention('collection', DigProgress.unseenFinds.length > 0);
        this.hub.setAttention('wardrobe', open !== 'wardrobe' && DigProgress.wardrobeHasNews);
    }

    /** The backpack just filled up: said on screen and over the miner (MiningController repeats it while they keep digging). */
    private updateBagFull(): void {
        const full = DigProgress.backpackCount >= DigProgress.capacity;
        if (full && !this.bagWasFull) {
            GameAnalytics.backpackFull(DigProgress.capacity);
            this.hud.say(t('backpackFull'), 0xff8a7a);
            this.effects.floatText(this.player.pickupPoint(new THREE.Vector3()).setY(2.4), t('bagFullFloat'), '#ff8a7a');
            DigAudio.play('error');
        }
        this.bagWasFull = full;
        if (!full && this.fullPushes > 0) {
            this.fullPushes = 0;
            this.guide.setReturnToSell(false);
        }
    }

    /**
     * The tutorial's first purchases are a must: the first bag upgrade, then the first tool, each the moment it's
     * affordable — the same tick the sale pays, while its coins are still flying, so the miner never gets a step away
     * from the ATM in between; then, once both are bought and the miner reaches the wardrobe (the
     * guide leads there: it appears with the second upgrade), the cheapest hat — any money short of it is quietly
     * added. Meanwhile the miner stands still and the HUD keeps the panel up, dimmed around, until it's bought. The
     * upgrades are derived from the progress alone, so a reload in the middle lands back in them.
     */
    private updateForced(): void {
        const money = DigProgress.money;
        const bag = DigProgress.nextBackpack;
        const tool = DigProgress.nextTool;
        const hat = DigProgress.starterHat;
        let forced: ForcedBuy | null = null;
        // Only the first mine teaches: a new mine starts back at level 0, but the player knows the loop by then.
        const firstMine = DigProgress.prestige === 0;
        if (firstMine && DigProgress.backpackLevel === 0 && bag && money >= bag.price) forced = 'backpack';
        else if (firstMine && DigProgress.toolLevel === 0 && tool && money >= tool.price) forced = 'tool';
        const needsHat = !!hat && !DigProgress.boughtFirstHat && DigProgress.backpackLevel > 0 && DigProgress.toolLevel > 0;
        if (!needsHat) this.hatForced = false;
        else if (!forced && (this.hatForced || this.onStation === 'wardrobe')) {
            if (!this.hatForced && money < hat.price) DigProgress.addMoney(hat.price - money);
            this.hatForced = true;
            forced = 'hat';
        }
        if (forced) GameAnalytics.forcedShown(forced);
        this.hud.setForced(forced);
        // The first find's banner holds the game too, until its CLAIM.
        this.player.movementController.enabled = !forced && !this.leaving && !this.hud.findBanner.blocking && !this.flyCamera.isEnabled();
    }

    /** Whether a tutorial step is done, from the progress (the funnel GameAnalytics reports). */
    private tutorialDone(step: TutorialStep): boolean {
        switch (step) {
            case 'move': return this.walked >= MOVE_HINT_DISTANCE || DigProgress.achievementStat('blocks') > 0;
            case 'dig': return DigProgress.achievementStat('blocks') > 0;
            case 'bag-full': return DigProgress.backpackCount >= DigProgress.capacity || DigProgress.timesSold > 0;
            case 'sell': return DigProgress.timesSold > 0;
            case 'bag-upgrade': return DigProgress.backpackLevel > 0;
            case 'tool-upgrade': return DigProgress.toolLevel > 0;
            case 'wardrobe': return DigProgress.wardrobeVisited;
            case 'hat': return DigProgress.boughtFirstHat;
            case 'find': return DigProgress.totalFinds > 0;
            // Sent by the find banner's CLAIM itself; here only for priming an old save.
            case 'claim': return DigProgress.totalFinds > 0;
            case 'collection': return DigProgress.totalFinds > 0 && DigProgress.unseenFinds.length === 0;
            case 'build': return (HUB.buildables ?? []).some((b) => DigProgress.isBuilt(b.id));
        }
    }

    /** Reports each tutorial step the moment it's done (GameAnalytics sends each once per player). */
    private updateTutorialFunnel(): void {
        for (const step of TUTORIAL) {
            if (step !== 'claim' && this.tutorialDone(step)) GameAnalytics.tutorialStep(step);
        }
    }

    /**
     * Walking into a buildable's ghost buys it when the money is there (it pops in), or says what it costs.
     * Only on stepping onto the spot, so standing there doesn't repeat the message every frame.
     */
    private updateBuilding(position: THREE.Vector3): void {
        const buildable = this.hub.buildableAt(position.x, position.z);
        if (buildable?.id === this.buildSpot) return;
        this.buildSpot = buildable?.id ?? null;
        if (!buildable) return;
        if (DigProgress.build(buildable.id, buildable.price)) {
            GameAnalytics.built(buildable.id);
            this.hub.completeBuild(buildable.id);
            DigAudio.play('buyCash');
            DigAudio.play('build');
            DigAudio.play('cheer');
            const { built, total } = this.hub.buildProgress;
            const name = names.item(buildable.name);
            this.hud.say(built === total ? t('hubComplete', { name }) : t('built', { name, built, total }), 0x8fe3a1);
            this.effects.floatText(new THREE.Vector3(buildable.x, buildable.height + 1, buildable.z), `-$${buildable.price}`, '#ffe27a');
        } else {
            this.hud.say(t('costToBuild', { name: names.item(buildable.name), price: buildable.price.toLocaleString('en-US') }), 0xffd9a8);
        }
    }

    /** Sells right where the miner stands, the items flying up and away (the ATM does it in the hub); `multiplier` on the value. */
    private sellAnywhere(multiplier = 1): void {
        if (DigProgress.backpackCount === 0) return;
        this.sell(this.player.transform.position.clone().add(new THREE.Vector3(0, SELL_ANYWHERE_HEIGHT, -0.6)), false, multiplier);
    }

    /**
     * Opens a new mine (prestige, from the ATM's confirmation): DigProgress resets the run, then the whole scene is
     * rebuilt by the game (DigScene.restart) — a new layout from the new seed, the miner back at the start.
     */
    private openNewMine(): void {
        if (!DigProgress.canOpenNewMine) return;
        this.leaveFor(DigProgress.mineCount, () => {
            if (DigProgress.openNewMine()) GameAnalytics.newMineOpened();
        });
    }

    /** Goes to another mine already opened (from the MAP): its own run as it was left, rebuilt like a new mine. */
    private travelTo(index: number): void {
        if (index === DigProgress.currentMine || index >= DigProgress.mineCount) return;
        this.leaveFor(index, () => {
            if (DigProgress.travelTo(index)) GameAnalytics.travelled();
        });
    }

    /**
     * Leaves this mine for mine `index` through the screen fade: the miner stops at once, the save only switches
     * (`apply`) once the screen is dark, then the scene is rebuilt for the mine arrived at.
     */
    private leaveFor(index: number, apply: () => void): void {
        if (this.leaving || !DigScene.restart) return;
        this.leaving = true;
        this.player.movementController.enabled = false;
        const theme = DigProgress.themeFor(index);
        // Not from inside the HUD's tap handler: the HUD is torn down with the scene.
        window.setTimeout(() => DigScene.restart?.(t('mineName', { mine: index + 1 }), names.theme(theme.name), apply), 0);
    }

    /** The newest mine just got its Tractor: say a new mine is waiting (the MAP button has its "!"). */
    private updateNewMineReady(): void {
        const ready = DigProgress.canOpenNewMine;
        if (ready && this.newMineReady === false) {
            this.hud.say(t('newMineReady'), 0xffd23f);
            DigAudio.play('quest');
        }
        this.newMineReady = ready;
    }

    /**
     * The platform's commercial break, only ever right after the player taps BUY on an upgrade (a natural pause, and
     * an input of theirs — never on walking somewhere): not during the tutorial (until the first hub piece is built),
     * at most once every AD_BREAK_COOLDOWN_MS (counted from the session start too), and a beat after the tap so the
     * "UPGRADED!" fanfare lands first. Gameplay stops for it; the miner's next move starts it again.
     */
    private async adBreakAfterBuy(): Promise<void> {
        const now = performance.now();
        if (this.adBreakRunning || !this.tutorialDone('build') || now - this.lastAdBreak < AD_BREAK_COOLDOWN_MS) return;
        this.adBreakRunning = true;
        this.lastAdBreak = now;
        await new Promise((resolve) => window.setTimeout(resolve, AD_BREAK_DELAY_MS));
        if (this.sceneDestroyed) return;
        GameAnalytics.adBreak('start');
        try {
            Gameplay.stop();
            await PlatformHandler.instance.platform?.showCommercialBreak();
        } catch (error) {
            console.warn('[DigScene] Commercial break failed', error);
        }
        this.lastAdBreak = performance.now();
        this.adBreakRunning = false;
        if (!this.sceneDestroyed) GameAnalytics.adBreak('complete');
    }

    /**
     * The HUD's phone: a rewarded video, then the backpack sold right here at x2 (bandit's bonus flow: gameplay stops
     * for the ad, the miner's next move starts it again). A closed or failed video sells nothing; the phone comes back.
     */
    private async sellByPhone(): Promise<void> {
        if (this.phoneBusy || DigProgress.backpackCount === 0) return;
        this.phoneBusy = true;
        this.hud.setPhoneBusy(true);
        GameAnalytics.phoneTapped();
        let watched = true;
        if (PlatformHandler.ENABLE_VIDEO_ADS) {
            try {
                Gameplay.stop();
                watched = (await PlatformHandler.instance.platform.showRewardedVideo()) !== false;
            } catch (error) {
                console.warn('[DigScene] Rewarded video failed', error);
                watched = false;
            }
        }
        this.phoneBusy = false;
        if (this.sceneDestroyed) return;
        this.hud.setPhoneBusy(false);
        GameAnalytics.phoneResult(watched);
        if (watched) this.sellAnywhere(2);
    }

    /**
     * Sells the backpack at once (so the save is right), then plays it out: the items stream out of the
     * miner to `target` (the ATM's slot, or up into the air for the SELL button), each arrival pops a
     * "+$" label (and flashes the ATM's pad) and hands its money and slot over in the HUD. Big
     * backpacks toss at most SELL_MAX_TOSSES items, each carrying a share.
     */
    private sell(target: THREE.Vector3, atPad: boolean, multiplier = 1): void {
        const items: MaterialDef[] = [];
        for (const [id, count] of Object.entries(DigProgress.backpack)) {
            const material = DIG.materials.find((m) => m.id === id);
            for (let i = 0; material && i < count; i++) items.push(material);
        }
        // Cheapest first, so the sale builds up to the best finds.
        items.sort((a, b) => a.value - b.value);
        const total = items.length;
        const earned = DigProgress.sellAll(multiplier);
        GameAnalytics.sold(atPad ? 'atm' : 'anywhere', DigProgress.timesSold);
        const tosses = Math.min(total, SELL_MAX_TOSSES);
        const interval = Math.min(SELL_TOSS_INTERVAL, SELL_MAX_SEC / tosses);
        this.hud.holdSale(earned, total);
        this.hud.saySold(earned, interval * tosses + 0.5);
        const pad = target;
        let paid = 0;
        let handed = 0;
        for (let k = 0; k < tosses; k++) {
            // Toss k carries items [first, last) of the sorted backpack.
            const first = Math.floor((k * total) / tosses);
            const last = Math.floor(((k + 1) * total) / tosses);
            const value = Math.round(items.slice(first, last).reduce((sum, m) => sum + m.value, 0) * multiplier * DigProgress.sellMultiplier);
            const material = items[last - 1];
            const from = this.player.pickupPoint(new THREE.Vector3());
            this.effects.toss(from, pad, new THREE.Color(material.color), k * interval, () => {
                paid += value;
                handed += last - first;
                this.hud.releaseSale(value, last - first);
                DigAudio.play('coins');
                if (atPad) this.hub.pulse('atm');
                // Scattered around the target so a quick run of labels doesn't stack into one blob.
                const label = pad.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3.2, 0.5 + Math.random() * 1.6, (Math.random() - 0.5) * 1.2));
                this.effects.floatText(label, `+$${value}`);
                if (k === tosses - 1) {
                    // Rounding leftovers, so the HUD always ends on the real numbers.
                    this.hud.releaseSale(earned - paid, total - handed);
                }
            }, this.terrain.pickupModel(material));
        }
    }

    private placeCamera(): void {
        this.threeCamera.position.copy(this.followTarget).add(cameraOffset(this.threeCamera));
        this.threeCamera.lookAt(this.followTarget);
    }

    public resize(): void {
        this.hud?.reposition();
        this.map?.reposition();
        const screen = Game.overlayScreenData;
        if (this.mapButton && screen) {
            // Under the mute button (top-left corner).
            this.mapButton.position.set(screen.topLeft.x + 64, screen.topLeft.y + 124);
        }
    }

    /**
     * Platform pause (YouTube Playables' ytgame.system.onPause, a hidden tab via the platform's visibility, the debug
     * button): core Game already stops the loop (no updates, no rendering) and DigAudio mutes; here the gsap clock
     * stops too, so every UI tween — panels, reward coins, float texts, the move hint — freezes where it is.
     */
    private onPlatformPause(): void {
        this.platformPaused = true;
        gsap.globalTimeline.pause();
    }

    private onPlatformResume(): void {
        this.platformPaused = false;
        gsap.globalTimeline.resume();
    }

    /** The player's first input starts gameplay (the platform's gameplayStart). */
    private readonly onFirstInput = (): void => {
        if (Gameplay.started) return;
        window.removeEventListener('pointerdown', this.onFirstInput, true);
        window.removeEventListener('keydown', this.onFirstInput, true);
        GameAnalytics.sessionStart(DigProgress.achievementStat('blocks') === 0 && DigProgress.upgradesBought === 0);
        Gameplay.start();
    };

    /** After a menu stopped gameplay (achievements, settings), moving again starts it again. */
    private updateGameplay(): void {
        const position = this.player.transform.position;
        const moved = Math.hypot(position.x - this.gameplayLast.x, position.z - this.gameplayLast.z) > 0.02;
        this.gameplayLast.copy(position);
        if (moved && Gameplay.started && !Gameplay.active) Gameplay.start();
    }

    public destroy(): void {
        this.sceneDestroyed = true;
        PlatformHandler.instance.onPause.remove(this.onPlatformPause, this);
        PlatformHandler.instance.onResume.remove(this.onPlatformResume, this);
        window.removeEventListener('pointerdown', this.onFirstInput, true);
        window.removeEventListener('keydown', this.onFirstInput, true);
        if (this.platformPaused) gsap.globalTimeline.resume();
        DigProgress.saveNow();
        DebugOverlay.instance.removePanel('dig.progress');
        Localization.onLocaleChange.remove(this.onLocaleChange, this);
        this.hud?.destroy();
        this.flyCamera?.destroy();
        this.map?.destroy({ children: true });
        this.mapButton?.destroy({ children: true });
        this.effects?.destroy();
        this.tractor?.destroy();
        this.guide?.destroy();
        this.hardBlocks?.destroy();
        this.terrain?.destroy();
        this.hub?.destroy();
        this.player?.destroy();
        super.destroy();
    }
}
