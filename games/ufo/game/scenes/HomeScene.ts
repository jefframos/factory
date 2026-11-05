// HomeScene.ts
//
// The main screen: the area's miniature (its own town, ui/areas.json `miniature`) as a little island in the sea, with the
// saucer you're wearing hovering over it, seen from far off through a long lens. Over it: your coins, the area's name, the
// button to play the next level, a floating icon to the competition's ranking, and the bottom tabs: the aliens' shop, home,
// the spaceships' shop.
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
import { DESIGN, LOOKS, currentArea, homeLevel, missionUpTo } from '../data/UfoConfig';
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

type Tab = 'alien' | 'home' | 'ufo';
const TAB_ORDER: Tab[] = ['alien', 'home', 'ufo'];

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
    public ready: Promise<void> = Promise.resolve();

    /** `onPlay`: the level's button; `onCompetition`: the ranking's. */
    public constructor(game: Game, private readonly onPlay: () => void, private readonly onCompetition: () => void) {
        super(game);
    }

    public build(): void {
        this.threeScene.add(new THREE.HemisphereLight(0xffffff, 0x5a7a4a, 1.6));
        const sun = new THREE.DirectionalLight(0xffffff, 1.5);
        sun.position.set(6, 14, 8);
        this.threeScene.add(sun);
        this.threeCamera.fov = VIEW.fov;
        updateBend(new THREE.Vector3(), 0);

        const level = homeLevel();
        this.threeScene.background = level.island ? deepSea(level.island.water) : new THREE.Color(FAR_SEA);
        this.town = new UfoTown(this.threeScene, level);
        const { minX, maxX, minZ, maxZ } = this.town.bounds();
        const span = Math.max(maxX - minX, maxZ - minZ);
        // The town's player point is the pivot, and where the saucer hovers. Framed so the island still fits round it.
        const { x, z } = level.start;
        this.span = 2 * Math.max(x - minX, maxX - x, z - minZ, maxZ - z);
        this.target.set(x, 0, z);
        this.saucer = new Saucer(this.threeScene, x, z);
        this.saucer.respawn(x, z, span * VIEW.ufoSize, 0);
        this.saucer.hover(span * VIEW.ufoHeight);
        this.frameCamera();
        this.ready = Promise.all([this.town.ready, this.saucer.loaded]).then(() => {
            if (VIEW.baked && !this.destroyedScene) this.bake();
        });
        this.buildUi();
        this.game.uiLayer.addChild(this.ui);
        this.buildDebug();
        if (UfoAudio.started()) this.startSound();
        else {
            window.addEventListener('pointerdown', this.startSound, true);
            window.addEventListener('keydown', this.startSound, true);
        }
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
        tappable(this.play, () => this.onPlay());
        gsap.to(this.play.scale, { x: 1.03, y: 1.03, duration: 0.7, yoyo: true, repeat: -1, ease: 'sine.inOut' });
        this.buildMedal();

        this.tabBack.tint = TABS.barColor;
        this.tabFocus.tint = TABS.focusColor;
        this.tabLight.tint = TABS.lightColor;
        this.tabBar.addChild(this.tabBack, this.tabFocus, this.tabLight);
        this.addTab('alien', 'ALIENS');
        this.addTab('home', 'HOME');
        this.addTab('ufo', 'SPACESHIPS');
        // The shops go in over the buttons, under the coins and the tabs (openTab()).
        this.ui.addChild(this.ribbon, this.medal, this.play, this.profile, this.coinsBar, this.mute, this.tabBar);
        // Back from a round: straight to how it changed the ranking.
        if (UfoProgress.openRankingOnHome) {
            UfoProgress.openRankingOnHome = false;
            this.openRanking();
        }
        this.refreshCoins();
        this.refreshTabIcons();
        this.resize();
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
        this.medalHand.visible = !UfoProgress.rankingSeen;
        this.medalAlert.visible = !UfoProgress.rankingSeen || anyClaimable();
    }

    private openRanking(): void {
        UfoProgress.markRankingSeen();
        this.refreshMedal();
        if (this.rankingPanel) return;
        this.rankingPanel = new RankingPanel(() => this.closeRanking(), () => this.onCompetition());
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
        this.tab = tab;
        this.shops.forEach((shop) => { shop.visible = false; });
        if (tab !== 'home') {
            let shop = this.shops.get(tab);
            if (!shop) {
                shop = new ShopPanel(tab, () => this.onShopChange());
                this.shops.set(tab, shop);
                this.ui.addChildAt(shop, this.ui.getChildIndex(this.coinsBar));
            }
            shop.visible = true;
            shop.reposition();
        }
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
        this.ribbon.position.set(screen.center.x, top + RIBBON.y);
        const tabsTop = top + screen.height - TABS.height;
        this.play.position.set(screen.center.x, tabsTop - PLAY.up);
        this.medal.position.set(screen.topLeft.x + MEDAL.x, top + MEDAL.y);
        this.rankingPanel?.reposition();
        this.placeTabs();
        this.shops.forEach((shop) => shop.reposition());
    }

    public update(delta: number): void {
        const step = Math.min(delta, 1 / 20);
        this.time += step;
        this.rankingPanel?.update(step);
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
        this.tabs.forEach(({ icon }) => gsap.killTweensOf(icon.scale));
        this.bakedIsland?.texture.destroy(true);
        this.bakedUfo?.texture.destroy(true);
        this.ui.destroy({ children: true });
        this.saucer?.destroy();
        this.town?.destroy();
        super.destroy();
    }
}
