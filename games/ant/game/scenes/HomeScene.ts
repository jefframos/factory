// HomeScene.ts
//
// The main screen, after the UFO game's (games/ufo/game/scenes/HomeScene.ts): the picture of the level the player is on
// — its jelly cubes on their tray (PictureView), swaying gently on the peach floor — with LEVEL N on a red ribbon over
// it, the sound button top right, the big yellow PLAY under it, and the bottom tabs: a gift (nothing yet), home, and the
// shop (an empty panel for now). Arrows either side of the picture go through the levels already reached (to replay
// one); the ▶| under the right one jumps back to the furthest.

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import gsap from 'gsap';
import SoundManager from 'core/audio/SoundManager';
import { Game } from 'core/Game';
import SetupThree from 'core/scene/SetupThree';
import { ThreeScene } from 'core/scene/ThreeScene';
import { AntAudio } from '../audio/AntAudio';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { AntSave } from '../data/AntSave';
import { LEVELS, pixelsOf } from '../data/Levels';
import { PictureView, TRAY_TOP } from '../world/PictureView';
import { LAYOUT } from '../world/Layout';
import { FLOOR, floorTexture } from './AntScene';
import { DARK, dimmer, framePlane, iconSprite, label, plainLabel, roundButton, tappable } from '../ui/UiParts';

/** Design units (720 x 1080). The bottom tabs (as UFO's), the ribbon, the PLAY button, the sound button. */
const TABS = {
    height: 108, rise: 14, barColor: 0x2b2d4d, focusColor: 0x4a6ef5, lightColor: 0x86a2ff, lightInset: 5,
    icon: 70, focusIcon: 88, focusIconY: -18, labelY: 34, labelSize: 22,
};
const RIBBON = { y: 140, width: 400, height: 86, scale: 0.6, text: 36, textY: -6 };
const PLAY = { width: 380, height: 104, up: 96, textSize: 54 };
const PLAY_SLICE = { side: 82, height: 194 };
const SHINE = { glowWidth: 1.35, glowHeight: 2.2, glowColor: 0xffd23f, glowFrom: 0.3, glowTo: 0.75, glowSeconds: 0.9, band: 90, tilt: 0.35, sweep: 0.75, wait: 1.5, alpha: 0.85, corner: 0.32 };
const MUTE = { size: 56, margin: 16, y: 48, icon: 0.55 / 128 };
/** The level arrows: their size, how far in from the screen's sides, how far above the middle; the latest button under the right one. */
const ARROWS = { size: 64, margin: 44, up: 60, latest: 54, latestDown: 76 };
/** The shop panel (empty for now): its frame's margins from the screen's edges. */
const SHOP = { top: 110, bottom: 30, side: 22, scale: 0.9, title: 40, titleY: 34 };
/** The camera: field of view, tilt from straight down, how much of the screen's width the tray fills, and how far the
 *  picture sits above the screen's middle (world units); the picture's sway. */
const VIEW = { fov: 30, tiltDeg: 28, fill: 0.86, lift: 1.6, swayDeg: 3, swaySpeed: 0.5, bob: 0.25 };

type Tab = 'gift' | 'home' | 'shop';
const TAB_ORDER: Tab[] = ['gift', 'home', 'shop'];
const TAB_ICONS: Record<Tab, { frame: string; name: string }> = {
    gift: { frame: 'ItemIcon_Gift_Blue', name: 'SOON' },
    home: { frame: 'Icon_MapPoint', name: 'HOME' },
    shop: { frame: 'ItemIcon_Shop', name: 'SHOP' },
};

/** A soft band of white, across a small canvas: the PLAY button's shine. */
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

export default class HomeScene extends ThreeScene {
    private readonly ui = new PIXI.Container();
    private readonly ribbon = new PIXI.Container();
    private readonly ribbonText = label(RIBBON.text);
    private readonly prev = roundButton('Button_Round02_Blue', 'Icon_Arrow_Prev1', ARROWS.size, ARROWS.size * 0.5);
    private readonly next = roundButton('Button_Round02_Blue', 'Icon_Arrow_Next1', ARROWS.size, ARROWS.size * 0.5);
    private readonly latest = roundButton('Button_Round02_Blue', 'Icon_Skip', ARROWS.latest, ARROWS.latest * 0.55);
    /** The level shown (and PLAY starts). */
    private index = 0;
    private readonly play = new PIXI.Container();
    private readonly mute = new PIXI.Container();
    private readonly tabBar = new PIXI.Container();
    private readonly tabBack = framePlane('Menu_BottomBtn_Bg', 720, TABS.height);
    private readonly tabFocus = framePlane('Menu_BottomBtn_TabFocus', 240, TABS.height + TABS.rise);
    private readonly tabLight = framePlane('Menu_BottomBtn_TabFocus_Light', 230, TABS.height + TABS.rise - TABS.lightInset);
    private readonly tabs = new Map<Tab, { holder: PIXI.Container; icon: PIXI.Container; words: PIXI.Text }>();
    private shop: PIXI.Container | null = null;
    private tab: Tab = 'home';
    /** The picture and the stand it sways on. */
    private readonly stand = new THREE.Group();
    private picture?: PictureView;
    private time = 0;
    private shine: PIXI.Sprite | null = null;
    private glow: PIXI.Sprite | null = null;

    /** `onPlay`: the PLAY button. */
    public constructor(game: Game, private readonly onPlay: () => void) {
        super(game);
    }

    public build(): void {
        this.threeScene.background = new THREE.Color(FLOOR);
        const pmrem = new THREE.PMREMGenerator(SetupThree.renderer);
        this.threeScene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
        this.threeScene.environmentIntensity = 0.3;
        pmrem.dispose();
        this.threeScene.add(new THREE.HemisphereLight(0xfff4ea, 0xc98f62, 0.75));
        const sun = new THREE.DirectionalLight(0xffffff, 0.95);
        sun.position.set(5, 30, 18);
        this.threeScene.add(sun);
        const floor = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 1 }));
        floor.rotation.x = -Math.PI / 2;
        floor.position.y = -0.4;
        this.threeScene.add(floor);
        this.threeCamera.fov = VIEW.fov;

        this.threeScene.add(this.stand);
        this.buildUi();
        this.showLevel(Math.max(0, Math.min(AntSave.selected, LEVELS.length - 1)));
        this.game.uiLayer.addChild(this.ui);
        this.resize();
    }

    /** The level `index`, as it'll look in the game: its picture, LEVEL N, which arrows show. */
    private showLevel(index: number): void {
        this.index = index;
        AntSave.selected = index;
        this.ribbonText.text = `LEVEL ${index + 1}`;
        this.picture?.destroy();
        this.picture = undefined;
        const level = LEVELS[index];
        if (level) {
            const cell = Math.min(LAYOUT.pictureMax.width / level.width, LAYOUT.pictureMax.depth / level.height);
            this.picture = new PictureView(level, pixelsOf(level), cell);
            this.picture.group.position.set(-this.picture.width / 2, TRAY_TOP, -this.picture.depth / 2);
            this.stand.add(this.picture.group);
        }
        const furthest = Math.min(AntSave.level, LEVELS.length - 1);
        this.prev.visible = index > 0;
        this.next.visible = index < furthest;
        this.latest.visible = index < furthest - 1;
        this.frameCamera();
    }

    /** One level back or on (`step`), or to `to`: the picture pops in. */
    private browse(to: number): void {
        const furthest = Math.min(AntSave.level, LEVELS.length - 1);
        const index = Math.max(0, Math.min(to, furthest));
        if (index === this.index) return;
        this.showLevel(index);
        this.stand.scale.setScalar(0.85);
        gsap.to(this.stand.scale, { x: 1, y: 1, z: 1, duration: 0.35, ease: 'back.out(2.5)' });
        gsap.fromTo(this.ribbon.scale, { x: 0.9, y: 0.9 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(3)' });
    }

    private buildUi(): void {
        const ribbonBack = framePlane('Title_Ribbon04_Red', RIBBON.width, RIBBON.height, RIBBON.scale);
        ribbonBack.position.set(-RIBBON.width / 2, -RIBBON.height / 2);
        this.ribbonText.y = RIBBON.textY;
        this.ribbon.addChild(ribbonBack, this.ribbonText);
        tappable(this.prev, () => this.browse(this.index - 1));
        tappable(this.next, () => this.browse(this.index + 1));
        tappable(this.latest, () => this.browse(AntSave.level));

        this.buildPlay();
        this.buildMute();

        this.tabBack.tint = TABS.barColor;
        this.tabFocus.tint = TABS.focusColor;
        this.tabLight.tint = TABS.lightColor;
        this.tabBar.addChild(this.tabBack, this.tabFocus, this.tabLight);
        for (const tab of TAB_ORDER) this.addTab(tab);
        this.ui.addChild(this.ribbon, this.prev, this.next, this.latest, this.play, this.mute, this.tabBar);
    }

    /** The pack's big PLAY: a tapered yellow button, dark words with no outline, a gold glow breathing and a shine sweeping. */
    private buildPlay(): void {
        const scale = PLAY.height / PLAY_SLICE.height;
        const back = new PIXI.NineSlicePlane(PIXI.Texture.from('Button_Tapered_Yellow'), PLAY_SLICE.side, 0, PLAY_SLICE.side, 0);
        back.scale.set(scale);
        back.width = PLAY.width / scale;
        back.height = PLAY_SLICE.height;
        back.position.set(-PLAY.width / 2, -PLAY.height / 2);
        const words = plainLabel(PLAY.textSize, DARK);
        words.text = 'PLAY';
        words.y = -6;
        this.glow = iconSprite('Glow_Circle01', PLAY.width);
        this.glow.width = PLAY.width * SHINE.glowWidth;
        this.glow.height = PLAY.height * SHINE.glowHeight;
        this.glow.tint = SHINE.glowColor;
        this.glow.alpha = SHINE.glowFrom;
        gsap.to(this.glow, { alpha: SHINE.glowTo, duration: SHINE.glowSeconds, yoyo: true, repeat: -1, ease: 'sine.inOut' });
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
        this.play.addChild(this.glow, back, words, outline, this.shine);
        // Only the button itself is a tap, not the glow round it.
        this.play.hitArea = new PIXI.Rectangle(-PLAY.width / 2, -PLAY.height / 2, PLAY.width, PLAY.height);
        tappable(this.play, () => this.onPlay());
        gsap.to(this.play.scale, { x: 1.03, y: 1.03, duration: 0.7, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }

    /** Sound on / off (SoundManager's saved mute), top right as in UFO. */
    private buildMute(): void {
        const back = PIXI.Sprite.from('Button_Round03_Dark');
        back.anchor.set(0.5);
        back.width = back.height = MUTE.size;
        const on = PIXI.Sprite.from('PictoIcon_Sound');
        const off = PIXI.Sprite.from('PictoIcon_Sound_Off');
        for (const icon of [on, off]) {
            icon.anchor.set(0.5);
            icon.scale.set(MUTE.size * MUTE.icon);
        }
        const refresh = () => {
            on.visible = !SoundManager.instance.isMuted;
            off.visible = SoundManager.instance.isMuted;
        };
        this.mute.addChild(back, on, off);
        tappable(this.mute, () => {
            SoundManager.instance.toggleMute();
            refresh();
        }, 'toggle');
        refresh();
    }

    private addTab(tab: Tab): void {
        const holder = new PIXI.Container();
        const icon = new PIXI.Container();
        icon.addChild(iconSprite(TAB_ICONS[tab].frame, 100));
        const words = label(TABS.labelSize);
        words.text = TAB_ICONS[tab].name;
        words.y = TABS.labelY;
        holder.addChild(icon, words);
        tappable(holder, () => this.openTab(tab), 'tab');
        this.tabBar.addChild(holder);
        this.tabs.set(tab, { holder, icon, words });
    }

    private openTab(tab: Tab): void {
        if (tab === 'gift') {
            // Nothing there yet: a little wiggle.
            const icon = this.tabs.get(tab)?.icon;
            if (icon) gsap.fromTo(icon, { rotation: -0.25 }, { rotation: 0, duration: 0.5, ease: 'elastic.out(3, 0.3)' });
            return;
        }
        if (tab === this.tab) return;
        this.tab = tab;
        if (tab === 'shop') this.openShop();
        else this.closeShop();
        this.placeTabs();
        const icon = this.tabs.get(tab)?.icon;
        if (icon) gsap.from(icon.scale, { x: 0.7, y: 0.7, duration: 0.3, ease: 'back.out(3)' });
    }

    /** The shop: the pack's popup frame over the screen (down to the tabs), empty for now. */
    private openShop(): void {
        if (this.shop) return;
        const screen = Game.overlayScreenData;
        const shop = new PIXI.Container();
        const dim = dimmer();
        dim.beginFill(0x10123a, 0.35).drawRect(screen.topLeft.x, screen.topLeft.y, screen.width, screen.height).endFill();
        const width = screen.width - SHOP.side * 2;
        const height = screen.height - TABS.height - SHOP.top - SHOP.bottom;
        const frame = framePlane('Popup04_Topber_Single', width, height, SHOP.scale);
        frame.position.set(screen.topLeft.x + SHOP.side, screen.topLeft.y + SHOP.top);
        const title = label(SHOP.title);
        title.text = 'SHOP';
        title.position.set(screen.center.x, frame.y + SHOP.titleY);
        const soon = label(30);
        soon.text = 'Coming soon!';
        soon.position.set(screen.center.x, frame.y + height / 2);
        const icon = iconSprite('ItemIcon_Shop', 140);
        icon.position.set(screen.center.x, soon.y - 110);
        shop.addChild(dim, frame, title, icon, soon);
        this.shop = shop;
        // Under the tabs, so they still switch back.
        this.ui.addChildAt(shop, this.ui.getChildIndex(this.tabBar));
        gsap.from(frame, { y: frame.y + 40, alpha: 0, duration: 0.25, ease: 'power2.out' });
    }

    private closeShop(): void {
        this.shop?.destroy({ children: true });
        this.shop = null;
    }

    private placeTabs(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const left = screen.topLeft.x;
        const barTop = screen.topLeft.y + screen.height - TABS.height;
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

    /** The camera frames the tray across most of the screen's width, the picture a little above the middle. */
    private frameCamera(): void {
        const camera = this.threeCamera;
        camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
        const tilt = THREE.MathUtils.degToRad(VIEW.tiltDeg);
        const half = THREE.MathUtils.degToRad(camera.fov / 2);
        const trayWidth = (this.picture?.width ?? LAYOUT.pictureMax.width) + 4;
        const trayDepth = (this.picture?.depth ?? LAYOUT.pictureMax.depth) + 4;
        // Wide enough for the tray (across) and, on a short screen, for its depth with room for the UI.
        const forWidth = trayWidth / VIEW.fill / 2 / (Math.tan(half) * camera.aspect);
        const forDepth = (trayDepth * Math.cos(tilt)) / 0.5 / 2 / Math.tan(half);
        const distance = Math.max(forWidth, forDepth);
        const aim = VIEW.lift;
        camera.position.set(0, Math.cos(tilt) * distance, aim + Math.sin(tilt) * distance);
        camera.lookAt(0, 0, aim);
        camera.near = distance * 0.2;
        camera.far = distance * 3;
        camera.updateProjectionMatrix();
    }

    public resize(): void {
        const screen = Game.overlayScreenData;
        if (!screen || !this.ui.children.length) return;
        this.frameCamera();
        const top = screen.topLeft.y;
        this.mute.position.set(screen.topLeft.x + screen.width - MUTE.margin - MUTE.size / 2, top + MUTE.y);
        this.ribbon.position.set(screen.center.x, top + RIBBON.y);
        const arrowsY = screen.center.y - ARROWS.up;
        this.prev.position.set(screen.topLeft.x + ARROWS.margin, arrowsY);
        this.next.position.set(screen.topLeft.x + screen.width - ARROWS.margin, arrowsY);
        this.latest.position.set(this.next.x, arrowsY + ARROWS.latestDown);
        this.play.position.set(screen.center.x, top + screen.height - TABS.height - PLAY.up);
        this.placeTabs();
        if (this.shop) {
            this.closeShop();
            this.openShop();
        }
    }

    public update(delta: number): void {
        const step = Math.min(delta, 1 / 20);
        this.time += step;
        // The picture sways a little and bobs, as if it floated.
        this.stand.rotation.y = THREE.MathUtils.degToRad(VIEW.swayDeg) * Math.sin(this.time * VIEW.swaySpeed);
        this.stand.position.y = VIEW.bob * Math.sin(this.time * VIEW.swaySpeed * 2);
        this.picture?.update(step);
        super.update(step);
    }

    public destroy(): void {
        gsap.killTweensOf([this.play.scale, this.stand.scale, this.ribbon.scale]);
        if (this.shine) gsap.killTweensOf(this.shine);
        if (this.glow) gsap.killTweensOf(this.glow);
        this.tabs.forEach(({ icon }) => gsap.killTweensOf([icon, icon.scale]));
        this.ui.destroy({ children: true });
        this.picture?.destroy();
        super.destroy();
    }
}
