// MobHud.ts
//
// The 2D layer over the battle (PIXI, in the stage's design units; laid out on Game.gameScreenData):
// - top: the battle's name and the enemy base's HP bar;
// - top right: the coins;
// - bottom: "drag to aim" until the player first drags;
// - the end card: VICTORY (with the coins won) or DEFEAT, the cannon's fire-rate upgrade, and NEXT / RETRY.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { Game } from 'core/Game';
import { MAX_FIRE_LEVEL } from '../data/MobConfig';

const FONT = 'Baloo2-ExtraBold';
const INK = 0x1b2148;

const text = (value: string, size: number, color = 0xffffff, stroke = INK) => new PIXI.Text(value, {
    fontFamily: FONT, fontSize: size, fill: color, stroke, strokeThickness: Math.max(3, size * 0.14), lineJoin: 'round', align: 'center',
});

/** A chunky rounded button: a darker base under a lighter face, the label on it. */
function button(label: string, width: number, height: number, face: number, edge: number, onTap: () => void): PIXI.Container & { setLabel(l: string): void; setEnabled(on: boolean): void } {
    const holder = new PIXI.Container() as PIXI.Container & { setLabel(l: string): void; setEnabled(on: boolean): void };
    const base = new PIXI.Graphics().beginFill(edge).drawRoundedRect(-width / 2, -height / 2 + 6, width, height, height * 0.32).endFill();
    const top = new PIXI.Graphics().beginFill(face).drawRoundedRect(-width / 2, -height / 2, width, height, height * 0.32).endFill();
    const words = text(label, height * 0.42);
    words.anchor.set(0.5);
    holder.addChild(base, top, words);
    holder.eventMode = 'static';
    holder.cursor = 'pointer';
    let enabled = true;
    holder.on('pointertap', () => {
        if (!enabled) return;
        gsap.fromTo(holder.scale, { x: 0.92, y: 0.92 }, { x: 1, y: 1, duration: 0.25, ease: 'back.out(3)' });
        onTap();
    });
    holder.setLabel = (l: string) => { words.text = l; };
    holder.setEnabled = (on: boolean) => {
        enabled = on;
        holder.alpha = on ? 1 : 0.5;
        holder.cursor = on ? 'pointer' : 'default';
    };
    return holder;
}

export interface EndCard {
    won: boolean;
    reward: number;
    fireLevel: number;
    upgradeCost: number | null;
    coins: number;
}

export class MobHud extends PIXI.Container {
    private readonly title = text('', 34);
    private readonly barBack = new PIXI.Graphics();
    private readonly barFill = new PIXI.Graphics();
    private readonly hpText = text('', 26);
    private readonly coinPill = new PIXI.Container();
    private readonly coinText = text('0', 30, 0xffe066);
    private readonly hint = new PIXI.Container();
    private readonly card = new PIXI.Container();
    private readonly dim = new PIXI.Graphics();
    private readonly cardTitle = text('', 76);
    private readonly cardReward = text('', 40, 0xffe066);
    private readonly upgrade: ReturnType<typeof button>;
    private readonly upgradeInfo = text('', 26);
    private readonly next: ReturnType<typeof button>;
    private hpShown = 1;
    private barWidth = 420;

    public constructor(onNext: () => void, onUpgrade: () => void) {
        super();
        this.title.anchor.set(0.5, 0);
        this.hpText.anchor.set(0.5);
        this.addChild(this.title, this.barBack, this.barFill, this.hpText);

        const pill = new PIXI.Graphics().beginFill(0x000000, 0.35).drawRoundedRect(-80, -26, 160, 52, 26).endFill();
        const coin = new PIXI.Graphics().beginFill(0xffd23f).lineStyle(4, 0xc98a00).drawCircle(-52, 0, 17).endFill();
        this.coinText.anchor.set(0.5);
        this.coinText.x = 14;
        this.coinPill.addChild(pill, coin, this.coinText);
        this.addChild(this.coinPill);

        const hintText = text('DRAG TO AIM', 40);
        hintText.anchor.set(0.5);
        const arrows = text('◀            ▶', 44);
        arrows.anchor.set(0.5);
        this.hint.addChild(arrows, hintText);
        this.addChild(this.hint);
        gsap.to(arrows.scale, { x: 1.12, duration: 0.6, yoyo: true, repeat: -1, ease: 'sine.inOut' });

        this.dim.eventMode = 'static';
        this.cardTitle.anchor.set(0.5);
        this.cardReward.anchor.set(0.5);
        this.upgradeInfo.anchor.set(0.5);
        this.upgrade = button('', 420, 92, 0x3b8cff, 0x245fbf, onUpgrade);
        this.next = button('NEXT', 320, 100, 0x5ad14a, 0x2f9a2a, onNext);
        this.card.addChild(this.dim, this.cardTitle, this.cardReward, this.upgradeInfo, this.upgrade, this.next);
        this.card.visible = false;
        this.addChild(this.card);
        this.layout();
    }

    public layout(): void {
        const screen = Game.gameScreenData;
        if (!screen) return;
        const { topLeft, topRight, bottomLeft, center, width, height } = screen;
        const top = topLeft.y + 24;
        this.title.position.set(center.x, top);
        this.barWidth = Math.min(460, width - 220);
        const barY = top + 62;
        this.barBack.clear().beginFill(0x000000, 0.4).drawRoundedRect(center.x - this.barWidth / 2 - 6, barY - 6, this.barWidth + 12, 40, 20).endFill();
        this.hpText.position.set(center.x, barY + 14);
        this.drawBar();
        this.coinPill.position.set(topRight.x - 100, top + 30);
        this.hint.position.set(center.x, bottomLeft.y - Math.min(220, height * 0.16));
        this.dim.clear().beginFill(0x0b1030, 0.6).drawRect(topLeft.x, topLeft.y, width, height).endFill();
        this.cardTitle.position.set(center.x, center.y - 210);
        this.cardReward.position.set(center.x, center.y - 110);
        this.upgradeInfo.position.set(center.x, center.y - 20);
        this.upgrade.position.set(center.x, center.y + 50);
        this.next.position.set(center.x, center.y + 200);
    }

    private drawBar(): void {
        const screen = Game.gameScreenData;
        if (!screen) return;
        const barY = screen.topLeft.y + 24 + 62;
        const x = screen.center.x - this.barWidth / 2;
        this.barFill.clear().beginFill(0xff3d4f).drawRoundedRect(x, barY, Math.max(28, this.barWidth * this.hpShown), 28, 14).endFill();
        this.barFill.visible = this.hpShown > 0;
    }

    public setTitle(value: string): void {
        this.title.text = value;
    }

    public setBaseHp(hp: number, max: number): void {
        const share = max > 0 ? hp / max : 0;
        if (Math.abs(share - this.hpShown) > 0.0001) {
            this.hpShown = share;
            this.drawBar();
        }
        this.hpText.text = `${hp}`;
    }

    public setCoins(coins: number): void {
        this.coinText.text = `${coins}`;
    }

    public hideHint(): void {
        if (!this.hint.visible) return;
        gsap.to(this.hint, { alpha: 0, duration: 0.3, onComplete: () => { this.hint.visible = false; } });
    }

    public showEnd(card: EndCard): void {
        this.cardTitle.text = card.won ? 'VICTORY!' : 'DEFEAT';
        this.cardTitle.style.fill = card.won ? 0xffe066 : 0xff6b7a;
        this.cardReward.text = card.won ? `+${card.reward} coins` : 'The base held. Try again!';
        this.cardReward.style.fill = card.won ? 0xffe066 : 0xffffff;
        this.next.setLabel(card.won ? 'NEXT' : 'RETRY');
        this.refreshUpgrade(card);
        this.card.visible = true;
        this.card.alpha = 0;
        gsap.to(this.card, { alpha: 1, duration: 0.3 });
        gsap.fromTo(this.cardTitle.scale, { x: 0.3, y: 0.3 }, { x: 1, y: 1, duration: 0.5, ease: 'back.out(2.5)' });
    }

    public refreshUpgrade(card: Pick<EndCard, 'fireLevel' | 'upgradeCost' | 'coins'>): void {
        const max = card.upgradeCost === null;
        this.upgradeInfo.text = `CANNON FIRE RATE  Lv ${card.fireLevel}/${MAX_FIRE_LEVEL}`;
        this.upgrade.setLabel(max ? 'MAXED' : `UPGRADE  ${card.upgradeCost}`);
        this.upgrade.setEnabled(!max && card.coins >= (card.upgradeCost ?? Infinity));
    }

    public hideEnd(): void {
        this.card.visible = false;
    }
}
