// CitiesPanel.ts
//
// The cities, hole.io / Clash Royale style: a blue panel (the UI library's Popup08: a light title strip over a dark
// bar) listing every city as a row — its map picture, its name, and where it stands: HERE (the one being played,
// yellow frame), DONE (a check), NEW! (unlocked, never visited: pulsing), locked, or SOON — with a green PLAY button on
// any that can be travelled to (onTravel). Two ways in:
//   - select: from the town icon or the NEW CITY AVAILABLE button; a close button, the dim closes it too.
//   - complete: the tutorial done — "TUTORIAL COMPLETE!" with rays, stars and confetti, no way out but on: the next
//     city's button is the big pulsing one.
// The HUD puts a dim behind it and fits it to the screen (CITIES_PANEL_SIZE).

import * as PIXI from 'pixi.js';
import gsap from 'gsap';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { loadMiniature } from './TownMiniature';
import { t } from '../i18n/Localization';
import { CITIES, CITY, CityDef, NEXT_CITY } from '../data/MowConfig';
import { MowProgress } from '../data/MowProgress';
import { MowAudio } from '../audio/MowAudio';

const WIDTH = 600;
const ROW = { height: 112, gap: 10, picture: 132 };
const TOP = 132;
const BOTTOM = 40;
const HEIGHT = TOP + CITIES.length * (ROW.height + ROW.gap) - ROW.gap + BOTTOM;
/** Frame size, for the HUD to fit the panel on screen. */
export const CITIES_PANEL_SIZE = { width: WIDTH, height: HEIGHT };
/** The library's art is drawn this many times bigger than shown (its nine-slice borders are wider than a slim bar). */
const ART = 2;

/** A nine-slice image from the atlas, `width` x `height` on screen (drawn at ART times and scaled down). */
function sliced(texture: string, width: number, height: number, [left, top, right, bottom]: number[]): PIXI.NineSlicePlane {
    const plane = new PIXI.NineSlicePlane(PIXI.Texture.from(texture), left, top, right, bottom);
    plane.width = width * ART;
    plane.height = height * ART;
    plane.scale.set(1 / ART);
    plane.pivot.set((width * ART) / 2, (height * ART) / 2);
    return plane;
}

/** A library button (green / yellow / blue pill) with a label, `width` x `height`. */
function button(color: 'Green' | 'Yellow' | 'Blue', label: string, width: number, height: number, fontSize: number): PIXI.Container {
    const holder = new PIXI.Container();
    holder.addChild(sliced(`Button01_l_${color}`, width, height, [38, 62, 38, 70]));
    const text = UiKit.text('hud', 'toast', { text: label }, { fontSize, strokeThickness: Math.round(fontSize / 4.5) });
    text.anchor.set(0.5);
    text.y = -2;
    UiKit.fit(text, width - 24);
    holder.addChild(text);
    return holder;
}

/** A city's map picture (its map shot; the town's while it has none of its own). */
async function cityPicture(city: CityDef): Promise<PIXI.Texture | undefined> {
    return (city.map ? await loadMiniature(city.map) : null) ?? (await loadMiniature('town')) ?? undefined;
}

export type CitiesMode = 'select' | 'complete';

export class CitiesPanel extends PIXI.Container {
    private readonly body = new PIXI.Container();

    /** `onTravel(city)`: a city's PLAY; `onClose`: the close button (select mode). */
    public constructor(private readonly onTravel: (city: CityDef) => void, private readonly onClose: () => void) {
        super();
        this.visible = false;
        this.addChild(this.body);
    }

    public show(mode: CitiesMode): void {
        UiAnim.kill(this.body);
        this.body.removeChildren().forEach((child) => child.destroy({ children: true }));
        const top = -HEIGHT / 2;
        const complete = mode === 'complete';
        if (complete) UiAnim.rays(this.body, WIDTH * 0.85, 0xfff0a0, 0.65, 7);
        const frame = sliced('Popup08_Topbar_Divided_Single', WIDTH, HEIGHT, [52, 166, 52, 56]);
        // Taps on the panel must not fall through to the movement joystick underneath.
        frame.eventMode = 'static';
        frame.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        this.body.addChild(frame);

        // The title in the light strip, a line under it on the dark bar.
        const title = UiKit.text('hud', 'toast', { text: complete ? t(CITY.keepGear ? 'tutorialCompleteTitle' : 'cityCompleteTitle') : t('citiesTitle') },
            { fontSize: 40, strokeThickness: 9 });
        title.anchor.set(0.5);
        title.y = top + 36;
        UiKit.fit(title, WIDTH - 120);
        const subtitle = UiKit.text('hud', 'toast', { text: complete && CITY.keepGear ? t('cityCompleteKeepGear') : t('citiesSubtitle') },
            { fontSize: 17, strokeThickness: 4, fill: 0xbfe6ff });
        subtitle.anchor.set(0.5);
        subtitle.y = top + 83;
        UiKit.fit(subtitle, WIDTH - 60);
        this.body.addChild(title, subtitle);

        const rows: PIXI.Container[] = [];
        CITIES.forEach((city, i) => {
            const row = this.row(city, complete);
            row.y = top + TOP + i * (ROW.height + ROW.gap) + ROW.height / 2;
            rows.push(row);
            this.body.addChild(row);
        });

        if (!complete) {
            const close = new PIXI.Container();
            close.addChild(UiKit.sprite('hud', 'closeButton'), UiKit.sprite('hud', 'closeIcon'));
            close.scale.set(56 / Math.max(close.height, 1));
            close.position.set(WIDTH / 2 - 14, top + 14);
            close.eventMode = 'static';
            close.cursor = 'pointer';
            close.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
            close.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
                event.stopPropagation();
                this.onClose();
            });
            this.body.addChild(close);
        }

        // In: the panel springs up, the rows one after another; a celebration adds stars and confetti.
        this.body.scale.set(complete ? 0.2 : 0.6);
        gsap.to(this.body.scale, { x: 1, y: 1, duration: complete ? 0.7 : 0.4, ease: complete ? 'elastic.out(1, 0.55)' : 'back.out(1.8)' });
        UiAnim.staggerRise(rows, 0.15, 0.06, 30);
        if (complete) {
            const stars = [-1, 0, 1].map((side) => {
                const star = PIXI.Sprite.from('ItemIcon_Star_Gold');
                star.anchor.set(0.5);
                star.scale.set((side === 0 ? 92 : 68) / Math.max(star.texture.width, star.texture.height, 1));
                star.position.set(side * 230, top - (side === 0 ? 30 : 8));
                star.rotation = side * 0.3;
                return star;
            });
            this.body.addChild(...stars);
            UiAnim.staggerPop(stars, 0.5, 0.12);
            for (let wave = 0; wave < 4; wave++) {
                gsap.delayedCall(0.2 + wave * 1.1, () => {
                    if (!this.body.destroyed && this.visible) UiAnim.confetti(this.body, 0, top + 60, 90, 1.4);
                });
            }
        }
    }

    /** A city's row: picture, name, where it stands, and PLAY when it can be travelled to. */
    private row(city: CityDef, complete: boolean): PIXI.Container {
        const row = new PIXI.Container();
        const here = city.id === CITY.id;
        const done = MowProgress.completedCities.includes(city.id);
        const unlocked = MowProgress.cityUnlocked(city);
        const fresh = unlocked && !done && !here;
        const width = WIDTH - 48;
        row.addChild(sliced(here ? 'BorderFrame_Round20_Single_Yellow' : 'BorderFrame_Round20_Single_Dark', width, ROW.height, [20, 20, 20, 22]));
        const left = -width / 2;

        // The picture (dark for a locked city), on a light card.
        const card = sliced('CardFrame01_Bg_n', ROW.picture, ROW.height - 16, [22, 22, 22, 24]);
        card.tint = here ? 0xfff3c4 : done ? 0xd9ffd0 : unlocked ? 0xdff0ff : 0x6a6f86;
        card.x = left + 8 + ROW.picture / 2;
        const art = new PIXI.Container();
        art.x = card.x;
        row.addChild(card, art);
        if (city.map && unlocked) {
            void cityPicture(city).then((texture) => {
                if (!texture || art.destroyed) return;
                const sprite = new PIXI.Sprite(texture);
                sprite.anchor.set(0.5);
                sprite.scale.set(Math.min((ROW.picture - 12) / texture.width, (ROW.height - 26) / texture.height));
                art.addChild(sprite);
            });
        } else {
            const lock = PIXI.Sprite.from('Icon_Lock02');
            lock.anchor.set(0.5);
            lock.scale.set(44 / Math.max(lock.texture.width, lock.texture.height, 1));
            art.addChild(lock);
        }

        // Its name and where it stands.
        const textX = left + ROW.picture + 26;
        const name = UiKit.text('hud', 'toast', { text: city.comingSoon ? t('citySoonName') : city.name.toUpperCase() },
            { fontSize: 25, strokeThickness: 6, fill: here ? 0xffe27a : 0xffffff });
        name.anchor.set(0, 0.5);
        name.position.set(textX, -16);
        UiKit.fit(name, 250);
        const statusText = here ? t('cityHere') : done ? t('cityDone') : fresh ? t('cityNew') : city.comingSoon ? t('citySoon') : t('cityLocked');
        const status = UiKit.text('hud', 'toast', { text: statusText },
            { fontSize: 16, strokeThickness: 4, fill: here ? 0xffe27a : done ? 0x9cff6a : fresh ? 0x7fe0ff : 0x9aa0b8 });
        status.anchor.set(0, 0.5);
        status.position.set(textX, 18);
        row.addChild(name, status);
        if (done) {
            const check = UiKit.sprite('hud', 'check');
            check.scale.set(30 / Math.max(check.width, check.height, 1));
            check.position.set(card.x + ROW.picture / 2 - 10, -ROW.height / 2 + 18);
            row.addChild(check);
        }

        // PLAY: any unlocked city but this one (the next one big and pulsing when it's new).
        if (unlocked && !here) {
            const next = fresh && city === NEXT_CITY;
            const go = button('Green', next && complete ? t('cityGo') : t('cityPlay'), next ? 150 : 130, 62, next ? 26 : 22);
            go.x = width / 2 - 14 - (next ? 75 : 65);
            go.eventMode = 'static';
            go.cursor = 'pointer';
            go.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
            go.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
                event.stopPropagation();
                go.eventMode = 'none';
                MowAudio.play('click');
                UiAnim.punch(go, 0.2);
                this.onTravel(city);
            });
            row.addChild(go);
            if (fresh) {
                gsap.delayedCall(0.8, () => {
                    if (!go.destroyed) UiAnim.pulse(go, 0.08, 0.5);
                });
            }
        } else if (!unlocked) {
            row.alpha = 0.75;
        }
        return row;
    }
}
