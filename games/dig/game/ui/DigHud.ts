// DigHud.ts
//
// The on-screen UI (GDD §15), built from the UI kit (ui/uikit.json, bandit-controller's kit): money and
// backpack pills with a fill bar in the top-left (and a SELL button beside the backpack, to sell from
// anywhere in the mine), the current tool chip, short centre messages
// ("Backpack full!", "SOLD! +$42"), the find banner, and the hub stations' panels, open while the
// miner stands on their pad: the ATM's upgrades (the next tool and the next backpack, each with a buy
// button), the collection (CollectionPanel) and the wardrobe (WardrobePanel). The panels sit in the bottom
// half of the screen (shrunk to fit), so the miner stays in view, and each has a close button that keeps
// it shut until the miner steps off the pad.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { DigProgress } from '../data/DigProgress';
import { CollectionPanel, COLLECTION_SIZE } from './CollectionPanel';
import { WardrobePanel, WARDROBE_SIZE } from './WardrobePanel';
import { FindBanner } from './FindBanner';
import { AchievementsPanel, ACHIEVEMENTS_SIZE } from './AchievementsPanel';
import { ModelIcons } from './ModelIcons';
import { DIG, Rarity, ToolDef } from '../data/DigConfig';
import { RARITY_COLORS } from './CollectionPanel';
import SoundToggleButton from 'core/ui/SoundToggleButton';
import type { StationKind } from '../data/HubData';

const PILL_WIDTH = 210;
const PILL_HEIGHT = 46;
const ICON_SIZE = 58;
/** The backpack fill bar sits in the right part of its pill, after the count. */
const BAR_WIDTH = 72;
const BAR_X = 186;
const BAR_HEIGHT = 18;
const TOOL_SIZE = 96;
/** The current tool sits in the bottom-right corner: its frame, its name on a pill under it. */
const TOOL_PILL_WIDTH = 170;
const MUTE_SIZE = 64;
/** The achievements button, under the money / backpack pills: just the memo pad icon, no button shape. */
const ACHIEVEMENTS_BUTTON = 84;
const SELL_WIDTH = 86;
const SELL_HEIGHT = 46;
const UPGRADE_SIZE = { width: 620, height: 480 };
/** Tool timeline in the upgrade panel: node size and the tractor's (the goal) bigger node. */
const NODE_SIZE = 60;
const GOAL_SIZE = 78;
const TIMELINE_WIDTH = 500;
const LINE_DONE = 0x5fd35a;
const LINE_TODO = 0x4a5263;
/** Offer rows: frame left, name + details, buy button right. */
const OFFER = { frameX: -235, textX: -178, textWidth: 300, buttonX: 215, buttonWidth: 130 };
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
    if (tool.vehicle) return `Power ${tool.power} · digs ${tool.area} wide · ride it!`;
    return `Power ${tool.power}${tool.area > 1 ? ` · digs ${tool.area} wide` : ''}`;
}

/** A tool's picture: its atlas icon, or for the tractor a render of its model. */
function toolArt(tool: ToolDef, size: number): PIXI.Sprite {
    return tool.vehicle ? ModelIcons.sprite(`./dig/models/${DIG.tractor.model}`, size) : toolIcon(tool.icon, size);
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
    private readonly backpackText = UiKit.text('hud', 'backpack', { count: 0, capacity: 0 });
    private readonly barFill = new PIXI.Container();
    private readonly toolChip = new PIXI.Container();
    private readonly toast = UiKit.text('hud', 'toast', { text: '' });
    /** The guide's current step (Guide.ts), on a pill near the top; hidden when there's none. */
    private readonly guide = new PIXI.Container();
    private readonly guideText = UiKit.text('hud', 'guide', { text: '' });
    private guideShown: string | null = null;
    private readonly sellButton = new PIXI.Container();
    private readonly panel = new PIXI.Container();
    private readonly panelBody = new PIXI.Container();
    private panelOpen = false;
    private readonly collection = new CollectionPanel();
    private readonly wardrobe: WardrobePanel;
    private readonly achievements: AchievementsPanel;
    private readonly achievementsButton = new PIXI.Container();
    private readonly achievementsAlert = new PIXI.Container();
    public readonly findBanner = new FindBanner();
    private station: StationKind | null = null;
    private readonly slots: PanelSlot[] = [];
    private lastMoney = -1;
    /** Money and items of a sale still flying to the sell pad: shown as not yet earned / still carried. */
    private heldMoney = 0;
    private heldItems = 0;
    private readonly onChange = () => this.refresh();

    /**
     * `onBuy` runs after a purchase so the scene can react (swap the tool in hand); `onSell` when SELL
     * is tapped; `onWear` after the wardrobe changes the miner's look.
     */
    public constructor(private readonly onBuy: () => void, private readonly onSell: () => void, onWear: () => void) {
        super();
        this.buildCorner();
        this.toast.alpha = 0;
        this.buildPanel();
        this.wardrobe = new WardrobePanel(onWear, (text, color) => this.say(text, color));
        this.achievements = new AchievementsPanel((text, color) => this.say(text, color));
        this.buildAchievementsButton();
        this.guide.addChild(UiKit.image('hud', 'pill', 420, 50), this.guideText);
        this.guide.visible = false;
        this.addChild(this.corner, this.toolChip, this.buildMute(), this.guide,
            this.slot(this.panel, UPGRADE_SIZE),
            this.slot(this.collection, COLLECTION_SIZE),
            this.slot(this.wardrobe, WARDROBE_SIZE),
            this.slot(this.achievements, ACHIEVEMENTS_SIZE, true),
            this.findBanner, this.toast);
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
            this.closeStationPanel();
        });
        panel.addChild(close);
        this.slots.push({ holder, ...size, fullScreen });
        return holder;
    }

    /** The close button: hides the open panel; it stays shut until the miner leaves the pad (setStationPanel). */
    private closeStationPanel(): void {
        this.toolChip.visible = true;
        this.achievements.visible = false;
        this.setUpgradePanel(false);
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
        label.anchor.set(0, 0.5);
        label.position.set(ICON_SIZE + 8, -2);
        row.addChild(back, symbol, label);
        return row;
    }

    private buildCorner(): void {
        this.corner.addChild(this.pill('moneyIcon', this.moneyText, 0));
        const bag = this.pill('backpackIcon', this.backpackText, 62);
        const bar = new PIXI.Container();
        bar.position.set(BAR_X, -2);
        bar.addChild(UiKit.image('hud', 'barBack', BAR_WIDTH, BAR_HEIGHT));
        bar.addChild(this.barFill);
        bag.addChild(bar);
        this.corner.addChild(bag);

        this.sellButton.position.set(BAR_X + BAR_WIDTH / 2 + 18 + SELL_WIDTH / 2, 62);
        this.sellButton.addChild(UiKit.image('hud', 'sellButton', SELL_WIDTH, SELL_HEIGHT), UiKit.text('hud', 'sellLabel'));
        this.sellButton.eventMode = 'static';
        this.sellButton.cursor = 'pointer';
        // Taps on HUD buttons must not also start the movement joystick underneath.
        this.sellButton.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.sellButton.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            UiAnim.punch(this.sellButton, 0.15);
            this.onSell();
        });
        this.corner.addChild(this.sellButton);
    }

    /** The memo pad under the pills (no button shape: the icon reads on its own); the pizza game's "!" bobs on it while a tier is ready to claim. */
    private buildAchievementsButton(): void {
        this.achievementsButton.position.set(ACHIEVEMENTS_BUTTON / 2, 150);
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

    /** Opens/closes the achievements (in the same bottom-half slot as the station panels). */
    private toggleAchievements(): void {
        if (this.achievements.visible) {
            this.closeStationPanel();
            return;
        }
        this.setUpgradePanel(false);
        this.collection.visible = false;
        this.wardrobe.visible = false;
        this.toolChip.visible = false;
        this.achievements.refresh();
        this.achievements.visible = true;
        UiAnim.popIn(this.achievements);
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
        this.say('SOLD! +$0', 0x9cff9c);
        gsap.killTweensOf(this.toast);
        UiAnim.countUp(this.toast, 0, earned, (value) => `SOLD! +$${value}`, duration);
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
        this.sellButton.visible = DigProgress.backpackCount > 0;
        this.backpackText.text = `${count}/${capacity}`;
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
        const name = UiKit.text('hud', 'toolName', { name: tool.name.toUpperCase() });
        name.y = TOOL_SIZE / 2 + 12;
        // Bottom-right: the tool in its frame, its name on a pill under it (shrunk to fit, never cut).
        const pill = UiKit.image('hud', 'pill', TOOL_PILL_WIDTH, 34);
        pill.y = TOOL_SIZE / 2 + 26;
        pill.alpha = 0.9;
        name.y = TOOL_SIZE / 2 + 24;
        UiKit.fit(name, TOOL_PILL_WIDTH - 16);
        this.toolChip.addChild(UiKit.image('upgrades', toolFrame(tool, true), TOOL_SIZE, TOOL_SIZE), toolArt(tool, TOOL_SIZE * 0.72), pill, name);

        if (this.panelOpen) {
            this.renderPanel();
        }
        if (this.station === 'wardrobe') {
            this.wardrobe.refresh();
        }
        this.achievementsAlert.visible = DigProgress.claimableAchievements > 0;
        if (this.achievements.visible) {
            this.achievements.refresh();
        }
    }

    /** Opens the panel of the station the miner stands on (null = none): ATM upgrades, collection, wardrobe. */
    public setStationPanel(kind: StationKind | null): void {
        if (kind === this.station) return;
        this.station = kind;
        // The open panel fills the bottom of the screen, where the tool chip sits.
        this.toolChip.visible = kind === null && !this.achievements.visible;
        if (kind !== null) this.achievements.visible = false;
        this.setUpgradePanel(kind === 'atm');
        this.collection.visible = kind === 'collection';
        this.wardrobe.visible = kind === 'wardrobe';
        if (kind === 'collection') {
            this.collection.refresh(DigProgress.unseenFinds);
            DigProgress.markFindsSeen();
            UiAnim.popIn(this.collection);
        } else if (kind === 'wardrobe') {
            this.wardrobe.refresh();
            DigProgress.markWardrobeSeen();
            UiAnim.popIn(this.wardrobe);
        }
    }

    /** The guide's line (null hides it); pops in when it changes so the new step gets noticed. */
    public setGuide(text: string | null): void {
        if (text === this.guideShown) return;
        this.guideShown = text;
        this.guide.visible = text !== null;
        if (text === null) return;
        this.guideText.text = text;
        UiKit.fit(this.guideText, 390);
        // A fresh pill sized to the text (stretching the old one would stretch its corners too).
        this.guide.removeChildAt(0).destroy({ children: true });
        this.guide.addChildAt(UiKit.image('hud', 'pill', Math.max(260, this.guideText.width + 60), 50), 0);
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
        }
    }

    /**
     * The tool path as a timeline (shovel ... tractor, owned / next / later), the next tool's offer under it,
     * the backpack, and a line on where the path ends.
     */
    private renderPanel(): void {
        this.panelBody.removeChildren().forEach((child) => child.destroy({ children: true }));
        const tool = DigProgress.nextTool;
        const bag = DigProgress.nextBackpack;
        this.panelBody.addChild(this.timeline(-160));
        this.panelBody.addChild(this.offer(
            -25,
            toolArt(tool ?? DigProgress.tool, 64),
            tool ? tool.name.toUpperCase() : 'TRACTOR OWNED',
            tool ? toolDetail(tool) : 'The best there is: ride it in the mine',
            tool?.price,
            () => DigProgress.buyTool(),
            { frame: toolFrame(tool ?? DigProgress.tool, !tool), rarity: (tool ?? DigProgress.tool).rarity },
        ));
        this.panelBody.addChild(this.offer(
            100,
            icon('hud', 'backpackIcon', 64),
            bag ? `BACKPACK ${bag.capacity}` : 'BIGGEST BACKPACK',
            bag ? `Holds ${bag.capacity} items` : 'Nothing left to buy',
            bag?.price,
            () => DigProgress.buyBackpack(),
        ));
        const goal = DIG.tools[DIG.tools.length - 1];
        const footer = UiKit.text('upgrades', 'itemInfo', {
            text: DigProgress.hasTractor ? 'You ride the tractor outside the hub!' : `Goal: the ${goal.name.toUpperCase()} · digs ${goal.area} wide · ride it at ${DIG.tractor.speedMultiplier}x speed`,
        });
        footer.anchor.set(0.5);
        footer.y = UPGRADE_SIZE.height / 2 - 30;
        UiKit.fit(footer, UPGRADE_SIZE.width - 50);
        this.panelBody.addChild(footer);
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
                text: i < owned ? '' : i === owned ? 'NOW' : goal ? `GOAL\n$${tool.price.toLocaleString('en-US')}` : `$${tool.price.toLocaleString('en-US')}`,
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

    /** `look.frame` swaps the icon frame (a tool's rarity / grey); `look.rarity` names it in its colour after the title. */
    private offer(y: number, symbol: PIXI.Container, title: string, detail: string, price: number | undefined, buy: () => boolean,
        look: { frame?: string; rarity?: Rarity } = {}): PIXI.Container {
        const row = new PIXI.Container();
        row.y = y;
        row.addChild(UiKit.image('upgrades', 'rowBack', UPGRADE_SIZE.width - 36, 104));
        const frame = UiKit.image('upgrades', look.frame ?? 'itemFrame', 86, 86);
        frame.x = OFFER.frameX;
        symbol.x = OFFER.frameX;
        const name = UiKit.fit(UiKit.text('upgrades', 'itemName', { name: title }), OFFER.textWidth);
        name.anchor.set(0, 0.5);
        name.position.set(OFFER.textX, -14);
        const info = UiKit.fit(UiKit.text('upgrades', 'itemInfo', { text: detail }), OFFER.textWidth);
        info.anchor.set(0, 0.5);
        info.position.set(OFFER.textX, 16);
        row.addChild(frame, symbol, name, info);
        if (look.rarity) {
            const tag = UiKit.text('upgrades', 'rarityTag', { text: look.rarity.toUpperCase() }, { fill: RARITY_COLORS[look.rarity] });
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
                this.say('UPGRADED!', 0x9cff9c);
                this.onBuy();
            } else {
                this.say('NOT ENOUGH CASH', 0xff8a7a);
                UiAnim.shake(button, 8, 0.35);
            }
        });
        row.addChild(button);
        return row;
    }

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        this.corner.position.set(screen.topLeft.x + 20, screen.topLeft.y + 44);
        this.mute.position.set(screen.topLeft.x + screen.width - 20 - MUTE_SIZE / 2, screen.topLeft.y + 20 + MUTE_SIZE / 2);
        this.toolChip.position.set(screen.topLeft.x + screen.width - 20 - TOOL_PILL_WIDTH / 2, screen.topLeft.y + screen.height - 40 - TOOL_SIZE / 2 - 26);
        this.toast.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.16);
        this.guide.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.24);
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
        this.findBanner.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.36);
    }

    public override destroy(): void {
        DigProgress.onChange.remove(this.onChange);
        UiAnim.kill(this);
        super.destroy({ children: true });
    }
}
