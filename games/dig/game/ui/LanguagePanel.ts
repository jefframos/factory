// LanguagePanel.ts
//
// The settings menu's language list (opened from the HUD's gear button, next to mute): every supported language as
// a flag and its own name (clog's LOCALE_LABELS / flags, so a player recognizes theirs whatever the UI is in), the
// current one highlighted. Picking one switches straight away: the scene rebuilds the HUD (reopening this list) and
// the hub's 3D labels in the new language. Styles: ui/uikit.json (screen "language").

import * as PIXI from 'pixi.js';
import { UiKit } from './UiKit';
import { UiAnim } from './UiAnim';
import { Localization } from '../i18n/Localization';
import { LOCALE_FLAG_CODE, LOCALE_LABELS, type Locale } from '../i18n/config';
import { DigAudio } from '../audio/DigAudio';

const COLUMNS = 3;
const OPTION = { width: 190, height: 54, gapX: 12, gapY: 10 };
const ROWS = Math.ceil(Localization.available.length / COLUMNS);
const WIDTH = COLUMNS * OPTION.width + (COLUMNS - 1) * OPTION.gapX + 50;
const TOP = 60;
const HEIGHT = TOP + ROWS * OPTION.height + (ROWS - 1) * OPTION.gapY + 34;
/** Frame size, for the HUD to fit the panel on screen. */
export const LANGUAGE_SIZE = { width: WIDTH, height: HEIGHT };
const FLAG = 38;

export class LanguagePanel extends PIXI.Container {
    private readonly body = new PIXI.Container();

    public constructor() {
        super();
        const frame = UiKit.image('language', 'panel', WIDTH, HEIGHT);
        const ribbon = UiKit.sprite('language', 'ribbon', 0.55);
        ribbon.y = -HEIGHT / 2;
        const title = UiKit.text('language', 'title');
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
        const left = -WIDTH / 2 + 25 + OPTION.width / 2;
        Localization.available.forEach((locale, i) => {
            const option = this.option(locale);
            option.position.set(left + (i % COLUMNS) * (OPTION.width + OPTION.gapX), -HEIGHT / 2 + TOP + OPTION.height / 2 + Math.floor(i / COLUMNS) * (OPTION.height + OPTION.gapY));
            this.body.addChild(option);
        });
    }

    private option(locale: Locale): PIXI.Container {
        const current = locale === Localization.currentLocale;
        const option = new PIXI.Container();
        option.addChild(UiKit.image('language', current ? 'optionActive' : 'option', OPTION.width, OPTION.height));
        const flag = PIXI.Sprite.from(`Icon_Flag_${LOCALE_FLAG_CODE[locale]}`);
        flag.anchor.set(0.5);
        flag.scale.set(FLAG / Math.max(flag.texture.width, flag.texture.height, 1));
        flag.x = -OPTION.width / 2 + 12 + FLAG / 2;
        const label = UiKit.text('language', 'optionLabel', { text: LOCALE_LABELS[locale] });
        label.anchor.set(0, 0.5);
        label.position.set(flag.x + FLAG / 2 + 10, -2);
        option.addChild(flag, label);
        option.eventMode = 'static';
        option.cursor = 'pointer';
        option.on('pointerdown', (event: PIXI.FederatedPointerEvent) => event.stopPropagation());
        option.on('pointertap', (event: PIXI.FederatedPointerEvent) => {
            event.stopPropagation();
            if (current) return;
            UiAnim.punch(option, 0.1);
            DigAudio.play('confirm');
            void Localization.setLocale(locale);
        });
        return option;
    }
}
