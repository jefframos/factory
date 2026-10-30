// MinesPanel.ts
//
// Opened from the HUD's MAP button: every mine the player has opened, one row each — its number, its tool and
// backpack and the cash waiting there — with GO to travel to it (the one being played says HERE). Under them, the
// next mine: OPEN once the newest mine has its Tractor (asks first: the HUD's confirmation), otherwise locked with
// what it takes. Each mine keeps its own run (DigProgress.mine()); the looks, hub, collection and the new-mine bonus
// are shared. Shows the newest MAX_ROWS mines. Styles: the upgrade panel's (ui/uikit.json screen "upgrades").

import * as PIXI from 'pixi.js';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { DIG } from '../data/DigConfig';
import { DigProgress } from '../data/DigProgress';
import { t, names } from '../i18n/Localization';

/** Wide enough that the ribbon's tails clear the close button in the corner. */
const WIDTH = 660;
const ROW = { height: 92, step: 102, width: WIDTH - 48 };
const MAX_ROWS = 4;
const HEADER = 74;
const FOOTER = 60;
/** Room for the mines shown plus the next-mine row. */
const HEIGHT = HEADER + (MAX_ROWS + 1) * ROW.step + FOOTER;
/** Frame size, for the HUD to fit the panel on screen. */
export const MINES_SIZE = { width: WIDTH, height: HEIGHT };
const BADGE = 70;
const TEXT_X = -ROW.width / 2 + 24 + BADGE + 18;
const TEXT_WIDTH = 320;
const BUTTON = { x: ROW.width / 2 - 82, width: 140, height: 60 };

export class MinesPanel extends PIXI.Container {
    private readonly body = new PIXI.Container();

    /** `onTravel` with the mine to go to; `onOpenNew` to ask about opening the next one. */
    public constructor(private readonly onTravel: (index: number) => void, private readonly onOpenNew: () => void) {
        super();
        const frame = UiKit.image('upgrades', 'panel', WIDTH, HEIGHT);
        // Purple, like the NEW MINE gems: the mines have their own colour, not the upgrades' green.
        const ribbon = UiKit.sprite('upgrades', 'ribbonPurple', 0.55);
        ribbon.y = -HEIGHT / 2;
        const title = UiKit.text('upgrades', 'title');
        title.text = t('titleMines');
        UiKit.fit(title, 260);
        title.y = -HEIGHT / 2 - 5;
        // Taps on the panel must not fall through to the movement joystick underneath.
        frame.eventMode = 'static';
        frame.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.addChild(frame, ribbon, title, this.body);
        this.visible = false;
    }

    public refresh(): void {
        UiAnim.kill(this.body);
        this.body.removeChildren().forEach((child) => child.destroy({ children: true }));
        const count = DigProgress.mineCount;
        const first = Math.max(0, count - MAX_ROWS);
        let y = -HEIGHT / 2 + HEADER + ROW.step / 2;
        for (let i = first; i < count; i++, y += ROW.step) this.body.addChild(this.mineRow(i, y));
        this.body.addChild(this.nextRow(count, y));
        const mines = DigProgress.prestige;
        const footer = UiKit.fit(UiKit.text('upgrades', 'itemInfo', {
            text: mines > 0
                ? t('mineBonus', { mine: mines + 1, sell: Math.round(DIG.prestige.sellBonus * mines * 100), dig: Math.round(DIG.prestige.digBonus * mines * 100) })
                : t('minesHint'),
        }), WIDTH - 50);
        footer.anchor.set(0.5);
        footer.y = HEIGHT / 2 - 32;
        this.body.addChild(footer);
    }

    /** A mine's row: "#n", its tool / backpack / cash, GO (or HERE for the one being played). */
    private mineRow(index: number, y: number): PIXI.Container {
        const mine = DigProgress.mine(index);
        const here = index === DigProgress.currentMine;
        const tool = DIG.tools[Math.min(mine.toolLevel, DIG.tools.length - 1)];
        const capacity = DIG.backpack[Math.min(mine.backpackLevel, DIG.backpack.length - 1)].capacity;
        const row = this.rowBase(y, `#${index + 1}`);
        this.texts(row, t('mineName', { mine: index + 1 }) + (mine.toolLevel >= DIG.tools.length - 1 ? `  ${t('mineMaxed')}` : ''),
            t('mineInfo', { tool: names.tool(tool), capacity, money: mine.money.toLocaleString('en-US') }));
        row.addChild(here ? this.button(t('mineHere'), 'lockedButton') : this.button(t('mineGo'), 'buyButton', () => this.onTravel(index)));
        return row;
    }

    /** The next mine: OPEN once the newest has its Tractor, otherwise locked with what it takes. */
    private nextRow(index: number, y: number): PIXI.Container {
        const ready = DigProgress.canOpenNewMine;
        const row = this.rowBase(y, `#${index + 1}`);
        const bonus = DigProgress.prestige + 1;
        this.texts(row, t('newMineTitle', { mine: index + 1 }), ready
            ? t('newMineInfo', { sell: Math.round(DIG.prestige.sellBonus * bonus * 100), dig: Math.round(DIG.prestige.digBonus * bonus * 100) })
            : t('mineLocked', { tool: names.tool(DIG.tools[DIG.tools.length - 1]), mine: index }));
        if (ready) {
            const open = this.button(t('newMineGo'), 'buyButton', () => this.onOpenNew());
            UiAnim.pulse(open, 0.05, 0.6);
            row.addChild(open);
        } else {
            row.alpha = 0.55;
            const lock = UiKit.sprite('wardrobe', 'lockIcon');
            lock.scale.set(40 / Math.max(lock.height, 1));
            lock.x = BUTTON.x;
            row.addChild(lock);
        }
        return row;
    }

    private rowBase(y: number, badge: string): PIXI.Container {
        const row = new PIXI.Container();
        row.y = y;
        row.addChild(UiKit.image('upgrades', 'rowBack', ROW.width, ROW.height));
        const box = UiKit.image('upgrades', 'itemFrame', BADGE, BADGE);
        box.x = -ROW.width / 2 + 24 + BADGE / 2;
        const number = UiKit.fit(UiKit.text('upgrades', 'itemName', { name: badge }), BADGE - 10);
        number.anchor.set(0.5);
        number.x = box.x;
        row.addChild(box, number);
        return row;
    }

    private texts(row: PIXI.Container, title: string, detail: string): void {
        const name = UiKit.fit(UiKit.text('upgrades', 'itemName', { name: title }), TEXT_WIDTH);
        name.anchor.set(0, 0.5);
        name.position.set(TEXT_X, -13);
        const info = UiKit.fit(UiKit.text('upgrades', 'itemInfo', { text: detail }), TEXT_WIDTH);
        info.anchor.set(0, 0.5);
        info.position.set(TEXT_X, 16);
        row.addChild(name, info);
    }

    private button(label: string, image: string, onTap?: () => void): PIXI.Container {
        const button = new PIXI.Container();
        button.x = BUTTON.x;
        const text = UiKit.fit(UiKit.text('upgrades', 'buyLabel', { price: '' }), BUTTON.width - 20);
        text.text = label;
        UiKit.fit(text, BUTTON.width - 20);
        button.addChild(UiKit.image('upgrades', image, BUTTON.width, BUTTON.height), text);
        if (!onTap) return button;
        button.eventMode = 'static';
        button.cursor = 'pointer';
        button.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        button.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            onTap();
        });
        return button;
    }
}
