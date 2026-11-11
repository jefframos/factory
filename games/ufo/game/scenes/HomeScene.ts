// HomeScene.ts
//
// The main screen: the area's miniature (its own town, ui/areas.json `miniature`) as a little island in the sea, with the
// saucer you're wearing hovering over it, seen from far off through a long lens. Over it: your coins, the area's name, the
// button to play the next level with the area's progress bar over it, a floating icon to the competition's ranking, and
// the bottom tabs: the aliens' shop, home, versus, the spaceships' shop.
//
// VERSUS (as Mob's arena screen): the arena's own island instead (← / → through the arenas, a padlock and what it takes
// on one not open yet), its name on the ribbon, the player's strip and the bar to the next arena under it, the trophy
// road's button, PLAY ONLINE (the matchmaking window, then the match). A new arena gets its NEW ARENA moment. The first
// time versus is open, a spotlight walks the player to it: the VERSUS tab, then PLAY ONLINE.
//
// With `home.baked` the island and the saucer are images (BakedView.ts), smooth where the live 3D is jagged: the two sit on
// the PIXI layer over the three canvas, which goes on drawing only the live sea. The view doesn't swing then; the saucer's
// picture bobs, and its beam's off.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import gsap from 'gsap';
import { DebugOverlay } from 'core/debug/DebugOverlay';
import { Game } from 'core/Game';
import SoundToggleButton from 'core/ui/SoundToggleButton';
import SetupThree from 'core/scene/SetupThree';
import { ThreeScene } from 'core/scene/ThreeScene';
import { UfoAudio } from '../audio/UfoAudio';
import { DESIGN, LOOKS, Level, areaProgress, currentArea, currentMissionIndex, hasLevel, homeLevel, islandLevel, missionUpTo } from '../data/UfoConfig';
import { ARENAS, RoadStep, arenaNeeds, arenaOpen, findPlayers, newestOpen, setMatchPlayers, versusOpen } from '../data/Versus';
import { AREA_BAR, AreaBar } from '../ui/AreaBar';
import { ArenaUnlocked } from '../ui/ArenaUnlocked';
import { Matchmaking } from '../ui/Matchmaking';
import { Overlay } from '../ui/Overlay';
import { Spotlight } from '../ui/Spotlight';
import { TrophyRoad } from '../ui/TrophyRoad';
import { VersusHome } from '../ui/VersusHome';
import { ShopKind, UfoProgress } from '../data/UfoProgress';
import { Saucer } from '../player/Saucer';
import { updateBend } from '../services/Bend';
import { Baked, bakeView } from '../ui/BakedView';
import { AvatarPanel } from '../ui/AvatarPanel';
import { RankingPanel } from '../ui/RankingPanel';
import { anyClaimable } from '../data/Ranking';
import { ShopPanel } from '../ui/ShopPanel';
import { Snapshots } from '../ui/Snapshots';
import { COIN_BAR, DARK, buttonParts, fillCoinBar, fitSprite, framePlane, iconSprite, label, makeAvatar, plainLabel, tappable } from '../ui/UiParts';
import { UfoTown } from '../world/UfoTown';

/** What's past the end of the sea, in a town without an island of its own. */
const FAR_SEA = 0x052594;
/** The sea's deep water is its colour times this (Water.ts `uDeep`): past its end, the background carries it on. */
const DEEP_SEA = { r: 0.1, g: 0.24, b: 0.62 };
const VIEW = DESIGN.home;
/** The bar, and the raised blue tab on it; the chosen tab's icon stands up out of the bar, its name under. */
const TABS = {
    height: 118, rise: 14, barColor: 0x2b2d4d, focusColor: 0x4a6ef5, lightColor: 0x86a2ff, lightInset: 5,
    icon: 74, focusIcon: 92, focusIconY: -18, labelY: 36, labelSize: 22,
};
const TOP = { y: 48, muteSize: 56, margin: 16 };
const COINS = COIN_BAR;
/** Top left: the picture, its username, and the coins under that. In the shops only the coins, in the corner. */
const PROFILE = { x: 58, y: 58, avatar: 88, nameX: 54, nameY: -28, nameSize: 24, nameWidth: 230, hitWidth: 330, hitHeight: 96, coinsX: 134, coinsY: 74 };
const RIBBON = { y: 160, width: 430, height: 86, scale: 0.6, text: 36, textY: -6 };
/** The buttons, up from the top of the tabs. */
const PLAY = { width: 440, height: 110, up: 92, textSize: 54 };
/** The floating icon to the ranking: where (from the top left), its size, its bounce, and what's round it. */
const MEDAL = {
    x: 96, y: 300, size: 110, bounce: 12, bounceSeconds: 0.55, rays: 230, raysColor: 0xffd23f, raysSeconds: 9, glow: 190, label: 22, labelY: 74,
    alert: 40, alertX: 44, alertY: -44, hand: 84, handX: 34, handY: 42, handMove: 16, handSeconds: 0.5,
};
const PLAY_SLICE = { side: 82, height: 194 };
const MUTE_ICON = 0.55 / 128;
/** The play button: a gold glow breathing behind it, and a band of light sweeping across. */
const SHINE = { glowWidth: 1.35, glowHeight: 2.2, glowColor: 0xffd23f, glowFrom: 0.3, glowTo: 0.75, glowSeconds: 0.9, band: 90, tilt: 0.35, sweep: 0.75, wait: 1.5, alpha: 0.85, corner: 0.32 };
const DEBUG_PANEL = 'ufo.home';
/** The baked saucer's bob, in design units, and how soon after a resize it's all baked again. */
const BAKED_BOB = { height: 5, speed: 1.6 };
const REBAKE_AFTER = 0.25;

function deepSea(water: string): THREE.Color {
    const hex = new THREE.Color(water).getHex(THREE.SRGBColorSpace);
    return new THREE.Color().setRGB((((hex >> 16) & 255) / 255) * DEEP_SEA.r, (((hex >> 8) & 255) / 255) * DEEP_SEA.g, ((hex & 255) / 255) * DEEP_SEA.b, THREE.SRGBColorSpace);
}
const DEBUG_COINS = 1000;

/** A soft band of white, across a small canvas. */
function shineTexture(): PIXI.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 4;
    const context = canvas.getContext('2d')!;
    const band = context.createLinearGradient(0, 0, 64, 0);
    band.addColorStop(0, 'rgba(255,255,255,0)');
    band.addColorStop(0.5, 'rgba(255,255,255,1)');
    band.addColorStop(1, 'rgba(255,255,255,0)');
    context.fillStyle = band;
    context.fillRect(0, 0, 64, 4);
    return PIXI.Texture.from(canvas);
}

type Tab = 'alien' | 'home' | 'versus' | 'ufo';
const TAB_ORDER: Tab[] = ['alien', 'home', 'versus', 'ufo'];
/** VERSUS's layout: the ribbon a little higher (no profile there), the strip under it, the ranking's and the road's
 *  buttons under that; the arrows' inset; the padlock on an arena not open yet. */
const VERSUS_LAYOUT = { ribbonY: 140, stripGap: 92, arrows: 56, arrowSize: 76, lock: 150, lockWords: 30 };
/** RANKING and ROAD: a row just over the tabs, either side of PLAY: their scale, how far in from the edge, how far up. */
const SIDE_ROW = { scale: 0.72, x: 66, up: 72 };
/** The area bar on HOME: its scale, and the room between it and PLAY. */
const HOME_AREA = { scale: 0.95, gap: 18 };

export default class HomeScene extends ThreeScene {
    private town!: UfoTown;
    private saucer!: Saucer;
    private readonly ui = new PIXI.Container();
    private readonly coinsBar = new PIXI.Container();
    private readonly coinsText = label(COINS.textSize);
    private readonly mute = new PIXI.Container();
    private readonly profile = new PIXI.Container();
    private readonly profileAvatar = new PIXI.Container();
    private avatarPanel: AvatarPanel | null = null;
    private readonly ribbon = new PIXI.Container();
    private readonly play = new PIXI.Container();
    private readonly medal = new PIXI.Container();
    private readonly medalIcon = iconSprite('ItemIcon_Medalstand', MEDAL.size);
    private readonly medalRays = iconSprite('Image_Effect_Rotate', MEDAL.rays);
    private readonly medalAlert = new PIXI.Container();
    private readonly medalHand = iconSprite('tutorial_hand_3', MEDAL.hand);
    private rankingPanel: RankingPanel | null = null;
    private readonly tabBar = new PIXI.Container();
    private readonly tabBack = framePlane('Menu_BottomBtn_Bg', 720, TABS.height);
    private readonly tabFocus = framePlane('Menu_BottomBtn_TabFocus', 240, TABS.height + TABS.rise);
    private readonly tabLight = framePlane('Menu_BottomBtn_TabFocus_Light', 230, TABS.height + TABS.rise - TABS.lightInset);
    private readonly tabs = new Map<Tab, { holder: PIXI.Container; icon: PIXI.Container; words: PIXI.Text }>();
    private readonly shops = new Map<ShopKind, ShopPanel>();
    private tab: Tab = 'home';
    private time = 0;
    private target = new THREE.Vector3();
    private distance = 100;
    private span = 100;
    private destroyedScene = false;
    /** The baked view's pictures, once they're up; until then (and if it can't be baked) it's live. */
    private bakedIsland: PIXI.Sprite | null = null;
    private bakedUfo: PIXI.Sprite | null = null;
    private bakedUfoY = 0;
    private rebakeIn = 0;
    private bakedFor = '';
    private shine: PIXI.Sprite | null = null;
    private glow: PIXI.Sprite | null = null;
    private playWords: PIXI.Text | null = null;
    private ribbonText: PIXI.Text | null = null;
    /** HOME's area bar; VERSUS's parts, its arrows, its padlock. */
    private readonly areaBar = new AreaBar();
    private versusHome: VersusHome | null = null;
    private readonly arenaPrev = new PIXI.Container();
    private readonly arenaNext = new PIXI.Container();
    private readonly arenaLock = new PIXI.Container();
    private readonly arenaLockWords = label(VERSUS_LAYOUT.lockWords);
    /** The arena VERSUS shows (ARENAS index), and whether it's open. */
    private arenaIndex = 0;
    private arenaLocked = false;
    /** Which island's shown (its map and poles), and every island built so far (kept, hidden, for coming back to). */
    private islandKey = '';
    private readonly islands = new Map<string, { level: Level; town: UfoTown }>();
    private matchmaking: Matchmaking | null = null;
    private overlay: Overlay | TrophyRoad | null = null;
    private spotlight: Spotlight | null = null;
    /** The versus tutorial's step, while it's on. */
    private tutorialStep: 'tab' | 'play' | null = null;
    public ready: Promise<void> = Promise.resolve();

    /** `onPlay`: the level's button; `onCompetition`: the ranking's (without versus); `onVersus`: a match in an arena. */
    public constructor(game: Game, private readonly onPlay: () => void, private readonly onCompetition: () => void,
        private readonly onVersus: (arena: string) => void = () => undefined) {
        super(game);
    }

    public build(): void {
        this.threeScene.add(new THREE.HemisphereLight(0xffffff, 0x5a7a4a, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 1.5);
        sun.position.set(6, 14, 8);
        this.threeScene.add(sun);
        this.threeCamera.fov = VIEW.fov;
        updateBend(new THREE.Vector3(), 0);

        // Back from a versus match: VERSUS, on the newest arena.
        if (UfoProgress.openVersusOnHome && versusOpen()) this.tab = 'versus';
        UfoProgress.openVersusOnHome = false;
        this.arenaIndex = newestOpen();
        this.saucer = new Saucer(this.threeScene, 0, 0);
        this.buildIsland();
        this.buildUi();
        this.game.uiLayer.addChild(this.ui);
        this.buildDebug();
        if (UfoAudio.started()) this.startSound();
        else {
            window.addEventListener('pointerdown', this.startSound, true);
            window.addEventListener('keydown', this.startSound, true);
        }
    }

    /** The island the tab shows (VERSUS: its arena's; else the area's miniature), built if it's another than now's. */
    private buildIsland(): void {
        const arena = ARENAS[this.arenaIndex];
        const versus = this.tab === 'versus' && !!arena;
        if (!versus && this.tab !== 'home' && this.islandKey) return;
        // By the map it shows: an arena on the area's own map is the same island (nothing's built again).
        const area = currentArea();
        const file = versus ? (hasLevel(arena.level) ? arena.level : 'town') : hasLevel(area.miniature) ? area.miniature : missionUpTo().level;
        const poles = !versus && area.miniaturePoles === true;
        const key = `${file}:${poles}`;
        if (key === this.islandKey) return;
        this.islandKey = key;
        // The old island's pictures go; its town and sea are hidden, kept for coming back to; the saucer's live again
        // till the island's baked.
        this.bakedIsland?.destroy({ texture: true, baseTexture: true });
        this.bakedUfo?.destroy({ texture: true, baseTexture: true });
        this.bakedIsland = null;
        this.bakedUfo = null;
        if (this.town) {
            this.town.setVisible(false);
            const oldSea = this.town.separateSea();
            if (oldSea) oldSea.visible = false;
        }
        this.saucer.setShown(true);
        this.saucer.showBeam(true);
        let entry = this.islands.get(key);
        if (!entry) {
            const built = islandLevel(file, poles);
            entry = { level: built, town: new UfoTown(this.threeScene, built) };
            this.islands.set(key, entry);
        }
        const { level, town } = entry;
        town.setVisible(true);
        const sea = town.separateSea();
        if (sea) sea.visible = true;
        this.threeScene.background = level.island ? deepSea(level.island.water) : new THREE.Color(FAR_SEA);
        this.town = town;
        const { minX, maxX, minZ, maxZ } = town.bounds();
        const span = Math.max(maxX - minX, maxZ - minZ);
        // The town's player point is the pivot, and where the saucer hovers. Framed so the island still fits round it.
        const { x, z } = level.start;
        this.span = 2 * Math.max(x - minX, maxX - x, z - minZ, maxZ - z);
        this.target.set(x, 0, z);
        this.saucer.respawn(x, z, span * VIEW.ufoSize, 0);
        this.saucer.hover(span * VIEW.ufoHeight);
        this.frameCamera();
        this.ready = Promise.all([town.ready, this.saucer.loaded]).then(() => {
            if (VIEW.baked && !this.destroyedScene && town === this.town) this.bake();
        });
    }

    /** Pictures of the island and the saucer, from where the camera is, then only the sea stays live under them. */
    private bake(): void {
        const { threeScene: scene, threeCamera: camera, town, saucer } = this;
        this.placeCamera();
        town.setVisible(true);
        town.culler.update(camera);
        saucer.update(0);
        saucer.showBeam(false);
        const sea = town.separateSea();
        const seaMaterial = sea?.material as THREE.Material | undefined;

        // The island, with the sea drawing only its depth: what's below the waterline stays hidden, as it is live.
        saucer.setShown(false);
        if (sea) sea.visible = true;
        if (seaMaterial) seaMaterial.colorWrite = false;
        const island = bakeView(scene, camera);
        if (seaMaterial) seaMaterial.colorWrite = true;

        // The saucer on its own, to bob.
        if (sea) sea.visible = false;
        town.setVisible(false);
        saucer.setShown(true);
        const ufo = bakeView(scene, camera);
        if (sea) sea.visible = true;

        if (!island || !ufo) {
            // No pictures: back to live.
            town.setVisible(true);
            saucer.showBeam(true);
            island?.texture.destroy(true);
            ufo?.texture.destroy(true);
            return;
        }
        saucer.setShown(false);
        this.bakedFor = `${window.innerWidth}x${window.innerHeight}`;
        this.bakedIsland = this.showBaked(this.bakedIsland, island, 0);
        this.bakedUfo = this.showBaked(this.bakedUfo, ufo, 1);
        this.bakedUfoY = this.bakedUfo.y;
    }

    /** `old`'s replaced by a sprite of `baked`, this far up the UI's stack (under everything else), placed on the screen. */
    private showBaked(old: PIXI.Sprite | null, baked: Baked, index: number): PIXI.Sprite {
        old?.destroy({ texture: true, baseTexture: true });
        const screen = Game.overlayScreenData;
        const sprite = new PIXI.Sprite(baked.texture);
        sprite.position.set(screen.topLeft.x + baked.left * screen.width, screen.topLeft.y + baked.top * screen.height);
        sprite.width = baked.width * screen.width;
        sprite.height = baked.height * screen.height;
        this.ui.addChildAt(sprite, index);
        return sprite;
    }

    private buildDebug(): void {
        const panel = DebugOverlay.instance.panel('UFO', { id: DEBUG_PANEL });
        panel.button(`+${DEBUG_COINS} COINS`, () => {
            UfoProgress.addCoins(DEBUG_COINS);
            this.refreshCoins();
        });
        panel.button('+100 TROPHIES', () => {
            UfoProgress.debugTrophies(100);
            this.applyTab();
        });
        panel.button('ERASE DATA', () => UfoProgress.eraseAndRestart());
    }

    private readonly startSound = (): void => {
        window.removeEventListener('pointerdown', this.startSound, true);
        window.removeEventListener('keydown', this.startSound, true);
        UfoAudio.startHomeMusic();
    };

    /** Far enough off, through the long lens, for the whole island to fit the screen's narrower way. */
    private frameCamera(): void {
        SetupThree.resize(this.threeCamera);
        const halfFov = THREE.MathUtils.degToRad(VIEW.fov / 2);
        const narrow = Math.min(1, this.threeCamera.aspect);
        this.distance = this.span / VIEW.fill / (2 * Math.tan(halfFov) * narrow);
        this.threeCamera.near = this.distance * 0.2;
        this.threeCamera.far = this.distance * 3;
        this.threeCamera.updateProjectionMatrix();
        this.placeCamera();
    }

    private placeCamera(): void {
        const pitch = THREE.MathUtils.degToRad(VIEW.pitchDeg);
        const swing = VIEW.baked ? 0 : Math.sin(this.time * VIEW.driftSpeed) * VIEW.drift;
        const drift = THREE.MathUtils.degToRad(VIEW.yawDeg) + swing;
        const flat = Math.cos(pitch) * this.distance;
        // It orbits the pivot; looking a little past it puts the pivot a little below the middle of the screen.
        const toCamera = { x: Math.sin(drift), z: Math.cos(drift) };
        const drop = this.span * VIEW.drop;
        const lookX = this.target.x - toCamera.x * drop;
        const lookZ = this.target.z - toCamera.z * drop;
        this.threeCamera.position.set(lookX + toCamera.x * flat, Math.sin(pitch) * this.distance, lookZ + toCamera.z * flat);
        this.threeCamera.lookAt(lookX, 0, lookZ);
        this.threeCamera.updateMatrixWorld();
    }

    private buildUi(): void {
        fillCoinBar(this.coinsBar, this.coinsText);
        this.buildProfile();
        this.buildMute();

        const ribbonBack = framePlane('Title_Ribbon04_Red', RIBBON.width, RIBBON.height, RIBBON.scale);
        ribbonBack.position.set(-RIBBON.width / 2, -RIBBON.height / 2);
        const ribbonText = label(RIBBON.text);
        ribbonText.text = currentArea().name.toUpperCase();
        ribbonText.y = RIBBON.textY;
        this.ribbonText = ribbonText;
        this.ribbon.addChild(ribbonBack, ribbonText);

        // The pack's big PLAY: a tapered yellow button, dark words with no outline.
        const scale = PLAY.height / PLAY_SLICE.height;
        const playBack = new PIXI.NineSlicePlane(PIXI.Texture.from('Button_Tapered_Yellow'), PLAY_SLICE.side, 0, PLAY_SLICE.side, 0);
        playBack.scale.set(scale);
        playBack.width = PLAY.width / scale;
        playBack.height = PLAY_SLICE.height;
        playBack.position.set(-PLAY.width / 2, -PLAY.height / 2);
        const playWords = plainLabel(PLAY.textSize, DARK);
        playWords.text = missionUpTo().name.toUpperCase();
        playWords.y = -6;
        this.playWords = playWords;
        this.glow = iconSprite('Glow_Circle01', PLAY.width);
        this.glow.width = PLAY.width * SHINE.glowWidth;
        this.glow.height = PLAY.height * SHINE.glowHeight;
        this.glow.tint = SHINE.glowColor;
        // Only the button itself is a tap, not the glow round it.
        this.play.hitArea = new PIXI.Rectangle(-PLAY.width / 2, -PLAY.height / 2, PLAY.width, PLAY.height);
        this.glow.alpha = SHINE.glowFrom;
        gsap.to(this.glow, { alpha: SHINE.glowTo, duration: SHINE.glowSeconds, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        // Kept to the button: its tapered outline.
        const { width: w, height: h } = PLAY;
        const corner = h * SHINE.corner;
        const outline = new PIXI.Graphics().beginFill(0xffffff).drawPolygon([
            -w / 2 + corner, -h / 2 + 6, w / 2 - corner, -h / 2 + 6, w / 2 - 6, 0, w / 2 - corner, h / 2 - 14, -w / 2 + corner, h / 2 - 14, -w / 2 + 6, 0,
        ]).endFill();
        this.shine = new PIXI.Sprite(shineTexture());
        this.shine.anchor.set(0.5);
        this.shine.width = SHINE.band;
        this.shine.height = h * 2;
        this.shine.rotation = SHINE.tilt;
        this.shine.alpha = SHINE.alpha;
        this.shine.blendMode = PIXI.BLEND_MODES.ADD;
        this.shine.mask = outline;
        gsap.fromTo(this.shine, { x: -w * 0.65 }, { x: w * 0.65, duration: SHINE.sweep, ease: 'sine.inOut', repeat: -1, repeatDelay: SHINE.wait });
        this.play.addChild(this.glow, playBack, playWords, outline, this.shine);
        tappable(this.play, () => this.pressPlay());
        gsap.to(this.play.scale, { x: 1.03, y: 1.03, duration: 0.7, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        this.buildMedal();

        this.tabBack.tint = TABS.barColor;
        this.tabFocus.tint = TABS.focusColor;
        this.tabLight.tint = TABS.lightColor;
        this.tabBar.addChild(this.tabBack, this.tabFocus, this.tabLight);
        this.addTab('alien', 'ALIENS');
        this.addTab('home', 'HOME');
        this.addTab('versus', 'VERSUS');
        this.addTab('ufo', 'SPACESHIPS');
        this.buildVersus();
        const where = areaProgress(currentMissionIndex());
        this.areaBar.set({ name: where.area.name, number: where.number, done: where.done, total: where.total, next: where.next?.name ?? null });
        this.areaBar.scale.set(HOME_AREA.scale);
        // The shops go in over the buttons, under the coins and the tabs (openTab()).
        this.ui.addChild(this.ribbon, this.areaBar, this.versusHome!, this.arenaPrev, this.arenaNext, this.arenaLock, this.medal, this.play, this.profile, this.coinsBar, this.mute, this.tabBar);
        // Back from a round: straight to how it changed the ranking.
        if (UfoProgress.openRankingOnHome) {
            UfoProgress.openRankingOnHome = false;
            this.openRanking();
        }
        this.refreshCoins();
        this.refreshTabIcons();
        this.applyTab();
        // Versus just opened (and not tried): its tutorial.
        if (versusOpen() && !UfoProgress.versusTutorial) {
            this.tutorialStep = this.tab === 'versus' ? 'play' : 'tab';
            gsap.delayedCall(0.5, () => {
                if (!this.destroyedScene && this.tutorialStep === 'tab') this.showTutorialStep();
            });
        }
        this.refreshMedal();
        this.resize();
    }

    /** VERSUS's parts: the strip and road bar, the road's button, the arrows, the padlock. */
    private buildVersus(): void {
        this.versusHome = new VersusHome(() => this.openRoad());
        const arrow = (holder: PIXI.Container, frame: string, step: number) => {
            const icon = iconSprite(frame, VERSUS_LAYOUT.arrowSize);
            holder.addChild(icon);
            holder.hitArea = new PIXI.Circle(0, 0, VERSUS_LAYOUT.arrowSize * 0.7);
            tappable(holder, () => this.lookAtArena(step));
            gsap.to(icon, { x: step * 8, duration: 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        };
        arrow(this.arenaPrev, 'Icon_Arrow_Prev1', -1);
        arrow(this.arenaNext, 'Icon_Arrow_Next1', 1);
        const lock = iconSprite('Icon_Lock03', VERSUS_LAYOUT.lock);
        this.arenaLockWords.y = VERSUS_LAYOUT.lock / 2 + 40;
        this.arenaLock.addChild(lock, this.arenaLockWords);
        this.arenaLock.eventMode = 'none';
    }

    /** What the tab shows: its island, its ribbon, PLAY's words, its own parts. */
    private applyTab(): void {
        const versus = this.tab === 'versus';
        if (versus || this.tab === 'home') this.buildIsland();
        const arena = ARENAS[this.arenaIndex];
        this.arenaLocked = versus && !!arena && !arenaOpen(arena, UfoProgress.levelsWon, UfoProgress.bestTrophies);
        if (this.ribbonText) {
            this.ribbonText.text = (versus ? arena?.name ?? 'VERSUS' : currentArea().name).toUpperCase();
            this.ribbonText.scale.set(Math.min(1, (RIBBON.width - 120) / Math.max(1, this.ribbonText.width / this.ribbonText.scale.x)));
        }
        if (this.playWords) {
            this.playWords.text = versus ? 'PLAY ONLINE' : missionUpTo().name.toUpperCase();
            this.playWords.scale.set(versus ? 0.8 : 1);
        }
        this.play.alpha = this.arenaLocked ? 0.55 : 1;
        this.areaBar.visible = this.tab === 'home';
        if (this.versusHome) {
            this.versusHome.visible = versus;
            if (versus) this.versusHome.refresh();
        }
        this.arenaPrev.visible = versus && this.arenaIndex > 0;
        this.arenaNext.visible = versus && this.arenaIndex < ARENAS.length - 1;
        this.arenaLock.visible = this.arenaLocked;
        if (this.arenaLocked && arena) {
            const needs = arenaNeeds(arena, UfoProgress.levelsWon, UfoProgress.bestTrophies);
            this.arenaLockWords.text = `ARENA ${this.arenaIndex + 1}/${ARENAS.length}\n${needs?.level ? `WIN LEVEL ${needs.level} TO OPEN` : `REACH ${needs?.trophies ?? 0} TROPHIES`}`;
        }
        this.resize();
        if (versus) gsap.delayedCall(0.3, () => this.arenaMoments());
    }

    /** ← / →: the arena before or after. */
    private lookAtArena(step: number): void {
        const next = Math.max(0, Math.min(ARENAS.length - 1, this.arenaIndex + step));
        if (next === this.arenaIndex) return;
        this.arenaIndex = next;
        this.applyTab();
        gsap.fromTo(this.ribbon.scale, { x: 0.7, y: 0.7 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(2.5)' });
    }

    /** PLAY: the next level, or (VERSUS) a match in the arena shown (a padlocked one just shakes). */
    private pressPlay(): void {
        if (this.tab !== 'versus') {
            this.onPlay();
            return;
        }
        if (this.arenaLocked) {
            gsap.fromTo(this.arenaLock, { x: this.arenaLock.x - 14 }, { x: this.arenaLock.x, duration: 0.4, ease: 'elastic.out(1.2, 0.3)' });
            UfoAudio.bump();
            return;
        }
        this.findMatch();
    }

    /** PLAY ONLINE: the matchmaking window finds the players (made up), then the match. */
    private findMatch(): void {
        const arena = ARENAS[this.arenaIndex];
        if (this.matchmaking || !arena) return;
        const players = findPlayers(arena.rivals);
        const look = UfoProgress.avatarLook;
        const you = { name: UfoProgress.username, face: look.face, color: look.color, trophies: UfoProgress.trophies, you: true };
        this.matchmaking = new Matchmaking(arena.name, you, players, () => {
            setMatchPlayers(players);
            this.onVersus(arena.id);
        }, () => this.closeMatchmaking());
        this.ui.addChild(this.matchmaking);
    }

    private closeMatchmaking(): void {
        this.matchmaking?.destroy();
        this.matchmaking = null;
    }

    /** VERSUS's moments: a new arena opened (NEW ARENA!, then it's the one shown), then the trophies a match just changed,
     *  then the tutorial's PLAY ONLINE. */
    private arenaMoments(): void {
        if (this.destroyedScene || this.tab !== 'versus' || this.overlay) return;
        const fresh = ARENAS.map((arena, index) => ({ arena, index }))
            .filter(({ arena }) => arenaOpen(arena, UfoProgress.levelsWon, UfoProgress.bestTrophies) && !UfoProgress.arenaSeen(arena.id));
        if (fresh.length) {
            fresh.forEach(({ arena }) => UfoProgress.markArenaSeen(arena.id));
            const newest = fresh[fresh.length - 1];
            this.openOverlay(new ArenaUnlocked(newest.arena, newest.index + 1, () => {
                this.overlay = null;
                this.arenaIndex = newest.index;
                this.applyTab();
            }));
            return;
        }
        this.trophiesPop();
        if (this.tutorialStep === 'play' && !this.spotlight) this.showTutorialStep();
    }

    /** Back from a match: how the trophies changed, floating up off the strip. */
    private trophiesPop(): void {
        const before = UfoProgress.trophiesBefore;
        UfoProgress.trophiesBefore = -1;
        if (before < 0 || !this.versusHome) return;
        const change = UfoProgress.trophies - before;
        const words = label(44, change >= 0 ? 0x6dff5a : 0xff6b6b);
        words.text = change >= 0 ? `+${change}` : `${change}`;
        words.position.set(this.versusHome.top.x + 230, this.versusHome.top.y - 10);
        this.ui.addChild(words);
        gsap.fromTo(words.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(3)' });
        gsap.to(words, { y: words.y - 60, alpha: 0, duration: 0.9, delay: 0.9, ease: 'power1.in', onComplete: () => words.destroy() });
        UfoAudio.milestone();
    }

    /** The versus tutorial's step on screen: a spotlight on the VERSUS tab, then on PLAY ONLINE. */
    private showTutorialStep(): void {
        this.closeSpotlight();
        if (this.tutorialStep === 'tab') {
            const tab = this.tabs.get('versus');
            if (!tab) return;
            this.spotlight = new Spotlight(tab.holder, 'VERSUS MODE IS OPEN!\nTAP VERSUS', () => {
                this.closeSpotlight();
                this.tutorialStep = 'play';
                this.openTab('versus');
            });
        } else if (this.tutorialStep === 'play') {
            this.spotlight = new Spotlight(this.play, 'PLAY YOUR FIRST\nVERSUS MATCH!', () => {
                this.closeSpotlight();
                this.tutorialStep = null;
                UfoProgress.finishVersusTutorial();
                this.refreshMedal();
                this.findMatch();
            });
        }
        if (this.spotlight) this.ui.addChild(this.spotlight);
        this.refreshMedal();
    }

    private closeSpotlight(): void {
        this.spotlight?.destroy({ children: true });
        this.spotlight = null;
    }

    private openOverlay(overlay: Overlay | TrophyRoad): void {
        this.overlay = overlay;
        this.ui.addChild(overlay);
        if (overlay instanceof TrophyRoad) overlay.layout();
        else overlay.show();
    }

    private openRoad(): void {
        if (this.overlay || this.tutorialStep) return;
        this.openOverlay(new TrophyRoad((step) => this.claimRoad(step), () => {
            this.overlay = null;
            this.versusHome?.refresh();
        }));
    }

    /** A road step's CLAIM: its coins, or its spaceship or alien (owned and worn: the saucer and the tabs change). */
    private claimRoad(step: RoadStep): void {
        UfoProgress.claimRoad(step.trophies, step.reward);
        UfoAudio.milestone();
        if (step.reward.ufo || step.reward.alien) this.onShopChange();
        else this.refreshCoins();
        this.versusHome?.refresh();
    }

    private buildProfile(): void {
        const name = label(PROFILE.nameSize);
        name.text = UfoProgress.username;
        name.anchor.set(0, 0.5);
        name.position.set(PROFILE.nameX, PROFILE.nameY);
        name.scale.set(Math.min(1, PROFILE.nameWidth / Math.max(name.width, 1)));
        this.profile.addChild(this.profileAvatar, name);
        this.profile.hitArea = new PIXI.Rectangle(-PROFILE.avatar / 2, -PROFILE.avatar / 2, PROFILE.hitWidth, PROFILE.hitHeight);
        tappable(this.profile, () => this.openAvatars());
        this.refreshAvatar();
    }

    private refreshAvatar(): void {
        this.profileAvatar.removeChildren().forEach((child) => child.destroy({ children: true }));
        const { face, color } = UfoProgress.avatarLook;
        this.profileAvatar.addChild(makeAvatar({ name: UfoProgress.username, face, color }, PROFILE.avatar));
    }

    private openAvatars(): void {
        if (this.avatarPanel) return;
        this.avatarPanel = new AvatarPanel(() => this.refreshAvatar(), () => {
            this.avatarPanel?.destroy();
            this.avatarPanel = null;
        });
        this.ui.addChild(this.avatarPanel);
        this.avatarPanel.reposition();
    }

    /** Where the coins go: under the name at home; in the corner over a shop, where there's no room for it. */
    private placeTopLeft(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const atHome = this.tab === 'home';
        const { x: left, y: top } = screen.topLeft;
        this.profile.visible = atHome;
        this.profile.position.set(left + PROFILE.x, top + PROFILE.y);
        if (atHome) this.coinsBar.position.set(left + PROFILE.coinsX, top + PROFILE.coinsY);
        else this.coinsBar.position.set(left + TOP.margin + COINS.icon / 2, top + TOP.y);
    }

    /** Bouncing, with rays and a glow behind; a hand points at it until it's been opened, an exclamation mark for what's claimable. */
    private buildMedal(): void {
        const glow = iconSprite('Glow_Circle01', MEDAL.glow);
        glow.tint = MEDAL.raysColor;
        glow.blendMode = PIXI.BLEND_MODES.ADD;
        this.medalRays.tint = MEDAL.raysColor;
        this.medalRays.blendMode = PIXI.BLEND_MODES.ADD;
        const words = label(MEDAL.label);
        words.text = 'RANKING';
        words.y = MEDAL.labelY;
        const circle = iconSprite('Alert_Circle_l_Bg', MEDAL.alert);
        circle.tint = 0xff3b4e;
        this.medalAlert.addChild(circle, iconSprite('Alert_Circle_Icon_Exclamation', MEDAL.alert * 0.55));
        this.medalAlert.position.set(MEDAL.alertX, MEDAL.alertY);
        this.medalHand.anchor.set(0.22, 0.2);
        this.medalHand.position.set(MEDAL.handX, MEDAL.handY);
        this.medal.addChild(glow, this.medalRays, this.medalIcon, words, this.medalAlert, this.medalHand);
        this.medal.hitArea = new PIXI.Circle(0, 0, MEDAL.size * 0.75);
        tappable(this.medal, () => this.openRanking());
        gsap.to(this.medalRays, { rotation: Math.PI * 2, duration: MEDAL.raysSeconds, ease: 'none', repeat: -1 });
        gsap.to(this.medalIcon, { y: -MEDAL.bounce, duration: MEDAL.bounceSeconds, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        gsap.to(this.medalHand, { x: MEDAL.handX + MEDAL.handMove, y: MEDAL.handY + MEDAL.handMove, duration: MEDAL.handSeconds, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        this.refreshMedal();
    }

    private refreshMedal(): void {
        // (Not while the versus tutorial's pointing somewhere else.)
        this.medalHand.visible = !UfoProgress.rankingSeen && !this.tutorialStep;
        this.medalAlert.visible = !UfoProgress.rankingSeen || anyClaimable();
    }

    private openRanking(): void {
        UfoProgress.markRankingSeen();
        this.refreshMedal();
        if (this.rankingPanel) return;
        this.rankingPanel = new RankingPanel(() => this.closeRanking());
        this.ui.addChild(this.rankingPanel);
        this.rankingPanel.reposition();
    }

    private closeRanking(): void {
        this.rankingPanel?.destroy();
        this.rankingPanel = null;
        this.refreshCoins();
        this.refreshMedal();
    }

    private buildMute(): void {
        const back = PIXI.Sprite.from('Button_Round03_Dark');
        back.anchor.set(0.5);
        back.width = back.height = TOP.muteSize;
        const icons = new SoundToggleButton('PictoIcon_Sound', 'PictoIcon_Sound_Off');
        icons.scale.set(TOP.muteSize * MUTE_ICON);
        this.mute.addChild(back, icons);
        this.mute.eventMode = 'static';
        this.mute.cursor = 'pointer';
        this.mute.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            if (event.target !== icons) icons.emit('pointertap', event);
            UfoAudio.toggle();
        });
    }

    private addTab(tab: Tab, name: string): void {
        const holder = new PIXI.Container();
        const icon = new PIXI.Container();
        const words = label(TABS.labelSize);
        words.text = name;
        words.y = TABS.labelY;
        holder.addChild(icon, words);
        tappable(holder, () => this.openTab(tab));
        this.tabBar.addChild(holder);
        this.tabs.set(tab, { holder, icon, words });
    }

    /** The tabs' pictures: the castle for home, and what you're wearing for the shops. */
    private refreshTabIcons(): void {
        const home = this.tabs.get('home')?.icon;
        if (home && !home.children.length) {
            home.addChild(iconSprite('Icon_MapPoint', 100));
        }
        const versus = this.tabs.get('versus')?.icon;
        if (versus && !versus.children.length) {
            versus.addChild(iconSprite('ItemIcon_Trophy_Gold', 100));
            if (!versusOpen()) {
                const lock = iconSprite('Icon_Lock03', 54);
                lock.position.set(30, 26);
                versus.addChild(lock);
            }
        }
        const place = (tab: Tab, texture: PIXI.Texture | null) => {
            const icon = this.tabs.get(tab)?.icon;
            if (!texture || !icon || this.destroyedScene) return;
            icon.removeChildren().forEach((child) => child.destroy());
            const sprite = new PIXI.Sprite(texture);
            sprite.anchor.set(0.5);
            fitSprite(sprite, 100);
            icon.addChild(sprite);
        };
        const ufo = LOOKS.ufos.find((style) => style.id === UfoProgress.worn('ufo'));
        const alien = LOOKS.aliens.find((style) => style.id === UfoProgress.worn('alien'));
        if (ufo) void Snapshots.ufo(ufo).then((texture) => place('ufo', texture));
        if (alien) void Snapshots.alien(alien).then((texture) => place('alien', texture));
    }

    private openTab(tab: Tab): void {
        if (tab === this.tab) return;
        // VERSUS, not open yet: what it takes.
        if (tab === 'versus' && !versusOpen()) {
            const icon = this.tabs.get('versus')?.icon;
            if (icon) gsap.fromTo(icon, { x: icon.x - 10 }, { x: icon.x, duration: 0.4, ease: 'elastic.out(1.2, 0.3)' });
            UfoAudio.bump();
            return;
        }
        this.tab = tab;
        this.shops.forEach((shop) => { shop.visible = false; });
        if (tab === 'alien' || tab === 'ufo') {
            let shop = this.shops.get(tab);
            if (!shop) {
                shop = new ShopPanel(tab, () => this.onShopChange());
                this.shops.set(tab, shop);
                this.ui.addChildAt(shop, this.ui.getChildIndex(this.coinsBar));
            }
            shop.visible = true;
            shop.reposition();
        }
        this.applyTab();
        this.placeTabs();
        this.placeTopLeft();
        const icon = this.tabs.get(tab)?.icon;
        if (icon) gsap.from(icon.scale, { x: 0.7, y: 0.7, duration: 0.3, ease: 'back.out(3)' });
    }

    private onShopChange(): void {
        this.refreshCoins();
        this.refreshTabIcons();
        void this.saucer.applyLook().then(() => {
            if (this.bakedIsland && !this.destroyedScene) this.bake();
        });
    }

    private refreshCoins(): void {
        this.coinsText.text = String(UfoProgress.coins);
    }

    private placeTabs(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const left = screen.topLeft.x;
        const bottom = screen.topLeft.y + screen.height;
        const barTop = bottom - TABS.height;
        this.tabBack.position.set(left, barTop);
        this.tabBack.width = screen.width;
        const third = screen.width / TAB_ORDER.length;
        TAB_ORDER.forEach((tab, i) => {
            const entry = this.tabs.get(tab);
            if (!entry) return;
            const focused = tab === this.tab;
            entry.holder.position.set(left + third * (i + 0.5), barTop + TABS.height / 2);
            // All of its third of the bar is the tab, not just its icon.
            entry.holder.hitArea = new PIXI.Rectangle(-third / 2, -TABS.height / 2 - TABS.rise, third, TABS.height + TABS.rise);
            entry.words.visible = focused;
            entry.icon.y = focused ? TABS.focusIconY : 0;
            entry.icon.scale.set((focused ? TABS.focusIcon : TABS.icon) / 100);
        });
        const at = left + third * TAB_ORDER.indexOf(this.tab);
        this.tabFocus.position.set(at, barTop - TABS.rise);
        this.tabFocus.width = third;
        this.tabLight.position.set(at + TABS.lightInset, barTop - TABS.rise + TABS.lightInset);
        this.tabLight.width = third - TABS.lightInset * 2;
    }

    public resize(): void {
        const screen = Game.overlayScreenData;
        if (!screen || !this.ui.children.length) return;
        this.frameCamera();
        if (this.bakedIsland && this.bakedFor !== `${window.innerWidth}x${window.innerHeight}`) this.rebakeIn = REBAKE_AFTER;
        const top = screen.topLeft.y;
        this.placeTopLeft();
        this.avatarPanel?.reposition();
        this.mute.position.set(screen.topLeft.x + screen.width - TOP.margin - TOP.muteSize / 2, top + TOP.y);
        const versus = this.tab === 'versus';
        this.ribbon.position.set(screen.center.x, top + (versus ? VERSUS_LAYOUT.ribbonY : RIBBON.y));
        const tabsTop = top + screen.height - TABS.height;
        this.play.position.set(screen.center.x, tabsTop - PLAY.up);
        // RANKING (and on VERSUS, ROAD) as a row just over the tabs, either side of PLAY, the same on every tab.
        this.medal.scale.set(SIDE_ROW.scale);
        this.medal.position.set(screen.topLeft.x + SIDE_ROW.x, tabsTop - SIDE_ROW.up);
        // HOME: the area bar over PLAY, shrunk to fit a narrow screen.
        const areaScale = Math.min(HOME_AREA.scale, (screen.width - 24) / AREA_BAR.width);
        this.areaBar.scale.set(areaScale);
        this.areaBar.position.set(screen.center.x, this.play.y - PLAY.height / 2 - HOME_AREA.gap - (AREA_BAR.height * areaScale) / 2);
        // VERSUS: the strip under the ribbon, the ranking and the road under it either side, the arrows by the island.
        if (this.versusHome) {
            const stripScale = Math.min(1, (screen.width - 24) / 600);
            this.versusHome.top.scale.set(stripScale);
            this.versusHome.top.position.set(screen.center.x, this.ribbon.y + VERSUS_LAYOUT.stripGap);
            this.versusHome.roadButton.scale.set(SIDE_ROW.scale);
            this.versusHome.roadButton.position.set(screen.topLeft.x + screen.width - SIDE_ROW.x, tabsTop - SIDE_ROW.up);
        }
        this.arenaPrev.position.set(screen.topLeft.x + VERSUS_LAYOUT.arrows, screen.center.y + 40);
        this.arenaNext.position.set(screen.topLeft.x + screen.width - VERSUS_LAYOUT.arrows, screen.center.y + 40);
        this.arenaLock.position.set(screen.center.x, screen.center.y + 20);
        this.matchmaking?.layout();
        this.overlay?.layout();
        this.rankingPanel?.reposition();
        this.placeTabs();
        this.shops.forEach((shop) => shop.reposition());
    }

    public update(delta: number): void {
        const step = Math.min(delta, 1 / 20);
        this.time += step;
        this.rankingPanel?.update(step);
        this.areaBar.update(step);
        this.versusHome?.update(step);
        this.matchmaking?.update(step);
        this.overlay?.update(step);
        this.spotlight?.update(step);
        this.placeCamera();
        if (this.bakedUfo) {
            this.bakedUfo.y = this.bakedUfoY + Math.sin(this.time * BAKED_BOB.speed) * BAKED_BOB.height;
            if (this.rebakeIn > 0) {
                this.rebakeIn -= step;
                if (this.rebakeIn <= 0) this.bake();
            }
        } else {
            this.saucer.update(step);
            this.town.culler.update(this.threeCamera);
        }
        super.update(step);
    }

    public destroy(): void {
        this.destroyedScene = true;
        window.removeEventListener('pointerdown', this.startSound, true);
        window.removeEventListener('keydown', this.startSound, true);
        DebugOverlay.instance.removePanel(DEBUG_PANEL);
        gsap.killTweensOf(this.play.scale);
        gsap.killTweensOf([this.medalRays, this.medalIcon, this.medalHand]);
        if (this.shine) gsap.killTweensOf(this.shine);
        if (this.glow) gsap.killTweensOf(this.glow);
        this.tabs.forEach(({ icon }) => {
            gsap.killTweensOf(icon);
            gsap.killTweensOf(icon.scale);
        });
        gsap.killTweensOf([this.ribbon.scale, this.arenaLock]);
        this.arenaPrev.children.forEach((child) => gsap.killTweensOf(child));
        this.arenaNext.children.forEach((child) => gsap.killTweensOf(child));
        this.matchmaking?.destroy();
        this.matchmaking = null;
        this.bakedIsland?.texture.destroy(true);
        this.bakedUfo?.texture.destroy(true);
        this.ui.destroy({ children: true });
        this.saucer?.destroy();
        this.islands.forEach(({ town }) => {
            town.separateSea()?.removeFromParent();
            town.destroy();
        });
        super.destroy();
    }
}
