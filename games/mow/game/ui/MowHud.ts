// MowHud.ts
//
// The on-screen UI, from the UI kit (ui/uikit.json): money and bag pills top-right (the bag's fill bar turns red and
// gets a bobbing "FULL!" tag when full), mute and the language flag top-left, the current district's restoration
// (name, % and a bar) top-centre, short messages in the middle, the move hint for a brand-new player, and the SHOP
// panel — open while the player stands on an ATM's pad, laid out like dig's: a GEAR tab (every mower on a timeline
// up to the goal, the next mower's offer, the bag's capacity with its levels, and the goal along the bottom) and a
// BOOSTS tab once the first mower is bought (speed, money gain, cutting width, sharp blades); the guide's hand sits
// on the button it's pointing at. Both modes (GameMode): a pop by the bar at each quarter of a section (milestone())
// and a big banner when one is restored (celebrate(): rays, ribbon, the bonus counting up, confetti). Rush mode: the
// combo meter under the bar (setCombo()). The town under the trophy: its miniature (TownMiniature, baked from the 3D
// world) under a dark veil that drains as the town is restored, with the town's % — when a section is restored it flies
// to the middle, big, and drains to the new % with a flash and confetti (TownMiniature.celebrate()), before the
// banner. Not baked yet: the
// drawn map (TownMap) stands in there, flown to the centre instead (flyMap()). The MAP button (bottom-left) and a tap
// on the miniature open the drawn map big: every section's fill, the one being worked on, the player.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import SoundToggleButton from 'core/ui/SoundToggleButton';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { MoveHint } from './MoveHint';
import { LanguagePanel, LANGUAGE_SIZE } from './LanguagePanel';
import { WardrobePanel, WARDROBE_SIZE } from './WardrobePanel';
import { TrophiesPanel, TROPHIES_SIZE } from './TrophiesPanel';
import { TownMap } from './TownMap';
import { FindCard, Find, FIND_CARD_SIZE, flyCoins } from './FindCard';
import { TownMiniature, REVEAL_SEC } from './TownMiniature';
import { MowProgress } from '../data/MowProgress';
import { MOW, ToolDef, UpgradeDef } from '../data/MowConfig';
import { ModelIcons } from './ModelIcons';
import { tabbedBlock, TabSpec } from './TabBar';
import { t, names, Localization } from '../i18n/Localization';
import { LOCALE_FLAG_CODE } from '../i18n/config';
import { MowAudio } from '../audio/MowAudio';
import { GameAnalytics } from '../analytics/GameAnalytics';
import { Gameplay } from '../data/Gameplay';

const PILL_WIDTH = 210;
const PILL_HEIGHT = 46;
const ICON_SIZE = 58;
const BAR_WIDTH = 72;
const BAR_X = 186;
const BAR_HEIGHT = 18;
/** The money / bag column's width: it hangs from the top-right corner. */
const CORNER_WIDTH = ICON_SIZE / 2 + PILL_WIDTH - 8;
const BUTTON_SIZE = 64;
const PROGRESS = { width: 360, height: 18 };
const SHOP = { width: 840, height: 580 };
/** Shop rows: frame left, text, buy button right. */
const ROW = { width: 776, frameX: -336, textX: -280, textWidth: 470, buttonX: 300, buttonWidth: 150 };
/** The tabs' content block (y = its top edge), and the GEAR tab's rows. */
const BLOCK = { top: -170, width: 800, height: 432, tabWidth: 170, tabHeight: 48 };
const GEAR_Y = { timeline: -110, tool: 28, bag: 146 };
const BOOST_ROW = { firstY: -116, step: 90, height: 82 };
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
/**
 * A restored section's reveal (the town's miniature filling up in the middle, then flying home), in seconds; the
 * banner follows as it lands, and the scene delays its "NEW AREA" message by it too.
 */
export const MAP_FLIGHT_SEC = REVEAL_SEC;
/** The RESTORED! banner: held up, then going; the scene's "NEW AREA" message waits for it (BANNER_SEC). */
const BANNER = { hold: 2.8, out: 0.4 };
export const BANNER_SEC = BANNER.hold + BANNER.out;
/** The drawn map's flight (no miniatures baked): out, the fill starting once it's there, back home. */
const MAP_FLIGHT = { out: 0.35, back: 1.35, home: 0.35 };
/** The corner miniature's width, its width in the reveal (at most; less on a narrow screen), and the MAP button's size. */
const MINIATURE_WIDTH = 190;
const REVEAL_WIDTH = 560;
const MAP_BUTTON_SIZE = 84;
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
    /** A find's claim card (treasures, secret chests), at the bottom of the screen. */
    private readonly findCard = new FindCard((find, from) => this.claimFind(find, from));
    private readonly moneyText = UiKit.text('hud', 'money', { money: 0 });
    private readonly bagText = UiKit.text('hud', 'backpack', { count: 0, capacity: 0 });
    private readonly barFill = new PIXI.Container();
    private readonly fullTag = new PIXI.Container();
    private bagRow!: PIXI.Container;
    private bagFull = false;
    private readonly toast = UiKit.text('hud', 'toast', { text: '' });
    private readonly progress = new PIXI.Container();
    private readonly progressText = UiKit.text('hud', 'toast', { text: '' }, { fontSize: 22, strokeThickness: 5 });
    private readonly progressFill = new PIXI.Container();
    /** The section-complete banner (celebrate()) and rush mode's combo meter (setCombo()). */
    private readonly celebration = new PIXI.Container();
    private readonly combo = new PIXI.Container();
    /** The town's miniature (top-right, under the trophy). */
    private readonly miniature = new TownMiniature(MINIATURE_WIDTH);
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
    private readonly panelMap = new TownMap();
    private readonly panelMapHolder = new PIXI.Container();
    private mapClose?: PIXI.Container;
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
    /** The wardrobe (on a wardrobe's pad), sized and placed like the shop. */
    private readonly wardrobe: WardrobePanel;
    private readonly wardrobeHolder = new PIXI.Container();
    private wardrobeOpen = false;
    /** The Trophies button (under the pills: the treasures found, by area), its "!", and its panel. */
    private readonly trophiesButton = new PIXI.Container();
    private readonly trophiesAlert = new PIXI.Container();
    private readonly trophies: TrophiesPanel;
    private readonly trophiesHolder = new PIXI.Container();
    /** The wardrobe's close button (hidden while the tutorial's first hat is forced). */
    private readonly wardrobeClose: PIXI.Container;
    private shopKey = '';
    private hint: ShopHint = null;
    private tab: 'gear' | 'boosts' = 'gear';
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
        this.buildCombo();
        this.buildButtons();
        this.buildShop();
        this.wardrobe = new WardrobePanel(onWear, (text, color) => this.say(text, color));
        this.wardrobeClose = this.addClose(this.wardrobe, WARDROBE_SIZE, () => this.setWardrobeOpen(false));
        this.wardrobeHolder.addChild(this.wardrobe);
        this.trophies = new TrophiesPanel((key) => this.claimTrophy(key), isOpen);
        this.addClose(this.trophies, TROPHIES_SIZE, () => this.toggleTrophies());
        this.trophiesHolder.addChild(this.trophies);
        this.buildTrophiesButton();
        this.languageHolder.addChild(this.language);
        this.addClose(this.language, LANGUAGE_SIZE, () => this.toggleLanguage());
        this.toast.alpha = 0;
        this.mapHolder.addChild(this.townMap);
        this.buildMap();
        this.addChild(this.corner, this.progress, this.combo, this.celebration, this.mapHolder, this.miniature, this.mapButton, this.mute, this.languageButton, this.moveHint, this.shopHolder, this.wardrobeHolder, this.trophiesHolder, this.languageHolder, this.mapPanel, this.findCard, this.toast);
        MowProgress.onChange.add(this.onChange);
        this.refresh();
        this.reposition();
    }

    // ---------------------------------------------------------------- corner (money, bag)

    private pill(iconId: string, label: PIXI.Text, y: number): PIXI.Container {
        const row = new PIXI.Container();
        row.y = y;
        const back = UiKit.image('hud', 'pill', PILL_WIDTH, PILL_HEIGHT);
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
        const bag = this.pill('backpackIcon', this.bagText, 62);
        this.bagRow = bag;
        const bar = new PIXI.Container();
        bar.position.set(BAR_X, -2);
        bar.addChild(UiKit.image('hud', 'barBack', BAR_WIDTH, BAR_HEIGHT), this.barFill);
        bag.addChild(bar);
        const fullLabel = UiKit.fit(UiKit.text('hud', 'toast', { text: t('bagFullTag') }, { fontSize: 20, fill: 0xff7a6a, strokeThickness: 5 }), BAR_WIDTH + 30);
        this.fullTag.addChild(fullLabel);
        this.fullTag.position.set(BAR_X, -PILL_HEIGHT / 2 - 6);
        this.fullTag.visible = false;
        gsap.to(this.fullTag, { y: this.fullTag.y - 6, duration: 0.4, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        bag.addChild(this.fullTag);
        this.corner.addChild(bag);
    }

    // ---------------------------------------------------------------- district progress

    private buildProgress(): void {
        const bar = new PIXI.Container();
        bar.y = 28;
        bar.addChild(UiKit.image('hud', 'barBack', PROGRESS.width, PROGRESS.height), this.progressFill);
        this.progress.addChild(this.progressText, bar);
    }

    /** The district shown at the top: its name, restored share and bar. */
    public setDistrict(index: number, share: number): void {
        this.district = index;
        const district = MOW.districts[index];
        const percent = Math.floor(share * 100);
        this.progressText.text = t('districtProgress', { name: names.district(district).toUpperCase(), percent });
        UiKit.fit(this.progressText, PROGRESS.width + 40);
        this.progressFill.removeChildren().forEach((child) => child.destroy({ children: true }));
        if (share > 0) {
            const inner = PROGRESS.width - 4;
            const width = Math.max(PROGRESS.height - 4, inner * Math.min(1, share));
            const fill = UiKit.image('hud', 'barFill', width, PROGRESS.height - 4);
            fill.x = -inner / 2 + width / 2;
            this.progressFill.addChild(fill);
        }
    }

    /** A quarter of a section done: the percentage pops out of the bar, which jumps. */
    public milestone(percent: number): void {
        gsap.killTweensOf(this.progress.scale);
        this.progress.scale.set(1);
        UiAnim.punch(this.progress, 0.2);
        const pop = UiKit.text('hud', 'toast', { text: `${percent}%` }, { fontSize: 46, strokeThickness: 8, fill: 0x9cff9c });
        pop.anchor.set(0.5);
        pop.position.set(PROGRESS.width / 2 + 52, 28);
        pop.scale.set(0.3);
        this.progress.addChild(pop);
        UiAnim.sparkBurst(this.progress, pop.x, pop.y, 0x9cff9c, 70);
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
        this.tappable(this.miniature, () => this.toggleMap());
        void this.miniature.ready.then((ready) => {
            if (!ready || this.destroyed) return;
            this.miniatureReady = true;
            this.mapHolder.visible = false;
            this.reposition();
        });

        const back = icon('hud', 'muteButton', MAP_BUTTON_SIZE);
        const map = PIXI.Sprite.from('ItemIcon_Map');
        map.anchor.set(0.5);
        map.scale.set((MAP_BUTTON_SIZE * 0.66) / Math.max(map.texture.width, map.texture.height, 1));
        this.mapButton.addChild(back, map);
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
        Gameplay.stop();
        UiAnim.popIn(this.panelMapHolder, this.mapDim);
    }

    /** Every section's share (1 once restored), open / restored flags, and the one being worked on (-1: none). */
    public setTownMap(shares: readonly number[], open: readonly boolean[], restored: readonly boolean[], current: number): void {
        this.townMap.setState(shares, open, restored, current);
        this.panelMap.setState(shares, open, restored, current);
        // The town's %: every section weighs the same.
        this.miniature.setShare(shares.reduce((sum, share) => sum + share, 0) / Math.max(1, shares.length));
    }

    /** The player's dot on the town map (world x / z). */
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
     * A section restored: first the town map's flight (flyMap()), then ? as it lands ? the banner: rays, its name on a
     * ribbon, RESTORED!, its bonus counting up, confetti; then it goes.
     */
    public celebrate(name: string, bonus: number, section: number): void {
        const screen = Game.overlayScreenData;
        if (!this.miniatureReady || !screen) {
            this.flyMap(section);
            gsap.delayedCall(MAP_FLIGHT.back + 0.1, () => {
                if (!this.destroyed) this.showBanner(name, bonus);
            });
            return;
        }
        // The town's miniature flies to the middle and fills up to its new %, then home; the banner as it lands.
        const scale = Math.min(REVEAL_WIDTH, screen.width * 0.85) / MINIATURE_WIDTH;
        const centre = { x: screen.center.x, y: screen.center.y - screen.height * 0.06 };
        this.miniature.celebrate(centre, scale, () => this.miniatureHome, () => {
            if (!this.destroyed) this.showBanner(name, bonus);
        });
    }

    private showBanner(name: string, bonus: number): void {
        UiAnim.kill(this.celebration);
        this.celebration.removeChildren().forEach((child) => child.destroy({ children: true }));
        const banner = new PIXI.Container();
        UiAnim.rays(banner, 300, 0xfff0a0, 0.6, 10);
        const ribbon = UiKit.sprite('upgrades', 'ribbon', 0.62);
        const title = UiKit.text('upgrades', 'title', {}, { fontSize: 40 });
        title.anchor.set(0.5);
        title.text = name;
        UiKit.fit(title, 480);
        title.y = -5;
        const restored = UiKit.text('hud', 'toast', { text: t('restored') }, { fontSize: 64, strokeThickness: 10, fill: 0xffe27a });
        restored.anchor.set(0.5);
        restored.y = -100;
        const reward = UiKit.text('hud', 'toast', { text: '' }, { fontSize: 46, strokeThickness: 8, fill: 0x9cff9c });
        reward.anchor.set(0.5);
        reward.y = 92;
        const stars = [-1, 0, 1].map((side) => {
            const star = PIXI.Sprite.from('ItemIcon_Star_Gold');
            star.anchor.set(0.5);
            star.scale.set((side === 0 ? 92 : 70) / Math.max(star.texture.width, star.texture.height, 1));
            star.position.set(side * 210, side === 0 ? -182 : -150);
            star.rotation = side * 0.25;
            return star;
        });
        banner.addChild(ribbon, title, restored, reward, ...stars);
        this.celebration.addChild(banner);
        banner.scale.set(0.3);
        banner.alpha = 0;
        gsap.to(banner, { alpha: 1, duration: 0.2 });
        gsap.to(banner.scale, { x: 1, y: 1, duration: 0.5, ease: 'back.out(2)' });
        UiAnim.staggerPop(stars, 0.25, 0.12);
        UiAnim.countUp(reward, 0, bonus, (value) => `+$${value.toLocaleString('en-US')}`, 1, 0.35);
        UiAnim.confetti(this.celebration, 0, -40, 90, 1.2);
        gsap.to(banner, { alpha: 0, duration: BANNER.out, delay: BANNER.hold });
        gsap.to(banner.scale, { x: 1.15, y: 1.15, duration: BANNER.out, delay: BANNER.hold, onComplete: () => {
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
        this.comboPot.text = `+$${Math.round(pot).toLocaleString('en-US')}`;
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
        const size = 76;
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
        this.tappable(this.trophiesButton, () => this.toggleTrophies());
        this.corner.addChild(this.trophiesButton);
    }

    private toggleTrophies(): void {
        MowAudio.play('toggle');
        this.trophies.visible = !this.trophies.visible;
        if (!this.trophies.visible) return;
        Gameplay.stop();
        this.trophies.refresh();
        UiAnim.popIn(this.trophies);
    }

    /** Something found (a treasure, a secret chest): its claim card (queued behind any showing). */
    public showFind(find: Find): void {
        this.findCard.show(find);
    }

    /** CLAIM on a find's card: paid now, held off the counter, its coins flying from the button into the money. */
    private claimFind(find: Find, from: PIXI.Point): void {
        this.holdSale(find.amount);
        const paid = find.claim();
        if (paid < find.amount) this.releaseSale(find.amount - paid);
        if (paid <= 0) return;
        MowAudio.play('buyCash');
        MowAudio.play('coins');
        const target = () => (this.moneyIcon && !this.moneyIcon.destroyed ? this.toLocal(this.moneyIcon.getGlobalPosition()) : new PIXI.Point());
        flyCoins(this, this.toLocal(from), target, paid, (share) => {
            if (!this.destroyed) this.releaseSale(share);
        });
    }

    /** Where the Trophies button is on screen (a found treasure flies there). */
    public get trophiesButtonPosition(): PIXI.Point {
        return this.trophiesButton.getGlobalPosition();
    }

    /** A reward claimed in the Trophies panel: paid now, said, the coins chime. */
    private claimTrophy(key: string): void {
        const amount = MowProgress.claimTreasure(key);
        if (amount <= 0) return;
        GameAnalytics.treasureClaimed(key);
        MowAudio.play('buyCash');
        MowAudio.play('coins');
        this.say(`+$${amount.toLocaleString('en-US')}`, 0x9cff9c);
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
            UiAnim.punch(target, 0.12);
            action();
        });
    }

    /** A panel's red close button on its top-right corner. */
    private addClose(panel: PIXI.Container, size: { width: number; height: number }, onClose: () => void): PIXI.Container {
        const close = new PIXI.Container();
        close.addChild(icon('hud', 'closeButton', CLOSE_SIZE), icon('hud', 'closeIcon', CLOSE_SIZE * 0.5));
        close.position.set(size.width / 2 - 8, -size.height / 2 + 8);
        this.tappable(close, onClose);
        panel.addChild(close);
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
        this.shop.addChild(frame, ribbon, title, this.shopBody);
        this.addClose(this.shop, SHOP, () => this.setShopOpen(false));
        this.shop.visible = false;
        this.shopHolder.addChild(this.shop);
    }

    /** Opens / closes the shop (the scene calls this as the player steps on / off the pad). */
    public setShopOpen(open: boolean): void {
        if (open === this.shopOpen) return;
        this.shopOpen = open;
        this.shop.visible = open;
        if (!open) return;
        this.renderShop();
        UiAnim.popIn(this.shop);
        MowAudio.play('open');
    }

    /** Opens / closes the wardrobe (the scene calls this as the player steps on / off a wardrobe's pad). */
    public setWardrobeOpen(open: boolean): void {
        if (open === this.wardrobeOpen) return;
        this.wardrobeOpen = open;
        this.wardrobe.visible = open;
        if (!open) return;
        // Seen first: a return visit after the first hat badges the gifts before the panel draws.
        MowProgress.markWardrobeSeen();
        this.wardrobe.refresh();
        UiAnim.popIn(this.wardrobe);
        MowAudio.play('open');
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
            bagPrice !== undefined ? t('bagSize', { amount: capacity.perLevel }) : t('bagMax'),
            t(bagPrice !== undefined ? 'bagHolds' : 'bagMaxInfo', { capacity: MowProgress.capacity + (bagPrice !== undefined ? capacity.perLevel : 0) }),
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
            const price = `$${tool.price.toLocaleString('en-US')}`;
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
    private levelBar(owned: number, count: number, y: number): PIXI.Container {
        const bar = new PIXI.Container();
        bar.position.set(ROW.textX, y);
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

    /** One boost: its icon, name and level, its effect now -> next, and the buy button (MAX at the top). */
    private boostRow(boost: UpgradeDef, y: number): PIXI.Container {
        const level = MowProgress.upgradeLevel(boost.id);
        const price = MowProgress.upgradePrice(boost);
        // Width is in world units, the rest a share.
        const effect = (lv: number) => (boost.id === 'width' ? `+${(boost.perLevel * lv).toFixed(2)}` : `+${Math.round(boost.perLevel * lv * 100)}%`);
        const art = PIXI.Sprite.from(boost.icon);
        art.anchor.set(0.5);
        art.scale.set(50 / Math.max(art.texture.width, art.texture.height, 1));
        const row = this.offer(
            y,
            art,
            names.upgrade(boost).toUpperCase(),
            `${t('upgradeLevel', { level, max: boost.maxLevel })}  ·  ${price === undefined ? effect(level) : `${effect(level)}  →  ${effect(level + 1)}`}`,
            price,
            () => {
                if (!MowProgress.buyUpgrade(boost)) return false;
                GameAnalytics.upgradeBought(boost.id, MowProgress.upgradeLevel(boost.id));
                return true;
            },
            false,
            undefined,
            BOOST_ROW.height,
            6,
        );
        // Its levels, like the bag's: owned green, the next gold.
        row.addChild(this.levelBar(level, boost.maxLevel, 27));
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
            UiKit.fit(UiKit.text('upgrades', 'buyLabel', { price: price.toLocaleString('en-US') }), ROW.buttonWidth - 20));
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
        this.trophiesAlert.visible = MowProgress.hasUnclaimedTreasure;
        const money = MowProgress.money - this.heldMoney;
        // The wardrobe's prices turn red / white with the money (not while a sale is still landing).
        if (this.wardrobeOpen && this.heldMoney === 0 && money !== this.lastMoney) this.wardrobe.refresh();
        this.moneyText.text = `$${money.toLocaleString('en-US')}`;
        if (this.lastMoney >= 0 && money > this.lastMoney) {
            gsap.killTweensOf(this.moneyText.scale);
            this.moneyText.scale.set(1);
            UiAnim.punch(this.moneyText as unknown as PIXI.Container, 0.25);
        }
        this.lastMoney = money;
        const count = Math.floor(MowProgress.clippings);
        const capacity = MowProgress.capacity;
        const full = MowProgress.full;
        this.bagText.text = `${count}/${capacity}`;
        UiKit.fit(this.bagText, BAR_X - BAR_WIDTH / 2 - (ICON_SIZE + 8) - 6);
        this.bagText.style.fill = full ? 0xff7a6a : 0xffffff;
        this.barFill.removeChildren().forEach((child) => child.destroy({ children: true }));
        const fraction = Math.min(1, count / Math.max(1, capacity));
        if (fraction > 0) {
            const inner = BAR_WIDTH - 4;
            const width = Math.max(BAR_HEIGHT - 4, inner * fraction);
            const fill = UiKit.image('hud', full ? 'barFull' : 'barFill', width, BAR_HEIGHT - 4);
            fill.x = -inner / 2 + width / 2;
            this.barFill.addChild(fill);
        }
        if (full !== this.bagFull) {
            this.bagFull = full;
            this.fullTag.visible = full;
            gsap.killTweensOf(this.bagRow.scale);
            this.bagRow.scale.set(1);
            if (full) UiAnim.pulse(this.bagRow, 0.08, 0.45);
        }
        if (this.shopOpen && this.shopState() !== this.shopKey) this.renderShop();
    }

    /** A short centre-screen message. */
    public say(message: string, color = 0xffffff): void {
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
        return { x: screen.topLeft.x + screen.width - 20 - MINIATURE_WIDTH / 2, y: this.corner.y + 190 + this.miniature.pictureHeight / 2 };
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        this.corner.position.set(screen.topLeft.x + screen.width - 20 - CORNER_WIDTH, screen.topLeft.y + 44);
        this.mute.position.set(screen.topLeft.x + 20 + BUTTON_SIZE / 2, screen.topLeft.y + 20 + BUTTON_SIZE / 2);
        this.languageButton.position.set(this.mute.x + BUTTON_SIZE + 12, this.mute.y);
        this.progress.position.set(screen.center.x, screen.topLeft.y + 120);
        this.combo.position.set(screen.center.x, screen.topLeft.y + 205);
        // The map hangs right-aligned under the trophy (its origin is its centre).
        this.mapHome.set(screen.topLeft.x + screen.width - 20 - this.townMap.panelWidth / 2, this.corner.y + 190 + this.townMap.panelHeight / 2);
        if (!this.mapFlying) this.mapHolder.position.copyFrom(this.mapHome);
        // The miniature hangs right-aligned under the trophy too (its origin is its centre), unless it's up celebrating.
        if (!this.miniature.celebrating) this.miniature.position.copyFrom(this.miniatureHome);
        this.mapButton.position.set(screen.topLeft.x + 20 + MAP_BUTTON_SIZE / 2, screen.topLeft.y + screen.height - 20 - MAP_BUTTON_SIZE / 2);
        this.mapDim.clear().beginFill(0x000000, 0.55).drawRect(screen.topLeft.x, screen.topLeft.y, screen.width, screen.height).endFill();
        const mapScale = Math.min(2.6, (screen.height * 0.8) / this.panelMap.panelHeight, (screen.width - 48) / this.panelMap.panelWidth);
        this.panelMapHolder.scale.set(mapScale);
        // The close button keeps its usual size on the scaled-up map.
        this.mapClose?.scale.set(1 / mapScale);
        this.panelMapHolder.position.set(screen.center.x, screen.center.y);
        this.celebration.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.36);
        this.toast.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.24);
        // The find card sits at the bottom, clear of the player.
        const cardScale = Math.min(1, (screen.width - 32) / FIND_CARD_SIZE.width, (screen.height * 0.42) / FIND_CARD_SIZE.height);
        this.findCard.scale.set(cardScale);
        this.findCard.position.set(screen.center.x, screen.topLeft.y + screen.height - 24 - (FIND_CARD_SIZE.height / 2) * cardScale);
        this.moveHint.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.72);
        // The shop hangs in the bottom half, under the player; the language list in the middle.
        const top = screen.center.y + PANEL_TOP_GAP;
        const room = screen.topLeft.y + screen.height - 16 - top;
        const shopScale = Math.min(1, room / (SHOP.height + RIBBON_OVERHANG), (screen.width - 24) / (SHOP.width + CLOSE_SIZE / 2));
        this.shopHolder.scale.set(shopScale);
        this.shopHolder.position.set(screen.center.x, top + (RIBBON_OVERHANG + SHOP.height / 2) * shopScale);
        const wardrobeScale = Math.min(1, room / (WARDROBE_SIZE.height + RIBBON_OVERHANG), (screen.width - 24) / (WARDROBE_SIZE.width + CLOSE_SIZE / 2));
        this.wardrobeHolder.scale.set(wardrobeScale);
        this.wardrobeHolder.position.set(screen.center.x, top + (RIBBON_OVERHANG + WARDROBE_SIZE.height / 2) * wardrobeScale);
        const trophiesScale = Math.min(1, (screen.height - 94) / (TROPHIES_SIZE.height + RIBBON_OVERHANG), (screen.width - 24) / (TROPHIES_SIZE.width + CLOSE_SIZE / 2));
        this.trophiesHolder.scale.set(trophiesScale);
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
