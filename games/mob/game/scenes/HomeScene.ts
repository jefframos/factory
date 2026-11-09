// HomeScene.ts
//
// The main screen, as Ant's and UFO's (games/ant/game/scenes/HomeScene.ts): the coins top left, the sound button top
// right, LEVEL N on a red ribbon with the area under it, the big yellow PLAY, and the bottom tabs: UPGRADES (the
// cannon's upgrades), HOME, AREAS (how far through each area: tap one to pick its first level). Behind it all, the world
// map (ui/worldmap.json, WorldMapView): the areas' hexagon tiles filling in as the player beats their levels, a flag on
// each beaten area, the pin on the next tile, the next area padlocked; the camera swaying slowly over it. With no map
// made, the level PLAY starts instead: its field in 3D in its area's look (the battle's own Arena). A level already
// beaten is replayed from the AREAS tab (an area's levels open under its row).

import * as PIXI from 'pixi.js';
import * as THREE from 'three';
import gsap from 'gsap';
import SoundToggleButton from 'core/ui/SoundToggleButton';
import { Game } from 'core/Game';
import { ThreeScene } from 'core/scene/ThreeScene';
import { ARENA, UpgradeKind, useField } from '../data/MobConfig';
import { MobSave } from '../data/MobSave';
import { PLAY as PLAY_LIST, areaProgress, battleConfig, battleZone } from '../data/MobLevels';
import { themeById } from '../data/Themes';
import { MobEvents } from '../data/MobEvents';
import { MobAudio } from '../audio/MobAudio';
import { Battle } from '../battle/Battle';
import { Arena } from '../battle/Arena';
import { WORLD_MAP } from '../data/WorldMap';
import { WorldMapView } from '../world/WorldMapView';
import { MapMarkers } from '../ui/MapMarkers';
import { CardKind } from '../data/Settings';
import { bendDrop, updateBend } from '../services/Bend';
import { HomePanel, PanelKind } from '../ui/HomePanels';
import { COIN_BAR, DARK, fillCoinBar, framePlane, iconSprite, label, plainLabel, tappable } from '../ui/UiParts';

/** Design units (720 x 1080). The bottom tabs (as Ant's and UFO's), the ribbon, the PLAY button, the sound button. */
const TABS = {
    height: 118, rise: 14, barColor: 0x2b2d4d, focusColor: 0x4a6ef5, lightColor: 0x86a2ff, lightInset: 5,
    icon: 74, focusIcon: 92, focusIconY: -18, labelY: 36, labelSize: 22,
};
const RIBBON = { y: 160, width: 430, height: 86, scale: 0.6, text: 36, textY: -6, areaY: 62, areaSize: 26 };
const PLAY = { width: 440, height: 110, up: 92, textSize: 54 };
const PLAY_SLICE = { side: 82, height: 194 };
const SHINE = { glowWidth: 1.35, glowHeight: 2.2, glowColor: 0xffd23f, glowFrom: 0.3, glowTo: 0.75, glowSeconds: 0.9, band: 90, tilt: 0.35, sweep: 0.75, wait: 1.5, alpha: 0.85, corner: 0.32 };
const MUTE = { size: 56, margin: 16, y: 48, icon: 0.55 / 128 };
/** The view: the camera's tilt and field of view, its sway (radians either way, and how fast), where the field goes on
 *  the screen (a share of its height: from under the ribbon to well over PLAY; of its width: the margin either side),
 *  and how far the island's sand reaches past the hedges (much wider than in a battle). */
const VIEW = { pitchDeg: 52, fov: 40, sway: 0.1, swaySpeed: 0.22, top: 0.28, bottom: 0.7, side: 0.03, island: 9 };
/** The world's bend (gentler than the battle's: seen from further off, a strong one curls the sea away), and the light. */
const BEND = { origin: new THREE.Vector3(0, 0, 1.5), strength: 0.0012 };
const LIGHT = { sky: 1.15, sun: 1.25 };
/**
 * The editor's world map preview (?home=1&map=…): `all`, every area beaten (the whole map); an area's id, the player
 * just come to it (its first level next). Anything else, or none: how far the player really is. The save isn't touched.
 */
const MAP_VIEW = new URLSearchParams(window.location.search).get('map');
function mapProgress(): { index: number; furthest: number; preview: boolean } {
    if (MAP_VIEW === 'all') return { index: PLAY_LIST.length, furthest: PLAY_LIST.length - 1, preview: true };
    const first = MAP_VIEW ? PLAY_LIST.findIndex((entry) => entry.zone.id === MAP_VIEW) : -1;
    if (first >= 0) return { index: first, furthest: first, preview: true };
    return { index: MobSave.battle, furthest: MobSave.furthest, preview: false };
}

/** The sky over the world map. */
const MAP_SKY = 0x8fd8ff;

type Tab = 'upgrades' | 'home' | 'areas';
const TAB_ORDER: Tab[] = ['upgrades', 'home', 'areas'];
const TAB_ICONS: Record<Tab, { frame: string; name: string }> = {
    upgrades: { frame: 'ItemIcon_Gear', name: 'UPGRADES' },
    home: { frame: 'Icon_Castle', name: 'HOME' },
    areas: { frame: 'Icon_MapPoint', name: 'AREAS' },
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
    private readonly areaText = label(RIBBON.areaSize, 0xdbe8ff);
    private readonly play = new PIXI.Container();
    /** The level shown (and PLAY starts). */
    private index = 0;
    private readonly mute = new PIXI.Container();
    private readonly tabBar = new PIXI.Container();
    private readonly tabBack = framePlane('Menu_BottomBtn_Bg', 720, TABS.height);
    private readonly tabFocus = framePlane('Menu_BottomBtn_TabFocus', 240, TABS.height + TABS.rise);
    private readonly tabLight = framePlane('Menu_BottomBtn_TabFocus_Light', 230, TABS.height + TABS.rise - TABS.lightInset);
    private readonly tabs = new Map<Tab, { holder: PIXI.Container; icon: PIXI.Container; words: PIXI.Text }>();
    private readonly panels = new Map<PanelKind, HomePanel>();
    private readonly coinsBar = new PIXI.Container();
    private readonly coinsText = label(COIN_BAR.textSize);
    private tab: Tab = 'home';
    /** The world map (when one's made), or the level's field (when not). */
    private map: WorldMapView | null = null;
    /** The map's markers (2D, over its areas). */
    private marks: MapMarkers | null = null;
    private battle: Battle | null = null;
    private arena: Arena | null = null;
    /** The camera's distance back, and how far it's slid along its own up (fitted once to the field: frameCamera()). */
    private distance = 30;
    private slide = 0;
    private readonly aim = new THREE.Vector3();
    private time = 0;
    private shine: PIXI.Sprite | null = null;
    private glow: PIXI.Sprite | null = null;

    /** `onPlay`: the PLAY button. */
    public constructor(game: Game, private readonly onPlay: () => void) {
        super(game);
    }

    public build(): void {
        this.threeScene.add(new THREE.HemisphereLight(0xffffff, 0x6b8f4a, LIGHT.sky));
        const sun = new THREE.DirectionalLight(0xffffff, LIGHT.sun);
        sun.position.set(6, 14, 8);
        this.threeScene.add(sun);
        this.index = MobSave.selected;
        if (WORLD_MAP.tiles.length) {
            // The map isn't bent: the tiles are separate pieces, and it's seen whole.
            updateBend(BEND.origin, 0);
            this.threeScene.background = new THREE.Color(MAP_SKY);
            const progress = mapProgress();
            this.map = new WorldMapView(progress.index, progress.furthest, undefined, !progress.preview, MAP_VIEW === 'all');
            this.threeScene.add(this.map.group);
        } else {
            updateBend(BEND.origin, BEND.strength);
            this.buildField();
        }
        this.buildUi();
        this.showLevel(this.index);
        this.game.uiLayer.addChild(this.ui);
        this.resize();
    }

    /** The level PLAY starts, as the battle will draw it: its field size, its area's look, its pieces. */
    private buildField(): void {
        const index = this.index;
        const config = battleConfig(index);
        const zone = battleZone(index);
        const theme = themeById(zone.theme);
        this.threeScene.background = new THREE.Color(theme.sky);
        useField(config);
        this.battle = new Battle(config);
        // Not played: no reds come, but the spinners and pushers go round.
        this.battle.state = 'won';
        this.arena = new Arena(config, this.battle.targets, theme, undefined, !!zone.plainForts, VIEW.island);
        // Just the pieces: the forts' hits, the gates' multipliers and the rest crowd the screen under the ribbon.
        this.arena.hideLabels();
        this.threeScene.add(this.arena.group);
    }

    private buildUi(): void {
        const ribbonBack = framePlane('Title_Ribbon04_Red', RIBBON.width, RIBBON.height, RIBBON.scale);
        ribbonBack.position.set(-RIBBON.width / 2, -RIBBON.height / 2);
        this.ribbonText.y = RIBBON.textY;
        this.areaText.y = RIBBON.areaY;
        this.ribbon.addChild(ribbonBack, this.ribbonText, this.areaText);

        this.buildPlay();
        this.buildMute();

        this.tabBack.tint = TABS.barColor;
        this.tabFocus.tint = TABS.focusColor;
        this.tabLight.tint = TABS.lightColor;
        this.tabBar.addChild(this.tabBack, this.tabFocus, this.tabLight);
        for (const tab of TAB_ORDER) this.addTab(tab);
        fillCoinBar(this.coinsBar, this.coinsText);
        this.refreshCoins();
        // The map's markers under everything else.
        if (this.map) {
            this.marks = new MapMarkers(this.map.areas);
            this.ui.addChild(this.marks);
        }
        this.ui.addChild(this.ribbon, this.play, this.mute, this.coinsBar, this.tabBar);
    }

    /** Level `index` shown (and picked: PLAY starts it): its ribbon, which arrows show; its field, once built. */
    private showLevel(index: number): void {
        this.index = index;
        MobSave.select(index);
        const area = areaProgress(index);
        this.ribbonText.text = `LEVEL ${index + 1}`;
        this.areaText.text = `AREA ${area.number} · ${area.zone.name.toUpperCase()}`;
    }

    /** To level `to` (one back or on, or the furthest): its field built afresh, popping in. */
    private browse(to: number): void {
        const index = Math.max(0, Math.min(to, MobSave.furthest));
        if (index === this.index) return;
        this.index = index;
        // On the map, only the ribbon changes; without one, the level's field is built afresh.
        if (this.arena) {
            this.threeScene.remove(this.arena.group);
            this.arena.dispose();
            this.buildField();
            this.frameCamera();
            const field = this.arena as Arena | null;
            if (field) {
                field.group.scale.setScalar(0.85);
                gsap.to(field.group.scale, { x: 1, y: 1, z: 1, duration: 0.35, ease: 'back.out(2.5)' });
            }
        }
        this.showLevel(index);
        gsap.fromTo(this.ribbon.scale, { x: 0.9, y: 0.9 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(3)' });
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

    /** Sound on / off (the shared toggle, as in the battle), top right. */
    private buildMute(): void {
        const back = PIXI.Sprite.from('Button_Round03_Dark');
        back.anchor.set(0.5);
        back.width = back.height = MUTE.size;
        const icons = new SoundToggleButton('PictoIcon_Sound', 'PictoIcon_Sound_Off');
        icons.scale.set(MUTE.size * MUTE.icon);
        this.mute.addChild(back, icons);
        this.mute.eventMode = 'static';
        this.mute.cursor = 'pointer';
        this.mute.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            if (event.target !== icons) icons.emit('pointertap', event);
            gsap.fromTo(this.mute.scale, { x: 0.86, y: 0.86 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)' });
        });
    }

    private addTab(tab: Tab): void {
        const holder = new PIXI.Container();
        const icon = new PIXI.Container();
        icon.addChild(iconSprite(TAB_ICONS[tab].frame, 100));
        const words = label(TABS.labelSize);
        words.text = TAB_ICONS[tab].name;
        words.y = TABS.labelY;
        holder.addChild(icon, words);
        tappable(holder, () => this.openTab(tab));
        this.tabBar.addChild(holder);
        this.tabs.set(tab, { holder, icon, words });
    }

    private openTab(tab: Tab): void {
        if (tab === this.tab) return;
        this.tab = tab;
        this.panels.forEach((panel) => { panel.visible = false; });
        if (tab !== 'home') {
            let panel = this.panels.get(tab);
            if (!panel) {
                panel = new HomePanel(tab, (kind) => this.buy(kind), (index) => this.playLevel(index), (kind) => this.buyCard(kind));
                this.panels.set(tab, panel);
                // Over the ribbon and PLAY, under the coins, the sound button and the tabs.
                this.ui.addChildAt(panel, this.ui.getChildIndex(this.mute));
            }
            panel.visible = true;
            panel.refresh();
            panel.reposition();
        }
        this.placeTabs();
        const icon = this.tabs.get(tab)?.icon;
        if (icon) gsap.from(icon.scale, { x: 0.7, y: 0.7, duration: 0.3, ease: 'back.out(3)' });
    }

    /** A level tapped in the AREAS tab: picked and played (a win goes on to the level after it). */
    private playLevel(index: number): void {
        this.browse(index);
        this.onPlay();
    }

    /** An upgrade card tapped in the UPGRADES tab: bought if there are the coins. */
    private buy(kind: UpgradeKind): void {
        if (!MobSave.buy(kind)) return;
        MobAudio.play('coins');
        MobEvents.upgradeBought(kind, MobSave.level(kind));
        this.refreshCoins();
        this.panels.forEach((panel) => panel.refresh());
        gsap.fromTo(this.coinsBar.scale, { x: 1.15, y: 1.15 }, { x: 1, y: 1, duration: 0.2 });
    }

    /** A unit card's next level tapped in the UPGRADES tab: bought if there are the coins. */
    private buyCard(kind: CardKind): void {
        if (!MobSave.buyCard(kind)) return;
        MobAudio.play('coins');
        this.refreshCoins();
        this.panels.forEach((panel) => panel.refresh());
        gsap.fromTo(this.coinsBar.scale, { x: 1.15, y: 1.15 }, { x: 1, y: 1, duration: 0.2 });
    }

    private refreshCoins(): void {
        this.coinsText.text = String(MobSave.coins);
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

    /**
     * The camera: at VIEW's tilt, looking at the field's middle, slid (along its own up) so that middle is halfway
     * between VIEW.top and VIEW.bottom of the screen, and as close as it can be with the field's four corners (where
     * the bend draws them) inside that band and in from the sides: the field fills the room between the ribbon and PLAY.
     */
    private frameCamera(): void {
        const camera = this.threeCamera;
        camera.fov = VIEW.fov;
        camera.aspect = window.innerWidth / Math.max(1, window.innerHeight);
        camera.near = 0.5;
        camera.far = 400;
        camera.updateProjectionMatrix();
        // What's framed: the map's tiles that show, or the field (its hedges).
        const box = this.map?.bounds;
        const [minX, maxX, nearZ, farZ] = box ? [box.min.x, box.max.x, box.max.z, box.min.z] : [-(ARENA.halfWidth + 1), ARENA.halfWidth + 1, 0, ARENA.baseZ];
        this.aim.set((minX + maxX) / 2, 0, (nearZ + farZ) / 2);
        const corners = [nearZ, farZ].flatMap((z) => [minX, maxX].map((x) => new THREE.Vector3(x, -bendDrop(x, z), z)));
        const middle = new THREE.Vector3(0, -bendDrop(0, this.aim.z), this.aim.z);
        const band = window.innerHeight * (VIEW.top + VIEW.bottom) / 2;
        const fits = (): boolean => corners.every((corner) => {
            const at = this.worldToScreen(corner);
            return !!at && at.x >= window.innerWidth * VIEW.side && at.x <= window.innerWidth * (1 - VIEW.side)
                && at.y >= window.innerHeight * VIEW.top && at.y <= window.innerHeight * VIEW.bottom;
        });
        for (let distance = 3; distance < 200; distance += 0.25) {
            this.distance = distance;
            this.slide = 0;
            this.placeCamera(0);
            // Slid until the middle's on the band's centre (a few passes: the slide changes how far off it is).
            for (let pass = 0; pass < 4; pass++) {
                const at = this.worldToScreen(middle);
                if (!at || Math.abs(at.y - band) < 0.5) break;
                const depth = middle.clone().sub(this.threeCamera.position).dot(this.threeCamera.getWorldDirection(new THREE.Vector3()));
                const worldPerPixel = (2 * depth * Math.tan(THREE.MathUtils.degToRad(this.threeCamera.fov) / 2)) / window.innerHeight;
                // Camera up: the field moves down the screen.
                this.slide += (band - at.y) * worldPerPixel;
                this.placeCamera(0);
            }
            if (fits()) break;
        }
    }

    /** The camera `yaw` round the field's middle (its sway), at the fitted distance, slid up its own up by `slide`. */
    private placeCamera(yaw: number): void {
        const camera = this.threeCamera;
        const pitch = THREE.MathUtils.degToRad(VIEW.pitchDeg);
        const back = Math.cos(pitch) * this.distance;
        camera.position.set(this.aim.x + Math.sin(yaw) * back, Math.sin(pitch) * this.distance, this.aim.z + Math.cos(yaw) * back);
        camera.lookAt(this.aim);
        camera.updateMatrixWorld(true);
        camera.position.addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1), this.slide);
        camera.updateMatrixWorld(true);
    }

    public resize(): void {
        const screen = Game.overlayScreenData;
        if (!screen || !this.ui.children.length) return;
        this.frameCamera();
        const top = screen.topLeft.y;
        this.mute.position.set(screen.topLeft.x + screen.width - MUTE.margin - MUTE.size / 2, top + MUTE.y);
        this.ribbon.position.set(screen.center.x, top + RIBBON.y);
        this.play.position.set(screen.center.x, top + screen.height - TABS.height - PLAY.up);
        this.placeTabs();
        this.coinsBar.position.set(screen.topLeft.x + 30 + COIN_BAR.icon / 2, top + MUTE.y);
        this.panels.forEach((panel) => panel.reposition());
    }

    public update(delta: number): void {
        const step = Math.min(delta, 1 / 20);
        this.time += step;
        if (this.battle && this.arena) {
            this.battle.step(step);
            this.arena.update(this.battle, step);
        }
        this.map?.update(step);
        this.placeCamera(Math.sin(this.time * VIEW.swaySpeed) * VIEW.sway);
        // The markers over their areas, where the camera has them now.
        if (this.marks) {
            this.marks.update(step);
            this.marks.place((area) => {
                const at = this.worldToScreen(area.anchor);
                return at ? this.marks!.toLocal(new PIXI.Point(at.x, at.y)) : null;
            });
        }
        this.panels.forEach((panel) => { if (panel.visible) panel.update(step); });
        super.update(step);
    }

    public destroy(): void {
        gsap.killTweensOf([this.play.scale, this.ribbon.scale, this.coinsBar.scale]);
        if (this.arena) gsap.killTweensOf(this.arena.group.scale);
        if (this.shine) gsap.killTweensOf(this.shine);
        if (this.glow) gsap.killTweensOf(this.glow);
        this.tabs.forEach(({ icon }) => gsap.killTweensOf([icon, icon.scale]));
        this.ui.destroy({ children: true });
        this.arena?.dispose();
        this.map?.dispose();
        super.destroy();
    }
}
