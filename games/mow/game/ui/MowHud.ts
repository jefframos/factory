// MowHud.ts
//
// The on-screen UI, from the UI kit (ui/uikit.json): money and bag pills top-right (the bag's fill bar turns red and
// gets a bobbing "FULL!" tag when full), mute and the language flag top-left, the current district's restoration
// (name, % and a bar) top-centre, short messages in the middle, the move hint for a brand-new player, and the SHOP
// panel — open while the player stands on an ATM's pad, laid out like dig's: a GEAR tab (every mower on a timeline
// up to the goal, the next mower's offer, the bag's capacity with its levels, and the goal along the bottom) and a
// BOOSTS tab once the first mower is bought (speed, money gain, cutting width, sharp blades); the guide's hand sits
// on the button it's pointing at. Both modes (GameMode): a pop by the bar at each quarter of a section (milestone())
// and a big banner when one is restored (celebrate(): ribbon, stars, the bonus counting up). Rush mode: the
// combo meter under the bar (setCombo()). The town under the trophy: a small icon of its miniature (TownMiniature,
// baked from the 3D world), whole, with the town's % and a star under it — when a section is restored, after its
// banner, it flies to the middle, big, under a dark veil that drains to the new % (the town's name on a ribbon over
// it), with a flash and confetti (TownMiniature.celebrate()); a tap on it blows it up the same way, the veil draining
// from empty to the town's % (TownMiniature.preview()), up until its close button, another tap or the player moving.
// Not baked yet: the drawn map (TownMap) stands in there, flown to the centre instead (flyMap()). The MAP button
// (bottom-left) opens the drawn map big: every section's fill, the one being worked on, the player.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import SoundToggleButton from 'core/ui/SoundToggleButton';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { GOAL_TIMELINE_HALF_WIDTH, GoalTimeline } from './GoalTimeline';
import { BakedShape } from './BakedShape';
import { MoveHint } from './MoveHint';
import { LanguagePanel, LANGUAGE_SIZE } from './LanguagePanel';
import { WardrobePanel, WARDROBE_SIZE } from './WardrobePanel';
import { TractorPanel, TRACTOR_PANEL_SIZE } from './TractorPanel';
import { TractorButton } from './TractorButton';
import { iconSticker } from './Sticker';
import { TrophiesPanel, TROPHIES_SIZE } from './TrophiesPanel';
import { TownMap } from './TownMap';
import { FindToasts, Find, flyCoins, flyItem } from './FindToasts';
import { TownMiniature, REVEAL_SEC } from './TownMiniature';
import { CitiesPanel, CitiesMode, CITIES_PANEL_SIZE } from './CitiesPanel';
import { MowProgress } from '../data/MowProgress';
import { CityDef, MOW, TOWN, ToolDef, UpgradeDef, UpgradeId, CITY, farmTest, goalCount, goalSection, shortMoney, shortNumber } from '../data/MowConfig';
import { ModelIcons } from './ModelIcons';
import { tabbedBlock, TabSpec } from './TabBar';
import { HudBar, hexBadge } from './HudBar';
import { t, names, Localization } from '../i18n/Localization';
import { LOCALE_FLAG_CODE } from '../i18n/config';
import { MowAudio } from '../audio/MowAudio';
import { GameAnalytics } from '../analytics/GameAnalytics';
import { Gameplay } from '../data/Gameplay';

const PILL_WIDTH = 210;
const PILL_HEIGHT = 46;
const ICON_SIZE = 58;
/** The bag's pill: its height, where its words and bar run (from, to), the line of each, and its colours (full: the bar's red). */
const BAG = { y: 64, height: 64, from: ICON_SIZE + 8, to: 224, textY: -13, barY: 15, barHeight: 20, fill: 0x2fd92a, full: 0xff4a3d };
/** The money / bag column's width: it hangs from the top-right corner. */
const CORNER_WIDTH = ICON_SIZE / 2 + PILL_WIDTH - 8;
/** The money / bag / trophy corner's size on a portrait screen. */
const CORNER_PORTRAIT_SCALE = 0.82;
const BUTTON_SIZE = 64;
/** The language button (off for now: the game's only in English; the browser's language still picks at boot). */
const SHOW_LANGUAGE_BUTTON = false;
/** The area's bar, under the level's (LevelBadge) and thinner (it matters less); alone (no level) it's at the top. */
const PROGRESS = { width: 264, height: 20, fill: 0x2fd92a, y: 120 };
/** The area bar's reward badge over its end: its size. */
const REWARD = { size: 32 };
/** (The farm test's POWER-UPS list takes the same panel, taller to fit its seven rows: POWER_ROW.) */
const SHOP = farmTest() ? { width: 840, height: 800 } : { width: 840, height: 580 };
/** Shop rows: frame left, text, buy button right. */
const ROW = { width: 776, frameX: -336, textX: -280, textWidth: 470, buttonX: 300, buttonWidth: 150 };
/** The tabs' content block (y = its top edge), and the GEAR tab's rows. */
const BLOCK = { top: -170, width: 800, height: 432, tabWidth: 170, tabHeight: 48 };
const GEAR_Y = { timeline: -110, tool: 28, bag: 146 };
const BOOST_ROW = { firstY: -116, step: 90, height: 82 };
/** The farm test's POWER-UPS panel (the shop's frame, no tabs): its rows, the button opening it. */
const POWER_ROW = { firstY: -SHOP.height / 2 + 112, step: 92, height: 86 };
/** What the POWER-UPS panel offers, in order (the blades are a station on the farm, so not here). */
const POWER_UPS: readonly UpgradeId[] = ['speed', 'money', 'grass', 'bag', 'width', 'chew', 'farm'];
const POWER_BUTTON_SIZE = 84;
/** The tractor's button comes this long after the wardrobe's (seconds). */
const TRACTOR_BUTTON_DELAY = 1.5;
/** Level bars past this many levels draw as one bar toward the next milestone. */
const LONG_TRACK = 30;
/** "· x2 at 25" after a milestone track's effect, or nothing. */
const nextMilestone = (boost: UpgradeDef, level: number): string => {
    const next = boost.milestones?.find((m) => m > level);
    return next ? `  ·  x2 at ${next}` : '';
};
/** POWER-UPS comes with this player level (the one after the chicken den's: its money's coming in). */
const POWER_UPS_LEVEL = 7;
const FOOTER_Y = 238;
/** The mower timeline: node sizes (the goal bigger), its width, line colours. */
const TIMELINE = { node: 60, goal: 78, width: 680 };
const LINE_DONE = 0x5fd35a;
const LINE_TODO = 0x4a5263;
const NEXT_GOLD = 0xffd86b;
const BAG_BAR = { width: 420, height: 9 };
/** Each mower's frame on the timeline, by its place on the path (the goal legendary). */
const TOOL_FRAMES = ['toolCommon', 'toolCommon', 'toolRare', 'toolRare', 'toolRare', 'toolEpic', 'toolEpic', 'toolLegendary'];
const toolFrame = (index: number, owned: boolean): string => (owned ? TOOL_FRAMES[Math.min(index, TOOL_FRAMES.length - 1)] : 'toolLocked');

/** A mower's art, rendered from its 3D model (ModelIcons.toolSprite). */
function mowerArt(tool: ToolDef, size: number): PIXI.Container {
    return ModelIcons.toolSprite(tool, size);
}
/** A restored section's banner: held up, then going; the town's fill follows it. */
const BANNER = { hold: 1.8, out: 0.3 };
/** Messages that came while the banner was up: one after another once it's gone, this far apart (seconds). */
const HELD_SAY_SEC = 1.6;
const BANNER_SEC = BANNER.hold + BANNER.out;
/** The drawn map's flight (no miniatures baked): out, the fill starting once it's there, back home. */
const MAP_FLIGHT = { out: 0.35, back: 1.35, home: 0.35 };
/**
 * A restored section's celebration (celebrate(): the banner, then the town's miniature filling up in the middle and
 * flying home), in seconds; the scene shows the next area after it.
 */
/** Section restored: stars from the banner to the town icon — how many, seconds apart, and each flight. */
const STAR_COUNT = 3;
const STAR_STAGGER = 0.15;
const STAR_FLIGHT = 0.75;
export const CELEBRATION_SEC = BANNER.hold + Math.max(STAR_STAGGER * (STAR_COUNT - 1) + 0.25 + STAR_FLIGHT, MAP_FLIGHT.back + MAP_FLIGHT.home);
/** The trophy button's size (under the money / bag pills). */
const TROPHY_SIZE = 76;
/**
 * The town icon's width (bottom-right), its width in the reveal (at most; less on a narrow screen),
 * and the MAP button's size.
 */
const MINIATURE_WIDTH = 104;
const REVEAL_WIDTH = 560;
/** The miniature grown in its corner takes at most this share of the screen's width and height. */
const REVEAL_SHARE = 0.5;
const MAP_BUTTON_SIZE = 84;
/** The MAP button's map: drawn this wide (at its size, so it stays crisp; only ever scaled down to fit). */
const PANEL_MAP_WIDTH = 600;
/** The wardrobe: on a tall screen its top (a share of the height), the player shown over it; on a wide one beside the player. */
const WARDROBE_VIEW = { top: 0.35, playerAt: 0.25, wideFrom: 1.2, gap: 60, playerLeft: 0.14 };
const RIBBON_OVERHANG = 44;
const PANEL_TOP_GAP = 40;
const CLOSE_SIZE = 56;

/** A kit image fitted to `size` (keeps aspect). */
function icon(screen: string, id: string, size: number): PIXI.Container {
    const sprite = UiKit.sprite(screen, id);
    sprite.scale.set(size / Math.max(sprite.width, sprite.height));
    return sprite;
}

/** What the guide wants bought (the hand goes on its button). */
export type ShopHint = 'tool' | 'capacity' | null;

export class MowHud extends PIXI.Container {
    private readonly corner = new PIXI.Container();
    /** The money pill's icon: claimed coins fly into it. */
    private moneyIcon?: PIXI.Container;
    /** The finds' toasts (treasures, secret chests), top-left under the buttons. */
    private readonly findToasts = new FindToasts();
    /** Treasures still flying into the Trophies button (its "!" and hand wait for them to land). */
    private treasuresFlying = 0;
    /** The hand on the Trophies button: a treasure waits there and none was ever claimed (the first one's lesson). */
    private trophiesHand?: PIXI.Container;
    private readonly moneyText = UiKit.text('hud', 'money', { money: 0 });
    private readonly bagText = UiKit.text('hud', 'backpack', { count: 0, capacity: 0 });
    /** The bag's worth in money (the farm test), under its count. */
    private readonly bagBar = new HudBar(BAG.to - BAG.from, BAG.barHeight, BAG.fill);
    private readonly bagValueIcon = PIXI.Sprite.from(UiKit.imageName('hud', 'moneyIcon'));
    private readonly bagValueText = new PIXI.Text('', new PIXI.TextStyle({ fontFamily: UiKit.fontFamily('primary'), fontSize: 23, fill: 0xffe27a, stroke: 0x1d140e, strokeThickness: 5, lineJoin: 'round' }));
    private readonly fullTag = new PIXI.Container();
    private bagRow!: PIXI.Container;
    private bagFull = false;
    private readonly toast = UiKit.text('hud', 'toast', { text: '' });
    private readonly progress = new PIXI.Container();
    /** The city's goal counted down (GoalTimeline), while it's not restored. */
    private goal?: GoalTimeline;
    private readonly progressText = UiKit.text('hud', 'toast', { text: '' }, { fontSize: 13, strokeThickness: 3, letterSpacing: 0.5 });
    private readonly progressBar = new HudBar(PROGRESS.width, PROGRESS.height, PROGRESS.fill);
    /** The section-complete banner (celebrate()) and rush mode's combo meter (setCombo()). */
    private readonly celebration = new PIXI.Container();
    private readonly combo = new PIXI.Container();
    /** The town's miniature (top-right, under the trophy). */
    private readonly miniature = new TownMiniature(MINIATURE_WIDTH, () => Localization.getString('town_name', undefined, TOWN.name).toUpperCase());
    private miniatureReady = false;
    /** The drawn map standing in for the miniature (none baked) and its holder, which flies; where the holder lives. */
    private readonly townMap = new TownMap();
    private readonly mapHolder = new PIXI.Container();
    private readonly mapHome = new PIXI.Point();
    private mapFlying = false;
    /** The MAP button (bottom-left) and the map it opens: the drawn map, big, over a dim. */
    private readonly mapButton = new PIXI.Container();
    private readonly mapPanel = new PIXI.Container();
    private readonly mapDim = new PIXI.Graphics();
    private readonly panelMap = new TownMap({ panel: true, width: PANEL_MAP_WIDTH });
    private readonly panelMapHolder = new PIXI.Container();
    private mapClose?: PIXI.Container;
    /** The miniature's blown-up view's close button (made on its first opening). */
    private miniatureClose?: PIXI.Container;
    private readonly comboText = UiKit.text('hud', 'toast', { text: '' }, { fontSize: 44, strokeThickness: 8, fill: 0xffe27a });
    private readonly comboPot = UiKit.text('hud', 'toast', { text: '' }, { fontSize: 24, strokeThickness: 5, fill: 0x9cff9c });
    private readonly comboBar = new PIXI.Graphics();
    private comboShown = 1;
    private readonly mute = new PIXI.Container();
    private readonly languageButton = new PIXI.Container();
    private readonly language = new LanguagePanel();
    private readonly languageHolder = new PIXI.Container();
    private readonly shop = new PIXI.Container();
    private readonly shopBody = new PIXI.Container();
    private readonly shopHolder = new PIXI.Container();
    private shopOpen = false;
    /** The shop held open by the scene (the first purchases after the yard): no closing it, the pad doesn't matter. */
    private shopForced = false;
    private shopClose?: PIXI.Container;
    /** The wardrobe (on a wardrobe's pad), sized and placed like the shop. */
    private readonly wardrobe: WardrobePanel;
    private readonly wardrobeHolder = new PIXI.Container();
    private wardrobeOpen = false;
    /** The tractor's panel (its paints and parts), in the wardrobe's place; its button once there's a tractor. */
    private readonly tractorPanel: TractorPanel;
    private tractorOpen = false;
    private tractorReady = false;
    private readonly tractorButton: TractorButton;
    /** The Trophies button (under the pills: the treasures found, by area), its "!", and its panel. */
    private readonly trophiesButton = new PIXI.Container();
    private readonly trophiesAlert = new PIXI.Container();
    private readonly trophies: TrophiesPanel;
    private readonly trophiesHolder = new PIXI.Container();
    /** The end of the town (every section restored): its panel over a dim. */
    /** The cities (select / the tutorial's end): their blue panel over a dim. */
    private readonly cities = new CitiesPanel((city) => this.onTravel?.(city), () => this.closeCities());
    private citiesMode: CitiesMode = 'select';
    /** A city's PLAY in the cities panel (the scene travels there). */
    public onTravel?: (city: CityDef) => void;
    private readonly citiesHolder = new PIXI.Container();
    private readonly citiesDim = new PIXI.Graphics();
    /** The next city's unlocked: a pulsing button over the town icon (opens the cities), rays behind the icon. */
    private readonly newCity = new PIXI.Container();
    private newCityRays?: { rays: PIXI.Container; tweens: gsap.core.Animation[] };
    /** The wardrobe's close button (hidden while the tutorial's first hat is forced). */
    private readonly wardrobeClose: PIXI.Container;
    private shopKey = '';
    private hint: ShopHint = null;
    private tab: 'gear' | 'boosts' = 'gear';
    /** The farm test's POWER-UPS: the shop's panel opened from its HUD button, listing the money boosts. */
    private powerOpen = false;
    private readonly powerButton = new PIXI.Container();
    private readonly powerAlert = new PIXI.Container();
    /** The farm test's wardrobe button (beside POWER-UPS): the wardrobe at any time, a "!" while something new's affordable. */
    private readonly wardrobeButton = new PIXI.Container();
    private readonly wardrobeAlert = new PIXI.Container();
    private shopTitle?: PIXI.Text;
    public readonly moveHint = new MoveHint();
    /** Money from a sale still landing: shown as not yet earned until releaseSale(). */
    private heldMoney = 0;
    private lastMoney = -1;
    private district = 0;
    private readonly onChange = () => this.refresh();

    /**
     * `onBuy` after any purchase (the scene reacts: swaps the tool, plays effects); `onWear` after a look changes
     * (re-dress the player); `isOpen(area)` whether a section is open (the Trophies panel marks the rest locked).
     */
    public constructor(private readonly onBuy: () => void, onWear: () => void, isOpen: (area: number) => boolean) {
        super();
        this.buildCorner();
        this.buildProgress();
        this.buildGoal();
        this.buildCombo();
        this.buildButtons();
        this.buildShop();
        this.wardrobe = new WardrobePanel(onWear, (text, color) => this.say(text, color));
        this.wardrobeClose = this.addClose(this.wardrobe, WARDROBE_SIZE, () => this.setWardrobeOpen(false));
        this.tractorPanel = new TractorPanel((text, color) => this.say(text, color));
        this.addClose(this.tractorPanel, TRACTOR_PANEL_SIZE, () => this.setTractorOpen(false));
        // (Their tops level: it's shorter.)
        this.tractorPanel.y = (TRACTOR_PANEL_SIZE.height - WARDROBE_SIZE.height) / 2;
        this.wardrobeHolder.addChild(this.wardrobe, this.tractorPanel);
        this.tractorButton = new TractorButton(POWER_BUTTON_SIZE, () => {
            if (!this.tractorOpen) this.setPowerOpen(false);
            this.setTractorOpen(!this.tractorOpen);
        });
        this.addChild(this.tractorButton);
        this.trophies = new TrophiesPanel((keys, from) => this.claimTrophies(keys, from), isOpen);
        this.addClose(this.trophies, TROPHIES_SIZE, () => this.toggleTrophies());
        this.trophiesHolder.addChild(this.trophies);
        this.buildTrophiesButton();
        this.buildPowerButton();
        this.buildWardrobeButton();
        this.languageHolder.addChild(this.language);
        this.addClose(this.language, LANGUAGE_SIZE, () => this.toggleLanguage());
        this.toast.alpha = 0;
        this.mapHolder.addChild(this.townMap);
        this.buildMap();
        this.addChild(this.corner, this.progress, this.combo, this.celebration, this.mapHolder, this.miniature, this.mapButton, this.mute, this.languageButton, this.moveHint, this.toast, this.shopHolder, this.wardrobeHolder, this.trophiesHolder, this.languageHolder, this.mapPanel, this.findToasts, this.newCity, this.citiesDim, this.citiesHolder);
        this.citiesHolder.addChild(this.cities);
        this.citiesDim.visible = false;
        this.citiesDim.eventMode = 'static';
        this.citiesDim.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        // A tap on the dim closes the selector (not the tutorial's end: that one only goes on).
        this.citiesDim.on('pointertap', () => {
            if (this.citiesMode === 'select') this.closeCities();
        });
        this.buildNewCity();
        MowProgress.onChange.add(this.onChange);
        this.refresh();
        this.reposition();
    }

    // ---------------------------------------------------------------- corner (money, bag)

    private pill(iconId: string, label: PIXI.Text, y: number, height = PILL_HEIGHT): PIXI.Container {
        const row = new PIXI.Container();
        row.y = y;
        const back = UiKit.image('hud', 'pill', PILL_WIDTH, height);
        back.position.set(ICON_SIZE / 2 + PILL_WIDTH / 2 - 8, 0);
        back.alpha = 0.85;
        const symbol = icon('hud', iconId, ICON_SIZE);
        symbol.position.set(ICON_SIZE / 2, 0);
        label.anchor.set(0, 0.5);
        label.position.set(ICON_SIZE + 8, -2);
        row.addChild(back, symbol, label);
        return row;
    }

    private buildCorner(): void {
        const money = this.pill('moneyIcon', this.moneyText, 0);
        this.moneyIcon = money.getChildAt(1) as PIXI.Container;
        this.corner.addChild(money);
        // The bag: its count (and, the farm test, what it's worth at the other end) over its bar.
        const bag = this.pill('backpackIcon', this.bagText, BAG.y, BAG.height);
        this.bagRow = bag;
        this.bagText.y = BAG.textY;
        this.bagBar.position.set(BAG.from, BAG.barY);
        bag.addChild(this.bagBar);
        if (farmTest()) {
            this.bagValueText.anchor.set(1, 0.5);
            this.bagValueText.position.set(BAG.to, BAG.textY);
            this.bagValueIcon.anchor.set(1, 0.5);
            this.bagValueIcon.scale.set(26 / Math.max(this.bagValueIcon.texture.width, this.bagValueIcon.texture.height, 1));
            this.bagValueIcon.y = BAG.textY;
            bag.addChild(this.bagValueText, this.bagValueIcon);
        }
        // Full: said on its bar.
        const fullLabel = UiKit.fit(UiKit.text('hud', 'toast', { text: t('bagFullTag') }, { fontSize: 18, strokeThickness: 5 }), BAG.to - BAG.from - 10);
        this.fullTag.addChild(fullLabel);
        this.fullTag.position.set((BAG.from + BAG.to) / 2, BAG.barY - 1);
        this.fullTag.visible = false;
        bag.addChild(this.fullTag);
        this.corner.addChild(bag);
    }

    // ---------------------------------------------------------------- district progress

    private buildProgress(): void {
        this.progressBar.x = -PROGRESS.width / 2;
        this.progressText.y = -1;
        // What finishing it pays, over the bar's end: a gold badge (green, a check, once restored).
        this.progressReward.position.set(PROGRESS.width / 2 - 4, 0);
        this.progress.addChild(this.progressBar, this.progressText, this.progressReward);
    }

    private buildGoal(): void {
        const goal = goalSection();
        if (!goal?.opensAfter || MowProgress.isRestored(goal.id)) return;
        this.goal = new GoalTimeline(goal.opensAfter, goal.goalModel && `./mow/models/${goal.goalModel}`, goalCount((id) => MowProgress.isRestored(id)));
        this.addChild(this.goal);
    }

    /** An area's restored: the goal's next lock comes off. */
    public goalStep(): void {
        this.goal?.setCount(goalCount((id) => MowProgress.isRestored(id)));
    }

    /** The goal's restored: its timeline's job is done. */
    public goalDone(): void {
        this.goal?.destroy({ children: true });
        this.goal = undefined;
    }

    /** The bar's reward: the district's bonus, or a check once it's restored. Rebuilt when either changes. */
    private drawReward(bonus: number, done: boolean): void {
        const key = `${bonus}:${done}`;
        if (key === this.rewardKey) return;
        const popped = this.rewardKey !== '' && done;
        this.rewardKey = key;
        this.progressReward.removeChildren().forEach((child) => child.destroy({ children: true }));
        const disc = done ? hexBadge(REWARD.size, 0x2c9a3c, 0x4fd05a) : hexBadge(REWARD.size, 0xe8951c, 0xffd34d);
        const icon = done ? UiKit.sprite('hud', 'check') : PIXI.Sprite.from(UiKit.imageName('hud', 'moneyIcon'));
        if (icon instanceof PIXI.Sprite) icon.anchor.set(0.5);
        icon.y = -1;
        icon.scale.set((REWARD.size * 0.56) / Math.max(icon.width / icon.scale.x, icon.height / icon.scale.y, 1));
        this.progressReward.addChild(disc, icon);
        if (popped) UiAnim.punch(this.progressReward, 0.5);
    }

    private readonly progressReward = new PIXI.Container();
    private rewardKey = '';

    /** The district shown at the top: its name, restored share and bar. */
    public setDistrict(index: number, share: number): void {
        this.district = index;
        const district = MOW.districts[index];
        const percent = Math.floor(share * 100);
        const words = t('districtProgress', { name: names.district(district).toUpperCase(), percent });
        if (words !== this.progressText.text) {
            this.progressText.text = words;
            UiKit.fit(this.progressText, PROGRESS.width - this.covered - REWARD.size / 2 - 16);
        }
        this.drawReward(district.bonus, MowProgress.isRestored(district.id));
        this.progressBar.setShare(share);
    }

    /** A quarter of a section done: the percentage pops out of the bar, which jumps. */
    public milestone(percent: number): void {
        UiAnim.punch(this.progress, 0.2);
        // In its own pill under the bar's middle (clear of the name over the bar and the reward at its end).
        const pop = new PIXI.Container();
        const label = UiKit.text('hud', 'toast', { text: `${percent}%` }, { fontSize: 30, strokeThickness: 6, fill: 0x9cff9c });
        label.anchor.set(0.5);
        const width = label.width + 36;
        const height = 44;
        pop.addChild(new BakedShape(Math.ceil(width), height, height / 2, { fill: 0x1d2633, fillAlpha: 0.9, rim: 0xffffff, rimWidth: 3, rimAlpha: 0.9 }), label);
        pop.position.set(0, PROGRESS.height / 2 + 8 + height / 2);
        pop.scale.set(0.3);
        this.progress.addChild(pop);
        UiAnim.sparkBurst(this.progress, pop.x, pop.y, 0x9cff9c, 60);
        gsap.to(pop.scale, { x: 1, y: 1, duration: 0.35, ease: 'back.out(3)' });
        gsap.to(pop, { y: pop.y - 26, alpha: 0, duration: 0.5, delay: 1, onComplete: () => {
            if (!pop.destroyed) pop.destroy();
        } });
    }

    // ---------------------------------------------------------------- town map

    /**
     * The corner: the town's miniature once it loads (the drawn map until then, and for good if it isn't baked); the
     * MAP button and its panel.
     */
    private buildMap(): void {
        this.tappable(this.miniature, () => this.openCities('select'));
        void this.miniature.ready.then((ready) => {
            if (!ready || this.destroyed) return;
            this.miniatureReady = true;
            this.mapHolder.visible = false;
            this.reposition();
        });

        // A sticker (the map icon on a white outline, nothing behind it), bottom left.
        this.mapButton.addChild(iconSticker('ItemIcon_Map', MAP_BUTTON_SIZE * 0.82));
        this.mapButton.hitArea = new PIXI.Rectangle(-MAP_BUTTON_SIZE / 2, -MAP_BUTTON_SIZE / 2, MAP_BUTTON_SIZE, MAP_BUTTON_SIZE);
        this.tappable(this.mapButton, () => this.toggleMap());

        // The panel: a dim (a tap on it closes), the drawn map big in the middle, its close button.
        this.mapDim.eventMode = 'static';
        this.mapDim.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.mapDim.on('pointertap', () => this.toggleMap());
        this.panelMapHolder.addChild(this.panelMap);
        this.panelMapHolder.eventMode = 'static';
        this.panelMapHolder.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.mapClose = this.addClose(this.panelMapHolder, { width: this.panelMap.panelWidth, height: this.panelMap.panelHeight }, () => this.toggleMap());
        this.mapPanel.addChild(this.mapDim, this.panelMapHolder);
        this.mapPanel.visible = false;
    }

    private toggleMap(): void {
        MowAudio.play('toggle');
        this.mapPanel.visible = !this.mapPanel.visible;
        if (!this.mapPanel.visible) return;
        GameAnalytics.panelOpened('map');
        // One map at a time: the miniature's blown-up view goes home.
        if (this.miniature.open) this.miniature.close();
        Gameplay.stop();
        UiAnim.popIn(this.panelMapHolder, this.mapDim);
    }

    /** Every section's share (1 once restored), open / restored flags, and the one being worked on (-1: none). */
    public setTownMap(shares: readonly number[], open: readonly boolean[], restored: readonly boolean[], current: number): void {
        this.townMap.setState(shares, open, restored, current);
        this.panelMap.setState(shares, open, restored, current);
        // The town's %: every section weighs the same (the blown-up fill); its pips in the corner: one per section.
        this.miniature.setShare(shares.reduce((sum, share) => sum + share, 0) / Math.max(1, shares.length));
        this.miniature.setSections(restored, current);
    }

    /** The player's dot on the town map (world x / z). */
    /** Which ATMs and wardrobes are out, for the maps' markers. */
    public setMapStations(atms: readonly boolean[], wardrobes: readonly boolean[]): void {
        this.townMap.setStations(atms, wardrobes);
        this.panelMap.setStations(atms, wardrobes);
    }

    public setMapPlayer(x: number, z: number): void {
        this.townMap.setPlayer(x, z);
        this.panelMap.setPlayer(x, z);
    }

    /** A section restored: the map flies to the centre (with rays), fills it, pops the next lock, and flies home. */
    private flyMap(section: number): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        const holder = this.mapHolder;
        UiAnim.kill(holder);
        this.mapFlying = true;
        const big = Math.min(2.4, (screen.height * 0.55) / this.townMap.panelHeight, (screen.width * 0.8) / this.townMap.panelWidth);
        const shine = UiAnim.rays(holder, this.townMap.panelWidth * 0.85, 0xfff0a0, 0.55, 8);
        shine.rays.alpha = 0;
        const done = () => {
            this.mapFlying = false;
            shine.tweens.forEach((tween) => tween.kill());
            if (!shine.rays.destroyed) shine.rays.destroy({ children: true });
            holder.position.copyFrom(this.mapHome);
            holder.scale.set(1);
        };
        gsap.timeline({ onComplete: done })
            .to(holder, { x: screen.center.x, y: screen.center.y - screen.height * 0.04, duration: MAP_FLIGHT.out, ease: 'power2.out' }, 0)
            .to(holder.scale, { x: big, y: big, duration: MAP_FLIGHT.out, ease: 'back.out(1.6)' }, 0)
            .to(shine.rays, { alpha: 1, duration: 0.25 }, MAP_FLIGHT.out * 0.5)
            .to(shine.rays, { alpha: 0, duration: 0.2 }, MAP_FLIGHT.back)
            .to(holder, { x: this.mapHome.x, y: this.mapHome.y, duration: MAP_FLIGHT.home, ease: 'power2.in' }, MAP_FLIGHT.back)
            .to(holder.scale, { x: 1, y: 1, duration: MAP_FLIGHT.home, ease: 'power2.in' }, MAP_FLIGHT.back);
        this.townMap.celebrate(section, MAP_FLIGHT.out);
    }

    /**
     * A section restored: first the banner (its name on a ribbon, three stars, its bonus counting up, a little confetti),
     * then, as it goes, the town filling up (TownMiniature.celebrate(), or the drawn map's flight: flyMap()). Takes
     * CELEBRATION_SEC: the scene shows the next area after it.
     */
    public celebrate(name: string, bonus: number, section: number): void {
        // The section's banner first; as it goes, its stars fly down to the town icon and its pip lights up (held
        // dark till they land), or (no miniature baked) the drawn map's flight. Without the town meter: the banner only.
        this.showBanner(name, bonus);
        if (this.townMeterHidden) return;
        if (this.miniatureReady) this.miniature.holdPips();
        gsap.delayedCall(BANNER.hold, () => {
            if (this.destroyed) return;
            if (this.miniatureReady && Game.overlayScreenData) this.flyStars(section);
            else this.flyMap(section);
        });
    }

    /** STAR_COUNT stars from the banner to the town icon's pip for `section`, one after another; it lights as they land. */
    private flyStars(section: number): void {
        const from = this.toLocal(this.celebration.getGlobalPosition());
        let landed = 0;
        for (let i = 0; i < STAR_COUNT; i++) {
            const star = PIXI.Sprite.from('ItemIcon_Star_Gold');
            star.anchor.set(0.5);
            const size = 58 / Math.max(star.texture.width, star.texture.height, 1);
            star.scale.set(0);
            star.position.set(from.x + (i - (STAR_COUNT - 1) / 2) * 70, from.y - 40);
            star.eventMode = 'none';
            this.addChild(star);
            const start = { x: star.x, y: star.y };
            const progress = { t: 0 };
            gsap.timeline({ delay: i * STAR_STAGGER, onComplete: () => {
                star.destroy();
                if (this.destroyed) return;
                MowAudio.play('buyStar');
                UiAnim.punch(this.miniature, 0.2);
                if (++landed === STAR_COUNT) {
                    this.miniature.releasePips();
                    MowAudio.play('sparkle');
                }
            } })
                .to(star.scale, { x: size, y: size, duration: 0.25, ease: 'back.out(3)' })
                .to(progress, {
                    t: 1,
                    duration: STAR_FLIGHT,
                    ease: 'power2.in',
                    onUpdate: () => {
                        const to = this.toLocal(this.miniature.pipGlobal(section));
                        const k = progress.t;
                        const u = 1 - k;
                        // A curve up and over (a raised midpoint), shrinking as it goes, spinning.
                        const midX = (start.x + to.x) / 2;
                        const midY = Math.min(start.y, to.y) - 120;
                        star.position.set(u * u * start.x + 2 * u * k * midX + k * k * to.x, u * u * start.y + 2 * u * k * midY + k * k * to.y);
                        star.scale.set(size * (1 - k * 0.6));
                        star.rotation = k * Math.PI * 2;
                    },
                });
        }
    }

    /** The cities panel: 'select' (the town icon, NEW CITY AVAILABLE), or 'complete' (the tutorial's end: only on). */
    public openCities(mode: CitiesMode): void {
        if (this.cities.visible && this.citiesMode === mode) return;
        if (this.mapPanel.visible) this.toggleMap();
        if (this.trophies.visible) this.toggleTrophies();
        this.citiesMode = mode;
        Gameplay.stop();
        GameAnalytics.panelOpened('cities');
        MowAudio.play(mode === 'complete' ? 'buyFanfare' : 'open');
        this.cities.show(mode);
        this.cities.visible = true;
        this.citiesDim.visible = true;
        this.citiesDim.alpha = 0;
        gsap.to(this.citiesDim, { alpha: 1, duration: 0.25 });
    }

    private closeCities(): void {
        if (!this.cities.visible) return;
        MowAudio.play('close');
        this.cities.visible = false;
        this.citiesDim.visible = false;
    }

    /** The NEW CITY AVAILABLE button over the town icon (shown by setNewCity()). */
    private buildNewCity(): void {
        const label = UiKit.text('hud', 'toast', { text: t('newCityAvailable') }, { fontSize: 18, strokeThickness: 5 });
        label.anchor.set(0.5);
        const width = Math.max(150, label.width + 34);
        const back = new PIXI.NineSlicePlane(PIXI.Texture.from('Button01_l_Green'), 38, 62, 38, 70);
        back.width = width * 2;
        back.height = 52 * 2;
        back.scale.set(0.5);
        back.pivot.set(width, 52);
        label.y = -2;
        this.newCity.addChild(back, label);
        this.newCity.visible = false;
        this.tappable(this.newCity, () => this.openCities('select'));
    }

    /** The next city is open: the button over the town icon pulses, rays turn behind the icon. Off: both go. */
    public setNewCity(on: boolean): void {
        if (on === this.newCity.visible) return;
        this.newCity.visible = on;
        UiAnim.kill(this.newCity);
        this.newCityRays?.tweens.forEach((tween) => tween.kill());
        this.newCityRays?.rays.destroy({ children: true });
        this.newCityRays = undefined;
        if (!on) return;
        UiAnim.popIn(this.newCity);
        gsap.delayedCall(0.5, () => {
            if (this.newCity.visible) UiAnim.pulse(this.newCity, 0.08, 0.5);
        });
        const shine = UiAnim.rays(this, MINIATURE_WIDTH * 0.9, 0xfff0a0, 0.75, 6);
        this.setChildIndex(shine.rays, this.getChildIndex(this.miniature));
        this.newCityRays = shine;
        this.reposition();
    }

    /** No town meter (the corner miniature and its map): the farm test, where the player's level is the progress. */
    private townMeterHidden = false;

    public hideTownMeter(): void {
        this.townMeterHidden = true;
        for (const target of [this.miniature, this.mapHolder]) {
            target.renderable = false;
            target.eventMode = 'none';
        }
    }

    /** The miniature's blown-up view back to its corner, if it's up. */
    public closeMiniature(): void {
        if (!this.miniature.open) return;
        MowAudio.play('toggle');
        this.miniature.close();
    }

    /**
     * Where the miniature is blown up to (its centre): it grows where it is, in its corner — its bottom-right staying
     * put, kept clear of the screen's top and left — rather than flying to the middle over everything. And how much:
     * REVEAL_WIDTH across at most, no more than REVEAL_SHARE of the screen either way.
     */
    private get revealCentre(): PIXI.IPointData {
        const screen = Game.overlayScreenData;
        const home = this.miniatureHome;
        if (!screen) return home;
        const scale = this.revealScale;
        const growX = (MINIATURE_WIDTH * (scale - 1)) / 2;
        const growY = (this.miniature.pictureHeight * (scale - 1)) / 2;
        // Up and left by how much it grows, a little more for the % under it (its own scale grows less).
        return { x: home.x - growX, y: home.y - growY - this.miniature.badgeHeight };
    }

    private get revealScale(): number {
        const screen = Game.overlayScreenData;
        if (!screen) return 1;
        const height = Math.max(1, this.miniature.pictureHeight);
        return Math.max(1, Math.min(REVEAL_WIDTH / MINIATURE_WIDTH, (screen.width * REVEAL_SHARE) / MINIATURE_WIDTH, (screen.height * REVEAL_SHARE) / height));
    }

    /** The banner's end (while it's up), and the messages waiting for it. */
    private bannerOver?: gsap.core.Tween;
    private readonly held: { message: string; color: number }[] = [];

    /** A restored section's banner is up. */
    public get celebrating(): boolean {
        return this.bannerOver !== undefined;
    }

    /** The waiting messages, one after another. */
    private sayHeld(): void {
        if (this.destroyed || this.celebrating) return;
        const next = this.held.shift();
        if (!next) return;
        this.say(next.message, next.color);
        if (this.held.length) gsap.delayedCall(HELD_SAY_SEC, () => this.sayHeld());
    }

    private showBanner(name: string, bonus: number): void {
        UiAnim.kill(this.celebration);
        this.celebration.removeChildren().forEach((child) => child.destroy({ children: true }));
        // Small, and up where the messages go (they wait for it: say()): the player and what just opened stay in sight.
        const banner = new PIXI.Container();
        const ribbon = UiKit.sprite('upgrades', 'ribbon', 0.46);
        const title = UiKit.text('upgrades', 'title', {}, { fontSize: 32 });
        title.anchor.set(0.5);
        title.text = name;
        UiKit.fit(title, 330);
        title.y = -4;
        const reward = UiKit.text('hud', 'toast', { text: '' }, { fontSize: 36, strokeThickness: 7, fill: 0x9cff9c });
        reward.anchor.set(0.5);
        reward.y = 60;
        reward.visible = bonus > 0;
        const stars = [-1, 0, 1].map((side) => {
            const star = PIXI.Sprite.from('ItemIcon_Star_Gold');
            star.anchor.set(0.5);
            star.scale.set((side === 0 ? 62 : 48) / Math.max(star.texture.width, star.texture.height, 1));
            star.position.set(side * 58, side === 0 ? -58 : -50);
            star.rotation = side * 0.2;
            return star;
        });
        banner.addChild(ribbon, title, reward, ...stars);
        this.celebration.addChild(banner);
        this.bannerOver?.kill();
        this.bannerOver = gsap.delayedCall(BANNER_SEC, () => {
            this.bannerOver = undefined;
            this.sayHeld();
        });
        banner.scale.set(0.3);
        banner.alpha = 0;
        gsap.to(banner, { alpha: 1, duration: 0.2 });
        gsap.to(banner.scale, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2)' });
        UiAnim.staggerPop(stars, 0.2, 0.1);
        UiAnim.countUp(reward, 0, bonus, (value) => `+${shortMoney(value)}`, 0.7, 0.3);
        UiAnim.confetti(this.celebration, 0, -30, 22, 1);
        gsap.to(banner, { alpha: 0, duration: BANNER.out, delay: BANNER.hold });
        gsap.to(banner.scale, { x: 0.9, y: 0.9, duration: BANNER.out, delay: BANNER.hold, onComplete: () => {
            if (banner.destroyed) return;
            UiAnim.kill(banner);
            banner.destroy({ children: true });
        } });
    }

    // ---------------------------------------------------------------- combo (rush mode)

    private buildCombo(): void {
        this.comboText.anchor.set(0.5);
        this.comboPot.anchor.set(0.5);
        this.comboPot.y = 38;
        this.comboBar.y = 62;
        this.combo.addChild(this.comboText, this.comboPot, this.comboBar);
        this.combo.visible = false;
    }

    /** The combo meter: hidden at x1; else COMBO xN, the pot so far and how long it has left. */
    public setCombo(multiplier: number, pot: number, timeShare: number): void {
        const show = multiplier > 1;
        if (!show) {
            if (this.combo.visible) gsap.to(this.combo, { alpha: 0, duration: 0.25, onComplete: () => {
                this.combo.visible = false;
            } });
            this.comboShown = 1;
            return;
        }
        if (!this.combo.visible || multiplier !== this.comboShown) {
            gsap.killTweensOf(this.combo);
            this.combo.visible = true;
            this.combo.alpha = 1;
            this.comboText.text = t('combo', { multiplier: multiplier.toString() });
            gsap.killTweensOf(this.comboText.scale);
            this.comboText.scale.set(1);
            UiAnim.punch(this.comboText as unknown as PIXI.Container, 0.35);
            this.comboShown = multiplier;
        }
        this.comboPot.text = `+${shortMoney(pot)}`;
        const width = 200;
        // Gold, going orange then red as it runs out.
        const color = timeShare > 0.5 ? 0xffd86b : timeShare > 0.25 ? 0xff9a3c : 0xff5a4a;
        this.comboBar.clear()
            .beginFill(0x000000, 0.45).drawRoundedRect(-width / 2 - 3, -7, width + 6, 14, 7).endFill()
            .beginFill(color).drawRoundedRect(-width / 2, -4, Math.max(8, width * timeShare), 8, 4).endFill();
    }

    /** The combo ended: its payout jumps out of the meter. */
    public comboPaid(amount: number, multiplier: number): void {
        if (amount <= 0) return;
        const paid = UiKit.text('hud', 'toast', { text: t('comboPaid', { multiplier: multiplier.toString(), amount: amount.toLocaleString('en-US') }) },
            { fontSize: 40, strokeThickness: 8, fill: 0xffe27a });
        paid.anchor.set(0.5);
        paid.position.set(this.combo.x, this.combo.y);
        paid.scale.set(0.4);
        this.addChild(paid);
        UiAnim.sparkBurst(this, paid.x, paid.y, 0xffe27a, 110);
        gsap.to(paid.scale, { x: 1, y: 1, duration: 0.35, ease: 'back.out(3)' });
        gsap.to(paid, { y: paid.y - 50, alpha: 0, duration: 0.6, delay: 1.1, onComplete: () => {
            if (!paid.destroyed) paid.destroy();
        } });
    }

    public get shownDistrict(): number {
        return this.district;
    }

    // ---------------------------------------------------------------- top-left buttons

    private buildButtons(): void {
        const icons = new SoundToggleButton(UiKit.imageName('hud', 'muteOn'), UiKit.imageName('hud', 'muteOff'));
        icons.scale.set((BUTTON_SIZE * 0.55) / 128);
        this.mute.addChild(icon('hud', 'muteButton', BUTTON_SIZE), icons);
        // The icons handle the toggle; a tap on the button around them is passed on to them.
        this.mute.eventMode = 'static';
        this.mute.cursor = 'pointer';
        this.mute.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.mute.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            if (event.target !== icons) icons.emit('pointertap', event);
            UiAnim.punch(this.mute, 0.12);
            MowAudio.play('toggle');
        });
        // The language list: the current language's flag on the round button.
        const flag = PIXI.Sprite.from(`Icon_Flag_${LOCALE_FLAG_CODE[Localization.currentLocale]}`);
        flag.anchor.set(0.5);
        flag.scale.set((BUTTON_SIZE * 0.6) / Math.max(flag.texture.width, flag.texture.height, 1));
        this.languageButton.addChild(icon('hud', 'muteButton', BUTTON_SIZE), flag);
        this.tappable(this.languageButton, () => this.toggleLanguage());
        this.languageButton.visible = SHOW_LANGUAGE_BUTTON;
    }

    private toggleLanguage(): void {
        MowAudio.play('toggle');
        this.language.visible = !this.language.visible;
        if (!this.language.visible) return;
        Gameplay.stop();
        this.language.refresh();
        UiAnim.popIn(this.language);
    }

    // ---------------------------------------------------------------- trophies

    /** The trophy under the money / bag pills: opens the Trophies panel; a bouncing "!" while a reward waits there. */
    private buildTrophiesButton(): void {
        const size = TROPHY_SIZE;
        this.trophiesButton.position.set(CORNER_WIDTH - size / 2, 140);
        const trophy = PIXI.Sprite.from('ItemIcon_Trophy_Gold');
        trophy.anchor.set(0.5);
        trophy.scale.set(size / Math.max(trophy.texture.width, trophy.texture.height, 1));
        this.trophiesButton.addChild(trophy);
        this.trophiesButton.hitArea = new PIXI.Rectangle(-size / 2, -size / 2, size, size);
        const alert = icon('hud', 'alert', 34);
        this.trophiesAlert.addChild(alert);
        this.trophiesAlert.position.set(size / 2 - 8, -size / 2 + 10);
        gsap.to(alert, { y: -8, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        this.trophiesAlert.visible = false;
        this.trophiesButton.addChild(this.trophiesAlert);
        // The hand: tapping at the trophy from under it.
        this.trophiesHand = this.pointingHand(0);
        this.trophiesHand.visible = false;
        this.trophiesButton.addChild(this.trophiesHand);
        this.tappable(this.trophiesButton, () => this.toggleTrophies());
        this.corner.addChild(this.trophiesButton);
        // The farm game has no Trophies panel: a trophy found pays at once.
        this.trophiesButton.visible = !farmTest();
    }

    private toggleTrophies(): void {
        MowAudio.play('toggle');
        this.trophies.visible = !this.trophies.visible;
        this.refresh();
        if (!this.trophies.visible) return;
        GameAnalytics.panelOpened('trophies');
        Gameplay.stop();
        this.trophies.refresh();
        UiAnim.popIn(this.trophies);
    }

    /**
     * A treasure found: its toast, and it flies from the player (`from`, on screen) into the Trophies button, whose "!"
     * (and, before anything was ever claimed, the hand) shows as it lands: its reward waits there.
     */
    public treasureFound(find: Find, from: PIXI.IPointData): void {
        this.findToasts.show(find);
        this.treasuresFlying++;
        this.refresh();
        const target = () => this.toLocal(this.trophiesButton.getGlobalPosition());
        flyItem(this, find.model, this.toLocal(from), target, () => {
            this.treasuresFlying = Math.max(0, this.treasuresFlying - 1);
            if (this.destroyed) return;
            MowAudio.play('item');
            UiAnim.punch(this.trophiesButton, 0.35);
            this.refresh();
        });
    }

    /** A secret chest found: its toast, and it pays at once, `claim()`'s coins flying from the player (`from`, on screen). */
    public secretFound(find: Find, amount: number, claim: () => number, from: PIXI.IPointData): void {
        this.findToasts.show({ ...find, name: `${find.name}  +${shortMoney(amount)}` });
        this.payOut(claim, amount, this.toLocal(from));
    }

    /** CLAIM in the Trophies panel: every waiting reward (`keys`) paid together, the coins flying from the button (`from`). */
    private claimTrophies(keys: readonly string[], from: PIXI.Point): void {
        const total = keys.reduce((sum, key) => sum + MowProgress.unclaimedFor(key), 0);
        this.payOut(() => keys.reduce((sum, key) => {
            const paid = MowProgress.claimTreasure(key);
            if (paid > 0) GameAnalytics.treasureClaimed(key);
            return sum + paid;
        }, 0), total, this.toLocal(from));
    }

    /** Pays `claim()` (expected: `amount`), held off the money counter until its coins land there from `from` (HUD space). */
    private payOut(claim: () => number, amount: number, from: PIXI.IPointData): void {
        this.holdSale(amount);
        const paid = claim();
        if (paid < amount) this.releaseSale(amount - paid);
        if (paid <= 0) return;
        MowAudio.play('buyCash');
        MowAudio.play('coins');
        const target = () => (this.moneyIcon && !this.moneyIcon.destroyed ? this.toLocal(this.moneyIcon.getGlobalPosition()) : new PIXI.Point());
        flyCoins(this, from, target, paid, (share) => {
            if (!this.destroyed) this.releaseSale(share);
        });
    }

    /** Where the Trophies button is on screen (a found treasure flies there). */
    public get trophiesButtonPosition(): PIXI.Point {
        return this.trophiesButton.getGlobalPosition();
    }

    /** Opens the language list (the HUD was just rebuilt for a new language: keep it open). */
    public openLanguage(): void {
        if (!this.language.visible) this.toggleLanguage();
    }

    private tappable(target: PIXI.Container, action: () => void): void {
        target.eventMode = 'static';
        target.cursor = 'pointer';
        // Taps on HUD buttons must not also start the movement joystick underneath.
        target.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        target.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            // Not on the town's picture while it's blown up: the bounce would spring it back to that size as it flies home.
            if (!(target === this.miniature && this.miniature.celebrating)) UiAnim.punch(target, 0.12);
            action();
        });
    }

    /** A panel's red close button on its top-right corner. */
    private addClose(panel: PIXI.Container, size: { width: number; height: number }, onClose: () => void): PIXI.Container {
        const close = this.closeButton(onClose);
        close.position.set(size.width / 2 - 8, -size.height / 2 + 8);
        panel.addChild(close);
        return close;
    }

    /** The red close button, tappable (not placed anywhere yet). */
    private closeButton(onClose: () => void): PIXI.Container {
        const close = new PIXI.Container();
        close.addChild(icon('hud', 'closeButton', CLOSE_SIZE), icon('hud', 'closeIcon', CLOSE_SIZE * 0.5));
        this.tappable(close, onClose);
        return close;
    }

    // ---------------------------------------------------------------- shop

    private buildShop(): void {
        const frame = UiKit.image('upgrades', 'panel', SHOP.width, SHOP.height);
        frame.eventMode = 'static';
        frame.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        const ribbon = UiKit.sprite('upgrades', 'ribbon', 0.55);
        ribbon.y = -SHOP.height / 2;
        const title = UiKit.text('upgrades', 'title');
        title.text = t('titleShop');
        title.y = -SHOP.height / 2 - 5;
        this.shopTitle = title;
        this.shop.addChild(frame, ribbon, title, this.shopBody);
        this.shopClose = this.addClose(this.shop, SHOP, () => (this.powerOpen ? this.setPowerOpen(false) : this.setShopOpen(false)));
        this.shop.visible = false;
        this.shopHolder.addChild(this.shop);
    }

    /** Opens / closes the shop (the scene calls this as the player steps on / off the pad; not while it's forced). */
    public setShopOpen(open: boolean): void {
        if (this.shopForced || this.powerOpen) return;
        this.showShop(open);
    }

    private showShop(open: boolean): void {
        if (open === this.shopOpen) return;
        this.shopOpen = open;
        if (this.shopTitle) this.shopTitle.text = this.powerOpen ? t('titlePowerUps') : t('titleShop');
        this.shop.visible = open;
        if (!open) return;
        this.renderShop();
        UiAnim.popIn(this.shop);
        MowAudio.play('open');
    }

    /**
     * The shop held open wherever the player is (the scene's first purchases after the yard: the hand on what to buy,
     * setShopHint()), on the GEAR tab and without its close button, until released (then it closes).
     */
    public setShopForced(forced: boolean): void {
        if (forced === this.shopForced) return;
        if (forced) {
            this.tab = 'gear';
            this.setShopOpen(true);
            this.shopForced = true;
        } else {
            this.shopForced = false;
            this.setShopOpen(false);
        }
        if (this.shopClose) this.shopClose.visible = !forced;
    }

    /** Opens / closes the wardrobe (the scene calls this as the player steps on / off a wardrobe's pad). */
    /** How far the player should be from the middle of the screen (shares of its width and height): clear of the open wardrobe (or the tractor's panel). */
    public viewShift(): { x: number; y: number } {
        const screen = Game.overlayScreenData;
        if ((!this.wardrobeOpen && !this.tractorOpen) || !screen) return { x: 0, y: 0 };
        return screen.width / screen.height >= WARDROBE_VIEW.wideFrom ? { x: -WARDROBE_VIEW.playerLeft, y: 0 } : { x: 0, y: WARDROBE_VIEW.playerAt - 0.5 };
    }

    public setWardrobeOpen(open: boolean): void {
        if (open === this.wardrobeOpen) return;
        this.wardrobeOpen = open;
        this.wardrobe.visible = open;
        if (!open) return;
        this.setTractorOpen(false);
        // Seen first: a return visit after the first hat badges the gifts before the panel draws.
        MowProgress.markWardrobeSeen();
        this.wardrobe.refresh();
        UiAnim.popIn(this.wardrobe);
        MowAudio.play('open');
    }

    /** Opens / closes the tractor's panel (its button). */
    public setTractorOpen(open: boolean): void {
        if (open === this.tractorOpen) return;
        this.tractorOpen = open;
        this.tractorPanel.visible = open;
        if (open) {
            this.setWardrobeOpen(false);
            GameAnalytics.panelOpened('tractor');
            GameAnalytics.tractorStep('menu');
            MowProgress.markTractorSeen();
            this.tractorPanel.refresh();
            UiAnim.popIn(this.tractorPanel);
            MowAudio.play('open');
        }
        this.refreshPowerButton();
    }

    /** The tractor can be dressed: its button's there. */
    public get tractorMenu(): boolean {
        return this.tractorButton.visible;
    }

    /** A panel's open over the game (nothing else should come up meanwhile). */
    public get panelOpen(): boolean {
        return this.playStopped || this.wardrobeOpen || this.tractorOpen || this.shopOpen;
    }

    /**
     * The tutorial's first hat (its id; undefined frees the wardrobe): the panel stays on it, the hand on it, the rest
     * dimmed, and there's no closing it until it's bought.
     */
    public setWardrobeForced(hatId: string | undefined): void {
        this.wardrobe.setForcedItem(hatId);
        this.wardrobeClose.visible = !hatId;
    }

    /** What the guide wants bought (the hand on its button), or null. */
    public setShopHint(hint: ShopHint): void {
        if (hint === this.hint) return;
        this.hint = hint;
        if (this.shopOpen) this.renderShop();
    }

    /** What the shop shows, as a key: rebuilt only when it changes (not on every coin). */
    private shopState(): string {
        const money = MowProgress.money;
        return [MowProgress.toolLevel, this.hint, this.tab, MowProgress.boostsUnlocked, MowProgress.canAffordBoost,
            ...MOW.upgrades.map((u) => `${MowProgress.upgradeLevel(u.id)}${money >= (MowProgress.upgradePrice(u) ?? Infinity) ? '+' : ''}`),
            money >= (MowProgress.nextTool?.price ?? Infinity)].join('|');
    }

    private renderShop(): void {
        this.shopKey = this.shopState();
        UiAnim.kill(this.shopBody);
        this.shopBody.removeChildren().forEach((child) => child.destroy({ children: true }));
        if (this.powerOpen) {
            this.renderPowerUps();
            return;
        }
        if (!MowProgress.boostsUnlocked) this.tab = 'gear';
        this.shopBody.addChild(this.shopTabs());
        if (this.tab === 'boosts') this.renderBoosts();
        else this.renderGear();
    }

    /** The tabs over the content block: GEAR, and BOOSTS once the first mower is bought (with a "!" when one is affordable). */
    private shopTabs(): PIXI.Container {
        const tabs: TabSpec[] = [{ id: 'gear', label: t('tabGear') }];
        if (MowProgress.boostsUnlocked) tabs.push({ id: 'boosts', label: t('tabBoosts'), alert: MowProgress.canAffordBoost });
        const block = tabbedBlock({
            width: BLOCK.width,
            height: BLOCK.height,
            tabWidth: BLOCK.tabWidth,
            tabHeight: BLOCK.tabHeight,
            tabs,
            active: this.tab,
            onSelect: (id) => {
                this.tab = id as 'gear' | 'boosts';
                GameAnalytics.tabOpened('atm', id);
                MowAudio.play('tab');
                this.renderShop();
            },
        });
        block.y = BLOCK.top;
        return block;
    }

    /** GEAR: the mower timeline, the next mower, the bag's capacity (with its levels), and the goal. */
    private renderGear(): void {
        const next = MowProgress.nextTool;
        const fmt = (n: number) => (Math.round(n * 10) / 10).toString();
        const current = MowProgress.tool;
        this.shopBody.addChild(this.offer(
            GEAR_Y.tool,
            mowerArt(next ?? current, 64),
            names.tool(next ?? current).toUpperCase(),
            next ? t('toolStats', { width: fmt(next.width), speed: fmt(next.speed), power: next.power }) : t('toolOwned'),
            next?.price,
            () => {
                if (!MowProgress.buyTool()) return false;
                GameAnalytics.toolBought(MowProgress.toolLevel, MowProgress.tool.id);
                return true;
            },
            this.hint === 'tool',
            toolFrame(next ? MowProgress.toolLevel + 1 : MowProgress.toolLevel, !next),
        ));
        const capacity = MOW.upgrades.find((u) => u.id === 'capacity')!;
        const bagPrice = MowProgress.upgradePrice(capacity);
        const bag = this.offer(
            GEAR_Y.bag,
            icon('hud', 'backpackIcon', 60),
            bagPrice !== undefined ? t('bagSize', { amount: MowProgress.capacityStep }) : t('bagMax'),
            t(bagPrice !== undefined ? 'bagHolds' : 'bagMaxInfo', { capacity: MowProgress.capacity + (bagPrice !== undefined ? MowProgress.capacityStep : 0) }),
            bagPrice,
            () => {
                if (!MowProgress.buyUpgrade(capacity)) return false;
                GameAnalytics.upgradeBought(capacity.id, MowProgress.upgradeLevel(capacity.id));
                return true;
            },
            this.hint === 'capacity',
        );
        bag.addChild(this.levelBar(MowProgress.upgradeLevel(capacity.id), capacity.maxLevel, 38));
        this.shopBody.addChild(bag);
        // After the rows, so the goal's price label draws over the mower row's top edge, not under it.
        this.shopBody.addChild(this.timeline(GEAR_Y.timeline));
        const goal = MOW.tools[MOW.tools.length - 1];
        this.footer(next ? t('mowerGoal', { tool: names.tool(goal).toUpperCase(), width: fmt(goal.width), power: goal.power }) : t('mowerGoalOwned'));
    }

    /** BOOSTS: a row per boost track, and a line on what boosts are. */
    private renderBoosts(): void {
        MOW.upgrades.filter((u) => u.tab === 'boosts')
            .forEach((boost, i) => this.shopBody.addChild(this.boostRow(boost, BOOST_ROW.firstY + i * BOOST_ROW.step)));
        this.footer(t('boostsHint'));
    }

    /** A line along the bottom of the shop. */
    private footer(text: string): void {
        const footer = UiKit.text('upgrades', 'itemInfo', { text });
        footer.anchor.set(0.5);
        footer.y = FOOTER_Y;
        UiKit.fit(footer, BLOCK.width - 30);
        this.shopBody.addChild(footer);
    }

    /** Every mower on a line: owned ones lit with a check, the next one pulsing, the rest dimmed with their price; the goal bigger. */
    private timeline(y: number): PIXI.Container {
        const row = new PIXI.Container();
        row.y = y;
        const owned = MowProgress.toolLevel;
        const count = MOW.tools.length;
        const step = TIMELINE.width / (count - 1);
        const x = (i: number) => -TIMELINE.width / 2 + i * step;
        const line = new PIXI.Graphics();
        line.lineStyle(6, LINE_TODO).moveTo(x(0), 0).lineTo(x(count - 1), 0);
        line.lineStyle(6, LINE_DONE).moveTo(x(0), 0).lineTo(x(owned), 0);
        row.addChild(line);
        MOW.tools.forEach((tool, i) => {
            const goal = i === count - 1;
            const size = goal ? TIMELINE.goal : TIMELINE.node;
            const node = new PIXI.Container();
            node.x = x(i);
            node.addChild(UiKit.image('upgrades', toolFrame(i, i <= owned), size, size), mowerArt(tool, size * 0.72));
            const price = shortMoney(tool.price);
            const label = UiKit.text('upgrades', 'nodeLabel', {
                text: i < owned ? '' : i === owned ? t('now') : goal ? t('goalPrice', { price: tool.price.toLocaleString('en-US') }) : price,
            });
            label.anchor.set(0.5, 0);
            label.y = size / 2 + 4;
            UiKit.fit(label, step + 6);
            if (i < owned) {
                const check = icon('hud', 'check', 26);
                check.y = size / 2 + 16;
                node.addChild(check);
            }
            if (i === owned) label.style.fill = 0x9cff9c;
            else if (goal || i === owned + 1) label.style.fill = NEXT_GOLD;
            node.addChild(label);
            if (i > owned) node.alpha = i === owned + 1 || goal ? 1 : 0.6;
            if (i === owned + 1) UiAnim.pulse(node, 0.08, 0.7);
            row.addChild(node);
        });
        return row;
    }

    /**
     * An upgrade path (the bag's, a boost's) as a segmented bar under its row's text: one segment per level, owned
     * green, the next gold and pulsing, the rest grey.
     */
    private levelBar(owned: number, count: number, y: number, milestones?: number[]): PIXI.Container {
        const bar = new PIXI.Container();
        bar.position.set(ROW.textX, y);
        if (count > LONG_TRACK) {
            // A long track (POWER-UPS' money ones): one bar filling toward the next milestone (or the cap).
            const marks = [...(milestones ?? []), count].filter((m) => m <= count).sort((a, b) => a - b);
            const next = marks.find((m) => m > owned) ?? count;
            const from = [0, ...marks].filter((m) => m <= owned).pop() ?? 0;
            const share = owned >= count ? 1 : (owned - from) / Math.max(1, next - from);
            bar.addChild(new PIXI.Graphics().beginFill(LINE_TODO).drawRoundedRect(0, -BAG_BAR.height / 2, BAG_BAR.width, BAG_BAR.height, 4).endFill());
            if (share > 0) bar.addChild(new PIXI.Graphics().beginFill(LINE_DONE).drawRoundedRect(0, -BAG_BAR.height / 2, Math.max(BAG_BAR.height, BAG_BAR.width * share), BAG_BAR.height, 4).endFill());
            return bar;
        }
        const gap = count > 16 ? 2 : 3;
        const width = (BAG_BAR.width - gap * (count - 1)) / count;
        for (let i = 0; i < count; i++) {
            const color = i < owned ? LINE_DONE : i === owned ? NEXT_GOLD : LINE_TODO;
            const segment = new PIXI.Graphics().beginFill(color).drawRoundedRect(-width / 2, -BAG_BAR.height / 2, width, BAG_BAR.height, 3).endFill();
            segment.x = width / 2 + i * (width + gap);
            if (i === owned) UiAnim.pulse(segment, 0.25, 0.5);
            bar.addChild(segment);
        }
        return bar;
    }

    /** POWER-UPS: a row per power-up, no tabs (the panel's whole inside). */
    private renderPowerUps(): void {
        POWER_UPS.map((id) => MOW.upgrades.find((u) => u.id === id))
            .filter((boost): boost is UpgradeDef => !!boost)
            .forEach((boost, i) => this.shopBody.addChild(this.boostRow(boost, POWER_ROW.firstY + i * POWER_ROW.step, POWER_ROW.height)));
    }

    // ---------------------------------------------------------------- power-ups (the farm test)

    /** The POWER-UPS button: a gold star sticker, a bouncing "!" while one's affordable; bottom left above the wardrobe. */
    private buildPowerButton(): void {
        const size = POWER_BUTTON_SIZE;
        // A sticker (the gold star on a white outline, nothing behind it), bottom left above the wardrobe (reposition()).
        this.powerButton.addChild(iconSticker('ItemIcon_Star_Gold', size * 0.82));
        this.powerButton.hitArea = new PIXI.Rectangle(-size / 2, -size / 2, size, size);
        const alert = icon('hud', 'alert', 34);
        this.powerAlert.addChild(alert);
        this.powerAlert.position.set(size / 2 - 6, -size / 2 + 6);
        gsap.to(alert, { y: -8, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        this.powerAlert.visible = false;
        this.powerButton.addChild(this.powerAlert);
        this.tappable(this.powerButton, () => {
            MowAudio.play('toggle');
            this.setPowerOpen(!this.powerOpen);
        });
        this.addChild(this.powerButton);
        this.powerButton.visible = false;
    }

    /** The wardrobe button: a shirt sticker and its "!"; bottom left, above the MAP button. */
    private buildWardrobeButton(): void {
        const size = POWER_BUTTON_SIZE;
        // A sticker (a shirt on a white outline, nothing behind it), bottom left above the map (reposition()).
        this.wardrobeButton.addChild(iconSticker('ItemIcon_Gear_Armor_Top', size * 0.82));
        this.wardrobeButton.hitArea = new PIXI.Rectangle(-size / 2, -size / 2, size, size);
        const alert = icon('hud', 'alert', 34);
        this.wardrobeAlert.addChild(alert);
        this.wardrobeAlert.position.set(size / 2 - 6, -size / 2 + 6);
        gsap.to(alert, { y: -8, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        this.wardrobeAlert.visible = false;
        this.wardrobeButton.addChild(this.wardrobeAlert);
        this.tappable(this.wardrobeButton, () => {
            MowAudio.play('toggle');
            if (!this.wardrobeOpen) this.setPowerOpen(false);
            this.setWardrobeOpen(!this.wardrobeOpen);
        });
        this.addChild(this.wardrobeButton);
        this.wardrobeButton.visible = false;
    }

    /** Opens / closes POWER-UPS (over whatever the player's doing; the ATM shop can't open over it). */
    private setPowerOpen(open: boolean): void {
        if (open === this.powerOpen || this.shopForced) return;
        if (open) {
            // (Over an open ATM shop or the wardrobe: they close first.)
            this.setWardrobeOpen(false);
            this.setTractorOpen(false);
            this.showShop(false);
            this.powerOpen = true;
            GameAnalytics.panelOpened('powerups');
            this.showShop(true);
        } else {
            this.showShop(false);
            this.powerOpen = false;
        }
    }

    /** The POWER-UPS button: shown once there's money to spend (the farm test only), its "!" while one's affordable. */
    private refreshPowerButton(): void {
        // The wardrobe: with the MAP button (the yard done: the very start stays simple); its "!" with something new affordable.
        const wardrobe = !!farmTest() && !!this.unlocked?.map;
        if (wardrobe && !this.wardrobeButton.visible) {
            UiAnim.popIn(this.wardrobeButton);
            // (The tractor's comes a moment after it.)
            gsap.delayedCall(TRACTOR_BUTTON_DELAY, () => {
                if (this.destroyed) return;
                this.tractorReady = true;
                this.refreshPowerButton();
            });
        }
        this.wardrobeButton.visible = wardrobe;
        this.wardrobeAlert.visible = wardrobe && MowProgress.wardrobeHasNews && !this.wardrobeOpen;
        // The tractor's: once there's one, after the map and the wardrobe; the first time ever, what it's for.
        const tractor = wardrobe && this.tractorReady && !!MowProgress.tool.ride;
        if (tractor && !this.tractorButton.visible && MowProgress.once('tractor-menu')) {
            this.say('CUSTOMIZE YOUR TRACTOR!', 0xffe27a);
            GameAnalytics.tractorButton();
        }
        this.tractorButton.set(tractor, MowProgress.tractorHasNews && !this.tractorOpen);
        const shown = !!farmTest() && MowProgress.levelFor(MowProgress.xp).level >= POWER_UPS_LEVEL;
        if (shown && !this.powerButton.visible) UiAnim.popIn(this.powerButton);
        this.powerButton.visible = shown;
        this.powerAlert.visible = shown && MowProgress.canAffordAny(POWER_UPS);
    }

    /** One boost: its icon, name and level, its effect now -> next, and the buy button (MAX at the top). */
    private boostRow(boost: UpgradeDef, y: number, height: number = BOOST_ROW.height): PIXI.Container {
        const level = MowProgress.upgradeLevel(boost.id);
        const price = MowProgress.upgradePrice(boost);
        // Width is in world units, a track with milestones its whole multiplier, the rest a share.
        const effect = (lv: number) => {
            if (boost.id === 'width') return `+${(boost.perLevel * lv).toFixed(2)}`;
            if (boost.milestones) {
                const factor = MowProgress.factorAt(boost, lv);
                return `x${factor >= 100 ? Math.round(factor) : Math.round(factor * 10) / 10}`;
            }
            return `+${Math.round(boost.perLevel * lv * 100)}%`;
        };
        const art = PIXI.Sprite.from(boost.icon);
        art.anchor.set(0.5);
        art.scale.set(50 / Math.max(art.texture.width, art.texture.height, 1));
        const row = this.offer(
            y,
            art,
            names.upgrade(boost).toUpperCase(),
            `${t('upgradeLevel', { level, max: boost.maxLevel })}  ·  ${price === undefined ? effect(level) : `${effect(level)}  →  ${effect(level + 1)}`}${nextMilestone(boost, level)}`,
            price,
            () => {
                if (!MowProgress.buyUpgrade(boost)) return false;
                GameAnalytics.upgradeBought(boost.id, MowProgress.upgradeLevel(boost.id));
                return true;
            },
            false,
            undefined,
            height,
            6,
        );
        // Its levels, like the bag's: owned green, the next gold.
        row.addChild(this.levelBar(level, boost.maxLevel, 27, boost.milestones));
        return row;
    }

    /** An offer row: its art in a frame, the name and detail (raised by `lift` to leave room under them), and the buy button (MAX when there's nothing left). */
    private offer(y: number, symbol: PIXI.Container, title: string, detail: string, price: number | undefined, buy: () => boolean,
        pointed: boolean, frameId = 'itemFrame', height = 104, lift = 0): PIXI.Container {
        const row = new PIXI.Container();
        row.y = y;
        row.addChild(UiKit.image('upgrades', 'rowBack', ROW.width, height));
        const frameSize = Math.min(86, height - 14);
        const frame = UiKit.image('upgrades', frameId, frameSize, frameSize);
        frame.x = ROW.frameX;
        symbol.x = ROW.frameX;
        const name = UiKit.fit(UiKit.text('upgrades', 'itemName', { name: title }), ROW.textWidth);
        name.anchor.set(0, 0.5);
        name.position.set(ROW.textX, -14 - lift);
        const info = UiKit.fit(UiKit.text('upgrades', 'itemInfo', { text: detail }), ROW.textWidth);
        info.anchor.set(0, 0.5);
        info.position.set(ROW.textX, 14 - lift * 1.5);
        row.addChild(frame, symbol, name, info);
        const button = new PIXI.Container();
        button.x = ROW.buttonX;
        row.addChild(button);
        if (price === undefined) {
            button.addChild(UiKit.image('upgrades', 'lockedButton', ROW.buttonWidth, 60), UiKit.text('upgrades', 'maxLabel'));
            return row;
        }
        const affordable = MowProgress.money >= price;
        button.addChild(UiKit.image('upgrades', affordable ? 'buyButton' : 'lockedButton', ROW.buttonWidth, 60),
            UiKit.fit(UiKit.text('upgrades', 'buyLabel', { price: shortMoney(price).slice(1) }), ROW.buttonWidth - 20));
        if (affordable) UiAnim.pulse(button, 0.05, 0.6);
        this.tappable(button, () => {
            if (buy()) {
                this.say(t('upgraded'), 0x9cff9c);
                MowAudio.play('buyCash');
                MowAudio.play('buyFanfare');
                this.onBuy();
            } else {
                this.say(t('notEnoughCash'), 0xff8a7a);
                MowAudio.play('error');
                UiAnim.shake(button, 8, 0.35);
            }
        });
        if (pointed && affordable) row.addChild(this.pointingHand(ROW.buttonX));
        return row;
    }

    /** The handHud pointing hand tapping at (x, 0). */
    private pointingHand(x: number): PIXI.Container {
        const holder = new PIXI.Container();
        holder.eventMode = 'none';
        holder.x = x;
        const hand = PIXI.Sprite.from('handHud');
        hand.width = hand.height = 72;
        hand.position.set(10 - 72 * 0.22, 8 - 72 * 0.16);
        holder.addChild(hand);
        gsap.to(holder, { y: 10, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        return holder;
    }

    // ---------------------------------------------------------------- updates

    /**
     * What the HUD shows as the game opens up: during the yard (the tutorial) no MAP button, no town icon, no trophy —
     * the first two come with the yard restored, the trophy with the first treasure found (a treasure flying in shows
     * it too). Each pops in as it comes (not on a load that already has it).
     */
    private refreshUnlocks(): void {
        // (Only the tutorial holds them back: any other city has the map from the start.)
        const map = !CITY.keepGear || MowProgress.isRestored(MOW.districts[0].id);
        // (Or a reward waiting: one carried over from the city before.)
        const trophy = this.treasuresFlying > 0 || MowProgress.hasUnclaimedTreasure || MOW.treasures.items.some((item) => MowProgress.treasureFound(item.id));
        const reveal = (target: PIXI.Container, shown: boolean, was: boolean | undefined) => {
            target.renderable = shown;
            target.eventMode = shown ? 'static' : 'none';
            if (shown && was === false) UiAnim.popIn(target);
        };
        reveal(this.mapButton, map, this.unlocked.map);
        reveal(this.miniature, map && !this.townMeterHidden, this.unlocked.map);
        reveal(this.mapHolder, map && !this.townMeterHidden, this.unlocked.map);
        reveal(this.trophiesButton, trophy, this.unlocked.trophy);
        this.unlocked = { map, trophy };
    }

    /** What refreshUnlocks() last showed (undefined before the first refresh: nothing pops on a load). */
    private unlocked: { map?: boolean; trophy?: boolean } = {};

    /** A sale just happened: hold its money back until the clippings land (releaseSale). */
    public holdSale(money: number): void {
        this.heldMoney += money;
        this.refresh();
    }

    public releaseSale(money: number): void {
        this.heldMoney = Math.max(0, this.heldMoney - money);
        this.refresh();
    }

    private refresh(): void {
        this.refreshUnlocks();
        this.refreshPowerButton();
        const waiting = MowProgress.hasUnclaimedTreasure && this.treasuresFlying === 0;
        this.trophiesAlert.visible = waiting;
        if (this.trophiesHand) this.trophiesHand.visible = waiting && !MowProgress.claimedAnyTreasure && !this.trophies.visible;
        // The first refresh shows the save as it is (no "it just changed" feedback).
        const first = this.lastMoney < 0;
        const money = MowProgress.money - this.heldMoney;
        // The wardrobe's prices turn red / white with the money (not while a sale is still landing).
        if (this.wardrobeOpen && this.heldMoney === 0 && money !== this.lastMoney) this.wardrobe.refresh();
        if (this.tractorOpen && this.heldMoney === 0 && money !== this.lastMoney) this.tractorPanel.refresh();
        this.moneyText.text = shortMoney(money);
        if (this.lastMoney >= 0 && money > this.lastMoney) {
            gsap.killTweensOf(this.moneyText.scale);
            this.moneyText.scale.set(1);
            UiAnim.punch(this.moneyText as unknown as PIXI.Container, 0.25);
        }
        this.lastMoney = money;
        const count = Math.floor(MowProgress.clippings);
        const capacity = MowProgress.capacity;
        const full = MowProgress.full;
        // The bag: how full, and what it's worth in money (what it sells for, what it pours into a station).
        this.bagText.text = `${shortNumber(count)}/${shortNumber(capacity)}`;
        const worth = farmTest() && count > 0 ? shortMoney(MowProgress.bagValue) : '';
        if (worth !== this.bagValueText.text) this.bagValueText.text = worth;
        this.bagValueIcon.visible = worth !== '';
        this.bagValueIcon.x = BAG.to - this.bagValueText.width - 1;
        UiKit.fit(this.bagText, (worth ? this.bagValueIcon.x - 30 : BAG.to) - BAG.from);
        this.bagText.style.fill = full ? 0xff7a6a : 0xffffff;
        this.bagBar.setShare(count / Math.max(1, capacity));
        if (full !== this.bagFull) {
            this.bagFull = full;
            this.fullTag.visible = full;
            this.bagBar.setColor(full ? BAG.full : BAG.fill);
            gsap.killTweensOf(this.bagRow.scale);
            this.bagRow.scale.set(1);
            if (full) {
                UiAnim.pulse(this.bagRow, 0.08, 0.45);
                // Not when a save loads with it full: only when it fills up in play.
                if (!first) MowAudio.play('bagFull');
            }
        }
        if (this.shopOpen && this.shopState() !== this.shopKey) this.renderShop();
    }

    /** A short centre-screen message. */
    public say(message: string, color = 0xffffff): void {
        // (Under an area's banner they'd pile up: they wait for it.)
        if (this.celebrating) {
            this.held.push({ message, color });
            return;
        }
        gsap.killTweensOf(this.toast);
        gsap.killTweensOf(this.toast.scale);
        this.toast.text = message;
        this.toast.style.fill = color;
        this.toast.alpha = 1;
        this.toast.scale.set(0.6);
        gsap.to(this.toast.scale, { x: 1, y: 1, duration: 0.3, ease: 'back.out(2.5)' });
        gsap.to(this.toast, { alpha: 0, duration: 0.5, delay: 1.8 });
    }

    /** Shakes the bag pill (trying to mow with it full). */
    public flashBag(): void {
        UiAnim.shake(this.bagRow, 8, 0.35);
    }

    /** Where the corner miniature sits (its centre). */
    private get miniatureHome(): PIXI.IPointData {
        const screen = Game.overlayScreenData;
        if (!screen) return this.miniature.position;
        // Bottom-right, its pips under it (the MAP button's corner's twin).
        return {
            x: screen.topLeft.x + screen.width - 20 - MINIATURE_WIDTH / 2,
            y: screen.topLeft.y + screen.height - 20 - this.miniature.badgeHeight - this.miniature.pictureHeight / 2,
        };
    }

    /** A panel that stops play is open (the map, Trophies, the language, the cities): gameplay waits for it to close. */
    public get playStopped(): boolean {
        return this.mapPanel.visible || this.trophies.visible || this.language.visible || this.cities.visible || this.powerOpen;
    }

    /** The player's level bar is on top (the farm test): the area's bar goes under it, smaller. */
    private underLevel = false;

    /** The room at the very top between the buttons (left) and the money (right), and its middle line: the level bar's place. */
    public levelSlot(): { left: number; right: number; y: number } {
        const button = SHOW_LANGUAGE_BUTTON ? this.languageButton : this.mute;
        return { left: button.x + BUTTON_SIZE / 2 + 10, right: this.corner.x - 10, y: this.mute.y };
    }

    public setUnderLevel(on: boolean): void {
        this.underLevel = on;
        this.reposition();
    }

    /** Where the level bar wants the area's on screen (its ends, its middle line, what the badge covers of it unscaled). */
    private levelSpan?: { left: number; right: number; y: number; covered: number };
    /** How much of the area's bar (its left end) the level's badge covers. */
    private covered = 0;

    public alignUnderLevel(span: { left: number; right: number; y: number; covered: number }): void {
        this.levelSpan = span;
        this.covered = span.covered;
        this.progressBar.setFrom(span.covered);
        // Its words in the middle of what's left in sight (the badge at one end, the reward at the other).
        this.progressText.x = (span.covered - REWARD.size / 2 + 4) / 2;
        UiKit.fit(this.progressText, PROGRESS.width - this.covered - REWARD.size / 2 - 16);
        this.reposition();
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        // Money, bag and trophy: smaller on a portrait screen (room for the area bar beside them).
        const cornerScale = screen.width < screen.height ? CORNER_PORTRAIT_SCALE : 1;
        this.corner.scale.set(cornerScale);
        this.corner.position.set(screen.topLeft.x + screen.width - 16 - CORNER_WIDTH * cornerScale, screen.topLeft.y + 36);
        this.mute.position.set(screen.topLeft.x + 20 + BUTTON_SIZE / 2, screen.topLeft.y + 20 + BUTTON_SIZE / 2);
        this.languageButton.position.set(this.mute.x + BUTTON_SIZE + 12, this.mute.y);
        // The area's bar: under the player's level bar when there is one (as wide as it), else at the top.
        this.progress.scale.set(1);
        this.progress.position.set(screen.center.x, screen.topLeft.y + PROGRESS.y);
        const span = this.underLevel ? this.levelSpan : undefined;
        if (span) {
            this.progress.scale.set((span.right - span.left) / PROGRESS.width);
            this.progress.position.set((span.left + span.right) / 2, span.y);
        }
        if (this.goal) {
            // Between the buttons on the left and the money on the right, smaller if it has to.
            const room = Math.min(screen.center.x - ((SHOW_LANGUAGE_BUTTON ? this.languageButton : this.mute).x + BUTTON_SIZE / 2), this.corner.x - screen.center.x) - 8;
            this.goal.scale.set(Math.min(1, room / GOAL_TIMELINE_HALF_WIDTH));
            this.goal.position.set(screen.center.x, screen.topLeft.y + 52);
        }
        this.combo.position.set(screen.center.x, span ? this.progress.y + 80 : screen.topLeft.y + 205);
        // The map hangs right-aligned under the trophy (its origin is its centre).
        this.mapHome.set(screen.topLeft.x + screen.width - 20 - this.townMap.panelWidth / 2, this.corner.y + 190 + this.townMap.panelHeight / 2);
        if (!this.mapFlying) this.mapHolder.position.copyFrom(this.mapHome);
        // The miniature hangs right-aligned under the trophy too (its origin is its centre), unless it's up celebrating.
        if (!this.miniature.celebrating) this.miniature.position.copyFrom(this.miniatureHome);
        this.mapButton.position.set(screen.topLeft.x + 20 + MAP_BUTTON_SIZE / 2, screen.topLeft.y + screen.height - 20 - MAP_BUTTON_SIZE / 2);
        // The wardrobe above it (the farm test).
        this.wardrobeButton.position.set(this.mapButton.x, this.mapButton.y - MAP_BUTTON_SIZE - 14);
        // The tractor's above that, POWER-UPS above both.
        this.tractorButton.position.set(this.mapButton.x, this.wardrobeButton.y - MAP_BUTTON_SIZE - 14);
        this.powerButton.position.set(this.mapButton.x, this.tractorButton.y - MAP_BUTTON_SIZE - 14);
        this.mapDim.clear().beginFill(0x000000, 0.55).drawRect(screen.topLeft.x, screen.topLeft.y, screen.width, screen.height).endFill();
        const mapScale = Math.min(1, (screen.height * 0.85) / (this.panelMap.panelHeight + RIBBON_OVERHANG), (screen.width - 24) / (this.panelMap.panelWidth + CLOSE_SIZE / 2));
        this.panelMapHolder.scale.set(mapScale);
        // The close button keeps its usual size on the scaled-up map.
        this.mapClose?.scale.set(1 / mapScale);
        this.panelMapHolder.position.set(screen.center.x, screen.center.y + (RIBBON_OVERHANG / 2) * mapScale);
        this.celebration.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.26);
        this.toast.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.24);
        // The finds' toasts stack down on the left, under the area's bar (clear of its name on a narrow screen).
        this.findToasts.position.set(screen.topLeft.x + 20, this.progress.y + 60);
        this.moveHint.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.72);
        // The shop hangs in the bottom half, under the player; the language list in the middle.
        const top = screen.center.y + PANEL_TOP_GAP;
        const room = screen.topLeft.y + screen.height - 16 - top;
        const shopScale = Math.min(1, room / (SHOP.height + RIBBON_OVERHANG), (screen.width - 24) / (SHOP.width + CLOSE_SIZE / 2));
        this.shopHolder.scale.set(shopScale);
        this.shopHolder.position.set(screen.center.x, top + (RIBBON_OVERHANG + SHOP.height / 2) * shopScale);
        // The wardrobe leaves the player in sight, trying things on (viewShift(): the camera moves them clear of it).
        const wide = screen.width / screen.height >= WARDROBE_VIEW.wideFrom;
        const wardrobeTop = wide ? screen.topLeft.y + 40 : screen.topLeft.y + screen.height * WARDROBE_VIEW.top;
        const wardrobeRoom = screen.topLeft.y + screen.height - 16 - wardrobeTop;
        const wardrobeWidth = wide ? screen.width / 2 - WARDROBE_VIEW.gap - 16 : screen.width - 24;
        const wardrobeScale = Math.min(1.1, wardrobeRoom / (WARDROBE_SIZE.height + RIBBON_OVERHANG), wardrobeWidth / (WARDROBE_SIZE.width + CLOSE_SIZE / 2));
        this.wardrobeHolder.scale.set(wardrobeScale);
        this.wardrobeHolder.position.set(
            wide ? screen.center.x + WARDROBE_VIEW.gap + (WARDROBE_SIZE.width / 2) * wardrobeScale : screen.center.x,
            wardrobeTop + (RIBBON_OVERHANG + WARDROBE_SIZE.height / 2) * wardrobeScale);
        const trophiesScale = Math.min(1, (screen.height - 94) / (TROPHIES_SIZE.height + RIBBON_OVERHANG), (screen.width - 24) / (TROPHIES_SIZE.width + CLOSE_SIZE / 2));
        this.trophiesHolder.scale.set(trophiesScale);
        const citiesScale = Math.min(1, (screen.height - 60) / (CITIES_PANEL_SIZE.height + 60), (screen.width - 20) / CITIES_PANEL_SIZE.width);
        this.citiesHolder.scale.set(citiesScale);
        this.citiesHolder.position.set(screen.center.x, screen.center.y + 20 * citiesScale);
        this.citiesDim.clear().beginFill(0x000000, 0.65).drawRect(screen.topLeft.x, screen.topLeft.y, screen.width, screen.height).endFill();
        // NEW CITY AVAILABLE over the town icon; its rays behind it.
        const home = this.miniatureHome;
        const half = this.newCity.width / 2;
        this.newCity.position.set(Math.min(home.x, screen.topLeft.x + screen.width - 12 - half), home.y - this.miniature.pictureHeight / 2 - 30);
        this.newCityRays?.rays.position.set(home.x, home.y);
        this.trophiesHolder.position.set(screen.center.x, screen.center.y + (RIBBON_OVERHANG / 2) * trophiesScale);
        const languageScale = Math.min(1, (screen.height - 94) / (LANGUAGE_SIZE.height + RIBBON_OVERHANG), (screen.width - 24) / (LANGUAGE_SIZE.width + CLOSE_SIZE / 2));
        this.languageHolder.scale.set(languageScale);
        this.languageHolder.position.set(screen.center.x, screen.center.y + (RIBBON_OVERHANG / 2) * languageScale);
    }

    public override destroy(): void {
        MowProgress.onChange.remove(this.onChange);
        UiAnim.kill(this);
        super.destroy({ children: true });
    }
}
