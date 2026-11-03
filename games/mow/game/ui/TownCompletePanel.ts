// TownCompletePanel.ts
//
// The end of a city (every area restored): the City Complete screen over a dim — it bounces in big with rays and waves
// of confetti: a ribbon ("CITY COMPLETE!", or "TUTORIAL COMPLETE!"), the city's map picture at 100% with a check, what
// it earned (the prestige bonus for every city from now on, or "your gear comes with you" from the tutorial), how the
// run went, then the cities in a row — done (a check), the next (faded, pulsing), the rest locked — and one green
// button: GO TO <the next city>. hole.io's city picker is the model; later the same row lets the player pick any
// unlocked city or replay one.
// Styles: the UI kit's "upgrades" panel and ribbon, the "achievements" button.

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { loadMiniature } from './TownMiniature';
import { t } from '../i18n/Localization';
import { CITIES, CITY, CityDef, NEXT_CITY, PRESTIGE_BONUS } from '../data/MowConfig';

const WIDTH = 620;
const HEIGHT = 650;
/** Frame size, for the HUD to fit the panel on screen. */
export const TOWN_COMPLETE_SIZE = { width: WIDTH, height: HEIGHT };
const PICTURE = { width: 300, height: 220 };
const CARD = { width: 104, height: 92, gap: 10 };
const BUTTON = { width: 330, height: 72 };
/** Confetti waves while it's up (seconds apart), and how many. */
const CONFETTI_EVERY = 1.1;
const CONFETTI_WAVES = 4;

/** How the run went, for the panel's lines. */
export interface TownCompleteStats {
    town: string;
    earned: number;
    trophies: { found: number; total: number };
    secrets: { found: number; total: number };
}

/** A city's map picture (its map shot; the town's while it has none of its own). */
async function cityPicture(city: CityDef): Promise<PIXI.Texture | undefined> {
    return (city.map ? await loadMiniature(city.map) : null) ?? (await loadMiniature('town')) ?? undefined;
}

export class TownCompletePanel extends PIXI.Container {
    private readonly body = new PIXI.Container();

    /** `onTravel`: the green button was tapped (the scene travels to the next city). */
    public constructor(private readonly onTravel: () => void) {
        super();
        this.visible = false;
        this.addChild(this.body);
    }

    /** Builds it for `stats` (call before showing it). */
    public show(stats: TownCompleteStats): void {
        UiAnim.kill(this.body);
        this.body.removeChildren().forEach((child) => child.destroy({ children: true }));
        const top = -HEIGHT / 2;
        const tutorial = !!CITY.keepGear;
        UiAnim.rays(this.body, WIDTH * 0.85, 0xfff0a0, 0.7, 7);
        const frame = UiKit.image('upgrades', 'panel', WIDTH, HEIGHT);
        // Taps on the panel must not fall through to the movement joystick underneath.
        frame.eventMode = 'static';
        frame.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        const ribbon = UiKit.sprite('upgrades', 'ribbon', 0.72);
        ribbon.y = top;
        const title = UiKit.text('upgrades', 'title', {}, { fontSize: 46 });
        title.anchor.set(0.5);
        title.text = t(tutorial ? 'tutorialCompleteTitle' : 'cityCompleteTitle');
        UiKit.fit(title, 500);
        title.y = top - 6;
        const stars = [-1, 0, 1].map((side) => {
            const star = PIXI.Sprite.from('ItemIcon_Star_Gold');
            star.anchor.set(0.5);
            star.scale.set((side === 0 ? 96 : 72) / Math.max(star.texture.width, star.texture.height, 1));
            star.position.set(side * 250, top - 30 + (side === 0 ? -40 : -14));
            star.rotation = side * 0.3;
            return star;
        });

        // The city's picture, whole, with its name and a check.
        const picture = new PIXI.Container();
        picture.y = top + 70 + PICTURE.height / 2;
        const name = this.line(stats.town.toUpperCase(), 30, 0xffe27a);
        name.y = top + 54;
        void cityPicture(CITY).then((texture) => this.fillPicture(picture, texture));
        const check = UiKit.sprite('hud', 'check');
        check.scale.set(64 / Math.max(check.width, check.height, 1));
        check.position.set(PICTURE.width / 2 - 10, PICTURE.height / 2 - 18);
        picture.addChild(check);

        // What it earned, and how it went.
        let y = picture.y + PICTURE.height / 2 + 30;
        const reward = this.line(tutorial ? t('cityCompleteKeepGear') : t('cityCompleteBonus', { percent: Math.round(PRESTIGE_BONUS * 100) }), 24, 0x9cff9c);
        reward.y = y;
        y += 34;
        const run = this.line(`${t('townCompleteEarned', { amount: stats.earned.toLocaleString('en-US') })}   ·   ${t('cityCompleteTrophies', stats.trophies)}`, 18, 0xffffff);
        run.y = y;

        // The cities: done, next, locked.
        const row = new PIXI.Container();
        row.y = y + 30 + CARD.height / 2;
        const shown = CITIES.slice(0, 5);
        shown.forEach((city, i) => {
            const card = this.card(city);
            card.x = (i - (shown.length - 1) / 2) * (CARD.width + CARD.gap);
            row.addChild(card);
        });

        // One way on.
        const next = NEXT_CITY && !NEXT_CITY.comingSoon ? NEXT_CITY : undefined;
        const button = new PIXI.Container();
        button.addChild(UiKit.image('achievements', 'buttonClaim', BUTTON.width, BUTTON.height));
        const label = UiKit.text('achievements', 'buttonLabel', { text: next ? t('cityCompleteGo', { city: next.name.toUpperCase() }) : t('townCompleteMore') }, { fontSize: 26 });
        UiKit.fit(label, BUTTON.width - 24);
        button.addChild(label);
        button.y = row.y + CARD.height / 2 + 26 + BUTTON.height / 2;
        if (next) {
            button.eventMode = 'static';
            button.cursor = 'pointer';
            button.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
            button.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
                event.stopPropagation();
                button.eventMode = 'none';
                UiAnim.punch(button, 0.2);
                this.onTravel();
            });
            // After it has popped in (a pulse from scale 0 would keep it tiny).
            gsap.delayedCall(1.5, () => {
                if (!button.destroyed) UiAnim.pulse(button, 0.07, 0.5);
            });
        } else {
            button.alpha = 0.6;
        }

        this.body.addChild(frame, picture, name, reward, run, row, button, ribbon, title, ...stars);
        // In big: the whole panel springs up from small, the title and the picture bounce after it, then the stars.
        this.body.scale.set(0.2);
        gsap.to(this.body.scale, { x: 1, y: 1, duration: 0.7, ease: 'elastic.out(1, 0.55)' });
        for (const [target, delay] of [[title, 0.3], [picture, 0.45], [row, 0.7], [button, 0.85]] as const) {
            const scale = target.scale.x;
            target.scale.set(0);
            gsap.to(target.scale, { x: scale, y: scale, duration: 0.55, delay, ease: 'back.out(2.4)' });
        }
        UiAnim.staggerPop(stars, 0.5, 0.12);
        for (let wave = 0; wave < CONFETTI_WAVES; wave++) {
            gsap.delayedCall(0.2 + wave * CONFETTI_EVERY, () => {
                if (!this.body.destroyed && this.visible) UiAnim.confetti(this.body, 0, top + 80, 90, 1.4);
            });
        }
    }

    private line(text: string, size: number, fill: number): PIXI.Text {
        const label = UiKit.text('hud', 'toast', { text }, { fontSize: size, strokeThickness: Math.round(size / 4.5), fill, align: 'center' });
        label.anchor.set(0.5);
        UiKit.fit(label, WIDTH - 60);
        return label;
    }

    /** The city's picture, fitted into PICTURE (a plain frame if it isn't baked yet). */
    private fillPicture(holder: PIXI.Container, texture?: PIXI.Texture): void {
        if (holder.destroyed) return;
        if (!texture) {
            holder.addChildAt(new PIXI.Graphics().beginFill(0x3a6b3a).drawRoundedRect(-PICTURE.width / 2, -PICTURE.height / 2, PICTURE.width, PICTURE.height, 18).endFill(), 0);
            return;
        }
        const sprite = new PIXI.Sprite(texture);
        sprite.anchor.set(0.5);
        sprite.scale.set(Math.min(PICTURE.width / texture.width, PICTURE.height / texture.height));
        holder.addChildAt(sprite, 0);
    }

    /** A city's card: done (its picture, a check), the next (its picture faded, pulsing), locked (dark, a lock), soon. */
    private card(city: CityDef): PIXI.Container {
        const card = new PIXI.Container();
        const done = city.id === CITY.id || CITIES.indexOf(city) < CITIES.indexOf(CITY);
        const next = city === NEXT_CITY && !city.comingSoon;
        card.addChild(new PIXI.Graphics()
            .lineStyle(3, done ? 0x9cff6a : next ? 0xffe27a : 0x6a6a7a, 1)
            .beginFill(done ? 0x2f5a2a : next ? 0x2a2350 : 0x24242c, 0.95)
            .drawRoundedRect(-CARD.width / 2, -CARD.height / 2, CARD.width, CARD.height, 14).endFill());
        const art = new PIXI.Container();
        art.y = -10;
        card.addChild(art);
        if (city.map && (done || next)) {
            void cityPicture(city).then((texture) => {
                if (!texture || art.destroyed) return;
                const sprite = new PIXI.Sprite(texture);
                sprite.anchor.set(0.5);
                sprite.scale.set(Math.min((CARD.width - 16) / texture.width, (CARD.height - 34) / texture.height));
                if (next) sprite.alpha = 0.45;
                art.addChild(sprite);
            });
        }
        if (!done && !next) {
            const lock = PIXI.Sprite.from('Icon_Lock02');
            lock.anchor.set(0.5);
            lock.scale.set(34 / Math.max(lock.texture.width, lock.texture.height, 1));
            art.addChild(lock);
        }
        if (done) {
            const check = UiKit.sprite('hud', 'check');
            check.scale.set(30 / Math.max(check.width, check.height, 1));
            check.position.set(CARD.width / 2 - 12, -CARD.height / 2 + 12);
            card.addChild(check);
        }
        const name = UiKit.text('hud', 'toast', { text: city.comingSoon ? t('citySoon') : city.name.toUpperCase() }, { fontSize: 13, strokeThickness: 3, fill: next ? 0xffe27a : 0xffffff });
        name.anchor.set(0.5);
        name.y = CARD.height / 2 - 14;
        UiKit.fit(name, CARD.width - 10);
        card.addChild(name);
        if (next) UiAnim.pulse(card, 0.06, 0.6);
        else if (!done) card.alpha = 0.7;
        return card;
    }
}
