// DigHud.ts
//
// The on-screen UI (GDD §15), built from the UI kit (ui/uikit.json, bandit-controller's kit): money and
// backpack pills with a fill bar in the top-right (the achievements and MAP under them; mute and settings
// top-left), the phone (sell the full backpack from anywhere at x2, for a
// rewarded video — see updatePhone()), the current tool chip, short centre messages
// ("Backpack full!", "SOLD! +$42"), the find banner, and the hub stations' panels, open while the
// miner stands on their pad: the ATM's upgrades — a GEAR tab (the next tool and the next backpack, each with a
// buy button; once the Tractor is owned it says so) and a BOOSTS tab (the repeatable boost tracks), the MAP
// button (under the achievements: the mines opened, travelling between them, opening the next — MinesPanel), the collection (CollectionPanel) and the wardrobe (WardrobePanel). The panels sit in the bottom
// half of the screen (shrunk to fit), so the miner stays in view, and each has a close button that keeps
// it shut until the miner steps off the pad.
//
// A full backpack shows on its pill (a bobbing "FULL!" tag, the pill and the SELL button pulsing) for as long as it
// stays full. The tutorial's first purchases are forced (setForced: the first bag, the first tool, the first hat): the
// screen dims, the upgrade panel (or the wardrobe on its hat) opens with no close button and the hand on what to buy,
// and nothing else can be tapped until it's bought.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { tabbedBlock, type TabSpec } from './TabBar';
import { DigProgress } from '../data/DigProgress';
import { CollectionPanel, COLLECTION_SIZE } from './CollectionPanel';
import { WardrobePanel, WARDROBE_SIZE } from './WardrobePanel';
import { FindBanner, FIND_BANNER_SIZE } from './FindBanner';
import { AchievementsPanel, ACHIEVEMENTS_SIZE } from './AchievementsPanel';
import { RewardPopup } from './RewardPopup';
import { LanguagePanel, LANGUAGE_SIZE } from './LanguagePanel';
import { MinesPanel, MINES_SIZE } from './MinesPanel';
import { MoveHint } from './MoveHint';
import { ModelIcons } from './ModelIcons';
import { BoostDef, DIG, Rarity, ToolDef } from '../data/DigConfig';
import { RARITY_COLORS } from './CollectionPanel';
import SoundToggleButton from 'core/ui/SoundToggleButton';
import type { StationKind } from '../data/HubData';

/** A tutorial purchase the HUD won't let go of (DigScene decides when). */
export type ForcedBuy = 'backpack' | 'tool' | 'hat';
import { t, names, type StringId } from '../i18n/Localization';
import { DigAudio } from '../audio/DigAudio';
import { Gameplay } from '../data/Gameplay';
import { GameAnalytics } from '../analytics/GameAnalytics';

const PILL_WIDTH = 210;
const PILL_HEIGHT = 46;
const ICON_SIZE = 58;
/** The money / backpack column's width (to the pills' right end): it hangs from the top-right corner. */
const CORNER_WIDTH = ICON_SIZE / 2 + PILL_WIDTH - 8;
/** The backpack fill bar sits in the right part of its pill, after the count. */
const BAR_WIDTH = 72;
const BAR_X = 186;
const BAR_HEIGHT = 18;
const TOOL_SIZE = 96;
/** The current tool sits in the bottom-right corner: its frame, its name on a pill under it. */
const TOOL_PILL_WIDTH = 170;
const MUTE_SIZE = 64;
/** The guide line wraps at this width. */
const GUIDE_WIDTH = 420;
/** The NEW MINE call to action in the bottom-left corner: the gem pack's size and the rays behind it. */
const NEW_MINE_CTA = { icon: 120, rays: 130, label: 170 };
/** The achievements button, under the money / backpack pills: just the memo pad icon, no button shape. */
const ACHIEVEMENTS_BUTTON = 84;
/** The SELL x2 offer: a pile of cash (no button shape) over the tool chip, a rotating shine behind it. */
const PHONE = { width: 112, height: 116, shine: 180 };
/** The phone only shows with this many tool upgrades bought (the Steel Pickaxe). */
const PHONE_TOOL_LEVEL = 2;
const UPGRADE_SIZE = { width: 620, height: 580 };
/** Tool timeline in the upgrade panel: node size and the tractor's (the goal) bigger node. */
const NODE_SIZE = 60;
const GOAL_SIZE = 78;
const TIMELINE_WIDTH = 460;
const LINE_DONE = 0x5fd35a;
/** The backpack's segmented upgrade bar, under its offer's text. */
const BAG_BAR = { width: 290, height: 9 };
const LINE_TODO = 0x4a5263;
/** GEAR tab layout (y): the tool timeline, the tool offer, the backpack offer. */
const GEAR_Y = { timeline: -110, tool: 28, bag: 146 };
/** The panel's tabs and the content block under them (TabBar): the block's top edge and size, the tabs' size. */
const PANEL_BLOCK = { top: -170, width: 580, height: 432, tabWidth: 170, tabHeight: 48 };
/** The line along the bottom of the upgrade panel, inside the content block. */
const PANEL_FOOTER_Y = 238;
/** BOOSTS tab: one compact row per boost, from FIRST_Y every STEP. */
const BOOST_ROW = { firstY: -110, step: 94, height: 86 };
/** The "open a new mine?" confirmation. */
const NEW_MINE_SIZE = { width: 560, height: 400 };
/** Offer rows: frame left, name + details, buy button right. */
const OFFER = { frameX: -226, textX: -170, textWidth: 290, buttonX: 202, buttonWidth: 130, rowWidth: 556 };
/** How far a panel's title ribbon sticks out above its frame. */
const RIBBON_OVERHANG = 44;
/** Gap between the screen middle (where the miner is) and the top of a panel's ribbon. */
const PANEL_TOP_GAP = 40;
const CLOSE_SIZE = 56;

/** A panel and the holder that places and sizes it (the panel's own scale is left to its pop-in). */
interface PanelSlot {
    holder: PIXI.Container;
    width: number;
    height: number;
    /** Overlays opened from the HUD (achievements) use the whole screen height, centred, not the bottom half. */
    fullScreen?: boolean;
}

/** A kit image sized to fit `size` (keeps aspect). */
function icon(screen: string, id: string, size: number): PIXI.Container {
    const sprite = UiKit.sprite(screen, id);
    sprite.scale.set(size / Math.max(sprite.width, sprite.height));
    return sprite;
}

/** Kit frame for a tool: its rarity's colour once owned, grey until then. */
const TOOL_FRAME: Record<Rarity, string> = { common: 'toolCommon', rare: 'toolRare', epic: 'toolEpic', legendary: 'toolLegendary' };
const toolFrame = (tool: ToolDef, owned: boolean): string => (owned ? TOOL_FRAME[tool.rarity] : 'toolLocked');

/** What a tool does, for its offer. */
function toolDetail(tool: ToolDef): string {
    if (tool.vehicle) return t('toolPowerRide', { power: tool.power, area: tool.area });
    if (tool.area > 1) return t('toolPowerWide', { power: tool.power, area: tool.area });
    return (tool.depth ?? 1) > 1 ? t('toolPowerDeep', { power: tool.power, depth: tool.depth! }) : t('toolPower', { power: tool.power });
}

/** A tool's picture: its atlas icon, or for a vehicle a render of the tractor's model (grey for the Digger). */
function toolArt(tool: ToolDef, size: number): PIXI.Sprite {
    return tool.vehicle ? ModelIcons.sprite(`./dig/models/${DIG.tractor.model}`, size, false, tool.greyscale) : toolIcon(tool.icon, size);
}

function toolIcon(iconId: string, size: number): PIXI.Sprite {
    const sprite = PIXI.Sprite.from(`ToolIcon_${iconId}`);
    sprite.anchor.set(0.5);
    sprite.scale.set(size / Math.max(sprite.texture.width, sprite.texture.height, 1));
    return sprite;
}

export class DigHud extends PIXI.Container {
    private readonly corner = new PIXI.Container();
    private readonly moneyText = UiKit.text('hud', 'money', { money: 0 });
    /** The money pill's icon: where reward coins fly to. */
    private moneyIcon?: PIXI.Container;
    private moneyIconScale = 1;
    private readonly rewardPopup: RewardPopup;
    private readonly backpackText = UiKit.text('hud', 'backpack', { count: 0, capacity: 0 });
    private readonly barFill = new PIXI.Container();
    private readonly toolChip = new PIXI.Container();
    private readonly toast = UiKit.text('hud', 'toast', { text: '' });
    /** The guide's current step (Guide.ts), on a pill near the top; hidden when there's none. */
    private readonly guide = new PIXI.Container();
    private readonly guideText = UiKit.text('hud', 'guide', { text: '' });
    private guideShown: string | null = null;
    /** The guide says an upgrade is affordable: the hand points at its buy button in the ATM panel. */
    private buyHint = false;
    /** The upgrade panel's open tab (BOOSTS once unlocked: DigProgress.boostsUnlocked). */
    private tab: 'gear' | 'boosts' = 'gear';
    /** "Open a new mine?" — asked before the reset (a full-screen confirmation). */
    private readonly newMineConfirm = new PIXI.Container();
    /** panelKey() when the upgrade panel was last built (see refresh()). */
    private renderedPanelKey = '';
    /** "Drag to move" (a brand-new game only; DigScene shows / hides it). */
    public readonly moveHint = new MoveHint();
    private readonly phone = new PIXI.Container();
    /** A rewarded video for the phone is playing (the phone hides until it's over). */
    private phoneBusy = false;
    private readonly panel = new PIXI.Container();
    private readonly panelBody = new PIXI.Container();
    private panelOpen = false;
    private readonly collection = new CollectionPanel();
    private readonly wardrobe: WardrobePanel;
    private readonly achievements: AchievementsPanel;
    private readonly achievementsButton = new PIXI.Container();
    private readonly achievementsAlert = new PIXI.Container();
    /** The mines (MAP button): shown once a second mine exists or can be opened; "!" when one can. */
    private readonly mines: MinesPanel;
    private readonly mapButton = new PIXI.Container();
    private readonly mapAlert = new PIXI.Container();
    /** Bottom-left, big and bouncy: "open your next mine" (only while one can be opened). */
    private readonly newMineCta = new PIXI.Container();
    /** The gear next to mute: opens the settings menu (the language list). */
    private readonly settings = new PIXI.Container();
    private readonly language = new LanguagePanel();
    public readonly findBanner: FindBanner;
    private station: StationKind | null = null;
    private readonly slots: PanelSlot[] = [];
    private lastMoney = -1;
    /** Money and items of a sale still flying to the sell pad: shown as not yet earned / still carried. */
    private heldMoney = 0;
    private heldItems = 0;
    /** The backpack pill (it pulses while full) and its "FULL!" tag. */
    private bagRow!: PIXI.Container;
    private readonly fullTag = new PIXI.Container();
    private bagFull = false;
    /** The first upgrade must be bought: the screen is dimmed, taps are caught, the upgrade panel can't be closed. */
    private forced: ForcedBuy | null = null;
    private readonly blocker = new PIXI.Graphics();
    private readonly forcedTitle = UiKit.text('hud', 'toast', { text: '' });
    /** The panels' close buttons (hidden while a purchase is forced). */
    private readonly closeButtons: PIXI.Container[] = [];
    private readonly onChange = () => this.refresh();

    /**
     * `onBuy` runs after a purchase so the scene can react (swap the tool in hand); `onSell` when the phone
     * is tapped; `onWear` after the wardrobe changes the miner's look.
     */
    public constructor(private readonly onBuy: () => void, private readonly onSell: () => void, onWear: () => void,
        /** The player confirmed opening a new mine (the scene resets and rebuilds it). */
        private readonly onNewMine: () => void,
        /** The player chose another mine to go to (the scene rebuilds it). */
        onTravel: (index: number) => void) {
        super();
        this.buildCorner();
        this.toast.alpha = 0;
        this.buildPanel();
        this.wardrobe = new WardrobePanel(onWear, (text, color) => this.say(text, color));
        this.achievements = new AchievementsPanel((achievement, level, reward, decor, hat) => {
            this.rewardPopup.show(achievement, level, achievement.tiers.length, reward,
                decor && achievement.decor ? t('decorAdded', { decor: names.decor({ id: achievement.id, decor: achievement.decor }) })
                    : hat ? t('hatWaiting', { hat: names.look(hat) }) : undefined);
        });
        this.rewardPopup = new RewardPopup({
            moneyTarget: () => (this.moneyIcon ? this.toLocal(this.moneyIcon.getGlobalPosition()) : new PIXI.Point()),
            hold: (amount) => this.holdSale(amount, 0),
            release: (amount) => this.releaseSale(amount, 0),
            punchMoney: () => {
                if (!this.moneyIcon) return;
                gsap.killTweensOf(this.moneyIcon.scale);
                this.moneyIcon.scale.set(this.moneyIconScale);
                UiAnim.punch(this.moneyIcon, 0.25);
            },
            center: () => {
                const screen = Game.overlayScreenData;
                return screen ? new PIXI.Point(screen.center.x, screen.topLeft.y + screen.height * 0.36) : new PIXI.Point();
            },
        });
        this.findBanner = new FindBanner({
            moneyTarget: () => (this.moneyIcon ? this.toLocal(this.moneyIcon.getGlobalPosition()) : new PIXI.Point()),
            hold: (amount) => this.holdSale(amount, 0),
            release: (amount) => this.releaseSale(amount, 0),
            punchMoney: () => {
                if (!this.moneyIcon) return;
                gsap.killTweensOf(this.moneyIcon.scale);
                this.moneyIcon.scale.set(this.moneyIconScale);
                UiAnim.punch(this.moneyIcon, 0.25);
            },
            onBlocking: () => this.updateBlocker(),
        });
        this.buildAchievementsButton();
        this.mines = new MinesPanel((index) => {
            this.closeStationPanel();
            onTravel(index);
        }, () => this.showNewMineConfirm());
        this.buildMapButton();
        this.guide.addChild(UiKit.image('hud', 'pill', 420, 50), this.guideText);
        this.guide.visible = false;
        this.buildBlocker();
        this.addChild(this.corner, this.toolChip, this.buildPhone(), this.buildNewMineCta(), this.buildMute(), this.buildSettings(), this.guide, this.moveHint, this.blocker, this.forcedTitle,
            this.slot(this.panel, UPGRADE_SIZE),
            this.slot(this.collection, COLLECTION_SIZE),
            this.slot(this.wardrobe, WARDROBE_SIZE),
            this.slot(this.achievements, ACHIEVEMENTS_SIZE, true),
            this.slot(this.language, LANGUAGE_SIZE, true),
            this.slot(this.mines, MINES_SIZE, true),
            this.buildNewMineConfirm(),
            this.findBanner, this.toast, this.rewardPopup);
        DigProgress.onChange.add(this.onChange);
        this.refresh();
        this.reposition();
    }

    /** Wraps a station panel in a holder for placement, and gives it a close button on its top-right corner. */
    private slot(panel: PIXI.Container, size: { width: number; height: number }, fullScreen = false): PIXI.Container {
        const holder = new PIXI.Container();
        holder.addChild(panel);
        const close = new PIXI.Container();
        close.addChild(icon('hud', 'closeButton', CLOSE_SIZE), icon('hud', 'closeIcon', CLOSE_SIZE * 0.5));
        close.position.set(size.width / 2 - 8, -size.height / 2 + 8);
        close.eventMode = 'static';
        close.cursor = 'pointer';
        close.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        close.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            DigAudio.play('close');
            this.closeStationPanel();
        });
        panel.addChild(close);
        this.closeButtons.push(close);
        this.slots.push({ holder, ...size, fullScreen });
        return holder;
    }

    /** The close button: hides the open panel; it stays shut until the miner leaves the pad (setStationPanel). */
    private closeStationPanel(): void {
        if (this.forced) return;
        this.toolChip.visible = true;
        this.achievements.visible = false;
        this.language.visible = false;
        this.mines.visible = false;
        this.setUpgradePanel(false);
        this.updateNewMineCta();
        this.collection.visible = false;
        this.wardrobe.visible = false;
    }

    // ---------------------------------------------------------------- corner

    private pill(iconId: string, label: PIXI.Text, y: number): PIXI.Container {
        const row = new PIXI.Container();
        row.y = y;
        const back = UiKit.image('hud', 'pill', PILL_WIDTH, PILL_HEIGHT);
        back.position.set(ICON_SIZE / 2 + PILL_WIDTH / 2 - 8, 0);
        back.alpha = 0.85;
        const symbol = icon('hud', iconId, ICON_SIZE);
        symbol.position.set(ICON_SIZE / 2, 0);
        if (iconId === 'moneyIcon') {
            this.moneyIcon = symbol;
            this.moneyIconScale = symbol.scale.x;
        }
        label.anchor.set(0, 0.5);
        label.position.set(ICON_SIZE + 8, -2);
        row.addChild(back, symbol, label);
        return row;
    }

    private buildCorner(): void {
        this.corner.addChild(this.pill('moneyIcon', this.moneyText, 0));
        const bag = this.pill('backpackIcon', this.backpackText, 62);
        this.bagRow = bag;
        const bar = new PIXI.Container();
        bar.position.set(BAR_X, -2);
        bar.addChild(UiKit.image('hud', 'barBack', BAR_WIDTH, BAR_HEIGHT));
        bar.addChild(this.barFill);
        bag.addChild(bar);
        // "FULL!" over the fill bar, with the kit's "!" (shown while the backpack is full).
        const fullLabel = UiKit.text('hud', 'toast', { text: t('bagFullTag') }, { fontSize: 20, fill: 0xff7a6a, strokeThickness: 5 });
        UiKit.fit(fullLabel, BAR_WIDTH + 30);
        const alert = icon('hud', 'alert', 30);
        alert.x = -fullLabel.width / 2 - 14;
        this.fullTag.addChild(alert, fullLabel);
        this.fullTag.position.set(BAR_X, -PILL_HEIGHT / 2 - 6);
        this.fullTag.visible = false;
        gsap.to(this.fullTag, { y: this.fullTag.y - 6, duration: 0.4, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        bag.addChild(this.fullTag);
        this.corner.addChild(bag);

    }

    /**
     * The phone (a placeholder for a later upgrade): a pile of cash on its own (no button shape), "SELL x2" under it, the
     * video badge on its corner, a slow rotating shine behind and a gentle pulse. Tapping it asks the scene to play a
     * rewarded video and sell the backpack at double (onSell).
     */
    private buildPhone(): PIXI.Container {
        const shine = PIXI.Sprite.from('Image_Effect_Rotate');
        shine.anchor.set(0.5);
        shine.scale.set(PHONE.shine / Math.max(shine.texture.width, shine.texture.height, 1));
        shine.tint = 0xfff2a0;
        shine.alpha = 0.8;
        shine.eventMode = 'none';
        gsap.to(shine, { rotation: Math.PI * 2, duration: 6, ease: 'none', repeat: -1 });
        const body = new PIXI.Container();
        // A pile of cash (bandit's payout pile) standing on its own, like the achievements and MAP icons: bundles at
        // the back first, the biggest on top.
        const picto = new PIXI.Container();
        picto.y = -14;
        for (const spec of [
            { x: -22, y: 8, size: 62, rotation: -0.35 },
            { x: 22, y: 8, size: 62, rotation: 0.3 },
            { x: 0, y: -12, size: 62, rotation: 0.12 },
            { x: 0, y: 12, size: 86, rotation: -0.05 },
        ]) {
            const bundle = PIXI.Sprite.from('ItemIcon_Money_Bill');
            bundle.anchor.set(0.5);
            bundle.scale.set(spec.size / Math.max(bundle.texture.width, bundle.texture.height, 1));
            bundle.position.set(spec.x, spec.y);
            bundle.rotation = spec.rotation;
            picto.addChild(bundle);
        }
        const label = UiKit.fit(UiKit.text('hud', 'toast', { text: t('phoneSell') }, { fontSize: 24, fill: 0x9cff9c, strokeThickness: 6 }), PHONE.width);
        label.y = PHONE.height / 2 - 12;
        const video = PIXI.Sprite.from('ItemIcon_Video');
        video.anchor.set(0.5);
        video.scale.set(40 / Math.max(video.texture.width, video.texture.height, 1));
        video.position.set(PHONE.width / 2 - 10, -PHONE.height / 2 + 14);
        body.addChild(picto, label, video);
        UiAnim.pulse(body, 0.06, 0.55);
        this.phone.addChild(shine, body);
        this.phone.visible = false;
        this.phone.eventMode = 'static';
        this.phone.cursor = 'pointer';
        this.phone.hitArea = new PIXI.Rectangle(-PHONE.width / 2, -PHONE.height / 2, PHONE.width, PHONE.height);
        // Taps on HUD buttons must not also start the movement joystick underneath.
        this.phone.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.phone.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            DigAudio.play('click');
            this.onSell();
        });
        return this.phone;
    }

    /** The phone shows while the backpack is full, once PHONE_TOOL_LEVEL tool upgrades are owned — and nothing else is up. */
    private updatePhone(): void {
        const show = DigProgress.backpackCount >= DigProgress.capacity && DigProgress.toolLevel >= PHONE_TOOL_LEVEL
            && !this.phoneBusy && this.forced === null && this.station === null && !this.achievements.visible && !this.language.visible;
        if (show === this.phone.visible) return;
        this.phone.visible = show;
        if (!show) return;
        UiAnim.popIn(this.phone);
        GameAnalytics.phoneShown();
    }

    /** A rewarded video for the phone started / ended (the phone stays hidden meanwhile). */
    public setPhoneBusy(busy: boolean): void {
        this.phoneBusy = busy;
        this.updatePhone();
        this.updateNewMineCta();
    }

    /** The memo pad under the pills (no button shape: the icon reads on its own); the pizza game's "!" bobs on it while a tier is ready to claim. */
    private buildAchievementsButton(): void {
        this.achievementsButton.position.set(CORNER_WIDTH - ACHIEVEMENTS_BUTTON / 2, 150);
        this.achievementsButton.addChild(icon('hud', 'achievementsIcon', ACHIEVEMENTS_BUTTON));
        // The icon alone is the button: an invisible square keeps the whole of it tappable.
        this.achievementsButton.hitArea = new PIXI.Rectangle(-ACHIEVEMENTS_BUTTON / 2, -ACHIEVEMENTS_BUTTON / 2, ACHIEVEMENTS_BUTTON, ACHIEVEMENTS_BUTTON);
        const alert = icon('hud', 'alert', 36);
        this.achievementsAlert.addChild(alert);
        this.achievementsAlert.position.set(ACHIEVEMENTS_BUTTON / 2 - 8, -ACHIEVEMENTS_BUTTON / 2 + 10);
        gsap.to(alert, { y: -8, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        this.achievementsButton.addChild(this.achievementsAlert);
        this.achievementsButton.eventMode = 'static';
        this.achievementsButton.cursor = 'pointer';
        this.achievementsButton.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.achievementsButton.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            UiAnim.punch(this.achievementsButton, 0.12);
            this.toggleAchievements();
        });
        this.corner.addChild(this.achievementsButton);
    }

    /** The MAP button under the achievements, drawn like it (the kit's map icon alone, no button shape); "!" when a new mine can be opened. */
    private buildMapButton(): void {
        this.mapButton.position.set(CORNER_WIDTH - ACHIEVEMENTS_BUTTON / 2, 150 + ACHIEVEMENTS_BUTTON + 8);
        const map = PIXI.Sprite.from('ItemIcon_Map');
        map.anchor.set(0.5);
        map.scale.set(ACHIEVEMENTS_BUTTON / Math.max(map.texture.width, map.texture.height, 1));
        this.mapButton.addChild(map);
        // The icon alone is the button: an invisible square keeps the whole of it tappable.
        this.mapButton.hitArea = new PIXI.Rectangle(-ACHIEVEMENTS_BUTTON / 2, -ACHIEVEMENTS_BUTTON / 2, ACHIEVEMENTS_BUTTON, ACHIEVEMENTS_BUTTON);
        const alert = icon('hud', 'alert', 36);
        this.mapAlert.addChild(alert);
        this.mapAlert.position.set(ACHIEVEMENTS_BUTTON / 2 - 8, -ACHIEVEMENTS_BUTTON / 2 + 10);
        gsap.to(alert, { y: -8, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        this.mapButton.addChild(this.mapAlert);
        this.mapButton.visible = false;
        this.mapButton.eventMode = 'static';
        this.mapButton.cursor = 'pointer';
        this.mapButton.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.mapButton.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            UiAnim.punch(this.mapButton, 0.12);
            this.toggleOverlay(this.mines, () => this.mines.refresh());
        });
        this.corner.addChild(this.mapButton);
    }

    /**
     * The NEW MINE call to action, bottom-left: the kit's gem pack bouncing (jump, squash on landing, a wiggle), purple
     * rays turning behind it, a bobbing "!" and a pulsing "NEW MINE!" — hard to ignore. Opens the confirmation.
     */
    private buildNewMineCta(): PIXI.Container {
        const cta = this.newMineCta;
        UiAnim.rays(cta, NEW_MINE_CTA.rays, 0xd38bff, 0.95, 6);
        const jumper = new PIXI.Container();
        const gems = PIXI.Sprite.from('ShopItem_s_GemPack_1');
        gems.anchor.set(0.5, 1);
        gems.scale.set(NEW_MINE_CTA.icon / Math.max(gems.texture.width, gems.texture.height, 1));
        gems.y = gems.height / 2;
        jumper.addChild(gems);
        const alert = icon('hud', 'alert', 40);
        alert.position.set(NEW_MINE_CTA.icon / 2 - 6, -NEW_MINE_CTA.icon / 2 + 6);
        gsap.to(alert, { y: alert.y - 8, duration: 0.4, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        jumper.addChild(alert);
        const label = UiKit.fit(UiKit.text('hud', 'toast', { text: t('newMineCta') }, { fontSize: 28, fill: 0xffe27a, strokeThickness: 7 }), NEW_MINE_CTA.label);
        label.y = NEW_MINE_CTA.icon / 2 + 26;
        UiAnim.pulse(label, 0.08, 0.45);
        cta.addChild(jumper, label);
        // Jump, land with a squash, a little wiggle, a rest — and again.
        const hop = gsap.timeline({ repeat: -1, repeatDelay: 0.5 });
        hop.to(jumper, { y: -30, duration: 0.26, ease: 'power2.out' })
            .to(jumper, { y: 0, duration: 0.24, ease: 'power2.in' })
            .to(jumper.scale, { x: 1.18, y: 0.82, duration: 0.07, ease: 'power1.out', yoyo: true, repeat: 1 })
            .to(jumper, { rotation: 0.14, duration: 0.07, ease: 'sine.inOut', yoyo: true, repeat: 3 }, '+=0.05');
        cta.visible = false;
        cta.eventMode = 'static';
        cta.cursor = 'pointer';
        cta.hitArea = new PIXI.Circle(0, 0, NEW_MINE_CTA.icon * 0.7);
        cta.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        cta.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            UiAnim.punch(jumper, 0.2);
            this.showNewMineConfirm();
        });
        return cta;
    }

    /** The NEW MINE button shows while a new mine can be opened and nothing else is up. */
    private updateNewMineCta(): void {
        const show = DigProgress.canOpenNewMine && this.forced === null && this.station === null && !this.achievements.visible
            && !this.language.visible && !this.mines.visible && !this.newMineConfirm.visible;
        if (show === this.newMineCta.visible) return;
        this.newMineCta.visible = show;
        if (show) UiAnim.popIn(this.newMineCta);
    }

    /** Opens/closes the achievements (centred over the game, like the language list). */
    private toggleAchievements(): void {
        this.toggleOverlay(this.achievements, () => this.achievements.refresh());
    }

    /** Opens an overlay panel opened from the HUD (closing whatever else is open), or closes it if it's showing. */
    private toggleOverlay(panel: PIXI.Container, refresh: () => void): void {
        if (this.forced) return;
        if (panel.visible) {
            this.closeStationPanel();
            return;
        }
        this.closeStationPanel();
        this.toolChip.visible = false;
        // Achievements and settings stop play (the platform's gameplayStop); moving again restarts it (DigScene).
        Gameplay.stop();
        refresh();
        panel.visible = true;
        this.updateNewMineCta();
        UiAnim.popIn(panel);
        DigAudio.play('open');
    }

    /** Shows the language list (the HUD was just rebuilt for a new language: keep it open). */
    public openLanguage(): void {
        if (!this.language.visible) this.toggleOverlay(this.language, () => this.language.refresh());
    }

    /** The gear on the round dark button (same as mute), left of it. */
    private buildSettings(): PIXI.Container {
        this.settings.addChild(icon('hud', 'muteButton', MUTE_SIZE), icon('hud', 'settingsIcon', MUTE_SIZE * 0.55));
        this.settings.eventMode = 'static';
        this.settings.cursor = 'pointer';
        this.settings.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.settings.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            UiAnim.punch(this.settings, 0.12);
            DigAudio.play('toggle');
            this.toggleOverlay(this.language, () => this.language.refresh());
        });
        return this.settings;
    }

    /** Top-right mute toggle (core's SoundToggleButton on the kit's round dark button), like the other games. */
    private readonly mute = new PIXI.Container();

    private buildMute(): PIXI.Container {
        const icons = new SoundToggleButton(UiKit.imageName('hud', 'muteOn'), UiKit.imageName('hud', 'muteOff'));
        icons.scale.set((MUTE_SIZE * 0.55) / 128);
        this.mute.addChild(icon('hud', 'muteButton', MUTE_SIZE), icons);
        this.mute.eventMode = 'static';
        this.mute.cursor = 'pointer';
        // The icons handle the toggle; the button around them must not start the joystick either.
        this.mute.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.mute.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            if (event.target !== icons) icons.emit('pointertap', event);
            UiAnim.punch(this.mute, 0.12);
            DigAudio.play('toggle');
        });
        return this.mute;
    }

    /**
     * A sale just happened (already in DigProgress): keep showing the money as unearned and the items
     * as carried until releaseSale() hands them over piece by piece, as the items land on the pad.
     */
    public holdSale(money: number, items: number): void {
        this.heldMoney += money;
        this.heldItems += items;
        this.refresh();
    }

    public releaseSale(money: number, items: number): void {
        this.heldMoney = Math.max(0, this.heldMoney - money);
        this.heldItems = Math.max(0, this.heldItems - items);
        this.refresh();
    }

    /** "SOLD! +$X", counting up over the sale. */
    public saySold(earned: number, duration: number): void {
        this.say(t('sold', { amount: 0 }), 0x9cff9c);
        gsap.killTweensOf(this.toast);
        UiAnim.countUp(this.toast, 0, earned, (value) => t('sold', { amount: value }), duration);
        gsap.to(this.toast, { alpha: 0, duration: 0.5, delay: duration + 1.2 });
    }

    private refresh(): void {
        const money = DigProgress.money - this.heldMoney;
        this.moneyText.text = `$${money}`;
        if (this.lastMoney >= 0 && money > this.lastMoney) {
            // A sale punches many times in a row: restart from rest so the scale never drifts.
            gsap.killTweensOf(this.moneyText.scale);
            this.moneyText.scale.set(1);
            UiAnim.punch(this.moneyText as unknown as PIXI.Container, 0.25);
        }
        this.lastMoney = money;

        const count = DigProgress.backpackCount + this.heldItems;
        const capacity = DigProgress.capacity;
        const full = count >= capacity;
        // Only worth showing with something to sell (and not while a sale is still flying).
        this.setBagFull(DigProgress.backpackCount >= capacity);
        this.updatePhone();
        this.updateNewMineCta();
        this.backpackText.text = `${count}/${capacity}`;
        // Shrinks to the gap before the fill bar ("100/200" would run into it).
        UiKit.fit(this.backpackText, BAR_X - BAR_WIDTH / 2 - (ICON_SIZE + 8) - 6);
        this.backpackText.style.fill = full ? 0xff7a6a : 0xffffff;
        this.barFill.removeChildren().forEach((child) => child.destroy({ children: true }));
        const fraction = Math.min(1, count / Math.max(1, capacity));
        if (fraction > 0) {
            const inner = BAR_WIDTH - 4;
            const width = Math.max(BAR_HEIGHT - 4, inner * fraction);
            const fill = UiKit.image('hud', full ? 'barFull' : 'barFill', width, BAR_HEIGHT - 4);
            fill.x = -inner / 2 + width / 2;
            this.barFill.addChild(fill);
        }

        this.toolChip.removeChildren().forEach((child) => child.destroy({ children: true }));
        const tool = DigProgress.tool;
        const name = UiKit.text('hud', 'toolName', { name: names.tool(tool).toUpperCase() });
        name.y = TOOL_SIZE / 2 + 12;
        // Bottom-right: the tool in its frame, its name on a pill under it (shrunk to fit, never cut).
        const pill = UiKit.image('hud', 'pill', TOOL_PILL_WIDTH, 34);
        pill.y = TOOL_SIZE / 2 + 26;
        pill.alpha = 0.9;
        name.y = TOOL_SIZE / 2 + 24;
        UiKit.fit(name, TOOL_PILL_WIDTH - 16);
        this.toolChip.addChild(UiKit.image('upgrades', toolFrame(tool, true), TOOL_SIZE, TOOL_SIZE), toolArt(tool, TOOL_SIZE * 0.72), pill, name);

        // Rebuilt only when what they show changes — not on every coin of a sale landing, which used to
        // recreate the buy buttons mid-tap (flicker, taps lost).
        if (this.panelOpen && this.panelKey() !== this.renderedPanelKey) {
            this.renderPanel();
        }
        if (this.station === 'wardrobe' && this.heldMoney === 0) {
            this.wardrobe.refresh();
        }
        this.achievementsAlert.visible = DigProgress.claimableAchievements > 0;
        this.mapButton.visible = DigProgress.prestige > 0 || DigProgress.canOpenNewMine;
        this.mapAlert.visible = DigProgress.canOpenNewMine;
        if (this.mines.visible && this.heldMoney === 0) this.mines.refresh();
        // Not while money is still landing (a sale, a reward): rebuilding the panel on every coin is wasted work and
        // kills its tweens mid-flight. It catches up when the last coin lands (heldMoney back to 0).
        if (this.achievements.visible && this.heldMoney === 0) {
            this.achievements.refresh();
        }
    }

    /** The backpack just filled up / was emptied: the "FULL!" tag, and the pill and SELL button pulse while full. */
    private setBagFull(full: boolean): void {
        if (full === this.bagFull) return;
        this.bagFull = full;
        this.fullTag.visible = full;
        gsap.killTweensOf(this.bagRow.scale);
        this.bagRow.scale.set(1);
        if (full) UiAnim.pulse(this.bagRow, 0.08, 0.45);
    }

    /** Draws attention to the backpack (the miner tried to dig with it full). */
    public flashBackpack(): void {
        UiAnim.shake(this.bagRow, 8, 0.35);
    }

    /** A dim layer over the game that catches every tap while a purchase is forced (drawn in reposition()). */
    private buildBlocker(): void {
        this.blocker.eventMode = 'static';
        this.blocker.visible = false;
        this.blocker.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.blocker.on('pointertap', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.forcedTitle.visible = false;
    }

    /** The dim layer is up while a purchase is forced or the first find's banner waits for its CLAIM. */
    private updateBlocker(): void {
        const on = this.forced !== null || (this.findBanner?.blocking ?? false) || this.newMineConfirm.visible;
        if (on && !this.blocker.visible) gsap.fromTo(this.blocker, { alpha: 0 }, { alpha: 1, duration: 0.3 });
        this.blocker.visible = on;
    }

    /**
     * A tutorial purchase is forced (the scene decides which and when; null = none): dims the game, opens the upgrade
     * panel (the bag, the tool) or the wardrobe (the hat) with the hand on it and no way to close it, and shuts the
     * other menus. Off again once bought, leaving open whatever the miner stands on.
     */
    public setForced(kind: ForcedBuy | null): void {
        if (kind === this.forced) return;
        const was = this.forced;
        this.forced = kind;
        this.updateBlocker();
        this.forcedTitle.visible = kind !== null;
        this.closeButtons.forEach((close) => (close.visible = kind === null));
        if (kind) {
            this.achievements.visible = false;
            this.language.visible = false;
            this.mines.visible = false;
            this.collection.visible = false;
            this.toolChip.visible = false;
            this.forcedTitle.text = t(kind === 'hat' ? 'firstHatTitle' : kind === 'backpack' ? 'firstBagTitle' : 'firstUpgradeTitle');
            this.forcedTitle.scale.set(1);
            UiKit.fit(this.forcedTitle, GUIDE_WIDTH + 120);
            UiAnim.punch(this.forcedTitle, 0.2);
            DigAudio.play('quest');
        }
        // Re-rendered so the hand shows (or goes); opened if it wasn't, closed unless the miner is on the ATM pad.
        if (this.panelOpen) this.renderPanel();
        this.setUpgradePanel(kind === 'backpack' || kind === 'tool' || (kind === null && this.station === 'atm'));
        this.wardrobe.setForcedItem(kind === 'hat' ? DigProgress.starterHat?.id : undefined);
        const wardrobe = kind === 'hat' || (kind === null && this.station === 'wardrobe');
        if (wardrobe && !this.wardrobe.visible) UiAnim.popIn(this.wardrobe);
        this.wardrobe.visible = wardrobe;
        if (!kind) this.toolChip.visible = this.station === null && !this.achievements.visible && !this.language.visible;
        this.updatePhone();
        this.updateNewMineCta();
    }

    /** Opens the panel of the station the miner stands on (null = none): ATM upgrades, collection, wardrobe. */
    public setStationPanel(kind: StationKind | null): void {
        if (kind === this.station) return;
        this.station = kind;
        // While a purchase is forced only its panel shows (setForced).
        if (this.forced) return;
        // The open panel fills the bottom of the screen, where the tool chip sits.
        this.toolChip.visible = kind === null && !this.achievements.visible && !this.language.visible;
        if (kind !== null) {
            this.achievements.visible = false;
            this.language.visible = false;
            this.mines.visible = false;
        }
        this.setUpgradePanel(kind === 'atm');
        this.updatePhone();
        this.updateNewMineCta();
        this.collection.visible = kind === 'collection';
        this.wardrobe.visible = kind === 'wardrobe';
        if (kind === 'collection') {
            this.collection.refresh(DigProgress.unseenFinds);
            DigProgress.markFindsSeen();
            UiAnim.popIn(this.collection);
            DigAudio.play('open');
        } else if (kind === 'wardrobe') {
            this.wardrobe.refresh();
            DigProgress.markWardrobeSeen();
            UiAnim.popIn(this.wardrobe);
            DigAudio.play('open');
        }
    }

    /** The guide's line (null hides it); pops in when it changes so the new step gets noticed. */
    public setGuide(text: string | null, buy = false): void {
        if (buy !== this.buyHint) {
            this.buyHint = buy;
            if (this.panelOpen) this.renderPanel();
        }
        if (text === this.guideShown) return;
        // A new step (not the first one, nor the guide finishing): a soft "quest" chime.
        if (text !== null && this.guideShown !== null) DigAudio.play('quest');
        this.guideShown = text;
        // The steps aren't shown as text any more: the floor arrows lead the way (the text is kept for debugging).
        this.guide.visible = false;
        if (text === null) return;
        this.guideText.text = text;
        // Wraps (long translations), on a fresh pill sized to the text (stretching the old one would stretch its corners).
        this.guideText.style.wordWrap = true;
        this.guideText.style.breakWords = true;
        this.guideText.style.wordWrapWidth = GUIDE_WIDTH;
        this.guideText.style.align = 'center';
        this.guide.removeChildAt(0).destroy({ children: true });
        this.guide.addChildAt(UiKit.image('hud', 'pill', Math.max(260, this.guideText.width + 60), this.guideText.height + 22), 0);
        UiAnim.punch(this.guide, 0.12);
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
        gsap.to(this.toast, { alpha: 0, duration: 0.5, delay: 1.6 });
    }

    // ---------------------------------------------------------------- upgrade panel

    private buildPanel(): void {
        const frame = UiKit.image('upgrades', 'panel', UPGRADE_SIZE.width, UPGRADE_SIZE.height);
        const ribbon = UiKit.sprite('upgrades', 'ribbon', 0.55);
        ribbon.y = -UPGRADE_SIZE.height / 2;
        const title = UiKit.text('upgrades', 'title');
        title.y = -UPGRADE_SIZE.height / 2 - 5;
        this.panel.addChild(frame, ribbon, title, this.panelBody);
        this.panel.visible = false;
    }

    /** Opens/closes the upgrade panel (the scene calls this as the miner steps on/off the pad). */
    public setUpgradePanel(open: boolean): void {
        if (open === this.panelOpen) return;
        this.panelOpen = open;
        this.panel.visible = open;
        if (open) {
            this.renderPanel();
            UiAnim.popIn(this.panel);
            DigAudio.play('open');
        }
    }

    /**
     * The tool path as a timeline (shovel ... tractor, owned / next / later), the next tool's offer under it,
     * the backpack, and a line on where the path ends.
     */
    /** What the upgrade panel shows, as a key: levels, what's affordable, the guide's hand. */
    private panelKey(): string {
        const money = DigProgress.money;
        const tool = DigProgress.nextTool;
        const bag = DigProgress.nextBackpack;
        const boosts = DIG.boosts.map((b) => `${DigProgress.boostLevel(b.id)}${money >= (DigProgress.boostPrice(b) ?? Infinity) ? '+' : ''}`);
        return [DigProgress.toolLevel, DigProgress.capacity, !!tool && money >= tool.price, !!bag && money >= bag.price, this.buyHint, this.forced,
            this.tab, DigProgress.boostsUnlocked, DigProgress.prestige, ...boosts].join('|');
    }

    private renderPanel(): void {
        this.renderedPanelKey = this.panelKey();
        // The buy buttons pulse: stop that before destroying them (see AchievementsPanel.refresh()).
        UiAnim.kill(this.panelBody);
        this.panelBody.removeChildren().forEach((child) => child.destroy({ children: true }));
        // A forced purchase is always on GEAR; BOOSTS only once unlocked.
        if (this.forced || !DigProgress.boostsUnlocked) this.tab = 'gear';
        this.panelBody.addChild(this.panelTabs());
        if (this.tab === 'boosts') {
            this.renderBoosts();
            return;
        }
        const tool = DigProgress.nextTool;
        const bag = DigProgress.nextBackpack;
        // The last tool owned: the tool row offers a new mine instead.
        this.panelBody.addChild(tool ? this.offer(
            GEAR_Y.tool,
            toolArt(tool, 64),
            names.tool(tool).toUpperCase(),
            toolDetail(tool),
            tool.price,
            () => {
                if (!DigProgress.buyTool()) return false;
                GameAnalytics.toolBought(DigProgress.toolLevel, DigProgress.tool.id);
                return true;
            },
            { frame: toolFrame(tool, false), rarity: tool.rarity, disabled: this.forced === 'backpack' },
        ) : this.offer(
            GEAR_Y.tool,
            toolArt(DigProgress.tool, 64),
            names.tool(DigProgress.tool).toUpperCase(),
            DigProgress.canOpenNewMine ? t('maxedOpenMine') : t('tractorOwnedInfo'),
            undefined,
            () => false,
            { frame: toolFrame(DigProgress.tool, true), rarity: DigProgress.tool.rarity },
        ));
        const bagRow = this.offer(
            GEAR_Y.bag,
            icon('hud', 'backpackIcon', 64),
            bag ? t('backpackSize', { capacity: bag.capacity }) : t('biggestBackpack'),
            bag ? t('backpackHolds', { capacity: bag.capacity }) : t('nothingLeft'),
            bag?.price,
            () => {
                if (!DigProgress.buyBackpack()) return false;
                GameAnalytics.backpackBought(DigProgress.backpackLevel, DigProgress.capacity);
                return true;
            },
            { disabled: this.forced === 'tool' },
        );
        bagRow.addChild(this.backpackLevels());
        this.panelBody.addChild(bagRow);
        // After the offer rows, so its labels (the goal's price) draw over the tool row's top edge, not under it.
        this.panelBody.addChild(this.timeline(GEAR_Y.timeline));
        // Guide: the hand on the buy button of the upgrade the money covers (the tool first).
        if (this.buyHint || this.forced) {
            const money = DigProgress.money;
            const row = this.forced === 'backpack' ? GEAR_Y.bag : this.forced === 'tool' ? GEAR_Y.tool
                : tool && money >= tool.price ? GEAR_Y.tool : bag && money >= bag.price ? GEAR_Y.bag : undefined;
            if (row !== undefined) this.panelBody.addChild(this.pointingHand(OFFER.buttonX, row));
        }
        const goal = DIG.tools[DIG.tools.length - 1];
        this.panelFooter(!DigProgress.nextTool ? t('tractorRiding') : t('tractorGoal', { tool: names.tool(goal).toUpperCase(), area: goal.area, speed: DIG.tractor.speedMultiplier }));
    }

    /** A line along the bottom of the upgrade panel. */
    private panelFooter(text: string): void {
        const footer = UiKit.text('upgrades', 'itemInfo', { text });
        footer.anchor.set(0.5);
        footer.y = PANEL_FOOTER_Y;
        UiKit.fit(footer, PANEL_BLOCK.width - 30);
        this.panelBody.addChild(footer);
    }

    /**
     * The tabs over the content block (TabBar): GEAR, and BOOSTS once unlocked (not while a purchase is forced —
     * that stays on GEAR).
     */
    private panelTabs(): PIXI.Container {
        const tabs: TabSpec[] = [{ id: 'gear', label: t('tabGear') }];
        if (DigProgress.boostsUnlocked && !this.forced) tabs.push({ id: 'boosts', label: t('tabBoosts'), alert: DigProgress.canAffordBoost });
        const block = tabbedBlock({
            width: PANEL_BLOCK.width,
            height: PANEL_BLOCK.height,
            tabWidth: PANEL_BLOCK.tabWidth,
            tabHeight: PANEL_BLOCK.tabHeight,
            tabs,
            active: this.tab,
            onSelect: (id) => {
                this.tab = id as 'gear' | 'boosts';
                DigAudio.play('tab');
                this.renderPanel();
            },
        });
        block.y = PANEL_BLOCK.top;
        return block;
    }

    /** The BOOSTS tab: a row per boost track, and the new mines' bonus (or what boosts are) along the bottom. */
    private renderBoosts(): void {
        DIG.boosts.forEach((boost, i) => this.panelBody.addChild(this.boostRow(boost, BOOST_ROW.firstY + i * BOOST_ROW.step)));
        const mines = DigProgress.prestige;
        this.panelFooter(mines > 0
            ? t('mineBonus', { mine: mines + 1, sell: Math.round(DIG.prestige.sellBonus * mines * 100), dig: Math.round(DIG.prestige.digBonus * mines * 100) })
            : t('boostsHint'));
    }

    /** One boost: its icon, name and level, its effect now -> next, and the buy button (MAX at the top). */
    private boostRow(boost: BoostDef, y: number): PIXI.Container {
        const row = new PIXI.Container();
        row.y = y;
        row.addChild(UiKit.image('upgrades', 'rowBack', OFFER.rowWidth, BOOST_ROW.height));
        const frame = UiKit.image('upgrades', 'itemFrame', 70, 70);
        frame.x = OFFER.frameX;
        const art = PIXI.Sprite.from(boost.icon);
        art.anchor.set(0.5);
        art.scale.set(50 / Math.max(art.texture.width, art.texture.height, 1));
        art.x = OFFER.frameX;
        const level = DigProgress.boostLevel(boost.id);
        const name = UiKit.fit(UiKit.text('upgrades', 'itemName', {
            name: t(`boost_${boost.id}` as StringId).toUpperCase(),
        }), OFFER.textWidth);
        name.anchor.set(0, 0.5);
        name.position.set(OFFER.textX, -12);
        const percent = (value: number) => `+${Math.round(value * 100)}%`;
        const now = percent(DigProgress.boostEffect(boost));
        const price = DigProgress.boostPrice(boost);
        const info = UiKit.fit(UiKit.text('upgrades', 'itemInfo', {
            text: `${t('boostLevel', { level, max: boost.maxLevel })}  ·  ${price === undefined ? now : `${now}  →  ${percent(DigProgress.boostEffect(boost, level + 1))}`}`,
        }), OFFER.textWidth);
        info.anchor.set(0, 0.5);
        info.position.set(OFFER.textX, 16);
        row.addChild(frame, art, name, info);

        const button = new PIXI.Container();
        button.position.set(OFFER.buttonX, 0);
        row.addChild(button);
        if (price === undefined) {
            button.addChild(UiKit.image('upgrades', 'lockedButton', OFFER.buttonWidth, 60), UiKit.text('upgrades', 'maxLabel'));
            return row;
        }
        const affordable = DigProgress.money >= price;
        button.addChild(UiKit.image('upgrades', affordable ? 'buyButton' : 'lockedButton', OFFER.buttonWidth, 60),
            UiKit.fit(UiKit.text('upgrades', 'buyLabel', { price: price.toLocaleString('en-US') }), OFFER.buttonWidth - 20));
        button.eventMode = 'static';
        button.cursor = 'pointer';
        if (affordable) UiAnim.pulse(button, 0.05, 0.6);
        button.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            if (DigProgress.buyBoost(boost)) {
                GameAnalytics.boostBought(boost.id, DigProgress.boostLevel(boost.id));
                this.say(t('upgraded'), 0x9cff9c);
                DigAudio.play('buyCash');
                DigAudio.play('buyShine');
                this.onBuy();
            } else {
                this.say(t('notEnoughCash'), 0xff8a7a);
                DigAudio.play('error');
                UiAnim.shake(button, 8, 0.35);
            }
        });
        return row;
    }

    /** "Open a new mine?": what resets, what stays, the bonus — YES / NO. Built once, shown by showNewMineConfirm(). */
    private buildNewMineConfirm(): PIXI.Container {
        this.newMineConfirm.visible = false;
        return this.newMineConfirm;
    }

    private showNewMineConfirm(): void {
        const box = this.newMineConfirm;
        UiAnim.kill(box);
        box.removeChildren().forEach((child) => child.destroy({ children: true }));
        const { width, height } = NEW_MINE_SIZE;
        const frame = UiKit.image('upgrades', 'panel', width, height);
        frame.eventMode = 'static';
        frame.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        const ribbon = UiKit.sprite('upgrades', 'ribbonPurple', 0.55);
        ribbon.y = -height / 2;
        const next = DigProgress.prestige + 1;
        const title = UiKit.fit(UiKit.text('upgrades', 'title', {}, {}), 260);
        title.text = t('newMineTitle', { mine: next + 1 });
        UiKit.fit(title, 260);
        title.y = -height / 2 - 5;
        box.addChild(frame, ribbon, title);
        const lines: [string, number][] = [
            [t('newMineBonus', { sell: Math.round(DIG.prestige.sellBonus * next * 100), dig: Math.round(DIG.prestige.digBonus * next * 100) }), 0x9cff9c],
            [t('newMineResets'), 0xff9a8a],
            [t('newMineKeeps'), 0xffffff],
        ];
        lines.forEach(([text, color], i) => {
            const line = UiKit.text('upgrades', 'itemInfo', { text }, { fill: color, wordWrap: true, wordWrapWidth: width - 80, align: 'center' });
            line.anchor.set(0.5);
            line.y = -95 + i * 62;
            box.addChild(line);
        });
        const button = (label: string, image: string, x: number, onTap: () => void) => {
            const b = new PIXI.Container();
            b.position.set(x, height / 2 - 70);
            b.addChild(UiKit.image('upgrades', image, 190, 64), UiKit.fit(UiKit.text('upgrades', 'buyLabel', { price: '' }, {}), 170));
            (b.getChildAt(1) as PIXI.Text).text = label;
            UiKit.fit(b.getChildAt(1) as PIXI.Text, 170);
            b.eventMode = 'static';
            b.cursor = 'pointer';
            b.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
            b.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
                event.stopPropagation();
                onTap();
            });
            box.addChild(b);
            return b;
        };
        UiAnim.pulse(button(t('newMineGo'), 'buyButton', 110, () => {
            this.hideNewMineConfirm();
            this.closeStationPanel();
            DigAudio.play('buyFanfare');
            this.onNewMine();
        }), 0.05, 0.6);
        button(t('cancel'), 'lockedButton', -110, () => {
            DigAudio.play('close');
            this.hideNewMineConfirm();
        });
        box.visible = true;
        this.updateBlocker();
        this.updateNewMineCta();
        UiAnim.popIn(box);
        DigAudio.play('open');
        GameAnalytics.newMineOffered();
    }

    private hideNewMineConfirm(): void {
        this.newMineConfirm.visible = false;
        this.updateBlocker();
        this.updateNewMineCta();
    }

    /** Every tool on a line: owned ones lit with a check, the next one pulsing, the rest dimmed with their price; the last (the tractor) bigger. */
    private timeline(y: number): PIXI.Container {
        const row = new PIXI.Container();
        row.y = y;
        const owned = DigProgress.toolLevel;
        const count = DIG.tools.length;
        const step = TIMELINE_WIDTH / (count - 1);
        const x = (i: number) => -TIMELINE_WIDTH / 2 + i * step;
        const line = new PIXI.Graphics();
        line.lineStyle(6, LINE_TODO).moveTo(x(0), 0).lineTo(x(count - 1), 0);
        line.lineStyle(6, LINE_DONE).moveTo(x(0), 0).lineTo(x(owned), 0);
        row.addChild(line);
        DIG.tools.forEach((tool, i) => {
            const goal = i === count - 1;
            const size = goal ? GOAL_SIZE : NODE_SIZE;
            const node = new PIXI.Container();
            node.x = x(i);
            node.addChild(UiKit.image('upgrades', toolFrame(tool, i <= owned), size, size), toolArt(tool, size * 0.72));
            const label = UiKit.text('upgrades', 'nodeLabel', {
                text: i < owned ? '' : i === owned ? t('now') : goal ? t('goalPrice', { price: tool.price.toLocaleString('en-US') }) : `$${tool.price.toLocaleString('en-US')}`,
            });
            label.anchor.set(0.5, 0);
            label.y = size / 2 + 4;
            UiKit.fit(label, step + 6);
            if (i < owned) {
                const check = icon('hud', 'check', 26);
                check.y = size / 2 + 16;
                node.addChild(check);
            }
            if (i === owned) label.style.fill = RARITY_COLORS[tool.rarity];
            else if (goal) label.style.fill = RARITY_COLORS.legendary;
            else if (i === owned + 1) label.style.fill = 0xffd86b;
            node.addChild(label);
            if (i > owned) node.alpha = i === owned + 1 || goal ? 1 : 0.6;
            if (i === owned + 1) UiAnim.pulse(node, 0.08, 0.7);
            row.addChild(node);
        });
        return row;
    }

    /**
     * The backpack's upgrade path as a little segmented bar under its offer: one segment per upgrade, owned ones
     * green, the next one gold and pulsing, the rest grey.
     */
    private backpackLevels(): PIXI.Container {
        const bar = new PIXI.Container();
        bar.position.set(OFFER.textX, 38);
        const count = DIG.backpack.length - 1;
        const owned = DigProgress.backpackLevel;
        const gap = 3;
        const width = (BAG_BAR.width - gap * (count - 1)) / count;
        for (let i = 0; i < count; i++) {
            const color = i < owned ? LINE_DONE : i === owned ? 0xffd86b : LINE_TODO;
            const segment = new PIXI.Graphics().beginFill(color).drawRoundedRect(-width / 2, -BAG_BAR.height / 2, width, BAG_BAR.height, 3).endFill();
            segment.x = width / 2 + i * (width + gap);
            if (i === owned) UiAnim.pulse(segment, 0.25, 0.5);
            bar.addChild(segment);
        }
        return bar;
    }

    /** The handHud pointing hand, fingertip on (x, y) and tapping at it (same art as the move hint). */
    private pointingHand(x: number, y: number): PIXI.Container {
        const holder = new PIXI.Container();
        holder.eventMode = 'none';
        holder.position.set(x, y);
        const hand = PIXI.Sprite.from('handHud');
        hand.width = hand.height = 72;
        // The fingertip sits ~(0.22, 0.16) into the art: place that on the button, a little below-right of its centre.
        hand.position.set(10 - 72 * 0.22, 8 - 72 * 0.16);
        holder.addChild(hand);
        gsap.to(holder, { y: y + 10, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        return holder;
    }

    /**
     * `look.frame` swaps the icon frame (a tool's rarity / grey); `look.rarity` names it in its colour after the title;
     * `look.disabled` dims the row and leaves its button dead (the other offer while a purchase is forced).
     */
    private offer(y: number, symbol: PIXI.Container, title: string, detail: string, price: number | undefined, buy: () => boolean,
        look: { frame?: string; rarity?: Rarity; disabled?: boolean } = {}): PIXI.Container {
        const row = new PIXI.Container();
        row.y = y;
        row.addChild(UiKit.image('upgrades', 'rowBack', OFFER.rowWidth, 104));
        const frame = UiKit.image('upgrades', look.frame ?? 'itemFrame', 86, 86);
        frame.x = OFFER.frameX;
        symbol.x = OFFER.frameX;
        // The name and its rarity tag share the text column: the name shrinks to leave the tag room, so neither
        // reaches the button.
        const tag = look.rarity ? UiKit.text('upgrades', 'rarityTag', { text: look.rarity.toUpperCase() }, { fill: RARITY_COLORS[look.rarity] }) : undefined;
        const tagRoom = tag ? tag.width + 12 : 0;
        const name = UiKit.fit(UiKit.text('upgrades', 'itemName', { name: title }), OFFER.textWidth - tagRoom);
        name.anchor.set(0, 0.5);
        name.position.set(OFFER.textX, -14);
        const info = UiKit.fit(UiKit.text('upgrades', 'itemInfo', { text: detail }), OFFER.textWidth);
        info.anchor.set(0, 0.5);
        info.position.set(OFFER.textX, 16);
        row.addChild(frame, symbol, name, info);
        if (tag) {
            tag.anchor.set(0, 0.5);
            tag.position.set(name.x + name.width + 12, name.y + 1);
            row.addChild(tag);
        }

        const button = new PIXI.Container();
        button.position.set(OFFER.buttonX, 0);
        if (price === undefined) {
            button.addChild(UiKit.image('upgrades', 'lockedButton', OFFER.buttonWidth, 64), UiKit.text('upgrades', 'maxLabel'));
            row.addChild(button);
            return row;
        }
        if (look.disabled) {
            row.alpha = 0.35;
            button.addChild(UiKit.image('upgrades', 'lockedButton', OFFER.buttonWidth, 64),
                UiKit.fit(UiKit.text('upgrades', 'buyLabel', { price: price.toLocaleString('en-US') }), OFFER.buttonWidth - 20));
            row.addChild(button);
            return row;
        }
        const affordable = DigProgress.money >= price;
        button.addChild(UiKit.image('upgrades', affordable ? 'buyButton' : 'lockedButton', OFFER.buttonWidth, 64),
            UiKit.fit(UiKit.text('upgrades', 'buyLabel', { price: price.toLocaleString('en-US') }), OFFER.buttonWidth - 20));
        button.eventMode = 'static';
        button.cursor = 'pointer';
        if (affordable) {
            UiAnim.pulse(button, 0.05, 0.6);
        }
        button.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            if (buy()) {
                this.say(t('upgraded'), 0x9cff9c);
                // A purchase is a big deal: ka-ching + fanfare, and a sparkle on top for a new tool.
                DigAudio.play('buyCash');
                DigAudio.play('buyFanfare');
                if (look.rarity) DigAudio.play('buyShine');
                this.onBuy();
            } else {
                this.say(t('notEnoughCash'), 0xff8a7a);
                DigAudio.play('error');
                UiAnim.shake(button, 8, 0.35);
            }
        });
        row.addChild(button);
        return row;
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        // Cash, backpack, achievements and MAP down the top-right; mute and settings in the top-left.
        this.corner.position.set(screen.topLeft.x + screen.width - 20 - CORNER_WIDTH, screen.topLeft.y + 44);
        this.mute.position.set(screen.topLeft.x + 20 + MUTE_SIZE / 2, screen.topLeft.y + 20 + MUTE_SIZE / 2);
        this.settings.position.set(this.mute.x + MUTE_SIZE + 12, this.mute.y);
        this.toolChip.position.set(screen.topLeft.x + screen.width - 20 - TOOL_PILL_WIDTH / 2, screen.topLeft.y + screen.height - 40 - TOOL_SIZE / 2 - 26);
        this.toast.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.16);
        // The right edge, a little above the middle: in sight, clear of the miner (centre), the panels (bottom
        // half) and the tool chip (bottom-right corner).
        // Bottom-right, standing on the tool chip.
        this.phone.position.set(this.toolChip.x, this.toolChip.y - TOOL_SIZE / 2 - 16 - PHONE.height / 2);
        // Far enough in that the "NEW MINE!" label (wider than the icon) keeps a margin from the screen edge.
        this.newMineCta.position.set(screen.topLeft.x + 28 + NEW_MINE_CTA.label / 2, screen.topLeft.y + screen.height - 70 - NEW_MINE_CTA.icon / 2);
        this.guide.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.24);
        this.moveHint.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.72);
        this.blocker.clear().beginFill(0x000000, 0.6).drawRect(screen.topLeft.x, screen.topLeft.y, screen.width, screen.height).endFill();
        this.blocker.hitArea = new PIXI.Rectangle(screen.topLeft.x, screen.topLeft.y, screen.width, screen.height);
        this.forcedTitle.position.set(screen.center.x, screen.center.y - 10);
        // Station panels: in the bottom half, under the miner, shrunk to fit what's there.
        const top = screen.center.y + PANEL_TOP_GAP;
        const room = screen.topLeft.y + screen.height - 16 - top;
        for (const slot of this.slots) {
            const slotRoom = slot.fullScreen ? screen.height - 70 - 24 : room;
            const scale = Math.min(1, slotRoom / (slot.height + RIBBON_OVERHANG), (screen.width - 24) / (slot.width + CLOSE_SIZE / 2));
            slot.holder.scale.set(scale);
            // Full-screen overlays sit in the middle of the screen; station panels hang under the miner.
            const y = slot.fullScreen ? screen.center.y + (RIBBON_OVERHANG / 2) * scale : top + (RIBBON_OVERHANG + slot.height / 2) * scale;
            slot.holder.position.set(screen.center.x, y);
        }
        // At the bottom of the screen, under the miner (the card's own height plus a margin up from the edge).
        this.newMineConfirm.position.set(screen.center.x, screen.center.y);
        this.newMineConfirm.scale.set(Math.min(1, (screen.width - 24) / NEW_MINE_SIZE.width, (screen.height - 80) / (NEW_MINE_SIZE.height + RIBBON_OVERHANG)));
        this.findBanner.position.set(screen.center.x, screen.topLeft.y + screen.height - FIND_BANNER_SIZE.height / 2 - 30);
    }

    public override destroy(): void {
        DigProgress.onChange.remove(this.onChange);
        gsap.killTweensOf(this.blocker);
        UiAnim.kill(this);
        super.destroy({ children: true });
    }
}
