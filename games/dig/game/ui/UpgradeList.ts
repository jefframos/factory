// UpgradeList.ts
//
// A panel of things to buy, a row each, as many pages as it takes: its picture, name, what it does now and next, its level's bar
// and its price on a button (POWER-UPS for cash, the medals' perks). An `action` along the bottom (REBIRTH), a line above it.

import * as PIXI from 'pixi.js';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { t } from '../i18n/Localization';
import { shortNumber } from '../utils/Numbers';
import { DigAudio } from '../audio/DigAudio';

const WIDTH = 760;
const HEIGHT = 690;
export const UPGRADE_LIST_SIZE = { width: WIDTH, height: HEIGHT };
const ROW = { width: 712, height: 88, step: 96, perPage: 5, firstY: -HEIGHT / 2 + 108 };
const AT = { icon: -304, frame: 72, art: 52, text: -250, textWidth: 396, button: 270, buttonWidth: 156 };
const BAR = { width: 396, height: 9, most: 25 };
const COLORS = { done: 0x5fd35a, next: 0xffd86b, todo: 0x4a5263 };
const PAGER_Y = HEIGHT / 2 - 148;
const FOOTER_Y = HEIGHT / 2 - 98;
const ACTION = { y: HEIGHT / 2 - 48, width: 420, height: 68 };

export interface UpgradeRow {
    id: string;
    icon: string;
    name: string;
    info: string;
    level: number;
    max: number;
    /** Its level counts up to this (a milestone), if not to `max`. */
    toward?: number;
    /** Its price (undefined: at the top), and whether that's there. */
    price?: number;
    affordable: boolean;
    buy(): boolean;
}

export interface UpgradeListSpec {
    title: string;
    ribbon: string;
    stroke: number;
    /** What a price is in: before the number, or an icon after it. */
    currency: { prefix?: string; icon?: string };
    /** What there is of it, at the top right, if it isn't on the HUD. */
    purse?(): string;
    rows(): UpgradeRow[];
    footer(): string;
    action?: { label(): string; enabled(): boolean; tap(): void };
    notEnough(): void;
    bought(id: string): void;
}

export class UpgradeList extends PIXI.Container {
    private readonly body = new PIXI.Container();
    private page = 0;
    private drawn = '';

    public constructor(private readonly spec: UpgradeListSpec) {
        super();
        const frame = UiKit.image('upgrades', 'panel', WIDTH, HEIGHT);
        // Taps on the panel must not fall through to the movement joystick underneath.
        frame.eventMode = 'static';
        frame.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        const ribbon = UiKit.sprite('upgrades', spec.ribbon, 0.55);
        ribbon.y = -HEIGHT / 2;
        const title = UiKit.text('upgrades', 'title');
        title.text = spec.title;
        title.style.stroke = spec.stroke;
        UiKit.fit(title, 270);
        title.y = -HEIGHT / 2 - 5;
        this.addChild(frame, ribbon, title, this.body);
        this.visible = false;
    }

    /** What it shows has changed since it was drawn. */
    public get stale(): boolean {
        return this.key() !== this.drawn;
    }

    private key(): string {
        return `${this.spec.rows().map((row) => `${row.level}${row.affordable ? '+' : '-'}`).join()}|${this.spec.purse?.() ?? ''}|${this.spec.action ? `${this.spec.action.label()}${this.spec.action.enabled()}` : ''}`;
    }

    public refresh(): void {
        this.drawn = this.key();
        // (The old rows' tweens first: one left on a destroyed sprite stalls every other animation.)
        UiAnim.kill(this.body);
        this.body.removeChildren().forEach((child) => child.destroy({ children: true }));
        const rows = this.spec.rows();
        const pages = Math.ceil(rows.length / ROW.perPage);
        this.page = Math.min(this.page, pages - 1);
        rows.slice(this.page * ROW.perPage, (this.page + 1) * ROW.perPage).forEach((row, i) => this.body.addChild(this.row(row, ROW.firstY + i * ROW.step)));
        if (pages > 1) {
            const label = UiKit.text('wardrobe', 'page', { page: this.page + 1, pages }, { fontSize: 24, strokeThickness: 6 });
            label.anchor.set(0.5);
            label.y = PAGER_Y;
            this.body.addChild(label, this.arrow('arrowLeft', -150, -1, pages), this.arrow('arrowRight', 150, 1, pages));
        }
        const footer = UiKit.fit(UiKit.text('upgrades', 'itemInfo', { text: this.spec.footer() }), WIDTH - 60);
        footer.anchor.set(0.5);
        footer.y = this.spec.action ? FOOTER_Y : FOOTER_Y + 34;
        this.body.addChild(footer);
        const purse = this.spec.purse?.();
        if (purse) {
            const held = UiKit.text('hud', 'toast', { text: purse }, { fontSize: 30, fill: 0xffe27a, strokeThickness: 6 });
            held.anchor.set(0, 0.5);
            held.position.set(-WIDTH / 2 + 74, -HEIGHT / 2 + 40);
            this.body.addChild(held);
            const { icon } = this.spec.currency;
            if (icon) this.body.addChild(this.sprite(icon, 40, -WIDTH / 2 + 48, -HEIGHT / 2 + 40));
        }
        if (this.spec.action) this.body.addChild(this.action(this.spec.action));
    }

    private sprite(frame: string, size: number, x: number, y = 0): PIXI.Sprite {
        const sprite = PIXI.Sprite.from(frame);
        sprite.anchor.set(0.5);
        sprite.scale.set(size / Math.max(sprite.texture.width, sprite.texture.height, 1));
        sprite.position.set(x, y);
        return sprite;
    }

    private row(row: UpgradeRow, y: number): PIXI.Container {
        const line = new PIXI.Container();
        line.y = y;
        line.addChild(UiKit.image('upgrades', 'rowBack', ROW.width, ROW.height));
        const frame = UiKit.image('upgrades', 'itemFrame', AT.frame, AT.frame);
        frame.x = AT.icon;
        const name = UiKit.fit(UiKit.text('upgrades', 'itemName', { name: row.name.toUpperCase() }), AT.textWidth);
        name.anchor.set(0, 0.5);
        name.position.set(AT.text, -21);
        const info = UiKit.fit(UiKit.text('upgrades', 'itemInfo', { text: row.info }), AT.textWidth);
        info.anchor.set(0, 0.5);
        info.position.set(AT.text, 7);
        line.addChild(frame, this.sprite(row.icon, AT.art, AT.icon), name, info, this.bar(row));
        const button = new PIXI.Container();
        button.x = AT.button;
        line.addChild(button);
        if (row.price === undefined) {
            button.addChild(UiKit.image('upgrades', 'lockedButton', AT.buttonWidth, 62), UiKit.text('upgrades', 'maxLabel'));
            return line;
        }
        const price = UiKit.text('upgrades', 'buyLabel', { price: '' });
        const { prefix = '', icon } = this.spec.currency;
        price.text = `${prefix}${shortNumber(row.price)}`;
        UiKit.fit(price, AT.buttonWidth - (icon ? 64 : 22));
        button.addChild(UiKit.image('upgrades', row.affordable ? 'buyButton' : 'lockedButton', AT.buttonWidth, 62), price);
        if (icon) {
            price.x = -16;
            button.addChild(this.sprite(icon, 34, 44, -2));
        }
        if (row.affordable) UiAnim.pulse(button, 0.05, 0.6);
        this.tappable(button, () => {
            if (row.buy()) {
                DigAudio.play('buyCash');
                DigAudio.play('buyShine');
                this.spec.bought(row.id);
                this.refresh();
                return;
            }
            this.spec.notEnough();
            DigAudio.play('error');
            UiAnim.shake(button, 8, 0.35);
        });
        return line;
    }

    /** Its level: a segment each when they're few, one bar toward the next milestone when they're many. */
    private bar(row: UpgradeRow): PIXI.Container {
        const bar = new PIXI.Container();
        bar.position.set(AT.text, 31);
        const box = (x: number, width: number, color: number) => {
            const part = new PIXI.Graphics().beginFill(color).drawRoundedRect(0, -BAR.height / 2, width, BAR.height, 3).endFill();
            part.x = x;
            bar.addChild(part);
            return part;
        };
        if (row.max <= BAR.most && !row.toward) {
            const gap = row.max > 16 ? 2 : 3;
            const width = (BAR.width - gap * (row.max - 1)) / row.max;
            for (let i = 0; i < row.max; i++) box(i * (width + gap), width, i < row.level ? COLORS.done : i === row.level ? COLORS.next : COLORS.todo);
            return bar;
        }
        box(0, BAR.width, COLORS.todo);
        const share = Math.min(1, row.level / (row.toward ?? row.max));
        if (share > 0) box(0, Math.max(6, BAR.width * share), COLORS.done);
        return bar;
    }

    private action(action: NonNullable<UpgradeListSpec['action']>): PIXI.Container {
        const enabled = action.enabled();
        const button = new PIXI.Container();
        button.y = ACTION.y;
        const label = UiKit.text('upgrades', 'buyLabel', { price: '' });
        label.text = action.label();
        UiKit.fit(label, ACTION.width - 30);
        button.addChild(UiKit.image('upgrades', enabled ? 'buyButton' : 'lockedButton', ACTION.width, ACTION.height), label);
        if (!enabled) return button;
        UiAnim.pulse(button, 0.04, 0.6);
        this.tappable(button, () => action.tap());
        return button;
    }

    private arrow(id: string, x: number, step: number, pages: number): PIXI.Container {
        const arrow = UiKit.sprite('wardrobe', id);
        // (Its touch area much bigger than it: a thumb's.)
        const height = Math.max(arrow.height, 1);
        arrow.hitArea = new PIXI.Rectangle(-height, -height * 0.7, height * 2, height * 1.4);
        arrow.scale.set(50 / height);
        arrow.position.set(x, PAGER_Y);
        this.tappable(arrow, () => {
            this.page = (this.page + step + pages) % pages;
            DigAudio.play('click');
            this.refresh();
        });
        return arrow;
    }

    private tappable(target: PIXI.Container, action: () => void): void {
        target.eventMode = 'static';
        target.cursor = 'pointer';
        target.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        target.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            action();
        });
    }
}

/** "Level 3" or "Level 3 / 20", what it does now and next. */
export const levelInfo = (level: number, max: number, now: string, next?: string): string => `${t('boostLevel', { level, max })}  ·  ${next === undefined ? now : `${now}  →  ${next}`}`;
