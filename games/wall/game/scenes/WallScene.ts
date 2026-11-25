// WallScene.ts
//
// The game: a wall fills the screen; tap anywhere and the player hits it there (Hands), and the cells there break off
// (VoxelWall). Enough of it gone and it comes down; the next one, seen all along through the hole, comes up. Cash comes off
// every hit; PUNCH HARDER makes the hits harder and puts tools in the player's hand, the crew (Crew) hits on its own, the weak
// spot (WeakSpot) pays for a good aim.
//
// The wall's the same size on any screen (a portrait block, all of it in sight); what's round it (Tunnel) doesn't break.
//
// Any tap does something: through a hole, the nearest cell. Two fingers are two punches.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import gsap from 'gsap';
import { Game } from 'core/Game';
import ModelLoaderManager from 'core/three/ModelLoaderManager';
import { createGLTFLoader } from 'core/three/GLTFLoaders';
import PlatformHandler from 'core/platforms/PlatformHandler';
import SetupThree from 'core/scene/SetupThree';
import { ThreeScene } from 'core/scene/ThreeScene';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import { WallAudio } from '../audio/WallAudio';
import { Gameplay } from '../ads/Gameplay';
import { WallAnalytics } from '../analytics/WallAnalytics';
import { buildEffectsPanel, fx } from '../config/Effects';
import { Crew } from '../crew/Crew';
import { BoostDef, CAMERA, CASH, CREW, CrewDef, TOOL_TYPES, MEDAL, WALL, WEAK, ENEMIES, bossAt, bossKind, bossNumber, enemiesOn, enemyModels, fightAt, fightModels, isBossWall, short, switchEnemies, toolAt, toolsUpTo, medalsOf, wallAt } from '../data/WallConfig';
import { wornLook } from '../data/Looks';
import { ModelQueue, ModelWant } from '../data/ModelQueue';
import { WallProgress } from '../data/WallProgress';
import { Hands, ToolLook } from '../player/Hands';
import { TRAY_TOP } from '../ui/Tray';
import { BAR_FOOT, WallHud } from '../ui/WallHud';
import { Enemies, Enemy } from '../enemies/Enemies';
import { Fight } from '../enemies/Fight';
import { Debris } from '../wall/Debris';
import { Bite, Cell, VoxelWall } from '../wall/VoxelWall';
import { HitMark } from '../wall/HitMark';
import { Tunnel, WALL_HEIGHT, WALL_WIDTH } from '../wall/Tunnel';
import { WeakSpot } from '../wall/WeakSpot';

const MODELS = './wall/models/player/';
/** The models got ahead: the fights (so many, within so many walls), the tools, the crew (by wall); looked into every so often (seconds). */
const MODELS_AHEAD = { walls: 6, fights: 2, tools: 2, crew: 2, every: 1 };
const CREW_MODELS = './wall/models/crew/';
/** The dark the next gate stands in (the fog: from a little past the wall, to all dark past the next one). */
const DARK = { from: 2.5, to: 1.45 };
/** The light: from all round (the sky's and what comes up off the floor), and the sun. */
const LIGHT = { sky: 0xffffff, ground: 0xb8a8e0, around: 2.05, sun: 0xfffaf0, strength: 2.35 };
/** Pieces flying off a hit, at most; those falling; and when it all comes down. */
const PIECES = { hit: 14, fallen: 22, collapse: 240, crew: 3, coins: 36 };
const COIN = new THREE.Color(0xffc93a);
/** The crew's hits are heard, and their numbers seen, this often at most (seconds). */
const CREW_EVERY = { sound: 0.09, number: 0.22 };
/** How the crew bites. */
const PLAIN: Bite = { wide: 1, deep: 1 };
/** A hand's aim is kept this far inside the wall's edges. */
const INSET = 0.12;
/** Time nearly stops this long (seconds) on a big hit, and when the wall comes down. */
const HIT_STOP = { big: 0.03, collapse: 0.09 };
/** A hit that takes this share of the wall is a big one. */
const BIG_HIT = 0.2;
/** After a wall: its burst, then the player walks through to the next one (`bob`: its steps, how many and how high). */
const ADVANCE = { wait: 0.6, seconds: 1.35, steps: 4, bob: 0.16 };
/** A gift's been seen after this long (seconds). */
const GIFT_SEEN_SEC = 2.2;
/** A boss that got away has been seen to after this long (seconds). */
const LOST_SEEN_SEC = 2.6;
/** New looks are held up this long (seconds). */
const FLAUNT_SEC = 1.7;
/** The hands rest no lower than this share of the screen's height (and so, with nothing to buy yet). */
const HANDS_LOWEST = 0.1;
/** This much lower in a fight. */
const HANDS_FIGHT = 0.075;
/** The mark a hit leaves: how far off the wall it's drawn, the smallest, its colours. */
const MARK = { front: 0.16, least: 0.45, plain: 0xffffff, big: 0xffe14a, weak: 0xff8a3a };
/** What flies off an enemy. */
const ENEMY_DUST = new THREE.Color(0xe8dcc0);
const MAX_FRAME_SEC = 0.1;

interface Landing {
    inSec: number;
    x: number;
    y: number;
    /** It was aimed at the weak spot. */
    weak: boolean;
    /** It was aimed at one of the enemies. */
    enemy?: Enemy;
}

export default class WallScene extends ThreeScene {
    private hud!: WallHud;
    private readonly tapZone = new PIXI.Container();
    private readonly hands = new Hands();
    private readonly debris = new Debris();
    private readonly tunnel = new Tunnel();
    private readonly mark = new HitMark();
    private readonly around = new THREE.HemisphereLight(LIGHT.sky, LIGHT.ground, LIGHT.around);
    private readonly sun = new THREE.DirectionalLight(LIGHT.sun, LIGHT.strength);
    private readonly weak = new WeakSpot();
    private readonly crew = new Crew({
        target: (x, out) => {
            if (this.phase === 'fighting') return this.fight.enemies.target(x, out);
            return this.phase === 'playing' ? this.wall.spotNear(x, 0.4 + 5 * Math.random() ** 1.6, 4, out) : null;
        },
        hit: (def, at, damage) => this.crewHit(def, at, damage),
    });
    private readonly fight = new Fight(new Enemies(), {
        won: (boss) => this.fightWon(boss),
        lost: () => this.bossLost(),
        bossComes: (name) => this.bossComes(name),
    });
    private flauntFor = 0;
    private crewSound = 0;
    private crewNumber = 0;
    private wall!: VoxelWall;
    /** The next one, waiting in the dark; and the way there walked (0 to 1). */
    private next!: VoxelWall;
    private walked = 0;
    private phase: 'playing' | 'falling' | 'fighting' | 'advancing' | 'previewing' = 'playing';
    /** Debug: the boss looked at, after how many rewinds. */
    private readonly look = { boss: 0, rewinds: 0 };
    private landings: Landing[] = [];
    private time = 0;
    private stopFor = 0;
    private started = false;
    private destroyed_ = false;
    private modelsReady: Promise<void> = Promise.resolve();
    /** The models that come once there's something to see (not asked for until then), and whether it's being played yet. */
    private readonly models = new ModelQueue(() => this.wantedModels());
    private modelsWait = Infinity;
    private begun = false;
    /** The camera's place. */
    private readonly home = new THREE.Vector3();
    private readonly raycaster = new THREE.Raycaster();
    private readonly ndc = new THREE.Vector2();
    private shake = 0;
    private readonly drawn = { calls: 0, triangles: 0 };

    public get ready(): Promise<void> {
        return this.modelsReady;
    }

    public build(): void {
        this.threeScene.background = this.tunnel.dark;
        this.threeScene.fog = new THREE.Fog(0, 1, 100);
        this.sun.position.set(-3.5, 6.5, 10);
        this.threeScene.add(this.around, this.sun);
        this.threeScene.add(this.tunnel.group, this.mark.group, this.debris.group, this.crew.group, this.fight.enemies.group, this.weak.group);
        // (What was behind it isn't any more: switched off since.)
        if (WallProgress.fighting && !fightAt(WallProgress.wall)) WallProgress.nextWall();
        this.buildWall();
        this.game.uiLayer.addChild(this.tapZone);
        this.tapZone.eventMode = 'static';
        this.tapZone.on('pointerdown', this.onTap, this);
        this.hud = new WallHud({
            punch: () => this.punchHarder(),
            hire: (def) => this.hire(def),
            boost: (boost) => this.buyBoost(boost),
            rewind: () => this.rewind(),
            flaunt: () => this.flaunt(),
            retryBoss: () => this.retryBoss(),
        }, {
            changed: () => this.dress(),
            show: (on) => this.hands.show(on),
            picture: (look, size) => this.hands.picture(SetupThree.renderer, look, size),
        });
        this.game.uiLayer.addChild(this.hud);
        const medal = new PIXI.Sprite(PIXI.Texture.from('ItemIcon_Badge_Gold'));
        this.tunnel.setMedal(this.game.app.renderer.extract.canvas(medal) as HTMLCanvasElement);
        const skull = new PIXI.Sprite(PIXI.Texture.from('ItemIcon_Skull'));
        this.tunnel.setSkull(this.game.app.renderer.extract.canvas(skull) as HTMLCanvasElement);
        this.showWall();
        this.modelsReady = this.loadModels();
        this.hands.wearLook(wornLook());
        this.applyTool(true);
        window.addEventListener('keydown', this.onKey);
        window.addEventListener('pointerdown', this.onFirst, true);
        window.addEventListener('keydown', this.onFirst, true);
        // (Not while one's falling and the next coming up: that one's whole.)
        WallProgress.setWallState(() => (this.phase === 'playing' ? { seed: this.wall.seed, gone: this.wall.save() } : undefined));
        this.crew.refresh(true);
        this.handOut(true);
        this.buildDebug();
        buildEffectsPanel();
        this.resize();
        this.hud.setTapHint(WallProgress.wall === 1 && this.wall.share >= 1);
        this.placeTapHint();
        // (Left in the middle of a fight: its wall's down.)
        if (WallProgress.fighting) {
            this.wall.collapse();
            this.startFight();
        }
    }

    // ---------------------------------------------------------------- walls

    private buildWall(): void {
        const number = WallProgress.wall;
        const { hp, material } = wallAt(number);
        const saved = WallProgress.savedWall;
        // (A hole from another size of wall is dropped: a whole one then.)
        this.wall = new VoxelWall(material, hp, this.seedOf(number), WALL.cols, saved?.seed === this.seedOf(number) ? saved.gone : undefined);
        this.threeScene.add(this.wall.group);
        this.tunnel.setRoom(material.room, material.accent, material.hue, true);
        this.buildNext(number + 1);
    }

    private seedOf(number: number): number {
        return number * 7919 + 17;
    }

    /** The next wall, waiting in its gate in the dark. */
    private buildNext(number: number): void {
        this.next?.dispose();
        const { hp, material } = wallAt(number);
        this.next = new VoxelWall(material, hp, this.seedOf(number), WALL.cols);
        this.next.group.position.z = -WALL.gap;
        this.threeScene.add(this.next.group);
    }

    private showWall(): void {
        this.hud.setWall(WallProgress.wall, wallAt(WallProgress.wall).material.name);
        this.hud.setShare(this.wall.share);
        this.tunnel.setBoss(isBossWall(WallProgress.wall), isBossWall(WallProgress.wall + 1));
        this.tunnel.showMedal(this.phase === 'playing' && WallProgress.wall >= MEDAL.wall);
    }

    private bringDown(): void {
        this.phase = 'falling';
        this.landings = [];
        this.weak.hide();
        const number = WallProgress.wall;
        const { hp, material } = wallAt(number);
        const cells = this.wall.collapse();
        const every = Math.max(1, Math.ceil(cells.length / PIECES.collapse));
        cells.forEach((cell, i) => {
            if (i % every === 0) this.debris.throw(cell.position, cell.color, WALL.cell * material.chip * 1.25, 1.15 + Math.random() * 0.8);
        });
        for (let i = 0; i < 8; i++) {
            this.debris.puff(new THREE.Vector3((Math.random() - 0.5) * 6, 1 + Math.random() * 7, -0.5 + Math.random()), material.dust, 4 + Math.random() * 3, 0.9);
        }
        const bonus = Math.round(hp * CASH.wallBonus * this.cashMult());
        for (let i = 0; i < PIECES.coins; i++) {
            this.debris.throw(new THREE.Vector3((Math.random() - 0.5) * WALL_WIDTH * 0.7, 1 + Math.random() * 3, 0.2), COIN, 0.17, 1.25);
        }
        WallProgress.addCash(bonus);
        // Something behind it: it's still this wall till that's beaten.
        const fight = fightAt(number);
        const bricks = fight ? 0 : WallProgress.nextWall();
        if (fight) WallProgress.startFight();
        WallAnalytics.wallDown(number);
        this.hud.tray.won(this.toHud(0, 0.1));
        this.hud.setShare(0);
        this.hud.flashScreen(0.75, 0.35);
        this.hud.announce(`WALL ${number} DESTROYED!`, bricks ? `+$${short(bonus)}   +${bricks} BRICKS` : `+$${short(bonus)}`, 0.95);
        this.stopFor = HIT_STOP.collapse * fx('hitStop');
        this.shake = 1;
        WallAudio.play('collapse');
        WallAudio.play('boom');
        gsap.delayedCall(0.25, () => WallAudio.play('coins'));
        this.vibrate(60);
        gsap.delayedCall(ADVANCE.wait, () => {
            if (this.destroyed_) return;
            if (fight) this.startFight();
            else this.advance();
        });
    }

    // ---------------------------------------------------------------- what's behind some of them

    private startFight(): void {
        this.phase = 'fighting';
        this.landings = [];
        const number = WallProgress.wall;
        const kind = fightAt(number);
        if (!kind) return;
        this.fight.start(number, WallProgress.farming);
        if (!WallProgress.farming) WallAnalytics.fight(kind, number, 'start');
        if (kind === 'minions') this.hud.announce('ENEMIES!', 'PUNCH THEM', 0.8);
        this.showFight();
    }

    private bossComes(name: string): void {
        WallAudio.play('boom', 1, 0.8);
        this.hud.announce(`${name}!`, `BEAT IT IN ${ENEMIES.boss.seconds} SECONDS`, 1.5);
    }

    /** Its time's up: it's gone, its minions come till it's called back. */
    private bossLost(): void {
        WallAnalytics.fight('boss', WallProgress.wall, 'fail');
        this.weak.reset();
        this.puffs(0xd8b0ff, 6);
        WallAudio.play('error');
        this.hud.announce('IT GOT AWAY!', 'GET STRONGER AND TRY AGAIN', 1.6);
        // (And that's one way to.)
        this.offerRewind(LOST_SEEN_SEC);
    }

    private retryBoss(): void {
        if (this.phase !== 'fighting' || !this.fight.farming || this.hud.busy) return;
        WallProgress.setFarming(false);
        WallAnalytics.fight('boss', WallProgress.wall, 'start');
        this.puffs(0xd8b0ff, 4);
        this.fight.retry();
        this.showFight();
    }

    /** All beaten: what that's worth, and on to the next wall. */
    private fightWon(boss: boolean): void {
        const number = WallProgress.wall;
        WallAnalytics.fight(boss ? 'boss' : 'minions', number, 'complete');
        this.weak.reset();
        this.hud.setFight();
        this.phase = 'falling';
        this.landings = [];
        let words = '';
        if (boss) {
            const { cash, bricks, medals } = ENEMIES.boss;
            const bonus = Math.round(wallAt(number).hp * cash * this.cashMult());
            WallProgress.addCash(bonus);
            WallProgress.bossReward(bricks, number >= MEDAL.wall ? medals : 0);
            words = `+$${short(bonus)}   +${bricks} BRICKS`;
            this.hud.tray.won(this.toHud(0, 0.1));
            this.hud.flashScreen(0.5, 0.3);
            WallAudio.play('collapse');
            this.shake = 0.8;
            this.vibrate(60);
        } else {
            this.hud.tray.won(this.toHud(0, -0.1));
        }
        WallProgress.nextWall();
        WallAudio.play('coins');
        this.hud.announce(boss ? `${bossKind(number, WallProgress.rewinds).name} BEATEN!` : 'CLEAR!', words, boss ? 1.4 : 0.6);
        gsap.delayedCall(boss ? 1 : 0.35, () => {
            if (!this.destroyed_) this.advance();
        });
    }

    private puffs(color: number, count: number): void {
        for (let i = 0; i < count; i++) this.debris.puff(new THREE.Vector3((Math.random() - 0.5) * 3, 0.6 + Math.random() * 3.4, -0.4 + Math.random() * 0.6), color, 2.4 + Math.random() * 2, 0.6);
    }

    /** The fight on the HUD. */
    private showFight(): void {
        const { fight } = this;
        if (!fight.on) return;
        const timed = fight.kind === 'boss' && !fight.farming;
        this.hud.setFight({ title: fight.title, boss: fight.kind === 'boss', retry: fight.farming, ...(timed ? { seconds: fight.timeLeft, timeShare: fight.timeShare } : {}) });
        this.hud.setShare(fight.share);
    }

    /** A hit on one of the enemies, at a spot on the screen. */
    private landOnEnemy(entry: Landing): void {
        const enemy = entry.enemy?.alive ? entry.enemy : this.fight.enemies.pick(entry.x, entry.y, this.threeCamera)?.enemy;
        if (!enemy) return;
        const weak = entry.weak && this.weak.visible;
        const combo = this.weak.left > 0 ? WallProgress.comboMult(this.weak.combo) : 1;
        this.strikeEnemy(enemy, WallProgress.damage * combo * (weak ? WallProgress.weakMult : 1), weak, entry);
        const tool = WallProgress.tool;
        WallAudio.play(tool.base === 'fists' ? 'hit-soft' : 'hit-wood', weak ? 1.2 : 1);
        this.vibrate(weak ? 22 : 12);
        if (weak) {
            const step = this.weak.hit();
            WallAudio.play('hit-glass', 1.2, 1.2 + Math.min(8, step) * 0.08);
            WallAnalytics.step('weak-spot');
            WallAnalytics.combo(step);
        }
    }

    /** Damage to one, by the player (at a spot on the screen) or the crew. */
    private strikeEnemy(enemy: Enemy, damage: number, weak: boolean, by?: { x: number; y: number }): void {
        const middle = enemy.middle(new THREE.Vector3());
        const { dealt, killed } = this.fight.damage(enemy, damage, !!by);
        const pay = dealt * CASH.perDamage * this.cashMult() + (killed && !enemy.spec.boss ? enemy.spec.hp * ENEMIES.minions.cash * this.cashMult() : 0);
        WallProgress.addCash(pay);
        const color = ENEMY_DUST;
        if (by) {
            // (Where the hand was, on its front.)
            this.raycaster.setFromCamera(this.ndc.set(by.x, by.y), this.threeCamera);
            const { origin, direction } = this.raycaster.ray;
            const at = origin.clone().addScaledVector(direction, (MARK.front - origin.z) / direction.z);
            this.mark.show(at, Math.max(MARK.least, enemy.spec.height * 0.22), weak ? MARK.weak : MARK.plain);
            for (let i = 0; i < (weak ? 8 : 4); i++) this.debris.throw(at, color, 0.12, 0.9, at);
            const spot = this.toHud(by.x, by.y);
            this.hud.float(short(Math.max(1, dealt)), spot.x, spot.y, weak ? 0xff8a3a : 0xffffff, weak ? 1.6 : 1);
        } else {
            this.debris.puff(middle.clone().setZ(middle.z + enemy.spec.height * 0.4), 0xfff0d8, 0.9, 0.3);
            if (this.crewNumber <= 0) {
                this.crewNumber = CREW_EVERY.number;
                const on = middle.clone().project(this.threeCamera);
                const spot = this.toHud(on.x, on.y);
                this.hud.float(short(Math.max(1, dealt)), spot.x, spot.y, 0xa8e6ff, 0.62);
            }
        }
        if (!killed) return;
        WallAudio.play('break', enemy.spec.boss ? 1.2 : 0.7);
        for (let i = 0; i < (enemy.spec.boss ? 60 : 12); i++) this.debris.throw(middle, i % 3 ? color : COIN, enemy.spec.boss ? 0.22 : 0.14, 1.1, middle);
        this.debris.puff(middle, 0xfff0d8, enemy.spec.height * 1.8, 0.55);
        if (enemy.spec.boss) this.stopFor = HIT_STOP.collapse * fx('hitStop');
    }


    /** Through the gate, to the next wall (the crew runs along); there, everything's moved back by a gap. */
    private advance(): void {
        this.phase = 'advancing';
        this.mark.clear();
        this.wall.dispose();
        this.wall = this.next;
        const { material } = wallAt(WallProgress.wall);
        this.hud.setWall(WallProgress.wall, material.name);
        this.hud.setShare(1);
        this.tunnel.setRoom(material.room, material.accent, material.hue);
        this.takeMedal();
        gsap.to(this, { walked: 1, duration: ADVANCE.seconds, ease: 'power2.inOut', onComplete: () => {
            if (!this.destroyed_) this.arrive();
        } });
    }

    /** The medal that was behind the wall flies to where they're counted. */
    private takeMedal(): void {
        const at = this.tunnel.takeMedal();
        if (!at) return;
        at.project(this.threeCamera);
        const number = WallProgress.wall - 1;
        this.hud.flyMedals(this.toHud(at.x, at.y), medalsOf(number) + (isBossWall(number) ? ENEMIES.boss.medals : 0));
        WallAnalytics.step('first-medal');
    }

    private arrive(): void {
        this.walked = 0;
        this.wall.group.position.z = 0;
        this.debris.shift(WALL.gap);
        this.next = undefined as unknown as VoxelWall;
        this.buildNext(WallProgress.wall + 1);
        this.phase = 'playing';
        this.showWall();
        WallAnalytics.wallStart(WallProgress.wall);
        const given = this.handOut();
        // (Once any gift's been seen.)
        const wait = given ? GIFT_SEEN_SEC : 0;
        const number = WallProgress.wall;
        if (isBossWall(number)) gsap.delayedCall(wait, () => {
            if (!this.destroyed_ && this.phase === 'playing' && WallProgress.wall === number) this.hud.announce('BOSS GATE!', `${bossKind(number, WallProgress.rewinds).name} IS BEHIND IT`, 1.3);
        });
        // (Not at a boss's gate: there's the boss to see first.)
        else this.offerRewind(wait);
    }

    /** Rewinding, the first time ever it's there to do: what it is, in a while. (From then on it's the player's to choose.) */
    private offerRewind(wait: number): void {
        if (!WallProgress.canRewind || WallProgress.rewinds > 0 || !WallProgress.markStep('rewind-offer-0')) return;
        gsap.delayedCall(wait, () => {
            if (!this.destroyed_ && WallProgress.canRewind && !this.hud.busy) this.hud.rewindPopup.setOpen(true);
        });
    }

    // ---------------------------------------------------------------- hitting

    private onTap(event: PIXI.FederatedPointerEvent): void {
        this.punchAt((event.global.x / window.innerWidth) * 2 - 1, 1 - (event.global.y / window.innerHeight) * 2);
    }

    private readonly onKey = (event: KeyboardEvent): void => {
        if (event.repeat) return;
        if (event.code === 'Escape') this.hud.rewindPopup.setOpen(false);
        if (event.code === 'Space') this.punchAt((Math.random() - 0.5) * 0.3, 0.15 + (Math.random() - 0.5) * 0.3);
        else if (event.code === 'Escape') this.hud.wardrobe.setOpen(false);
        else if (/^Digit[1-4]$/.test(event.code)) this.hud.tray.buyNumber(Number(event.code.slice(5)) - 1);
    };

    /** The first click or key, anywhere: the game's being played. */
    private readonly onFirst = (): void => {
        this.stopFirst();
        Gameplay.begin();
        WallAnalytics.begin();
        this.begun = true;
    };

    private stopFirst(): void {
        window.removeEventListener('pointerdown', this.onFirst, true);
        window.removeEventListener('keydown', this.onFirst, true);
    }

    private punchAt(x: number, y: number): void {
        if ((this.phase !== 'playing' && this.phase !== 'fighting') || this.hud.busy) return;
        if (!this.started) {
            this.started = true;
            this.hud.setTapHint(false);
        }
        WallAnalytics.step('first-hit');
        WallAudio.play('swing');
        // On the weak spot, or within the wall.
        const weak = this.onWeakSpot(x, y);
        // (One of the enemies: the one there, or the nearest.)
        const enemy = this.phase === 'fighting' && !weak ? this.fight.enemies.pick(x, y, this.threeCamera) : null;
        const at = weak ? this.weak.position.clone().project(this.threeCamera) : (enemy ?? this.onWall(x, y));
        this.landings.push({ inSec: this.hands.punch(at.x, at.y), x: at.x, y: at.y, weak, enemy: enemy?.enemy });
    }

    /** A spot on the screen (-1..1) near enough to the weak spot. */
    private onWeakSpot(x: number, y: number): boolean {
        if (!this.weak.visible) return false;
        const at = this.weak.position.clone().project(this.threeCamera);
        return Math.hypot((at.x - x) * this.threeCamera.aspect, at.y - y) < WEAK.radius * 2;
    }

    /** A spot on the screen brought within the wall's. */
    private onWall(x: number, y: number): THREE.Vector3 {
        this.raycaster.setFromCamera(this.ndc.set(x, y), this.threeCamera);
        const { origin, direction } = this.raycaster.ray;
        const point = origin.clone().addScaledVector(direction, -origin.z / direction.z);
        point.x = THREE.MathUtils.clamp(point.x, -WALL_WIDTH / 2 + INSET, WALL_WIDTH / 2 - INSET);
        point.y = THREE.MathUtils.clamp(point.y, INSET, WALL_HEIGHT - INSET);
        return point.project(this.threeCamera);
    }

    private cashMult(): number {
        return WallProgress.cashMult * (wallAt(WallProgress.wall).material.cash ?? 1);
    }

    /** A hit lands: the cells there go. */
    private land(entry: Landing): void {
        const { x, y } = entry;
        let { weak } = entry;
        this.threeCamera.updateMatrixWorld();
        if (this.phase === 'fighting') this.landOnEnemy(entry);
        if (this.phase !== 'playing') return;
        this.raycaster.setFromCamera(this.ndc.set(x, y), this.threeCamera);
        const ray = this.raycaster.ray;
        ray.origin.sub(this.wall.group.position);
        const aimed = this.wall.aim(ray);
        if (!aimed) return;
        const tool = WallProgress.tool;
        const before = this.wall.share;
        const combo = this.weak.left > 0 ? WallProgress.comboMult(this.weak.combo) : 1;
        // (It may have gone by now: a plain hit then.)
        weak &&= this.weak.visible;
        const damage = WallProgress.damage * combo * (weak ? WallProgress.weakMult : 1);
        const { cells, fallen } = this.wall.hit(aimed.point, damage, tool.bite);
        const { hp, material } = wallAt(WallProgress.wall);
        const took = before - this.wall.share;
        const big = weak || took >= BIG_HIT || fallen.length > 24;
        this.scatter(cells, fallen, aimed.point, PIECES.hit, big ? 1.25 : 1);
        this.showMark(aimed.point, cells, weak ? MARK.weak : big ? MARK.big : MARK.plain);
        const front = aimed.point.clone();
        front.z += 0.5;
        this.debris.puff(front, weak ? '#ffd75e' : material.dust, big ? 3.2 : 1.9);
        // Money for what was really taken (what fell counts).
        const earned = Math.max(1, Math.round(took * hp * CASH.perDamage * this.cashMult()));
        WallProgress.addCash(earned);
        const at = this.toHud(x, y);
        this.hud.float(`+${short(earned)}`, at.x, at.y, weak ? 0xff8a3a : big ? 0xffe27a : 0xffffff, weak ? 1.6 : big ? 1.3 : 1);
        this.hud.setShare(this.wall.share, true);
        if (big) this.stopFor = Math.max(this.stopFor, HIT_STOP.big * fx('hitStop'));
        WallAudio.play(`hit-${tool.base === 'pickaxe' && material.hit === 'stone' ? 'pick' : material.hit}` as 'hit-stone', big ? 1.2 : 1);
        if (cells.length + fallen.length > 6) WallAudio.play('break', Math.min(1.3, 0.5 + (cells.length + fallen.length) / 60));
        this.vibrate(big ? 22 : 12);
        if (weak) {
            const step = this.weak.hit();
            WallAudio.play('hit-glass', 1.2, 1.2 + Math.min(8, step) * 0.08);
            WallAnalytics.step('weak-spot');
            WallAnalytics.combo(step);
        }
        if (this.wall.down) this.bringDown();
    }

    /** Where the hit was and how far it reached: a light on the wall's face, where it's seen from here, and the tiles round it flash. */
    private showMark(at: THREE.Vector3, cells: Cell[], color: number): void {
        // Nearly all of what it took (a stray few go farther).
        const far = cells.map(({ position }) => Math.hypot(position.x - at.x, position.y - at.y)).sort((a, b) => a - b);
        const reach = Math.max(MARK.least, (far[Math.floor(far.length * 0.9)] ?? 0) + WALL.cell / 2);
        this.wall.flash(at, reach);
        const eye = this.threeCamera.position;
        const t = (MARK.front - eye.z) / (at.z - eye.z);
        this.mark.show(eye.clone().lerp(at, t), reach * t, color);
    }

    /** The pieces off a hit (the ones at the edge of the bite too, not all in the middle). */
    private scatter(cells: Cell[], fallen: Cell[], from: THREE.Vector3, most: number, force: number): void {
        const { material } = wallAt(WallProgress.wall);
        const step = Math.max(1, Math.floor(cells.length / most));
        for (let i = 0; i < cells.length; i += step) this.debris.throw(cells[i].position, cells[i].color, WALL.cell * material.chip * 0.85, force, from);
        const fall = Math.max(1, Math.ceil(fallen.length / PIECES.fallen));
        for (let i = 0; i < fallen.length; i += fall) this.debris.drop(fallen[i].position, fallen[i].color, WALL.cell * material.chip * 1.1);
    }

    /** One of the crew's hits lands. */
    private crewHit(def: CrewDef, at: THREE.Vector3, damage: number): void {
        if (this.hud.busy) return;
        if (this.phase === 'fighting') {
            const enemy = this.fight.enemies.nearest(at);
            if (!enemy) return;
            this.strikeEnemy(enemy, damage, false);
            if (this.crewSound <= 0) {
                this.crewSound = CREW_EVERY.sound;
                WallAudio.play('hit-soft', 0.28, 1.25 - def.size * 0.35);
            }
            return;
        }
        if (this.phase !== 'playing') return;
        const point = at.clone();
        point.z = Math.min(point.z, -0.1);
        const before = this.wall.share;
        const { cells, fallen } = this.wall.hit(point, damage, PLAIN);
        const { hp, material } = wallAt(WallProgress.wall);
        const took = before - this.wall.share;
        if (took > 0) WallProgress.addCash(took * hp * CASH.perDamage * this.cashMult());
        this.scatter(cells, fallen, point, Math.round(PIECES.crew * fx('crewPieces')) || 1, 0.8);
        this.hud.setShare(this.wall.share);
        if (cells.length) this.debris.puff(new THREE.Vector3(point.x, point.y, 0.4), material.dust, 0.9 + def.size, 0.35);
        if (this.crewSound <= 0) {
            this.crewSound = CREW_EVERY.sound;
            WallAudio.play(`hit-${material.hit}`, 0.28, 1.25 - def.size * 0.35);
        }
        if (this.crewNumber <= 0 && took > 0) {
            this.crewNumber = CREW_EVERY.number;
            const on = new THREE.Vector3(point.x, point.y, 0).project(this.threeCamera);
            const spot = this.toHud(on.x, on.y);
            this.hud.float(`+${short(Math.max(1, took * hp * this.cashMult()))}`, spot.x, spot.y, 0xa8e6ff, 0.62);
        }
        if (this.wall.down) this.bringDown();
    }

    private vibrate(ms: number): void {
        if (fx('vibration') <= 0) return;
        try {
            navigator.vibrate?.(Math.round(ms * fx('vibration')));
        } catch {
            // Not allowed here.
        }
    }

    /** A spot on the screen (-1..1, y up) in the HUD's units. */
    private toHud(x: number, y: number): PIXI.Point {
        return this.game.overlayContainer.toLocal(new PIXI.Point(((x + 1) / 2) * window.innerWidth, ((1 - y) / 2) * window.innerHeight));
    }

    // ---------------------------------------------------------------- buying

    /**
     * What's given: the first PUNCH HARDER (wall 1 down), the first chick (its wall reached), a tool (at some walls, if it
     * hasn't been bought by then). `quietly`: no show (the start).
     */
    private handOut(quietly = false): boolean {
        if (WallProgress.giftWaiting && WallProgress.punchHarder()) {
            WallAnalytics.punch(WallProgress.punchLevel, true);
            if (quietly) return true;
            this.hud.showGift('Wall_fists', 'x2 PUNCH!', 'FREE UPGRADE', () => this.hud.tray.punchAt);
            this.flaunt();
            return true;
        }
        if (WallProgress.giveTool()) {
            const level = WallProgress.punchLevel;
            const tool = toolAt(level);
            WallAnalytics.punch(level, true);
            WallAnalytics.tool(level, tool.id);
            this.applyTool(quietly);
            if (!quietly) this.hud.showGift(`Wall_${tool.base}`, `${tool.name.toUpperCase()}!`, 'A GIFT: HITS HARDER', () => this.hud.tray.punchAt);
            return true;
        }
        const [first] = CREW;
        if (!WallProgress.giveFirst(first)) return false;
        WallAnalytics.hire(first.id, 1, true);
        if (quietly) {
            this.crew.refresh(true);
            return true;
        }
        this.hud.showGift(`Wall_${first.id}`, `A ${first.name.toUpperCase()}!`, 'IT HITS ON ITS OWN', () => this.hud.tray.crewAt(0));
        this.crew.refresh();
        return true;
    }

    private punchHarder(): boolean {
        const before = toolAt(WallProgress.punchLevel);
        if (!WallProgress.punchHarder()) {
            WallAudio.play('error');
            return false;
        }
        WallAnalytics.punch(WallProgress.punchLevel);
        WallAudio.play('claim');
        const tool = toolAt(WallProgress.punchLevel);
        if (tool.id === before.id) return true;
        WallAnalytics.tool(WallProgress.punchLevel, tool.id);
        WallAudio.play('tool');
        this.hud.announce(`${tool.name.toUpperCase()}!`, 'NEW TOOL', 0.9);
        this.applyTool(false);
        return true;
    }

    private hire(def: CrewDef): boolean {
        if (!WallProgress.hire(def)) {
            WallAudio.play('error');
            return false;
        }
        const owned = WallProgress.owned(def.id);
        WallAnalytics.hire(def.id, owned);
        WallAudio.play('claim', 0.8, 1.1);
        this.crew.refresh();
        this.crew.cheer(def.id);
        if (owned === 1) this.hud.announce(`${def.name.toUpperCase()}!`, 'IT HITS ON ITS OWN', 1);
        return true;
    }

    private buyBoost(boost: BoostDef): boolean {
        if (!WallProgress.buyBoost(boost)) {
            WallAudio.play('error');
            return false;
        }
        WallAnalytics.boost(boost.id);
        WallAudio.play('tool');
        this.hud.announce(`${boost.title}!`, `${boost.what} ${boost.value}`, 0.9);
        if (boost.effect.crewId) this.crew.cheer(boost.effect.crewId);
        else if (boost.effect.crew) CREW.forEach((def) => this.crew.cheer(def.id));
        return true;
    }

    private rewind(): void {
        if ((this.phase !== 'playing' && this.phase !== 'fighting') || !WallProgress.canRewind) return;
        const { wall, runMedals, medalMult } = WallProgress;
        this.weak.reset();
        this.landings = [];
        this.hud.rewindShow.play(wall, runMedals, medalMult, WallProgress.multAfterRewind, () => {
            // (Out of sight; the wall holds while the show's on.)
            if (!WallProgress.rewind()) return;
            // (A fight left for it.)
            if (this.phase === 'fighting' && this.fight.kind && !this.fight.farming) WallAnalytics.fight(this.fight.kind, wall, 'fail');
            WallAnalytics.rewind(WallProgress.rewinds);
            this.crew.refresh(true);
            this.fight.stop();
            this.hud.setFight();
            this.phase = 'playing';
            this.remakeWall();
        }, () => void this.rewound());
    }

    /** It's done: a break, and off again. */
    private async rewound(): Promise<void> {
        await Gameplay.commercialBreak();
        if (!this.destroyed_) this.hud.announce('LET\'S GO AGAIN!', `ALL DAMAGE x${short(WallProgress.medalMult)}`, 1.2);
    }

    /** The wall it's at now, anew. */
    private remakeWall(): void {
        this.wall.dispose();
        this.buildWall();
        this.showWall();
    }

    private applyTool(atOnce: boolean): void {
        const { id, base, tint = '#ffffff', glow = 0, hold, swing } = WallProgress.tool;
        this.hands.setTool(hold && swing ? { id, base, tint, glow, hold, swing } satisfies ToolLook : undefined, atOnce);
    }

    /** The hands held up a moment, to see what's new on them. */
    private flaunt(): void {
        this.hands.show(true);
        this.flauntFor = FLAUNT_SEC;
    }

    /** The hands wear and hold what's picked. */
    private dress(): void {
        this.hands.wearLook(wornLook());
        this.applyTool(false);
    }

    private async loadModels(): Promise<void> {
        try {
            const [hands] = await Promise.all([createGLTFLoader().loadAsync(`${MODELS}hands.glb`), this.models.now(this.modelsInSight())]);
            if (this.destroyed_) return;
            this.hands.setModels(hands);
        } catch (error) {
            // (The wall still breaks without them.)
            console.warn('[WallScene] the hands could not load', error);
        }
        // (The rest, from now on.)
        this.modelsWait = 0;
    }

    /** The models there's no beginning without: what's in hand, what's on it, who's being fought. */
    private modelsInSight(): ModelWant[] {
        const { tool, fighting, wall, rewinds } = WallProgress;
        return [
            ...this.toolWant(tool.base),
            ...(wornLook().gloves.boxing ? [this.gloveWant] : []),
            ...(fighting ? this.enemyWants(fightModels(wall, rewinds)) : []),
        ];
    }

    /**
     * The models to get, the soonest seen first: who's in the crew; then, once it's being played, the next enemies, the next
     * tools, what the wardrobe shows, the next of the crew and the enemies after those. Nothing that's further off.
     */
    private wantedModels(): ModelWant[] {
        if (this.destroyed_) return [];
        const { wall, rewinds, punchLevel } = WallProgress;
        const crew = (there: (def: CrewDef) => boolean) => CREW.filter(there).map(({ id }) => this.crewWant(id));
        const wants = [...this.modelsInSight(), ...crew((def) => WallProgress.owned(def.id) > 0)];
        if (!this.begun) return wants;
        const fights: string[][] = [];
        for (let n = wall; n <= wall + MODELS_AHEAD.walls && fights.length < MODELS_AHEAD.fights; n++) {
            const models = fightModels(n, rewinds);
            if (models.length) fights.push(models);
        }
        const tools = Array.from({ length: MODELS_AHEAD.tools }, (_, i) => toolAt(punchLevel + 1 + i));
        return [
            ...wants,
            ...this.enemyWants(fights[0] ?? []),
            ...tools.flatMap(({ base }) => this.toolWant(base)),
            this.gloveWant,
            ...toolsUpTo(punchLevel).flatMap(({ base }) => this.toolWant(base)),
            ...crew((def) => def.wall <= wall + MODELS_AHEAD.crew),
            ...this.enemyWants(fights.slice(1).flat()),
        ];
    }

    private enemyWants(ids: string[]): ModelWant[] {
        return ids.map((id) => ({ key: `enemy ${id}`, get: () => this.fight.enemies.load(id) }));
    }

    private crewWant(id: string): ModelWant {
        return { key: `crew ${id}`, get: async () => this.crew.setModel(id, await ModelLoaderManager.instance.loadModel(`${CREW_MODELS}${id}.glb`)) };
    }

    /** (None for the fists.) */
    private toolWant(base: string | undefined): ModelWant[] {
        const type = TOOL_TYPES.find(({ id }) => id === base);
        if (!type) return [];
        return [{ key: `tool ${type.id}`, get: async () => this.hands.addTool(type.id, await ModelLoaderManager.instance.loadModel(`${MODELS}${type.model}.glb`)) }];
    }

    private readonly gloveWant: ModelWant = { key: 'boxing', get: async () => this.hands.setGlove(await ModelLoaderManager.instance.loadModel(`${MODELS}boxing.glb`)) };

    // ---------------------------------------------------------------- frame

    /** The share of the screen's height the wall may take, and how far up it stands: clear of the HUD, upright. */
    private frameWall(aspect: number): { tall: number; floorAt: number } {
        if (aspect >= CAMERA.wide.aspect) return CAMERA.wide;
        const height = Game.overlayScreenData?.height ?? Game.DESIGN_HEIGHT;
        const floorAt = (TRAY_TOP + CAMERA.clear) / height;
        const room = 1 - floorAt - (BAR_FOOT + CAMERA.clear) / height;
        return { tall: Math.min(CAMERA.tall, room), floorAt };
    }

    /** Where the hands rest: over what there is of the cards now (undefined: a wide screen, where they're not under them). */
    private handsFloor(): number | undefined {
        if (this.threeCamera.aspect >= CAMERA.wide.aspect) return undefined;
        const height = Game.overlayScreenData?.height ?? Game.DESIGN_HEIGHT;
        const floor = Math.max(HANDS_LOWEST, (this.hud.tray.topNow + CAMERA.clear) / height);
        // (Out of the way of what's on the floor.)
        return this.phase === 'fighting' ? Math.max(HANDS_LOWEST, floor - HANDS_FIGHT) : floor;
    }

    private placeCamera(): void {
        const aspect = this.threeCamera.aspect;
        const { tall, floorAt } = this.frameWall(aspect);
        // All of the wall in sight: its share of the height, or the whole width.
        const height = Math.max(WALL_HEIGHT / tall, (WALL_WIDTH + CAMERA.side * 2) / aspect);
        const distance = height / 2 / Math.tan(THREE.MathUtils.degToRad(CAMERA.fov / 2));
        // Its foot this share of the way up the screen (a narrow one: the wall in the middle of its room).
        const foot = floorAt + (tall - WALL_HEIGHT / height) / 2;
        this.home.set(0, height * (0.5 - foot) + CAMERA.pitchDrop, distance);
        const fog = this.threeScene.fog as THREE.Fog;
        fog.near = distance + DARK.from;
        fog.far = distance + WALL.gap * DARK.to;
        this.threeCamera.fov = CAMERA.fov;
        this.threeCamera.updateProjectionMatrix();
    }

    public update(delta: number): void {
        // (An ad: everything waits.)
        delta = Gameplay.paused ? 0 : Math.min(delta, MAX_FRAME_SEC);
        // A hit-stop: the world nearly stops, the screen doesn't.
        let step = delta;
        if (this.stopFor > 0) {
            this.stopFor -= delta;
            step = delta * 0.05;
        }
        this.time += step;
        // (Those landing this frame, in order; a landing can bring the wall down.)
        const landing = this.landings.filter((entry) => (entry.inSec -= step) <= 0);
        this.landings = this.landings.filter((entry) => entry.inSec > 0);
        landing.forEach((entry) => this.land(entry));
        this.modelsWait -= delta;
        if (this.modelsWait <= 0) {
            this.modelsWait = MODELS_AHEAD.every;
            void this.models.check();
        }
        this.hands.setFloor(this.handsFloor());
        this.hands.update(delta);
        this.debris.update(step);
        this.mark.update(delta);
        this.wall.updateFlash(delta);
        this.crewSound -= delta;
        this.crewNumber -= delta;
        if (this.phase === 'fighting') {
            this.fight.update(this.hud.busy ? 0 : step);
            if (this.phase === 'fighting') this.showFight();
        } else this.fight.enemies.update(step);
        const toHit = this.phase === 'playing' ? this.wall.share > 0 : this.phase === 'fighting' && this.fight.enemies.alive.length > 0;
        this.crew.update(step, toHit && !this.hud.busy, this.phase === 'advancing');
        this.tunnel.update(delta);
        (this.threeScene.fog as THREE.Fog).color.copy(this.tunnel.dark);
        this.around.intensity = LIGHT.around * fx('light');
        this.sun.intensity = LIGHT.strength * fx('light');
        const fighting = this.phase === 'fighting' && this.fight.bossThere;
        const weakOn = (this.phase === 'playing' || fighting) && WallProgress.best >= WEAK.wall;
        this.weak.update(delta, weakOn, () => fighting ? this.fight.weakAt(new THREE.Vector3()) : this.wall.spotNear((Math.random() - 0.5) * WALL_WIDTH * 0.7, WALL_HEIGHT * (0.25 + Math.random() * 0.6), 3, new THREE.Vector3()));
        this.showCombo();
        if (Gameplay.active) WallAnalytics.played(delta);
        this.hud.playing = this.started && this.phase === 'playing';
        if (Gameplay.active) WallProgress.addPlayed(delta);
        if (this.flauntFor > 0) {
            this.flauntFor -= delta;
            if (this.flauntFor <= 0 && !this.hud.wardrobe.isOpen) this.hands.show(false);
        }
        if (this.phase === 'playing') this.wall.update(this.time);
        this.showLife();
        this.updateCamera(delta);
        this.hud.update(delta);
        super.update(delta);
        // The hands, over everything.
        const renderer = SetupThree.renderer;
        this.drawn.calls = renderer.info.render.calls;
        this.drawn.triangles = renderer.info.render.triangles;
        renderer.autoClear = false;
        renderer.clearDepth();
        renderer.render(this.hands.scene, this.hands.camera);
        renderer.autoClear = true;
    }

    /** The wall's life, or that of what's behind it, on the bar. */
    private showLife(): void {
        if (this.phase === 'fighting') {
            const { left, total } = this.fight.life;
            this.hud.setLife(left, total);
        } else if (this.phase === 'playing' || this.phase === 'falling') {
            this.hud.setLife(this.wall.down ? 0 : this.wall.share * this.wall.hp, this.wall.hp);
        } else if (this.phase === 'previewing') {
            const hp = wallAt((this.look.boss + 1) * ENEMIES.boss.every).hp * ENEMIES.boss.hp;
            this.hud.setLife(hp, hp);
        } else this.hud.setLife(this.wall.hp, this.wall.hp);
    }

    private readonly comboAt = new THREE.Vector3();

    private showCombo(): void {
        const mult = this.weak.left > 0 && (this.phase === 'playing' || this.phase === 'fighting') ? WallProgress.comboMult(this.weak.combo) : 1;
        if (mult <= 1 || !this.weak.visible) {
            if (mult <= 1) this.hud.setCombo(1);
            return;
        }
        this.comboAt.copy(this.weak.position);
        this.comboAt.y -= 0.85;
        this.comboAt.project(this.threeCamera);
        const at = this.toHud(this.comboAt.x, this.comboAt.y);
        this.hud.setCombo(mult, at.x, at.y);
    }

    private updateCamera(delta: number): void {
        this.shake = Math.max(0, this.shake - delta * 1.8);
        const quake = this.shake * this.shake * fx('quake');
        const along = -WALL.gap * this.walked;
        const step = -Math.abs(Math.sin(this.walked * Math.PI * ADVANCE.steps)) * ADVANCE.bob * fx('steps');
        this.crew.group.position.z = along;
        this.threeCamera.position.set(
            this.home.x + Math.sin(this.time * 71) * 0.14 * quake,
            this.home.y + Math.sin(this.time * 83) * 0.14 * quake + step,
            this.home.z + along,
        );
        this.threeCamera.lookAt(0, this.home.y - CAMERA.pitchDrop + step, along);
        this.threeCamera.rotateZ(THREE.MathUtils.degToRad(CAMERA.rollDeg) * fx('tilt'));
    }

    private placeTapHint(): void {
        const at = this.toHud(0, 0.22);
        if (WallProgress.wall === 1 && !this.started && this.wall.share >= 1) this.hud.setTapHint(true, at.x, at.y);
    }

    public resize(): void {
        this.placeCamera();
        this.hands.resize(this.threeCamera.aspect);
        const screen = Game.overlayScreenData;
        if (screen) this.tapZone.hitArea = new PIXI.Rectangle(screen.topLeft.x - 400, screen.topLeft.y - 400, screen.width + 800, screen.height + 800);
        this.hud?.reposition();
        if (!this.hud || !this.wall) return;
        this.placeTapHint();
    }

    private buildDebug(): void {
        const panel = DebugOverlay.instance.panel('Wall', { id: 'wall.game' });
        panel.monitor('Wall', () => `${WallProgress.wall} (${Math.round(this.wall.share * 100)}%)`);
        panel.monitor('Punch', () => `level ${WallProgress.punchLevel}, damage ${short(WallProgress.damage)}`);
        panel.monitor('Crew', () => `${WallProgress.crewCount}, ${short(WallProgress.crewDps)}/s`);
        panel.monitor('Medals', () => `${WallProgress.runMedals} + ${WallProgress.medals} cashed in (x${WallProgress.medalMult.toFixed(1)})`);
        panel.monitor('Draw Calls', () => this.drawn.calls);
        panel.monitor('Triangles', () => this.drawn.triangles.toLocaleString('en-US'));
        panel.button('CASH x10', () => WallProgress.addCash(Math.max(1000, WallProgress.cash * 9)));
        panel.button('BRICKS +50', () => WallProgress.addBricks(50));
        panel.button('SKIP 5 WALLS', () => {
            if (this.phase !== 'playing') return;
            WallProgress.skipTo(WallProgress.wall + 5);
            this.remakeWall();
        });
        panel.button('BRING IT DOWN', () => this.phase === 'playing' && this.bringDown());
        panel.button('NEXT BOSS GATE', () => {
            if (this.phase !== 'playing' || !enemiesOn) return;
            WallProgress.skipTo((Math.floor(WallProgress.wall / ENEMIES.boss.every) + 1) * ENEMIES.boss.every);
            this.remakeWall();
        });
        panel.button('KILL ALL ENEMIES', () => this.phase === 'fighting' && this.fight.killAll());
        this.buildBossDebug();
        panel.button(enemiesOn ? 'ENEMIES: ON (switch off, reloads)' : 'ENEMIES: OFF (switch on, reloads)', () => {
            switchEnemies();
            WallProgress.saveNow();
            window.location.reload();
        });
        panel.button('NEW GAME', () => WallProgress.reset());
    }

    /** Debug: the bosses, one after another or all together, as they grow and change colour. */
    private buildBossDebug(): void {
        if (!enemiesOn) return;
        const { look } = this;
        const panel = DebugOverlay.instance.panel('Bosses', { id: 'wall.bosses', persist: false });
        const show = (step: number): boolean => {
            if (this.phase !== 'playing' && this.phase !== 'previewing') return false;
            look.boss = Math.max(0, look.boss + step);
            this.phase = 'previewing';
            this.weak.reset();
            this.landings = [];
            this.wall.group.visible = false;
            this.tunnel.showMedal(false);
            const kind = this.fight.preview(look.boss, look.rewinds);
            void this.models.now(this.enemyWants(enemyModels(kind)));
            this.hud.setFight({ title: kind.name, boss: true, retry: false });
            this.hud.setShare(1);
            return true;
        };
        const wall = () => (look.boss + 1) * ENEMIES.boss.every;
        panel.monitor('Boss', () => `${look.boss + 1}: ${bossAt(look.boss, look.rewinds).name} (wall ${wall()})`);
        panel.monitor('Height', () => {
            const { pair, height } = bossAt(look.boss, look.rewinds);
            return `${(pair ?? [{ height }]).map((one) => one.height.toFixed(1)).join(' and ')} (the gate's ${WALL_HEIGHT.toFixed(1)})`;
        });
        panel.monitor('Health', () => short(wallAt(wall()).hp * ENEMIES.boss.hp));
        panel.buttons([
            { label: '< BEFORE', action: () => void show(-1) },
            { label: 'SHOW', action: () => void show(0) },
            { label: 'NEXT >', action: () => void show(1) },
        ]);
        panel.slider(look, 'rewinds', 0, 10, 1, 'After rewinds');
        panel.button('LINE UP 12 (from this one)', () => {
            if (!show(0)) return;
            this.fight.lineUp(look.boss, look.rewinds);
            void this.models.now(this.enemyWants(Array.from({ length: 12 }, (_, i) => enemyModels(bossAt(look.boss + i, look.rewinds))).flat()));
        });
        panel.button('BACK TO THE GAME', () => {
            if (this.phase !== 'previewing') return;
            this.fight.stop();
            this.hud.setFight();
            this.wall.group.visible = true;
            this.phase = 'playing';
            this.showWall();
        });
        look.boss = bossNumber(Math.max(ENEMIES.boss.every, WallProgress.wall));
        look.rewinds = WallProgress.rewinds;
    }

    public destroy(): void {
        this.destroyed_ = true;
        WallProgress.saveNow();
        WallProgress.setWallState(undefined);
        window.removeEventListener('keydown', this.onKey);
        this.stopFirst();
        this.tapZone.destroy();
        this.hud.destroy();
        this.wall.dispose();
        super.destroy();
    }
}
