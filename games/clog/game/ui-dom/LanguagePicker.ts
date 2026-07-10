import { Localization } from '../i18n/Localization';
import { withTap } from '../dom-ui/PanelChrome';
import { SUPPORTED_LOCALES, LOCALE_LABELS, LOCALE_FLAG_CODE, type Locale } from '../i18n/config';
import flagEng from '../dom-ui/flags/Icon_Flag_eng.png';
import flagEsp from '../dom-ui/flags/Icon_Flag_esp.png';
import flagIta from '../dom-ui/flags/Icon_Flag_ita.png';
import flagBrz from '../dom-ui/flags/Icon_Flag_brz.png';
import flagFra from '../dom-ui/flags/Icon_Flag_fra.png';
import flagDeu from '../dom-ui/flags/Icon_Flag_deu.png';
import flagJpn from '../dom-ui/flags/Icon_Flag_jpn.png';
import flagKor from '../dom-ui/flags/Icon_Flag_kor.png';
import flagChn from '../dom-ui/flags/Icon_Flag_chn.png';
import flagRus from '../dom-ui/flags/Icon_Flag_rus.png';

/** Static import map — Vite needs literal import statements to bundle these, so LOCALE_FLAG_CODE only carries the icon *key*, resolved here (same pattern as ShopScreen's ICONS). */
const FLAG_ICON: Record<string, string> = {
    eng: flagEng, esp: flagEsp, ita: flagIta, brz: flagBrz, fra: flagFra,
    deu: flagDeu, jpn: flagJpn, kor: flagKor, chn: flagChn, rus: flagRus,
};

function flagIcon(locale: Locale): string {
    return FLAG_ICON[LOCALE_FLAG_CODE[locale]];
}

/** Every flag in dom-ui/flags/ is a fixed 84x69 badge — sizing tiles to that exact ratio (instead of a square) is what keeps object-fit from letterboxing or cropping them. */
const FLAG_ASPECT = '84 / 69';
const SELECTED_BORDER = '#4ecdc4'; // same teal LeaderboardPanel/leaderboardRow use to mark "you" — reused here to mark "current language"

/**
 * Module-level (not per-call) so it survives SettingsButton rebuilding the
 * whole menu on a locale change (see SettingsButton.refreshIfOpen) — without
 * this, picking a flag would immediately re-collapse the grid, since a fresh
 * renderLanguageRow() call would otherwise always start from "collapsed".
 * Only the row's own click toggles this; selecting a language does not.
 */
let panelExpanded = false;

/**
 * Language row for the Settings menu (see SettingsMenu.renderSettingsMenu) —
 * collapsed shows the current language's flag + name; clicking it expands a
 * grid of every SUPPORTED_LOCALES entry, and picking one calls
 * Localization.setLocale(). The grid stays open across that pick (see
 * panelExpanded) — only clicking the row again collapses it.
 */
export function renderLanguageRow(container: HTMLElement): void {
    const row = document.createElement('button');
    row.className = 'btn btn-secondary btn-md btn-block btn-hug-start';
    Object.assign(row.style, { justifyContent: 'space-between', marginTop: '8px' });

    const current = document.createElement('span');
    Object.assign(current.style, { display: 'flex', alignItems: 'center', gap: '8px' });

    const currentFlag = document.createElement('img');
    currentFlag.className = 'btn-icon btn-icon-sm';
    currentFlag.src = flagIcon(Localization.currentLocale);

    const currentLabel = document.createElement('span');
    currentLabel.textContent = LOCALE_LABELS[Localization.currentLocale];

    current.appendChild(currentFlag);
    current.appendChild(currentLabel);

    const chevron = document.createElement('span');
    chevron.textContent = panelExpanded ? '▾' : '▸';

    row.appendChild(current);
    row.appendChild(chevron);

    // Animates open/closed via the CSS grid-rows accordion technique
    // (0fr <-> 1fr on a single-row grid wrapping an overflow:hidden inner)
    // instead of measuring scrollHeight in JS — this subtree is built
    // off-DOM before SettingsButton.open() attaches it, so a scrollHeight
    // read here (or even one rAF later) can't be trusted to reflect final
    // layout; animating a fr value has no such dependency; it always
    // resolves to the content's real natural height.
    const wrap = document.createElement('div');
    Object.assign(wrap.style, {
        display: 'grid',
        gridTemplateRows: panelExpanded ? '1fr' : '0fr',
        transition: 'grid-template-rows 0.25s ease, opacity 0.2s ease',
        opacity: panelExpanded ? '1' : '0',
    });

    const inner = document.createElement('div');
    inner.style.overflow = 'hidden';
    inner.style.minHeight = '0'; // grid items default to min-height:auto, which would ignore the 0fr row track and refuse to shrink below content size
    wrap.appendChild(inner);

    // Flag-only tiles, sized to the flags' own 84:69 aspect ratio (not a
    // shop-card — that button's 9-slice frame is scaled for the shop's
    // wide, full-viewport grid and turns to mush at this box's 280px width).
    // The language name only ever shows on the collapsed row above (see
    // `current`); the currently active tile is picked out with a border
    // instead of a label.
    const grid = document.createElement('div');
    Object.assign(grid.style, { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '6px', margin: '10px 0 0' });

    for (const locale of SUPPORTED_LOCALES) {
        const isCurrent = locale === Localization.currentLocale;

        const tile = document.createElement(isCurrent ? 'div' : 'button');
        tile.title = LOCALE_LABELS[locale];
        Object.assign(tile.style, {
            aspectRatio: FLAG_ASPECT,
            width: '100%',
            padding: '0',
            borderRadius: '4px',
            border: `2px solid ${isCurrent ? SELECTED_BORDER : 'transparent'}`,
            background: 'rgba(255,255,255,0.06)',
            cursor: isCurrent ? 'default' : 'pointer',
            overflow: 'hidden',
        });

        const flag = document.createElement('img');
        Object.assign(flag.style, { width: '100%', height: '100%', objectFit: 'cover', display: 'block' });
        flag.src = flagIcon(locale);
        tile.appendChild(flag);

        if (!isCurrent) tile.addEventListener('click', withTap(() => void Localization.setLocale(locale)));
        grid.appendChild(tile);
    }

    inner.appendChild(grid);

    row.addEventListener('click', withTap(() => {
        panelExpanded = !panelExpanded;
        wrap.style.gridTemplateRows = panelExpanded ? '1fr' : '0fr';
        wrap.style.opacity = panelExpanded ? '1' : '0';
        chevron.textContent = panelExpanded ? '▾' : '▸';
    }));

    container.appendChild(row);
    container.appendChild(wrap);
}
