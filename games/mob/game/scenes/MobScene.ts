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
//
// The juice lives here too, fed by the battle's events: the arena's effects, the sounds (MobAudio), the HUD's pop-ups,
// the camera shaking (base hits, giants, the end), a moment of slow motion as the base falls, coins flying home.

import * as THREE from 'three';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { ThreeScene } from 'core/scene/ThreeScene';
import { ARENA, COLORS, TUNING } from '../data/MobConfig';
import { LEVELS_BY_ID, PLAY, battleConfig, battleInfo, battleZone } from '../data/MobLevels';
import { MobEvents } from '../data/MobEvents';
import { THEMES, ThemeFile, parseTheme, themeById } from '../data/Themes';
import { BattleConfig, UPGRADES, UpgradeKind } from '../data/MobConfig';
import { UpgradeView } from '../ui/MobHud';
import { MobAudio } from '../audio/MobAudio';
import { BLUE, CAR, TRUCK } from '../battle/Battle';
import { MobSave } from '../data/MobSave';
import { Battle } from '../battle/Battle';
import { CrowdView } from '../battle/CrowdView';
import { Arena } from '../battle/Arena';
import { MobHud } from '../ui/MobHud';
import { updateBend } from '../services/Bend';

const MODEL_BASE = './mob/models/mob/';

/**
 * The URL can pin what's played (the editor's live preview uses these): ?level=<id> plays that level (levels/<id>.json)
 * instead of the save's next battle, ?theme=<id> draws it in that theme, and ?preview=1 takes levels sent from the
 * editor (window.postMessage({ type: 'mob-level', level, theme })) and rebuilds the field as they arrive.
 */
const QUERY = new URLSearchParams(window.location.search);
const DEBUG_PANEL = 'mob.debug';
/**
 * The camera, as Cinemachine frames one (the debug panel's Camera folder changes it live): it orbits a fixed point on
 * the field (`target`) at `pitchDeg`, `distance` back; `offsetX` / `offsetY` then slide it along its own right / up
 * (world units), moving the framing without changing the angle. `distance` is for a 9:16 screen: narrower ones move
 * back so the field's width still fits.
 */
const CAMERA = { pitchDeg: 50, fov: 46, distance: 15, offsetX: 0, offsetY: 6 };
const CAMERA_TARGET = new THREE.Vector3(0, 0, -12.5);
const REFERENCE_ASPECT = 9 / 16;
/** The forts' roof line and how far behind the base line their back is (Arena's BASE), and the gap kept under the HUD (px). */
const FORT_TOP_Y = 2.9;
const FORT_BACK = 2.6;
const HUD_CLEARANCE = 10;
/** The cannon's front edge (z) and the room kept under it at the bottom of the screen (px). */
const CANNON_FRONT_Z = 1.2;
/** Where the cannon's front sits on the screen (a share of its height from the top; under it, the energy bar). CAMERA.offsetY nudges it (10 px a unit). */
const CANNON_PIN = 0.86;
/** The world bends away from here (the cannon), this strongly (Bend.ts): the base end drops like a horizon. */
const BEND = { origin: new THREE.Vector3(0, 0, 1.5), strength: 0.0028 };
/** Light: the sky's fill and the sun. */
const LIGHT = { sky: 1.15, sun: 1.25 };
/** Seconds from the end of a battle to its card (the base's collapse plays first). */
const WON_CARD_DELAY = 1.4;
const LOST_CARD_DELAY = 0.9;
/** Camera shake, only for the big moments (it makes people queasy if it comes often): a giant hitting the base, the
 *  base falling, a loss. 0 = none (clashes, ordinary base hits and new giants never shake). */
const SHAKE = { giantClash: 0, baseHit: 0, bigHit: 0.16, giant: 0, won: 0.38, lost: 0.22 };
/** All of it scaled by this (the debug panel's Camera shake; 0 = off). */
const SHAKE_LEVEL = { value: 1 };
/** The base falls: the game slows to this, then eases back to full speed over this long (seconds). */
const SLOW_MOTION = { scale: 0.25, seconds: 1.2 };
/** A gate's "+N" pop-up gathers its copies over this long (seconds), so a stream doesn't pop every frame. */
const GATE_POP_SECONDS = 0.35;

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
    private gameplayOn = false;
    private torndown = false;
    /** The camera's framed position (resize()); the shake moves it round this. */
    private readonly cameraBase = new THREE.Vector3();
    private shake = 0;
    /** Copies each gate made since its last pop-up, and when it may pop next. */
    private gateTally: number[] = [];
    private gatePopIn: number[] = [];
    private readonly projected = new THREE.Vector3();
    /** How the last battle ended (a press on RETRY after a loss is a retry). */
    private lastWon = true;
    /** A level and theme pinned by the URL or the editor (instead of the save's next battle / its zone's theme). */
    private pinned: { config?: BattleConfig; theme?: string; themeData?: ThemeFile } = {
        config: QUERY.get('level') ? LEVELS_BY_ID[QUERY.get('level')!] : undefined,
        theme: QUERY.get('theme') ?? undefined,
    };

    public constructor(game: Game) {
        super(game);
        this.threeScene.background = new THREE.Color(0x8fd8ff);
        updateBend(BEND.origin, BEND.strength);
        this.threeScene.add(new THREE.HemisphereLight(0xffffff, 0x6b8f4a, LIGHT.sky));
        const sun = new THREE.DirectionalLight(0xffffff, LIGHT.sun);
        sun.position.set(6, 14, 8);
        this.threeScene.add(sun);
        this.threeScene.add(this.crowd.group);

        this.hud = new MobHud(() => this.nextBattle(), (kind) => this.buyUpgrade(kind));
        this.addChild(this.hud);
        this.ready = this.crowd.load(MODEL_BASE, TUNING.maxMobs + 64);
        this.startBattle();
        PlatformHandler.instance.onPause.add(this.onPlatformPause);
        PlatformHandler.instance.onResume.add(this.onPlatformResume);
        if (QUERY.get('preview')) {
            window.addEventListener('message', this.onEditorMessage);
            // Tell the editor it can send the level now (anything it sent while the game was loading was missed).
            window.parent?.postMessage({ type: 'mob-ready' }, '*');
        }
        this.buildDebug();
        // For poking at it from the console (and headless tests): window.mob.
        if (QUERY.get('debug') || QUERY.get('dev')) (window as unknown as { mob: unknown }).mob = this;

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
        const config = this.pinned.config ?? battleConfig(index);
        const theme = this.pinned.themeData ? parseTheme(this.pinned.themeData) : themeById(this.pinned.theme ?? battleZone(index).theme);
        (this.threeScene.background as THREE.Color).setHex(theme.sky);
        if (this.arena) {
            this.threeScene.remove(this.arena.group);
            this.arena.dispose();
        }
        this.gateTally = config.gates.map(() => 0);
        this.gatePopIn = config.gates.map(() => 0);
        this.battle = new Battle(config, {
            fire: () => {
                this.arena.fired();
                MobAudio.play('shot', 0.9 + Math.random() * 0.2);
            },
            clash: (x, z, big) => {
                this.arena.clash(x, z, big);
                MobAudio.play('clash', big ? 0.7 : 0.95 + Math.random() * 0.25);
                if (big) this.kick(SHAKE.giantClash);
            },
            gate: (g, x, _z, made) => {
                this.arena.pulseGate(g, x);
                this.gateTally[g] += made;
                MobAudio.play('gate', 1 + Math.min(4, made) * 0.08);
            },
            baseHit: (x, z, _hp, damage, target) => {
                this.arena.hitBase(target, x, z, damage);
                MobAudio.play(damage > 1 ? 'bigHit' : 'baseHit', 0.9 + Math.random() * 0.2);
                this.kick(damage > 1 ? SHAKE.bigHit : SHAKE.baseHit);
            },
            pad: (p) => this.arena.padFed(p),
            vanish: (x, z, team) => {
                // A puff for some of them (the crowd clearing out reads without a cloud over everything).
                if (Math.random() < 0.35) this.arena.puffAt(x, z, team === BLUE ? COLORS.blue : COLORS.red);
            },
            pushCleared: (b) => {
                this.arena.clearPush(b);
                MobAudio.play('bigHit', 1.2);
                const block = this.battle.pushBlocks[b];
                this.popAt('OPEN!', block.x, 1.8, block.nowZ, 0x9fd8ff, 44);
            },
            blockHit: (b, _hp, x, z) => {
                this.arena.hitBlock(b, x, z);
                MobAudio.play('baseHit', 1.3 + Math.random() * 0.2);
            },
            blockBroken: (b) => {
                this.arena.breakBlock(b);
                MobAudio.play('bigHit', 1.1);
                const block = this.battle.blocks[b];
                this.popAt('BROKEN!', block.centreX, 1.8, block.centreZ, 0xffd08a, 40);
            },
            giant: (team, x, z, kind) => {
                if (team === BLUE && !this.pinned.config) MobEvents.unitMade(kind < 0 ? 'ufo' : kind === TRUCK ? 'truck' : kind === CAR ? 'car' : 'giant');
                this.arena.giant(x, z, kind < 0 ? 0xffd23f : team === BLUE ? COLORS.blue : COLORS.red);
                MobAudio.play('giant', team === BLUE ? 1 : 0.8);
                this.kick(SHAKE.giant);
                const word = kind < 0 ? 'UFO!' : kind === TRUCK ? 'TRUCK!' : kind === CAR ? 'CAR!' : team === BLUE ? 'GIANT!' : 'RED GIANT!';
                this.popAt(word, x, 2.5, z, kind < 0 ? 0xffd23f : team === BLUE ? 0x9fd8ff : 0xff6b7a, 46);
            },
            helmet: (x, z) => this.arena.helmetOn(x, z),
            suck: (x, z) => {
                this.arena.suck(x, z);
                if (Math.random() < 0.4) MobAudio.play('whoosh', 1.4 + Math.random() * 0.3);
            },
            saucerHit: (_target, x, z) => {
                this.arena.saucerCrash(x, z);
                MobAudio.play('explosion', 1);
                this.kick(SHAKE.bigHit);
                this.popAt('BOOM!', x, 3.5, z, 0xffd23f, 52);
            },
            targetDown: (target) => {
                const last = this.battle.targets.every((other) => !other.alive);
                this.arena.destroyTarget(target, last);
                if (!last) {
                    MobAudio.play('bigHit', 0.9);
                    const fort = this.battle.targets[target];
                    this.popAt('DESTROYED!', fort.x, 3, fort.z, 0xffd23f, 42);
                }
            },
            won: () => this.finish(true),
            lost: () => this.finish(false),
        });
        this.applyUpgrades();
        // Fires only while the player holds (a press starts the battle and fires; letting go stops).
        this.battle.firing = false;
        // The field after the battle: its forts are the battle's targets (the events above only fire once it runs).
        this.arena = new Arena(config, this.battle.targets, theme);
        this.arena.onLayout = () => this.resize();
        this.threeScene.add(this.arena.group);
        this.time = 0;
        this.state = 'waiting';
        this.hud.hideEnd();
        this.hud.setTitle(index + 1, config.name);
        this.hud.reset();
        this.hud.setBaseHp(this.battle.baseHp, this.battle.baseHpMax);
        this.hud.setCoins(MobSave.coins);
    }

    private begin(): void {
        if (this.state !== 'waiting') return;
        this.state = 'playing';
        this.hud.start();
        this.setGameplay(true);
        // Analytics: not for a level pinned by the URL or the editor (that isn't the player's progress).
        if (!this.pinned.config) {
            const number = MobSave.battle + 1;
            const info = battleInfo(MobSave.battle);
            MobEvents.levelStart(number, info.id, { id: info.zone, first: info.firstInZone }, MobSave.best);
            MobSave.reach(number);
        }
    }

    private finish(won: boolean): void {
        if (this.state === 'over') return;
        this.state = 'over';
        this.setGameplay(false);
        const config = this.battle.config;
        if (!this.pinned.config) {
            const number = MobSave.battle + 1;
            const info = battleInfo(MobSave.battle);
            if (won) MobEvents.levelComplete(number, info.id, this.battle.time, { id: info.zone, last: info.lastInZone }, info.lastOfAll);
            else MobEvents.levelFail(number, info.id, 1 - this.battle.baseHp / Math.max(1, this.battle.baseHpMax));
        }
        this.lastWon = won;
        const coinsBefore = MobSave.coins;
        if (won) {
            MobSave.addCoins(config.reward);
            MobSave.nextBattle();
            // The last target blows apart (Battle's targetDown) in slow motion, confetti over the field.
            this.kick(SHAKE.won);
            MobAudio.play('explosion');
            Game.timeScale = SLOW_MOTION.scale;
            const speed = { scale: SLOW_MOTION.scale };
            gsap.to(speed, { scale: 1, duration: SLOW_MOTION.seconds, ease: 'power2.in', onUpdate: () => { Game.timeScale = speed.scale; } });
            gsap.delayedCall(0.5, () => {
                if (this.torndown) return;
                this.arena.confetti();
                MobAudio.play('win');
                MobAudio.play('applause');
            });
        } else {
            this.hud.flashRed();
            this.kick(SHAKE.lost);
            MobAudio.play('lose');
        }
        const card = () => {
            if (this.torndown) return;
            this.hud.showEnd({ won, reward: config.reward, upgrades: this.upgradeViews(), coins: MobSave.coins });
            if (won) this.hud.flyCoins(coinsBefore, MobSave.coins, () => MobAudio.play('coins', 0.9 + Math.random() * 0.3));
            else this.hud.setCoins(MobSave.coins);
        };
        gsap.delayedCall(won ? WON_CARD_DELAY : LOST_CARD_DELAY, card);
    }

    private nextBattle(): void {
        MobAudio.play('whoosh');
        if (!this.lastWon && !this.pinned.config) MobEvents.levelRetry(MobSave.battle + 1);
        this.startBattle();
    }

    private buyUpgrade(kind: UpgradeKind): void {
        if (!MobSave.buy(kind)) return;
        MobAudio.play('coins');
        MobEvents.upgradeBought(kind, MobSave.level(kind));
        this.applyUpgrades();
        this.hud.setCoins(MobSave.coins);
        this.hud.refreshUpgrade({ upgrades: this.upgradeViews(), coins: MobSave.coins });
    }

    /** The save's upgrade levels onto the battle's cannon. */
    private applyUpgrades(): void {
        this.battle.fireLevel = MobSave.level('fire');
        this.battle.capacityLevel = MobSave.level('capacity');
        this.battle.rechargeLevel = MobSave.level('recharge');
    }

    private upgradeViews(): UpgradeView[] {
        return (Object.keys(UPGRADES) as UpgradeKind[]).map((kind) => ({ kind, level: MobSave.level(kind), cost: MobSave.cost(kind) }));
    }

    private setGameplay(on: boolean): void {
        if (on === this.gameplayOn) return;
        this.gameplayOn = on;
        MobEvents.playing(on);
    }

    // ------------------------------------------------------------------ input

    /** The cannon follows the finger: the point on the cannon's row under its x. */
    private aimAt(screenX: number): void {
        const cannonRow = this.worldToScreen(new THREE.Vector3(0, 0, 0.35));
        const point = this.screenToGround(screenX, cannonRow?.y ?? window.innerHeight * 0.85);
        if (!point) return;
        this.battle.aimX = Math.max(-ARENA.cannonRange, Math.min(ARENA.cannonRange, point.x));
    }

    private readonly onPlatformPause = (): void => MobEvents.paused(true);
    private readonly onPlatformResume = (): void => MobEvents.paused(false);

    /** The editor's live preview: a level (and theme) to show now. */
    private readonly onEditorMessage = (event: MessageEvent): void => {
        const data = event.data as { type?: string; level?: BattleConfig; theme?: string; themeData?: ThemeFile } | null;
        if (!data || data.type !== 'mob-level' || !data.level) return;
        // themeData: a theme being edited (not saved yet), drawn as it is.
        this.pinned = { config: data.level, theme: data.theme, themeData: data.themeData };
        this.startBattle();
    };

    private readonly onPointerDown = (event: PointerEvent): void => {
        MobAudio.unlock();
        // A press on the mute button isn't a press on the field (no start, no firing).
        if (this.hud.onButton(event.clientX, event.clientY)) return;
        if (this.state === 'over') return;
        this.dragging = true;
        this.battle.firing = true;
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
        this.battle.firing = false;
    };

    // ------------------------------------------------------------------ frame

    public override fixedUpdate(delta: number): void {
        if (this.state === 'waiting') return;
        this.battle.step(delta);
    }

    public override update(delta: number): void {
        const dt = Math.min(delta, 1 / 20);
        MobEvents.tick(dt);
        this.time += dt;
        this.crowd.update(this.battle, this.time);
        this.arena.update(this.battle, dt);
        this.hud.setBaseHp(this.battle.baseHp, this.battle.baseHpMax);
        this.hud.setEnergy(this.battle.energy < 0 ? 1 : this.battle.energy / this.battle.energyMax, this.battle.overheated);
        this.hud.update(dt, this.state === 'playing' ? this.battle.danger : 0);
        this.popGates(dt);
        this.labelGiants();
        // The shake: round the framed position, dying away (in real time, so slow motion doesn't drag it out).
        const real = Math.min(1 / 20, Game.timeScale > 0 ? delta / Game.timeScale : delta);
        this.shake = Math.max(0, this.shake - real * 1.8);
        const amount = this.shake * this.shake;
        this.threeCamera.position.set(
            this.cameraBase.x + (Math.random() - 0.5) * amount,
            this.cameraBase.y + (Math.random() - 0.5) * amount,
            this.cameraBase.z + (Math.random() - 0.5) * amount * 0.5,
        );
        super.update(delta);
    }

    /** Shakes the camera (strengths add up, to a limit). */
    private kick(strength: number): void {
        const amount = strength * SHAKE_LEVEL.value;
        if (amount <= 0) return;
        this.shake = Math.min(0.7, Math.sqrt(this.shake * this.shake + amount));
    }

    /** A word popping up over a point of the field. */
    private popAt(value: string, x: number, y: number, z: number, color: number, size = 40): void {
        const at = this.worldToScreen(this.projected.set(x, y, z));
        if (at) this.hud.pop(value, at.x, at.y, color, size);
    }

    /** Each giant's hits left, over its head. */
    private labelGiants(): void {
        const labels: { x: number; y: number; hp: number; blue: boolean }[] = [];
        const height = TUNING.mobHeight * TUNING.giantScale + 0.5;
        for (let i = 0; i < this.battle.count && labels.length < 12; i++) {
            // Giants and trucks show their hits; a car can't be destroyed (no number).
            if (!this.battle.big[i] || this.battle.big[i] === CAR) continue;
            const at = this.worldToScreen(this.projected.set(this.battle.x[i], height, this.battle.z[i]));
            if (at) labels.push({ x: at.x, y: at.y, hp: Math.ceil(this.battle.hp[i]), blue: this.battle.team[i] === BLUE });
        }
        this.hud.setGiantLabels(labels);
    }

    /** Each gate's "+N", once its copies have gathered for a moment. */
    private popGates(dt: number): void {
        this.battle.gates.forEach((gate, g) => {
            this.gatePopIn[g] -= dt;
            if (this.gateTally[g] <= 0 || this.gatePopIn[g] > 0) return;
            this.popAt(`+${this.gateTally[g]}`, gate.nowX, 1.6, gate.z, 0x9fe6ff, 34);
            this.gateTally[g] = 0;
            this.gatePopIn[g] = GATE_POP_SECONDS;
        });
    }

    /** The camera, framed as CAMERA says (see there). */
    /**
     * The camera: at CAMERA's pitch, the cannon pinned near the bottom of the screen (CANNON_PIN of its height), as far
     * back as it needs to be for the field's width (9:16 or narrower: further) and for every fort's top — its number
     * included — to sit just under the HUD. So tall forts zoom out rather than push the cannon off the screen.
     */
    public override resize(): void {
        const camera = this.threeCamera;
        camera.fov = CAMERA.fov;
        camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
        camera.near = 0.5;
        camera.far = 250;
        camera.updateProjectionMatrix();
        updateBend(BEND.origin, BEND.strength);
        this.hud.layout();
        const hudBottom = this.hud.topBottom() + HUD_CLEARANCE;
        const tops = this.arena?.fortTops() ?? [new THREE.Vector3(0, FORT_TOP_Y, ARENA.baseZ - FORT_BACK)];
        const base = CAMERA.distance * Math.max(1, REFERENCE_ASPECT / camera.aspect);
        for (let back = 1; back < 2.2; back += 0.03) {
            this.frame(base * back);
            const highest = Math.min(...tops.map((top) => this.worldToScreen(top)?.y ?? -Infinity));
            if (highest >= hudBottom) break;
        }
        this.cameraBase.copy(camera.position);
    }

    /** The camera `distance` back at the pitch, then slid up or down (its own up) so the cannon sits at CANNON_PIN. */
    private frame(distance: number): void {
        const camera = this.threeCamera;
        const pitch = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
        camera.position.set(0, Math.sin(pitch), Math.cos(pitch)).multiplyScalar(distance).add(CAMERA_TARGET);
        camera.lookAt(CAMERA_TARGET);
        camera.updateMatrixWorld(true);
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        camera.position.addScaledVector(right, CAMERA.offsetX);
        camera.updateMatrixWorld(true);
        const cannon = new THREE.Vector3(0, 0, CANNON_FRONT_Z);
        const pinned = window.innerHeight * CANNON_PIN + CAMERA.offsetY * 10;
        const forward = camera.getWorldDirection(new THREE.Vector3());
        for (let pass = 0; pass < 4; pass++) {
            const at = this.worldToScreen(cannon);
            if (!at || Math.abs(at.y - pinned) < 0.5) break;
            const depth = cannon.clone().sub(camera.position).dot(forward);
            const worldPerPixel = (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / window.innerHeight;
            // Camera up: the field moves down the screen.
            camera.position.addScaledVector(up, (pinned - at.y) * worldPerPixel);
            camera.updateMatrixWorld(true);
        }
    }

    // ------------------------------------------------------------------ debug

    private buildDebug(): void {
        const panel = DebugOverlay.instance.panel('Mob', { id: DEBUG_PANEL });
        panel.monitor('Mobs', () => `${this.battle.count} (peak ${this.battle.peak})`);
        panel.monitor('Battle', () => `${MobSave.battle + 1} · ${this.battle.time.toFixed(1)}s`);
        panel.buttons([
            { label: 'WIN', action: () => this.battle.destroyAll() },
            { label: 'LOSE', variant: 'danger', action: () => { this.battle.state = 'lost'; this.finish(false); } },
            { label: 'RESTART', action: () => this.startBattle() },
            {
                label: 'RESET',
                variant: 'danger',
                action: () => {
                    // Back to a new player: no coins, no upgrades, battle 1.
                    MobSave.reset();
                    this.pinned.config = undefined;
                    this.startBattle();
                },
            },
            { label: 'GIANT', action: () => this.battle.debugSpawn('giant') },
            { label: 'TRUCK', action: () => this.battle.debugSpawn('truck') },
            { label: 'UFO', action: () => this.battle.debugSpawn('saucer') },
            { label: 'CAR', action: () => this.battle.debugSpawn('car') },
        ]);
        const levels = { level: MobSave.battle % PLAY.length };
        const choices = Object.fromEntries(PLAY.map((entry, i) => [`${i + 1}. ${entry.zone.name} · ${entry.config.name} (${entry.config.kind})`, i]));
        panel.select(levels, 'level', choices, {
            label: 'Level',
            persist: false,
            onChange: (index: number) => {
                MobSave.setBattle(index);
                this.pinned.config = undefined;
                this.startBattle();
            },
        });
        const looks = { theme: this.pinned.theme ?? '' };
        panel.select(looks, 'theme', { "Zone's own": '', ...Object.fromEntries(Object.values(THEMES).map((theme) => [theme.name, theme.id])) }, {
            label: 'Theme',
            persist: false,
            onChange: (id: string) => {
                this.pinned.theme = id || undefined;
                this.startBattle();
            },
        });
        panel.buttons([
            { label: '+500 coins', action: () => { MobSave.addCoins(500); this.hud.setCoins(MobSave.coins); } },
        ]);
        const camera = panel.folder('Camera');
        const apply = () => this.resize();
        camera.slider(CAMERA, 'pitchDeg', 25, 89, 1, 'Pitch (deg)').onChange(apply);
        camera.slider(CAMERA, 'distance', 10, 80, 0.5, 'Distance').onChange(apply);
        camera.slider(CAMERA, 'offsetY', -15, 15, 0.1, 'Offset up / down').onChange(apply);
        camera.slider(CAMERA, 'offsetX', -10, 10, 0.1, 'Offset left / right').onChange(apply);
        camera.slider(CAMERA, 'fov', 20, 80, 1, 'Field of view').onChange(apply);
        camera.slider(BEND, 'strength', 0, 0.012, 0.0001, 'Bend').onChange(apply);
        camera.slider(SHAKE_LEVEL, 'value', 0, 2, 0.05, 'Camera shake');
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
        tuning.slider(TUNING, 'blueGiantHp', 5, 150, 1, 'Blue giant hits');
        tuning.slider(TUNING, 'redGiantHp', 5, 200, 1, 'Red giant hits');
        panel.monitor('Giants', () => {
            const s = this.battle.giantStats;
            return `blue ${s.blue} (${s.blue ? (s.blueKills / s.blue).toFixed(0) : 0} kills each) · red ${s.red} (${s.red ? (s.redKills / s.red).toFixed(0) : 0} each)`;
        });
        tuning.slider(TUNING, 'giantScale', 1.2, 4, 0.05, 'Giant size');
        tuning.slider(TUNING, 'shove', 0, 20, 0.5, 'Spinner / pusher shove');
    }

    public override destroy(): void {
        this.torndown = true;
        this.setGameplay(false);
        window.removeEventListener('message', this.onEditorMessage);
        PlatformHandler.instance.onPause.remove(this.onPlatformPause);
        PlatformHandler.instance.onResume.remove(this.onPlatformResume);
        window.removeEventListener('pointerdown', this.onPointerDown);
        window.removeEventListener('pointermove', this.onPointerMove);
        window.removeEventListener('pointerup', this.onPointerUp);
        window.removeEventListener('pointercancel', this.onPointerUp);
        DebugOverlay.instance.removePanel(DEBUG_PANEL);
        Game.timeScale = 1;
        this.arena.dispose();
        super.destroy();
    }
}
