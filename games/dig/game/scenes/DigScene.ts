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
import type { StationKind } from '../data/HubData';
import { hubRects, HUB } from '../data/HubData';
import { DIG, MaterialDef } from '../data/DigConfig';
import { DigProgress } from '../data/DigProgress';
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

const FLOOR_HALF_THICKNESS = 0.5;
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
/** The move hint goes once the miner has walked this far. */
const MOVE_HINT_DISTANCE = 2.5;

export default class DigScene extends ThreeScene {
    private readonly world = new World();
    private player!: DigPlayer;
    private terrain!: VoxelTerrain;
    private hub!: HubRoom;
    private tractor!: TractorRide;
    private guide!: Guide;
    private effects!: DigEffects;
    private mining!: MiningController;
    private hud!: DigHud;
    private map?: DigMap;
    private mapButton?: PIXI.Container;
    private flyCamera!: DebugFlyCameraController;
    private currentZone = 0;
    private platformPaused = false;
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
        this.terrain = new VoxelTerrain(this.threeScene, DigProgress.savedDug);
        DigProgress.setDugProvider(() => this.terrain.saveDug());
        this.hub = new HubRoom(this.threeScene, this.world);

        this.player = this.world.add(new DigPlayer(this, this.threeScene));
        this.player.transform.position.set(HUB.start.x, 0, HUB.start.z);
        void this.player.loadCharacter().catch((error) => console.error('[DigScene] character failed to load', error));

        this.effects = new DigEffects(this.threeScene, DIG.terrain.blockHeight, () => this.player.pickupPoint(this.pickupPoint));
        this.tractor = new TractorRide(this.threeScene, this.player, this.effects);
        // A newly revealed area of the hub: smoke where its pieces pop in, and its name on screen.
        this.hub.onReveal = (area, points) => {
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
        this.mining = new MiningController(this.terrain, this.effects, this.player, (text) => this.hud.say(text, 0xffd9a8), (find, result) => {
            this.hud.findBanner.show(find, result);
            DigAudio.play('sparkle');
            this.effects.floatText(this.player.pickupPoint(new THREE.Vector3()).setY(2.2), `+$${find.reward}`, '#ffe27a');
        });
        this.flyCamera = new DebugFlyCameraController(this.threeCamera, SetupThree.renderer.domElement);
        if (Game.debugParams.dev) {
            this.buildDevMap();
        }

        this.followTarget.copy(this.player.transform.position);
        this.placeCamera();
        this.buildDebug();
    }

    /** Mine floor with a collider under the whole map, and warm, readable light (GDD §16: not too dark). */
    private buildLightsAndGround(): void {
        this.threeScene.background = new THREE.Color(0x1f1611);
        this.threeScene.add(new THREE.HemisphereLight(0xfff1dc, 0x4a3426, 1.5));
        const sun = new THREE.DirectionalLight(0xffffff, 1.4);
        sun.position.set(6, 14, 8);
        this.threeScene.add(sun);

        const size = DIG.terrain.radius * 2 + 4;
        const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x5a3f2c, roughness: 1 });
        BendService.applyBend(floorMaterial);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(size, size, 48, 48), floorMaterial);
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.01;
        this.threeScene.add(floor);

        const ground = this.world.spawn();
        ground.addComponent(new RigidBody({
            halfExtents: new THREE.Vector3(size / 2, FLOOR_HALF_THICKNESS, size / 2),
            centerOffset: new THREE.Vector3(0, -FLOOR_HALF_THICKNESS, 0),
            isStatic: true,
            layer: Layers.Environment,
        }));
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
        this.world.update(delta);
        this.world.lateUpdate(delta);
        this.tractor.update(delta);
        this.updateFootsteps();
        this.updateMoveHint();
        this.guide.update(delta, this.player.transform.position);
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
        const hud = new DigHud(() => this.mining.toolChanged(), () => this.sellAnywhere(), () => this.player.applyLook(DigProgress.look));
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
        this.world.fixedUpdate(delta);
        this.mining.fixedUpdate(delta);
        this.updateStations();
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
        this.hud.setStationPanel(open);
        this.updateBuilding(position);
        this.hub.setAttention('atm', open !== 'atm' && DigProgress.canAffordUpgrade);
        this.hub.setAttention('collection', DigProgress.unseenFinds.length > 0);
        this.hub.setAttention('wardrobe', open !== 'wardrobe' && DigProgress.wardrobeHasNews);
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

    /** The HUD's SELL button: sells right where the miner stands, the items flying up and away (the ATM does it in the hub). */
    private sellAnywhere(): void {
        if (DigProgress.backpackCount === 0) return;
        this.sell(this.player.transform.position.clone().add(new THREE.Vector3(0, SELL_ANYWHERE_HEIGHT, -0.6)), false);
    }

    /**
     * Sells the backpack at once (so the save is right), then plays it out: the items stream out of the
     * miner to `target` (the ATM's slot, or up into the air for the SELL button), each arrival pops a
     * "+$" label (and flashes the ATM's pad) and hands its money and slot over in the HUD. Big
     * backpacks toss at most SELL_MAX_TOSSES items, each carrying a share.
     */
    private sell(target: THREE.Vector3, atPad: boolean): void {
        const items: MaterialDef[] = [];
        for (const [id, count] of Object.entries(DigProgress.backpack)) {
            const material = DIG.materials.find((m) => m.id === id);
            for (let i = 0; material && i < count; i++) items.push(material);
        }
        // Cheapest first, so the sale builds up to the best finds.
        items.sort((a, b) => a.value - b.value);
        const total = items.length;
        const earned = DigProgress.sellAll();
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
            const value = items.slice(first, last).reduce((sum, m) => sum + m.value, 0);
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
            // Under the mute button (top-right corner).
            this.mapButton.position.set(screen.topLeft.x + screen.width - 64, screen.topLeft.y + 124);
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
        this.terrain?.destroy();
        this.hub?.destroy();
        this.player?.destroy();
        super.destroy();
    }
}
