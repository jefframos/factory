// MowScene.ts
//
// Mow Town's scene: the town (Town, from levels/town.json: park, plaza, road, the fenced Residential Street, the
// ATMs) with the grass over its districts (GrassField), the player with their tool (MowPlayer), automatic mowing while
// moving (MowingSystem), the HUD (MowHud) and the floor arrows (ArrowGuide).
//
// The loop: mow -> the container fills -> stand on any ATM's pad (the clippings are tossed into it, cash counts up,
// and the shop opens: tools and upgrades) -> mow faster. A district reaching its restoration goal clears its last
// stragglers, brightens, blooms with flowers, pays its bonus and opens the next one (its fence sinks, its ATMs pop
// in, and with `onUnlock.pan` the camera glides over to show it).
//
// The guide (no text, just the arrows): a full bag -> the nearest ATM; the first mower or the first upgrade
// affordable -> the nearest ATM (and the hand on the shop's BUY button); a newly opened district -> its grass.
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
import { MowingSystem } from '../mowing/MowingSystem';
import { MowHud, ShopHint } from '../ui/MowHud';
import { MowEffects } from '../vfx/MowEffects';
import { MOW } from '../data/MowConfig';
import { MowProgress } from '../data/MowProgress';
import { Gameplay } from '../data/Gameplay';
import { MowAudio } from '../audio/MowAudio';
import { EngineSound } from '../audio/EngineSound';
import { GameAnalytics } from '../analytics/GameAnalytics';
import { t, names, Localization } from '../i18n/Localization';

/** Top-down, slightly angled. yaw 0 = camera south of the player looking north (-Z). */
export const MOW_CAMERA = {
    yawDeg: 0,
    pitchDeg: 55,
    distance: 14,
    followSpeed: 8,
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

function cameraOffset(camera: THREE.PerspectiveCamera): THREE.Vector3 {
    const yaw = THREE.MathUtils.degToRad(MOW_CAMERA.yawDeg);
    const pitch = THREE.MathUtils.degToRad(MOW_CAMERA.pitchDeg);
    const distance = MOW_CAMERA.distance * Math.max(1, REFERENCE_ASPECT / camera.aspect);
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
    private readonly lastPosition = new THREE.Vector3();
    /** Districts that opened this session and haven't been mowed yet (the guide leads there). */
    private readonly fresh = new Set<number>();
    /** The ATM the player stands on (-1: none). */
    private onAtm = -1;
    private moveHintActive = false;
    private walked = 0;
    /** Where the player was last frame, for the move hint (the engine keeps its own: lastPosition). */
    private readonly hintLast = new THREE.Vector3();
    private readonly occlusionTarget = new THREE.Vector3();
    /** A camera pan to a newly opened section: where to, and how far through it (seconds); the player waits. */
    private pan: { to: THREE.Vector3; time: number } | null = null;

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
        // Districts restored in an earlier session look restored again (all mowed, even if the level's grass changed).
        MOW.districts.forEach((district, d) => {
            if (!MowProgress.isRestored(district.id)) return;
            this.grass.cutAll(d);
            this.grass.setRestored(d);
            this.town.bloom(this.flowerSpots(district));
        });

        this.player = this.world.add(new MowPlayer(this, this.threeScene));
        this.player.transform.position.set(MOW.start.x, 0, MOW.start.z);
        this.characterReady = this.player.loadCharacter().catch((error) => console.error('[MowScene] character failed to load', error));
        this.effects = new MowEffects(this.threeScene, 0.5, () => this.player.pickupPoint(new THREE.Vector3()));
        this.tractor = new TractorRide(this.threeScene, this.player, this.effects, (x, z) => this.inUnfinishedSection(x, z));
        this.player.ridePoint = (out) => this.tractor.cutPoint(out);
        this.guide = new ArrowGuide(this.threeScene, () => this.town.blockers);
        this.hud = this.createHud();
        Localization.onLocaleChange.add(this.onLocaleChange, this);
        this.mowing = new MowingSystem(this.grass, this.player, this.effects, (d) => this.town.isOpen(d), () => {
            this.hud.say(t('bagFull'), 0xff8a7a);
            this.hud.flashBag();
            this.effects.floatText(this.player.pickupPoint(new THREE.Vector3()).setY(2.4), t('bagFullFloat'), '#ff8a7a');
            GameAnalytics.bagFull();
            GameAnalytics.tutorialStep('bag-full');
        }, (grass) => {
            const tool = MOW.tools.find((tl) => tl.power >= grass.resistance - 1);
            this.hud.say(tool ? t('needsTool', { grass: names.grass(grass), tool: names.tool(tool) }) : t('needsPower', { grass: names.grass(grass) }), 0xffd9a8);
        }, () => {
            GameAnalytics.tutorialStep('cut');
            this.fresh.forEach((d) => {
                if (this.grass.progress(d) > 0.02) this.fresh.delete(d);
            });
        });

        this.moveHintActive = MowProgress.cellsCut === 0 && MowProgress.toolLevel === 0;
        if (this.moveHintActive) this.hud.moveHint.show();
        this.lastPosition.copy(this.player.transform.position);
        this.hintLast.copy(this.player.transform.position);
        this.followTarget.copy(this.player.transform.position);
        this.placeCamera();
        this.buildDebug();
        // Gameplay starts on the first input, once the game is loaded.
        void this.ready.then(() => {
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

    private createHud(): MowHud {
        const hud = new MowHud(() => this.onBought());
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
        // Open districts not restored yet slowly grow back: always grass to earn from (no soft lock whatever was bought).
        this.grass.regrow(delta, (d) => this.town.isOpen(d) && !MowProgress.isRestored(MOW.districts[d].id));
        this.updateStations();
        this.checkRestoration();
        this.updateDistrictBar();
        const position = this.player.transform.position;
        this.followTarget.lerp(this.cameraGoal(delta, position), 1 - Math.exp(-MOW_CAMERA.followSpeed * delta));
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

    private placeCamera(): void {
        this.threeCamera.position.copy(this.followTarget).add(cameraOffset(this.threeCamera));
        this.threeCamera.lookAt(this.followTarget);
    }

    /** Powered mowers run an engine (rising with the speed); the scissors and the push mower are quiet. */
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
    }

    /** Sells the bag now (so the save is right), then plays it out: clippings tossed into the ATM, cash landing. */
    private sell(atm: number): void {
        const earned = MowProgress.sell();
        if (earned <= 0) return;
        GameAnalytics.sold(MowProgress.timesSold);
        GameAnalytics.tutorialStep('sell');
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

    private updateDistrictBar(): void {
        const d = this.currentDistrict();
        this.hud.setDistrict(d, MowProgress.isRestored(MOW.districts[d].id) ? 1 : this.grass.progress(d));
    }

    /** A district at its goal: the stragglers go, it brightens and blooms, its bonus is paid, the next one opens. */
    private checkRestoration(): void {
        MOW.districts.forEach((district, d) => {
            if (!this.town.isOpen(d) || MowProgress.isRestored(district.id)) return;
            if (this.grass.progress(d) < district.completeAt) return;
            this.grass.cutAll(d);
            MowProgress.grassChanged();
            this.grass.setRestored(d);
            this.town.bloom(this.flowerSpots(district));
            MowProgress.restore(district.id, district.bonus);
            GameAnalytics.districtRestored(district.id);
            if (d === 0) GameAnalytics.tutorialStep('park-restored');
            MowAudio.play('applause');
            MowAudio.play('cheer');
            this.hud.say(t('districtRestored', { name: names.district(district).toUpperCase() }), 0x9cff9c);
            this.effects.floatText(this.player.pickupPoint(new THREE.Vector3()).setY(2.6), `+$${district.bonus}`, '#ffe27a');
            for (let i = 0; i < 8; i++) {
                const at = new THREE.Vector3(district.x + (Math.random() - 0.5) * district.width, 0.5, district.z + (Math.random() - 0.5) * district.depth);
                this.effects.smoke(at, 3, 1, new THREE.Color(0xfff2a0), 0.8);
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
                    MowAudio.play('reveal');
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
        const count = Math.round(district.width * district.depth * 0.25);
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
        } else if (this.fresh.size) {
            const d = [...this.fresh][0];
            const district = MOW.districts[d];
            target = new THREE.Vector3(district.x, 0, district.z + district.depth / 2 - 1.5);
        }
        this.hud.setShopHint(hint);
        this.guide.update(delta, this.player.transform.position, target);
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
        this.grass?.destroy();
        this.town?.destroy();
        this.tractor?.destroy();
        this.player?.destroy();
        super.destroy();
    }
}
