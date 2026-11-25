// DigHud.ts
//
// The on-screen UI, built from the UI kit (ui/uikit.json, bandit-controller's kit): the player's level and its bar at the top
// (LevelBadge); money and backpack pills with a fill bar in the top-right (the achievements and MAP under them; mute and
// settings top-left); bottom-left the POWER-UPS star (the boosts, from a level on) and the tractor's sticker (its paints and
// parts: TractorPanel); the phone (sell the full backpack from anywhere at x2, for a rewarded video — see updatePhone());
// short centre messages ("Backpack full!", "SOLD! +$42"), and the hub stations' panels, open while the miner
// stands on their pad: the collection (CollectionPanel) and the wardrobe (WardrobePanel). Upgrades have no panel: they're
// bought on the hub's pads (UpgradePads). The panels sit in the bottom half of the screen (shrunk to fit), so the miner stays
// in view, and each has a close button that keeps it shut until the miner steps off the pad.
//
// A full backpack shows on its pill (a bobbing "FULL!" tag, the pill pulsing) for as long as it stays full. The tutorial's
// first hat is forced (setForced): the screen dims, the wardrobe opens on it with no close button and the hand on it, and
// nothing else can be tapped until it's bought.
//
// The progress changes many times a second on a tractor: the HUD's drawn again once a frame at most (tick()).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { UiKit } from './UiKit';
import { UiAnim, type UiTween } from './UiAnim';
import { tagBadge } from './TabBar';
import { LevelBadge } from './LevelBadge';
import { TractorButton } from './TractorButton';
import { TractorPanel, TRACTOR_PANEL_SIZE } from './TractorPanel';
import { iconSticker } from './Sticker';
import { DigProgress, COLLECTION_REWARD } from '../data/DigProgress';
import { CollectionPanel, COLLECTION_SIZE } from './CollectionPanel';
import { WardrobePanel, WARDROBE_SIZE } from './WardrobePanel';
import { AchievementsPanel, ACHIEVEMENTS_SIZE } from './AchievementsPanel';
import { flyCoin, coinCount, COIN_STAGGER } from './FlyCoin';
import { LanguagePanel, LANGUAGE_SIZE } from './LanguagePanel';
import { MinesPanel, MINES_SIZE } from './MinesPanel';
import { MoveHint } from './MoveHint';
import { ModelIcons } from './ModelIcons';
import { BoostDef, DIG, PerkDef, Rarity, ToolDef } from '../data/DigConfig';
import { UpgradeList, UPGRADE_LIST_SIZE, UpgradeRow, levelInfo } from './UpgradeList';
import SoundToggleButton from 'core/ui/SoundToggleButton';
import { HUB, rateLabel, type StationKind } from '../data/HubData';

import { t, names, type StringId, Localization } from '../i18n/Localization';
import { LOCALE_FLAG_CODE } from '../i18n/config';
import { shortMoney, shortNumber } from '../utils/Numbers';
import { DigAudio } from '../audio/DigAudio';
import { Gameplay } from '../data/Gameplay';
import { GameAnalytics } from '../analytics/GameAnalytics';

/** POWER-UPS' title outline. */
const BOOST_TITLE_STROKE = 0x4a1d6e;
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
/** The power surge countdown pill (setPower). */
const POWER_TIMER = { width: 340, height: 74 };
/** What medals are drawn as. */
const MEDAL = 'ItemIcon_Trophy_Gold';
/** The achievements button, under the money / backpack pills: just the memo pad icon, no button shape. */
const ACHIEVEMENTS_BUTTON = 84;
/** The SELL x2 offer: a pile of cash (no button shape) over the tool chip, a rotating shine behind it. */
const PHONE = { width: 112, height: 116, shine: 180 };
/** The phone only shows with this many tool upgrades bought (the Steel Pickaxe). */
const PHONE_TOOL_LEVEL = 2;
/** The stickers at the bottom left (POWER-UPS, the tractor), and the tractor's, this long after its first one's bought. */
const STICKER = { size: 92, gap: 16, margin: 24 };
/** On a screen narrower than this the level goes under the corners, not between them. */
const WIDE = 900;
/** The rebirth's confirmation. */
const REBIRTH_SIZE = { width: 560, height: 400 };
/** The rewarded tractor offer: taller than the new-mine card, for the tractor on its shine. */
const TRACTOR_OFFER_SIZE = { width: 560, height: 520 };
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

/** A white glow round the screen's edge, clear in the middle (tinted and pulsed by setPower). */
function vignetteTexture(): PIXI.Texture {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const g = canvas.getContext('2d')!;
    const gradient = g.createRadialGradient(128, 128, 56, 128, 128, 182);
    gradient.addColorStop(0, 'rgba(255,255,255,0)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.3)');
    gradient.addColorStop(1, 'rgba(255,255,255,0.95)');
    g.fillStyle = gradient;
    g.fillRect(0, 0, 256, 256);
    return PIXI.Texture.from(canvas);
}

/** A tool's picture: its atlas icon, or a tractor as it looks now. */
function toolArt(tool: ToolDef, size: number): PIXI.Sprite {
    return tool.vehicle ? ModelIcons.tractorSprite(tool, DigProgress.tractorLook, size) : toolIcon(tool.icon, size);
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
    private readonly backpackText = UiKit.text('hud', 'backpack', { count: 0, capacity: 0 });
    private readonly barFill = new PIXI.Container();
    private readonly toolChip = new PIXI.Container();
    private readonly toast = UiKit.text('hud', 'toast', { text: '' });
    /** The guide's current step (Guide.ts), on a pill near the top; hidden when there's none. */
    private readonly guide = new PIXI.Container();
    private readonly guideText = UiKit.text('hud', 'guide', { text: '' });
    private guideShown: string | null = null;
    private readonly levelBadge = new LevelBadge();
    private readonly powerButton = new PIXI.Container();
    private readonly powerAlert = new PIXI.Container();
    private readonly tractorPanel: TractorPanel;
    private readonly tractorButton: TractorButton;
    /** Something changed since it was last drawn (tick()). */
    private changed = false;
    /** A rebirth: asked before the reset (a full-screen confirmation). */
    private readonly rebirthConfirm = new PIXI.Container();
    private readonly tractorConfirm = new PIXI.Container();
    private readonly tractorBadge = new PIXI.Container();
    /** "Drag to move" (a brand-new game only; DigScene shows / hides it). */
    public readonly moveHint = new MoveHint();
    private readonly phone = new PIXI.Container();
    /** A rewarded video for the phone is playing (the phone hides until it's over). */
    private phoneBusy = false;
    private phoneVideo!: PIXI.Sprite;
    private phoneFree!: PIXI.Container;
    private phoneHand!: PIXI.Container;
    /** POWER-UPS, and the medals' perks (and REBIRTH). */
    private readonly panel: UpgradeList;
    private readonly perks: UpgradeList;
    private readonly perksButton = new PIXI.Container();
    private readonly perksAlert = new PIXI.Container();
    private readonly wardrobeButton = new PIXI.Container();
    private readonly wardrobeAlert = new PIXI.Container();
    private readonly collection: CollectionPanel;
    /** Coins flying in from a reward (killed with the HUD). */
    private claimTweens: UiTween[] = [];
    private readonly wardrobe: WardrobePanel;
    private readonly achievements: AchievementsPanel;
    private readonly achievementsButton = new PIXI.Container();
    /** The mines (MAP button): shown once a second mine exists or can be opened; "!" when one can. */
    private readonly mines: MinesPanel;
    private readonly mapButton = new PIXI.Container();
    private readonly mapAlert = new PIXI.Container();
    /** The gear next to mute: opens the settings menu (the language list). */
    private readonly settings = new PIXI.Container();
    private readonly language = new LanguagePanel();
    private station: StationKind | null = null;
    private readonly slots: PanelSlot[] = [];
    private lastMoney = -1;
    /** What the hub earns a second, by the money (shown from the first piece that earns); the rate shown. */
    private readonly incomeText = UiKit.text('hud', 'toast', { text: '' }, { fontSize: 22, fill: 0x8fffa0, strokeThickness: 5 });
    private incomeShown = 0;
    /** Money and items of a sale still flying to the sell pad: shown as not yet earned / still carried. */
    private heldMoney = 0;
    private heldItems = 0;
    /** The backpack pill (it pulses while full) and its "FULL!" tag. */
    private bagRow!: PIXI.Container;
    private readonly fullTag = new PIXI.Container();
    private bagFull = false;
    private readonly blocker = new PIXI.Graphics();
    /** A power surge's screen edge: a pulsing rainbow glow, the star feeling (setPower). */
    private readonly powerVignette = new PIXI.Sprite(vignetteTexture());
    /** The panels' close buttons (hidden while a purchase is forced). */
    private readonly closeButtons: PIXI.Container[] = [];
    /** A power surge's countdown (setPower): the lent tool's name over a draining bar, near the top. */
    private readonly powerTimer = new PIXI.Container();
    private readonly powerText = UiKit.text('hud', 'toast', { text: '' }, { fontSize: 26, fill: 0x8fe9ff, strokeThickness: 6 });
    private readonly powerBar = new PIXI.Graphics();
    private powerShown: string | null = null;
    private readonly onChange = () => {
        this.changed = true;
    };

    /**
     * `onBuy` runs after a purchase so the scene can react (swap the tool in hand); `onSell` when the phone
     * is tapped; `onWear` after the wardrobe changes the miner's look.
     */
    public constructor(private readonly onBuy: () => void, private readonly onSell: () => void, onWear: () => void,
        /** The player confirmed a rebirth (the scene starts over). */
        private readonly onRebirth: () => void,
        /** The player chose another mine to go to (the scene rebuilds it). */
        onTravel: (index: number) => void) {
        super();
        this.buildCorner();
        this.toast.alpha = 0;
        this.panel = new UpgradeList({
            title: t('titlePowerUps'), ribbon: 'ribbonPurple', stroke: BOOST_TITLE_STROKE, currency: { prefix: '$' },
            rows: () => DIG.boosts.map((boost) => this.boostRow(boost)), footer: () => t('boostsHint'),
            notEnough: () => this.say(t('notEnoughCash'), 0xff8a7a),
            bought: (id) => {
                GameAnalytics.boostBought(id, DigProgress.boostLevel(id as BoostDef['id']));
                this.onBuy();
            },
        });
        this.perks = new UpgradeList({
            title: t('titlePerks'), ribbon: 'ribbon', stroke: 0x1d5a12, currency: { icon: MEDAL },
            purse: () => shortNumber(DigProgress.medals),
            rows: () => DIG.rebirth.perks.map((perk) => this.perkRow(perk)),
            footer: () => (DigProgress.prestige > 0 ? t('rebirthHint') : t('rebirthLocked')),
            action: { label: () => t('rebirthButton', { medals: shortNumber(DigProgress.runMedals) }), enabled: () => DigProgress.canRebirth, tap: () => this.showRebirthConfirm() },
            notEnough: () => this.say(t('notEnoughMedals'), 0xff8a7a),
            bought: (id) => GameAnalytics.perkBought(id, DigProgress.perkLevel(id as PerkDef['id'])),
        });
        this.wardrobe = new WardrobePanel(onWear, (text, color) => this.say(text, color));
        this.achievements = new AchievementsPanel();
        this.collection = new CollectionPanel();
        this.buildAchievementsButton();
        this.mines = new MinesPanel((index) => {
            this.closeStationPanel();
            onTravel(index);
        });
        this.buildMapButton();
        this.tractorPanel = new TractorPanel((text, color) => this.say(text, color));
        this.tractorButton = new TractorButton(STICKER.size, () => this.toggleTractor());
        this.sticker(this.powerButton, this.powerAlert, 'ItemIcon_Star_Gold', () => this.toggleOverlay(this.panel, () => {
            GameAnalytics.panelOpened('powerups');
            this.panel.refresh();
        }));
        this.sticker(this.perksButton, this.perksAlert, MEDAL, () => this.toggleOverlay(this.perks, () => {
            GameAnalytics.panelOpened('perks');
            this.perks.refresh();
        }));
        this.sticker(this.wardrobeButton, this.wardrobeAlert, 'ItemIcon_Gear_Armor_Top', () => this.toggleOverlay(this.wardrobe, () => {
            // Marked first: a return visit badges the free looks in this very refresh.
            DigProgress.markWardrobeSeen();
            this.wardrobe.refresh();
        }));
        this.guide.addChild(UiKit.image('hud', 'pill', 420, 50), this.guideText);
        this.guide.visible = false;
        this.buildBlocker();
        this.powerText.anchor.set(0.5);
        this.powerText.y = -12;
        this.powerTimer.addChild(UiKit.image('hud', 'pill', POWER_TIMER.width, POWER_TIMER.height), this.powerText, this.powerBar);
        this.powerTimer.visible = false;
        this.powerVignette.visible = false;
        this.powerVignette.eventMode = 'none';
        this.addChild(this.tractorBadge, this.powerVignette, this.corner, this.toolChip, this.levelBadge, this.perksButton, this.powerButton, this.tractorButton, this.wardrobeButton, this.buildPhone(), this.buildMute(), this.guide, this.powerTimer, this.moveHint, this.blocker,
            this.slot(this.panel, UPGRADE_LIST_SIZE, true),
            this.slot(this.perks, UPGRADE_LIST_SIZE, true),
            this.slot(this.tractorPanel, TRACTOR_PANEL_SIZE),
            this.slot(this.collection, COLLECTION_SIZE),
            this.slot(this.wardrobe, WARDROBE_SIZE),
            this.slot(this.achievements, ACHIEVEMENTS_SIZE, true),
            this.slot(this.language, LANGUAGE_SIZE, true),
            this.slot(this.mines, MINES_SIZE, true),
            this.rebirthConfirm,
            this.tractorConfirm,
            this.toast);
        this.tractorConfirm.visible = false;
        this.rebirthConfirm.visible = false;
        this.tractorBadge.visible = false;
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
        this.toolChip.visible = true;
        this.achievements.visible = false;
        this.language.visible = false;
        this.mines.visible = false;
        this.panel.visible = false;
        this.perks.visible = false;
        this.tractorPanel.visible = false;
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
        const money = this.pill('moneyIcon', this.moneyText, 0);
        // The hub's income, just left of the money icon (the corner sits on the screen's right edge).
        this.incomeText.anchor.set(1, 0.5);
        this.incomeText.position.set(-6, 0);
        this.incomeText.visible = false;
        money.addChild(this.incomeText);
        this.corner.addChild(money);
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
        this.phoneVideo = video;
        // While sales are free (DigProgress.freeSellsLeft): a FREE tag where the video badge goes; the first also gets the hand.
        this.phoneFree = tagBadge(t('free'), PHONE.width / 2 - 14, -PHONE.height / 2 + 12);
        this.phoneHand = this.pointingHand(-6, -20);
        body.addChild(picto, label, video, this.phoneFree);
        UiAnim.pulse(body, 0.06, 0.55);
        this.phone.addChild(shine, body, this.phoneHand);
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
            && !this.phoneBusy && this.station === null && !this.overlayOpen;
        if (show === this.phone.visible) return;
        this.phone.visible = show;
        if (!show) return;
        const free = DigProgress.freeSellsLeft > 0;
        this.phoneVideo.visible = !free;
        this.phoneFree.visible = free;
        this.phoneHand.visible = DigProgress.firstPhoneSell;
        UiAnim.popIn(this.phone);
        GameAnalytics.phoneShown(free);
    }

    /** A rewarded video for the phone started / ended (the phone stays hidden meanwhile). */
    public setPhoneBusy(busy: boolean): void {
        this.phoneBusy = busy;
        this.updatePhone();
    }

    /** The memo pad under the pills (no button shape: the icon reads on its own). Achievements pay by themselves: it's to look at them. */
    private buildAchievementsButton(): void {
        this.achievementsButton.position.set(CORNER_WIDTH - ACHIEVEMENTS_BUTTON / 2, 150);
        this.achievementsButton.addChild(icon('hud', 'achievementsIcon', ACHIEVEMENTS_BUTTON));
        // The icon alone is the button: an invisible square keeps the whole of it tappable.
        this.achievementsButton.hitArea = new PIXI.Rectangle(-ACHIEVEMENTS_BUTTON / 2, -ACHIEVEMENTS_BUTTON / 2, ACHIEVEMENTS_BUTTON, ACHIEVEMENTS_BUTTON);
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

    /** Achievements reached: paid at once, their cash flying off the memo pad, and said. */
    public payAchievements(): void {
        let reward = 0;
        let hat: string | undefined;
        let title = '';
        for (let again = true; again;) {
            again = false;
            for (const achievement of DIG.achievements) {
                const paid = DigProgress.claimAchievement(achievement.id);
                if (!paid) continue;
                GameAnalytics.achievementClaimed(achievement.id, DigProgress.achievementLevel(achievement.id));
                reward += paid.reward;
                hat ??= paid.hat;
                title ||= names.achievement(achievement).toUpperCase();
                again = true;
            }
        }
        if (reward <= 0) return;
        this.holdSale(reward, 0);
        DigAudio.play('buyCash');
        this.flyCash(reward, this.achievementsButton.getGlobalPosition());
        UiAnim.punch(this.achievementsButton, 0.35);
        this.say(hat ? t('hatWaiting', { hat: names.look(hat) }) : `${t('achievementTitle')} ${title}  +${shortMoney(reward)}`, 0xffe27a);
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

    /** Opens/closes the achievements (centred over the game, like the language list). */
    private toggleAchievements(): void {
        this.toggleOverlay(this.achievements, () => this.achievements.refresh());
    }

    /** Opens an overlay panel opened from the HUD (closing whatever else is open), or closes it if it's showing. */
    private toggleOverlay(panel: PIXI.Container, refresh: () => void): void {
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
        this.updatePhone();
        UiAnim.popIn(panel);
        DigAudio.play('open');
    }

    /** A panel opened from the HUD is up. */
    private get overlayOpen(): boolean {
        return this.achievements.visible || this.language.visible || this.mines.visible || this.panel.visible || this.perks.visible || this.tractorPanel.visible || this.wardrobe.visible;
    }

    /** Any panel at all is up (nothing's offered meanwhile). */
    public get busy(): boolean {
        return this.station === 'collection' || this.overlayOpen || this.rebirthConfirm.visible || this.tractorConfirm.visible;
    }

    /** The tractor can be dressed: its button's there. */
    public get tractorMenu(): boolean {
        return this.tractorButton.visible;
    }

    private toggleTractor(): void {
        this.toggleOverlay(this.tractorPanel, () => {
            GameAnalytics.panelOpened('tractor');
            DigProgress.markTractorSeen();
            this.tractorPanel.refresh();
        });
        this.refreshStickers();
    }

    /** A sticker button (a picture on a white outline, nothing behind it) with a bouncing "!". */
    private sticker(button: PIXI.Container, alert: PIXI.Container, frame: string, onTap: () => void): void {
        const { size } = STICKER;
        button.addChild(iconSticker(frame, size * 0.82));
        button.hitArea = new PIXI.Rectangle(-size / 2, -size / 2, size, size);
        const mark = icon('hud', 'alert', 34);
        alert.addChild(mark);
        alert.position.set(size / 2 - 6, -size / 2 + 6);
        gsap.to(mark, { y: -8, duration: 0.45, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        button.addChild(alert);
        button.visible = false;
        button.eventMode = 'static';
        button.cursor = 'pointer';
        // Taps on HUD buttons must not also start the movement joystick underneath.
        button.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        button.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            DigAudio.play('toggle');
            onTap();
        });
    }

    private showSticker(button: PIXI.Container, shown: boolean): void {
        if (shown && !button.visible) UiAnim.popIn(button);
        button.visible = shown;
    }

    /** A power-up's row: its effect now and next. */
    private boostRow(boost: BoostDef): UpgradeRow {
        const level = DigProgress.boostLevel(boost.id);
        const price = DigProgress.boostPrice(boost);
        const effect = (at: number) => {
            const value = DigProgress.boostEffect(boost, at);
            return value < 10 ? `+${Math.round(value * 100)}%` : `x${shortNumber(1 + value)}`;
        };
        return {
            id: boost.id, icon: boost.icon, name: t(`boost_${boost.id}` as StringId), level, max: boost.maxLevel,
            toward: boost.milestones?.find((milestone) => milestone > level),
            info: levelInfo(level, boost.maxLevel, effect(level), price === undefined ? undefined : effect(level + 1)),
            price, affordable: price !== undefined && DigProgress.money >= price, buy: () => DigProgress.buyBoost(boost),
        };
    }

    /** A perk's row. */
    private perkRow(perk: PerkDef): UpgradeRow {
        const level = DigProgress.perkLevel(perk.id);
        const price = DigProgress.perkCost(perk);
        const effect = (at: number) => {
            if (perk.id === 'tools' || perk.id === 'blades' || perk.id === 'crew') return `+${at}`;
            if (perk.id === 'luck' || perk.id === 'speed') return `+${Math.round(perk.per * at * 100)}%`;
            const factor = Math.pow(perk.per, at);
            return perk.id === 'portal' ? `-${Math.round((1 - factor) * 100)}%` : `x${factor < 10 ? factor.toFixed(2) : shortNumber(factor)}`;
        };
        return {
            id: perk.id, icon: perk.icon, name: names.perk(perk), level, max: perk.max,
            info: `${t(`perk_what_${perk.id}` as StringId)}  ·  ${price === undefined ? effect(level) : `${effect(level)}  →  ${effect(level + 1)}`}`,
            price, affordable: price !== undefined && DigProgress.medals >= price, buy: () => DigProgress.buyPerk(perk),
        };
    }

    /** The stickers at the bottom left: there from a level (POWER-UPS) and from the first tractor, each with its "!". */
    private refreshStickers(): void {
        const power = DigProgress.boostsUnlocked;
        if (power && !this.powerButton.visible) {
            if (DigProgress.once('power-ups')) this.say(t('powerUpsOpen'), 0xffe27a);
        }
        this.showSticker(this.powerButton, power);
        this.powerAlert.visible = power && DigProgress.canAffordBoost && !this.panel.visible;
        // (A tractor of their own, and the tutorial's first pieces done: one new thing at a time.)
        const tractor = DigProgress.hasTractor && DigProgress.backpackLevel > 0;
        if (tractor && !this.tractorButton.visible && DigProgress.once('tractor-menu')) this.say(t('tractorMenuOpen'), 0xffe27a);
        this.tractorButton.set(tractor, DigProgress.tractorHasNews && !this.tractorPanel.visible);
        this.showSticker(this.wardrobeButton, DigProgress.backpackLevel > 0 || DigProgress.rebirths > 0);
        this.wardrobeAlert.visible = DigProgress.wardrobeHasNews && !this.wardrobe.visible;
        const perks = DigProgress.prestige > 0 || DigProgress.rebirths > 0;
        this.showSticker(this.perksButton, perks);
        this.perksAlert.visible = perks && (DigProgress.canAffordPerk || (DigProgress.canRebirth && DigProgress.rebirths === 0)) && !this.perks.visible;
    }

    /** Once a frame: what changed since the last one is drawn. */
    public tick(): void {
        if (!this.changed) return;
        this.changed = false;
        this.refresh();
    }

    /** Shows the language list (the HUD was just rebuilt for a new language: keep it open). */
    public openLanguage(): void {
        if (!this.language.visible) this.toggleOverlay(this.language, () => this.language.refresh());
    }

    /** The language button: the current language's flag on the round dark button (same as mute), beside it. */
    private buildSettings(): PIXI.Container {
        // The menu only picks the language, so the button shows the current language's flag (a player who can't read
        // the UI still recognizes it). The HUD is rebuilt on a language change, so the flag follows. Back to the gear
        // (hud settingsIcon) if real settings arrive.
        const flag = PIXI.Sprite.from(`Icon_Flag_${LOCALE_FLAG_CODE[Localization.currentLocale]}`);
        flag.anchor.set(0.5);
        flag.scale.set((MUTE_SIZE * 0.6) / Math.max(flag.texture.width, flag.texture.height, 1));
        this.settings.addChild(icon('hud', 'muteButton', MUTE_SIZE), flag);
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
        const { level, into, need } = DigProgress.levelNow;
        this.levelBadge.set(level, into, need);
        this.refreshStickers();
        const money = DigProgress.money - this.heldMoney;
        this.moneyText.text = shortMoney(money);
        UiKit.fit(this.moneyText, PILL_WIDTH - ICON_SIZE - 14);
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

        // (On foot: a tractor's on its sticker.)
        this.toolChip.renderable = !DigProgress.hasTractor;
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
        if (this.panel.visible && this.heldMoney === 0 && this.panel.stale) this.panel.refresh();
        if (this.perks.visible && this.perks.stale) this.perks.refresh();
        if (this.tractorPanel.visible && this.heldMoney === 0 && this.tractorPanel.stale) this.tractorPanel.refresh();
        if (this.wardrobe.visible && this.heldMoney === 0) {
            this.wardrobe.refresh();
        }
        this.mapButton.visible = DigProgress.prestige > 0;
        this.mapAlert.visible = false;
        if (this.mines.visible && this.heldMoney === 0) this.mines.refresh();
        // Not while money is still landing (a sale, a reward): rebuilding the panel on every coin is wasted work and
        // kills its tweens mid-flight. It catches up when the last coin lands (heldMoney back to 0).
        if (this.achievements.visible && this.heldMoney === 0) {
            this.achievements.refresh();
        }
    }

    /**
     * A find's reward (or the collection's), the moment it's dug up: paid now, then its cash flies
     * from `from` (on screen) into the money icon, the counter climbing as each coin lands.
     */
    public claimReward(id: string, from: PIXI.Point): void {
        const amount = DigProgress.unclaimedFor(id);
        if (amount <= 0) return;
        // Held back first, so the counter doesn't jump before the coins land.
        this.holdSale(amount, 0);
        DigProgress.claimReward(id);
        if (id !== COLLECTION_REWARD) GameAnalytics.findClaimed(id);
        DigAudio.play('buyCash');
        this.flyCash(amount, from);
    }

    /** `amount`, held back already, flies in as coins from `from` (on screen): the counter climbs as each lands. */
    private flyCash(amount: number, from: PIXI.Point): void {
        const start = this.toLocal(from);
        const target = () => (this.moneyIcon ? this.toLocal(this.moneyIcon.getGlobalPosition()) : new PIXI.Point());
        const coins = coinCount(amount);
        let paid = 0;
        for (let i = 0; i < coins; i++) {
            // Each coin carries its share; the last one takes the rounding remainder.
            const share = i === coins - 1 ? amount - paid : Math.floor(amount / coins);
            paid += share;
            const at = new PIXI.Point(start.x + (Math.random() - 0.5) * 60, start.y + (Math.random() - 0.5) * 24);
            this.claimTweens.push(flyCoin(this, at, target, i * COIN_STAGGER, () => {
                this.releaseSale(share, 0);
                DigAudio.play('coins');
                if (!this.moneyIcon) return;
                gsap.killTweensOf(this.moneyIcon.scale);
                this.moneyIcon.scale.set(this.moneyIconScale);
                UiAnim.punch(this.moneyIcon, 0.25);
            }));
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
    }

    /** The dim layer is up while a purchase is forced or the new-mine question is asked. */
    private updateBlocker(): void {
        const on = this.rebirthConfirm.visible || this.tractorConfirm.visible;
        if (on && !this.blocker.visible) gsap.fromTo(this.blocker, { alpha: 0 }, { alpha: 1, duration: 0.3 });
        this.blocker.visible = on;
    }

    private closeOverlays(): void {
        this.achievements.visible = false;
        this.language.visible = false;
        this.mines.visible = false;
        this.panel.visible = false;
        this.perks.visible = false;
        this.tractorPanel.visible = false;
        this.wardrobe.visible = false;
    }

    /** Opens the panel of the station the miner stands on (null = none): collection, wardrobe (the ATM has none). */
    public setStationPanel(kind: StationKind | null): void {
        if (kind === this.station) return;
        this.station = kind;
        // The open panel fills the bottom of the screen, where the tool chip sits.
        this.toolChip.visible = kind === null && !this.achievements.visible && !this.language.visible;
        if (kind !== null) this.closeOverlays();
        this.updatePhone();
        this.collection.visible = kind === 'collection';
        if (kind === 'collection') {
            this.collection.refresh(DigProgress.unseenFinds);
            DigProgress.markFindsSeen();
            UiAnim.popIn(this.collection);
            DigAudio.play('open');
        }
    }

    /** The guide's line (null hides it); pops in when it changes so the new step gets noticed. */
    public setGuide(text: string | null): void {
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

    /**
     * A power surge's countdown: `label` (the lent tool and the seconds left) over a bar at `fraction` (1 = full);
     * null hides it. Pops in when it first shows.
     */
    public setPower(label: string | null, fraction = 0): void {
        if (label === null) {
            this.powerTimer.visible = false;
            this.powerShown = null;
            this.powerVignette.visible = false;
            return;
        }
        if (this.powerShown === null) {
            this.powerTimer.visible = true;
            UiAnim.punch(this.powerTimer, 0.2);
            this.powerVignette.visible = true;
        }
        // The edge glow cycles through the rainbow and throbs to the beat (faster as time runs out).
        const time = performance.now() / 1000;
        const beat = fraction < 0.25 ? 11 : 7;
        this.powerVignette.tint = new PIXI.Color({ h: (time * 220) % 360, s: 90, l: 60 }).toNumber();
        this.powerVignette.alpha = 0.7 + 0.3 * Math.abs(Math.sin(time * beat));
        if (label !== this.powerShown) this.powerText.text = label;
        this.powerShown = label;
        const width = POWER_TIMER.width - 48;
        const color = fraction < 0.25 ? 0xff8a7a : 0x6fe3ff;
        this.powerBar.clear()
            .beginFill(0x10202a, 0.8).drawRoundedRect(-width / 2, 12, width, 12, 6).endFill()
            .beginFill(color).drawRoundedRect(-width / 2, 12, Math.max(12, width * fraction), 12, 6).endFill();
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

    // ---------------------------------------------------------------- POWER-UPS

    /** A rebirth: what it pays, what goes, what stays — and whether to. */
    private showRebirthConfirm(): void {
        const box = this.rebirthConfirm;
        UiAnim.kill(box);
        box.removeChildren().forEach((child) => child.destroy({ children: true }));
        const { width, height } = REBIRTH_SIZE;
        const frame = UiKit.image('upgrades', 'panel', width, height);
        frame.eventMode = 'static';
        frame.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        const ribbon = UiKit.sprite('upgrades', 'ribbon', 0.55);
        ribbon.y = -height / 2;
        const title = UiKit.text('upgrades', 'title');
        title.text = t('rebirthTitle');
        UiKit.fit(title, 260);
        title.y = -height / 2 - 5;
        box.addChild(frame, ribbon, title);
        const lines: [string, number, number][] = [
            [t('rebirthPays', { medals: shortNumber(DigProgress.runMedals) }), 0xffe27a, 34],
            [t('rebirthLoses'), 0xff9a8a, 22],
            [t('rebirthKeeps'), 0x9cff9c, 22],
        ];
        lines.forEach(([text, fill, fontSize], i) => {
            const line = UiKit.text('upgrades', 'itemInfo', { text }, { fill, fontSize, wordWrap: true, wordWrapWidth: width - 70, align: 'center' });
            line.anchor.set(0.5);
            line.y = -100 + i * 66;
            box.addChild(line);
        });
        const button = (label: string, image: string, x: number, onTap: () => void) => {
            const made = new PIXI.Container();
            made.position.set(x, height / 2 - 66);
            const text = UiKit.text('upgrades', 'buyLabel', { price: '' });
            text.text = label;
            UiKit.fit(text, 180);
            made.addChild(UiKit.image('upgrades', image, 200, 66), text);
            made.eventMode = 'static';
            made.cursor = 'pointer';
            made.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
            made.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
                event.stopPropagation();
                box.visible = false;
                this.updateBlocker();
                onTap();
            });
            box.addChild(made);
            return made;
        };
        UiAnim.pulse(button(t('rebirthGo'), 'buyButton', 115, () => {
            this.closeStationPanel();
            DigAudio.play('buyFanfare');
            this.onRebirth();
        }), 0.05, 0.6);
        button(t('cancel'), 'lockedButton', -115, () => DigAudio.play('close'));
        this.closeStationPanel();
        box.visible = true;
        this.updateBlocker();
        UiAnim.popIn(box);
        DigAudio.play('open');
        GameAnalytics.rebirthOffered();
    }

    public get canOfferTractor(): boolean {
        return this.station === null && !this.overlayOpen && !this.rebirthConfirm.visible && !this.tractorConfirm.visible;
    }

    public showTractorOffer(onWatch: () => void, onSkip: () => void): void {
        const box = this.tractorConfirm;
        UiAnim.kill(box);
        box.removeChildren().forEach((child) => child.destroy({ children: true }));
        const { width, height } = TRACTOR_OFFER_SIZE;
        const frame = UiKit.image('upgrades', 'panel', width, height);
        frame.eventMode = 'static';
        frame.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        const ribbon = UiKit.sprite('upgrades', 'ribbon', 0.55);
        ribbon.y = -height / 2;
        const title = UiKit.text('upgrades', 'title');
        title.text = t('tractorOfferTitle');
        UiKit.fit(title, 260);
        title.y = -height / 2 - 5;

        // The hero: the surge tractor turning on a double shine (a fast gold one over a slow cyan one), bobbing.
        const hero = new PIXI.Container();
        hero.y = -70;
        const tractor = ModelIcons.sprite(`./dig/models/${DIG.chests.power.model}`, 200);
        hero.addChild(tractor);
        UiAnim.rays(hero, 120, 0xfff0a0, 0.95, 5);
        UiAnim.rays(hero, 175, 0x6fe3ff, 0.8, 12);
        gsap.to(tractor.position, { y: -8, duration: 0.9, ease: 'sine.inOut', yoyo: true, repeat: -1 });
        const timer = UiKit.text('hud', 'toast', { text: `${DIG.chests.power.seconds}s` }, { fontSize: 34, fill: 0xffe14d, strokeThickness: 7 });
        timer.position.set(115, 45);
        timer.rotation = -0.18;
        UiAnim.pulse(timer, 0.1, 0.5);
        hero.addChild(timer);

        const body = UiKit.text('upgrades', 'itemInfo', {}, {
            fill: 0xffffff, fontSize: 22, lineHeight: 27, strokeThickness: 3,
            wordWrap: true, breakWords: true, wordWrapWidth: width - 80, align: 'center',
        });
        body.style.wordWrap = true;
        body.style.breakWords = true;
        body.style.wordWrapWidth = width - 80;
        body.text = t('tractorOfferBody', { seconds: DIG.chests.power.seconds });
        body.anchor.set(0.5);
        body.y = 70;
        box.addChild(frame, hero, ribbon, title, body);

        const buttonY = height / 2 - 60;
        const tap = (b: PIXI.Container, onTap: () => void) => {
            b.eventMode = 'static';
            b.cursor = 'pointer';
            b.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
            b.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
                event.stopPropagation();
                onTap();
            });
        };
        const skip = new PIXI.Container();
        skip.position.set(-135, buttonY);
        const skipText = UiKit.text('upgrades', 'buyLabel', { price: '' });
        skipText.text = t('cancel');
        UiKit.fit(skipText, 160);
        skip.addChild(UiKit.image('upgrades', 'lockedButton', 180, 64), skipText);
        tap(skip, onSkip);

        // The standard rewarded-video button: green, video icon + label, its own shine, a pulse and a glint sweeping across.
        const watch = new PIXI.Container();
        watch.position.set(105, buttonY);
        const watchW = 270;
        const watchH = 78;
        const face = new PIXI.Container();
        face.addChild(UiKit.image('upgrades', 'buyButton', watchW, watchH));
        const video = PIXI.Sprite.from('ItemIcon_Video');
        video.anchor.set(0.5);
        video.scale.set(52 / Math.max(video.texture.width, video.texture.height, 1));
        video.x = -watchW / 2 + 40;
        const watchText = UiKit.text('upgrades', 'buyLabel', { price: '' });
        watchText.text = t('tractorWatch');
        UiKit.fit(watchText, watchW - 95);
        watchText.x = 24;
        const glintMask = new PIXI.Graphics().beginFill(0xffffff).drawRoundedRect(-watchW / 2 + 4, -watchH / 2 + 4, watchW - 8, watchH - 12, 18).endFill();
        const glint = new PIXI.Graphics().beginFill(0xffffff, 0.45).drawPolygon([-14, -50, 14, -50, -6, 50, -34, 50]).endFill();
        glint.mask = glintMask;
        glint.eventMode = 'none';
        glint.x = -watchW;
        gsap.to(glint, { x: watchW, duration: 0.8, ease: 'power1.in', repeat: -1, repeatDelay: 1.1 });
        face.addChild(glint, glintMask, video, watchText);
        watch.addChild(face);
        UiAnim.rays(watch, 170, 0xfff0a0, 0.9, 6);
        UiAnim.pulse(face, 0.06, 0.55);
        tap(watch, onWatch);
        box.addChild(skip, watch);
        box.interactiveChildren = true;
        box.visible = true;
        this.updateBlocker();
        UiAnim.popIn(box);
        DigAudio.play('open');
    }

    public setTractorBusy(): void {
        this.tractorConfirm.interactiveChildren = false;
    }

    /**
     * The video badge floating over the rewarded tractor spot in the world: the standard video button (green, video icon)
     * on a turning shine, bobbing and pulsing. `at` is in this HUD's space; null hides it.
     */
    public setTractorBadge(at: PIXI.IPointData | null): void {
        const badge = this.tractorBadge;
        if (!at || this.tractorConfirm.visible) {
            badge.visible = false;
            return;
        }
        if (badge.children.length === 0) {
            const face = new PIXI.Container();
            face.addChild(UiKit.image('upgrades', 'buyButton', 104, 72));
            const video = PIXI.Sprite.from('ItemIcon_Video');
            video.anchor.set(0.5);
            video.scale.set(54 / Math.max(video.texture.width, video.texture.height, 1));
            video.y = -3;
            face.addChild(video);
            badge.addChild(face);
            UiAnim.rays(badge, 95, 0xfff0a0, 0.9, 6);
            UiAnim.pulse(face, 0.08, 0.55);
            badge.eventMode = 'none';
        }
        badge.visible = true;
        badge.position.set(at.x, at.y + Math.sin(performance.now() / 300) * 6);
    }

    public hideTractorOffer(): void {
        UiAnim.kill(this.tractorConfirm);
        this.tractorConfirm.visible = false;
        this.updateBlocker();
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

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        // Cash, backpack, achievements and MAP down the top-right; mute and settings in the top-left.
        this.corner.position.set(screen.topLeft.x + screen.width - 20 - CORNER_WIDTH, screen.topLeft.y + 44);
        this.mute.position.set(screen.topLeft.x + 20 + MUTE_SIZE / 2, screen.topLeft.y + 20 + MUTE_SIZE / 2);
        this.settings.position.set(this.mute.x + MUTE_SIZE + 12, this.mute.y);
        this.toolChip.position.set(screen.topLeft.x + screen.width - 20 - TOOL_PILL_WIDTH / 2, screen.topLeft.y + screen.height - 40 - TOOL_SIZE / 2 - 26);
        this.toast.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.19);
        // The right edge, a little above the middle: in sight, clear of the miner (centre), the panels (bottom
        // half) and the tool chip (bottom-right corner).
        // Bottom-right, standing on the tool chip.
        this.phone.position.set(this.toolChip.x, this.toolChip.y - TOOL_SIZE / 2 - 16 - PHONE.height / 2);
        // The stickers up the left edge.
        const stickerX = screen.topLeft.x + STICKER.margin + STICKER.size / 2;
        const stickerY = screen.topLeft.y + screen.height - STICKER.margin - STICKER.size / 2;
        this.tractorButton.position.set(stickerX, stickerY);
        [this.wardrobeButton, this.powerButton, this.perksButton].forEach((button, i) => button.position.set(stickerX, stickerY - (STICKER.size + STICKER.gap) * (i + 1)));
        this.levelBadge.position.set(screen.center.x - LevelBadge.width / 2 + LevelBadge.badgeHalf, screen.topLeft.y + (screen.width < WIDE ? 128 : 48));
        this.guide.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.24);
        this.powerTimer.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.25);
        this.moveHint.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.72);
        this.blocker.clear().beginFill(0x000000, 0.6).drawRect(screen.topLeft.x, screen.topLeft.y, screen.width, screen.height).endFill();
        this.powerVignette.position.set(screen.topLeft.x, screen.topLeft.y);
        this.powerVignette.width = screen.width;
        this.powerVignette.height = screen.height;
        this.blocker.hitArea = new PIXI.Rectangle(screen.topLeft.x, screen.topLeft.y, screen.width, screen.height);
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
        this.rebirthConfirm.position.set(screen.center.x, screen.center.y);
        this.rebirthConfirm.scale.set(Math.min(1, (screen.width - 24) / REBIRTH_SIZE.width, (screen.height - 80) / (REBIRTH_SIZE.height + RIBBON_OVERHANG)));
        this.tractorConfirm.position.copyFrom(this.rebirthConfirm.position);
        this.tractorConfirm.scale.set(Math.min(1, (screen.width - 24) / TRACTOR_OFFER_SIZE.width, (screen.height - 80) / (TRACTOR_OFFER_SIZE.height + RIBBON_OVERHANG)));
    }

    public override destroy(): void {
        DigProgress.onChange.remove(this.onChange);
        gsap.killTweensOf(this.blocker);
        this.claimTweens.forEach((tween) => tween.kill());
        UiAnim.kill(this);
        super.destroy({ children: true });
    }
}
