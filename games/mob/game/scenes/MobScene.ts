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
//
// An arena match (the fake multiplayer: game/data/ArenaConfig) is played here too: the arena's mirrored field, the
// opponent's cannon at the far end played by a robot (DuelRobot) the arena ladder picks (ArenaLadder: its skill, cards
// and cannon from the player's rating, their streak and what they have), the clock and both sides' life (DuelHud).
// ?arena=<id> plays one (the editor's Arena tab: with ?ai=<skill> to pick the opponent's hands, ?rating=<n> to meet that
// rating's opponent, ?watch=<skill> to have a robot play the player's side; those test matches aren't counted).

import * as THREE from 'three';
import gsap from 'gsap';
import * as PIXI from 'pixi.js';
import { Game } from 'core/Game';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { ThreeScene } from 'core/scene/ThreeScene';
import { ARENA, COLORS, TUNING, UNIT_COLORS } from '../data/MobConfig';
import { LEVELS_BY_ID, PLAY, areaProgress, battleConfig, battleInfo, battleZone } from '../data/MobLevels';
import { MobEvents } from '../data/MobEvents';
import { THEMES, ThemeFile, parseTheme, themeById } from '../data/Themes';
import { BattleConfig, FIELD, UPGRADES, UpgradeKind, easedConfig, useField } from '../data/MobConfig';
import { UpgradeView } from '../ui/MobHud';
import { MobAudio } from '../audio/MobAudio';
import { BLUE, CAR, TRUCK } from '../battle/Battle';
import { MobSave } from '../data/MobSave';
import { Battle } from '../battle/Battle';
import { CrowdView } from '../battle/CrowdView';
import { Arena } from '../battle/Arena';
import { MobHud } from '../ui/MobHud';
import { applyBend, bendDrop, updateBend } from '../services/Bend';
import { CARD_KINDS, CardKind, SETTINGS, cardStat } from '../data/Settings';
import { ArenaConfig, arenaBattle } from '../data/ArenaConfig';
import { ARENAS_BY_ID, arenaFor } from '../data/Arenas';
import { Ladder, Opponent, SkillId, opponentFor, tierBadge, tierFor } from '../data/ArenaLadder';
import ladderFile from '../../ui/arena-ladder.json';
import { DuelRobot } from '../sim/DuelRobot';
import { SKILLS } from '../sim/Grading';
import { BuildingBar, DuelEnd, DuelHud } from '../ui/DuelHud';
import { CharacterView } from '../battle/CharacterView';
import { HAND } from '../ui/CardTray';
import { CARD_NAMES } from '../ui/CardFace';
import { CHARACTER_CARDS } from '../battle/Battle';
import { RadialTransition } from '../ui/RadialTransition';
import { AVATARS } from '../data/Profile';
import { MatchPlayer } from '../ui/Matchmaking';
import { RED, Target } from '../battle/Battle';
import { matchOver, storyWon } from '../data/Ranking';

const MODEL_BASE = './mob/models/mob/';
/** A new player's first counted versus matches (how many), made easy: the opponent's fire rate and buildings' hits, shares. */
const EASY_MATCHES = { count: 3, fire: 0.35, buildings: 0.55 };
/** The debug panel's FAST CARDS: the cards charge this many times as fast. */
const DEBUG_CARD_PACE = 4;

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
const CAMERA = { pitchDeg: SETTINGS.camera?.pitchDeg ?? 50, yawDeg: SETTINGS.camera?.yawDeg ?? 0, fov: SETTINGS.camera?.fov ?? 46, distance: 15, offsetX: 0, offsetY: 6 };
/** What the camera looks at: this share of the way up the field (-12.5 on the default 24), set per field in resize(). */
const CAMERA_TARGET = new THREE.Vector3(0, 0, -12.5);
const TARGET_SHARE = 12.5 / FIELD.length;
/** How much further back the camera may go than its usual distance, to fit the forts' tops and a bigger field's sides. */
const MOST_BACK = 4;
/** How far (px) inside the safe area (the design resolution, as it fits the screen) the field's corners are kept. */
const SAFE_MARGIN = 4;
/** Debug: a pink spear on each corner the camera keeps in the safe area (tip down on the point), and the safe area
 *  outlined in pink over everything. */
const SHOW_FRAMING = false;
const FRAMING_PINK = 0xff3dc8;
const REFERENCE_ASPECT = 9 / 16;
/** The forts' roof line and how far behind the base line their back is (Arena's BASE), and the gap kept under the HUD (px). */
const FORT_TOP_Y = 2.9;
const FORT_BACK = 2.6;
const HUD_CLEARANCE = 10;
/** An arena match: the room kept over the far buildings for their life bars (px). */
const DUEL_BAR_ROOM = 64;
/** The cannon's front edge (z) and the room kept under it at the bottom of the screen (px). */
const CANNON_FRONT_Z = 1.2;
/** Where the cannon's front sits on the screen (a share of its height from the top; under it, the energy bar). CAMERA.offsetY nudges it (10 px a unit). */
const CANNON_PIN = 0.78;
/** How high over a truck its hits show (world units: over its roof). */
const TRUCK_LABEL_HEIGHT = 2.4;
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
/** An arena match's end: the beaten side's cannon blows up in slow motion, then (this long after) the end card. */
const DUEL_END = { card: 2 };
/** A gate's "+N" pop-up gathers its copies over this long (seconds), so a stream doesn't pop every frame. */
const GATE_POP_SECONDS = 0.35;
const LADDER = ladderFile as Ladder;
/** How an arena match was started from the main screen: online (against a "player": `opponent`, counted) or practice
 *  (against the bot, shown as one; not counted). */
export interface MatchStart { online: boolean; opponent?: MatchPlayer }
/** An arena match's countdown before it starts (seconds: 3, 2, 1, then GO). */
const COUNTDOWN = 3;
/** An arena match to play instead of the levels: the arena (by id or as sent), and what the test pins (see the top). */
interface DuelSpec {
    arena: ArenaConfig;
    ai?: SkillId;
    rating?: number;
    watch?: SkillId;
    /** Counted on the player's arena record (not a test, not practice). */
    counted: boolean;
    /** Online: the opponent shown as a player (their name); else a bot. */
    opponent?: MatchPlayer;
}

export default class MobScene extends ThreeScene {
    /** Resolves once the crowd's model is loaded and baked (the loading screen waits for it). */
    public readonly ready: Promise<void>;
    private readonly crowd = new CrowdView();
    /** The debug panel's switches. */
    private readonly debugFlags = { fastCards: false };
    /** The card units with characters of their own (skeletons...): loaded only when a battle's cards can make them. */
    private readonly characters = new CharacterView();
    /** The characters this battle's cards need, loaded (the transition waits for it). */
    private charactersReady: Promise<void> = Promise.resolve();
    private readonly hud: MobHud;
    /** Debug (SHOW_FRAMING): the corner spears and the safe area's outline. */
    private readonly framingSpears = new THREE.Group();
    private readonly safeFrame = new PIXI.Graphics();
    private battle!: Battle;
    private arena!: Arena;
    private state: 'waiting' | 'playing' | 'over' = 'waiting';
    /** The player's unit cards this battle, and how charged each is (0..1: full, its unit comes out of the cannon). */
    private cards: { kind: CardKind; charge: number }[] = [];
    /** The first-card tutorial's on (the battle paused till the player taps that card): its card. */
    private cardTutorial: CardKind | null = null;
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
    /** An arena match to play (the URL, the editor, the debug panel), and the one on: its robots and opponent. */
    private duelSpec: DuelSpec | null = QUERY.get('arena') && ARENAS_BY_ID[QUERY.get('arena')!] ? {
        arena: ARENAS_BY_ID[QUERY.get('arena')!],
        ai: (QUERY.get('ai') as SkillId) || undefined,
        rating: QUERY.get('rating') ? Number(QUERY.get('rating')) : undefined,
        watch: (QUERY.get('watch') as SkillId) || undefined,
        counted: false,
    } : null;
    private duel: { robot: DuelRobot; watch: DuelRobot | null; opponent: Opponent; spec: DuelSpec } | null = null;
    /** An arena match's countdown left (seconds): it starts by itself at the end (no tap). */
    private countdown = 0;
    private readonly duelHud: DuelHud;

    /** `onHome`: the end card's HOME (the main screen). */
    /** `arena`: an arena's id, a counted match there (the main screen's ARENA) instead of the story's level. */
    public constructor(game: Game, private readonly onHome: () => void = () => undefined, arena?: string, match?: MatchStart) {
        super(game);
        // From the main screen: online counts (trophies, crowns, quests), practice doesn't.
        if (arena && ARENAS_BY_ID[arena]) this.duelSpec = { arena: ARENAS_BY_ID[arena], counted: !!match?.online, opponent: match?.opponent };
        this.threeScene.background = new THREE.Color(0x8fd8ff);
        updateBend(BEND.origin, BEND.strength);
        this.threeScene.add(new THREE.HemisphereLight(0xffffff, 0x6b8f4a, LIGHT.sky));
        const sun = new THREE.DirectionalLight(0xffffff, LIGHT.sun);
        sun.position.set(6, 14, 8);
        this.threeScene.add(sun);
        this.threeScene.add(this.crowd.group, this.characters.group);

        this.hud = new MobHud(() => this.nextBattle(), (kind) => this.buyUpgrade(kind), () => this.onHome(), (kind) => this.playCard(kind));
        this.hud.setGiveUp(false, () => this.surrender());
        this.addChild(this.hud);
        this.duelHud = new DuelHud(() => this.nextBattle(), () => this.onHome());
        this.duelHud.visible = false;
        this.addChild(this.duelHud);
        if (SHOW_FRAMING) {
            // The scene is laid out in the design resolution: its 0,0 .. DESIGN_WIDTH x DESIGN_HEIGHT is the safe area.
            this.safeFrame.lineStyle(4, FRAMING_PINK).drawRect(0, 0, Game.DESIGN_WIDTH, Game.DESIGN_HEIGHT);
            this.addChild(this.safeFrame);
            this.threeScene.add(this.framingSpears);
        }
        const crowd = this.crowd.load(MODEL_BASE, TUNING.maxMobs + 64);
        this.startBattle();
        this.ready = Promise.all([crowd, this.charactersReady]).then(() => undefined);
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
        MobAudio.music('battle');
        const index = MobSave.selected;
        const spec = this.duelSpec;
        // A level lost before comes back easier (MobSave.ease); a pinned one (the URL, the editor) is played as it is.
        // An arena match: its mirrored field, in its theme (the beach unless it says).
        const config = spec ? arenaBattle(spec.arena) : this.pinned.config ?? easedConfig(battleConfig(index), MobSave.ease);
        const theme = this.pinned.themeData ? parseTheme(this.pinned.themeData) : themeById(spec ? spec.arena.theme ?? this.pinned.theme ?? 'beach' : this.pinned.theme ?? battleZone(index).theme);
        (this.threeScene.background as THREE.Color).setHex(theme.sky);
        if (this.arena) {
            this.threeScene.remove(this.arena.group);
            this.arena.dispose();
        }
        this.gateTally = config.gates.map(() => 0);
        this.gatePopIn = config.gates.map(() => 0);
        // The level's field size, before anything is built on it (Battle and Arena read ARENA).
        useField(config);
        this.battle = new Battle(config, {
            fire: () => {
                this.arena.fired();
                MobAudio.play('shot', 0.9 + Math.random() * 0.2);
            },
            // An arena match: the opponent's cannon, the player's buildings hit and falling, the time up level.
            redFire: () => {
                this.arena.redFired();
                if (Math.random() < 0.5) MobAudio.play('shot', 0.7 + Math.random() * 0.15);
            },
            ownHit: (x, z, _hp, damage, target, special) => {
                this.arena.hitOwn(target, x, z, damage);
                MobAudio.play(damage > 1 ? 'bigHit' : 'baseHit', 0.8 + Math.random() * 0.15);
                if (special) this.kick(SHAKE.bigHit);
            },
            ownDown: (target) => {
                const own = this.battle.blueTargets[target];
                // The cannon: the match lost (finishDuel blows it up).
                if (own.kind === 'cannon') return;
                this.arena.destroyOwn(target);
                MobAudio.play('explosion', 0.8);
                this.popAt('LOST!', own.x, 3, own.z, 0xff8a96, 42);
            },
            draw: () => this.finishDuel('draw'),
            // A side's towers all down: its cannon's open now (plainly the target).
            exposed: (team) => {
                const blue = team === BLUE;
                const x = blue ? this.battle.cannonX : this.battle.red.cannonX;
                const z = blue ? 0.35 + this.battle.cannonZ : ARENA.baseZ - 0.35 - this.battle.cannonZ;
                MobAudio.play('bigHit', 0.7);
                this.popAt(blue ? 'DEFEND THE CANNON!' : 'CANNON OPEN!', x, 2.6, z, blue ? 0xff8a96 : 0xffd23f, 46);
                // On its cannon: it fires faster from now on (the comeback), by itself.
                gsap.delayedCall(0.6, () => {
                    if (this.state !== 'playing') return;
                    MobAudio.play('confirm', blue ? 1.2 : 0.9);
                    this.popAt('SPEED UP!', x, 2.0, z, blue ? 0x9fe6ff : 0xff8a96, 40);
                });
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
            baseHit: (x, z, _hp, damage, target, special) => {
                this.arena.hitBase(target, x, z, damage);
                MobAudio.play(damage > 1 ? 'bigHit' : 'baseHit', 0.9 + Math.random() * 0.2);
                // Only the sparse special units shake it: helmeted mobs hit hard too, but they come in swarms.
                this.kick(special ? SHAKE.bigHit : SHAKE.baseHit);
            },
            pad: (p) => this.arena.padFed(p),
            vanish: (x, z, team) => {
                // A puff for some of them (the crowd clearing out reads without a cloud over everything).
                if (Math.random() < 0.35) this.arena.puffAt(x, z, team === BLUE ? COLORS.blue : COLORS.red);
            },
            pushCleared: (b) => {
                this.arena.clearPush(b);
                MobAudio.play('crumble', 0.9);
                const block = this.battle.pushBlocks[b];
                this.popAt('OPEN!', block.x, 1.8, block.nowZ, 0x9fd8ff, 44);
            },
            blockHit: (b, _hp, x, z) => {
                const gate = this.battle.blocks[b].gate;
                if (gate !== undefined) this.arena.hitLock(gate, x, z);
                else this.arena.hitBlock(b, x, z);
                MobAudio.play('blockHit', 0.9 + Math.random() * 0.25);
            },
            ground: (x, z, team, big) => {
                this.arena.ground(x, z, team === BLUE ? COLORS.blue : COLORS.red, big);
                if (big || Math.random() < 0.3) MobAudio.play('clash', big ? 0.6 : 0.7 + Math.random() * 0.3);
                if (big) this.kick(SHAKE.bigHit);
            },
            pipeIn: (p, end, team) => this.arena.pipeMouth(this.battle.pipes[p], end, team),
            pipeOut: (p, end, team) => this.arena.pipeMouth(this.battle.pipes[p], end, team),
            gateUnlocked: (g) => {
                this.arena.unlockGate(g);
                MobAudio.play('bigHit', 1.3);
                const gate = this.battle.gates[g];
                this.popAt('UNLOCKED!', gate.nowX, 1.8, gate.z, 0x9fe6ff, 40);
            },
            blockBroken: (b) => {
                this.arena.breakBlock(b);
                MobAudio.play('crumble', 1);
                const block = this.battle.blocks[b];
                this.popAt('BROKEN!', block.centreX, 1.8, block.centreZ, 0xffd08a, 40);
            },
            giant: (team, x, z, kind, card) => {
                if (team === BLUE && !this.pinned.config) MobEvents.unitMade(card ?? (kind < 0 ? 'ufo' : kind === TRUCK ? 'truck' : kind === CAR ? 'car' : 'giant'));
                this.arena.giant(x, z, kind < 0 ? 0xffd23f : team === BLUE ? COLORS.blue : COLORS.red);
                MobAudio.play('giant', team === BLUE ? 1 : 0.8);
                this.kick(SHAKE.giant);
                const word = card ? `${CARD_NAMES[card]}!` : kind < 0 ? 'UFO!' : kind === TRUCK ? 'TRUCK!' : kind === CAR ? 'RAMMER!' : team === BLUE ? 'GIANT!' : 'RED GIANT!';
                this.popAt(word, x, 2.5, z, kind < 0 ? 0xffd23f : team === BLUE ? 0x9fd8ff : 0xff6b7a, 46);
            },
            explode: (team, x, z, radius) => {
                this.arena.blast(x, z, radius);
                this.arena.shockwave(x, z, radius, team === BLUE ? 0xffb347 : 0xff6b4a);
                MobAudio.play('explosion', 0.9);
                this.kick(SHAKE.bigHit * 1.6);
                this.popAt('BOOM!', x, 2.6, z, 0xffd23f, 50);
            },
            shockwave: (team, x, z, radius) => {
                this.arena.shockwave(x, z, radius, team === BLUE ? COLORS.blue : COLORS.red);
                MobAudio.play('bigHit', 0.7);
            },
            knocked: (x, z, team) => {
                if (Math.random() < 0.5) this.arena.clash(x, z, false);
                else this.arena.puffAt(x, z, team === BLUE ? COLORS.blue : COLORS.red);
            },
            king: (x, z) => {
                this.arena.giant(x, z, COLORS.red);
                MobAudio.play('giant', 0.65);
                this.kick(SHAKE.giant * 1.6);
                this.popAt('GIANT KING!', x, 3.2, z, 0xffd23f, 58);
            },
            helmet: (x, z, kind) => this.arena.helmetOn(x, z, kind),
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
                // A match's cannon: the match won (finishDuel blows it up).
                if (this.duel && this.battle.targets[target].kind === 'cannon') return;
                const last = this.battle.targets.every((other) => !other.alive);
                this.arena.destroyTarget(target, last);
                if (!last) {
                    MobAudio.play('bigHit', 0.9);
                    const fort = this.battle.targets[target];
                    this.popAt('DESTROYED!', fort.x, 3, fort.z, 0xffd23f, 42);
                }
            },
            won: () => (this.duel ? this.finishDuel('won') : this.finish(true)),
            lost: () => (this.duel ? this.finishDuel('lost') : this.finish(false)),
        });
        this.applyUpgrades();
        this.setUpDuel(spec);
        // Fires only while the player holds (a press starts the battle and fires; letting go stops).
        this.battle.firing = false;
        // The field after the battle: its forts are the battle's targets (the events above only fire once it runs).
        // (An arena match's towers are the plain ones: flat colours, no models.)
        this.arena = new Arena(config, this.battle.targets, theme, undefined, !spec && !!battleZone(index).plainForts, undefined, this.battle.blueTargets);
        // Each building's life: the bars over them (DuelHud's), story and arena alike.
        this.arena.hideTargetLabels();
        this.arena.onLayout = () => this.resize();
        this.threeScene.add(this.arena.group);
        if (SHOW_FRAMING) this.placeFramingSpears();
        this.time = 0;
        this.state = 'waiting';
        this.cardTutorial = null;
        this.hud.hideCardTutorial();
        this.hud.hideEnd();
        this.hud.setTitle(index + 1, config.name);
        this.hud.reset();
        this.dealCards(config);
        this.charactersReady = this.characters.need(this.charactersNeeded());
        this.hud.setBaseHp(this.battle.baseHp, this.battle.baseHpMax);
        this.hud.setCoins(MobSave.coins);
        this.resize();
        // Framed again once things have settled (the HUD's words in their font, the scene on the screen at its size):
        // framed only now, the camera could keep a wrong zoom till the window's next resize.
        requestAnimationFrame(() => { if (!this.torndown) this.resize(); });
        gsap.delayedCall(0.35, () => { if (!this.torndown) this.resize(); });
        void document.fonts?.ready.then(() => { if (!this.torndown) this.resize(); });
    }

    /**
     * An arena match's other side (or none: back to the levels' HUD): the opponent the ladder gives (the test's skill or
     * rating over it), its robot on the reds' cannon with its cards and upgrades; a robot on the player's too when
     * watching.
     */
    private setUpDuel(spec: DuelSpec | null): void {
        this.duel = null;
        this.hud.setDuel(!!spec);
        // (The story: just its bars over the buildings.)
        this.duelHud.visible = true;
        this.duelHud.setStory(!spec);
        if (!spec) return;
        const player = MobSave.arenaLoadout();
        const record = spec.rating !== undefined ? { rating: spec.rating, streak: 0 } : MobSave.arena;
        const opponent = opponentFor(LADDER, record, player);
        if (spec.ai) opponent.skill = spec.ai;
        // A new player's first counted matches: the opponent barely fights back (the slowest hands, no cards, a cannon
        // firing a fraction as fast, buildings with fewer hits).
        if (spec.counted && MobSave.arena.played < EASY_MATCHES.count) {
            opponent.skill = 'newbie';
            opponent.cards = {};
            this.battle.redFireScale = EASY_MATCHES.fire;
            for (const target of this.battle.targets) {
                target.hp = target.hpMax = Math.round(target.hpMax * EASY_MATCHES.buildings);
            }
        }
        const red = this.battle.red;
        red.fireLevel = opponent.fire;
        red.capacityLevel = opponent.capacity;
        red.rechargeLevel = opponent.recharge;
        const cardsOf = (cards: Opponent['cards']) => CARD_KINDS.filter((kind) => cards[kind] !== undefined).map((kind) => ({ kind, level: cards[kind]! }));
        const robot = new DuelRobot(this.battle, RED, SKILLS[opponent.skill], cardsOf(opponent.cards));
        const watch = spec.watch ? new DuelRobot(this.battle, BLUE, SKILLS[spec.watch], cardsOf(player.cards)) : null;
        this.duel = { robot, watch, opponent, spec };
        // Online, the opponent's a "player" (their name); practice and tests: the bot, as it is.
        const caption = spec.opponent ? spec.opponent.name.toUpperCase() : `BOT · ${SKILLS[opponent.skill].name.toUpperCase()}`;
        this.duelHud.reset(caption, this.battle.ownHpMax, this.battle.baseHpMax);
        this.countdown = COUNTDOWN + 0.5;
        this.duelHud.setTime(this.battle.timeLeft);
    }

    /** An arena match: a bar over each building standing (a cannon's only once it's open), and the open cannons' rings. */
    private placeBuildingBars(): void {
        const b = this.battle;
        const bars: BuildingBar[] = [];
        // A story level over: no bars (its end card's up, over the field).
        if (!this.duel && this.state === 'over') {
            this.duelHud.setBuildingBars(bars);
            return;
        }
        const add = (target: Target, blue: boolean): void => {
            if (!target.alive) return;
            const cannon = target.kind === 'cannon';
            if (cannon && target.shielded) return;
            const z = cannon ? (blue ? 0.35 + b.cannonZ : ARENA.baseZ - 0.35 - b.cannonZ) : target.z + (blue ? 1.3 : -1.3);
            const at = this.worldToScreen(this.projected.set(cannon ? target.x : target.x, cannon ? 2 : 3.6, z));
            if (at) bars.push({ x: at.x, y: at.y, hp: target.hp, max: target.hpMax, blue, cannon });
        };
        b.targets.forEach((target) => add(target, false));
        b.blueTargets.forEach((target) => add(target, true));
        this.duelHud.setBuildingBars(bars);
        if (!this.duel) return;
        const open = (list: Target[]) => list.some((target) => target.kind === 'cannon' && target.alive && !target.shielded);
        this.arena.showExposed(open(b.blueTargets), open(b.targets));
    }

    /** An arena match is over: the field's last moments, then its result card (a counted one moves the rating). */
    private finishDuel(result: 'won' | 'lost' | 'draw'): void {
        if (this.state === 'over' || !this.duel) return;
        this.state = 'over';
        this.setGameplay(false);
        const spec = this.duel.spec;
        const before = MobSave.arena;
        const after = spec.counted ? MobSave.arenaResult(LADDER, result) : null;
        // The competition: what it destroyed (each enemy tower, their cannon) and a win (a test isn't counted).
        const towers = this.battle.targets.filter((target) => target.kind !== 'cannon' && !target.alive).length;
        const cannon = !this.battle.timedOut && this.battle.targets.some((target) => target.kind === 'cannon' && !target.alive);
        if (spec.counted) matchOver(result === 'won', towers, cannon);
        // The match's crowns, each side: a tower down 1, the cannon down all 3.
        const ownTowers = this.battle.blueTargets.filter((target) => target.kind !== 'cannon' && !target.alive).length;
        const ownCannon = !this.battle.timedOut && this.battle.blueTargets.some((target) => target.kind === 'cannon' && !target.alive);
        const matchCrowns = { you: cannon ? 3 : Math.min(3, towers), them: ownCannon ? 3 : Math.min(3, ownTowers) };
        // A counted win: a chest (opened back on the main screen); all three crowns, the profile's tally.
        let chest: DuelEnd['chest'] = null;
        if (spec.counted && result === 'won') {
            chest = MobSave.winChest();
            if (matchCrowns.you === 3) MobSave.addThreeCrown();
        }
        // The beaten side's cannon blows up (fallen or not: the clock ran out), in slow motion.
        if (result !== 'draw') {
            const list = result === 'won' ? this.battle.targets : this.battle.blueTargets;
            const k = list.findIndex((target) => target.kind === 'cannon');
            if (k >= 0) {
                if (result === 'won') this.arena.destroyTarget(k, true);
                else this.arena.destroyOwn(k, true);
                const at = list[k];
                this.popAt(result === 'won' ? 'DEFEATED!' : 'DESTROYED!', at.x, 3.5, at.z, result === 'won' ? 0xffd23f : 0xff8a96, 56);
                if (this.battle.timedOut) this.popAt('TIME UP!', 0, 4.5, ARENA.baseZ / 2, 0xffffff, 64);
            }
            MobAudio.play('explosion');
            Game.timeScale = SLOW_MOTION.scale;
            const speed = { scale: SLOW_MOTION.scale };
            gsap.to(speed, { scale: 1, duration: SLOW_MOTION.seconds, ease: 'power2.in', onUpdate: () => { Game.timeScale = speed.scale; } });
        }
        if (result === 'won') {
            this.kick(SHAKE.won);
            gsap.delayedCall(0.5, () => {
                if (this.torndown) return;
                this.arena.confetti();
                MobAudio.play('win');
                MobAudio.play('applause');
            });
        } else if (result === 'lost') {
            this.hud.flashRed();
            this.kick(SHAKE.lost);
            MobAudio.play('lose');
        }
        const mine = AVATARS[MobSave.avatar % AVATARS.length];
        const record = after ?? before;
        const you: MatchPlayer = { name: MobSave.username, face: mine.face, color: mine.color, trophies: record.rating, tier: LADDER.tiers[tierFor(LADDER, record)].name, badge: tierBadge(LADDER, tierFor(LADDER, record)) };
        // The opponent: online, the "player" found; practice and tests, the bot.
        const bot = AVATARS[(this.duel.opponent.tierIndex * 3 + 5) % AVATARS.length];
        const them: MatchPlayer = spec.opponent ?? { name: `BOT · ${SKILLS[this.duel.opponent.skill].name.toUpperCase()}`, face: bot.face, color: bot.color, trophies: before.rating, tier: this.duel.opponent.tier.name, badge: tierBadge(LADDER, this.duel.opponent.tierIndex) };
        gsap.delayedCall(result === 'draw' ? LOST_CARD_DELAY : DUEL_END.card, () => {
            if (this.torndown) return;
            this.duelHud.showEnd({
                result, you, them, crowns: matchCrowns, chest,
                rating: after ? { before: before.rating, after: after.rating, tier: LADDER.tiers[tierFor(LADDER, after)].name } : null,
            });
        });
    }

    private begin(): void {
        if (this.state !== 'waiting') return;
        this.state = 'playing';
        this.hud.start();
        this.setGameplay(true);
        // Analytics: not for a level pinned by the URL or the editor (that isn't the player's progress), nor a match.
        if (!this.pinned.config && !this.duel) {
            const number = MobSave.selected + 1;
            const info = battleInfo(MobSave.selected);
            MobEvents.levelStart(number, info.id, { id: info.zone, first: info.firstInZone }, MobSave.best);
            MobSave.reach(number);
        }
    }

    /** GIVE UP's YES: the battle (or the match) lost now. */
    private surrender(): void {
        if (this.state !== 'playing') return;
        this.battle.state = 'lost';
        if (this.duel) this.finishDuel('lost');
        else this.finish(false);
    }

    private finish(won: boolean): void {
        if (this.state === 'over') return;
        this.state = 'over';
        this.setGameplay(false);
        const config = this.battle.config;
        if (!this.pinned.config) {
            const number = MobSave.selected + 1;
            const info = battleInfo(MobSave.selected);
            if (won) MobEvents.levelComplete(number, info.id, this.battle.time, { id: info.zone, last: info.lastInZone }, info.lastOfAll);
            else MobEvents.levelFail(number, info.id, 1 - this.battle.baseHp / Math.max(1, this.battle.baseHpMax));
            if (!won) MobSave.lost();
        }
        this.lastWon = won;
        const coinsBefore = MobSave.coins;
        // A replay (a level already beaten) pays its share of the reward; a loss, the loss's coins.
        const replay = !this.pinned.config && MobSave.selected < MobSave.battle;
        const reward = won ? Math.round(config.reward * (replay ? SETTINGS.replayReward : 1)) : SETTINGS.loseCoins;
        const newCards = won ? this.unlockCards(config) : [];
        // A win: copies of one of the player's cards (their levels: the CARDS tab); fewer on a replay.
        const copies = won && !this.pinned.config ? MobSave.storyCopies(!replay) : null;
        // The area the battle was in, if it was its last (a win opens the next area on the end card).
        const played = MobSave.selected;
        const finished = won && !this.pinned.config && battleInfo(played).lastInZone ? areaProgress(played) : null;
        if (won) {
            MobSave.addCoins(reward);
            MobSave.won(played);
            // The competition's crowns (a level pinned by the URL or the editor isn't the player's).
            if (!this.pinned.config) storyWon();
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
            this.hud.showEnd({
                won, reward, upgrades: this.upgradeViews(), coins: MobSave.coins, newCards, copies,
                homeCall: !this.pinned.config && arenaFor(MobSave.battle + 1, MobSave.bestTrophies).open && !MobSave.arenaTutorial,
                area: areaProgress(MobSave.selected),
                finished: finished ? { zone: finished.zone, number: finished.number, total: finished.total } : null,
            });
            if (MobSave.coins > coinsBefore) this.hud.flyCoins(coinsBefore, MobSave.coins, () => MobAudio.play('coins', 0.9 + Math.random() * 0.3));
            else this.hud.setCoins(MobSave.coins);
        };
        gsap.delayedCall(won ? WON_CARD_DELAY : LOST_CARD_DELAY, card);
    }

    private nextBattle(): void {
        if (this.travelling) return;
        if (!this.lastWon && !this.pinned.config && !this.duel) MobEvents.levelRetry(MobSave.selected + 1);
        // The wipe (no words: it's the same screen, just not a dry cut), the next battle built under it.
        this.travelling = true;
        void RadialTransition.go(this.game, '', '', () => {
            if (this.torndown) return undefined;
            this.startBattle();
            return this.charactersReady;
        }).then(() => {
            this.travelling = false;
        });
    }

    /** A wipe to the next battle under way (a second tap doesn't start another). */
    private travelling = false;

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
        const cannonRow = this.worldToScreen(new THREE.Vector3(0, 0, 0.35 + this.battle.cannonZ));
        const point = this.screenToGround(screenX, cannonRow?.y ?? window.innerHeight * 0.85);
        if (!point) return;
        this.battle.aimX = Math.max(-ARENA.cannonRange, Math.min(ARENA.cannonRange, point.x));
    }

    private readonly onPlatformPause = (): void => MobEvents.paused(true);
    private readonly onPlatformResume = (): void => MobEvents.paused(false);

    /** The editor's live preview: a level (and theme) to show now. */
    private readonly onEditorMessage = (event: MessageEvent): void => {
        const data = event.data as { type?: string; level?: BattleConfig; theme?: string; themeData?: ThemeFile; arena?: ArenaConfig; ai?: SkillId; rating?: number; watch?: SkillId } | null;
        // The Arena tab: a match on the arena as it's being edited (a test: not counted).
        if (data?.type === 'mob-arena' && data.arena) {
            this.duelSpec = { arena: data.arena, ai: data.ai || undefined, rating: data.rating, watch: data.watch || undefined, counted: false };
            this.pinned = { theme: data.theme };
            this.startBattle();
            return;
        }
        if (!data || data.type !== 'mob-level' || !data.level) return;
        this.duelSpec = null;
        // themeData: a theme being edited (not saved yet), drawn as it is.
        this.pinned = { config: data.level, theme: data.theme, themeData: data.themeData };
        this.startBattle();
    };

    private readonly onPointerDown = (event: PointerEvent): void => {
        MobAudio.unlock();
        // A press on the mute button isn't a press on the field (no start, no firing).
        if (this.hud.onButton(event.clientX, event.clientY)) return;
        // The first-card tutorial: only the card goes (the field's paused). A robot playing the player's side (watching a
        // match): a press only starts it.
        if (this.state === 'over' || this.cardTutorial) return;
        if (this.duel?.watch) return;
        this.dragging = true;
        this.aimAt(event.clientX);
        // (A match starts with its countdown, not a press: till then the finger only aims.)
        if (this.duel && this.state === 'waiting') return;
        this.battle.firing = true;
        this.begin();
    };

    private readonly onPointerMove = (event: PointerEvent): void => {
        // Aiming is dragging, for a mouse as for a finger: aiming on a mouse just moving over the field, the cannon
        // followed it down to the cards, and a card's unit always came out under the card, not where it was aimed.
        if (this.state === 'over' || !this.dragging || this.duel?.watch) return;
        this.aimAt(event.clientX);
    };

    private readonly onPointerUp = (): void => {
        this.dragging = false;
        if (!this.duel?.watch) this.battle.firing = false;
    };

    // ------------------------------------------------------------------ frame

    public override fixedUpdate(delta: number): void {
        // Paused for the first-card tutorial.
        if (this.state === 'waiting' || this.cardTutorial) return;
        if (this.duel) {
            this.duel.watch?.step(delta);
            this.duel.robot.step(delta);
        }
        this.battle.step(delta);
    }

    public override update(delta: number): void {
        const dt = Math.min(delta, 1 / 20);
        MobEvents.tick(dt);
        this.time += dt;
        this.crowd.update(this.battle, this.time);
        this.characters.update(this.battle, this.time);
        this.arena.update(this.battle, dt);
        this.hud.setBaseHp(this.battle.baseHp, this.battle.baseHpMax);
        // GIVE UP while a battle's on (not a robot's watched match).
        this.hud.setGiveUp(this.state === 'playing' && !this.duel?.watch);
        if (this.duel && this.state === 'waiting' && this.countdown > 0) {
            const before = Math.ceil(this.countdown - 0.5);
            this.countdown -= dt;
            const now = Math.ceil(this.countdown - 0.5);
            if (now !== before && now > 0) {
                this.duelHud.showCount(String(now));
                MobAudio.play('click', 1 + (COUNTDOWN - now) * 0.1);
            }
            if (this.countdown <= 0) {
                // GO (the battle's own): the player holding already fires.
                this.begin();
                if (this.dragging) this.battle.firing = true;
            }
        }
        if (this.duel) {
            this.duelHud.setLife(this.battle.ownHp, this.battle.ownHpMax, this.battle.baseHp, this.battle.baseHpMax);
            this.duelHud.setTime(this.battle.timeLeft);
            this.duelHud.update(dt);
            this.placeBuildingBars();
        } else {
            // A story level: the bars over its buildings.
            this.duelHud.update(dt);
            this.placeBuildingBars();
        }
        this.hud.setEnergy(this.battle.energy < 0 ? 1 : this.battle.energy / this.battle.energyMax, this.battle.overheated, this.battle.capped);
        // The energy bar rides beside the cannon.
        const cannon = this.worldToScreen(this.projected.set(this.battle.cannonX, 0.6, CANNON_FRONT_Z - 0.6 + this.battle.cannonZ));
        if (cannon) this.hud.placeEnergy(cannon.x, cannon.y);
        this.chargeCards(dt);
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

    /** The characters this battle can make: its cards' (the player's, and an arena opponent's). */
    private charactersNeeded(): number[] {
        const kinds = new Set<CardKind>(this.cards.map((card) => card.kind));
        if (this.duel) for (const kind of Object.keys(this.duel.opponent.cards) as CardKind[]) kinds.add(kind);
        return [...kinds].map((kind) => CHARACTER_CARDS[kind]?.look ?? 0).filter((look) => look > 0);
    }

    /** The battle's cards: the player's battle deck (the CARDS tab's: up to DECK_SIZE; HAND of them in hand, the rest
     *  waiting their turn), none charged. */
    private dealCards(_config: BattleConfig): void {
        const deck = MobSave.deck;
        this.cards = deck.map((kind) => ({ kind, charge: 0 }));
        this.showHand();
    }

    /**
     * A win: each unit with a house in the level gets its card, the first time (the end card reveals it). A level
     * pinned by the URL or the editor gives nothing.
     */
    private unlockCards(config: BattleConfig): CardKind[] {
        if (this.pinned.config) return [];
        const fresh: CardKind[] = [];
        for (const pad of config.pads ?? []) {
            const kind = (pad.kind ?? 'giant') as CardKind;
            if (CARD_KINDS.includes(kind) && !fresh.includes(kind) && MobSave.unlockCard(kind)) fresh.push(kind);
        }
        return fresh;
    }

    /** The hand (the first HAND cards) into the tray, and the rest waiting in its pile. */
    private showHand(): void {
        this.hud.setCards(this.cards.slice(0, HAND).map((card) => card.kind));
        this.hud.setCardPile(this.cards[HAND]?.kind ?? null, Math.max(0, this.cards.length - HAND));
    }

    /** While the battle's on, each card in the hand charges (SETTINGS.cards: its seconds), up to full: then it waits to
     *  be tapped. (The waiting ones don't: each comes in uncharged.) */
    private chargeCards(dt: number): void {
        for (const card of this.cards.slice(0, HAND)) {
            const seconds = cardStat(card.kind, 'seconds', MobSave.cardLevel(card.kind)) ?? 20;
            const pace = this.debugFlags.fastCards ? DEBUG_CARD_PACE : 1;
            if (this.state === 'playing' && !this.cardTutorial) card.charge = Math.min(1, card.charge + (dt * pace) / Math.max(0.1, seconds));
            this.hud.setCardCharge(card.kind, card.charge);
            // The first card charged, the first time: the battle pauses for the player to use it.
            if (card.charge >= 1 && this.state === 'playing' && !this.cardTutorial && !MobSave.cardTutorial && !this.pinned.config && !this.duel) {
                this.cardTutorial = card.kind;
                this.dragging = false;
                this.battle.firing = false;
                this.hud.showCardTutorial(card.kind);
            }
        }
    }

    /** A charged card tapped: its unit out of the cannon, and it starts charging again. */
    private playCard(kind: CardKind): void {
        const at = this.cards.findIndex((entry) => entry.kind === kind);
        const card = this.cards[at];
        if (!card || at >= HAND || card.charge < 1 || this.state !== 'playing') return;
        // The first-card tutorial: only its card, and that ends it (the battle goes on).
        if (this.cardTutorial) {
            if (kind !== this.cardTutorial) return;
            this.cardTutorial = null;
            MobSave.cardTutorialDone();
            this.hud.hideCardTutorial();
        }
        card.charge = 0;
        // Its level's own hits and damage (not the houses' units').
        const level = MobSave.cardLevel(kind);
        this.battle.spawnUnit(kind, { hp: cardStat(kind, 'hp', level), damage: cardStat(kind, 'damage', level) });
        this.hud.cardFired(kind);
        this.hud.setCardCharge(kind, 0);
        // More cards than the hand holds: the next waiting one takes its place; it goes to the back of the line.
        if (this.cards.length > HAND) {
            const next = this.cards[HAND];
            this.cards.splice(HAND, 1);
            this.cards[at] = next;
            this.cards.push(card);
            this.hud.replaceCard(kind, next.kind);
            this.hud.setCardCharge(next.kind, next.charge);
            this.hud.setCardPile(this.cards[HAND]?.kind ?? null, this.cards.length - HAND);
        }
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
        // Over each one's head: a giant's is the crowd's model grown; a truck's is its own (much lower).
        const giantHeight = TUNING.mobHeight * TUNING.giantScale + 0.5;
        for (let i = 0; i < this.battle.count && labels.length < 12; i++) {
            // Giants and trucks show their hits; a car can't be destroyed (no number).
            if (!this.battle.big[i] || this.battle.big[i] === CAR) continue;
            const height = this.battle.big[i] === TRUCK ? TRUCK_LABEL_HEIGHT : giantHeight;
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
        this.duelHud.layout();
        // (A match: room too for the bars over the far buildings, under the clock and the life bars.)
        const hudBottom = (this.duel ? this.duelHud.topBottom() + DUEL_BAR_ROOM : this.hud.topBottom()) + HUD_CLEARANCE;
        const tops = this.arena?.fortTops() ?? [new THREE.Vector3(0, FORT_TOP_Y, ARENA.baseZ - FORT_BACK)];
        // A longer field moves the look-at point up it.
        CAMERA_TARGET.z = ARENA.baseZ * TARGET_SHARE;
        // The grid's four corners (the cannon's end, the base's line, either side) must be inside the safe area: the
        // design resolution (Game.DESIGN_WIDTH x DESIGN_HEIGHT), scaled to fit the screen and centred, as the HUD is.
        const fit = Math.min(window.innerWidth / Game.DESIGN_WIDTH, window.innerHeight / Game.DESIGN_HEIGHT);
        const safe = {
            left: (window.innerWidth - Game.DESIGN_WIDTH * fit) / 2 + SAFE_MARGIN,
            right: (window.innerWidth + Game.DESIGN_WIDTH * fit) / 2 - SAFE_MARGIN,
            top: (window.innerHeight - Game.DESIGN_HEIGHT * fit) / 2 + SAFE_MARGIN,
            bottom: (window.innerHeight + Game.DESIGN_HEIGHT * fit) / 2 - SAFE_MARGIN,
        };
        // Where they're drawn: the world's bend drops each one (Bend.ts), so that's where they're checked.
        const corners = this.framingCorners().map((corner) => corner.setY(-bendDrop(corner.x, corner.z)));
        // Every corner within the safe area's sides, and the far ones under its top. The near ones are on the cannon's row,
        // which keeps its place at the bottom (over the energy bar), safe area or not.
        const cornersFit = (): boolean => corners.every((corner) => {
            const at = this.worldToScreen(corner);
            return !!at && at.x >= safe.left && at.x <= safe.right && (corner.z === 0 || at.y >= safe.top);
        });
        const base = CAMERA.distance * Math.max(1, REFERENCE_ASPECT / camera.aspect);
        for (let back = 1; back < MOST_BACK; back += 0.03) {
            this.frame(base * back);
            // The forts' tops (their numbers too) under the HUD, and the whole grid inside the safe area.
            const highest = Math.min(...tops.map((top) => this.worldToScreen(top)?.y ?? -Infinity));
            if (highest >= hudBottom && cornersFit()) break;
        }
        this.cameraBase.copy(camera.position);
    }

    /** The grid's corners the camera frames (see resize()): ±ARENA.halfWidth at the cannon's end (z 0) and the base line. */
    private framingCorners(): THREE.Vector3[] {
        return [0, ARENA.baseZ].flatMap((z) => [-1, 1].map((side) => new THREE.Vector3(side * ARENA.halfWidth, 0, z)));
    }

    /** Debug: a pink spear on each framing corner, its tip on the point (bent with the world, so it shows where the
     *  corner is drawn). */
    private placeFramingSpears(): void {
        for (const child of [...this.framingSpears.children]) {
            this.framingSpears.remove(child);
            child.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
        }
        const material = new THREE.MeshBasicMaterial({ color: FRAMING_PINK });
        applyBend(material);
        for (const corner of this.framingCorners()) {
            const spear = new THREE.Group();
            const tip = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.7, 10), material);
            tip.rotation.x = Math.PI;
            tip.position.y = 0.35;
            const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6, 8), material);
            shaft.position.y = 0.7 + 1.3;
            spear.add(tip, shaft);
            spear.position.copy(corner);
            this.framingSpears.add(spear);
        }
    }

    /** The camera `distance` back at the pitch, then slid up or down (its own up) so the cannon sits at CANNON_PIN. */
    private frame(distance: number): void {
        const camera = this.threeCamera;
        const pitch = THREE.MathUtils.degToRad(CAMERA.pitchDeg);
        // Turned round the field by the yaw (0: straight down it, from behind the cannon).
        const yaw = THREE.MathUtils.degToRad(CAMERA.yawDeg);
        camera.position.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch)).multiplyScalar(distance).add(CAMERA_TARGET);
        camera.lookAt(CAMERA_TARGET);
        camera.updateMatrixWorld(true);
        const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0);
        const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
        camera.position.addScaledVector(right, CAMERA.offsetX);
        camera.updateMatrixWorld(true);
        this.pinOnScreen(new THREE.Vector3(0, 0, CANNON_FRONT_Z), window.innerHeight * CANNON_PIN + CAMERA.offsetY * 10, up);
    }

    /** Slides the camera along `up` until `point` is at screen height `y`. */
    private pinOnScreen(point: THREE.Vector3, y: number, up: THREE.Vector3): void {
        const camera = this.threeCamera;
        const forward = camera.getWorldDirection(new THREE.Vector3());
        for (let pass = 0; pass < 4; pass++) {
            const at = this.worldToScreen(point);
            if (!at || Math.abs(at.y - y) < 0.5) break;
            const depth = point.clone().sub(camera.position).dot(forward);
            const worldPerPixel = (2 * depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / window.innerHeight;
            // Camera up: the field moves down the screen.
            camera.position.addScaledVector(up, (y - at.y) * worldPerPixel);
            camera.updateMatrixWorld(true);
        }
    }

    // ------------------------------------------------------------------ debug

    private buildDebug(): void {
        const panel = DebugOverlay.instance.panel('Mob', { id: DEBUG_PANEL });
        panel.monitor('Mobs', () => `${this.battle.count} (peak ${this.battle.peak})`);
        panel.monitor('Battle', () => `${MobSave.selected + 1} · ${this.battle.time.toFixed(1)}s`);
        // Two to a row: more side by side can't be read.
        panel.buttons([
            { label: 'WIN', action: () => this.battle.destroyAll() },
            { label: 'LOSE', variant: 'danger', action: () => { this.battle.state = 'lost'; this.finish(false); } },
        ]);
        panel.buttons([
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
        ]);
        panel.buttons([
            { label: 'GIANT', action: () => this.battle.debugSpawn('giant') },
            { label: 'TRUCK', action: () => this.battle.debugSpawn('truck') },
        ]);
        panel.buttons([
            { label: 'UFO', action: () => this.battle.debugSpawn('saucer') },
            { label: 'RAMMER', action: () => this.battle.debugSpawn('car') },
        ]);
        const levels = { level: MobSave.selected % PLAY.length };
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
        // The arena (not on the main screen yet): a match counted on the save's arena record, or back to the levels.
        const arenaIds = Object.keys(ARENAS_BY_ID);
        if (arenaIds.length) {
            panel.buttons([
                { label: 'ARENA', action: () => { this.duelSpec = { arena: ARENAS_BY_ID[arenaIds[0]], counted: true }; this.startBattle(); } },
                { label: 'LEVELS', action: () => { this.duelSpec = null; this.startBattle(); } },
            ]);
            panel.monitor('Arena', () => {
                const record = MobSave.arena;
                return `★ ${record.rating} ${LADDER.tiers[tierFor(LADDER, record)].name} · ${record.won}W ${record.lost}L · streak ${record.streak}`;
            });
        }
        // The unit cards, each on or off (later: the shop's); FAST CARDS: they charge 4x as fast (to try them).
        const cards = panel.folder('Cards');
        cards.toggle(this.debugFlags, 'fastCards', { label: 'Fast cards (4x charge)', persist: false });
        cards.button('REVEAL (all four)', () => this.hud.revealCards([...CARD_KINDS]));
        const owned = Object.fromEntries(CARD_KINDS.map((kind) => [kind, MobSave.hasCard(kind)])) as Record<CardKind, boolean>;
        const CARD_LABELS: Record<CardKind, string> = { giant: 'Giant card', truck: 'Truck card', saucer: 'UFO card', car: 'Car card', skeletons: 'Skeletons card', warriors: 'Warriors card', golem: 'Golem card', bomb: 'Bomb card', bats: 'Bats card', turtle: 'Turtle card', 'giant-green': 'Armored giant card', 'giant-viking': 'Viking giant card' };
        for (const kind of CARD_KINDS) {
            cards.toggle(owned, kind, {
                label: CARD_LABELS[kind],
                persist: false,
                onChange: (on: boolean) => {
                    MobSave.setCard(kind, on);
                    this.cards = MobSave.deck.map((k) => this.cards.find((card) => card.kind === k) ?? { kind: k, charge: 0 });
                    this.showHand();
                },
            });
        }
        const camera = panel.folder('Camera');
        const apply = () => this.resize();
        camera.slider(CAMERA, 'pitchDeg', 25, 89, 1, 'Pitch (deg)').onChange(apply);
        camera.slider(CAMERA, 'yawDeg', -45, 45, 1, 'Yaw (deg)').onChange(apply);
        camera.slider(CAMERA, 'distance', 10, 80, 0.5, 'Distance').onChange(apply);
        camera.slider(CAMERA, 'offsetY', -15, 15, 0.1, 'Offset up / down').onChange(apply);
        camera.slider(CAMERA, 'offsetX', -10, 10, 0.1, 'Offset left / right').onChange(apply);
        camera.slider(CAMERA, 'fov', 20, 80, 1, 'Field of view').onChange(apply);
        camera.slider(BEND, 'strength', 0, 0.012, 0.0001, 'Bend').onChange(apply);
        camera.slider(SHAKE_LEVEL, 'value', 0, 2, 0.05, 'Camera shake');
        camera.button('Log camera', () => console.log('[Mob] CAMERA', JSON.stringify({ ...CAMERA, bend: BEND.strength })));
        // The upgrades' colours, live (Apply keeps them; Log colours prints them for MobConfig's UNIT_COLORS).
        const colours = panel.folder('Colours');
        const recolour = () => this.arena?.refreshColors();
        const COLOUR_LABELS: Record<keyof typeof UNIT_COLORS, string> = {
            giant: 'Giant (body)', giantHouse: 'Giant house (tint)',
            truck: 'Truck (tint)', truckWall: 'Truck house wall', truckRoof: 'Truck house roof',
            ufo: 'UFO (tint)', ufoWall: 'UFO house wall', ufoRoof: 'UFO house roof',
            car: 'Car (tint)', carWall: 'Car house wall', carRoof: 'Car house roof',
        };
        for (const key of Object.keys(COLOUR_LABELS) as (keyof typeof UNIT_COLORS)[]) {
            colours.color(UNIT_COLORS, key, { label: COLOUR_LABELS[key] }).onChange(recolour);
        }
        colours.button('Log colours', () => console.log('[Mob] UNIT_COLORS', JSON.stringify(Object.fromEntries(
            Object.entries(UNIT_COLORS).map(([key, value]) => [key, `0x${value.toString(16).padStart(6, '0')}`])))));
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
        // Nothing of the end card left to start (a card reveal waiting) once it's gone.
        this.hud.hideEnd();
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
