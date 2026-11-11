// UfoScene.ts
//
// Fly the saucer over the town and eat it. Anything whose middle is under a saucer gets pulled up if it fits (its footprint
// within the saucer's radius) and the saucer flies above it. Each bite grows the saucer, and growing lifts it: what stopped
// it before can be flown over, and eaten once it fits.
//
// The standard mode's a list of missions (Mission, in ui/ufo.json): other saucers about, the clock running, and a job to do:
// reach the points, eat everything, or swallow one object. Fail and it's a retry, win and it's on to the next.
//
// Competition: a level with a `round` is timed: the biggest saucer when the clock runs out wins (alone, it's how much of the town you
// get). Rival saucers (Rival.ts) play the same rules, and a saucer flying higher than another eats it when it gets its
// middle under its beam: the eaten one comes back smaller, a moment later. A level's goal is then a huge bonus. A level
// without a `round` plays calmly, until its goal's eaten or everything is. Either way: the end screen, then the next
// level, from a small saucer again.
//
// Like the other 3D games, the THREE world sits behind the PIXI overlay (the HUD, and the input catcher: this scene).

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import gsap from 'gsap';
import { Game } from 'core/Game';
import AnalogInput from 'core/io/AnalogInput';
import KeyboardInputMovement from 'core/io/KeyboardInputMovement';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { ThreeScene } from 'core/scene/ThreeScene';
import { CAMERA, DESIGN, LOOKS, Level, Mission, Prop, UFO, areaProgress, currentArena, currentLevel, currentMission, currentMissionIndex, goToMission, levelTitle, missionUpTo } from '../data/UfoConfig';
import { arenaById, coinsFor, currentMatchPlayers, rivalsNow, trophiesFor } from '../data/Versus';
import type { AreaView } from '../ui/AreaBar';
import { UfoProgress } from '../data/UfoProgress';
import { awardRound } from '../data/Ranking';
import { SpatialAudio } from '../audio/SpatialAudio';
import { UfoAudio } from '../audio/UfoAudio';
import { bendUniforms, updateBend } from '../services/Bend';
import { Rival } from '../player/Rival';
import { Directed, RivalDirector } from '../player/RivalDirector';
import { Saucer } from '../player/Saucer';
import { UfoHud } from '../ui/UfoHud';
import type { PlayerLook } from '../ui/UiParts';
import { Cars } from '../world/Cars';
import { HomeArrows } from '../world/HomeArrows';
import { People } from '../world/People';
import { Item, UfoTown } from '../world/UfoTown';

/** The longest step simulated (a hitch doesn't throw the saucer through a wall). */
const MAX_FRAME_SEC = 1 / 20;
/** How long a thing takes to reach the saucer: quick for the small, longer for the tall. */
const FLIGHT = { base: 0.22, perHeight: 0.012 };
/** A slurp: how much taller it stretches on the way, and how thin it goes (share of its width left at the top). */
const SLURP = { stretch: 0.9, thin: 0.03 };
const FLIGHT_SPIN = 7;
/** The same "too big" message isn't repeated within this (seconds), nor the thud. */
const SAY_EVERY = 2.5;
const BUMP_EVERY = 0.5;
const SKY = 0x9fd4f2;
/**
 * A portrait screen's camera pulls back, narrower screens more, to keep some width in view: not all of it, or a phone
 * starts far too far out. PORTRAIT_PULL 1 would keep all the width; 0 wouldn't pull back at all.
 */
const REFERENCE_ASPECT = 1.2;
const PORTRAIT_PULL = 0.45;
const CAMERA_LOOK_HEIGHT = 0.35;
/** The players' faces and colours (rivals take the ones after the player's). */
const FACES = [0, 1, 2, 3, 4, 5, 6, 7].map((n) => `ProfileFace_s_0${n}`);
const PLAYER_COLORS = [0x5fe87a, 0xff7ab8, 0x6fc3ff, 0xffb347, 0xb98cff, 0x4fe0d0, 0xff6b6b, 0xffe066];
const RIVAL_NAMES = ['Zorp', 'Blip', 'Gloop', 'Nebby', 'Krill', 'Vex', 'Quark', 'Plonk', 'Oozle', 'Fizz'];
/** How unevenly the rivals are placed round the player at the start (1: up to half the gap each way). */
const INTRO_ANGLE_JITTER = 0.7;
/** A rival's name: this many radii over it. */
const TAG_LIFT = 1.6;
/** How often the leaderboard's redrawn (seconds). */
const BOARD_EVERY = 0.25;
/** Rivals start at least this far from the player and each other. */
const SPAWN_APART = 14;
/** The goal's line: up at the start for this long; then back with a pulse every so often, and as the bar passes these shares. */
const BANNER_FLASH = { first: 5, again: 4, every: 45, shares: [0.5, 0.85] };
/** Points for eating a saucer, and a kill streak's window (seconds) and shouts. */
const KILL = { points: 25, streakSeconds: 9, shouts: ['KILL!', 'DOUBLE KILL!', 'MULTI KILL!', 'MEGA KILL!', 'MONSTER KILL!'] };
/** A points goal is rounded to this. */
const TARGET_ROUND = 50;
/** Under the saucer, on the ground: how far past its radius the size bar sits. */
const SIZE_BAR_AT = 1.2;
/** A pop-up this many points or more is a big one. */
const BIG_POINTS = 8;
/** A solo round's a win with this much of the town eaten (%). */
const SOLO_WIN = 30;
/** A rival's points count this much of what it eats (a race: a little behind the player's pace, eating as much). */
const RACE_PACE = 0.85;
/** The markers at the screen's edge for rivals out of view: only this many, the nearest, and only within this far. */
const MARKERS = { most: 3, range: 110 };

type Phase = 'menu' | 'intro' | 'playing' | 'ended';

/** Going somewhere else: what the transition says, what to set up behind it, and whether it's to the home screen. */
export interface Travel {
    title: string;
    subtitle: string;
    apply: () => void;
    home?: boolean;
}

/** A saucer in the game: the player's or a rival's. */
interface Contestant extends PlayerLook {
    saucer: Saucer;
    rival: Rival | null;
    /** How many things are on their way up its beam. */
    flying: number;
    /** Eaten: how long until it's back. */
    respawn: number;
    /** In a level to eat everything: what a rival's eaten, which whoever eats it gets. */
    held: { count: number; points: number; value: number };
    /** A rival's points (a race's: the player's are the score). */
    points: number;
}

interface Flying {
    item: Item;
    points: number;
    eater: Contestant;
    time: number;
    duration: number;
    from: THREE.Vector3;
    scale: THREE.Vector3;
}

/** What a thing's worth when you eat it. */
const pointsOf = (item: Item): number => Math.max(1, Math.round(item.value));
/** The arrow to an object to swallow. */
const GOAL_ARROW = 0xffd23f;

/** The hints already taken in, this session. */
const hintsDone = new Set<string>();

export default class UfoScene extends ThreeScene {
    private level!: Level;
    private town!: UfoTown;
    private cars!: Cars;
    private people!: People;
    private homeArrows!: HomeArrows;
    private saucer!: Saucer;
    private you!: Contestant;
    private readonly contestants: Contestant[] = [];
    private hud!: UfoHud;
    /** The sea, the parks and the cars, from the first input on (startSound()). */
    private spatial?: SpatialAudio;
    private keyboard!: KeyboardInputMovement;
    private analog!: AnalogInput;
    private readonly input = new THREE.Vector2();
    private readonly stillInput = new THREE.Vector2();
    private readonly flying: Flying[] = [];
    private readonly mission: Mission | null = currentMission();
    private readonly missionIndex = currentMissionIndex();
    /** A versus match's arena (null: a story level, or the competition's round). */
    private readonly arena = arenaById(currentArena() ?? '') ?? null;
    /** A level to eat everything: rivals never eat the player or outgrow it, and whoever eats one gets what it ate. */
    private readonly gentle = this.mission?.type === 'all';
    private score = 0;
    private target = 0;
    private kills = 0;
    private streak = 0;
    private streakTimer = 0;
    private sizeLevel = 1;
    private missionWon = false;
    private director: RivalDirector | null = null;
    private bannerTimer = 0;
    private bannerStarted = false;
    /** The goal's line shows at the start, and again as soon as the player sets off. */
    private bannerForMoving = false;
    private bannerShares: number[] = [...BANNER_FLASH.shares];
    private readonly focus = new THREE.Vector3();
    private readonly saucerAt = new THREE.Vector3();
    private readonly tagAt = new THREE.Vector3();
    private readonly goal = new THREE.Vector3();
    private distance: number = CAMERA.distance;
    /** Where the camera started: the world's curve is `camera.bend` from here. */
    private startDistance: number = CAMERA.distance;
    private phase: Phase = 'intro';
    /** The quit box is up: the round's paused under it. */
    private quitAsked = false;
    /** The intro: how far along, where the rivals wait and where they go, and the camera's angle while it lasts. */
    private introTime = 0;
    private introDone = false;
    private introShare = 0;
    private introDistance = 0;
    private introPitch: number | null = null;
    private readonly introMoves: { saucer: Saucer; steer: THREE.Vector2; setsOffAt: number }[] = [];
    /** What's been eaten that can come back, and how long since the player ate and things last came back. */
    private readonly eatenProps: { prop: Prop; radius: number; height: number; value: number }[] = [];
    private sinceEaten = 0;
    private sinceRestore = 0;
    private clock = 0;
    private boardTimer = 0;
    private eaten = 0;
    /** Every model's in: "nothing left to eat" now means the town's gone. */
    private loaded = false;
    /** The level's goal has gone up a beam. */
    private goalEaten = false;
    /** The goal's "you're big enough" has been said. */
    private goalAnnounced = false;
    private sayTimer = 0;
    private bumpTimer = 0;
    private readonly debugPanelId = 'ufo.tuning';
    /** Resolves once the town's models are in. */
    public ready: Promise<void> = Promise.resolve();

    /** `travel`: on to somewhere else, behind the transition. */
    public constructor(game: Game, private readonly travel: (travel: Travel) => void) {
        super(game);
    }

    public build(): void {
        const level = currentLevel();
        this.level = level;
        this.threeScene.background = new THREE.Color(SKY);
        this.threeScene.add(new THREE.HemisphereLight(0xffffff, 0x5a7a4a, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 1.5);
        sun.position.set(6, 14, 8);
        this.threeScene.add(sun);
        this.threeCamera.fov = CAMERA.fov;
        this.threeCamera.near = 1;
        this.threeCamera.far = 1500;
        this.threeCamera.updateProjectionMatrix();

        this.town = new UfoTown(this.threeScene, level);
        this.cars = new Cars(this.threeScene, level, this.town);
        this.people = new People(this.threeScene, level, this.town, this.cars);
        this.saucer = new Saucer(this.threeScene, level.start.x, level.start.z);
        this.you = { name: UfoProgress.username, face: UfoProgress.avatarLook.face, color: UfoProgress.avatarLook.color, saucer: this.saucer, rival: null, flying: 0, respawn: 0, held: { count: 0, points: 0, value: 0 }, points: 0 };
        this.contestants.push(this.you);
        this.spawnRivals();
        this.homeArrows = new HomeArrows(this.threeScene);
        this.ready = Promise.all([this.town.ready, this.cars.ready, this.people.ready]).then(() => {
            this.loaded = true;
            this.setUpMission();
        });
        this.focus.set(level.start.x, 0, level.start.z);
        this.distance = this.startDistance = this.cameraDistance();
        this.placeCamera();
        updateBend(this.focus, CAMERA.bend);

        this.hud = new UfoHud(() => this.onEndButton(), () => this.onHomeButton());
        if (this.mission?.tutorial) {
            this.hud.hideHome();
            this.hud.hideTopBar();
        } else if (this.mission && UfoProgress.levelsWon === 0) {
            // A new player's first level: no way out to the main screen till it's won (it opens after it).
            this.hud.hideHome();
        }
        this.startIntro();
        this.game.uiLayer.addChild(this.hud);
        this.buildInput();
        this.buildDebug();
        this.clock = this.mission?.seconds ?? this.roundSpec?.seconds ?? 0;
        if (this.roundLike && this.contestants.length > 1) this.hud.showRoundKills();
        if (this.mission && !this.roundLike) {
            this.hud.setMission(true);
            this.hud.setRing(this.clock, this.clock);
            this.hud.setKills(0);
        }
        // After the first level the player has long since done something; browsers only let sound start once they have.
        if (UfoAudio.started()) this.startSound();
        else {
            window.addEventListener('pointerdown', this.startSound, true);
            window.addEventListener('keydown', this.startSound, true);
        }
    }

    /** Everyone's gathered round the player, and the camera's high above. */
    private startIntro(): void {
        const { gatherRadius, zoomOut, rivalsFrom, rivalsTo } = DESIGN.intro;
        const rivals = this.contestants.filter(({ rival }) => rival);
        rivals.forEach(({ saucer }, i) => {
            // Round the player, not quite evenly.
            const angle = ((i + (Math.random() - 0.5) * INTRO_ANGLE_JITTER) / rivals.length) * Math.PI * 2;
            saucer.position.set(this.level.start.x + Math.sin(angle) * gatherRadius, this.level.start.z + Math.cos(angle) * gatherRadius);
            // Straight out from the player, at a rival's own speed.
            const steer = new THREE.Vector2(Math.sin(angle), Math.cos(angle)).multiplyScalar(DESIGN.rivals.speed);
            this.introMoves.push({ saucer, steer, setsOffAt: THREE.MathUtils.lerp(rivalsFrom, rivalsTo, Math.random()) });
        });
        const { minX, maxX, minZ, maxZ } = this.town.bounds();
        const halfFov = THREE.MathUtils.degToRad(CAMERA.fov / 2);
        const wholeIsland = Math.max(maxX - minX, maxZ - minZ) / (2 * Math.tan(halfFov) * Math.min(1, this.threeCamera.aspect));
        this.introDistance = Math.min(this.threeCamera.far * 0.6, wholeIsland * zoomOut);
        this.distance = this.introDistance;
        this.introPitch = THREE.MathUtils.degToRad(DESIGN.intro.pitchDeg);
        this.placeCamera();
        this.hud.alpha = 0;
    }

    /** The camera comes down to the player, the rivals fly out, and it starts. */
    private updateIntro(delta: number): void {
        if (!this.loaded) return;
        const { hold, seconds, controlAt, pitchDeg } = DESIGN.intro;
        this.introTime += delta;
        const t = THREE.MathUtils.clamp((this.introTime - hold) / seconds, 0, 1);
        this.introShare = t * t * (3 - 2 * t);
        this.introPitch = THREE.MathUtils.lerp(THREE.MathUtils.degToRad(pitchDeg), this.cameraPitch(), this.introShare);
        // Close enough: the level's on, while the camera finishes coming down.
        if (this.phase === 'intro') {
            for (const { saucer, steer, setsOffAt } of this.introMoves) {
                if (t >= setsOffAt) saucer.move(steer, delta, this.town);
            }
            if (t >= controlAt) {
                this.phase = 'playing';
                void PlatformHandler.instance.platform.gameplayStart();
                gsap.to(this.hud, { alpha: 1, duration: 0.35 });
            }
        }
        if (t < 1) return;
        this.introDone = true;
        this.introPitch = null;
    }

    /** The level's over, or being left: play stops, for the platform too. */
    private stopPlaying(): void {
        this.phase = 'ended';
        void PlatformHandler.instance.platform.gameplayStop();
    }

    /** With everything loaded, what the mission's after is known. */
    private setUpMission(): void {
        const { mission, hud } = this;
        if (!mission || hud.destroyed) return;
        const goalName = this.level.goal?.name.toUpperCase();
        if (mission.type === 'object' && this.town.goalItem) hud.setBanner([{ text: `SWALLOW THE ${goalName}`, green: true }, { text: ' TO WIN!' }]);
        else if (mission.type === 'points') {
            const total = this.town.items.reduce((sum, item) => sum + pointsOf(item), 0);
            // Never more than the town has.
            const wanted = mission.points ?? Math.round((total * (mission.share ?? 0.5)) / TARGET_ROUND) * TARGET_ROUND;
            this.target = Math.max(TARGET_ROUND, Math.min(wanted, total));
            hud.setBanner([{ text: 'EAT EVERYTHING', green: true }, { text: ' UNTIL YOU GET ' }, { text: `${this.target} POINTS`, green: true }, { text: '!' }]);
        } else if (mission.type === 'race') {
            const total = this.town.items.reduce((sum, item) => sum + pointsOf(item), 0);
            const wanted = mission.points ?? Math.round((total * (mission.share ?? 0.3)) / TARGET_ROUND) * TARGET_ROUND;
            this.target = Math.max(TARGET_ROUND, Math.min(wanted, total));
            hud.setBanner([{ text: `FIRST TO ${this.target} POINTS`, green: true }, { text: ' WINS!' }]);
        } else if (mission.type === 'top') {
            hud.setBanner([{ text: 'BE THE BIGGEST', green: true }, { text: ' WHEN TIME RUNS OUT!' }]);
        } else hud.setBanner([{ text: 'EAT THE WHOLE TOWN', green: true }, { text: ' TO WIN!' }]);
    }

    /** A versus arena's clock and rivals, or (the competition) the level's round; null in a story level. */
    private get roundSpec(): { seconds: number; rivals: number } | null {
        if (this.mission) return null;
        if (this.arena) return { seconds: this.arena.seconds, rivals: this.arena.rivals };
        return this.level?.round ?? null;
    }

    /** Played as a round: the clock on the bar, the leaderboard, names over the rivals (a round, a `top` or `race` level). */
    private get roundLike(): boolean {
        return this.mission ? this.mission.type === 'top' || this.mission.type === 'race' : Boolean(this.roundSpec);
    }

    /**
     * The HUD's home button. A competition round asks first (paused meanwhile): QUIT ends it there, on the end screen
     * with the place the player has (before it's started: home). Anything else: home.
     */
    private onHomeButton(): void {
        if (!this.roundSpec || this.phase === 'ended') {
            this.leaveToHome();
            return;
        }
        if (this.quitAsked) return;
        this.quitAsked = true;
        void PlatformHandler.instance.platform.gameplayStop();
        // (The engine's hum and the beam quiet while paused.)
        UfoAudio.setHum(0, this.saucer.radius);
        UfoAudio.setSucking(false);
        this.hud.askQuit(() => {
            this.quitAsked = false;
            if (this.phase === 'playing') this.finishRound();
            else this.leaveToHome();
        }, () => {
            this.quitAsked = false;
            if (this.phase === 'playing') void PlatformHandler.instance.platform.gameplayStart();
        });
    }

    /** Out of the level, to the home screen: the same level's still next. */
    private leaveToHome(): void {
        this.stopPlaying();
        this.travel({ title: 'HOME', subtitle: '', home: true, apply: () => goToMission(currentMissionIndex()) });
    }

    /** The end screen's button: home (a mission won: the next one's up), or a mission lost, again. */
    private onEndButton(): void {
        const { mission } = this;
        // The tutorial, the first time: straight on into the first level (the main screen comes after it).
        if (mission?.tutorial && UfoProgress.levelsWon === 0) {
            const first = missionUpTo();
            this.travel({ title: first.name, subtitle: levelTitle(first.level).toUpperCase(), apply: () => goToMission(currentMissionIndex()) });
            return;
        }
        if (mission && !this.missionWon) {
            this.travel({ title: mission.name, subtitle: levelTitle(mission.level).toUpperCase(), apply: () => goToMission(this.missionIndex) });
            return;
        }
        const next = mission && !mission.tutorial ? this.missionIndex + 1 : currentMissionIndex();
        this.travel({ title: 'HOME', subtitle: '', home: true, apply: () => goToMission(next) });
    }

    /** The rivals asked for: each in another style, alien and colour, scattered round the map. */
    private spawnRivals(): void {
        const count = this.mission?.rivals ?? this.roundSpec?.rivals ?? 0;
        const taken: { x: number; y: number }[] = [this.saucer.position];
        const directed: Directed[] = [];
        // A level's own shares, else the settings'; a versus match: the tier's (easy the first few times), its pace too.
        const base = this.mission?.ratios ?? DESIGN.rivals.ratios;
        const versus = this.arena ? rivalsNow(count, base) : null;
        const ratios = versus?.ratios ?? base;
        const speed = versus?.speed ?? DESIGN.rivals.speed;
        // The players the matchmaking found, else made-up names.
        const players = this.arena ? currentMatchPlayers() : [];
        const first = Math.floor(Math.random() * RIVAL_NAMES.length);
        for (let i = 0; i < count; i++) {
            const at = this.town.findOpenSpot(taken, SPAWN_APART);
            const ufo = LOOKS.ufos[(i + 1) % LOOKS.ufos.length];
            const alien = LOOKS.aliens[(i + 1) % LOOKS.aliens.length];
            const player = players[i];
            const color = player?.color ?? PLAYER_COLORS[(i + 1) % PLAYER_COLORS.length];
            const saucer = new Saucer(this.threeScene, at.x, at.y, { look: () => ({ ufo, alien }), throwsLight: false, beamColor: color });
            taken.push(saucer.position);
            const rival = new Rival(saucer, this.mission?.type === 'object', speed);
            directed.push({ saucer, rival, ratio: ratios[i % ratios.length], seen: 0 });
            this.contestants.push({
                name: player?.name ?? RIVAL_NAMES[(first + i) % RIVAL_NAMES.length], face: player?.face ?? FACES[(i + 1) % FACES.length], color,
                saucer, rival, flying: 0, respawn: 0, held: { count: 0, points: 0, value: 0 }, points: 0,
            });
        }
        if (directed.length) this.director = new RivalDirector(directed, this.saucer, this.gentle);
    }

    /** The soundtrack and the sounds of the place (big downloads, so not before they can be heard). */
    private readonly startSound = (): void => {
        window.removeEventListener('pointerdown', this.startSound, true);
        window.removeEventListener('keydown', this.startSound, true);
        this.spatial ??= new SpatialAudio(this.level);
        UfoAudio.startMusic(this.level);
    };

    private buildInput(): void {
        this.eventMode = 'static';
        this.hitArea = new PIXI.Rectangle(-2000, -2000, 6000, 6000);
        const steer = ({ direction, magnitude }: { direction: PIXI.Point; magnitude: number }) => {
            this.input.set(magnitude > 0 ? direction.x * magnitude : 0, magnitude > 0 ? direction.y * magnitude : 0);
        };
        this.keyboard = new KeyboardInputMovement();
        this.keyboard.onMove.add(steer);
        this.analog = new AnalogInput(this);
        this.analog.onMove.add(steer);
        // Past the screen's edge the browser may cancel a touch without the stick hearing it end, and then the stick ignores
        // every new finger, waiting for the old one. So it's told here, ahead of PIXI: a finger with none other down (primary)
        // means whatever the stick was holding is over.
        window.addEventListener('pointerdown', this.onAnyPointerDown, true);
        window.addEventListener('pointercancel', this.releaseStick, true);
        window.addEventListener('blur', this.releaseStick);
    }

    private readonly onAnyPointerDown = (event: PointerEvent): void => {
        if (event.isPrimary) this.resetStick();
    };

    private readonly releaseStick = (): void => {
        this.resetStick();
        this.input.set(0, 0);
    };

    private resetStick(): void {
        this.analog.setEnabled(false);
        this.analog.setEnabled(true);
    }

    /** With ?dev or ?debug: the numbers to feel out, live (saving them for good is the editor's UFO tab). */
    private buildDebug(): void {
        const panel = DebugOverlay.instance.panel('UFO', { id: this.debugPanelId });
        const choices = (styles: { id: string; name: string }[]) => Object.fromEntries(styles.map((style) => [style.name, style.id]));
        panel.select(LOOKS, 'ufo', choices(LOOKS.ufos), { label: 'UFO style' }).onChange(() => void this.saucer.applyLook());
        panel.select(LOOKS, 'alien', choices(LOOKS.aliens), { label: 'Alien' }).onChange(() => void this.saucer.applyLook());
        panel.slider(UFO, 'speed', 2, 30, 0.5, 'Speed');
        panel.slider(UFO, 'growth', 0, 1, 0.01, 'Growth');
        panel.slider(UFO, 'altitudePerRadius', 1, 6, 0.1, 'Altitude per radius');
        panel.slider(DESIGN.rivals, 'speed', 0.3, 1.2, 0.01, 'Rival speed');
        panel.slider(CAMERA, 'bend', 0, 0.01, 0.0001, 'World bend');
        panel.slider(CAMERA, 'pitchDeg', 25, 89, 1, 'Camera pitch');
        panel.slider(CAMERA, 'endPitchDeg', 25, 89, 1, 'Camera pitch, grown');
        panel.slider(CAMERA, 'distance', 6, 40, 0.5, 'Camera distance');
        panel.slider(CAMERA, 'perAltitude', 0, 4, 0.1, 'Camera per altitude');
        panel.slider(CAMERA, 'maxShare', 0.1, 1, 0.01, 'Largest saucer on screen');
        panel.button('GROW', () => this.saucer.grow(40));
        panel.button('WIN LEVEL', () => this.debugEnd(true));
        panel.button('LOSE LEVEL', () => this.debugEnd(false));
        panel.button('ERASE DATA', () => UfoProgress.eraseAndRestart());
        panel.button('END THE ROUND', () => {
            this.clock = 0;
        });
        panel.button('EAT EVERYTHING', () => {
            [...this.town.items].forEach((item) => this.eat(item, this.you));
        });
    }

    private debugEnd(won: boolean): void {
        if (this.phase !== 'playing') return;
        if (this.mission) this.finishMission(won);
        else this.finishRound();
    }

    public update(delta: number): void {
        // (Paused while the quit box asks.)
        if (this.quitAsked) return;
        delta = Math.min(delta, MAX_FRAME_SEC);
        const playing = this.phase === 'playing';
        const saucers = this.contestants.map(({ saucer }) => saucer);
        if (!this.introDone) this.updateIntro(delta);
        if (playing) this.director?.update(delta, this.input, (saucer) => this.isOnScreen(saucer));
        for (const contestant of this.contestants) {
            const { saucer, rival } = contestant;
            if (rival && playing) rival.update(delta, saucers, this.town, this.saucer);
            const steer = !playing || !saucer.isAlive ? this.stillInput : rival ? rival.input : this.input;
            // (Not while the intro's placing them: the town would push them about.)
            if (this.phase !== 'intro') saucer.move(steer, delta, this.town);
            saucer.update(delta);
        }
        this.homeArrows.update(delta, this.saucer.position, this.saucer.radius, this.town);
        this.cars.update(delta);
        this.people.update(delta);
        this.spatial?.update(this.saucer.position.x, this.saucer.position.y, this.cars.carSounds());
        this.sayTimer -= delta;
        this.bumpTimer -= delta;
        this.streakTimer -= delta;
        if (this.streakTimer <= 0) this.streak = 0;
        if (playing) {
            this.checkBump();
            for (const contestant of this.contestants) this.checkItems(contestant);
            this.checkSaucers();
            this.updateRespawns(delta);
            this.updateScarcity(delta);
        }
        this.updateFlying(delta);
        for (const contestant of this.contestants) contestant.saucer.setSucking(contestant.flying > 0);
        UfoAudio.setSucking(this.you.flying > 0, this.you.flying, this.saucer.radius);
        UfoAudio.setHum(playing && this.saucer.isAlive ? this.saucer.speedShare : 0, this.saucer.radius);
        this.updateCamera(delta);
        this.town.culler.update(this.threeCamera);
        this.town.fadeBlocking(this.threeCamera.position, this.saucer.worldPosition(this.saucerAt), delta);
        this.updateHud(delta);
        if (playing) {
            this.updateHints();
            this.updateBanner(delta);
            this.checkEnd(delta);
        }
        super.update(delta);
    }

    private updateHud(delta: number): void {
        const { hud } = this;
        hud.updateEnd(delta);
        this.updateSizeBar();
        const { round, goal } = this.level;
        const goalItem = this.town.goalItem;
        if (this.roundLike) hud.setKills(this.kills);
        if (this.mission && !this.roundLike) this.updateMissionHud();
        else if (this.roundLike) hud.setClock(this.clock, this.mission?.seconds ?? this.roundSpec?.seconds ?? round?.seconds ?? 1);
        else if (goal && goalItem) hud.setProgress(Math.min(1, this.saucer.radius / goal.radius), goal.name.toUpperCase());
        else hud.setProgress(this.townShare(), 'TOWN');
        const forYou = this.mission ? this.mission.type === 'object' : true;
        if (forYou && goal && goalItem && !goalItem.gone && !this.goalAnnounced && this.saucer.radius >= goal.radius && this.phase === 'playing') {
            this.goalAnnounced = true;
            this.sayTimer = SAY_EVERY;
            hud.say(`BIG ENOUGH! SWALLOW THE ${goal.name.toUpperCase()}!`);
        }
        this.boardTimer -= delta;
        if (this.boardTimer <= 0) {
            this.boardTimer = BOARD_EVERY;
            hud.setBoard(this.contestants.length > 1 && this.roundLike ? this.ranking() : [], this.mission?.type === 'race');
        }
        if (this.mission && !this.roundLike) this.updateArrows();
        else this.updateTags();
    }

    /**
     * How much of what's left of the town the player has: what the rivals ate is gone from it (eating a rival still gives
     * its haul, as a bonus), so the map eaten bare is the town done, without having to hunt the rivals for the rest.
     */
    private townShare(): number {
        return this.eaten / Math.max(1, this.eaten + this.town.items.length + this.flying.length);
    }

    /** The ring timer, the points bar (or how far along the mission is), the kills. */
    private updateMissionHud(): void {
        const { mission, hud } = this;
        if (!mission) return;
        if (mission.seconds > 0) hud.setRing(this.clock, mission.seconds);
        else hud.hideRing();
        if (!mission.rivals) hud.hideKills();
        hud.setKills(this.kills);
        const goal = this.level.goal;
        if (mission.type === 'points') hud.setScoreBar(this.score / Math.max(1, this.target), `${this.score}/${this.target || '…'}`);
        else if (mission.type === 'object' && goal && this.town.goalItem) {
            const share = Math.min(1, this.saucer.radius / goal.radius);
            hud.setScoreBar(share, `${goal.name.toUpperCase()} ${Math.floor(share * 100)}%`);
        } else {
            // Full when it's won.
            const share = Math.min(1, this.townShare() / UFO.completeShare);
            hud.setScoreBar(share, `EATEN ${Math.floor(share * 100)}%`);
        }
    }

    private isOnScreen(saucer: Saucer): boolean {
        const at = this.onHud(saucer.position.x, 0, saucer.position.y);
        return !!at && this.hud.isInView(at.x, at.y);
    }

    /** The goal's line comes and goes: up at the start, back every so often and as the bar nears the end, pulsing. */
    private updateBanner(delta: number): void {
        const { mission, hud } = this;
        if (!mission || !this.loaded) return;
        // The tutorial shows one thing at a time: flying, then, with the first thing eaten, the goal, which stays.
        if (mission.tutorial) {
            if (!this.bannerStarted && this.eaten > 0) {
                this.bannerStarted = true;
                hud.showTutorialGoal();
            }
            return;
        }
        if (!this.bannerStarted) {
            this.bannerStarted = true;
            this.bannerTimer = BANNER_FLASH.every;
            hud.flashBanner(BANNER_FLASH.first, false);
            return;
        }
        if (!this.bannerForMoving && this.input.lengthSq() > 0) {
            this.bannerForMoving = true;
            this.bannerTimer = BANNER_FLASH.every;
            hud.flashBanner(BANNER_FLASH.first, true);
            return;
        }
        this.bannerTimer -= delta;
        const share = mission.type === 'points' || mission.type === 'race' ? this.score / Math.max(1, this.target) : 0;
        const passed = this.bannerShares.length > 0 && share >= this.bannerShares[0];
        if (passed) this.bannerShares.shift();
        if (this.bannerTimer > 0 && !passed) return;
        this.bannerTimer = BANNER_FLASH.every;
        hud.flashBanner(BANNER_FLASH.again, true);
    }

    /** A world spot, lying on the curved ground, in the HUD's space; null if it's behind the camera. */
    private onHud(x: number, y: number, z: number): PIXI.IPointData | null {
        const origin = bendUniforms.uBendOrigin.value;
        const dx = x - origin.x;
        const dz = z - origin.z;
        this.tagAt.set(x, y - (dx * dx + dz * dz) * bendUniforms.uBendStrength.value, z);
        const screen = this.worldToScreen(this.tagAt);
        return screen ? this.hud.toLocal(new PIXI.Point(screen.x, screen.y)) : null;
    }

    /** The saucer's size bar, under it on the ground; a new size is a milestone: a jump, a halo and a chime. */
    private updateSizeBar(): void {
        const { saucer, hud } = this;
        const reached = Math.max(0, saucer.radius - UFO.startRadius) / UFO.sizeStep;
        const level = 1 + Math.floor(reached);
        if (level > this.sizeLevel && this.phase === 'playing') {
            saucer.milestone();
            hud.bumpSizeBar();
            UfoAudio.milestone();
        }
        this.sizeLevel = level;
        // (The tutorial's first step shows only how to fly.)
        const waiting = this.mission?.tutorial && !this.bannerStarted;
        const at = saucer.isAlive && this.phase !== 'menu' && !waiting ? this.onHud(saucer.position.x, 0, saucer.position.y + saucer.radius * SIZE_BAR_AT) : null;
        hud.setSizeBar(at, reached - Math.floor(reached), level);
    }

    /** A small arrow in its colour for each saucer out of view; a gold one for an object to swallow. */
    private updateArrows(): void {
        let index = 0;
        const point = (x: number, z: number, color: number, hunting = false) => {
            const at = this.onHud(x, 0, z);
            const inView = !!at && this.hud.isInView(at.x, at.y);
            if (inView) return;
            const away = at ?? { x: Game.overlayScreenData.center.x + (x - this.saucer.position.x) * 100, y: Game.overlayScreenData.center.y + (z - this.saucer.position.y) * 100 };
            this.hud.setArrow(index++, away, color, hunting);
        };
        if (this.phase === 'playing') {
            for (const { saucer, color, rival } of this.contestants) {
                if (rival && saucer.isAlive) point(saucer.position.x, saucer.position.y, color, this.director?.isHunting(saucer) ?? false);
            }
            const goal = this.town.goalItem;
            if (this.mission?.type === 'object' && goal && !goal.gone) point(goal.x, goal.z, GOAL_ARROW);
        }
        for (let i = index; i < this.contestants.length + 1; i++) this.hud.setArrow(i, null, 0);
    }

    /** Everyone, best first: by size, or (a race) by points. */
    private ranking(): (PlayerLook & { size: number; you: boolean })[] {
        const race = this.mission?.type === 'race';
        const value = (contestant: Contestant) => (race ? this.pointsOf(contestant) : contestant.saucer.targetRadius);
        return [...this.contestants].sort((a, b) => value(b) - value(a))
            .map((contestant) => ({ name: contestant.name, face: contestant.face, color: contestant.color, size: value(contestant), you: contestant === this.you }));
    }

    /** A contestant's points: the player's score, a rival's own. */
    private pointsOf(contestant: Contestant): number {
        return contestant === this.you ? this.score : Math.floor(contestant.points);
    }

    /**
     * Each rival's name over it, coloured by whether it's a danger to the player, or food; and for the nearest ones out of
     * view, a marker at the screen's edge.
     */
    private updateTags(): void {
        const origin = bendUniforms.uBendOrigin.value;
        const strength = bendUniforms.uBendStrength.value;
        const outOfView: { player: Contestant; at: { x: number; y: number }; distance: number }[] = [];
        let index = 0;
        for (const player of this.contestants) {
            const { name, saucer, rival } = player;
            if (!rival) continue;
            const i = index++;
            if (!saucer.isAlive || this.phase !== 'playing') {
                this.hud.setTag(i, null, name, false, false);
                continue;
            }
            const dx = saucer.position.x - origin.x;
            const dz = saucer.position.y - origin.z;
            this.tagAt.set(saucer.position.x, saucer.altitude + saucer.radius * TAG_LIFT - (dx * dx + dz * dz) * strength, saucer.position.y);
            const screen = this.worldToScreen(this.tagAt);
            const at = screen ? this.hud.toLocal(new PIXI.Point(screen.x, screen.y)) : null;
            const inView = !!at && this.hud.isInView(at.x, at.y);
            this.hud.setTag(i, inView ? at : null, name, saucer.canEat(this.saucer), this.saucer.canEat(saucer));
            if (inView) continue;
            const distance = this.saucer.position.distanceTo(saucer.position);
            if (distance > MARKERS.range) continue;
            // Behind the camera it has no spot on the screen: its way on the ground instead (+Z is down the screen).
            const away = at ?? { x: Game.overlayScreenData.center.x + (saucer.position.x - this.saucer.position.x) * 100, y: Game.overlayScreenData.center.y + (saucer.position.y - this.saucer.position.y) * 100 };
            outOfView.push({ player, at: away, distance });
        }
        outOfView.sort((a, b) => a.distance - b.distance);
        for (let i = 0; i < MARKERS.most; i++) {
            const entry = outOfView[i];
            if (!entry) {
                this.hud.setMarker(i, null, 'neutral', null);
                continue;
            }
            const { saucer } = entry.player;
            const kind = saucer.canEat(this.saucer) ? 'danger' : this.saucer.canEat(saucer) ? 'food' : 'neutral';
            this.hud.setMarker(i, entry.at, kind, entry.player);
        }
    }

    /** The first time round, this session: how to move, how to eat, then what the rivals are about. */
    private updateHints(): void {
        const hint = (id: string, text: string, done: boolean): boolean => {
            if (hintsDone.has(id)) return false;
            if (done) {
                hintsDone.add(id);
                return false;
            }
            this.hud.hint(text);
            return true;
        };
        if (hint('move', 'DRAG OR USE THE ARROWS TO FLY', this.input.lengthSq() > 0)) {
            this.hud.showMoveHand(true);
            return;
        }
        this.hud.showMoveHand(false);
        this.hud.hint(null);
    }

    /** The round's clock, or (calm levels) the goal or the whole town. */
    private checkEnd(delta: number): void {
        const { round, goal } = this.level;
        const left = this.town.items.length + this.flying.length;
        // The map eaten (by anyone: what the rivals took doesn't have to be won back from them), with a little to spare
        // (UFO.completeShare): once the saucer's big, the last small things are too hard to spot.
        const allEaten = this.loaded && this.eaten > 0 && (left === 0 || this.townShare() >= UFO.completeShare);
        const allGone = allEaten;
        if (this.mission) {
            this.clock -= delta;
            if (this.mission.type === 'top') {
                if (this.clock <= 0 || allEaten) this.finishTop();
                return;
            }
            if (this.mission.type === 'race') {
                const ahead = this.target > 0 ? this.contestants.find((contestant) => contestant.rival && contestant.points >= this.target) : undefined;
                if (this.target > 0 && this.score >= this.target) this.finishMission(true);
                else if (ahead) this.finishMission(false, `${ahead.name.toUpperCase()} GOT THERE FIRST`);
                else if (this.mission.seconds > 0 && this.clock <= 0) this.finishMission(false);
                return;
            }
            const won = this.mission.type === 'points' ? this.target > 0 && this.score >= this.target
                : this.mission.type === 'object' && this.town.goalItem ? this.goalEaten : allEaten;
            if (won) this.finishMission(true);
            else if (this.mission.seconds > 0 && this.clock <= 0) this.finishMission(false);
            return;
        }
        if (this.roundSpec) {
            this.clock -= delta;
            if (this.clock <= 0 || allGone) this.finishRound();
            return;
        }
        const goalItem = this.town.goalItem;
        if (goalItem ? this.goalEaten : allGone) {
            this.stopPlaying();
            this.hud.showEnd({ title: goal && goalItem ? `${goal.name.toUpperCase()} SWALLOWED!` : 'TOWN ABDUCTED!', outcome: 'win', button: 'CONTINUE' });
        }
    }

    /** `why`: a lost race's (who got there first). */
    private finishMission(won: boolean, why?: string): void {
        this.stopPlaying();
        this.missionWon = won;
        const { mission } = this;
        if (!mission) return;
        const area = this.areaView(won);
        if (won) {
            const reward = mission.reward ?? 200;
            UfoProgress.addCoins(reward);
            if (mission.tutorial) UfoProgress.finishTutorial();
            else {
                // Kept at once: the next level's up, even if the game's closed on the end screen.
                UfoProgress.wonLevel(this.missionIndex);
                goToMission(this.missionIndex + 1);
            }
            this.hud.showEnd({ title: 'WELL DONE!', outcome: 'win', coins: reward, coinsTotal: UfoProgress.coins, button: 'CONTINUE', area });
        } else {
            this.hud.showEnd({ title: why ? 'TOO SLOW!' : 'TIME UP!', detail: why ?? mission.name.toUpperCase(), outcome: 'lose', button: 'TRY AGAIN', area });
        }
    }

    /** A `top` level's clock run out: first is a win; else where the player came, and again. */
    private finishTop(): void {
        const results = this.ranking();
        const place = results.findIndex((row) => row.you) + 1;
        if (place === 1) {
            this.finishMission(true);
            return;
        }
        this.stopPlaying();
        this.missionWon = false;
        const nth = `${place}${['ST', 'ND', 'RD'][place - 1] ?? 'TH'} PLACE`;
        const area = this.areaView(false);
        if (place <= 3) this.hud.showEnd({ title: nth, detail: 'COME FIRST TO WIN', outcome: 'place', emblem: place === 2 ? 'ItemIcon_Medal_Silver_1' : 'ItemIcon_Medal_Bronze_1', results, button: 'TRY AGAIN', area });
        else this.hud.showEnd({ title: nth, outcome: 'lose', results, button: 'TRY AGAIN', area });
    }

    /** The area bar for a story level's end: its area, the levels done (this one too, won), whether it's finished. */
    private areaView(won: boolean): { view: AreaView; complete: boolean } | undefined {
        const { mission } = this;
        if (!mission || mission.tutorial) return undefined;
        const where = areaProgress(this.missionIndex);
        const done = where.done + (won ? 1 : 0);
        return { view: { name: where.area.name, number: where.number, done, total: where.total, next: where.next?.name ?? null }, complete: won && done >= where.total };
    }

    private finishRound(): void {
        this.stopPlaying();
        if (this.contestants.length < 2) {
            const share = Math.floor((this.townShare()) * 100);
            this.hud.showEnd({
                title: share >= 100 ? 'TOWN ABDUCTED!' : `${share}% OF THE TOWN`, detail: `SIZE ${this.saucer.targetRadius.toFixed(1)}`,
                outcome: share >= SOLO_WIN ? 'win' : 'place', emblem: share >= SOLO_WIN ? undefined : 'ItemIcon_Medal_Bronze_1', button: 'CONTINUE',
            });
            return;
        }
        const results = this.ranking();
        const place = results.findIndex((row) => row.you) + 1;
        const nth = `${place}${['ST', 'ND', 'RD'][place - 1] ?? 'TH'} PLACE`;
        const button = 'CONTINUE';
        const starsWon = awardRound(place);
        // A versus match: trophies won or lost, coins by place; back home on VERSUS.
        let trophies: number | undefined;
        let coinsWon: number | undefined;
        if (this.arena) {
            trophies = trophiesFor(place);
            coinsWon = coinsFor(this.arena, place);
            UfoProgress.trophiesBefore = UfoProgress.trophies;
            UfoProgress.versusResult(place, trophies, coinsWon);
            UfoProgress.openVersusOnHome = true;
        } else {
            UfoProgress.openRankingOnHome = true;
        }
        if (place === 1) this.hud.showEnd({ title: 'VICTORY!', outcome: 'win', results, button, starsWon, trophies, coinsWon });
        else if (place <= 3) this.hud.showEnd({ title: nth, outcome: 'place', emblem: place === 2 ? 'ItemIcon_Medal_Silver_1' : 'ItemIcon_Medal_Bronze_1', results, button, starsWon, trophies, coinsWon });
        else this.hud.showEnd({ title: nth, outcome: 'lose', results, button, trophies, coinsWon });
    }

    private checkBump(): void {
        if (!this.saucer.bumped) return;
        this.saucer.warn();
        if (this.bumpTimer > 0 || this.input.lengthSq() === 0) return;
        this.bumpTimer = BUMP_EVERY;
        UfoAudio.bump();
    }

    /** What's under a saucer: eaten if it fits and the saucer's above it. A rival at its size cap's stopped eating. */
    private checkItems(contestant: Contestant): void {
        const { saucer } = contestant;
        if (!saucer.isAlive || contestant.rival?.capped) return;
        const { radius, altitude, position } = saucer;
        const isYou = contestant === this.you;
        for (let i = this.town.items.length - 1; i >= 0; i--) {
            const item = this.town.items[i];
            if (Math.hypot(item.x - position.x, item.z - position.y) > radius) continue;
            // An object to swallow is the player's alone.
            if (item.goal && this.mission?.type === 'object' && !isYou) continue;
            if (item.height > altitude) {
                if (isYou) saucer.warn();
            } else if (item.radius <= radius) {
                if (!isYou && !this.isThingOnScreen(item)) this.pretendToEat(item, contestant);
                else this.eat(item, contestant);
            } else if (isYou) {
                saucer.warn();
            }
        }
    }

    private isThingOnScreen(item: Item): boolean {
        return this.isSpotOnScreen(item.x, item.z);
    }

    /** Out of sight, a rival grows as if it ate the thing, and the thing stays: the player can't run out because of it. */
    private pretendToEat(item: Item, contestant: Contestant): void {
        const now = performance.now() / 1000;
        if (item.sparedUntil !== undefined && item.sparedUntil > now) return;
        item.sparedUntil = now + DESIGN.scarcity.offscreenCooldown;
        contestant.saucer.grow(item.value);
        contestant.points += pointsOf(item) * RACE_PACE;
    }

    /** Whether things eaten here ever come back: not where eating everything is the point. */
    private restoresThings(): boolean {
        return this.mission ? this.mission.type !== 'all' : Boolean(this.roundSpec);
    }

    /** Things come back, out of sight and near the player, if it's going short. */
    private updateScarcity(delta: number): void {
        this.sinceEaten += delta;
        this.sinceRestore += delta;
        const settings = DESIGN.scarcity;
        if (!this.loaded || !this.restoresThings() || this.sinceRestore < settings.every || !this.eatenProps.length) return;
        const { radius, altitude, position } = this.saucer;
        const eatable = this.town.items.filter((item) => item.radius <= radius && item.height <= altitude).length;
        const left = this.town.items.reduce((sum, item) => sum + pointsOf(item), 0);
        const pointsShort = (this.mission?.type === 'points' || this.mission?.type === 'race') && this.score + left * settings.riskShare < this.target;
        if (this.sinceEaten < settings.droughtSeconds && eatable >= settings.minEatable && !pointsShort) return;
        const worth = ({ prop, value }: { prop: Prop; value: number }) => Math.sqrt(value + 0.5) / (Math.hypot(prop.x - position.x, prop.z - position.y) + 10);
        const picks = this.eatenProps
            .filter(({ prop, radius: size, height }) => size <= radius && height <= altitude && !this.isSpotOnScreen(prop.x, prop.z))
            .sort((a, b) => worth(b) - worth(a))
            .slice(0, settings.batch);
        if (!picks.length) return;
        this.sinceRestore = 0;
        this.sinceEaten = 0;
        for (const pick of picks) {
            this.eatenProps.splice(this.eatenProps.indexOf(pick), 1);
            void this.town.restore(pick.prop);
        }
    }

    private isSpotOnScreen(x: number, z: number): boolean {
        const at = this.onHud(x, 0, z);
        return !!at && this.hud.isInView(at.x, at.y);
    }

    /** A higher saucer with another's middle under its beam eats it. */
    private checkSaucers(): void {
        for (const eater of this.contestants) {
            if (!eater.saucer.isAlive) continue;
            for (const prey of this.contestants) {
                if (prey === eater || !eater.saucer.canEat(prey.saucer)) continue;
                if (eater.saucer.position.distanceTo(prey.saucer.position) > eater.saucer.radius) continue;
                if (prey === this.you && !this.director?.mayEatPlayer(eater.saucer)) continue;
                prey.saucer.abductBy(eater.saucer);
                prey.respawn = DESIGN.rivals.respawnSeconds;
                eater.saucer.absorb(prey.saucer.targetRadius);
                this.handOver(prey, eater);
                if (prey === this.you) {
                    this.director?.onPlayerEaten();
                    this.sayTimer = SAY_EVERY;
                    this.hud.say(`${eater.name.toUpperCase()} ATE YOU!`);
                    UfoAudio.bump();
                } else if (eater === this.you) {
                    this.onKill(prey);
                    UfoAudio.kill();
                } else {
                    eater.points += KILL.points;
                }
            }
        }
    }

    /** A level to eat everything: what the eaten one had eaten goes to the eater, so the whole town can still be had. */
    private handOver(prey: Contestant, eater: Contestant): void {
        if (!this.gentle) return;
        const { count, points, value } = prey.held;
        prey.held = { count: 0, points: 0, value: 0 };
        if (eater === this.you) {
            this.eaten += count;
            this.score += points;
            if (value > 0) eater.saucer.grow(value);
        } else {
            eater.held.count += count;
            eater.held.points += points;
            eater.held.value += value;
        }
    }

    /** The player ate a saucer: points, the count, and a shout for the streak. */
    private onKill(prey: Contestant): void {
        this.kills++;
        this.streak = this.streakTimer > 0 ? this.streak + 1 : 1;
        this.streakTimer = KILL.streakSeconds;
        this.score += KILL.points;
        const at = this.onHud(prey.saucer.position.x, prey.saucer.altitude, prey.saucer.position.y);
        if (!at) return;
        this.hud.popPoints(at.x, at.y, `+${KILL.points}`, true);
        const shout = this.mission ? KILL.shouts[Math.min(this.streak, KILL.shouts.length) - 1] : `YOU ATE ${prey.name.toUpperCase()}!`;
        this.hud.shout(shout, at.x, at.y);
    }

    /** The eaten come back: smaller, somewhere clear, and safe for a moment. */
    private updateRespawns(delta: number): void {
        for (const contestant of this.contestants) {
            if (contestant.respawn <= 0) continue;
            contestant.respawn -= delta;
            if (contestant.respawn > 0) continue;
            const others = this.contestants.filter((other) => other !== contestant).map(({ saucer }) => saucer.position);
            const at = this.town.findOpenSpot(others, SPAWN_APART);
            contestant.saucer.respawn(at.x, at.y, Math.max(UFO.startRadius, contestant.saucer.targetRadius * (contestant === this.you ? DESIGN.rivals.playerKeeps : DESIGN.rivals.respawnSize)), DESIGN.rivals.protectSeconds);
        }
    }

    private eat(item: Item, eater: Contestant): void {
        this.town.take(item);
        if (item.prop && !item.goal) this.eatenProps.push({ prop: item.prop, radius: item.radius, height: item.height, value: item.value });
        this.cars.release(item);
        this.people.release(item);
        const world = item.object.getWorldPosition(new THREE.Vector3());
        const points = pointsOf(item);
        if (eater === this.you) {
            const at = this.onHud(item.x, Math.min(item.height, eater.saucer.altitude), item.z);
            if (at) this.hud.popPoints(at.x, at.y, `+${points}`, points >= BIG_POINTS);
        }
        // Out of the fade's care, and from now on a thing of its own to scale.
        this.flying.push({
            item, points, eater, time: 0, duration: FLIGHT.base + FLIGHT.perHeight * item.height,
            from: world, scale: item.object.scale.clone(),
        });
        eater.flying++;
        this.threeScene.attach(item.object);
        if (item.goal && this.roundLike) {
            this.sayTimer = SAY_EVERY;
            this.hud.say(eater === this.you ? `YOU SWALLOWED THE ${this.level.goal?.name.toUpperCase()}!` : `${eater.name.toUpperCase()} SWALLOWED THE ${this.level.goal?.name.toUpperCase()}!`);
        }
    }

    /** Up into the saucer, spinning and shrinking; the bite counts when it gets there. */
    private updateFlying(delta: number): void {
        for (let i = this.flying.length - 1; i >= 0; i--) {
            const flight = this.flying[i];
            const { saucer } = flight.eater;
            const target = saucer.worldPosition(this.saucerAt);
            flight.time += delta;
            const t = Math.min(1, flight.time / flight.duration);
            // Slow to come away, then whipped in.
            const pull = t * t * t;
            const { object } = flight.item;
            object.position.lerpVectors(flight.from, target, pull);
            // Drawn out like a noodle: thin at once, long in the middle of the way, gone at the end.
            const thin = Math.max(SLURP.thin, 1 - t * t * (1 - SLURP.thin));
            const long = Math.max(SLURP.thin, (1 + Math.sin(t * Math.PI) * SLURP.stretch) * (1 - pull));
            object.scale.set(flight.scale.x * thin, flight.scale.y * long, flight.scale.z * thin);
            object.rotation.y += FLIGHT_SPIN * delta;
            if (t < 1) continue;
            this.flying.splice(i, 1);
            flight.eater.flying--;
            object.removeFromParent();
            flight.item.materials?.forEach((material) => material.dispose());
            if (flight.eater !== this.you) flight.eater.points += flight.points * RACE_PACE;
            if (this.gentle && flight.eater !== this.you) {
                flight.eater.held.count++;
                flight.eater.held.points += flight.points;
                flight.eater.held.value += flight.item.value;
            } else {
                this.eaten++;
            }
            if (flight.item.goal) this.goalEaten = true;
            // The player's first size-up comes quickly.
            const onFirstSize = flight.eater === this.you && saucer.targetRadius < UFO.startRadius + UFO.sizeStep;
            saucer.grow(flight.item.value * (onFirstSize ? UFO.firstSizeBoost : 1));
            if (flight.eater === this.you) {
                this.sinceEaten = 0;
                this.score += flight.points;
                UfoAudio.eat(Math.min(1, flight.item.radius / Math.max(saucer.radius, 1e-3)));
            }
        }
    }

    /** Steeper as the saucer grows: from above, its height over the ground doesn't push it up and off from its beam. */
    private cameraPitch(): number {
        const grown = THREE.MathUtils.smoothstep(this.saucer.radius, UFO.startRadius, CAMERA.endPitchRadius);
        return THREE.MathUtils.degToRad(THREE.MathUtils.lerp(CAMERA.pitchDeg, CAMERA.endPitchDeg, grown));
    }

    /** The usual pull-back, or further if the saucer would fill more than `maxShare` of the screen's narrower side. */
    private cameraDistance(): number {
        const { aspect } = this.threeCamera;
        const { radius, altitude } = this.saucer;
        const portrait = Math.pow(Math.max(1, REFERENCE_ASPECT / aspect), PORTRAIT_PULL);
        const rivals = this.contestants.length > 1 ? CAMERA.rivalsZoom : 1;
        const usual = (CAMERA.distance + CAMERA.perAltitude * altitude) * portrait * rivals;
        // The saucer's nearer than the focus by its height over it, so that's added back.
        const halfSide = Math.tan(THREE.MathUtils.degToRad(CAMERA.fov / 2)) * Math.min(1, aspect);
        const nearer = altitude * (1 - CAMERA_LOOK_HEIGHT) * Math.sin(this.cameraPitch());
        return Math.max(usual, radius / (CAMERA.maxShare * halfSide) + nearer);
    }

    private updateCamera(delta: number): void {
        const { x, y: z } = this.saucer.position;
        this.goal.set(x, this.saucer.altitude * CAMERA_LOOK_HEIGHT, z);
        if (!this.introDone) {
            this.focus.copy(this.goal);
            this.distance = THREE.MathUtils.lerp(this.introDistance, this.cameraDistance(), this.introShare);
        } else {
            this.focus.lerp(this.goal, 1 - Math.exp(-CAMERA.followSpeed * delta));
            this.distance += (this.cameraDistance() - this.distance) * (1 - Math.exp(-CAMERA.zoomSpeed * delta));
        }
        this.placeCamera();
        // Eased off as it pulls back, or the view's wider reach would curve the world harder and harder.
        updateBend(this.focus, CAMERA.bend * Math.min(1, this.startDistance / this.distance));
    }

    private placeCamera(): void {
        const pitch = this.introPitch ?? this.cameraPitch();
        this.threeCamera.position.set(this.focus.x, this.focus.y + Math.sin(pitch) * this.distance, this.focus.z + Math.cos(pitch) * this.distance);
        this.threeCamera.lookAt(this.focus);
    }

    public resize(): void {
        this.hud?.reposition();
    }

    public destroy(): void {
        // (Calling it when already stopped does nothing.)
        void PlatformHandler.instance.platform.gameplayStop();
        window.removeEventListener('pointerdown', this.onAnyPointerDown, true);
        window.removeEventListener('pointercancel', this.releaseStick, true);
        window.removeEventListener('blur', this.releaseStick);
        gsap.killTweensOf(this.hud);
        window.removeEventListener('pointerdown', this.startSound, true);
        window.removeEventListener('keydown', this.startSound, true);
        this.spatial?.destroy();
        UfoAudio.setSucking(false);
        UfoAudio.setHum(0);
        DebugOverlay.instance.removePanel(this.debugPanelId);
        this.keyboard?.destroy();
        this.analog?.destroy();
        this.hud?.destroy();
        this.cars?.destroy();
        this.people?.destroy();
        this.town?.destroy();
        for (const { saucer } of this.contestants) saucer.destroy();
        this.homeArrows?.destroy();
        for (const { item } of this.flying) item.materials?.forEach((material) => material.dispose());
        super.destroy();
    }
}
