// MowHud.ts
//
// The on-screen UI, from the UI kit (ui/uikit.json): money and bag pills top-right (the bag's fill bar turns red and
// gets a bobbing "FULL!" tag when full), mute and the language flag top-left, the current district's restoration
// (name, % and a bar) top-centre, short messages in the middle, the move hint for a brand-new player, and the SHOP
// panel — open while the player stands on an ATM's pad, laid out like dig's: a GEAR tab (every mower on a timeline
// up to the goal, the next mower's offer, the bag's capacity with its levels, and the goal along the bottom) and a
// BOOSTS tab once the first mower is bought (speed, money gain, cutting width, sharp blades); the guide's hand sits
// on the button it's pointing at.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import SoundToggleButton from 'core/ui/SoundToggleButton';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { MoveHint } from './MoveHint';
import { LanguagePanel, LANGUAGE_SIZE } from './LanguagePanel';
import { MowProgress } from '../data/MowProgress';
import { MOW, ToolDef, UpgradeDef } from '../data/MowConfig';
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
const SHOP = { width: 620, height: 580 };
/** Shop rows: frame left, text, buy button right. */
const ROW = { width: 556, frameX: -226, textX: -170, textWidth: 290, buttonX: 202, buttonWidth: 130 };
/** The tabs' content block (y = its top edge), and the GEAR tab's rows. */
const BLOCK = { top: -170, width: 580, height: 432, tabWidth: 170, tabHeight: 48 };
const GEAR_Y = { timeline: -110, tool: 28, bag: 146 };
const BOOST_ROW = { firstY: -116, step: 90, height: 82 };
const FOOTER_Y = 238;
/** The mower timeline: node sizes (the goal bigger), its width, line colours. */
const TIMELINE = { node: 60, goal: 78, width: 460 };
const LINE_DONE = 0x5fd35a;
const LINE_TODO = 0x4a5263;
const NEXT_GOLD = 0xffd86b;
const BAG_BAR = { width: 290, height: 9 };
/** Each mower's frame on the timeline, by its place on the path (the goal legendary). */
const TOOL_FRAMES = ['toolCommon', 'toolCommon', 'toolRare', 'toolRare', 'toolEpic', 'toolLegendary'];
const toolFrame = (index: number, owned: boolean): string => (owned ? TOOL_FRAMES[Math.min(index, TOOL_FRAMES.length - 1)] : 'toolLocked');

/** A mower's art for now: its placeholder cube's colour, as a little block with a handle. */
function mowerArt(tool: ToolDef, size: number): PIXI.Container {
    const art = new PIXI.Container();
    const s = size / 64;
    const handle = new PIXI.Graphics().lineStyle(5 * s, 0x2b2b30).moveTo(-14 * s, -4 * s).lineTo(-22 * s, -26 * s);
    const body = new PIXI.Graphics().lineStyle(3 * s, 0x1d140e).beginFill(new PIXI.Color(tool.color).toNumber())
        .drawRoundedRect(-18 * s, -10 * s, 36 * s, 24 * s, 6 * s).endFill();
    const wheels = new PIXI.Graphics().beginFill(0x2b2b30).drawCircle(-11 * s, 15 * s, 5 * s).drawCircle(11 * s, 15 * s, 5 * s).endFill();
    if (!tool.handheld) art.addChild(handle);
    art.addChild(body);
    if (!tool.handheld) art.addChild(wheels);
    return art;
}
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
    private readonly mute = new PIXI.Container();
    private readonly languageButton = new PIXI.Container();
    private readonly language = new LanguagePanel();
    private readonly languageHolder = new PIXI.Container();
    private readonly shop = new PIXI.Container();
    private readonly shopBody = new PIXI.Container();
    private readonly shopHolder = new PIXI.Container();
    private shopOpen = false;
    private shopKey = '';
    private hint: ShopHint = null;
    private tab: 'gear' | 'boosts' = 'gear';
    public readonly moveHint = new MoveHint();
    /** Money from a sale still landing: shown as not yet earned until releaseSale(). */
    private heldMoney = 0;
    private lastMoney = -1;
    private district = 0;
    private readonly onChange = () => this.refresh();

    /** `onBuy` after any purchase (the scene reacts: swaps the tool, plays effects). */
    public constructor(private readonly onBuy: () => void) {
        super();
        this.buildCorner();
        this.buildProgress();
        this.buildButtons();
        this.buildShop();
        this.languageHolder.addChild(this.language);
        this.addClose(this.language, LANGUAGE_SIZE, () => this.toggleLanguage());
        this.toast.alpha = 0;
        this.addChild(this.corner, this.progress, this.mute, this.languageButton, this.moveHint, this.shopHolder, this.languageHolder, this.toast);
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
        this.corner.addChild(this.pill('moneyIcon', this.moneyText, 0));
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
    private addClose(panel: PIXI.Container, size: { width: number; height: number }, onClose: () => void): void {
        const close = new PIXI.Container();
        close.addChild(icon('hud', 'closeButton', CLOSE_SIZE), icon('hud', 'closeIcon', CLOSE_SIZE * 0.5));
        close.position.set(size.width / 2 - 8, -size.height / 2 + 8);
        this.tappable(close, onClose);
        panel.addChild(close);
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
        bag.addChild(this.levelBar(capacity));
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

    /** An upgrade's levels as a segmented bar under its offer: owned green, the next gold and pulsing, the rest grey. */
    private levelBar(upgrade: UpgradeDef): PIXI.Container {
        const bar = new PIXI.Container();
        bar.position.set(ROW.textX, 38);
        const count = upgrade.maxLevel;
        const owned = MowProgress.upgradeLevel(upgrade.id);
        const gap = 3;
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
        return this.offer(
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
        );
    }

    /** An offer row: its art in a frame, the name and detail, and the buy button (MAX when there's nothing left). */
    private offer(y: number, symbol: PIXI.Container, title: string, detail: string, price: number | undefined, buy: () => boolean,
        pointed: boolean, frameId = 'itemFrame', height = 104): PIXI.Container {
        const row = new PIXI.Container();
        row.y = y;
        row.addChild(UiKit.image('upgrades', 'rowBack', ROW.width, height));
        const frameSize = Math.min(86, height - 14);
        const frame = UiKit.image('upgrades', frameId, frameSize, frameSize);
        frame.x = ROW.frameX;
        symbol.x = ROW.frameX;
        const name = UiKit.fit(UiKit.text('upgrades', 'itemName', { name: title }), ROW.textWidth);
        name.anchor.set(0, 0.5);
        name.position.set(ROW.textX, -14);
        const info = UiKit.fit(UiKit.text('upgrades', 'itemInfo', { text: detail }), ROW.textWidth);
        info.anchor.set(0, 0.5);
        info.position.set(ROW.textX, 14);
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
        const money = MowProgress.money - this.heldMoney;
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

    public reposition(): void {
        const screen = Game.overlayScreenData;
        if (!screen) return;
        this.corner.position.set(screen.topLeft.x + screen.width - 20 - CORNER_WIDTH, screen.topLeft.y + 44);
        this.mute.position.set(screen.topLeft.x + 20 + BUTTON_SIZE / 2, screen.topLeft.y + 20 + BUTTON_SIZE / 2);
        this.languageButton.position.set(this.mute.x + BUTTON_SIZE + 12, this.mute.y);
        this.progress.position.set(screen.center.x, screen.topLeft.y + 120);
        this.toast.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.24);
        this.moveHint.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.72);
        // The shop hangs in the bottom half, under the player; the language list in the middle.
        const top = screen.center.y + PANEL_TOP_GAP;
        const room = screen.topLeft.y + screen.height - 16 - top;
        const shopScale = Math.min(1, room / (SHOP.height + RIBBON_OVERHANG), (screen.width - 24) / (SHOP.width + CLOSE_SIZE / 2));
        this.shopHolder.scale.set(shopScale);
        this.shopHolder.position.set(screen.center.x, top + (RIBBON_OVERHANG + SHOP.height / 2) * shopScale);
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
