// DigHud.ts
//
// The on-screen UI (GDD §15), built from the UI kit (ui/uikit.json, bandit-controller's kit): money and
// backpack pills with a fill bar in the top-left (and a SELL button beside the backpack, to sell from
// anywhere in the mine), the current tool chip, short centre messages
// ("Backpack full!", "SOLD! +$42"), the find banner, and the hub stations' panels, open while the
// miner stands on their pad: the ATM's upgrades (the next tool and the next backpack, each with a buy
// button), the collection (CollectionPanel) and the wardrobe (WardrobePanel).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { DigProgress } from '../data/DigProgress';
import { CollectionPanel } from './CollectionPanel';
import { WardrobePanel } from './WardrobePanel';
import { FindBanner } from './FindBanner';
import type { StationKind } from '../data/HubData';

const PILL_WIDTH = 210;
const PILL_HEIGHT = 46;
const ICON_SIZE = 58;
/** The backpack fill bar sits in the right part of its pill, after the count. */
const BAR_WIDTH = 72;
const BAR_X = 186;
const BAR_HEIGHT = 18;
const TOOL_SIZE = 84;
const SELL_WIDTH = 86;
const SELL_HEIGHT = 46;

/** A kit image sized to fit `size` (keeps aspect). */
function icon(screen: string, id: string, size: number): PIXI.Container {
    const sprite = UiKit.sprite(screen, id);
    sprite.scale.set(size / Math.max(sprite.width, sprite.height));
    return sprite;
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
    private readonly sellButton = new PIXI.Container();
    private readonly panel = new PIXI.Container();
    private readonly panelBody = new PIXI.Container();
    private panelOpen = false;
    private readonly collection = new CollectionPanel();
    private readonly wardrobe: WardrobePanel;
    public readonly findBanner = new FindBanner();
    private station: StationKind | null = null;
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
        this.addChild(this.corner, this.panel, this.collection, this.wardrobe, this.findBanner, this.toast);
        DigProgress.onChange.add(this.onChange);
        this.refresh();
        this.reposition();
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
        this.toolChip.position.set(TOOL_SIZE / 2, 150);
        this.corner.addChild(this.toolChip);
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
        this.toolChip.addChild(UiKit.image('hud', 'toolFrame', TOOL_SIZE, TOOL_SIZE), toolIcon(tool.icon, TOOL_SIZE * 0.7), name);

        if (this.panelOpen) {
            this.renderPanel();
        }
        if (this.station === 'wardrobe') {
            this.wardrobe.refresh();
        }
    }

    /** Opens the panel of the station the miner stands on (null = none): ATM upgrades, collection, wardrobe. */
    public setStationPanel(kind: StationKind | null): void {
        if (kind === this.station) return;
        this.station = kind;
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
        const frame = UiKit.image('upgrades', 'panel', 460, 330);
        const ribbon = UiKit.sprite('upgrades', 'ribbon', 0.55);
        ribbon.y = -165;
        const title = UiKit.text('upgrades', 'title');
        title.y = -170;
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

    private renderPanel(): void {
        this.panelBody.removeChildren().forEach((child) => child.destroy({ children: true }));
        const tool = DigProgress.nextTool;
        const bag = DigProgress.nextBackpack;
        this.panelBody.addChild(this.offer(
            -50,
            tool ? toolIcon(tool.icon, 64) : toolIcon(DigProgress.tool.icon, 64),
            tool ? tool.name.toUpperCase() : 'BEST TOOL OWNED',
            tool ? `Power ${tool.power}${tool.area > 1 ? ` · digs ${tool.area} wide` : ''}` : 'Nothing left to buy',
            tool?.price,
            () => DigProgress.buyTool(),
        ));
        this.panelBody.addChild(this.offer(
            70,
            icon('hud', 'backpackIcon', 64),
            bag ? `BACKPACK ${bag.capacity}` : 'BIGGEST BACKPACK',
            bag ? `Holds ${bag.capacity} items` : 'Nothing left to buy',
            bag?.price,
            () => DigProgress.buyBackpack(),
        ));
    }

    private offer(y: number, symbol: PIXI.Container, title: string, detail: string, price: number | undefined, buy: () => boolean): PIXI.Container {
        const row = new PIXI.Container();
        row.y = y;
        const frame = UiKit.image('upgrades', 'itemFrame', 86, 86);
        frame.x = -160;
        symbol.x = -160;
        const name = UiKit.text('upgrades', 'itemName', { name: title });
        name.anchor.set(0, 0.5);
        name.position.set(-105, -14);
        const info = UiKit.text('upgrades', 'itemInfo', { text: detail });
        info.anchor.set(0, 0.5);
        info.position.set(-105, 16);
        row.addChild(frame, symbol, name, info);

        const button = new PIXI.Container();
        button.position.set(140, 0);
        if (price === undefined) {
            button.addChild(UiKit.image('upgrades', 'lockedButton', 110, 64), UiKit.text('upgrades', 'maxLabel'));
            row.addChild(button);
            return row;
        }
        const affordable = DigProgress.money >= price;
        button.addChild(UiKit.image('upgrades', affordable ? 'buyButton' : 'lockedButton', 110, 64), UiKit.text('upgrades', 'buyLabel', { price }));
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
        this.toast.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.16);
        this.panel.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.7);
        this.collection.position.set(screen.center.x, screen.center.y + 50);
        this.wardrobe.position.set(screen.center.x, screen.center.y + 90);
        this.findBanner.position.set(screen.center.x, screen.topLeft.y + screen.height * 0.36);
    }

    public override destroy(): void {
        DigProgress.onChange.remove(this.onChange);
        UiAnim.kill(this);
        super.destroy({ children: true });
    }
}
