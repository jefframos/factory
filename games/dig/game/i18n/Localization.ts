// Localization.ts
//
// Every player-facing string, backed by ./locales/<code>.json (clog's system: en.json is written by hand — and its
// data names generated from ui/dig.json / levels/hub.json — the rest are machine-translated from it by
// `npm run translate:i18n` with GAME=dig). Locale files are picked up by glob, so a newly generated language works
// without touching this file; a string missing from it falls back to English, then to its id.
//
// Text is read when UI is built (`t('sell')`), so a language change is announced (onLocaleChange) and the scene
// rebuilds what shows text — the HUD and the hub's 3D price tags / signs — on the spot, no reload (like clog).

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, isSupportedLocale, type Locale } from './config';
import en from './locales/en.json';

type StringTable = Record<string, string>;
export type StringId = keyof typeof en;
type StringVars = Record<string, string | number>;

const STORAGE_KEY = 'DIG_LOCALE';

/** Every locale file present (eagerly bundled). */
const FILES = import.meta.glob<{ default: StringTable }>('./locales/*.json', { eager: true });
const TABLES: Partial<Record<Locale, StringTable>> = {};
for (const [path, module] of Object.entries(FILES)) {
    const code = path.replace(/^.*\/(.+)\.json$/, '$1');
    if (isSupportedLocale(code)) TABLES[code] = module.default;
}

function interpolate(template: string, vars: StringVars): string {
    return template.replace(/\{(\w+)\}/g, (match, key) => (key in vars ? String(vars[key]) : match));
}

class LocalizationService {
    private locale: Locale = DEFAULT_LOCALE;
    /** Dispatched with the new locale after setLocale(): rebuild whatever shows text. */
    readonly onLocaleChange: Signal = new Signal();

    get currentLocale(): Locale {
        return this.locale;
    }

    /** Locales with a translation file (the rest still work, in English). */
    hasTranslation(locale: Locale): boolean {
        return Boolean(TABLES[locale]);
    }

    /** The locales the picker offers: only those with a translation file (in SUPPORTED_LOCALES order). */
    get available(): Locale[] {
        return SUPPORTED_LOCALES.filter((locale) => this.hasTranslation(locale));
    }

    /** Call once at boot, before any UI is built: the saved choice, else the browser's language. */
    async load(): Promise<void> {
        try {
            const saved = await PlatformHandler.instance.platform.getItem(STORAGE_KEY);
            this.locale = saved && isSupportedLocale(saved) && this.hasTranslation(saved) ? saved : this.browserLocale();
        } catch (error) {
            console.error('Localization: failed to load saved locale', error);
            this.locale = this.browserLocale();
        }
    }

    /** Switches language now (onLocaleChange rebuilds the UI), then saves the choice. */
    async setLocale(locale: Locale): Promise<void> {
        if (!this.hasTranslation(locale) || locale === this.locale) return;
        this.locale = locale;
        this.onLocaleChange.dispatch(locale);
        try {
            await PlatformHandler.instance.platform.setItem(STORAGE_KEY, locale);
        } catch (error) {
            console.error('Localization: failed to save locale', error);
        }
    }

    private browserLocale(): Locale {
        const lang = navigator.language.toLowerCase();
        if (lang.startsWith('pt') && this.hasTranslation('pt-br')) return 'pt-br';
        if (lang.startsWith('zh') && this.hasTranslation('zh-cn')) return 'zh-cn';
        const base = lang.split('-')[0];
        return isSupportedLocale(base) && this.hasTranslation(base) ? base : DEFAULT_LOCALE;
    }

    /** A string by id (any key in en.json), with `{name}` placeholders filled from `vars`. */
    getString(id: StringId | string, vars?: StringVars, fallback?: string): string {
        const template = TABLES[this.locale]?.[id] ?? (en as StringTable)[id] ?? fallback ?? id;
        return vars ? interpolate(template, vars) : template;
    }
}

export const Localization = new LocalizationService();

/** Shorthand: `t('sell')`, `t('built', { name, built, total })`. */
export const t = (id: StringId, vars?: StringVars): string => Localization.getString(id, vars);

/** Key slug for names that have no id (buildables, wardrobe items): same rule as the en.json generator. */
const slug = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

/** Localized names of game data, falling back to the data's own (English) name. */
export const names = {
    material: (def: { id: string; name: string }) => Localization.getString(`material_${def.id}`, undefined, def.name),
    zone: (def: { id: string; name: string }) => Localization.getString(`zone_${def.id}`, undefined, def.name),
    tool: (def: { id: string; name: string }) => Localization.getString(`tool_${def.id}`, undefined, def.name),
    find: (def: { id: string; name: string }) => Localization.getString(`find_${def.id}`, undefined, def.name),
    achievement: (def: { id: string; name: string }) => Localization.getString(`achv_${def.id}`, undefined, def.name),
    achievementGoal: (def: { id: string; describe: string }, goal: string) => Localization.getString(`achv_${def.id}_goal`, { goal }, def.describe),
    decor: (def: { id: string; decor: string }) => Localization.getString(`achv_${def.id}_decor`, undefined, def.decor),
    area: (def: { id: string; name: string }) => Localization.getString(`area_${def.id}`, undefined, def.name),
    item: (name: string) => Localization.getString(`item_${slug(name)}`, undefined, name),
    look: (name: string) => Localization.getString(`look_${slug(name)}`, undefined, name),
    rarity: (rarity: string) => Localization.getString(`rarity_${rarity}`, undefined, rarity.toUpperCase()),
};
