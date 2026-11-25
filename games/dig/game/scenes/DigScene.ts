// DigScene.ts
//
// Dig & Discover's main scene: the miner's hub room (levels/hub.json) in the middle of a block-voxel
// mine (VoxelTerrain). Walking out of a doorway and pushing into the rock digs automatically — on foot with the pickaxe,
// soon on a tractor (TractorRide) — (MiningController); resources fly into the backpack. The hub's upgrade pads
// (UpgradePads) take the bag and the money for the next tractor, blades or bag; its ATM turns the bag into money, the idol
// shows the artifact collection, the closet is the wardrobe; each
// station gets a bouncing "!" when there's something new to check there. Progress (money, upgrades, the dug tunnels) is
// saved (DigProgress). The mine gets harder in zones further out (VoxelTerrain); reaching a new one and
// digging up finds are announced here.
//
// Teaching the loop: blocks the tool can't dig wear a padlock (HardBlockMarkers) that jumps, with a "NEEDS ..." label,
// when the miner pushes into one; and the backpack filling up is called out over the miner. Animals called on their pad help
// (Crew); the portal at the back of the hub (Portal), once there and paid for, leads to the next dungeon, the gear along, where everything's
// exponential; a rebirth (the HUD's medals) starts over for good upgrades.
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
import { Backpack } from '../player/Backpack';
import { Crew } from '../player/Crew';
import { Portal } from '../world/Portal';
import { shortMoney } from '../utils/Numbers';
import { UpgradePads } from '../world/UpgradePads';
import { CosmeticOffer, COSMETIC_OFFER_SIZE } from '../ui/CosmeticOffer';
import { watchRewardedVideo } from '../ads/RewardedVideo';
import { Guide } from '../world/Guide';
import { RelicHunt } from '../world/RelicHunt';
import { StarMusic } from '../audio/StarMusic';
import { HardBlockMarkers } from '../world/HardBlockMarkers';
import { TreasureSparkles } from '../world/TreasureSparkles';
import { TreasureBeacons } from '../world/TreasureBeacons';
import { PowerSurge } from '../mining/PowerSurge';
import { PowerChestSpawner, POWER_CHEST_TAKEN, TRACTOR_SPOT_COLOR } from '../mining/PowerChestSpawner';
import type { StationKind } from '../data/HubData';
import { hubRects, HUB, buildablesIn } from '../data/HubData';
import { DIG, ChestKind, MaterialDef, PadKind, animalKind } from '../data/DigConfig';
import { COLLECTION_REWARD, DigProgress } from '../data/DigProgress';
import { DigEffects } from '../vfx/DigEffects';
import { MiningController } from '../mining/MiningController';
import { DigHud } from '../ui/DigHud';
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
const FLOOR_SEGMENTS = 220;
/** Floor colour for a zone without its own. */
const DEFAULT_FLOOR = 0x5a3f2c;
/** Darken exposed paths without changing zone hues or the hub's floor. */
const MINE_FLOOR_LIGHTNESS = 0.72;
/** The zones' fog and floors, a little more vivid than listed (saturation, lightness). */
const VIVID = { fog: [0.04, 0.02], floor: [0.03, 0.01] };
/** Zone fog (ui/dig.json zones `fog`): starts and is full at these multiples of the camera distance. */
const FOG_NEAR = 1.25;
const FOG_FAR = 3.4;
/** How fast the fog colour eases to a new zone's (per second, exponential). */
const FOG_BLEND = 1.5;
const DEFAULT_FOG = 0x3a2a1f;
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
    /** Further back on a tractor, the bigger it is (a unit of its size over the smallest's), and how fast that eases (per second). */
    perSize: 10,
    ride: 1.5,
    ease: 2.2,
};
/** The smallest tractor's size. */
const SMALLEST = Math.min(...DIG.tools.filter((tool) => tool.vehicle).map((tool) => tool.rideScale ?? 1));
/** How much further back than DIG_CAMERA.distance it is now. */
let pulledBack = 0;

/** Design aspect the camera distance was tuned for; taller screens pull back so the same area stays framed. */
const REFERENCE_ASPECT = Game.DESIGN_WIDTH / Game.DESIGN_HEIGHT;

function cameraOffset(camera: THREE.PerspectiveCamera): THREE.Vector3 {
    const yaw = THREE.MathUtils.degToRad(DIG_CAMERA.yawDeg);
    const pitch = THREE.MathUtils.degToRad(DIG_CAMERA.pitchDeg);
    const distance = (DIG_CAMERA.distance + pulledBack) * Math.max(1, REFERENCE_ASPECT / camera.aspect);
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
/** A swing breaking at least this many blocks (a drill's) shakes the camera, harder the more, up to SHAKE_MAX. */
const SHAKE_FROM_BLOCKS = 3;
const SHAKE_PER_BLOCK = 0.035;
const SHAKE_MAX = 0.3;
const SHAKE_DECAY = 9;
/** Blocks broken with no gap longer than COMBO_GAP_SEC: every COMBO_STEP of them pops a "N BLOCKS!". */
const COMBO_GAP_SEC = 1.2;
const COMBO_STEP = 10;
const RIDE_COMBO_STEP = 200;
/** Rock's drawn this far round the miner: so much of the camera's distance, and a little. */
const VIEW = { perDistance: 1.9, more: 6 };
/** A cosmetic's card (seconds of play): the first this soon after the first bigger bag; it stays, then the next waits. */
const SKIN_OFFER = { first: 15, stays: 28, wait: 40, right: 24, y: 0.42 };
/** Embers over the lava near the miner: one tried every so often, within this many blocks. */
const EMBER = { every: 0.07, range: 13, colors: [0xff7a2e, 0xffc04a, 0xff4a1e] };
/** Driving (or walking) through lava smokes this often. */
const LAVA_SMOKE_SEC = 0.16;
/** The miner's middle, over their feet. */
const SEEN_HEIGHT = 0.9;
/** The portal appearing is said after the level that brings it. */
const PORTAL_SAID_MS = 1800;
/** A chest's cosmetic popup comes at most this often. */
const GIFT_GAP_MS = 20000;
/** Achievements reached are paid this often (seconds): never a burst of messages. */
const ACHIEVEMENTS_SEC = 4;
const CONFETTI = [0xffd23f, 0x6fe3ff, 0xff7ab8, 0x8fffa0];
/** A power surge's cashed drops are added up and shown as one "+$" this often. */
const SURGE_CASH_SEC = 0.3;

export default class DigScene extends ThreeScene {
    /**
     * Resolves once the scene can be played: the mine drawn (its block models loaded) and the miner's character
     * loaded. The loading screen (index.ts) and the screen fade between mines wait for it, so a player never sees the
     * game without the miner in it. A character that fails to load still resolves it (logged), rather than leaving the
     * player on the loading screen.
     */
    public get ready(): Promise<void> {
        return Promise.all([this.terrain?.ready, this.characterReady]).then(() => undefined);
    }

    /** The miner's character loading (build()). */
    private characterReady: Promise<void> = Promise.resolve();

    /**
     * Rebuilds the scene from scratch as a fresh instance behind the screen fade (set by the game: index.ts): fades
     * out showing `title` / `subtitle`, runs `apply` (the save switches mine), rebuilds, fades back in.
     */
    public static restart?: (title: string, subtitle: string, apply: () => void) => void;

    private readonly world = new World();
    private player!: DigPlayer;
    private terrain!: VoxelTerrain;
    private floor!: THREE.Mesh;
    private fog!: THREE.Fog;
    private readonly fogColors = DIG.zones.map((zone) => new THREE.Color(zone.fog ?? DEFAULT_FOG).offsetHSL(0, VIVID.fog[0], VIVID.fog[1]));
    private hub!: HubRoom;
    private tractor!: TractorRide;
    private pads!: UpgradePads;
    private backpack!: Backpack;
    private crew!: Crew;
    private portal!: Portal;
    /** A cosmetic offered for a video while playing: the card, the seconds till it comes or goes, whose is next. */
    private skinOffer!: CosmeticOffer;
    private skinTimer = SKIN_OFFER.first;
    private skinFor: 'tractor' | 'miner' = 'tractor';
    /** The free one's been shown (it comes once a session). */
    private giftShown = false;
    private skinBusy = false;
    private emberIn = 0;
    private lavaIn = 0;
    private readonly following = new THREE.Vector3();
    private readonly occluded = new THREE.Vector3();
    private guide!: Guide;
    private relicHunt!: RelicHunt;
    /** The power surge's tune (the star feeling), playing while one runs. */
    private readonly starMusic = new StarMusic();
    private hardBlocks!: HardBlockMarkers;
    /** Sparkles over buried finds near the miner. */
    private treasureSparkles!: TreasureSparkles;
    /** Light beams over buried finds and chests, seen from further away. */
    private treasureBeacons!: TreasureBeacons;
    /** The fixed rewarded tractor offer, unlocked in The Deep. */
    private powerChests!: PowerChestSpawner;
    /** Camera shake left (world units), from big swings. */
    private shake = 0;
    private readonly shakeOffset = new THREE.Vector3();
    /** Blocks broken in the current run, and the time since the last one (onBroke). */
    private combo = 0;
    private comboGap = 0;
    /** A power surge's cash not yet shown, and the time to the next "+$". */
    private surgeCash = 0;
    private surgeCashTimer = 0;
    /** Pushes into rock with a full backpack since it filled up (FULL_PUSHES_TO_GUIDE turns the arrows to the ATM on). */
    private fullPushes = 0;
    /** The backpack was full last frame (filling it up gets called out once). */
    private bagWasFull = false;
    /** The station pad the miner stands on (updateStations). */
    private onStation: StationKind | null = null;
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
    /** A commercial break is on its way or playing (adBreakAfterBuy). */
    private adBreakRunning = false;
    /** When the last commercial break ended (or the session started): the cooldown counts from here. */
    private lastAdBreak = performance.now();
    /** A phone sale's rewarded video is playing. */
    private phoneBusy = false;
    private tractorOfferOpen = false;
    private tractorBusy = false;
    private sceneDestroyed = false;
    /** Where the miner was last frame (gameplay restarts when they move). */
    private readonly gameplayLast = new THREE.Vector3();
    /** Move hint: shown on a brand-new game until the miner has walked MOVE_HINT_DISTANCE. */
    private moveHintActive = false;
    private walked = 0;
    private readonly hintLast = new THREE.Vector3();
    /** Where the last footstep sounded (see updateFootsteps()). */
    private readonly lastStep = new THREE.Vector3();
    private readonly followTarget = new THREE.Vector3();
    private readonly pickupPoint = new THREE.Vector3();
    private readonly badgeWorld = new THREE.Vector3();

    public constructor(game: Game) {
        super(game);
    }

    public build(): void {
        PlatformHandler.instance.onPause.add(this.onPlatformPause, this);
        PlatformHandler.instance.onResume.add(this.onPlatformResume, this);
        this.buildLightsAndGround();
        this.terrain = new VoxelTerrain(this.threeScene, DigProgress.savedDug, DigProgress.mineSeed, DigProgress.mineTheme);
        this.colorFloorByZone();
        DigProgress.setDugProvider(() => this.terrain.saveDug());
        this.hub = new HubRoom(this.threeScene, this.world);

        this.player = this.world.add(new DigPlayer(this, this.threeScene));
        this.player.transform.position.set(HUB.start.x, 0, HUB.start.z);
        this.characterReady = this.player.loadCharacter().catch((error) => console.error('[DigScene] character failed to load', error));
        // The rock's models only once the miner is in: on a slow line the two would share it, keeping the loading screen
        // up longer (the rock pops in behind the game instead).
        void this.characterReady.then(() => this.terrain.loadModels());

        this.backpack = new Backpack(this.threeScene, this.player, this.terrain);
        // (Into the backpack: onto its pile.)
        this.effects = new DigEffects(this.threeScene, DIG.terrain.blockHeight, () => this.backpack.top(this.pickupPoint));
        this.tractor = new TractorRide(this.threeScene, this.player, this.effects);
        // A newly revealed area of the hub: smoke where its pieces pop in, and its name on screen.
        this.hub.onReveal = (area, points) => {
            GameAnalytics.areaRevealed(area.id);
            DigAudio.play('reveal');
            for (const point of points) this.effects.smoke(point.clone().setY(0.5), 4, 0.9, new THREE.Color(0xf3e9d8), 0.6);
            // Just after whatever caused it ("UPGRADED!", "BUILT: ..."), so both get read. A room of pieces to buy isn't
            // named (one more name to learn): it just says there's more to build.
            const text = buildablesIn(area).length ? t('newPieces') : t('newArea', { name: names.area(area).toUpperCase() });
            window.setTimeout(() => this.hud.say(text, 0x8fe3ff), 1200);
        };
        this.pads = new UpgradePads(this.threeScene, (to) => this.pour(to), (kind, at) => this.upgraded(kind, at), (def, at) => {
            DigAudio.play('reveal');
            this.effects.smoke(at.setY(0.4), 6, 0.9, new THREE.Color(0xf3e9d8), 0.8);
        });
        this.hud = this.createHud();
        this.skinOffer = new CosmeticOffer(() => void this.takeSkinOffer());
        // Behind the HUD (its panels open over it).
        this.game.uiLayer.addChildAt(this.skinOffer, this.game.uiLayer.getChildIndex(this.hud));
        DigProgress.levelUpListeners.push(this.onLevelUp);
        this.resize();
        Localization.onLocaleChange.add(this.onLocaleChange, this);
        // A brand-new game: show how to move first.
        this.moveHintActive = DigProgress.achievementStat('blocks') === 0 && DigProgress.upgradesBought === 0;
        if (this.moveHintActive) this.hud.moveHint.show();
        this.hintLast.copy(this.player.transform.position);
        // Finding a relic (or building the tutorial's hub piece) names the next one, once the moment's own message has
        // been read; the guide's arrows lead there.
        this.relicHunt = new RelicHunt(this.terrain, (find) => {
            window.setTimeout(() => this.hud.say(t('relicNext', { name: names.find(find).toUpperCase() }), 0xffd23f), 1200);
        });
        this.guide = new Guide(this.threeScene, this.hub, (x, z) => this.terrain.isSolid(x, z), this.relicHunt, this.pads, (text) => this.hud.setGuide(text));
        this.hardBlocks = new HardBlockMarkers(this.threeScene, this.terrain);
        this.treasureSparkles = new TreasureSparkles(this.terrain, this.effects);
        this.treasureBeacons = new TreasureBeacons(this.threeScene, this.terrain);
        this.powerChests = new PowerChestSpawner(this.threeScene, this.terrain, () => this.offerTractor());
        this.mining = new MiningController(this.terrain, this.effects, this.player, this.tractor, (text) => this.hud.say(text, 0xffd9a8), (find, zone) => {
            // Paid on the spot, its coins flying into the money: nothing pops up, the digging goes on.
            const amount = DigProgress.findPayout(find, zone);
            const result = DigProgress.addFind(find, amount);
            GameAnalytics.findDug(find.id);
            DigProgress.addXp(DIG.levels.xp.find);
            const from = this.minerOnScreen();
            this.hud.claimReward(find.id, from);
            if (result.completed) {
                this.hud.claimReward(COLLECTION_REWARD, from);
                this.hud.say(t('allArtifacts', { count: DIG.finds.length }), 0xffd23f);
            }
            const over = this.player.pickupPoint(new THREE.Vector3());
            this.effects.floatText(over.clone().setY(3.3), names.find(find).toUpperCase(), '#ffd23f');
            this.effects.floatText(over.clone().setY(2.5), `+${shortMoney(amount)}`, '#8fffa0');
            DigAudio.play('sparkle');
            if (find.rarity !== 'common') DigAudio.play('cheer');
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
        }, (kind, zone) => this.openChest(kind, zone), (count, at) => {
            this.onBroke(count, at);
        }, (amount) => {
            this.surgeCash += amount;
        });
        this.crew = new Crew(this.threeScene, this.terrain, this.mining, (at, gave) => {
            if (!gave) return;
            this.effects.hit(at, new THREE.Color(0xd8cfc2));
            DigAudio.play('hitStone');
        });
        this.portal = new Portal(this.threeScene, () => this.travelTo(DigProgress.currentMine + 1), () => {
            Portal.boxes().forEach((box) => this.hub.addSolid(box));
            window.setTimeout(() => this.hud.say(t('portalAppears'), 0xd7a6ff), PORTAL_SAID_MS);
            DigAudio.play('reveal');
        }, (at) => this.effects.sparkle(at, new THREE.Color(0xb57bff), 0.45));
        if (DigProgress.padThere('portal')) Portal.boxes().forEach((box) => this.hub.addSolid(box));
        this.flyCamera = new DebugFlyCameraController(this.threeCamera, SetupThree.renderer.domElement);
        if (Game.debugParams.dev) {
            this.buildDevMap();
        }

        this.followTarget.copy(this.player.transform.position);
        this.placeCamera();
        this.buildDebug();
        // Gameplay starts on the first input, but only once the game is loaded (taps on the loading screen don't count).
        void this.ready.then(() => {
            if (this.sceneDestroyed) return;
            // The game is in: now the hub's decor, buildables and trophies load (they pop in as they arrive).
            this.hub.loadDecor();
            window.addEventListener('pointerdown', this.onFirstInput, true);
            window.addEventListener('keydown', this.onFirstInput, true);
        });
        // A save from before analytics: its past tutorial steps count as sent (not reported all at once now).
        if (DigProgress.once('tutorial-primed')) GameAnalytics.primeTutorial((step) => this.tutorialDone(step));
    }

    /** Mine floor with a collider under the whole map, and warm, readable light (GDD §16: not too dark). */
    private buildLightsAndGround(): void {
        // Near black like the bedrock: past the world's end there's nothing but dark — until the zone fog tints the
        // horizon (updateFog() shares the fog's colour with the background so the far edge melts into it).
        this.fog = new THREE.Fog(this.fogColors[0].clone(), 1, 2);
        this.threeScene.fog = this.fog;
        this.threeScene.background = this.fog.color;
        // Cool sky fill and warm sun: lit faces warm, shaded sides cool, so blocks keep their shape from above.
        this.threeScene.add(new THREE.HemisphereLight(0xe2ebff, 0x483a50, 1.28));
        const sun = new THREE.DirectionalLight(0xffe3b6, 1.95);
        sun.position.set(6, 14, 8);
        this.threeScene.add(sun);

        const size = DIG.terrain.radius * 2 + 4;
        // Shaded per zone through vertex colours (colorFloorByZone(), once the terrain knows its zones).
        const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, vertexColors: true });
        BendService.applyBend(floorMaterial);
        this.floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size, FLOOR_SEGMENTS, FLOOR_SEGMENTS), floorMaterial);
        this.floor.rotation.x = -Math.PI / 2;
        this.floor.position.y = -0.01;
        // (Lifted over the far zones: its own bounds aren't where it's drawn.)
        this.floor.frustumCulled = false;
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
        const zoneColors = DIG.zones.map((zone, i) => new THREE.Color(themeFloors?.[i] ?? zone.floor ?? DEFAULT_FLOOR).offsetHSL(0, VIVID.floor[0], VIVID.floor[1]).multiplyScalar(MINE_FLOOR_LIGHTNESS));
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
            mesh.frustumCulled = false;
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
            DigProgress.addXp(DIG.levels.xp.zone * zone);
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
        panel.button('POWER SURGE (without using up the power chest)', () => this.openChest('power', this.currentZone, true));
        panel.button('SPAWN TRACTOR AD SPOT (3 blocks ahead)', () => {
            const forward = new THREE.Vector3(0, 0, 1);
            const container = this.player.character?.container;
            if (container) forward.applyQuaternion(container.quaternion).setY(0).normalize();
            this.powerChests.debugPlaceNear(this.player.transform.position, forward);
        });
        panel.button('ADD $100', () => DigProgress.addMoney(100));
        panel.button('ADD $5000', () => DigProgress.addMoney(5000));
        panel.button('ADD $1M', () => DigProgress.addMoney(1000000));
        panel.monitor('Power', () => `${PowerSurge.power} (blades ${DigProgress.bladesLevel})`);
        panel.button('NEXT TRACTOR', () => this.grant('tool'));
        panel.button('NEXT BLADES', () => this.grant('blades'));
        panel.button('NEXT BAG', () => this.grant('capacity'));
        panel.button('CHEST COSMETIC', () => {
            this.lastGift = -Infinity;
            this.giveCosmetic();
        });
        panel.button('NEXT ANIMAL', () => this.grant('animals'));
        panel.button('OPEN THE PORTAL', () => this.grant('portal'));
        panel.button('REBIRTH (if there is one)', () => this.rebirth());
        panel.button('ADD $1T', () => DigProgress.addMoney(1e12));
        panel.button('COSMETIC AD CARD (now)', () => {
            this.skinOffer.hide();
            this.skinTimer = 0;
        });
        panel.monitor('Ad card in', () => `${Math.max(0, this.skinTimer).toFixed(0)}s${this.skinOffer.offered ? ' (goes)' : ''}`);
        panel.button('LEVEL UP', () => DigProgress.levelUp());
        panel.button('FILL THE BAG', () => DigProgress.addItems('stone', DigProgress.capacity));
        panel.slider(BendService.uniforms.uVibrance, 'value', 0.6, 2, 0.01, 'Vibrance');
        panel.slider(DIG.digging, 'chewSec', 0.05, 1.5, 0.01, 'Chew seconds');
        panel.slider(DIG.digging, 'falloff', 0.2, 1, 0.01, 'Chew falloff');
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
        if (Gameplay.active) {
            GameAnalytics.playTime(delta);
        }
        this.world.update(delta);
        this.world.lateUpdate(delta);
        this.tractor.update(delta);
        this.backpack.update(delta);
        this.pads.enabled = !this.leaving;
        this.portal.update(delta, this.player.transform.position, !this.leaving && !this.hud.busy);
        this.pads.update(delta, this.player.transform.position);
        this.updateLava(delta);
        this.updateSkinOffer(delta);
        this.hud.tick();
        this.updateFootsteps();
        this.updateMoveHint();
        this.relicHunt.update(delta, this.player.transform.position);
        this.guide.update(delta, this.player.transform.position);
        this.hardBlocks.update(delta, this.player.transform.position);
        this.treasureSparkles.update(delta, this.player.transform.position);
        this.treasureBeacons.focus = this.relicHunt.targetCell;
        this.treasureBeacons.update(delta, this.player.transform.position);
        if (PlatformHandler.ENABLE_VIDEO_ADS) this.powerChests.update(this.player.transform.position, Gameplay.active && !this.tractorOfferOpen
            && !this.phoneBusy && !this.adBreakRunning && this.hud.canOfferTractor);
        this.updateTractorBadge();
        this.updatePowerSurge(delta);
        this.terrain.viewRange = cameraOffset(this.threeCamera).length() * VIEW.perDistance + VIEW.more;
        this.terrain.update(delta);
        this.updateFog(delta);
        this.effects.update(delta);
        this.hub.update(delta, this.player.transform.position);
        this.flyCamera.update(delta);
        this.map?.update(delta);
        BendService.updateTime(delta);
        super.update(delta);
    }

    /** The rewarded tractor spot's video badge, kept over the tractor on screen (bent like the world it floats in). */
    private updateTractorBadge(): void {
        if (!PlatformHandler.ENABLE_VIDEO_ADS || !this.powerChests.badgeVisible) {
            this.hud.setTractorBadge(null);
            return;
        }
        const world = BendService.applyToPosition(this.powerChests.badgePosition(this.badgeWorld));
        const screen = this.worldToScreen(world);
        this.hud.setTractorBadge(screen ? this.hud.toLocal(new PIXI.Point(screen.x, screen.y), this.game.app.stage) : null);
    }

    /** Cash chests pay immediately; power starts after a rewarded offer or the debug button. */
    private openChest(kind: ChestKind, zone: number, debug = false): void {
        if (!debug) GameAnalytics.chestDug(kind, DIG.zones[zone].id);
        if (kind === 'power' && !debug) DigProgress.once(POWER_CHEST_TAKEN);
        const at = this.player.pickupPoint(new THREE.Vector3());
        const color = new THREE.Color(kind === 'power' ? TRACTOR_SPOT_COLOR : 0xffd23f);
        for (let i = 0; i < 14; i++) {
            this.effects.sparkle(at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 1.6, Math.random() * 0.8, (Math.random() - 0.5) * 1.6)), color, 0.55);
        }
        DigAudio.play('cheer');
        if (kind === 'cash') {
            DigProgress.addXp(DIG.levels.xp.chest);
            const amount = DigProgress.chestPayout(zone);
            DigProgress.addEarned(amount);
            this.hud.say(t('cashChest', { amount: shortMoney(amount).slice(1) }), 0xffd23f);
            this.effects.floatText(at.clone().setY(2.6), `+${shortMoney(amount)}`, '#ffe27a');
            DigAudio.play('coins');
            this.giveCosmetic();
            return;
        }
        const tool = PowerSurge.start();
        GameAnalytics.powerSurge(tool.id, 'start');
        this.hud.say(t('powerChest', { tool: names.tool(tool).toUpperCase(), seconds: DIG.chests.power.seconds }), 0x8fe9ff);
        DigAudio.play('quest');
        this.mining.toolChanged();
        // Whatever's in the bag stays there: the surge cashes new drops only.
        this.guide.setReturnToSell(false);
        this.fullPushes = 0;
    }

    /**
     * What else a chest holds: a cosmetic on the card (nothing stops for it), free or for a video in turn, the first free. None right
     * after another, nor during a surge.
     */
    private giveCosmetic(): void {
        const now = performance.now();
        if (this.hud.busy || this.leaving || this.skinBusy || PowerSurge.active || now - this.lastGift < GIFT_GAP_MS) return;
        const gift = DigProgress.cosmeticToGive();
        if (!gift) return;
        this.lastGift = now;
        this.skinTimer = SKIN_OFFER.stays;
        const free = this.chestCards++ % 2 === 0;
        this.skinOffer.offer(gift, free);
        DigAudio.play('sparkle');
        GameAnalytics.chestGift(gift.who, gift.kind, free ? 'free' : 'video');
    }

    /** The miner, on the screen (the stage's global space). */
    private minerOnScreen(): PIXI.Point {
        const at = BendService.applyToPosition(this.player.pickupPoint(new THREE.Vector3()));
        const screen = this.worldToScreen(at);
        return this.game.app.stage.toGlobal(new PIXI.Point(screen?.x ?? 0, screen?.y ?? 0));
    }

    private lastGift = -Infinity;
    private chestCards = 0;
    /** Till achievements reached are paid. */
    private achievementsIn = 0;

    /** Runs a power surge's clock (only while playing), its HUD countdown and cash pops, and its end. */
    private updatePowerSurge(delta: number): void {
        this.surgeCashTimer -= delta;
        if (this.surgeCash > 0 && this.surgeCashTimer <= 0) {
            this.surgeCashTimer = SURGE_CASH_SEC;
            this.effects.floatText(this.player.pickupPoint(new THREE.Vector3()).setY(2.3), `+${shortMoney(this.surgeCash)}`);
            this.surgeCash = 0;
        }
        // Only while the miner can dig: a menu, or a forced purchase holding the game doesn't eat it.
        const ended = Gameplay.active && this.player.movementController.enabled ? PowerSurge.update(delta) : undefined;
        const tool = PowerSurge.tool;
        if (tool && !this.starMusic.playing) this.starMusic.start();
        if (!tool && this.starMusic.playing) this.starMusic.stop();
        this.starMusic.update();
        this.hud.setPower(tool ? t('powerTimer', { tool: names.tool(tool).toUpperCase(), seconds: Math.ceil(PowerSurge.secondsLeft) }) : null, PowerSurge.fraction);
        if (!ended) return;
        GameAnalytics.powerSurge(ended.id, 'complete');
        this.mining.toolChanged();
        // Still above the tool owned: name it, it's what to save up for.
        const owned = DIG.tools.indexOf(ended) <= DigProgress.toolLevel;
        this.hud.say(owned ? t('powerOver') : t('powerOverBuy', { tool: names.tool(ended) }), 0x8fe9ff);
        DigAudio.play('quest');
    }

    /** One swing broke `count` blocks: big swings shake the camera, and a long run pops a "N BLOCKS!". */
    private onBroke(count: number, at: THREE.Vector3): void {
        // (A tractor breaks them all the time: no shaking, no pulses, and a run's called out a lot later.)
        const riding = this.tractor.isRiding;
        const step = riding ? RIDE_COMBO_STEP : COMBO_STEP;
        if (!riding) this.effects.wideBreak(at, count);
        if (!riding && count >= SHAKE_FROM_BLOCKS) this.shake = Math.min(SHAKE_MAX, this.shake + count * SHAKE_PER_BLOCK);
        const before = this.combo;
        this.combo += count;
        this.comboGap = 0;
        if (Math.floor(this.combo / step) > Math.floor(before / step)) {
            const shown = Math.floor(this.combo / step) * step;
            this.effects.floatText(this.player.pickupPoint(new THREE.Vector3()).setY(3), t('combo', { count: shown }), '#ffd23f');
        }
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
        }, () => void this.sellByPhone(), () => this.player.applyLook(DigProgress.look), () => this.rebirth(), (index) => this.travelTo(index));
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
        this.game.uiLayer.addChildAt(this.skinOffer, this.game.uiLayer.getChildIndex(this.hud));
        this.hud.openLanguage();
        if (this.moveHintActive) this.hud.moveHint.show();
        this.hub.relabel();
        this.resize();
    }

    /** Physics, mining and camera on the same clock, so the character and camera never jitter against each other. */
    public fixedUpdate(delta: number): void {
        // The footprint against the rock: wider on the tractor (before movement uses it).
        const at = this.player.transform.position;
        this.terrain.setBody(at.x, at.z, this.tractor.isRiding ? this.tractor.circles() : undefined);
        // Its own speed on the tractor; slower through lava.
        this.player.speedMultiplier = (this.tractor.isRiding ? PowerSurge.digTool.rideSpeed ?? DIG.tractor.speedMultiplier : 1) * (this.terrain.isLava(at.x, at.z) ? DIG.lava.slow : 1);
        this.world.fixedUpdate(delta);
        this.mining.fixedUpdate(delta);
        this.crew.update(delta, this.player.transform.position, !this.inHub() && !this.leaving, DIG.animals.radius + (this.tractor.isRiding ? this.tractor.scale : 0));
        this.updateStations();
        this.updateBagFull();
        this.updateForced();
        this.updateTutorialFunnel();
        this.updateZone();

        this.comboGap += delta;
        if (this.comboGap > COMBO_GAP_SEC) this.combo = 0;
        this.shake *= Math.exp(-SHAKE_DECAY * delta);
        if (this.shake < 0.005) this.shake = 0;

        const position = this.player.transform.position;
        const followT = 1 - Math.exp(-DIG_CAMERA.followSpeed * delta);
        this.followTarget.lerp(this.following.copy(position).setY(BendService.ground(position.x, position.z)), followT);
        const back = this.tractor.isRiding ? DIG_CAMERA.ride + (this.tractor.scale - SMALLEST) * DIG_CAMERA.perSize : 0;
        pulledBack += (back - pulledBack) * (1 - Math.exp(-DIG_CAMERA.ease * delta));
        if (!this.flyCamera.isEnabled()) {
            this.placeCamera();
        }
        BendService.updateOrigin(this.followTarget);
        BendService.updateCameraPosition(this.threeCamera.position);
        // (The miner's middle: what's between it and the camera is seen through.)
        BendService.updateOcclusionTarget(this.occluded.copy(this.following).setY(this.following.y + SEEN_HEIGHT));
    }

    /**
     * Standing on a station's pad uses it: the ATM sells the backpack (the items fly into its slot), the idol and the
     * closet open their panels. Also keeps the "!" marks current. (The upgrade pads are their own: UpgradePads.)
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
                this.sell(this.hub.stationTarget(station.kind) ?? new THREE.Vector3(station.x, 1, station.z), station.kind);
            }
        }
        this.onStation = open;
        this.hud.setStationPanel(open);
        this.hub.setAttention('atm', open !== 'atm' && DigProgress.backpackCount >= DigProgress.capacity);
        this.hub.setAttention('collection', DigProgress.unseenFinds.length > 0);
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

    /** Whether the miner can move: not while something's up that waits for them. */
    private updateForced(): void {
        this.player.movementController.enabled = !this.leaving && !this.tractorOfferOpen && !this.flyCamera.isEnabled();
    }

    private inHub(): boolean {
        const at = this.player.transform.position;
        return hubRects().some((r) => Math.abs(at.x - r.x) <= r.width / 2 && Math.abs(at.z - r.z) <= r.depth / 2);
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
            case 'blades': return DigProgress.bladesLevel > 0;
            case 'find': return DigProgress.totalFinds > 0;
            case 'animal': return DigProgress.tutorialOver;
        }
    }

    /** Reports each tutorial step the moment it's done (GameAnalytics sends each once per player). */
    private updateTutorialFunnel(): void {
        for (const step of TUTORIAL) {
            if (this.tutorialDone(step)) GameAnalytics.tutorialStep(step);
        }
    }

    /** Sells right where the miner stands, the items flying up and away (the ATM does it in the hub); `multiplier` on the value. */
    private sellAnywhere(multiplier = 1): void {
        if (DigProgress.backpackCount === 0) return;
        this.sell(this.player.transform.position.clone().add(new THREE.Vector3(0, SELL_ANYWHERE_HEIGHT, -0.6)), null, multiplier);
    }

    /** Starts over for medals: back in the first dungeon with nothing (DigProgress.rebirth), through the screen fade. */
    private rebirth(): void {
        if (!DigProgress.canRebirth) return;
        this.leaveFor(0, () => {
            const medals = DigProgress.rebirth();
            if (medals > 0) GameAnalytics.reborn(DigProgress.rebirths);
        }, t('rebirthTitle'));
    }

    /** Goes to another dungeon already open (through the portal, or from the MAP), the gear along: its tunnels as they were left. */
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
    private leaveFor(index: number, apply: () => void, title = t('portalTo', { n: index + 1 })): void {
        if (this.leaving || !DigScene.restart) return;
        this.leaving = true;
        this.player.movementController.enabled = false;
        const theme = DigProgress.themeFor(index);
        // Not from inside the HUD's tap handler: the HUD is torn down with the scene.
        window.setTimeout(() => DigScene.restart?.(title, names.theme(theme.name), apply), 0);
    }

    /**
     * The platform's commercial break, only ever right after the player taps BUY on an upgrade (a natural pause, and
     * an input of theirs — never on walking somewhere): not during the tutorial (until the first animal's called),
     * at most once every AD_BREAK_COOLDOWN_MS (counted from the session start too), and a beat after the tap so the
     * "UPGRADED!" fanfare lands first. Gameplay stops for it; the miner's next move starts it again.
     */
    private async adBreakAfterBuy(): Promise<void> {
        const now = performance.now();
        if (this.adBreakRunning || this.tractorOfferOpen || !DigProgress.tutorialOver || now - this.lastAdBreak < AD_BREAK_COOLDOWN_MS) return;
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

    /** Something out of the bag flies onto a pad's stand (money, once the bag's empty). */
    private pour(to: THREE.Vector3): void {
        const id = Object.keys(DigProgress.backpack).find((key) => DigProgress.backpack[key] > 0);
        const material = DIG.materials.find((m) => m.id === id);
        const from = this.backpack.top(new THREE.Vector3());
        this.effects.toss(from, to.clone(), new THREE.Color(material?.color ?? '#8fffa0'), 0, () => undefined, material && this.terrain.pickupModel(material));
        DigAudio.play('coins');
    }

    /** A pad's paid in full: what it gave, said and shown. */
    private upgraded(kind: PadKind, at: THREE.Vector3): void {
        DigProgress.countPadVisit();
        DigProgress.addXp(DIG.levels.xp.upgrade);
        DigAudio.play('buyCash');
        DigAudio.play('buyFanfare');
        if (kind === 'tool') {
            DigAudio.play('buyShine');
            GameAnalytics.toolBought(DigProgress.toolLevel, DigProgress.tool.id);
            this.hud.say(t('newTractor', { tool: names.tool(DigProgress.tool).toUpperCase() }), 0xffe27a);
            this.mining.toolChanged();
        } else if (kind === 'animals') {
            GameAnalytics.animalCalled(DigProgress.animals);
            this.hud.say(t('newAnimal', { animal: names.animal(animalKind(DigProgress.animals - 1)).toUpperCase() }), 0xffe27a);
            DigAudio.play('cheer');
        } else if (kind === 'portal') {
            GameAnalytics.portalOpened(DigProgress.prestige + 1);
            this.hud.say(t('portalOpen'), 0xd7a6ff);
            DigAudio.play('applause');
            DigAudio.play('cheer');
        } else if (kind === 'blades') {
            GameAnalytics.bladesBought(DigProgress.bladesLevel);
            this.hud.say(t('newBlades', { power: DigProgress.power }), 0xffe27a);
        } else {
            GameAnalytics.backpackBought(DigProgress.backpackLevel, DigProgress.capacity);
            this.hud.say(t('newBag', { capacity: DigProgress.capacity }), 0xffe27a);
        }
        this.burst(at);
    }

    private grant(kind: PadKind): void {
        if (DigProgress.grant(kind)) this.upgraded(kind, this.player.transform.position.clone().setY(1.2));
    }

    /** Sparkles of every colour. */
    private burst(at: THREE.Vector3): void {
        for (let i = 0; i < 18; i++) {
            const from = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.2, (Math.random() - 0.5) * 2));
            this.effects.sparkle(from, new THREE.Color(CONFETTI[i % CONFETTI.length]), 0.55);
        }
    }

    /** A new level: said big, with what it pays. */
    private readonly onLevelUp = (level: number, cash: number): void => {
        if (this.sceneDestroyed) return;
        GameAnalytics.levelReached(level);
        DigAudio.play('cheer');
        DigAudio.play('quest');
        const text = t('levelUp', { level });
        this.hud.say(`${text}  +${shortMoney(cash)}`, 0xffe27a);
        const at = this.player.transform.position.clone();
        this.effects.floatText(at.clone().setY(3), text, '#ffe27a');
        this.burst(at.setY(0.6));
    };

    /** Embers rise off the lava near the miner; driving through it smokes. */
    private updateLava(delta: number): void {
        const at = this.player.transform.position;
        this.emberIn -= delta;
        while (this.emberIn <= 0) {
            this.emberIn += EMBER.every;
            const x = at.x + (Math.random() - 0.5) * 2 * EMBER.range;
            const z = at.z + (Math.random() - 0.5) * 2 * EMBER.range;
            if (!this.terrain.isLava(x, z)) continue;
            this.effects.sparkle(new THREE.Vector3(x, 0.15, z), new THREE.Color(EMBER.colors[Math.floor(Math.random() * EMBER.colors.length)]), 0.4);
        }
        this.lavaIn -= delta;
        if (this.lavaIn > 0 || !this.terrain.isLava(at.x, at.z)) return;
        this.lavaIn = LAVA_SMOKE_SEC;
        this.effects.smoke(at.clone().setY(0.2), 1, 0.8, new THREE.Color(0x4a3a36), 1.2);
    }

    /**
     * A cosmetic on a card while playing: the tractor's gift first, then one for a video, the tractor's and the miner's in turn. It
     * stays a while, goes, and something else comes later; tapped, its video.
     */
    private updateSkinOffer(delta: number): void {
        // (Achievements pay by themselves as they're reached.)
        this.achievementsIn -= delta;
        if (this.achievementsIn <= 0 && !this.hud.busy && !this.leaving && DigProgress.tutorialOver) {
            this.achievementsIn = ACHIEVEMENTS_SEC;
            this.hud.payAchievements();
        }
        const card = this.skinOffer;
        const { offered } = card;
        if (offered && DigProgress.ownsCosmetic(offered)) this.skinTimer = 0;
        else if (this.hud.busy || this.skinBusy || !Gameplay.active || (!offered && (DigProgress.backpackLevel === 0 || PowerSurge.active))) return;
        this.skinTimer -= delta;
        if (this.skinTimer > 0) return;
        if (offered) {
            card.hide();
            this.skinTimer = SKIN_OFFER.wait;
            return;
        }
        const gift = this.tractor.isRiding && !this.giftShown ? DigProgress.tractorGift() : undefined;
        this.giftShown ||= !!gift;
        const next = gift ?? DigProgress.cosmeticToOffer(this.skinFor);
        if (!gift) this.skinFor = this.skinFor === 'tractor' ? 'miner' : 'tractor';
        this.skinTimer = SKIN_OFFER.stays;
        if (!next) return;
        card.offer(next);
        GameAnalytics.skinOffer(next.who, next.kind, next.item.id, 'visible');
    }

    /** The offered one tapped: its video (none for the gift), then it's theirs, and on. */
    private async takeSkinOffer(): Promise<void> {
        const { offered, free } = this.skinOffer;
        if (!offered || this.skinBusy) return;
        const { who, kind, item } = offered;
        this.skinBusy = true;
        GameAnalytics.skinOffer(who, kind, item.id, 'interact');
        const watched = free || (await watchRewardedVideo(`${who} ${item.id}`));
        this.skinBusy = false;
        if (this.sceneDestroyed) return;
        GameAnalytics.skinOffer(who, kind, item.id, free ? 'gift' : watched ? 'unlocked' : 'no-video');
        if (!watched) {
            this.hud.say(t('noVideo'), 0xff9a8a);
            return;
        }
        this.skinOffer.hide();
        this.skinTimer = SKIN_OFFER.wait;
        DigProgress.giveCosmetic(offered, true);
        if (who === 'miner') this.player.applyLook(DigProgress.look);
        const name = item.name ? (who === 'miner' ? names.look(item.name) : item.name) : t('newLook');
        this.hud.say(t('tractorUnlocked', { name: name.toUpperCase() }), 0x9cff9c);
        DigAudio.play('buyFanfare');
        this.burst(this.player.transform.position.clone().setY(0.8));
    }

    /**
     * The HUD's phone: the backpack sold right here at x2. The first DigProgress.freeSellsLeft sales are free; after
     * that it's a rewarded video first (bandit's bonus flow: gameplay stops for the ad, the miner's next move starts it
     * again). A closed or failed video sells nothing; the phone comes back.
     */
    private async sellByPhone(): Promise<void> {
        if (this.phoneBusy || this.tractorOfferOpen || DigProgress.backpackCount === 0) return;
        if (DigProgress.freeSellsLeft > 0) {
            GameAnalytics.phoneTapped(true);
            DigProgress.useFreeSell();
            this.sellAnywhere(2);
            GameAnalytics.phoneResult(true, true);
            return;
        }
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

    private offerTractor(): void {
        if (this.tractorOfferOpen || !this.powerChests.available) return;
        this.tractorOfferOpen = true;
        this.player.movementController.enabled = false;
        Gameplay.stop();
        GameAnalytics.tractorOffer('start');
        this.hud.showTractorOffer(() => void this.watchTractorVideo(), () => {
            GameAnalytics.tractorOffer('skip');
            this.tractorOfferOpen = false;
            this.hud.hideTractorOffer();
        });
    }

    private async watchTractorVideo(): Promise<void> {
        if (this.tractorBusy || !this.tractorOfferOpen || !this.powerChests.available) return;
        this.tractorBusy = true;
        this.hud.setTractorBusy();
        GameAnalytics.tractorOffer('interact');
        let watched = false;
        try {
            Gameplay.stop();
            watched = PlatformHandler.ENABLE_VIDEO_ADS
                && await PlatformHandler.instance.platform.showRewardedVideo() === true;
        } catch (error) {
            console.warn('[DigScene] Tractor rewarded video failed', error);
        }
        this.tractorBusy = false;
        if (this.sceneDestroyed) return;
        GameAnalytics.tractorOffer(watched ? 'complete' : 'fail');
        this.tractorOfferOpen = false;
        this.hud.hideTractorOffer();
        if (!watched) {
            this.hud.say(t('tractorAdFailed'), 0xff9a8a);
            return;
        }
        this.powerChests.consume();
        this.openChest('power', this.terrain.zoneIndexAt(this.player.transform.position.x, this.player.transform.position.z), true);
    }

    /**
     * Sells the backpack at once (so the save is right), then plays it out: the items stream out of the
     * miner to `target` (`pad`'s slot: the ATM; or up into the air for the SELL button), each arrival pops a
     * "+$" label (and flashes the ATM's pad) and hands its money and slot over in the HUD. Big
     * backpacks toss at most SELL_MAX_TOSSES items, each carrying a share.
     */
    private sell(target: THREE.Vector3, atPad: 'atm' | null, multiplier = 1): void {
        const items: MaterialDef[] = [];
        for (const [id, count] of Object.entries(DigProgress.backpack)) {
            const material = DIG.materials.find((m) => m.id === id);
            for (let i = 0; material && i < count; i++) items.push(material);
        }
        // Cheapest first, so the sale builds up to the best finds.
        items.sort((a, b) => a.value - b.value);
        const total = items.length;
        const earned = DigProgress.sellAll(multiplier);
        GameAnalytics.sold(atPad ?? 'anywhere', DigProgress.timesSold);
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
            const value = Math.round(items.slice(first, last).reduce((sum, m) => sum + DigProgress.itemValue(m.id), 0) * multiplier * DigProgress.sellMultiplier);
            const material = items[last - 1];
            const from = this.backpack.top(new THREE.Vector3());
            this.effects.toss(from, pad, new THREE.Color(material.color), k * interval, () => {
                paid += value;
                handed += last - first;
                this.hud.releaseSale(value, last - first);
                DigAudio.play('coins');
                if (atPad) this.hub.pulse(atPad);
                // Scattered around the target so a quick run of labels doesn't stack into one blob.
                const label = pad.clone().add(new THREE.Vector3((Math.random() - 0.5) * 3.2, 0.5 + Math.random() * 1.6, (Math.random() - 0.5) * 1.2));
                this.effects.floatText(label, `+${shortMoney(value)}`);
                if (k === tosses - 1) {
                    // Rounding leftovers, so the HUD always ends on the real numbers.
                    this.hud.releaseSale(earned - paid, total - handed);
                }
            }, this.terrain.pickupModel(material));
        }
    }

    private placeCamera(): void {
        // A shake moves camera and look-at together, so the view jolts without turning.
        this.shakeOffset.set((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2).multiplyScalar(this.shake);
        this.threeCamera.position.copy(this.followTarget).add(cameraOffset(this.threeCamera)).add(this.shakeOffset);
        this.threeCamera.lookAt(this.shakeOffset.add(this.followTarget));
    }

    /** The far view fades into the miner's zone's fog colour (eased across borders), at the camera's distance. */
    private updateFog(delta: number): void {
        const position = this.player.transform.position;
        const target = this.fogColors[this.terrain.zoneIndexAt(position.x, position.z)];
        this.fog.color.lerp(target, 1 - Math.exp(-delta * FOG_BLEND));
        const distance = cameraOffset(this.threeCamera).length();
        this.fog.near = distance * FOG_NEAR;
        this.fog.far = distance * FOG_FAR;
    }

    public resize(): void {
        this.hud?.reposition();
        this.map?.reposition();
        const screen = Game.overlayScreenData;
        if (screen) this.skinOffer?.position.set(screen.topLeft.x + screen.width - SKIN_OFFER.right - COSMETIC_OFFER_SIZE.width / 2, screen.topLeft.y + screen.height * SKIN_OFFER.y + COSMETIC_OFFER_SIZE.height / 2);
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
        // Playing now: the tractor's model comes down behind the game (one already owned loaded with the scene), and
        // the power chest's (the same tractor) with it.
        this.tractor.loadInBackground();
        this.terrain.loadPowerModel();
    };

    /** After a menu stopped gameplay (achievements, settings), moving again starts it again. */
    private updateGameplay(): void {
        const position = this.player.transform.position;
        const moved = Math.hypot(position.x - this.gameplayLast.x, position.z - this.gameplayLast.z) > 0.02;
        this.gameplayLast.copy(position);
        if (moved && Gameplay.started && !Gameplay.active && !this.tractorOfferOpen && !this.phoneBusy && !this.adBreakRunning) Gameplay.start();
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
        const listener = DigProgress.levelUpListeners.indexOf(this.onLevelUp);
        if (listener >= 0) DigProgress.levelUpListeners.splice(listener, 1);
        this.skinOffer?.destroy();
        this.pads?.destroy();
        this.backpack?.destroy();
        this.crew?.destroy();
        this.portal?.destroy();
        this.hud?.destroy();
        this.flyCamera?.destroy();
        this.map?.destroy({ children: true });
        this.mapButton?.destroy({ children: true });
        this.effects?.destroy();
        this.tractor?.destroy();
        this.starMusic.stop();
        this.guide?.destroy();
        this.hardBlocks?.destroy();
        this.treasureBeacons?.destroy();
        this.powerChests?.destroy();
        // A surge belongs to this mine (the scene is rebuilt between mines).
        PowerSurge.clear();
        this.terrain?.destroy();
        this.hub?.destroy();
        this.player?.destroy();
        super.destroy();
    }
}
