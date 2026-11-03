// MowScene.ts
//
// Mow Town's scene: the town (Town, from levels/town.json: park, plaza, road, the fenced Residential Street, the
// ATMs) with the grass over its districts (GrassField), the player with their tool (MowPlayer), automatic mowing while
// moving (MowingSystem), the HUD (MowHud) and the floor arrows (ArrowGuide).
//
// The loop: mow -> the container fills -> stand on any ATM's pad (the clippings are tossed into it, cash counts up,
// and the shop opens: tools and upgrades) -> mow faster. A wardrobe's pad opens Dig's wardrobe (colours, faces, hats):
// the first one appears with the second sale, the arrows lead to it, and its first hat is a must (updateStations). A district reaching its restoration goal clears its last
// stragglers, brightens, blooms with flowers, pays its bonus and opens the next one (its fence sinks, its ATMs pop
// in, and with `onUnlock.pan` the camera glides over to show it).
//
// Treasures hide in the grass (GrassField.placeTreasures): a beam rises from one within reach (TreasureBeacons), cutting
// its cell pops it out into the player and it lands in the Trophies panel (claimed there); an area restored with some
// still hidden hands them over.
//
// Cut grass doesn't grow back — except when the player is stuck (updateRelief()): nothing left in the open district
// their mower can cut, and the next mower still out of reach with the bag sold. Then just enough grass they can cut
// grows back to earn the difference.
//
// The guide (no text, just the arrows): a full bag -> the nearest ATM; the first mower or the first upgrade
// affordable -> the nearest ATM (and the hand on the shop's BUY button); a newly opened district -> its grass.
//
// Modes (GameMode, ?mode=calm|rush): both get the path stripes (GrassField), a pop at each quarter of a section
// (updateDistrictBar) and the restored banner (MowHud.celebrate); rush adds the combo meter (Combo): mowing on
// without a break raises a multiplier, and the extra money it piled up is paid when the run ends.
//
// Camera: dig's follow camera — a fixed yaw / pitch orbit around a smoothed follow point.

import * as THREE from 'three';
import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import gsap from 'gsap';
import World from '../ecs/World';
import RigidBody from '../physics/RigidBody';
import { Layers } from '../physics/PhysicsConstants';
import { BendService } from '../services/BendService';
import MowPlayer from '../player/MowPlayer';
import { GrassField } from '../world/GrassField';
import { Town } from '../world/Town';
import { TractorRide } from '../player/TractorRide';
import { ArrowGuide } from '../world/ArrowGuide';
import type { Box } from '../world/GuidePath';
import { MowingSystem } from '../mowing/MowingSystem';
import { Combo } from '../mowing/Combo';
import { isRush } from '../data/GameMode';
import { MowHud, ShopHint, CELEBRATION_SEC } from '../ui/MowHud';
import { RARITY_COLORS } from '../ui/TrophiesPanel';
import { MowEffects } from '../vfx/MowEffects';
import { MOW, TOWN, SecretDef, TreasureDef, firstToolFor, SECRET_CHEST_MODEL } from '../data/MowConfig';
import { TreasureBeacons } from '../world/TreasureBeacons';
import { SecretPatches } from '../world/SecretPatches';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { MowProgress } from '../data/MowProgress';
import { Gameplay } from '../data/Gameplay';
import { MowAudio } from '../audio/MowAudio';
import { EngineSound, MowerVoice } from '../audio/EngineSound';
import { SpatialAudio } from '../audio/SpatialAudio';
import { GrassLocks } from '../world/GrassLocks';
import { Traffic } from '../world/Traffic';
import { GameAnalytics } from '../analytics/GameAnalytics';
import { t, names, Localization } from '../i18n/Localization';

/** Top-down, slightly angled. yaw 0 = camera south of the player looking north (-Z). */
export const MOW_CAMERA = {
    yawDeg: 0,
    pitchDeg: 55,
    // Closer since the player's smaller (MowDesign.playerScale).
    distance: 11.5,
    followSpeed: 8,
    /** How fast the distance eases to a new section's `zoom`. */
    zoomSpeed: 1.5,
};

const REFERENCE_ASPECT = Game.DESIGN_WIDTH / Game.DESIGN_HEIGHT;
const MAX_FRAME_SEC = 0.1;
/** Metres walked per footstep sound. */
const STEP_DISTANCE = 0.9;
const FLOOR_HALF_THICKNESS = 0.5;
/** Selling: at most this many clumps are tossed into the bin. */
const SELL_TOSSES = 12;
const SELL_TOSS_INTERVAL = 0.07;
const CLIPPING_COLOR = new THREE.Color(0x7cc95a);
/** The move hint goes once the player has walked this far. */
const MOVE_HINT_DISTANCE = 2.5;
/** The yard this far mowed: the first purchases at the latest (they come when the starting bag fills, before this). */
const FIRST_BUY_AT = 0.6;
/** The town's blown-up miniature closes once the player moves more than this in a frame (world units). */
const MINIATURE_CLOSE_STEP = 0.005;
/** Occlusion looks at the torso, not the feet: what a tree in front actually hides. */
const OCCLUSION_HEIGHT = 0.9;
/** A newly opened section (onUnlock.pan, after the celebration): the camera glides over, holds, glides back (seconds). */
const PAN = { delay: 0.4, glide: 0.9, hold: 1.4 };
/**
 * Wandering: further than FAR units from the section being worked on (its rect), the arrows lead back into it, until
 * the player is back inside (BACK units in from its edge counts).
 */
const WANDER = { far: 7, back: 1.5, inset: 1.2 };
/** How often the scene checks whether the player is stuck (updateRelief()). */
const STUCK_CHECK_SEC = 1;
/** Stuck: grass grown back to earn this much more than the next mower is short of, over about RELIEF_SEC. */
const RELIEF_MARGIN = 1.25;
const RELIEF_SEC = 3;
/** At least this many cells grow back a second while relief is under way. */
const RELIEF_MIN_RATE = 8;
/** Confetti over a restored section: chip colours. */
/** Flower clumps per square unit of a restored section. */
const FLOWER_DENSITY = 0.04;
/** A secret patch's twinkle and its toast's colour (its chest's model: SECRET_CHEST_MODEL). */
const SECRET_GLINT = new THREE.Color(0xffe27a);
const CONFETTI = [0xff5a6e, 0xffd23f, 0x4fc3ff, 0x9cff6a, 0xc36bff, 0xffffff].map((c) => new THREE.Color(c));

function cameraOffset(camera: THREE.PerspectiveCamera, zoom: number): THREE.Vector3 {
    const yaw = THREE.MathUtils.degToRad(MOW_CAMERA.yawDeg);
    const pitch = THREE.MathUtils.degToRad(MOW_CAMERA.pitchDeg);
    const distance = MOW_CAMERA.distance * zoom * Math.max(1, REFERENCE_ASPECT / camera.aspect);
    const horizontal = distance * Math.cos(pitch);
    return new THREE.Vector3(horizontal * Math.sin(yaw), distance * Math.sin(pitch), horizontal * Math.cos(yaw));
}

/**
 * Spots for a restored district's flowers: a seeded scatter over its rect (the same every time), kept to `isLawn` (where
 * its grass grew: not on a road tile, the deck or the sea the rect reaches over).
 */
export function flowerSpots(district: (typeof MOW.districts)[number], isLawn: (x: number, z: number) => boolean): THREE.Vector3[] {
    const spots: THREE.Vector3[] = [];
    let seed = district.x * 31 + district.z * 17 + 7;
    const random = () => {
        seed = (seed * 9301 + 49297) % 233280;
        return seed / 233280;
    };
    // Sparse: a sprinkle of colour over the lawn, not a flower bed.
    const count = Math.round(district.width * district.depth * FLOWER_DENSITY);
    for (let i = 0; i < count; i++) {
        const x = district.x + (random() - 0.5) * district.width;
        const z = district.z + (random() - 0.5) * district.depth;
        if (isLawn(x, z)) spots.push(new THREE.Vector3(x, 0, z));
    }
    return spots;
}

/** The town's light: sky and ground fill, and the sun (MowScene, and the map snapshots in the same light). */
export function addTownLights(threeScene: THREE.Scene): void {
    threeScene.add(new THREE.HemisphereLight(0xffffff, 0x5a7a4a, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(6, 14, 8);
    threeScene.add(sun);
}

export default class MowScene extends ThreeScene {
    private readonly world = new World();
    private player!: MowPlayer;
    private town!: Town;
    private grass!: GrassField;
    private effects!: MowEffects;
    private mowing!: MowingSystem;
    private guide!: ArrowGuide;
    private hud!: MowHud;
    private tractor!: TractorRide;
    private readonly engine = new EngineSound();
    /** The sea and the cars, heard from where the player is (updateSpatialAudio()). */
    private spatial?: SpatialAudio;
    private readonly cameraForward = new THREE.Vector3();
    /** Distance walked since the last footstep (updateFootsteps()). */
    private stepDistance = 0;
    private characterReady: Promise<void> = Promise.resolve();
    private sceneDestroyed = false;
    private readonly followTarget = new THREE.Vector3();
    /** The camera distance's multiplier, easing to the section being worked on's `zoom` (cameraZoomGoal()). */
    private zoom = 1;
    private readonly lastPosition = new THREE.Vector3();
    /** Districts that opened this session and haven't been mowed yet (the guide leads there). */
    private readonly fresh = new Set<number>();
    /** Leading a wandering player back to the section being worked on (updateGuide()). */
    private wandering = false;
    /** The ATM the player stands on (-1: none). */
    private onAtm = -1;
    /** Beams over the treasures still hidden near the player. */
    private beacons!: TreasureBeacons;
    /** Secret patches round town, each hiding a chest. */
    private secrets!: SecretPatches;
    /** Padlocks (with the mower it takes) over grass the mower can't cut. */
    private locks!: GrassLocks;
    /** A few cars on the roads. */
    private traffic!: Traffic;
    /** Each treasure's model, fitted to its size (loaded behind the game: treasureModels()). */
    private readonly treasureModels = new Map<string, THREE.Object3D>();
    /** The wardrobe whose pad the player stands on, or -1. */
    private onWardrobe = -1;
    /** The tutorial's first hat is being forced (the player is held on the wardrobe's pad until it's bought). */
    private hatForced = false;
    /** The first purchases once the yard's done (firstBuys()): the mower, then the bag; null when not running. */
    private firstBuy: ShopHint = null;
    private moveHintActive = false;
    /** updateRelief(): seconds to the next stuck check; while grass grows back, the district, clippings still to grow and cells a second. */
    private stuckCheck = STUCK_CHECK_SEC;
    private relief = { district: -1, clippings: 0, rate: 0, carry: 0 };
    private walked = 0;
    /** Where the player was last frame, for the move hint (the engine keeps its own: lastPosition). */
    private readonly hintLast = new THREE.Vector3();
    /** Where the player was last frame, for closing the town's blown-up miniature once they move. */
    private readonly miniatureLast = new THREE.Vector3();
    private readonly occlusionTarget = new THREE.Vector3();
    /** A camera pan to a newly opened section: where to, and how far through it (seconds); the player waits. */
    private pan: { to: THREE.Vector3; time: number } | null = null;
    /** Per section: the quarters of it already celebrated (updateDistrictBar). */
    private milestones: number[] = [];
    /** Rush mode's combo meter (null in calm mode). */
    private combo: Combo | null = null;

    public constructor(game: Game) {
        super(game);
    }

    /**
     * Resolves once the scene can be played (the character, the town's models round the player — the far ones keep
     * coming in behind — and the grass): the loading screen waits.
     */
    public get ready(): Promise<void> {
        return Promise.all([this.characterReady, this.town?.readyNear, this.grass?.ready]).then(() => undefined);
    }

    public build(): void {
        this.buildLights();
        const open = (d: number) => d === 0 || MowProgress.isRestored(MOW.districts[d - 1].id);
        this.town = new Town(this.threeScene, open, (d) => MowProgress.isRestored(MOW.districts[d].id));
        this.traffic = new Traffic(this.threeScene, this.town.readyNear);
        this.town.movingBlockers = () => this.traffic.blockers();
        this.grass = new GrassField(this.threeScene, (x, z) => this.town.isBlocked(x, z), MowProgress.savedCut);
        MowProgress.setCutProvider(() => this.grass.save());
        // Districts restored in an earlier session look restored again (all mowed, even if the level's grass changed);
        // a treasure of theirs not found then (a save from before treasures) is handed over: its reward waits in the panel.
        MOW.districts.forEach((district, d) => {
            if (!MowProgress.isRestored(district.id)) return;
            this.grass.cutAll(d);
            this.grass.setRestored(d);
            this.town.bloom(flowerSpots(district, (x, z) => this.grass.isLawn(x, z, d)));
            for (const item of MOW.treasures.items) if (item.area === district.id && MowProgress.findTreasure(item.id)) GameAnalytics.treasureFound(item.id);
        });
        this.milestones = MOW.districts.map((_, d) => Math.floor(this.grass.progress(d) * 4));
        this.grass.placeTreasures((id) => MowProgress.treasureFound(id));
        this.beacons = new TreasureBeacons(this.threeScene, this.grass, (id) => !MowProgress.treasureFound(id));
        this.secrets = new SecretPatches(this.threeScene, (id) => MowProgress.secretFound(id));

        this.player = this.world.add(new MowPlayer(this, this.threeScene));
        this.player.transform.position.set(MOW.start.x, 0, MOW.start.z);
        this.characterReady = this.player.loadCharacter().catch((error) => console.error('[MowScene] character failed to load', error));
        this.effects = new MowEffects(this.threeScene, 0.5, () => this.player.pickupPoint(new THREE.Vector3()));
        // Ridden everywhere once owned (paths, restored sections, the ATMs' pads): it's the reward, not just a mowing tool.
        this.tractor = new TractorRide(this.threeScene, this.player, this.effects, () => true);
        this.player.ridePoint = (out) => this.tractor.cutPoint(out);
        this.player.groundAt = (x, z) => {
            const ground = this.town.surfaceAt(x, z);
            return ground.kind === 'pavement' ? ground.y : 0;
        };
        this.guide = new ArrowGuide(this.threeScene, () => this.town.blockers, () => this.town.unstandable(),
            (x, z) => this.town.topAt(x, z));
        this.hud = this.createHud();
        Localization.onLocaleChange.add(this.onLocaleChange, this);
        if (isRush) this.combo = this.createCombo();
        this.locks = new GrassLocks(this.threeScene, this.grass, (d) => this.town.isOpen(d));
        this.mowing = new MowingSystem(this.grass, this.player, this.effects, (d) => this.town.isOpen(d), () => {
            this.combo?.end();
            this.hud.say(t('bagFull'), 0xff8a7a);
            this.hud.flashBag();
            this.effects.floatText(this.player.pickupPoint(new THREE.Vector3()).setY(2.4), t('bagFullFloat'), '#ff8a7a');
            GameAnalytics.bagFull();
            GameAnalytics.tutorialStep('bag-full');
            // The first ATM waits for this (appearsWhenFull): it pops up now, and the arrows lead to it.
            this.town.revealStations();
        }, (grass) => {
            const tool = firstToolFor(grass);
            if (tool) {
                const at = (this.mowing.wall ?? this.player.transform.position).clone().setY(2.2);
                this.effects.floatText(at, t('needsToolShort', { tool: names.tool(tool) }).toUpperCase(), '#ff8a7a');
            }
            this.hud.say(tool ? t('needsTool', { grass: names.grass(grass), tool: names.tool(tool) }) : t('needsPower', { grass: names.grass(grass) }), 0xffd9a8);
        }, (_cells, clippings) => {
            this.combo?.cut(clippings * MOW.clippingPrice * (1 + MowProgress.moneyBonus));
            GameAnalytics.tutorialStep('cut');
            this.fresh.forEach((d) => {
                if (this.grass.progress(d) > 0.02) this.fresh.delete(d);
            });
        }, (treasure, at) => this.findTreasure(treasure, at), this.secrets, (secret, at) => this.findSecret(secret, at));

        this.moveHintActive = MowProgress.cellsCut === 0 && MowProgress.toolLevel === 0;
        if (this.moveHintActive) this.hud.moveHint.show();
        this.lastPosition.copy(this.player.transform.position);
        this.hintLast.copy(this.player.transform.position);
        this.followTarget.copy(this.player.transform.position);
        this.zoom = this.cameraZoomGoal();
        this.placeCamera();
        this.buildDebug();
        // Gameplay starts on the first input, once the game is loaded (and the big downloads wait for it: afterFirstInput()).
        void this.ready.then(() => {
            if (this.sceneDestroyed) return;
            window.addEventListener('pointerdown', this.onFirstInput, true);
            window.addEventListener('keydown', this.onFirstInput, true);
        });
    }

    private buildLights(): void {
        this.threeScene.background = new THREE.Color(0x9fd4f2);
        addTownLights(this.threeScene);
        // A floor collider under the whole town (the character stands on it).
        const ground = this.world.spawn();
        ground.addComponent(new RigidBody({
            halfExtents: new THREE.Vector3(80, FLOOR_HALF_THICKNESS, 80),
            centerOffset: new THREE.Vector3(0, -FLOOR_HALF_THICKNESS, 0),
            isStatic: true,
            layer: Layers.Environment,
        }));
    }

    /** Rush mode's combo: a chime and sparkles as it climbs, its pot paid (and shown) when it ends. */
    private createCombo(): Combo {
        return new Combo(MOW.combo, {
            onStep: () => {
                MowAudio.play('item');
                const at = this.player.pickupPoint(new THREE.Vector3());
                for (let i = 0; i < 4; i++) this.effects.sparkle(at, new THREE.Color(0xffe27a), 0.45);
            },
            onEnd: (pot, multiplier) => {
                if (pot <= 0 || this.sceneDestroyed) return;
                MowProgress.addMoney(pot);
                this.hud.comboPaid(pot, multiplier);
                MowAudio.play('coins');
                this.effects.floatText(this.player.pickupPoint(new THREE.Vector3()).setY(2.6), `+$${pot}`, '#ffe27a');
            },
        });
    }

    private createHud(): MowHud {
        const hud = new MowHud(() => this.onBought(), () => this.player.applyLook(MowProgress.look), (d) => this.town.isOpen(d));
        this.game.uiLayer.addChild(hud);
        return hud;
    }

    /** A new language: rebuild the HUD (its text is read when built) and keep the language list open. */
    private onLocaleChange(): void {
        this.hud.destroy();
        this.hud = this.createHud();
        this.hud.openLanguage();
        this.resize();
    }

    private buildDebug(): void {
        const panel = DebugOverlay.instance.panel('Mow', { id: 'mow.progress' });
        panel.monitor('Money', () => MowProgress.money);
        panel.monitor('Bag', () => `${Math.floor(MowProgress.clippings)}/${MowProgress.capacity}`);
        panel.monitor('Tool', () => MowProgress.tool.name);
        panel.monitor('Park', () => `${Math.floor(this.grass.progress(0) * 100)}%`);
        panel.button('ADD $100', () => MowProgress.addMoney(100));
        panel.button('ADD $1000', () => MowProgress.addMoney(1000));
        panel.button('FILL BAG', () => MowProgress.addClippings(MowProgress.capacity - MowProgress.clippings));
        panel.button('RESTORE CURRENT DISTRICT', () => {
            const d = this.currentDistrict();
            for (const { treasure, at } of this.grass.takeTreasures(d)) this.findTreasure(treasure, at);
            this.grass.cutAll(d);
            this.checkRestoration();
        });
        panel.button('RESET SAVE', () => {
            if (window.confirm('Reset all Mow Town progress?')) MowProgress.reset();
        });
    }

    // ---------------------------------------------------------------- frame

    public update(delta: number): void {
        delta = Math.min(delta, MAX_FRAME_SEC);
        if (Gameplay.active) GameAnalytics.playTime(delta);
        this.world.update(delta);
        this.world.lateUpdate(delta);
        this.player.syncTool();
        this.tractor.update(delta);
        this.town.bodyRadius = this.tractor.isRiding ? MOW.tractor.bodyRadius : 0.35;
        this.grass.update();
        this.beacons.update(delta, this.player.transform.position);
        this.secrets.update(delta, this.player.transform.position, (at) => this.effects.sparkle(at, SECRET_GLINT, 0.4));
        if (this.mowing.wall) this.locks.bump(this.mowing.wall);
        this.locks.update(delta, this.player.transform.position, MowProgress.power);
        this.traffic.update(delta, this.player.transform.position, this.town.bodyRadius);
        this.effects.update(delta);
        this.updateEngine(delta);
        this.updateSpatialAudio(delta);
        this.updateGuide(delta);
        this.updateMoveHint();
        this.updateMiniatureClose();
        // The starting mower's small bag full in the yard (about half way: FIRST_BUY_AT as a backstop), or a save past
        // the yard without a mower: the first purchases (firstBuys()) — a better mower, then the bag it needed.
        const yardDone = MowProgress.isRestored(MOW.districts[0].id);
        if (!this.firstBuy && MowProgress.toolLevel === 0 && (MowProgress.full || this.grass.progress(0) >= FIRST_BUY_AT || yardDone)) {
            this.firstBuys();
        }
        BendService.updateTime(delta);
        super.update(delta);
    }

    public fixedUpdate(delta: number): void {
        this.world.fixedUpdate(delta);
        this.mowing.fixedUpdate(delta);
        if (this.combo) {
            this.combo.update(delta);
            this.hud.setCombo(this.combo.multiplier, this.combo.pot, this.combo.timeShare);
        }
        this.updateRelief(delta);
        this.updateStations();
        this.checkRestoration();
        this.updateDistrictBar();
        const position = this.player.transform.position;
        this.followTarget.lerp(this.cameraGoal(delta, position), 1 - Math.exp(-MOW_CAMERA.followSpeed * delta));
        this.zoom += (this.cameraZoomGoal() - this.zoom) * (1 - Math.exp(-MOW_CAMERA.zoomSpeed * delta));
        this.placeCamera();
        BendService.updateOrigin(this.followTarget);
        BendService.updateCameraPosition(this.threeCamera.position);
        BendService.updateOcclusionTarget(this.occlusionTarget.copy(position).setY(position.y + OCCLUSION_HEIGHT));
    }

    /** What the camera follows: the player, or a newly opened section while a pan runs (the player waits meanwhile). */
    private cameraGoal(delta: number, position: THREE.Vector3): THREE.Vector3 {
        const pan = this.pan;
        if (!pan) return position;
        pan.time += delta;
        const controller = this.player.movementController;
        const showing = pan.time >= PAN.delay && pan.time < PAN.delay + PAN.glide + PAN.hold;
        if (controller) controller.enabled = !showing;
        if (pan.time >= PAN.delay + PAN.glide * 2 + PAN.hold) this.pan = null;
        return showing ? pan.to : position;
    }

    /** The first section not restored yet sets the zoom (the small Front Yard is seen closer), even while selling. */
    private cameraZoomGoal(): number {
        return MOW.districts.find((d) => !MowProgress.isRestored(d.id))?.zoom ?? 1;
    }

    private placeCamera(): void {
        this.threeCamera.position.copy(this.followTarget).add(cameraOffset(this.threeCamera, this.zoom));
        this.threeCamera.lookAt(this.followTarget);
    }

    /**
     * The mower's sound by kind (EngineSound): the reel mowers click, the walked engine mowers hum, the ride-ons chug
     * (only while ridden: on foot the hands are free). It follows the walking speed. Then the footsteps.
     */
    private updateEngine(delta: number): void {
        const tool = MowProgress.tool;
        const voice: MowerVoice | null = tool.reel ? 'reel' : tool.ride ? (this.tractor.isRiding ? 'tractor' : null) : tool.engine ? 'electric' : null;
        if (voice) this.engine.start(voice);
        else this.engine.stop();
        if (delta <= 0) return;
        const position = this.player.transform.position;
        const moved = Math.hypot(position.x - this.lastPosition.x, position.z - this.lastPosition.z);
        this.lastPosition.copy(position);
        if (voice) this.engine.update(moved / delta / Math.max(1, MowProgress.speed), delta);
        this.updateFootsteps(moved);
    }

    /** The sound zones (the sea) and the cars nearby, heard from the player facing up the screen. */
    private updateSpatialAudio(delta: number): void {
        if (!this.spatial) return;
        const position = this.player.transform.position;
        const forward = this.threeCamera.getWorldDirection(this.cameraForward).setY(0);
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        forward.normalize();
        this.spatial.update(position.x, position.z, forward.x,         forward.z, this.traffic.carSounds(), delta);
    }

    /** A step sound every STEP_DISTANCE walked, by what's underfoot (none while riding; a teleport doesn't count). */
    private updateFootsteps(moved: number): void {
        if (this.tractor.isRiding || moved > 3) {
            this.stepDistance = 0;
            return;
        }
        this.stepDistance += moved;
        if (this.stepDistance < STEP_DISTANCE) return;
        this.stepDistance = 0;
        const position = this.player.transform.position;
        const kind = this.town.surfaceAt(position.x, position.z).kind;
        MowAudio.play(kind === 'pavement' ? 'stepStone' : kind === 'deck' ? 'stepWood' : 'stepGrass');
    }

    /** The town's miniature, blown up by a tap on it, goes back to its corner as soon as the player moves. */
    private updateMiniatureClose(): void {
        const position = this.player.transform.position;
        const moved = position.distanceToSquared(this.miniatureLast) > MINIATURE_CLOSE_STEP * MINIATURE_CLOSE_STEP;
        this.miniatureLast.copy(position);
        if (moved) this.hud.closeMiniature();
    }

    /** "Drag to move" until the player has walked a little (a brand-new game only). */
    private updateMoveHint(): void {
        if (!this.moveHintActive) return;
        const position = this.player.transform.position;
        this.walked += Math.min(1, Math.hypot(position.x - this.hintLast.x, position.z - this.hintLast.z));
        this.hintLast.copy(position);
        if (this.walked < MOVE_HINT_DISTANCE) return;
        this.moveHintActive = false;
        this.hud.moveHint.hide();
        GameAnalytics.tutorialStep('move');
    }

    // ---------------------------------------------------------------- ATMs

    /** Standing on any ATM's pad sells the bag (clippings tossed into it) and opens the shop. */
    private updateStations(): void {
        // The first ATM waits for a full bag (appearsWhenFull): out as soon as it is, wherever it filled.
        if (MowProgress.full) this.town.revealStations();
        const position = this.player.transform.position;
        const atm = this.town.atmAt(position.x, position.z);
        if (atm >= 0 && MowProgress.clippings > 0) this.sell(atm);
        if (atm !== this.onAtm) {
            this.onAtm = atm;
            this.hud.setShopOpen(atm >= 0);
        }
        // A wardrobe's pad opens the wardrobe (Dig's); its "!" while something new there is affordable.
        const wardrobe = this.town.wardrobeAt(position.x, position.z);
        if (wardrobe !== this.onWardrobe) {
            this.onWardrobe = wardrobe;
            this.hud.setWardrobeOpen(wardrobe >= 0);
        }
        this.updateForcedHat(wardrobe >= 0);
        this.town.setWardrobeAttention(wardrobe < 0 && MowProgress.wardrobeHasNews);
    }

    /**
     * The tutorial's first hat: on a wardrobe's pad with no hat bought yet, the wardrobe is locked onto the cheapest
     * one (the hand on it, no closing, the player held there) and any money short of it is quietly added — it never
     * blocks. Bought: the wardrobe is free again and the game carries on.
     */
    private updateForcedHat(onWardrobe: boolean): void {
        const hat = MowProgress.starterHat;
        const forced = onWardrobe && !!hat && !MowProgress.boughtFirstHat;
        if (forced === this.hatForced) return;
        this.hatForced = forced;
        const controller = this.player.movementController;
        if (forced) {
            if (MowProgress.money < hat.price) MowProgress.addMoney(hat.price - MowProgress.money);
            GameAnalytics.tutorialStep('wardrobe');
        } else if (MowProgress.boughtFirstHat) {
            GameAnalytics.tutorialStep('hat');
        }
        this.hud.setWardrobeForced(forced ? hat.id : undefined);
        if (controller) controller.enabled = !forced;
    }

    /** Sells the bag now (so the save is right), then plays it out: clippings tossed into the ATM, cash landing. */
    private sell(atm: number): void {
        const earned = MowProgress.sell();
        if (earned <= 0) return;
        GameAnalytics.sold(MowProgress.timesSold);
        GameAnalytics.tutorialStep('sell');
        // A station waiting for this many sales pops in (the first wardrobe, with the second).
        this.town.revealStations();
        this.hud.holdSale(earned);
        const bin = this.town.atmModelAt(atm);
        let paid = 0;
        for (let k = 0; k < SELL_TOSSES; k++) {
            const share = k === SELL_TOSSES - 1 ? earned - paid : Math.floor(earned / SELL_TOSSES);
            paid += share;
            this.effects.toss(this.player.pickupPoint(new THREE.Vector3()), bin, CLIPPING_COLOR, k * SELL_TOSS_INTERVAL, () => {
                this.hud.releaseSale(share);
                MowAudio.play('coins');
                if (k === SELL_TOSSES - 1) this.effects.floatText(bin.clone().setY(3), `+$${earned}`, '#ffe27a');
            });
        }
        this.hud.say(t('sold', { amount: earned }), 0x9cff9c);
    }

    /** After any purchase: the tool cube follows (MowPlayer), the first-session steps are counted. */
    private onBought(): void {
        // The first purchases: whatever's still missing of the two (bought in either order — the bag first leaves the
        // mower to buy, its money topped up again), then the player's free.
        if (this.firstBuy) {
            this.setFirstBuy(MowProgress.toolLevel === 0 ? 'tool' : MowProgress.upgradeLevel('capacity') === 0 ? 'capacity' : null);
        }
        if (MowProgress.toolLevel > 0) GameAnalytics.tutorialStep('first-mower');
        if (MOW.upgrades.some((u) => MowProgress.upgradeLevel(u.id) > 0)) GameAnalytics.tutorialStep('first-upgrade');
        this.effects.smoke(this.player.transform.position.clone().setY(0.4), 6, 0.8, new THREE.Color(0xffffff), 0.8);
    }

    /**
     * Half the yard mowed (FIRST_BUY_AT): the shop pops up where the player stands and walks them through the first
     * mower (power 2: the park's grass goes down without a stop), then the first bag upgrade (the hand on each, no closing it, the player held there), any money short
     * quietly added (there's no ATM in the yard), like the first hat. Then they're free to finish the yard with the new
     * mower, and leave the tutorial with a mower worth having and a bag for the park.
     */
    private firstBuys(): void {
        if (this.sceneDestroyed || this.firstBuy || MowProgress.toolLevel > 0) return;
        this.setFirstBuy('tool');
    }

    private setFirstBuy(step: ShopHint): void {
        this.firstBuy = step;
        const capacity = MOW.upgrades.find((u) => u.id === 'capacity');
        const price = step === 'tool' ? MowProgress.nextTool?.price : step === 'capacity' && capacity ? MowProgress.upgradePrice(capacity) : undefined;
        if (price !== undefined && MowProgress.money < price) MowProgress.addMoney(price - MowProgress.money);
        const controller = this.player.movementController;
        if (controller) controller.enabled = step === null;
        this.hud.setShopHint(step);
        this.hud.setShopForced(step !== null);
    }

    // ---------------------------------------------------------------- districts

    /** The district the player is in, else the first one not restored (shown on the HUD's bar). */
    private currentDistrict(): number {
        const p = this.player.transform.position;
        const inside = MOW.districts.findIndex((d) => Math.abs(p.x - d.x) <= d.width / 2 && Math.abs(p.z - d.z) <= d.depth / 2);
        if (inside >= 0) return inside;
        const pending = MOW.districts.findIndex((d) => !MowProgress.isRestored(d.id));
        return pending >= 0 ? pending : MOW.districts.length - 1;
    }

    /**
     * A treasure's cell was cut (or its area restored): it pops out of the grass with a burst and hops into the player
     * (MowEffects.reveal, Dig's), then counts as found — the HUD names it in a toast and it flies from the player into
     * the Trophies button, where its reward waits to be claimed.
     */
    private findTreasure(treasure: TreasureDef, at: THREE.Vector3): void {
        if (MowProgress.treasureFound(treasure.id)) return;
        const model = this.treasureModels.get(treasure.id)?.clone(true);
        MowAudio.play('sparkle');
        this.effects.reveal(at.clone().setY(0.6), () => {
            if (!MowProgress.findTreasure(treasure.id)) return;
            GameAnalytics.treasureFound(treasure.id);
            this.hud.treasureFound({
                title: t('treasureFoundTitle'),
                color: RARITY_COLORS[treasure.rarity],
                name: names.treasure(treasure).toUpperCase(),
                model: `./mow/models/${treasure.model}`,
            }, this.playerOnScreen());
        }, model);
    }

    /** A secret patch mowed through: its chest pops out and pays at once (a toast, coins flying from the player). */
    private findSecret(secret: SecretDef, at: THREE.Vector3): void {
        const chest = MOW.treasures.items.find((item) => item.model === SECRET_CHEST_MODEL);
        const model = chest ? this.treasureModels.get(chest.id)?.clone(true) : undefined;
        MowAudio.play('sparkle');
        this.effects.reveal(at.clone().setY(0.6), () => {
            if (MowProgress.secretFound(secret.id)) return;
            this.hud.secretFound({
                title: t('secretFoundTitle'),
                color: SECRET_GLINT.getHex(),
                name: t('secretChest'),
                model: `./mow/models/${SECRET_CHEST_MODEL}`,
            }, secret.reward, () => {
                const paid = MowProgress.claimSecret(secret.id, secret.reward);
                if (paid > 0) GameAnalytics.secretFound(secret.id);
                return paid;
            }, this.playerOnScreen());
        }, model);
    }

    /** Where the player is on screen (PIXI global coordinates), for HUD flights from them. */
    private playerOnScreen(): PIXI.Point {
        const at = this.player.pickupPoint(new THREE.Vector3()).project(this.threeCamera);
        const screen = Game.renderer.screen;
        return new PIXI.Point(((at.x + 1) / 2) * screen.width, ((1 - at.y) / 2) * screen.height);
    }

    /** The treasures' models, fitted to their size, for the pop-out (loaded behind the game; one missing just flies a cube). */
    private loadTreasureModels(): void {
        for (const treasure of MOW.treasures.items) {
            void ModelLoaderManager.instance.loadModel(`./mow/models/${treasure.model}`).then((object) => {
                if (!object || this.sceneDestroyed) return;
                const box = new THREE.Box3().setFromObject(object);
                const size = box.getSize(new THREE.Vector3());
                object.position.sub(box.getCenter(new THREE.Vector3()));
                const holder = new THREE.Group();
                holder.add(object);
                holder.scale.setScalar(treasure.size / Math.max(size.x, size.y, size.z, 1e-4));
                holder.traverse((child) => {
                    if (!(child instanceof THREE.Mesh)) return;
                    child.material = (child.material as THREE.Material).clone();
                    BendService.applyBend(child.material as THREE.Material);
                });
                this.treasureModels.set(treasure.id, holder);
            }).catch((error) => console.warn('[MowScene] treasure model', treasure.model, error));
        }
    }

    /**
     * The only way cut grass comes back: the player is stuck. Checked every STUCK_CHECK_SEC — the open districts not
     * restored yet hold nothing their mower can cut (or chew), and the next mower costs more than their money plus the
     * bag sold. Then the newest such district grows back grass their mower cuts at once, enough clippings to earn the
     * shortfall (x RELIEF_MARGIN), over about RELIEF_SEC, and the HUD says so. Otherwise nothing ever grows back.
     */
    private updateRelief(delta: number): void {
        const relief = this.relief;
        if (relief.clippings > 0) {
            relief.carry += relief.rate * delta;
            const cells = Math.floor(relief.carry);
            if (cells <= 0) return;
            relief.carry -= cells;
            const grown = this.grass.regrow(relief.district, cells, MowProgress.power);
            // Nothing left to grow back there: done.
            relief.clippings = grown > 0 ? relief.clippings - grown : 0;
            return;
        }
        this.stuckCheck -= delta;
        if (this.stuckCheck > 0) return;
        this.stuckCheck = STUCK_CHECK_SEC;
        const next = MowProgress.nextTool;
        if (!next) return;
        const perClipping = MOW.clippingPrice * (1 + MowProgress.moneyBonus);
        const shortfall = next.price - MowProgress.money - Math.round(MowProgress.clippings * perClipping);
        if (shortfall <= 0) return;
        const open = MOW.districts.map((_, d) => d).filter((d) => this.town.isOpen(d) && !MowProgress.isRestored(MOW.districts[d].id));
        if (!open.length || open.some((d) => this.grass.cuttableLeft(d, MowProgress.power, 1) > 0)) return;
        // Stuck. Clippings to grow, and a pace (cells a second) that gets them back in about RELIEF_SEC.
        const clippings = Math.ceil((shortfall / perClipping) * RELIEF_MARGIN);
        const cuttable = MOW.grass.filter((g) => g.resistance <= MowProgress.power);
        const perCell = cuttable.length ? cuttable.reduce((sum, g) => sum + g.value, 0) / cuttable.length : 1;
        this.relief = { district: open[open.length - 1], clippings, rate: Math.max(RELIEF_MIN_RATE, clippings / perCell / RELIEF_SEC), carry: 0 };
        this.hud.say(t('grassRegrows'), 0x9cff9c);
    }

    /**
     * The bar at the top, and a pop each time the section shown passes another quarter (25 / 50 / 75%); and the town
     * map: every section's share, which are open / restored, the one being worked on, and the player's dot.
     */
    private updateDistrictBar(): void {
        const restoredFlags = MOW.districts.map((district) => MowProgress.isRestored(district.id));
        const openFlags = MOW.districts.map((_, i) => this.town.isOpen(i));
        const shares = MOW.districts.map((_, i) => (restoredFlags[i] ? 1 : openFlags[i] ? this.grass.progress(i) : 0));
        const working = MOW.districts.findIndex((_, i) => openFlags[i] && !restoredFlags[i]);
        this.hud.setTownMap(shares, openFlags, restoredFlags, working);
        const at = this.player.transform.position;
        this.hud.setMapPlayer(at.x, at.z);

        const d = this.currentDistrict();
        const restored = MowProgress.isRestored(MOW.districts[d].id);
        const share = restored ? 1 : this.grass.progress(d);
        this.hud.setDistrict(d, share);
        const quarter = Math.min(3, Math.floor(share * 4));
        if (restored || !this.town.isOpen(d) || quarter <= this.milestones[d]) return;
        this.milestones[d] = quarter;
        this.hud.milestone(quarter * 25);
        MowAudio.play('quest');
    }

    /** A district at its goal: the stragglers go, it brightens and blooms, its bonus is paid, the next one opens. */
    private checkRestoration(): void {
        MOW.districts.forEach((district, d) => {
            if (!this.town.isOpen(d) || MowProgress.isRestored(district.id)) return;
            if (this.grass.progress(d) < district.completeAt) return;
            // Nothing is lost with the stragglers: treasures still hidden there pop out too.
            for (const { treasure, at } of this.grass.takeTreasures(d)) this.findTreasure(treasure, at);
            this.grass.cutAll(d);
            MowProgress.grassChanged();
            this.grass.setRestored(d);
            this.town.bloom(flowerSpots(district, (x, z) => this.grass.isLawn(x, z, d)), true);
            MowProgress.restore(district.id, district.bonus);
            this.town.releasePen(d);
            GameAnalytics.districtRestored(district.id);
            if (d === 0) GameAnalytics.tutorialStep('yard-restored');
            if (district.id === 'park') GameAnalytics.tutorialStep('park-restored');
            MowAudio.play('applause');
            MowAudio.play('cheer');
            this.hud.celebrate(names.district(district).toUpperCase(), district.bonus, d);
            MowAudio.play('complete');
            for (let i = 0; i < 8; i++) {
                const at = new THREE.Vector3(district.x + (Math.random() - 0.5) * district.width, 0.5, district.z + (Math.random() - 0.5) * district.depth);
                this.effects.smoke(at, 3, 1, new THREE.Color(0xfff2a0), 0.8);
            }
            // Confetti round the player, in waves.
            for (let wave = 0; wave < 4; wave++) {
                gsap.delayedCall(wave * 0.18, () => {
                    if (this.sceneDestroyed) return;
                    const at = this.player.transform.position;
                    CONFETTI.forEach((color) => this.effects.burst(new THREE.Vector3(at.x + (Math.random() - 0.5) * 3, 0, at.z + (Math.random() - 0.5) * 3), color, 4, 5));
                });
            }
            const next = d + 1;
            if (next < MOW.districts.length && !this.town.isOpen(next)) {
                this.town.unlock(next);
                this.fresh.add(next);
                const nextDistrict = MOW.districts[next];
                // After the celebration (the RESTORED! banner, then the town filling up): the next area, the camera
                // panning to it if it asks.
                gsap.delayedCall(CELEBRATION_SEC + 0.2, () => {
                    if (this.sceneDestroyed) return;
                    if (nextDistrict.onUnlock?.pan) this.pan = { to: this.town.sectionCentre(nextDistrict), time: 0 };
                    this.hud.say(t('districtUnlocked', { name: names.district(nextDistrict).toUpperCase() }), 0x8fe3ff);
                    // Uplifting: the victory fanfare with a shimmer (dig's "reveal" read as an error here).
                    MowAudio.play('buyFanfare');
                    MowAudio.play('sparkle');
                });
            }
            // The last one: the town is done (there's no more game yet), told after its celebration.
            if (MOW.districts.every((other) => MowProgress.isRestored(other.id))) {
                GameAnalytics.townRestored();
                gsap.delayedCall(CELEBRATION_SEC + 0.4, () => {
                    if (this.sceneDestroyed) return;
                    this.hud.showTownComplete({
                        town: Localization.getString('town_name', undefined, TOWN.name),
                        earned: MowProgress.earned,
                        trophies: { found: MOW.treasures.items.filter((item) => MowProgress.treasureFound(item.id)).length, total: MOW.treasures.items.length },
                        secrets: { found: (TOWN.secrets ?? []).filter((secret) => MowProgress.secretFound(secret.id)).length, total: TOWN.secrets?.length ?? 0 },
                    });
                });
            }
        });
    }

    // ---------------------------------------------------------------- guide

    /** Where the arrows lead now (see the file's header), and the hand in the shop. */
    private updateGuide(delta: number): void {
        let target: THREE.Vector3 | null = null;
        let area: Box | undefined;
        let hint: ShopHint = null;
        if (this.firstBuy) {
            // The first purchases are on screen: nothing to lead to, the hand's on what to buy.
            this.hud.setShopHint(this.firstBuy);
            this.guide.update(delta, this.player.transform.position, null);
            return;
        }
        const atmAt = this.town.nearestAtm(this.player.transform.position);
        const next = MowProgress.nextTool;
        const firstUpgrade = MOW.upgrades.every((u) => MowProgress.upgradeLevel(u.id) === 0);
        // The first upgrade the guide points at is the bag (on the GEAR tab, where the shop opens).
        const capacity = MOW.upgrades.find((u) => u.id === 'capacity')!;
        const affordableUpgrade = MowProgress.money >= (MowProgress.upgradePrice(capacity) ?? Infinity) ? capacity : undefined;
        if (MowProgress.full) {
            target = atmAt;
        } else if (MowProgress.toolLevel === 0 && next && MowProgress.money >= next.price) {
            target = atmAt;
            hint = 'tool';
        } else if (MowProgress.toolLevel > 0 && firstUpgrade && affordableUpgrade) {
            target = atmAt;
            hint = 'capacity';
        } else if (!MowProgress.boughtFirstHat && this.town.nearestWardrobe(this.player.transform.position)) {
            // The first wardrobe is out (the second sale): go and get the first hat.
            target = this.town.nearestWardrobe(this.player.transform.position);
        } else if (this.fresh.size) {
            const d = [...this.fresh][0];
            const district = MOW.districts[d];
            target = new THREE.Vector3(district.x, 0, district.z + district.depth / 2 - 1.5);
        } else {
            area = this.wanderArea();
            if (area) target = new THREE.Vector3(area.x, 0, area.z);
        }
        this.hud.setShopHint(hint);
        this.guide.update(delta, this.player.transform.position, target, area);
    }

    /**
     * The section being worked on (the first open one not restored), as the arrows' goal while the player has wandered
     * off from it (WANDER); undefined when they're there, or all is restored.
     */
    private wanderArea(): Box | undefined {
        const d = MOW.districts.findIndex((district, i) => this.town.isOpen(i) && !MowProgress.isRestored(district.id));
        if (d < 0) {
            this.wandering = false;
            return undefined;
        }
        const district = MOW.districts[d];
        const p = this.player.transform.position;
        const outX = Math.max(0, Math.abs(p.x - district.x) - district.width / 2);
        const outZ = Math.max(0, Math.abs(p.z - district.z) - district.depth / 2);
        const away = Math.hypot(outX, outZ);
        if (away > WANDER.far) this.wandering = true;
        const inside = Math.abs(p.x - district.x) <= district.width / 2 - WANDER.back && Math.abs(p.z - district.z) <= district.depth / 2 - WANDER.back;
        if (inside) this.wandering = false;
        if (!this.wandering) return undefined;
        return { x: district.x, z: district.z, halfX: district.width / 2 - WANDER.inset, halfZ: district.depth / 2 - WANDER.inset };
    }

    // ---------------------------------------------------------------- lifecycle

    private readonly onFirstInput = (): void => {
        window.removeEventListener('pointerdown', this.onFirstInput, true);
        window.removeEventListener('keydown', this.onFirstInput, true);
        this.afterFirstInput();
        if (Gameplay.started) return;
        GameAnalytics.sessionStart(MowProgress.cellsCut === 0);
        Gameplay.start();
    };

    /**
     * What waits for the first input, kept out of the initial download: the soundtrack, the ambience loops (SpatialAudio)
     * and the treasures' models (only needed when one is found). The browser lets audio start then anyway.
     */
    private afterFirstInput(): void {
        if (this.sceneDestroyed || this.spatial) return;
        this.spatial = new SpatialAudio();
        MowAudio.startMusic();
        this.loadTreasureModels();
    }

    public resize(): void {
        this.hud?.reposition();
    }

    public destroy(): void {
        this.sceneDestroyed = true;
        window.removeEventListener('pointerdown', this.onFirstInput, true);
        window.removeEventListener('keydown', this.onFirstInput, true);
        MowProgress.saveNow();
        DebugOverlay.instance.removePanel('mow.progress');
        Localization.onLocaleChange.remove(this.onLocaleChange, this);
        this.engine.stop();
        this.spatial?.destroy();
        this.hud?.destroy();
        this.guide?.destroy();
        this.effects?.destroy();
        this.beacons?.destroy();
        this.secrets?.destroy();
        this.locks?.destroy();
        this.traffic?.destroy();
        this.grass?.destroy();
        this.town?.destroy();
        this.tractor?.destroy();
        this.player?.destroy();
        super.destroy();
    }
}
