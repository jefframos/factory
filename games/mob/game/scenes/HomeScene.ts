// HomeScene.ts
//
// The main screen, as Ant's and UFO's (games/ant/game/scenes/HomeScene.ts): the coins top left, the sound button top
// right, LEVEL N on a red ribbon with the area under it, the big yellow PLAY, and the bottom tabs: UPGRADES (the
// cannon's upgrades), HOME, AREAS (how far through each area: tap one to pick its first level). Behind it all, the world
// map (ui/worldmap.json, WorldMapView): the areas' hexagon tiles filling in as the player beats their levels, a flag on
// each beaten area, the pin on the next tile, the next area padlocked; the camera swaying slowly over it. With no map
// made, the level PLAY starts instead: its field in 3D in its area's look (the battle's own Arena). A level already
// beaten is replayed from the AREAS tab (an area's levels open under its row).
//
// The two middle tabs are the game modes (bigger, each on its own coloured plate, their names always shown): STORY (the
// above) and ARENA (the arena mode, the fake multiplayer: game/data/ArenaConfig). ARENA changes the whole screen: the
// arena's field behind (the last one the player has opened: they open as the story goes on, `unlockAt`), the purple
// ribbon with its name, PLAY ONLINE and PRACTICE side by side, padlocked till the first one opens. The arenas open one
// after another (the first by the story, the rest by the most trophies the player's had: Arenas.ts); the ribbon's
// arrows look through them (one not open yet: padlocked, what it takes), a new one opening is a moment of its own
// (ArenaUnlocked). Once one's open (ArenaHome, as Clash Royale's main menu): the player's strip (their profile:
// ProfilePanel), the trophy road's bar (the road: TrophyRoad), and the free chest over PLAY (a video opens it). The
// chests won in matches open back here (ChestOpen).
//
// The side tabs: CARDS (the unit cards: the arena's battle deck, the collection, each card's details and upgrade:
// CardPopup, UpgradeShow) and RANKING on the arena's side; UPGRADES (the cannon's) and AREAS on the story's.

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
import { ArenaConfig, arenaBattle } from '../data/ArenaConfig';
import { ARENA_ORDER, arenaFor, arenaNeeds, arenaOpen } from '../data/Arenas';
import { ArenaUnlocked } from '../ui/ArenaUnlocked';
import { Spotlight } from '../ui/Spotlight';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { Ladder, tierFor } from '../data/ArenaLadder';
import ladderFile from '../../ui/arena-ladder.json';
import { bendDrop, updateBend } from '../services/Bend';
import { HomePanel, PanelKind } from '../ui/HomePanels';
import { RankingPanel } from '../ui/RankingPanel';
import { MatchPlayer, Matchmaking } from '../ui/Matchmaking';
import { MatchStart } from './MobScene';
import { AVATARS, usernameFrom } from '../data/Profile';
import { opponentFor, tierBadge } from '../data/ArenaLadder';
import { anyClaimable } from '../data/Ranking';
import { COIN_BAR, DARK, fillCoinBar, fillGemBar, glossyButton, framePlane, iconSprite, label, plainLabel, roundButton, tappable } from '../ui/UiParts';
import { ArenaHome, SLOTS, SLOTS_WIDTH, STRIP } from '../ui/ArenaHome';
import { CardPopup } from '../ui/CardPopup';
import { UpgradeShow } from '../ui/UpgradeShow';
import { ChestOpen } from '../ui/ChestOpen';
import { NewCardShow } from '../ui/NewCardShow';
import { TrophyRoad } from '../ui/TrophyRoad';
import { ProfilePanel } from '../ui/ProfilePanel';
import { Overlay } from '../ui/Overlay';
import { RoadStep } from '../data/ArenaRewards';
import { CARD_KINDS, SETTINGS } from '../data/Settings';

/** Design units (720 x 1080). The bottom tabs (as Ant's and UFO's), the ribbon, the PLAY button, the sound button. */
const TABS = {
    height: 118, rise: 14, barColor: 0x2b2d4d, focusColor: 0x4a6ef5, lightColor: 0x86a2ff, lightInset: 5,
    icon: 74, focusIcon: 92, focusIconY: -18, labelY: 36, labelSize: 22,
};
const RIBBON = { y: 128, width: 430, height: 86, scale: 0.6, text: 36, textY: -6, areaY: 62, areaSize: 26 };
/** The mode tabs' plates (always up, a colour each; the one not shown sits `drop` lower) and their icons. */
const MODE_TABS = { story: 0x18c25a, arena: 0x8f45ff, drop: 16, icon: 84, focusIcon: 100, rise: 22, inset: 5 };
/** Each mode tab's shine (over its plate, as the side tabs' focus has one). */
const MODE_LIGHTS = { story: 0x8cf7b4, arena: 0xc9a2ff };
/** The arena's PRACTICE button, beside PLAY (PLAY slid left by `shift` to make room). */
const PRACTICE = { width: 180, height: 90, gap: 14, shift: 95 };
/** The arena's own parts: the strip's middle under the ribbon, the chest slots' over PLAY. */
const ARENA_HOME = { stripY: 222, slotsOver: 22 };
const PLAY = { width: 440, height: 110, up: 92, textSize: 54 };
const PLAY_SLICE = { side: 82, height: 194 };
const SHINE = { glowWidth: 1.35, glowHeight: 2.2, glowColor: 0xffd23f, glowFrom: 0.3, glowTo: 0.75, glowSeconds: 0.9, band: 90, tilt: 0.35, sweep: 0.75, wait: 1.5, alpha: 0.85, corner: 0.32 };
const MUTE = { size: 56, margin: 16, y: 48, icon: 0.55 / 128 };
/** A side tab's badge (a quest's reward waiting, a card to upgrade or not looked at): its size and where on the tab. */
const RANKING_BADGE = { size: 36, x: 34, y: -40 };
/** The view: the camera's tilt and field of view, its sway (radians either way, and how fast), where the field goes on
 *  the screen (a share of its height: from under the ribbon to well over PLAY; of its width: the margin either side),
 *  and how far the island's sand reaches past the hedges (much wider than in a battle). */
const VIEW = { pitchDeg: SETTINGS.camera?.homePitchDeg ?? 52, fov: 40, sway: 0.1, swaySpeed: 0.22, top: 0.28, bottom: 0.7, side: 0.03, island: 9 };
/** The arena's view (its field between the road's bar and the chest slots). */
// (It reaches down behind the free chest's plate, to just over PLAY: squeezed over the chest, the field showed small.)
const ARENA_VIEW = { top: 0.32, bottom: 0.74 };
/** The arrows looking through the arenas: how far in from the screen's sides. */
const ARENA_ARROWS = { inset: 56 };
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

type Mode = 'story' | 'arena';
type Tab = 'cards' | 'upgrades' | 'ranking' | Mode | 'areas';
const TAB_ORDER: Tab[] = ['cards', 'ranking', 'arena', 'story', 'upgrades', 'areas'];
const TAB_ICONS: Record<Tab, { frame: string; name: string }> = {
    cards: { frame: 'PictoIcon_Cards', name: 'CARDS' },
    upgrades: { frame: 'ItemIcon_Gear', name: 'UPGRADES' },
    ranking: { frame: 'ItemIcon_Medalstand', name: 'RANKING' },
    story: { frame: 'Icon_Castle', name: 'STORY' },
    arena: { frame: 'ItemIcon_Battle', name: 'ARENA' },
    areas: { frame: 'Icon_MapPoint', name: 'AREAS' },
};
const isMode = (tab: Tab): tab is Mode => tab === 'story' || tab === 'arena';
const LADDER = ladderFile as Ladder;
/** The mode last shown (back from a match, the main screen's on it again). */
let lastMode: Mode = 'story';

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
    /** The story's ribbon (red, stretched) and the arena's (purple, fixed), with its words and rating. */
    private readonly storyRibbon = new PIXI.Container();
    private readonly arenaRibbon = new PIXI.Container();
    private readonly arenaText = label(RIBBON.text);
    private readonly ratingText = label(RIBBON.areaSize, 0xffe066);
    /** The mode on (STORY / ARENA), and the arena shown (null: none made), whether it's open. */
    private mode: Mode = lastMode;
    private shownArena: { id: string; arena: ArenaConfig } | null = null;
    private arenaLocked = false;
    private readonly modePlates = new Map<Mode, PIXI.NineSlicePlane>();
    private readonly modeLights = new Map<Mode, PIXI.NineSlicePlane>();
    /** PLAY's words (PLAY ONLINE in the arena), PRACTICE (the arena's, against the bot), and the matchmaking window. */
    private playWords: PIXI.Text | null = null;
    private readonly practice = glossyButton(PRACTICE.width, PRACTICE.height, 'PRACTICE', 'Button01_l_Sky');
    private matchmaking: Matchmaking | null = null;
    /** The RANKING tab's badge, and its page once it's been opened. */
    private readonly rankingBadge = new PIXI.Container();
    /** The CARDS tab's badge (a card ready to upgrade, or new). */
    private readonly cardsBadge = new PIXI.Container();
    /** The arena's strip, road bar and chest slots (shown in the arena, once it's open), and a window over it all. */
    private readonly arenaHome = new ArenaHome({
        profile: () => this.openOverlay(new ProfilePanel(() => this.arenaHome.refresh(), () => this.overlayClosed())),
        road: () => this.openOverlay(new TrophyRoad((step) => this.claimRoad(step), () => this.overlayClosed())),
        adChest: () => void this.watchAdChest(),
    });
    /** The arena looked at (ARENA_ORDER's index; -1: the player's own, the last open), the ribbon's arrows, the padlock
     *  over one not open yet, and a video playing (the free chest's). */
    private viewArena = -1;
    private readonly arenaPrev = roundButton('Button_Round02_Blue', 'Icon_Arrow_Prev1', 64);
    private readonly arenaNext = roundButton('Button_Round02_Blue', 'Icon_Arrow_Next1', 64);
    private readonly arenaLock = new PIXI.Container();
    private watching = false;
    /** The versus mode's tutorial: its step (null: none on), the spotlight showing it; the ARENA tab's padlock. */
    private tutorialStep: 'tab' | 'play' | null = null;
    private spotlight: Spotlight | null = null;
    private readonly arenaTabLock = iconSprite('Icon_Lock03', 40);
    private overlay: Overlay | TrophyRoad | null = null;
    private rankingPanel: RankingPanel | null = null;
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
    /** The gems (the competition's quests pay them), beside the coins. */
    private readonly gemsBar = new PIXI.Container();
    private readonly gemsText = label(COIN_BAR.textSize);
    private tab: Tab = lastMode;
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

    /** `onPlay`: the PLAY button (an arena's id: a match there, online or practice). */
    public constructor(game: Game, private readonly onPlay: (arena?: string, match?: MatchStart) => void) {
        super(game);
    }

    public build(): void {
        MobAudio.music('menu');
        this.threeScene.add(new THREE.HemisphereLight(0xffffff, 0x6b8f4a, LIGHT.sky));
        const sun = new THREE.DirectionalLight(0xffffff, LIGHT.sun);
        sun.position.set(6, 14, 8);
        this.threeScene.add(sun);
        this.index = MobSave.selected;
        this.buildUi();
        this.showLevel(this.index);
        this.buildMode();
        this.game.uiLayer.addChild(this.ui);
        this.resize();
        // Versus mode just opened (and not tried): its tutorial.
        if (arenaFor(MobSave.battle + 1, MobSave.bestTrophies).open && !MobSave.arenaTutorial) this.tutorialStep = this.mode === 'arena' ? 'play' : 'tab';
        this.tutorialHides();
    }

    /** During the tutorial only what it points at: the free chest and PRACTICE hidden (back after it). */
    private tutorialHides(): void {
        const on = !!this.tutorialStep;
        this.arenaHome.slots.visible = !on;
        this.practice.visible = !on && this.mode === 'arena' && !this.arenaLocked && !!this.shownArena;
        this.resize();
    }

    /** The versus tutorial's step on screen: a spotlight on the ARENA tab, then on PLAY ONLINE. */
    private showTutorialStep(): void {
        if (this.tutorialStep === 'tab') {
            const tab = this.tabs.get('arena');
            if (!tab) return;
            this.spotlight = new Spotlight(tab.holder, 'VERSUS MODE IS OPEN!\nTAP ARENA', () => {
                this.closeSpotlight();
                this.tutorialStep = 'play';
                this.openTab('arena');
            });
        } else {
            this.spotlight = new Spotlight(this.play, 'PLAY YOUR FIRST\nVERSUS MATCH!', () => {
                this.closeSpotlight();
                this.tutorialStep = null;
                MobSave.finishArenaTutorial();
                this.pressPlay();
                this.tutorialHides();
            });
        }
        this.ui.addChild(this.spotlight);
    }

    private closeSpotlight(): void {
        this.spotlight?.destroy({ children: true });
        this.spotlight = null;
    }

    /** What's behind for the mode on: the story's world map (or its level's field), or the arena's field. */
    private buildMode(): void {
        this.map?.dispose();
        if (this.map) this.threeScene.remove(this.map.group);
        this.map = null;
        this.marks?.destroy({ children: true });
        this.marks = null;
        if (this.arena) {
            this.threeScene.remove(this.arena.group);
            this.arena.dispose();
        }
        this.arena = null;
        this.battle = null;
        if (this.mode === 'arena') {
            // The arenas stay open once reached (the most trophies the player's had).
            const reached = MobSave.battle + 1;
            const { current, open } = arenaFor(reached, MobSave.bestTrophies);
            this.anyArenaOpen = open;
            if (this.viewArena < 0 || this.viewArena >= ARENA_ORDER.length) this.viewArena = Math.max(0, ARENA_ORDER.findIndex((entry) => entry.id === current?.id));
            const shown = ARENA_ORDER[this.viewArena] ?? null;
            this.shownArena = shown;
            this.arenaLocked = !shown || !arenaOpen(shown.arena, reached, MobSave.bestTrophies);
            // Flat, as the map is: the sea then reaches every edge of the screen (bent, the sky shows past it).
            updateBend(BEND.origin, 0);
            if (shown) this.buildArenaField(shown.arena);
            this.showArenaRibbon();
        } else if (WORLD_MAP.tiles.length) {
            // The map isn't bent: the tiles are separate pieces, and it's seen whole.
            updateBend(BEND.origin, 0);
            this.threeScene.background = new THREE.Color(MAP_SKY);
            const progress = mapProgress();
            this.map = new WorldMapView(progress.index, progress.furthest, undefined, !progress.preview, MAP_VIEW === 'all');
            this.threeScene.add(this.map.group);
            // The map's markers under everything else.
            this.marks = new MapMarkers(this.map.areas);
            this.ui.addChildAt(this.marks, 0);
        } else {
            updateBend(BEND.origin, BEND.strength);
            this.buildField();
        }
        this.storyRibbon.visible = this.mode === 'story';
        this.arenaRibbon.visible = this.mode === 'arena';
        this.play.alpha = this.mode === 'arena' && this.arenaLocked ? 0.55 : 1;
        // The arena: PLAY ONLINE (a "player"), and PRACTICE (the bot) over it.
        if (this.playWords) {
            this.playWords.text = this.mode === 'arena' ? 'PLAY ONLINE' : 'PLAY';
            this.playWords.scale.set(this.mode === 'arena' ? 0.78 : 1);
        }
        this.practice.visible = this.mode === 'arena' && !this.arenaLocked && !!this.shownArena;
        this.arenaHome.visible = this.mode === 'arena' && this.anyArenaOpen;
        // (The tutorial: no free chest, no PRACTICE.)
        if (this.tutorialStep) {
            this.arenaHome.slots.visible = false;
            this.practice.visible = false;
        } else this.arenaHome.slots.visible = true;
        this.arenaTabLock.visible = !arenaFor(MobSave.battle + 1, MobSave.bestTrophies).open;
        if (this.arenaHome.visible) this.arenaHome.refresh();
        // The arrows (looking through the arenas), and the padlock over one not open yet.
        this.arenaPrev.visible = this.mode === 'arena' && this.viewArena > 0;
        this.arenaNext.visible = this.mode === 'arena' && this.viewArena < ARENA_ORDER.length - 1;
        this.arenaLock.visible = this.mode === 'arena' && this.arenaLocked && !!this.shownArena;
        this.resize();
        // Back on the arena: a new one opened, then the chests won, each a moment of its own.
        if (this.mode === 'arena') gsap.delayedCall(0.3, () => this.arenaMoments());
    }

    /** Whether any arena's open (the arena's own parts show once one is). */
    private anyArenaOpen = false;

    /** One arena on or back (the arrows): the field, the ribbon, PLAY for it. */
    private lookAtArena(step: number): void {
        const next = Math.max(0, Math.min(ARENA_ORDER.length - 1, this.viewArena + step));
        if (next === this.viewArena) return;
        this.viewArena = next;
        this.buildMode();
        this.frameCamera();
        gsap.fromTo(this.ribbon.scale, { x: 0.7, y: 0.7 }, { x: 1, y: 1, duration: 0.3, ease: 'back.out(2.5)' });
    }

    /** The arena's moments, one after another: a new arena opened (NEW ARENA!: then it's the one shown), then each
     *  chest won in a match, opened. */
    private arenaMoments(): void {
        if (this.ui.destroyed || this.mode !== 'arena' || this.overlay) return;
        const reached = MobSave.battle + 1;
        const fresh = ARENA_ORDER.map((entry, index) => ({ ...entry, index }))
            .filter((entry) => arenaOpen(entry.arena, reached, MobSave.bestTrophies) && !MobSave.arenaSeen(entry.id));
        if (fresh.length) {
            fresh.forEach((entry) => MobSave.markArenaSeen(entry.id));
            const newest = fresh[fresh.length - 1];
            this.openOverlay(new ArenaUnlocked(newest.arena, newest.index + 1, () => {
                this.overlay = null;
                this.viewArena = newest.index;
                this.buildMode();
                this.frameCamera();
            }));
            return;
        }
        const opened = MobSave.openPending();
        if (!opened) return;
        this.refreshCoins();
        this.openOverlay(new ChestOpen(opened.kind, opened.loot, () => {
            this.overlayClosed();
            this.arenaMoments();
        }));
    }

    /** The free chest: its video, then it opens (no video, or it was cut short: nothing). */
    private async watchAdChest(): Promise<void> {
        if (this.watching || this.overlay) return;
        this.watching = true;
        const rewarded = await PlatformHandler.instance.platform.showRewardedVideo('mob-free-chest').catch(() => false);
        this.watching = false;
        if (this.ui.destroyed || !rewarded) return;
        const opened = MobSave.openAdChest();
        if (!opened) return;
        this.refreshCoins();
        this.openOverlay(new ChestOpen(opened.kind, opened.loot, () => this.overlayClosed()));
    }

    /** An arena's field as a match has it (both halves, both sides' cannons and towers), not played. */
    private buildArenaField(arena: ArenaConfig): void {
        const config = arenaBattle(arena);
        const theme = themeById(arena.theme ?? 'beach');
        this.threeScene.background = new THREE.Color(theme.sky);
        useField(config);
        this.battle = new Battle(config);
        this.battle.state = 'won';
        this.arena = new Arena(config, this.battle.targets, theme, undefined, false, VIEW.island, this.battle.blueTargets);
        this.arena.hideLabels();
        this.threeScene.add(this.arena.group);
    }

    /** The arena's ribbon: its name only (what's open and next is on the arena bar under it: a second line here would
     *  sit on the player's strip); one not open yet: what it takes, under its padlock. */
    private showArenaRibbon(): void {
        const arena = this.shownArena?.arena;
        this.arenaText.text = (arena?.name ?? 'ARENA').toUpperCase();
        this.ratingText.text = arena ? '' : 'COMING SOON';
        const lockWords = this.arenaLock.getChildByName('words') as PIXI.Text | null;
        if (!arena || !this.arenaLocked || !lockWords) return;
        const number = `ARENA ${this.viewArena + 1}/${ARENA_ORDER.length}`;
        const needs = arenaNeeds(arena, MobSave.battle + 1, MobSave.bestTrophies);
        lockWords.text = needs?.level ? `${number}\nUNLOCKS AFTER LEVEL ${needs.level - 1}` : `${number}\nREACH ${needs?.trophies ?? 0} TROPHIES`;
    }

    /** PLAY: the story's level, or a match in the arena shown (a padlocked one just shakes). */
    private pressPlay(): void {
        if (this.mode === 'story') return this.onPlay();
        if (!this.shownArena || this.arenaLocked) {
            gsap.fromTo(this.arenaRibbon, { x: this.arenaRibbon.x - 12 }, { x: this.arenaRibbon.x, duration: 0.4, ease: 'elastic.out(1.2, 0.3)' });
            MobAudio.play('click');
            return;
        }
        this.findOpponent(this.shownArena.id);
    }

    /** PLAY ONLINE: the matchmaking window finds a "player" (the ladder's robot, given a name and face), then the match. */
    private findOpponent(arena: string): void {
        if (this.matchmaking) return;
        const record = MobSave.arena;
        const opponent = opponentFor(LADDER, record, MobSave.arenaLoadout());
        const seed = Math.floor(Math.random() * 2 ** 32);
        const look = AVATARS[seed % AVATARS.length];
        // Trophies near the player's (a fair match, as it'd be).
        const trophies = Math.max(0, record.rating + Math.round((Math.random() - 0.5) * 60));
        const them: MatchPlayer = { name: usernameFrom(seed), face: look.face, color: look.color, trophies, tier: opponent.tier.name, badge: tierBadge(LADDER, opponent.tierIndex) };
        const mine = AVATARS[MobSave.avatar % AVATARS.length];
        const you: MatchPlayer = { name: MobSave.username, face: mine.face, color: mine.color, trophies: record.rating, tier: LADDER.tiers[tierFor(LADDER, record)].name, badge: tierBadge(LADDER, tierFor(LADDER, record)) };
        this.matchmaking = new Matchmaking(you, them, () => this.onPlay(arena, { online: true, opponent: them }), () => this.closeMatchmaking());
        this.ui.addChild(this.matchmaking);
    }

    private closeMatchmaking(): void {
        this.matchmaking?.destroy();
        this.matchmaking = null;
    }

    /** The level PLAY starts, as the battle will draw it: its field size, its area's look, its pieces. */
    private buildField(): void {
        // (The story's level field, when there's no world map.)
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
        this.storyRibbon.addChild(ribbonBack, this.ribbonText, this.areaText);
        // The arena's: the same ribbon in purple (its own image), the rating under it as the area is under the story's.
        const arenaBack = framePlane('Title_Ribbon04_Purple', RIBBON.width, RIBBON.height, RIBBON.scale);
        arenaBack.position.set(-RIBBON.width / 2, -RIBBON.height / 2);
        this.arenaText.y = RIBBON.textY;
        this.ratingText.y = RIBBON.areaY;
        this.arenaRibbon.addChild(arenaBack, this.arenaText, this.ratingText);
        this.ribbon.addChild(this.storyRibbon, this.arenaRibbon);

        this.buildPlay();
        this.buildMute();

        this.tabBack.tint = TABS.barColor;
        this.tabFocus.tint = TABS.focusColor;
        this.tabLight.tint = TABS.lightColor;
        this.tabBar.addChild(this.tabBack, this.tabFocus, this.tabLight);
        // The mode tabs' own plates (under the tabs' icons, over the bar).
        for (const mode of ['story', 'arena'] as Mode[]) {
            const plate = framePlane('Menu_BottomBtn_TabFocus', 180, TABS.height + MODE_TABS.rise);
            plate.tint = MODE_TABS[mode];
            const light = framePlane('Menu_BottomBtn_TabFocus_Light', 170, TABS.height + MODE_TABS.rise - MODE_TABS.inset);
            light.tint = MODE_LIGHTS[mode];
            this.modePlates.set(mode, plate);
            this.modeLights.set(mode, light);
            this.tabBar.addChild(plate, light);
        }
        for (const tab of TAB_ORDER) this.addTab(tab);
        fillCoinBar(this.coinsBar, this.coinsText);
        fillGemBar(this.gemsBar, this.gemsText);
        this.refreshCoins();
        this.buildRankingBadge();
        // The ARENA tab's padlock (till versus mode opens).
        this.arenaTabLock.position.set(RANKING_BADGE.x, RANKING_BADGE.y);
        this.tabs.get('arena')?.holder.addChild(this.arenaTabLock);
        this.buildCardsBadge();
        this.practice.words.scale.set(0.78);
        tappable(this.practice, () => {
            if (this.shownArena && !this.arenaLocked) this.onPlay(this.shownArena.id, { online: false });
        });
        // The arenas' arrows (beside the ribbon) and the padlock over one not open yet.
        tappable(this.arenaPrev, () => this.lookAtArena(-1));
        tappable(this.arenaNext, () => this.lookAtArena(1));
        const lockGlow = iconSprite('Glow_Circle01', 260);
        lockGlow.tint = 0x10123a;
        lockGlow.alpha = 0.8;
        const lock = iconSprite('Icon_Lock03', 130);
        lock.y = -20;
        const lockWords = label(28);
        lockWords.name = 'words';
        lockWords.y = 90;
        this.arenaLock.addChild(lockGlow, lock, lockWords);
        this.arenaLock.visible = false;
        this.ui.addChild(this.ribbon, this.arenaHome, this.arenaLock, this.arenaPrev, this.arenaNext, this.play, this.practice, this.mute, this.coinsBar, this.gemsBar, this.tabBar);
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
        this.playWords = words;
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
        tappable(this.play, () => this.pressPlay());
        gsap.to(this.play.scale, { x: 1.03, y: 1.03, duration: 0.7, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    }

    /** The RANKING tab's red badge (on its icon) while a quest's reward waits. */
    private buildRankingBadge(): void {
        const circle = iconSprite('Alert_Circle_l_Bg', RANKING_BADGE.size);
        circle.tint = 0xff3b4e;
        this.rankingBadge.addChild(circle, iconSprite('Alert_Circle_Icon_Exclamation', RANKING_BADGE.size * 0.55));
        this.rankingBadge.position.set(RANKING_BADGE.x, RANKING_BADGE.y);
        this.tabs.get('ranking')?.holder.addChild(this.rankingBadge);
        this.refreshRanking();
    }

    private refreshRanking(): void {
        this.rankingBadge.visible = anyClaimable();
    }

    /** The CARDS tab's red badge while a card can be upgraded (its copies there) or hasn't been looked at. */
    private buildCardsBadge(): void {
        const circle = iconSprite('Alert_Circle_l_Bg', RANKING_BADGE.size);
        circle.tint = 0xff3b4e;
        this.cardsBadge.addChild(circle, iconSprite('Alert_Circle_Icon_Exclamation', RANKING_BADGE.size * 0.55));
        this.cardsBadge.position.set(RANKING_BADGE.x, RANKING_BADGE.y);
        this.tabs.get('cards')?.holder.addChild(this.cardsBadge);
        this.refreshCards();
    }

    private refreshCards(): void {
        this.cardsBadge.visible = CARD_KINDS.some((kind) => MobSave.isNew(kind) || MobSave.canUpgrade(kind));
    }

    /** A window over everything (a card, a chest, the road, the profile). */
    private openOverlay(overlay: Overlay | TrophyRoad): void {
        this.overlay?.close();
        this.overlay = overlay;
        this.ui.addChild(overlay);
        overlay.show();
    }

    /** A window closed: what it changed shown. */
    private overlayClosed(): void {
        this.overlay = null;
        this.refreshAll();
    }

    private refreshAll(): void {
        this.refreshCoins();
        this.refreshRanking();
        this.refreshCards();
        if (this.arenaHome.visible) this.arenaHome.refresh();
        this.panels.forEach((panel) => {
            if (!panel.visible) return;
            panel.refresh();
            panel.reposition();
        });
    }

    /** A card tapped in the CARDS tab: its details (upgrade, use, remove). */
    private openCard(kind: CardKind): void {
        this.openOverlay(new CardPopup(kind, {
            upgrade: (card) => {
                const from = MobSave.cardLevel(card);
                if (!MobSave.buyCard(card)) return;
                MobAudio.play('coins');
                this.overlay?.close();
                this.openOverlay(new UpgradeShow(card, from, () => this.overlayClosed()));
            },
            use: (card, instead) => {
                MobSave.useCard(card, instead);
                MobAudio.play('confirm');
                this.overlay?.close();
            },
            remove: (card) => {
                if (MobSave.removeCard(card)) MobAudio.play('click');
                this.overlay?.close();
            },
        }, () => this.overlayClosed()));
    }

    /** A trophy road step claimed: its chest opened over the road (or its coins / gems / copies added). */
    private claimRoad(step: RoadStep): void {
        const got = MobSave.claimRoad(step);
        if (!got) return;
        MobAudio.play('coins');
        this.refreshCoins();
        if (got.card) {
            // Over the road (which stays under it).
            const road = this.overlay;
            const show = new NewCardShow(got.card, () => {
                this.overlay = road;
                this.refreshAll();
            });
            this.overlay = show;
            this.ui.addChild(show);
            show.show();
            return;
        }
        if (got.chest) {
            // Over the road (which stays under it).
            const road = this.overlay;
            const chest = new ChestOpen(got.chest, got.loot, () => {
                this.overlay = road;
                this.refreshAll();
            });
            this.overlay = chest;
            this.ui.addChild(chest);
            chest.show();
        }
    }

    /** The RANKING tab's page (as the other tabs' panels: over the ribbon and PLAY, under the coins and the tab bar). */
    private showRanking(): void {
        if (!this.rankingPanel) {
            this.rankingPanel = new RankingPanel(null, null, () => {
                this.refreshCoins();
                this.refreshRanking();
            }, TABS.height);
            this.ui.addChildAt(this.rankingPanel, this.ui.getChildIndex(this.mute));
        }
        this.rankingPanel.visible = true;
        this.rankingPanel.refresh();
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
        if (this.rankingPanel) this.rankingPanel.visible = false;
        this.refreshCards();
        if (tab === 'ranking') this.showRanking();
        // A mode: the whole screen changes to it (what's behind, the ribbon, what PLAY does).
        if (isMode(tab) && tab !== this.mode) {
            this.mode = tab;
            lastMode = tab;
            this.buildMode();
            this.frameCamera();
            gsap.fromTo(this.ribbon.scale, { x: 0.6, y: 0.6 }, { x: 1, y: 1, duration: 0.35, ease: 'back.out(2.5)' });
        }
        if (!isMode(tab) && tab !== 'ranking') {
            let panel = this.panels.get(tab as PanelKind);
            if (!panel) {
                panel = new HomePanel(tab as PanelKind, (kind) => this.buy(kind), (index) => this.playLevel(index), (kind) => this.openCard(kind));
                this.panels.set(tab as PanelKind, panel);
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
        // (From the arena: the story's level, so back to the story's screen first.)
        if (this.mode !== 'story') {
            this.mode = 'story';
            lastMode = 'story';
            this.buildMode();
        }
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

    private refreshCoins(): void {
        this.coinsText.text = String(MobSave.coins);
        this.gemsText.text = String(MobSave.gems);
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
            const mode = isMode(tab);
            entry.holder.position.set(left + third * (i + 0.5), barTop + TABS.height / 2);
            // All of its share of the bar is the tab, not just its icon.
            entry.holder.hitArea = new PIXI.Rectangle(-third / 2, -TABS.height / 2 - MODE_TABS.rise, third, TABS.height + MODE_TABS.rise);
            // A mode tab: always its name, up on its plate; the mode not shown sits a little lower (not faded).
            const down = mode && tab !== this.mode ? MODE_TABS.drop : 0;
            entry.holder.y += down;
            entry.words.visible = mode ? tab === this.mode : focused;
            entry.icon.y = focused || mode ? TABS.focusIconY : 0;
            entry.icon.scale.set((mode ? (tab === this.mode ? MODE_TABS.focusIcon : MODE_TABS.icon) : focused ? TABS.focusIcon : TABS.icon) / 100);
            if (mode) {
                const plate = this.modePlates.get(tab)!;
                plate.position.set(left + third * i + 4, barTop - MODE_TABS.rise + down);
                plate.width = third - 8;
                const light = this.modeLights.get(tab)!;
                light.position.set(left + third * i + 4 + MODE_TABS.inset, barTop - MODE_TABS.rise + down + MODE_TABS.inset);
                light.width = third - 8 - MODE_TABS.inset * 2;
            }
        });
        // The blue focus is the side tabs' (a mode tab shows its own plate).
        const sideOn = !isMode(this.tab);
        this.tabFocus.visible = this.tabLight.visible = sideOn;
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
        const { top, bottom } = this.mode === 'arena' && this.arenaHome.visible ? ARENA_VIEW : VIEW;
        const band = window.innerHeight * (top + bottom) / 2;
        const fits = (): boolean => corners.every((corner) => {
            const at = this.worldToScreen(corner);
            return !!at && at.x >= window.innerWidth * VIEW.side && at.x <= window.innerWidth * (1 - VIEW.side)
                && at.y >= window.innerHeight * top && at.y <= window.innerHeight * bottom;
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
        // In the arena, PLAY ONLINE and PRACTICE side by side; the chest slots over them; the strip and road under the ribbon.
        const arenaOn = this.mode === 'arena' && this.practice.visible;
        this.play.position.set(screen.center.x - (arenaOn ? PRACTICE.shift : 0), top + screen.height - TABS.height - PLAY.up);
        this.practice.position.set(this.play.x + PLAY.width / 2 + PRACTICE.gap + PRACTICE.width / 2, this.play.y);
        const fit = Math.min(1, (screen.width - 24) / STRIP.width);
        this.arenaHome.top.scale.set(fit);
        this.arenaHome.top.position.set(screen.center.x, top + ARENA_HOME.stripY);
        this.arenaHome.slots.scale.set(Math.min(1, (screen.width - 24) / SLOTS_WIDTH));
        // The arrows either side of the field, level with its middle; the padlock in the middle.
        const fieldY = top + screen.height * (ARENA_VIEW.top + ARENA_VIEW.bottom) / 2;
        this.arenaPrev.position.set(screen.topLeft.x + ARENA_ARROWS.inset, fieldY);
        this.arenaNext.position.set(screen.topLeft.x + screen.width - ARENA_ARROWS.inset, fieldY);
        this.arenaLock.position.set(screen.center.x, fieldY);
        this.arenaHome.slots.position.set(screen.center.x, this.play.y - PLAY.height / 2 - ARENA_HOME.slotsOver - (SLOTS.height / 2) * this.arenaHome.slots.scale.y);
        this.overlay?.layout();
        this.matchmaking?.layout();
        this.placeTabs();
        this.coinsBar.position.set(screen.topLeft.x + 30 + COIN_BAR.icon / 2, top + MUTE.y);
        this.gemsBar.position.set(this.coinsBar.x + COIN_BAR.width + COIN_BAR.icon / 2 + 22, top + MUTE.y);
        this.rankingPanel?.reposition();
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
        if (this.rankingPanel?.visible) this.rankingPanel.update(step);
        this.matchmaking?.update(step);
        // The tutorial: its spotlight while nothing else is up (a window, the matchmaking), out of the way when it is.
        if (this.tutorialStep && !this.overlay && !this.matchmaking) {
            if (!this.spotlight) this.showTutorialStep();
            this.spotlight?.update(step);
        } else if (this.spotlight) this.closeSpotlight();
        if (this.arenaHome.visible) this.arenaHome.update(step);
        this.overlay?.update(step);
        super.update(step);
    }

    public destroy(): void {
        gsap.killTweensOf([this.play.scale, this.ribbon.scale, this.coinsBar.scale, this.arenaRibbon]);
        if (this.arena) gsap.killTweensOf(this.arena.group.scale);
        if (this.shine) gsap.killTweensOf(this.shine);
        if (this.glow) gsap.killTweensOf(this.glow);
        this.tabs.forEach(({ icon }) => gsap.killTweensOf([icon, icon.scale]));
        this.rankingPanel?.destroy();
        this.rankingPanel = null;
        this.closeMatchmaking();
        this.closeSpotlight();
        this.overlay?.close();
        this.ui.destroy({ children: true });
        this.arena?.dispose();
        this.map?.dispose();
        super.destroy();
    }
}
