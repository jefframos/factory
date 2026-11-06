// MobScene.ts
//
// A battle (refs/mob's MVP): the field in 3D (THREE, behind the PIXI overlay), the HUD over it, and the player's one
// control — drag across the screen and the cannon follows the finger's x. The battle (Battle.ts) is stepped at the fixed
// rate; the crowd (CrowdView), the field (Arena) and the HUD follow it each frame.
//
// It starts on the first touch (gameplay start goes to the platform then, not before): until then the field waits with
// "drag to aim". Won: the base collapses, coins are paid, and the end card offers the fire-rate upgrade and NEXT. Lost (a
// red past the danger line): the end card's RETRY replays the same battle. Either way the next battle is built in this
// same scene (the crowd's baked model stays loaded).

import * as THREE from 'three';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { ThreeScene } from 'core/scene/ThreeScene';
import { ARENA, TUNING, battleConfig } from '../data/MobConfig';
import { MobSave } from '../data/MobSave';
import { Battle } from '../battle/Battle';
import { CrowdView } from '../battle/CrowdView';
import { Arena } from '../battle/Arena';
import { MobHud } from '../ui/MobHud';
import { updateBend } from '../services/Bend';

const MODEL_BASE = './mob/models/mob/';
const DEBUG_PANEL = 'mob.debug';
/**
 * The camera, as Cinemachine frames one (the debug panel's Camera folder changes it live): it orbits a fixed point on
 * the field (`target`) at `pitchDeg`, `distance` back; `offsetX` / `offsetY` then slide it along its own right / up
 * (world units), moving the framing without changing the angle. `distance` is for a 9:16 screen: narrower ones move
 * back so the field's width still fits.
 */
const CAMERA = { pitchDeg: 45, fov: 42, distance: 35, offsetX: 0, offsetY: -1.9 };
const CAMERA_TARGET = new THREE.Vector3(0, 0, -11.5);
const REFERENCE_ASPECT = 9 / 16;
/** The world bends away from here (the cannon), this strongly (Bend.ts): the base end drops like a horizon. */
const BEND = { origin: new THREE.Vector3(0, 0, 1.5), strength: 0.0028 };
/** Light: the sky's fill and the sun. */
const LIGHT = { sky: 1.15, sun: 1.25 };
/** Seconds from the end of a battle to its card (the base's collapse plays first). */
const WON_CARD_DELAY = 1.4;
const LOST_CARD_DELAY = 0.9;

export default class MobScene extends ThreeScene {
    /** Resolves once the crowd's model is loaded and baked (the loading screen waits for it). */
    public readonly ready: Promise<void>;
    private readonly crowd = new CrowdView();
    private readonly hud: MobHud;
    private battle!: Battle;
    private arena!: Arena;
    private state: 'waiting' | 'playing' | 'over' = 'waiting';
    private time = 0;
    private dragging = false;
    private collapse = { progress: 0 };
    private gameplayOn = false;
    private torndown = false;

    public constructor(game: Game) {
        super(game);
        this.threeScene.background = new THREE.Color(0x8fd8ff);
        updateBend(BEND.origin, BEND.strength);
        this.threeScene.add(new THREE.HemisphereLight(0xffffff, 0x6b8f4a, LIGHT.sky));
        const sun = new THREE.DirectionalLight(0xffffff, LIGHT.sun);
        sun.position.set(6, 14, 8);
        this.threeScene.add(sun);
        this.threeScene.add(this.crowd.group);

        this.hud = new MobHud(() => this.nextBattle(), () => this.buyUpgrade());
        this.addChild(this.hud);
        this.ready = this.crowd.load(MODEL_BASE, TUNING.maxMobs + 64);
        this.startBattle();
        this.buildDebug();

        window.addEventListener('pointerdown', this.onPointerDown);
        window.addEventListener('pointermove', this.onPointerMove);
        window.addEventListener('pointerup', this.onPointerUp);
        window.addEventListener('pointercancel', this.onPointerUp);
        this.resize();
    }

    // ------------------------------------------------------------------ battles

    /** A fresh battle: the save's next one, the field rebuilt for its gates. */
    private startBattle(): void {
        const index = MobSave.battle;
        const config = battleConfig(index);
        if (this.arena) {
            this.threeScene.remove(this.arena.group);
            this.arena.dispose();
        }
        this.arena = new Arena(config.gates);
        this.threeScene.add(this.arena.group);
        this.battle = new Battle(config, {
            clash: (x, z) => this.arena.puff(x, z),
            gate: (g) => this.arena.pulseGate(g),
            baseHit: () => this.arena.hitBase(),
            won: () => this.finish(true),
            lost: () => this.finish(false),
        });
        this.battle.fireLevel = MobSave.fireLevel;
        this.collapse.progress = 0;
        this.time = 0;
        this.state = 'waiting';
        this.hud.hideEnd();
        this.hud.setTitle(`BATTLE ${index + 1}  ·  ${config.name.toUpperCase()}`);
        this.hud.setBaseHp(this.battle.baseHp, this.battle.baseHpMax);
        this.hud.setCoins(MobSave.coins);
    }

    private begin(): void {
        if (this.state !== 'waiting') return;
        this.state = 'playing';
        this.hud.hideHint();
        this.setGameplay(true);
        PlatformHandler.instance.measure('battle', MobSave.battle + 1, 'start');
    }

    private finish(won: boolean): void {
        if (this.state === 'over') return;
        this.state = 'over';
        this.setGameplay(false);
        const config = this.battle.config;
        PlatformHandler.instance.measure('battle', MobSave.battle + 1, won ? 'win' : 'lose');
        if (won) {
            MobSave.addCoins(config.reward);
            MobSave.nextBattle();
            gsap.to(this.collapse, { progress: 1, duration: 1.1, ease: 'power2.in' });
        }
        const card = () => {
            if (this.torndown) return;
            this.hud.setCoins(MobSave.coins);
            this.hud.showEnd({ won, reward: config.reward, fireLevel: MobSave.fireLevel, upgradeCost: MobSave.upgradeCost, coins: MobSave.coins });
        };
        gsap.delayedCall(won ? WON_CARD_DELAY : LOST_CARD_DELAY, card);
    }

    private nextBattle(): void {
        this.startBattle();
    }

    private buyUpgrade(): void {
        if (!MobSave.buyFireLevel()) return;
        PlatformHandler.instance.measure('upgrade', 'fire-rate', `${MobSave.fireLevel}`);
        this.battle.fireLevel = MobSave.fireLevel;
        this.hud.setCoins(MobSave.coins);
        this.hud.refreshUpgrade({ fireLevel: MobSave.fireLevel, upgradeCost: MobSave.upgradeCost, coins: MobSave.coins });
    }

    private setGameplay(on: boolean): void {
        if (on === this.gameplayOn) return;
        this.gameplayOn = on;
        const platform = PlatformHandler.instance.platform;
        void (on ? platform?.gameplayStart() : platform?.gameplayStop())?.catch?.(() => undefined);
    }

    // ------------------------------------------------------------------ input

    /** The cannon follows the finger: the point on the cannon's row under its x. */
    private aimAt(screenX: number): void {
        const cannonRow = this.worldToScreen(new THREE.Vector3(0, 0, 0.35));
        const point = this.screenToGround(screenX, cannonRow?.y ?? window.innerHeight * 0.85);
        if (!point) return;
        this.battle.aimX = Math.max(-ARENA.cannonRange, Math.min(ARENA.cannonRange, point.x));
    }

    private readonly onPointerDown = (event: PointerEvent): void => {
        if (this.state === 'over') return;
        this.dragging = true;
        this.aimAt(event.clientX);
        this.begin();
    };

    private readonly onPointerMove = (event: PointerEvent): void => {
        // A mouse aims just by moving over the field; a finger by dragging.
        if (this.state === 'over' || (!this.dragging && event.pointerType !== 'mouse')) return;
        if (this.state === 'playing' || this.dragging) this.aimAt(event.clientX);
    };

    private readonly onPointerUp = (): void => {
        this.dragging = false;
    };

    // ------------------------------------------------------------------ frame

    public override fixedUpdate(delta: number): void {
        if (this.state === 'waiting') return;
        this.battle.step(delta);
    }

    public override update(delta: number): void {
        const dt = Math.min(delta, 1 / 20);
        this.time += dt;
        this.crowd.update(this.battle, this.time);
        this.arena.update(this.battle, dt);
        if (this.collapse.progress > 0) this.arena.collapseBase(this.collapse.progress);
        this.hud.setBaseHp(this.battle.baseHp, this.battle.baseHpMax);
        super.update(delta);
    }

    /** The camera, framed as CAMERA says (see there). */
    public override resize(): void {
        const camera = this.threeCamera;
        camera.fov = CAMERA.fov;
        camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
        camera.near = 0.5;
        camera.far = 250;
        camera.updateProjectionMatrix();
        updateBend(BEND.origin, BEND.strength);
        // Orbit: at the pitch, `distance` back from the target (further on a screen narrower than 9:16).
        const pitch = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
        const distance = CAMERA.distance * Math.max(1, REFERENCE_ASPECT / camera.aspect);
        camera.position.set(0, Math.sin(pitch), Math.cos(pitch)).multiplyScalar(distance).add(CAMERA_TARGET);
        camera.lookAt(CAMERA_TARGET);
        // Then slide along its own right and up: the framing moves, the angle stays.
        camera.updateMatrixWorld(true);
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        camera.position.addScaledVector(right, CAMERA.offsetX).addScaledVector(up, CAMERA.offsetY);
        camera.updateMatrixWorld(true);
        this.hud.layout();
    }

    // ------------------------------------------------------------------ debug

    private buildDebug(): void {
        const panel = DebugOverlay.instance.panel('Mob', { id: DEBUG_PANEL });
        panel.monitor('Mobs', () => `${this.battle.count} (peak ${this.battle.peak})`);
        panel.monitor('Battle', () => `${MobSave.battle + 1} · ${this.battle.time.toFixed(1)}s`);
        panel.buttons([
            { label: 'WIN', action: () => { this.battle.baseHp = 0; this.battle.state = 'won'; this.finish(true); } },
            { label: 'LOSE', variant: 'danger', action: () => { this.battle.state = 'lost'; this.finish(false); } },
            { label: 'RESTART', action: () => this.startBattle() },
        ]);
        panel.buttons([
            { label: '+500 coins', action: () => { MobSave.addCoins(500); this.hud.setCoins(MobSave.coins); } },
            { label: 'Reset save', variant: 'danger', action: () => { MobSave.reset(); this.startBattle(); } },
        ]);
        const camera = panel.folder('Camera');
        const apply = () => this.resize();
        camera.slider(CAMERA, 'pitchDeg', 25, 89, 1, 'Pitch (deg)').onChange(apply);
        camera.slider(CAMERA, 'distance', 10, 80, 0.5, 'Distance').onChange(apply);
        camera.slider(CAMERA, 'offsetY', -15, 15, 0.1, 'Offset up / down').onChange(apply);
        camera.slider(CAMERA, 'offsetX', -10, 10, 0.1, 'Offset left / right').onChange(apply);
        camera.slider(CAMERA, 'fov', 20, 80, 1, 'Field of view').onChange(apply);
        camera.slider(BEND, 'strength', 0, 0.012, 0.0001, 'Bend').onChange(apply);
        camera.button('Log camera', () => console.log('[Mob] CAMERA', JSON.stringify({ ...CAMERA, bend: BEND.strength })));
        const look = panel.folder('Mobs');
        look.slider(TUNING, 'mobHeight', 0.6, 3, 0.05, 'Mob size (mesh)');
        const tuning = panel.folder('Tuning');
        tuning.slider(TUNING, 'fireRate', 1, 12, 0.1, 'Fire rate (lv 1)');
        tuning.slider(TUNING, 'blueSpeed', 1, 8, 0.1, 'Blue speed');
        tuning.slider(TUNING, 'redSpeed', 1, 8, 0.1, 'Red speed');
        tuning.slider(TUNING, 'radius', 0.12, 0.5, 0.01, 'Mob radius');
        tuning.slider(TUNING, 'separation', 0, 20, 0.5, 'Separation');
        tuning.slider(TUNING, 'seekRange', 0, 8, 0.1, 'Red seek range');
        tuning.slider(TUNING, 'maxMobs', 50, TUNING.maxMobs, 10, 'Max mobs');
    }

    public override destroy(): void {
        this.torndown = true;
        this.setGameplay(false);
        window.removeEventListener('pointerdown', this.onPointerDown);
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointercancel', this.onPointerUp);
        DebugOverlay.instance.removePanel(DEBUG_PANEL);
        this.arena.dispose();
        super.destroy();
    }
}
