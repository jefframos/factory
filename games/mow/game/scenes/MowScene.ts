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
import { MowHud, ShopHint } from '../ui/MowHud';
import { MowEffects } from '../vfx/MowEffects';
import { MOW, TreasureDef, firstToolFor } from '../data/MowConfig';
import { TreasureBeacons } from '../world/TreasureBeacons';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { MowProgress } from '../data/MowProgress';
import { Gameplay } from '../data/Gameplay';
import { MowAudio } from '../audio/MowAudio';
import { EngineSound } from '../audio/EngineSound';
import { GrassLocks } from '../world/GrassLocks';
import { GameAnalytics } from '../analytics/GameAnalytics';
import { t, names, Localization } from '../i18n/Localization';

/** Top-down, slightly angled. yaw 0 = camera south of the player looking north (-Z). */
export const MOW_CAMERA = {
    yawDeg: 0,
    pitchDeg: 55,
    distance: 14,
    followSpeed: 8,
    /** How fast the distance eases to a new section's `zoom`. */
    zoomSpeed: 1.5,
};

const REFERENCE_ASPECT = Game.DESIGN_WIDTH / Game.DESIGN_HEIGHT;
const MAX_FRAME_SEC = 0.1;
const FLOOR_HALF_THICKNESS = 0.5;
/** Selling: at most this many clumps are tossed into the bin. */
const SELL_TOSSES = 12;
const SELL_TOSS_INTERVAL = 0.07;
const CLIPPING_COLOR = new THREE.Color(0x7cc95a);
/** The move hint goes once the player has walked this far. */
const MOVE_HINT_DISTANCE = 2.5;
/** Occlusion looks at the torso, not the feet: what a tree in front actually hides. */
const OCCLUSION_HEIGHT = 0.9;
/** A newly opened section (onUnlock.pan): the camera glides over, holds, glides back (seconds). */
const PAN = { delay: 1.2, glide: 0.9, hold: 1.4 };
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
const CONFETTI = [0xff5a6e, 0xffd23f, 0x4fc3ff, 0x9cff6a, 0xc36bff, 0xffffff].map((c) => new THREE.Color(c));

function cameraOffset(camera: THREE.PerspectiveCamera, zoom: number): THREE.Vector3 {
    const yaw = THREE.MathUtils.degToRad(MOW_CAMERA.yawDeg);
    const pitch = THREE.MathUtils.degToRad(MOW_CAMERA.pitchDeg);
    const distance = MOW_CAMERA.distance * zoom * Math.max(1, REFERENCE_ASPECT / camera.aspect);
    const horizontal = distance * Math.cos(pitch);
    return new THREE.Vector3(horizontal * Math.sin(yaw), distance * Math.sin(pitch), horizontal * Math.cos(yaw));
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
    private engineOn = false;
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
    /** Padlocks (with the mower it takes) over grass the mower can't cut. */
    private locks!: GrassLocks;
    /** Each treasure's model, fitted to its size (loaded behind the game: treasureModels()). */
    private readonly treasureModels = new Map<string, THREE.Object3D>();
    /** The wardrobe whose pad the player stands on, or -1. */
    private onWardrobe = -1;
    /** The tutorial's first hat is being forced (the player is held on the wardrobe's pad until it's bought). */
    private hatForced = false;
    private moveHintActive = false;
    /** updateRelief(): seconds to the next stuck check; while grass grows back, the district, clippings still to grow and cells a second. */
    private stuckCheck = STUCK_CHECK_SEC;
    private relief = { district: -1, clippings: 0, rate: 0, carry: 0 };
    private walked = 0;
    /** Where the player was last frame, for the move hint (the engine keeps its own: lastPosition). */
    private readonly hintLast = new THREE.Vector3();
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

    /** Resolves once the scene can be played (the character, the town's models and the grass loaded): the loading screen waits. */
    public get ready(): Promise<void> {
        return Promise.all([this.characterReady, this.town?.ready, this.grass?.ready]).then(() => undefined);
    }

    public build(): void {
        this.buildLights();
        const open = (d: number) => d === 0 || MowProgress.isRestored(MOW.districts[d - 1].id);
        this.town = new Town(this.threeScene, open);
        this.grass = new GrassField(this.threeScene, (x, z) => this.town.isBlocked(x, z), MowProgress.savedCut);
        MowProgress.setCutProvider(() => this.grass.save());
        // Districts restored in an earlier session look restored again (all mowed, even if the level's grass changed);
        // a treasure of theirs not found then (a save from before treasures) is handed over: its reward waits in the panel.
        MOW.districts.forEach((district, d) => {
            if (!MowProgress.isRestored(district.id)) return;
            this.grass.cutAll(d);
            this.grass.setRestored(d);
            this.town.bloom(this.flowerSpots(district));
            for (const item of MOW.treasures.items) if (item.area === district.id && MowProgress.findTreasure(item.id)) GameAnalytics.treasureFound(item.id);
        });
        this.milestones = MOW.districts.map((_, d) => Math.floor(this.grass.progress(d) * 4));
        this.grass.placeTreasures((id) => MowProgress.treasureFound(id));
        this.beacons = new TreasureBeacons(this.threeScene, this.grass, (id) => !MowProgress.treasureFound(id));

        this.player = this.world.add(new MowPlayer(this, this.threeScene));
        this.player.transform.position.set(MOW.start.x, 0, MOW.start.z);
        this.characterReady = this.player.loadCharacter().catch((error) => console.error('[MowScene] character failed to load', error));
        this.effects = new MowEffects(this.threeScene, 0.5, () => this.player.pickupPoint(new THREE.Vector3()));
        this.tractor = new TractorRide(this.threeScene, this.player, this.effects, (x, z) => this.inUnfinishedSection(x, z));
        this.player.ridePoint = (out) => this.tractor.cutPoint(out);
        this.guide = new ArrowGuide(this.threeScene, () => this.town.blockers, () => this.town.unstandable());
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
        }, (treasure, at) => this.findTreasure(treasure, at));

        this.moveHintActive = MowProgress.cellsCut === 0 && MowProgress.toolLevel === 0;
        if (this.moveHintActive) this.hud.moveHint.show();
        this.lastPosition.copy(this.player.transform.position);
        this.hintLast.copy(this.player.transform.position);
        this.followTarget.copy(this.player.transform.position);
        this.zoom = this.cameraZoomGoal();
        this.placeCamera();
        this.buildDebug();
        // Gameplay starts on the first input, once the game is loaded.
        void this.ready.then(() => {
            // The game is in: the treasures' models come down behind it (only needed when one is found).
            this.loadTreasureModels();
            if (this.sceneDestroyed) return;
            window.addEventListener('pointerdown', this.onFirstInput, true);
            window.addEventListener('keydown', this.onFirstInput, true);
        });
    }

    private buildLights(): void {
        this.threeScene.background = new THREE.Color(0x9fd4f2);
        this.threeScene.add(new THREE.HemisphereLight(0xffffff, 0x5a7a4a, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 1.5);
        sun.position.set(6, 14, 8);
        this.threeScene.add(sun);
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
        if (this.mowing.wall) this.locks.bump(this.mowing.wall);
        this.locks.update(delta, this.player.transform.position, MowProgress.power);
        this.effects.update(delta);
        this.updateEngine(delta);
        this.updateGuide(delta);
        this.updateMoveHint();
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

    /** Powered mowers run an engine (rising with the speed); the reel and the push mower are quiet. */
    private updateEngine(delta: number): void {
        // A ridden mower's engine runs only while it's ridden.
        const engine = MowProgress.tool.engine === true && (!MowProgress.tool.ride || this.tractor.isRiding);
        if (engine !== this.engineOn) {
            this.engineOn = engine;
            if (engine) this.engine.start();
            else this.engine.stop();
        }
        if (!engine || delta <= 0) return;
        const position = this.player.transform.position;
        const moved = Math.hypot(position.x - this.lastPosition.x, position.z - this.lastPosition.z);
        this.engine.update(moved / delta / Math.max(1, MowProgress.speed));
        this.lastPosition.copy(position);
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
        if (MowProgress.toolLevel > 0) GameAnalytics.tutorialStep('first-mower');
        if (MOW.upgrades.some((u) => MowProgress.upgradeLevel(u.id) > 0)) GameAnalytics.tutorialStep('first-upgrade');
        this.effects.smoke(this.player.transform.position.clone().setY(0.4), 6, 0.8, new THREE.Color(0xffffff), 0.8);
    }

    // ---------------------------------------------------------------- districts

    /** Inside an open section not restored yet: where a ridden mower is ridden. */
    private inUnfinishedSection(x: number, z: number): boolean {
        return MOW.districts.some((d, i) => this.town.isOpen(i) && !MowProgress.isRestored(d.id)
            && Math.abs(x - d.x) <= d.width / 2 && Math.abs(z - d.z) <= d.depth / 2);
    }

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
     * (MowEffects.reveal, Dig's), then counts as found — the HUD names it and its Trophies button jumps.
     */
    private findTreasure(treasure: TreasureDef, at: THREE.Vector3): void {
        if (MowProgress.treasureFound(treasure.id)) return;
        const model = this.treasureModels.get(treasure.id)?.clone(true);
        MowAudio.play('sparkle');
        this.effects.reveal(at.clone().setY(0.6), () => {
            if (!MowProgress.findTreasure(treasure.id)) return;
            GameAnalytics.treasureFound(treasure.id);
            this.hud.trophyFound(names.treasure(treasure));
            MowAudio.play('cheer');
        }, model);
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

    /** The bar at the top, and a pop each time the section shown passes another quarter (25 / 50 / 75%). */
    private updateDistrictBar(): void {
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
            this.town.bloom(this.flowerSpots(district), true);
            MowProgress.restore(district.id, district.bonus);
            GameAnalytics.districtRestored(district.id);
            if (d === 0) GameAnalytics.tutorialStep('yard-restored');
            if (district.id === 'park') GameAnalytics.tutorialStep('park-restored');
            MowAudio.play('applause');
            MowAudio.play('cheer');
            this.hud.celebrate(names.district(district).toUpperCase(), district.bonus);
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
                if (nextDistrict.onUnlock?.pan) this.pan = { to: this.town.sectionCentre(nextDistrict), time: 0 };
                gsap.delayedCall(1.6, () => {
                    if (this.sceneDestroyed) return;
                    this.hud.say(t('districtUnlocked', { name: names.district(nextDistrict).toUpperCase() }), 0x8fe3ff);
                    // Uplifting: the victory fanfare with a shimmer (dig's "reveal" read as an error here).
                    MowAudio.play('buyFanfare');
                    MowAudio.play('sparkle');
                });
            }
        });
    }

    /** Spots for a restored district's flowers: a seeded scatter over it. */
    private flowerSpots(district: (typeof MOW.districts)[number]): THREE.Vector3[] {
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
            if (!this.town.isBlocked(x, z)) spots.push(new THREE.Vector3(x, 0, z));
        }
        return spots;
    }

    // ---------------------------------------------------------------- guide

    /** Where the arrows lead now (see the file's header), and the hand in the shop. */
    private updateGuide(delta: number): void {
        let target: THREE.Vector3 | null = null;
        let area: Box | undefined;
        let hint: ShopHint = null;
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
        if (Gameplay.started) return;
        window.removeEventListener('pointerdown', this.onFirstInput, true);
        window.removeEventListener('keydown', this.onFirstInput, true);
        GameAnalytics.sessionStart(MowProgress.cellsCut === 0);
        Gameplay.start();
    };

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
        this.hud?.destroy();
        this.guide?.destroy();
        this.effects?.destroy();
        this.beacons?.destroy();
        this.locks?.destroy();
        this.grass?.destroy();
        this.town?.destroy();
        this.tractor?.destroy();
        this.player?.destroy();
        super.destroy();
    }
}
