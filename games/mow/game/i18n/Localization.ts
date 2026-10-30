// Localization.ts
//
// Every player-facing string, backed by ./locales/<code>.json (en.json is written by hand, with a key for each name
// in ui/mow.json; the rest are translated from it by `npm run i18n:update` with GAME=mow). Locale files are picked up by glob, so a newly generated language works
// without touching this file; a string missing from it falls back to English, then to its id.
//
// The language at boot: the platform's own setting where it has one (YouTube), else the saved choice, else the
// browser's preferred languages, else English (load()).
//
// Text is read when UI is built (`t('sell')`), so a language change is announced (onLocaleChange) and the scene
// rebuilds what shows text (the HUD) on the spot, no reload.

import { Signal } from 'signals';
import PlatformHandler from 'core/platforms/PlatformHandler';
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, isSupportedLocale, type Locale } from './config';
import en from './locales/en.json';

type StringTable = Record<string, string>;
export type StringId = keyof typeof en;
type StringVars = Record<string, string | number>;

const STORAGE_KEY = 'MOW_LOCALE';

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
    /** The platform supplies the language (load()): a choice made in the menu isn't saved over it. */
    private platformLanguage = false;
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

    /**
     * Call once at boot, before any UI is built. The language comes from, in order:
     *  1. the platform's own language setting, where it has one (YouTube Playables' ytgame.system.getLanguage(), which
     *     its rules say to use instead of the browser's — and not to save a choice over it: platformLanguage);
     *  2. the player's saved choice (picked in the language menu);
     *  3. the browser's preferred languages, the first one the game has;
     *  4. English.
     */
    async load(): Promise<void> {
        const platform = PlatformHandler.instance.platform;
        try {
            const tag = await platform.getLanguage?.();
            const fromPlatform = tag ? this.match(tag) : undefined;
            if (fromPlatform) {
                this.platformLanguage = true;
                this.locale = fromPlatform;
                return;
            }
        } catch (error) {
            console.warn('Localization: platform language unavailable', error);
        }
        try {
            const saved = await platform.getItem(STORAGE_KEY);
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
        // The platform owns the language there: the choice lasts this session, nothing saved over its setting.
        if (this.platformLanguage) return;
        try {
            await PlatformHandler.instance.platform.setItem(STORAGE_KEY, locale);
        } catch (error) {
            console.error('Localization: failed to save locale', error);
        }
    }

    /** The first of the browser's preferred languages (navigator.languages, in order) the game has; else English. */
    private browserLocale(): Locale {
        const tags = navigator.languages?.length ? navigator.languages : [navigator.language];
        for (const tag of tags) {
            const locale = this.match(tag);
            if (locale) return locale;
        }
        return DEFAULT_LOCALE;
    }

    /**
     * A BCP-47 tag ("pt-BR", "es-419", "zh-TW", "nb") to the game's locale for it, if it has a translation: any
     * Portuguese -> Brazilian Portuguese, any Chinese -> Simplified Chinese, otherwise by its language part.
     */
    private match(tag: string): Locale | undefined {
        const lang = tag.toLowerCase();
        const base = lang.split(/[-_]/)[0];
        const candidate = base === 'pt' ? 'pt-br' : base === 'zh' ? 'zh-cn' : base === 'in' ? 'id' : base;
        return isSupportedLocale(candidate) && this.hasTranslation(candidate) ? candidate : undefined;
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

/** Localized names of game data, falling back to the data's own (English) name. */
export const names = {
    /** A tool / mower (ui/mow.json tools). */
    tool: (def: { id: string; name: string }) => Localization.getString(`tool_${def.id}`, undefined, def.name),
    /** A grass type (ui/mow.json grass). */
    grass: (def: { id: string; name: string }) => Localization.getString(`grass_${def.id}`, undefined, def.name),
    /** A district (ui/mow.json districts). */
    district: (def: { id: string; name: string }) => Localization.getString(`district_${def.id}`, undefined, def.name),
    /** An upgrade track (ui/mow.json upgrades). */
    upgrade: (def: { id: string; name: string }) => Localization.getString(`upgrade_${def.id}`, undefined, def.name),
};
